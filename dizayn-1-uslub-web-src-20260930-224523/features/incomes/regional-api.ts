import { api, getToken, type ApiResponse } from '@/lib/api';

export interface RegionalRow {
  regionCode: number;
  regionName: string;
  categoryCode: string;
  categoryLabel: string;
  quantity: number | null;
  amountTiyin: string;
}

export interface RegionalGroup {
  regionCode: number;
  name: string;
  count: number;
  quantity: number;
  totalTiyin: string;
}

export interface RegionalAnalyzeResult {
  period: string;
  fileName: string;
  fileHash: string;
  totalRows: number;
  totalTiyin: string;
  unknownSheets: string[];
  unknownServices: { sheet: string; rowIndex: number; label: string }[];
  hasPrevious: boolean;
  previousCount: number;
  regions: RegionalGroup[];
  rows: RegionalRow[];
}

export interface RegionalCommitResult {
  success: true;
  created: number;
  totalTiyin: string;
  replacedPrevious: boolean;
}

export interface RegionSummaryRow {
  regionCode: number | null;
  name: string;
  amountTiyin: string;
  quantity: number;
  count: number;
  sharePercent: number;
}

export interface ServiceSummaryRow {
  categoryCode: string;
  label: string;
  amountTiyin: string;
  quantity: number;
  averageTiyin: string | null;
  count: number;
  sharePercent: number;
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/** Bo'sh shablonni yuklab oladi — 15 varaq, har birida 39 xizmat */
export async function downloadRegionalTemplate(period: string): Promise<void> {
  const token = getToken();

  const response = await fetch(`${BASE}/incomes/regional/template?period=${period}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error('Shablonni yuklab bo\u2018lmadi');
  }

  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1]
    ? decodeURIComponent(match[1])
    : `Hududiy-daromadlar-${period}.xlsx`;

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}

/** Faylni yuklaydi va tahlil qiladi — hali saqlanmaydi */
export async function analyzeRegionalFile(
  period: string,
  file: File,
): Promise<RegionalAnalyzeResult> {
  const token = getToken();

  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE}/incomes/regional/analyze?period=${period}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  if (!response.ok) {
    let message = 'Faylni tahlil qilib bo\u2018lmadi';
    try {
      const parsed = (await response.json()) as {
        error?: { message?: string | string[] };
      };
      const raw = parsed.error?.message;
      message = Array.isArray(raw) ? (raw[0] ?? message) : (raw ?? message);
    } catch {
      // JSON emas
    }
    throw new Error(message);
  }

  const result = (await response.json()) as ApiResponse<RegionalAnalyzeResult>;
  return result.data;
}

export const regionalIncomeApi = {
  commit: (period: string, rows: RegionalRow[], replace = false) =>
    api.post<ApiResponse<RegionalCommitResult>>(
      `/incomes/regional/commit?period=${period}&replace=${replace}`,
      { rows },
    ),

  summaryByRegion: (period: string) =>
    api.get<ApiResponse<{ rows: RegionSummaryRow[]; totalTiyin: string }>>(
      '/incomes/regional/summary/region',
      { params: { period } },
    ),

  summaryByService: (period: string, regionCode?: number) =>
    api.get<ApiResponse<{ rows: ServiceSummaryRow[]; totalTiyin: string }>>(
      '/incomes/regional/summary/service',
      { params: { period, regionCode } },
    ),
};
