import type { CompareMode, DateRange, SectionFilter } from './structure.types';

// ═══════════════════════════════════════════════════════════
// Solishtirma ichkarisi: Viloyat → Tumanlar → Tuman → Xodim
// ═══════════════════════════════════════════════════════════

/** Tumanga bo'linmagan yozuvlar uchun kalit */
export const UNASSIGNED_KEY = '-';

export interface MoneyPart {
  key: string;
  label: string;
  amountTiyin: string;
  previousTiyin: string;
}

/** Tuman qatori (viloyat jadvalida) */
export interface DistrictRow {
  /** Tuman kaliti "3-1"; "-" — tumanga bo'linmagan */
  id: string;
  name: string;
  unassigned: boolean;

  incomeTiyin: string;
  previousIncomeTiyin: string;
  /** Ko'rsatilgan xizmatlar soni (Hududlar tushumidagi "Soni") */
  quantity: number;
  previousQuantity: number;

  expenseTiyin: string;
  previousExpenseTiyin: string;
  /** Xarajat ichidan */
  payrollTiyin: string;
  leaseTiyin: string;
  otherTiyin: string;

  /** Natija = daromad − xarajat */
  resultTiyin: string;
  previousResultTiyin: string;

  /** Davrda ish haqi olgan xodimlar soni */
  headcount: number;
  /** Natijalar faylidan (daromadga qo'shilmaydi): xodimlar rejasi va fakti */
  planTiyin: string;
  factTiyin: string;
  /** «Tumanga bo'linmagan» daromaddan shu tumanga taqsimlangan qism (incomeTiyin ichida) */
  allocatedIncomeTiyin: string;

  /** Eng katta daromad keltirgan xizmatlar (3 tagacha) */
  topServices: { label: string; amountTiyin: string }[];

  /** 12 oylik dinamika (months tartibida) */
  incomeTrend: string[];
  expenseTrend: string[];
}

export interface DrillBase {
  section: SectionFilter;
  compare: CompareMode;
  compareLabel: string;
  range: DateRange;
  previousRange: DateRange;
  /** Oylar dinamikasi uchun: oraliq oxiri bilan tugaydigan 12 oy */
  months: string[];
}

export interface RegionDistrictsResult extends DrillBase {
  region: { code: number; name: string };
  /** Viloyat jami — Solishtirmadagi bilan bir xil yozuvlardan */
  totals: {
    incomeTiyin: string;
    previousIncomeTiyin: string;
    expenseTiyin: string;
    previousExpenseTiyin: string;
    quantity: number;
  };
  /** Tumanlar + (bo'lsa) "Tumanga bo'linmagan" qatori; yig'indisi = totals */
  districts: DistrictRow[];
  /** Tekshiruv: tumanlar yig'indisi viloyat jamisiga tengmi */
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
  /** Bitta xizmatning o'rtacha narxi */
  averageTiyin: string | null;
}

export interface EmployeeRow {
  pinfl: string;
  fullName: string;
  position: string | null;
  employmentType: string;
  /** Davrda olgan ish haqi (tuman xarajatiga kiradi) */
  salaryTiyin: string;
  previousSalaryTiyin: string;
  /** Natijalar faylidan */
  planTiyin: string;
  factTiyin: string;
  bonusTiyin: string;
  /** Nechta oy ish haqi olgan */
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