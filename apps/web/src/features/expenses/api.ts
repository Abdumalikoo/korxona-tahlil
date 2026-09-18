import { api, getToken, type ApiResponse, type PaginatedResponse } from "@/lib/api";
import type {
  Expense,
  CategorySummaryRow,
  DepartmentSummaryRow,
  TrendPoint,
  ComparisonResult,
  BehaviorSummary,
  PaymentMethod,
  PaymentStatus,
  RegionSummaryRow,
} from "@/lib/types";

export interface ExpenseFilters {
  period?: string;
  periodFrom?: string;
  periodTo?: string;
  /** Sana oraligi - eng aniq filtr */
  dateFrom?: string;
  dateTo?: string;
  departmentId?: string;
  regionCode?: number;
  categoryCode?: string;
  rootCategoryCode?: string;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: SortField;
  sortOrder?: SortOrder;
}

export type SortField = 'date' | 'amountTiyin' | 'categoryCode';
export type SortOrder = 'asc' | 'desc';

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
  regionCode?: number;
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

/**
 * Excel faylni yuklab oladi.
 *
 * Oddiy havola ishlamaydi - token Authorization sarlavhasida
 * yuborilishi kerak. Shuning uchun fayl blob sifatida olinadi
 * va vaqtinchalik havola orqali brauzerga beriladi.
 */
export async function downloadExpensesExcel(filters: ExpenseFilters): Promise<void> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  search.delete('page');
  search.delete('limit');

  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
  const token = getToken();

  const response = await fetch(`${base}/expenses/export?${search.toString()}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error('Faylni yuklab bolmadi');
  }

  // Fayl nomini serverdan olamiz
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : 'Xarajatlar.xlsx';

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

export interface SpikeRow {
  categoryCode: string;
  label: string;
  currentTiyin: string;
  previousTiyin: string;
  diffTiyin: string;
  changePercent: number | null;
  isNew: boolean;
}

export interface SpikesResult {
  period: string;
  previousPeriod: string;
  thresholdPercent: number;
  rows: SpikeRow[];
}

export interface GroupSummaryRow {
  code: string;
  label: string;
  amountTiyin: string;
  previousTiyin: string;
  count: number;
  sharePercent: number;
  changePercent: number | null;
}

/** Daraxt korinishidagi tarkib */
export interface BreakdownNode {
  key: string;
  label: string;
  amountTiyin: string;
  count: number;
  sharePercent: number;
  children: BreakdownNode[];
}

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

  /** Oxshash yozuv bor-yoqligini tekshiradi */
  similar: (params: {
    date: string;
    amountTiyin: number;
    categoryCode: string;
    excludeId?: string;
  }) =>
    api.get<ApiResponse<{ items: Expense[]; count: number }>>("/expenses/similar", {
      params,
    }),

  spikes: (period: string, threshold = 30, departmentId?: string) =>
    api.get<ApiResponse<SpikesResult>>("/expenses/spikes", {
      params: { period, threshold, departmentId },
    }),

  /** Bir nechta yozuvni birdan ochirish */
  removeMany: (ids: string[]) =>
    api.post<ApiResponse<{ count: number }>>("/expenses/bulk-delete", { ids }),

  /** Filtrga mos hammasini ochirish */
  removeByFilter: (filters: ExpenseFilters) =>
    api.post<ApiResponse<{ count: number }>>("/expenses/delete-by-filter", undefined, {
      params: filters,
    }),

  /** Filtrga nechta yozuv mos kelishi */
  countByFilter: (filters: ExpenseFilters) =>
    api.get<ApiResponse<{ count: number }>>("/expenses/count", { params: filters }),

  restore: (id: string) =>
    api.post<ApiResponse<Expense>>(`/expenses/${id}/restore`),

  deleted: (period?: string) =>
    api.get<ApiResponse<Expense[]>>("/expenses/deleted", { params: { period } }),

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

  /** Ildiz guruhlar kesimi */
  /** Daraxt korinishidagi tarkib */
  breakdown: (filters: ExpenseFilters) =>
    api.get<ApiResponse<{ rows: BreakdownNode[]; totalTiyin: string }>>(
      "/expenses/breakdown",
      { params: filters },
    ),

  summaryByGroup: (filters: ExpenseFilters) =>
    api.get<ApiResponse<{ rows: GroupSummaryRow[]; totalTiyin: string }>>(
      "/expenses/summary/group",
      { params: filters },
    ),

  /** Eng katta yozuvlar */
  top: (filters: ExpenseFilters, limit = 5) =>
    api.get<ApiResponse<Expense[]>>("/expenses/top", {
      params: { ...filters, limit },
    }),

  summaryByRegion: (filters: ExpenseFilters) =>
    api.get<ApiResponse<{ rows: RegionSummaryRow[]; totalTiyin: string }>>(
      "/expenses/summary/region",
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
