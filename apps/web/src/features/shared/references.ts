import { api, type ApiResponse } from '@/lib/api';
import type { Category, CategoryTree, Department, IncomeCategory } from '@/lib/types';

export const referencesApi = {
  departments: () => api.get<ApiResponse<Department[]>>('/departments'),

  /** Yozuv kiritish uchun yaroqli kategoriyalar (faqat barglar) */
  expenseLeaves: () => api.get<ApiResponse<Category[]>>('/categories/leaves'),

  /** Daraxt ko'rinishida - filtr va guruhlash uchun */
  expenseTree: () => api.get<ApiResponse<CategoryTree[]>>('/categories/tree'),

  incomeCategories: () => api.get<ApiResponse<IncomeCategory[]>>('/categories/income'),
};
