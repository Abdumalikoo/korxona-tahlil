import { api, type ApiResponse } from '@/lib/api';
import type { Calc } from '@/lib/calc';
import { formatPercent, formatPeriod, formatPeriodShort, formatSum } from '@/lib/format';

// ═══════════════════════════════════════════════════════════
// Python tahlil xizmati bilan bir xil turlar (apps/analytics)
// ═══════════════════════════════════════════════════════════

export type ValueUnit =
  | 'som'
  | 'percent'
  | 'pp'
  | 'kishi'
  | 'count'
  | 'index'
  | 'number'
  | 'period'
  | 'text';

export type ParamKey = 'metric' | 'metric2' | 'group_by';

export interface FormulaParam {
  key: ParamKey;
  label: string;
  kind: 'metric' | 'group';
  default: string;
  options: string[] | null;
}

export interface FormulaInfo {

  id: string;
  title: string;
  category: string;
  description: string;
  latex: string;
  /** Formuladagi belgilar izohi */
  symbols: Record<string, string>;
  minPeriods: number;
  params: FormulaParam[];
}

export interface MetricInfo {
  key: string;
  label: string;
  unit: 'som' | 'kishi';
  higherIsBetter: boolean;
}

export interface GroupInfo {
  key: string;
  label: string;
}

export interface ModelCatalog {
  formulas: FormulaInfo[];
  metrics: MetricInfo[];
  groups: GroupInfo[];
}

export interface ResultValue {
  label: string;
  value: number | string | null;

  unit: ValueUnit;
  text: string;
  /** «Qanday hisoblandi?» — tahlil xizmati tayyorlaydi */
  calc?: Calc | null;
}

export interface ChartSeries {
  name: string;
  values: (number | null)[];
  unit: ValueUnit;
}

export interface SeriesChartData {
  type: 'line' | 'bar';
  x: string[];
  series: ChartSeries[];
  /** O'ng o'qdagi qo'shimcha chiziq (masalan, o'sish %) */
  overlay?: ChartSeries;
  /** O'rtacha ± σ oralig'i */
  bands?: { mean: number | null; lower: number | null; upper: number | null };
}

export interface PieChartData {
  type: 'pie';
  x: string[];
  series: ChartSeries[];
}

export interface ScatterPoint {
  x: number | null;
  y: number | null;
  label: string;
}


export interface ScatterChartData {
  type: 'scatter';
  xLabel: string;
  yLabel: string;
  xUnit: ValueUnit;
  yUnit: ValueUnit;
  points: ScatterPoint[];
  line: { slope: number | null; intercept: number | null } | null;
}

export type ChartData = SeriesChartData | PieChartData | ScatterChartData;

export interface TableColumn {
  key: string;
  label: string;
  unit: ValueUnit;
}

export interface ResultTable {
  columns: TableColumn[];
  rows: Record<string, number | string | null>[];
}

export interface FormulaResult {
  headline: ResultValue | null;
  stats: ResultValue[];
  chart: ChartData | null;
  table: ResultTable | null;
  interpretation: string[];
  warnings: string[];
  n: number;
  insufficient: boolean;

}

export interface RunInput {
  start: string;
  end: string;
  metric?: string;
  metric2?: string;
  groupBy?: string;
}

export interface FormulaRun {
  formula: FormulaInfo;
  params: Required<RunInput>;
  result: FormulaResult;
  tookMs: number;
}

export interface ModelingHealth {
  ok: boolean;
  python: string;
  libraries: Record<string, string | null>;
  database: {
    ok: boolean;
    error?: string;
    expenses?: number;
    incomes?: number;
    first_period?: string | null;
    last_period?: string | null;
  };
  formulas: number;
  tookMs: number;
}


// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

export const modelingApi = {
  health: () => api.get<ApiResponse<ModelingHealth>>('/modeling/health'),

  catalog: () => api.get<ApiResponse<ModelCatalog>>('/modeling/formulas'),

  run: (id: string, input: RunInput) =>
    api.post<ApiResponse<FormulaRun>>(`/modeling/formulas/${id}/run`, input),
};

