import { BadRequestException, Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ENTRY_UNITS, ENTRY_UNIT_CODES, entryUnitLabel } from '../../common/segments/segments';
import { readUnitCategories, UNIT_CATEGORIES_KEY, type EntryKind } from '../../common/segments/unit-categories';

/**
 * Kiritish bo'limlari moddalari: har bo'lim (Markaz, Hududlar, Tax free, Marksheyder, Fermer xo'jaligi,
 * Buxgalteriya xizmatlari) uchun daromad turlari va xarajat moddalari ro'yxati.
 * Ro'yxat saqlanmagan bo'lim — umumiy (hamma moddalar).
 */
@Controller('unit-categories')
export class UnitCategoriesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private kindOf(raw: unknown): EntryKind {
    if (raw === 'expense' || raw === 'income') return raw;
    throw new BadRequestException("Turi noto'g'ri: expense yoki income");
  }

  /** ?kind=expense|income — har bo'lim: ro'yxat (null — umumiy, hammasi) */
  @Get()
  async get(@Query('kind') kindRaw?: string) {
    const kind = this.kindOf(kindRaw);
    const lists = await readUnitCategories(this.prisma);
    return { data: { kind, units: ENTRY_UNITS.map((u) => ({ code: u.code, label: u.label, codes: lists[kind][u.code] ?? null })) } };
  }

  /** Bitta bo'lim ro'yxatini saqlash; codes: null — umumiyga qaytarish (hamma moddalar) */
  @Patch()
  @Roles(UserRole.ADMIN)
  async set(@Body() body: { kind?: unknown; unit?: unknown; codes?: unknown }, @CurrentUser('id') userId: string) {
    const kind = this.kindOf(body?.kind);
    const unit = typeof body?.unit === 'string' && ENTRY_UNIT_CODES.includes(body.unit) ? body.unit : null;
    if (!unit) throw new BadRequestException("Bo'lim noto'g'ri");
    let codes: string[] | null = null;
    if (body?.codes !== null && body?.codes !== undefined) {
      if (!Array.isArray(body.codes)) throw new BadRequestException("Moddalar ro'yxati noto'g'ri");
      codes = [...new Set(body.codes.filter((c): c is string => typeof c === 'string' && c.length > 0 && c.length <= 64))];
      if (codes.length > 5000) throw new BadRequestException("Ro'yxat juda katta");
      const known =
        kind === 'expense'
          ? new Set((await this.prisma.category.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((c) => c.code))
          : new Set((await this.prisma.incomeCategory.findMany({ where: { code: { in: codes } }, select: { code: true } })).map((c) => c.code));
      const unknown = codes.filter((c) => !known.has(c));
      if (unknown.length) throw new BadRequestException(`Modda topilmadi: ${unknown.slice(0, 5).join(', ')}`);
    }
    const row = await this.prisma.setting.findUnique({ where: { key: UNIT_CATEGORIES_KEY } });
    const prev = (row?.value ?? {}) as Record<string, Record<string, string[]>>;
    const side = { ...(prev[kind] ?? {}) };
    if (codes === null) delete side[unit];
    else side[unit] = codes;
    const value = { ...prev, [kind]: side };
    await this.prisma.setting.upsert({ where: { key: UNIT_CATEGORIES_KEY }, create: { key: UNIT_CATEGORIES_KEY, value }, update: { value } });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entity: 'unit_categories',
      entityId: `${kind}:${unit}`,
      summary: `${kind === 'expense' ? 'Xarajat' : 'Daromad'} moddalari · ${entryUnitLabel(unit)}: ${codes === null ? 'umumiy (hamma moddalar)' : `${codes.length} ta modda`}`,
    });
    return this.get(kind);
  }
}