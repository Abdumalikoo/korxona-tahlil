import { api, getToken, type ApiResponse } from '@/lib/api';

// Asosiy vositalar — /api/fixed-assets

export type AssetStatus = 'active' | 'done' | 'disposed' | 'expense' | 'hold';

/** BALANCE — balansda, eskirish bilan; HOLD — faqat balansda (xarajatsiz); EXPENSE — xarajatga o'tkazilgan */
export type AssetMode = 'BALANCE' | 'HOLD' | 'EXPENSE';

export const MODE_INFO: Record<AssetMode, { label: string; short: string; hint: string }> = {
  HOLD: { label: 'Balansda (xarajatsiz)', short: 'Balansda', hint: "Xarajatga hech narsa o'tmaydi — vosita balansda, kimda va qayerdaligi hisobotda turadi" },
  EXPENSE: { label: "Xarajatga o'tkazish (Markaz)", short: 'Xarajatga', hint: "Qiymati berilgan oyda to'liq xarajat bo'ladi — Markaz hisobidan, «Asosiy vositalar» guruhida" },
  BALANCE: { label: 'Balansda, eskirish bilan', short: 'Eskirish', hint: 'Balansda turadi, har oy qiymat ÷ xizmat muddati sarf sifatida Markaz xarajatiga yoziladi' },
};

export interface FixedAssetView {
  id: string;
  name: string;
  inventoryNo: string | null;
  categoryCode: string;
  categoryLabel: string;
  source: 'WAREHOUSE' | 'EXPENSE' | 'MANUAL' | string;
  sourceLabel: string;
  mode: AssetMode | string;
  modeLabel: string;
  holderName: string | null;
  placeText: string | null;
  quantity: number;
  importBatch: string | null;
  place: string;
  regionCode: number | null;
  departmentId: string | null;
  costTiyin: string;
  acquiredAt: string;
  lifeMonths: number;
  lifeOverridden: boolean;
  monthlyTiyin: string;
  accumulatedTiyin: string;
  residualTiyin: string;
  endPeriod: string;
  status: AssetStatus;
  disposedAt: string | null;
  disposeReason: string | null;
  note: string | null;
  expenseId: string | null;
  assetId: string | null;
}

export interface AssetsSummary {
  range: { from: string; to: string };
  count: number;
  costTiyin: string;
  accumulatedTiyin: string;
  residualTiyin: string;
  chargeTiyin: string;
  acquiredTiyin: string;
  acquiredCount: number;
  disposedTiyin: string;
  months: string[];
  chargeTrend: string[];
  byCategory: { code: string; label: string; count: number; costTiyin: string; residualTiyin: string; chargeTiyin: string }[];
  expensedCount: number;
  expensedTiyin: string;
  holdCount: number;
  holdTiyin: string;
  lastSyncAt: string | null;
}

export interface AssetBatch {
  batch: string;
  count: number;
  costTiyin: string;
  modes: Record<string, number>;
}

export interface ImportRowView {
  row: number;
  date: string | null;
  name: string;
  inventoryNo: string | null;
  quantity: number;
  priceTiyin: string;
  costTiyin: string;
  placeText: string;
  holderName: string | null;
  condition: string | null;
  warnings: string[];
  errors: string[];
  exists: boolean;
  duplicate: boolean;
}

export interface AssetImportAnalysis {
  fileName: string;
  total: number;
  ok: number;
  errors: number;
  exists: number;
  duplicates: number;
  zeroPrice: number;
  totalTiyin: string;
  byMonth: { period: string; count: number; totalTiyin: string }[];
  places: { placeText: string; count: number; totalTiyin: string; target: string; targetLabel: string; reason: string }[];
  targets: { value: string; label: string; group: string }[];
  rows: ImportRowView[];
}

export interface ReportItem {
  id: string;
  date: string;
  name: string;
  inventoryNo: string | null;
  quantity: number;
  costTiyin: string;
  residualTiyin: string;
  holderName: string | null;
  placeText: string | null;
  mode: AssetMode;
  modeLabel: string;
  source: string;
}

export interface ReportGroup {
  key: string;
  label: string;
  kind: 'region' | 'center';
  count: number;
  quantity: number;
  costTiyin: string;
  residualTiyin: string;
  holders: { name: string; count: number; costTiyin: string }[];
  items: ReportItem[];
}

