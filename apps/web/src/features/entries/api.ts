import { api, type ApiResponse } from '@/lib/api';

/** Bugun kiritilgan yozuv (xarajat, daromad, ombor hujjati yoki Excel yuklash) */
export interface EntryItem {
  id: string;
  at: string;
  type: 'EXPENSE' | 'INCOME' | 'STOCK' | 'IMPORT';
  title: string;
  subtitle: string | null;
  amountTiyin: string | null;
  href: string;
  by: string | null;
}

export interface EntriesToday {
  date: string;
  items: EntryItem[];
  totals: { count: number; expenseTiyin: string; incomeTiyin: string; stockDocs: number };
}

/** «Boshlash» ro'yxati qadami */
export interface SetupStep {
  key: string;
  label: string;
  hint: string;
  href: string;
  done: boolean;
  count: number;
}

export interface SetupStatus {
  steps: SetupStep[];
  done: number;
  total: number;
}

export const entriesApi = {
  /** «Boshlash» ro'yxati: nima to'ldirilgan, nima qolgan */
  setup: () => api.get<ApiResponse<SetupStatus>>('/entries/setup'),

  /** date — "YYYY-MM-DD" (bo'lmasa bugun) */
  today: (date?: string) => api.get<ApiResponse<EntriesToday>>('/entries/today', { params: { date } }),
};