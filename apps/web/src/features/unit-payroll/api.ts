import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Yo'nalish ish haqi (Tax free …): /api/unit-payroll/:unit/…
// ═══════════════════════════════════════════════════════════

export interface UnitStaff {
  pinfl: string;
  fullName: string;
  position: string | null;
  active: boolean;
  addedAt: string;
  /** UPLOAD — vedomostdan, MANUAL — qo'lda, REGISTRY — Xodimlar bazasidan, MOVE — boshqa bo'limdan ko'chib kelgan */
  source: 'UPLOAD' | 'MANUAL' | 'REGISTRY' | 'MOVE';
  leftAt: string | null;
  /** Umumiy xodimlar bazasida ham bor */
  inRegistry: boolean;
  /** Bo'limlar o'rtasida ko'chishlari (oy tartibida) */
  moves?: MoveStep[];
}

export interface MoveStep {
  id: string;
  unit: string;
  unitLabel: string;
  from: string;
}

/** Bo'limlar o'rtasida ko'chish («miya» tarixi) */
export interface UnitMove {
  id: string;
  pinfl: string;
  fullName: string;
  unit: string;
  unitLabel: string;
  from: string;
  fromUnit: string | null;
  fromUnitLabel: string | null;
  note: string | null;
  source: 'MANUAL' | 'UPLOAD';
  createdAt: string;
}

export interface UnitStaffList {
  unit: string;
  label: string;
  active: number;
  total: number;
  /** Ko'rsatilgan oy (shu oydagi tarkib) */
  period?: string;
  items: UnitStaff[];
  /** Shu oyda boshqa bo'limda bo'lganlar (oldin yoki keyin shu yerda) */
  away?: { pinfl: string; fullName: string; unit: string | null; unitLabel: string | null; moves: MoveStep[] }[];
}

/** Xodimlar bazasi bilan bog'lash */
export interface StaffLinkInfo {
  unit: string;
  label: string;
  /** Bo'limlar nomi bo'yicha avtomatik tanlanadi */
  auto: boolean;
  /** Lavozimida yo'nalish nomi bor xodimlar ham */
  byPosition: boolean;
  /** Ma'lumotnomalardan (10/16/37/51-jadval) — tuzilmasi shu yo'nalishga tegishlilar */
  byHr?: boolean;
  hrCount?: number;
  departments: { id: string; name: string; employees: number; selected: boolean }[];
  /** Bazadan bog'langan faol xodimlar soni */
  linkedCount: number;
}

export interface StaffLookup {
  pinfl: string;
  inStaff: boolean;
  active: boolean;
  fullName: string | null;
  position: string | null;
  inRegistry: boolean;
}

/** KNOWN — ro'yxatda; RETURNING — ketgan edi, qaytadi; REGISTRY — yangi (ismi bazadan); NEW — yangi (ism kerak) */
export type UnitRowStatus = 'KNOWN' | 'RETURNING' | 'REGISTRY' | 'NEW';

export interface UnitAnalyzeRow {
  rowIndex: number;
  pinfl: string;
  fullName: string | null;
  position: string | null;
  amountTiyin: string;
  status: UnitRowStatus;
  /** Shu oyda boshqa bo'limda (ko'chishlar bo'yicha) — summa bo'lsa, saqlanganda shu bo'limga ko'chadi */
  otherUnit?: string;
  otherUnitLabel?: string;
  /** Shu oy umumiy vedomostda bor — saqlanmaydi (ish haqi ikki marta sanalmasin) */
  inGeneral?: boolean;
}

export interface UnitAnalyzeResult {
  unit: string;
  label: string;
  period: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  zeroRows: number;
  knownRows: number;
  newRows: number;
  returningRows: number;
  unnamedRows: number;
  movedRows?: number;
  /** Umumiy vedomostda allaqachon bor — olinmaydi */
  inGeneralRows?: number;
  inGeneralTiyin?: string;
  totalTiyin: string;
  invalidRows: { rowIndex: number; reason: string }[];
  duplicates: string[];
  notInFile: { pinfl: string; fullName: string }[];
  hasPrevious: boolean;
  previousCount: number;
  previousTiyin: string;
  rows: UnitAnalyzeRow[];
}

