// ═══════════════════════════════════════════════════════════
// Daromad va xarajat tarkibi — turlar
// ═══════════════════════════════════════════════════════════

export type StructureKind = 'expense' | 'income';
export type SectionFilter = 'ALL' | 'DOIMIY' | 'BOSHQA';

/** Ichma-ich kirish darajalari */
export type LevelKey =
  | 'section' // Doimiy / Boshqa
  | 'group' // Xarajat guruhi yoki modul (ish haqi, ijara, mashinalar)
  | 'source' // Daromad manbai: hududlar tushumi / shartnomalar
  | 'category' // Kategoriya yoki xizmat turi
  | 'place' // Markaz bo'limi, hudud yoki umumkorxona
  | 'lease' // Ijara shartnomasi
  | 'vehicle' // Mashina
  | 'employee' // Xodim (ish haqi)
  | 'records'; // Yozuvlar ro'yxati

export const LEVEL_LABELS: Record<LevelKey, string> = {
  section: "Bo'lim",
  group: 'Guruh',
  source: 'Manba',
  category: 'Tur',
  place: 'Joy',
  lease: 'Shartnoma',
  vehicle: 'Mashina',
  employee: 'Xodim',
  records: 'Yozuvlar',
};

export type ModuleKey = 'PAYROLL' | 'LEASE' | 'VEHICLE' | 'REGIONAL';

/** Nima bilan solishtiriladi: o'tgan teng davr yoki o'tgan yilning shu davri */
export type CompareMode = 'prev' | 'yoy';

export const COMPARE_LABELS: Record<CompareMode, string> = {
  prev: "o'tgan teng davr",
  yoy: "o'tgan yilning shu davri",
};

/** Trend oynasi: oxirgi 24 oy (joriy yil + o'tgan yil bilan solishtirish uchun) */
export const TREND_MONTHS = 24;

export interface DateRange {
  from: string;
  to: string;
}

export interface PathStep {
  level: LevelKey;
  key: string;
  label: string;
}

export interface StructureNode {
  key: string;
  label: string;
  level: LevelKey;
  amountTiyin: string;
  previousTiyin: string;
  /** O'tgan teng davrga nisbatan, %; bazasi 0 bo'lsa null */
  changePercent: number | null;
  /** Ota tugun ichidagi ulushi, % */
  sharePercent: number;
  count: number;
  /** Joriy davrdagi Doimiy va Boshqa bo'lim summalari */
  doimiyTiyin: string;
  boshqaTiyin: string;
  /** Oxirgi 24 oy (months bilan bir xil tartibda) */
  trend: string[];
  drillable: boolean;
  module: ModuleKey | null;
}

export interface StructureRecord {
  id: string;
  date: string;
  label: string;
  detail: string | null;
  place: string;
  amountTiyin: string;
}

export interface Driver {
  key: string;
  label: string;
  deltaTiyin: string;
}

export interface ParetoItem {
  key: string;
  label: string;
  sharePercent: number;
  cumulativePercent: number;
  abc: 'A' | 'B' | 'C';
}

export interface Anomaly {
  key: string;
  label: string;
  period: string;
  z: number;
  lastTiyin: string;
  averageTiyin: string;
}

export interface Insights {
  drivers: Driver[];
  totalDeltaTiyin: string;
  pareto: ParetoItem[];
  /** 80% ni tashkil qiluvchi tugunlar soni */
  paretoCount: number;
  hhi: number;
  effectiveCount: number;
  concentration: 'tarqoq' | "o'rtacha" | 'yuqori';
  anomalies: Anomaly[];
  /** Faqat eng yuqori darajada: oylar kesimida Doimiy / Boshqa (24 oy) */
  sectionTrend: { period: string; doimiyTiyin: string; boshqaTiyin: string }[] | null;
  notes: string[];
}

export interface StructureTree {
  kind: StructureKind;
  section: SectionFilter;
  compare: CompareMode;
  compareLabel: string;
  range: DateRange;
  previousRange: DateRange;
  months: string[];
  path: PathStep[];
  level: LevelKey;
  levelLabel: string;
  /** Keyingi daraja (tugun bosilganda) */
  nextLevel: LevelKey | null;
  totalTiyin: string;
  previousTotalTiyin: string;
  changePercent: number | null;
  count: number;
  totalTrend: string[];
  nodes: StructureNode[];
  records: StructureRecord[] | null;
  recordsTotal: number;
  insights: Insights | null;
}

export interface FlowPart {
  key: string;
  label: string;
  amountTiyin: string;
  previousTiyin: string;
}

export interface SectionSplit {
  doimiyTiyin: string;
  boshqaTiyin: string;
  previousDoimiyTiyin: string;
  previousBoshqaTiyin: string;
}

export interface FlowResult {
  section: SectionFilter;
  compare: CompareMode;
  compareLabel: string;
  range: DateRange;
  previousRange: DateRange;
  income: { totalTiyin: string; previousTiyin: string; parts: FlowPart[] };
  expense: { totalTiyin: string; previousTiyin: string; parts: FlowPart[] };
  profitTiyin: string;
  previousProfitTiyin: string;
  /** Rentabellik: foyda / daromad, % */
  marginPercent: number | null;
  previousMarginPercent: number | null;
  /** Doimiy / Boshqa kesimi (joriy va solishtirilayotgan davr) */
  split: { income: SectionSplit; expense: SectionSplit };
  months: string[];
  monthly: { period: string; incomeTiyin: string; expenseTiyin: string }[];
}