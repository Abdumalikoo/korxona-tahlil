import { api, getToken, type ApiResponse } from '@/lib/api';

// KPI baholash — /api/kpi/* (backend kpi.templates.ts / kpi.service.ts bilan bir xil turlar)

export type KpiKind = 'BONUS' | 'PENALTY';

export type KpiCriterion = {
  id: string;
  no: number;
  kind: KpiKind;
  title: string;
  max: number;
  method: string;
} & (
  | { type: 'LEVEL'; levels: { id: string; label: string; points: number }[] }
  | { type: 'FLAG'; label: string }
  | { type: 'PER_CASE'; perCase: number; cap: number | null }
  | { type: 'COUNT_LEVELS'; steps: { min: number; points: number }[] }
  | { type: 'COUNT_TIERS'; tiers: { id: string; label: string; points: number }[]; cap: number }
);

export interface KpiTemplate {
  key: string;
  department: string;
  title: string;
  source: string;
  criteria: KpiCriterion[];
}

export interface KpiPick {
  level?: string;
  on?: boolean;
  count?: number;
  counts?: Record<string, number>;
}

export interface KpiEvaluation {
  picks: Record<string, KpiPick>;
  points: Record<string, number>;
  bonus: number;
  penalty: number;
  total: number;
  savedAt: string;
  savedBy: string;
}

export interface KpiSheet {
  key: string;
  department: string;
  period: string;
  submittedAt: string | null;
  submittedBy: string | null;
  canEdit: boolean;
  employees: { pinfl: string; fullName: string; position: string | null; evaluation: KpiEvaluation | null }[];
}

export interface KpiMe {
  template: KpiTemplate | null;
  templates: { key: string; department: string }[];
  canEdit: boolean;
  isHead: boolean;
}

export interface KpiSummary {
  from: string;
  to: string;
  months: string[];
  departments: {
    key: string;
    department: string;
    criteria: { id: string; no: number; kind: KpiKind; title: string; max: number }[];
    months: { period: string; submittedAt: string | null; submittedBy: string | null; count: number }[];
    employees: { pinfl: string; fullName: string; position: string | null; average: number | null; months: Record<string, { bonus: number; penalty: number; total: number; submitted: boolean; points: Record<string, number> }> }[];
  }[];
}

export interface KpiHeads {
  users: { id: string; fullName: string; loginCode: string | null; isActive: boolean; template: string | null }[];
  templates: { key: string; department: string }[];
}

const params = (b?: string | null) => (b ? { b } : {});

export const kpiApi = {
  me: (b?: string | null) => api.get<ApiResponse<KpiMe>>('/kpi/me', { params: params(b) }),
  sheet: (period: string, b?: string | null) => api.get<ApiResponse<KpiSheet>>('/kpi/sheet', { params: { period, ...params(b) } }),
  save: (body: { b?: string | null; period: string; pinfl: string; picks: Record<string, KpiPick> }) => api.put<ApiResponse<{ evaluation: KpiEvaluation | null }>>('/kpi/eval', { ...body, b: body.b ?? undefined }),
  submit: (period: string, b?: string | null) => api.post<ApiResponse<{ submitted: number }>>('/kpi/submit', { period, b: b ?? undefined }),
  reopen: (period: string, b: string) => api.post<ApiResponse<{ reopened: boolean }>>('/kpi/reopen', { period, b }),
  summary: (from: string, to: string) => api.get<ApiResponse<KpiSummary>>('/kpi/summary', { params: { from, to } }),
  heads: () => api.get<ApiResponse<KpiHeads>>('/kpi/heads'),
  setHead: (userId: string, b: string | null) => api.put<ApiResponse<{ saved: boolean }>>('/kpi/heads', { userId, b }),
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/** Yig'ma KPI hisobotini yuklab olish */
export async function downloadKpi(from: string, to: string, format: 'xlsx' | 'pdf'): Promise<void> {
  const token = getToken();
  const response = await fetch(`${BASE}/kpi/export?from=${from}&to=${to}&format=${format}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' });
  if (!response.ok) throw new Error("Hisobotni yuklab bo'lmadi");
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)/.exec(disposition) ?? /filename="([^"]+)"/.exec(disposition);
  const name = m ? decodeURIComponent(m[1]!) : `yigma-kpi.${format}`;
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Rollar › KPI: bo'lim dashbordi */
export interface KpiOverview {
  key: string;
  department: string;
  title: string;
  source: string;
  year: string;
  now: string;
  employees: number;
  current: { period: string; count: number; submittedAt: string | null; average: number | null };
  heads: { id: string; fullName: string; loginCode: string | null; isActive: boolean; mustChangePin: boolean; lastLoginAt: string | null; locked: boolean }[];
  months: { period: string; count: number; average: number | null; submittedAt: string | null; submittedBy: string | null }[];
  last: { period: string; top: { pinfl: string; fullName: string; total: number; bonus: number; penalty: number }[]; bottom: { pinfl: string; fullName: string; total: number; bonus: number; penalty: number }[] } | null;
  activity: { period: string; pinfl: string; fullName: string; total: number; savedAt: string; savedBy: string }[];
  alerts: { tone: 'red' | 'amber'; text: string }[];
  criteria: { id: string; no: number; kind: KpiKind; title: string; max: number }[];
}

export const kpiOverviewApi = {
  get: (b: string, year?: string) => api.get<ApiResponse<KpiOverview>>('/kpi/overview', { params: { b, ...(year ? { year } : {}) } }),
};

/** Administrator rol ish stoliga KPI bo'limi bilan kirganda — qaysi bo'lim (sessiya davomida) */
export const ACTING_KPI_KEY = 'acting-kpi';
