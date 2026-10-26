import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Bank ko'chirmasi — tahlil: /api/bank-analysis/…
// Xarajat va daromadga yozilmaydi: o'xshash to'lovlar oyma-oy va o'sib boruvchi guruhlanadi.
// ═══════════════════════════════════════════════════════════

export type BankDir = 'OUT' | 'IN';
export type BankKind = 'SOLIQ' | 'ISH_HAQI' | 'BANK' | 'KOMMUNAL' | 'ALOQA' | 'IJARA' | 'YOQILGI' | 'XARID' | 'XIZMAT' | 'KREDIT' | 'DEPOZIT' | 'QAYTARISH' | 'ICHKI' | 'TUSHUM' | 'BOSHQA';

/** Takrorlanishi: muntazam, vaqti-vaqti bilan, bir martalik */
export type BankPattern = 'REGULAR' | 'IRREGULAR' | 'ONCE';

export const PATTERN_LABEL: Record<BankPattern, string> = { REGULAR: 'Muntazam', IRREGULAR: 'Vaqti-vaqti bilan', ONCE: 'Bir martalik' };

export const KIND_OPTIONS: { code: BankKind; label: string }[] = [
  { code: 'SOLIQ', label: 'Soliq va majburiy to‘lovlar' },
  { code: 'ISH_HAQI', label: 'Ish haqi va xodimlarga' },
  { code: 'BANK', label: 'Bank xizmati' },
  { code: 'KOMMUNAL', label: 'Kommunal' },
  { code: 'ALOQA', label: 'Aloqa va internet' },
  { code: 'IJARA', label: 'Ijara' },
  { code: 'YOQILGI', label: 'Yoqilg‘i' },
  { code: 'XARID', label: 'Tovar va material' },
  { code: 'XIZMAT', label: 'Xizmat va ishlar' },
  { code: 'KREDIT', label: 'Kredit va foiz' },
  { code: 'DEPOZIT', label: 'Depozit' },
  { code: 'QAYTARISH', label: 'Qaytarish' },
  { code: 'ICHKI', label: 'Ichki o‘tkazma (hisoblararo)' },
  { code: 'TUSHUM', label: 'Xizmat tushumi' },
  { code: 'BOSHQA', label: 'Boshqa' },
];

export interface BankRow {
  id: string;
  /** Schyot-faktura qatorida */
  invoiceId?: string;
  itemNo?: string;
  status?: string;
  docType?: string;
  contract?: string;
  contractDate?: string | null;
  ikpu?: string;
  unit?: string;
  qty?: number | null;
  costTiyin?: string;
  vatTiyin?: string;
  vatRate?: number | null;
  /** Xizmat oyi (faktura) */
  period?: string;
  invoiceNote?: string;
  ourBranch?: string;
  docDate: string;
  procDate: string | null;
  docNo: string;
  accountName: string;
  inn: string;
  mfo: string;
  dir: BankDir;
  amountTiyin: string;
  purpose: string;
}

export interface BankGroup {
  key: string;
  dir: BankDir;
  kind: BankKind;
  kindLabel: string;
  counterparty: string;
  /** Siz bergan nom */
  name: string | null;
  /** Hisobot moddasi (siz bergan) */
  category: string | null;
  autoKind: BankKind;
  kindEdited: boolean;
  pattern: BankPattern;
  inn: string | null;
  label: string;
  samples: string[];
  count: number;
  totalTiyin: string;
  sharePct: number;
  avgTiyin: string;
  byMonth: Record<string, string>;
  countByMonth: Record<string, number>;
  cumulative: string[];
  activeMonths: number;
  regular: boolean;
  firstDate: string;
  lastDate: string;
  changePct: number | null;
  /** Xarajat / daromadga yo'naltirilgani */
  postedCount: number;
  postedTiyin: string;
  /** Faqat yuklashdan oldingi tahlilda: guruh qatorlari */
  rowIds?: string[];
}

export interface BankAccount {
  key: string;
  label: string;
  months: string[];
}

export interface BankAnalysis {
  fileName: string;
  sheetName: string;
  account: { suggested: string; known: BankAccount[] };
  months: { period: string; label: string; count: number; outTiyin: string; inTiyin: string }[];
  rows: BankRow[];
  invalid: { rowIndex: number; reason: string }[];
  invalidCount: number;
  groups: BankGroup[];
  /** Schyot-faktura: bizning korxona, holatlar, fakturalar soni, fayldagi hamma ID */
  org?: { inn: string; name: string; source: 'SAVED' | 'DETECTED' };
  statuses?: { status: string; count: number; included: boolean }[];
  invoices?: { total: number; included: number; other: number; update: number };
  allIds?: string[];
  truncated?: boolean;
}

