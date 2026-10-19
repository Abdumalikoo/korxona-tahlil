import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import {
    cellText,
    cellValue,
    columnLetter,
    normalize,
    parseNumber,
} from '../salary-composition/salary-composition.excel';
import { matchPlace, placeKey, translit, type PlaceKey } from './leases.match';
import { LeaseMonthsService, type AccrueResult } from './leases.months';
import { LeasesService } from './leases.service';
import { currentPeriod, isPeriod, parseTiyin, periodsBetween } from './leases.shared';
import {
    CENTRAL_REGION,
    type LeaseFrequencyValue,
    type LeaseInput,
    type LeaseKindValue,
} from './leases.types';

// ═══════════════════════════════════════════════════════════
// Ijara — Excel orqali ommaviy kiritish
// ═══════════════════════════════════════════════════════════

const TEMPLATE_ROWS = 500;
const MAX_IMPORT_SIZE = 10 * 1024 * 1024;

/** Ustunlar: kalit, sarlavha, tanib olish uchun boshlanishlar (normalize qilingan) */
const COLUMNS = [
  { key: 'kind', header: 'Turi (Hudud / Aeroport)', width: 16, aliases: ['turi', 'tur'] },
  { key: 'region', header: 'Hudud *', width: 22, aliases: ['hudud', 'viloyat'] },
  { key: 'place', header: "Tuman yoki bo'lim", width: 24, aliases: ['tuman', 'bolim'] },
  { key: 'airport', header: 'Aeroport nomi', width: 26, aliases: ['aeroport'] },
  { key: 'title', header: 'Obyekt nomi *', width: 32, aliases: ['obyekt'] },
  { key: 'number', header: 'Shartnoma raqami *', width: 18, aliases: ['shartnomaraqami', 'raqam'] },
  { key: 'contractDate', header: 'Shartnoma sanasi', width: 16, aliases: ['shartnomasanasi', 'sana'] },
  { key: 'startPeriod', header: 'Boshlanish oyi * (2026-01)', width: 18, aliases: ['boshlanish'] },
  { key: 'endPeriod', header: 'Tugash oyi (2027-12)', width: 16, aliases: ['tugash'] },
  { key: 'monthly', header: "Oylik summa, so'm *", width: 18, aliases: ['oyliksumma', 'summa'] },
  { key: 'vat', header: "QQS bilan (Ha / Yo'q)", width: 14, aliases: ['qqs'] },
  { key: 'frequency', header: "To'lov davriyligi", width: 16, aliases: ['tolovdavriy', 'davriy'] },
  { key: 'paymentDay', header: "To'lov kuni", width: 11, aliases: ['tolovkuni'] },
  { key: 'area', header: 'Maydon, m²', width: 11, aliases: ['maydon'] },
  { key: 'address', header: 'Manzil', width: 30, aliases: ['manzil'] },
  { key: 'purpose', header: 'Maqsadi', width: 16, aliases: ['maqsad'] },
  { key: 'lessor', header: 'Ijaraga beruvchi *', width: 30, aliases: ['ijaragaberuvchi', 'beruvchi'] },
  { key: 'tin', header: 'STIR / JShShIR', width: 16, aliases: ['stir', 'inn', 'jshshir'] },
  { key: 'phone', header: 'Telefon', width: 16, aliases: ['telefon'] },
  { key: 'bank', header: 'Bank rekvizitlari', width: 30, aliases: ['bank'] },
  { key: 'note', header: 'Izoh', width: 30, aliases: ['izoh'] },
] as const;

type ColumnKey = (typeof COLUMNS)[number]['key'];

const MONTHS: Record<string, number> = {
  yanvar: 1, fevral: 2, mart: 3, aprel: 4, may: 5, iyun: 6,
  iyul: 7, avgust: 8, sentabr: 9, oktabr: 10, noyabr: 11, dekabr: 12,
};

// ═══════════ Turlar ═══════════

export type ImportRowStatus = 'ok' | 'error' | 'exists' | 'duplicate';

/** Tahlil qilingan va bazaga yozishga tayyor qator */
export interface ImportLease extends LeaseInput {
  endPeriod: string | null;
  monthlyTiyin: string;
  /**
   * Oylar bo'yicha jadval (shablondagi «2026-01», «2026-02»… ustunlari to'ldirilgan bo'lsa).
   * Har bir narx o'zgarishi — alohida shart (validFrom). Bo'lmasa — bitta oylik summa.
   */
  terms?: { validFrom: string; monthlyTiyin: string }[];
}

/** Oylik jadval ustuni: sarlavhasi «2026-01» (yoki «Yanvar 2026») */
interface ScheduleColumn {
  column: number;
  period: string;
}

export interface ImportRow {
  rowNumber: number;
  status: ImportRowStatus;
  errors: string[];
  warnings: string[];
  title: string;
  number: string;
  placeLabel: string;
  lessorName: string;
  startPeriod: string | null;
  endPeriod: string | null;
  monthlyTiyin: string | null;
  /** Oylik jadval: nechta oy to'ldirilgan va muddat ichidagi jami (yo'q bo'lsa — 0 / null) */
  scheduleMonths: number;
  scheduleTotalTiyin: string | null;
  /** status = ok bo'lsa to'ldiriladi */
  lease: ImportLease | null;
}

