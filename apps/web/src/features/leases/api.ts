import { api, getToken, type ApiResponse } from '@/lib/api';
import { parseSum } from '@/lib/format';

// ═══════════════════════════════════════════════════════════
// Ijara — turlar (backend bilan bir xil)
// ═══════════════════════════════════════════════════════════

export type LeaseKind = 'ODDIY' | 'AEROPORT';
export type LeaseFrequency = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type LeaseDocumentType = 'SHARTNOMA' | 'QOSHIMCHA_KELISHUV' | 'DALOLATNOMA' | 'BOSHQA';
export type LeaseStatus = 'ACTIVE' | 'NOT_STARTED' | 'ENDED';

export interface LeasePlace {
  regionCode: number;
  regionName: string;
  districtId: string | null;
  districtName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  airportName: string | null;
  label: string;
}

export interface LeaseListItem {
  id: string;
  number: string;
  contractDate: string | null;
  kind: LeaseKind;
  title: string;
  place: LeasePlace;
  lessorName: string;
  areaM2: number | null;
  vatIncluded: boolean;
  paymentFrequency: LeaseFrequency;
  startPeriod: string;
  endPeriod: string | null;
  status: LeaseStatus;
  monthlyTiyin: string;
  latestTiyin: string;
  nextChange: { validFrom: string; monthlyTiyin: string } | null;
  documentCount: number;
  hasContract: boolean;
}

export interface LeaseListResult {
  period: string;
  items: LeaseListItem[];
  summary: {
    total: number;
    active: number;
    ended: number;
    notStarted: number;
    monthlyTiyin: string;
    withoutContract: number;
    byKind: { kind: LeaseKind; count: number; monthlyTiyin: string }[];
  };
}

