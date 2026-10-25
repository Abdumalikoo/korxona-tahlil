import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    Res,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Personal, Roles } from '../../common/decorators';
import { isSegment } from '../../common/segments/segments';
import { CompositionPlaceService } from './salary-composition.place';
import { CompositionReconcileService } from './salary-composition.reconcile';
import { SalaryCompositionService } from './salary-composition.service';
import { SalaryStructureService } from './salary-composition.structure';
import type { CommitRow, ComponentInput } from './salary-composition.types';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface CommitBody {
  fileName?: string;
  rows: {
    pinfl: string;
    fullName?: string | null;
    workedDays?: number | null;
    rate?: number | null;
    /** Komponent kodi → summa (tiyin, satr ko'rinishida) */
    items: Record<string, string>;
    /** Tarkibdagi bo'lim nomi (bo'lsa) */
    dept?: string | null;
  }[];
  /** Tarkibdagi bo'limlar: { map: { nom: departmentId | 'SKIP' }, apply: PINFL[] } — shu oy joyini tarkibdagidek qilish */
  places?: unknown;
  /** Tasdiqlangan ustun moslashlari — eslab qolinadi: { key, leaf, label, code | 'SKIP' } */
  columns?: unknown;
}

@Controller('salary-composition')
export class SalaryCompositionController {
  constructor(
    private readonly composition: SalaryCompositionService,
    private readonly structure: SalaryStructureService,
    private readonly reconcile: CompositionReconcileService,
    private readonly places: CompositionPlaceService,
  ) {}

