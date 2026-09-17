import { api, type ApiResponse } from "@/lib/api";
import type { Expense, Income } from "@/lib/types";

export interface TrashStats {
  expenses: number;
  incomes: number;
  total: number;
  retentionDays: number;
  expiringSoon: number;
}

export const trashApi = {
  /** Savatdagi xarajatlar */
  expenses: (period?: string) =>
    api.get<ApiResponse<Expense[]>>("/expenses/deleted", { params: { period } }),

  /** Savatdagi daromadlar */
  incomes: (period?: string) =>
    api.get<ApiResponse<Income[]>>("/incomes/deleted", { params: { period } }),

  restoreExpense: (id: string) =>
    api.post<ApiResponse<Expense>>(`/expenses/${id}/restore`),

  /** Savatdagi yozuvlar soni */
  stats: () => api.get<ApiResponse<TrashStats>>("/trash/stats"),

  /** Muddati otganlarni tozalash */
  cleanupExpired: () =>
    api.post<ApiResponse<{ expenses: number; incomes: number }>>("/trash/cleanup"),

  /** Savatni butunlay bosatish */
  empty: () =>
    api.post<ApiResponse<{ expenses: number; incomes: number }>>("/trash/empty"),

  restoreIncome: (id: string) =>
    api.post<ApiResponse<Income>>(`/incomes/${id}/restore`),
};