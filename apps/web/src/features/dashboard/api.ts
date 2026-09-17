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

export const dashboardApi = {
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
