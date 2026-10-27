import type { DrillBase, MoneyPart } from './districts.types';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Markaz: Markaz → Bo'limlar → Bo'lim xodimlari → Xodim
// (hududlardagi kabi, faqat reja/tushum yo'q)
// ═══════════════════════════════════════════════════════════

/** Bo'limga biriktirilmagan yozuvlar kaliti */
export const NO_DEPARTMENT = '-';

export interface DepartmentRow {
  /** Bo'lim id; "-" — bo'limga biriktirilmagan */
  id: string;
  name: string;
  unassigned: boolean;
  incomeTiyin: string;
  previousIncomeTiyin: string;
  /** Bo'limning o'z xarajati (ish haqi + boshqa) */
  expenseTiyin: string;
  previousExpenseTiyin: string;
  payrollTiyin: string;
  previousPayrollTiyin: string;
  otherTiyin: string;
  /** Davrda ishlagan xodimlar (Xodimlar bo'limidan) */
  headcount: number;
  /** Bir xodimga xarajat (xodim bo'lsa) */
  perHeadTiyin: string | null;
  /** Eng katta xarajat moddalari (3 tagacha) */
  topParts: { label: string; amountTiyin: string }[];
  /** 12 oylik xarajat (months tartibida) */
  expenseTrend: string[];
}

export interface CenterDetailResult extends DrillBase {
  center: { name: string };
  totals: {
    incomeTiyin: string;
    previousIncomeTiyin: string;
    /** Markazning o'z xarajati (bo'limlar, ish haqi, ijara, mashinalar …) */
    ownExpenseTiyin: string;
    previousOwnExpenseTiyin: string;
    /** Hududlar uchun Markaz to'lagan (Xarajatlar siyosati moddalari) */
    regionalExpenseTiyin: string;
    previousRegionalExpenseTiyin: string;
    /** 2-guruh: asosiy vositalar sarfi (eskirish) — xarid balansda */
    assetsExpenseTiyin: string;
    previousAssetsExpenseTiyin: string;
    /** Jami = o'z + hududlar uchun + asosiy vositalar sarfi (Solishtirmadagi Markaz xarajati) */
    expenseTiyin: string;
    previousExpenseTiyin: string;
    payrollTiyin: string;
    previousPayrollTiyin: string;
    headcount: number;
    previousHeadcount: number;
  };
  /** Daromad manbalari (daromad turlari, masalan kassa hisobraqamlari) */
  incomeParts: MoneyPart[];
  /** O'z xarajati moddalari */
  ownParts: MoneyPart[];
  /** Hududlar uchun to'langan moddalar */
  regionalParts: MoneyPart[];
  /** Hududlar uchun to'langan — qaysi hudud uchun */
  regionalBy: { regionCode: number | null; name: string; amountTiyin: string }[];
  /** Bo'limlar + (bo'lsa) «Bo'limga biriktirilmagan»; yig'indisi = o'z xarajati */
  departments: DepartmentRow[];
  /** 12 oy: daromad, o'z xarajati, hududlar uchun */
  trend: { income: string[]; own: string[]; regional: string[]; assets: string[] };
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
  /** Bo'lim xarajat moddalari */
  expenseParts: MoneyPart[];
  /** Bo'lim daromad turlari (bo'limga yozilgan daromad bo'lsa) */
  incomeParts: MoneyPart[];
  employees: CenterEmployeeRow[];
  /** Bo'lim ish haqi xarajati (joriy davr) */
  payrollTiyin: string;
  /** Xodimlar ro'yxatidagi ish haqi jami — farq bo'lsa, izohda sababi */
  listedPayrollTiyin: string;
  notes: string[];
}