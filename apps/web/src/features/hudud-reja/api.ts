import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Hudud uchun reja — /api/hudud-reja. Hamma raqamlar backend (Python) hisobidan; bu yerda faqat ko'rsatiladi.
// Pul — so'mda (son).
// ═══════════════════════════════════════════════════════════

export type ImportKind = 'STATS' | 'EMP_MONTHS' | 'EMP_SERVICES' | 'FACTORS' | 'SERVICES';
export type Source = 'merged' | 'system' | 'import';
export type Level = 'error' | 'warning' | 'info';

export interface Issue {
  row: number | null;
  col?: string;
  level: Level;
  message: string;
}

export interface ImportSummary {
  kind: ImportKind;
  sheet: string;
  title: string;
  dataRows: number;
  samples: number;
  valid: number;
  errorRows: number;
  errors: number;
  warnings: number;
  infos: number;
  new: number;
  update: number;
  same: number;
  from: string | null;
  to: string | null;
  regions: number;
  result?: { created: number; updated: number; skipped: number; excluded: number };
}

export interface ImportSession {
  id: string;
  kind: ImportKind;
  fileName: string;
  fileSize: number;
  status: 'CHECKED' | 'IMPORTED' | 'CANCELLED';
  summary: ImportSummary;
  createdAt: string;
  importedAt: string | null;
  issues?: Issue[];
  preview?: { row: number; status: 'new' | 'update' | 'same'; changes: string[]; values: Record<string, unknown> }[];
  createdBy?: string | null;
  importedBy?: string | null;
  policy?: string | null;
}

export interface DataStatusItem {
  rows: number;
  from?: string | null;
  to?: string | null;
  lastImport: { kind: string; importedAt: string; fileName: string } | null;
}
export interface DataStatus {
  STATS: DataStatusItem & { system: { rows: number; from: string | null; to: string | null } };
  EMP_MONTHS: DataStatusItem;
  EMP_SERVICES: DataStatusItem;
  FACTORS: DataStatusItem;
  SERVICES: { rows: number; withTariff: number; lastImport: DataStatusItem['lastImport'] };
}

export interface RunParams {
  targetPeriod: string;
  historyFrom: string;
  historyTo: string;
  regions: number[] | null;
  source: Source;
  backtestMonths: number;
  selection: string;
  roundQuantity: boolean;
  allocation: { method: 'share' | 'perday'; window: number; newEmployees: boolean };
}

export interface RunSummary {
  total: { forecastRev: number; lastRev: number | null; wape: number | null; points: number };
  regions: { code: number; name: string; forecastRev: number; lastRev: number | null; prevRev: number | null; wape: number | null; accuracyPoints: number; employees: number; employeesTotal: number; unallocated: number | null; reliability: Record<string, number> }[];
  models: Record<string, number>;
  employees: number;
  tookMs: number;
}

export interface RunMeta {
  id: string;
  targetPeriod: string;
  params: RunParams;
  status: 'RUNNING' | 'DONE' | 'FAILED';
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  tookMs: number | null;
  dataVersion: string;
  summary: RunSummary | null;
  createdBy?: string | null;
  approvedRegions?: number[];
  reused?: boolean;
  edits?: { region: number; service: string; pinfl: string; amount: number; by?: string; at: string }[];
}

export interface PlanStatus {
  status: 'CALCULATED' | 'APPROVED' | 'APPROVED_OTHER';
  label: string;
  version: number | null;
}

export interface RegionRow {
  code: number;
  name: string;
  lastRev: number | null;
  currentRev: number | null;
  forecastRev: number;
  diff: number | null;
  changePct: number | null;
  models: Record<string, number>;
  mainModel: { key: string; label: string; count: number } | null;
  wape: number | null;
  accuracyPoints: number;
  quality: { key: 'good' | 'partial' | 'low'; label: string };
  monthsReported: number;
  months: number;
  servicesForecast: number;
  servicesNoData: string[];
  employeesTotal: number | null;
  unallocated: number | null;
  plan: PlanStatus;
}

export interface ModelRow {
  model: string;
  label: string;
  points: number;
  candidate: boolean;
  mae: number | null;
  rmse: number | null;
  wape: number | null;
  bias: number | null;
  revMae?: number | null;
  revWape?: number | null;
}

