import { api, getToken, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Munosabat va Nazorat — backend bilan bir xil turlar
// ═══════════════════════════════════════════════════════════

export type ItemKind = 'INCOME' | 'EXPENSE' | 'RESULT';

export interface ItemFilter {
  unit?: string;
  departmentId?: string;
  categoryCode?: string;
  rootCategoryCode?: string;
  source?: 'MANUAL' | 'IMPORT' | 'PAYROLL' | 'LEASE' | 'VEHICLE';
  section?: 'DOIMIY' | 'BOSHQA';
  vehicleId?: string;
}

/** Belgilanadigan modda */
export interface MarkItem {
  kind: ItemKind;
  label: string;
  filter: ItemFilter;
  /** Qayerda belgilangan: "Solishtirma", "Xarajat tarkibi" ... */
  origin?: string;
}

export type Verdict = 'better' | 'same' | 'worse' | 'nodata';

export interface WindowStats {
  from: string;
  to: string;
  days: number;
  sumTiyin: string;
  perDayTiyin: string;
}

export interface TopRecord {
  id: string;
  date: string;
  kind: 'INCOME' | 'EXPENSE';
  label: string;
  place: string;
  amountTiyin: string;
}

export interface ItemEvaluation {
  id: string;
  kind: ItemKind;
  label: string;
  filter: ItemFilter;
  origin: string | null;
  base: WindowStats;
  track: WindowStats;
  expectedTiyin: string;
  effectTiyin: string;
  changePercent: number | null;
  verdict: Verdict;
  verdictText: string;
  months: string[];
  monthly: string[];
  topRecords: TopRecord[];
  notes: string[];
}

export interface AssigneeView {
  pinfl: string;
  fullName: string;
  position: string | null;
  role: string;
}

export interface ReactionSummary {
  id: string;
  title: string;
  note: string | null;
  status: 'OPEN' | 'CLOSED' | 'CONTROL';
  startDate: string;
  dueDate: string;
  baseFrom: string;
  baseTo: string;
  createdAt: string;
  closedAt: string | null;
  daysTotal: number;
  daysPassed: number;
  daysLeft: number;
  overdue: boolean;
  itemCount: number;
  assignees: AssigneeView[];
  better: number;
  worse: number;
  same: number;
  gainTiyin: string;
  controlCount: number;
}

export interface ReactionDetail extends ReactionSummary {
  items: ItemEvaluation[];
  conclusions: string[];
}

export interface ControlMonth {
  period: string;
  valueTiyin: string;
  projectedTiyin: string | null;
  breached: boolean;
  partial: boolean;
}

/** Nazorat moddasi prognozi (Katta modellar) */
export interface ControlOutlook {
  model: string;
  reliability: 'high' | 'medium' | 'low' | 'none';
  reliabilityText: string;
  wape: number | null;
  historyMonths: number;
  /** Joriy oydan keyingi 3 oy */
  months: { period: string; meanTiyin: string; lo80Tiyin: string; hi80Tiyin: string; breachProbability: number }[];
  text: string;
}

export interface ControlView {
  id: string;
  reactionId: string | null;
  reactionTitle: string | null;
  title: string;
  kind: ItemKind;
  label: string;
  filter: ItemFilter;
  limitTiyin: string;
  startPeriod: string;
  note: string | null;
  isActive: boolean;
  assignees: AssigneeView[];
  createdAt: string;
  months: ControlMonth[];
  current: ControlMonth | null;
  usagePercent: number | null;
  breaches: number;
  checkedMonths: number;
  suggestedTiyin: string;
  /** Prognoz asosidagi taklif: keyingi 3 oy o'rtachasi */
  forecastSuggestedTiyin: string | null;
  outlook: ControlOutlook | null;
  status: 'ok' | 'risk' | 'breach' | 'nodata';
  statusText: string;
}

export interface EmployeeOption {
  pinfl: string;
  fullName: string;
  position: string | null;
  place: string;
}

export interface Option {
  value: string;
  label: string;
}

export interface ReactionLookups {
  units: Option[];
  departments: Option[];
  expenseGroups: Option[];
  expenseCategories: (Option & { parent: string | null })[];
  incomeCategories: Option[];
  vehicles: (Option & { unit: string })[];
}

export interface CreateReactionPayload {
  title: string;
  note?: string;
  startDate?: string;
  dueDate: string;
  items: MarkItem[];
  assignees?: { pinfl: string; role?: string }[];
}

export interface UpdateReactionPayload {
  title?: string;
  note?: string | null;
  dueDate?: string;
  status?: 'OPEN' | 'CLOSED';
  assignees?: { pinfl: string; role?: string }[];
  addItems?: MarkItem[];
  removeItemIds?: string[];
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

export const reactionsApi = {
  list: (status?: 'OPEN' | 'CLOSED' | 'CONTROL') => api.get<ApiResponse<ReactionSummary[]>>('/reactions', { params: { status } }),
  detail: (id: string) => api.get<ApiResponse<ReactionDetail>>(`/reactions/${id}`),
  create: (payload: CreateReactionPayload) => api.post<ApiResponse<ReactionDetail>>('/reactions', payload),
  update: (id: string, payload: UpdateReactionPayload) => api.patch<ApiResponse<ReactionDetail>>(`/reactions/${id}`, payload),
  remove: (id: string) => api.delete<void>(`/reactions/${id}`),
  employees: (search: string) => api.get<ApiResponse<EmployeeOption[]>>('/reactions/employees', { params: { search } }),
  lookups: () => api.get<ApiResponse<ReactionLookups>>('/reactions/lookups'),
  controlPreview: (id: string) =>
    api.get<ApiResponse<{ itemId: string; kind: ItemKind; label: string; suggestedTiyin: string }[]>>(`/reactions/${id}/control-preview`),
  toControl: (id: string, payload: { limits?: Record<string, number>; note?: string }) =>
    api.post<ApiResponse<ControlView[]>>(`/reactions/${id}/control`, payload),
};

export const controlsApi = {
  list: () => api.get<ApiResponse<ControlView[]>>('/controls'),
  one: (id: string) => api.get<ApiResponse<ControlView>>(`/controls/${id}`),
  create: (payload: { title: string; kind: ItemKind; label: string; filter: ItemFilter; limitSom?: number; note?: string; assignees?: { pinfl: string }[] }) =>
    api.post<ApiResponse<ControlView>>('/controls', payload),
  update: (id: string, payload: { title?: string; limitSom?: number; note?: string | null; isActive?: boolean; assignees?: { pinfl: string }[] }) =>
    api.patch<ApiResponse<ControlView>>(`/controls/${id}`, payload),
  remove: (id: string) => api.delete<void>(`/controls/${id}`),
};

/** Excel hisobot yoki slaydlarni yuklab olish */
export async function downloadReactionFile(id: string, kind: 'report' | 'slides'): Promise<void> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
  const token = getToken();
  const response = await fetch(`${base}/reactions/${id}/${kind}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error(kind === 'report' ? 'Hisobot tayyorlanmadi' : 'Slaydlar tayyorlanmadi');
  const disposition = response.headers.get('Content-Disposition') ?? '';
  const match = /filename\*=UTF-8''([^;]+)/.exec(disposition) ?? /filename="([^"]+)"/.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]!) : kind === 'report' ? 'munosabat.xlsx' : 'munosabat.pptx';
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ═══════════════════════════════════════════════════════════
// Yorliqlar
// ═══════════════════════════════════════════════════════════

export const KIND_LABEL: Record<ItemKind, string> = {
  INCOME: 'Daromad',
  EXPENSE: 'Xarajat',
  RESULT: 'Natija',
};

/** Modda kaliti — bir xil moddani ikki marta qo'shmaslik uchun */
export function markKey(item: Pick<MarkItem, 'kind' | 'filter'>): string {
  const f = item.filter;
  const keys = Object.keys(f).sort() as (keyof ItemFilter)[];
  return `${item.kind}|${keys.map((k) => `${k}=${f[k] ?? ''}`).join('&')}`;
}