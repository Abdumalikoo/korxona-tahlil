import { api, type ApiResponse } from '@/lib/api';

export interface PeriodTotals {
  period: string;
  incomeTiyin: string;
  paidTiyin: string;
  expenseTiyin: string;
  profitTiyin: string;
}

export interface OverviewCurrent extends PeriodTotals {
  marginPercent: number | null;
  incomeCount: number;
  expenseCount: number;
}

export interface OverviewCompare extends PeriodTotals {
  incomeChange: number | null;
  expenseChange: number | null;
  profitChange: number | null;
}

export interface Overview {
  current: OverviewCurrent;
  previous: OverviewCompare;
  lastYear: OverviewCompare;
}

export interface TrendPoint {
  period: string;
  incomeTiyin: string;
  expenseTiyin: string;
  profitTiyin: string;
}

export interface DepartmentRow {
  departmentId: string | null;
  name: string;
  index: number;
  incomeTiyin: string;
  expenseTiyin: string;
  profitTiyin: string;
  marginPercent: number | null;
}

export interface DepartmentPnL {
  rows: DepartmentRow[];
  totals: {
    incomeTiyin: string;
    expenseTiyin: string;
    profitTiyin: string;
    marginPercent: number | null;
  };
}

export interface RegionPnLRow {
  regionCode: number;
  name: string;
  incomeTiyin: string;
  expenseTiyin: string;
  profitTiyin: string;
  marginPercent: number | null;
  /** Har 1 som daromadga qancha xarajat */
  costRatio: number | null;
}

export interface RegionPnL {
  rows: RegionPnLRow[];
  totals: {
    incomeTiyin: string;
    expenseTiyin: string;
    profitTiyin: string;
    marginPercent: number | null;
  };
}

export interface SpikeRow {
  categoryCode: string;
  label: string;
  currentTiyin: string;
  previousTiyin: string;
  changePercent: number | null;
  isNew: boolean;
}

export interface Alerts {
  spikes: SpikeRow[];
  payable: { totalTiyin: string; count: number };
  receivable: { totalTiyin: string; count: number };
}

export interface StructureRow {
  code: string;
  label: string;
  amountTiyin: string;
  sharePercent: number;
}

export interface ExpenseStructure {
  rows: StructureRow[];
  totalTiyin: string;
}

// ─────── Nima ozgardi ───────

export type InsightKind = 'up' | 'down' | 'new' | 'gone';
export type InsightArea = 'expense' | 'income';

export interface Insight {
  kind: InsightKind;
  area: InsightArea;
  subject: string;
  message: string;
  currentTiyin: string;
  previousTiyin: string;
  diffTiyin: string;
  changePercent: number | null;
}

export interface InsightsResult {
  insights: Insight[];
  currentRange: { from: string; to: string };
  previousRange: { from: string; to: string };
}

// ─────── Bolim reytingi ───────

export interface DepartmentRating {
  departmentId: string | null;
  name: string;
  incomeTiyin: string;
  expenseTiyin: string;
  profitTiyin: string;
  marginPercent: number | null;
  employeeCount: number;
  perEmployeeTiyin: string | null;
}

export interface RatingResult {
  rows: DepartmentRating[];
  best: DepartmentRating | null;
  worst: DepartmentRating | null;
}

// ─────── Xodim boshiga ───────

export interface PerEmployeeMetrics {
  employeeCount: number;
  incomePerEmployeeTiyin: string;
  expensePerEmployeeTiyin: string;
  payrollPerEmployeeTiyin: string;
  payrollSharePercent: number | null;
  totalIncomeTiyin: string;
  totalExpenseTiyin: string;
  totalPayrollTiyin: string;
}

// ─────── Savollar ───────

export interface AnswerResult {
  question: string;
  answer: string;
  details: { label: string; value: string }[];
}

export const dashboardApi = {
  /** Nima ozgardi */
  insights: (dateFrom: string, dateTo: string) =>
    api.get<ApiResponse<InsightsResult>>("/dashboard/insights", {
      params: { dateFrom, dateTo },
    }),

  /** Bolimlar reytingi */
  rating: (dateFrom: string, dateTo: string) =>
    api.get<ApiResponse<RatingResult>>("/dashboard/rating", {
      params: { dateFrom, dateTo },
    }),

  /** Xodim boshiga korsatkichlar */
  perEmployee: (dateFrom: string, dateTo: string) =>
    api.get<ApiResponse<PerEmployeeMetrics>>("/dashboard/per-employee", {
      params: { dateFrom, dateTo },
    }),

  /** Tayyor savolga javob */
  answer: (question: string, dateFrom: string, dateTo: string) =>
    api.get<ApiResponse<AnswerResult>>(`/dashboard/answer/${question}`, {
      params: { dateFrom, dateTo },
    }),

  overview: (period: string) =>
    api.get<ApiResponse<Overview>>('/dashboard/overview', { params: { period } }),

  trend: (months = 12, from?: string) =>
    api.get<ApiResponse<TrendPoint[]>>('/dashboard/trend', {
      params: { months, from },
    }),

  departments: (period: string) =>
    api.get<ApiResponse<DepartmentPnL>>('/dashboard/departments', {
      params: { period },
    }),

  regions: (period: string) =>
    api.get<ApiResponse<RegionPnL>>("/dashboard/regions", { params: { period } }),

  alerts: (period: string) =>
    api.get<ApiResponse<Alerts>>('/dashboard/alerts', { params: { period } }),

  expenseStructure: (period: string) =>
    api.get<ApiResponse<ExpenseStructure>>('/dashboard/expense-structure', {
      params: { period },
    }),
};
