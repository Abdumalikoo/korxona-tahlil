import type { AlertCalc } from './alerts.calc';
import type { ItemFilter, ItemKind } from '../reactions/reactions.types';

// ═══════════════════════════════════════════════════════════
// «Muhokama talab qiladi» — tizimning o'zi topadigan holatlar
// ═══════════════════════════════════════════════════════════

export type AlertRule = 'expenseGrowth' | 'incomeDrop' | 'loss' | 'plan' | 'outlier' | 'debt' | 'control';

export const RULE_LABELS: Record<AlertRule, string> = {
  expenseGrowth: "Xarajat keskin o'sgan",
  incomeDrop: 'Daromad tushib ketgan',
  loss: 'Zarar bilan ishlagan',
  plan: 'Reja bajarilmagan',
  outlier: 'Odatdan tashqari katta yozuv',
  debt: "Muddati o'tgan qarz",
  control: 'Nazorat chegarasi',
};

/** Sozlamalar — Sozlamalar sahifasida o'zgartiriladi (summalar so'mda) */
export interface AlertSettings {
  enabled: Record<AlertRule, boolean>;
  /** Solishtirish asosi: oldingi necha oy o'rtachasi */
  baseMonths: number;
  /** Xarajat o'sishi: kamida shuncha foiz VA shuncha so'm */
  expenseGrowthPct: number;
  expenseGrowthMinSom: number;
  /** Daromad kamayishi: kamida shuncha foiz VA shuncha so'm */
  incomeDropPct: number;
  incomeDropMinSom: number;
  /** Zarar: kamida shuncha so'm */
  lossMinSom: number;
  /** Reja bajarilishi shundan past bo'lsa, % */
  planMinPct: number;
  /** Bitta yozuv: o'sha modda odatdagi yozuvidan (median) necha barobar katta VA kamida shuncha so'm */
  outlierFactor: number;
  outlierMinSom: number;
  /** Qarz: necha kundan ortiq to'lanmagan VA kamida shuncha so'm */
  debtDays: number;
  debtMinSom: number;
  /** Kontragent va mijozlar bo'yicha ham tekshirish */
  byCounterparty: boolean;
  /** Tumanlar bo'yicha ham tekshirish (Solishtirma › tumanlar) */
  byDistrict: boolean;
}

export const DEFAULT_SETTINGS: AlertSettings = {
  enabled: { expenseGrowth: true, incomeDrop: true, loss: true, plan: true, outlier: true, debt: true, control: true },
  baseMonths: 3,
  expenseGrowthPct: 25,
  expenseGrowthMinSom: 5_000_000,
  incomeDropPct: 20,
  incomeDropMinSom: 5_000_000,
  lossMinSom: 1_000_000,
  planMinPct: 80,
  outlierFactor: 3,
  outlierMinSom: 10_000_000,
  debtDays: 30,
  debtMinSom: 1_000_000,
  byCounterparty: true,
  byDistrict: true,
};

/** Muhokamaga qo'yish uchun tayyor modda */
export interface AlertItem {
  kind: ItemKind;
  label: string;
  filter: ItemFilter;
  origin: string;
}

export interface Alert {
  /** Barqaror kalit (qoida + obyekt + oy) — «Ko'rildi» shu bo'yicha eslab qolinadi */
  key: string;
  rule: AlertRule;
  ruleLabel: string;
  severity: 'high' | 'medium';
  title: string;
  /** Raqamlar bilan izoh: nima, qancha, nimaga nisbatan */
  detail: string;
  /** Muammoning summasi (o'sish, kamayish, zarar, qarz…), tiyinda */
  amountTiyin: string;
  period: string | null;
  /** Bir bosishda muhokamaga qo'yish (bo'lmasa — allaqachon Nazoratda) */
  item: AlertItem | null;
  /** Batafsil ko'rish sahifasi */
  href: string | null;
  /** «Qanday hisoblandi?» — formula va ishlanishi */
  calc?: AlertCalc;
}

export interface AlertsResult {
  /** Tekshirilgan to'liq oy */
  period: string;
  /** Solishtirish asosi: shu oylar o'rtachasi */
  basePeriods: string[];
  generatedAt: string;
  alerts: Alert[];
  /** «Ko'rildi» deb belgilanganlar soni (ro'yxatda yo'q) */
  dismissedCount: number;
  counts: Record<AlertRule, number>;
  settings: AlertSettings;
}