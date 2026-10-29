import { api, getToken, type ApiResponse } from '@/lib/api';

export interface RegionalRow {
  regionCode: number;
  regionName: string;
  /** Tuman kaliti "3-1"; null — faqat viloyat bo'yicha */
  districtId: string | null;
  districtName: string | null;
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
  /** Nechta tumandan tushum bor */
  districtCount: number;
  /** Tumanga bo'linmagan qismi */
  unassignedTiyin: string;
}

export interface RegionalAnalyzeResult {
  period: string;
  fileName: string;
  fileHash: string;
  totalRows: number;
  totalTiyin: string;
  /** Tuman kesimidagi yozuvlar soni */
  districtRows: number;
  unknownSheets: string[];
  unknownServices: { sheet: string; rowIndex: number; label: string }[];
  /** Tanilmagan viloyat/tuman (ro'yxat ko'rinishidagi faylda) */
  unknownPlaces: { sheet: string; rowIndex: number; value: string }[];
  /** G'alati qiymatlar: bir dona narxi odatdagidan 20 marta farq yoki juda kichik summa — saqlashdan oldin ko'rib chiqish */
  anomalies: { regionName: string; districtName: string | null; categoryLabel: string; quantity: number | null; amountTiyin: string; unitTiyin: string | null; usualUnitTiyin: string | null; reason: string }[];
  hasPrevious: boolean;
  previousCount: number;
  regions: RegionalGroup[];
  rows: RegionalRow[];
}

export interface RegionalCommitResult {
  success: true;
  created: number;
  totalTiyin: string;
  districtRows: number;
  replacedPrevious: boolean;
}

export interface DistrictSummaryRow {
  /** null — tumanga bo'linmagan */
  districtId: string | null;
  name: string;
  amountTiyin: string;
  quantity: number;
  count: number;
  sharePercent: number;
}

export interface RegionSummaryRow {
  regionCode: number | null;
  name: string;
  amountTiyin: string;
  quantity: number;
  count: number;
  sharePercent: number;
}

/** Xizmat turi × viloyat: kataklar — viloyat kodi → summa (tiyin) */
export interface ServiceRegionMatrix {
  regions: { regionCode: number; name: string }[];
  rows: { categoryCode: string; label: string; totalTiyin: string; quantity: number; cells: Record<string, string> }[];
  regionTotals: Record<string, string>;
  totalTiyin: string;
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

/** Bo'sh shablonni yuklab oladi — har bir viloyat alohida varaqda, ustunlarda tumanlar */
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
    : `Hududiy-daromadlar-xizmatlar-${period}.xlsx`;

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

  summaryByDistrict: (period: string, regionCode: number) =>
    api.get<ApiResponse<{ rows: DistrictSummaryRow[]; totalTiyin: string }>>(
      '/incomes/regional/summary/district',
      { params: { period, regionCode } },
    ),

  /** Xizmat turi × viloyat */
  summaryMatrix: (period: string) =>
    api.get<ApiResponse<ServiceRegionMatrix>>('/incomes/regional/summary/matrix', { params: { period } }),

  /** districtId: tuman kaliti yoki "-" (tumanga bo'linmagan) */
  summaryByService: (period: string, regionCode?: number, districtId?: string) =>
    api.get<ApiResponse<{ rows: ServiceSummaryRow[]; totalTiyin: string }>>(
      '/incomes/regional/summary/service',
      { params: { period, regionCode, districtId } },
    ),
};