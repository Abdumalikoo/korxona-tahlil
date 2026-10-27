import { api, type ApiResponse } from '@/lib/api';

// Xarajatlar › Foyda keltirmaydigan bo'limlar (Markaz bo'limlari) — /api/expense-policy/departments, /department/:id

export interface DepListRow {
  id: string;
  name: string;
  isActive: boolean;
  writtenTiyin: string;
  staysTiyin: string;
  incomingTiyin: string;
  resultTiyin: string;
  count: number;
  categories: number;
  rules: number;
}

export interface DepCategoryRow {
  code: string;
  label: string;
  parentCode: string | null;
  group: boolean;
  rule: string | null;
  effective: { target: string; label: string; origin: 'dep' | 'parent' | 'unit' | 'global' | 'none' };
  count: number;
  totalTiyin: string;
  months: Record<string, string>;
  used: boolean;
}

export interface DepView {
  department: { id: string; name: string };
  from: string;
  to: string;
  months: string[];
  targets: { code: string; label: string }[];
  categories: DepCategoryRow[];
  rulesCount: number;
  incoming: { from: string; fromLabel: string; code: string; label: string; count: number; totalTiyin: string }[];
  totals: { writtenTiyin: string; staysTiyin: string; movedOutTiyin: string; incomingTiyin: string; resultTiyin: string; outBy: { target: string; label: string; totalTiyin: string }[] };
}

export const depPolicyApi = {
  list: (from: string, to: string) => api.get<ApiResponse<DepListRow[]>>('/expense-policy/departments', { params: { from, to } }),
  view: (id: string, from: string, to: string) => api.get<ApiResponse<DepView>>(`/expense-policy/department/${encodeURIComponent(id)}`, { params: { from, to } }),
  save: (id: string, rules: Record<string, string>) => api.patch<ApiResponse<{ id: string; rules: Record<string, string>; changed: number }>>(`/expense-policy/department/${encodeURIComponent(id)}`, { rules }),
};
