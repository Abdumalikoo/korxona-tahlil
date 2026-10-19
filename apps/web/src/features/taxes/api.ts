import { api, getToken, type ApiResponse } from '@/lib/api';

// Xarajatlar › Soliqlar — /api/taxes

export type TaxMethod = 'MANUAL' | 'PAYROLL_PERCENT';

export interface TaxType {
  code: string;
  name: string;
  method: TaxMethod;
  rate: number | null;
  /** Qaysi hududda yozilsa ham Markaz xarajati */
  center: boolean;
  active: boolean;
  order: number;
}

export interface TaxUnit {
  key: string;
  regionCode: number;
  departmentId: string | null;
  name: string;
}

export interface TaxCell {
  amountTiyin: string;
  baseTiyin?: string;
}

export interface TaxMonth {
  period: string;
  types: (TaxType & { categoryCode: string; totalTiyin: string; previousTiyin: string })[];
  units: TaxUnit[];
  cells: Record<string, Record<string, TaxCell>>;
  totals: { totalTiyin: string; previousTiyin: string; autoTiyin: string; manualTiyin: string; centerTiyin: string; payrollTiyin: string };
  months: string[];
  trend: Record<string, string[]>;
  hasPayroll: boolean;
}

export interface CellInput {
  type: string;
  unit: string;
  amountTiyin: string;
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const auth = (): Record<string, string> => {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
};
async function errorOf(r: Response, fallback: string): Promise<string> {
  try {
    const j = (await r.json()) as { error?: { message?: string | string[] }; message?: string | string[] };
    const m = j.error?.message ?? j.message;
    return Array.isArray(m) ? (m[0] ?? fallback) : (m ?? fallback);
  } catch {
    return fallback;
  }
}

export const taxesApi = {
  month: (period: string) => api.get<ApiResponse<TaxMonth>>(`/taxes/${period}`),
  save: (period: string, cells: CellInput[]) => api.patch<ApiResponse<TaxMonth>>(`/taxes/${period}`, { cells }),
  copyPrevious: (period: string) => api.post<ApiResponse<TaxMonth>>(`/taxes/${period}/copy-previous`, {}),
  types: () => api.get<ApiResponse<TaxType[]>>('/taxes/types'),
  saveTypes: (types: Partial<TaxType>[]) => api.patch<ApiResponse<TaxType[]>>('/taxes/types', { types }),
  sync: () => api.post<ApiResponse<{ periods: number }>>('/taxes/sync', {}),
  async template(period: string): Promise<void> {
    const r = await fetch(`${BASE}/taxes/template?period=${period}`, { headers: auth() });
    if (!r.ok) throw new Error(await errorOf(r, "Shablonni yuklab bo'lmadi"));
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Soliqlar-${period}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  async parse(period: string, file: File): Promise<{ period: string; cells: CellInput[]; unknownUnits: string[]; unknownColumns: string[] }> {
    const fd = new FormData();
    fd.append('file', file);
    const r = await fetch(`${BASE}/taxes/parse?period=${period}`, { method: 'POST', headers: auth(), body: fd });
    if (!r.ok) throw new Error(await errorOf(r, "Faylni o'qib bo'lmadi"));
    return ((await r.json()) as ApiResponse<{ period: string; cells: CellInput[]; unknownUnits: string[]; unknownColumns: string[] }>).data;
  },
};