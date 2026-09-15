import { Decimal } from 'decimal.js';

/**
 * Pul bilan ishlashning yagona to'g'ri yo'li.
 * Hech qachon `number` bilan summa hisoblanmasin.
 *
 * Bazada pul TIYIN'da (butun son) saqlanadi:
 *   1 000 000 so'm → 100 000 000 tiyin
 * Sabab: butun son bilan ishlashda yaxlitlash xatosi umuman bo'lmaydi.
 */

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

/** 1 so'm = 100 tiyin */
const TIYIN_PER_SUM = 100;

export type MoneyInput = string | number | Decimal | bigint;

/** Istalgan kirishni Decimal'ga o'giradi */
export function toDecimal(value: MoneyInput): Decimal {
  if (value instanceof Decimal) return value;
  if (typeof value === 'bigint') return new Decimal(value.toString());
  return new Decimal(value);
}

// ─────────── Konvertatsiya ───────────

/** So'mni tiyinga (bazada saqlash uchun) */
export function sumToTiyin(sum: MoneyInput): bigint {
  const value = toDecimal(sum).times(TIYIN_PER_SUM).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return BigInt(value.toFixed(0));
}

/** Tiyinni so'mga (ko'rsatish va hisoblash uchun) */
export function tiyinToSum(tiyin: bigint | number | string): Decimal {
  return new Decimal(tiyin.toString()).dividedBy(TIYIN_PER_SUM);
}

// ─────────── Arifmetika ───────────

/** Summalar yig'indisi */
export function sumAll(values: MoneyInput[]): Decimal {
  return values.reduce<Decimal>((total, value) => total.plus(toDecimal(value)), new Decimal(0));
}

