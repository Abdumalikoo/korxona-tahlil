import { api, getToken, type ApiResponse } from '@/lib/api';
import type { StatementChecks } from '@/components/shared/file-check';

// Daromadlar › Qo'mita mablag'lari — /api/qomita/*

export interface QomitaItemView {
  id: string;
  departmentId: string;
  departmentName: string;
  incomeCode: string;
  incomeLabel: string;
  components: { code: string; name: string }[];
  categories: { code: string; label: string }[];
  note: string | null;
}

export interface QomitaConfigView {
  items: QomitaItemView[];
  departments: { id: string; name: string }[];
  components: { code: string; name: string; group: string }[];
  categories: { code: string; label: string; group: string | null; isLeaf: boolean }[];
}

export interface QomitaMonth {
  allocated: string;
  payroll: string;
  other: string;
}

export interface QomitaRowView {
  /** Bo'lim id; «-» — bo'lim ko'rsatilmagan Qo'mita daromadi */
  key: string;
  label: string;
  incomeCode: string | null;
  components: { code: string; name: string }[];
  categories: { code: string; label: string }[];
  allocatedTiyin: string;
  payrollTiyin: string;
  otherTiyin: string;
  coveredTiyin: string;
  balanceTiyin: string;
  months: Record<string, QomitaMonth>;
}

export interface QomitaReport {
  from: string;
  to: string;
  months: string[];
  tarkibMissing: string[];
  rows: QomitaRowView[];
  totals: { allocatedTiyin: string; payrollTiyin: string; otherTiyin: string; coveredTiyin: string; balanceTiyin: string };
}

export interface QomitaDetail {
  key: string;
  label: string;
  months: string[];
  incomeCode: string | null;
  incomes: { id: string; date: string; period: string; amountTiyin: string; description: string | null; clientName: string | null; documentNo: string | null; origin: 'BANK' | 'MANUAL' | 'FILE' | 'KASSA' | 'OTHER'; approved?: { at: string; by: string } | null }[];
  payrollParts: { code: string; name: string; totalTiyin: string; months: Record<string, string> }[];
  employees: { pinfl: string; fullName: string; totalTiyin: string; parts: Record<string, string>; months: Record<string, string> }[];
  categories: { code: string; label: string; totalTiyin: string; months: Record<string, string>; sub: string | null }[];
  tarkibMissing: string[];
}

export interface QomitaBankRow {
  account: string;
  accountLabel: string;
  rowId: string;
  docDate: string;
  docNo: string;
  payer: string;
  amountTiyin: string;
  purpose: string;
  matched: boolean;
}

/** Qo'mita ajratmasi — o'chirish ro'yxati uchun */
export interface QomitaIncomeRow {
  id: string;
  date: string;
  period: string;
  amountTiyin: string;
  department: string;
  description: string | null;
  documentNo: string | null;
  origin: 'BANK' | 'MANUAL' | 'FILE' | 'KASSA' | 'OTHER';
  canDelete: boolean;
}

export const qomitaApi = {
  config: () => api.get<ApiResponse<QomitaConfigView>>('/qomita/config'),
  saveItem: (body: { departmentId: string; components: string[]; categories: string[]; note?: string }) =>
    api.put<ApiResponse<{ item: unknown; recalculated: boolean; warning: string | null }>>('/qomita/item', body),
  removeItem: (departmentId: string) => api.delete<ApiResponse<{ removed: boolean; warning: string | null }>>(`/qomita/item/${encodeURIComponent(departmentId)}`),
  report: (from: string, to: string) => api.get<ApiResponse<QomitaReport>>('/qomita/report', { params: { from, to } }),
  detail: (key: string, from: string, to: string) => api.get<ApiResponse<QomitaDetail>>(`/qomita/detail/${encodeURIComponent(key)}`, { params: { from, to } }),
  addIncome: (body: { departmentId: string; period: string; date?: string; amount: string; description?: string }) => api.post<ApiResponse<{ id: string; amountTiyin: string }>>('/qomita/income', body),
  removeIncome: (id: string) => api.delete<ApiResponse<{ removed: boolean }>>(`/qomita/income/${encodeURIComponent(id)}`),
  /** Davrdagi hamma ajratmalar (o'chirish ro'yxati) */
  incomes: (from: string, to: string) => api.get<ApiResponse<QomitaIncomeRow[]>>('/qomita/incomes', { params: { from, to } }),
  /** Bir nechta ajratmani o'chirish (Savatdan tiklanadi; bankdan yo'naltirilgani — yo'naltirish bekor qilinadi) */
  removeIncomes: (ids: string[]) => api.post<ApiResponse<{ removed: number; failed: { id: string; message: string }[] }>>('/qomita/income/remove-many', { ids }),
  bank: (q?: string) => api.get<ApiResponse<{ total: number; items: QomitaBankRow[] }>>('/qomita/bank', { params: q ? { q } : {} }),
  bankRoute: (body: { items: { account: string; rowId: string }[]; departmentId: string; description?: string; skipDuplicates?: boolean; force?: boolean }) =>
    api.post<ApiResponse<{ count: number; totalTiyin: string; skipped: number }>>('/qomita/bank', body),
};

