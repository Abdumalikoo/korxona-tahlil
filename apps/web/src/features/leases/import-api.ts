import { api, getToken, type ApiResponse } from '@/lib/api';
import type { LeaseInput } from './api';

// ═══════════════════════════════════════════════════════════
// Ijara — Excel import (backend bilan bir xil turlar)
// ═══════════════════════════════════════════════════════════

export type ImportRowStatus = 'ok' | 'error' | 'exists' | 'duplicate';

export interface ImportLease extends LeaseInput {
  endPeriod: string | null;
  monthlyTiyin: string;
  /** Oylik jadval bo'yicha narx shartlari (har o'zgarish — alohida) */
  terms?: { validFrom: string; monthlyTiyin: string }[];
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
  /** Jadvalda to'ldirilgan oylar soni (0 — jadval yo'q) */
  scheduleMonths: number;
  /** Muddat ichidagi jadval bo'yicha jami */
  scheduleTotalTiyin: string | null;
  lease: ImportLease | null;
}

export interface ImportAnalysis {
  fileName: string;
  total: number;
  ok: number;
  errors: number;
  exists: number;
  duplicates: number;
  totalMonthlyTiyin: string;
  /** Faylda oylik jadval ustunlari: ["2026-01", …] */
  schedulePeriods: string[];
  totalScheduleTiyin: string;
  /** Xarajatga yoziladigan oylar (boshlanishdan joriy oygacha) */
  accruePeriods: string[];
  rows: ImportRow[];
}

export interface AccrueResult {
  periods: string[];
  closedPeriods: string[];
  appendedPeriods: string[];
  expenses: number;
  totalTiyin: string;
}

export interface ImportResult {
  created: number;
  skipped: number;
  accrued: AccrueResult | null;
}

export const IMPORT_STATUS: Record<ImportRowStatus, { label: string; tone: 'income' | 'expense' | 'neutral' | 'warn' }> = {
  ok: { label: 'Yoziladi', tone: 'income' },
  error: { label: 'Xato', tone: 'expense' },
  exists: { label: 'Bazada bor', tone: 'neutral' },
  duplicate: { label: 'Takror', tone: 'warn' },
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: { message?: string | string[] } };
    const raw = parsed.error?.message;
    return Array.isArray(raw) ? (raw[0] ?? fallback) : (raw ?? fallback);
  } catch {
    return fallback;
  }
}

/** Shablon — hududlar, tumanlar va bo'limlar ro'yxati bilan */
export async function downloadLeaseTemplate(): Promise<void> {
  const response = await fetch(`${BASE}/leases/import/template`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await readError(response, 'Shablonni yuklab bo‘lmadi'));

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'ijara-shablon.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Faylni tekshirish — hali hech narsa saqlanmaydi */
export async function analyzeLeaseImport(file: File): Promise<ImportAnalysis> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE}/leases/import/analyze`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!response.ok) throw new Error(await readError(response, 'Faylni tekshirib bo‘lmadi'));

  const result = (await response.json()) as ApiResponse<ImportAnalysis>;
  return result.data;
}

/** Tekshiruvdan o'tgan qatorlarni saqlash; accrue — o'tgan oylar xarajatini ham yozish */
export function commitLeaseImport(rows: ImportLease[], accrue = false) {
  return api.post<ApiResponse<ImportResult>>('/leases/import/commit', { rows, accrue });
}