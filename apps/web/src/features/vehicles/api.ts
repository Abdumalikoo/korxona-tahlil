import { api, getToken, type ApiResponse } from '@/lib/api';
import { parseSum, tiyinToSum } from '@/lib/format';

// ═══════════════════════════════════════════════════════════
// Mashinalar — backend bilan bir xil turlar
// ═══════════════════════════════════════════════════════════

export type VehicleFuelType = 'AI80' | 'AI92' | 'AI95' | 'DIZEL' | 'METAN' | 'PROPAN' | 'ELEKTR';
export type VehicleRecordKind = 'FUEL' | 'WASH' | 'REPAIR' | 'SERVICE' | 'OTHER';
export type VehiclePaymentMethod = 'CASH' | 'BANK' | 'CARD' | 'OTHER';
export type VehicleBodyType = 'SEDAN' | 'HATCH' | 'SUV' | 'MINIVAN' | 'PICKUP' | 'VAN' | 'BUS';

export const BODY_LABELS: Record<VehicleBodyType, string> = {
  SEDAN: 'Sedan (Cobalt, Gentra, Malibu)',
  HATCH: 'Xetchbek (Spark, Matiz)',
  SUV: 'Krossover / SUV (Tracker, Captiva)',
  MINIVAN: 'Miniven (Damas, Orlando)',
  PICKUP: 'Pikap (Labo)',
  VAN: 'Furgon (Gazel, Sprinter)',
  BUS: 'Avtobus',
};

/** Rusumidan kuzov turi: «Chevrolet Damas» → MINIVAN */
export function bodyTypeOf(v: { model: string; bodyType?: VehicleBodyType | null }): VehicleBodyType {
  if (v.bodyType) return v.bodyType;
  const m = v.model.toLowerCase();
  if (/labo|pikap|pickup|hilux|l200|navara|ranger/.test(m)) return 'PICKUP';
  if (/damas|orlando|minivan|miniven|carnival|sienna|hyundai h-?1|starex/.test(m)) return 'MINIVAN';
  if (/gazel|gazelle|sprinter|transit|furgon|isuzu n|van\b|hyundai porter|porter/.test(m)) return 'VAN';
  if (/avtobus|bus\b|isuzu (sam|bogdan)|yutong|higer|paz/.test(m)) return 'BUS';
  if (/spark|matiz|tico|i10|picanto|kia rio x|hatch|xetch/.test(m)) return 'HATCH';
  if (/tracker|captiva|equinox|tahoe|traverse|trailblazer|suv|cruiser|prado|rav4|tucson|sportage|santa fe|x5|x6|kx|jetour|chery tiggo|haval|byd song|lixiang|li auto/.test(m)) return 'SUV';
  return 'SEDAN';
}

export type KindAmounts = Record<VehicleRecordKind, string>;

export interface VehicleLookups {
  regions: { code: number; name: string }[];
  departments: { id: string; name: string }[];
  fuelTypes: { value: VehicleFuelType; label: string }[];
  kinds: { value: VehicleRecordKind; label: string }[];
  /** Mashina guruhlari: Toshkent shahri, Marksheyder, Rahbariyat, Qo'shimcha */
  groups?: { value: string; label: string }[];
}

export interface VehicleItem {
  id: string;
  plateNumber: string;
  model: string;
  year: number | null;
  color: string | null;
  fuelType: VehicleFuelType;
  fuelNorm: number | null;
  regionCode: number;
  regionName: string;
  departmentId: string | null;
  departmentName: string | null;
  driverName: string | null;
  driverPhone: string | null;
  initialOdometerKm: number | null;
  isActive: boolean;
  note: string | null;
  fleetGroup?: string | null;
  fleetGroupLabel?: string | null;
  /** Yoqilg'i kartasi raqami (AZS hisobotidan import) */
  fuelCardNo?: string | null;
  /** Kuzov turi (3D): bo'sh — rusumidan aniqlanadi */
  bodyType?: VehicleBodyType | null;
  /** Yo'nalishga biriktirilgan bo'lsa (Tax free, Marksheyder …) */
  segment?: string | null;
  segmentLabel?: string | null;
  /** Bo'limga biriktirish izohi */
  placeComment?: string | null;
  lastOdometerKm: number | null;
  month: { totalTiyin: string; count: number; liters: number; byKind: KindAmounts };
  recordCount: number;
}

/** Mashina qaysi birlikniki: Markaz (bo'lim bilan), hudud yoki yo'nalish */
export type VehicleUnit = 'CENTER' | 'REGION' | 'TAX_FREE' | 'MARKSHEYDER' | 'FERMER' | 'BUXGALTERIYA' | 'QOMITA';

