import { exportXlsx } from '@/lib/excel-export';
// ═══════════════════════════════════════════════════════════
// Tarkib tahlili uchun oddiy statistik hisoblar (brauzerda).
// Hamma summalar tiyinda, number sifatida.
// ═══════════════════════════════════════════════════════════

export const toNums = (values: string[]): number[] => values.map(Number);

export const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

export const mean = (values: number[]): number => (values.length ? sum(values) / values.length : 0);

/** Oxirgi n ta qiymat */
export function lastN<T>(values: T[], n: number): T[] {
  return values.slice(Math.max(0, values.length - n));
}

/** Foizli o'zgarish; bazasi 0 bo'lsa null */
export function changePct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Oylik trend: chiziqli regressiya qiyaligi, o'rtachaga nisbatan % (oyiga) */
export function trendPerMonth(values: number[]): number | null {
  const n = values.length;
  const avg = mean(values);
  if (n < 3 || avg <= 0) return null;
  const xMean = (n - 1) / 2;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - xMean) * (y - avg);
    den += (x - xMean) ** 2;
  });
  return den === 0 ? null : (num / den / avg) * 100;
}

/** O'zgaruvchanlik koeffitsienti (CV), %: standart chetlanish / o'rtacha */
export function variation(values: number[]): number | null {
  const active = values.filter((v) => v !== 0);
  if (active.length < 3) return null;
  const avg = mean(active);
  if (avg <= 0) return null;
  const std = Math.sqrt(sum(active.map((v) => (v - avg) ** 2)) / (active.length - 1));
  return (std / avg) * 100;
}

export type Behavior = 'growing' | 'falling' | 'stable' | 'volatile' | 'new' | 'unknown';

export const BEHAVIOR_TEXT: Record<Behavior, { label: string; hint: string }> = {
  growing: { label: "O'smoqda", hint: "Oyma-oy barqaror o'sish" },
  falling: { label: 'Kamaymoqda', hint: 'Oyma-oy barqaror pasayish' },
  stable: { label: 'Barqaror', hint: "Deyarli o'zgarmaydi" },
  volatile: { label: "O'zgaruvchan", hint: 'Oydan oyga keskin sakraydi' },
  new: { label: 'Yangi', hint: "Oxirgi oylarda paydo bo'lgan" },
  unknown: { label: "Ma'lumot kam", hint: 'Xulosa uchun kamida 3 oy kerak' },
};

/** Moddaning xarakteri: trend va o'zgaruvchanlik bo'yicha */
export function behaviorOf(values12: number[]): Behavior {
  const active = values12.filter((v) => v > 0).length;
  if (active === 0) return 'unknown';
  const firstActive = values12.findIndex((v) => v > 0);
  if (firstActive >= 8) return 'new';
  if (active < 3) return 'unknown';
  const cv = variation(values12) ?? 0;
  const slope = trendPerMonth(values12) ?? 0;
  if (cv > 60) return 'volatile';
  if (slope >= 2) return 'growing';
  if (slope <= -2) return 'falling';
  return 'stable';
}

export interface MonthStat {
  period: string;
  value: number;
}

/** Eng yuqori va eng past (nol bo'lmagan) oy */
export function extremes(months: string[], values: number[]): { max: MonthStat | null; min: MonthStat | null } {
  let max: MonthStat | null = null;
  let min: MonthStat | null = null;
  values.forEach((value, i) => {
    const period = months[i]!;
    if (!max || value > max.value) max = { period, value };
    if (value > 0 && (!min || value < min.value)) min = { period, value };
  });
  return { max, min };
}

export interface YearForecast {
  year: number;
  /** Yil boshidan to'liq o'tgan oylar fakti */
  factTiyin: number;
  /** Joriy (to'liq bo'lmagan) oy fakti */
  partialTiyin: number;
  /** Prognoz uchun asos: so'nggi 3 to'liq oy o'rtachasi */
  basisTiyin: number;
  /** Qolgan oylar soni (joriy oy ham kiradi, agar to'liq bo'lmasa) */
  remainingMonths: number;
  forecastTiyin: number;
  /** O'tgan yil jami (24 oylik oynadan) */
  lastYearTiyin: number | null;
  /** O'tgan yilning shu vaqtgacha bo'lgan qismi */
  lastYearToDateTiyin: number | null;
}