export interface ServiceRow {
  service: string;
  serviceName: string;
  lastQty: number | null;
  forecastQty?: number | null;
  forecastQtyFinal: number | null;
  tariff: number | null;
  tariffSource?: 'catalog' | 'implied' | null;
  tariffNote?: string | null;
  lastRev: number | null;
  forecastRev: number | null;
  diff: number | null;
  model?: string | null;
  modelLabel?: string;
  wape?: number | null;
  revWape?: number | null;
  reliability: string | Record<string, number>;
  reliabilityLabel?: string;
  observations?: number;
  intermittent?: boolean;
  quality?: string;
  interval?: { lo: number; hi: number; level: number } | null;
  reason?: string;
  notes?: string[];
  formulaGap?: { recorded: number; formula: number; diff: number; pct: number | null } | null;
  outliers?: { month: string; value: number; z: number }[];
  regions?: number;
  models?: Record<string, number>;
}

export interface SeriesDetail extends Omit<ServiceRow, 'models' | 'interval' | 'reliability'> {
  region: number;
  regionName: string;
  months: string[];
  targetPeriod: string;
  prevRev: number | null;
  lyRev: number | null;
  history: { qty: (number | null)[]; rev: (number | null)[] };
  models: ModelRow[];
  testPoints: number;
  comparable: boolean;
  params: Record<string, number>;
  reliability: string;
  interval: { lo: number; hi: number; level: number; basis?: string } | null;
  revInterval: { lo: number; hi: number; level: number } | null;
  gaps: number;
  zeroShare: number;
}

export interface EmployeeRow {
  pinfl: string;
  name: string | null;
  position: string | null;
  isNew: boolean;
  manualNeeded: boolean;
  workedDays: number | null;
  workedMonths: number;
  plannedDays: number | null;
  plannedDaysSource: string;
  histRev: number;
  histQty: number | null;
  lastRev: number | null;
  potential: number | null;
  plan: number;
  share: number | null;
  prevPlan: number | null;
  change: number | null;
  changeBase: 'prevPlan' | 'lastRev' | null;
  manual?: boolean;
  services: { service: string; serviceName: string; hist: number | null; share: number; plan: number; manual?: number }[];
  region: number;
  regionName: string;
  planStatus: PlanStatus;
}

export interface EmployeesView {
  region: number | null;
  regions: {
    code: number;
    name: string;
    forecastRev: number;
    method: string;
    methodUsed: string;
    mode: 'service' | 'total';
    window: string[];
    check: { regionForecast: number; employeesTotal: number; unallocated: number; diff: number };
    unallocated: { service: string; serviceName: string; amount: number; reason: string }[];
    notes: string[];
    plan: PlanStatus;
  }[];
  employees: EmployeeRow[];
}

export interface Overview {
  target: string;
  source: Source;
  sourceLabel: string;
  region: number | null;
  lastMonth: string;
  lastActual: number | null;
  history: { period: string; rev: number | null; qty: number | null }[];
  completeness: { have: number; expected: number; pct: number; months: number; regions: number } | null;
  forecast: {
    runId: string;
    createdAt: string;
    params: RunParams;
    dataVersion: string;
    total: number;
    accuracy: { wape: number | null; points: number; months: string[]; actual: number[]; forecast: number[] } | null;
    selectionNote: string;
    regions: { code: number; name: string; forecastRev: number; lastRev: number | null; insufficient: boolean; plan: PlanStatus }[];
    services: { service: string; name: string; forecastRev: number; lastRev: number; insufficient: boolean }[];
    employees: { pinfl: string; name: string; region: string; plan: number }[];
    employeesCount: number;
    unallocated: number;
  } | null;
  run: { id: string; status: string; error: string | null; createdAt: string } | null;
}

export interface QualityItem {
  code: string;
  level: Level;
  title: string;
  count: number;
  items: string[];
  hint?: string;
}

export interface Precheck {
  params: RunParams;
  months: string[];
  regions: { code: number; name: string; monthsReported: number; months: number; activeServices: number; employees: number; employeeServiceRows: number; employeeMonthRows: number }[];
  tariffMissing: string[];
  seriesCount: number;
  dataHash: string;
}

