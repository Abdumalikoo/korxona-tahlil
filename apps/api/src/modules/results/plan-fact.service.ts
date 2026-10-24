import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { PayrollService } from '../payroll/payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';

// ═══════════════════════════════════════════════════════════
// Xodimlar reja / tushum fayli (bir nechta oy, bitta faylda).
//
// Tuzilma (birinchi mos varaq):
//   № | PINFL | F.I.Sh | Viloyat | tuman | Yanvar (reja, tushum) | Fevral (reja, tushum) | …
//   Oy nomi — birlashtirilgan katakda, ostida «reja» va «tushum» ustunlari.
//   Oy nomi yo'q fayl (faqat «reja» va «tushum» ustunlari) — bitta oy: qaysi oy ekani yuklashda tanlanadi.
//   Yil va oy(lar) yuklashda tanlanadi; oylar tanlansa — fayldan faqat shu oylar olinadi.
//
// Xodim reestrdan topiladi:
//   1) PINFL bo'yicha (ustun bo'lsa va to'ldirilgan bo'lsa) — eng aniq; viloyat bo'sh bo'lsa reestrdagisi olinadi;
//   2) PINFL yo'q bo'lsa — F.I.Sh bo'yicha: to'liq ism (apostrof, «o'g'li / qizi / uli» farqlari hisobga
//      olinmaydi), keyin familiya + ism — avval shu viloyat xodimlari ichida, keyin hammasi ichida.
//   Topilmagan yoki bir nechta mos kelgan xodimlar saqlanmaydi — ro'yxati ko'rsatiladi.
//
// Saqlash — Natijalar (EmployeeResult) bilan bir xil: oy bo'yicha, ustama qoidasi bilan (<80% — 0,
// 80–95% — tushumning 25%, >95% — 45%). Shu oyda fayldagi viloyatlar natijasi almashtiriladi, boshqa
// viloyatlarniki saqlanib qoladi. Xodimning shu oydagi hududi/tumani fayldagidek yoziladi.
// Tushumi bo'sh oy (hali hisobot yo'q) — saqlanmaydi.
//
// MUHIM: bu fayl DAROMAD YARATMAYDI (ish haqi vedomosti kabi ishlaydi). Daromad Daromadlar bo'limida
// (xizmatlar hisoboti) allaqachon bor — fayl uni xodimlarga bo'lib beradi. Har oy × viloyat (va tuman):
// xodimlar tushumi yig'indisi ↔ yuklangan daromad solishtiriladi, mos kelmasa — ogohlantirish.
// ═══════════════════════════════════════════════════════════

const LOW_PERCENT = 80;
const HIGH_PERCENT = 95;
const MID_RATE = 25n;
const HIGH_RATE = 45n;

const MONTH_WORDS: [number, string[]][] = [
  [1, ['yanvar', 'январ', 'январь']],
  [2, ['fevral', 'феврал', 'февраль']],
  [3, ['mart', 'март']],
  [4, ['aprel', 'апрел', 'апрель']],
  [5, ['may', 'май']],
  [6, ['iyun', 'июн', 'июнь']],
  [7, ['iyul', 'июл', 'июль']],
  [8, ['avgust', 'август']],
  [9, ['sentabr', 'sentyabr', 'сентябр', 'сентябрь']],
  [10, ['oktabr', 'oktyabr', 'октябр', 'октябрь']],
  [11, ['noyabr', 'ноябр', 'ноябрь']],
  [12, ['dekabr', 'декабр', 'декабрь']],
];
export const MONTH_NAMES = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

type Region = { code: number; name: string };
type District = { id: string; regionCode: number; name: string };
type Emp = { pinfl: string; fullName: string; regionCode: number; districtId: string | null; employmentType: string; isActive: boolean };

interface SheetLayout {
  headerRow: number;
  dataFrom: number;
  name: number | null;
  pinfl: number | null;
  region: number | null;
  district: number | null;
  /** «Shtat» ustuni: Shtat - 1 / Shartnoma asosida */
  type: number | null;
  /** Oy nomisiz fayl — bitta «reja / tushum» juftligi (oy yuklashda tanlanadi) */
  single: boolean;
  months: { month: number; plan: number | null; fact: number; bonus: number | null }[];
}

export interface PlanFactRow {
  rowIndex: number;
  pinfl: string;
  fullName: string;
  fileName: string;
  regionCode: number;
  regionName: string;
  districtId: string | null;
  districtName: string | null;
  employmentType: string;
  /** Ism to'liq mos kelmadi (familiya + ism bo'yicha topildi) */
  partial: boolean;
  /** Reestrdagi hudud/tumandan farq qiladi (shu oy uchun fayldagisi yoziladi) */
  moved: boolean;
  /** Fayldagi «Shtat» (bo'sh — reestrdagi) */
  fileType: string | null;
  /** Oy → reja/tushum (tiyin, satr); bonusFromFile — ustama fayldan (aks holda qoida bo'yicha hisoblangan) */
  months: Record<string, { planTiyin: string; factTiyin: string; bonusTiyin: string; percent: number | null; bonusFromFile?: boolean }>;
}

export interface PlanFactMonth {
  period: string;
  label: string;
  employees: number;
  planTiyin: string;
  factTiyin: string;
  bonusTiyin: string;
  percent: number | null;
  /** Shu oy uchun bazada avval saqlangan natijalar (shu viloyatlarda) */
  previousRows: number;
  /** Ustama — hudud xodimlarining shu oy ish haqi (Hududlar ish haqi vedomostiga yoziladi) */
  payroll: {
    /** Ustama ustuni bor (fayldan) */
    fromFile: boolean;
    employees: number;
    totalTiyin: string;
    /** Shu oy umumiy vedomostda (administrator) bor — ish haqi qayta yozilmaydi */
    inGeneral: number;
    /** Shu oy avvalgi hudud vedomostidagi shu xodimlar ish haqi (almashtiriladi) */
    previousTiyin: string;
    /** Umumiy vedomostda borlar (PINFL) */
    generalPinfls: string[];
  };
}

/** Fayldagi tushum ↔ yuklangan daromad (oy × viloyat yoki tuman) */
export interface ReconcileLine {
  period: string;
  label: string;
  regionCode: number;
  regionName: string;
  districtId: string | null;
  districtName: string | null;
  /** Fayldagi xodimlar tushumi yig'indisi */
  factTiyin: string;
  /** Daromadlar bo'limida shu oy, shu hududga yozilgan daromad */
  incomeTiyin: string;
  diffTiyin: string;
  /** (fayl − daromad) ÷ daromad × 100; daromad yo'q — null */
  diffPercent: number | null;
  status: 'ok' | 'diff' | 'no_income';
}