/**
 * Yil yakuni prognozi (oddiy, tushunarli usul):
 * yil boshidan to'liq oylar fakti + so'nggi 3 to'liq oy o'rtachasi × qolgan oylar.
 * Joriy oy to'liq tugamagan bo'lsa, u ham "qolgan oy" hisoblanadi.
 */
export function forecastYear(months: string[], values: number[], rangeTo: string): YearForecast | null {
  const [y, m, d] = rangeTo.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthComplete = d >= lastDay;
  const lastFull = monthComplete ? m : m - 1;
  const period = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
  const valueOf = (p: string): number | null => {
    const i = months.indexOf(p);
    return i < 0 ? null : values[i]!;
  };

  let fact = 0;
  for (let month = 1; month <= lastFull; month += 1) fact += valueOf(period(y, month)) ?? 0;
  const partial = monthComplete ? 0 : (valueOf(period(y, m)) ?? 0);

  const basisMonths: number[] = [];
  for (let back = 0; back < 3; back += 1) {
    const index = y * 12 + (lastFull - 1) - back;
    const v = valueOf(period(Math.floor(index / 12), (index % 12) + 1));
    if (v !== null) basisMonths.push(v);
  }
  if (basisMonths.length === 0) return null;
  const basis = mean(basisMonths);
  const remaining = 12 - lastFull;

  let lastYear: number | null = 0;
  let lastYearToDate: number | null = 0;
  for (let month = 1; month <= 12; month += 1) {
    const v = valueOf(period(y - 1, month));
    if (v === null) {
      lastYear = null;
      if (month <= lastFull) lastYearToDate = null;
      continue;
    }
    if (lastYear !== null) lastYear += v;
    if (month <= lastFull && lastYearToDate !== null) lastYearToDate += v;
  }

  return {
    year: y,
    factTiyin: fact,
    partialTiyin: partial,
    basisTiyin: basis,
    remainingMonths: remaining,
    forecastTiyin: fact + basis * remaining,
    lastYearTiyin: lastYear,
    lastYearToDateTiyin: lastYearToDate,
  };
}

