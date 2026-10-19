import { api, type ApiResponse } from '@/lib/api';
import type { DateRange } from '@/components/shared/date-range-picker';

// ═══════════════════════════════════════════════════════════
// Daromad va xarajat tarkibi — backend bilan bir xil turlar
// ═══════════════════════════════════════════════════════════

export type StructureKind = 'expense' | 'income';
export type SectionFilter = 'ALL' | 'DOIMIY' | 'BOSHQA';
export type LevelKey =
  | 'section'
  | 'group'
  | 'source'
  | 'category'
  | 'place'
  | 'lease'
  | 'vehicle'
  | 'employee'
  | 'records';
export type ModuleKey = 'PAYROLL' | 'LEASE' | 'VEHICLE' | 'REGIONAL';
/** prev — o'tgan teng davr, yoy — o'tgan yilning shu davri */
export type CompareMode = 'prev' | 'yoy';

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
  changePercent: number | null;
  sharePercent: number;
  count: number;
  doimiyTiyin: string;
  boshqaTiyin: string;
  /** Oxirgi 24 oy (StructureTree.months tartibida) */
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

export interface Insights {
  drivers: { key: string; label: string; deltaTiyin: string }[];
  totalDeltaTiyin: string;
  pareto: { key: string; label: string; sharePercent: number; cumulativePercent: number; abc: 'A' | 'B' | 'C' }[];
  paretoCount: number;
  hhi: number;
  effectiveCount: number;
  concentration: 'tarqoq' | "o'rtacha" | 'yuqori';
  anomalies: { key: string; label: string; period: string; z: number; lastTiyin: string; averageTiyin: string }[];
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
  marginPercent: number | null;
  previousMarginPercent: number | null;
  split: { income: SectionSplit; expense: SectionSplit };
  months: string[];
  monthly: { period: string; incomeTiyin: string; expenseTiyin: string }[];
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

export const structureApi = {
  /** flat — «Doimiy / Boshqa» bosqichisiz: birinchi daraja darhol daromad turi yoki xarajat guruhi */
  tree: (kind: StructureKind, range: DateRange, section: SectionFilter, path: string[], compare: CompareMode = 'prev', flat = false) =>
    api.get<ApiResponse<StructureTree>>(`/structure/${kind}/tree`, {
      params: { from: range.from, to: range.to, section, compare, path: path.length ? path.join('~') : undefined, flat: flat ? '1' : undefined },
    }),

  flow: (range: DateRange, section: SectionFilter, compare: CompareMode = 'prev') =>
    api.get<ApiResponse<FlowResult>>('/structure/flow', {
      params: { from: range.from, to: range.to, section, compare },
    }),
};

// ═══════════════════════════════════════════════════════════
// Yorliqlar, ranglar, formatlash
// ═══════════════════════════════════════════════════════════

export const SECTION_OPTIONS: { value: SectionFilter; label: string }[] = [
  { value: 'ALL', label: 'Barchasi' },
  { value: 'DOIMIY', label: 'Doimiy' },
  { value: 'BOSHQA', label: 'Boshqa' },
];

export const COMPARE_OPTIONS: { value: CompareMode; label: string; hint: string }[] = [
  { value: 'prev', label: "O'tgan teng davr", hint: 'Tanlangan davrdan oldingi xuddi shuncha kun' },
  { value: 'yoy', label: "O'tgan yil", hint: "O'tgan yilning xuddi shu sanalari" },
];

export const KIND_TEXT: Record<StructureKind, { title: string; root: string; word: string }> = {
  expense: { title: 'Xarajat tarkibi', root: 'Barcha xarajatlar', word: 'xarajat' },
  income: { title: 'Daromad tarkibi', root: 'Barcha daromadlar', word: 'daromad' },
};

export const LEVEL_HINTS: Record<LevelKey, string> = {
  section: 'Doimiy va bir martalik',
  group: 'Guruhlar va modullar',
  source: 'Pul qayerdan keladi',
  category: 'Turlar',
  place: "Bo'limlar va hududlar",
  lease: 'Ijara shartnomalari',
  vehicle: 'Mashinalar',
  employee: 'Xodimlar',
  records: 'Yozuvlar',
};

/**
 * Rang tizimi — jiddiy va bir xil:
 *  - tarkib (bloklar, ustunlar) — bitta to'q ko'k ohang, katta summa to'qroq;
 *  - yashil / qizil — faqat ma'noli joyda: daromad/xarajat, yaxshi/yomon o'zgarish;
 *  - kulrang — "boshqalar", yordamchi chiziqlar.
 */
export const RAMP = [
  '#1b3354', '#23426a', '#2d527f', '#3a6293', '#4c74a4',
  '#6187b3', '#7a9bc2', '#95b0d0', '#afc3dc', '#c7d5e7', '#dbe4f0',
];
export const TONE = {
  ink: '#0f172a',
  slate: '#475569',
  grid: '#e5e7eb',
  axis: '#94a3b8',
  rest: '#d1d5db',
  income: '#2f7a57',
  incomeSoft: '#cfe5d9',
  expense: '#b3423b',
  expenseSoft: '#f0d4d1',
} as const;

/**
 * O'rin bo'yicha rang: 0 — eng katta (eng to'q).
 * Moddalar kam bo'lsa, ranglar shkala bo'ylab yoyiladi — bir-biridan aniq ajraladi.
 */
export function rampColor(rank: number, count: number): string {
  const last = RAMP.length - 2;
  const step = count > 1 ? Math.max(1, last / (count - 1)) : 1;
  return RAMP[Math.min(Math.round(Math.max(rank, 0) * step), RAMP.length - 1)]!;
}

/** Fon rangiga mos matn rangi */
export function inkOn(color: string): string {
  const i = RAMP.indexOf(color);
  if (i >= 0) return i < 6 ? '#ffffff' : TONE.ink;
  return color === TONE.rest ? TONE.ink : '#ffffff';
}

/** To'liq summa, so'msiz: "1 234 567" */
export function num(tiyin: string | number): string {
  const v = Math.round(Number(tiyin) / 100);
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  return `${v < 0 ? '−' : ''}${s}`;
}

/** To'liq summa: "1 234 567 so'm" */
export function som(tiyin: string | number): string {
  return `${num(tiyin)}\u00A0so'm`;
}

/** "1 234 567 890" tiyin → "12,3 mln" */
export function compact(tiyin: string | bigint | number): string {
  const som = Number(tiyin) / 100;
  const abs = Math.abs(som);
  const sign = som < 0 ? '−' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2).replace('.', ',')} trln`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2).replace('.', ',')} mlrd`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1).replace('.', ',')} mln`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3)} ming`;
  return `${sign}${Math.round(abs)}`;
}

export function pct(value: number | null | undefined, sign = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const prefix = sign && value > 0 ? '+' : value < 0 ? '−' : '';
  return `${prefix}${Math.abs(value).toFixed(1).replace('.', ',')}%`;
}

/** O'zgarish rangi: xarajat o'sishi — yomon, daromad o'sishi — yaxshi */
export function changeTone(kind: StructureKind, change: number | null): string {
  if (change === null || Math.abs(change) < 0.5) return 'text-(--color-text-muted)';
  const good = kind === 'income' ? change > 0 : change < 0;
  return good ? 'text-(--color-income)' : 'text-(--color-expense)';
}