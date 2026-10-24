import type { DateRange } from '@/components/shared/date-range-picker';
import type { CompareMode, SectionFilter } from '@/features/structure/api';
import { api, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Solishtirma › yo'nalish (Tax free, Marksheyder …): /api/structure/regions/segment/:code
// ═══════════════════════════════════════════════════════════

/** Bosh sahifa yozuvlari filtri (explore/records) */
export interface SegFilter {
  unit: string;
  cats?: string[];
  exact?: boolean;
}

export interface SegPart {
  code: string;
  label: string;
  amountTiyin: string;
  previousTiyin: string;
  count: number;
  f: SegFilter;
  children?: SegPart[];
}

export interface SegFlow {
  unit: string;
  unitLabel: string;
  code: string;
  label: string;
  amountTiyin: string;
  previousTiyin: string;
  count: number;
  f: SegFilter;
}

export interface SegmentView {
  code: string;
  label: string;
  unitKey: string;
  section: SectionFilter;
  compare: CompareMode;
  compareLabel: string;
  range: DateRange;
  previousRange: DateRange;
  months: string[];
  totals: {
    incomeTiyin: string;
    previousIncomeTiyin: string;
    expenseTiyin: string;
    previousExpenseTiyin: string;
    resultTiyin: string;
    previousResultTiyin: string;
    margin: number | null;
    previousMargin: number | null;
    incomeCount: number;
    expenseCount: number;
    payrollTiyin: string;
    /** Boshqa bo'limlardan siyosat bo'yicha kelgan */
    incomingTiyin: string;
    /** Shu bo'limda yozilgan, boshqa bo'lim hisobiga o'tgan */
    outgoingTiyin: string;
    incomeShare: number | null;
    expenseShare: number | null;
  };
  trend: { income: string[]; expense: string[]; result: string[] };
  incomeParts: SegPart[];
  expenseParts: SegPart[];
  incoming: SegFlow[];
  outgoing: SegFlow[];
}

export const segmentApi = {
  view: (code: string, range: DateRange, section: SectionFilter, compare: CompareMode) =>
    api.get<ApiResponse<SegmentView>>(`/structure/regions/segment/${encodeURIComponent(code)}`, { params: { from: range.from, to: range.to, section, compare } }),
};