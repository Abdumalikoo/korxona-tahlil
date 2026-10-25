import { api, getToken, type ApiResponse } from '@/lib/api';

// Yuklangan manba fayllar arxivi (faqat administrator)

export type SourceKind = 'salary-composition' | 'payroll' | 'unit-payroll' | 'acc-23106';

export interface SourceLinkState {
  version: number;
  at: string;
  ok: boolean;
  note: string;
}

export interface SourceEntry {
  id: string;
  kind: SourceKind;
  kindLabel: string;
  fileName: string;
  size: number;
  sealed: boolean;
  status: 'LINKED' | 'CANCELLED';
  periods: string[];
  unit: string | null;
  refId: string | null;
  at: string;
  linkedAt: string | null;
  cancelledAt: string | null;
  links: Record<string, SourceLinkState>;
}

export interface SourceArchiveList {
  directory: string;
  encrypted: boolean;
  running: boolean;
  entries: SourceEntry[];
  linkers: Record<SourceKind, { name: string; label: string; version: number }[]>;
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export const sourceArchiveApi = {
  list: (kind?: SourceKind) => api.get<ApiResponse<SourceArchiveList>>('/source-archive', kind ? { params: { kind } } : undefined),
  relink: (kind?: SourceKind, force = false) => api.post<ApiResponse<{ files: number; runs: number; failed: number }>>(`/source-archive/relink?${new URLSearchParams({ ...(kind ? { kind } : {}), ...(force ? { force: 'true' } : {}) }).toString()}`, {}),
  relinkOne: (kind: SourceKind, id: string) => api.post<ApiResponse<Record<string, SourceLinkState>>>(`/source-archive/${kind}/${encodeURIComponent(id)}/relink`, {}),
};

/** Arxivdagi faylni yuklab olish (audit yoziladi) */
export async function downloadSourceFile(e: SourceEntry): Promise<void> {
  const token = getToken();
  const response = await fetch(`${BASE}/source-archive/${e.kind}/${encodeURIComponent(e.id)}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error('Faylni yuklab bo‘lmadi');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = e.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
