import { api, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Katta modellar › Hudud natijasi va Markaz xarajati (backend: modules/regional-econ)
// Pul — tiyinda, satr ko'rinishida; nisbatlar — ulush (0.25 = 25%)
// ═══════════════════════════════════════════════════════════

export type RangeMode = 'M' | 'Q' | 'Y';

export interface EconRange {
  mode: RangeMode;
  from: string;
  to: string;
  periods: string[];
  label: string;
  prevPeriods: string[];
  prevLabel: string;
}

export interface PerfRow {
  code: number;
  name: string;
  revenueTiyin: string;
  payrollTiyin: string;
  opexTiyin: string;
  expenseTiyin: string;
  resultTiyin: string;
  allocatedTiyin: string;
  adjustedTiyin: string;
  margin: number | null;
  adjustedMargin: number | null;
  payrollShare: number | null;
  opexShare: number | null;
  coverage: number | null;
  coverageFull: number | null;
  headcount: number;
  fte: number;
  fteMissing: number;
  revenuePerHeadTiyin: string | null;
  revenuePerFteTiyin: string | null;
  prev: { revenueTiyin: string; expenseTiyin: string; resultTiyin: string; adjustedTiyin: string; hasData: boolean };
  revenueGrowth: number | null;
  expenseGrowth: number | null;
  resultGrowth: number | null;
  budget: { planTiyin: string; factTiyin: string; variance: number | null; months: number } | null;
  peer: 'A' | 'B' | 'C' | null;
  peerRank: number | null;
  peerSize: number;
  hasData: boolean;
}

export interface Insight {
  level: 'good' | 'warn' | 'bad' | 'info';
  regionCode: number | null;
  text: string;
}

export interface Performance {
  range: EconRange;
  closedPeriods: string[];
  openPeriods: string[];
  rows: PerfRow[];
  center: { incomeTiyin: string; expenseTiyin: string; allocatedOutTiyin: string; retainedTiyin: string; resultTiyin: string; adjustedTiyin: string };
  unassigned: { incomeTiyin: string; expenseTiyin: string; allocatedOutTiyin: string; adjustedTiyin: string } | null;
  company: { incomeTiyin: string; expenseTiyin: string; resultTiyin: string; regionsRevenueShare: number | null };
  reconciliation: { ok: boolean; diffTiyin: string; formula: string };
  insights: Insight[];
  method: string[];
}

export interface Suggestion {
  role: string;
  roleLabel: string;
  driver: string | null;
  driverLabel: string | null;
  reason: string;
}

export interface OverheadUnit {
  key: string;
  name: string;
  kind: 'department' | 'center' | 'unassigned';
  role: string | null;
  roleLabel: string | null;
  driver: string | null;
  driverLabel: string | null;
  ruleChanged: boolean;
  incomeTiyin: string;
  expenseTiyin: string;
  allocatedTiyin: string;
  retainedTiyin: string;
  retained: { reason: string; label: string; amountTiyin: string }[];
  byRegion: Record<string, string>;
  suggestion: Suggestion | null;
}

export interface Overhead {
  range: EconRange;
  closedPeriods: string[];
  totals: {
    centralExpenseTiyin: string;
    centralIncomeTiyin: string;
    unassignedExpenseTiyin: string;
    totalExpenseTiyin: string;
    allocatedTiyin: string;
    retainedTiyin: string;
    retainedByReason: { reason: string; label: string; amountTiyin: string }[];
  };
  reconciliation: { ok: boolean; diffTiyin: string; formula: string };
  regions: { code: number; name: string; allocatedTiyin: string; share: number | null }[];
  units: OverheadUnit[];
  sensitivity: { driver: string; label: string; byRegion: Record<string, string>; unallocatedTiyin: string }[];
  warnings: string[];
  method: string[];
}

export interface RuleView {
  id: string;
  role: string;
  roleLabel: string;
  driver: string | null;
  driverLabel: string | null;
  validFrom: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string | null;
}

export interface RuleUnit {
  key: string;
  name: string;
  kind: 'department' | 'center' | 'unassigned';
  current: RuleView | null;
  upcoming: RuleView[];
  history: RuleView[];
  suggestion: Suggestion | null;
}

export interface RuleList {
  roles: { value: string; label: string }[];
  drivers: { value: string; label: string }[];
  currentPeriod: string;
  units: RuleUnit[];
}

export interface DriverValues {
  period: string;
  unitKey: string;
  unitName: string;
  regions: { code: number; name: string; value: number | null }[];
}

export const reApi = {
  performance: (to: string, mode: RangeMode) => api.get<ApiResponse<Performance>>('/regional-econ/performance', { params: { to, mode } }),
  overhead: (to: string, mode: RangeMode) => api.get<ApiResponse<Overhead>>('/regional-econ/overhead', { params: { to, mode } }),
  rules: () => api.get<ApiResponse<RuleList>>('/regional-econ/rules'),
  setRule: (input: { unitKey: string; role: string; driver: string | null; validFrom: string; note: string | null }) => api.post<ApiResponse<{ id: string }>>('/regional-econ/rules', input),
  deleteRule: (id: string) => api.delete<ApiResponse<{ ok: true }>>(`/regional-econ/rules/${id}`),
  acceptSuggestions: (validFrom: string) => api.post<ApiResponse<{ created: number }>>('/regional-econ/rules/accept-suggestions', { validFrom }),
  drivers: (period: string, unitKey: string) => api.get<ApiResponse<DriverValues>>('/regional-econ/drivers', { params: { period, unitKey } }),
  setDrivers: (period: string, unitKey: string, values: { regionCode: number; value: number | null }[]) => api.post<ApiResponse<{ saved: number }>>('/regional-econ/drivers', { period, unitKey, values }),
};

/** Ulush → "12,5%" */
export const share = (x: number | null | undefined, sign = false) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : `${sign && x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1).replace('.', ',')}%`;

export const RANGE_OPTIONS: { value: RangeMode; label: string }[] = [
  { value: 'M', label: 'Oy' },
  { value: 'Q', label: '3 oy' },
  { value: 'Y', label: 'Yil boshidan' },
];

// ─────────────────────────── 3-bosqich: hudud prognozi ───────────────────────────

export type Reliability = 'high' | 'medium' | 'low' | 'none';

export interface BandT {
  meanTiyin: string;
  loTiyin: string;
  hiTiyin: string;
}

export interface FcAccuracy {
  points: number;
  wape: number | null;
  naiveWape: number | null;
  byH: (number | null)[];
}

export interface ServiceForecast {
  key: string;
  label: string;
  history: { period: string; valueTiyin: string }[];
  forecast: BandT[];
  model: string;
  modelLabel: string;
  fromPeriod: string | null;
  used: number;
  accuracy: FcAccuracy;
  reliability: Reliability;
  notes: string[];
}

export interface RegionForecast {
  code: number;
  name: string;
  hasData: boolean;
  fromPeriod: string | null;
  last: { revenueTiyin: string; payrollTiyin: string; opexTiyin: string; resultTiyin: string };
  revenue: { history: { period: string; valueTiyin: string }[]; forecast: BandT[]; wape: number | null; reliability: Reliability; services: ServiceForecast[] };
  payroll: {
    history: { period: string; valueTiyin: string }[];
    forecast: BandT[];
    wape: number | null;
    backtestMonths: number;
    headcountNow: number;
    headcount: number[];
    basis: Record<string, number>;
    /** Mavsumiy tuzatma (o'tgan yilning shu oyidagi mukofot va h.k.), 1 — yo'q */
    seasonal?: number[];
  };
  opex: {
    history: { period: string; valueTiyin: string }[];
    recurring: { forecast: BandT[]; model: string; modelLabel: string; accuracy: FcAccuracy; reliability: Reliability } | null;
    oneTimeAllowanceTiyin: string;
    forecast: BandT[];
    budget: (string | null)[];
  };
  overhead: { share: number; forecast: BandT[] };
  result: BandT[];
}

export interface RegionalForecast {
  lastActual: string;
  lastLabel: string;
  horizon: number;
  periods: string[];
  periodLabels: string[];
  history: string[];
  generatedAt: string;
  total: {
    revenue: BandT[];
    payroll: BandT[];
    opex: BandT[];
    overhead: BandT[];
    result: BandT[];
    revenueWape: number | null;
    payrollWape: number | null;
    last: { revenueTiyin: string; payrollTiyin: string; opexTiyin: string };
  };
  central: { forecast: BandT[]; model: string; modelLabel: string; allocatedShare: number };
  regions: RegionForecast[];
  insights: Insight[];
  notes: string[];
  method: string[];
}

export interface PayrollDetail {
  region: { code: number; name: string };
  lastActual: string;
  recentPeriods: string[];
  periods: string[];
  regionRatio: number | null;
  regionMedianTiyin: string | null;
  rows: {
    pinfl: string;
    fullName: string;
    position: string | null;
    cardTiyin: string | null;
    rate: number | null;
    ratio: number | null;
    recent: string[];
    months: ({ valueTiyin: string; basis: 'CARD' | 'RECENT' | 'REGION' | 'NONE' } | null)[];
    changes: string[];
  }[];
}

interface CompareCell {
  forecastTiyin: string;
  actualTiyin: string;
  error: number | null;
}

export interface ForecastRunView {
  id: string;
  lastActual: string;
  lastLabel: string;
  horizon: number;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  checked: number;
  wape: { revenue: number | null; payroll: number | null; opex: number | null };
  months: (
    | { period: string; label: string; available: false }
    | { period: string; label: string; available: true; revenue: CompareCell; payroll: CompareCell; opex: CompareCell; worst: { code: number; name: string; forecastTiyin: string; actualTiyin: string; error: number | null }[] }
  )[];
}

export const fcApi = {
  forecast: (to: string, h: number) => api.get<ApiResponse<RegionalForecast>>('/regional-econ/forecast', { params: { to, h } }),
  payroll: (to: string, h: number, region: number) => api.get<ApiResponse<PayrollDetail>>('/regional-econ/forecast/payroll', { params: { to, h, region } }),
  runs: () => api.get<ApiResponse<ForecastRunView[]>>('/regional-econ/forecast/runs'),
  saveRun: (to: string, h: number, note: string | null) => api.post<ApiResponse<{ id: string }>>('/regional-econ/forecast/runs', { to, h, note }),
  deleteRun: (id: string) => api.delete<ApiResponse<{ ok: true }>>(`/regional-econ/forecast/runs/${id}`),
};

export const RELIABILITY: Record<Reliability, { label: string; cls: string }> = {
  high: { label: 'Yuqori', cls: 'bg-emerald-100 text-emerald-800' },
  medium: { label: "O'rtacha", cls: 'bg-sky-100 text-sky-800' },
  low: { label: 'Past', cls: 'bg-amber-100 text-amber-800' },
  none: { label: "Ma'lumot kam", cls: 'bg-slate-100 text-slate-600' },
};

// ─────────────────────────── 4-bosqich: salohiyat va KPI ───────────────────────────

export type WindowReason = 'EVENT' | 'DETECTED' | 'DATA' | 'MAX';

export interface ServicePotential {
  key: string;
  label: string;
  window: { from: string; to: string; n: number; reason: WindowReason; reasonText: string };
  windowValues: { period: string; valueTiyin: string }[];
  breaks: { period: string; source: 'EVENT' | 'DETECTED'; text: string }[];
  meanTiyin: string;
  growth: number;
  growthMethod: 'YOY' | 'TREND' | 'PAIRS';
  cv: number | null;
  stable: boolean;
  short: boolean;
  fittedLastTiyin: string;
  actualLastTiyin: string;
  utilization: number | null;
  ahead: string[];
  /** Mavsum indeksi (null — 24 oydan kam barqaror ma'lumot) */
  seasonal: { last: number; ahead: number[] } | null;
  /** Shu oy uchun salohiyat: yillik daraja × mavsum indeksi */
  aheadSeasonal: string[];
  fittedLastSeasonalTiyin: string;
  forecast: string[];
  exponent: number;
  notes: string[];
}

export interface RegionPotential {
  code: number;
  name: string;
  hasData: boolean;
  actualLastTiyin: string;
  fittedLastTiyin: string;
  utilization: number | null;
  ahead: string[];
  aheadSeasonal: string[];
  seasonalServices: number;
  forecast: string[];
  services: ServicePotential[];
}

export interface PotentialResult {
  lastActual: string;
  lastLabel: string;
  horizon: number;
  periods: string[];
  periodLabels: string[];
  total: { actualLastTiyin: string; fittedLastTiyin: string; utilization: number | null; ahead: string[]; aheadSeasonal: string[]; forecast: string[] };
  regions: RegionPotential[];
  insights: Insight[];
  method: string[];
}

export type KpiMetric = 'REVENUE' | 'EXPENSE' | 'RESULT';
export type KpiStatus = 'DRAFT' | 'PROPOSED' | 'APPROVED';

export interface KpiCell {
  metric: KpiMetric;
  label: string;
  up: boolean;
  id: string | null;
  status: KpiStatus | null;
  suggestedTiyin: string | null;
  basis: {
    base?: string;
    baseLabel?: string;
    step?: number;
    potentialTiyin?: string;
    forecastRevenueTiyin?: string;
    forecastExpenseTiyin?: string;
    budgetTiyin?: string | null;
    revenueSource?: 'POTENTIAL' | 'FORECAST';
    expenseSource?: 'BUDGET' | 'FORECAST' | 'MIXED';
  } | null;
  proposedTiyin: string | null;
  approvedTiyin: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  note: string | null;
  actualTiyin: string | null;
  achievement: number | null;
  state: 'met' | 'near' | 'missed' | 'none';
  history: number;
}

export interface KpiList {
  period: string;
  label: string;
  timing: 'past' | 'running' | 'future';
  closed: boolean;
  metrics: { key: KpiMetric; label: string; up: boolean }[];
  counts: { DRAFT: number; PROPOSED: number; APPROVED: number; missing: number };
  states: { met: number; near: number; missed: number };
  totals: { metric: KpiMetric; label: string; approvedTiyin: string; actualTiyin: string; regions: number; achievement: number | null }[];
  regions: { code: number; name: string; metrics: KpiCell[] }[];
  method: string[];
}

export interface KpiLog {
  id: string;
  action: string;
  actionLabel: string;
  valueTiyin: string | null;
  note: string | null;
  by: string | null;
  at: string;
}

export const potApi = {
  potential: (to: string, h: number) => api.get<ApiResponse<PotentialResult>>('/regional-econ/potential', { params: { to, h } }),
};

export const kpiApi = {
  list: (period: string) => api.get<ApiResponse<KpiList>>('/regional-econ/kpi', { params: { period } }),
  history: (id: string) => api.get<ApiResponse<KpiLog[]>>(`/regional-econ/kpi/${id}/history`),
  generate: (period: string) => api.post<ApiResponse<{ created: number; updated: number; skipped: number }>>(`/regional-econ/kpi/period/${period}/generate`, {}),
  approveAll: (period: string) => api.post<ApiResponse<{ approved: number }>>(`/regional-econ/kpi/period/${period}/approve-all`, {}),
  propose: (id: string, valueTiyin: string, note: string | null) => api.post<ApiResponse<{ ok: true }>>(`/regional-econ/kpi/${id}/propose`, { valueTiyin, note }),
  approve: (id: string, valueTiyin: string | null, note: string | null) => api.post<ApiResponse<{ ok: true }>>(`/regional-econ/kpi/${id}/approve`, { valueTiyin, note }),
  reject: (id: string, note: string) => api.post<ApiResponse<{ ok: true }>>(`/regional-econ/kpi/${id}/reject`, { note }),
  reopen: (id: string, note: string) => api.post<ApiResponse<{ ok: true }>>(`/regional-econ/kpi/${id}/reopen`, { note }),
};

// ─────────────────────────── 5-bosqich: panel, izoh, stsenariy ───────────────────────────

export type Light = 'red' | 'amber' | 'green' | 'none';

export interface DashRow {
  code: number;
  name: string;
  light: Light;
  reasons: string[];
  revenueTiyin: string;
  revenueGrowth: number | null;
  resultTiyin: string;
  adjustedTiyin: string;
  adjustedMargin: number | null;
  coverage: number | null;
  headcount: number;
  ytdRevenueTiyin: string;
  ytdAdjustedTiyin: string;
  ytdRevenueGrowth: number | null;
  utilization: number | null;
  potentialNextTiyin: string | null;
  forecastRevenueNextTiyin: string | null;
  forecastResultNext: BandT | null;
  lossProb: number | null;
  reliability: Reliability;
  kpi: { revenueAchievement: number | null; revenueState: 'met' | 'near' | 'missed' | 'none'; states: Record<string, number> };
}

export interface Dashboard {
  lastActual: string;
  lastLabel: string;
  next: string;
  nextLabel: string;
  ytdLabel: string;
  totals: {
    revenueTiyin: string;
    revenueGrowth: number | null;
    resultTiyin: string;
    adjustedTiyin: string;
    ytdRevenueTiyin: string;
    ytdGrowth: number | null;
    forecastRevenueTiyin: string;
    forecastResultTiyin: string;
    potentialTiyin: string;
    utilization: number | null;
    centerAdjustedTiyin: string;
    companyResultTiyin: string;
  };
  lights: { red: number; amber: number; green: number };
  kpi: { last: { met: number; near: number; missed: number }; nextApproved: number; nextProposed: number };
  quality: { closed: boolean; errors: number; warnings: number };
  rows: DashRow[];
  story: { title: string; text: string; tone: 'good' | 'warn' | 'bad' | 'info' }[];
  method: string[];
}

export interface Explain {
  region: { code: number; name: string };
  period: string;
  periodLabel: string;
  prev: string;
  prevLabel: string;
  headline: string;
  parts: string[];
  steps: { key: string; label: string; valueTiyin: string }[];
  check: { ok: boolean };
  services: { key: string; label: string; prevTiyin: string; curTiyin: string; deltaTiyin: string; volumeEffectTiyin: string | null; priceEffectTiyin: string | null; q0: number | null; q1: number | null }[];
  opex: { key: string; label: string; prevTiyin: string; curTiyin: string; deltaTiyin: string }[];
  payroll: { prevTiyin: string; curTiyin: string; h0: number; h1: number; avg0Tiyin: string; avg1Tiyin: string; headEffectTiyin: string; avgEffectTiyin: string };
  overhead: { prevTiyin: string; curTiyin: string };
  method: string[];
}

export interface Levers {
  regionCode: number | null;
  start: number;
  tariffPct: number;
  tariffService: string | null;
  elasticity: number;
  volumePct: number;
  wagePct: number;
  headcount: number;
  opexPct: number;
  oneTimeTiyin: number;
  centralPct: number;
}

type Parts = { revenue: string; payroll: string; opex: string; overhead: string; result: string };

export interface ScenarioResult {
  lastActual: string;
  horizon: number;
  periods: string[];
  periodLabels: string[];
  levers: Levers;
  services: { key: string; label: string }[];
  months: { period: string; label: string; base: Parts; scen: Parts }[];
  delta: Parts;
  regions: {
    code: number;
    name: string;
    touched: boolean;
    baseResult: string[];
    scenResult: string[];
    scenRevenue: string[];
    baseLoss: (number | null)[];
    scenLoss: (number | null)[];
    breakEvenTariff: (number | null)[];
    deltaTiyin: string;
  }[];
  narrative: string[];
  method: string[];
}

export const dashApi = {
  dashboard: (to: string) => api.get<ApiResponse<Dashboard>>('/regional-econ/dashboard', { params: { to } }),
  explain: (region: number, period: string) => api.get<ApiResponse<Explain>>('/regional-econ/explain', { params: { region, period } }),
  scenario: (to: string, h: number, levers: Partial<Levers>) => api.get<ApiResponse<ScenarioResult>>('/regional-econ/scenario', { params: { to, h, levers: JSON.stringify(levers) } }),
};

export const LIGHT: Record<Light, { label: string; dot: string; text: string }> = {
  red: { label: "E'tibor kerak", dot: 'bg-red-500', text: 'text-red-700' },
  amber: { label: 'Kuzatish', dot: 'bg-amber-400', text: 'text-amber-700' },
  green: { label: 'Yaxshi', dot: 'bg-emerald-500', text: 'text-emerald-700' },
  none: { label: "Ma'lumot yo'q", dot: 'bg-slate-300', text: 'text-slate-500' },
};

// ─────────────────────────── Katta demo ───────────────────────────

export interface DemoStatus {
  exists: boolean;
  incomes: number;
  expenses: number;
  employees: number;
  months: number;
  from: string | null;
  to: string | null;
  realRegionalIncomes: number;
}

export interface DemoCreated {
  regions: number;
  incomes: number;
  expenses: number;
  employees: number;
  payrollEntries: number;
  months: number;
  from: string;
  to: string;
  closedMonths: number;
  kpiTargets: number;
  forecastRuns: number;
}

export const demoApi = {
  status: () => api.get<ApiResponse<DemoStatus>>('/regional-econ/demo'),
  create: (force = false) => api.post<ApiResponse<DemoCreated>>('/regional-econ/demo', { force }),
  remove: () => api.delete<ApiResponse<Record<string, number>>>('/regional-econ/demo'),
};