/** Fayldagi hamma oylar (oylar oralig'i shabloni) */
export interface UnitManyResult {
  unit: string;
  label: string;
  fileName: string;
  /** MONTHS — oylar ustunli shablon; SINGLE — eski (PINFL, Summa) — tanlangan oy */
  format: 'MONTHS' | 'SINGLE';
  invalidRows: { rowIndex: number; reason: string }[];
  duplicates: string[];
  months: (UnitAnalyzeResult & { monthLabel: string; paidRows: number })[];
}

export interface UnitCommitResult {
  success: true;
  batchId: string;
  expenseCreated: boolean;
  employees: number;
  zeroCount: number;
  totalTiyin: string;
  newStaff: number;
  returned: number;
  movedIn?: number;
  replacedPrevious: boolean;
  /** Umumiy vedomostda bor bo'lgani uchun olinmaganlar */
  skippedInGeneral?: number;
}

export interface UnitBatch {
  id: string;
  period: string;
  fileName: string;
  status: 'COMMITTED' | 'CANCELLED';
  createdAt: string;
  cancelledAt: string | null;
  uploadedBy: string;
  totalTiyin: string;
  count: number;
  zeroCount: number;
  newStaff: number;
  expenseId: string | null;
  rowsCount: number;
}

export interface UnitBatchDetail extends Omit<UnitBatch, 'rowsCount'> {
  rows: { pinfl: string; fullName: string; amountTiyin: string }[];
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: { message?: string | string[] }; message?: string | string[] };
    const raw = parsed.error?.message ?? parsed.message;
    return Array.isArray(raw) ? (raw[0] ?? fallback) : (raw ?? fallback);
  } catch {
    return fallback;
  }
}

const enc = encodeURIComponent;

/** Shu oy saqlangan ish haqi — xodimlar bo'yicha */
export interface UnitSavedRow {
  pinfl: string;
  fullName: string;
  position: string | null;
  amountTiyin: string;
  batches: { id: string; fileName: string }[];
  inRegistry: boolean;
  /** Shu oyda boshqa bo'limda (ko'chishlar bo'yicha) */
  otherUnit?: string;
  otherUnitLabel?: string;
}

export interface UnitSaved {
  unit: string;
  label: string;
  period: string;
  monthLabel: string;
  count: number;
  paidCount: number;
  totalTiyin: string;
  splitTiyin: string;
  batches: number;
  rows: UnitSavedRow[];
}