// ─────────── 3802 › Shtatlar — /api/qomita/3802/shtat/* ───────────

export type ShtatListKind = 'UMUMIY' | 'OLADI' | 'OLMAYDI' | 'BOSHQA';
/** Qoplash qoidasi: Oklad va 40% ustama, hamma summa yoki qoplanmaydi */
export type Coverage3802 = 'OKLAD_40' | 'FULL' | 'NONE';

export interface ShtatPositionView {
  row: number;
  name: string;
  units: number;
  grade: string;
  salaryTiyin: string;
  bonusTiyin: string;
  totalTiyin: string;
}

export interface ShtatSectionView {
  key: string;
  name: string;
  positions: ShtatPositionView[];
  units: number;
  totalTiyin: string;
  fileUnits: number | null;
  fileTotalTiyin: string | null;
  ok: boolean;
  settingKey: string;
  departmentId: string | null;
  departmentName: string | null;
  mapping: 'SAVED' | 'SUGGESTED' | 'NONE';
  coverage: Coverage3802;
  coveredTiyin: string;
}

export interface ShtatSheetView {
  sheet: string;
  kind: ShtatListKind;
  subtitle: string;
  annualFundTiyin: string | null;
  sections: ShtatSectionView[];
  units: number;
  totalTiyin: string;
}

export type ShtatKind = 'OLADI' | 'OLMAYDI';

export interface ShtatSummary {
  units: number;
  totalTiyin: string;
  coveredMonthlyTiyin: string;
  fullSections: number;
  unmapped: number;
  suggested: number;
  mismatched: number;
}

export interface ShtatAnalysis {
  kind: ShtatKind;
  fileName: string;
  sheet: ShtatSheetView;
  summary: ShtatSummary;
}

export type ShtatSaved = Omit<ShtatAnalysis, 'kind'> & { savedAt: string; savedBy: string };

export interface ShtatView {
  OLADI: ShtatSaved | null;
  OLMAYDI: ShtatSaved | null;
  departments: { id: string; name: string }[];
  coverages: Coverage3802[];
}

export interface ShtatMember {
  pinfl: string;
  fullName: string;
  /** Kadrlar ma'lumotnomasidagi lavozimi */
  position: string;
  okladTiyin: string;
  ustamaTiyin: string;
  /** Ish haqi tarkibi bo'yicha jami */
  totalTiyin: string;
}

export interface ShtatMembers {
  kind: ShtatKind;
  period: string | null;
  periods: string[];
  sections: {
    key: string;
    name: string;
    departmentId: string | null;
    departmentName: string | null;
    mapping: 'SAVED' | 'SUGGESTED' | 'NONE';
    units: number;
    positions: { name: string; units: number; members: ShtatMember[]; filled: number }[];
    /** Bo'limda bor, lavozimi shtatda topilmagan */
    others: ShtatMember[];
    members: number;
  }[];
  totals: { units: number; members: number; others: number };
  unmappedSections: number;
  noPosition: number;
}

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

async function upload<T>(path: string, file: File, fallback: string, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const token = getToken();
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  if (!response.ok) {
    let message = fallback;
    try {
      const parsed = (await response.json()) as { error?: { message?: string | string[] }; message?: string | string[] };
      const raw = parsed.error?.message ?? parsed.message;
      message = Array.isArray(raw) ? (raw[0] ?? fallback) : (raw ?? fallback);
    } catch {
      // Javob JSON emas — standart xabar
    }
    throw new Error(message);
  }
  return ((await response.json()) as ApiResponse<T>).data;
}

