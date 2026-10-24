import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Yo'nalish doimiy to'lovlari (filiallar/joylar kesimida): /api/unit-lease/:unit/…
//   Tax free — Ijara va kommunal; Fermer xo'jaligi — Ijara va internet (joylar sahifada tahrirlanadi).
// ═══════════════════════════════════════════════════════════

/** Katak: turning maydoni (ijaraTiyin, kommunalTiyin, internetTiyin …) → tiyin */
export type LeaseCell = Record<string, string>;

/** To'lov turi (shablon ustuni) */
export interface LeaseKindInfo {
  key: string;
  label: string;
  /** Katakdagi maydon nomi */
  field: string;
}

export interface LeaseMeta {
  title: string;
  branchLabel: string;
  kinds: LeaseKindInfo[];
}

export interface LeaseBranches extends LeaseMeta {
  unit: string;
  label: string;
  editable: boolean;
  branches: LeaseBranch[];
}

export interface LeaseBranch {
  code: string;
  no: number;
  name: string;
}

export interface LeaseAnalyzeMonth {
  period: string;
  label: string;
  totalTiyin: string;
  empty: boolean;
  saved: { fileName: string; savedAt: string; totalTiyin: string } | null;
}

export interface LeaseAnalyzeResult extends LeaseMeta {
  unit: string;
  label: string;
  fileName: string;
  sheetName: string;
  months: LeaseAnalyzeMonth[];
  branches: (LeaseBranch & { inFile: boolean; cells: Record<string, LeaseCell> })[];
  missingBranches: { no: number; name: string }[];
  invalid: { row: number; column: string; reason: string }[];
  unknownRows: { row: number; text: string }[];
  totalTiyin: string;
}

export interface LeaseData extends LeaseMeta {
  unit: string;
  label: string;
  editable: boolean;
  months: { period: string; label: string; saved: { fileName: string; savedAt: string; uploadedBy: string } | null }[];
  branches: (LeaseBranch & { cells: Record<string, LeaseCell | null> })[];
}

export interface LeaseBatch {
  id: string;
  fileName: string;
  createdAt: string;
  uploadedBy: string;
  months: string[];
  monthLabels: string[];
  liveMonths: string[];
  totalTiyin: string;
  status: 'COMMITTED' | 'CANCELLED';
  /** ACTIVE — hamma oylari amalda; PARTIAL — ba'zi oylari keyin almashtirilgan; REPLACED — hammasi almashtirilgan */
  state: 'ACTIVE' | 'PARTIAL' | 'REPLACED' | 'CANCELLED';
}

export interface LeaseCommitResult {
  success: true;
  batchId: string;
  months: string[];
  expensesCreated: number;
  replacedMonths: number;
  totalTiyin: string;
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const enc = encodeURIComponent;

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

export const unitLeaseApi = {
  data: (unit: string, from: string, to: string) => api.get<ApiResponse<LeaseData>>(`/unit-lease/${enc(unit)}/data`, { params: { from, to } }),
  batches: (unit: string) => api.get<ApiResponse<LeaseBatch[]>>(`/unit-lease/${enc(unit)}/batches`),
  branches: (unit: string) => api.get<ApiResponse<LeaseBranches>>(`/unit-lease/${enc(unit)}/branches`),
  saveBranches: (unit: string, branches: { code?: string; name: string }[]) =>
    api.post<ApiResponse<{ branches: LeaseBranch[] }>>(`/unit-lease/${enc(unit)}/branches`, { branches }),
  commit: (unit: string, body: { fileName: string; months: string[]; rows: ({ branch: string; period: string } & LeaseCell)[] }) =>
    api.post<ApiResponse<LeaseCommitResult>>(`/unit-lease/${enc(unit)}/commit`, body),
  cancel: (unit: string, id: string) => api.post<ApiResponse<{ success: true; clearedMonths: string[] }>>(`/unit-lease/${enc(unit)}/batches/${enc(id)}/cancel`),
};

/** Shablon: tanlangan oylar oralig'i (from–to), qatorlar — filiallar */
export async function downloadLeaseTemplate(unit: string, from: string, to: string): Promise<void> {
  const response = await fetch(`${BASE}/unit-lease/${enc(unit)}/template?from=${enc(from)}&to=${enc(to)}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await readError(response, "Shablonni yuklab bo'lmadi"));
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : `Ijara-${unit}-${from}_${to}.xlsx`;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Faylni tahlil qiladi — undagi hamma oylar o'qiladi, hali saqlanmaydi */
export async function analyzeLeaseFile(unit: string, file: File): Promise<LeaseAnalyzeResult> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}/unit-lease/${enc(unit)}/analyze`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, "Faylni tahlil qilib bo'lmadi"));
  return ((await response.json()) as ApiResponse<LeaseAnalyzeResult>).data;
}