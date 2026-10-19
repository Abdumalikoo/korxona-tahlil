import { api, getToken, type ApiResponse } from '@/lib/api';

// Xodimlar reja / tushum fayli — /api/plan-fact (administrator va Hududchi)

export interface PlanFactMonthValue {
  planTiyin: string;
  factTiyin: string;
  bonusTiyin: string;
  percent: number | null;
  /** Ustama fayldan («Ustama miqdori» ustuni) */
  bonusFromFile?: boolean;
}

export interface PlanFactRow {
  rowIndex: number;
  pinfl: string;
  fullName: string;
  fileName: string;
  regionCode: number;
  regionName: string;
  districtId: string | null;
  districtName: string | null;
  employmentType: string;
  fileType?: string | null;
  partial: boolean;
  moved: boolean;
  months: Record<string, PlanFactMonthValue>;
}

export interface PlanFactMonth {
  period: string;
  label: string;
  employees: number;
  planTiyin: string;
  factTiyin: string;
  bonusTiyin: string;
  percent: number | null;
  previousRows: number;
  /** Ustama — hudud xodimlarining shu oy ish haqi (Hududlar ish haqi vedomostiga yoziladi) */
  payroll: { fromFile: boolean; employees: number; totalTiyin: string; inGeneral: number; previousTiyin: string; generalPinfls: string[] };
}

export interface ReconcileLine {
  period: string;
  label: string;
  regionCode: number;
  regionName: string;
  districtId: string | null;
  districtName: string | null;
  factTiyin: string;
  incomeTiyin: string;
  diffTiyin: string;
  diffPercent: number | null;
  status: 'ok' | 'diff' | 'no_income';
}

/** Faylda bor, reestrda yo'q xodim */
export interface PlanFactMissing {
  rowIndex: number;
  fileName: string;
  region: string;
  pinfl: string | null;
  reason: 'pinfl' | 'name';
  regionCode: number | null;
  districtId: string | null;
  districtName: string | null;
  employmentType: string | null;
}

export interface PlanFactAnalysis {
  year: number;
  fileName: string;
  sheetName: string;
  totalRows: number;
  matchedRows: number;
  months: PlanFactMonth[];
  emptyMonths: string[];
  regions: { regionCode: number; name: string; employees: number; planTiyin: string; factTiyin: string; percent: number | null }[];
  missing: PlanFactMissing[];
  typeChanges: { rowIndex: number; fileName: string; from: string; to: string }[];
  /** Saqlanmaydigan qatorlar (topilmagan, aniqlanmagan, takror, xato katak) */
  skippedRows: number;
  ambiguous: { rowIndex: number; fileName: string; region: string; candidates: string[] }[];
  unknownRegions: { rowIndex: number; fileName: string; value: string }[];
  unknownDistricts: { rowIndex: number; fileName: string; region: string; value: string }[];
  duplicates: { rowIndex: number; fileName: string; firstRow: number }[];
  invalidCells: { rowIndex: number; fileName: string; month: string; value: string }[];
  partialNames: { rowIndex: number; fileName: string; registryName: string }[];
  nameMismatches: { rowIndex: number; pinfl: string; fileName: string; registryName: string }[];
  invalidPinfl: { rowIndex: number; fileName: string; value: string }[];
  registryRegion: { rowIndex: number; fileName: string; value: string; region: string }[];
  notInFile: string[];
  fileMonths: number[];
  single: boolean;
  hasPinfl: boolean;
  reconcile: ReconcileLine[];
  reconcileDistricts: ReconcileLine[];
  reconcileIssues: number;
  rows: PlanFactRow[];
}

export interface PlanFactCommitResult {
  year: number;
  saved: { period: string; label: string; employees: number; factTiyin: string; replaced: number; payrollTiyin: string | null }[];
  missing: number;
  reconcileIssues: number;
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

async function failMessage(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as { error?: { message?: string | string[] }; message?: string | string[] };
    const raw = parsed.error?.message ?? parsed.message;
    return Array.isArray(raw) ? (raw[0] ?? fallback) : (raw ?? fallback);
  } catch {
    return fallback;
  }
}

async function send<T>(path: string, file: File): Promise<T> {
  const token = getToken();
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  if (!response.ok) throw new Error(await failMessage(response, "Faylni o'qib bo'lmadi"));
  return ((await response.json()) as ApiResponse<T>).data;
}

/** months — tanlangan oylar (1–12); bo'sh — fayldagi hamma oylar */
const query = (year: number, months: number[]) => `year=${year}${months.length ? `&months=${months.join(',')}` : ''}`;

export const analyzePlanFact = (file: File, year: number, months: number[]) => send<PlanFactAnalysis>(`/plan-fact/analyze?${query(year, months)}`, file);

/** Saqlash: fayl serverda qayta o'qiladi (xuddi shu yil va oylar bilan). payroll=false — ustama ish haqi vedomostiga yozilmaydi */
export const commitPlanFact = (file: File, year: number, months: number[], payroll = true) =>
  send<PlanFactCommitResult>(`/plan-fact/commit?${query(year, months)}${payroll ? '' : '&payroll=0'}`, file);

/** Reestrda yo'q xodimlarni to'g'ridan-to'g'ri Xodimlarga qo'shish (fayldagi PINFL, F.I.Sh, hudud, shtat turi) */
export const addPlanFactEmployees = async (employees: { pinfl: string; fullName: string; regionCode: number; districtId: string | null; employmentType: string | null }[]) =>
  (await api.post<ApiResponse<{ created: number }>>('/plan-fact/add-employees', { employees })).data;

/** Bo'sh shablon (korxona shakli, bitta oy): Xodim F.I.Sh · JShShIR · Shtat · Hudud nomi · Oylik reja · Reja bajarilishi · Foizda · Ustama miqdori */
export async function downloadPlanFactTemplate(year: number, months: number[]): Promise<void> {
  const token = getToken();
  const response = await fetch(`${BASE}/plan-fact/template?${query(year, months)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(await failMessage(response, "Shablonni yuklab bo'lmadi"));
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = months.length === 1 ? `reja-tushum-${year}-${String(months[0]).padStart(2, '0')}.xlsx` : `reja-tushum-${year}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}