import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Turlar (backend bilan bir xil)
// ═══════════════════════════════════════════════════════════

export type ComponentGroup = 'BUDGET' | 'HOJALIK';

export type ComponentCategory =
  | 'ASOSIY'
  | 'TATIL'
  | 'PREMIYA'
  | 'KOMPENSATSIYA'
  | 'USTAMA'
  | 'JARIMA'
  | 'BOSHQA';

export const GROUP_LABELS: Record<ComponentGroup, string> = {
  BUDGET: 'Byudjet hisobidan',
  HOJALIK: "Xo'jalik hisobidan",
};

export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  ASOSIY: 'Asosiy ish haqi',
  TATIL: "Ta'til va kasallik",
  PREMIYA: 'Premiyalar',
  KOMPENSATSIYA: 'Kompensatsiyalar',
  USTAMA: 'Ustamalar',
  JARIMA: 'Jarimalar',
  BOSHQA: 'Boshqa',
};

export const CATEGORY_ORDER: ComponentCategory[] = [
  'ASOSIY',
  'TATIL',
  'PREMIYA',
  'KOMPENSATSIYA',
  'USTAMA',
  'BOSHQA',
  'JARIMA',
];

/** Grafik va belgilar uchun ranglar */
export const CATEGORY_COLORS: Record<ComponentCategory, string> = {
  ASOSIY: '#1e40af',
  TATIL: '#0891b2',
  PREMIYA: '#16a34a',
  KOMPENSATSIYA: '#ca8a04',
  USTAMA: '#7c3aed',
  BOSHQA: '#64748b',
  JARIMA: '#dc2626',
};

export interface SalaryComponent {
  code: string;
  name: string;
  group: ComponentGroup;
  groupLabel: string;
  category: ComponentCategory;
  categoryLabel: string;
  /** 1 — qo'shiladi, -1 — ayiriladi (jarima) */
  sign: number;
  sortOrder: number;
  isActive: boolean;
  usedCount: number;
}

export interface ComponentInput {
  code?: string;
  name?: string;
  group?: ComponentGroup;
  category?: ComponentCategory;
  sign?: number;
  sortOrder?: number;
  isActive?: boolean;
}

/**
 * Qator holati:
 * ok — soliq hisobotiga mos,
 * diff — summa farq qiladi,
 * not_in_payroll — soliq hisobotida bu xodim yo'q,
 * no_payroll — shu oyga soliq hisoboti yuklanmagan
 */
export type RowState = 'ok' | 'diff' | 'not_in_payroll' | 'no_payroll';

/** Oyning umumiy holati */
export type CheckState = 'MATCHED' | 'MISMATCH' | 'NO_PAYROLL' | 'NOT_UPLOADED';

export type BatchStatus = 'MATCHED' | 'MISMATCH' | 'NO_PAYROLL';

export interface CompositionRow {
  rowIndex: number | null;
  pinfl: string;
  fullName: string;
  inRegistry: boolean;
  unitName: string | null;
  workedDays: number | null;
  rate: number | null;
  /** Komponent kodi → summa (tiyin, doim musbat) */
  items: Record<string, string>;
  totalTiyin: string;
  payrollTiyin: string | null;
  diffTiyin: string | null;
  state: RowState;
}

export interface ComponentTotal {
  code: string;
  name: string;
  group: ComponentGroup;
  category: ComponentCategory;
  sign: number;
  /** Belgisi bilan (jarima manfiy) */
  totalTiyin: string;
  employees: number;
}

export interface CategoryTotal {
  category: ComponentCategory;
  label: string;
  /** Belgisi bilan (jarima manfiy) */
  totalTiyin: string;
  sharePercent: number | null;
}

export interface CheckPerson {
  pinfl: string;
  fullName: string;
  compositionTiyin: string;
  payrollTiyin: string;
  diffTiyin: string;
}

export interface CheckSummary {
  period: string;
  state: CheckState;
  payrollUploaded: boolean;
  compositionUploaded: boolean;
  compositionTiyin: string;
  payrollTiyin: string;
  diffTiyin: string;
  employees: number;
  mismatchCount: number;
  mismatches: CheckPerson[];
  missingInComposition: CheckPerson[];
  notInPayroll: CheckPerson[];
}

/** Fayl tahlili — bazaga hali hech narsa yozilmagan */
export interface CompositionAnalysis {
  period: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  columns: SalaryComponent[];
  missingColumns: { code: string; name: string }[];
  invalidRows: { rowIndex: number; reason: string }[];
  duplicates: { rowIndex: number; pinfl: string }[];
  unknownEmployees: { rowIndex: number; pinfl: string; fileName: string }[];
  totalMismatches: { rowIndex: number; pinfl: string; fileTiyin: string; computedTiyin: string }[];
  hasPrevious: boolean;
  byComponent: ComponentTotal[];
  byCategory: CategoryTotal[];
  check: CheckSummary;
  rows: CompositionRow[];
}

export interface CommitResult {
  success: true;
  batchId: string;
  saved: number;
  replacedPrevious: boolean;
  totalTiyin: string;
  payrollTiyin: string;
  status: BatchStatus;
  mismatchCount: number;
  /** Hudud xodimlari ish haqidan Markaz hisobiga o'tgan qism (bayram, choraklik) */
  centerTiyin?: string;
  centerEmployees?: number;
}

