import { api, type ApiResponse } from '@/lib/api';
import type { DateRange } from '@/components/shared/date-range-picker';
import type { CompareMode, SectionFilter } from '@/features/structure/api';
import type { ItemFilter, ItemKind, MarkItem } from '@/features/reactions/api';

// ═══════════════════════════════════════════════════════════
// Solishtirma: hududlar va Markaz — backend bilan bir xil turlar
// ═══════════════════════════════════════════════════════════

/** segment — yo'nalish (Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari) */
export type UnitKind = 'region' | 'center' | 'segment' | 'unassigned';

export interface UnitPart {
  key: string;
  label: string;
  amountTiyin: string;
  previousTiyin: string;
}

export interface RegionUnit {
  key: string;
  code: number | null;
  name: string;
  kind: UnitKind;
  /** Yo'nalish kodi (kind = segment) */
  segment?: string;
  incomeTiyin: string;
  previousIncomeTiyin: string;
  expenseTiyin: string;
  previousExpenseTiyin: string;
  payrollTiyin: string;
  previousPayrollTiyin: string;
  expenseParts: UnitPart[];
  incomeParts: UnitPart[];
  headcount: number;
  previousHeadcount: number;
  incomeTrend: string[];
  expenseTrend: string[];
  incomeCount: number;
  expenseCount: number;
  /** Faqat Markaz (Xarajatlar siyosati): o'ziniki va hududlar uchun */
  centerSplit?: {
    ownTiyin: string;
    regionalTiyin: string;
    previousOwnTiyin: string;
    previousRegionalTiyin: string;
    /** 2-guruh: asosiy vositalar sarfi (eskirish) */
    assetsTiyin?: string;
    previousAssetsTiyin?: string;
    byRegion: { code: number | null; amountTiyin: string }[];
  };
}

export interface RegionsResult {
  section: SectionFilter;
  compare: CompareMode;
  compareLabel: string;
  range: DateRange;
  previousRange: DateRange;
  months: string[];
  units: RegionUnit[];
  notes: string[];
}

// ─────────── Hududga biriktirilmagan yozuvlar ───────────

export interface UnassignedItem {
  id: string;
  date: string;
  period: string;
  amountTiyin: string;
  categoryCode: string;
  categoryLabel: string;
  section: string;
  source: string;
  /** Xarajatda — kontragent, daromadda — mijoz */
  counterparty: string | null;
  description: string | null;
  documentNo: string | null;
  fileName: string | null;
}

export interface UnassignedGroup {
  key: string;
  label: string;
  totalTiyin: string;
  count: number;
}

export interface UnassignedSide {
  totalTiyin: string;
  count: number;
  byCategory: UnassignedGroup[];
  bySource: UnassignedGroup[];
  byFile: UnassignedGroup[];
  items: UnassignedItem[];
  truncated: boolean;
}

export interface UnassignedResult {
  range: DateRange;
  section: SectionFilter;
  months: { period: string; incomeTiyin: string; expenseTiyin: string }[];
  income: UnassignedSide;
  expense: UnassignedSide;
  policyExcludedTiyin: string;
}

export interface UnassignedDetail {
  side: 'expense' | 'income';
  id: string;
  date: string;
  period: string;
  amountTiyin: string;
  categoryCode: string;
  categoryLabel: string;
  section: string;
  source: string;
  sourceLabel: string;
  counterparty: string | null;
  description: string | null;
  documentNo: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  dueDate: string | null;
  responsible: string | null;
  vatTiyin: string | null;
  paidTiyin: string | null;
  quantity: number | null;
  recurrence: string | null;
  district: string | null;
  createdBy: { fullName: string; username: string; role: string } | null;
  createdAt: string;
  updatedAt: string | null;
  file: { fileName: string; period: string | null; uploadedAt: string; uploadedBy: string | null } | null;
  payroll: { period: string; fileName: string | null; scope: string } | null;
  /** Shu kontragent bilan boshqa yozuvlar qayerga yozilgan */
  hints: { unitKey: string; name: string; count: number; totalTiyin: string; lastDate: string }[];
}

export const SOURCE_LABELS: Record<string, string> = {
  MANUAL: "Qo'lda",
  IMPORT: 'Fayldan',
  PAYROLL: 'Ish haqi',
  LEASE: 'Ijara',
  VEHICLE: 'Mashinalar',
  WAREHOUSE: 'Ombor',
  ASSET: 'Asosiy vositalar',
  TAX: 'Soliqlar',
};

