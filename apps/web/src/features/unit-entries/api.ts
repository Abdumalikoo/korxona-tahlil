import { api, ApiError, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Yo'nalish xarajatlari — qo'lda kiritish jadvali: /api/unit-entries/:unit/:kind/…
// ═══════════════════════════════════════════════════════════

/** ASSET — asosiy vositalar, AD — reklama, OTHER — boshqa xarajatlar */
export type EntryKindCode = 'ASSET' | 'AD' | 'OTHER';

export interface EntryRow {
  id: string;
  date: string;
  name: string;
  branch: string | null;
  counterparty: string | null;
  docNo: string | null;
  qty: number | null;
  priceTiyin: string | null;
  amountTiyin: string;
  note: string | null;
  expenseId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntryBranch {
  code: string;
  no: number;
  name: string;
}

export interface EntryList {
  unit: string;
  unitLabel: string;
  kind: EntryKindCode;
  label: string;
  qty: boolean;
  category: string;
  branches: EntryBranch[];
  from: string;
  to: string;
  rows: EntryRow[];
  deletedElsewhere: number;
  byMonth: { period: string; label: string; count: number; totalTiyin: string }[];
  totalTiyin: string;
}

export interface EntryInput {
  id?: string;
  date: string;
  name: string;
  branch: string | null;
  counterparty: string | null;
  docNo: string | null;
  qty: number | null;
  priceTiyin: string | null;
  amountTiyin: string | null;
  note: string | null;
}

export interface ParsedEntry extends Omit<EntryInput, 'id'> {
  rowIndex: number;
  errors: string[];
}

/** Saqlashda xato: qaysi qatorda nima */
export class EntrySaveError extends Error {
  constructor(
    message: string,
    readonly rows: { index: number; errors: string[] }[],
  ) {
    super(message);
  }
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const enc = encodeURIComponent;
const path = (unit: string, kind: EntryKindCode) => `/unit-entries/${enc(unit)}/${enc(kind)}`;

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type ErrorBody = { error?: { message?: string | string[]; details?: { rows?: { index: number; errors: string[] }[] } } };

async function readError(response: Response, fallback: string): Promise<{ message: string; rows: { index: number; errors: string[] }[] }> {
  try {
    const parsed = (await response.json()) as ErrorBody;
    const raw = parsed.error?.message;
    return { message: Array.isArray(raw) ? (raw[0] ?? fallback) : (raw ?? fallback), rows: parsed.error?.details?.rows ?? [] };
  } catch {
    return { message: fallback, rows: [] };
  }
}

export const unitEntriesApi = {
  list: (unit: string, kind: EntryKindCode, from: string, to: string) => api.get<ApiResponse<EntryList>>(path(unit, kind), { params: { from, to } }),
  remove: (unit: string, kind: EntryKindCode, ids: string[]) => api.post<ApiResponse<{ count: number }>>(`${path(unit, kind)}/delete`, { ids }),
};

/** Saqlash — xato bo'lsa, qator-qator tafsiloti bilan (EntrySaveError) */
export async function saveEntries(unit: string, kind: EntryKindCode, rows: EntryInput[]): Promise<{ created: number; updated: number; rows: EntryRow[] }> {
  const response = await fetch(`${BASE}${path(unit, kind)}/save`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ rows }) });
  if (!response.ok) {
    const e = await readError(response, "Saqlab bo'lmadi");
    if (e.rows.length) throw new EntrySaveError(e.message, e.rows);
    throw new ApiError(e.message, response.status);
  }
  return ((await response.json()) as ApiResponse<{ created: number; updated: number; rows: EntryRow[] }>).data;
}

async function download(url: string, fallbackName: string, fallbackError: string) {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) throw new Error((await readError(response, fallbackError)).message);
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
  const href = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(href);
}

export const downloadEntriesTemplate = (unit: string, kind: EntryKindCode) => download(`${BASE}${path(unit, kind)}/template`, `${unit}-${kind}-shablon.xlsx`, "Shablonni yuklab bo'lmadi");

export const exportEntries = (unit: string, kind: EntryKindCode, from: string, to: string) =>
  download(`${BASE}${path(unit, kind)}/export?from=${enc(from)}&to=${enc(to)}`, `${unit}-${kind}-${from}_${to}.xlsx`, "Yuklab olib bo'lmadi");

/** Faylni o'qiydi — qatorlar qoralama (saqlanmaydi) */
export async function parseEntriesFile(unit: string, kind: EntryKindCode, file: File): Promise<{ fileName: string; rows: ParsedEntry[] }> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}${path(unit, kind)}/parse`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error((await readError(response, "Faylni o'qib bo'lmadi")).message);
  return ((await response.json()) as ApiResponse<{ fileName: string; rows: ParsedEntry[] }>).data;
}