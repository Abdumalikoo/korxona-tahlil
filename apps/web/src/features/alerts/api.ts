import { api, type ApiResponse } from '@/lib/api';
import type { ItemFilter, ItemKind } from '@/features/reactions/api';
import type { Calc } from '@/lib/calc';

// ═══════════════════════════════════════════════════════════
// «Muhokama talab qiladi» — backend (apps/api/src/modules/alerts) bilan bir xil turlar
// ═══════════════════════════════════════════════════════════

export type AlertRule = 'expenseGrowth' | 'incomeDrop' | 'loss' | 'plan' | 'outlier' | 'debt' | 'control';

export const RULES: { rule: AlertRule; label: string; hint: string }[] = [
  { rule: 'expenseGrowth', label: "Xarajat o'sgan", hint: "Hudud, modda, kontragent yoki tuman xarajati keskin o'sgan" },
  { rule: 'incomeDrop', label: 'Daromad tushgan', hint: 'Hudud, xizmat turi, mijoz yoki tuman daromadi kamaygan' },
  { rule: 'loss', label: 'Zarar', hint: 'Hudud yoki tuman oyni zarar bilan yopgan' },
  { rule: 'plan', label: 'Reja bajarilmagan', hint: 'Xodim rejasi belgilangan foizdan past bajarilgan' },
  { rule: 'outlier', label: 'Katta yozuv', hint: "Bitta yozuv o'sha moddaning odatiy yozuvidan bir necha barobar katta" },
  { rule: 'debt', label: 'Qarz', hint: "To'lov muddati o'tgan debitorlik va kreditorlik" },
  { rule: 'control', label: 'Nazorat', hint: 'Nazoratdagi modda chegarani buzgan yoki yaqinlashgan' },
];

export interface AlertSettings {
  enabled: Record<AlertRule, boolean>;
  baseMonths: number;
  expenseGrowthPct: number;
  expenseGrowthMinSom: number;
  incomeDropPct: number;
  incomeDropMinSom: number;
  lossMinSom: number;
  planMinPct: number;
  outlierFactor: number;
  outlierMinSom: number;
  debtDays: number;
  debtMinSom: number;
  byCounterparty: boolean;
  byDistrict: boolean;
}

export interface Alert {
  key: string;
  rule: AlertRule;
  ruleLabel: string;
  severity: 'high' | 'medium';
  title: string;
  detail: string;
  amountTiyin: string;
  period: string | null;
  item: { kind: ItemKind; label: string; filter: ItemFilter; origin: string } | null;
  href: string | null;
  /** «Qanday hisoblandi?» — backend tayyorlaydi (formula, sonlar, ishlanishi, chegara tekshiruvi) */
  calc?: Calc;
}

export interface AlertsResult {
  period: string;
  basePeriods: string[];
  generatedAt: string;
  alerts: Alert[];
  dismissedCount: number;
  counts: Record<AlertRule, number>;
  settings: AlertSettings;
}

export const alertsApi = {
  list: (all = false) => api.get<ApiResponse<AlertsResult>>('/alerts', { params: all ? { all: '1' } : {} }),
  dismiss: (key: string) => api.post<void>('/alerts/dismiss', { key }),
  restore: () => api.post<void>('/alerts/restore'),
  settings: () => api.get<ApiResponse<AlertSettings>>('/alerts/settings'),
  saveSettings: (payload: Partial<AlertSettings>) => api.patch<ApiResponse<AlertSettings>>('/alerts/settings', payload),
};

/** Ogohlantirishlar o'zgarganda (ko'rildi, muhokamaga qo'yildi) — qo'ng'iroqcha yangilanadi */
export const ALERTS_CHANGED = 'alerts:changed';
export function notifyAlertsChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(ALERTS_CHANGED));
}