export interface BankSeries {
  period: string;
  label: string;
  count: number;
  uploaded: { account: string; label: string; fileName: string; savedAt: string }[];
  outTiyin: string;
  inTiyin: string;
  outCumTiyin: string;
  inCumTiyin: string;
  netTiyin: string;
}

export interface BankKindTotal {
  dir: BankDir;
  kind: BankKind;
  label: string;
  count: number;
  groups: number;
  totalTiyin: string;
  sharePct: number;
  byMonth: Record<string, string>;
}

export interface BankView {
  from: string;
  to: string;
  months: string[];
  accounts: BankAccount[];
  account: string | null;
  series: BankSeries[];
  totals: { rows: number; outTiyin: string; inTiyin: string; netTiyin: string; groups: number; regularOut: number; monthsWithData: number; posted: { count: number; outTiyin: string; inTiyin: string }; patterns: { dir: BankDir; pattern: BankPattern; groups: number; count: number; totalTiyin: string }[] };
  kinds: BankKindTotal[];
  groups: BankGroup[];
}

export interface BankRowPost {
  id: string;
  batch: string;
  place: string;
  categoryLabel: string;
  section: 'DOIMIY' | 'BOSHQA';
  description: string;
  entryType: 'EXPENSE' | 'INCOME';
  createdAt: string;
  createdBy: string;
}

export interface BankGroupRow extends BankRow {
  account: string;
  accountLabel: string;
  /** Sizning izohingiz */
  note: string | null;
  noteBy: string | null;
  post: BankRowPost | null;
}

export interface BankGroupRows {
  key: string;
  rows: BankGroupRow[];
  totalTiyin: string;
}

export interface BankItem {
  account: string;
  rowId: string;
}

export interface BankRoutePlace {
  unit: string;
  departmentId?: string;
  regionCode?: number;
  districtId?: string;
}

export interface BankOptions {
  dir: BankDir;
  unit: string | null;
  limited: boolean;
  categories: { code: string; label: string; group: string | null }[];
}

export interface BankDuplicate {
  account: string;
  rowId: string;
  docDate: string;
  amountTiyin: string;
  purpose: string;
  matches: { id: string; date: string; description: string | null; categoryLabel: string; source: string }[];
}

export interface BankCheck {
  count: number;
  totalTiyin: string;
  dirs: BankDir[];
  already: string[];
  duplicates: BankDuplicate[];
}

export interface BankPostBatch {
  batch: string;
  createdAt: string;
  createdBy: string;
  dir: BankDir;
  entryType: 'EXPENSE' | 'INCOME';
  place: string;
  categoryLabel: string;
  section: 'DOIMIY' | 'BOSHQA';
  count: number;
  live: number;
  totalTiyin: string;
  liveTiyin: string;
  months: string[];
  cancelReason: string | null;
}

export interface BankBatch {
  id: string;
  account: string;
  accountLabel: string;
  fileName: string;
  createdAt: string;
  uploadedBy: string;
  months: string[];
  rows: number;
  outTiyin: string;
  inTiyin: string;
  status: 'COMMITTED' | 'CANCELLED';
  cancelledAt: string | null;
  liveMonths: string[];
  liveRows?: number;
  state: 'ACTIVE' | 'PARTIAL' | 'REPLACED' | 'CANCELLED';
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: { message?: string | string[] }; message?: string | string[] };
    const raw = parsed.error?.message ?? parsed.message;
    return Array.isArray(raw) ? (raw[0] ?? fallback) : (raw ?? fallback);
  } catch {
    return fallback;
  }
}

export type PivotLevel = 'category' | 'kind' | 'counterparty' | 'service';
export const PIVOT_LEVEL_LABEL: Record<PivotLevel, string> = { category: 'Hisobot moddasi', kind: 'Tur', counterparty: 'Kontragent (INN)', service: 'Xizmat / izoh' };

export interface PivotNode {
  id: string;
  level: PivotLevel;
  label: string;
  inn: string | null;
  comment: string | null;
  count: number;
  groups: number;
  totalTiyin: string;
  byMonth: Record<string, string>;
  groupKey: string | null;
  keys: string[];
  children: PivotNode[];
}

export interface PivotData {
  from: string;
  to: string;
  months: string[];
  dir: BankDir;
  levels: PivotLevel[];
  rows: PivotNode[];
  total: { totalTiyin: string; byMonth: Record<string, string>; groups: number; count: number };
  facets: { kinds: { code: BankKind; label: string }[]; categories: string[] };
}

export interface PivotParams {
  from: string;
  to: string;
  account?: string | null;
  dir: BankDir;
  levels: PivotLevel[];
  kinds?: string[];
  categories?: string[];
  patterns?: string[];
  q?: string;
  min?: string;
}

