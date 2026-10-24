import { api, type ApiResponse } from '@/lib/api';

// Xarajatlar siyosati — /api/expense-policy

export interface PolicyCategory {
  code: string;
  label: string;
  parentCode: string | null;
  isLeaf: boolean;
  isActive: boolean;
  /** Siyosatda to'g'ridan-to'g'ri belgilangan */
  selected: boolean;
  /** Ota moddasi orqali Markaz hisobida */
  inherited: boolean;
  /** Har doim Markaz hisobida (ish haqi qo'shimchalari, asosiy vositalar sarfi) */
  locked?: boolean;
  /** Nima uchun bu yerda o'zgartirib bo'lmaydi */
  lockedReason?: string;
  /** Amaldagi to'lovchi: 'region' — yozilgan joyida, 'center' — Markaz yoki yo'nalish kodi (TAX_FREE …) */
  payer?: string;
}

/** Modda bo'yicha davrdagi xarajat — qayerda yozilgani */
export interface CategoryAmount {
  code: string;
  regionTiyin: string;
  centerTiyin: string;
  noneTiyin: string;
  /** Yo'nalishlarda (Tax free, Marksheyder …) yozilgan */
  segmentTiyin?: string;
  count: number;
}

/** Ish haqi tarkibi komponenti — Markazga o'tadimi */
export interface PayrollComponentOption {
  code: string;
  name: string;
  categoryLabel: string;
  selected: boolean;
  /** Qaysi Markaz moddasiga yoziladi */
  target: string;
}

export interface RecomputeReport {
  periods: number;
  changedBatches: number;
  centerTiyin: string;
}

export interface PolicyData {
  categories: PolicyCategory[];
  centerCategories: string[];
  /** Markazga o'tgan ota moddaning hududda qoladigan ichki moddalari */
  excludeCategories?: string[];
  /** Belgilangan modda → yo'nalish (yo'q bo'lsa — Markaz) */
  payers?: Record<string, string>;
  /** To'lovchi tanlovlari: Markaz + yo'nalishlar */
  payerOptions?: { code: string; label: string }[];
  recommended: { parent: { code: string; label: string }; items: { code: string; label: string }[]; missing: number };
  payrollComponents?: PayrollComponentOption[];
}

export interface CenterPart {
  key: string;
  label: string;
  amountTiyin: string;
}

export interface CenterSummary {
  range: { from: string; to: string };
  months: string[];
  totalTiyin: string;
  ownTiyin: string;
  regionalTiyin: string;
  /** 2-guruh: asosiy vositalar sarfi */
  assetsTiyin?: string;
  ownParts: CenterPart[];
  regionalParts: CenterPart[];
  byRegion: { code: number | null; name: string; amountTiyin: string }[];
  ownTrend: string[];
  regionalTrend: string[];
  assetsTrend?: string[];
  policyCount: number;
}

export const policyApi = {
  get: () => api.get<ApiResponse<PolicyData>>('/expense-policy'),
  save: (centerCategories: string[], excludeCategories: string[] = [], payers: Record<string, string> = {}) =>
    api.patch<ApiResponse<PolicyData>>('/expense-policy', { centerCategories, excludeCategories, payers }),
  amounts: (from: string, to: string) => api.get<ApiResponse<{ range: { from: string; to: string }; rows: CategoryAmount[] }>>('/expense-policy/amounts', { params: { from, to } }),
  seed: () => api.post<ApiResponse<{ created: number; policy: PolicyData }>>('/expense-policy/seed', {}),
  summary: (from: string, to: string) => api.get<ApiResponse<CenterSummary>>('/expense-policy/summary', { params: { from, to } }),
  savePayroll: (components: string[]) => api.patch<ApiResponse<{ policy: PolicyData; report: RecomputeReport }>>('/expense-policy/payroll', { components }),
  recompute: () => api.post<ApiResponse<RecomputeReport>>('/expense-policy/payroll/recompute', {}),
};