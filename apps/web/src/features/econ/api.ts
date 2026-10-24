import { api, getToken, type ApiResponse } from '@/lib/api';
import type { ItemFilter, ItemKind, MarkItem } from '@/features/reactions/api';

// ═══════════════════════════════════════════════════════════
// Katta modellar — backend (apps/api/src/modules/econ) bilan bir xil turlar
// Pul — tiyinda, satr ko'rinishida
// ═══════════════════════════════════════════════════════════

/** segment — yo'nalish (Tax free, Marksheyder …) */
export type EconUnitKind = 'total' | 'region' | 'center' | 'segment' | 'unassigned';
export type Target = 'income' | 'expense' | 'result' | 'payroll';
export type Reliability = 'high' | 'medium' | 'low' | 'none';
export type ModelKind = 'mean' | 'ses' | 'holt' | 'seasonal' | 'combined' | 'none';

export interface DataWarning {
  level: 'info' | 'warn';
  unit: string | null;
  period: string | null;
  text: string;
}

export interface ModelReadiness {
  id: string;
  title: string;
  ready: boolean;
  text: string;
}

export interface EconOverview {
  /** Tarixiy ko'rinish: shu oy oxiridagi holat (null — bugungi) */
  asOf: string | null;
  months: string[];
  firstPeriod: string;
  lastFullPeriod: string;
  currentPeriod: string;
  fullMonths: number;
  units: { key: string; name: string; kind: EconUnitKind; fullMonths: number; incomeTiyin: string; expenseTiyin: string; headcount: number }[];
  total: { incomeTiyin: string[]; expenseTiyin: string[]; payrollTiyin: string[]; headcount: number[] };
  readiness: ModelReadiness[];
  warnings: DataWarning[];
  sources: string[];
}

export interface ForecastPoint {
  period: string;
  meanTiyin: string;
  lo80Tiyin: string;
  hi80Tiyin: string;
  lo95Tiyin: string;
  hi95Tiyin: string;
  actualSoFarTiyin: string | null;
}

export interface ForecastResult {
  target: Target;
  targetLabel: string;
  unit: string;
  unitName: string;
  horizon: number;
  history: { period: string; valueTiyin: string; fittedTiyin: string | null }[];
  forecast: ForecastPoint[];
  model: {
    kind: ModelKind;
    name: string;
    explain: string;
    params: { alpha: number; beta: number; gamma: number; phi: number } | null;
    seasonal: { month: number; effectTiyin: string }[] | null;
  };
  accuracy: {
    points: number;
    wape: number | null;
    /** Xato nimaga nisbatan: qiymatning o'ziga yoki (natija uchun) daromad hajmiga */
    basis: 'value' | 'income';
    naiveWape: number | null;
    skill: number | null;
    rows: { period: string; actualTiyin: string; predictedTiyin: string }[];
  };
  reliability: Reliability;
  reliabilityText: string;
  /** Jami = actual (tugagan oylar) + currentExpected (joriy oy, kamida yozilgani) + rest (dekabrgacha prognoz) */
  yearEnd: {
    year: number;
    actualTiyin: string;
    currentPeriod: string;
    currentSoFarTiyin: string;
    currentExpectedTiyin: string;
    restTiyin: string;
    forecastTiyin: string;
    totalTiyin: string;
    lo80Tiyin: string;
    hi80Tiyin: string;
    previousYearTiyin: string | null;
  } | null;
  notes: string[];
  /** Model qanday ishlaydi: bosqichlar, sinalgan modellar, har oy prognozi tarkibi */
  how?: ForecastHow | null;
}

