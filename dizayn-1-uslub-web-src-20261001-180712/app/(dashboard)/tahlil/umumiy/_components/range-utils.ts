import type { DateRange } from '@/components/shared/date-range-picker';

const DAY_MS = 86_400_000;

function toMs(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Oraliqdagi kunlar soni — ikki chekka ham kiradi */
export function rangeDays(range: DateRange): number {
  return Math.round((toMs(range.to) - toMs(range.from)) / DAY_MS) + 1;
}

/**
 * Tanlangan oraliqqa teng uzunlikdagi oldingi davr.
 * 01.04 — 30.06 tanlansa, 01.01 — 31.03 qaytadi.
 */
export function previousRange(range: DateRange): DateRange {
  const days = rangeDays(range);
  const prevTo = toMs(range.from) - DAY_MS;
  const prevFrom = prevTo - (days - 1) * DAY_MS;

  return { from: toIso(prevFrom), to: toIso(prevTo) };
}

/** "2026-09-18" → "2026-09" */
export function periodOf(iso: string): string {
  return iso.slice(0, 7);
}

/** Nol bazada null — "cheksiz o'sish" ko'rsatilmasligi uchun */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
