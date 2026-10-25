import { api, getToken, type ApiResponse } from '@/lib/api';
import type { InvalidRow, PayrollGroup } from './api';

// ═══════════════════════════════════════════════════════════
// Umumiy vedomost bo'limlar bilan birga: har xodim qayerga yoziladi (umumiy, bo'lim yoki olinmaydi).
// ═══════════════════════════════════════════════════════════

export const PAYROLL_UNITS = [
  { code: 'TAX_FREE', label: 'Tax free', slug: 'tax-free' },
  { code: 'FERMER', label: "Fermer xo'jaligi", slug: 'fermer' },
  { code: 'BUXGALTERIYA', label: 'Buxgalteriya xizmatlari', slug: 'buxgalteriya' },
  { code: 'MARKSHEYDER', label: 'Marksheyder', slug: 'marksheyder' },
] as const;

export type PlanTarget = 'GENERAL' | 'SKIP' | (typeof PAYROLL_UNITS)[number]['code'];

export const targetLabel = (t: string) => (t === 'GENERAL' ? 'Umumiy vedomost' : t === 'SKIP' ? 'Olinmaydi' : (PAYROLL_UNITS.find((u) => u.code === t)?.label ?? t));

export interface PlanRow {
  pinfl: string;
  rowIndex: number | null;
  fullName: string | null;
  place: string | null;
  amountTiyin: string;
  inRegistry: boolean;
  unitNow: string | null;
  unitNowLabel: string | null;
  suggested: PlanTarget;
  target: PlanTarget;
  locked: { unit: string; label: string; amountTiyin: string } | null;
  problem: string | null;
  /** Soliq hisobotidan: oylik (4-ilova) va boshqa daromad (5-ilova) */
  parts?: { salaryTiyin: string; otherTiyin: string };
}

export interface NdflSheetSummary {
  name: string;
  kind: 'SALARY' | 'OTHER';
  label: string;
  rows: number;
  people: number;
  monthTiyin: string;
  cumulativeTiyin: string;
  taxMonthTiyin: string;
  corrected: number;
  zeroMonth: number;
  types: { code: string; label: string; rows: number; monthTiyin: string }[];
}

/** Soliq hisoboti xulosasi (fayl soliq hisoboti bo'lsa) */
export interface NdflSummary {
  sheets: NdflSheetSummary[];
  people: number;
  inBoth: number;
  monthOverCumulative: number;
  periodHint: string | null;
  periodMismatch: boolean;
  salaryTiyin: string;
  otherTiyin: string;
  taxTiyin: string;
  /** Bo'lim sahifasida: boshqa joy xodimlari — olinmadi */
  outside?: number;
  outsideTiyin?: string;
}

export interface PlanSummary {
  total: number;
  totalTiyin: string;
  general: { count: number; zeroCount: number; totalTiyin: string; groups: PayrollGroup[] };
  units: { unit: string; label: string; count: number; totalTiyin: string; zeroCount: number; unnamed: number }[];
  locked: { count: number; fileTiyin: string; byUnit: { unit: string; label: string; count: number; fileTiyin: string; uploadedTiyin: string }[] };
  skipped: { count: number; totalTiyin: string };
  changed: number;
  blocking: number;
}

export interface PlanResult {
  period: string;
  rows: PlanRow[];
  summary: PlanSummary;
}

export interface PlanAnalysis extends PlanResult {
  fileName: string;
  totalRows: number;
  invalidRows: InvalidRow[];
  duplicates: string[];
  hasPrevious: boolean;
  previousCount: number;
  ndfl: NdflSummary | null;
}

export interface PlanCommitResult {
  success: true;
  general: { batchId: string; employees: number; zeroCount: number; totalTiyin: string; expensesCreated: number; replacedPrevious: boolean } | null;
  units: { unit: string; label: string; employees: number; totalTiyin: string }[];
  skipped: number;
  locked: number;
  moved: number;
}

export type PlanInputRow = Pick<PlanRow, 'pinfl' | 'amountTiyin' | 'target' | 'fullName' | 'rowIndex'>;

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export const planApi = {
  /** format: auto — shablon yoki soliq hisoboti; ndfl — faqat soliq hisoboti */
  async analyze(period: string, file: File, format: 'auto' | 'ndfl' = 'auto'): Promise<PlanAnalysis> {
    const form = new FormData();
    form.append('file', file);
    const token = getToken();
    const res = await fetch(`${BASE}/payroll-plan/analyze?period=${period}&format=${format}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
    if (!res.ok) {
      let msg = "Faylni tahlil qilib bo'lmadi";
      try {
        const raw = ((await res.json()) as { error?: { message?: string | string[] } }).error?.message;
        msg = (Array.isArray(raw) ? raw[0] : raw) ?? msg;
      } catch {
        /* e'tiborsiz */
      }
      throw new Error(msg);
    }
    return ((await res.json()) as ApiResponse<PlanAnalysis>).data;
  },
  preview: (period: string, rows: PlanInputRow[]) => api.post<ApiResponse<PlanResult>>(`/payroll-plan/preview?period=${period}`, { rows }),
  commit: (period: string, rows: PlanInputRow[], fileName: string, replace: boolean) => api.post<ApiResponse<PlanCommitResult>>(`/payroll-plan/commit?period=${period}&replace=${replace}`, { rows, fileName }),
};