export interface BalanceReport {
  at: string;
  balance: { count: number; quantity: number; costTiyin: string; residualTiyin: string; holdCount: number; holdTiyin: string; groups: ReportGroup[] };
  expensed: { count: number; costTiyin: string; groups: ReportGroup[] };
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: { message?: string | string[] } };
    const raw = parsed.error?.message;
    return Array.isArray(raw) ? (raw[0] ?? fallback) : (raw ?? fallback);
  } catch {
    return fallback;
  }
}

/** Excel'ni tekshirish — hali hech narsa saqlanmaydi */
export async function analyzeAssetImport(file: File): Promise<AssetImportAnalysis> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}/fixed-assets/import/analyze`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, 'Faylni tekshirib bo‘lmadi'));
  return ((await response.json()) as ApiResponse<AssetImportAnalysis>).data;
}

/** Balans hisoboti — Excel */
export async function downloadBalanceReport(at: string, batch?: string): Promise<void> {
  const qs = new URLSearchParams({ at, ...(batch ? { batch } : {}) });
  const response = await fetch(`${BASE}/fixed-assets/report/excel?${qs.toString()}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await readError(response, 'Hisobotni yuklab bo‘lmadi'));
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : `asosiy-vositalar-balans-${at}.xlsx`;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export interface AssetPolicyView {
  capitalCategories: string[];
  life: Record<string, number>;
  defaultLife: number;
  categories: { code: string; label: string; parentCode: string | null; isLeaf: boolean; selected: boolean; inherited: boolean; lifeMonths: number }[];
}

export interface ScheduleRow {
  period: string;
  amountTiyin: string;
  accumulatedTiyin: string;
  residualTiyin: string;
  done: boolean;
}

export interface SyncReport {
  captured: number;
  capturedTiyin: string;
  updated: number;
  periods: number;
  chargeRows: number;
}

export interface CreateAssetPayload {
  name: string;
  costTiyin: string;
  acquiredAt: string;
  categoryCode: string;
  lifeMonths?: number | null;
  regionCode?: number | null;
  departmentId?: string | null;
  inventoryNo?: string;
  note?: string;
}

/** Omborga ulash (Excel'dan yuklanganlar → ombor ro'yxati, xodim nomida) */
export interface AdoptPreview {
  total: number;
  pieces: number;
  matched: number;
  unmatched: { name: string; count: number; reason: string }[];
  holders: { name: string; employee: string | null; pinfl: string | null; count: number }[];
  renumbered: number;
  alreadyLinked: number;
}

export const assetsApi = {
  adoptPreview: (batch?: string) => api.get<ApiResponse<AdoptPreview>>('/fixed-assets/adopt', { params: { batch } }),
  adopt: (batch?: string) => api.post<ApiResponse<AdoptPreview & { created: number; items: number }>>('/fixed-assets/adopt', { batch }),

  list: (params: { status?: string; search?: string; batch?: string } = {}) => api.get<ApiResponse<FixedAssetView[]>>('/fixed-assets', { params }),
  batches: () => api.get<ApiResponse<AssetBatch[]>>('/fixed-assets/batches'),
  report: (at: string, batch?: string) => api.get<ApiResponse<BalanceReport>>('/fixed-assets/report', { params: { at, batch } }),
  importCommit: (body: { fileName: string; batch?: string; mode: AssetMode; mapping: Record<string, string>; rows: ImportRowView[] }) =>
    api.post<ApiResponse<{ created: number; skipped: number; batch: string; mode: AssetMode; totalTiyin: string }>>('/fixed-assets/import/commit', body),
  modeMany: (body: { ids?: string[]; batch?: string; mode: AssetMode }) =>
    api.post<ApiResponse<{ changed: number; skipped: { id: string; name: string; reason: string }[] }>>('/fixed-assets/mode', body),
  summary: (from: string, to: string) => api.get<ApiResponse<AssetsSummary>>('/fixed-assets/summary', { params: { from, to } }),
  detail: (id: string) => api.get<ApiResponse<{ asset: FixedAssetView; schedule: ScheduleRow[] }>>(`/fixed-assets/${id}`),
  policy: () => api.get<ApiResponse<AssetPolicyView>>('/fixed-assets/policy'),
  savePolicy: (body: { capitalCategories?: string[]; life?: Record<string, number>; defaultLife?: number }) =>
    api.patch<ApiResponse<{ policy: AssetPolicyView; report: SyncReport }>>('/fixed-assets/policy', body),
  sync: () => api.post<ApiResponse<SyncReport>>('/fixed-assets/sync', {}),
  create: (body: CreateAssetPayload) => api.post<ApiResponse<FixedAssetView>>('/fixed-assets', body),
  update: (id: string, body: { lifeMonths?: number | null; name?: string; note?: string; costTiyin?: string; acquiredAt?: string }) => api.patch<ApiResponse<FixedAssetView>>(`/fixed-assets/${id}`, body),
  dispose: (id: string, body: { date?: string; reason?: string; undo?: boolean }) => api.post<ApiResponse<FixedAssetView>>(`/fixed-assets/${id}/dispose`, body),
  mode: (id: string, mode: AssetMode) => api.post<ApiResponse<FixedAssetView>>(`/fixed-assets/${id}/mode`, { mode }),
  remove: (id: string) => api.delete<ApiResponse<{ success: true }>>(`/fixed-assets/${id}`),
};
// ─────────── Xarid shabloni — /api/asset-xarid (1-bosqich: reestr, raqamlarga ta'sir qilmaydi) ───────────

