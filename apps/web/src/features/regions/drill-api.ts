import type { DateRange } from '@/components/shared/date-range-picker';
import type { CompareMode, SectionFilter } from '@/features/structure/api';
import { api, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Solishtirma ichkarisi: Viloyat → Tumanlar → Tuman → Xodim
// (backend: apps/api/src/modules/structure/districts.types.ts bilan bir xil)
// ═══════════════════════════════════════════════════════════

/** Tumanga bo'linmagan qism kaliti */
export const UNASSIGNED_KEY = '-';

export interface MoneyPart {
  key: string;
  label: string;
  amountTiyin: string;
  previousTiyin: string;
}

export interface DistrictRow {
  id: string;
  name: string;
  unassigned: boolean;
  incomeTiyin: string;
  previousIncomeTiyin: string;
  quantity: number;
  previousQuantity: number;
  expenseTiyin: string;
  previousExpenseTiyin: string;
  payrollTiyin: string;
  leaseTiyin: string;
  otherTiyin: string;
  resultTiyin: string;
  previousResultTiyin: string;
  headcount: number;
  planTiyin: string;
  factTiyin: string;
  /** «Tumanga bo'linmagan» daromaddan shu tumanga taqsimlangan qism (incomeTiyin ichida) */
  allocatedIncomeTiyin?: string;
  topServices: { label: string; amountTiyin: string }[];
  incomeTrend: string[];
  expenseTrend: string[];
}

interface DrillBase {
  section: SectionFilter;
  compare: CompareMode;
  compareLabel: string;
  range: DateRange;
  previousRange: DateRange;
  months: string[];
}

export interface RegionDistrictsResult extends DrillBase {
  region: { code: number; name: string };
  totals: {
    incomeTiyin: string;
    previousIncomeTiyin: string;
    expenseTiyin: string;
    previousExpenseTiyin: string;
    quantity: number;
  };
  districts: DistrictRow[];
  check: { incomeOk: boolean; expenseOk: boolean };
  notes: string[];
}

export interface ServiceRow {
  code: string;
  label: string;
  quantity: number;
  previousQuantity: number;
  amountTiyin: string;
  previousTiyin: string;
  averageTiyin: string | null;
}

export interface EmployeeRow {
  pinfl: string;
  fullName: string;
  position: string | null;
  employmentType: string;
  salaryTiyin: string;
  previousSalaryTiyin: string;
  planTiyin: string;
  factTiyin: string;
  bonusTiyin: string;
  paidMonths: number;
}

export interface DistrictDetailResult extends DrillBase {
  region: { code: number; name: string };
  district: { id: string; name: string; unassigned: boolean };
  summary: DistrictRow;
  services: ServiceRow[];
  expenseParts: MoneyPart[];
  employees: EmployeeRow[];
  notes: string[];
}

export interface EmployeeMonth {
  period: string;
  regionName: string;
  districtId: string | null;
  districtName: string | null;
  salaryTiyin: string;
  planTiyin: string;
  factTiyin: string;
  bonusTiyin: string;
}

export interface EmployeeDetailResult {
  range: DateRange;
  employee: {
    pinfl: string;
    fullName: string;
    position: string | null;
    employmentType: string;
    regionName: string;
    districtName: string | null;
    isActive: boolean;
  };
  months: EmployeeMonth[];
  totals: { salaryTiyin: string; planTiyin: string; factTiyin: string; bonusTiyin: string };
}

export const drillApi = {
  region: (code: number, range: DateRange, section: SectionFilter, compare: CompareMode) =>
    api.get<ApiResponse<RegionDistrictsResult>>(`/structure/drill/region/${code}`, {
      params: { from: range.from, to: range.to, section, compare },
    }),

  district: (id: string, regionCode: number, range: DateRange, section: SectionFilter, compare: CompareMode) =>
    api.get<ApiResponse<DistrictDetailResult>>(`/structure/drill/district/${encodeURIComponent(id)}`, {
      params: { region: regionCode, from: range.from, to: range.to, section, compare },
    }),

  employee: (pinfl: string, range: DateRange) =>
    api.get<ApiResponse<EmployeeDetailResult>>(`/structure/drill/employee/${encodeURIComponent(pinfl)}`, {
      params: { from: range.from, to: range.to },
    }),
};

// ═══════════════════════════════════════════════════════════
// Solishtirma › Markaz: Markaz → Bo'limlar → Bo'lim → Xodim (reja/tushum yo'q)
// (backend: apps/api/src/modules/structure/center.types.ts)
// ═══════════════════════════════════════════════════════════

/** Bo'limga biriktirilmagan */
export const NO_DEPARTMENT = '-';

export interface DepartmentRow {
  id: string;
  name: string;
  unassigned: boolean;
  incomeTiyin: string;
  previousIncomeTiyin: string;
  expenseTiyin: string;
  previousExpenseTiyin: string;
  payrollTiyin: string;
  previousPayrollTiyin: string;
  otherTiyin: string;
  headcount: number;
  perHeadTiyin: string | null;
  topParts: { label: string; amountTiyin: string }[];
  expenseTrend: string[];
}

export interface CenterDetailResult extends DrillBase {
  center: { name: string };
  totals: {
    incomeTiyin: string;
    previousIncomeTiyin: string;
    ownExpenseTiyin: string;
    previousOwnExpenseTiyin: string;
    regionalExpenseTiyin: string;
    previousRegionalExpenseTiyin: string;
    /** 2-guruh: asosiy vositalar sarfi (eskirish) */
    assetsExpenseTiyin?: string;
    previousAssetsExpenseTiyin?: string;
    expenseTiyin: string;
    previousExpenseTiyin: string;
    payrollTiyin: string;
    previousPayrollTiyin: string;
    headcount: number;
    previousHeadcount: number;
  };
  incomeParts: MoneyPart[];
  ownParts: MoneyPart[];
  regionalParts: MoneyPart[];
  regionalBy: { regionCode: number | null; name: string; amountTiyin: string }[];
  departments: DepartmentRow[];
  trend: { income: string[]; own: string[]; regional: string[]; assets?: string[] };
  notes: string[];
}

export interface CenterEmployeeRow {
  pinfl: string;
  fullName: string;
  position: string | null;
  employmentType: string;
  salaryTiyin: string;
  previousSalaryTiyin: string;
  paidMonths: number;
  isActive: boolean;
}

export interface DepartmentDetailResult extends DrillBase {
  department: { id: string; name: string; unassigned: boolean };
  summary: DepartmentRow;
  expenseParts: MoneyPart[];
  incomeParts: MoneyPart[];
  employees: CenterEmployeeRow[];
  notes: string[];
}

export const centerDrillApi = {
  center: (range: DateRange, section: SectionFilter, compare: CompareMode) =>
    api.get<ApiResponse<CenterDetailResult>>('/structure/drill/center', { params: { from: range.from, to: range.to, section, compare } }),
  department: (id: string, range: DateRange, section: SectionFilter, compare: CompareMode) =>
    api.get<ApiResponse<DepartmentDetailResult>>(`/structure/drill/center/department/${encodeURIComponent(id)}`, {
      params: { from: range.from, to: range.to, section, compare },
    }),
};