export interface PlanFactAnalysis {
  year: number;
  fileName: string;
  sheetName: string;
  totalRows: number;
  matchedRows: number;
  months: PlanFactMonth[];
  /** Ustuni bor, lekin tushumi hammasi bo'sh — saqlanmaydi */
  emptyMonths: string[];
  regions: { regionCode: number; name: string; employees: number; planTiyin: string; factTiyin: string; percent: number | null }[];
  missing: {
    rowIndex: number;
    fileName: string;
    region: string;
    pinfl: string | null;
    reason: 'pinfl' | 'name';
    /** To'g'ridan-to'g'ri «Xodimlarga qo'shish» uchun (fayldagi ma'lumot) */
    regionCode: number | null;
    districtId: string | null;
    districtName: string | null;
    employmentType: string | null;
  }[];
  /** Shtat turi reestrdagidan farq qiladi (shu oy uchun fayldagisi yoziladi) */
  typeChanges: { rowIndex: number; fileName: string; from: string; to: string }[];
  /** Saqlanmaydigan qatorlar soni (topilmagan, aniqlanmagan, takror, xato) */
  skippedRows: number;
  ambiguous: { rowIndex: number; fileName: string; region: string; candidates: string[] }[];
  unknownRegions: { rowIndex: number; fileName: string; value: string }[];
  unknownDistricts: { rowIndex: number; fileName: string; region: string; value: string }[];
  duplicates: { rowIndex: number; fileName: string; firstRow: number }[];
  invalidCells: { rowIndex: number; fileName: string; month: string; value: string }[];
  partialNames: { rowIndex: number; fileName: string; registryName: string }[];
  /** PINFL bo'yicha topildi, lekin fayldagi ism reestrdagidan farq qiladi */
  nameMismatches: { rowIndex: number; pinfl: string; fileName: string; registryName: string }[];
  /** PINFL noto'g'ri yozilgan (14 raqam emas) — F.I.Sh bo'yicha qidirildi */
  invalidPinfl: { rowIndex: number; fileName: string; value: string }[];
  /** Viloyat bo'sh yoki tanilmadi — reestrdagi viloyati olindi (PINFL bo'yicha topilganlar) */
  registryRegion: { rowIndex: number; fileName: string; value: string; region: string }[];
  /** Tanlangan, lekin faylda yo'q oylar */
  notInFile: string[];
  /** Faylda topilgan hamma oylar (1–12; oy nomisiz faylda — bo'sh) */
  fileMonths: number[];
  /** Fayl tuzilmasi: oy nomlari bilan yoki bitta oy */
  single: boolean;
  /** Faylda PINFL ustuni bor */
  hasPinfl: boolean;
  /** Daromad bilan solishtirish: viloyatlar (har oy) */
  reconcile: ReconcileLine[];
  /** Tumanlar kesimida farqlar (faqat mos kelmaganlari) */
  reconcileDistricts: ReconcileLine[];
  /** Mos kelmagan (yoki daromadi yo'q) viloyat-oylar soni */
  reconcileIssues: number;
  rows: PlanFactRow[];
}