export interface CompositionBatch {
  id: string;
  period: string;
  fileName: string | null;
  employeeCount: number;
  totalTiyin: string;
  payrollTiyin: string;
  status: BatchStatus;
  mismatchCount: number;
  uploadedBy: string | null;
  createdAt: string;
  cancelledAt: string | null;
}

export interface CompositionView {
  period: string;
  batch: CompositionBatch | null;
  components: SalaryComponent[];
  byComponent: ComponentTotal[];
  byCategory: CategoryTotal[];
  check: CheckSummary;
  rows: CompositionRow[];
}

export interface EmployeeHistory {
  employee: { pinfl: string; fullName: string; unitName: string | null; inRegistry: boolean };
  components: SalaryComponent[];
  periods: {
    period: string;
    workedDays: number | null;
    rate: number | null;
    items: Record<string, string>;
    totalTiyin: string;
    payrollTiyin: string | null;
    diffTiyin: string | null;
    state: RowState;
  }[];
  byCategory: CategoryTotal[];
}

// ═══════════════════════════════════════════════════════════
// Yordamchilar
// ═══════════════════════════════════════════════════════════

/** Xodim qatoridagi summalarni guruh (kategoriya) bo'yicha yig'adi — belgisi bilan */
export function sumByCategory(
  items: Record<string, string>,
  components: SalaryComponent[],
): Record<ComponentCategory, bigint> {
  const result = {
    ASOSIY: 0n,
    TATIL: 0n,
    PREMIYA: 0n,
    KOMPENSATSIYA: 0n,
    USTAMA: 0n,
    JARIMA: 0n,
    BOSHQA: 0n,
  } as Record<ComponentCategory, bigint>;

  const byCode = new Map(components.map((c) => [c.code, c]));

  for (const [code, value] of Object.entries(items)) {
    const component = byCode.get(code);
    const amount = BigInt(value);
    const category = component?.category ?? 'BOSHQA';
    result[category] += (component?.sign ?? 1) < 0 ? -amount : amount;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
// Fayl bilan ishlash
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

/** Javobdagi faylni brauzerga yuklab beradi */
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

/** Shablon — faol komponentlar va shu oy soliq summalari bilan */
export async function downloadCompositionTemplate(period: string): Promise<void> {
  const response = await fetch(`${BASE}/salary-composition/template?period=${period}`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readError(response, 'Shablonni yuklab bo‘lmadi'));
  }

  await saveFile(response, `ish-haqi-tarkibi-${period}.xlsx`);
}

/** Saqlangan tarkib hisoboti — Tarkib, Guruhlar, Farqlar varaqlari */
export async function downloadCompositionExcel(period: string): Promise<void> {
  const response = await fetch(`${BASE}/salary-composition/export?period=${period}`, {
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readError(response, 'Faylni yuklab bo‘lmadi'));
  }

  await saveFile(response, `ish-haqi-tarkibi-${period}-hisobot.xlsx`);
}

/** Faylni tahlil qiladi — hali hech narsa saqlanmaydi */
export async function analyzeCompositionFile(
  period: string,
  file: File,
): Promise<CompositionAnalysis> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${BASE}/salary-composition/analyze?period=${period}`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await readError(response, 'Faylni tahlil qilib bo‘lmadi'));
  }

  const result = (await response.json()) as ApiResponse<CompositionAnalysis>;
  return result.data;
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

export const compositionApi = {
  /** Tahlil natijasini saqlaydi — shu oyning oldingi tarkibi almashtiriladi */
  commit: (period: string, fileName: string, rows: CompositionRow[]) =>
    api.post<ApiResponse<CommitResult>>(`/salary-composition/commit?period=${period}`, {
      fileName,
      rows: rows.map((row) => ({
        pinfl: row.pinfl,
        fullName: row.fullName,
        workedDays: row.workedDays,
        rate: row.rate,
        items: row.items,
      })),
    }),

  cancel: (batchId: string) =>
    api.post<ApiResponse<{ success: true; period: string }>>(
      `/salary-composition/batches/${batchId}/cancel`,
    ),

  batches: (period?: string) =>
    api.get<ApiResponse<CompositionBatch[]>>('/salary-composition/batches', {
      params: { period },
    }),

  view: (period: string) =>
    api.get<ApiResponse<CompositionView>>('/salary-composition/view', { params: { period } }),

  check: (period: string) =>
    api.get<ApiResponse<CheckSummary>>('/salary-composition/check', { params: { period } }),

  employee: (pinfl: string, from?: string, to?: string) =>
    api.get<ApiResponse<EmployeeHistory>>(`/salary-composition/employee/${pinfl}`, {
      params: { from, to },
    }),

  // ─────────── Komponentlar ───────────

  components: () => api.get<ApiResponse<SalaryComponent[]>>('/salary-composition/components'),

  createComponent: (input: ComponentInput) =>
    api.post<ApiResponse<SalaryComponent>>('/salary-composition/components', input),

  updateComponent: (code: string, input: ComponentInput) =>
    api.patch<ApiResponse<SalaryComponent>>(`/salary-composition/components/${code}`, input),

  removeComponent: (code: string) =>
    api.delete<ApiResponse<{ success: true }>>(`/salary-composition/components/${code}`),
};