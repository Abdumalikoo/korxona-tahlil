import { Decimal } from 'decimal.js';

/**
 * Frontend tomonda pul formatlash.
 *
 * Backend summalarni TIYIN da, satr korinishida yuboradi
 * (BigInt JSON da satrga aylanadi). Bu yerda ular somga
 * ogirilib, ozbekcha formatda korsatiladi.
 */

const TIYIN_PER_SUM = 100;

export type TiyinInput = string | number | bigint;

/** Tiyinni somga ogiradi */
export function tiyinToSum(tiyin: TiyinInput): Decimal {
  return new Decimal(tiyin.toString()).dividedBy(TIYIN_PER_SUM);
}

/** Somni tiyinga - formadan yuborishdan oldin */
export function sumToTiyin(sum: Decimal | number | string): number {
  return new Decimal(sum).times(TIYIN_PER_SUM).toDecimalPlaces(0).toNumber();
}

/**
 * Pulni korsatish uchun formatlaydi.
 * 1250000 -> "1 250 000"
 */
export function formatSum(
  value: Decimal | number | string,
  options: { decimals?: number; currency?: boolean } = {},
): string {
  const { decimals = 0, currency = false } = options;

  const fixed = new Decimal(value).toDecimalPlaces(decimals).toFixed(decimals);
  const [intPart = '0', fracPart] = fixed.split('.');

  const negative = intPart.startsWith('-');
  const digits = negative ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');

  let result = (negative ? '-' : '') + grouped;
  if (fracPart) result += `,${fracPart}`;
  if (currency) result += '\u00A0som';

  return result;
}

/** Tiyindan togridan-togri */
export function formatTiyin(
  tiyin: TiyinInput,
  options?: { decimals?: number; currency?: boolean },
): string {
  return formatSum(tiyinToSum(tiyin), options);
}

/**
 * Katta summalarni qisqartiradi - kartochkalar uchun.
 * 1 250 000 000 -> "1,25 mlrd"
 */
export function formatCompact(tiyin: TiyinInput): string {
  const sum = tiyinToSum(tiyin);
  const abs = sum.abs();

  if (abs.gte(1_000_000_000)) {
    return `${formatSum(sum.dividedBy(1_000_000_000), { decimals: 2 })} mlrd`;
  }
  if (abs.gte(1_000_000)) {
    return `${formatSum(sum.dividedBy(1_000_000), { decimals: 1 })} mln`;
  }
  if (abs.gte(1_000)) {
    return `${formatSum(sum.dividedBy(1_000), { decimals: 0 })} ming`;
  }
  return formatSum(sum);
}

/**
 * Foizni formatlaydi.
 * null -> "-"  (hisoblab bolmaydigan holat)
 */
export function formatPercent(
  value: number | null | undefined,
  options: { decimals?: number; sign?: boolean } = {},
): string {
  if (value === null || value === undefined) return '-';

  const { decimals = 1, sign = false } = options;
  const prefix = sign && value > 0 ? '+' : '';

  return `${prefix}${value.toFixed(decimals).replace('.', ',')}%`;
}

/**
 * Foydalanuvchi kiritgan matnni songa ogiradi.
 * "1 250 000", "1250000,50", "1.250.000" - hammasi ishlaydi.
 */
export function parseSum(input: string): Decimal | null {
  if (!input.trim()) return null;

  let text = input.trim();

  let negative = false;
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }

  text = text
    .replace(/som|sum|сум/gi, '')
    .replace(/[\s\u00A0\u202F]/g, '');

  if (!text) return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    text = lastComma > lastDot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  } else if (lastComma > -1) {
    const after = text.length - lastComma - 1;
    text = after <= 2 && text.split(',').length === 2
      ? text.replace(',', '.')
      : text.replace(/,/g, '');
  } else if (lastDot > -1) {
    const after = text.length - lastDot - 1;
    if (after === 3) text = text.replace(/\./g, '');
  }

  if (!/^\d*\.?\d*$/.test(text) || text === '' || text === '.') return null;

  try {
    const result = new Decimal(text);
    return negative ? result.negated() : result;
  } catch {
    return null;
  }
}

// --------- Sana ---------

const MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
] as const;

const TASHKENT_OFFSET_MS = 5 * 3600_000;

function tashkentParts(input: string | Date) {
  const date = typeof input === 'string' ? new Date(input) : input;
  const shifted = new Date(date.getTime() + TASHKENT_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

/** "10.09.2026" */
export function formatDate(input: string | Date): string {
  const { year, month, day } = tashkentParts(input);
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

/** "10 sentabr 2026" */
export function formatDateLong(input: string | Date): string {
  const { year, month, day } = tashkentParts(input);
  return `${day} ${MONTHS[month - 1]?.toLowerCase()} ${year}`;
}

/** "10.09.2026, 14:30" */
export function formatDateTime(input: string | Date): string {
  const { hours, minutes } = tashkentParts(input);
  return `${formatDate(input)}, ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** "2026-09" -> "Sentabr 2026" */
export function formatPeriod(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;

  const year = match[1];
  const month = Number(match[2]);
  return `${MONTHS[month - 1] ?? month} ${year}`;
}

/** "2026-09" -> "Sen 26" - grafik oqlari uchun */
export function formatPeriodShort(period: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;

  const short = ['Yan','Fev','Mar','Apr','May','Iyn','Iyl','Avg','Sen','Okt','Noy','Dek'];
  const month = Number(match[2]);
  return `${short[month - 1] ?? month} ${match[1]?.slice(2)}`;
}

/** Joriy davr: "2026-09" */
export function currentPeriod(): string {
  const now = new Date(Date.now() + TASHKENT_OFFSET_MS);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** input[type=date] uchun bugungi sana */
export function todayInput(): string {
  const now = new Date(Date.now() + TASHKENT_OFFSET_MS);
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Davrni siljitadi: shiftPeriod("2026-09", -1) -> "2026-08" */
export function shiftPeriod(period: string, delta: number): string {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return period;

  let year = Number(match[1]);
  let month = Number(match[2]) + delta;

  while (month <= 0) { month += 12; year -= 1; }
  while (month > 12) { month -= 12; year += 1; }

  return `${year}-${String(month).padStart(2, '0')}`;
}