export const shtat3802Api = {
  view: () => api.get<ApiResponse<ShtatView>>('/qomita/3802/shtat'),
  /** Faylni o'qish — hech narsa saqlanmaydi */
  analyze: (kind: ShtatKind, file: File) => upload<ShtatAnalysis>(`/qomita/3802/shtat/analyze?kind=${kind}`, file, "Faylni o'qib bo'lmadi"),
  /** Saqlash — fayl serverda qayta o'qiladi */
  commit: (kind: ShtatKind, file: File) => upload<{ success: true; kind: ShtatKind; sections: number; units: number }>(`/qomita/3802/shtat/commit?kind=${kind}`, file, "Saqlab bo'lmadi"),
  section: (body: { kind: ShtatKind; section: string; departmentId: string | null; coverage: Coverage3802 }) =>
    api.post<ApiResponse<{ success: true; key: string; departmentId: string | null; coverage: Coverage3802 }>>('/qomita/3802/shtat/section', body),
  members: (kind: ShtatKind, period?: string | null) => api.get<ApiResponse<ShtatMembers>>('/qomita/3802/shtat/members', { params: { kind, period: period ?? undefined } }),
  /** Yuklangan shtatni o'chirish (shu toifa) */
  remove: (kind: ShtatKind) => api.delete<ApiResponse<{ removed: true; kind: ShtatKind }>>('/qomita/3802/shtat', { params: { kind } }),
  /** Shablonni yuklab olish (Excel) */
  template: async (kind: ShtatKind): Promise<void> => {
    const token = getToken();
    const response = await fetch(`${BASE}/qomita/3802/shtat/template?kind=${kind}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error("Shablonni yuklab bo'lmadi");
    const name = decodeURIComponent(/filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? '3802-shtat-shablon.xlsx');
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

// ─────────── 3802 › Har oylik real bajarilgan ishlar — /api/qomita/3802/oylik/* ───────────

export interface VedPeriodBrief {
  period: string;
  /** Olinadigan varaqlar (qismlar birga) */
  used: string[];
  /** Olinmaydigan varaqlar va sababi (nusxa, boshqa versiya) */
  skipped: { sheet: string; reason: string }[];
  sections: number;
  employees: number;
  totalTiyin: string;
  okladTiyin: string;
  ustamaTiyin: string;
  warnings: string[];
  /** Avval qabul qilingan (bo'lsa — almashtiriladi) */
  saved: { fileName: string; savedAt: string } | null;
}

export interface VedAnalysis {
  fileName: string;
  from: string;
  to: string;
  periods: VedPeriodBrief[];
  unknown: { sheet: string; reason: string }[];
}

export interface VedSavedPeriod {
  period: string;
  fileName: string;
  sheets: string[];
  savedAt: string;
  savedBy: string;
  employees: number;
  totalTiyin: string;
  okladTiyin: string;
  ustamaTiyin: string;
  warnings: string[];
}

export interface VedEmployeeView {
  row: number;
  fullName: string;
  position: string;
  amounts: Partial<Record<string, string>>;
  totalTiyin: string;
  note: string;
}

export interface VedDetail {
  period: string;
  fileName: string;
  sheets: string[];
  savedAt: string;
  savedBy: string;
  components: { code: string; label: string }[];
  sections: { name: string; employees: VedEmployeeView[]; totalTiyin: string; fileTotalTiyin: string | null; ok: boolean; okladTiyin: string; ustamaTiyin: string }[];
}

export const vedomost3802Api = {
  list: () => api.get<ApiResponse<{ periods: VedSavedPeriod[] }>>('/qomita/3802/oylik'),
  /** Faylni o'qish — undagi hamma oylar, hech narsa saqlanmaydi */
  analyze: (file: File) => upload<VedAnalysis>('/qomita/3802/oylik/analyze', file, "Faylni o'qib bo'lmadi"),
  /** Tanlangan oraliqni qabul qilish (fayl serverda qayta o'qiladi) */
  commit: (file: File, from: string, to: string) =>
    upload<{ success: true; saved: number; replaced: number; periods: string[] }>(`/qomita/3802/oylik/commit?from=${from}&to=${to}`, file, "Qabul qilib bo'lmadi"),
  detail: (period: string) => api.get<ApiResponse<VedDetail>>(`/qomita/3802/oylik/${encodeURIComponent(period)}`),
  /** Qabul qilingan oy(lar)ni o'chirish */
  remove: (from: string, to: string) => api.delete<ApiResponse<{ removed: number; periods: string[] }>>('/qomita/3802/oylik', { params: { from, to } }),
};

// ─────────── Qo'mita mablag'lari › Bank ko'chirmasidan — /api/qomita/statement/* ───────────

/** dep:<id> — bo'lim ajratmasi; DEPOSIT / LOAN — daromad emas; SKIP — o'tkazish */
export type StatementTarget = string;

export interface QomitaStatementRow {
  rowIndex: number;
  docDate: string;
  docNo: string;
  payer: string;
  amountTiyin: string;
  purpose: string;
  /** Faylga qo'lda yozilgan izoh («Marksheyder oylik», «Depozit») */
  comment: string;
  fromQomita: boolean;
  target: StatementTarget;
  period: string;
  reasons: string[];
  periodReason: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  signature: string | null;
  duplicate: boolean;
}

export interface QomitaStatementAnalysis {
  fileName: string;
  sheetName: string;
  checks: StatementChecks;
  commentColumn: number | null;
  incomingTotal: number;
  qomitaCount: number;
  rows: QomitaStatementRow[];
  departments: { id: string; name: string }[];
}

export interface QomitaUploadView {
  id: string;
  fileName: string;
  at: string;
  by: string;
  written: number;
  totalTiyin: string;
  notIncome: number;
  skipped: number;
  removedAt?: string | null;
  liveCount: number;
  liveTiyin: string;
}

export const qomitaStatementApi = {
  analyze: (file: File, all = false) => upload<QomitaStatementAnalysis>(`/qomita/statement/analyze${all ? '?all=1' : ''}`, file, "Faylni o'qib bo'lmadi"),
  commit: (file: File, decisions: { rowIndex: number; target: StatementTarget; period: string }[]) =>
    upload<{ uploadId: string; written: number; totalTiyin: string; notIncome: number; skipped: number }>('/qomita/statement/commit', file, "Yozib bo'lmadi", { decisions: JSON.stringify(decisions) }),
  uploads: () => api.get<ApiResponse<QomitaUploadView[]>>('/qomita/statement/uploads'),
  removeUpload: (id: string) => api.delete<ApiResponse<{ removed: number }>>(`/qomita/statement/uploads/${encodeURIComponent(id)}`),
};

// ─────────── 3802 › Nazorat zanjiri — /api/qomita/3802/nazorat/* ───────────

export type NzLinkCode = 'TARKIB' | 'SHTAT' | 'D23106' | 'QOPLASH' | 'AJRATISH';
export type NzStatus = 'OK' | 'WARN' | 'NONE' | 'LATER';

export interface NzLink {
  code: NzLinkCode;
  title: string;
  status: NzStatus;
  summary: string;
  warn: number;
  explained: number;
}

export interface NzOverview {
  toleranceTiyin: string;
  months: { period: string; links: { code: NzLinkCode; status: NzStatus; warn: number; explained: number }[]; employees: number; neededTiyin: string; incomeTiyin: string; ytdBalanceTiyin: string }[];
}

export interface NzTarkibItem {
  key: string;
  section: string;
  fullName: string;
  position: string;
  regional: boolean;
  how: 'LINK' | 'EXACT' | 'FIRST2' | 'FUZZY' | 'NONE' | 'CONFIRMED_NONE';
  pinfl: string | null;
  tarkibName: string | null;
  vedOklad: string;
  vedUstama: string;
  tarkibOklad: string | null;
  tarkibUstama: string | null;
  diffTiyin: string;
  status: 'OK' | 'DIFF' | 'NOT_FOUND' | 'CONFIRMED_NONE';
  note: string | null;
  candidates?: { pinfl: string; fullName: string }[];
}

export interface NzMonth {
  period: string;
  toleranceTiyin: string;
  links: NzLink[];
  tarkib: { loaded: boolean; items: NzTarkibItem[]; tarkibOnly: { key: string; pinfl: string; fullName: string; okladTiyin: string; ustamaTiyin: string; note: string | null }[] };
  d23106: {
    loaded: boolean;
    items: { key: string; section: string; fullName: string; regional: boolean; vedTatilTiyin: string; vedModdiyTiyin: string; vedTiyin: string; paid: { docDate: string; amountTiyin: string; kind: 'TATIL' | 'MODDIY' | 'ISH_HAQI' }[]; paidTiyin: string; ratio: number | null; how: 'PINFL' | 'NAME' | null; status: 'PAID' | 'DIFF' | 'WITH_SALARY' | 'NOT_PAID' | 'REGIONAL'; note: string | null }[];
  };
  shtat: {
    positions: { key: string; shtatKey: string; position: string; units: number; heads: number; salaryTiyin: string; maxOkladTiyin: string; people: { fullName: string; section: string; okladTiyin: string; over: boolean }[]; status: 'OK' | 'OVER_UNITS' | 'OVER_SALARY' | 'BOTH'; note: string | null }[];
    noPosition: { key: string; fullName: string; section: string; position: string; shtatName: string; note: string | null }[];
    sections: { key: string; name: string; employees: number; shtatKey: string | null; shtatName: string | null; shtatKind: 'OLADI' | 'OLMAYDI' | null; mode: 'SAVED' | 'SUGGESTED' | 'NONE'; note: string | null }[];
  };
  qoplash: {
    items: { key: string; departmentId: string | null; label: string; sections: { name: string; coverage: 'OKLAD_40' | 'FULL' | 'NONE'; rule: 'SHTAT' | 'DEFAULT'; neededTiyin: string; employees: number }[]; neededTiyin: string; incomeTiyin: string; diffTiyin: string; in3802: boolean; ytdBalanceTiyin: string }[];
    neededTiyin: string;
    incomeTiyin: string;
    otherIncomeTiyin: string;
    note: string | null;
  };
  shtatSections: { key: string; name: string; kind: 'OLADI' | 'OLMAYDI' }[];
}

export const nazorat3802Api = {
  overview: () => api.get<ApiResponse<NzOverview>>('/qomita/3802/nazorat'),
  detail: (period: string) => api.get<ApiResponse<NzMonth>>(`/qomita/3802/nazorat/${encodeURIComponent(period)}`),
  /** pinfl: string — bog'lash; null — «tarkibda yo'q»; undefined — bekor qilish */
  link: (fullName: string, pinfl?: string | null) => api.put<ApiResponse<{ saved: boolean }>>('/qomita/3802/nazorat/link', pinfl === undefined ? { fullName } : { fullName, pinfl }),
  section: (section: string, shtatKey?: string | null) => api.put<ApiResponse<{ saved: boolean }>>('/qomita/3802/nazorat/section', shtatKey === undefined ? { section } : { section, shtatKey }),
  note: (period: string, link: NzLinkCode, item: string, note: string) => api.put<ApiResponse<{ saved: boolean }>>('/qomita/3802/nazorat/note', { period, link, item, note }),
  config: (toleranceSom: string) => api.put<ApiResponse<{ toleranceTiyin: string }>>('/qomita/3802/nazorat/config', { toleranceSom }),
  export: async (period: string): Promise<void> => {
    const token = getToken();
    const response = await fetch(`${BASE}/qomita/3802/nazorat/${encodeURIComponent(period)}/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error("Excel'ni yuklab bo'lmadi");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = `3802-nazorat-${period}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

// ─────────── 3802 › Qo'mita pullarining sarfi — /api/qomita/3802/nazorat/sarf ───────────

export interface SarfUnit {
  key: string;
  kind: 'POOL' | 'CONTRACT' | 'UNASSIGNED';
  departmentId: string | null;
  label: string;
  segment: string | null;
  incomeTiyin: string;
  spendTiyin: string;
  coveredTiyin: string;
  fullBalanceTiyin: string;
  balance3802Tiyin: string;
  byMonth: Record<string, { income: string; spend: string; covered: string }>;
  cumulative: { period: string; fullBalanceTiyin: string; balance3802Tiyin: string }[];
  categories: { code: string; label: string; totalTiyin: string; byMonth: Record<string, string> }[];
}

export interface Sarf {
  from: string;
  to: string;
  months: string[];
  vedMonths: string[];
  pool: { incomeTiyin: string; coveredTiyin: string; balanceTiyin: string; months: { period: string; incomeTiyin: string; coveredTiyin: string; balanceTiyin: string }[]; units: SarfUnit[] };
  contracts: { incomeTiyin: string; spendTiyin: string; balanceTiyin: string; units: SarfUnit[] };
  unassigned: SarfUnit | null;
}

export interface SarfUnitDetail extends SarfUnit {
  months: string[];
  employees: { pinfl: string | null; fullName: string; inTarkib: boolean; inVedomost: boolean; paidTiyin: string; coveredTiyin: string; months: Record<string, { paid: string; covered: string }> }[];
}

export const sarfApi = {
  sarf: (from: string, to: string) => api.get<ApiResponse<Sarf>>('/qomita/3802/nazorat/sarf', { params: { from, to } }),
  unit: (unit: string, from: string, to: string) => api.get<ApiResponse<SarfUnitDetail>>(`/qomita/3802/nazorat/sarf/${encodeURIComponent(unit)}`, { params: { from, to } }),
  approveIncome: (id: string, ok: boolean) => api.post<ApiResponse<{ approved: boolean }>>(`/qomita/income/${encodeURIComponent(id)}/approve`, { ok }),
};