/** «Model qanday ishlaydi» — har bir raqam qayerdan kelgani */
export interface ForecastHow {
  steps: { title: string; text: string }[];
  candidates: { kind: string; name: string; wape: number | null; byHorizon: (number | null)[]; points: number; chosen: boolean }[];
  chosenBy: 'test' | 'aicc' | 'only' | 'combined';
  cleaned: { period: string; actualTiyin: string; usedTiyin: string }[];
  breakdown: {
    columns: { key: string; label: string; hint: string }[];
    rows: { period: string; values: Record<string, string>; sumTiyin: string; meanTiyin: string; note: string | null }[];
  };
  levels: { period: string; levelTiyin: string }[];
  intervals: { modelSigmaTiyin: string; testSigmaTiyin: string | null; usedSigmaTiyin: string; text: string } | null;
  horizon: { h: number; wape: number | null; points: number }[];
  coverage: { inside: number; total: number } | null;
}

export interface UnitForecastSummary {
  key: string;
  name: string;
  kind: EconUnitKind;
  fullMonths: number;
  recentAvgTiyin: string;
  nextAvgTiyin: string;
  nextLo80Tiyin: string;
  nextHi80Tiyin: string;
  changePercent: number | null;
  yearEndTiyin: string | null;
  reliability: Reliability;
  wape: number | null;
  model: string;
  spark: string[];
  sparkForecastFrom: number;
}

export interface UnitsForecastResult {
  target: Target;
  targetLabel: string;
  horizon: number;
  currentPeriod: string;
  units: UnitForecastSummary[];
  notes: string[];
}

// ─────────── Omillar tahlili ───────────

export type FactorKey = 'headcount' | 'payroll' | 'nonpayroll' | 'vehicle' | 'lease' | 'other';
export type Significance = 'strong' | 'weak' | 'none';

export interface FactorCoef {
  key: FactorKey;
  label: string;
  value: number;
  se: number;
  t: number;
  p: number;
  lo95: number;
  hi95: number;
  significance: Significance;
  meaning: string;
}

export interface ModelTable {
  name: string;
  method: 'pooled' | 'fixed' | 'random' | 'elasticity';
  n: number;
  groups: number;
  r2: number;
  adjR2: number;
  withinR2?: number;
  rho?: number;
  f: number;
  fP: number;
  durbinWatson: number;
  coefficients: FactorCoef[];
  trendPerMonth: number | null;
  note?: string;
}

export interface CdCoef {
  value: number;
  se: number;
  p: number;
  lo95: number;
  hi95: number;
}

export interface FactorsResult {
  factors: { key: FactorKey; label: string; unit: 'kishi' | 'som' }[];
  available: { key: FactorKey; label: string; unit: 'kishi' | 'som' }[];
  observations: number;
  units: number;
  months: number;
  periodFrom: string | null;
  periodTo: string | null;
  pooled: ModelTable | null;
  fixed: ModelTable | null;
  random: ModelTable | null;
  hausman: { stat: number; df: number; p: number; text: string } | null;
  preferred: 'pooled' | 'fixed' | 'random' | null;
  elasticity: ModelTable | null;
  cobbDouglas: {
    n: number;
    r2: number;
    alpha: CdCoef;
    beta: CdCoef;
    sum: number;
    sumSe: number;
    sumP: number;
    returns: 'increasing' | 'constant' | 'decreasing';
    tfpGrowthYear: number;
    tfp: { key: string; name: string; index: number }[];
    text: string;
  } | null;
  unitEffects: { key: string; name: string; effectTiyin: string; actualTiyin: string; expectedTiyin: string; months: number }[];
  correlation: { keys: string[]; labels: string[]; matrix: (number | null)[][] } | null;
  /** Pul — tiyin (son), xodimlar — kishi */
  regionMeans: { key: string; name: string; months: number; incomeTiyin: number; factors: Record<FactorKey, number> }[];
  points: { key: string; period: string; incomeTiyin: number; factors: Record<FactorKey, number> }[];
  warnings: string[];
  notes: string[];
}

