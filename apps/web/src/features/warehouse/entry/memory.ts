import type { DocKind } from '../api';
import type { TargetValue } from '../target-picker';

// ═══════════════════════════════════════════════════════════
// Brauzerda eslab qolinadiganlar (shu kompyuterda):
//  • qoralama — har hujjat turi uchun alohida; brauzer yopilib qolsa ham yo'qolmaydi
//  • odatiy qiymatlar — mas'ul shaxs, to'lov usuli, komissiya a'zolari
//  • oxirgi oluvchilar — chiqim/qaytarishda bir bosishda tanlash
// Hammasi try/catch ichida: saqlab bo'lmasa ham forma ishlayveradi.
// ═══════════════════════════════════════════════════════════

const DRAFT = (kind: DocKind) => `korxona_wh_draft_${kind}`;
const PREFS = 'korxona_wh_prefs';
const RECENT = 'korxona_wh_recent_targets';

export interface LineDraft {
  key: number;
  itemId: string;
  /** Excel'dan qo'yilgan, ro'yxatda topilmagan nom — qidiruvda tayyor turadi */
  search?: string;
  qty: string;
  /** Kirim narxi, so'm */
  price: number | null;
  /** Asosiy vosita kirimida seriya raqamlari */
  serials: string;
}

export interface FormDraft {
  date: string;
  counterparty: string;
  documentNo: string;
  paymentMethod: string;
  issuedBy: string;
  responsible: string;
  reason: string;
  note: string;
  /** Hisobdan chiqarishda komissiya a'zolari */
  commission: string;
  target: TargetValue;
  lines: LineDraft[];
  assetIds: string[];
  /** Vosita holati (dalolatnomada): assetId → matn */
  conditions?: Record<string, string>;
}

export interface StoredDraft {
  savedAt: string;
  form: FormDraft;
}

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // saqlab bo'lmasa — shunchaki eslab qolinmaydi
  }
}

/** Qoralamada foydali narsa bormi (bo'sh formani saqlamaymiz) */
export function draftHasContent(f: FormDraft): boolean {
  return f.lines.some((l) => l.itemId || l.search) || f.assetIds.length > 0 || Boolean(f.counterparty || f.reason || f.target.holderName || f.target.departmentId);
}

export const drafts = {
  load: (kind: DocKind) => read<StoredDraft>(DRAFT(kind)),
  save: (kind: DocKind, form: FormDraft) => write(DRAFT(kind), draftHasContent(form) ? { savedAt: new Date().toISOString(), form } : null),
  clear: (kind: DocKind) => write(DRAFT(kind), null),
  /** Ish stoli uchun: qaysi turda tugatilmagan hujjat bor */
  list: (kinds: DocKind[]) =>
    kinds
      .map((kind) => ({ kind, draft: read<StoredDraft>(DRAFT(kind)) }))
      .filter((x): x is { kind: DocKind; draft: StoredDraft } => Boolean(x.draft))
      .map(({ kind, draft }) => ({
        kind,
        savedAt: draft.savedAt,
        lines: draft.form.lines.filter((l) => l.itemId || l.search).length + draft.form.assetIds.length,
      })),
};

export interface Prefs {
  responsible?: string;
  paymentMethod?: string;
  commission?: string;
}

export const prefs = {
  get: (): Prefs => read<Prefs>(PREFS) ?? {},
  set: (patch: Prefs) => write(PREFS, { ...(read<Prefs>(PREFS) ?? {}), ...patch }),
};

export interface RecentTarget {
  label: string;
  value: TargetValue;
}

export const recentTargets = {
  get: (): RecentTarget[] => read<RecentTarget[]>(RECENT) ?? [],
  push: (label: string, value: TargetValue) => {
    const list = (read<RecentTarget[]>(RECENT) ?? []).filter((r) => r.label !== label);
    write(RECENT, [{ label, value }, ...list].slice(0, 8));
  },
};