export interface LeaseDocument {
  id: string;
  termId: string | null;
  type: LeaseDocumentType;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface LeaseTerm {
  id: string;
  validFrom: string;
  validTo: string | null;
  monthlyTiyin: string;
  note: string | null;
  createdAt: string;
  documents: LeaseDocument[];
}

export interface LeaseAccrual {
  period: string;
  accruedTiyin: string;
  expectedTiyin: string;
  changed: boolean;
}

export interface LeaseDetail extends Omit<LeaseListItem, 'documentCount' | 'hasContract'> {
  address: string | null;
  purpose: string | null;
  lessorTin: string | null;
  lessorPhone: string | null;
  lessorBank: string | null;
  paymentDay: number | null;
  endReason: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  /** Eng yangisi birinchi */
  terms: LeaseTerm[];
  documents: LeaseDocument[];
  accruals: LeaseAccrual[];
  accruedTotalTiyin: string;
  /** Tahrirlashdan keyin: qayta yopish kerak bo'lgan oylar */
  stalePeriods?: string[];
}

export interface LeaseInput {
  number?: string;
  contractDate?: string | null;
  kind?: LeaseKind;
  title?: string;
  regionCode?: number;
  districtId?: string | null;
  departmentId?: string | null;
  airportName?: string | null;
  address?: string | null;
  areaM2?: number | null;
  purpose?: string | null;
  lessorName?: string;
  lessorTin?: string | null;
  lessorPhone?: string | null;
  lessorBank?: string | null;
  vatIncluded?: boolean;
  paymentFrequency?: LeaseFrequency;
  paymentDay?: number | null;
  startPeriod?: string;
  note?: string | null;
  monthlyTiyin?: string;
}

export interface LeaseLookups {
  regions: { code: number; name: string; districts: { id: string; name: string }[] }[];
  departments: { id: string; name: string; index: number }[];
  airports: string[];
}

export interface MonthRow {
  leaseId: string;
  number: string;
  title: string;
  kind: LeaseKind;
  place: LeasePlace;
  lessorName: string;
  expectedTiyin: string;
  accruedTiyin: string | null;
  changed: boolean;
}

export interface MonthView {
  period: string;
  close: {
    id: string;
    closedAt: string;
    closedBy: string | null;
    leaseCount: number;
    totalTiyin: string;
  } | null;
  rows: MonthRow[];
  expectedTotalTiyin: string;
  stale: boolean;
}

export interface MonthCloseSummary {
  id: string;
  period: string;
  leaseCount: number;
  totalTiyin: string;
  closedAt: string;
  closedBy: string | null;
  stale: boolean;
}

export interface MonthList {
  closes: MonthCloseSummary[];
  openPeriods: string[];
}

// ═══════════════════════════════════════════════════════════
// Yorliqlar
// ═══════════════════════════════════════════════════════════

export const KIND_LABELS: Record<LeaseKind, string> = {
  ODDIY: 'Hudud / Markaz',
  AEROPORT: 'Aeroport',
};

export const FREQUENCY_LABELS: Record<LeaseFrequency, string> = {
  MONTHLY: 'Har oy',
  QUARTERLY: 'Har chorak',
  YEARLY: 'Har yil',
};

export const DOCUMENT_LABELS: Record<LeaseDocumentType, string> = {
  SHARTNOMA: 'Shartnoma',
  QOSHIMCHA_KELISHUV: "Qo'shimcha kelishuv",
  DALOLATNOMA: 'Dalolatnoma',
  BOSHQA: 'Boshqa',
};

export const STATUS_LABELS: Record<LeaseStatus, { label: string; tone: 'income' | 'neutral' | 'warn' }> = {
  ACTIVE: { label: 'Amalda', tone: 'income' },
  NOT_STARTED: { label: 'Boshlanmagan', tone: 'warn' },
  ENDED: { label: 'Tugagan', tone: 'neutral' },
};

/** Hujjat yuklashda ruxsat etilgan fayllar */
export const DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx';

// ═══════════════════════════════════════════════════════════
// Yordamchilar
// ═══════════════════════════════════════════════════════════

/** "12 500 000" yoki "12500000,50" → tiyin satri; noto'g'ri bo'lsa null */
export function somToTiyin(input: string): string | null {
  const value = parseSum(input);
  if (!value || value.isNegative()) return null;
  return value.times(100).toFixed(0);
}

/** Tiyin → forma maydoni uchun so'm matni: "12500000" yoki "12500000.5" */
export function tiyinToSomInput(tiyin: string): string {
  const value = BigInt(tiyin);
  const som = value / 100n;
  const rest = value % 100n;
  return rest === 0n ? som.toString() : `${som}.${rest.toString().padStart(2, '0')}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ═══════════════════════════════════════════════════════════
// Fayllar (token bilan)
// ═══════════════════════════════════════════════════════════

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

/** Hujjat yuklash */
export async function uploadLeaseDocument(
  leaseId: string,
  file: File,
  type: LeaseDocumentType,
  termId?: string | null,
): Promise<LeaseDocument> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);
  if (termId) formData.append('termId', termId);

  const response = await fetch(`${BASE}/leases/${leaseId}/documents`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  if (!response.ok) throw new Error(await readError(response, 'Hujjatni yuklab bo‘lmadi'));

  const result = (await response.json()) as ApiResponse<LeaseDocument>;
  return result.data;
}

/**
 * Hujjatni ochish (PDF va rasm — yangi oynada) yoki yuklab olish.
 * Oyna oldindan ochiladi — brauzer "popup"ni to'smasligi uchun.
 */
export async function openLeaseDocument(doc: LeaseDocument, download = false): Promise<void> {
  const viewable = doc.mimeType === 'application/pdf' || doc.mimeType.startsWith('image/');
  const preview = !download && viewable ? window.open('', '_blank') : null;

  const response = await fetch(`${BASE}/leases/documents/${doc.id}/file?inline=1`, {
    headers: authHeaders(),
  });
  if (!response.ok) {
    preview?.close();
    throw new Error(await readError(response, 'Hujjatni ochib bo‘lmadi'));
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  if (preview) {
    preview.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const link = document.createElement('a');
  link.href = url;
  link.download = doc.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

export const leasesApi = {
  lookups: () => api.get<ApiResponse<LeaseLookups>>('/leases/lookups'),

  list: (params: {
    period?: string;
    kind?: string;
    regionCode?: number;
    status?: string;
    search?: string;
  }) => api.get<ApiResponse<LeaseListResult>>('/leases', { params }),

  getOne: (id: string, period?: string) =>
    api.get<ApiResponse<LeaseDetail>>(`/leases/${id}`, { params: { period } }),

  create: (input: LeaseInput) => api.post<ApiResponse<LeaseDetail>>('/leases', input),

  update: (id: string, input: LeaseInput) =>
    api.patch<ApiResponse<LeaseDetail>>(`/leases/${id}`, input),

  remove: (id: string) => api.delete<ApiResponse<{ id: string }>>(`/leases/${id}`),

  /** Shu oydan boshlab yangi oylik summa */
  setTerm: (id: string, input: { validFrom: string; monthlyTiyin: string; note?: string | null }) =>
    api.post<ApiResponse<LeaseDetail>>(`/leases/${id}/terms`, input),

  removeTerm: (id: string, termId: string) =>
    api.delete<ApiResponse<LeaseDetail>>(`/leases/${id}/terms/${termId}`),

  /** endPeriod: null — qayta tiklash */
  terminate: (id: string, input: { endPeriod: string | null; endReason?: string | null }) =>
    api.post<ApiResponse<LeaseDetail>>(`/leases/${id}/terminate`, input),

  removeDocument: (docId: string) =>
    api.delete<ApiResponse<{ id: string }>>(`/leases/documents/${docId}`),

  months: () => api.get<ApiResponse<MonthList>>('/leases/months'),

  month: (period: string) => api.get<ApiResponse<MonthView>>(`/leases/months/${period}`),

  closeMonth: (period: string, replace = false) =>
    api.post<ApiResponse<MonthCloseSummary>>(`/leases/months/${period}/close`, { replace }),

  cancelMonth: (period: string) =>
    api.post<ApiResponse<{ period: string; removed: number }>>(`/leases/months/${period}/cancel`),
};
