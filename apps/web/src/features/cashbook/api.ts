import { api, getToken, type ApiResponse } from '@/lib/api';
import type { CashColumn } from './calc';

// ═══════════════════════════════════════════════════════════
// Buxgalteriya › kunlik tushum va qoldiq — server bilan aloqa.
// Pul — tiyin (matn), ekranda «ming so'm».
// ═══════════════════════════════════════════════════════════

export interface CashAccount {
  id: string;
  key: string;
  code: string | null;
  name: string;
  number: string | null;
  parentId: string | null;
  rollupId: string | null;
  sortOrder: number;
  inputs: string[];
  sums: string[];
  balanceRule: string;
  isHeader: boolean;
  isActive: boolean;
  level: number;
}

export type CashValuesText = Record<CashColumn, string | null>;

export interface CashDay {
  date: string;
  exists: boolean;
  opening: boolean;
  prevDate: string | null;
  nextDate: string | null;
  latestDate: string | null;
  note: string | null;
  savedAt: string | null;
  savedBy: string | null;
  accounts: CashAccount[];
  values: Record<string, CashValuesText>;
}

export interface CashReportRow {
  date: string;
  daily: string | null;
  regions: string | null;
  refund: string | null;
  balance: string | null;
  ytdAfter: string | null;
  mtdAfter: string | null;
  savedBy: string | null;
  updatedAt: string;
}

export interface CashOverview {
  today: string;
  todaySaved: boolean;
  latestDate: string | null;
  reports: number;
  latest: CashReportRow | null;
  series: { date: string; daily: string | null; regions: string | null }[];
  missing: string[];
  sections: { id: string; code: string | null; name: string; daily: string | null; balance: string | null }[];
  regions: { id: string; name: string; daily: string | null; mtdAfter: string | null }[];
}

export interface CashImport {
  date: string | null;
  matched: number;
  unmatched: string[];
  values: Record<string, CashValuesText>;
}

export interface CashAccountInput {
  name?: string;
  code?: string | null;
  number?: string | null;
  parentId?: string | null;
  preset?: 'ACCOUNT' | 'SUB' | 'BALANCE';
  rollup?: boolean;
  balanceRule?: string;
  isActive?: boolean;
}

export type CashLine = { accountId: string } & Partial<Record<CashColumn, string | null>>;

export const cashApi = {
  overview: () => api.get<ApiResponse<CashOverview>>('/cashbook/overview'),
  reports: (from?: string, to?: string) => api.get<ApiResponse<CashReportRow[]>>('/cashbook/reports', { params: { from, to } }),
  day: (date: string) => api.get<ApiResponse<CashDay>>(`/cashbook/day/${date}`),
  save: (date: string, lines: CashLine[], note: string | null) => api.post<ApiResponse<CashDay>>(`/cashbook/day/${date}`, { lines, note }),
  remove: (date: string) => api.delete<ApiResponse<{ ok: true }>>(`/cashbook/day/${date}`),
  accounts: () => api.get<ApiResponse<CashAccount[]>>('/cashbook/accounts'),
  createAccount: (input: CashAccountInput) => api.post<ApiResponse<CashAccount>>('/cashbook/accounts', input),
  updateAccount: (id: string, input: CashAccountInput) => api.patch<ApiResponse<CashAccount>>(`/cashbook/accounts/${id}`, input),
  move: (id: string, dir: 'up' | 'down') => api.post<ApiResponse<CashAccount[]>>(`/cashbook/accounts/${id}/move`, { dir }),
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

async function failMessage(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: { message?: string | string[] } };
    const raw = parsed.error?.message;
    return Array.isArray(raw) ? (raw[0] ?? fallback) : (raw ?? fallback);
  } catch {
    return fallback;
  }
}

/** Kunlik ma'lumotnomani shablon ko'rinishidagi Excel qilib yuklab olish */
export async function downloadCashDay(date: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`${BASE}/cashbook/day/${date}/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(await failMessage(response, "Faylni yuklab bo'lmadi"));
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : `Kunlik tushum ${date}.xlsx`;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** To'ldirilgan shablondan o'qish (saqlanmaydi — ekranga to'ldiriladi) */
export async function importCashFile(file: File): Promise<CashImport> {
  const token = getToken();
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}/cashbook/import`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  if (!response.ok) throw new Error(await failMessage(response, "Faylni o'qib bo'lmadi"));
  return ((await response.json()) as ApiResponse<CashImport>).data;
}

export const COLUMN_LABELS: Record<CashColumn, string> = {
  ytd: 'Yil boshidan',
  mtd: 'Oy boshidan',
  refund: "Qaytarilgan pul mablag'lari",
  daily: 'Kunlik tushum',
  balance: 'Qoldiq',
};

const WEEKDAYS = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];

/** "2026-09-30" → "30.09.2026" */
export function dmy(date: string): string {
  return date.split('-').reverse().join('.');
}

/** "2026-09-30" → "Chorshanba" */
export function weekday(date: string): string {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? '';
}

/** Sanani kunga siljitish */
export function shiftDate(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}