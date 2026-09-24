import { api, getToken, type ApiResponse } from '@/lib/api';

export type EmploymentKind = 'SHTAT' | 'SHARTNOMA';

export const EMPLOYMENT_LABELS: Record<EmploymentKind, string> = {
  SHTAT: 'Asosiy shtat',
  SHARTNOMA: 'Shartnoma',
};

/** Tahlildagi qator */
export interface AnalyzedRow {
  rowIndex: number;
  pinfl: string;
  fullName: string;
  regionCode: number;
  regionName: string;
  districtId: string | null;
  districtName: string | null;
  employmentType: EmploymentKind;
  planTiyin: string;
  factTiyin: string;
  percent: number | null;
  bonusTiyin: string;
  expectedBonusTiyin: string;
}

export interface RegionTotal {
  regionCode: number;
  name: string;
  count: number;
  planTiyin: string;
  factTiyin: string;
  bonusTiyin: string;
  percent: number | null;
}

export interface ChangeRow {
  pinfl: string;
  fullName: string;
  from: string;
  to: string;
}

/** Fayl tahlili — bazaga hali hech narsa yozilmagan */
export interface ResultsAnalysis {
  period: string;
  fileName: string;
  totalRows: number;
  matchedRows: number;
  planTiyin: string;
  factTiyin: string;
  bonusTiyin: string;
  percent: number | null;
  invalidRows: { rowIndex: number; reason: string }[];
  missing: { rowIndex: number; pinfl: string; fullName: string }[];
  unknownDistricts: { rowIndex: number; region: string; value: string }[];
  nameMismatches: { rowIndex: number; pinfl: string; fileName: string; registryName: string }[];
  locationChanges: ChangeRow[];
  typeChanges: ChangeRow[];
  bonusMismatches: {
    rowIndex: number;
    pinfl: string;
    fullName: string;
    percent: number | null;
    fileTiyin: string;
    expectedTiyin: string;
  }[];
  hasPrevious: boolean;
  regions: RegionTotal[];
  rows: AnalyzedRow[];
}

/** Ish haqi qayta guruhlanganda ko'chgan xodim */
export interface MovedEmployee {
  pinfl: string;
  fullName: string;
  amountTiyin: string;
  from: string;
  to: string;
}

export interface RegroupReport {
  period: string;
  batches: number;
  changedBatches: number;
  moved: MovedEmployee[];
}

export interface CommitResult {
  success: true;
  batchId: string;
  saved: number;
  movedCount: number;
  replacedPrevious: boolean;
  planTiyin: string;
  factTiyin: string;
  bonusTiyin: string;
  payroll: RegroupReport;
}

export interface ResultBatch {
  id: string;
  period: string;
  fileName: string;
  totalRows: number;
  planTiyin: string;
  factTiyin: string;
  bonusTiyin: string;
  movedCount: number;
  createdAt: string;
  cancelledAt: string | null;
  uploadedBy: { id: string; fullName: string };
}

export interface ResultListRow {
  pinfl: string;
  fullName: string;
  regionCode: number;
  regionName: string;
  districtId: string | null;
  districtName: string | null;
  employmentType: EmploymentKind;
  planTiyin: string;
  factTiyin: string;
  bonusTiyin: string;
  percent: number | null;
}

export interface ResultList {
  rows: ResultListRow[];
  regions: RegionTotal[];
  totals: { planTiyin: string; factTiyin: string; bonusTiyin: string; percent: number | null };
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

export async function downloadResultsTemplate(period: string): Promise<void> {
  const response = await fetch(`${BASE}/results/template?period=${period}`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readError(response, 'Shablonni yuklab bo\u2018lmadi'));
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `Xodim-natijalari-${period}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

/** Faylni tahlil qiladi — hali hech narsa saqlanmaydi */
export async function analyzeResultsFile(period: string, file: File): Promise<ResultsAnalysis> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE}/results/analyze?period=${period}`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await readError(response, 'Faylni tahlil qilib bo\u2018lmadi'));
  }

  const result = (await response.json()) as ApiResponse<ResultsAnalysis>;
  return result.data;
}

export const resultsApi = {
  commit: (period: string, fileName: string, rows: AnalyzedRow[]) =>
    api.post<ApiResponse<CommitResult>>(`/results/commit?period=${period}`, {
      fileName,
      rows: rows.map((row) => ({
        pinfl: row.pinfl,
        regionCode: row.regionCode,
        districtId: row.districtId,
        employmentType: row.employmentType,
        planTiyin: row.planTiyin,
        factTiyin: row.factTiyin,
        bonusTiyin: row.bonusTiyin,
      })),
    }),

  cancel: (batchId: string) =>
    api.post<ApiResponse<{ success: true; payroll: RegroupReport }>>(
      `/results/${batchId}/cancel`,
    ),

  batches: (period?: string) =>
    api.get<ApiResponse<ResultBatch[]>>('/results/batches', { params: { period } }),

  list: (period: string, regionCode?: number) =>
    api.get<ApiResponse<ResultList>>('/results', { params: { period, regionCode } }),
};
