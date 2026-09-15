/**
 * Sana va davrlar bilan ishlash.
 *
 * Qoida: bazada sanalar UTC'da saqlanadi, ekranda Toshkent vaqtida
 * ko'rsatiladi. O'zbekiston UTC+5, yozgi vaqtga o'tish yo'q —
 * shuning uchun siljish doim o'zgarmas.
 */

const TASHKENT_OFFSET_HOURS = 5;

/** Davr identifikatori: "2026-09" */
export type PeriodKey = string;

export interface Period {
  key: PeriodKey;
  year: number;
  month: number; // 1-12
  label: string; // "Sentabr 2026"
  start: Date; // UTC
  end: Date; // UTC, oyning oxirgi lahzasi
}

export const MONTH_NAMES = [
  'Yanvar',
  'Fevral',
  'Mart',
  'Aprel',
  'May',
  'Iyun',
  'Iyul',
  'Avgust',
  'Sentabr',
  'Oktabr',
  'Noyabr',
  'Dekabr',
] as const;

export const MONTH_NAMES_SHORT = [
  'Yan',
  'Fev',
  'Mar',
  'Apr',
  'May',
  'Iyn',
  'Iyl',
  'Avg',
  'Sen',
  'Okt',
  'Noy',
  'Dek',
] as const;

export const WEEKDAY_NAMES = [
  'Yakshanba',
  'Dushanba',
  'Seshanba',
  'Chorshanba',
  'Payshanba',
  'Juma',
  'Shanba',
] as const;

// ─────────── Toshkent vaqti ───────────

/** UTC sanadan Toshkent vaqtidagi qismlarni ajratadi */
function tashkentParts(date: Date): { year: number; month: number; day: number } {
  const shifted = new Date(date.getTime() + TASHKENT_OFFSET_HOURS * 3600_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Toshkent vaqtidagi kun boshini UTC sifatida qaytaradi */
export function tashkentDayStart(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, -TASHKENT_OFFSET_HOURS, 0, 0, 0));
}

/** Hozirgi vaqt Toshkent bo'yicha */
export function nowInTashkent(): { year: number; month: number; day: number } {
  return tashkentParts(new Date());
}

// ─────────── Davrlar ───────────

/** "2026-09" ko'rinishidagi kalit yasaydi */
export function periodKey(year: number, month: number): PeriodKey {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** Kalitni yil va oyga ajratadi */
export function parsePeriodKey(key: PeriodKey): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  return { year, month };
}

/** To'liq davr obyektini quradi */
export function buildPeriod(year: number, month: number): Period {
  const start = tashkentDayStart(year, month, 1);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const end = new Date(tashkentDayStart(nextYear, nextMonth, 1).getTime() - 1);

  return {
    key: periodKey(year, month),
    year,
    month,
    label: `${MONTH_NAMES[month - 1]} ${year}`,
    start,
    end,
  };
}

/** Sanadan davrni aniqlaydi */
export function periodFromDate(date: Date): Period {
  const { year, month } = tashkentParts(date);
  return buildPeriod(year, month);
}

/** Joriy davr */
export function currentPeriod(): Period {
  const { year, month } = nowInTashkent();
  return buildPeriod(year, month);
}

/** Oldingi davr — solishtirish uchun */
export function previousPeriod(period: Period): Period {
  return period.month === 1
    ? buildPeriod(period.year - 1, 12)
    : buildPeriod(period.year, period.month - 1);
}

/** O'tgan yilning shu oyi — mavsumiylikni hisobga olgan solishtirish */
export function samePeriodLastYear(period: Period): Period {
  return buildPeriod(period.year - 1, period.month);
}

/** Keyingi davr */
export function nextPeriod(period: Period): Period {
  return period.month === 12
    ? buildPeriod(period.year + 1, 1)
    : buildPeriod(period.year, period.month + 1);
}

/**
 * Oxirgi N ta davr — grafiklarda dinamika ko'rsatish uchun.
 * Eng eskisidan eng yangisiga tartiblangan.
 */
export function lastPeriods(count: number, from: Period = currentPeriod()): Period[] {
  const result: Period[] = [];
  let cursor = from;

  for (let i = 0; i < count; i += 1) {
    result.unshift(cursor);
    cursor = previousPeriod(cursor);
  }

  return result;
}

