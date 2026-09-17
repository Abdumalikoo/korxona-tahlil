import { api, getToken, type ApiResponse } from '@/lib/api';

export type BatchStatus = 'DRAFT' | 'COMMITTED' | 'CANCELLED';

export interface PayrollGroup {
  label: string;
  departmentId: string | null;
  count: number;
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

/** Fayl tahlili natijasi - hali saqlanmagan */
export interface AnalyzeResult {
  batchId: string;
  period: string;
  fileName: string;
  totalRows: number;
  matchedRows: number;
  missingRows: number;
  invalidRows: InvalidRow[];
  missing: MissingRow[];
  totalTiyin: string;
  /** Bu davr uchun oldin tasdiqlangan yuklash bormi */
  hasPrevious: boolean;
  previousBatchId: string | null;
  groups: PayrollGroup[];
}

export interface CommitResult {
  success: true;
  expensesCreated: number;
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

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * Bo'sh shablonni yuklab oladi.
 * Ikkinchi varaqda barcha faol xodimlar ro'yxati bo'ladi.
 */
export async function downloadTemplate(period: string): Promise<void> {
  const token = getToken();

  const response = await fetch(`${BASE}/payroll/template?period=${period}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error('Shablonni yuklab bo\u2018lmadi');
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : `Ish-haqi-${period}.xlsx`;

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

/**
 * Faylni yuklaydi va tahlil qiladi.
 * Natija qaytadi, lekin xarajatlar hali yaratilmaydi.
 */
export async function analyzeFile(
  period: string,
  file: File,
): Promise<AnalyzeResult> {
  const token = getToken();

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE}/payroll/analyze?period=${period}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!response.ok) {
    let message = 'Faylni tahlil qilib bo\u2018lmadi';
    try {
      const parsed = (await response.json()) as {
        error?: { message?: string | string[] };
      };
      const raw = parsed.error?.message;
      message = Array.isArray(raw) ? (raw[0] ?? message) : (raw ?? message);
    } catch {
      // JSON emas
    }
    throw new Error(message);
  }

  const result = (await response.json()) as ApiResponse<AnalyzeResult>;
  return result.data;
}

export const payrollApi = {
  /** replace=true bo'lsa eski yuklash bekor qilinadi */
  commit: (batchId: string, replace = false) =>
    api.post<ApiResponse<CommitResult>>(
      `/payroll/${batchId}/commit?replace=${replace}`,
    ),

  cancel: (batchId: string) =>
    api.post<ApiResponse<{ success: true }>>(`/payroll/${batchId}/cancel`),

  batches: (period?: string) =>
    api.get<ApiResponse<PayrollBatch[]>>('/payroll/batches', {
      params: { period },
    }),

  batch: (batchId: string) =>
    api.get<ApiResponse<PayrollBatchDetail>>(`/payroll/batches/${batchId}`),
};