export interface ImportAnalysis {
  fileName: string;
  total: number;
  ok: number;
  errors: number;
  exists: number;
  duplicates: number;
  /** Yoziladigan qatorlarning oylik summasi */
  totalMonthlyTiyin: string;
  /** Faylda oylik jadval ustunlari bor — masalan ["2026-01", …, "2026-12"] */
  schedulePeriods: string[];
  /** Yoziladiganlarning jadval bo'yicha jami summasi */
  totalScheduleTiyin: string;
  /** Xarajatga yoziladigan oylar oralig'i (boshlanishdan joriy oygacha) */
  accruePeriods: string[];
  rows: ImportRow[];
}

export interface ImportResult {
  created: number;
  skipped: number;
  /** «O'tgan oylar xarajatini yozish» tanlangan bo'lsa */
  accrued: AccrueResult | null;
}

// ═══════════ Yordamchilar ═══════════

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Excel sana raqami (46054 → 2026-02-01) */
function fromSerial(value: unknown): Date | null {
  if (typeof value !== 'number' || value < 20000 || value > 80000) return null;
  return new Date(Math.round((value - 25569) * 86400 * 1000));
}

/** Katakdan oy: sana, "2026-01", "01.2026", "2026.01", "15.01.2026", "Yanvar 2026" */
function parsePeriodCell(value: ExcelJS.CellValue): string | null | 'invalid' {
  const raw = cellValue(value);
  if (raw === null || raw === undefined || raw === '') return null;

  const date = raw instanceof Date ? raw : fromSerial(raw);
  if (date) return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;

  const text = String(raw).trim().toLowerCase();
  let match = /^(\d{4})[-./](\d{1,2})$/.exec(text);
  if (match) return check(Number(match[1]), Number(match[2]));

  match = /^(\d{1,2})[-./](\d{4})$/.exec(text);
  if (match) return check(Number(match[2]), Number(match[1]));

  match = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(text);
  if (match) return check(Number(match[3]), Number(match[2]));

  match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (match) return check(Number(match[1]), Number(match[2]));

  const words = normalize(text).match(/^([a-z]+)(\d{4})$/);
  if (words) {
    const month = MONTHS[words[1] ?? ''];
    if (month) return check(Number(words[2]), month);
  }
  return 'invalid';

  function check(year: number, month: number): string | 'invalid' {
    if (year < 2000 || year > 2100 || month < 1 || month > 12) return 'invalid';
    return `${year}-${pad(month)}`;
  }
}

/** Katakdan sana "YYYY-MM-DD" */
function parseDateCell(value: ExcelJS.CellValue): string | null | 'invalid' {
  const raw = cellValue(value);
  if (raw === null || raw === undefined || raw === '') return null;
  const date = raw instanceof Date ? raw : fromSerial(raw);
  if (date) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  }
  const text = String(raw).trim();
  let match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  if (match) return `${match[3]}-${pad(Number(match[2]))}-${pad(Number(match[1]))}`;
  match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match) return text;
  return 'invalid';
}

function parseYesNo(text: string): boolean | null {
  const value = normalize(text);
  if (value === '') return null;
  if (['ha', 'yes', 'да', '1', 'true', 'bor', 'qqsbilan'].includes(value)) return true;
  if (['yoq', 'no', 'нет', '0', 'false', 'yuq', 'qqssiz'].includes(value)) return false;
  return null;
}

/** Sarlavha oy ustunimi: «2026-01», «2026.01», «01.2026», «Yanvar 2026», «2026 yanvar» */
function parseScheduleHeader(text: string): string | null {
  const value = text.trim().toLowerCase();
  let match = /^(\d{4})[-./](\d{1,2})$/.exec(value);
  if (match) return period(Number(match[1]), Number(match[2]));
  match = /^(\d{1,2})[-./](\d{4})$/.exec(value);
  if (match) return period(Number(match[2]), Number(match[1]));
  const words = normalize(value);
  match = /^([a-z]+)(\d{4})$/.exec(words) ?? /^(\d{4})([a-z]+)$/.exec(words);
  if (match) {
    const [a, b] = [match[1] ?? '', match[2] ?? ''];
    const name = /^\d/.test(a) ? b : a;
    const year = /^\d/.test(a) ? a : b;
    const month = MONTHS[name];
    if (month) return period(Number(year), month);
  }
  return null;

  function period(year: number, month: number): string | null {
    if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
    return `${year}-${pad(month)}`;
  }
}

function parseFrequency(text: string): LeaseFrequencyValue | null {
  const value = normalize(text);
  if (value === '') return 'MONTHLY';
  if (value.includes('chorak') || value.includes('kvartal') || value.includes('quarter')) return 'QUARTERLY';
  if (value.includes('yil') || value.includes('god') || value.includes('year')) return 'YEARLY';
  if (value.includes('oy') || value.includes('mes') || value.includes('month')) return 'MONTHLY';
  return null;
}

