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
  /** Qo'shimcha sozlamalar (masalan, taqqoslash turi, qisqa / to'liq ko'rinish) */
  options?: { key: string; label: string; default: string; choices: { value: string; label: string }[] }[];
}

export interface HistoryItem {
  id: string;
  type: string;
  title: string;
  format: ReportFormat;
  filename: string;
  size: number;
  params: { from: string; to: string; unit?: string; subject?: string; subtitle?: string; options?: Record<string, string> };
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
export async function generateReport(payload: { type: string; from: string; to: string; unit?: string; subject?: string; options?: Record<string, string>; format: ReportFormat }): Promise<string> {
  const response = await fetch(`${BASE}/reports/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  return saveResponse(response, `hisobot.${payload.format}`);
}

// ═══════════════════════════════════════════════════════════
// Ekranda ko'rish: hisobot hujjati (backend reports.types.ts bilan bir xil)
// ═══════════════════════════════════════════════════════════

export type Tone = 'good' | 'bad' | 'neutral' | 'warn';
export type ColumnFormat = 'text' | 'money' | 'mln' | 'pct' | 'signedPct' | 'int' | 'decimal' | 'decimal3';
export type Cell = string | number | null;

/** Qatorni Munosabatga belgilash uchun modda (backend reports.types.ts → DocMark) */
export interface DocMark {
  kind: 'INCOME' | 'EXPENSE' | 'RESULT';
  label: string;
  filter: Record<string, string>;
}

export interface DocColumn {
  label: string;
  format?: ColumnFormat;
  width?: number;
  toneBy?: 'up' | 'down' | 'row';
  tones?: Record<string, Tone>;
}

/** Blok qaysi formatlarda (bo'lmasa — hammasida); ekranda Excel'dagidek ko'rsatiladi, grafiklar bilan */
export type DocFormats = { formats?: ('xlsx' | 'pptx' | 'pdf')[] };

export interface DocKpis extends DocFormats {
  type: 'kpis';
  /** Kartalar guruhi nomi (fakt / reja / prognoz) */
  title?: string;
  items: { label: string; value: string; sub?: string; tone?: Tone }[];
}

export interface DocTable extends DocFormats {
  type: 'table';
  title?: string;
  columns: DocColumn[];
  rows: Cell[][];
  total?: Cell[];
  note?: string;
  rowTone?: ('up' | 'down' | null)[];
  /** Har qator uchun Munosabat belgisi (rows bilan bir xil tartibda) */
  marks?: (DocMark | null)[];
  /** Ichma-ich jadval: qator darajasi (0 — eng yuqori); ekranda bosib ochiladi */
  levels?: number[];
  /** Boshida ochiq darajalar soni (standart 1) */
  openLevels?: number;
}

export interface DocChart extends DocFormats {
  type: 'chart';
  title: string;
  kind: 'bar' | 'barh' | 'line';
  labels: string[];
  series: { name: string; values: number[]; color?: string; asLine?: boolean }[];
  unit: string;
  stacked?: boolean;
}

export interface DocNotes extends DocFormats {
  type: 'notes';
  title?: string;
  items: string[];
}

export interface DocFormulas extends DocFormats {
  type: 'formulas';
  title?: string;
  headers?: [string, string];
  items: { name: string; formula: string }[];
}

export type DocBlock = DocKpis | DocTable | DocChart | DocNotes | DocFormulas;

export interface ReportDoc {
  kind: string;
  title: string;
  subtitle: string;
  meta: string[];
  highlights: string[];
  sections: { title: string; intro?: string; sheet?: string; formats?: ('xlsx' | 'pptx' | 'pdf')[]; blocks: DocBlock[] }[];
  fileBase: string;
  generatedAt: string;
}

export interface ReportRequest {
  type: string;
  from: string;
  to: string;
  unit?: string;
  subject?: string;
  options?: Record<string, string>;
}

/**
 * Ekranda ko'rish: Excel'dagi bloklar (batafsil jadvallar) + grafiklar.
 * Faqat PDF/PowerPoint uchun qisqartirilgan nusxalar takrorlanmasin.
 */
export function forScreen(doc: ReportDoc): ReportDoc {
  const show = (b: DocFormats & { type?: string }) => !b.formats || b.formats.includes('xlsx') || b.type === 'chart';
  return { ...doc, sections: doc.sections.map((s) => ({ ...s, blocks: s.blocks.filter(show) })).filter((s) => s.blocks.length > 0) };
}

/** Hisobotni ekranda ko'rish uchun (fayl yaratilmaydi, tarixga yozilmaydi) */
export function previewReport(payload: ReportRequest) {
  return api.post<ApiResponse<ReportDoc>>('/reports/preview', payload);
}

/** Tarixdagi hisobotni qayta yuklab olish */
export async function downloadHistory(item: HistoryItem): Promise<void> {
  const response = await fetch(`${BASE}/reports/history/${item.id}/file`, { headers: authHeaders() });
  await saveResponse(response, item.filename);
}