/** Yil boshidan jamlanma (oylar bo'yicha, 12 ta qiymat; ma'lumot yo'q oylar null) */
export function cumulativeByMonth(months: string[], values: number[], year: number, upToMonth = 12): (number | null)[] {
  let acc = 0;
  const result: (number | null)[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const i = months.indexOf(`${year}-${String(month).padStart(2, '0')}`);
    if (i < 0 || month > upToMonth) {
      result.push(null);
      continue;
    }
    acc += values[i]!;
    result.push(acc);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════
// CSV (Excel ochadi) — yuklab olish
// ═══════════════════════════════════════════════════════════

/**
 * Ustun nomiga qarab formulasi (CSV oxiridagi «Hisob-kitob» bo'limi uchun).
 * Saytdagi «Qanday hisoblandi?» bilan bir xil formulalar (lib/calc.ts FORMULAS).
 */
const COLUMN_FORMULAS: [RegExp, string][] = [
  [/rentabellik/i, 'Rentabellik, % = (Daromad − Xarajat) ÷ Daromad × 100'],
  [/ulush/i, 'Ulush, % = Qator summasi ÷ Jami × 100'],
  [/o['‘’]zgarish/i, "O'zgarish, % = (Joriy − Oldingi) ÷ |Oldingi| × 100 (oldingi 0 bo'lsa — hisoblanmaydi)"],
  [/farq/i, 'Farq = Joriy − Oldingi (yoki Haqiqiy − Kutilgan)'],
  [/natija|foyda/i, 'Natija = Daromad − Xarajat (musbat — foyda, manfiy — zarar)'],
  [/(bir|1) xodimga/i, 'Bir xodimga = Summa ÷ Xodimlar soni'],
  [/o['‘’]rtacha/i, "O'rtacha = Summa ÷ Soni (yoki oylar soni)"],
  [/bajarilish/i, 'Bajarilish, % = Fakt ÷ Reja × 100'],
  [/zarar oylari|zararli/i, 'Zararli oy — shu oyda Daromad − Xarajat < 0'],
  [/samaradorlik/i, "Samaradorlik (DEA) = Daromad ÷ namuna hududlar shu resurslar bilan oladigan daromad"],
  [/imkoniyat/i, 'Imkoniyat = Daromad ÷ Samaradorlik; Farq = Imkoniyat − Daromad'],
  [/zararsizlik/i, "Zararsizlik = Doimiy xarajat ÷ (1 − o'zgaruvchan ulush)"],
  [/zaxira/i, 'Xavfsizlik zaxirasi, % = (Daromad − Zararsizlik) ÷ Daromad × 100'],
  [/leverej/i, 'Leverej = Daromad × (1 − v) ÷ Foyda'],
  [/ehtimol/i, "Ehtimollik = holat yuz bergan simulyatsiya yo'llari ÷ 2000 × 100"],
  [/prognoz|80%/i, "Prognoz — Katta modellar (ETS); 80% oraliq — 2000 ta simulyatsiyaning 10% va 90% kvantillari"],
  [/kutilgan/i, "Kutilgan — avvalgi sur'at (yoki model) bo'yicha kutilgan qiymat"],
  [/ish haqi/i, 'Ish haqi — Ish haqi qaydnomasidan (tumanda ishlagan xodimlarga hisoblangan)'],
];

function csvWorkings(header: string[], rows: (string | number | null)[][]): (string | number | null)[][] {
  const lines: (string | number | null)[][] = [];
  const seen = new Set<string>();
  for (const column of header) {
    const hit = COLUMN_FORMULAS.find(([re]) => re.test(column));
    if (!hit || seen.has(hit[1])) continue;
    seen.add(hit[1]);
    lines.push([column, hit[1]]);
  }
  if (rows.some((r) => typeof r[0] === 'string' && /^jami/i.test(r[0]))) lines.push(['Jami', "Jami qatori = ustundagi qiymatlar yig'indisi (foizlar — jami summalardan qayta hisoblanadi)"]);
  if (lines.length === 0) return [];
  return [[], ['Hisob-kitob (ustunlar qanday hisoblangan)'], ...lines, ["Har bir son bo'yicha to'liq ishlanish — saytda raqamni bosing («Qanday hisoblandi?»)."]];
}

/**
 * CSV yuklab olish. Oxiriga «Hisob-kitob» bo'limi qo'shiladi: ustunlar formulasi
 * (workings berilsa — o'shalar, aks holda ustun nomlaridan avtomatik).
 */
export function downloadCsv(fileName: string, header: string[], rows: (string | number | null)[][], workings?: string[][]): void {
  // Avval tushunarli Excel (.xlsx: jadval, tushuntirish, ma'lumot); server javob bermasa — CSV
  const name = fileName.replace(/\.csv$/i, '');
  const work = workings ?? csvWorkings(header, rows).filter((r) => r.length && !(r.length === 1 && /^Hisob-kitob/.test(String(r[0]))));
  void exportXlsx({ fileName: name, header, rows, workings: work }).catch(() => saveCsv(fileName, header, rows, workings));
}

/** Eski usul — CSV (Excel'da ochiladi); Excel eksport ishlamasa */
function saveCsv(fileName: string, header: string[], rows: (string | number | null)[][], workings?: string[][]): void {
  const escape = (value: string | number | null) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const tail = workings ? (workings.length ? [[], ['Hisob-kitob'], ...workings] : []) : csvWorkings(header, rows);
  // Excel (ru/uz lokal) uchun ";" ajratgich va BOM
  const body = [header, ...rows, ...tail].map((row) => row.map(escape).join(';')).join('\r\n');
  const blob = new Blob([String.fromCharCode(0xfeff) + body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** CSV uchun summa: so'mda, butun son (Excel raqam sifatida o'qiydi) */
export function csvSom(tiyin: string | number): number {
  return Math.round(Number(tiyin) / 100);
}

/** CSV uchun foiz: "12,5" */
export function csvPct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '' : value.toFixed(1).replace('.', ',');
}