export const SIGNIFICANCE: Record<Significance, { label: string; tone: string; hint: string }> = {
  strong: { label: 'Ishonchli', tone: 'bg-(--color-income-soft) text-(--color-income)', hint: "p < 0,05 — tasodif bo'lish ehtimoli 5% dan kam" },
  weak: { label: 'Taxminiy', tone: 'bg-amber-100 text-amber-800', hint: "p < 0,10 — ta'sir bor bo'lishi mumkin, lekin ishonch past" },
  none: { label: 'Aniqlanmadi', tone: 'bg-(--color-surface-sunken) text-(--color-text-muted)', hint: "p ≥ 0,10 — ta'sirni tasodifdan ajratib bo'lmadi" },
};

export const METHOD_LABEL: Record<'pooled' | 'fixed' | 'random', string> = {
  pooled: 'Umumiy (OLS)',
  fixed: "Qat'iy ta'sirlar (FE)",
  random: "Tasodifiy ta'sirlar (RE)",
};

// ═══════════════════════════════════════════════════════════
// Samaradorlik chegarasi (DEA) va zararsizlik
// ═══════════════════════════════════════════════════════════

export type EfficiencyMode = 'resources' | 'money';

export interface EfficiencyUnit {
  key: string;
  name: string;
  months: number;
  /** Oylik o'rtacha qiymatlar */
  incomeTiyin: string;
  expenseTiyin: string;
  payrollTiyin: string;
  nonpayrollTiyin: string;
  headcount: number;
  incomePerHeadTiyin: string | null;
  /** Daromad / xarajat */
  roi: number | null;
  /** (Daromad − xarajat) / daromad */
  margin: number | null;
  /** Doimiy miqyos samaradorligi (0..1) */
  crs: number;
  /** Hajmi hisobga olingan samaradorlik (0..1) */
  vrs: number;
  /** Miqyos samaradorligi = crs / vrs */
  scale: number;
  rank: number;
  /** Namuna hududlar (chegaradagi) va ularning vazni */
  peers: { key: string; name: string; weight: number }[];
  /** Chegaradagilar kabi ishlaganda oylik daromad */
  potentialIncomeTiyin: string;
  gapTiyin: string;
  status: 'frontier' | 'near' | 'mid' | 'low';
}

export interface EfficiencyResult {
  mode: EfficiencyMode;
  months: number;
  periodFrom: string | null;
  periodTo: string | null;
  inputs: string[];
  units: EfficiencyUnit[];
  frontier: string[];
  notes: string[];
  warnings: string[];
}

export interface BreakevenUnit {
  key: string;
  name: string;
  kind: EconUnitKind;
  months: number;
  avgIncomeTiyin: string;
  avgExpenseTiyin: string;
  avgProfitTiyin: string;
  /** regression — xarajat daromadga bog'liq qism topildi; fixed — hammasi doimiy deb olindi */
  method: 'regression' | 'fixed' | 'none';
  fixedTiyin: string | null;
  variableRate: number | null;
  r2: number | null;
  slopeP: number | null;
  breakevenTiyin: string | null;
  /** (o'rtacha daromad − zararsizlik) / o'rtacha daromad */
  safetyMargin: number | null;
  /** Operatsion leverej: daromad 1% o'zgarsa, foyda necha % o'zgaradi */
  leverage: number | null;
  status: 'safe' | 'thin' | 'loss' | 'na';
  text: string;
  points: { period: string; incomeTiyin: string; expenseTiyin: string }[];
}

export interface BreakevenResult {
  months: number;
  periodFrom: string | null;
  periodTo: string | null;
  units: BreakevenUnit[];
  center: { netExpenseTiyin: string; regionsProfitTiyin: string; coverage: number | null } | null;
  notes: string[];
}

// ═══════════════════════════════════════════════════════════
// Stsenariy va risk
// ═══════════════════════════════════════════════════════════

/** O'zgarishlar ulushda (0,1 = +10%) */
export interface ScenarioChanges {
  headcount: number;
  wage: number;
  vehicle: number;
  lease: number;
  other: number;
  income: number;
}

