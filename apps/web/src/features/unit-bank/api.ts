import type { StatementChecks } from '@/components/shared/file-check';
import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Yo'nalish bank xarajatlari (bank ko'chirmasi shaklida): /api/unit-bank/:unit/…
// ═══════════════════════════════════════════════════════════

/** Ko'chirma qatori — fayldagidek; description — xarajat izohi (almashtirilgan) */
export interface BankRow {
  no: string;
  docDate: string;
  procDate: string | null;
  docNo: string;
  accountName: string;
  inn: string;
  account: string;
  mfo: string;
  debitTiyin: string;
  creditTiyin: string;
  purpose: string;
  description: string;
}

export interface BankAnalyzeResult {
  unit: string;
  label: string;
  fileName: string;
  sheetName: string;
  months: { period: string; label: string; count: number; totalTiyin: string; saved: { fileName: string; savedAt: string; count: number; totalTiyin: string } | null }[];
  rows: (BankRow & { rowIndex: number; period: string })[];
  invalid: { rowIndex: number; reason: string }[];
  inflow: { count: number; totalTiyin: string };
  renamedRows: number;
  totalTiyin: string;
  /** Fayl tekshiruvi: «Итого» va qoldiq bilan */
  checks?: StatementChecks;
}

export interface BankData {
  unit: string;
  label: string;
  months: { period: string; label: string; saved: { fileName: string; savedAt: string; uploadedBy: string } | null; count: number; totalTiyin: string; rows: BankRow[] }[];
}

export interface BankBatch {
  id: string;
  fileName: string;
  createdAt: string;
  uploadedBy: string;
  months: string[];
  monthLabels: string[];
  liveMonths: string[];
  rows: number;
  totalTiyin: string;
  status: 'COMMITTED' | 'CANCELLED';
  state: 'ACTIVE' | 'PARTIAL' | 'REPLACED' | 'CANCELLED';
}

export interface BankCommitResult {
  success: true;
  batchId: string;
  months: string[];
  expensesCreated: number;
  replacedMonths: number;
  totalTiyin: string;
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const enc = encodeURIComponent;

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

export const unitBankApi = {
  data: (unit: string, from: string, to: string) => api.get<ApiResponse<BankData>>(`/unit-bank/${enc(unit)}/data`, { params: { from, to } }),
  batches: (unit: string) => api.get<ApiResponse<BankBatch[]>>(`/unit-bank/${enc(unit)}/batches`),
  commit: (unit: string, body: { fileName: string; months: string[]; rows: BankRow[] }) => api.post<ApiResponse<BankCommitResult>>(`/unit-bank/${enc(unit)}/commit`, body),
  cancel: (unit: string, id: string) => api.post<ApiResponse<{ success: true; clearedMonths: string[] }>>(`/unit-bank/${enc(unit)}/batches/${enc(id)}/cancel`),
};

/** Shablon — bank ko'chirmasi ustunlari */
export async function downloadBankTemplate(unit: string): Promise<void> {
  const response = await fetch(`${BASE}/unit-bank/${enc(unit)}/template`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await readError(response, "Shablonni yuklab bo'lmadi"));
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : 'Bank-xarajatlari-shablon.xlsx';
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Ko'chirmani tahlil qiladi — hali saqlanmaydi */
export async function analyzeBankFile(unit: string, file: File): Promise<BankAnalyzeResult> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}/unit-bank/${enc(unit)}/analyze`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, "Faylni tahlil qilib bo'lmadi"));
  return ((await response.json()) as ApiResponse<BankAnalyzeResult>).data;
}