/** Tiyin qiymatlarining yig'indisi */
export function sumTiyin(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

/** Ayirma */
export function subtract(a: MoneyInput, b: MoneyInput): Decimal {
  return toDecimal(a).minus(toDecimal(b));
}

/** Ko'paytirish */
export function multiply(value: MoneyInput, factor: MoneyInput): Decimal {
  return toDecimal(value).times(toDecimal(factor));
}

/** Bo'lish — nolga bo'lishdan himoyalangan */
export function divide(value: MoneyInput, divisor: MoneyInput): Decimal | null {
  const d = toDecimal(divisor);
  if (d.isZero()) return null;
  return toDecimal(value).dividedBy(d);
}

// ─────────── Foiz va o'zgarish ───────────

/** Qismning butunga nisbatan foizi */
export function percentOf(part: MoneyInput, total: MoneyInput): Decimal | null {
  const t = toDecimal(total);
  if (t.isZero()) return null;
  return toDecimal(part).dividedBy(t).times(100);
}

/**
 * Ikki davr orasidagi o'zgarish foizi.
 * Oldingi qiymat nol bo'lsa null — "cheksiz o'sish" ko'rsatilmasligi kerak.
 */
export function changePercent(current: MoneyInput, previous: MoneyInput): Decimal | null {
  const prev = toDecimal(previous);
  if (prev.isZero()) return null;
  return toDecimal(current).minus(prev).dividedBy(prev.abs()).times(100);
}

/** Mutlaq o'zgarish */
export function changeAbsolute(current: MoneyInput, previous: MoneyInput): Decimal {
  return toDecimal(current).minus(toDecimal(previous));
}

// ─────────── Taqsimlash ───────────

/**
 * Summani ulushlar bo'yicha taqsimlaydi.
 * Yaxlitlash qoldig'i eng katta ulushga qo'shiladi,
 * shunda qismlar yig'indisi doim butunga teng bo'ladi.
 *
 * Umumiy xarajatlarni bo'limlarga taqsimlashda ishlatiladi.
 */
export function allocate(totalTiyin: bigint, weights: number[]): bigint[] {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  if (totalWeight <= 0 || weights.length === 0) {
    return weights.map(() => 0n);
  }

  const total = new Decimal(totalTiyin.toString());
  const parts: bigint[] = [];
  let distributed = 0n;

  for (const weight of weights) {
    const share = total
      .times(weight)
      .dividedBy(totalWeight)
      .toDecimalPlaces(0, Decimal.ROUND_DOWN);
    const value = BigInt(share.toFixed(0));
    parts.push(value);
    distributed += value;
  }

  // Qoldiqni eng katta ulushga qo'shamiz
  const remainder = totalTiyin - distributed;
  if (remainder !== 0n) {
    let maxIndex = 0;
    for (let i = 1; i < weights.length; i += 1) {
      if ((weights[i] ?? 0) > (weights[maxIndex] ?? 0)) maxIndex = i;
    }
    parts[maxIndex] = (parts[maxIndex] ?? 0n) + remainder;
  }

  return parts;
}

// ─────────── Formatlash ───────────

/**
 * Pulni o'zbekcha formatda ko'rsatadi.
 * 1234567.89 → "1 234 567,89"
 */
export function formatMoney(
  value: MoneyInput,
  options: { decimals?: number; withCurrency?: boolean } = {},
): string {
  const { decimals = 0, withCurrency = false } = options;

  const fixed = toDecimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toFixed(decimals);
  const [intPart = '0', fracPart] = fixed.split('.');

  const negative = intPart.startsWith('-');
  const digits = negative ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');

  let result = (negative ? '-' : '') + grouped;
  if (fracPart) result += `,${fracPart}`;
  if (withCurrency) result += ' so\u2018m';

  return result;
}

/** Tiyindan to'g'ridan-to'g'ri formatlash */
export function formatTiyin(
  tiyin: bigint | number | string,
  options?: { decimals?: number; withCurrency?: boolean },
): string {
  return formatMoney(tiyinToSum(tiyin), options);
}

/**
 * Katta summalarni qisqartiradi — dashboard kartochkalari uchun.
 * 1 250 000 000 → "1,25 mlrd"
 */
export function formatCompact(value: MoneyInput): string {
  const d = toDecimal(value);
  const abs = d.abs();

  if (abs.gte(1_000_000_000)) {
    return `${formatMoney(d.dividedBy(1_000_000_000), { decimals: 2 })} mlrd`;
  }
  if (abs.gte(1_000_000)) {
    return `${formatMoney(d.dividedBy(1_000_000), { decimals: 1 })} mln`;
  }
  if (abs.gte(1_000)) {
    return `${formatMoney(d.dividedBy(1_000), { decimals: 1 })} ming`;
  }
  return formatMoney(d);
}

/** Foizni formatlash: 12.345 → "+12,3%" */
export function formatPercent(
  value: Decimal | number | null,
  options: { decimals?: number; withSign?: boolean } = {},
): string {
  if (value === null) return '—';

  const { decimals = 1, withSign = false } = options;
  const d = toDecimal(value);
  const formatted = formatMoney(d, { decimals });
  const sign = withSign && d.gt(0) ? '+' : '';

  return `${sign}${formatted}%`;
}

// ─────────── Parsing ───────────

/**
 * Foydalanuvchi kiritgan yoki Excel'dan kelgan matnni songa o'giradi.
 * Qo'llab-quvvatlanadi: "1 250 000", "1.250.000", "1,250,000.50",
 * "1 250 000,50", "1250000 so'm", "(5000)" — manfiy
 */
export function parseMoney(input: string | number | null | undefined): Decimal | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) ? new Decimal(input) : null;
  }

  let text = input.trim();
  if (text === '' || text === '-') return null;

  // Qavs ichidagi son — manfiy (buxgalteriya formati)
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }

  // Valyuta belgilari va bo'shliqlarni olib tashlaymiz
  text = text
    .replace(/so\u2018m|so'm|сум|сўм|uzs|UZS/gi, '')
    .replace(/[\s\u00A0\u202F]/g, '')
    .trim();

  if (text === '') return null;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  if (lastComma > -1 && lastDot > -1) {
    // Ikkalasi bor — oxirgisi kasr ajratuvchi
    if (lastComma > lastDot) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const after = text.length - lastComma - 1;
    // "1,50" → kasr; "1,250" yoki "1,250,000" → guruh ajratuvchi
    text = after <= 2 && text.split(',').length === 2 ? text.replace(',', '.') : text.replace(/,/g, '');
  } else if (lastDot > -1) {
    const after = text.length - lastDot - 1;
    if (after === 3 && text.split('.').length > 2) {
      text = text.replace(/\./g, '');
    } else if (after === 3 && /^\d{1,3}\.\d{3}$/.test(text)) {
      text = text.replace('.', '');
    }
  }

  if (!/^\d*\.?\d*$/.test(text) || text === '' || text === '.') return null;

  try {
    const result = new Decimal(text);
    return negative ? result.negated() : result;
  } catch {
    return null;
  }
}

/** Matnni to'g'ridan-to'g'ri tiyinga */
export function parseMoneyToTiyin(input: string | number | null | undefined): bigint | null {
  const parsed = parseMoney(input);
  return parsed === null ? null : sumToTiyin(parsed);
}
