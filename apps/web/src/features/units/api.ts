import { api, type ApiResponse } from '@/lib/api';
import { useAsync } from '@/lib/use-async';

// Kiritish bo'limlari moddalari — /api/unit-categories

export type EntryKind = 'expense' | 'income';

export interface UnitCategoryList {
  code: string;
  label: string;
  /** null — umumiy (hamma moddalar ochiq) */
  codes: string[] | null;
}

export interface UnitCategoriesData {
  kind: EntryKind;
  units: UnitCategoryList[];
}

export const unitCategoriesApi = {
  get: (kind: EntryKind) => api.get<ApiResponse<UnitCategoriesData>>('/unit-categories', { params: { kind } }),
  set: (kind: EntryKind, unit: string, codes: string[] | null) => api.patch<ApiResponse<UnitCategoriesData>>('/unit-categories', { kind, unit, codes }),
};

/** Bo'limlar ro'yxatlari: bo'lim kodi → moddalar (null — umumiy) */
export function useUnitCategories(kind: EntryKind) {
  const res = useAsync(() => unitCategoriesApi.get(kind).then((r) => r.data), [kind]);
  const lists = new Map<string, string[] | null>((res.data?.units ?? []).map((u) => [u.code, u.codes]));
  return { lists, loading: res.loading, error: res.error, reload: res.reload, data: res.data };
}