export interface VehiclePlaceRow {
  id: string;
  plateNumber: string;
  model: string;
  driverName: string | null;
  fleetGroup: string | null;
  fleetGroupLabel: string | null;
  isActive: boolean;
  unit: VehicleUnit;
  regionCode: number;
  regionName: string;
  departmentId: string | null;
  departmentName: string | null;
  segment: string | null;
  placeLabel: string;
  comment: string | null;
  commentAt: string | null;
  totalTiyin: string;
  count: number;
  months: Record<string, string>;
}

export interface VehiclePlaces {
  from: string;
  to: string;
  months: string[];
  items: VehiclePlaceRow[];
}

export interface VehiclePlaceInput {
  id: string;
  unit: VehicleUnit;
  regionCode?: number | null;
  departmentId?: string | null;
  comment?: string | null;
}

export interface VehicleList {
  period: string;
  items: VehicleItem[];
  totals: { totalTiyin: string; count: number; liters: number; byKind: KindAmounts };
}

export interface VehicleRecordItem {
  id: string;
  vehicleId: string;
  plateNumber: string;
  model: string;
  kind: VehicleRecordKind;
  date: string;
  period: string;
  amountTiyin: string;
  liters: number | null;
  odometerKm: number | null;
  description: string | null;
  counterparty: string | null;
  documentNo: string | null;
  paymentMethod: VehiclePaymentMethod;
  expenseId: string | null;
  createdAt: string;
}

export interface VehicleSummaryRow {
  vehicleId: string;
  plateNumber: string;
  model: string;
  isActive: boolean;
  fuelNorm: number | null;
  totalTiyin: string;
  byKind: KindAmounts;
  liters: number;
  distanceKm: number | null;
  consumptionPer100: number | null;
  costPerKmSom: number | null;
}

export interface VehicleSummary {
  from: string;
  to: string;
  months: { period: string; totalTiyin: string; byKind: KindAmounts }[];
  vehicles: VehicleSummaryRow[];
  totals: { totalTiyin: string; byKind: KindAmounts; liters: number };
}

export interface VehicleInput {
  plateNumber: string;
  model: string;
  year: number | null;
  color: string | null;
  fuelType: VehicleFuelType;
  fuelNorm: number | null;
  regionCode: number;
  departmentId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  initialOdometerKm: number | null;
  isActive: boolean;
  note: string | null;
  fleetGroup?: string | null;
  fuelCardNo?: string | null;
  bodyType?: VehicleBodyType | null;
}

export interface RecordInput {
  vehicleId: string;
  kind: VehicleRecordKind;
  date: string;
  amountTiyin: string;
  liters: number | null;
  odometerKm: number | null;
  description: string | null;
  counterparty: string | null;
  documentNo: string | null;
  paymentMethod: VehiclePaymentMethod;
}

// ═══════════════════════════════════════════════════════════
// Yorliqlar va ranglar
// ═══════════════════════════════════════════════════════════

export const KINDS: VehicleRecordKind[] = ['FUEL', 'WASH', 'REPAIR', 'SERVICE', 'OTHER'];

export const KIND_LABELS: Record<VehicleRecordKind, string> = {
  FUEL: "Yoqilg'i",
  WASH: 'Moyka',
  REPAIR: "Ta'mirlash",
  SERVICE: 'Texnik xizmat',
  OTHER: 'Boshqa',
};

export const KIND_HINTS: Record<VehicleRecordKind, string> = {
  FUEL: 'Benzin, gaz, dizel',
  WASH: 'Yuvish, salon tozalash',
  REPAIR: "Ta'mirlash ishi va ehtiyot qismlar",
  SERVICE: 'Moy, filtr, shina almashtirish',
  OTHER: "Sug'urta, texko'rik, jarima, to'xtash joyi",
};

export const KIND_COLORS: Record<VehicleRecordKind, string> = {
  FUEL: 'var(--color-brand-600, #2563eb)',
  WASH: '#06b6d4',
  REPAIR: '#ef4444',
  SERVICE: '#f59e0b',
  OTHER: '#94a3b8',
};

export const FUEL_LABELS: Record<VehicleFuelType, string> = {
  AI80: 'AI-80',
  AI92: 'AI-92',
  AI95: 'AI-95',
  DIZEL: 'Dizel',
  METAN: 'Metan',
  PROPAN: 'Propan',
  ELEKTR: 'Elektr',
};

/** Yoqilg'i birligi: gazda m³, elektrda kVt·soat */
export function fuelUnit(fuelType: VehicleFuelType): string {
  if (fuelType === 'METAN') return 'm³';
  if (fuelType === 'ELEKTR') return 'kVt·s';
  return 'l';
}

