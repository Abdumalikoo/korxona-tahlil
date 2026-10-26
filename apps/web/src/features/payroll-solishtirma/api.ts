import { api, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Ish haqi solishtirma: FOT − soliq (− kasaba) = 23106 — /api/payroll-solishtirma
// ═══════════════════════════════════════════════════════════

export type BankMonthMode = 'ACCRUAL' | 'PAID';
export type FotMode = 'TARKIB' | 'SOLIQ';
export type SolTab = 'CENTER' | 'REGION';
export type SolState = 'OK' | 'LESS' | 'MORE' | 'NO_BANK' | 'NO_FOT';
export type GroupKey = 'CENTER_SHTAT' | 'CENTER_SHARTNOMA' | 'REGION_SHTAT' | 'REGION_SHARTNOMA' | 'UNIT' | 'UNKNOWN';

export interface SolishtirmaSettings {
  taxPct: number;
  unionPct: number;
  toleranceSum: number;
}

export interface SolRow {
  pinfl: string;
  fullName: string;
  inRegistry: boolean;
  group: GroupKey;
  groupLabel: string;
  unit: string | null;
  unitLabel: string | null;
  regionCode: number | null;
  regionName: string | null;
  employmentType: 'SHTAT' | 'SHARTNOMA';
  typeKnown: boolean;
  /** Umumiy hisobotda ham, bo'lim sahifasida qo'lda ham (ikki marta sanalgan) */
  soliqDuplicate?: boolean;
  fotTiyin: string | null;
  fotSource: 'TARKIB' | 'SOLIQ' | null;
  tarkibTiyin: string | null;
  soliqTiyin: string | null;
  /** Soliq hisoboti − tarkib */
  tarkibSoliqDiffTiyin?: string | null;
  /** Markaz: tarkib kategoriyalari */
  categories?: { category: string; label: string; tiyin: string }[];
  /** «To'g'ri» deb tasdiqlash mumkinmi */
  confirmable?: boolean;
  confirm?: 'CONFIRMED' | 'CHANGED' | null;
  /** Markaz: tarkib farqini komponentga yo'naltirish */
  tarkibFix?: {
    unit: string | null;
    canAllocate: boolean;
    diffTiyin: string;
    suggestion: { componentCode: string; componentName: string; amountTiyin: string; confidence: 'STRONG' | 'WEAK'; reason: string } | null;
    adjustments: { id: string; componentName: string; amountTiyin: string }[];
  } | null;
  taxTiyin: string | null;
  unionTiyin: string | null;
  expectedTiyin: string | null;
  bankTiyin: string;
  bank: { kind: string; label: string; netTiyin: string; count: number; dates: string[] }[];
  diffTiyin: string | null;
  state: SolState;
  hint: string | null;
}

export interface SolGroup {
  key: GroupKey;
  label: string;
  rule: string;
  employees: number;
  ok: number;
  problems: number;
  fotTiyin: string;
  tarkibTiyin?: string;
  soliqTiyin?: string;
  taxTiyin: string;
  unionTiyin: string;
  expectedTiyin: string;
  bankTiyin: string;
  diffTiyin: string;
}

export interface SolView {
  period: string;
  label: string;
  mode: BankMonthMode;
  /** Eski API'da bo'lmaydi */
  fotMode?: FotMode;
  tab?: SolTab;
  tabs?: Record<SolTab, { employees: number; confirmed?: number; problems: number; tarkibDiff: number }>;
  components?: { code: string; name: string; category: string; categoryLabel: string; sign: number }[];
  fixScopes?: { unit: string | null; label: string; compositionUploaded: boolean }[];
  matched?: {
    count: number;
    soliqTiyin: string;
    bankTiyin: string;
    bankOk: number;
    categories: { category: string; label: string; tiyin: string }[];
    byGroup: { key: GroupKey; label: string; count: number; soliqTiyin: string }[];
    confirmed: { at: string; by: string; count: number; totalTiyin: string; changed: number; missing: number } | null;
    unconfirmed: number;
  };
  settings: SolishtirmaSettings;
  sources: { tarkib: boolean; soliq: boolean; bank: boolean };
  summary: { employees: number; confirmed?: number; ok: number; less: number; more: number; noBank: number; noFot: number; tarkibSoliqDiff: number; fotTiyin: string; expectedTiyin: string; bankTiyin: string; unknownType: number };
  groups: SolGroup[];
  regions: { name: string; employees: number; problems: number; expectedTiyin: string; bankTiyin: string; diffTiyin: string }[];
  rows: SolRow[];
}

/** Bitta xodim — manbadagi hamma yuklangan narsa */
export interface SolPerson {
  period: string;
  monthLabel: string;
  mode: BankMonthMode;
  pinfl: string;
  fullName: string;
  employee: { position: string | null; department: string | null; employmentType: string } | null;
  row: SolRow | null;
  soliq: { where: string; fileName: string; at: string | null; tiyin: string; counted: boolean; note: string | null }[];
  soliqTiyin: string;
  tarkib: { where: string; fileName: string; at: string | null; totalTiyin: string; items: { code: string; name: string; category: string; categoryLabel: string; tiyin: string; sign: number }[] }[];
  adjustments: { componentName: string; tiyin: string; note: string | null; at: string; by: string }[];
  bank: { month: string; fileName: string; docDate: string; procDate: string | null; docNo: string; tiyin: string; kind: string; kindLabel: string; purpose: string; accrual: string; forMonth: string; orderNo: string | null; orderDate: string | null; account: string; matchBy: string | null; counted: boolean; reason: string | null }[];
  bankCountedTiyin: string;
}

export const solishtirmaApi = {
  view: (period: string, bankMonth: BankMonthMode, tab: SolTab) => api.get<ApiResponse<SolView>>('/payroll-solishtirma', { params: { period, bankMonth, tab } }),
  confirm: (period: string, tab: SolTab, bankMonth: BankMonthMode, pinfls?: string[]) =>
    api.post<ApiResponse<{ success: true; confirmed: number; total: number }>>(`/payroll-solishtirma/confirm?period=${period}&tab=${tab}&bankMonth=${bankMonth}`, pinfls ? { pinfls } : {}),
  cancelConfirm: (period: string, tab: SolTab) => api.post<ApiResponse<{ success: true; removed: number }>>(`/payroll-solishtirma/confirm/cancel?period=${period}&tab=${tab}`),
  person: (period: string, pinfl: string, bankMonth: BankMonthMode) => api.get<ApiResponse<SolPerson>>('/payroll-solishtirma/person', { params: { period, pinfl, bankMonth } }),
  saveSettings: (s: SolishtirmaSettings) => api.put<ApiResponse<SolishtirmaSettings>>('/payroll-solishtirma/settings', s),
};