const pivotQuery = (p: PivotParams) => ({
  from: p.from,
  to: p.to,
  dir: p.dir,
  levels: p.levels.join(','),
  ...(p.account ? { account: p.account } : {}),
  ...(p.kinds?.length ? { kinds: p.kinds.join(',') } : {}),
  ...(p.categories?.length ? { categories: p.categories.join(',') } : {}),
  ...(p.patterns?.length ? { patterns: p.patterns.join(',') } : {}),
  ...(p.q ? { q: p.q } : {}),
  ...(p.min ? { min: p.min } : {}),
});

type CommitResult = { success: true; batchId: string; account: string; months: string[]; saved: number; replacedMonths: string[]; outTiyin: string; inTiyin: string; droppedPosts: number; invoices?: number; updatedInvoices?: number; removedRows?: number };

/** Tahlil API — bank ko'chirmasi (/bank-analysis) va schyot-fakturalar (/invoice-analysis) bir xil yo'llar bilan */
export function makeAnalysisApi(base: '/bank-analysis' | '/invoice-analysis') {
  return {
    view: (from: string, to: string, account?: string | null) => api.get<ApiResponse<BankView>>(`${base}/view`, { params: { from, to, ...(account ? { account } : {}) } }),
    group: (key: string, from: string, to: string, account?: string | null) => api.get<ApiResponse<BankGroupRows>>(`${base}/group`, { params: { key, from, to, ...(account ? { account } : {}) } }),
    batches: () => api.get<ApiResponse<BankBatch[]>>(`${base}/batches`),
    commit: (body: { fileName: string; account?: string; months?: string[]; rows: BankRow[]; allIds?: string[]; org?: { inn: string; name: string } }) => api.post<ApiResponse<CommitResult>>(`${base}/commit`, body),
    cancel: (id: string) => api.post<ApiResponse<{ success: true; months: string[]; droppedPosts: number; removedRows?: number }>>(`${base}/batches/${encodeURIComponent(id)}/cancel`),
    groupMeta: (body: { key: string; name: string; kind: BankKind | null; category?: string }) => api.post<ApiResponse<{ success: true; key: string; name: string | null; kind: BankKind | null; category: string | null }>>(`${base}/groups/meta`, body),
    groupCategory: (keys: string[], category: string) => api.post<ApiResponse<{ success: true; count: number; category: string | null }>>(`${base}/groups/category`, { keys, category }),
    categories: () => api.get<ApiResponse<string[]>>(`${base}/categories`),
    pivot: (p: PivotParams) => api.get<ApiResponse<PivotData>>(`${base}/pivot`, { params: pivotQuery(p) }),
    /** Hisobot — Excel faylini yuklab olish */
    pivotExcel: async (p: PivotParams): Promise<void> => {
      const qs = new URLSearchParams(pivotQuery(p) as Record<string, string>).toString();
      const response = await fetch(`${BASE}${base}/pivot/excel?${qs}`, { headers: authHeaders() });
      if (!response.ok) throw new Error(await readError(response, "Excel'ni yuklab bo'lmadi"));
      const name = decodeURIComponent(/filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'hisobot.xlsx');
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    options: (dir: BankDir, unit?: string) => api.get<ApiResponse<BankOptions>>(`${base}/options`, { params: { dir, ...(unit ? { unit } : {}) } }),
    notes: (items: (BankItem & { comment: string })[]) => api.post<ApiResponse<{ success: true; saved: number; cleared: number; entries: number }>>(`${base}/notes`, { items }),
    check: (items: BankItem[]) => api.post<ApiResponse<BankCheck>>(`${base}/route/check`, { items }),
    route: (body: { items: BankItem[]; place: BankRoutePlace; categoryCode: string; section: 'DOIMIY' | 'BOSHQA'; description?: string; force?: boolean; skipDuplicates?: boolean }) =>
      api.post<ApiResponse<{ success: true; batch: string | null; count: number; totalTiyin: string; skipped: number; entryType: 'EXPENSE' | 'INCOME'; place: string }>>(`${base}/route`, body),
    unroute: (body: { ids?: string[]; batch?: string }) => api.post<ApiResponse<{ success: true; count: number; totalTiyin: string }>>(`${base}/route/cancel`, body),
    posts: () => api.get<ApiResponse<BankPostBatch[]>>(`${base}/posts`),
    /** Fayl tahlili (hech narsa saqlanmaydi) */
    analyze: async (file: File): Promise<BankAnalysis> => {
      const form = new FormData();
      form.append('file', file);
      const response = await fetch(`${BASE}${base}/analyze`, { method: 'POST', headers: authHeaders(), body: form });
      if (!response.ok) throw new Error(await readError(response, "Faylni tahlil qilib bo'lmadi"));
      return ((await response.json()) as ApiResponse<BankAnalysis>).data;
    },
  };
}

export type AnalysisApi = ReturnType<typeof makeAnalysisApi>;
export const bankAnalysisApi = makeAnalysisApi('/bank-analysis');
export const invoiceAnalysisApi = makeAnalysisApi('/invoice-analysis');
