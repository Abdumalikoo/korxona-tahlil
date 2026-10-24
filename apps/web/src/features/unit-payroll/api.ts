import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Yo'nalish ish haqi (Tax free …): /api/unit-payroll/:unit/…
// ═══════════════════════════════════════════════════════════

export interface UnitStaff {
  pinfl: string;
  fullName: string;
  position: string | null;
  active: boolean;
  addedAt: string;
  source: 'UPLOAD' | 'MANUAL';
  leftAt: string | null;
  /** Umumiy xodimlar bazasida ham bor */
  inRegistry: boolean;
}

export interface UnitStaffList {
  unit: string;
  label: string;
  active: number;
  total: number;
  items: UnitStaff[];
}

export interface StaffLookup {
  pinfl: string;
  inStaff: boolean;
  active: boolean;
  fullName: string | null;
  position: string | null;
  inRegistry: boolean;
}

/** KNOWN — ro'yxatda; RETURNING — ketgan edi, qaytadi; REGISTRY — yangi (ismi bazadan); NEW — yangi (ism kerak) */
export type UnitRowStatus = 'KNOWN' | 'RETURNING' | 'REGISTRY' | 'NEW';

export interface UnitAnalyzeRow {
  rowIndex: number;
  pinfl: string;
  fullName: string | null;
  position: string | null;
  amountTiyin: string;
  status: UnitRowStatus;
}

export interface UnitAnalyzeResult {
  unit: string;
  label: string;
  period: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  zeroRows: number;
  knownRows: number;
  newRows: number;
  returningRows: number;
  unnamedRows: number;
  totalTiyin: string;
  invalidRows: { rowIndex: number; reason: string }[];
  duplicates: string[];
  notInFile: { pinfl: string; fullName: string }[];
  hasPrevious: boolean;
  previousCount: number;
  previousTiyin: string;
  rows: UnitAnalyzeRow[];
}

export interface UnitCommitResult {
  success: true;
  batchId: string;
  expenseCreated: boolean;
  employees: number;
  zeroCount: number;
  totalTiyin: string;
  newStaff: number;
  returned: number;
  replacedPrevious: boolean;
}

export interface UnitBatch {
  id: string;
  period: string;
  fileName: string;
  status: 'COMMITTED' | 'CANCELLED';
  createdAt: string;
  cancelledAt: string | null;
  uploadedBy: string;
  totalTiyin: string;
  count: number;
  zeroCount: number;
  newStaff: number;
  expenseId: string | null;
  rowsCount: number;
}

export interface UnitBatchDetail extends Omit<UnitBatch, 'rowsCount'> {
  rows: { pinfl: string; fullName: string; amountTiyin: string }[];
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

const enc = encodeURIComponent;

export const unitPayrollApi = {
  staff: (unit: string) => api.get<ApiResponse<UnitStaffList>>(`/unit-payroll/${enc(unit)}/staff`),
  lookup: (unit: string, pinfl: string) => api.get<ApiResponse<StaffLookup>>(`/unit-payroll/${enc(unit)}/lookup/${enc(pinfl)}`),
  addStaff: (unit: string, body: { pinfl: string; fullName?: string; position?: string }) =>
    api.post<ApiResponse<UnitStaffList>>(`/unit-payroll/${enc(unit)}/staff`, body),
  updateStaff: (unit: string, pinfl: string, body: { active?: boolean; fullName?: string; position?: string | null }) =>
    api.patch<ApiResponse<UnitStaffList>>(`/unit-payroll/${enc(unit)}/staff/${enc(pinfl)}`, body),
  commit: (unit: string, period: string, body: { rows: { pinfl: string; amountTiyin: string; fullName?: string | null }[]; fileName: string }, replace: boolean) =>
    api.post<ApiResponse<UnitCommitResult>>(`/unit-payroll/${enc(unit)}/commit?period=${enc(period)}&replace=${replace ? 'true' : 'false'}`, body),
  batches: (unit: string, period: string) => api.get<ApiResponse<UnitBatch[]>>(`/unit-payroll/${enc(unit)}/batches?period=${enc(period)}`),
  batch: (unit: string, period: string, id: string) => api.get<ApiResponse<UnitBatchDetail>>(`/unit-payroll/${enc(unit)}/batches/${enc(id)}?period=${enc(period)}`),
  cancel: (unit: string, period: string, id: string) =>
    api.post<ApiResponse<{ success: true; id: string }>>(`/unit-payroll/${enc(unit)}/batches/${enc(id)}/cancel?period=${enc(period)}`),
};

/** Shablon: 1-varaq — PINFL, Summa; 2-varaq — faqat shu bo'lim xodimlari */
export async function downloadUnitTemplate(unit: string, period: string): Promise<void> {
  const response = await fetch(`${BASE}/unit-payroll/${enc(unit)}/template?period=${enc(period)}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await readError(response, "Shablonni yuklab bo'lmadi"));
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : `Ish-haqi-${unit}-${period}.xlsx`;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Faylni tahlil qiladi — hali hech narsa saqlanmaydi */
export async function analyzeUnitFile(unit: string, period: string, file: File): Promise<UnitAnalyzeResult> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}/unit-payroll/${enc(unit)}/analyze?period=${enc(period)}`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, "Faylni tahlil qilib bo'lmadi"));
  return ((await response.json()) as ApiResponse<UnitAnalyzeResult>).data;
}