  private sendFile(response: Response, buffer: Buffer, filename: string): void {
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"`,
    );
    response.send(buffer);
  }

  /** ?unit= — yo'nalish (TAX_FREE …): alohida tarkib. Bo'lmasa — umumiy (Markaz) tarkib */
  private unitOf(raw?: string): string | undefined {
    if (raw === undefined || raw === '') return undefined;
    if (isSegment(raw)) return raw;
    throw new BadRequestException("Bo'lim noto'g'ri");
  }

  private optionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  // ═══════════ Komponentlar ═══════════

  /** Komponentlar ro'yxati (faol va nofaol) */
  @Get('components')
  async components() {
    const data = await this.composition.listComponents();
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Post('components')
  async createComponent(@Body() body: ComponentInput) {
    const data = await this.composition.createComponent(body ?? {});
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Patch('components/:code')
  async updateComponent(@Param('code') code: string, @Body() body: ComponentInput) {
    const data = await this.composition.updateComponent(code, body ?? {});
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Delete('components/:code')
  async removeComponent(@Param('code') code: string) {
    const data = await this.composition.removeComponent(code);
    return { data };
  }

  // ═══════════ Shablon va yuklash ═══════════

  /** Shablon — faol komponentlar, formulalar va Xodimlar varag'i bilan */
  @Get('template')
  async template(@Query('period') period: string, @Res() response: Response, @Query('unit') unit?: string) {
    const { buffer, filename } = await this.composition.buildTemplate(period, this.unitOf(unit));
    this.sendFile(response, buffer, filename);
  }

  /** Faylni tahlil qilish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@Query('period') period: string, @UploadedFile() file: Express.Multer.File, @Query('sheet') sheet?: string, @Query('unit') unit?: string, @Body('mapping') mappingRaw?: string) {
    // mapping — shu yuklashda tanlangan moslash: JSON { "AB": "OKLAD", "AC": "SKIP" }
    let mapping: Record<string, string> | undefined;
    if (typeof mappingRaw === 'string' && mappingRaw.length) {
      if (mappingRaw.length > 20_000) throw new BadRequestException('Moslash juda katta');
      try {
        const parsed = JSON.parse(mappingRaw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) mapping = parsed as Record<string, string>;
      } catch {
        throw new BadRequestException("Moslash noto'g'ri (JSON)");
      }
    }
    const u = this.unitOf(unit);
    const data = await this.composition.analyze(period, file, sheet || undefined, u, mapping);
    // Tarkibdagi bo'limlar: taklif qilingan moslik va «miya» bilan farqlar (faqat umumiy tarkib)
    const places = u ? null : await this.places.analyze(period, data.rows.map((r) => ({ pinfl: r.pinfl, fullName: r.fullName, deptName: r.deptName ?? null })), data.deptColumn ?? null);
    return { data: { ...data, places } };
  }

  /** O'rgatilgan ustun moslashlari (sarlavha → komponent) */
  @Get('columns')
  async learned() {
    return { data: await this.composition.listLearned() };
  }

  /** O'rgatilgan moslashni o'chirish */
  @Roles(UserRole.ADMIN)
  @Post('columns/forget')
  @HttpCode(HttpStatus.OK)
  async forget(@Body('key') key: string) {
    if (typeof key !== 'string' || !key) throw new BadRequestException('Kalit kerak');
    return { data: await this.composition.forgetLearned(key) };
  }

  /** Saqlash — shu oyning oldingi tarkibini almashtiradi */
  @Roles(UserRole.ADMIN)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  async commit(
    @Query('period') period: string,
    @Body() body: CommitBody,
    @CurrentUser('id') userId: string,
    @Query('unit') unitRaw?: string,
  ) {
    const unit = this.unitOf(unitRaw);
    if (!Array.isArray(body?.rows) || body.rows.length === 0) {
      throw new BadRequestException('Saqlash uchun ma\'lumot yo\'q');
    }

    const rows: CommitRow[] = body.rows.map((row) => {
      try {
        const items = new Map<string, bigint>();
        for (const [code, value] of Object.entries(row.items ?? {})) {
          items.set(String(code), BigInt(value));
        }
        return {
          pinfl: String(row.pinfl ?? ''),
          fullName: row.fullName ? String(row.fullName) : null,
          workedDays: this.optionalNumber(row.workedDays),
          rate: this.optionalNumber(row.rate),
          items,
        };
      } catch {
        throw new BadRequestException(`Noto'g'ri qator: ${row?.pinfl}`);
      }
    });

    const data = await this.composition.commit({
      period,
      rows,
      fileName: body.fileName ?? 'tarkib.xlsx',
      userId,
      unit,
    });
    // Saqlandi — tasdiqlangan ustun moslashlari eslab qolinadi (keyingi oy shu sarlavhalar o'zi taniladi)
    const remembered = await this.composition.rememberColumns(body.columns).catch(() => 0);
    // Tarkibdagi bo'limlar: moslik eslab qolinadi, belgilangan xodimlarning shu oy joyi tarkibdagidek
    const places = unit ? null : await this.places.apply(period, data.batchId, body.rows.map((r) => ({ pinfl: String(r.pinfl ?? ''), fullName: r.fullName ? String(r.fullName) : null, dept: typeof r.dept === 'string' ? r.dept : null })), body.places, userId);
    return { data: { ...data, rememberedColumns: remembered, places } };
  }

  /** Yuklashni bekor qilish */
  @Roles(UserRole.ADMIN)
  @Post('batches/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id') id: string, @CurrentUser('id') userId: string, @Query('unit') unit?: string, @Query('period') period?: string) {
    const u = this.unitOf(unit);
    const data = await this.composition.cancel(id, u, period);
    // Umumiy tarkib bekor — shu oy tarkib bo'yicha o'zgartirilgan joylar ham bekor
    const places = u ? null : await this.places.onCancel(data.period, userId).catch(() => null);
    return { data: { ...data, places } };
  }

  /** Yuklashlar tarixi */
  @Get('batches')
  async batches(@Query('period') period?: string, @Query('unit') unit?: string) {
    const data = await this.composition.batches(period || undefined, this.unitOf(unit));
    return { data };
  }

  // ═══════════ Ko'rish ═══════════

  /** Oy tarkibi: xodimlar, komponentlar, guruhlar, tekshiruv */
  @Personal()
  @Get('view')
  async view(@Query('period') period: string, @Query('unit') unit?: string) {
    const data = await this.composition.view(period, this.unitOf(unit));
    return { data };
  }

  /** Oy holati — soliq hisobotiga mosligi */
  @Get('check')
  async check(@Query('period') period: string, @Query('unit') unit?: string) {
    const data = await this.composition.check(period, this.unitOf(unit));
    return { data };
  }

  /** Ish haqi tuzilmasi — oylar, guruhlar, bo'limlar (from/to: "YYYY-MM") */
  @Get('structure')
  async salaryStructure(@Query('from') from: string, @Query('to') to: string) {
    const data = await this.structure.structure(from, to);
    return { data };
  }

  /** Bitta xodimning oylar bo'yicha tarkibi */
  @Personal()
  @Get('employee/:pinfl')
  async employee(
    @Param('pinfl') pinfl: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('unit') unit?: string,
  ) {
    const data = await this.composition.employeeHistory(pinfl, from || undefined, to || undefined, this.unitOf(unit));
    return { data };
  }

  /** Saqlangan tarkib Excel'da (Tarkib, Guruhlar, Farqlar) */
  @Personal()
  @Get('export')
  async exportExcel(@Query('period') period: string, @Res() response: Response, @Query('unit') unit?: string) {
    const { buffer, filename } = await this.composition.exportExcel(period, this.unitOf(unit));
    this.sendFile(response, buffer, filename);
  }

  // ═══════════ Uchlik nazorat: tarkib · soliq hisoboti · 23106 ═══════════

  /** Har xodim: tarkib, soliq hisoboti, 23106 to'lovlari, farq va qayerga o'tkazish tavsiyasi */
  @Personal()
  @Get('reconcile')
  async reconcileView(@Query('period') period: string, @Query('unit') unit?: string) {
    return { data: await this.reconcile.view(period, this.unitOf(unit)) };
  }

  /** Farqni tarkib komponentiga o'tkazish: { items: [{ pinfl, componentCode, amountTiyin, note?, source? }] } */
  @Roles(UserRole.ADMIN)
  @Post('reconcile/allocate')
  @HttpCode(HttpStatus.OK)
  async reconcileAllocate(@Query('period') period: string, @Body() body: { items?: unknown }, @CurrentUser('id') userId: string, @Query('unit') unit?: string) {
    return { data: await this.reconcile.allocate(period, this.unitOf(unit), body, userId) };
  }

  /** O'tkazishni bekor qilish */
  @Roles(UserRole.ADMIN)
  @Post('reconcile/adjust/:id/undo')
  @HttpCode(HttpStatus.OK)
  async reconcileUndo(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.reconcile.undo(id, userId) };
  }

  // ═══════════ Tarkibdagi bo'limlar (shu oy joyi) ═══════════

  /** Shu oy: tarkibdagi bo'limlar va tarkib bo'yicha o'zgartirilgan joylar */
  @Personal()
  @Get('places')
  async placesView(@Query('period') period: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) throw new BadRequestException("Davr noto'g'ri formatda (YYYY-MM)");
    return { data: await this.places.view(period) };
  }

  /** O'zgarishni bekor qilish: { pinfls } — avvalgi joyiga */
  @Roles(UserRole.ADMIN)
  @Post('places/revert')
  @HttpCode(HttpStatus.OK)
  async placesRevert(@Query('period') period: string, @Body('pinfls') pinfls: unknown, @CurrentUser('id') userId: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) throw new BadRequestException("Davr noto'g'ri formatda (YYYY-MM)");
    if (!Array.isArray(pinfls) || !pinfls.length) throw new BadRequestException('Xodimlarni tanlang');
    return { data: await this.places.revert(period, pinfls.map(String), userId) };
  }
}
