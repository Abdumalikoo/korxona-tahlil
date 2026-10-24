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
  /** Shu bo'limga tegishli (ro'yxatda, yozilgan yoki qoidasi bor); qolganlari — «Hamma moddalar»da */
  used: boolean;
}

/** Ish haqi qismi — ish haqi tarkibi komponenti (bayram puli, choraklik, ustama …) */
export interface UnitPolicyPayrollPart {
  code: string;
  name: string;
  /** Komponent turi */
  group: string;
  /** Davrda shu bo'lim xodimlariga hisoblangan (ish haqi tarkibidan) */
  totalTiyin: string;
  /** Shu bo'limning qoidasi yoki null — ish haqi ichida */
  rule: string | null;
  /** Umumiy siyosat bo'yicha (Hududlar: bayram, choraklik — Markaz) */
  globalTarget: string | null;
  /** Davrda ish haqidan ajratib yozilgani */
  splitTiyin: string;
}

export interface UnitPolicyView {
  unit: string;
  label: string;
  from: string;
  to: string;
  targets: { code: string; label: string }[];
  categories: UnitPolicyCategory[];
  incoming: { source: string; sourceLabel: string; code: string; label: string; count: number; totalTiyin: string }[];
  payrollParts: UnitPolicyPayrollPart[];
  payrollRulesCount: number;
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
  save: (unit: string, rules: Record<string, string>, payroll: Record<string, string>) =>
    api.patch<ApiResponse<{ unit: string; rules: Record<string, string>; payroll: Record<string, string>; changed: number; recomputedPeriods: number }>>(`/expense-policy/unit/${enc(unit)}`, { rules, payroll }),
};