import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Bank ko'chirmasi — tahlil: /api/bank-analysis/…
// Xarajat va daromadga yozilmaydi: o'xshash to'lovlar oyma-oy va o'sib boruvchi guruhlanadi.
// ═══════════════════════════════════════════════════════════

export type BankDir = 'OUT' | 'IN';
export type BankKind = 'SOLIQ' | 'ISH_HAQI' | 'BANK' | 'KOMMUNAL' | 'ALOQA' | 'IJARA' | 'YOQILGI' | 'XARID' | 'XIZMAT' | 'KREDIT' | 'DEPOZIT' | 'QAYTARISH' | 'ICHKI' | 'TUSHUM' | 'BOSHQA';

export interface BankRow {
  id: string;
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
  totals: { rows: number; outTiyin: string; inTiyin: string; netTiyin: string; groups: number; regularOut: number; monthsWithData: number; posted: { count: number; outTiyin: string; inTiyin: string } };
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

export const bankAnalysisApi = {
  view: (from: string, to: string, account?: string | null) => api.get<ApiResponse<BankView>>('/bank-analysis/view', { params: { from, to, ...(account ? { account } : {}) } }),
  group: (key: string, from: string, to: string, account?: string | null) => api.get<ApiResponse<BankGroupRows>>('/bank-analysis/group', { params: { key, from, to, ...(account ? { account } : {}) } }),
  batches: () => api.get<ApiResponse<BankBatch[]>>('/bank-analysis/batches'),
  commit: (body: { fileName: string; account: string; months: string[]; rows: BankRow[] }) =>
    api.post<ApiResponse<{ success: true; batchId: string; account: string; months: string[]; saved: number; replacedMonths: string[]; outTiyin: string; inTiyin: string; droppedPosts: number }>>('/bank-analysis/commit', body),
  cancel: (id: string) => api.post<ApiResponse<{ success: true; months: string[]; droppedPosts: number }>>(`/bank-analysis/batches/${encodeURIComponent(id)}/cancel`),
  options: (dir: BankDir, unit?: string) => api.get<ApiResponse<BankOptions>>('/bank-analysis/options', { params: { dir, ...(unit ? { unit } : {}) } }),
  notes: (items: (BankItem & { comment: string })[]) => api.post<ApiResponse<{ success: true; saved: number; cleared: number; entries: number }>>('/bank-analysis/notes', { items }),
  check: (items: BankItem[]) => api.post<ApiResponse<BankCheck>>('/bank-analysis/route/check', { items }),
  route: (body: { items: BankItem[]; place: BankRoutePlace; categoryCode: string; section: 'DOIMIY' | 'BOSHQA'; description?: string; force?: boolean; skipDuplicates?: boolean }) =>
    api.post<ApiResponse<{ success: true; batch: string | null; count: number; totalTiyin: string; skipped: number; entryType: 'EXPENSE' | 'INCOME'; place: string }>>('/bank-analysis/route', body),
  unroute: (body: { ids?: string[]; batch?: string }) => api.post<ApiResponse<{ success: true; count: number; totalTiyin: string }>>('/bank-analysis/route/cancel', body),
  posts: () => api.get<ApiResponse<BankPostBatch[]>>('/bank-analysis/posts'),
};

export async function analyzeBankStatement(file: File): Promise<BankAnalysis> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}/bank-analysis/analyze`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, "Faylni tahlil qilib bo'lmadi"));
  return ((await response.json()) as ApiResponse<BankAnalysis>).data;
}