const APOS = /['`´ʹʻʼʽ‘’‛]/g;
const PATRONYMIC_TAIL = new Set(['ogli', 'ugli', 'oglu', 'qizi', 'kizi', 'uli', 'ули', 'угли', 'қизи', 'кизи', 'ўғли']);

/** Kichik harf, apostroflarsiz, bitta bo'shliq */
export function norm(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(APOS, '')
    .replace(/[.,;:()«»"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ism kalitlari: to'liq (otasining ismi qo'shimchasiz) va familiya+ism */
export function nameKeys(full: string): { full: string; short: string; swapped: string } {
  const tokens = norm(full).replace(/-/g, ' ').split(' ').filter(Boolean);
  while (tokens.length > 2 && PATRONYMIC_TAIL.has(tokens[tokens.length - 1]!)) tokens.pop();
  return { full: tokens.join(' '), short: tokens.slice(0, 2).join(' '), swapped: [tokens[1], tokens[0]].filter(Boolean).join(' ') };
}

/** Hudud kaliti: «viloyati», «respublikasi» siz; «sh.», «shahar» → «shahri» */
function regionKey(value: string): string {
  return norm(value)
    .replace(/\b(sh|shahar)\b/g, 'shahri')
    .replace(/\s(viloyati|viloyat|vil|respublikasi|resp|r)$/, '')
    .trim();
}

/** Tuman kaliti: asos va turi (shahar / tuman) */
function districtKey(value: string): { base: string; city: boolean } {
  let v = norm(value);
  // «Bo'lim boshlig'i - Nukus shahar» → «Nukus shahar»
  const dash = v.lastIndexOf(' - ');
  if (dash >= 0) v = v.slice(dash + 3).trim();
  const city = /\b(shahri|shahar|sh)\b/.test(v);
  const base = v.replace(/\b(shahri|shahar|sh|tumani|tuman|t)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return { base, city };
}

function monthOf(text: string): number | null {
  const t = norm(text);
  if (!t || /jami|итого|yillik|chorak|-/.test(t)) return null;
  for (const [m, words] of MONTH_WORDS) if (words.some((w) => t === w || t.startsWith(`${w} `) || t.endsWith(` ${w}`))) return m;
  return null;
}

function percentOf(plan: bigint, fact: bigint): number | null {
  if (plan <= 0n) return null;
  return Number((fact * 10000n) / plan) / 100;
}

export function bonusFor(plan: bigint, fact: bigint): bigint {
  const p = percentOf(plan, fact);
  if (p === null || p < LOW_PERCENT) return 0n;
  if (p <= HIGH_PERCENT) return (fact * MID_RATE) / 100n;
  return (fact * HIGH_RATE) / 100n;
}

const pad = (m: number) => String(m).padStart(2, '0');

/** «3,4» yoki «2026-03,2026-04» → [3, 4] (takrorsiz, tartiblangan) */
export function parseMonths(input?: string): number[] {
  if (!input) return [];
  const out = new Set<number>();
  for (const raw of input.split(',')) {
    const t = raw.trim();
    const m = /^(?:\d{4}-)?(\d{1,2})$/.exec(t);
    if (!m) continue;
    const n = Number(m[1]);
    if (n >= 1 && n <= 12) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

@Injectable()
export class PlanFactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollService,
    private readonly audit: AuditService,
  ) {}

  // ═══════════ Fayl o'qish ═══════════

  private cell(v: ExcelJS.CellValue): unknown {
    if (v && typeof v === 'object') {
      const r = v as unknown as Record<string, unknown>;
      if ('result' in r) return r.result;
      if ('richText' in r && Array.isArray(r.richText)) return (r.richText as { text: string }[]).map((p) => p.text).join('');
      if ('text' in r) return r.text;
    }
    return v;
  }

  private text(sheet: ExcelJS.Worksheet, row: number, col: number): string {
    const c = sheet.getRow(row).getCell(col);
    const raw = this.cell(c.isMerged && c.master ? c.master.value : c.value);
    return raw === null || raw === undefined ? '' : String(raw).trim();
  }

  /** So'm → tiyin. Bo'sh — null (yo'q), noto'g'ri — undefined */
  private money(value: unknown): bigint | null | undefined {
    if (value === null || value === undefined || String(value).trim() === '' || String(value).trim() === '-') return null;
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? BigInt(Math.round(value * 100)) : undefined;
    const n = Number(String(value).replace(/[\s  ]/g, '').replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n * 100)) : undefined;
  }

  private layout(sheet: ExcelJS.Worksheet): SheetLayout {
    const maxCol = Math.min(sheet.columnCount || 60, 120);
    const maxScan = Math.min(sheet.rowCount, 25);
    let headerRow = 0;
    let name: number | null = null;
    let pinfl: number | null = null;
    let region: number | null = null;
    let district: number | null = null;
    let type: number | null = null;
    let hudud: number | null = null;
    for (let r = 1; r <= maxScan && !headerRow; r++) {
      name = pinfl = region = district = type = hudud = null;
      for (let c = 1; c <= maxCol; c++) {
        const t = norm(this.text(sheet, r, c)).replace(/\s/g, '');
        if (!t) continue;
        if (pinfl === null && /^(pinfl|jshshir|жшшир|пинфл|shaxsiyraqam|jshshr)/.test(t)) pinfl = c;
        else if (type === null && /^(shtat|штат|xodimturi|ishturi|turi$)/.test(t)) type = c;
        else if (name === null && /^(fish|fio|fiо|xodim|familiyaismi|familiya|ism|фио|фиш)/.test(t)) name = c;
        else if (region === null && /^(viloyat|region|вилоят|область)/.test(t)) region = c;
        else if (hudud === null && /^(hudud|худуд)/.test(t)) hudud = c;
        else if (district === null && /^(tuman|shahar|туман|район|filial)/.test(t)) district = c;
      }
      // «Hudud nomi» — viloyat ustuni bo'lmasa, tuman/shahar (bo'lim) nomi deb olinadi; viloyat tumandan aniqlanadi
      if (hudud !== null) {
        if (region === null && district === null) district = hudud;
        else if (region === null) region = hudud;
      }
      if ((name !== null && (region !== null || district !== null)) || pinfl !== null) headerRow = r;
    }
    if (!headerRow) throw new BadRequestException("Sarlavha topilmadi: «JShShIR (PINFL)» yoki «F.I.Sh» va «Hudud nomi» ustunlari bo'lishi kerak");
    const isBonus = (t: string) => /^(ustama|bonus|mukofot|мукофот|премия|premiya)/.test(t);

    const isPlan = (t: string) => /^(oylik )?(reja|plan|план|режа)\b/.test(t) && !/(bajar|tushum|fakt)/.test(t);
    const isFact = (t: string) => /(tushum|fakt|haqiqiy|bajarilish|bajarildi|bajarilgan|ijro|факт|тушум)/.test(t);

    // Oylar: sarlavha qatori va ostidagi 2 qator — oy nomi birlashtirilgan katakda, ostida «reja» / «tushum»
    const months = new Map<number, { plan: number | null; fact: number | null; bonus: number | null }>();
    let subRow = 0;
    for (let r = headerRow; r <= headerRow + 2; r++) {
      let current: number | null = null;
      for (let c = 1; c <= maxCol; c++) {
        const txt = this.text(sheet, r, c);
        const m = monthOf(txt);
        if (m) current = m;
        else if (txt && /jami|итого|yillik/.test(norm(txt))) current = null; // oy guruhidan tashqari («Jami»)
        if (!current) continue;
        for (let rr = r + 1; rr <= r + 2; rr++) {
          const sub = norm(this.text(sheet, rr, c));
          if (!sub) continue;
          const slot = months.get(current) ?? { plan: null, fact: null, bonus: null };
          if (isBonus(sub)) {
            if (slot.bonus === null) slot.bonus = c;
            subRow = Math.max(subRow, rr);
          } else if (isFact(sub)) {
            if (slot.fact === null) slot.fact = c;
            subRow = Math.max(subRow, rr);
          } else if (isPlan(sub)) {
            if (slot.plan === null) slot.plan = c;
            subRow = Math.max(subRow, rr);
          }
          months.set(current, slot);
          break;
        }
      }
      if (months.size) break;
    }
    const list = [...months.entries()]
      .filter(([, v]) => v.fact !== null)
      .map(([month, v]) => ({ month, plan: v.plan, fact: v.fact!, bonus: v.bonus }))
      .sort((a, b) => a.month - b.month);
    if (list.length) return { headerRow, dataFrom: Math.max(subRow, headerRow) + 1, name, pinfl, region, district, type, single: false, months: list };

    // Oy nomisiz: bitta «reja» va «tushum» ustuni (sarlavha qatori yoki ostidagi 2 qatorda)
    let plan: number | null = null;
    let fact: number | null = null;
    let bonus: number | null = null;
    let row = headerRow;
    for (let r = headerRow; r <= headerRow + 1; r++) {
      for (let c = 1; c <= maxCol; c++) {
        const t = norm(this.text(sheet, r, c));
        if (!t) continue;
        if (bonus === null && isBonus(t)) {
          bonus = c;
          row = Math.max(row, r);
        } else if (fact === null && isFact(t)) {
          fact = c;
          row = Math.max(row, r);
        } else if (plan === null && isPlan(t)) {
          plan = c;
          row = Math.max(row, r);
        }
      }
    }
    if (fact === null) throw new BadRequestException("«Tushum» ustuni topilmadi: har oy uchun «reja» va «tushum» ustunlari bo'lishi kerak");
    return { headerRow, dataFrom: row + 1, name, pinfl, region, district, type, single: true, months: [{ month: 0, plan, fact, bonus }] };
  }

  private async references() {
    const [regions, districts, employees] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true } }) as Promise<Region[]>,
      this.prisma.district.findMany({ select: { id: true, regionCode: true, name: true } }) as Promise<District[]>,
      this.prisma.employee.findMany({ select: { pinfl: true, fullName: true, regionCode: true, districtId: true, employmentType: true, isActive: true } }) as Promise<Emp[]>,
    ]);
    return { regions, districts, employees };
  }

  // ═══════════ Tahlil ═══════════

  /** monthsInput: tanlangan oylar — «3,4» yoki «2026-03,2026-04»; bo'sh — fayldagi hamma oylar */
  async analyze(file: Express.Multer.File | undefined, yearInput?: string | number, monthsInput?: string): Promise<PlanFactAnalysis> {
    if (!file) throw new BadRequestException('Fayl yuklanmadi');
    const year = Number(yearInput ?? new Date().getUTCFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("Yil noto'g'ri");
    const selected = parseMonths(monthsInput);

    const wb = new ExcelJS.Workbook();
    await assertSafeXlsx(file.buffer);
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx (Excel) bo'lishi kerak");
    }
    // Sarlavhasi to'g'ri birinchi varaq
    let sheet: ExcelJS.Worksheet | undefined;
    let lay: SheetLayout | undefined;
    let firstError: unknown = null;
    for (const ws of wb.worksheets) {
      try {
        lay = this.layout(ws);
        sheet = ws;
        break;
      } catch (e) {
        firstError ??= e;
      }
    }
    if (!sheet || !lay) throw firstError instanceof Error ? firstError : new BadRequestException('Faylda varaq topilmadi');

    // Oylar: tanlov bo'yicha
    let notInFile: string[] = [];
    const fileMonths = lay.single ? [] : lay.months.map((m) => m.month);
    if (lay.single) {
      if (selected.length !== 1) throw new BadRequestException("Faylda oy nomi yo'q (faqat «reja» va «tushum») — qaysi oy ekanini tanlang (bitta oy)");
      lay.months = [{ ...lay.months[0]!, month: selected[0]! }];
    } else if (selected.length) {
      const inFile = new Set(lay.months.map((m) => m.month));
      notInFile = selected.filter((m) => !inFile.has(m)).map((m) => `${MONTH_NAMES[m - 1]} ${year}`);
      lay.months = lay.months.filter((m) => selected.includes(m.month));
      if (!lay.months.length) throw new BadRequestException(`Tanlangan oy(lar) faylda yo'q: ${notInFile.join(', ')}`);
    }

    const { regions, districts, employees } = await this.references();
    const regionBy = new Map<string, Region>();
    for (const r of regions) {
      regionBy.set(norm(r.name), r);
      regionBy.set(regionKey(r.name), r);
    }
    const findRegion = (raw: string): Region | null => {
      if (/^\d+$/.test(raw.trim())) return regions.find((r) => r.code === Number(raw)) ?? null;
      return regionBy.get(norm(raw)) ?? regionBy.get(regionKey(raw)) ?? null;
    };
    const dKeys = districts.map((d) => ({ d, ...districtKey(d.name) }));
    const findDistrict = (regionCode: number, raw: string): District | null => {
      const k = districtKey(raw);
      if (!k.base) return null;
      const inRegion = dKeys.filter((x) => x.d.regionCode === regionCode && x.base === k.base);
      return (inRegion.find((x) => x.city === k.city) ?? (inRegion.length === 1 ? inRegion[0] : undefined))?.d ?? null;
    };

    // Xodimlar indeksi
    const byFull = new Map<string, Emp[]>();
    const byShort = new Map<string, Emp[]>();
    const push = (m: Map<string, Emp[]>, k: string, e: Emp) => {
      if (!k) return;
      const list = m.get(k) ?? [];
      list.push(e);
      m.set(k, list);
    };
    for (const e of employees) {
      const k = nameKeys(e.fullName);
      push(byFull, k.full, e);
      push(byShort, k.short, e);
    }
    const pick = (list: Emp[] | undefined, regionCode: number): Emp[] => {
      if (!list?.length) return [];
      if (list.length === 1) return list;
      const inRegion = list.filter((e) => e.regionCode === regionCode);
      if (inRegion.length === 1) return inRegion;
      const active = (inRegion.length ? inRegion : list).filter((e) => e.isActive);
      return active.length ? active : inRegion.length ? inRegion : list;
    };
    const matchEmployee = (fileName: string, regionCode: number): { emp: Emp | null; partial: boolean; candidates: Emp[] } => {
      const k = nameKeys(fileName);
      let c = pick(byFull.get(k.full), regionCode);
      if (c.length === 1) return { emp: c[0]!, partial: false, candidates: c };
      if (c.length > 1) return { emp: null, partial: false, candidates: c };
      c = pick(byShort.get(k.short), regionCode);
      if (c.length === 0) c = pick(byShort.get(k.swapped), regionCode);
      if (c.length === 1) return { emp: c[0]!, partial: true, candidates: c };
      return { emp: null, partial: false, candidates: c };
    };

    const out: PlanFactAnalysis = {
      year,
      fileName: file.originalname,
      sheetName: sheet.name,
      totalRows: 0,
      matchedRows: 0,
      months: [],
      emptyMonths: [],
      regions: [],
      missing: [],
      ambiguous: [],
      unknownRegions: [],
      unknownDistricts: [],
      duplicates: [],
      invalidCells: [],
      partialNames: [],
      nameMismatches: [],
      invalidPinfl: [],
      registryRegion: [],
      typeChanges: [],
      skippedRows: 0,
      notInFile,
      fileMonths,
      single: lay.single,
      hasPinfl: lay.pinfl !== null,
      reconcile: [],
      reconcileDistricts: [],
      reconcileIssues: 0,
      rows: [],
    };
    const seen = new Map<string, number>();
    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const districtName = new Map(districts.map((d) => [d.id, d.name]));

    const byPinfl = new Map(employees.map((e) => [e.pinfl, e]));
    // Viloyat ustuni bo'lmasa (yangi shablon: «Hudud nomi» — tuman/shahar) — viloyat tumandan aniqlanadi
    const districtsByBase = new Map<string, typeof dKeys>();
    for (const x of dKeys) {
      const list = districtsByBase.get(x.base) ?? [];
      list.push(x);
      districtsByBase.set(x.base, list);
    }
    const guessDistrict = (raw: string, preferRegion: number | null): District | null => {
      const k = districtKey(raw);
      if (!k.base) return null;
      const all = districtsByBase.get(k.base) ?? [];
      const typed = all.filter((x) => x.city === k.city);
      const pool = typed.length ? typed : all;
      if (preferRegion !== null) {
        const inRegion = pool.filter((x) => x.d.regionCode === preferRegion);
        if (inRegion.length === 1) return inRegion[0]!.d;
      }
      return pool.length === 1 ? pool[0]!.d : null;
    };
    const parseType = (raw: string): 'SHTAT' | 'SHARTNOMA' | null => {
      const t = norm(raw);
      if (!t) return null;
      if (/shartnoma|договор|контракт|^2$/.test(t)) return 'SHARTNOMA';
      if (/shtat|штат|^1$|asosiy/.test(t)) return 'SHTAT';
      return null;
    };
    const TYPE_LABEL: Record<string, string> = { SHTAT: 'Shtat', SHARTNOMA: 'Shartnoma asosida' };

    for (let r = lay.dataFrom; r <= sheet.rowCount; r++) {
      const fileName = lay.name !== null ? this.text(sheet, r, lay.name) : '';
      const pinflText = lay.pinfl !== null ? this.text(sheet, r, lay.pinfl) : '';
      const pinflDigits = pinflText.replace(/\D/g, '');
      const hasName = /[a-zа-яёўқғҳ]{2}/i.test(fileName) && !/^(jami|итого|всего|hammasi)/i.test(norm(fileName));
      // Bo'sh, «Jami» yoki ustun raqamlari qatori (1, 2, 3 …) — o'tkazib yuboriladi
      if (!hasName && pinflDigits.length < 10) continue;
      out.totalRows += 1;
      const who = fileName || pinflText;
      const regionText = lay.region !== null ? this.text(sheet, r, lay.region) : '';
      const dText = lay.district !== null ? this.text(sheet, r, lay.district) : '';
      const fileType = lay.type !== null ? parseType(this.text(sheet, r, lay.type)) : null;
      let region: Region | null = regionText ? findRegion(regionText) : null;

      // 1) PINFL bo'yicha
      let emp: Emp | null = null;
      let partial = false;
      if (pinflText) {
        if (/^\d{14}$/.test(pinflDigits)) {
          emp = byPinfl.get(pinflDigits) ?? null;
          if (!emp) {
            const d = dText ? guessDistrict(dText, region?.code ?? null) : null;
            const reg = region ?? (d ? { code: d.regionCode, name: regionName.get(d.regionCode) ?? String(d.regionCode) } : null);
            out.missing.push({
              rowIndex: r,
              fileName: who,
              region: reg ? `${reg.name}${d ? ` / ${d.name}` : ''}` : regionText || dText,
              pinfl: pinflDigits,
              reason: 'pinfl',
              regionCode: reg?.code ?? null,
              districtId: d?.id ?? null,
              districtName: d?.name ?? null,
              employmentType: fileType,
            });
            continue;
          }
          if (fileName && nameKeys(fileName).short !== nameKeys(emp.fullName).short) out.nameMismatches.push({ rowIndex: r, pinfl: emp.pinfl, fileName, registryName: emp.fullName });
        } else {
          out.invalidPinfl.push({ rowIndex: r, fileName: who, value: pinflText });
        }
      }

      // Tuman (va viloyat ustuni bo'lmasa — viloyat) fayldagi «Hudud nomi»dan
      let districtFound: District | null = null;
      if (dText) {
        districtFound = region ? findDistrict(region.code, dText) : guessDistrict(dText, emp?.regionCode ?? null);
        if (!region && districtFound) region = { code: districtFound.regionCode, name: regionName.get(districtFound.regionCode) ?? String(districtFound.regionCode) };
      }
      if (!region && emp) {
        region = { code: emp.regionCode, name: regionName.get(emp.regionCode) ?? String(emp.regionCode) };
        out.registryRegion.push({ rowIndex: r, fileName: who, value: regionText || dText, region: region.name });
      }

      // 2) F.I.Sh bo'yicha
      if (!emp) {
        if (!region && hasName) {
          // viloyat noma'lum — butun reestrdan to'liq ism bo'yicha (bitta bo'lsa)
          const only = byFull.get(nameKeys(fileName).full);
          if (only && only.length === 1) {
            emp = only[0]!;
            region = { code: emp.regionCode, name: regionName.get(emp.regionCode) ?? String(emp.regionCode) };
          }
        }
        if (!emp) {
          if (!region) {
            out.unknownRegions.push({ rowIndex: r, fileName: who, value: regionText || dText });
            continue;
          }
          if (!hasName) {
            out.missing.push({ rowIndex: r, fileName: who, region: region.name, pinfl: null, reason: 'name', regionCode: region.code, districtId: districtFound?.id ?? null, districtName: districtFound?.name ?? null, employmentType: fileType });
            continue;
          }
          const found = matchEmployee(fileName, region.code);
          if (!found.emp) {
            if (found.candidates.length > 1) out.ambiguous.push({ rowIndex: r, fileName, region: region.name, candidates: found.candidates.slice(0, 5).map((e) => `${e.fullName} (${regionName.get(e.regionCode) ?? e.regionCode})`) });
            else out.missing.push({ rowIndex: r, fileName, region: region.name, pinfl: null, reason: 'name', regionCode: region.code, districtId: districtFound?.id ?? null, districtName: districtFound?.name ?? null, employmentType: fileType });
            continue;
          }
          emp = found.emp;
          partial = found.partial;
        }
      }
      if (!region) continue; // (yuqorida aniqlangan — TS uchun)
      if (seen.has(emp.pinfl)) {
        out.duplicates.push({ rowIndex: r, fileName: who, firstRow: seen.get(emp.pinfl)! });
        continue;
      }
      seen.set(emp.pinfl, r);
      if (partial) out.partialNames.push({ rowIndex: r, fileName, registryName: emp.fullName });

      let districtId: string | null = districtFound && districtFound.regionCode === region.code ? districtFound.id : null;
      if (dText && !districtId) out.unknownDistricts.push({ rowIndex: r, fileName: who, region: region.name, value: dText });
      if (!districtId && emp.regionCode === region.code) districtId = emp.districtId;
      const employmentType = fileType ?? emp.employmentType;
      if (fileType && fileType !== emp.employmentType) out.typeChanges.push({ rowIndex: r, fileName: who, from: TYPE_LABEL[emp.employmentType] ?? emp.employmentType, to: TYPE_LABEL[fileType]! });

      const months: PlanFactRow['months'] = {};
      for (const m of lay.months) {
        const label = MONTH_NAMES[m.month - 1]!;
        const row = sheet.getRow(r);
        const factRaw = this.cell(row.getCell(m.fact).value);
        const planRaw = m.plan ? this.cell(row.getCell(m.plan).value) : null;
        const bonusRaw = m.bonus ? this.cell(row.getCell(m.bonus).value) : null;
        const fact = this.money(factRaw);
        const plan = this.money(planRaw);
        const bonus = this.money(bonusRaw);
        if (fact === undefined) {
          out.invalidCells.push({ rowIndex: r, fileName, month: `${label} tushum`, value: String(factRaw) });
          continue;
        }
        if (plan === undefined) {
          out.invalidCells.push({ rowIndex: r, fileName, month: `${label} reja`, value: String(planRaw) });
          continue;
        }
        if (bonus === undefined) {
          out.invalidCells.push({ rowIndex: r, fileName, month: `${label} ustama`, value: String(bonusRaw) });
          continue;
        }
        if (fact === null) continue; // tushum hali yo'q — oy saqlanmaydi
        const p = plan ?? 0n;
        // «Ustama miqdori» ustuni bor — bu xodimning ish haqi: bo'sh katak = 0 (qoida bo'yicha hisoblanmaydi)
        const fromFile = m.bonus !== null;
        months[`${year}-${pad(m.month)}`] = {
          planTiyin: p.toString(),
          factTiyin: fact.toString(),
          bonusTiyin: (fromFile ? (bonus ?? 0n) : bonusFor(p, fact)).toString(),
          percent: percentOf(p, fact),
          bonusFromFile: fromFile,
        };
      }

      out.rows.push({
        rowIndex: r,
        pinfl: emp.pinfl,
        fullName: emp.fullName,
        fileName: fileName || emp.fullName,
        regionCode: region.code,
        regionName: region.name,
        districtId,
        districtName: districtId ? (districtName.get(districtId) ?? null) : null,
        employmentType,
        fileType,
        partial,
        moved: emp.regionCode !== region.code || (districtId !== null && emp.districtId !== districtId),
        months,
      });
    }
    out.matchedRows = out.rows.length;
    out.skippedRows = out.missing.length + out.ambiguous.length + out.unknownRegions.length + out.duplicates.length + new Set(out.invalidCells.map((c) => c.rowIndex)).size;
    if (!out.totalRows) throw new BadRequestException('Faylda xodim qatorlari topilmadi (PINFL yoki F.I.Sh to\'ldirilmagan)');

    // Oylar bo'yicha yig'indi
    const regionCodes = [...new Set(out.rows.map((x) => x.regionCode))];
    for (const m of lay.months) {
      const period = `${year}-${pad(m.month)}`;
      let plan = 0n;
      let fact = 0n;
      let bonus = 0n;
      let n = 0;
      for (const row of out.rows) {
        const v = row.months[period];
        if (!v) continue;
        n += 1;
        plan += BigInt(v.planTiyin);
        fact += BigInt(v.factTiyin);
        bonus += BigInt(v.bonusTiyin);
      }
      const label = `${MONTH_NAMES[m.month - 1]} ${year}`;
      if (!n) {
        out.emptyMonths.push(label);
        continue;
      }
      const previousRows = await this.prisma.employeeResult.count({ where: { period, regionCode: { in: regionCodes }, batch: { cancelledAt: null } } });
      const payroll = await this.payrollInfo(period, out.rows.filter((x) => x.months[period]).map((x) => ({ pinfl: x.pinfl, amount: BigInt(x.months[period]!.bonusTiyin) })), m.bonus !== null);
      out.months.push({ period, label, employees: n, planTiyin: plan.toString(), factTiyin: fact.toString(), bonusTiyin: bonus.toString(), percent: percentOf(plan, fact), previousRows, payroll });
    }

    // Viloyatlar bo'yicha (hamma oylar)
    const reg = new Map<number, { employees: number; plan: bigint; fact: bigint }>();
    for (const row of out.rows) {
      const g = reg.get(row.regionCode) ?? { employees: 0, plan: 0n, fact: 0n };
      g.employees += 1;
      for (const v of Object.values(row.months)) {
        g.plan += BigInt(v.planTiyin);
        g.fact += BigInt(v.factTiyin);
      }
      reg.set(row.regionCode, g);
    }
    out.regions = [...reg.entries()]
      .map(([code, g]) => ({ regionCode: code, name: regionName.get(code) ?? String(code), employees: g.employees, planTiyin: g.plan.toString(), factTiyin: g.fact.toString(), percent: percentOf(g.plan, g.fact) }))
      .sort((a, b) => a.regionCode - b.regionCode);

    await this.reconcile(out, regionName, districtName);
    return out;
  }

  /**
   * Ustama = hudud xodimining shu oy ish haqi. Hududlar ish haqi vedomostiga (REGIONS) yoziladi:
   * shu xodimlarning avvalgi hudud ish haqi almashtiriladi, boshqalariniki saqlanadi.
   * Umumiy vedomostda (administrator) shu oy ish haqi bor xodim — qayta yozilmaydi (ikki marta sanalmasin).
   */
  private async payrollInfo(period: string, list: { pinfl: string; amount: bigint }[], fromFile: boolean) {
    const pinfls = list.map((x) => x.pinfl);
    const [general, previous] = pinfls.length
      ? await Promise.all([
          this.prisma.payrollEntry.findMany({ where: { period, employeePinfl: { in: pinfls }, batch: { status: 'COMMITTED', scope: { not: 'REGIONS' } } }, select: { employeePinfl: true } }),
          this.prisma.payrollEntry.findMany({ where: { period, employeePinfl: { in: pinfls }, batch: { status: 'COMMITTED', scope: 'REGIONS' } }, select: { baseTiyin: true } }),
        ])
      : [[], []];
    const inGeneral = new Set(general.map((g) => g.employeePinfl));
    const usable = list.filter((x) => !inGeneral.has(x.pinfl));
    return {
      fromFile,
      employees: usable.length,
      totalTiyin: usable.reduce((t, x) => t + x.amount, 0n).toString(),
      inGeneral: inGeneral.size,
      previousTiyin: previous.reduce((t, x) => t + x.baseTiyin, 0n).toString(),
      generalPinfls: [...inGeneral],
    };
  }

  /**
   * Fayl daromadni qayta yozmaydi — allaqachon yuklangan daromadni xodimlarga bo'lib beradi.
   * Shuning uchun har oy × viloyat (va tuman) bo'yicha: fayldagi tushum yig'indisi = Daromadlar bo'limidagi
   * shu hudud daromadi bo'lishi kerak. Farq 0,5% dan (kamida 1 000 so'm) katta bo'lsa — ogohlantirish.
   */
  private async reconcile(out: PlanFactAnalysis, regionName: Map<number, string>, districtName: Map<string, string>): Promise<void> {
    const periods = out.months.map((m) => m.period);
    if (!periods.length) return;
    const regionCodes = [...new Set(out.rows.map((r) => r.regionCode))];
    const incomes = await this.prisma.income.findMany({
      where: { period: { in: periods }, deletedAt: null, regionCode: { in: regionCodes } },
      select: { period: true, regionCode: true, districtId: true, amountTiyin: true },
    });
    const key = (p: string, r: number, d: string | null) => `${p}|${r}|${d ?? ''}`;
    const incR = new Map<string, bigint>();
    const incD = new Map<string, bigint>();
    for (const i of incomes) {
      if (i.regionCode === null) continue;
      incR.set(key(i.period, i.regionCode, null), (incR.get(key(i.period, i.regionCode, null)) ?? 0n) + i.amountTiyin);
      if (i.districtId) incD.set(key(i.period, i.regionCode, i.districtId), (incD.get(key(i.period, i.regionCode, i.districtId)) ?? 0n) + i.amountTiyin);
    }
    const fileR = new Map<string, bigint>();
    const fileD = new Map<string, bigint>();
    for (const row of out.rows) {
      for (const [period, v] of Object.entries(row.months)) {
        const f = BigInt(v.factTiyin);
        fileR.set(key(period, row.regionCode, null), (fileR.get(key(period, row.regionCode, null)) ?? 0n) + f);
        if (row.districtId) fileD.set(key(period, row.regionCode, row.districtId), (fileD.get(key(period, row.regionCode, row.districtId)) ?? 0n) + f);
      }
    }
    const labelOf = new Map(out.months.map((m) => [m.period, m.label]));
    const line = (k: string, file: bigint, income: bigint): ReconcileLine => {
      const [period, r, d] = k.split('|') as [string, string, string];
      const diff = file - income;
      const abs = diff < 0n ? -diff : diff;
      const tolerance = income / 200n > 100_000n ? income / 200n : 100_000n; // 0,5% yoki 1 000 so'm
      return {
        period,
        label: labelOf.get(period) ?? period,
        regionCode: Number(r),
        regionName: regionName.get(Number(r)) ?? r,
        districtId: d || null,
        districtName: d ? (districtName.get(d) ?? d) : null,
        factTiyin: file.toString(),
        incomeTiyin: income.toString(),
        diffTiyin: diff.toString(),
        diffPercent: income > 0n ? Number((diff * 10000n) / income) / 100 : null,
        status: income === 0n ? 'no_income' : abs <= tolerance ? 'ok' : 'diff',
      };
    };
    out.reconcile = [...fileR.entries()]
      .map(([k, f]) => line(k, f, incR.get(k) ?? 0n))
      .sort((a, b) => a.period.localeCompare(b.period) || a.regionCode - b.regionCode);
    out.reconcileIssues = out.reconcile.filter((l) => l.status !== 'ok').length;
    // Tumanlar: faqat daromadi tuman kesimida yuklangan viloyat-oylarda solishtiriladi
    const dKeys = new Set([...fileD.keys(), ...incD.keys()]);
    const regionsWithDistrictIncome = new Set([...incD.keys()].map((k) => k.split('|').slice(0, 2).join('|')));
    out.reconcileDistricts = [...dKeys]
      .filter((k) => regionsWithDistrictIncome.has(k.split('|').slice(0, 2).join('|')) && fileR.has(`${k.split('|').slice(0, 2).join('|')}|`))
      .map((k) => line(k, fileD.get(k) ?? 0n, incD.get(k) ?? 0n))
      .filter((l) => l.status !== 'ok')
      .sort((a, b) => a.period.localeCompare(b.period) || a.regionCode - b.regionCode || (a.districtName ?? '').localeCompare(b.districtName ?? ''));
  }

  // ═══════════ Saqlash ═══════════

  /** Faylni qayta o'qib saqlaydi (brauzerdan kelgan raqamlarga ishonilmaydi). months — faqat shu oylar (bo'sh — hammasi) */
  /** withPayroll — ustama ustuni bo'lsa, ustamani hudud xodimlarining shu oy ish haqi sifatida yozish (standart: ha) */
  async commit(file: Express.Multer.File | undefined, yearInput: string | number | undefined, monthsInput: string | undefined, userId: string, withPayroll = true) {
    const a = await this.analyze(file, yearInput, monthsInput);
    const months = a.months;
    if (!months.length) throw new BadRequestException("Saqlash uchun oy yo'q: fayldagi oylarda tushum to'ldirilmagan");
    if (!a.rows.length) throw new BadRequestException('Reestrda topilgan xodim yo\'q — avval Xodimlar bo\'limiga qo\'shing');
    // Yopilgan oy (Hududchi › Oyni yopish) — o'zgartirilmaydi
    const closed = new Set(
      (await this.prisma.regionalPeriodClose.findMany({ where: { period: { in: months.map((m) => m.period) } }, select: { period: true, status: true } }))
        .filter((c) => c.status === 'CLOSED')
        .map((c) => c.period),
    );
    for (const m of months) {
      if (closed.has(m.period)) throw new BadRequestException(`${m.label} yopilgan — o'zgartirib bo'lmaydi. Xato bo'lsa, administrator oyni qayta ochadi`);
    }

    const saved: { period: string; label: string; employees: number; factTiyin: string; replaced: number; payrollTiyin: string | null }[] = [];
    for (const m of months) {
      // Ustama ish haqi sifatida vedomostga yozilsa — natijada «bonus» bo'lib qayta ko'rinmaydi (Solishtirmada faqat «Ish haqi»)
      const asSalary = withPayroll && m.payroll.fromFile;
      const general = new Set(m.payroll.generalPinfls);
      const rows = a.rows
        .filter((r) => r.months[m.period])
        .map((r) => {
          const v = r.months[m.period]!;
          const salary = asSalary && r.regionCode !== 0 && !general.has(r.pinfl) ? BigInt(v.bonusTiyin) : null;
          return { row: r, v: salary === null ? v : { ...v, bonusTiyin: '0' }, salary };
        });
      const regionCodes = [...new Set(rows.map((x) => x.row.regionCode))];
      const pinfls = rows.map((x) => x.row.pinfl);
      const totals = rows.reduce((s, x) => ({ plan: s.plan + BigInt(x.v.planTiyin), fact: s.fact + BigInt(x.v.factTiyin), bonus: s.bonus + BigInt(x.v.bonusTiyin) }), { plan: 0n, fact: 0n, bonus: 0n });

      const replaced = await this.prisma.$transaction(
        async (tx) => {
          // Shu oyning faol natijalari: fayldagi viloyatlar yoki fayldagi xodimlar — almashtiriladi
          const old = await tx.employeeResult.findMany({
            where: { period: m.period, batch: { cancelledAt: null }, OR: [{ regionCode: { in: regionCodes } }, { employeePinfl: { in: pinfls } }] },
            select: { id: true, batchId: true, employeePinfl: true },
          });
          if (old.length) {
            await tx.employeeResult.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
            // Qolganlari bo'yicha eski yuklashlar yig'indisi yangilanadi; bo'sh qolgani — bekor
            for (const batchId of [...new Set(old.map((o) => o.batchId))]) {
              const left = await tx.employeeResult.findMany({ where: { batchId }, select: { planTiyin: true, factTiyin: true, bonusTiyin: true } });
              if (!left.length) await tx.resultBatch.update({ where: { id: batchId }, data: { cancelledAt: new Date() } });
              else
                await tx.resultBatch.update({
                  where: { id: batchId },
                  data: {
                    totalRows: left.length,
                    planTiyin: left.reduce((s, x) => s + x.planTiyin, 0n),
                    factTiyin: left.reduce((s, x) => s + x.factTiyin, 0n),
                    bonusTiyin: left.reduce((s, x) => s + x.bonusTiyin, 0n),
                  },
                });
            }
          }
          const touched = [...new Set([...pinfls, ...old.map((o) => o.employeePinfl)])];
          await tx.employeeLocation.deleteMany({ where: { period: m.period, source: 'RESULTS', employeePinfl: { in: touched } } });

          const batch = await tx.resultBatch.create({
            data: {
              period: m.period,
              fileName: a.fileName,
              totalRows: rows.length,
              planTiyin: totals.plan,
              factTiyin: totals.fact,
              bonusTiyin: totals.bonus,
              movedCount: rows.filter((x) => x.row.moved).length,
              uploadedById: userId,
            },
          });
          await tx.employeeResult.createMany({
            data: rows.map(({ row, v }) => ({
              batchId: batch.id,
              period: m.period,
              employeePinfl: row.pinfl,
              regionCode: row.regionCode,
              districtId: row.districtId,
              employmentType: row.employmentType as 'SHTAT' | 'SHARTNOMA',
              planTiyin: BigInt(v.planTiyin),
              factTiyin: BigInt(v.factTiyin),
              bonusTiyin: BigInt(v.bonusTiyin),
            })),
          });
          // Boshqa manbadan (qo'lda ko'chirish) yozilgan joylashuv ustun — ustidan yozilmaydi
          const manual = new Set(
            (await tx.employeeLocation.findMany({ where: { period: m.period, employeePinfl: { in: pinfls } }, select: { employeePinfl: true } })).map((x) => x.employeePinfl),
          );
          const loc = rows.filter(({ row }) => !manual.has(row.pinfl));
          if (loc.length)
            await tx.employeeLocation.createMany({
              data: loc.map(({ row }) => ({ employeePinfl: row.pinfl, period: m.period, regionCode: row.regionCode, districtId: row.districtId, employmentType: row.employmentType, source: 'RESULTS' })),
              skipDuplicates: true,
            });
          return old.length;
        },
        { timeout: 120_000 },
      );
      await this.payroll.regroup(m.period).catch(() => null);
      const payrollTiyin = asSalary ? await this.writePayroll(m.period, rows.filter((x) => x.salary !== null).map((x) => ({ pinfl: x.row.pinfl, regionCode: x.row.regionCode, amount: x.salary! })), m.payroll.generalPinfls, a.fileName, userId) : null;
      saved.push({ period: m.period, label: m.label, employees: rows.length, factTiyin: totals.fact.toString(), replaced, payrollTiyin });
    }
    await this.audit.log({
      userId,
      action: 'CREATE',
      entity: 'plan_fact',
      entityId: String(a.year),
      summary: `Reja/tushum fayli: ${a.fileName} — ${saved.map((s) => s.label).join(', ')}; ${a.matchedRows} xodim`,
    });
    return { year: a.year, saved, missing: a.missing.length + a.ambiguous.length + a.unknownRegions.length, reconcileIssues: a.reconcileIssues };
  }

  /**
   * Ustama → Hududlar ish haqi vedomosti (REGIONS) shu oy uchun.
   * Avvalgi hudud vedomostidagi BOSHQA xodimlar saqlanadi (birlashtiriladi), shu fayl xodimlariniki almashtiriladi.
   * Markaz xodimlari va umumiy vedomostdagilar kirmaydi.
   */
  private async writePayroll(period: string, list: { pinfl: string; regionCode: number; amount: bigint }[], generalPinfls: string[], fileName: string, userId: string): Promise<string | null> {
    const skip = new Set(generalPinfls);
    const mine = list.filter((x) => x.regionCode !== 0 && !skip.has(x.pinfl));
    if (!mine.length) return null;
    const minePins = new Set(mine.map((x) => x.pinfl));
    const kept = await this.prisma.payrollEntry.findMany({
      where: { period, batch: { status: 'COMMITTED', scope: 'REGIONS' } },
      // To'liq summa (baseTiyin): bayram, choraklik Markazga ajratilgan bo'lsa ham vedomostga to'liq qaytadi
      select: { employeePinfl: true, baseTiyin: true, totalTiyin: true, bonusTiyin: true },
    });
    const rows = new Map<string, bigint>();
    const fullOf = (k: { baseTiyin: bigint; totalTiyin: bigint; bonusTiyin: bigint }) => (k.baseTiyin === 0n ? k.totalTiyin + k.bonusTiyin : k.baseTiyin);
    for (const k of kept) if (!minePins.has(k.employeePinfl)) rows.set(k.employeePinfl, (rows.get(k.employeePinfl) ?? 0n) + fullOf(k));
    for (const x of mine) rows.set(x.pinfl, x.amount);
    const result = await this.payroll.commit({
      period,
      rows: [...rows.entries()].map(([pinfl, amountTiyin]) => ({ pinfl, amountTiyin })),
      userId,
      replacePrevious: true,
      fileName: `Ustama: ${fileName}`.slice(0, 200),
      missing: [],
      scope: 'REGIONS',
    });
    return mine.reduce((t, x) => t + x.amount, 0n).toString() || String(result.totalTiyin);
  }

  // ═══════════ Topilmagan xodimlarni reestrga qo'shish ═══════════

  /**
   * Faylda bor, reestrda yo'q xodimlar — to'g'ridan-to'g'ri Xodimlar reestriga qo'shiladi
   * (PINFL, F.I.Sh, viloyat/tuman, shtat turi — fayldagidek). Keyin fayl qayta tahlil qilinadi.
   */
  async addEmployees(input: unknown, actor: { id: string; role: string }) {
    const list = Array.isArray(input) ? input.slice(0, 2000) : [];
    if (!list.length) throw new BadRequestException("Qo'shish uchun xodim tanlanmagan");
    const [regions, districts] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true } }),
      this.prisma.district.findMany({ select: { id: true, regionCode: true } }),
    ]);
    const regionSet = new Set(regions.map((r) => r.code));
    const districtRegion = new Map(districts.map((d) => [d.id, d.regionCode]));
    const clean = list.map((raw, i) => {
      const x = (raw ?? {}) as Record<string, unknown>;
      const pinfl = String(x.pinfl ?? '').replace(/\D/g, '');
      const fullName = String(x.fullName ?? '').replace(/\s+/g, ' ').trim();
      const regionCode = Number(x.regionCode);
      const districtId = x.districtId ? String(x.districtId) : null;
      const employmentType = x.employmentType === 'SHARTNOMA' ? 'SHARTNOMA' : 'SHTAT';
      const n = i + 1;
      if (!/^\d{14}$/.test(pinfl)) throw new BadRequestException(`${n}-xodim: PINFL 14 raqam bo'lishi kerak`);
      if (fullName.split(' ').length < 2) throw new BadRequestException(`${n}-xodim (${pinfl}): F.I.Sh to'liq emas`);
      if (!Number.isInteger(regionCode) || !regionSet.has(regionCode)) throw new BadRequestException(`${n}-xodim (${fullName}): viloyatni tanlang`);
      if (actor.role !== 'ADMIN' && regionCode === 0) throw new BadRequestException(`${fullName}: Hududchi Markaz xodimini qo'sha olmaydi`);
      if (districtId && districtRegion.get(districtId) !== regionCode) throw new BadRequestException(`${fullName}: tuman viloyatga mos emas`);
      const [lastName, firstName, ...rest] = fullName.split(' ');
      return { pinfl, fullName, lastName: lastName!, firstName: firstName ?? '', middleName: rest.join(' ') || null, regionCode, districtId, employmentType: employmentType as 'SHTAT' | 'SHARTNOMA' };
    });
    const pins = clean.map((c) => c.pinfl);
    if (new Set(pins).size !== pins.length) throw new BadRequestException("Bir xil PINFL ikki marta tanlangan");
    const exists = await this.prisma.employee.findMany({ where: { pinfl: { in: pins } }, select: { pinfl: true, fullName: true } });
    if (exists.length) throw new BadRequestException(`Reestrda allaqachon bor: ${exists.slice(0, 3).map((e) => `${e.fullName} (${e.pinfl})`).join(', ')}`);
    await this.prisma.employee.createMany({
      data: clean.map((c) => ({
        pinfl: c.pinfl,
        lastName: c.lastName,
        firstName: c.firstName,
        middleName: c.middleName,
        fullName: c.fullName,
        employmentType: c.employmentType,
        regionCode: c.regionCode,
        districtId: c.districtId,
        isActive: true,
      })),
    });
    await this.audit.log({
      userId: actor.id,
      action: 'CREATE',
      entity: 'employee',
      entityId: pins[0]!,
      summary: `Reja/tushum faylidan xodimlarga qo'shildi: ${clean.length} ta (${clean.slice(0, 3).map((c) => c.fullName).join(', ')}${clean.length > 3 ? '…' : ''})`,
    });
    return { created: clean.length };
  }

  // ═══════════ Shablon ═══════════

  /**
   * Bo'sh shablon (faqat sarlavha) — korxonadagi shakl: bitta oy, oy yuklashda tanlanadi.
   *   Xodim F.I.Sh · JShShIR · Shtat · Hudud nomi · Oylik reja · Reja bajarilishi (tushum) · Foizda · Ustama miqdori
   * «Ustama miqdori» — hudud xodimining shu oy ish haqi (Solishtirmada «Ish haqi» bo'lib ko'rinadi).
   */
  async template(yearInput?: string | number, monthsInput?: string): Promise<{ buffer: Buffer; filename: string }> {
    const year = Number(yearInput ?? new Date().getUTCFullYear());
    const chosen = parseMonths(monthsInput);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reja-tushum', { views: [{ state: 'frozen', ySplit: 1 }] });
    const cols: { header: string; width: number; numFmt?: string }[] = [
      { header: 'Xodim F.I.Sh', width: 44 },
      { header: 'JShShIR', width: 17, numFmt: '@' },
      { header: 'Shtat', width: 18 },
      { header: 'Hudud nomi', width: 32 },
      { header: 'Oylik reja', width: 15, numFmt: '# ### ##0' },
      { header: 'Reja bajarilishi (tushum)', width: 16, numFmt: '# ### ##0' },
      { header: 'Foizda', width: 9, numFmt: '0.0' },
      { header: 'Ustama miqdori', width: 16, numFmt: '# ### ##0' },
    ];
    const headFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF2F5597' } };
    const border = { top: { style: 'thin' as const }, left: { style: 'thin' as const }, bottom: { style: 'thin' as const }, right: { style: 'thin' as const } };
    cols.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.width;
      if (c.numFmt) col.numFmt = c.numFmt;
      const cell = ws.getCell(1, i + 1);
      cell.value = c.header;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = headFill;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = border;
    });
    ws.getRow(1).height = 34;
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
    // Foizda — avtomatik (tushum ÷ reja × 100); 1000 qatorgacha
    for (let r = 2; r <= 1001; r++) {
      ws.getCell(r, 7).value = { formula: `IF(AND(ISNUMBER(E${r}),E${r}>0,ISNUMBER(F${r})),ROUND(F${r}/E${r}*100,1),"")` } as ExcelJS.CellFormulaValue;
    }
    // Shtat — tanlov ro'yxati
    for (let r = 2; r <= 1001; r++) {
      ws.getCell(r, 3).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Shtat - 1,Shartnoma asosida"'] };
    }

    const help = wb.addWorksheet("Yo'riqnoma");
    [
      'Xodimlar reja va tushumi (bir oy)',
      '',
      "Shablon bo'sh — 2-qatordan boshlab o'zingiz to'ldirasiz. Sarlavhani (1-qator) o'zgartirmang. Qaysi oy ekanini dasturda yuklashda tanlaysiz.",
      '',
      "Xodim F.I.Sh — to'liq ism.",
      "JShShIR — PINFL (14 raqam). Xodim shu raqam bo'yicha aniq topiladi; bo'sh bo'lsa — F.I.Sh bo'yicha qidiriladi.",
      "Shtat — «Shtat - 1» yoki «Shartnoma asosida». Bo'sh bo'lsa — Xodimlar reestridagi.",
      "Hudud nomi — tuman yoki shahar (masalan «Amudaryo tumani», «Nukus shahar», «Bo'lim boshlig'i - Nukus shahar»). Viloyat shundan aniqlanadi.",
      "Oylik reja, Reja bajarilishi (tushum) — so'mda.",
      "Foizda — avtomatik hisoblanadi.",
      "Ustama miqdori — xodimning shu oy hududdagi ish haqi. Solishtirmada «Ish haqi» bo'lib ko'rinadi (Hududlar ish haqi vedomostiga yoziladi).",
      '',
      "Reestrda yo'q xodim (PINFL topilmasa) — yuklashda ko'rsatiladi va shu yerning o'zidan Xodimlarga qo'shish mumkin.",
      "PINFL va F.I.Sh bo'yicha topilmagan qatorlar — ogohlantiriladi; «OK» bosilsa, ular olinmasdan qolganlari saqlanadi.",
      "Bu fayl yangi daromad yaratmaydi — Daromadlar bo'limidagi daromadni xodimlarga bo'lib beradi va u bilan solishtiriladi.",
    ].forEach((t, i) => (help.getCell(i + 1, 1).value = t));
    help.getColumn(1).width = 130;
    help.getCell(1, 1).font = { bold: true, size: 13 };

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const suffix = chosen.length === 1 ? `${year}-${pad(chosen[0]!)}` : String(year);
    return { buffer, filename: `reja-tushum-${suffix}.xlsx` };
  }
}