export interface ScenarioBand {
  meanTiyin: string;
  lo80Tiyin: string;
  hi80Tiyin: string;
}

export interface ScenarioPath {
  income: ScenarioBand[];
  expense: ScenarioBand[];
  result: ScenarioBand[];
  /** Har oy zarar ehtimoli */
  lossProbability: number[];
}

export interface ScenarioTotals {
  incomeTiyin: string;
  expenseTiyin: string;
  resultTiyin: string;
  resultLo80Tiyin: string;
  resultHi80Tiyin: string;
  lossProbability: number;
}

export interface ScenarioResult {
  unit: string;
  unitName: string;
  horizon: number;
  periods: string[];
  changes: ScenarioChanges;
  useElasticity: boolean;
  elasticity: {
    headcount: { value: number; se: number; used: boolean; p: number | null };
    nonpayroll: { value: number; se: number; used: boolean; p: number | null };
  };
  shares: { payroll: number; lease: number; vehicle: number; other: number };
  expenseFactor: number;
  baseline: ScenarioPath;
  scenario: ScenarioPath;
  totals: { baseline: ScenarioTotals; scenario: ScenarioTotals; betterProbability: number };
  notes: string[];
}

export interface RiskUnit {
  key: string;
  name: string;
  kind: EconUnitKind;
  months: number;
  expectedResultTiyin: string;
  p10Tiyin: string;
  p90Tiyin: string;
  /** Davr jamida zarar ehtimoli */
  lossProbability: number;
  /** Kamida bir oy zarar ehtimoli */
  anyMonthLossProbability: number;
  /** O'rtacha oylik daromad oxirgi 3 oydan 10%+ past bo'lish ehtimoli */
  incomeDropProbability: number;
  recentResultTiyin: string;
  level: 'high' | 'medium' | 'low';
}

export interface RiskResult {
  horizon: number;
  periodFrom: string;
  periodTo: string;
  units: RiskUnit[];
  notes: string[];
}

/** Stsenariy so'rovi: o'zgarishlar foizda (10 = +10%) */
export interface ScenarioRequest {
  unit: string;
  horizon: number;
  headcount: number;
  wage: number;
  vehicle: number;
  lease: number;
  other: number;
  income: number;
  useElasticity: boolean;
}

/**
 * asOf — umumiy «Davr»ning oxirgi oyi (lib/period → useAsOf): o'tgan oy bo'lsa, modellar
 * o'sha oy oxirida turgandek hisoblanadi; undefined — bugungi holat.
 */
export const econApi = {
  overview: (asOf?: string) => api.get<ApiResponse<EconOverview>>('/econ/overview', { params: { asOf } }),
  forecast: (target: Target, unit: string, horizon: number, asOf?: string) =>
    api.get<ApiResponse<ForecastResult>>('/econ/forecast', { params: { target, unit, horizon, asOf } }),
  unitsForecast: (target: Target, horizon = 3, asOf?: string) =>
    api.get<ApiResponse<UnitsForecastResult>>('/econ/forecast/units', { params: { target, horizon, asOf } }),
  efficiency: (months: string, mode: EfficiencyMode, asOf?: string) =>
    api.get<ApiResponse<EfficiencyResult>>('/econ/efficiency', { params: { months, mode, asOf } }),
  breakeven: (months: string, asOf?: string) => api.get<ApiResponse<BreakevenResult>>('/econ/breakeven', { params: { months, asOf } }),
  scenario: (payload: ScenarioRequest, asOf?: string) => api.post<ApiResponse<ScenarioResult>>('/econ/scenario', payload, { params: { asOf } }),
  risk: (horizon: number, asOf?: string) => api.get<ApiResponse<RiskResult>>('/econ/risk', { params: { horizon, asOf } }),
  factors: (factors: FactorKey[], asOf?: string) =>
    api.get<ApiResponse<FactorsResult>>('/econ/factors', { params: { factors: factors.join(','), asOf } }),
};