/** Formula parametri → so'rov maydoni */
export const PARAM_INPUT: Record<ParamKey, 'metric' | 'metric2' | 'groupBy'> = {
  metric: 'metric',
  metric2: 'metric2',
  group_by: 'groupBy',
};

// ═══════════════════════════════════════════════════════════
// Formatlash
// ═══════════════════════════════════════════════════════════

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isPeriod(value: unknown): value is string {
  return typeof value === 'string' && PERIOD_RE.test(value);
}

/** Oylar soni (ikkala chet ham kiradi) */

export function monthsBetween(start: string, end: string): number {
  if (!isPeriod(start) || !isPeriod(end)) return 0;
  const [ys, ms] = start.split('-').map(Number);
  const [ye, me] = end.split('-').map(Number);
  return (ye - ys) * 12 + (me - ms) + 1;
}

/** So'mni qisqa ko'rinishda: 12,5 mln so'm */
export function formatSom(value: number, withCurrency = true): string {
  const abs = Math.abs(value);
  const suffix = withCurrency ? '\u00A0so\u2018m' : '';
  if (abs >= 1e9) return `${formatSum(value / 1e9, { decimals: 2 })}\u00A0mlrd${suffix}`;
  if (abs >= 1e6) return `${formatSum(value / 1e6, { decimals: 1 })}\u00A0mln${suffix}`;
  if (abs >= 1e4) return `${formatSum(value / 1e3, { decimals: 0 })}\u00A0ming${suffix}`;
  return `${formatSum(value, { decimals: 0 })}${suffix}`;
}

function formatNumber(value: number, decimals: number): string {
  return formatSum(value, { decimals });
}

/** Qiymatni birligi bo'yicha ko'rsatadi */
export function formatValue(value: number | string | null | undefined, unit: ValueUnit): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return unit === 'period' ? formatPeriod(value) : value;
  if (!Number.isFinite(value)) return '—';

  switch (unit) {
    case 'som':
      return formatSom(value);
    case 'percent':
      return formatPercent(value, { decimals: 1 });

    case 'pp':
      return `${value > 0 ? '+' : ''}${formatNumber(value, 1)}\u00A0p.p.`;
    case 'kishi':
      return `${formatNumber(value, 0)}\u00A0kishi`;
    case 'count':
      return formatNumber(value, Number.isInteger(value) ? 0 : 1);
    case 'index':
      return formatNumber(value, 0);
    case 'number':
      return formatNumber(value, Math.abs(value) < 10 ? 3 : 1);
    default:
      return String(value);
  }
}

/** Grafik o'qi uchun qisqa yozuv */
export function formatAxis(value: number, unit: ValueUnit): string {
  if (!Number.isFinite(value)) return '';
  switch (unit) {
    case 'som':
      return formatSom(value, false);
    case 'percent':
      return `${formatNumber(value, Math.abs(value) < 10 && !Number.isInteger(value) ? 1 : 0)}%`;
    case 'pp':
      return formatNumber(value, 1);
    default: {
      const abs = Math.abs(value);
      if (abs >= 1e6) return `${formatNumber(value / 1e6, 1)} mln`;
      if (abs >= 1e4) return `${formatNumber(value / 1e3, 0)} ming`;
      return formatNumber(value, Number.isInteger(value) ? 0 : 2);
    }
  }

}

/** O'q yorlig'i: "2026-03" → "Mar 26", boshqasi o'zicha */
export function formatCategory(value: string): string {
  return isPeriod(value) ? formatPeriodShort(value) : value;
}

/** Grafiklar uchun umumiy ranglar */
export const CHART_COLORS = [
  'var(--color-brand-600, #2563eb)',
  '#f59e0b',
  '#10b981',
  '#8b5cf6',
  '#ef4444',
  '#06b6d4',
  '#84cc16',
  '#ec4899',
  '#64748b',
  '#f97316',
];

export const OVERLAY_COLOR = '#f59e0b';