import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Hisobotlar › Choraklik ijro (biznes-reja): reja fayli, qatorlarni belgilash, fakt, hisobot, Excel.
// Pul — млн.сўм.
// ═══════════════════════════════════════════════════════════

export type Mode = 'quarter' | 'ytd';
export type SourceKind = 'INCOME' | 'EXPENSE' | 'PAYROLL' | 'HEADCOUNT' | 'MANUAL';
export type Area = 'center' | 'regions' | 'all';

export interface LineSource {
  kind: SourceKind;
  categories?: string[];
  area?: Area;
  departments?: string[];
}

export interface BplanMap {
  lines: Record<string, LineSource>;
  incomeGroups: Record<string, number>;
  groupMap: string[];
  saved?: boolean;
}

export interface FactLine {
  key: string;
  section: string;
  name: string;
  kind: 'in' | 'out' | 'count' | 'balance';
  derived?: boolean;
}

export interface FactCell {
  auto: (number | null)[];
  manual: (number | null)[];
  final: (number | null)[];
}

export interface Overview {
  year: number;
  years: number[];
  plan: { fileName: string; uploadedAt: string; size: number } | null;
  lines: FactLine[];
  groups: string[];
  regions: string[];
  uoCodes: { code: string; name: string }[];
  map: BplanMap;
  cells: Record<string, FactCell>;
  regionCells: { auto: number[][][]; manual: Record<string, number>; final: number[][][] };
  notes: Record<string, string>;
  unmatchedRegions: string[];
  checks: { text: string; a: number; b: number }[];
  sources: {
    incomeCategories: { code: string; label: string; active: boolean }[];
    expenseCategories: { code: string; label: string; parentCode: string | null; active: boolean }[];
    departments: { id: string; name: string }[];
  };
}

export interface ExecRow {
  code: string;
  name: string;
  level: 0 | 1 | 2;
  sign: 1 | -1;
  prior: number | null;
  annual: number | null;
  plan: number | null;
  fact: number | null;
}

export interface RegionRow {
  name: string;
  prior: number;
  annual: number;
  plan: number;
  fact: number;
  groups: (number | null)[];
}

export interface KpiRow {
  name: string;
  weight: string;
  unit: string;
  periods: { target: number | null; fact: number | null }[];
}

export interface Execution {
  quarter: number;
  mode: Mode;
  periodLabel: string;
  f2: ExecRow[];
  detail: ExecRow[];
  services: ExecRow[];
  regions: RegionRow[];
  regionTotal: RegionRow;
  taxes: ExecRow[];
  payroll: ExecRow[];
  headcount: ExecRow[];
  profit: ExecRow[];
  sponsorship: ExecRow[];
  kpi: KpiRow[];
  summary: { revenuePlan: number; revenueFact: number; profitPlan: number; profitFact: number; costPlan: number; costFact: number };
}

export interface ManualPayload {
  lines: Record<string, (number | null)[]>;
  regions: Record<string, number>;
}

export const bplanApi = {
  overview: (year: number) => api.get<ApiResponse<Overview>>('/bplan', { params: { year } }),
  report: (year: number, quarter: number, mode: Mode) => api.get<ApiResponse<Execution>>('/bplan/report', { params: { year, quarter, mode } }),
  suggest: () => api.get<ApiResponse<BplanMap>>('/bplan/map/suggest'),
  saveMap: (map: BplanMap) => api.patch<ApiResponse<BplanMap>>('/bplan/map', map),
  saveManual: (year: number, manual: ManualPayload) => api.patch<ApiResponse<ManualPayload>>(`/bplan/manual?year=${year}`, manual),
  removePlan: (year: number) => api.delete<ApiResponse<Overview>>(`/bplan/plan?year=${year}`),
};

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

/** Biznes-reja faylini yuklash (1–6-иловалар) */
export async function uploadPlan(year: number, file: File): Promise<Overview> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}/bplan/plan?year=${year}`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, "Faylni yuklab bo'lmadi"));
  return ((await response.json()) as ApiResponse<Overview>).data;
}

/** To'liq formulali Excel */
export async function downloadExcel(year: number, quarter: number, mode: Mode): Promise<void> {
  const response = await fetch(`${BASE}/bplan/excel?year=${year}&quarter=${quarter}&mode=${mode}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await readError(response, "Excel'ni tayyorlab bo'lmadi"));
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const name = star ? decodeURIComponent(star[1]!) : `Choraklik ijro ${year}.xlsx`;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** 1 234,5 */
export function mln(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (Math.abs(v) < 0.05 && digits <= 1) return '–';
  const s = Math.abs(v)
    .toFixed(digits)
    .replace('.', ',')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return v < 0 ? `−${s}` : s;
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1).replace('.', ',')}%`;
}

/** Bajarilish rangi: daromadda ≥100% yaxshi, xarajatda ≤100% yaxshi */
export function tone(ratio: number | null, sign: 1 | -1): 'good' | 'warn' | 'bad' | 'none' {
  if (ratio === null || !Number.isFinite(ratio)) return 'none';
  if (sign === 1) return ratio >= 1 ? 'good' : ratio >= 0.9 ? 'warn' : 'bad';
  return ratio <= 1 ? 'good' : ratio <= 1.1 ? 'warn' : 'bad';
}

export const AREA_LABEL: Record<Area, string> = { center: 'Markaz', regions: 'Hududlar', all: 'Hammasi' };
export const KIND_LABEL: Record<SourceKind, string> = {
  MANUAL: "Qo'lda",
  INCOME: 'Daromad moddalari',
  EXPENSE: 'Xarajat moddalari',
  PAYROLL: 'Ish haqi vedomosti',
  HEADCOUNT: 'Xodimlar soni (vedomost)',
};