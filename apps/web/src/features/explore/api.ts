import { api, type ApiResponse } from '@/lib/api';
import { formatDate, formatPeriodShort, formatSum, tiyinToSum } from '@/lib/format';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa › Daromad / Xarajat / Tahlil — ichiga kirib boriladigan jadvallar.
// Summalar tiyinda (son). Har bir qatordagi «f» — shu qatorni tashkil qilgan yozuvlar filtri.
// ═══════════════════════════════════════════════════════════

export type Kind = 'income' | 'expense';
export type Which = 'cur' | 'prev' | 'ly';

export interface Filter {
  cats?: string[];
  /** center | regions | segments | none | r:<kod> | s:<yo'nalish> (Tax free …) */
  unit?: string;
  dep?: string;
  month?: string;
  party?: string;
  unpaid?: boolean;
  exact?: boolean;
}

export interface Vals {
  cur: number;
  prev: number;
  ly: number;
  count: number;
}

export interface XNode extends Vals {
  key: string;
  label: string;
  kind: Kind;
  f: Filter;
  x?: Record<string, number>;
  children?: XNode[];
}

export interface MatrixRow {
  key: string;
  label: string;
  kind: Kind;
  f: Filter;
  values: number[];
  total: number;
  children?: MatrixRow[];
}

export interface Months {
  rows: MatrixRow[];
  total: MatrixRow;
  units: MatrixRow[];
}

export interface Span {
  from: string;
  to: string;
}

interface Header {
  cur: Span;
  prev: Span;
  ly: Span;
  /** Joriy davr oylari */
  monthList: string[];
}

export interface Parties {
  rows: XNode[];
  others: Vals & { parties: number };
  total: number;
}

export interface RecordRow {
  id: string;
  date: string;
  period: string;
  amount: number;
  open: number;
  status: string;
  category: string;
  categoryCode: string;
  unit: string;
  unitLabel: string;
  department: string | null;
  party: string | null;
  description: string | null;
  quantity: number | null;
  documentNo: string | null;
}

type UnitVals = Vals & { open: number };
/** Yo'nalish (Tax free, Marksheyder …) — o'z bo'limi sifatida */
export type SegmentVals = UnitVals & { key: string; label: string };

export interface IncomeExplore extends Header {
  totals: UnitVals & { received: number; quantity: number; center: UnitVals; regions: UnitVals; none: UnitVals; segments?: UnitVals; bySegment?: SegmentVals[] };
  tree: XNode[];
  categories: XNode[];
  regions: XNode[];
  departments: XNode[];
  months: Months;
  clients: Parties;
  top: RecordRow[];
}

export interface ExpenseExplore extends Header {
  totals: UnitVals & { paid: number; unpaidCount: number; center: UnitVals; regions: UnitVals; none: UnitVals; segments?: UnitVals; bySegment?: SegmentVals[] };
  tree: XNode[];
  regions: XNode[];
  departments: XNode[];
  months: Months;
  counterparties: Parties;
  top: RecordRow[];
}

export interface PnlRow {
  key: string;
  label: string;
  kind?: Kind;
  f?: Filter;
  values: number[];
  total: number;
  prev: number;
  ly: number;
  count?: number;
  children?: PnlRow[];
}

export interface UnitRow {
  key: string;
  label: string;
  income: UnitVals;
  expense: UnitVals;
  result: { cur: number; prev: number; ly: number };
  margin: number | null;
  marginPrev: number | null;
  incomeTop: XNode[];
  expenseTop: XNode[];
}

export interface ResultExplore extends Header {
  totals: {
    income: UnitVals;
    expense: UnitVals;
    result: { cur: number; prev: number; ly: number };
    margin: number | null;
    marginPrev: number | null;
    marginLy: number | null;
    receivable: number;
    payable: number;
  };
  pnl: {
    income: PnlRow;
    expense: PnlRow;
    result: PnlRow;
    margin: { values: (number | null)[]; total: number | null; prev: number | null; ly: number | null };
  };
  units: UnitRow[];
}

