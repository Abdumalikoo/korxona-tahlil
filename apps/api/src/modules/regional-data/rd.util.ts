import { BadRequestException } from '@nestjs/common';

// Hududchi ma'lumot asosi — umumiy yordamchilar (sana, oy, pul)

export { CENTRAL_REGION } from '../../common/segments/segments';
export const TASHKENT_OFFSET_HOURS = 5;
export const MAX_TIYIN = 9_000_000_000_000_000n;

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

export function monthName(p: string): string {
  return `${MONTHS[Number(p.slice(5)) - 1] ?? p} ${p.slice(0, 4)}`;
}

export function assertPeriod(period: unknown): string {
  const p = String(period ?? '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw new BadRequestException("Oy ko'rinishi: YYYY-MM");
  return p;
}

export function todayTashkent(): string {
  return new Date(Date.now() + TASHKENT_OFFSET_HOURS * 3600_000).toISOString().slice(0, 10);
}

export function currentPeriod(): string {
  return todayTashkent().slice(0, 7);
}

export function shiftPeriod(p: string, delta: number): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** "2026-09-15" → Date (00:00 UTC) — @db.Date maydonlari uchun */
export function parseDay(raw: unknown, label = 'Sana'): Date {
  const s = String(raw ?? '').trim();
  const d = new Date(`${s}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new BadRequestException(`${label} noto'g'ri (YYYY-MM-DD)`);
  return d;
}

export function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Oy boshi va oxiri (Toshkent kuni, @db.Date bilan solishtirish uchun) */
export function periodDays(p: string): { first: Date; last: Date } {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return { first: new Date(Date.UTC(y, m - 1, 1)), last: new Date(Date.UTC(y, m, 0)) };
}

/** Tiyin matn/son → BigInt (manfiy emas) */
export function parseTiyin(raw: unknown, label: string, allowZero = false): bigint {
  let v: bigint;
  try {
    const s = typeof raw === 'number' ? String(Math.round(raw)) : String(raw ?? '').trim();
    if (!/^\d+$/.test(s)) throw new Error();
    v = BigInt(s);
  } catch {
    throw new BadRequestException(`${label}: summa noto'g'ri`);
  }
  if (!allowZero && v <= 0n) throw new BadRequestException(`${label}: summa noldan katta bo'lsin`);
  if (v > MAX_TIYIN) throw new BadRequestException(`${label}: summa juda katta`);
  return v;
}

export function cleanText(raw: unknown, max: number, label = 'Matn'): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/\s+/g, ' ');
  if (!s) return null;
  if (s.length > max) throw new BadRequestException(`${label} juda uzun (ko'pi bilan ${max} belgi)`);
  return s;
}

/** Excel katagi qiymati (formula natijasi, boy matn) */
export function cellRaw(value: unknown): unknown {
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('result' in v) return v.result;
    if ('text' in v) return v.text;
    if ('richText' in v && Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((t) => t.text).join('');
    if (value instanceof Date) return value;
  }
  return value;
}

export function cellText(value: unknown): string {
  const r = cellRaw(value);
  if (r === null || r === undefined) return '';
  if (r instanceof Date) return ymd(r);
  return String(r).trim();
}

/** So'mdagi son (Excel) → tiyin; bo'sh → null; xato → undefined */
export function somToTiyin(value: unknown): bigint | null | undefined {
  const r = cellRaw(value);
  if (r === null || r === undefined || String(r).trim() === '') return null;
  const n = typeof r === 'number' ? r : Number(String(r).replace(/[\s  ]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return undefined;
  return BigInt(Math.round(n * 100));
}

/** Excel sanasi (Date, "2026-09-01", "01.09.2026") → "YYYY-MM-DD" yoki null */
export function excelDate(value: unknown): string | null {
  const r = cellRaw(value);
  if (r instanceof Date) return ymd(r);
  const s = String(r ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  if (typeof r === 'number' && r > 20000 && r < 80000) return ymd(new Date(Math.round((r - 25569) * 86_400_000)));
  return null;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}