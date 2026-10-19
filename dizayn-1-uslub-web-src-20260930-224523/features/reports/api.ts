import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Hisobotlar markazi — backend (apps/api/src/modules/reports) bilan bir xil turlar
// ═══════════════════════════════════════════════════════════

export type ReportFormat = 'xlsx' | 'pptx' | 'pdf';

export interface CatalogItem {
  id: string;
  title: string;
  description: string;
  contents: string[];
  unit: 'none' | 'optional' | 'required';
  period: boolean;
  formats: ReportFormat[];
  group: string;
  /** Ixtiyoriy obyekt tanlovi (masalan, bitta munosabat) */
  subject?: { kind: 'reaction'; label: string; emptyLabel: string };
}

export interface HistoryItem {
  id: string;
  type: string;
  title: string;
  format: ReportFormat;
  filename: string;
  size: number;
  params: { from: string; to: string; unit?: string; subject?: string; subtitle?: string };
  createdAt: string;
  createdBy: string | null;
}

export const FORMAT_LABEL: Record<ReportFormat, string> = {
  xlsx: 'Excel',
  pptx: 'PowerPoint',
  pdf: 'PDF',
};

export const FORMAT_HINT: Record<ReportFormat, string> = {
  xlsx: 'Jadvallar — tahrirlash, saralash, hisob-kitob uchun',
  pptx: 'Slaydlar — majlis va taqdimot uchun, grafiklar bilan',
  pdf: 'Chop etish va yuborish uchun tayyor hujjat',
};

export interface ReconcileCheck {
  area: string;
  name: string;
  expectedTiyin: string | null;
  actualTiyin: string | null;
  ok: boolean;
  detail?: string;
}

export interface ReconcileResult {
  range: { from: string; to: string };
  rangeText: string;
  checkedAt: string;
  baseline: { incomeTiyin: string; expenseTiyin: string; incomeDoimiyTiyin: string; expenseDoimiyTiyin: string; receivableTiyin: string };
  checks: ReconcileCheck[];
  passed: number;
  failed: number;
}

export const reportsApi = {
  reconcile: (from: string, to: string) => api.get<ApiResponse<ReconcileResult>>('/reports/reconcile', { params: { from, to } }),
  catalog: () => api.get<ApiResponse<CatalogItem[]>>('/reports/catalog'),
  history: (limit = 50) => api.get<ApiResponse<HistoryItem[]>>('/reports/history', { params: { limit } }),
  remove: (id: string) => api.delete<void>(`/reports/history/${id}`),
};

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

async function saveResponse(response: Response, fallback: string): Promise<string> {
  if (!response.ok) {
    let message = 'Hisobot tayyorlanmadi';
    try {
      const body = (await response.json()) as { error?: { message?: string | string[] }; message?: string | string[] };
      const m = body.error?.message ?? body.message;
      if (m) message = Array.isArray(m) ? m.join('; ') : m;
    } catch {
      /* javob JSON emas */
    }
    throw new Error(message);
  }
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition) ?? /filename="([^"]+)"/.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]!) : fallback;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Hisobot yaratish va darhol yuklab olish; fayl nomini qaytaradi */
export async function generateReport(payload: { type: string; from: string; to: string; unit?: string; subject?: string; format: ReportFormat }): Promise<string> {
  const response = await fetch(`${BASE}/reports/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return saveResponse(response, `hisobot.${payload.format}`);
}

/** Tarixdagi hisobotni qayta yuklab olish */
export async function downloadHistory(item: HistoryItem): Promise<void> {
  const response = await fetch(`${BASE}/reports/history/${item.id}/file`, { headers: authHeaders() });
  await saveResponse(response, item.filename);
}