export interface PlanVersion {
  id: string;
  regionCode: number;
  regionName: string;
  version: number;
  runId: string;
  status: 'APPROVED' | 'SUPERSEDED';
  forecast: number;
  employees: number;
  unallocated: number;
  note: string | null;
  restoredFrom: string | null;
  approvedBy: string | null;
  approvedAt: string;
}

export interface KindMeta {
  kind: ImportKind;
  sheet: string;
  title: string;
  what: string;
  why: string;
  row: string;
  key: string[];
  mandatory: boolean;
  /** money — oldindan ko'rishda tiyinda keladi (so'mga /100) */
  cols: { key: string; label: string; type: string; required: boolean; hint: string }[];
}

export interface RegionRef {
  code: number;
  name: string;
}

export const hpApi = {
  kinds: () => api.get<ApiResponse<KindMeta[]>>('/hudud-reja/kinds'),
  status: () => api.get<ApiResponse<DataStatus>>('/hudud-reja/data/status'),
  imports: (kind?: ImportKind) => api.get<ApiResponse<ImportSession[]>>('/hudud-reja/imports', { params: kind ? { kind } : {} }),
  importOne: (id: string) => api.get<ApiResponse<ImportSession>>(`/hudud-reja/imports/${id}`),
  confirm: (id: string, policy: 'upsert' | 'insert', excludeRows: number[]) => api.post<ApiResponse<ImportSession>>(`/hudud-reja/imports/${id}/confirm`, { policy, excludeRows }),
  cancel: (id: string) => api.post<ApiResponse<{ ok: boolean }>>(`/hudud-reja/imports/${id}/cancel`, {}),
  overview: (q: { target: string; source: Source; region?: number | null; runId?: string | null }) =>
    api.get<ApiResponse<Overview>>('/hudud-reja/overview', { params: { target: q.target, source: q.source, ...(q.region ? { region: q.region } : {}), ...(q.runId ? { runId: q.runId } : {}) } }),
  quality: (target: string, source: Source) => api.get<ApiResponse<{ target: string; source: Source; months: string[]; items: QualityItem[] }>>('/hudud-reja/quality', { params: { target, source } }),
  precheck: (body: Partial<RunParams>) => api.post<ApiResponse<Precheck>>('/hudud-reja/precheck', body),
  start: (body: Partial<RunParams>) => api.post<ApiResponse<RunMeta>>('/hudud-reja/runs', body),
  runs: (target?: string) => api.get<ApiResponse<RunMeta[]>>('/hudud-reja/runs', { params: target ? { target } : {} }),
  run: (id: string) => api.get<ApiResponse<RunMeta>>(`/hudud-reja/runs/${id}`),
  regions: (id: string) => api.get<ApiResponse<RegionRow[]>>(`/hudud-reja/runs/${id}/regions`),
  services: (id: string, region?: number | null) => api.get<ApiResponse<{ region: number | null; rows: ServiceRow[]; modelLabels: Record<string, string> }>>(`/hudud-reja/runs/${id}/services`, { params: region ? { region } : {} }),
  series: (id: string, region: number, service: string) => api.get<ApiResponse<SeriesDetail>>(`/hudud-reja/runs/${id}/series`, { params: { region, service } }),
  employees: (id: string, region?: number | null) => api.get<ApiResponse<EmployeesView>>(`/hudud-reja/runs/${id}/employees`, { params: region ? { region } : {} }),
  assign: (id: string, body: { region: number; service: string; pinfl: string; amount?: number }) => api.post<ApiResponse<EmployeesView>>(`/hudud-reja/runs/${id}/assign`, body),
  unassign: (id: string, index: number) => api.delete<ApiResponse<{ ok: boolean }>>(`/hudud-reja/runs/${id}/assign/${index}`),
  approve: (id: string, regions: number[] | null, note: string) => api.post<ApiResponse<{ approved: { region: number; version: number }[] }>>(`/hudud-reja/runs/${id}/approve`, { regions, note }),
  plans: (target: string) => api.get<ApiResponse<PlanVersion[]>>('/hudud-reja/plans', { params: { target } }),
  restore: (id: string, note: string) => api.patch<ApiResponse<{ version: number }>>(`/hudud-reja/plans/${id}/restore`, { note }),
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

/** Faylni tekshirish (bazaga yozilmaydi) — har bir topilgan varaq uchun alohida sessiya */
export async function checkFile(file: File, kind: ImportKind | 'ALL'): Promise<{ fileName: string; sessions: ImportSession[] }> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}/hudud-reja/imports/check?kind=${kind}`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, "Faylni tekshirib bo'lmadi"));
  return ((await response.json()) as ApiResponse<{ fileName: string; sessions: ImportSession[] }>).data;
}

export async function download(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await readError(response, "Faylni tayyorlab bo'lmadi"));
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const name = star ? decodeURIComponent(star[1]!) : fallbackName;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const templateUrl = (kind: ImportKind | 'ALL', fill = false) => `/hudud-reja/templates/${kind}${fill ? '?fill=1' : ''}`;
export const exportUrl = (runId: string, kind: 'regions' | 'services' | 'employees' | 'full') => `/hudud-reja/runs/${runId}/export?kind=${kind}`;

// ───────────────────────── Formatlash ─────────────────────────

export function som(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const r = Math.round(v);
  return `${r < 0 ? '−' : ''}${Math.abs(r).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

export function short(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '−' : '';
  const f = (x: number, d: number) => x.toFixed(d).replace('.', ',');
  if (a >= 1e9) return `${s}${f(a / 1e9, 2)} mlrd`;
  if (a >= 1e8) return `${s}${f(a / 1e6, 0)} mln`;
  if (a >= 1e6) return `${s}${f(a / 1e6, 1)} mln`;
  if (a >= 1e3) return `${s}${Math.round(a / 1e3)} ming`;
  return `${s}${Math.round(a)}`;
}

export function pct(v: number | null | undefined, digits = 1, sign = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const t = `${Math.abs(v).toFixed(digits).replace('.', ',')}%`;
  return v < 0 ? `−${t}` : sign && v > 0 ? `+${t}` : t;
}

export function qty(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return Number.isInteger(v) ? som(v) : v.toFixed(1).replace('.', ',');
}

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const MONTHS_SHORT = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];

