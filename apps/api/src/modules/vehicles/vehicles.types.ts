// ═══════════════════════════════════════════════════════════
// Mashinalar — turlar, yorliqlar va kategoriyalar
// ═══════════════════════════════════════════════════════════

export const VEHICLE_FUEL_TYPES = ['AI80', 'AI92', 'AI95', 'DIZEL', 'METAN', 'PROPAN', 'ELEKTR'] as const;
export type VehicleFuelTypeValue = (typeof VEHICLE_FUEL_TYPES)[number];

export const VEHICLE_RECORD_KINDS = ['FUEL', 'WASH', 'REPAIR', 'SERVICE', 'OTHER'] as const;
export type VehicleRecordKindValue = (typeof VEHICLE_RECORD_KINDS)[number];

export const PAYMENT_METHODS = ['CASH', 'BANK', 'CARD', 'OTHER'] as const;
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number];

export const FUEL_TYPE_LABELS: Record<VehicleFuelTypeValue, string> = {
  AI80: 'AI-80',
  AI92: 'AI-92',
  AI95: 'AI-95',
  DIZEL: 'Dizel',
  METAN: 'Metan',
  PROPAN: 'Propan',
  ELEKTR: 'Elektr',
};

export const RECORD_KIND_LABELS: Record<VehicleRecordKindValue, string> = {
  FUEL: "Yoqilg'i",
  WASH: 'Moyka',
  REPAIR: "Ta'mirlash",
  SERVICE: 'Texnik xizmat',
  OTHER: 'Boshqa',
};

/** Xarajat kategoriyalari: bitta ota va har tur uchun bola */
export const VEHICLE_PARENT_CATEGORY = 'VEHICLE';
export const VEHICLE_PARENT_LABEL = 'Mashinalar';

export const VEHICLE_CATEGORIES: Record<
  VehicleRecordKindValue,
  { code: string; label: string; behavior: 'FIXED' | 'VARIABLE' | 'MIXED' }
> = {
  FUEL: { code: 'VEHICLE_FUEL', label: "Mashina: yoqilg'i", behavior: 'VARIABLE' },
  WASH: { code: 'VEHICLE_WASH', label: 'Mashina: moyka', behavior: 'VARIABLE' },
  REPAIR: { code: 'VEHICLE_REPAIR', label: "Mashina: ta'mirlash va ehtiyot qismlar", behavior: 'VARIABLE' },
  SERVICE: { code: 'VEHICLE_SERVICE', label: 'Mashina: texnik xizmat', behavior: 'MIXED' },
  OTHER: { code: 'VEHICLE_OTHER', label: "Mashina: sug'urta, texko'rik va boshqa", behavior: 'FIXED' },
};

/** Mashina guruhlari (Ombor › Mashinalar — kartochkalar shu tartibda) */
export const VEHICLE_GROUPS = [
  { value: 'TOSHKENT', label: 'Toshkent shahri' },
  { value: 'MARKSHEYDER', label: 'Marksheyder' },
  { value: 'RAHBARIYAT', label: 'Rahbariyat' },
  { value: 'QOSHIMCHA', label: "Qo'shimcha" },
] as const;
export type VehicleGroupValue = (typeof VEHICLE_GROUPS)[number]['value'];

/** Kuzov turlari — 3D ko'rinish shakli */
export const VEHICLE_BODY_TYPES = ['SEDAN', 'HATCH', 'SUV', 'MINIVAN', 'PICKUP', 'VAN', 'BUS'] as const;
export type VehicleBodyType = (typeof VEHICLE_BODY_TYPES)[number];

/** Markaz hudud kodi */
export const CENTRAL_REGION = 0;

// ═══════════════════════════════════════════════════════════
// Kirish ma'lumotlari
// ═══════════════════════════════════════════════════════════

