import type { Cell, Column, ColumnFormat, Tone } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Yagona ko'rinish: raqamlar, sanalar, ranglar — uchala format uchun
// ═══════════════════════════════════════════════════════════

export const PALETTE = {
  navy: '1B3354',
  navy2: '2D527F',
  ink: '111827',
  text: '374151',
  muted: '6B7280',
  faint: '9CA3AF',
  line: 'E5E7EB',
  panel: 'F6F7F9',
  green: '2F7A57',
  greenSoft: 'E3F1E9',
  red: 'B3423B',
  redSoft: 'F6E1DF',
  amber: 'B45309',
  amberSoft: 'FEF3C7',
  slate: '94A3B8',
  expenseBar: 'C9837D',
  /** Toifalar uchun ketma-ket ranglar (to'q ko'kdan ochgacha) */
  ramp: ['1B3354', '2D527F', '4C74A4', '7A9BC2', 'AFC3DC', 'C7D5E7'],
};

export const TONE_COLOR: Record<Tone, string> = {
  good: PALETTE.green,
  bad: PALETTE.red,
  warn: PALETTE.amber,
  neutral: PALETTE.ink,
};

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const MONTHS_SHORT = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];

/** "2026-09" → "sentabr 2026" */
export function periodLabel(period: string): string {
  return `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
}

/** "2026-09" → "Sen 26" */
export function periodShort(period: string): string {
  return `${MONTHS_SHORT[Number(period.slice(5, 7)) - 1]} ${period.slice(2, 4)}`;
}

/** "2026-09-30" → "30.09.2026" */
export function uzDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** Guruhlangan son: 1 234 567 (oddiy bo'shliq — barcha shriftlarda bor) */
export function grouped(value: number, digits = 0): string {
  const fixed = Math.abs(value).toFixed(digits);
  const [int, frac] = fixed.split('.');
  const g = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${value < 0 ? '−' : ''}${g}${frac ? `,${frac}` : ''}`;
}

/** Qisqa pul ko'rinishi: "1,25 mlrd so'm" */
export function fmtSom(value: number, withUnit = true): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  const text =
    abs >= 1e12
      ? `${(abs / 1e12).toFixed(2).replace('.', ',')} trln`
      : abs >= 1e9
        ? `${(abs / 1e9).toFixed(2).replace('.', ',')} mlrd`
        : abs >= 1e6
          ? `${(abs / 1e6).toFixed(1).replace('.', ',')} mln`
          : abs >= 1e3
            ? `${Math.round(abs / 1e3)} ming`
            : `${Math.round(abs)}`;
  return `${sign}${text}${withUnit ? " so'm" : ''}`;
}

export function fmtPct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits).replace('.', ',')}%`;
}

export function fmtSignedPct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits).replace('.', ',')}%`;
}

export function signedSom(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmtSom(Math.abs(value))}`;
}

/** O'zgarish foizi; asos nol bo'lsa null */
export function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** Jadval katagi matn ko'rinishida (PDF va slaydlar uchun) */
export function cellText(value: Cell, format: ColumnFormat = 'text'): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  switch (format) {
    case 'money':
      return grouped(value);
    case 'mln':
      return grouped(value / 1e6, 1);
    case 'pct':
      return fmtPct(value);
    case 'signedPct':
      return fmtSignedPct(value);
    case 'int':
      return grouped(value);
    case 'decimal':
      return value.toFixed(2).replace('.', ',');
    case 'decimal3':
      return value.toFixed(3).replace('.', ',');
    default:
      return String(value);
  }
}

/** Excel raqam formati */
export function excelFormat(format: ColumnFormat = 'text'): string | undefined {
  switch (format) {
    case 'money':
    case 'int':
      return '#,##0';
    case 'mln':
      // Qiymat so'mda saqlanadi, ko'rinishi mln so'mda (har bir oxirgi vergul — 1000 ga bo'lish)
      return '#,##0.0,,';
    case 'pct':
      return '0.0"%"';
    case 'signedPct':
      return '+0.0"%";-0.0"%";0.0"%"';
    case 'decimal':
      return '0.00';
    case 'decimal3':
      return '0.000';
    default:
      return undefined;
  }
}

/** O'zgarish rangi */
export function toneOf(value: Cell, by: 'up' | 'down' | 'row' | null | undefined): Tone {
  if (by === 'row') return 'neutral';
  if (!by || typeof value !== 'number' || Math.abs(value) < 0.5) return 'neutral';
  return (value > 0) === (by === 'up') ? 'good' : 'bad';
}

/** Jadval katagi rangi: matn — ustun lug'ati bo'yicha, son — o'zgarish yo'nalishi bo'yicha */
export function cellTone(value: Cell, column: Column | undefined, rowDirection: 'up' | 'down' | null | undefined): Tone {
  if (typeof value === 'string') return column?.tones?.[value] ?? 'neutral';
  return toneOf(value, column?.toneBy === 'row' ? rowDirection : column?.toneBy);
}

export function safeFile(text: string): string {
  return text.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
}