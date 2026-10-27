import { api, type ApiResponse } from '@/lib/api';

// Daromadlar › Qo'mita mablag'lari — /api/qomita/*

export interface QomitaItemView {
  id: string;
  departmentId: string;
  departmentName: string;
  incomeCode: string;
  incomeLabel: string;
  components: { code: string; name: string }[];
  categories: { code: string; label: string }[];
  note: string | null;
}

export interface QomitaConfigView {
  items: QomitaItemView[];
  departments: { id: string; name: string }[];
  components: { code: string; name: string; group: string }[];
  categories: { code: string; label: string; group: string | null; isLeaf: boolean }[];
}

export interface QomitaMonth {
  allocated: string;
  payroll: string;
  other: string;
}

export interface QomitaRowView {
  /** Bo'lim id; «-» — bo'lim ko'rsatilmagan Qo'mita daromadi */
  key: string;
  label: string;
  incomeCode: string | null;
  components: { code: string; name: string }[];
  categories: { code: string; label: string }[];
  allocatedTiyin: string;
  payrollTiyin: string;
  otherTiyin: string;
  coveredTiyin: string;
  balanceTiyin: string;
  months: Record<string, QomitaMonth>;
}

export interface QomitaReport {
  from: string;
  to: string;
  months: string[];
  tarkibMissing: string[];
  rows: QomitaRowView[];
  totals: { allocatedTiyin: string; payrollTiyin: string; otherTiyin: string; coveredTiyin: string; balanceTiyin: string };
}

export interface QomitaDetail {
  key: string;
  label: string;
  months: string[];
  incomeCode: string | null;
  incomes: { id: string; date: string; period: string; amountTiyin: string; description: string | null; clientName: string | null; documentNo: string | null; origin: 'BANK' | 'MANUAL' | 'OTHER' }[];
  payrollParts: { code: string; name: string; totalTiyin: string; months: Record<string, string> }[];
  employees: { pinfl: string; fullName: string; totalTiyin: string; parts: Record<string, string>; months: Record<string, string> }[];
  categories: { code: string; label: string; totalTiyin: string; months: Record<string, string>; sub: string | null }[];
  tarkibMissing: string[];
}

export interface QomitaBankRow {
  account: string;
  accountLabel: string;
  rowId: string;
  docDate: string;
  docNo: string;
  payer: string;
  amountTiyin: string;
  purpose: string;
  matched: boolean;
}

export const qomitaApi = {
  config: () => api.get<ApiResponse<QomitaConfigView>>('/qomita/config'),
  saveItem: (body: { departmentId: string; components: string[]; categories: string[]; note?: string }) =>
    api.put<ApiResponse<{ item: unknown; recalculated: boolean; warning: string | null }>>('/qomita/item', body),
  removeItem: (departmentId: string) => api.delete<ApiResponse<{ removed: boolean; warning: string | null }>>(`/qomita/item/${encodeURIComponent(departmentId)}`),
  report: (from: string, to: string) => api.get<ApiResponse<QomitaReport>>('/qomita/report', { params: { from, to } }),
  detail: (key: string, from: string, to: string) => api.get<ApiResponse<QomitaDetail>>(`/qomita/detail/${encodeURIComponent(key)}`, { params: { from, to } }),
  addIncome: (body: { departmentId: string; period: string; date?: string; amount: string; description?: string }) => api.post<ApiResponse<{ id: string; amountTiyin: string }>>('/qomita/income', body),
  removeIncome: (id: string) => api.delete<ApiResponse<{ removed: boolean }>>(`/qomita/income/${encodeURIComponent(id)}`),
  bank: (q?: string) => api.get<ApiResponse<{ total: number; items: QomitaBankRow[] }>>('/qomita/bank', { params: q ? { q } : {} }),
  bankRoute: (body: { items: { account: string; rowId: string }[]; departmentId: string; description?: string; skipDuplicates?: boolean; force?: boolean }) =>
    api.post<ApiResponse<{ count: number; totalTiyin: string; skipped: number }>>('/qomita/bank', body),
};