export interface VehicleInput {
  plateNumber?: string;
  model?: string;
  year?: number | string | null;
  color?: string | null;
  fuelType?: string;
  fuelNorm?: number | string | null;
  regionCode?: number | string;
  departmentId?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  initialOdometerKm?: number | string | null;
  isActive?: boolean;
  note?: string | null;
  /** Guruh: TOSHKENT | MARKSHEYDER | RAHBARIYAT | QOSHIMCHA (bo'sh — guruhsiz) */
  fleetGroup?: string | null;
  /** Yoqilg'i kartasi raqami (AZS hisobotidan import uchun) */
  fuelCardNo?: string | null;
  /** Kuzov turi (3D): SEDAN | HATCH | SUV | MINIVAN | PICKUP | VAN | BUS */
  bodyType?: string | null;
}

export interface RecordInput {
  vehicleId?: string;
  kind?: string;
  /** "YYYY-MM-DD" */
  date?: string;
  /** Tiyin, satr ko'rinishida */
  amountTiyin?: string | number;
  liters?: number | string | null;
  odometerKm?: number | string | null;
  description?: string | null;
  counterparty?: string | null;
  documentNo?: string | null;
  paymentMethod?: string;
}

export interface RecordFilter {
  period?: string;
  vehicleId?: string;
  kind?: string;
}

// ═══════════════════════════════════════════════════════════
// Javoblar
// ═══════════════════════════════════════════════════════════

export interface VehicleLookups {
  regions: { code: number; name: string }[];
  departments: { id: string; name: string }[];
  fuelTypes: { value: VehicleFuelTypeValue; label: string }[];
  kinds: { value: VehicleRecordKindValue; label: string }[];
  groups: { value: string; label: string }[];
}

export interface VehicleListItem {
  id: string;
  plateNumber: string;
  model: string;
  year: number | null;
  color: string | null;
  fuelType: VehicleFuelTypeValue;
  fuelNorm: number | null;
  regionCode: number;
  regionName: string;
  departmentId: string | null;
  departmentName: string | null;
  /** Yo'nalish (Tax free, Marksheyder …) — biriktirilgan bo'lsa xarajati shu yo'nalishga yoziladi */
  segment: string | null;
  segmentLabel: string | null;
  /** Biriktirish izohi */
  placeComment: string | null;
  driverName: string | null;
  driverPhone: string | null;
  initialOdometerKm: number | null;
  isActive: boolean;
  note: string | null;
  fleetGroup: string | null;
  fleetGroupLabel: string | null;
  fuelCardNo: string | null;
  bodyType: string | null;
  /** Oxirgi spidometr ko'rsatkichi */
  lastOdometerKm: number | null;
  /** Tanlangan oy: tur bo'yicha summalar */
  month: {
    totalTiyin: string;
    count: number;
    liters: number;
    byKind: Record<VehicleRecordKindValue, string>;
  };
  /** Umumiy yozuvlar soni (o'chirishni tekshirish uchun) */
  recordCount: number;
}

export interface VehicleListResult {
  period: string;
  items: VehicleListItem[];
  totals: {
    totalTiyin: string;
    count: number;
    liters: number;
    byKind: Record<VehicleRecordKindValue, string>;
  };
}

export interface RecordItem {
  id: string;
  vehicleId: string;
  plateNumber: string;
  model: string;
  kind: VehicleRecordKindValue;
  date: string;
  period: string;
  amountTiyin: string;
  liters: number | null;
  odometerKm: number | null;
  description: string | null;
  counterparty: string | null;
  documentNo: string | null;
  paymentMethod: PaymentMethodValue;
  expenseId: string | null;
  createdAt: string;
}

export interface SummaryVehicleRow {
  vehicleId: string;
  plateNumber: string;
  model: string;
  isActive: boolean;
  fuelNorm: number | null;
  totalTiyin: string;
  byKind: Record<VehicleRecordKindValue, string>;
  liters: number;
  /** Davr ichidagi yurgan masofa (spidometr bo'yicha) */
  distanceKm: number | null;
  /** 100 km ga sarf (to'liq bak usuli) */
  consumptionPer100: number | null;
  /** 1 km narxi, so'm */
  costPerKmSom: number | null;
}

export interface VehicleSummary {
  from: string;
  to: string;
  months: { period: string; totalTiyin: string; byKind: Record<VehicleRecordKindValue, string> }[];
  vehicles: SummaryVehicleRow[];
  totals: { totalTiyin: string; byKind: Record<VehicleRecordKindValue, string>; liters: number };
}