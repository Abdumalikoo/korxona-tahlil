import { api, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Bo'lim xarajatlari siyosati: /api/expense-policy/unit/:unit
// ═══════════════════════════════════════════════════════════

export interface UnitPolicyCategory {
  code: string;
  label: string;
  parentCode: string | null;
  group: boolean;
  /** Bo'lim moddalari ro'yxatida */
  listed: boolean;
  /** Shu moddaning o'z qoidasi (maqsad bo'lim kodi) */
  rule: string | null;
  /** unit — o'z qoidasi; parent — guruh qoidasi; global — umumiy siyosat; none — yozilgan joyida */
  effective: { target: string; targetLabel: string; origin: 'unit' | 'parent' | 'global' | 'none' };
  /** Bo'lim qoidasi bo'lmasa — umumiy siyosat bo'yicha kim hisobida */
  globalTarget: string;
  count: number;
  totalTiyin: string;
}

export interface UnitPolicyView {
  unit: string;
  label: string;
  from: string;
  to: string;
  targets: { code: string; label: string }[];
  categories: UnitPolicyCategory[];
  incoming: { source: string; sourceLabel: string; code: string; label: string; count: number; totalTiyin: string }[];
  rulesCount: number;
  totals: {
    writtenTiyin: string;
    movedOutTiyin: string;
    staysTiyin: string;
    incomingTiyin: string;
    resultTiyin: string;
    outBy: { unit: string; label: string; totalTiyin: string }[];
  };
}

const enc = encodeURIComponent;

export const unitPolicyApi = {
  view: (unit: string, from: string, to: string) => api.get<ApiResponse<UnitPolicyView>>(`/expense-policy/unit/${enc(unit)}`, { params: { from, to } }),
  save: (unit: string, rules: Record<string, string>) => api.patch<ApiResponse<{ unit: string; rules: Record<string, string>; changed: number }>>(`/expense-policy/unit/${enc(unit)}`, { rules }),
};