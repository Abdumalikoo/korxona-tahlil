import type {
  SalaryComponentCategory,
  SalaryComponentGroup,
  SalaryCompositionStatus,
} from '@prisma/client';

// ═══════════════════════════════════════════════════════════
// Turlar
// ═══════════════════════════════════════════════════════════

export interface ComponentDto {
  code: string;
  name: string;
  group: SalaryComponentGroup;
  groupLabel: string;
  category: SalaryComponentCategory;
  categoryLabel: string;
  sign: number;
  sortOrder: number;
  isActive: boolean;
  usedCount: number;
}

export interface ComponentInput {
  code?: string;
  name?: string;
  group?: string;
  category?: string;
  sign?: number;
  sortOrder?: number;
  isActive?: boolean;
}

/**
 * Qator holati:
 * ok — soliq hisobotiga mos,
 * diff — summa farq qiladi,
 * not_in_payroll — soliq hisobotida bu xodim yo'q,
 * no_payroll — shu oyga soliq hisoboti umuman yuklanmagan
 */
export type RowState = 'ok' | 'diff' | 'not_in_payroll' | 'no_payroll';

/** Umumiy holat */
export type CheckState = 'MATCHED' | 'MISMATCH' | 'NO_PAYROLL' | 'NOT_UPLOADED';

export interface CompositionRowDto {
  rowIndex: number | null;
  pinfl: string;
  fullName: string;
  inRegistry: boolean;
  unitName: string | null;
  workedDays: number | null;
  rate: number | null;
  /** Komponent kodi → summa (tiyin, doim musbat) */
  items: Record<string, string>;
  totalTiyin: string;
  payrollTiyin: string | null;
  diffTiyin: string | null;
  state: RowState;
}

export interface ComponentTotal {
  code: string;
  name: string;
  group: SalaryComponentGroup;
  category: SalaryComponentCategory;
  sign: number;
  /** Belgisi bilan (jarima manfiy) */
  totalTiyin: string;
  employees: number;
}

export interface CategoryTotal {
  category: SalaryComponentCategory;
  label: string;
  /** Belgisi bilan (jarima manfiy) */
  totalTiyin: string;
  /** Jami tarkibdagi ulushi, % */
  sharePercent: number | null;
}

export interface CheckPerson {
  pinfl: string;
  fullName: string;
  compositionTiyin: string;
  payrollTiyin: string;
  diffTiyin: string;
}

export interface CheckSummary {
  period: string;
  state: CheckState;
  payrollUploaded: boolean;
  compositionUploaded: boolean;
  compositionTiyin: string;
  payrollTiyin: string;
  diffTiyin: string;
  employees: number;
  mismatchCount: number;
  /** Summasi farq qiladiganlar */
  mismatches: CheckPerson[];
  /** Soliq hisobotida bor (summa > 0), tarkibda yo'q */
  missingInComposition: CheckPerson[];
  /** Tarkibda bor (summa > 0), soliq hisobotida yo'q */
  notInPayroll: CheckPerson[];
}

export interface AnalysisResult {
  period: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  columns: ComponentDto[];
  missingColumns: { code: string; name: string }[];
  invalidRows: { rowIndex: number; reason: string }[];
  duplicates: { rowIndex: number; pinfl: string }[];
  unknownEmployees: { rowIndex: number; pinfl: string; fileName: string }[];
  /** Fayldagi JAMI ustuni hisoblangan yig'indiga mos kelmagan qatorlar */
  totalMismatches: { rowIndex: number; pinfl: string; fileTiyin: string; computedTiyin: string }[];
  hasPrevious: boolean;
  byComponent: ComponentTotal[];
  byCategory: CategoryTotal[];
  check: CheckSummary;
  rows: CompositionRowDto[];
}

/** Saqlash uchun kiruvchi qator */
export interface CommitRow {
  pinfl: string;
  fullName: string | null;
  workedDays: number | null;
  rate: number | null;
  items: Map<string, bigint>;
}

export interface CommitResult {
  success: true;
  batchId: string;
  saved: number;
  replacedPrevious: boolean;
  totalTiyin: string;
  payrollTiyin: string;
  status: SalaryCompositionStatus;
  mismatchCount: number;
  /** Hudud xodimlari ish haqidan Markaz hisobiga o'tgan qism (bayram, choraklik …) */
  centerTiyin?: string;
  centerEmployees?: number;
}

export interface BatchDto {
  id: string;
  period: string;
  fileName: string | null;
  employeeCount: number;
  totalTiyin: string;
  payrollTiyin: string;
  status: SalaryCompositionStatus;
  mismatchCount: number;
  uploadedBy: string | null;
  createdAt: Date;
  cancelledAt: Date | null;
}

export interface CompositionView {
  period: string;
  batch: BatchDto | null;
  components: ComponentDto[];
  byComponent: ComponentTotal[];
  byCategory: CategoryTotal[];
  check: CheckSummary;
  rows: CompositionRowDto[];
}

export interface EmployeeHistory {
  employee: { pinfl: string; fullName: string; unitName: string | null; inRegistry: boolean };
  components: ComponentDto[];
  periods: {
    period: string;
    workedDays: number | null;
    rate: number | null;
    items: Record<string, string>;
    totalTiyin: string;
    payrollTiyin: string | null;
    diffTiyin: string | null;
    state: RowState;
  }[];
  byCategory: CategoryTotal[];
}

// ─────────── Ichki turlar ───────────

export interface ParsedRow {
  rowIndex: number;
  pinfl: string;
  fileName: string;
  workedDays: number | null;
  rate: number | null;
  items: Map<string, bigint>;
  fileTotalTiyin: bigint | null;
}

export interface RegistryInfo {
  fullName: string;
  unitName: string | null;
}

export interface PayrollInfo {
  uploaded: boolean;
  map: Map<string, bigint>;
}

export interface CheckInput {
  pinfl: string;
  fullName: string;
  totalTiyin: bigint;
}

export type FixedKey = 'pinfl' | 'fullName' | 'days' | 'rate' | 'total';