import { api, type ApiResponse, type PaginatedResponse } from "@/lib/api";
import type {
  Expense,
  CategorySummaryRow,
  DepartmentSummaryRow,
  TrendPoint,
  ComparisonResult,
  BehaviorSummary,
  PaymentMethod,
  PaymentStatus,
} from "@/lib/types";

export interface ExpenseFilters {
  period?: string;
  periodFrom?: string;
  periodTo?: string;
  departmentId?: string;
  categoryCode?: string;
  rootCategoryCode?: string;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ExpenseListMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sumTiyin: string;
  /** Tolanmagan va qisman tolangan xarajatlar - kreditorlik qarzi */
  unpaidTiyin: string;
  unpaidCount: number;
}

export interface CreateExpensePayload {
  date: string;
  amountTiyin: number;
  categoryCode: string;
  departmentId?: string;
  description?: string;
  paymentMethod?: PaymentMethod;
  documentNo?: string;
  counterparty?: string;
  paymentStatus?: PaymentStatus;
  dueDate?: string;
  responsible?: string;
  vatTiyin?: number;
}

export type UpdateExpensePayload = Partial<CreateExpensePayload>;

export const expensesApi = {
  list: (filters: ExpenseFilters) =>
    api.get<PaginatedResponse<Expense> & { meta: ExpenseListMeta }>("/expenses", {
      params: filters,
    }),

  getOne: (id: string) => api.get<ApiResponse<Expense>>(`/expenses/${id}`),

  create: (payload: CreateExpensePayload) =>
    api.post<ApiResponse<Expense>>("/expenses", payload),

  update: (id: string, payload: UpdateExpensePayload) =>
    api.patch<ApiResponse<Expense>>(`/expenses/${id}`, payload),

  remove: (id: string) => api.delete<ApiResponse<{ success: true }>>(`/expenses/${id}`),

  summaryByCategory: (filters: ExpenseFilters) =>
    api.get<ApiResponse<{ rows: CategorySummaryRow[]; totalTiyin: string }>>(
      "/expenses/summary/category",
      { params: filters },
    ),

  summaryByDepartment: (filters: ExpenseFilters) =>
    api.get<ApiResponse<{ rows: DepartmentSummaryRow[]; totalTiyin: string }>>(
      "/expenses/summary/department",
      { params: filters },
    ),

  summaryByBehavior: (filters: ExpenseFilters) =>
    api.get<ApiResponse<BehaviorSummary>>("/expenses/summary/behavior", {
      params: filters,
    }),

  trend: (months = 12, departmentId?: string) =>
    api.get<ApiResponse<TrendPoint[]>>("/expenses/trend", {
      params: { months, departmentId },
    }),

  comparison: (period: string, departmentId?: string) =>
    api.get<ApiResponse<ComparisonResult>>("/expenses/comparison", {
      params: { period, departmentId },
    }),
};