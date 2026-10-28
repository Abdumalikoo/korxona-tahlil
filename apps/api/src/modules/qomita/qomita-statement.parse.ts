// ═══════════════════════════════════════════════════════════
// Qo'mita mablag'lari › Bank ko'chirmasi: kirim qatorini «tushunish» (sun'iy intellektsiz, qoidalar bilan).
//
// Har kirim uchun: nima ekani (bo'lim ajratmasi / depozit / qarz qaytishi), qaysi bo'lim uchun va qaysi oy uchun.
// Ishonch tartibi (birinchi topilgani):
//  1) Izoh ustuni — foydalanuvchi faylga qo'lda yozgan («Marksheyder oylik», «3802 Call Markaz», «Depozit»);
//  2) Xotira — avval shu shartnoma / majburiyat raqami qayerga yozilgan bo'lsa;
//  3) To'lov maqsadi — kalit so'zlar («маркшейдер», «Call-марказ», «депозит», «qarz … qaytarilmoqda»).
// Oy: izohdagi oy nomi («sentabr oyi uchun») → hisob-faktura sanasi → to'lov sanasi.
// ═══════════════════════════════════════════════════════════

/** Qo'mitadan kelgan to'lov belgisi (to'lovchi nomi yoki maqsadida) */
export const QOMITA_PAYER_RE = /комитет|qo['ʻ‘’`]?mita|qumita|komitet|kumita|қўмита|кумита/i;

export type StatementTarget = `dep:${string}` | 'DEPOSIT' | 'LOAN' | 'SKIP';
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface StatementDept {
  id: string;
  name: string;
}

export interface Interpretation {
  /** Taklif: qayerga yoziladi */
  target: StatementTarget;
  /** Qaysi oy uchun (YYYY-MM) */
  period: string;
  /** Nega shunday (foydalanuvchiga ko'rsatiladi) */
  reasons: string[];
  periodReason: string;
  confidence: Confidence;
  /** Xotira kaliti: shartnoma / majburiyat raqami (keyingi safar shu tanlov) */
  signature: string | null;
}

const lower = (s: string) =>
  s
    .toLowerCase()
    .replace(/[ʻ‘’`']/g, '')
    .replace(/ё/g, 'е')
    .replace(/қ/g, 'к')
    .replace(/ҳ/g, 'х')
    .replace(/ғ/g, 'г')
    .replace(/ў/g, 'у');

/** Kirill → lotin (bo'lim nomi bilan solishtirish uchun) */
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
export const latin = (s: string) => lower(s).replace(/[а-я]/g, (c) => CYR[c] ?? c);
const words = (s: string) => latin(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

/** Bo'limning taniladigan kalit so'zlari (nomidagi so'zlar + ma'lum sinonimlar) */
const SYNONYMS: { test: RegExp; keys: RegExp }[] = [
  { test: /marksh/, keys: /marksh|маркшейд|маркшеид/i },
  { test: /call|koll|kol markaz/, keys: /call|колл?[\s-]*(марказ|центр)|kol+[\s-]*markaz|колл?-?центр/i },
  { test: /tax\s*free|taxfree/, keys: /tax\s*-?\s*free|такс\s*фри|tax\s*fri/i },
  { test: /fermer/, keys: /fermer|фермер/i },
];
const GENERIC = new Set(['bolimi', 'bolim', 'markaz', 'markazi', 'xizmati', 'xizmat', 'boshqarma', 'boshqarmasi', 'sektor', 'sektori', 'va', 'uchun']);

export function deptMatch(text: string, deps: StatementDept[]): StatementDept | null {
  if (!text.trim()) return null;
  const t = latin(text);
  const tw = words(text);
  let best: { d: StatementDept; score: number } | null = null;
  for (const d of deps) {
    const n = latin(d.name);
    let score = 0;
    for (const s of SYNONYMS) if (s.test.test(n) && (s.keys.test(text) || s.keys.test(t))) score += 3;
    // Nomdagi muhim so'zlar (kamida 4 harf): bosh qismi mos kelsa
    for (const w of words(d.name).filter((x) => x.length >= 4 && !GENERIC.has(x))) if (tw.some((x) => x.startsWith(w.slice(0, Math.max(4, w.length - 2))) || w.startsWith(x.slice(0, Math.max(4, x.length - 1))))) score += 2;
    // «Call markaz» kabi qisqa nom — to'liq ibora sifatida
    if (n.length >= 4 && t.includes(n)) score += 2;
    if (score && (!best || score > best.score)) best = { d, score };
  }
  return best && best.score >= 2 ? best.d : null;
}

const DEPOSIT_RE = /depozit|депозит|deposit/i;
const LOAN_RE = /qarz|карз|заем|заём|займ|ссуд|возврат\s+(заем|займ|ссуд)|qaytarilmoqda|кайтарилмокда|кайтариш/i;

/** Shartnoma / majburiyat raqami — xotira kaliti */
export function signatureOf(purpose: string): string | null {
  const p = lower(purpose);
  const c = p.match(/(\d{1,4}(?:\/\d{1,4})?)\s*-?\s*(?:сон|son|sonli|сонли)\s*(?:шартнома|shartnoma)/);
  if (c) return `shartnoma:${c[1]}`;
  const m = p.match(/(\d{1,4}(?:\/\d{1,4})?)\s*-?\s*(?:сон|son|sonli|сонли)\s*(?:юридик|yuridik)\s*(?:мажбурият|majburiyat)/);
  if (m) return `majburiyat:${m[1]}`;
  const q = p.match(/(\d{1,4})\s*-?\s*(?:sonli|сонли|сон|son)\s*(?:qarz|карз)/);
  if (q) return `qarz:${q[1]}`;
  return null;
}

// ─────────── Oy ───────────

const MONTH_STEMS: [number, RegExp][] = [
  [1, /^(yanvar|январ)/],
  [2, /^(fevral|феврал)/],
  [3, /^(mart|март)/],
  [4, /^(aprel|апрел)/],
  [5, /^(may|май|мая|мае)/],
  [6, /^(iyun|июн)/],
  [7, /^(iyul|июл)/],
  [8, /^(avgust|август)/],
  [9, /^(sentabr|sentyabr|сентябр|сентабр)/],
  [10, /^(oktabr|oktyabr|октябр|октабр)/],
  [11, /^(noyabr|ноябр)/],
  [12, /^(dekabr|декабр)/],
];
const pad = (n: number) => String(n).padStart(2, '0');

/** «sentabr oyi uchun», «за сентябрь», «август ойи иш хаки» → oy; yil — to'lov yili (keyingi oy bo'lsa — o'tgan yil) */
export function monthFromText(text: string, docDate: string): string | null {
  const toks = lower(text).split(/[^a-zа-я0-9]+/).filter(Boolean);
  for (let i = 0; i < toks.length; i++) {
    const hit = MONTH_STEMS.find(([, re]) => re.test(toks[i]!));
    if (!hit) continue;
    const next = toks[i + 1] ?? '';
    const prev = toks[i - 1] ?? '';
    // Oy nomi yonida «oyi / ойи / учун / uchun / за / yil» yoki yil soni bo'lsa — davr; aks holda (masalan, «21-майдаги қарор») — sana
    const isPeriod = /^(oyi|ойи|oy|ой|uchun|учун|месяц)/.test(next) || /^(за|uchun|учун)$/.test(prev) || /^\d{4}$/.test(next);
    if (!isPeriod) continue;
    const y = /^\d{4}$/.test(next) ? Number(next) : Number(docDate.slice(0, 4));
    const m = hit[0];
    const docM = Number(docDate.slice(5, 7));
    const year = /^\d{4}$/.test(next) ? y : m > docM ? y - 1 : y;
    return `${year}-${pad(m)}`;
  }
  return null;
}

/** «11.09.2026 й 2026/2-1-сон хисоб-фактурага» → 2026-09 (hisob-faktura sanasi) */
export function invoiceMonth(text: string): string | null {
  const p = lower(text);
  const re = /(\d{2})\.(\d{2})\.(\d{4})\s*(?:й\.?|йил\S*|yil\S*|y\.)?\s*(?:даги|dagi)?\s*[\d/-]*\s*-?\s*(?:сон|son|sonli|сонли)?\s*(?:хисоб|hisob|счет|счёт)[\s-]*(?:фактур|faktur)/g;
  let last: RegExpExecArray | null = null;
  for (let m = re.exec(p); m; m = re.exec(p)) last = m;
  if (!last) return null;
  const month = Number(last[2]);
  if (month < 1 || month > 12) return null;
  return `${last[3]}-${last[2]}`;
}

/** Bank maqsadi «12345~67890~To'lovchi~matn» — faqat matn qismi */
export function cleanPurpose(raw: string, payer = ''): string {
  const parts = String(raw ?? '')
    .split('~')
    .map((s) => s.trim())
    .filter(Boolean);
  const keep = parts.filter((s) => !/^\d[\d\s]*$/.test(s) && !(payer && lower(s) === lower(payer)));
  return (keep.length ? keep : parts).join(' · ').replace(/\s+/g, ' ').trim();
}

export function interpret(
  row: { docDate: string; purpose: string; comment: string; payer: string },
  deps: StatementDept[],
  memory: Record<string, StatementTarget>,
): Interpretation {
  const reasons: string[] = [];
  const signature = signatureOf(row.purpose);
  let target: StatementTarget | null = null;
  let confidence: Confidence = 'LOW';
  const comment = row.comment.trim();
  const depOk = (t: StatementTarget) => !t.startsWith('dep:') || deps.some((d) => `dep:${d.id}` === t);

  // 1) Foydalanuvchi izohi
  if (comment) {
    if (DEPOSIT_RE.test(comment)) target = 'DEPOSIT';
    else if (LOAN_RE.test(comment)) target = 'LOAN';
    else {
      const d = deptMatch(comment, deps);
      if (d) target = `dep:${d.id}`;
    }
    if (target) {
      confidence = 'HIGH';
      reasons.push(`izoh: «${comment.slice(0, 60)}»`);
    }
  }
  // 2) Xotira
  if (!target && signature && memory[signature] && depOk(memory[signature]!)) {
    target = memory[signature]!;
    confidence = 'HIGH';
    reasons.push(`avvalgi tanlov (${signature.replace(':', ' № ')})`);
  }
  // 3) To'lov maqsadi
  if (!target) {
    const p = row.purpose;
    if (DEPOSIT_RE.test(p)) target = 'DEPOSIT';
    else if (LOAN_RE.test(p)) target = 'LOAN';
    else {
      const d = deptMatch(p, deps);
      if (d) target = `dep:${d.id}`;
    }
    if (target) {
      confidence = 'MEDIUM';
      reasons.push("to'lov maqsadidagi so'zlar");
    }
  }
  if (!target) {
    target = 'SKIP';
    reasons.push('aniqlanmadi — tanlang');
  }

  // Oy
  let period = monthFromText(`${comment} ${row.purpose}`, row.docDate);
  let periodReason = 'izohdagi oy';
  if (!period) {
    period = invoiceMonth(row.purpose);
    periodReason = 'hisob-faktura sanasi';
  }
  if (!period) {
    period = row.docDate.slice(0, 7);
    periodReason = "to'lov sanasi";
  }
  return { target, period, reasons, periodReason, confidence, signature };
}
