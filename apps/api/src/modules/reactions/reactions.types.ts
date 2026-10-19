// ═══════════════════════════════════════════════════════════
// Munosabat va Nazorat — turlar
// ═══════════════════════════════════════════════════════════

/** INCOME — daromad, EXPENSE — xarajat, RESULT — natija (daromad − xarajat) */
export type ItemKind = 'INCOME' | 'EXPENSE' | 'RESULT';

/**
 * Belgilangan modda filtri. Hamma maydon ixtiyoriy — berilganlari "VA" bilan birlashadi.
 *  unit: "r:3" — hudud, "center" — Markaz (hudud 0 yoki markaz bo'limi), "none" — hududga biriktirilmagan
 */
export interface ItemFilter {
  unit?: string;
  departmentId?: string;
  categoryCode?: string;
  /** Ota kategoriya: o'zi va barcha bolalari */
  rootCategoryCode?: string;
  source?: 'MANUAL' | 'IMPORT' | 'PAYROLL' | 'LEASE' | 'VEHICLE';
  section?: 'DOIMIY' | 'BOSHQA';
  vehicleId?: string;
  /** Tuman ("3-1"): daromad — tumanga yozilgan tushum; xarajat — tuman xodimlari ish haqi, ijarasi va tumanga yozilgan xarajatlar */
  districtId?: string;
  /** Xodim (PINFL): xarajat — uning ish haqi; daromad — Natijalar faylidagi fakti */
  employeePinfl?: string;
  /** Kontragent (xarajat) */
  counterparty?: string;
  /** Mijoz (daromad) */
  clientName?: string;
  /** Ijara shartnomasi */
  leaseId?: string;
  /** Bitta yozuv (daromad yoki xarajat id si) */
  recordId?: string;
}

export interface ItemInput {
  kind: ItemKind;
  label: string;
  filter: ItemFilter;
  origin?: string;
}

export interface AssigneeInput {
  pinfl: string;
  role?: string;
}

export interface CreateReactionInput {
  title: string;
  note?: string;
  /** Kuzatuv boshlanishi, YYYY-MM-DD (bo'lmasa — bugun) */
  startDate?: string;
  /** Muddat, YYYY-MM-DD */
  dueDate: string;
  items: ItemInput[];
  assignees?: AssigneeInput[];
}

export interface UpdateReactionInput {
  title?: string;
  note?: string | null;
  dueDate?: string;
  status?: 'OPEN' | 'CLOSED';
  assignees?: AssigneeInput[];
  addItems?: ItemInput[];
  removeItemIds?: string[];
}

export interface ToControlInput {
  /** Har modda uchun oylik chegara (so'mda). Berilmasa — tizim taklifi (so'nggi 3 oy o'rtachasi) */
  limits?: Record<string, number>;
  note?: string;
}

export interface CreateControlInput {
  title: string;
  kind: ItemKind;
  label: string;
  filter: ItemFilter;
  /** Oylik chegara, so'mda */
  limitSom: number;
  note?: string;
  assignees?: AssigneeInput[];
}

export interface UpdateControlInput {
  title?: string;
  limitSom?: number;
  note?: string | null;
  isActive?: boolean;
  assignees?: AssigneeInput[];
}

// ─────────── Natijalar ───────────

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
  /** Baza sur'ati bilan hozirgacha kutilgan summa */
  expectedTiyin: string;
  /** Haqiqiy − kutilgan (xarajat uchun manfiy — yaxshi) */
  effectTiyin: string;
  /** Kunlik sur'at o'zgarishi, % */
  changePercent: number | null;
  verdict: Verdict;
  verdictText: string;
  months: string[];
  /** 24 oylik qiymatlar (months tartibida) */
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
  /** Qisqa holat: nechta modda yaxshilandi / yomonlashdi */
  better: number;
  worse: number;
  same: number;
  /** Jami ta'sir: xarajat tejalgan + daromad oshgan (musbat — yaxshi) */
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
  /** Joriy oy uchun: oy oxirigacha taxmin */
  projectedTiyin: string | null;
  breached: boolean;
  partial: boolean;
}

/** Nazorat moddasi prognozi (Katta modellar yadrosi) */
export interface ControlOutlook {
  model: string;
  reliability: 'high' | 'medium' | 'low' | 'none';
  reliabilityText: string;
  /** Sinovdagi o'rtacha nisbiy xato (0..1) */
  wape: number | null;
  /** Model o'rgangan oylar soni */
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
  /** Joriy oy holati */
  current: ControlMonth | null;
  /** Limitdan foydalanish, % (joriy oy taxmini bo'yicha) */
  usagePercent: number | null;
  /** Nazorat boshlanganidan beri buzilgan oylar */
  breaches: number;
  checkedMonths: number;
  /** Tizim taklif qilgan chegara: so'nggi 3 to'liq oy o'rtachasi */
  suggestedTiyin: string;
  /** Prognoz asosidagi taklif: keyingi 3 oy o'rtachasi */
  forecastSuggestedTiyin: string | null;
  outlook: ControlOutlook | null;
  status: 'ok' | 'risk' | 'breach' | 'nodata';
  statusText: string;
}