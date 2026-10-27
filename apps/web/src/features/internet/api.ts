import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Internet — backend bilan bir xil turlar
// ═══════════════════════════════════════════════════════════

export type UnitRef = { kind: 'center' } | { kind: 'department'; departmentId: string } | { kind: 'region'; regionCode: number };

export interface Contract {
  contractNo: string;
  contractDate: string | null;
  /** Kimga to'lanadi */
  provider: string | null;
  /** Nima uchun */
  purpose: string | null;
  unit: UnitRef | null;
}

export interface Registry {
  contracts: Contract[];
  categoryCode: string | null;
}

export interface Payment {
  ref: string;
  period: string;
  amountTiyin: string;
  text: string;
  contractNo: string | null;
  contractDate: string | null;
  prepaid: boolean;
  posted: boolean;
}

export interface ContractSummary {
  contractNo: string;
  contractDate: string | null;
  inRegistry: boolean;
  contract: Contract | null;
  months: Record<string, string>;
  totalTiyin: string;
  count: number;
  prepaid: boolean;
  notes: string[];
}

export interface Analysis {
  fileName: string;
  /** pairs — oy juftliklari, template — shablon, bank — bank ko'chirmasi (выписка) */
  format: 'pairs' | 'template' | 'bank';
  /** Bank ko'chirmasi: chiqim qatorlari va internet bo'lmagani (o'tkazib yuborilgan) */
  bank: { rows: number; skipped: number; skippedTiyin: string } | null;
  months: string[];
  payments: Payment[];
  contracts: ContractSummary[];
  registryFromFile: Contract[];
  registryUnresolved: { contractNo: string; unitName: string }[];
  byMonth: { period: string; totalTiyin: string; count: number }[];
  totalTiyin: string;
  warnings: string[];
  noContract: number;
}

export interface Lookups {
  departments: { id: string; name: string; code: string }[];
  regions: { code: number; name: string }[];
  categories: { code: string; label: string }[];
}

export interface Overview {
  registry: Registry;
  category: { code: string; label: string; exists: boolean };
  lookups: Lookups;
  posted: {
    months: string[];
    rows: { contractNo: string; months: Record<string, string>; totalTiyin: string; unitLabel: string; mismatch: boolean }[];
    totalTiyin: string;
    count: number;
    byUnit: { label: string; totalTiyin: string; count: number }[];
  };
}

export const internetApi = {
  overview: () => api.get<ApiResponse<Overview>>('/internet'),
  saveRegistry: (contracts: Contract[], categoryCode: string | null, applyToPosted: boolean) =>
    api.patch<ApiResponse<{ registry: Registry; updated: number }>>('/internet/registry', { contracts, categoryCode, applyToPosted }),
  commit: (fileName: string, payments: Payment[], contracts: Contract[], categoryCode: string | null) =>
    api.post<ApiResponse<{ created: number; skipped: number; totalTiyin: string; unassigned: number; batchId: string | null }>>('/internet/commit', { fileName, payments, contracts, categoryCode }),
};

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

async function saveFile(response: Response, fallbackName: string): Promise<void> {
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
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

/** Faylni o'qish — hech narsa saqlanmaydi */
export async function analyzeInternetFile(file: File): Promise<Analysis> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}/internet/analyze`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, "Faylni o'qib bo'lmadi"));
  return ((await response.json()) as ApiResponse<Analysis>).data;
}

/** Shablon: file berilsa — shu fayldan to'ldirilgan (shartnomalar, oylar, tahlil) */
export async function downloadInternetTemplate(file?: File): Promise<void> {
  let response: Response;
  if (file) {
    const form = new FormData();
    form.append('file', file);
    response = await fetch(`${BASE}/internet/template`, { method: 'POST', headers: authHeaders(), body: form });
  } else {
    response = await fetch(`${BASE}/internet/template`, { headers: authHeaders() });
  }
  if (!response.ok) throw new Error(await readError(response, "Shablonni yuklab bo'lmadi"));
  await saveFile(response, 'Internet-shartnomalar.xlsx');
}

/** Biriktirish → tanlov qiymati */
export function unitValue(unit: UnitRef | null): string {
  if (!unit) return '';
  if (unit.kind === 'center') return 'center';
  if (unit.kind === 'department') return `dep:${unit.departmentId}`;
  return `reg:${unit.regionCode}`;
}

export function unitOf(value: string): UnitRef | null {
  if (value === 'center') return { kind: 'center' };
  if (value.startsWith('dep:')) return { kind: 'department', departmentId: value.slice(4) };
  if (value.startsWith('reg:')) return { kind: 'region', regionCode: Number(value.slice(4)) };
  return null;
}

export function unitText(unit: UnitRef | null, lookups: Lookups): string {
  if (!unit) return 'Biriktirilmagan';
  if (unit.kind === 'center') return 'Markaz (umumiy)';
  if (unit.kind === 'department') return `Markaz › ${lookups.departments.find((d) => d.id === unit.departmentId)?.name ?? "bo'lim"}`;
  return lookups.regions.find((r) => r.code === unit.regionCode)?.name ?? `Hudud ${unit.regionCode}`;
}