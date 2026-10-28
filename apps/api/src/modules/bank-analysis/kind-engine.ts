import { BANK_KIND_LABEL, type BankDir, type BankKind } from './bank-analysis.rules';

// ═══════════════════════════════════════════════════════════
// To'lov turi — yagona yadro (bank ko'chirmasi, schyot-faktura, kontragentlar, hisobot — bir xil natija).
// Tartib (aniqrog'i oldin), har biri — tur, manba va sababi bilan:
//  1. MANUAL       — guruhga siz bergan tur (guruh darajasida, groups() da);
//  2. RULE         — matn qoidasi: «izohda X bo'lsa → Y» (uzunroq matn oldin);
//  3. COUNTERPARTY — kontragent xotirasi: shu INN guruhlariga siz bergan turlar bir xil bo'lsa — yangi guruhlariga ham;
//  4. IKPU / KEYWORD — faktura IKPU kodi yoki izoh / oluvchi nomidagi so'z (avvalgi qoidalar);
//  5. ACCOUNT      — oluvchi hisobi budjet (g'aznachilik, 23402…) va izohdan hech narsa topilmagan — soliq;
//  6. DEFAULT      — kirim, sukut bo'yicha «xizmat tushumi»; NONE — aniqlanmadi («Boshqa», ko'rib chiqing).
// Saqlash: settings «bank.kind.rules» (bank va faktura uchun bitta) — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

export const KIND_RULES_KEY = 'bank.kind.rules';
/** Faktura tahlili ombori (bank servisi faktura servisini import qila olmaydi — aylanma bog'liqlik) */
export const INVOICE_STORE_KEY = 'invoice.analysis.store';
export const MAX_KIND_RULES = 300;

export type KindSource = 'MANUAL' | 'RULE' | 'COUNTERPARTY' | 'IKPU' | 'KEYWORD' | 'ACCOUNT' | 'DEFAULT' | 'NONE';

export interface KindVerdict {
  kind: BankKind;
  source: KindSource;
  /** Nega shu tur (foydalanuvchiga ko'rsatiladi) */
  reason: string;
}

export interface KindRule {
  id: string;
  /** Foydalanuvchi yozgan matn (asl ko'rinishda) */
  text: string;
  kind: BankKind;
  /** Faqat chiqim yoki faqat kirim (null — ikkalasi) */
  dir: BankDir | null;
  createdAt: string;
  createdBy: string;
}

export function readKindRules(raw: unknown): KindRule[] {
  const v = (raw ?? {}) as { rules?: unknown };
  if (!Array.isArray(v.rules)) return [];
  return (v.rules as KindRule[]).filter((r) => Boolean(r && typeof r.id === 'string' && typeof r.text === 'string' && r.kind in BANK_KIND_LABEL && (r.dir === null || r.dir === 'OUT' || r.dir === 'IN')));
}

