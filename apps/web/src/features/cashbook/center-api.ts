import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Markaz daromadlari — kunlik ma'lumotnomadan oylik daromad (/api/cashbook/center-income).
// Pul — tiyin (matn).
// ═══════════════════════════════════════════════════════════

export type CenterMode = 'DOIMIY' | 'BOSHQA' | 'REGION' | 'NONE';

export const MODE_LABEL: Record<CenterMode, string> = {
  DOIMIY: 'Markaz daromadi',
  BOSHQA: 'Boshqa daromad',
  REGION: 'Hududlar (hisobot uchun)',
  NONE: 'Daromad emas',
};

/** Qator egasi: Markaz yoki yo'nalish (Tax free, Marksheyder …) — yo'nalish daromadi o'z xarajatlari bilan birga ko'rinadi */
export type CenterOwner = 'CENTER' | 'TAX_FREE' | 'MARKSHEYDER' | 'FERMER' | 'BUXGALTERIYA' | 'QOMITA';

export const OWNER_LABEL: Record<CenterOwner, string> = {
  CENTER: 'Markaz',
  TAX_FREE: 'Tax free',
  MARKSHEYDER: 'Marksheyder',
  FERMER: "Fermer xo'jaligi",
  BUXGALTERIYA: 'Buxgalteriya xizmatlari',
  QOMITA: "Qo'mita",
};

export interface CenterMonth {
  period: string;
  label: string;
  reportDate: string | null;
  reports: number;
  doimiyTiyin: string;
  boshqaTiyin: string;
  markazTiyin: string;
  regionsTiyin: string;
  syncedTiyin: string;
  inSync: boolean;
  otherCenterTiyin: string;
  regionIncomeTiyin: string;
  /** Shundan yo'nalishlarga yozilgan */
  segmentsTiyin: string;
}

export interface CenterRow {
  id: string;
  key: string;
  code: string | null;
  name: string;
  level: number;
  isHeader: boolean;
  mode: CenterMode | null;
  defaultMode: CenterMode | null;
  owner: CenterOwner | null;
  defaultOwner: CenterOwner | null;
  /** Egasi Markaz bo'lsa — Markaz bo'limi (null — bo'limsiz, «Markaz › Umumiy») */
  departmentId: string | null;
  months: Record<string, string | null>;
  totalTiyin: string;
}

export interface CenterYear {
  year: number;
  latestDate: string | null;
  months: CenterMonth[];
  rows: CenterRow[];
  totals: { doimiyTiyin: string; boshqaTiyin: string; markazTiyin: string; regionsTiyin: string; syncedTiyin: string };
}

export interface CenterPreview {
  date: string;
  period: string;
  label: string;
  exists: boolean;
  matched: number;
  unmatched: string[];
  /** To'ldirilgan, lekin son sifatida o'qilmagan kataklar */
  invalid?: string[];
  gap: { prevDate: string; accounts: number } | null;
  laterInMonth: string | null;
  doimiyTiyin: string;
  boshqaTiyin: string;
  markazTiyin: string;
  regionsTiyin: string;
  lines: { id: string; code: string | null; name: string; mode: CenterMode; amountTiyin: string }[];
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

async function failMessage(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: { message?: string | string[] }; message?: string | string[] };
    const raw = parsed.error?.message ?? parsed.message;
    return Array.isArray(raw) ? (raw[0] ?? fallback) : (raw ?? fallback);
  } catch {
    return fallback;
  }
}

async function send<T>(path: string, file: File): Promise<T> {
  const token = getToken();
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  if (!response.ok) throw new Error(await failMessage(response, "Faylni o'qib bo'lmadi"));
  return ((await response.json()) as ApiResponse<T>).data;
}

const dateQ = (date?: string) => (date ? `?date=${date}` : '');

export const centerIncomeApi = {
  year: async (year: number) => (await api.get<ApiResponse<CenterYear>>(`/cashbook/center-income?year=${year}`)).data,
  preview: (file: File, date?: string) => send<CenterPreview>(`/cashbook/center-income/preview${dateQ(date)}`, file),
  upload: (file: File, date?: string) => send<CenterPreview & { year: CenterYear }>(`/cashbook/center-income/upload${dateQ(date)}`, file),
  sync: async (year: number, period?: string) =>
    (await api.post<ApiResponse<CenterYear>>(`/cashbook/center-income/sync?year=${year}${period ? `&period=${period}` : ''}`)).data,
  /** departments: qator → Markaz bo'limi (null — «Markaz › Umumiy») */
  setModes: async (year: number, modes: Record<string, CenterMode>, owners: Record<string, CenterOwner> = {}, departments: Record<string, string | null> = {}) =>
    (await api.patch<ApiResponse<CenterYear>>('/cashbook/center-income/modes', { year, modes, owners, departments })).data,
  async template(): Promise<void> {
    const token = getToken();
    const response = await fetch(`${BASE}/cashbook/center-income/template`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error(await failMessage(response, "Shablonni yuklab bo'lmadi"));
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Kunlik tushum shablon.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};