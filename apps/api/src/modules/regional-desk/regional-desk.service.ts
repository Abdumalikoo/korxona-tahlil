import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { PayrollService } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import { PeriodCloseService } from '../regional-data/period-close.service';
import { RegionalIncomeService, type ParsedRow } from '../incomes/regional-income.service';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { monthSpan } from '../../common/period';

// ═══════════════════════════════════════════════════════════
// Hududchi (hududlar bo'limi) ish joyi:
//   • Daromad — «Xizmatlar bo'yicha hisobot» (service_report) shablonini yuklash:
//       – bir oylik hisobot (01.09–30.09) → shu oy;
//       – yil boshidan hisobot (01.01–12.10) → oxirgi oy = fayl − oldingi oylarda saqlangan;
//     viloyatlar ustunlarda, xizmatlar qatorlarda (Soni / Summasi) — umumiy hududiy o'qish qoidasi bilan.
//   • Ish haqi — hudud xodimlari vedomosti (PINFL · Summa), umumiy tizimdagidek;
//     markaz xodimlari va umumiy vedomostdagilar kirmaydi (ikki marta sanalmaydi).
//   • Xarajatlar — hudud (va tuman) bo'yicha qo'lda kiritiladigan xarajatlar.
// Pul — tiyin (BigInt), javobda matn.
// ═══════════════════════════════════════════════════════════

const CENTRAL_REGION = 0;
const PAYROLL_CATEGORY = 'PAYROLL_BASE';
const TASHKENT_OFFSET_HOURS = 5;
const MAX_TIYIN = 9_000_000_000_000_000n;

export interface RegionalExpenseInput {
  date?: string;
  regionCode?: number;
  districtId?: string | null;
  categoryCode?: string;
  amountTiyin?: string | number;
  description?: string | null;
  counterparty?: string | null;
  documentNo?: string | null;
  paymentMethod?: string;
  /** RECURRING — har oy takrorlanadi, ONE_TIME — bir martalik */
  recurrence?: string | null;
}

export interface IncomeCommitInput {
  period?: string;
  fileName?: string;
  rows?: { regionCode: number; districtId?: string | null; categoryCode: string; categoryLabel?: string; regionName?: string; quantity: number | null; amountTiyin: string }[];
}

export interface PayrollCommitInput {
  period?: string;
  fileName?: string;
  rows?: { pinfl: string; amountTiyin: string }[];
  missing?: { rowIndex: number; pinfl: string }[];
}

function todayTashkent(): string {
  return new Date(Date.now() + TASHKENT_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);
}