/** Solishtirish uchun matn: kichik harf, ё → е, apostrofsiz, harf va raqamdan boshqasi — bitta probel */
export function normText(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[ʻʼ‘’`']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export type PreparedRule = KindRule & { norm: string };

/** Qoidalar — uzunroq (aniqroq) matn oldin; 3 harfdan qisqasi olinmaydi */
export function prepareRules(rules: KindRule[]): PreparedRule[] {
  return rules
    .map((r) => ({ ...r, norm: normText(r.text) }))
    .filter((r) => r.norm.length >= 3)
    .sort((a, b) => b.norm.length - a.norm.length);
}

/** Kontragent xotirasi: «DIR|INN» → (guruh kaliti → siz bergan tur) */
export type CounterpartyMemory = Map<string, Map<string, BankKind>>;

/**
 * Kontragent xotirasi: guruh kaliti «DIR|inn:XXXXXXXXX|…» bo'yicha siz bergan turlar. Jismoniy shaxslar (person) — yo'q.
 * Qo'llanishi — rememberedKind: shu INN va yo'nalishdagi BOSHQA guruhlarga bergan turlaringiz bir xil bo'lsa.
 */
export function counterpartyMemory(metas: Record<string, { kind?: BankKind | null }>[]): CounterpartyMemory {
  const out: CounterpartyMemory = new Map();
  for (const meta of metas)
    for (const [key, m] of Object.entries(meta)) {
      if (!m?.kind || !(m.kind in BANK_KIND_LABEL)) continue;
      const x = /^(OUT|IN)\|inn:(\d{9})\|/.exec(key);
      if (!x) continue;
      const k = `${x[1]}|${x[2]}`;
      const g = out.get(k) ?? new Map<string, BankKind>();
      g.set(key, m.kind);
      out.set(k, g);
    }
  return out;
}

/**
 * Xotiradagi tur: guruhning o'zi (selfKey) hisobga olinmaydi — aks holda guruhga bergan turingiz o'sha guruhning
 * «avtomatik» turi bo'lib qaytardi. Turlar har xil bo'lsa — noaniq (undefined).
 */
export function rememberedKind(memory: CounterpartyMemory, dir: BankDir, inn: string, selfKey?: string): BankKind | undefined {
  const g = memory.get(`${dir}|${inn}`);
  if (!g) return undefined;
  const kinds = new Set<BankKind>();
  for (const [key, kind] of g) if (key !== selfKey) kinds.add(kind);
  return kinds.size === 1 ? [...kinds][0] : undefined;
}

/** Budjet (g'aznachilik) hisobi: balans hisobi kodi 23402 */
export const isBudgetAccount = (code: string | undefined) => code === '23402';

/** Oluvchi hisob raqamidan faqat balans hisobi kodi (birinchi 5 raqam) — to'liq raqam saqlanmaydi */
export function accountCode(account: string): string | undefined {
  const d = String(account ?? '').replace(/\D/g, '');
  return d.length === 20 ? d.slice(0, 5) : undefined;
}

export interface KindContext {
  rules: PreparedRule[];
  memory: CounterpartyMemory;
}

/**
 * Bitta qator turi (qo'lda berilgan guruh turidan tashqari).
 * base — manbaga xos avtomatik tur: bank — kalit so'zlar, faktura — IKPU va kalit so'zlar.
 */
export function rowVerdict(r: { dir: BankDir; inn: string; purpose: string; accountCode?: string }, ctx: KindContext, base: () => KindVerdict, selfKey?: string): KindVerdict {
  if (ctx.rules.length) {
    const t = normText(r.purpose);
    const hit = ctx.rules.find((x) => (!x.dir || x.dir === r.dir) && t.includes(x.norm));
    if (hit) return { kind: hit.kind, source: 'RULE', reason: `Qoida: «${hit.text}» → ${BANK_KIND_LABEL[hit.kind]}` };
  }
  const inn = String(r.inn ?? '').replace(/\D/g, '');
  const remembered = inn.length === 9 ? rememberedKind(ctx.memory, r.dir, inn, selfKey) : undefined;
  if (remembered) return { kind: remembered, source: 'COUNTERPARTY', reason: `Shu kontragent (INN ${inn}) to‘lovlarini «${BANK_KIND_LABEL[remembered]}» deb belgilagansiz` };
  const b = base();
  if (b.source === 'NONE' && r.dir === 'OUT' && isBudgetAccount(r.accountCode)) return { kind: 'SOLIQ', source: 'ACCOUNT', reason: 'Oluvchi hisobi — budjet (g‘aznachilik, 23402…), izohdan tur aniqlanmadi' };
  return b;
}

/**
 * Guruh turi — hamma qatorlardan, summa bo'yicha ko'pchilik (avval — faqat oxirgi to'lov).
 * mixed — boshqa tur ham summaning kamida 5 foizi.
 */
export function groupVerdict<R extends { amountTiyin: string }>(rows: R[], verdictOf: (r: R) => KindVerdict): KindVerdict & { mixed: boolean } {
  const by = new Map<BankKind, { total: bigint; best: { amount: bigint; v: KindVerdict } }>();
  let all = 0n;
  for (const r of rows) {
    const v = verdictOf(r);
    let amount = 0n;
    try {
      amount = BigInt(r.amountTiyin);
    } catch {
      amount = 0n;
    }
    all += amount;
    const x = by.get(v.kind) ?? { total: 0n, best: { amount: -1n, v } };
    x.total += amount;
    if (amount > x.best.amount) x.best = { amount, v };
    by.set(v.kind, x);
  }
  const ranked = [...by.values()].sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));
  const top = ranked[0];
  if (!top) return { kind: 'BOSHQA', source: 'NONE', reason: 'To‘lov yo‘q', mixed: false };
  const mixed = ranked.slice(1).some((x) => all > 0n && x.total * 20n >= all);
  return { ...top.best.v, mixed };
}