export interface RecordsPage {
  span: Span;
  page: number;
  pages: number;
  pageSize: number;
  count: number;
  total: number;
  quantity: number | null;
  rows: RecordRow[];
}

export type Sort = 'amount' | 'date' | 'date-asc';

function filterParams(f: Filter): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.cats?.length) p.cats = f.cats.join(',');
  if (f.unit) p.unit = f.unit;
  if (f.dep) p.dep = f.dep;
  if (f.month) p.month = f.month;
  if (f.party !== undefined) p.party = f.party;
  if (f.unpaid) p.unpaid = '1';
  if (f.exact) p.exact = '1';
  return p;
}

export const exploreApi = {
  income: (from: string, to: string) => api.get<ApiResponse<IncomeExplore>>('/explore/income', { params: { from, to } }),
  expense: (from: string, to: string) => api.get<ApiResponse<ExpenseExplore>>('/explore/expense', { params: { from, to } }),
  result: (from: string, to: string) => api.get<ApiResponse<ResultExplore>>('/explore/result', { params: { from, to } }),
  records: (kind: Kind, from: string, to: string, f: Filter, which: Which, page: number, sort: Sort) =>
    api.get<ApiResponse<RecordsPage>>('/explore/records', { params: { kind, from, to, which, page, sort, ...filterParams(f) } }),
};

// ───────────────────────── Yordamchilar ─────────────────────────

/** O'zgarish ulushi: (joriy − asos) / |asos|; asos 0 bo'lsa — null */
export function change(cur: number, base: number): number | null {
  if (!base) return null;
  return (cur - base) / Math.abs(base);
}

export function share(part: number, total: number): number | null {
  if (!total) return null;
  return part / total;
}

/** 0,1234 → "12,3%" */
export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits).replace('.', ',')}%`;
}

/** O'zgarish: "+12,3%" */
export function pctSigned(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  const s = pct(v);
  return v > 0 ? `+${s}` : s;
}

/** To'liq summa: 1 234 567 (so'm, tiyinsiz) */
export function som(tiyin: number): string {
  return formatSum(tiyinToSum(Math.round(tiyin)));
}

/** Qisqa summa: 1,2 mln / 3,45 mlrd */
export function short(tiyin: number): string {
  const v = tiyin / 100;
  const a = Math.abs(v);
  const f = (x: number, d: number) => x.toFixed(d).replace('.', ',');
  if (a >= 1e9) return `${f(v / 1e9, 2)} mlrd`;
  if (a >= 1e6) return `${f(v / 1e6, 1)} mln`;
  if (a >= 1e3) return `${Math.round(v / 1e3)} ming`;
  return `${Math.round(v)}`;
}

export function spanText(s: Span): string {
  return `${formatDate(s.from)} — ${formatDate(s.to)}`;
}

export function monthLabel(m: string): string {
  return formatPeriodShort(m);
}

/** Ushbu yo'nalishda o'sish yaxshimi */
export function goodUp(kind: Kind | 'result'): boolean {
  return kind !== 'expense';
}

/** Kategorik ranglar (tekshirilgan tartib) — doim bir xil tartibda beriladi */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#6250d6'];
export const OTHER = '#a3a29c';
export const UNIT_COLOR: Record<string, string> = {
  center: SERIES[0]!,
  regions: SERIES[1]!,
  's:TAX_FREE': SERIES[2]!,
  's:MARKSHEYDER': SERIES[3]!,
  's:FERMER': SERIES[4]!,
  's:BUXGALTERIYA': SERIES[5]!,
  's:QOMITA': '#8a6d3b',
  none: OTHER,
};

/** CSV yuklab olish (Excel ochadi) */
export function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    const s = v === null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100).replace('.', ',') : v;
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(['﻿' + rows.map((r) => r.map(esc).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** So'm (tiyin → so'm, CSV uchun) */
export const csvSom = (tiyin: number) => Math.round(tiyin) / 100;