import { api, type ApiResponse } from "@/lib/api";
import type { Department, Category, CategoryTree, IncomeCategory } from "@/lib/types";

export interface CreateCategoryPayload {
  code?: string;
  label: string;
  parentCode?: string | null;
  behavior?: "FIXED" | "VARIABLE" | "MIXED";
  scope?: "DEPARTMENT" | "GENERAL";
  keywords?: string[];
  order?: number;
  isActive?: boolean;
}

export type UpdateCategoryPayload = Partial<Omit<CreateCategoryPayload, "code" | "parentCode">>;

export const referencesApi = {
  departments: () => api.get<ApiResponse<Department[]>>("/departments"),

  /** Yozuv kiritish uchun yaroqli kategoriyalar (faqat barglar) */
  expenseLeaves: () => api.get<ApiResponse<Category[]>>("/categories/leaves"),

  /** Daraxt korinishida - filtr va guruhlash uchun */
  expenseTree: (includeInactive = false) =>
    api.get<ApiResponse<CategoryTree[]>>("/categories/tree", {
      params: { includeInactive },
    }),

  /** Tekis royxat - sozlamalar uchun */
  expenseCategories: (includeInactive = false) =>
    api.get<ApiResponse<Category[]>>("/categories", {
      params: { includeInactive },
    }),

  incomeCategories: () => api.get<ApiResponse<IncomeCategory[]>>("/categories/income"),
};

export const categoriesApi = {
  create: (payload: CreateCategoryPayload) =>
    api.post<ApiResponse<Category>>("/categories", payload),

  update: (code: string, payload: UpdateCategoryPayload) =>
    api.patch<ApiResponse<Category>>(`/categories/${code}`, payload),

  archive: (code: string) =>
    api.patch<ApiResponse<Category>>(`/categories/${code}/archive`),

  usage: (code: string) =>
    api.get<ApiResponse<{ expenses: number }>>(`/categories/${code}/usage`),
};