// ═══════════════════════════════════════════════════════════
// Servis
// ═══════════════════════════════════════════════════════════

@Injectable()
export class LeaseImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leases: LeasesService,
    private readonly months: LeaseMonthsService,
  ) {}

  private async references() {
    const [regions, districts, departments] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.district.findMany({
        where: { isActive: true },
        select: { id: true, name: true, regionCode: true, code: true },
        orderBy: [{ regionCode: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.department.findMany({
        where: { isActive: true },
        select: { id: true, name: true, index: true },
        orderBy: [{ order: 'asc' }, { index: 'asc' }],
      }),
    ]);
    return { regions, districts: districts.filter((d) => d.code !== 0), departments };
  }

  // ═══════════ Shablon ═══════════

  async buildTemplate(): Promise<{ buffer: Buffer; filename: string }> {
    const { regions, districts, departments } = await this.references();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Korxona tahlil';
    workbook.created = new Date();

    // ── Asosiy varaq ──
    const sheet = workbook.addWorksheet('Ijaralar', { views: [{ state: 'frozen', ySplit: 1 }] });
    // Oylik jadval ustunlari — joriy yil oylari (ixtiyoriy; to'ldirilsa har oy o'z summasi bilan yoziladi)
    const year = Number(currentPeriod().slice(0, 4));
    const schedule = Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
    sheet.columns = [
      ...COLUMNS.map((c) => ({ key: c.key, width: c.width })),
      ...schedule.map((p) => ({ key: p, width: 13 })),
    ];

    const header = sheet.getRow(1);
    COLUMNS.forEach((column, index) => {
      const cell = header.getCell(index + 1);
      cell.value = column.header;
      const required = column.header.includes('*');
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: required ? 'FF1E3A8A' : 'FF475569' },
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    schedule.forEach((p, index) => {
      const cell = header.getCell(COLUMNS.length + index + 1);
      cell.value = p;
      cell.numFmt = '@';
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      if (index === 0) {
        cell.note = "Oylik jadval (ixtiyoriy): har oy uchun summa. To'ldirilsa — xarajat shu summalar bilan yoziladi, «Oylik summa» shart emas.";
      }
    });
    header.height = 34;

    const col = (key: ColumnKey) => COLUMNS.findIndex((c) => c.key === key) + 1;
    const list = (key: ColumnKey, formula: string) => {
      const letter = columnLetter(col(key));
      for (let row = 2; row <= TEMPLATE_ROWS + 1; row++) {
        sheet.getCell(`${letter}${row}`).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [formula],
          showErrorMessage: false,
        };
      }
    };

    list('kind', '"Hudud,Aeroport"');
    list('region', `'Hududlar'!$B$2:$B$${regions.length + 1}`);
    list('vat', '"Ha,Yo\'q"');
    list('frequency', '"Har oy,Har chorak,Har yil"');

    for (let row = 2; row <= TEMPLATE_ROWS + 1; row++) {
      sheet.getCell(`${columnLetter(col('monthly'))}${row}`).numFmt = '#,##0.00';
      sheet.getCell(`${columnLetter(col('contractDate'))}${row}`).numFmt = 'dd.mm.yyyy';
      for (const key of ['startPeriod', 'endPeriod', 'number', 'tin'] as const) {
        sheet.getCell(`${columnLetter(col(key))}${row}`).numFmt = '@';
      }
      for (let i = 0; i < schedule.length; i++) {
        sheet.getCell(`${columnLetter(COLUMNS.length + i + 1)}${row}`).numFmt = '#,##0.00';
      }
    }

    // ── Ma'lumotnomalar ──
    const regionSheet = workbook.addWorksheet('Hududlar');
    regionSheet.columns = [
      { header: 'Kod', key: 'code', width: 8 },
      { header: 'Hudud', key: 'name', width: 28 },
    ];
    regions.forEach((r) => regionSheet.addRow({ code: r.code, name: r.name }));

    const districtSheet = workbook.addWorksheet('Tumanlar');
    districtSheet.columns = [
      { header: 'Hudud', key: 'region', width: 24 },
      { header: 'Tuman', key: 'name', width: 28 },
    ];
    const regionNames = new Map(regions.map((r) => [r.code, r.name]));
    districts.forEach((d) =>
      districtSheet.addRow({ region: regionNames.get(d.regionCode) ?? d.regionCode, name: d.name }),
    );

    const departmentSheet = workbook.addWorksheet("Bo'limlar (Markaz)");
    departmentSheet.columns = [
      { header: 'Indeks', key: 'index', width: 8 },
      { header: "Bo'lim", key: 'name', width: 40 },
    ];
    departments.forEach((d) => departmentSheet.addRow({ index: d.index, name: d.name }));

    for (const ref of [regionSheet, districtSheet, departmentSheet]) {
      ref.getRow(1).font = { bold: true };
      ref.views = [{ state: 'frozen', ySplit: 1 }];
    }

    // ── Yo'riqnoma ──
    const help = workbook.addWorksheet("Yo'riqnoma");
    help.getColumn(1).width = 110;
    const lines = [
      "IJARA SHARTNOMALARINI KIRITISH",
      '',
      "1. Har bir shartnoma — «Ijaralar» varag'ida bitta qator. * belgili ustunlar majburiy.",
      "2. Turi: «Hudud» — viloyat/tuman yoki Markaz ijarasi; «Aeroport» — aeroportdagi joy (Aeroport nomi majburiy).",
      "3. Hudud: ro'yxatdan tanlang yoki kodini yozing. Markaz uchun — «Markaz» (kod 0).",
      "4. Tuman yoki bo'lim: viloyat uchun tuman nomi («Tumanlar» varag'idan), Markaz uchun bo'lim nomi yoki indeksi. Bo'sh — viloyat boshqarmasi / Markaz umumiy.",
      "5. Boshlanish oyi — xarajat shu oydan yoziladi: 2026-01, 01.2026 yoki sana ko'rinishida.",
      "6. Tugash oyi — oxirgi hisoblanadigan oy. Muddatsiz bo'lsa bo'sh qoldiring.",
      "7. Oylik summa — so'mda, har oy uchun (choraklik/yillik to'lansa ham oyiga bo'lib yozing).",
      "8. QQS: bo'sh — «Ha». Davriylik: bo'sh — «Har oy».",
      "9. Bir hududda bir xil raqamli shartnoma bazada bo'lsa — qator o'tkazib yuboriladi (ikki marta kiritilmaydi).",
      "10. Hujjatlarni (shartnoma fayllarini) import qilingandan keyin shartnoma kartasidan yuklang.",
      `11. Oylik jadval (yashil ustunlar ${schedule[0]} … ${schedule[11]}) — ixtiyoriy. Har oyning summasi har xil bo'lsa (kunlar soniga qarab), shu yerga yozing:`,
      "    xarajat har oy o'z summasi bilan yoziladi. Bo'sh katak — oldingi oy summasi davom etadi; 0 — shu oy hisoblanmaydi.",
      "    Jadval to'ldirilsa «Oylik summa», «Boshlanish oyi» va «Tugash oyi» bo'sh qolishi mumkin — jadvaldagi birinchi va oxirgi oy olinadi.",
      "    Keyingi yillar uchun ustun qo'shish mumkin: sarlavhasi «2027-01» ko'rinishida bo'lsin.",
      "12. Import oynasida «O'tgan oylar xarajatini yozish» belgilansa — boshlanish oyidan joriy oygacha har oy xarajatga yoziladi:",
      "    yopilgan oyga yangi shartnomalar qo'shiladi (boshqalariga tegilmaydi), yopilmagan oy yopiladi.",
      '',
      "Misol:",
      "Hudud | Andijon | Asaka | | Asaka tuman bo'limi binosi | 45/2026 | 10.01.2026 | 2026-01 | | 12 500 000 | Ha | Har oy | 10 | 85 | Asaka sh., Navoiy ko'ch. 5 | Ofis | «Asaka Invest» MChJ | 301234567",
      "Aeroport | Toshkent shahri | | Toshkent xalqaro aeroporti | 1-terminal kassasi | A-17 | | 2026-03 | | 8 000 000 | Ha | Har chorak | | 12 | | Kassa | «Uzbekistan Airports» AJ |",
    ];
    lines.forEach((line, index) => {
      const cell = help.getCell(`A${index + 1}`);
      cell.value = line;
      cell.alignment = { wrapText: true };
      if (index === 0) cell.font = { bold: true, size: 13 };
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, filename: 'ijara-shablon.xlsx' };
  }


  // ═══════════ Tahlil ═══════════

  async analyze(file: Express.Multer.File | undefined): Promise<ImportAnalysis> {
    if (!file?.buffer?.length) throw new BadRequestException('Fayl tanlanmagan');
    if (file.size > MAX_IMPORT_SIZE) throw new BadRequestException('Fayl hajmi 10 MB dan oshmasin');

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('Faylni o\'qib bo\'lmadi — .xlsx formatida saqlang');
    }

    const sheet = workbook.getWorksheet('Ijaralar') ?? workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('Faylda varaq yo\'q');

    // ── Sarlavha qatorini topamiz ──
    let headerRow = 0;
    let columns = new Map<ColumnKey, number>();
    for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
      const found = new Map<ColumnKey, number>();
      sheet.getRow(r).eachCell((cell, colNumber) => {
        const text = normalize(cellText(cell.value));
        if (!text) return;
        for (const column of COLUMNS) {
          if (found.has(column.key)) continue;
          if (column.aliases.some((alias) => text.startsWith(alias))) {
            found.set(column.key, colNumber);
            break;
          }
        }
      });
      if (found.size > columns.size) {
        columns = found;
        headerRow = r;
      }
    }

    // Oylik jadval ustunlari (shu sarlavha qatorida)
    const schedule: ScheduleColumn[] = [];
    if (headerRow > 0) {
      const used = new Set(columns.values());
      const seen = new Set<string>();
      sheet.getRow(headerRow).eachCell((cell, colNumber) => {
        if (used.has(colNumber)) return;
        const value = cellValue(cell.value);
        const period =
          value instanceof Date
            ? `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}`
            : parseScheduleHeader(cellText(cell.value));
        if (period && !seen.has(period)) {
          seen.add(period);
          schedule.push({ column: colNumber, period });
        }
      });
      schedule.sort((a, b) => a.period.localeCompare(b.period));
    }

    const required: ColumnKey[] = ['region', 'title', 'number', 'lessor'];
    if (schedule.length === 0) required.push('startPeriod', 'monthly');
    const missing = required.filter((key) => !columns.has(key));
    if (headerRow === 0 || missing.length > 0) {
      const labels = missing.map((key) => COLUMNS.find((c) => c.key === key)?.header.replace(' *', ''));
      throw new BadRequestException(
        `Shablon ustunlari topilmadi${labels.length ? `: ${labels.join(', ')}` : ''}. Tizimdagi shablondan foydalaning`,
      );
    }

    // ── Ma'lumotnomalar ──
    const { regions, districts, departments } = await this.references();

    const regionItems = regions.map((region) => ({ key: placeKey(region.name), item: region }));
    const districtItems = new Map<number, { key: PlaceKey; item: { id: string; name: string } }[]>();
    for (const district of districts) {
      const list = districtItems.get(district.regionCode) ?? [];
      list.push({ key: placeKey(district.name), item: district });
      districtItems.set(district.regionCode, list);
    }
    const departmentByKey = new Map<string, { id: string; name: string }>();
    for (const department of departments) {
      departmentByKey.set(normalize(department.name), department);
      departmentByKey.set(String(department.index), department);
    }

    const findRegion = (value: string): { region?: { code: number; name: string }; warning?: string } => {
      const trimmed = value.trim();
      if (/^markaz/.test(normalize(translit(trimmed)))) {
        return { region: regions.find((x) => x.code === CENTRAL_REGION) };
      }
      // Kod: «26» yoki «Toshkent shahri (26)»
      const code = /^\s*(\d{1,3})\s*$/.exec(trimmed)?.[1] ?? /\((\d{1,3})\)\s*$/.exec(trimmed)?.[1];
      if (code !== undefined) {
        const byCode = regions.find((x) => x.code === Number(code));
        if (byCode) return { region: byCode };
      }
      const match = matchPlace(trimmed.replace(/\(\d{1,3}\)\s*$/, ''), regionItems);
      if (!match.item) return {};
      return {
        region: match.item,
        warning: match.approximate ? `Hudud «${trimmed}» → «${match.item.name}» deb olindi` : undefined,
      };
    };

    const existing = await this.prisma.lease.findMany({
      where: { deletedAt: null },
      select: { number: true, regionCode: true },
    });
    const existingKeys = new Set(existing.map((l) => `${l.regionCode}|${normalize(l.number)}`));
    const seenKeys = new Set<string>();

    const text = (row: ExcelJS.Row, key: ColumnKey): string => {
      const index = columns.get(key);
      return index ? cellText(row.getCell(index).value) : '';
    };
    const raw = (row: ExcelJS.Row, key: ColumnKey): ExcelJS.CellValue => {
      const index = columns.get(key);
      return index ? row.getCell(index).value : null;
    };

    const rows: ImportRow[] = [];
    const now = currentPeriod();

    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const values = COLUMNS.map((c) => text(row, c.key));
      const scheduleRaw = schedule.map((s) => ({ period: s.period, value: parseNumber(row.getCell(s.column).value) }));
      if (values.every((v) => v === '') && scheduleRaw.every((s) => s.value === null)) continue;
      // Jami / izoh qatorlari: hudud ham, raqam ham yo'q
      if (!text(row, 'region') && !text(row, 'number') && !text(row, 'title')) continue;

      const errors: string[] = [];
      const warnings: string[] = [];

      // Joy
      const airportName = text(row, 'airport');
      const kindText = normalize(text(row, 'kind'));
      const kind: LeaseKindValue =
        kindText.startsWith('aero') || (!kindText && airportName) ? 'AEROPORT' : 'ODDIY';

      const regionText = text(row, 'region');
      let region: { code: number; name: string } | undefined;
      if (!regionText) {
        errors.push('Hudud ko\'rsatilmagan');
      } else {
        const found = findRegion(regionText);
        region = found.region;
        if (found.warning) warnings.push(found.warning);
        if (!region) errors.push(`Hudud topilmadi: «${regionText}»`);
      }

      const placeText = text(row, 'place');
      let districtId: string | null = null;
      let departmentId: string | null = null;
      let placeName = '';

      if (kind === 'AEROPORT') {
        if (!airportName) errors.push('Aeroport nomi ko\'rsatilmagan');
        if (placeText) warnings.push('Aeroport uchun tuman/bo\'lim hisobga olinmaydi');
      } else if (region && placeText) {
        if (region.code === CENTRAL_REGION) {
          const department =
            departmentByKey.get(normalize(placeText)) ?? departmentByKey.get(placeText.replace(/\D/g, ''));
          if (department) {
            departmentId = department.id;
            placeName = department.name;
          } else {
            warnings.push(`Bo'lim topilmadi: «${placeText}» — Markaz umumiy xarajatiga yoziladi`);
          }
        } else {
          const match = matchPlace(placeText, districtItems.get(region.code) ?? []);
          if (match.item) {
            districtId = match.item.id;
            placeName = match.item.name;
            if (match.approximate) warnings.push(`Tuman «${placeText}» → «${match.item.name}» deb olindi`);
            else if (match.ambiguous) warnings.push(`«${placeText}» — bir nechta mos, «${match.item.name}» olindi`);
          } else {
            warnings.push(
              `${region.name} hududida tuman topilmadi: «${placeText}» — viloyat boshqarmasiga yoziladi (keyin kartadan tanlash mumkin)`,
            );
          }
        }
      }

      // Asosiy maydonlar
      const title = text(row, 'title');
      const number = text(row, 'number').replace(/\.+$/, '').trim();
      const lessorName = text(row, 'lessor');
      if (!title) errors.push('Obyekt nomi yo\'q');
      if (!number) errors.push('Shartnoma raqami yo\'q');
      if (!lessorName) errors.push('Ijaraga beruvchi yo\'q');

      // Oylik jadval
      const scheduled: { period: string; tiyin: bigint }[] = [];
      for (const item of scheduleRaw) {
        if (item.value === null) continue;
        if (Number.isNaN(item.value) || item.value < 0) {
          errors.push(`${item.period} oyi summasi noto'g'ri`);
          continue;
        }
        scheduled.push({ period: item.period, tiyin: BigInt(Math.round(item.value * 100)) });
      }
      const nonZero = scheduled.filter((s) => s.tiyin > 0n);

      const start = parsePeriodCell(raw(row, 'startPeriod'));
      let startPeriod = start && start !== 'invalid' ? start : null;
      if (start === 'invalid') errors.push(`Boshlanish oyi noto'g'ri: «${text(row, 'startPeriod')}»`);
      if (!startPeriod && start !== 'invalid') {
        if (nonZero.length > 0) startPeriod = nonZero[0]!.period;
        else errors.push('Boshlanish oyi yo\'q');
      }

      const end = parsePeriodCell(raw(row, 'endPeriod'));
      let endPeriod = end && end !== 'invalid' ? end : null;
      if (end === 'invalid') errors.push(`Tugash oyi noto'g'ri: «${text(row, 'endPeriod')}»`);
      if (!endPeriod && end !== 'invalid' && nonZero.length > 0) {
        endPeriod = nonZero[nonZero.length - 1]!.period;
        warnings.push(`Tugash oyi ko'rsatilmagan — jadvaldagi oxirgi oy (${endPeriod}) olindi`);
      }
      if (startPeriod && endPeriod && endPeriod < startPeriod) {
        errors.push('Tugash oyi boshlanishdan oldin');
      }

      const amount = parseNumber(raw(row, 'monthly'));
      let monthlyTiyin: string | null = null;
      if (amount !== null && (Number.isNaN(amount) || amount < 0)) {
        errors.push(`Oylik summa noto'g'ri: «${text(row, 'monthly')}»`);
      } else if (amount !== null && amount > 0) {
        monthlyTiyin = BigInt(Math.round(amount * 100)).toString();
      }
      if (!monthlyTiyin && nonZero.length > 0) monthlyTiyin = nonZero[0]!.tiyin.toString();
      if (!monthlyTiyin && amount === null && nonZero.length === 0) errors.push('Oylik summa yo\'q (jadval ham bo\'sh)');
      else if (!monthlyTiyin && errors.length === 0) errors.push('Oylik summa 0');

      // Jadval → narx shartlari (har o'zgarish — alohida shart)
      let terms: { validFrom: string; monthlyTiyin: string }[] | undefined;
      let scheduleTotal: bigint | null = null;
      if (scheduled.length > 0 && startPeriod && monthlyTiyin && errors.length === 0) {
        const byPeriod = new Map(scheduled.map((s) => [s.period, s.tiyin]));
        const outside = scheduled.filter((s) => s.period < startPeriod! || (endPeriod && s.period > endPeriod));
        if (outside.some((s) => s.tiyin > 0n)) {
          warnings.push(
            `Muddatdan tashqaridagi oylar hisobga olinmaydi: ${outside.filter((s) => s.tiyin > 0n).map((s) => s.period).join(', ')}`,
          );
        }
        const lastScheduled = scheduled[scheduled.length - 1]!.period;
        const until = endPeriod && endPeriod < lastScheduled ? endPeriod : lastScheduled;
        const firstAmount = amount !== null && amount > 0 ? BigInt(monthlyTiyin) : (byPeriod.get(startPeriod) ?? BigInt(monthlyTiyin));
        terms = [];
        let current: bigint | null = null;
        scheduleTotal = 0n;
        for (const p of startPeriod <= until ? periodsBetween(startPeriod, until) : []) {
          const value: bigint = byPeriod.get(p) ?? current ?? firstAmount;
          if (value !== current) {
            terms.push({ validFrom: p, monthlyTiyin: value.toString() });
            current = value;
          }
          scheduleTotal += value;
        }
        if (terms.length === 0) terms = undefined;
        if (terms && terms[0]!.validFrom !== startPeriod) {
          terms.unshift({ validFrom: startPeriod, monthlyTiyin: firstAmount.toString() });
        }
      }

      const contract = parseDateCell(raw(row, 'contractDate'));
      if (contract === 'invalid') warnings.push('Shartnoma sanasi tanilmadi — bo\'sh qoldirildi');

      const vatText = text(row, 'vat');
      const vat = parseYesNo(vatText);
      if (vatText && vat === null) warnings.push(`QQS tanilmadi («${vatText}») — «Ha» deb olindi`);

      const frequencyText = text(row, 'frequency');
      const frequency = parseFrequency(frequencyText);
      if (frequency === null) warnings.push(`Davriylik tanilmadi («${frequencyText}») — «Har oy» deb olindi`);

      const dayValue = parseNumber(raw(row, 'paymentDay'));
      let paymentDay: number | null = null;
      if (dayValue !== null) {
        if (Number.isInteger(dayValue) && dayValue >= 1 && dayValue <= 31) paymentDay = dayValue;
        else warnings.push('To\'lov kuni noto\'g\'ri — bo\'sh qoldirildi');
      }

      const areaValue = parseNumber(raw(row, 'area'));
      let areaM2: number | null = null;
      if (areaValue !== null) {
        if (!Number.isNaN(areaValue) && areaValue >= 0) areaM2 = areaValue;
        else warnings.push('Maydon noto\'g\'ri — bo\'sh qoldirildi');
      }

      let tin: string | null = text(row, 'tin').replace(/\s/g, '') || null;
      if (tin && !/^\d{9}$|^\d{14}$/.test(tin)) {
        warnings.push(`STIR noto'g'ri («${tin}») — bo'sh qoldirildi`);
        tin = null;
      }

      if (startPeriod && startPeriod > now) warnings.push('Boshlanish oyi kelajakda — xarajat o\'sha oydan yoziladi');

      // Takrorlar
      let status: ImportRowStatus = errors.length > 0 ? 'error' : 'ok';
      if (status === 'ok' && region) {
        const key = `${region.code}|${normalize(number)}`;
        if (existingKeys.has(key)) status = 'exists';
        else if (seenKeys.has(key)) status = 'duplicate';
        seenKeys.add(key);
      }

      const regionName = region?.name ?? regionText;
      const placeLabel =
        kind === 'AEROPORT'
          ? `${airportName || 'Aeroport'} (${regionName})`
          : placeName
            ? `${regionName} · ${placeName}`
            : regionName;

      rows.push({
        rowNumber: r,
        status,
        errors,
        warnings,
        title,
        number,
        placeLabel,
        lessorName,
        startPeriod,
        endPeriod,
        monthlyTiyin,
        scheduleMonths: nonZero.length,
        scheduleTotalTiyin: scheduleTotal === null ? null : scheduleTotal.toString(),
        lease:
          status === 'ok' && region && startPeriod && monthlyTiyin
            ? {
                kind,
                regionCode: region.code,
                districtId,
                departmentId,
                airportName: kind === 'AEROPORT' ? airportName : null,
                title,
                number,
                contractDate: contract && contract !== 'invalid' ? contract : null,
                startPeriod,
                endPeriod,
                monthlyTiyin,
                ...(terms ? { terms } : {}),
                vatIncluded: vat ?? true,
                paymentFrequency: frequency ?? 'MONTHLY',
                paymentDay,
                areaM2,
                address: text(row, 'address') || null,
                purpose: text(row, 'purpose') || null,
                lessorName,
                lessorTin: tin,
                lessorPhone: text(row, 'phone') || null,
                lessorBank: text(row, 'bank') || null,
                note: text(row, 'note') || null,
              }
            : null,
      });
    }

    if (rows.length === 0) throw new BadRequestException('Faylda ma\'lumot qatori yo\'q');

    const okRows = rows.filter((r) => r.status === 'ok');
    const starts = okRows.map((r) => r.startPeriod).filter((p): p is string => !!p && p <= now).sort();
    const ends = okRows.map((r) => r.endPeriod ?? now).sort();
    const lastEnd = ends.length ? (ends[ends.length - 1]! < now ? ends[ends.length - 1]! : now) : now;
    return {
      fileName: file.originalname,
      total: rows.length,
      ok: okRows.length,
      errors: rows.filter((r) => r.status === 'error').length,
      exists: rows.filter((r) => r.status === 'exists').length,
      duplicates: rows.filter((r) => r.status === 'duplicate').length,
      totalMonthlyTiyin: okRows.reduce((sum, r) => sum + BigInt(r.monthlyTiyin ?? '0'), 0n).toString(),
      schedulePeriods: schedule.map((s) => s.period),
      totalScheduleTiyin: okRows.reduce((sum, r) => sum + BigInt(r.scheduleTotalTiyin ?? '0'), 0n).toString(),
      accruePeriods: starts.length ? periodsBetween(starts[0]!, lastEnd) : [],
      rows,
    };
  }

  // ═══════════ Saqlash ═══════════

  /**
   * Tahlildagi "ok" qatorlar — hammasi yoki hech biri yoziladi.
   * accrue = true — boshlanish oyidan joriy oygacha xarajatga yoziladi (yopilgan oylarga qo'shiladi).
   */
  async commit(items: ImportLease[], userId: string, accrue = false): Promise<ImportResult> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('Saqlash uchun qator yo\'q');
    }
    if (items.length > 2000) throw new BadRequestException('Bir martada 2000 tadan ko\'p emas');

    const existing = await this.prisma.lease.findMany({
      where: { deletedAt: null },
      select: { number: true, regionCode: true },
    });
    const taken = new Set(existing.map((l) => `${l.regionCode}|${normalize(l.number)}`));

    const prepared: Prisma.LeaseUncheckedCreateInput[] = [];
    let skipped = 0;

    for (const [index, item] of items.entries()) {
      const label = `${index + 1}-qator (№ ${item?.number ?? '—'})`;
      try {
        const data = (await this.leases.validate(item ?? {}, null)) as Prisma.LeaseUncheckedCreateInput;
        const monthly = parseTiyin(item.monthlyTiyin, 'Oylik summa');
        if (monthly === 0n) throw new BadRequestException('Oylik summa 0');

        let endPeriod: string | null = null;
        if (item.endPeriod) {
          if (!isPeriod(item.endPeriod) || item.endPeriod < data.startPeriod) {
            throw new BadRequestException('Tugash oyi noto\'g\'ri');
          }
          endPeriod = item.endPeriod;
        }

        const terms = this.prepareTerms(item.terms, data.startPeriod, endPeriod, monthly, userId);

        const key = `${data.regionCode}|${normalize(String(data.number))}`;
        if (taken.has(key)) {
          skipped += 1;
          continue;
        }
        taken.add(key);

        prepared.push({
          ...data,
          endPeriod,
          createdById: userId,
          terms: { create: terms },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new BadRequestException(`${label}: ${message}`);
      }
    }

    const createdIds: string[] = [];
    await this.prisma.$transaction(
      async (tx) => {
        for (const data of prepared) {
          const lease = await tx.lease.create({ data, select: { id: true } });
          createdIds.push(lease.id);
        }
      },
      { timeout: 120_000, maxWait: 10_000 },
    );

    const accrued = accrue && createdIds.length > 0 ? await this.months.accrueLeases(createdIds, userId) : null;
    return { created: prepared.length, skipped, accrued };
  }

  /** Jadvaldagi shartlarni tekshiradi; jadval bo'lmasa — bitta boshlang'ich narx */
  private prepareTerms(
    input: ImportLease['terms'],
    startPeriod: string,
    endPeriod: string | null,
    monthly: bigint,
    userId: string,
  ): Prisma.LeaseTermCreateWithoutLeaseInput[] {
    if (!Array.isArray(input) || input.length === 0) {
      return [{ validFrom: startPeriod, monthlyTiyin: monthly, note: 'Boshlang\'ich narx (import)', createdById: userId }];
    }
    if (input.length > 600) throw new BadRequestException('Jadvalda oylar juda ko\'p');
    const seen = new Set<string>();
    const terms = input
      .map((term) => {
        if (!isPeriod(term?.validFrom)) throw new BadRequestException('Jadvaldagi oy noto\'g\'ri');
        if (term.validFrom < startPeriod) throw new BadRequestException(`${term.validFrom} — boshlanish oyidan oldin`);
        if (endPeriod && term.validFrom > endPeriod) throw new BadRequestException(`${term.validFrom} — tugash oyidan keyin`);
        if (seen.has(term.validFrom)) throw new BadRequestException(`${term.validFrom} — takrorlangan`);
        seen.add(term.validFrom);
        return { validFrom: term.validFrom, monthlyTiyin: parseTiyin(term.monthlyTiyin, `${term.validFrom} summasi`) };
      })
      .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    if (terms[0]!.validFrom !== startPeriod) terms.unshift({ validFrom: startPeriod, monthlyTiyin: monthly });
    return terms.map((term, index) => ({
      validFrom: term.validFrom,
      monthlyTiyin: term.monthlyTiyin,
      note: index === 0 ? 'Boshlang\'ich narx (import, oylik jadval)' : 'Oylik jadval (import)',
      createdById: userId,
    }));
  }
}