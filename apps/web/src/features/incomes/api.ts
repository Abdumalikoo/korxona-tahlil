import { api, getToken, type ApiResponse, type PaginatedResponse } from '@/lib/api';
import type {
  Income,
  CategorySummaryRow,
  DepartmentSummaryRow,
  TrendPoint,
  ComparisonResult,
  AbcRow,
  PaymentMethod,
  PaymentStatus,
} from '@/lib/types';

export interface IncomeFilters {
  period?: string;
  periodFrom?: string;
  periodTo?: string;
  departmentId?: string;
  categoryCode?: string;
  paymentStatus?: PaymentStatus;
  search?: string;
  page?: number;
  limit?: number;
}

export interface IncomeListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sumTiyin: string;
  paidTiyin: string;
  /** Hisoblangan, lekin tushmagan summa */
  receivableTiyin: string;
}

export interface CreateIncomePayload {
  date: string;
  amountTiyin: number;
  paidTiyin?: number;
  categoryCode: string;
  departmentId?: string;
  clientName?: string;
  description?: string;
  contractNo?: string;
  paymentStatus?: PaymentStatus;
  paymentMethod?: PaymentMethod;
}

export type UpdateIncomePayload = Partial<CreateIncomePayload>;

export interface IncomeCategorySummary {
  categoryCode: string;
  label: string;
  amountTiyin: string;
  paidTiyin: string;
  count: number;
  sharePercent: number;
}

export interface AbcResult {
  rows: AbcRow[];
  totalTiyin: string;
  summary: { A: number; B: number; C: number };
}

export interface ReceivablesResult {
  items: Income[];
  totalTiyin: string;
  count: number;
}

export const incomesApi = {
  list: (filters: IncomeFilters) =>
    api.get<PaginatedResponse<Income> & { meta: IncomeListMeta }>('/incomes', {
      params: filters,
    }),

  getOne: (id: string) => api.get<ApiResponse<Income>>(`/incomes/${id}`),

  create: (payload: CreateIncomePayload) =>
    api.post<ApiResponse<Income>>('/incomes', payload),

  update: (id: string, payload: UpdateIncomePayload) =>
    api.patch<ApiResponse<Income>>(`/incomes/${id}`, payload),

  remove: (id: string) => api.delete<ApiResponse<{ success: true }>>(`/incomes/${id}`),

  removeMany: (ids: string[]) =>
    api.post<ApiResponse<{ count: number }>>("/incomes/bulk-delete", { ids }),

  removeByFilter: (filters: IncomeFilters) =>
    api.post<ApiResponse<{ count: number }>>("/incomes/delete-by-filter", undefined, {
      params: filters,
    }),

  countByFilter: (filters: IncomeFilters) =>
    api.get<ApiResponse<{ count: number }>>("/incomes/count", { params: filters }),

  restore: (id: string) => api.post<ApiResponse<Income>>(`/incomes/${id}/restore`),

  deleted: (period?: string) =>
    api.get<ApiResponse<Income[]>>("/incomes/deleted", { params: { period } }),

  summaryByCategory: (filters: IncomeFilters) =>
    api.get<ApiResponse<{ rows: IncomeCategorySummary[]; totalTiyin: string }>>(
      '/incomes/summary/category',
      { params: filters },
    ),

  summaryByDepartment: (filters: IncomeFilters) =>
    api.get<ApiResponse<{ rows: DepartmentSummaryRow[]; totalTiyin: string }>>(
      '/incomes/summary/department',
      { params: filters },
    ),

  abc: (filters: IncomeFilters) =>
    api.get<ApiResponse<AbcResult>>('/incomes/abc', { params: filters }),

  receivables: (filters: IncomeFilters) =>
    api.get<ApiResponse<ReceivablesResult>>('/incomes/receivables', {
      params: filters,
    }),

  trend: (months = 12, departmentId?: string) =>
    api.get<ApiResponse<TrendPoint[]>>('/incomes/trend', {
      params: { months, departmentId },
    }),

  comparison: (period: string, departmentId?: string) =>
    api.get<ApiResponse<ComparisonResult>>('/incomes/comparison', {
      params: { period, departmentId },
    }),
};