export function monthName(p: string): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return `${y}-yil ${MONTHS[m - 1]}`;
}
export function monthShort(p: string): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}`;
}
export function periodAdd(p: string, n: number): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export function nextMonth(): string {
  const now = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7);
  return periodAdd(now, 1);
}

export const SOURCE_LABEL: Record<Source, string> = {
  merged: 'Birlashtirilgan (yuklangan + dasturdagi)',
  system: 'Dasturdagi daromadlar',
  import: 'Faqat yuklangan tarix',
};

export const KIND_TEXT: Record<ImportKind, string> = {
  STATS: 'Daromad va xizmatlar soni',
  EMP_MONTHS: 'Xodimlar natijalari',
  EMP_SERVICES: "Xodimlar va xizmatlar bog'lanishi",
  FACTORS: "Hududlar va faoliyat ko'rsatkichlari",
  SERVICES: 'Xizmatlar katalogi va tariflar',
};

export const RELIABILITY: Record<string, { label: string; cls: string }> = {
  high: { label: 'Yuqori', cls: 'bg-(--color-income-soft) text-(--color-income)' },
  medium: { label: "O'rta", cls: 'bg-sky-50 text-sky-700' },
  low: { label: 'Past', cls: 'bg-(--color-warn-soft) text-(--color-warn)' },
  none: { label: 'Aniqlanmagan', cls: 'bg-(--color-surface-sunken) text-(--color-text-muted)' },
};

export const PLAN_CLS: Record<PlanStatus['status'], string> = {
  CALCULATED: 'bg-(--color-surface-sunken) text-(--color-text-muted)',
  APPROVED: 'bg-(--color-income-soft) text-(--color-income)',
  APPROVED_OTHER: 'bg-(--color-warn-soft) text-(--color-warn)',
};

export const MODEL_SHORT: Record<string, string> = {
  naive: 'Naive',
  ma3: '3 oylik o‘rtacha',
  snaive: 'Mavsumiy naive',
  ses: 'SES',
  holt: 'Holt',
  hw: 'Mavsumiy ETS',
  croston: 'Croston',
  sba: 'SBA',
};