/** Ikki davr orasidagi barcha davrlar */
export function periodRange(from: Period, to: Period): Period[] {
  const result: Period[] = [];
  let cursor = from;
  let guard = 0;

  while (cursor.key <= to.key && guard < 600) {
    result.push(cursor);
    cursor = nextPeriod(cursor);
    guard += 1;
  }

  return result;
}

/** Yilning boshidan hozirgi davrgacha */
export function yearToDate(period: Period = currentPeriod()): Period[] {
  return periodRange(buildPeriod(period.year, 1), period);
}

// ─────────── Formatlash ───────────

/** "10.09.2026" */
export function formatDate(date: Date): string {
  const { year, month, day } = tashkentParts(date);
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

/** "10 sentabr 2026" */
export function formatDateLong(date: Date): string {
  const { year, month, day } = tashkentParts(date);
  return `${day} ${MONTH_NAMES[month - 1]?.toLowerCase()} ${year}`;
}

/** "10.09.2026, 14:30" */
export function formatDateTime(date: Date): string {
  const shifted = new Date(date.getTime() + TASHKENT_OFFSET_HOURS * 3600_000);
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(date)}, ${hours}:${minutes}`;
}

/** HTML input[type=date] uchun: "2026-09-10" */
export function toInputDate(date: Date): string {
  const { year, month, day } = tashkentParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** input[type=date] qiymatidan UTC sanaga */
export function fromInputDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return tashkentDayStart(year, month, day);
}

// ─────────── Parsing (Excel importi uchun) ───────────

/** Excel serial raqamini sanaga o'giradi (1900 tizimi) */
function fromExcelSerial(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 100_000) return null;

  // Excel'da 1900-yil noto'g'ri kabisa yil deb hisoblanadi — 59 dan keyin 1 kun siljish
  const adjusted = serial > 59 ? serial - 1 : serial;
  const base = Date.UTC(1900, 0, 1);
  const ms = base + (adjusted - 1) * 86_400_000;

  const date = new Date(ms);
  const { year, month, day } = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };

  return tashkentDayStart(year, month, day);
}

/**
 * Turli formatdagi sanalarni o'qiydi.
 * Qo'llab-quvvatlanadi:
 *   "10.09.2026", "10/09/2026", "10-09-2026"
 *   "2026-09-10"
 *   45910 (Excel serial)
 *   Date obyekti
 */
export function parseDate(input: unknown): Date | null {
  if (input === null || input === undefined || input === '') return null;

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }

  if (typeof input === 'number') {
    return fromExcelSerial(input);
  }

  if (typeof input !== 'string') return null;

  const text = input.trim();
  if (text === '') return null;

  // ISO: 2026-09-10
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return tashkentDayStart(year, month, day);
    }
    return null;
  }

  // Kun.Oy.Yil — O'zbekistonda asosiy format
  const dmy = /^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{2,4})/.exec(text);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    let year = Number(dmy[3]);

    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return tashkentDayStart(year, month, day);
    }
    return null;
  }

  // Faqat raqamlardan iborat matn — Excel serial bo'lishi mumkin
  if (/^\d+([.,]\d+)?$/.test(text)) {
    return fromExcelSerial(Number(text.replace(',', '.')));
  }

  return null;
}

/** Matndan davrni o'qiydi: "09.2026", "2026-09", "Sentabr 2026" */
export function parsePeriod(input: string): Period | null {
  const text = input.trim();

  const iso = parsePeriodKey(text);
  if (iso) return buildPeriod(iso.year, iso.month);

  const my = /^(\d{1,2})[.\/\-](\d{4})$/.exec(text);
  if (my) {
    const month = Number(my[1]);
    const year = Number(my[2]);
    if (month >= 1 && month <= 12) return buildPeriod(year, month);
    return null;
  }

  const named = /^([a-zA-Zа-яА-ЯёЁ\u02BB\u2018']+)\s+(\d{4})$/.exec(text);
  if (named) {
    const name = named[1]?.toLowerCase() ?? '';
    const year = Number(named[2]);
    const index = MONTH_NAMES.findIndex((m) => m.toLowerCase() === name);
    if (index >= 0) return buildPeriod(year, index + 1);
  }

  return null;
}