function assertPeriod(period: unknown): string {
  const p = String(period ?? '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new BadRequestException("Oy ko'rinishi: YYYY-MM");
  return p;
}

function normalize(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/['`´ʻʼ‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
/** Shablon sarlavhasidagi xizmat ustunlari — «tanilmagan» deb ko'rsatilmaydi */
const HEADER_WORDS = new Set(['xizmat nomi', 'olchov birligi', 'shundan,', 'shundan', '№', 'jami respublika boyicha']);
const monthName = (p: string) => `${MONTHS[Number(p.slice(5)) - 1]} ${p.slice(0, 4)}`;

@Injectable()
export class RegionalDeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly regional: RegionalIncomeService,
    private readonly payroll: PayrollService,
    private readonly closes: PeriodCloseService,
  ) {}

  // ─────────── Ma'lumotnomalar ───────────

  async lookups() {
    const [regions, districts, categories] = await Promise.all([
      this.prisma.region.findMany({ where: { isActive: true, code: { not: CENTRAL_REGION } }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.district.findMany({ where: { isActive: true, regionCode: { not: CENTRAL_REGION } }, select: { id: true, regionCode: true, code: true, name: true }, orderBy: [{ regionCode: 'asc' }, { code: 'asc' }] }),
      this.prisma.category.findMany({
        where: { isActive: true, isLeaf: true, code: { not: PAYROLL_CATEGORY } },
        select: { code: true, label: true, parentCode: true },
        orderBy: [{ order: 'asc' }, { label: 'asc' }],
      }),
    ]);
    const parents = await this.prisma.category.findMany({
      where: { code: { in: [...new Set(categories.map((c) => c.parentCode).filter((x): x is string => Boolean(x)))] } },
      select: { code: true, label: true },
    });
    const parentLabel = new Map(parents.map((p) => [p.code, p.label]));
    return {
      regions,
      districts,
      categories: categories.map((c) => ({ code: c.code, label: c.label, group: c.parentCode ? (parentLabel.get(c.parentCode) ?? null) : null })),
    };
  }

  // ─────────── Daromad: xizmatlar hisoboti ───────────

  private cellText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      const v = value as unknown as Record<string, unknown>;
      if ('richText' in v && Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((t) => t.text).join('');
      if ('result' in v) return String(v.result ?? '');
      if ('text' in v) return String(v.text ?? '');
    }
    return String(value);
  }

  /** Hisobot oralig'i: sarlavhadagi «2026-01-01 dan 2026-10-12 gacha» yoki fayl nomidagi sanalar */
  private async detectRange(file: Express.Multer.File): Promise<{ from: string; to: string } | null> {
    const pick = (text: string): { from: string; to: string } | null => {
      const iso = /(\d{4})-(\d{2})-(\d{2})\D{1,20}?(\d{4})-(\d{2})-(\d{2})/.exec(text);
      if (iso) return { from: `${iso[1]}-${iso[2]}-${iso[3]}`, to: `${iso[4]}-${iso[5]}-${iso[6]}` };
      const dmy = /(\d{2})\.(\d{2})\.(\d{4})\D{1,20}?(\d{2})\.(\d{2})\.(\d{4})/.exec(text);
      if (dmy) return { from: `${dmy[3]}-${dmy[2]}-${dmy[1]}`, to: `${dmy[6]}-${dmy[5]}-${dmy[4]}` };
      return null;
    };
    try {
      const wb = new ExcelJS.Workbook();
      await assertSafeXlsx(file.buffer);
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
      const ws = wb.worksheets[0];
      if (ws) {
        for (let r = 1; r <= Math.min(6, ws.rowCount); r++) {
          const texts: string[] = [];
          ws.getRow(r).eachCell((c) => texts.push(this.cellText(c.value)));
          const hit = pick(texts.join(' '));
          if (hit) return hit;
        }
      }
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi (.xlsx bo'lishi kerak)");
    }
    return pick(file.originalname ?? '');
  }

  private validDate(s: string): boolean {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }

  /** Oldingi oylarda saqlangan hududiy daromad: hudud+xizmat bo'yicha yig'indi va qaysi oylarda bor */
  private async storedIncome(months: string[]) {
    const rows = months.length
      ? await this.prisma.income.findMany({
          where: { deletedAt: null, source: 'IMPORT', regionCode: { not: null }, period: { in: months } },
          select: { period: true, regionCode: true, categoryCode: true, amountTiyin: true, quantity: true },
        })
      : [];
    const sums = new Map<string, { amount: bigint; quantity: number | null }>();
    const present = new Set<string>();
    for (const r of rows) {
      present.add(r.period);
      const key = `${r.regionCode}:${r.categoryCode}`;
      const s = sums.get(key) ?? { amount: 0n, quantity: null };
      s.amount += r.amountTiyin;
      if (r.quantity !== null) s.quantity = (s.quantity ?? 0) + r.quantity;
      sums.set(key, s);
    }
    return { sums, present };
  }

  async analyzeIncome(file: Express.Multer.File | undefined, periodOverride?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Fayl yuklanmadi');
    const range = await this.detectRange(file);

    let period: string;
    let mode: 'MONTH' | 'CUMULATIVE' = 'MONTH';
    let previousMonths: string[] = [];
    if (range) {
      if (!this.validDate(range.from) || !this.validDate(range.to) || range.from > range.to) throw new BadRequestException("Hisobot sanalari noto'g'ri");
      if (range.from.slice(8) !== '01') {
        throw new BadRequestException(
          `Hisobot oy boshidan boshlanishi kerak (fayl: ${range.from.split('-').reverse().join('.')}). Manba tizimda sanani «01.MM.YYYY» dan tanlang`,
        );
      }
      period = range.to.slice(0, 7);
      const fromMonth = range.from.slice(0, 7);
      if (fromMonth < period) {
        mode = 'CUMULATIVE';
        previousMonths = monthSpan(fromMonth, period, 240).slice(0, -1);
      }
    } else {
      if (!periodOverride) throw new BadRequestException("Faylda hisobot sanalari topilmadi — oyni tanlang va qayta yuklang");
      period = assertPeriod(periodOverride);
    }

    const parsed = await this.regional.analyze(period, file);

    // Yangi (bazada yo'q) xizmat turlari — qo'shish taklif qilinadi
    const newServices = [...new Set(parsed.unknownServices.map((u) => u.label.trim()).filter((l) => l && !normalize(l).startsWith('jami') && l !== '(nomsiz)'))];

    // Fayldagi qiymatlar: hudud + xizmat bo'yicha (tumanlar — viloyatga yig'iladi, yil boshidan rejimida)
    const fileByKey = new Map<string, { regionCode: number; regionName: string; categoryCode: string; categoryLabel: string; amount: bigint; quantity: number | null }>();
    for (const r of parsed.rows) {
      const key = `${r.regionCode}:${r.categoryCode}`;
      const e = fileByKey.get(key) ?? { regionCode: r.regionCode, regionName: r.regionName, categoryCode: r.categoryCode, categoryLabel: r.categoryLabel, amount: 0n, quantity: null };
      e.amount += r.amountTiyin;
      if (r.quantity !== null) e.quantity = (e.quantity ?? 0) + r.quantity;
      fileByKey.set(key, e);
    }

    let rows: ParsedRow[];
    const negatives: { regionName: string; categoryLabel: string; fileTiyin: string; storedTiyin: string }[] = [];
    let missingMonths: string[] = [];
    const before = new Map<number, bigint>();

    if (mode === 'CUMULATIVE') {
      const { sums, present } = await this.storedIncome(previousMonths);
      missingMonths = previousMonths.filter((m) => !present.has(m));
      const labels = new Map<string, string>();
      const regionNames = new Map<number, string>();
      for (const e of fileByKey.values()) {
        labels.set(e.categoryCode, e.categoryLabel);
        regionNames.set(e.regionCode, e.regionName);
      }
      if (sums.size) {
        const [cats, regs] = await Promise.all([
          this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
          this.prisma.region.findMany({ select: { code: true, name: true } }),
        ]);
        for (const c of cats) if (!labels.has(c.code)) labels.set(c.code, c.label);
        for (const r of regs) if (!regionNames.has(r.code)) regionNames.set(r.code, r.name);
      }
      rows = [];
      const keys = new Set([...fileByKey.keys(), ...sums.keys()]);
      for (const key of keys) {
        const [rc, cc] = key.split(':') as [string, string];
        const regionCode = Number(rc);
        const f = fileByKey.get(key);
        const s = sums.get(key);
        const fileAmt = f?.amount ?? 0n;
        const storedAmt = s?.amount ?? 0n;
        before.set(regionCode, (before.get(regionCode) ?? 0n) + storedAmt);
        const delta = fileAmt - storedAmt;
        const regionName = f?.regionName ?? regionNames.get(regionCode) ?? String(regionCode);
        const categoryLabel = f?.categoryLabel ?? labels.get(cc) ?? cc;
        if (delta < 0n) {
          negatives.push({ regionName, categoryLabel, fileTiyin: fileAmt.toString(), storedTiyin: storedAmt.toString() });
          continue;
        }
        if (delta === 0n) continue;
        const q = f?.quantity !== null && f?.quantity !== undefined ? f.quantity - (s?.quantity ?? 0) : null;
        rows.push({ regionCode, regionName, districtId: null, districtName: null, categoryCode: cc, categoryLabel, quantity: q !== null && q >= 0 ? q : null, amountTiyin: delta });
      }
    } else {
      rows = parsed.rows;
    }

    // Hududlar bo'yicha: fayldagi, oldin saqlangan, shu oyga yoziladigan
    const regionsOut = new Map<number, { regionCode: number; name: string; fileTiyin: bigint; beforeTiyin: bigint; monthTiyin: bigint; quantity: number }>();
    for (const e of fileByKey.values()) {
      const g = regionsOut.get(e.regionCode) ?? { regionCode: e.regionCode, name: e.regionName, fileTiyin: 0n, beforeTiyin: before.get(e.regionCode) ?? 0n, monthTiyin: 0n, quantity: 0 };
      g.fileTiyin += e.amount;
      regionsOut.set(e.regionCode, g);
    }
    for (const r of rows) {
      const g = regionsOut.get(r.regionCode) ?? { regionCode: r.regionCode, name: r.regionName, fileTiyin: 0n, beforeTiyin: before.get(r.regionCode) ?? 0n, monthTiyin: 0n, quantity: 0 };
      g.monthTiyin += r.amountTiyin;
      g.quantity += r.quantity ?? 0;
      regionsOut.set(r.regionCode, g);
    }

    const order = parsed.regions.map((r) => r.regionCode);
    const regionList = [...regionsOut.values()].sort((a, b) => {
      const ia = order.indexOf(a.regionCode);
      const ib = order.indexOf(b.regionCode);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    const fileTotal = [...fileByKey.values()].reduce((s, e) => s + e.amount, 0n);
    const monthTotal = rows.reduce((s, r) => s + r.amountTiyin, 0n);
    const existing = await this.prisma.income.aggregate({
      where: { deletedAt: null, source: 'IMPORT', regionCode: { not: null }, period },
      _sum: { amountTiyin: true },
      _count: { _all: true },
    });

    return {
      fileName: file.originalname,
      range,
      period,
      periodLabel: monthName(period),
      mode,
      previousMonths,
      missingMonths,
      /** Oldingi oylar yetishmasa — saqlab bo'lmaydi */
      blocked: missingMonths.length > 0,
      fileTiyin: fileTotal.toString(),
      beforeTiyin: (fileTotal - monthTotal).toString(),
      monthTiyin: monthTotal.toString(),
      existingCount: existing._count._all,
      existingTiyin: (existing._sum.amountTiyin ?? 0n).toString(),
      regions: regionList.map((g) => ({ regionCode: g.regionCode, name: g.name, fileTiyin: g.fileTiyin.toString(), beforeTiyin: g.beforeTiyin.toString(), monthTiyin: g.monthTiyin.toString(), quantity: g.quantity })),
      negatives,
      newServices,
      unknownServices: parsed.unknownServices,
      unknownPlaces: parsed.unknownPlaces,
      unknownHeaders: parsed.unknownSheets.filter((h) => !HEADER_WORDS.has(normalize(h))),
      invalidCells: (parsed as { invalidCells?: unknown[] }).invalidCells ?? [],
      rows: rows.map((r) => ({ ...r, amountTiyin: r.amountTiyin.toString() })),
    };
  }

  /**
   * Bo'sh shablon — manba tizimdagi «Xizmatlar bo'yicha hisobot» bilan bir xil tuzilma:
   * B1 sarlavha, B2 «… (YYYY-MM-01 dan YYYY-MM-DD gacha)», 3–4-qator: Xizmat nomi · O'lchov birligi ·
   * Jami Respublika bo'yicha · viloyatlar; keyin har xizmat — «Soni» va «Summasi» qatorlari.
   */
  async incomeTemplate(periodRaw: string): Promise<{ buffer: Buffer; filename: string }> {
    const period = assertPeriod(periodRaw);
    const [y, m] = period.split('-').map(Number) as [number, number];
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const from = `${period}-01`;
    const to = `${period}-${String(last).padStart(2, '0')}`;
    const ORDER = [3, 6, 8, 10, 12, 14, 18, 22, 24, 26, 27, 30, 33, 35];
    const [regionsRaw, services] = await Promise.all([
      this.prisma.region.findMany({ where: { isActive: true, code: { not: CENTRAL_REGION } }, select: { code: true, name: true } }),
      this.prisma.incomeCategory.findMany({ where: { isActive: true, code: { startsWith: 'SRV_' } }, select: { code: true, label: true, order: true }, orderBy: { order: 'asc' } }),
    ]);
    const pos = (c: number) => (ORDER.indexOf(c) === -1 ? 1000 + c : ORDER.indexOf(c));
    const regions = regionsRaw.sort((a, b) => pos(a.code) - pos(b.code));
    const srv = services.filter((x) => /^SRV_\d{2}$/.test(x.code));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const ws = wb.addWorksheet('Sheet1', { views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] });
    const lastCol = 4 + regions.length;
    const font = { name: 'Times New Roman', size: 11 };
    const thin = { style: 'thin' as const, color: { argb: 'FF999999' } };
    const border = { top: thin, left: thin, bottom: thin, right: thin };
    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 60;
    ws.getColumn(3).width = 10;
    ws.getColumn(4).width = 18;
    for (let c = 5; c <= lastCol; c++) ws.getColumn(c).width = 15;

    ws.mergeCells(1, 2, 1, lastCol);
    ws.getCell(1, 2).value = '"Soliq-servis" AJ tomonidan ko\'rsatilgan xizmatlar soni to\'g\'risida ma\'lumot';
    ws.getCell(1, 2).font = { ...font, size: 13, bold: true };
    ws.getCell(1, 2).alignment = { horizontal: 'center' };
    ws.mergeCells(2, 2, 2, lastCol);
    ws.getCell(2, 2).value = `Xizmatlar bo'yicha hisobot (${from} dan ${to} gacha)`;
    ws.getCell(2, 2).font = { ...font, italic: true };
    ws.getCell(2, 2).alignment = { horizontal: 'center' };

    const head = (r: number, c: number, v: string) => {
      const cell = ws.getCell(r, c);
      cell.value = v;
      cell.font = { ...font, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } };
      cell.border = border;
    };
    ws.mergeCells(3, 1, 4, 1);
    head(3, 1, '№');
    ws.mergeCells(3, 2, 4, 2);
    head(3, 2, 'Xizmat nomi');
    ws.mergeCells(3, 3, 4, 3);
    head(3, 3, "O'lchov birligi");
    ws.mergeCells(3, 4, 4, 4);
    head(3, 4, "Jami Respublika bo'yicha");
    if (regions.length) {
      ws.mergeCells(3, 5, 3, lastCol);
      head(3, 5, 'shundan,');
    }
    regions.forEach((r, i) => head(4, 5 + i, r.name));
    ws.getRow(4).height = 45;

    const colL = (c: number) => ws.getColumn(c).letter;
    const writePair = (r: number, num: string | null, label: string, total: boolean) => {
      ws.mergeCells(r, 1, r + 1, 1);
      ws.mergeCells(r, 2, r + 1, 2);
      ws.getCell(r, 1).value = num;
      ws.getCell(r, 2).value = label;
      ws.getCell(r, 3).value = 'Soni';
      ws.getCell(r + 1, 3).value = 'Summasi';
      for (const rr of [r, r + 1]) {
        for (let c = 1; c <= lastCol; c++) {
          const cell = ws.getCell(rr, c);
          cell.font = { ...font, bold: total };
          cell.border = border;
          if (c === 2) cell.alignment = { wrapText: true, vertical: 'middle' };
          if (c === 1) cell.alignment = { horizontal: 'center', vertical: 'middle' };
          if (c >= 4) cell.numFmt = rr === r ? '#,##0' : '#,##0.00';
          if (total) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
        }
        // Respublika jami — viloyatlar yig'indisi
        if (regions.length) ws.getCell(rr, 4).value = { formula: `SUM(${colL(5)}${rr}:${colL(lastCol)}${rr})` };
        ws.getCell(rr, 4).font = { ...font, bold: true };
      }
    };

    const firstRow = 7;
    writePair(5, '№', "Jami ko'rsatilgan xizmatlar", true);
    srv.forEach((x, i) => {
      const num = /^SRV_(\d+)$/.exec(x.code)?.[1];
      writePair(firstRow + i * 2, num ? String(Number(num)) : null, x.label, false);
    });
    const lastRow = firstRow + srv.length * 2 - 1;
    // Jami qatori — har ustunda «Soni» va «Summasi» qatorlari yig'indisi
    if (srv.length) {
      for (let c = 4; c <= lastCol; c++) {
        const L = colL(c);
        ws.getCell(5, c).value = { formula: `SUMIF($C$${firstRow}:$C$${lastRow},"Soni",${L}${firstRow}:${L}${lastRow})` };
        ws.getCell(6, c).value = { formula: `SUMIF($C$${firstRow}:$C$${lastRow},"Summasi",${L}${firstRow}:${L}${lastRow})` };
      }
    }
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    const data = await wb.xlsx.writeBuffer();
    return { buffer: Buffer.from(data), filename: `service_report__${from}_${to}.xlsx` };
  }

  async commitIncome(input: IncomeCommitInput, userId: string) {
    const period = assertPeriod(input?.period);
    if (!Array.isArray(input.rows) || input.rows.length === 0) throw new BadRequestException("Saqlash uchun ma'lumot yo'q");
    if (input.rows.length > 20000) throw new BadRequestException("Qatorlar juda ko'p");
    const rows: ParsedRow[] = input.rows.map((r) => {
      let amount: bigint;
      try {
        amount = BigInt(String(r.amountTiyin));
      } catch {
        throw new BadRequestException(`Noto'g'ri summa: ${r.regionName ?? r.regionCode}`);
      }
      if (amount > MAX_TIYIN) throw new BadRequestException('Summa juda katta');
      const quantity = r.quantity === null || r.quantity === undefined ? null : Number(r.quantity);
      if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0)) throw new BadRequestException("Noto'g'ri son (miqdor)");
      return {
        regionCode: Number(r.regionCode),
        regionName: String(r.regionName ?? ''),
        districtId: r.districtId ?? null,
        districtName: null,
        categoryCode: String(r.categoryCode),
        categoryLabel: String(r.categoryLabel ?? ''),
        quantity,
        amountTiyin: amount,
      };
    });
    await this.closes.assertOpen(period);
    // Shu oyning hududiy daromadi to'liq almashtiriladi (qayta yuklash — yangilash)
    const result = await this.regional.commit(period, rows, userId, true);
    await this.audit.log({
      userId,
      action: 'IMPORT',
      entity: 'income',
      entityId: period,
      summary: `Hududlar daromadi ${monthName(period)}: ${result.created} ta yozuv, ${(Number(result.totalTiyin) / 100).toLocaleString('ru-RU')} so'm${input.fileName ? ` (${String(input.fileName).slice(0, 80)})` : ''}`,
    });
    return { ...result, totalTiyin: result.totalTiyin.toString(), period };
  }

  /** Hisobotda bor, bazada yo'q xizmat turlarini qo'shish (SRV_40, SRV_41 …) */
  async createServices(labelsRaw: unknown, userId: string) {
    const labels = (Array.isArray(labelsRaw) ? labelsRaw : []).map((l) => String(l ?? '').trim().replace(/\s+/g, ' ')).filter(Boolean);
    if (labels.length === 0) throw new BadRequestException("Xizmat nomi yo'q");
    if (labels.length > 50) throw new BadRequestException("Bir martada ko'pi bilan 50 ta");
    const existing = await this.prisma.incomeCategory.findMany({ select: { code: true, label: true, order: true } });
    const known = new Set(existing.map((c) => normalize(c.label)));
    let max = existing.reduce((m, c) => {
      const hit = /^SRV_(\d+)$/.exec(c.code);
      return hit ? Math.max(m, Number(hit[1])) : m;
    }, 0);
    let order = existing.reduce((m, c) => Math.max(m, c.order), 0);
    const created: { code: string; label: string }[] = [];
    for (const label of labels) {
      if (label.length > 300) throw new BadRequestException('Xizmat nomi juda uzun');
      if (known.has(normalize(label))) continue;
      max += 1;
      if (max > 99) throw new BadRequestException("Xizmat turlari soni chegaradan oshdi (SRV_99)");
      const code = `SRV_${String(max).padStart(2, '0')}`;
      await this.prisma.incomeCategory.create({ data: { code, label, order: (order += 1), isActive: true } });
      known.add(normalize(label));
      created.push({ code, label });
    }
    if (created.length) await this.audit.log({ userId, action: 'CREATE', entity: 'income_category', entityId: created.map((c) => c.code).join(','), summary: `Yangi xizmat turlari: ${created.map((c) => c.label).join('; ').slice(0, 300)}` });
    return { created };
  }

  // ─────────── Ish haqi (hudud xodimlari) ───────────

  private async locationsFor(period: string, pinfls?: string[]) {
    const rows = await this.prisma.employeeLocation.findMany({
      where: { period, ...(pinfls ? { employeePinfl: { in: pinfls } } : {}) },
      select: { employeePinfl: true, regionCode: true },
    });
    return new Map(rows.map((r) => [r.employeePinfl, r.regionCode]));
  }

  /** Bo'sh vedomost: faqat hudud xodimlari (PINFL · Summa) */
  async payrollTemplate(periodRaw: string): Promise<{ buffer: Buffer; filename: string }> {
    const period = assertPeriod(periodRaw);
    const [employees, regions, locations] = await Promise.all([
      this.prisma.employee.findMany({ where: { isActive: true }, select: { pinfl: true, fullName: true, regionCode: true, employmentType: true }, orderBy: [{ regionCode: 'asc' }, { fullName: 'asc' }] }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.locationsFor(period),
    ]);
    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const list = employees
      .map((e) => ({ ...e, region: locations.get(e.pinfl) ?? e.regionCode }))
      .filter((e) => e.region !== CENTRAL_REGION)
      .sort((a, b) => a.region - b.region || a.fullName.localeCompare(b.fullName));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const sheet = wb.addWorksheet('Ish haqi', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'PINFL', key: 'pinfl', width: 20 },
      { header: 'Summa', key: 'amount', width: 18 },
    ];
    const head = sheet.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF047857' } };
    sheet.getColumn('A').numFmt = '@';
    sheet.getColumn('B').numFmt = '#,##0';
    for (const e of list) sheet.addRow({ pinfl: e.pinfl, amount: null });

    const ref = wb.addWorksheet('Hudud xodimlari');
    ref.columns = [
      { header: 'PINFL', key: 'pinfl', width: 20 },
      { header: 'F.I.Sh.', key: 'fullName', width: 45 },
      { header: 'Hudud', key: 'region', width: 26 },
      { header: 'Ish turi', key: 'type', width: 14 },
    ];
    ref.getRow(1).font = { bold: true };
    ref.getColumn('A').numFmt = '@';
    for (const e of list) ref.addRow({ pinfl: e.pinfl, fullName: e.fullName, region: regionName.get(e.region) ?? e.region, type: e.employmentType === 'SHTAT' ? 'Shtat' : 'Shartnoma' });
    ref.autoFilter = { from: 'A1', to: `D${Math.max(1, ref.rowCount)}` };

    const data = await wb.xlsx.writeBuffer();
    return { buffer: Buffer.from(data), filename: `Hudud-ish-haqi-${period}.xlsx` };
  }

  async analyzePayroll(periodRaw: string, file: Express.Multer.File | undefined) {
    const period = assertPeriod(periodRaw);
    if (!file?.buffer?.length) throw new BadRequestException('Fayl yuklanmadi');
    const base = await this.payroll.analyze(period, file);
    const pinfls = base.rows.map((r) => r.pinfl);
    const [employees, locations, regions, overlap, previous] = await Promise.all([
      this.prisma.employee.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, fullName: true, regionCode: true } }),
      this.locationsFor(period, pinfls),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.payrollEntry.findMany({
        where: { period, employeePinfl: { in: pinfls }, batch: { status: 'COMMITTED', scope: { not: 'REGIONS' } } },
        select: { employeePinfl: true },
      }),
      this.prisma.payrollBatch.findMany({ where: { period, status: 'COMMITTED', scope: 'REGIONS' }, select: { id: true, totalTiyin: true, matchedRows: true, committedAt: true } }),
    ]);
    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const emp = new Map(employees.map((e) => [e.pinfl, e]));
    const inGeneral = new Set(overlap.map((o) => o.employeePinfl));

    const kept: { pinfl: string; amountTiyin: bigint; region: number }[] = [];
    const central: { pinfl: string; fullName: string; amountTiyin: string }[] = [];
    const general: { pinfl: string; fullName: string; amountTiyin: string }[] = [];
    for (const r of base.rows) {
      const e = emp.get(r.pinfl);
      const region = locations.get(r.pinfl) ?? e?.regionCode ?? CENTRAL_REGION;
      if (region === CENTRAL_REGION) central.push({ pinfl: r.pinfl, fullName: e?.fullName ?? '', amountTiyin: r.amountTiyin.toString() });
      else if (inGeneral.has(r.pinfl)) general.push({ pinfl: r.pinfl, fullName: e?.fullName ?? '', amountTiyin: r.amountTiyin.toString() });
      else kept.push({ pinfl: r.pinfl, amountTiyin: r.amountTiyin, region });
    }
    const byRegion = new Map<number, { regionCode: number; name: string; count: number; zero: number; totalTiyin: bigint }>();
    for (const k of kept) {
      const g = byRegion.get(k.region) ?? { regionCode: k.region, name: regionName.get(k.region) ?? String(k.region), count: 0, zero: 0, totalTiyin: 0n };
      g.count += 1;
      if (k.amountTiyin === 0n) g.zero += 1;
      g.totalTiyin += k.amountTiyin;
      byRegion.set(k.region, g);
    }
    const total = kept.reduce((s, k) => s + k.amountTiyin, 0n);
    return {
      period,
      periodLabel: monthName(period),
      fileName: base.fileName,
      totalRows: base.totalRows,
      matchedRows: kept.length,
      missingRows: base.missingRows,
      missing: base.missing,
      invalidRows: base.invalidRows,
      duplicates: base.duplicates,
      zeroRows: kept.filter((k) => k.amountTiyin === 0n).length,
      central,
      general,
      totalTiyin: total.toString(),
      previous: previous.map((p) => ({ id: p.id, totalTiyin: p.totalTiyin.toString(), employees: p.matchedRows, committedAt: p.committedAt?.toISOString() ?? null })),
      regions: [...byRegion.values()].sort((a, b) => a.regionCode - b.regionCode).map((g) => ({ ...g, totalTiyin: g.totalTiyin.toString() })),
      rows: kept.map((k) => ({ pinfl: k.pinfl, amountTiyin: k.amountTiyin.toString() })),
    };
  }

  async commitPayroll(input: PayrollCommitInput, userId: string) {
    const period = assertPeriod(input?.period);
    if (!Array.isArray(input.rows) || input.rows.length === 0) throw new BadRequestException("Saqlash uchun ma'lumot yo'q");
    const rows = input.rows.map((r) => {
      try {
        return { pinfl: String(r.pinfl), amountTiyin: BigInt(String(r.amountTiyin)) };
      } catch {
        throw new BadRequestException(`Noto'g'ri summa: ${r.pinfl}`);
      }
    });
    await this.closes.assertOpen(period);
    // Faqat hudud xodimlari (markaz — umumiy vedomostda)
    const pinfls = rows.map((r) => r.pinfl);
    const [employees, locations] = await Promise.all([
      this.prisma.employee.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, regionCode: true } }),
      this.locationsFor(period, pinfls),
    ]);
    const emp = new Map(employees.map((e) => [e.pinfl, e]));
    const central = rows.filter((r) => (locations.get(r.pinfl) ?? emp.get(r.pinfl)?.regionCode ?? CENTRAL_REGION) === CENTRAL_REGION);
    if (central.length) throw new BadRequestException(`${central.length} ta markaz xodimi bor — hudud vedomostiga kirmaydi. Faylni qayta tekshiring`);
    const result = await this.payroll.commit({
      period,
      rows,
      userId,
      replacePrevious: true,
      fileName: String(input.fileName ?? 'hudud-ish-haqi.xlsx').slice(0, 200),
      missing: Array.isArray(input.missing) ? input.missing.slice(0, 5000) : [],
      scope: 'REGIONS',
    });
    await this.audit.log({
      userId,
      action: 'IMPORT',
      entity: 'payroll_batch',
      entityId: result.batchId,
      summary: `Hududlar ish haqi ${monthName(period)}: ${result.employees} xodim, ${(Number(result.totalTiyin) / 100).toLocaleString('ru-RU')} so'm${result.replacedPrevious ? ' (oldingisi almashtirildi)' : ''}`,
    });
    return { ...result, totalTiyin: result.totalTiyin.toString(), period };
  }

  async payrollBatches(periodRaw?: string) {
    const where: Prisma.PayrollBatchWhereInput = { scope: 'REGIONS' };
    if (periodRaw) where.period = assertPeriod(periodRaw);
    const batches = await this.prisma.payrollBatch.findMany({ where, orderBy: [{ period: 'desc' }, { createdAt: 'desc' }], take: 60 });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(batches.map((b) => b.uploadedById))] } }, select: { id: true, fullName: true } });
    const names = new Map(users.map((u) => [u.id, u.fullName]));
    return batches.map((b) => ({
      id: b.id,
      period: b.period,
      status: b.status,
      fileName: b.fileName,
      employees: b.matchedRows,
      missing: b.missingRows,
      totalTiyin: b.totalTiyin.toString(),
      committedAt: b.committedAt?.toISOString() ?? null,
      by: names.get(b.uploadedById) ?? null,
    }));
  }

  async cancelPayroll(id: string, userId: string) {
    const batch = await this.prisma.payrollBatch.findUnique({ where: { id } });
    if (!batch || batch.scope !== 'REGIONS') throw new NotFoundException('Hudud vedomosti topilmadi');
    await this.closes.assertOpen(batch.period);
    const result = await this.payroll.cancel(id);
    await this.audit.log({ userId, action: 'DELETE', entity: 'payroll_batch', entityId: id, summary: `Hududlar ish haqi ${monthName(batch.period)} bekor qilindi` });
    return result;
  }

  // ─────────── Xarajatlar (hudud bo'yicha, qo'lda) ───────────

  private toStoredDate(iso: string): Date {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m || !this.validDate(iso)) throw new BadRequestException("Sana noto'g'ri");
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), -TASHKENT_OFFSET_HOURS, 0, 0, 0));
  }

  private async cleanExpense(input: RegionalExpenseInput) {
    const date = String(input.date ?? '');
    const stored = this.toStoredDate(date);
    if (date > todayTashkent()) throw new BadRequestException("Kelajakdagi sana bo'lishi mumkin emas");
    const regionCode = Number(input.regionCode);
    if (!Number.isInteger(regionCode) || regionCode === CENTRAL_REGION) throw new BadRequestException('Hududni tanlang');
    const region = await this.prisma.region.findUnique({ where: { code: regionCode }, select: { code: true, isActive: true } });
    if (!region || !region.isActive) throw new BadRequestException('Hudud topilmadi');
    let districtId: string | null = input.districtId ? String(input.districtId) : null;
    if (districtId) {
      const d = await this.prisma.district.findUnique({ where: { id: districtId }, select: { regionCode: true } });
      if (!d || d.regionCode !== regionCode) throw new BadRequestException('Tuman shu hududga tegishli emas');
    } else districtId = null;
    const categoryCode = String(input.categoryCode ?? '');
    if (categoryCode === PAYROLL_CATEGORY) throw new BadRequestException("Ish haqi — «Ish haqi» bo'limidan vedomost bilan yuklanadi");
    const category = await this.prisma.category.findUnique({ where: { code: categoryCode }, select: { isLeaf: true, isActive: true, label: true } });
    if (!category) throw new BadRequestException('Xarajat moddasini tanlang');
    if (!category.isActive) throw new BadRequestException(`"${category.label}" moddasi arxivlangan`);
    if (!category.isLeaf) throw new BadRequestException(`"${category.label}" — bosh modda, ichidagi aniq moddani tanlang`);
    let amount: bigint;
    try {
      amount = BigInt(String(input.amountTiyin ?? ''));
    } catch {
      throw new BadRequestException("Summa noto'g'ri");
    }
    if (amount <= 0n) throw new BadRequestException("Summa noldan katta bo'lsin");
    if (amount > MAX_TIYIN) throw new BadRequestException('Summa juda katta');
    const text = (v: unknown, max: number) => {
      const s = v === null || v === undefined ? '' : String(v).trim();
      if (s.length > max) throw new BadRequestException(`Matn juda uzun (ko'pi bilan ${max} belgi)`);
      return s || null;
    };
    const method = ['BANK', 'CASH', 'CARD', 'OTHER'].includes(String(input.paymentMethod)) ? String(input.paymentMethod) : 'BANK';
    const recurrence = input.recurrence === 'RECURRING' || input.recurrence === 'ONE_TIME' ? input.recurrence : null;
    if (!recurrence) throw new BadRequestException("Xarajat turini belgilang: har oy takrorlanadimi yoki bir martalikmi");
    return {
      date: stored,
      period: date.slice(0, 7),
      regionCode,
      districtId,
      categoryCode,
      amountTiyin: amount,
      description: text(input.description, 500),
      counterparty: text(input.counterparty, 200),
      documentNo: text(input.documentNo, 50),
      paymentMethod: method,
      recurrence,
    };
  }

  private expenseView(e: {
    id: string;
    date: Date;
    period: string;
    amountTiyin: bigint;
    categoryCode: string;
    regionCode: number | null;
    districtId: string | null;
    description: string | null;
    counterparty: string | null;
    documentNo: string | null;
    paymentMethod: string;
    recurrence?: string | null;
    createdAt: Date;
    category?: { label: string } | null;
    region?: { name: string } | null;
    district?: { name: string } | null;
    createdBy?: { fullName: string } | null;
  }) {
    return {
      id: e.id,
      date: new Date(e.date.getTime() + TASHKENT_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10),
      period: e.period,
      amountTiyin: e.amountTiyin.toString(),
      categoryCode: e.categoryCode,
      categoryLabel: e.category?.label ?? e.categoryCode,
      regionCode: e.regionCode,
      regionName: e.region?.name ?? null,
      districtId: e.districtId,
      districtName: e.district?.name ?? null,
      description: e.description,
      counterparty: e.counterparty,
      documentNo: e.documentNo,
      paymentMethod: e.paymentMethod,
      recurrence: e.recurrence ?? null,
      createdAt: e.createdAt.toISOString(),
      by: e.createdBy?.fullName ?? null,
    };
  }

  private readonly expenseInclude = {
    category: { select: { label: true } },
    region: { select: { name: true } },
    district: { select: { name: true } },
    createdBy: { select: { fullName: true } },
  } as const;

  async expenses(periodRaw: string, regionCode?: number) {
    const period = assertPeriod(periodRaw);
    const rows = await this.prisma.expense.findMany({
      where: {
        deletedAt: null,
        period,
        source: 'MANUAL',
        regionCode: regionCode !== undefined && Number.isInteger(regionCode) ? regionCode : { not: null, notIn: [CENTRAL_REGION] },
      },
      include: this.expenseInclude,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 1000,
    });
    return rows.filter((r) => r.regionCode !== CENTRAL_REGION).map((r) => this.expenseView(r));
  }

  async createExpense(input: RegionalExpenseInput, userId: string) {
    const d = await this.cleanExpense(input);
    await this.closes.assertOpen(d.period);
    const row = await this.prisma.expense.create({
      data: { ...d, paymentMethod: d.paymentMethod as never, paymentStatus: 'PAID', source: 'MANUAL', section: 'DOIMIY', createdById: userId },
      include: this.expenseInclude,
    });
    await this.audit.log({ userId, action: 'CREATE', entity: 'expense', entityId: row.id, summary: `Hudud xarajati: ${row.region?.name ?? d.regionCode} — ${row.category?.label ?? d.categoryCode}, ${(Number(d.amountTiyin) / 100).toLocaleString('ru-RU')} so'm` });
    return this.expenseView(row);
  }

  private async ownExpense(id: string) {
    const row = await this.prisma.expense.findUnique({ where: { id } });
    if (!row || row.deletedAt || row.source !== 'MANUAL' || row.regionCode === null || row.regionCode === CENTRAL_REGION) {
      throw new NotFoundException('Hudud xarajati topilmadi');
    }
    return row;
  }

  async updateExpense(id: string, input: RegionalExpenseInput, userId: string) {
    const old = await this.ownExpense(id);
    await this.closes.assertOpen(old.period);
    const d = await this.cleanExpense(input);
    await this.closes.assertOpen(d.period);
    const row = await this.prisma.expense.update({ where: { id }, data: { ...d, paymentMethod: d.paymentMethod as never }, include: this.expenseInclude });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'expense', entityId: id, summary: `Hudud xarajati o'zgartirildi: ${row.region?.name ?? ''} — ${row.category?.label ?? ''}` });
    return this.expenseView(row);
  }

  async deleteExpense(id: string, userId: string) {
    const row = await this.ownExpense(id);
    await this.closes.assertOpen(row.period);
    await this.prisma.expense.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'expense', entityId: id, summary: `Hudud xarajati o'chirildi (${(Number(row.amountTiyin) / 100).toLocaleString('ru-RU')} so'm)` });
    return { ok: true as const };
  }

  // ─────────── Ish stoli / dashbord ───────────

  async overview(periodRaw?: string) {
    const period = periodRaw ? assertPeriod(periodRaw) : todayTashkent().slice(0, 7);
    const year = period.slice(0, 4);
    const months = monthSpan(`${year}-01`, period, 240);
    const regionWhere = { not: null, notIn: [CENTRAL_REGION] };

    const [regions, incomes, expenses, batches] = await Promise.all([
      this.prisma.region.findMany({ where: { isActive: true, code: { not: CENTRAL_REGION } }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.income.findMany({
        where: { deletedAt: null, source: 'IMPORT', regionCode: regionWhere, period: { in: months } },
        select: { period: true, regionCode: true, amountTiyin: true, quantity: true, createdAt: true },
      }),
      this.prisma.expense.findMany({
        where: { deletedAt: null, regionCode: regionWhere, period: { in: months } },
        select: { period: true, regionCode: true, amountTiyin: true, source: true },
      }),
      this.prisma.payrollBatch.findMany({ where: { scope: 'REGIONS', status: 'COMMITTED', period: { in: months } }, select: { period: true, totalTiyin: true, matchedRows: true, committedAt: true } }),
    ]);

    const monthRows = months.map((m) => {
      const inc = incomes.filter((i) => i.period === m);
      const exp = expenses.filter((e) => e.period === m);
      const pay = batches.filter((b) => b.period === m);
      const last = inc.reduce<Date | null>((d, i) => (!d || i.createdAt > d ? i.createdAt : d), null);
      return {
        period: m,
        label: monthName(m),
        incomeTiyin: inc.reduce((s, i) => s + i.amountTiyin, 0n).toString(),
        incomeRows: inc.length,
        incomeAt: last ? last.toISOString() : null,
        payrollTiyin: exp.filter((e) => e.source === 'PAYROLL').reduce((s, e) => s + e.amountTiyin, 0n).toString(),
        payrollUploaded: pay.length > 0,
        payrollEmployees: pay.reduce((s, b) => s + b.matchedRows, 0),
        otherTiyin: exp.filter((e) => e.source !== 'PAYROLL').reduce((s, e) => s + e.amountTiyin, 0n).toString(),
        otherCount: exp.filter((e) => e.source === 'MANUAL').length,
      };
    });

    const regionRows = regions.map((r) => {
      const inc = incomes.filter((i) => i.period === period && i.regionCode === r.code);
      const exp = expenses.filter((e) => e.period === period && e.regionCode === r.code);
      const ytdInc = incomes.filter((i) => i.regionCode === r.code).reduce((s, i) => s + i.amountTiyin, 0n);
      const ytdExp = expenses.filter((e) => e.regionCode === r.code).reduce((s, e) => s + e.amountTiyin, 0n);
      const income = inc.reduce((s, i) => s + i.amountTiyin, 0n);
      const payroll = exp.filter((e) => e.source === 'PAYROLL').reduce((s, e) => s + e.amountTiyin, 0n);
      const other = exp.filter((e) => e.source !== 'PAYROLL').reduce((s, e) => s + e.amountTiyin, 0n);
      return {
        regionCode: r.code,
        name: r.name,
        incomeTiyin: income.toString(),
        quantity: inc.reduce((s, i) => s + (i.quantity ?? 0), 0),
        payrollTiyin: payroll.toString(),
        otherTiyin: other.toString(),
        netTiyin: (income - payroll - other).toString(),
        ytdIncomeTiyin: ytdInc.toString(),
        ytdExpenseTiyin: ytdExp.toString(),
      };
    });

    const cur = monthRows[monthRows.length - 1]!;
    return { period, periodLabel: monthName(period), months: monthRows, regions: regionRows, current: cur };
  }
}