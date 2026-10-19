// ═══════════════════════════════════════════════════════════
// Katta modellar — umumiy turlar
// Pul qiymatlari tiyinda, satr ko'rinishida (BigInt aniqligi saqlanadi)
// ═══════════════════════════════════════════════════════════

export type UnitKind = 'total' | 'region' | 'center' | 'unassigned';

/** Bir birlik (korxona, hudud, Markaz) uchun oylik qatorlar — so'mda (float, faqat hisoblash uchun) */
export interface UnitSeries {
  key: string;
  code: number | null;
  name: string;
  kind: UnitKind;
  /** Oylar bo'yicha (panel.months tartibida) */
  income: number[];
  incomeDoimiy: number[];
  expense: number[];
  expenseDoimiy: number[];
  payroll: number[];
  lease: number[];
  vehicle: number[];
  otherExpense: number[];
  headcount: number[];
  incomeCount: number[];
  expenseCount: number[];
}

export interface Panel {
  /** Barcha oylar: birinchi yozuvdan joriy oygacha */
  months: string[];
  /** Joriy (tugamagan) oy — months ichida oxirgisi bo'lsa */
  currentPeriod: string;
  /** Tugagan oxirgi oy */
  lastFullPeriod: string;
  /**
   * Tarixiy ko'rinish: null — bugungi holat; "2026-08" — shu oy oxiridagi holat
   * (keyingi oylar yozuvlari hisobga olinmaydi, prognoz shu oydan keyin boshlanadi).
   */
  asOf: string | null;
  total: UnitSeries;
  units: UnitSeries[];
  builtAt: number;
}

export type Target = 'income' | 'expense' | 'result' | 'payroll';

export const TARGET_LABEL: Record<Target, string> = {
  income: 'Daromad',
  expense: 'Xarajat',
  result: 'Natija (daromad − xarajat)',
  payroll: 'Ish haqi xarajati',
};

export type Reliability = 'high' | 'medium' | 'low' | 'none';

export const RELIABILITY_LABEL: Record<Reliability, string> = {
  high: 'Ishonchli',
  medium: "O'rtacha ishonchli",
  low: 'Taxminiy',
  none: "Ma'lumot yetarli emas",
};

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
  /** Oddiy tilda: nima kerak, nima bor */
  text: string;
}

export interface EconOverview {
  /** Tarixiy ko'rinish oyi (Panel.asOf) */
  asOf: string | null;
  months: string[];
  firstPeriod: string;
  lastFullPeriod: string;
  currentPeriod: string;
  fullMonths: number;
  units: { key: string; name: string; kind: UnitKind; fullMonths: number; incomeTiyin: string; expenseTiyin: string; headcount: number }[];
  /** Korxona bo'yicha oylik qatorlar */
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
  /** Joriy oy uchun: hozirgacha haqiqatda yozilgan */
  actualSoFarTiyin: string | null;
}

export interface ForecastResult {
  target: Target;
  targetLabel: string;
  unit: string;
  unitName: string;
  horizon: number;
  /** Tarix (tugagan oylar) */
  history: { period: string; valueTiyin: string; fittedTiyin: string | null }[];
  forecast: ForecastPoint[];
  model: {
    /** combined — natija: daromad prognozi − xarajat prognozi */
    kind: 'mean' | 'ses' | 'holt' | 'seasonal' | 'combined' | 'none';
    name: string;
    explain: string;
    params: { alpha: number; beta: number; gamma: number; phi: number } | null;
    /** Mavsumiy ta'sir: har oy uchun o'rtachadan farq (faqat mavsumiy modelda) */
    seasonal: { month: number; effectTiyin: string }[] | null;
  };
  accuracy: {
    points: number;
    wape: number | null;
    /** Xato nimaga nisbatan: qiymatning o'ziga yoki (natija uchun) daromad hajmiga */
    basis: 'value' | 'income';
    naiveWape: number | null;
    /** Model oddiy usuldan necha foiz aniqroq (manfiy — yomonroq) */
    skill: number | null;
    rows: { period: string; actualTiyin: string; predictedTiyin: string }[];
  };
  reliability: Reliability;
  reliabilityText: string;
  /** Yil oxirigacha: haqiqiy + joriy oy + prognoz */
  yearEnd: YearEnd | null;
  notes: string[];
  /** Model qanday ishlaydi — bosqichlar, sinalgan modellar, prognoz tarkibi (model bo'lmasa — null) */
  how: ForecastHow | null;
}

