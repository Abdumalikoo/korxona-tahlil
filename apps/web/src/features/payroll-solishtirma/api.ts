import { api, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Ish haqi solishtirma: FOT − soliq (− kasaba) = 23106 — /api/payroll-solishtirma
// ═══════════════════════════════════════════════════════════

export type BankMonthMode = 'ACCRUAL' | 'PAID';
export type FotMode = 'TARKIB' | 'SOLIQ';
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
  fotTiyin: string | null;
  fotSource: 'TARKIB' | 'SOLIQ' | null;
  tarkibTiyin: string | null;
  soliqTiyin: string | null;
  /** Soliq hisoboti − tarkib (ikkalasi bo'lsa) */
  tarkibSoliqDiffTiyin?: string | null;
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
  settings: SolishtirmaSettings;
  sources: { tarkib: boolean; soliq: boolean; bank: boolean };
  summary: { employees: number; ok: number; less: number; more: number; noBank: number; noFot: number; tarkibSoliqDiff: number; fotTiyin: string; expectedTiyin: string; bankTiyin: string; unknownType: number };
  groups: SolGroup[];
  regions: { name: string; employees: number; problems: number; expectedTiyin: string; bankTiyin: string; diffTiyin: string }[];
  rows: SolRow[];
}

export const solishtirmaApi = {
  view: (period: string, bankMonth: BankMonthMode, fot: FotMode) => api.get<ApiResponse<SolView>>('/payroll-solishtirma', { params: { period, bankMonth, fot } }),
  saveSettings: (s: SolishtirmaSettings) => api.put<ApiResponse<SolishtirmaSettings>>('/payroll-solishtirma/settings', s),
};
