import { BadRequestException, Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ENTRY_UNITS, ENTRY_UNIT_CODES, entryUnitLabel } from '../../common/segments/segments';
import { readUnitCategories, unitList, UNIT_CATEGORIES_KEY, type EntryKind } from '../../common/segments/unit-categories';
import { CategoriesService } from './categories.service';

/**
 * Kiritish bo'limlari moddalari — har bo'lim (Markaz, Hududlar, Tax free, Marksheyder, Fermer xo'jaligi,
 * Buxgalteriya xizmatlari) alohida: o'z xarajat moddalari va daromad turlari. Boshida bo'sh.
 */
@Controller('unit-categories')
export class UnitCategoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly categories: CategoriesService,
  ) {}

  private kindOf(raw: unknown): EntryKind {
    if (raw === 'expense' || raw === 'income') return raw;
    throw new BadRequestException("Turi noto'g'ri: expense yoki income");
  }

  private unitOf(raw: unknown): string {
    if (typeof raw === 'string' && ENTRY_UNIT_CODES.includes(raw)) return raw;
    throw new BadRequestException("Bo'lim noto'g'ri");
  }

  /** ?kind=expense|income — har bo'lim ro'yxati (bo'sh bo'lishi mumkin) */
  @Get()
  async get(@Query('kind') kindRaw?: string) {
    const kind = this.kindOf(kindRaw);
    const lists = await readUnitCategories(this.prisma);
    return { data: { kind, units: ENTRY_UNITS.map((u) => ({ code: u.code, label: u.label, codes: unitList(lists, kind, u.code) })) } };
  }

  private async write(kind: EntryKind, unit: string, codes: string[]): Promise<void> {
    const row = await this.prisma.setting.findUnique({ where: { key: UNIT_CATEGORIES_KEY } });
    const prev = (row?.value ?? {}) as Record<string, Record<string, string[]>>;
    const value = { ...prev, [kind]: { ...(prev[kind] ?? {}), [unit]: codes } };
    await this.prisma.setting.upsert({ where: { key: UNIT_CATEGORIES_KEY }, create: { key: UNIT_CATEGORIES_KEY, value }, update: { value } });
  }

  /** Bo'lim ro'yxatini saqlash (mavjud moddalardan tanlash yoki olib tashlash) */
  @Patch()
  @Roles(UserRole.ADMIN)
  async set(@Body() body: { kind?: unknown; unit?: unknown; codes?: unknown }, @CurrentUser('id') userId: string) {
    const kind = this.kindOf(body?.kind);
    const unit = this.unitOf(body?.unit);
    if (!Array.isArray(body?.codes)) throw new BadRequestException("Moddalar ro'yxati kerak");
    const codes = [...new Set(body.codes.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= 64))];
    if (codes.length > 5000) throw new BadRequestException("Ro'yxat juda katta");
    const known =
      kind === 'expense'
        ? new Set((await this.prisma.category.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((c) => c.code))
        : new Set((await this.prisma.incomeCategory.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((c) => c.code));
    const unknown = codes.filter((c) => !known.has(c));
    if (unknown.length) throw new BadRequestException(`Modda topilmadi: ${unknown.slice(0, 5).join(', ')}`);
    const before = unitList(await readUnitCategories(this.prisma), kind, unit);
    await this.write(kind, unit, codes);
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entity: 'unit_categories',
      entityId: `${kind}:${unit}`,
      summary: `${kind === 'expense' ? 'Xarajat moddalari' : 'Daromad turlari'} · ${entryUnitLabel(unit)}: ${before.length} → ${codes.length} ta`,
    });
    return this.get(kind);
  }

  /**
   * Bo'limga YANGI modda: xarajatda — guruh (parentCode bo'lmasa) yoki guruh ichidagi modda; daromadda — xizmat turi.
   * Yaratiladi va darhol shu bo'lim ro'yxatiga qo'shiladi (boshqa bo'limlarda ko'rinmaydi).
   */
  @Post('item')
  @Roles(UserRole.ADMIN)
  async addItem(@Body() body: { kind?: unknown; unit?: unknown; label?: unknown; parentCode?: unknown }, @CurrentUser('id') userId: string) {
    const kind = this.kindOf(body?.kind);
    const unit = this.unitOf(body?.unit);
    const label = typeof body?.label === 'string' ? body.label.trim().replace(/\s+/g, ' ') : '';
    if (label.length < 2 || label.length > 120) throw new BadRequestException("Nomi 2–120 belgi bo'lsin");
    const list = unitList(await readUnitCategories(this.prisma), kind, unit);
    let code: string;
    if (kind === 'expense') {
      const parentCode = typeof body?.parentCode === 'string' && body.parentCode ? body.parentCode : null;
      if (parentCode && !list.includes(parentCode)) throw new BadRequestException("Guruh shu bo'limniki emas");
      // Bir bo'limda bir xil nomli modda ikki marta bo'lmasin
      const siblings = await this.prisma.category.findMany({ where: { code: { in: list }, parentCode }, select: { label: true } });
      if (siblings.some((s) => s.label.trim().toLowerCase() === label.toLowerCase())) throw new BadRequestException(`«${label}» shu bo'limda allaqachon bor`);
      code = (await this.categories.create({ label, parentCode } as never)).code;
    } else {
      const same = await this.prisma.incomeCategory.findMany({ where: { code: { in: list } }, select: { label: true } });
      if (same.some((s) => s.label.trim().toLowerCase() === label.toLowerCase())) throw new BadRequestException(`«${label}» shu bo'limda allaqachon bor`);
      code = (await this.categories.createIncomeCategory({ label })).code;
    }
    await this.write(kind, unit, [...list, code]);
    await this.audit.log({
      userId,
      action: 'CREATE',
      entity: 'unit_categories',
      entityId: `${kind}:${unit}:${code}`,
      summary: `${entryUnitLabel(unit)} bo'limiga ${kind === 'expense' ? 'xarajat moddasi' : 'daromad turi'} qo'shildi: ${label}`,
    });
    return { data: { code, ...(await this.get(kind)).data } };
  }
}