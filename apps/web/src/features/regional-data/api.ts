import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Hududchi: ma'lumot asosi — sifat, oyni yopish, voqealar, tariflar, shtat-maosh, xarajat rejasi
// ═══════════════════════════════════════════════════════════

export type CheckLevel = 'ok' | 'warn' | 'error' | 'info';

export interface QualityItem {
  key: string;
  level: CheckLevel;
  title: string;
  detail: string | null;
  list: string[];
  href: string | null;
}

export interface QualityResult {
  period: string;
  periodLabel: string;
  closed: boolean;
  errors: number;
  warnings: number;
  items: QualityItem[];
}

export interface CloseRow {
  period: string;
  label: string;
  status: 'OPEN' | 'CLOSED';
  closedAt: string | null;
  closedBy: string | null;
  reopenedAt: string | null;
  reopenedBy: string | null;
  reopenReason: string | null;
  warnings: number | null;
  note: string | null;
}

export interface EventRow {
  id: string;
  date: string;
  kind: string;
  kindLabel: string;
  regionCode: number | null;
  regionName: string;
  categoryCode: string | null;
  categoryLabel: string;
  title: string;
  description: string | null;
  isBreak: boolean;
  by: string | null;
  createdAt: string;
}

export interface EventInput {
  date: string;
  kind: string;
  regionCode: number | null;
  categoryCode: string | null;
  title: string;
  description: string | null;
  isBreak: boolean;
}

export interface TariffView {
  id: string;
  categoryCode: string;
  regionCode: number | null;
  regionName: string;
  priceTiyin: string;
  validFrom: string;
  status: 'PROPOSED' | 'APPROVED' | 'REJECTED';
  note: string | null;
  by: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface TariffService {
  code: string;
  label: string;
  current: TariffView | null;
  pending: TariffView[];
  history: TariffView[];
  actual: { period: string; priceTiyin: string; quantity: number } | null;
}

export interface StaffRow {
  pinfl: string;
  fullName: string;
  regionCode: number;
  regionName: string;
  position: string | null;
  employmentType: string;
  rate: number | null;
  baseSalaryTiyin: string | null;
  effectiveFrom: string | null;
  upcoming: { effectiveFrom: string; rate: number; baseSalaryTiyin: string } | null;
  changes: number;
}

export interface StaffList {
  employees: StaffRow[];
  total: number;
  filled: number;
  fte: number;
}

export interface SalaryHistory {
  pinfl: string;
  fullName: string;
  items: { id: string; effectiveFrom: string; rate: number; baseSalaryTiyin: string; position: string | null; note: string | null; source: string; createdAt: string }[];
}

export interface StaffImportRow {
  rowIndex: number;
  pinfl: string;
  fullName: string;
  effectiveFrom: string;
  rate: number;
  baseSalaryTiyin: string;
  position: string | null;
  change: 'NEW' | 'UPDATE' | 'SAME';
}

export interface StaffImport {
  fileName: string;
  rows: StaffImportRow[];
  changed: number;
  errors: { rowIndex: number; reason: string }[];
  notRegional: { rowIndex: number; pinfl: string }[];
}

export interface BudgetGrid {
  period: string;
  periodLabel: string;
  regionCode: number;
  regionName: string;
  rows: { code: string; label: string; group: string | null; planTiyin: string | null; factTiyin: string }[];
  totalPlanTiyin: string;
  totalFactTiyin: string;
}

export const rdData = {
  quality: (period: string) => api.get<ApiResponse<QualityResult>>('/regional-data/quality', { params: { period } }),
  closes: (year?: string) => api.get<ApiResponse<CloseRow[]>>('/regional-data/closes', { params: { year } }),
  close: (period: string, note: string | null) => api.post<ApiResponse<{ ok: true }>>(`/regional-data/closes/${period}/close`, { note }),
  reopen: (period: string, reason: string) => api.post<ApiResponse<{ ok: true }>>(`/regional-data/closes/${period}/reopen`, { reason }),
  events: () => api.get<ApiResponse<{ kinds: Record<string, string>; items: EventRow[] }>>('/regional-data/events'),
  createEvent: (input: EventInput) => api.post<ApiResponse<EventRow>>('/regional-data/events', input),
  updateEvent: (id: string, input: EventInput) => api.patch<ApiResponse<EventRow>>(`/regional-data/events/${id}`, input),
  deleteEvent: (id: string) => api.delete<ApiResponse<{ ok: true }>>(`/regional-data/events/${id}`),
  tariffs: () => api.get<ApiResponse<TariffService[]>>('/regional-data/tariffs'),
  proposeTariff: (input: { categoryCode: string; regionCode: number | null; priceTiyin: string; validFrom: string; note: string | null }) => api.post<ApiResponse<{ id: string }>>('/regional-data/tariffs', input),
  decideTariff: (id: string, approve: boolean) => api.post<ApiResponse<{ ok: true }>>(`/regional-data/tariffs/${id}/decide`, { approve }),
  deleteTariff: (id: string) => api.delete<ApiResponse<{ ok: true }>>(`/regional-data/tariffs/${id}`),
  staff: () => api.get<ApiResponse<StaffList>>('/regional-data/staff'),
  staffHistory: (pinfl: string) => api.get<ApiResponse<SalaryHistory>>(`/regional-data/staff/${pinfl}`),
  staffAdd: (pinfl: string, input: { effectiveFrom: string; rate: number; baseSalaryTiyin: string; position: string | null; note: string | null }) => api.post<ApiResponse<SalaryHistory>>(`/regional-data/staff/${pinfl}`, input),
  staffRemove: (id: string) => api.delete<ApiResponse<SalaryHistory>>(`/regional-data/staff/salary/${id}`),
  staffCommit: (rows: StaffImportRow[]) => api.post<ApiResponse<{ saved: number }>>('/regional-data/staff/import/commit', { rows }),
  budget: (period: string, region: number) => api.get<ApiResponse<BudgetGrid>>('/regional-data/budget', { params: { period, region } }),
  budgetSave: (period: string, regionCode: number, items: { categoryCode: string; amountTiyin: string | null }[]) => api.post<ApiResponse<BudgetGrid>>('/regional-data/budget', { period, regionCode, items }),
  budgetCopy: (period: string, regionCode: number) => api.post<ApiResponse<BudgetGrid>>('/regional-data/budget/copy', { period, regionCode }),
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

export async function download(path: string, fallbackName: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(await failMessage(response, "Faylni yuklab bo'lmadi"));
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const token = getToken();
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  if (!response.ok) throw new Error(await failMessage(response, "Faylni o'qib bo'lmadi"));
  return ((await response.json()) as ApiResponse<T>).data;
}