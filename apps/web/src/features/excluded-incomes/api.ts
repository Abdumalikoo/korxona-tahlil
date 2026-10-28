import { api, getToken, type ApiResponse } from '@/lib/api';

// Hisobga olinmaydigan tushumlar — /api/excluded-incomes (daromadga qo'shilmaydi)

export type ExcludedKind = 'DEPOZIT' | 'USTAV_FONDI';

export interface ExcludedItem {
  id: string;
  kind: ExcludedKind;
  date: string;
  amountTiyin: string;
  note: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Bank ko'chirmasidan yo'naltirilgan — tahrir/o'chirish Bank ko'chirmasida (yo'naltirishni bekor qilish) */
  source?: 'BANK';
  counterparty?: string | null;
  documentNo?: string | null;
}

export interface ExcludedList {
  from: string;
  to: string;
  kinds: { code: ExcludedKind; label: string; totalTiyin: string }[];
  totalTiyin: string;
  months: { period: string; byKind: Record<ExcludedKind, string>; totalTiyin: string }[];
  items: ExcludedItem[];
}

export type ExcludedBody = { kind: ExcludedKind; date: string; amountTiyin: string; note?: string };

export const excludedApi = {
  list: (from: string, to: string) => api.get<ApiResponse<ExcludedList>>('/excluded-incomes', { params: { from, to } }),
  create: (body: ExcludedBody) => api.post<ApiResponse<ExcludedItem>>('/excluded-incomes', body),
  update: (id: string, body: ExcludedBody) => api.patch<ApiResponse<ExcludedItem>>(`/excluded-incomes/${encodeURIComponent(id)}`, body),
  remove: (id: string) => api.delete<ApiResponse<{ deleted: boolean }>>(`/excluded-incomes/${encodeURIComponent(id)}`),
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/** Excel yuklab olish */
export async function downloadExcluded(from: string, to: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`${BASE}/excluded-incomes/export?from=${from}&to=${to}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, credentials: 'include' });
  if (!response.ok) throw new Error("Faylni yuklab bo'lmadi");
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const m = /filename\*=UTF-8''([^;]+)/.exec(disposition) ?? /filename="([^"]+)"/.exec(disposition);
  const name = m ? decodeURIComponent(m[1]!) : 'hisobga-olinmaydigan-tushumlar.xlsx';
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