export type XaridKind = 'ASSET' | 'LOW_VALUE' | 'SUPPLY' | 'PRINT_GIFT' | 'SERVICE';
export type XaridStatus = 'DONE' | 'IN_PROGRESS' | 'PLANNED' | 'REJECTED';

export interface XaridRow {
  key: string;
  /** Excel qator raqami */
  row: number;
  name: string;
  /** Birlik kodi (CENTER, FERMER, MARKSHEYDER …) */
  unit: string;
  structure: string | null;
  reqDept: string | null;
  reqNo: string | null;
  reqDate: string | null;
  purpose: string | null;
  type: string | null;
  measure: string | null;
  qty: number | null;
  unitPriceTiyin: string | null;
  /** Haqiqiy qiymat — faqat «Шартнома / жами сумма» (AB) ustuni; shartnoma yo'q — null */
  totalTiyin: string | null;
  /** Bozor taxminiy qiymati (shartnoma yo'q bo'lsa) — ma'lumot uchun, jamiga qo'shilmaydi */
  estimateTiyin: string | null;
  method: string | null;
  platform: string | null;
  platformUrl: string | null;
  supplier: string | null;
  contractNo: string | null;
  contractDate: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  status: XaridStatus;
  kind: XaridKind;
  autoKind: XaridKind;
  reason: string;
  overridden: boolean;
  warnings: string[];
}

export interface XaridGroup {
  key: string;
  count: number;
  totalTiyin: string;
}

export interface XaridView {
  loaded: boolean;
  fileName?: string;
  savedAt?: string;
  savedBy?: string;
  sheet?: string;
  headerRow?: number;
  missing?: string[];
  rule: { assetMinTiyin: string; overrides: number };
  kinds: { key: XaridKind; label: string }[];
  statuses: { key: XaridStatus; label: string; count: number }[];
  summary: {
    rows: number;
    done: number;
    doneTotalTiyin: string;
    warnings: number;
    byKind: { key: XaridKind; label: string; count: number; totalTiyin: string; all: number }[];
    byUnit: XaridGroup[];
    byPlatform: XaridGroup[];
    byMonth: XaridGroup[];
  };
  rows: XaridRow[];
}

export type XaridAnalysis = XaridView & { fileName: string; sheet: string; headerRow: number; missing: string[]; skipped: { row: number; reason: string }[] };

async function uploadXarid<T>(path: string, file: File, fallback: string): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, fallback));
  return ((await response.json()) as ApiResponse<T>).data;
}

export const xaridApi = {
  view: () => api.get<ApiResponse<XaridView>>('/asset-xarid'),
  /** Faylni o'qish — hech narsa saqlanmaydi */
  analyze: (file: File) => uploadXarid<XaridAnalysis>('/asset-xarid/analyze', file, "Faylni o'qib bo'lmadi"),
  /** Saqlash — fayl serverda qayta o'qiladi */
  commit: (file: File) => uploadXarid<{ success: true; rows: number }>('/asset-xarid/commit', file, "Saqlab bo'lmadi"),
  rule: (assetMinSom: string) => api.put<ApiResponse<{ assetMinSom: number }>>('/asset-xarid/rule', { assetMinSom }),
  override: (key: string, kind: XaridKind | null) => api.put<ApiResponse<{ key: string; kind: XaridKind | null }>>('/asset-xarid/override', { key, kind }),
  remove: () => api.delete<ApiResponse<{ removed: true }>>('/asset-xarid'),
  /** Bo'sh shablon (Excel) */
  template: async (): Promise<void> => {
    const response = await fetch(`${BASE}/asset-xarid/template`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await readError(response, "Shablonni yuklab bo'lmadi"));
    const name = decodeURIComponent(/filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'asosiy-vositalar-xarid-shablon.xlsx');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};
