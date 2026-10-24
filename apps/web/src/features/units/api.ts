import { api, type ApiResponse } from '@/lib/api';
import { useAsync } from '@/lib/use-async';

// Kiritish bo'limlari moddalari — /api/unit-categories

export type EntryKind = 'expense' | 'income';

export interface UnitCategoryList {
  code: string;
  label: string;
  /** Shu bo'lim moddalari (boshida bo'sh) */
  codes: string[];
}

export interface UnitCategoriesData {
  kind: EntryKind;
  units: UnitCategoryList[];
}

export const unitCategoriesApi = {
  get: (kind: EntryKind) => api.get<ApiResponse<UnitCategoriesData>>('/unit-categories', { params: { kind } }),
  set: (kind: EntryKind, unit: string, codes: string[]) => api.patch<ApiResponse<UnitCategoriesData>>('/unit-categories', { kind, unit, codes }),
  /** Bo'limga yangi modda (xarajatda: parentCode bo'lmasa — guruh) yoki xizmat turi */
  addItem: (kind: EntryKind, unit: string, label: string, parentCode?: string | null) =>
    api.post<ApiResponse<UnitCategoriesData & { code: string }>>('/unit-categories/item', { kind, unit, label, parentCode: parentCode ?? null }),
};

/** Bo'limlar ro'yxatlari: bo'lim kodi → moddalar (yuklanmaguncha — Map bo'sh) */
export function useUnitCategories(kind: EntryKind) {
  const res = useAsync(() => unitCategoriesApi.get(kind).then((r) => r.data), [kind]);
  const lists = new Map<string, string[]>((res.data?.units ?? []).map((u) => [u.code, u.codes ?? []]));
  return { lists, loading: res.loading, error: res.error, reload: res.reload, data: res.data };
}