// ═══════════════════════════════════════════════════════════
// Yorliqlar va yordamchilar
// ═══════════════════════════════════════════════════════════

export const TARGET_OPTIONS: { value: Target; label: string; hint: string }[] = [
  { value: 'income', label: 'Daromad', hint: "Daromadlar bo'limidagi yozuvlar" },
  { value: 'expense', label: 'Xarajat', hint: "Xarajatlar bo'limidagi barcha yozuvlar" },
  { value: 'result', label: 'Natija', hint: 'Daromad − xarajat' },
  { value: 'payroll', label: 'Ish haqi', hint: 'Xarajatlardagi ish haqi yozuvlari' },
];

/** Ko'rsatkich o'sishi yaxshimi (daromad, natija — ha; xarajat — yo'q) */
export function higherIsBetter(target: Target): boolean {
  return target === 'income' || target === 'result';
}

export const RELIABILITY: Record<Reliability, { label: string; tone: string; hint: string }> = {
  high: { label: 'Ishonchli', tone: 'bg-(--color-income-soft) text-(--color-income)', hint: "Sinovda o'rtacha xato 10% dan kam, 18+ oy ma'lumot" },
  medium: { label: "O'rtacha", tone: 'bg-sky-100 text-sky-800', hint: "Sinovda o'rtacha xato 25% dan kam" },
  low: { label: 'Taxminiy', tone: 'bg-amber-100 text-amber-800', hint: "Ma'lumot kam yoki oylar orasida tebranish katta — faqat yo'nalish sifatida" },
  none: { label: "Ma'lumot kam", tone: 'bg-(--color-surface-sunken) text-(--color-text-muted)', hint: 'Kamida 4 ta tugagan oy kerak' },
};

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

export function monthTitle(month: number): string {
  return MONTHS[month - 1] ?? String(month);
}

/** Munosabatga belgilash uchun modda: birlik va ko'rsatkich */
export function forecastMark(unit: { key: string; name: string }, target: Target): MarkItem {
  const filter: ItemFilter = unit.key === 'all' ? {} : { unit: unit.key };
  let kind: ItemKind = 'INCOME';
  let what = 'daromad';
  if (target === 'expense') {
    kind = 'EXPENSE';
    what = 'xarajat';
  } else if (target === 'payroll') {
    kind = 'EXPENSE';
    what = 'ish haqi';
    filter.source = 'PAYROLL';
  } else if (target === 'result') {
    kind = 'RESULT';
    what = 'natija';
  }
  return { kind, label: `${unit.key === 'all' ? 'Butun korxona' : unit.name} · ${what}`, filter, origin: 'Katta modellar · Prognoz' };
}

/** Daromad moddasi (Munosabat uchun) */
export function incomeMark(unit: { key: string; name: string }, origin: string): MarkItem {
  return { kind: 'INCOME', label: `${unit.name} · daromad`, filter: { unit: unit.key }, origin };
}

/** Excel hisobot yoki slaydlarni yuklab olish (barcha modellar bo'yicha) */
export async function downloadEconFile(kind: 'report' | 'slides', asOf?: string): Promise<void> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
  const token = getToken();
  const response = await fetch(`${base}/econ/${kind}${asOf ? `?asOf=${asOf}` : ''}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(kind === 'report' ? 'Hisobot tayyorlanmadi' : 'Slaydlar tayyorlanmadi');
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition) ?? /filename="([^"]+)"/.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]!) : kind === 'report' ? 'katta-modellar.xlsx' : 'katta-modellar.pptx';
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Natija moddasi (Munosabat uchun) */
export function resultMark(unit: { key: string; name: string }, origin: string): MarkItem {
  return { kind: 'RESULT', label: `${unit.key === 'all' ? 'Butun korxona' : unit.name} · natija`, filter: unit.key === 'all' ? {} : { unit: unit.key }, origin };
}