export const PAYMENT_LABELS: Record<VehiclePaymentMethod, string> = {
  CASH: 'Naqd',
  CARD: 'Karta',
  BANK: "Bank o'tkazmasi",
  OTHER: 'Boshqa',
};

/** "1 250 000,50" → "125000050" (tiyin); noto'g'ri yoki ≤ 0 bo'lsa null */
export function somToTiyin(text: string): string | null {
  const value = parseSum(text);
  if (!value || value.lte(0)) return null;
  return value.times(100).toDecimalPlaces(0).toFixed(0);
}

/** Tiyin → formadagi so'm matni: "125000050" → "1250000,5" */
export function tiyinToInput(tiyin: string): string {
  return tiyinToSum(tiyin).toString().replace('.', ',');
}

/** Son maydoni: "25,5" → 25.5; bo'sh → null; noto'g'ri → NaN */
export function parseNumber(text: string): number | null {
  const clean = text.replace(/[\s\u00A0]/g, '').replace(',', '.');
  if (!clean) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : Number.NaN;
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

// ─────────── Yoqilg'i hisoboti (AZS) importi ───────────

export interface FuelRow {
  key: string;
  at: string;
  date: string;
  time: string;
  station: string;
  fuel: string;
  fuelType: VehicleFuelType | null;
  liters: number;
  priceTiyin: string;
  amountTiyin: string;
  vatTiyin: string;
  exists: boolean;
  error: string | null;
}

export interface FuelCard {
  key: string;
  label: string;
  cardNo: string | null;
  plate: string | null;
  liters: number;
  amountTiyin: string;
  fileTotalTiyin: string | null;
  totalOk: boolean;
  count: number;
  newCount: number;
  existsCount: number;
  fuels: { fuel: string; liters: number; amountTiyin: string }[];
  firstDate: string | null;
  lastDate: string | null;
  match: { vehicleId: string; plateNumber: string; model: string; by: 'card' | 'plate'; isActive: boolean } | null;
  rows: FuelRow[];
}

export interface FuelAnalysis {
  fileName: string;
  periodFrom: string | null;
  periodTo: string | null;
  organization: string | null;
  totals: { liters: number; amountTiyin: string; vatTiyin: string; count: number; newCount: number; existsCount: number };
  check: { fileTotalTiyin: string | null; ok: boolean };
  byFuel: { fuel: string; liters: number; amountTiyin: string }[];
  cards: FuelCard[];
  warnings: string[];
}

export interface FuelCommitCard {
  key: string;
  cardNo: string | null;
  plate: string | null;
  action: 'vehicle' | 'new' | 'skip';
  vehicleId?: string | null;
  newVehicle?: { model?: string; fleetGroup?: string | null; regionCode?: number | null } | null;
  rows: FuelRow[];
}

export interface FuelCommitResult {
  created: number;
  skipped: number;
  vehiclesCreated: number;
  cardsLinked: number;
  amountTiyin: string;
  liters: number;
  errors: { card: string; reason: string }[];
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/** AZS hisobotini (.xls / .xlsx) tekshirish — hech narsa yozilmaydi */
export async function analyzeFuelReport(file: File): Promise<FuelAnalysis> {
  const form = new FormData();
  form.append('file', file);
  const token = getToken();
  const response = await fetch(`${BASE}/vehicles/fuel-import/analyze`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  if (!response.ok) {
    let message = "Faylni tekshirib bo'lmadi";
    try {
      const body = (await response.json()) as { error?: { message?: string | string[] } };
      const m = body.error?.message;
      if (m) message = Array.isArray(m) ? (m[0] ?? message) : m;
    } catch {
      // javob JSON emas
    }
    throw new Error(message);
  }
  return ((await response.json()) as ApiResponse<FuelAnalysis>).data;
}

/** Demo holati (faqat administrator) */
export interface VehicleDemoStatus {
  vehicles: number;
  records: number;
  totalTiyin: string;
}

export const vehiclesApi = {
  fuelCommit: (body: { fileName: string; paymentMethod: VehiclePaymentMethod; cards: FuelCommitCard[] }) =>
    api.post<ApiResponse<FuelCommitResult>>('/vehicles/fuel-import/commit', body),

  lookups: () => api.get<ApiResponse<VehicleLookups>>('/vehicles/lookups'),

  list: (period: string) => api.get<ApiResponse<VehicleList>>('/vehicles', { params: { period } }),

  create: (input: VehicleInput) => api.post<ApiResponse<{ id: string; plateNumber: string }>>('/vehicles', input),

  update: (id: string, input: Partial<VehicleInput>) =>
    api.patch<ApiResponse<{ id: string; plateNumber: string }>>(`/vehicles/${id}`, input),

  remove: (id: string) => api.delete<ApiResponse<{ id: string }>>(`/vehicles/${id}`),

  records: (params: { period: string; vehicleId?: string; kind?: string }) =>
    api.get<ApiResponse<VehicleRecordItem[]>>('/vehicles/records', { params }),

  createRecord: (input: RecordInput) => api.post<ApiResponse<VehicleRecordItem>>('/vehicles/records', input),

  updateRecord: (id: string, input: RecordInput) =>
    api.patch<ApiResponse<VehicleRecordItem>>(`/vehicles/records/${id}`, input),

  removeRecord: (id: string) => api.delete<ApiResponse<{ id: string }>>(`/vehicles/records/${id}`),

  /** Oldingi AZS / moyka / servis nomlari */
  counterparties: (kind?: string) => api.get<ApiResponse<string[]>>('/vehicles/counterparties', { params: { kind } }),

  /** Bo'limlarga biriktirish: mashinalar, joyi va davr xarajati */
  places: (from: string, to: string) => api.get<ApiResponse<VehiclePlaces>>('/vehicles/places', { params: { from, to } }),
  setPlaces: (items: VehiclePlaceInput[], fromPeriod: string | null) =>
    api.post<ApiResponse<{ vehicles: number; expenses: number }>>('/vehicles/places', { items, fromPeriod }),

  summary: (from: string, to: string) =>
    api.get<ApiResponse<VehicleSummary>>('/vehicles/summary', { params: { from, to } }),

  /** Demo: 13 ta namunaviy mashina va 3 oylik xarajatlar (Xarajatlarga ham yoziladi) */
  demoStatus: () => api.get<ApiResponse<VehicleDemoStatus>>('/vehicles/demo'),
  createDemo: () => api.post<ApiResponse<VehicleDemoStatus>>('/vehicles/demo'),
  removeDemo: () => api.delete<ApiResponse<VehicleDemoStatus>>('/vehicles/demo'),
};
// ═══════════ Choraklik hisobot (24-ilova) ═══════════

export type QuarterScale = 'THOUSAND' | 'SOM';

export interface QuarterRow {
  n: number;
  org: string;
  model: string;
  plate: string;
  plateKey: string;
  madeYear: number | null;
  balanceYear: number | null;
  count: number | null;
  balanceValueTiyin: string;
  storageTiyin: string;
  equipTiyin: string;
  distancePeriodKm: number | null;
  distanceTotalKm: number | null;
  vehicleId: string | null;
  vehicleLabel: string | null;
}

export interface QuarterAnalysis {
  year: number | null;
  quarter: number | null;
  scale: QuarterScale;
  rows: QuarterRow[];
  warnings: string[];
  exists: boolean;
}

export interface QuarterStored {
  key: string;
  year: number;
  quarter: number;
  fileName: string;
  scale: QuarterScale;
  savedAt: string;
  savedBy: string;
  rows: QuarterRow[];
  repairTiyin: string;
  records: number;
}

/** Choraklik hisobotni o'qish — hech narsa yozilmaydi */
export async function analyzeQuarterReport(file: File, scale: QuarterScale): Promise<QuarterAnalysis> {
  const form = new FormData();
  form.append('file', file);
  const token = getToken();
  const response = await fetch(`${BASE}/vehicles/quarterly/analyze?scale=${scale}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  if (!response.ok) {
    let message = "Faylni o'qib bo'lmadi";
    try {
      const body = (await response.json()) as { error?: { message?: string | string[] } };
      const m = body.error?.message;
      if (m) message = Array.isArray(m) ? (m[0] ?? message) : m;
    } catch {
      // javob JSON emas
    }
    throw new Error(message);
  }
  return ((await response.json()) as ApiResponse<QuarterAnalysis>).data;
}

/** Bo'sh shablon (mashinalar ro'yxati bilan) */
export async function downloadQuarterTemplate(year: number, quarter: number): Promise<void> {
  const token = getToken();
  const response = await fetch(`${BASE}/vehicles/quarterly/template?year=${year}&quarter=${quarter}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error("Shablonni yuklab bo'lmadi");
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `Choraklik-hisobot-${year}-${quarter}-chorak.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const quarterlyApi = {
  list: () => api.get<ApiResponse<QuarterStored[]>>('/vehicles/quarterly'),
  commit: (body: { year: number; quarter: number; scale: QuarterScale; fileName: string; rows: QuarterRow[] }) =>
    api.post<ApiResponse<{ key: string; vehicles: number; createdVehicles: number; records: number; repairTiyin: string }>>('/vehicles/quarterly/commit', body),
  remove: (key: string) => api.delete<ApiResponse<{ key: string; removed: number }>>(`/vehicles/quarterly/${key}`),
};
