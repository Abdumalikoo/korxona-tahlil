import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › 23106 — xodimlarga to'lovlar ko'chirmasi: /api/acc-23106/…
// ═══════════════════════════════════════════════════════════

export type PayoutKind = 'BAYRAM' | 'MUKOFOT' | 'SAFAR' | 'MODDIY' | 'TATIL' | 'KASALLIK' | 'ISH_HAQI' | 'BOSHQA';
export type ControlState = 'OK' | 'OVER' | 'NOT_IN_TARKIB' | 'NO_TARKIB' | 'NA';

export interface PayoutRow {
  no: string;
  docDate: string;
  procDate: string | null;
  docNo: string;
  accountName: string;
  inn: string;
  mfo: string;
  debitTiyin: string;
  purpose: string;
  kind: PayoutKind;
  kindLabel: string;
  orderDate: string | null;
  orderNo: string | null;
  accrual: string;
  commentName: string | null;
  pinfl: string | null;
  fullName: string | null;
  matchBy: 'PINFL' | 'NAME' | null;
  inSoliq: boolean;
  tarkibTiyin: string | null;
  paidGroupTiyin: string;
  control: ControlState;
}

export interface PayoutSummary {
  count: number;
  totalTiyin: string;
  people: number;
  byKind: { kind: PayoutKind; label: string; count: number; totalTiyin: string }[];
  matched: { pinfl: number; name: number; none: number };
  control: { ok: number; over: number; notInTarkib: number; noTarkib: number; na: number };
}

export interface PayoutAnalysis {
  fileName: string;
  sheetName: string;
  months: { period: string; label: string; count: number; totalTiyin: string; saved: { fileName: string; savedAt: string; count: number } | null }[];
  rows: PayoutRow[];
  invalid: { rowIndex: number; reason: string }[];
  inflow: { count: number; totalTiyin: string };
  summary: PayoutSummary;
}

export interface PayoutView {
  from: string;
  to: string;
  months: { period: string; label: string; saved: { fileName: string; savedAt: string; uploadedBy: string; count: number } | null }[];
  rows: PayoutRow[];
  summary: PayoutSummary;
}

export interface PayoutBatch {
  id: string;
  fileName: string;
  createdAt: string;
  uploadedBy: string;
  months: string[];
  rows: number;
  totalTiyin: string;
  status: 'COMMITTED' | 'CANCELLED';
  cancelledAt: string | null;
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: { message?: string | string[] }; message?: string | string[] };
    const raw = parsed.error?.message ?? parsed.message;
    return Array.isArray(raw) ? (raw[0] ?? fallback) : (raw ?? fallback);
  } catch {
    return fallback;
  }
}

export const acc23106Api = {
  view: (from: string, to: string) => api.get<ApiResponse<PayoutView>>('/acc-23106/view', { params: { from, to } }),
  batches: () => api.get<ApiResponse<PayoutBatch[]>>('/acc-23106/batches'),
  commit: (body: { fileName: string; months: string[]; rows: PayoutRow[] }) => api.post<ApiResponse<{ success: true; batchId: string; months: string[]; saved: number; replacedMonths: number; totalTiyin: string }>>('/acc-23106/commit', body),
  cancel: (id: string) => api.post<ApiResponse<{ success: true; months: string[] }>>(`/acc-23106/batches/${encodeURIComponent(id)}/cancel`),
};

export async function downloadAcc23106Template(): Promise<void> {
  const response = await fetch(`${BASE}/acc-23106/template`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await readError(response, "Shablonni yuklab bo'lmadi"));
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = '23106-kochirma-shablon.xlsx';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function analyzeAcc23106(file: File): Promise<PayoutAnalysis> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}/acc-23106/analyze`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, "Faylni tahlil qilib bo'lmadi"));
  return ((await response.json()) as ApiResponse<PayoutAnalysis>).data;
}