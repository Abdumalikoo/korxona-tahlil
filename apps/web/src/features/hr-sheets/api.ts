import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Xodimlar › Ma'lumotnomalar (10, 16, 37, 51-jadval) va «Miya» (xodim kartasi): /api/hr-sheets/…
// Faqat administrator.
// ═══════════════════════════════════════════════════════════

export type HrSheetCode = 'J10' | 'J16' | 'J37' | 'J51';

export interface HrColumnInfo {
  key: string;
  header: string;
  kind: 'text' | 'date' | 'int' | 'pinfl';
  sensitive: boolean;
  group: string;
}

export interface HrCurrent {
  fileName: string;
  uploadedAt: string;
  uploadedBy?: string;
  count: number;
}

export interface HrSheetInfo {
  code: HrSheetCode;
  no: number;
  label: string;
  hint: string;
  byName: boolean;
  multi: boolean;
  columns: HrColumnInfo[];
  current: HrCurrent | null;
  hasPrev: boolean;
}

export interface HrUnitCount {
  unit: string;
  label: string;
  count: number;
}

export interface HrOverview {
  sheets: HrSheetInfo[];
  people: { total: number; working: number; inRegistry: number; notInRegistry: number };
  units: HrUnitCount[];
}

export interface HrRows {
  code: HrSheetCode;
  columns: HrColumnInfo[];
  total: number;
  page: number;
  limit: number;
  current: HrCurrent | null;
  rows: { n: number; pinfl: string | null; unit: string | null; unitLabel: string | null; inRegistry: boolean; cells: Record<string, string | null> }[];
}

export interface HrAnalyze {
  token: string;
  code: HrSheetCode;
  label: string;
  fileName: string;
  sheetName: string;
  headerRow: number;
  total: number;
  blankRows: number;
  columns: { key: string; header: string; found: boolean }[];
  invalid: { row: number; reason: string }[];
  invalidCount: number;
  duplicates: { row: number; firstRow: number; name: string }[];
  duplicateCount: number;
  diff: { added: number; removed: number; changed: number; same: number } | null;
  current: HrCurrent | null;
  people: { identified: number; inRegistry: number; notInRegistry: number; alsoInOtherSheets: number; unmatchedNames: number; ambiguousNames: number };
  units: HrUnitCount[];
  preview: Record<string, string | null>[];
}

export interface HrSearchHit {
  pinfl: string;
  fullName: string;
  position: string | null;
  place: string | null;
  unit: string | null;
  unitLabel: string | null;
  sources: string[];
  inRegistry: boolean;
}

export interface HrPersonCard {
  pinfl: string;
  fullName: string;
  position: string | null;
  place: string | null;
  status: string | null;
  working: boolean;
  hrUnit: string | null;
  hrUnitLabel: string | null;
  sources: string[];
  registry: {
    fullName: string;
    position: string | null;
    employmentType: string;
    region: string | null;
    district: string | null;
    department: string | null;
    hiredAt: string | null;
    firedAt: string | null;
    isActive: boolean;
  } | null;
  miya: {
    period: string;
    unit: string | null;
    unitLabel: string | null;
    staffIn: { unit: string; label: string; source: string }[];
    moves: { id: string; unit: string; unitLabel: string; fromUnitLabel: string | null; from: string; note: string | null; source: string }[];
  };
  sheets: {
    code: HrSheetCode;
    no: number;
    label: string;
    fileName: string;
    uploadedAt: string;
    records: { groups: { group: string; label: string; fields: { label: string; value: string }[] }[] }[];
  }[];
  payroll: {
    months: { period: string; totalTiyin: string }[];
    units: { unit: string; label: string; period: string; amountTiyin: string }[];
  };
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

async function download(path: string, fallbackName: string, error: string): Promise<void> {
  const response = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await readError(response, error));
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const hrSheetsApi = {
  overview: () => api.get<ApiResponse<HrOverview>>('/hr-sheets'),
  rows: (code: HrSheetCode, params: { q?: string; unit?: string; page?: number; limit?: number }) => api.get<ApiResponse<HrRows>>(`/hr-sheets/${code}/rows`, { params }),
  commit: (code: HrSheetCode, token: string) => api.post<ApiResponse<{ success: true; count: number; fileName: string }>>(`/hr-sheets/${code}/commit`, { token }),
  restore: (code: HrSheetCode) => api.post<ApiResponse<{ success: true; count: number; fileName: string | null }>>(`/hr-sheets/${code}/restore`),
  clear: (code: HrSheetCode) => api.delete<ApiResponse<{ success: true }>>(`/hr-sheets/${code}`),
  search: (q: string) => api.get<ApiResponse<HrSearchHit[]>>('/hr-sheets/search', { params: { q } }),
  person: (pinfl: string) => api.get<ApiResponse<HrPersonCard>>(`/hr-sheets/person/${enc(pinfl)}`),
};

export const downloadHrTemplate = (code: HrSheetCode, no: number) => download(`/hr-sheets/${code}/template`, `${no}-jadval-shablon.xlsx`, "Shablonni yuklab bo'lmadi");
export const exportHrSheet = (code: HrSheetCode, no: number) => download(`/hr-sheets/${code}/export`, `${no}-jadval.xlsx`, "Faylni yuklab bo'lmadi");

export async function analyzeHrFile(code: HrSheetCode, file: File): Promise<HrAnalyze> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}/hr-sheets/${code}/analyze`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, "Faylni tahlil qilib bo'lmadi"));
  return ((await response.json()) as ApiResponse<HrAnalyze>).data;
}