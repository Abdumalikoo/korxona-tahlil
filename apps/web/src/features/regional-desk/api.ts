import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Hududchi ish joyi — server bilan aloqa (pul: tiyin matn ko'rinishida)
// ═══════════════════════════════════════════════════════════

export interface RdLookups {
  regions: { code: number; name: string }[];
  districts: { id: string; regionCode: number; code: number; name: string }[];
  categories: { code: string; label: string; group: string | null }[];
}

export interface RdMonth {
  period: string;
  label: string;
  incomeTiyin: string;
  incomeRows: number;
  incomeAt: string | null;
  payrollTiyin: string;
  payrollUploaded: boolean;
  payrollEmployees: number;
  otherTiyin: string;
  otherCount: number;
}

export interface RdRegion {
  regionCode: number;
  name: string;
  incomeTiyin: string;
  quantity: number;
  payrollTiyin: string;
  otherTiyin: string;
  netTiyin: string;
  ytdIncomeTiyin: string;
  ytdExpenseTiyin: string;
}

export interface RdOverview {
  period: string;
  periodLabel: string;
  months: RdMonth[];
  regions: RdRegion[];
  current: RdMonth;
}

export interface RdIncomeRow {
  regionCode: number;
  regionName: string;
  districtId: string | null;
  districtName: string | null;
  categoryCode: string;
  categoryLabel: string;
  quantity: number | null;
  amountTiyin: string;
}

export interface RdIncomeAnalysis {
  fileName: string;
  range: { from: string; to: string } | null;
  period: string;
  periodLabel: string;
  mode: 'MONTH' | 'CUMULATIVE';
  previousMonths: string[];
  missingMonths: string[];
  blocked: boolean;
  fileTiyin: string;
  beforeTiyin: string;
  monthTiyin: string;
  existingCount: number;
  existingTiyin: string;
  regions: { regionCode: number; name: string; fileTiyin: string; beforeTiyin: string; monthTiyin: string; quantity: number }[];
  negatives: { regionName: string; categoryLabel: string; fileTiyin: string; storedTiyin: string }[];
  newServices: string[];
  unknownServices: { sheet: string; rowIndex: number; label: string }[];
  unknownPlaces: { sheet: string; rowIndex: number; value: string }[];
  unknownHeaders: string[];
  invalidCells: { sheet: string; rowIndex: number; region: string }[];
  rows: RdIncomeRow[];
}

export interface RdPayrollAnalysis {
  period: string;
  periodLabel: string;
  fileName: string;
  totalRows: number;
  matchedRows: number;
  missingRows: number;
  missing: { rowIndex: number; pinfl: string }[];
  invalidRows: { rowIndex: number; reason: string }[];
  duplicates: string[];
  zeroRows: number;
  central: { pinfl: string; fullName: string; amountTiyin: string }[];
  general: { pinfl: string; fullName: string; amountTiyin: string }[];
  totalTiyin: string;
  previous: { id: string; totalTiyin: string; employees: number; committedAt: string | null }[];
  regions: { regionCode: number; name: string; count: number; zero: number; totalTiyin: string }[];
  rows: { pinfl: string; amountTiyin: string }[];
}

export interface RdBatch {
  id: string;
  period: string;
  status: 'COMMITTED' | 'CANCELLED' | 'DRAFT';
  fileName: string;
  employees: number;
  missing: number;
  totalTiyin: string;
  committedAt: string | null;
  by: string | null;
}

export interface RdExpense {
  id: string;
  date: string;
  period: string;
  amountTiyin: string;
  categoryCode: string;
  categoryLabel: string;
  regionCode: number;
  regionName: string | null;
  districtId: string | null;
  districtName: string | null;
  description: string | null;
  counterparty: string | null;
  documentNo: string | null;
  paymentMethod: string;
  recurrence: 'RECURRING' | 'ONE_TIME' | null;
  createdAt: string;
  by: string | null;
}

export interface RdExpenseInput {
  date: string;
  regionCode: number;
  districtId: string | null;
  categoryCode: string;
  amountTiyin: string;
  description: string | null;
  counterparty: string | null;
  documentNo: string | null;
  paymentMethod: string;
  recurrence: 'RECURRING' | 'ONE_TIME' | null;
}

export const rdApi = {
  lookups: () => api.get<ApiResponse<RdLookups>>('/regional-desk/lookups'),
  overview: (period: string) => api.get<ApiResponse<RdOverview>>('/regional-desk/overview', { params: { period } }),
  commitIncome: (period: string, rows: RdIncomeRow[], fileName: string) => api.post<ApiResponse<{ created: number; totalTiyin: string; period: string }>>('/regional-desk/income/commit', { period, rows, fileName }),
  createServices: (labels: string[]) => api.post<ApiResponse<{ created: { code: string; label: string }[] }>>('/regional-desk/income/services', { labels }),
  batches: (period?: string) => api.get<ApiResponse<RdBatch[]>>('/regional-desk/payroll/batches', { params: { period } }),
  commitPayroll: (a: RdPayrollAnalysis) => api.post<ApiResponse<{ employees: number; totalTiyin: string; replacedPrevious: boolean }>>('/regional-desk/payroll/commit', { period: a.period, rows: a.rows, fileName: a.fileName, missing: a.missing }),
  cancelPayroll: (id: string) => api.post<ApiResponse<{ success: true }>>(`/regional-desk/payroll/${id}/cancel`),
  expenses: (period: string, region?: number | null) => api.get<ApiResponse<RdExpense[]>>('/regional-desk/expenses', { params: { period, region: region ?? undefined } }),
  createExpense: (input: RdExpenseInput) => api.post<ApiResponse<RdExpense>>('/regional-desk/expenses', input),
  updateExpense: (id: string, input: RdExpenseInput) => api.patch<ApiResponse<RdExpense>>(`/regional-desk/expenses/${id}`, input),
  deleteExpense: (id: string) => api.delete<ApiResponse<{ ok: true }>>(`/regional-desk/expenses/${id}`),
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

async function upload<T>(path: string, file: File): Promise<T> {
  const token = getToken();
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  if (!response.ok) throw new Error(await failMessage(response, "Faylni o'qib bo'lmadi"));
  return ((await response.json()) as ApiResponse<T>).data;
}

export const analyzeIncomeFile = (file: File, period?: string) => upload<RdIncomeAnalysis>(`/regional-desk/income/analyze${period ? `?period=${period}` : ''}`, file);
export const analyzePayrollFile = (file: File, period: string) => upload<RdPayrollAnalysis>(`/regional-desk/payroll/analyze?period=${period}`, file);

/** Daromad uchun bo'sh shablon (manba tizimdagi «Xizmatlar bo'yicha hisobot» tuzilmasida) */
export async function downloadIncomeTemplate(period: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`${BASE}/regional-desk/income/template?period=${period}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(await failMessage(response, "Shablonni yuklab bo'lmadi"));
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] ? decodeURIComponent(match[1]) : `service_report_${period}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function downloadPayrollTemplate(period: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`${BASE}/regional-desk/payroll/template?period=${period}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(await failMessage(response, "Shablonni yuklab bo'lmadi"));
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = `Hudud-ish-haqi-${period}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
export const monthLabel = (p: string) => `${MONTHS[Number(p.slice(5)) - 1] ?? p} ${p.slice(0, 4)}`;
export const dmy = (d: string) => d.split('-').reverse().join('.');
export function shiftMonth(p: string, delta: number): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}