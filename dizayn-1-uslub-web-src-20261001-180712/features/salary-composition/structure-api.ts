import { api, type ApiResponse } from '@/lib/api';
import type { ComponentCategory } from './api';

// ═══════════════════════════════════════════════════════════
// Ish haqi tuzilmasi — backend bilan bir xil turlar
// ═══════════════════════════════════════════════════════════

/** Guruh → summa (tiyin, belgisi bilan; jarima manfiy) */
export type CategoryAmounts = Record<ComponentCategory, string>;

export type UnitKind = 'department' | 'region' | 'contract';

export interface StructurePeriod {
  period: string;
  /** Rasmiy summa — soliq hisobotidan */
  payrollTiyin: string;
  /** Tarkibda taqsimlangan qism */
  compositionTiyin: string;
  /** Soliq − tarkib */
  unallocatedTiyin: string;
  byCategory: CategoryAmounts;
  payrollUploaded: boolean;
  compositionUploaded: boolean;
}

export interface StructureCategory {
  category: ComponentCategory;
  label: string;
  totalTiyin: string;
  /** Tarkib yuklangan oylardagi ish haqidagi ulushi, % */
  sharePercent: number | null;
}

export interface StructureComponent {
  code: string;
  name: string;
  category: ComponentCategory;
  sign: number;
  totalTiyin: string;
  employees: number;
}

export interface StructureUnit {
  key: string;
  label: string;
  kind: UnitKind;
  employees: number;
  payrollTiyin: string;
  compositionTiyin: string;
  unallocatedTiyin: string;
  byCategory: CategoryAmounts;
  coveredPayrollTiyin: string;
  bonusSharePercent: number | null;
}

export interface StructurePerson {
  pinfl: string;
  fullName: string;
  unitName: string;
  amountTiyin: string;
  sharePercent: number | null;
}

export interface SalaryStructure {
  from: string;
  to: string;
  periods: StructurePeriod[];
  totals: {
    payrollTiyin: string;
    compositionTiyin: string;
    unallocatedTiyin: string;
    coveragePercent: number | null;
    coveredPeriods: number;
    coveredPayrollTiyin: string;
    byCategory: StructureCategory[];
  };
  byComponent: StructureComponent[];
  units: StructureUnit[];
  topBonus: StructurePerson[];
  topPenalty: StructurePerson[];
}

/** from / to — "YYYY-MM" yoki "YYYY-MM-DD" (oyi olinadi) */
export function fetchSalaryStructure(from: string, to: string) {
  return api.get<ApiResponse<SalaryStructure>>('/salary-composition/structure', {
    params: { from: from.slice(0, 7), to: to.slice(0, 7) },
  });
}