export const regionsApi = {
  compare: (range: DateRange, section: SectionFilter, compare: CompareMode) =>
    api.get<ApiResponse<RegionsResult>>('/structure/regions', {
      params: { from: range.from, to: range.to, section, compare },
    }),
  unassigned: (range: DateRange, section: SectionFilter) =>
    api.get<ApiResponse<UnassignedResult>>('/structure/regions/unassigned', {
      params: { from: range.from, to: range.to, section },
    }),
  unassignedItem: (side: 'expense' | 'income', id: string) => api.get<ApiResponse<UnassignedDetail>>(`/structure/regions/unassigned/${side}/${id}`),
};

// ═══════════════════════════════════════════════════════════
// Hisoblangan ko'rsatkichlar (bir joyda — jadval, grafik va karta bir xil raqamni ishlatadi)
// ═══════════════════════════════════════════════════════════

export interface UnitStats {
  unit: RegionUnit;
  income: number;
  expense: number;
  payroll: number;
  profit: number;
  previousIncome: number;
  previousExpense: number;
  previousProfit: number;
  /** Rentabellik: foyda / daromad, % */
  margin: number | null;
  previousMargin: number | null;
  /** Foyda farqi (so'm) */
  profitDelta: number;
  incomePerHead: number | null;
  expensePerHead: number | null;
  /** 24 oylik foyda */
  profitTrend: number[];
  /** So'nggi 12 oyda zarar bilan yopilgan oylar */
  lossMonths: number;
  /** So'nggi 12 oyda ma'lumoti bor oylar */
  activeMonths: number;
}

export function statsOf(unit: RegionUnit): UnitStats {
  const income = Number(unit.incomeTiyin);
  const expense = Number(unit.expenseTiyin);
  const previousIncome = Number(unit.previousIncomeTiyin);
  const previousExpense = Number(unit.previousExpenseTiyin);
  const incomeTrend = unit.incomeTrend.map(Number);
  const expenseTrend = unit.expenseTrend.map(Number);
  const profitTrend = incomeTrend.map((v, i) => v - expenseTrend[i]!);
  const last12 = profitTrend.slice(-12);
  const active12 = incomeTrend.slice(-12).map((v, i) => v !== 0 || expenseTrend.slice(-12)[i] !== 0);
  return {
    unit,
    income,
    expense,
    payroll: Number(unit.payrollTiyin),
    profit: income - expense,
    previousIncome,
    previousExpense,
    previousProfit: previousIncome - previousExpense,
    margin: income > 0 ? ((income - expense) / income) * 100 : null,
    previousMargin: previousIncome > 0 ? ((previousIncome - previousExpense) / previousIncome) * 100 : null,
    profitDelta: income - expense - (previousIncome - previousExpense),
    incomePerHead: unit.headcount > 0 ? income / unit.headcount : null,
    expensePerHead: unit.headcount > 0 ? expense / unit.headcount : null,
    profitTrend,
    lossMonths: last12.filter((v, i) => active12[i] && v < 0).length,
    activeMonths: active12.filter(Boolean).length,
  };
}

export const KIND_LABEL: Record<UnitKind, string> = {
  region: 'Hudud',
  center: 'Markaz',
  segment: "Yo'nalish",
  unassigned: 'Biriktirilmagan',
};

/** Ro'yxatdagi tartib: Markaz, hududlar, yo'nalishlar, biriktirilmagan */
export const KIND_ORDER: Record<UnitKind, number> = { center: 0, region: 1, segment: 2, unassigned: 3 };

// ═══════════════════════════════════════════════════════════
// Munosabat belgilari: hudud, uning daromadi/xarajati va tarkibidagi moddalar
// ═══════════════════════════════════════════════════════════

const ORIGIN = 'Solishtirma';

function withSection(filter: ItemFilter, section: SectionFilter): ItemFilter {
  return section === 'ALL' ? filter : { ...filter, section };
}

export function unitMark(unit: RegionUnit, kind: ItemKind, section: SectionFilter): MarkItem {
  const what = kind === 'INCOME' ? 'daromad' : kind === 'EXPENSE' ? 'xarajat' : 'natija';
  return {
    kind,
    label: `${unit.name} · ${what}${section === 'ALL' ? '' : section === 'DOIMIY' ? ' (Doimiy)' : ' (Boshqa)'}`,
    filter: withSection({ unit: unit.key }, section),
    origin: ORIGIN,
  };
}

export function unitPartMark(unit: RegionUnit, side: 'INCOME' | 'EXPENSE', part: UnitPart, section: SectionFilter): MarkItem | null {
  if (part.key === 'rest') return null;
  const filter: ItemFilter = { unit: unit.key };
  if (side === 'INCOME') filter.categoryCode = part.key;
  else if (part.key === 'PAYROLL' || part.key === 'LEASE' || part.key === 'VEHICLE') filter.source = part.key;
  else if (part.key.startsWith('c:')) filter.rootCategoryCode = part.key.slice(2);
  else return null;
  return { kind: side, label: `${unit.name} · ${part.label}`, filter: withSection(filter, section), origin: ORIGIN };
}