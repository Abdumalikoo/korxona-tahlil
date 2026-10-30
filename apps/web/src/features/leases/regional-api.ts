import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Hudud ijaralari — /api/regional-rent
// ═══════════════════════════════════════════════════════════

export type RentAction = 'NEW' | 'UPDATE' | 'SAME' | 'EMPTY' | 'ERROR' | 'MISSING' | 'DB';

export interface RentRowView {
  /** «Varaq / qator» (fayldan) */
  ref: string | null;
  regionCode: number | null;
  /** Fayldagi tuman (yoki ijara nomi) */
  district: string;
  /** Ilovadagi tuman (tanilgan bo'lsa) */
  districtName: string | null;
  approx: boolean;
  leaseId: string | null;
  leaseTitle: string | null;
  /** Butun yil bo'yicha (tanlangan oyga qarab — rentAction) */
  action: RentAction;
  /** 12 oy, tiyin */
  months: string[];
  /** Bazadagi 12 oy, tiyin */
  dbMonths: string[] | null;
  /** Fayl va baza farq qilgan oylar (0–11) */
  diff: number[];
  totalOk: boolean | null;
  warnings: string[];
}

export interface RentView {
  year: number;
  periods: string[];
  /** Yopilgan oylar */
  closed: string[];
  regions: { code: number | null; name: string; rows: RentRowView[]; months: string[] }[];
  months: string[];
  summary: { rows: number; new: number; update: number; same: number; empty: number; error: number; missing: number; unmatchedDistricts: number; totalBad: number };
}

export type RentAnalysis = RentView & { fileName: string; format: 'TEMPLATE' | 'MINISTRY'; sheets: string[]; skipped: { ref: string; reason: string }[]; untilDefault: number };

export interface RentCommit {
  created: number;
  updated: number;
  same: number;
  closes: { period: string; leaseCount: number; totalTiyin: string }[];
}

/** Tanlangan oygacha holat: shu oygacha summa bormi, farq bormi */
export function rentAction(r: RentRowView, until: number): RentAction {
  if (r.action === 'ERROR' || r.action === 'MISSING' || r.action === 'DB') return r.action;
  if (!r.months.slice(0, until).some((x) => x !== '0')) return 'EMPTY';
  if (!r.leaseId) return 'NEW';
  return r.diff.some((i) => i < until) ? 'UPDATE' : 'SAME';
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};
async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: { message?: string | string[] } };
    const raw = parsed.error?.message;
    return Array.isArray(raw) ? (raw[0] ?? fallback) : (raw ?? fallback);
  } catch {
    return fallback;
  }
}
async function upload<T>(path: string, file: File, fallback: string): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, fallback));
  return ((await response.json()) as ApiResponse<T>).data;
}

export const regionalRentApi = {
  current: (year: number) => api.get<ApiResponse<RentView>>('/regional-rent', { params: { year } }),
  analyze: (file: File, year: number) => upload<RentAnalysis>(`/regional-rent/analyze?year=${year}`, file, "Faylni o'qib bo'lmadi"),
  commit: (file: File, year: number, until: number) => upload<RentCommit>(`/regional-rent/commit?year=${year}&until=${until}`, file, "Saqlab bo'lmadi"),
  template: async (year: number): Promise<void> => {
    const response = await fetch(`${BASE}/regional-rent/template?year=${year}`, { headers: authHeaders() });
    if (!response.ok) throw new Error(await readError(response, "Shablonni yuklab bo'lmadi"));
    const name = decodeURIComponent(/filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? `hudud-ijaralari-${year}-shablon.xlsx`);
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
