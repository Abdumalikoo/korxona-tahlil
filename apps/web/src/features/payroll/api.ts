import { api, getToken, type ApiResponse } from '@/lib/api';

export type BatchStatus = 'DRAFT' | 'COMMITTED' | 'CANCELLED';

export interface PayrollGroup {
  label: string;
  departmentId: string | null;
  regionCode: number | null;
  count: number;
  zeroCount: number;
  totalTiyin: string;
}

export interface MissingRow {
  rowIndex: number;
  pinfl: string;
}

export interface InvalidRow {
  rowIndex: number;
  reason: string;
}

export interface ZeroEmployee {
  pinfl: string;
  fullName: string;
  place: string;
}

export interface PayrollRow {
  pinfl: string;
  amountTiyin: string;
}

/** Fayl tahlili — bazaga hali hech narsa yozilmagan */
export interface AnalyzeResult {
  period: string;
  fileName: string;
  totalRows: number;
  matchedRows: number;
  paidRows: number;
  zeroRows: number;
  missingRows: number;
  invalidRows: InvalidRow[];
  missing: MissingRow[];
  duplicates: string[];
  zeroEmployees: ZeroEmployee[];
  totalTiyin: string;
  hasPrevious: boolean;
  previousCount: number;
  groups: PayrollGroup[];
  rows: PayrollRow[];
}

export interface CommitResult {
  success: true;
  batchId: string;
  expensesCreated: number;
  employees: number;
  zeroCount: number;
  totalTiyin: string;
  replacedPrevious: boolean;
}

export interface PayrollBatch {
  id: string;
  period: string;
  status: BatchStatus;
  fileName: string;
  totalRows: number;
  matchedRows: number;
  missingRows: number;
  totalTiyin: string;
  createdAt: string;
  committedAt: string | null;
  uploadedBy: { id: string; fullName: string };
  _count?: { entries: number };
}

export interface PayrollEntryRow {
  id: string;
  employeePinfl: string;
  totalTiyin: string;
  employee: {
    pinfl: string;
    fullName: string;
    regionCode: number;
    employmentType: string;
    region: { name: string };
    department: { name: string } | null;
  };
}

export interface PayrollBatchDetail extends PayrollBatch {
  missingPinfls: MissingRow[];
  entries: PayrollEntryRow[];
}

/** Xarajat ortidagi xodimlar */
export interface ExpenseDetailEntry {
  id: string;
  totalTiyin: string;
  employee: {
    pinfl: string;
    fullName: string;
    position: string | null;
    regionCode: number;
    districtId: string | null;
    district: { id: string; code: number; name: string } | null;
    department: { name: string } | null;
  };
}

export interface ExpenseDetailGroup {
  key: string;
  label: string;
  count: number;
  totalTiyin: string;
}

export interface ExpenseDetail {
  isPayroll: boolean;
  isCentral?: boolean;
  groups: ExpenseDetailGroup[];
  entries: ExpenseDetailEntry[];
  count?: number;
  totalTiyin?: string;
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Server xato xabarini o'qiydi */
async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: { message?: string | string[] } };
    const raw = parsed.error?.message;
    return Array.isArray(raw) ? (raw[0] ?? fallback) : (raw ?? fallback);
  } catch {
    return fallback;
  }
}

/** Javobdagi faylni brauzerga yuklab beradi */
async function saveFile(response: Response, fallbackName: string): Promise<void> {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

export async function downloadTemplate(period: string): Promise<void> {
  const response = await fetch(`${BASE}/payroll/template?period=${period}`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readError(response, 'Shablonni yuklab bo\u2018lmadi'));
  }

  await saveFile(response, `Ish-haqi-${period}.xlsx`);
}

/** Faylni tahlil qiladi — hali hech narsa saqlanmaydi */
export async function analyzeFile(period: string, file: File): Promise<AnalyzeResult> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE}/payroll/analyze?period=${period}`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await readError(response, 'Faylni tahlil qilib bo\u2018lmadi'));
  }

  const result = (await response.json()) as ApiResponse<AnalyzeResult>;
  return result.data;
}

/** Topilmagan PINFL larni Excel faylga yuklab oladi */
export async function downloadMissing(period: string, missing: MissingRow[]): Promise<void> {
  const response = await fetch(`${BASE}/payroll/missing/export`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ period, missing }),
  });

  if (!response.ok) {
    throw new Error(await readError(response, 'Faylni yuklab bo\u2018lmadi'));
  }

  await saveFile(response, `Topilmaganlar-${period}.xlsx`);
}

export const payrollApi = {
  /** Tahlil natijasini saqlaydi */
  commit: (
    period: string,
    payload: { rows: PayrollRow[]; fileName: string; missing: MissingRow[] },
    replace = false,
  ) =>
    api.post<ApiResponse<CommitResult>>(
      `/payroll/commit?period=${period}&replace=${replace}`,
      payload,
    ),

  /** Tasdiqlangan yuklashni bekor qiladi */
  cancel: (batchId: string) =>
    api.post<ApiResponse<{ success: true }>>(`/payroll/${batchId}/cancel`),

  batches: (period?: string) =>
    api.get<ApiResponse<PayrollBatch[]>>('/payroll/batches', { params: { period } }),

  batch: (batchId: string) =>
    api.get<ApiResponse<PayrollBatchDetail>>(`/payroll/batches/${batchId}`),

  expenseDetail: (expenseId: string) =>
    api.get<ApiResponse<ExpenseDetail>>(`/payroll/expense/${expenseId}`),
};