export const unitPayrollApi = {
  saved: (unit: string, period: string) => api.get<ApiResponse<UnitSaved>>(`/unit-payroll/${enc(unit)}/saved?period=${enc(period)}`),
  removeRows: (unit: string, period: string, pinfls: string[]) =>
    api.post<ApiResponse<{ removed: number; totalTiyin: string }>>(`/unit-payroll/${enc(unit)}/saved/remove?period=${enc(period)}`, { pinfls }),
  moveRows: (unit: string, period: string, body: { pinfls: string[]; target: string; onlyThisMonth: boolean; withAmount: boolean }) =>
    api.post<ApiResponse<{ moved: number; totalTiyin: string; target: string; targetLabel: string }>>(`/unit-payroll/${enc(unit)}/saved/move?period=${enc(period)}`, body),
  staff: (unit: string, period?: string) => api.get<ApiResponse<UnitStaffList>>(`/unit-payroll/${enc(unit)}/staff`, period ? { params: { period } } : undefined),
  moves: (unit: string, pinfl?: string) => api.get<ApiResponse<{ items: UnitMove[]; units: { code: string; label: string }[] }>>(`/unit-payroll/${enc(unit)}/moves`, pinfl ? { params: { pinfl } } : undefined),
  addMove: (unit: string, body: { pinfl: string; unit: string; from: string; note?: string; fullName?: string }) => api.post<ApiResponse<UnitMove>>(`/unit-payroll/${enc(unit)}/moves`, body),
  removeMove: (unit: string, id: string) => api.delete<ApiResponse<{ success: true; id: string }>>(`/unit-payroll/${enc(unit)}/moves/${enc(id)}`),
  link: (unit: string) => api.get<ApiResponse<StaffLinkInfo>>(`/unit-payroll/${enc(unit)}/link`),
  setLink: (unit: string, body: { departmentIds?: string[] | null; byPosition?: boolean; byHr?: boolean }) => api.patch<ApiResponse<StaffLinkInfo>>(`/unit-payroll/${enc(unit)}/link`, body),
  lookup: (unit: string, pinfl: string) => api.get<ApiResponse<StaffLookup>>(`/unit-payroll/${enc(unit)}/lookup/${enc(pinfl)}`),
  addStaff: (unit: string, body: { pinfl: string; fullName?: string; position?: string }) =>
    api.post<ApiResponse<UnitStaffList>>(`/unit-payroll/${enc(unit)}/staff`, body),
  updateStaff: (unit: string, pinfl: string, body: { active?: boolean; fullName?: string; position?: string | null }) =>
    api.patch<ApiResponse<UnitStaffList>>(`/unit-payroll/${enc(unit)}/staff/${enc(pinfl)}`, body),
  commit: (unit: string, period: string, body: { rows: { pinfl: string; amountTiyin: string; fullName?: string | null }[]; fileName: string }, replace: boolean) =>
    api.post<ApiResponse<UnitCommitResult>>(`/unit-payroll/${enc(unit)}/commit?period=${enc(period)}&replace=${replace ? 'true' : 'false'}`, body),
  batches: (unit: string, period: string) => api.get<ApiResponse<UnitBatch[]>>(`/unit-payroll/${enc(unit)}/batches?period=${enc(period)}`),
  batch: (unit: string, period: string, id: string) => api.get<ApiResponse<UnitBatchDetail>>(`/unit-payroll/${enc(unit)}/batches/${enc(id)}?period=${enc(period)}`),
  cancel: (unit: string, period: string, id: string) =>
    api.post<ApiResponse<{ success: true; id: string }>>(`/unit-payroll/${enc(unit)}/batches/${enc(id)}/cancel?period=${enc(period)}`),
};

/** Shablon: 1-varaq — PINFL, Summa; 2-varaq — faqat shu bo'lim xodimlari */
/** Shablon — oylar oralig'i (from–to): har oy alohida ustun */
export async function downloadUnitTemplate(unit: string, from: string, to: string = from): Promise<void> {
  const response = await fetch(`${BASE}/unit-payroll/${enc(unit)}/template?from=${enc(from)}&to=${enc(to)}`, { headers: authHeaders() });
  if (!response.ok) throw new Error(await readError(response, "Shablonni yuklab bo'lmadi"));
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : `Ish-haqi-${unit}-${from}_${to}.xlsx`;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Faylni tahlil qiladi — hali hech narsa saqlanmaydi */
export async function analyzeUnitFile(unit: string, period: string, file: File): Promise<UnitAnalyzeResult> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}/unit-payroll/${enc(unit)}/analyze?period=${enc(period)}`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, "Faylni tahlil qilib bo'lmadi"));
  return ((await response.json()) as ApiResponse<UnitAnalyzeResult>).data;
}

/** Faylni tahlil qiladi — undagi hamma oylar (eski shablon — tanlangan oy); hali saqlanmaydi */
export async function analyzeUnitFileMany(unit: string, period: string, file: File): Promise<UnitManyResult> {
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}/unit-payroll/${enc(unit)}/analyze-many?period=${enc(period)}`, { method: 'POST', headers: authHeaders(), body: form });
  if (!response.ok) throw new Error(await readError(response, "Faylni tahlil qilib bo'lmadi"));
  return ((await response.json()) as ApiResponse<UnitManyResult>).data;
}