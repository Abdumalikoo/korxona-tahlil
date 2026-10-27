import { legacyPurposeKind, toLatin, type PayoutKind } from './acc23106.purpose';

// ═══════════════════════════════════════════════════════════
// 23106 — to'lov turini (nima uchun) foydalanuvchi o'zgartirishi:
//  • QOIDA: «izohida shu matn bo'lsa — shu guruh» (keyingi yuklashlarda ham avtomatik);
//  • QO'LDA: aniq to'lov(lar) uchun guruh (sana + hujjat № + summa + ИНН bo'yicha — qayta yuklansa ham eslab qolinadi).
// Tartib: qo'lda > qoida (uzunroq matn oldin) > dastur aniqlagani (kalit so'zlar).
// Saqlash joyi: settings «acc23106.rules» — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

export const RULES_KEY = 'acc23106.rules';
export const KINDS: PayoutKind[] = ['BAYRAM', 'MUKOFOT', 'SAFAR', 'MODDIY', 'TATIL', 'KASALLIK', 'ISH_HAQI', 'BOSHQA'];
export const MAX_RULES = 300;
export const MAX_OVERRIDES = 20000;

export type KindSource = 'AUTO' | 'RULE' | 'MANUAL';

export interface KindRule {
  id: string;
  /** Foydalanuvchi yozgan matn (asl ko'rinishda) */
  text: string;
  kind: PayoutKind;
  createdAt: string;
  createdBy: string;
}

export interface KindOverride {
  kind: PayoutKind;
  at: string;
  by: string;
}

export interface RulesStore {
  rules: KindRule[];
  overrides: Record<string, KindOverride>;
}

export function readRules(raw: unknown): RulesStore {
  const v = (raw ?? {}) as Partial<RulesStore>;
  const rules = Array.isArray(v.rules) ? v.rules.filter((r): r is KindRule => Boolean(r && typeof r.id === 'string' && typeof r.text === 'string' && KINDS.includes(r.kind))) : [];
  const overrides: Record<string, KindOverride> = {};
  if (v.overrides && typeof v.overrides === 'object' && !Array.isArray(v.overrides)) {
    for (const [k, o] of Object.entries(v.overrides)) if (o && KINDS.includes((o as KindOverride).kind)) overrides[k] = o as KindOverride;
  }
  return { rules, overrides };
}

/**
 * Solishtirish uchun matn: lotin, kichik harf, raqam va tinish belgilarisiz, bitta probel.
 * Raqamlar olib tashlanadi — buyruq raqami, sana, summa har to'lovda boshqacha bo'ladi.
 */
export function normMatch(text: string): string {
  return toLatin(text ?? '')
    .replace(/[‘’ʻʼ`']/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/ts/g, 's') // «ц» → s: lotin «kompensatsiya» = kirill «компенсация»
    .replace(/\s+/g, ' ')
    .trim();
}

/** Izohning «qolipi» — xodim ismi va raqamlarsiz (bir xil mazmundagi izohlarni guruhlash uchun) */
export function purposePattern(purpose: string): string {
  const head = (purpose ?? '').split(/сотрудник|работник|xodim|ходим/i)[0] ?? '';
  return normMatch(head).slice(0, 160);
}

/** To'lov kaliti (qo'lda belgilash uchun): sana | hujjat № | summa | ИНН */
export function payoutKey(r: { docDate: string; docNo: string; debitTiyin: string; inn: string }): string {
  return `${r.docDate}|${r.docNo}|${r.debitTiyin}|${r.inn}`;
}

/** Qoidalar — uzunroq (aniqroq) matn oldin */
export function sortedRules(store: RulesStore): (KindRule & { norm: string })[] {
  return store.rules
    .map((r) => ({ ...r, norm: normMatch(r.text) }))
    .filter((r) => r.norm.length >= 3)
    .sort((a, b) => b.norm.length - a.norm.length);
}

export function classify(
  r: { purpose: string; docDate: string; docNo: string; debitTiyin: string; inn: string; autoKind?: PayoutKind },
  store: RulesStore,
  rules = sortedRules(store),
): { kind: PayoutKind; source: KindSource; ruleId: string | null } {
  const o = store.overrides[payoutKey(r)];
  if (o) return { kind: o.kind, source: 'MANUAL', ruleId: null };
  if (rules.length) {
    const t = normMatch(r.purpose);
    const hit = rules.find((x) => t.includes(x.norm));
    if (hit) return { kind: hit.kind, source: 'RULE', ruleId: hit.id };
  }
  return { kind: r.autoKind ?? legacyPurposeKind(r.purpose), source: 'AUTO', ruleId: null };
}