/** «Model qanday ishlaydi»: foydalanuvchi prognozning har bir raqami qayerdan kelganini ko'radi */
export interface ForecastHow {
  steps: { title: string; text: string }[];
  /** Sinab ko'rilgan modellar: o'tmishda 1, 2, 3 oy oldinga aytish xatosi */
  candidates: { kind: string; name: string; wape: number | null; byHorizon: (number | null)[]; points: number; chosen: boolean }[];
  chosenBy: 'test' | 'aicc' | 'only' | 'combined';
  /** O'rgatishda yumshatilgan bir martalik sakrashlar */
  cleaned: { period: string; actualTiyin: string; usedTiyin: string }[];
  /** Har prognoz oyi qanday yig'iladi: ustunlar yig'indisi = prognoz */
  breakdown: {
    columns: { key: string; label: string; hint: string }[];
    rows: { period: string; values: Record<string, string>; sumTiyin: string; meanTiyin: string; note: string | null }[];
  };
  /** Model ko'rgan «asosiy daraja» (tasodifiy tebranishsiz) — tarix bo'yicha */
  levels: { period: string; levelTiyin: string }[];
  /** Ehtimol oralig'i qanday topilgani */
  intervals: { modelSigmaTiyin: string; testSigmaTiyin: string | null; usedSigmaTiyin: string; text: string } | null;
  /** O'tmishda sinov: necha oy oldinga aytilganda qancha xato */
  horizon: { h: number; wape: number | null; points: number }[];
  /** Sinovda haqiqiy qiymat 80% oraliqqa tushgan oylar */
  coverage: { inside: number; total: number } | null;
}

/**
 * Yil yakuni tarkibi (hammasi tiyinda):
 *   jami = actual (yilning tugagan oylari, haqiqiy) + currentExpected (joriy oy) + rest (keyingi oylar, dekabrgacha)
 *   forecast = currentExpected + rest
 *   currentExpected = max(joriy oyda hozircha yozilgan, joriy oy prognozi)
 */
export interface YearEnd {
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
}

export interface UnitForecastSummary {
  key: string;
  name: string;
  kind: UnitKind;
  fullMonths: number;
  /** Oxirgi 3 tugagan oy o'rtachasi */
  recentAvgTiyin: string;
  /** Keyingi 3 oy o'rtachasi (prognoz) */
  nextAvgTiyin: string;
  nextLo80Tiyin: string;
  nextHi80Tiyin: string;
  changePercent: number | null;
  /** Yil oxirigacha jami */
  yearEndTiyin: string | null;
  reliability: Reliability;
  wape: number | null;
  model: string;
  /** Oxirgi 12 oy + 3 oy prognoz (sparkline uchun) */
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

// ═══════════════════════════════════════════════════════════
// Omillar tahlili
// ═══════════════════════════════════════════════════════════

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
  /** Oddiy tilda ma'nosi */
  meaning: string;
}

export interface ModelTable {
  name: string;
  method: 'pooled' | 'fixed' | 'random' | 'elasticity';
  n: number;
  groups: number;
  r2: number;
  adjR2: number;
  /** FE: hudud ichidagi R² */
  withinR2?: number;
  /** RE: hududlar orasidagi farqlarning umumiy tebranishdagi ulushi */
  rho?: number;
  f: number;
  fP: number;
  durbinWatson: number;
  coefficients: FactorCoef[];
  /** Umumiy vaqt trendi (oyiga, daromad birligida) */
  trendPerMonth: number | null;
  note?: string;
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
  /** Qaysi modelga tayanamiz */
  preferred: 'pooled' | 'fixed' | 'random' | null;
  elasticity: ModelTable | null;
  cobbDouglas: {
    n: number;
    r2: number;
    alpha: { value: number; se: number; p: number; lo95: number; hi95: number };
    beta: { value: number; se: number; p: number; lo95: number; hi95: number };
    sum: number;
    sumSe: number;
    sumP: number;
    returns: 'increasing' | 'constant' | 'decreasing';
    /** Umumiy samaradorlikning yillik o'sishi, % */
    tfpGrowthYear: number;
    /** Hududlar TFP indeksi (100 — o'rtacha) */
    tfp: { key: string; name: string; index: number }[];
    text: string;
  } | null;
  /** FE: resurslarga nisbatan kutilganidan ko'p/kam daromad (oyiga) */
  unitEffects: { key: string; name: string; effectTiyin: string; actualTiyin: string; expectedTiyin: string; months: number }[];
  correlation: { keys: string[]; labels: string[]; matrix: (number | null)[][] } | null;
  /** Hudud o'rtachalari (grafik uchun): pul — tiyin (son), xodimlar — kishi */
  regionMeans: { key: string; name: string; months: number; incomeTiyin: number; factors: Record<FactorKey, number> }[];
  points: { key: string; period: string; incomeTiyin: number; factors: Record<FactorKey, number> }[];
  warnings: string[];
  notes: string[];
}

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
  kind: UnitKind;
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
  kind: UnitKind;
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