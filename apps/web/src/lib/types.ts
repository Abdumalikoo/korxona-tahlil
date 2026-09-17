/**
 * Backend qaytaradigan malumot tuzilmalari.
 *
 * Pul summalari string - BigInt JSON da satrga aylanadi.
 * Ularni formatTiyin yoki Money komponenti bilan korsating.
 */

export type UserRole = "ADMIN" | "VIEWER";
export type CostBehavior = "FIXED" | "VARIABLE" | "MIXED";
export type CostScope = "DEPARTMENT" | "GENERAL";
export type PaymentMethod = "CASH" | "BANK" | "CARD" | "OTHER";
export type PaymentStatus = "PAID" | "PARTIAL" | "UNPAID";
export type EntrySource = "MANUAL" | "IMPORT" | "PAYROLL";

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
}

export interface LoginResult {
  accessToken: string;
  user: User;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  order: number;
  allocationWeight: number;
}

export interface Category {
  code: string;
  label: string;
  parentCode: string | null;
  isLeaf: boolean;
  behavior: CostBehavior;
  scope: CostScope;
  keywords: string[];
  model3d: string | null;
  isActive: boolean;
  order: number;
}

export interface CategoryTree extends Category {
  children: CategoryTree[];
}

export interface IncomeCategory {
  code: string;
  label: string;
  isActive: boolean;
  order: number;
}

interface CategoryRef {
  code: string;
  label: string;
  behavior?: CostBehavior;
  parentCode?: string | null;
}

interface DepartmentRef {
  id: string;
  code: string;
  name: string;
}

interface UserRef {
  id: string;
  fullName: string;
}

export interface Expense {
  id: string;
  date: string;
  period: string;
  /** TIYIN da, satr korinishida */
  amountTiyin: string;
  categoryCode: string;
  departmentId: string | null;
  /** Hudud kodi - ish haqi va hududiy xarajatlarda */
  regionCode: number | null;

  description: string | null;
  paymentMethod: PaymentMethod;
  documentNo: string | null;
  counterparty: string | null;

  /** Tolov holati - kreditorlik qarzini kuzatish uchun */
  paymentStatus: PaymentStatus;
  /** Qachongacha tolanishi kerak */
  dueDate: string | null;
  /** Javobgar shaxs */
  responsible: string | null;
  /** Summa ichidagi QQS, tiyinda */
  vatTiyin: string | null;

  source: EntrySource;
  createdAt: string;
  updatedAt: string;

  category: CategoryRef;
  department: DepartmentRef | null;
  region: { code: number; name: string } | null;
  createdBy?: UserRef;
}

export interface Income {
  id: string;
  date: string;
  period: string;
  amountTiyin: string;
  paidTiyin: string;
  categoryCode: string;
  departmentId: string | null;
  clientName: string | null;
  description: string | null;
  contractNo: string | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  source: EntrySource;
  createdAt: string;
  category: CategoryRef;
  department: DepartmentRef | null;
  createdBy?: UserRef;
}

// --------- Tahlil natijalari ---------

export interface CategorySummaryRow {
  categoryCode: string;
  label: string;
  parentCode: string | null;
  behavior: CostBehavior | null;
  amountTiyin: string;
  count: number;
  sharePercent: number;
}

export interface DepartmentSummaryRow {
  departmentId: string | null;
  code: string | null;
  name: string;
  amountTiyin: string;
  paidTiyin?: string;
  count: number;
  sharePercent: number;
}

export interface TrendPoint {
  period: string;
  amountTiyin: string;
  paidTiyin?: string;
  count: number;
}

export interface ComparisonResult {
  current: { period: string; amountTiyin: string };
  previous: { period: string; amountTiyin: string; changePercent: number | null };
  lastYear: { period: string; amountTiyin: string; changePercent: number | null };
}

export interface BehaviorSummary {
  fixedTiyin: string;
  variableTiyin: string;
  mixedTiyin: string;
  totalTiyin: string;
}

export interface AbcRow {
  clientName: string;
  amountTiyin: string;
  count: number;
  sharePercent: number;
  cumulativePercent: number;
  group: "A" | "B" | "C";
}
// --------- Hududlar ---------

export interface Region {
  code: number;
  name: string;
  isActive: boolean;
}

export interface District {
  id: string;
  regionCode: number;
  code: number;
  name: string;
  isActive: boolean;
}

export interface RegionWithDistricts extends Region {
  districts: District[];
}

// --------- Xodimlar ---------

export type EmploymentType = 'SHTAT' | 'SHARTNOMA';

interface RegionRef {
  code: number;
  name: string;
}

interface DistrictRef {
  id: string;
  code: number;
  name: string;
}

interface DepartmentRef2 {
  id: string;
  code: string;
  name: string;
  index: number;
}

export interface Employee {
  pinfl: string;
  lastName: string;
  firstName: string;
  middleName: string | null;
  fullName: string;

  employmentType: EmploymentType;

  regionCode: number;
  districtId: string | null;
  departmentId: string | null;

  position: string | null;
  hiredAt: string | null;
  firedAt: string | null;
  isActive: boolean;

  createdAt: string;
  updatedAt: string;

  region: RegionRef;
  district: DistrictRef | null;
  department: DepartmentRef2 | null;
}

export interface EmployeeStats {
  centralStaff: number;
  regionalStaff: number;
  contract: number;
  total: number;
}

 export interface RegionSummaryRow {   regionCode: number | null;   name: string;   amountTiyin: string;   count: number;   sharePercent: number; }