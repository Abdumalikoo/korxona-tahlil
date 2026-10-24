// ═══════════════════════════════════════════════════════════
// Manba chati — savolni tushunish (sun'iy intellektsiz, qoidalar bo'yicha).
//
//  1) Matn bir xil ko'rinishga keltiriladi: kirill → lotin, tutuq belgilari olib tashlanadi, kichik harf
//     («Ўтган ойдаги иш ҳақи» → «otgan oydagi ish haqi»).
//  2) Topiladi: JShShIR yoki xodim F.I.Sh. (qo'shimchalar bilan ham: «Aliyevning»), davr (oy nomlari, yil, chorak,
//     «o'tgan oy», «oxirgi 3 oy», «yanvardan martgacha», «yanvar va fevral» — solishtirish), bo'lim (Markaz, Hududlar,
//     Tax free …), viloyat, Markaz bo'limi, modda (Ijara, Internet …), ko'rsatkich (xarajat, daromad, natija, ish haqi),
//     guruhlash (oylar / moddalar / bo'limlar bo'yicha), «eng ko'p», yozuvlar ro'yxati, xodimlar soni.
//  3) Savolda bo'lmagan narsa oldingi savoldan olinadi (kontekst): «fevraldagi-chi?» — oldingi ko'rsatkich va bo'lim.
// ═══════════════════════════════════════════════════════════

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

/** Kirill → lotin, kichik harf, tutuq belgilarisiz, faqat harf/raqam/bo'shliq */
export function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    // «е» so'z boshida va unlidan keyin — «ye» (Алиев → aliyev)
    .replace(/(^|[^а-яёўқғҳ]|[аеёиоуўэюя])е/g, (_m, pre: string) => `${pre}ye`)
    .replace(/[а-яёўқғҳ]/g, (ch) => CYR[ch] ?? ch)
    .replace(/[ʻʼ‘’'`´]/g, '')
    .replace(/[^a-z0-9\-–.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const tokens = (s: string) => s.split(/[\s.\-–]+/).filter(Boolean);

// ─────────── Davr ───────────

export interface PeriodSpec {
  from: string;
  to: string;
  label: string;
}

const MONTHS: { stems: string[]; n: number; label: string }[] = [
  { stems: ['yanvar'], n: 1, label: 'Yanvar' },
  { stems: ['fevral'], n: 2, label: 'Fevral' },
  { stems: ['mart'], n: 3, label: 'Mart' },
  { stems: ['aprel'], n: 4, label: 'Aprel' },
  { stems: ['may'], n: 5, label: 'May' },
  { stems: ['iyun'], n: 6, label: 'Iyun' },
  { stems: ['iyul'], n: 7, label: 'Iyul' },
  { stems: ['avgust'], n: 8, label: 'Avgust' },
  { stems: ['sentabr', 'sentyabr'], n: 9, label: 'Sentabr' },
  { stems: ['oktabr', 'oktyabr'], n: 10, label: 'Oktabr' },
  { stems: ['noyabr'], n: 11, label: 'Noyabr' },
  { stems: ['dekabr'], n: 12, label: 'Dekabr' },
];
export const MONTH_LABELS = MONTHS.map((m) => m.label);

const pad = (n: number) => String(n).padStart(2, '0');
export const ym = (y: number, m: number) => `${y}-${pad(m)}`;
export function addMonths(p: string, d: number): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + d;
  return ym(Math.floor(t / 12), (t % 12) + 1);
}
export function monthsOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let p = from; p <= to && out.length < 240; p = addMonths(p, 1)) out.push(p);
  return out;
}
export const periodLabel = (p: string) => `${MONTHS[Number(p.slice(5, 7)) - 1]!.label} ${p.slice(0, 4)}`;
export function spanLabel(from: string, to: string): string {
  if (from === to) return periodLabel(from);
  if (from.slice(5) === '01' && to.slice(5) === '12' && from.slice(0, 4) === to.slice(0, 4)) return `${from.slice(0, 4)} yil`;
  return from.slice(0, 4) === to.slice(0, 4) ? `${MONTHS[Number(from.slice(5)) - 1]!.label} – ${periodLabel(to)}` : `${periodLabel(from)} – ${periodLabel(to)}`;
}

function monthAt(token: string): number | null {
  for (const m of MONTHS) {
    for (const s of m.stems) {
      if (s === 'may') {
        if (/^may(da|dagi|dan|ga|ning|ni|oyi|gacha)?$/.test(token)) return m.n;
      } else if (token.startsWith(s) && !(s === 'mart' && token.startsWith('marta'))) return m.n;
    }
  }
  return null;
}

/** Matndagi davr(lar): bitta davr yoki solishtirish uchun ikkitasi */
export function parsePeriod(text: string, now: string): { period: PeriodSpec | null; compare: PeriodSpec | null; used: Set<string> } {
  const t = text;
  const toks = tokens(t);
  const used = new Set<string>();
  const curY = Number(now.slice(0, 4));
  const curM = Number(now.slice(5, 7));
  const years = [...t.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
  years.forEach((y) => used.add(String(y)));
  // YYYY-MM yoki MM.YYYY
  const iso = [...t.matchAll(/\b(20\d{2})-(0[1-9]|1[0-2])\b/g)].map((m) => `${m[1]}-${m[2]}`);
  const dotted = [...t.matchAll(/\b(0?[1-9]|1[0-2])\.(20\d{2})\b/g)].map((m) => `${m[2]}-${pad(Number(m[1]))}`);
  const explicit = [...iso, ...dotted];
  const ms: number[] = [];
  for (const tok of toks) {
    const n = monthAt(tok);
    if (n) {
      ms.push(n);
      used.add(tok);
    }
  }
  const mk = (from: string, to: string): PeriodSpec => ({ from, to, label: spanLabel(from, to) });
  const yearFor = (m: number, i: number) => years[Math.min(i, years.length - 1)] ?? (m > curM ? curY - 1 : curY);
  const rangeWords = /(\bdan\b|gacha|\borasida|\b-\b|–)|[a-z]dan\s+[a-z]+gacha/.test(t);

  if (explicit.length >= 2) {
    const [a, b] = explicit.sort();
    return /taqqos|solishtir|\bva\b|bilan/.test(t) && !rangeWords ? { period: mk(a!, a!), compare: mk(b!, b!), used } : { period: mk(a!, b!), compare: null, used };
  }
  if (explicit.length === 1) return { period: mk(explicit[0]!, explicit[0]!), compare: null, used };

  if (ms.length >= 2) {
    const a = ym(yearFor(ms[0]!, 0), ms[0]!);
    const b = ym(yearFor(ms[1]!, 1), ms[1]!);
    if (rangeWords || /gacha/.test(t)) return { period: mk(a <= b ? a : b, a <= b ? b : a), compare: null, used };
    return { period: mk(a, a), compare: mk(b, b), used };
  }
  if (ms.length === 1) {
    const p = ym(yearFor(ms[0]!, 0), ms[0]!);
    return { period: mk(p, p), compare: null, used };
  }

  const markUsed = (re: RegExp) => {
    const m = t.match(re);
    if (m) tokens(m[0]).forEach((x) => used.add(x));
    return Boolean(m);
  };
  const quarter = t.match(/\b([1-4])\s*-?\s*chorak|\b(birinchi|ikkinchi|uchinchi|tortinchi)\s+chorak/);
  if (quarter) {
    markUsed(/\b([1-4])\s*-?\s*chorak|\b(birinchi|ikkinchi|uchinchi|tortinchi)\s+chorak/);
    const q = quarter[1] ? Number(quarter[1]) : ['birinchi', 'ikkinchi', 'uchinchi', 'tortinchi'].indexOf(quarter[2]!) + 1;
    const y = years[0] ?? (q * 3 - 2 > curM ? curY - 1 : curY);
    return { period: mk(ym(y, q * 3 - 2), ym(y, q * 3)), compare: null, used };
  }
  const half = t.match(/\b(birinchi|ikkinchi|1|2)\s*-?\s*yarim\s*yil/);
  if (half) {
    markUsed(/\b(birinchi|ikkinchi|1|2)\s*-?\s*yarim\s*yil/);
    const h = half[1] === 'ikkinchi' || half[1] === '2' ? 2 : 1;
    const y = years[0] ?? curY;
    return { period: mk(ym(y, h === 1 ? 1 : 7), ym(y, h === 1 ? 6 : 12)), compare: null, used };
  }
  const lastN = t.match(/\b(oxirgi|songgi|otgan)\s+(\d{1,2})\s+oy/);
  if (lastN) {
    markUsed(/\b(oxirgi|songgi|otgan)\s+(\d{1,2})\s+oy\w*/);
    const n = Math.min(60, Math.max(1, Number(lastN[2])));
    return { period: mk(addMonths(now, -(n - 1)), now), compare: null, used };
  }
  if (markUsed(/\b(otgan|oldingi)\s+oy\w*/)) {
    const p = addMonths(now, -1);
    return { period: mk(p, p), compare: null, used };
  }
  if (markUsed(/\b(shu|bu|joriy|hozirgi)\s+oy\w*/)) return { period: mk(now, now), compare: null, used };
  if (markUsed(/\b(otgan|oldingi)\s+yil\w*/)) return { period: mk(ym(curY - 1, 1), ym(curY - 1, 12)), compare: null, used };
  if (markUsed(/\b(shu|bu|joriy)\s+yil\w*|yil\s+boshidan/)) return { period: mk(ym(curY, 1), now), compare: null, used };
  if (years.length >= 2 && /taqqos|solishtir|\bva\b/.test(t)) {
    const [a, b] = [...years].sort();
    return { period: mk(ym(a!, 1), ym(a!, 12)), compare: mk(ym(b!, 1), b === curY ? now : ym(b!, 12)), used };
  }
  if (years.length) {
    const y = years[0]!;
    return { period: mk(ym(y, 1), y === curY ? now : ym(y, 12)), compare: null, used };
  }
  if (markUsed(/\b(hamma|barcha|butun)\s+davr\w*|\bboshidan\b/)) return { period: mk('2000-01', now), compare: null, used };
  return { period: null, compare: null, used };
}

// ─────────── Ko'rsatkich va niyat ───────────

export type MoneyKind = 'expense' | 'income' | 'result' | 'payroll';
export type Intent = 'person' | 'money' | 'staff' | 'records' | 'units' | 'sources' | 'help' | 'greeting';
export type GroupBy = 'month' | 'category' | 'unit' | null;
export type PersonAspect = 'all' | 'payroll' | 'moves' | 'where';

export const RE = {
  payroll: /\bish\s*haq|\boylik|\bmaosh|\bish\s*xaq|\bzarplat/,
  income: /\bdaromad|\btushum|\bkirim\w*\b/,
  expense: /\bxarajat|\bharajat|\bsarf|\bchiqim|\bxaraj\b/,
  result: /\bnatija|\bfoyda|\bzarar|\brentab|\bsof\s+(foyda|natija)/,
  staff: /\bxodim|\bhodim|\bishchi|\bkadr|\bshtat/,
  count: /\bsoni\b|\bnechta|\bqancha\s+xodim|\bnecha\b/,
  list: /\bro?yxat|\bkimlar|\bismlar|\bfamiliya/,
  records: /\byozuv|\boxirgi\s+\d*\s*(ta\s+)?(xarajat|daromad|yozuv|tolov)|\btafsilot|\bbatafsil|\bqaysi\s+(xarajat|tolov)lar|\bhujjat/,
  moves: /\bkoch|\botkaz|\bbolim\w*\s+almash/,
  where: /\bqaysi\s+bolim|\bqayerda|\bqayerga|\bbolimi\b|\bqaysi\s+joy/,
  info: /\bmalumot|\bhamma|\bbarcha|\bhaqida|\bkim\b|\bkarta|\bto?liq|\bprofil|\bpasport|\btugilgan|\btelefon|\bmanzil/,
  byMonth: /\boylar\s+boy|\boyma\s*oy|\bdinamika|\bhar\s+oy|\boylik\s+boy|\boylar\s+kesim|\btrend/,
  byCategory: /\bmodda|\bturlar|\bnimaga|\btarkib|\bkategor|\bnimalarga|\bqaysi\s+modda/,
  byUnit: /\bbolimlar\s+boy|\bhududlar\s+boy|\bviloyatlar\s+boy|\bqaysi\s+(hudud|viloyat|bolim)|\bhar\s+(bir\s+)?(bolim|hudud|viloyat)|\byonalishlar\s+boy|\bkesim/,
  top: /\beng\s+(kop|katta|yuqori|baland|kam|kichik)/,
  bottom: /\beng\s+(kam|kichik|past)/,
  units: /\bqanday\s+bolim|\bbolimlar\s+ro?yxat|\bqaysi\s+bolimlar\s+bor/,
  sources: /\bmanba|\bnima\s+bila|\bnimalarni\s+bila|\bqanday\s+savol/,
  help: /^(yordam|help|\?|nima qila olasan|nima qila olasiz)$/,
  greeting: /^(salom|assalomu?\s*alaykum|assalom|hayrli\s+\w+|qalesan|qalaysiz|salom\s+\w+)\W*$/,
  compare: /\btaqqos|\bsolishtir|\bfarq/,
};

/** Shaxs topishda e'tiborga olinmaydigan so'zlar */
export const STOP = new Set(
  (
    'ber bering berib korsat korsating chiqar chiqaring ayt ayting yoz menga bizga kerak iltimos qani qancha nechta necha qanday qaysi qachon nima nimalar ' +
    'malumot malumoti malumotlari malumotlarini hamma hammasi barcha barchasi haqida haqidagi toliq tolig shu bu u ana mana uchun bilan va yoki ham esa ' +
    'oy oyi oyda oydagi oylar oylik yil yili yilda yildagi davr davrdagi joriy otgan oldingi oxirgi songgi boshidan gacha dan da ni ning ga ' +
    'xarajat xarajati xarajatlari xarajatlar harajat sarf daromad daromadi daromadlari tushum natija foyda zarar ish haqi haqqi oylik maosh ' +
    'xodim xodimi xodimlar xodimlari xodimning hodim ishchi bolim bolimi bolimlar bolimning hudud hududlar viloyat viloyati tuman ' +
    'modda moddalar boyicha kesimida eng kop katta kam soni royxat royxati yozuv yozuvlar tafsilot batafsil ' +
    'kochish kochishlari otkazish qayerda kim karta kartasi jami umumiy salom rahmat chi chi? edi ekan bor yoq'
  ).split(/\s+/),
);

// ─────────── Lug'at (xizmat beradi) ───────────

export interface DictPerson {
  pinfl: string;
  fullName: string;
  /** Normallashtirilgan ism bo'laklari */
  toks: string[];
}
export interface DictRegion {
  code: number;
  name: string;
  stems: string[];
}
export interface DictDept {
  id: string;
  name: string;
  toks: string[];
}
export interface DictCat {
  code: string;
  label: string;
  toks: string[];
  kind: 'expense' | 'income';
}
export interface ChatDict {
  people: DictPerson[];
  /** Ismning birinchi 3 harfi → shaxslar indekslari */
  byPrefix: Map<string, number[]>;
  regions: DictRegion[];
  depts: DictDept[];
  cats: DictCat[];
}

export const UNIT_PATTERNS: { code: string; re: RegExp }[] = [
  { code: 'TAX_FREE', re: /\btax\s*-?\s*free|\btaks\s*-?\s*fri|\btaxfree|\btaksfri/ },
  { code: 'MARKSHEYDER', re: /\bmarksheyd|\bmarkshed/ },
  { code: 'FERMER', re: /\bfermer/ },
  { code: 'BUXGALTERIYA', re: /\bbuxgalteriya\s+xizmat|\bbuxgalteriya\b|\bbuxgalteriyada|\bbuxgalteriyaning/ },
  { code: 'QOMITA', re: /\bqomita/ },
  { code: 'CENTER', re: /\bmarkaz/ },
  { code: 'REGION', re: /\bhududlar\b(?!\s+boy)|\bhududlarda|\bhududlarning|\bviloyatlar\b(?!\s+boy)|\bviloyatlarda/ },
];

const GENERIC_CAT = new Set(['xarajat', 'xarajatlar', 'xarajatlari', 'tolov', 'tolovlar', 'tolovlari', 'boshqa', 'umumiy', 'va', 'uchun', 'xizmatlari', 'xizmati', 'xizmat', 'bilan', 'ombor', 'xarid']);

export function catTokens(label: string): string[] {
  return tokens(norm(label)).filter((x) => x.length >= 3 && !GENERIC_CAT.has(x));
}

const prefixMatch = (q: string, w: string) => {
  if (w.length < 3 || q.length < 3) return false;
  const k = Math.min(w.length, Math.max(4, w.length - 2), 6);
  return q.startsWith(w.slice(0, k)) && (w.length <= 4 ? q.startsWith(w) : true);
};

// ─────────── Natija ───────────

export interface ParsedQuery {
  text: string;
  intent: Intent;
  kind: MoneyKind | null;
  /** Ikkala ko'rsatkich (daromad + xarajat) so'ralgan */
  overview: boolean;
  pinfl: string | null;
  /** Bir nechta shaxs mos keldi — tanlash kerak */
  personChoices: string[];
  aspect: PersonAspect;
  units: string[];
  region: number | null;
  dept: string | null;
  category: string | null;
  period: PeriodSpec | null;
  compare: PeriodSpec | null;
  groupBy: GroupBy;
  top: 'desc' | 'asc' | null;
  /** Kontekstdan olingan maydonlar */
  inherited: string[];
}

export interface ChatContext {
  pinfl?: string | null;
  units?: string[];
  region?: number | null;
  dept?: string | null;
  category?: string | null;
  period?: PeriodSpec | null;
  kind?: MoneyKind | null;
  intent?: Intent | null;
}

/** Ism bo'lagi skeleti: yozilish farqlari (h/x, iy/i, yo/o) teng */
export const skel = (t: string) => t.replace(/h/g, 'x').replace(/iy(?=[aeiou])/g, 'i').replace(/yo/g, 'o').replace(/yu/g, 'u');

/** Shaxslarni topish: kamida 2 bo'lak mos (familiya + ism) yoki yagona familiya */
export function findPeople(qToks: string[], dict: ChatDict): { best: string[]; score: number } {
  const cand = new Map<number, number>();
  const used = qToks.filter((t) => t.length >= 3 && !STOP.has(t) && !/^\d+$/.test(t)).map(skel);
  for (const q of used) {
    const idx = dict.byPrefix.get(q.slice(0, 3)) ?? [];
    for (const i of idx) {
      const p = dict.people[i]!;
      if (p.toks.some((w) => w.startsWith(q) || (q.startsWith(w) && w.length >= 4) || (w.length >= 5 && prefixMatch(q, w)))) cand.set(i, (cand.get(i) ?? 0) + 1);
    }
  }
  if (!cand.size) return { best: [], score: 0 };
  const max = Math.max(...cand.values());
  const top = [...cand.entries()].filter(([, s]) => s === max).map(([i]) => dict.people[i]!.pinfl);
  const uniq = [...new Set(top)];
  if (max >= 2) return { best: uniq, score: max };
  // Bitta bo'lak: familiya mos kelganlar — tanlash uchun (ko'pi bilan 8)
  const bySurname = [...cand.entries()]
    .filter(([i]) => used.some((q) => dict.people[i]!.toks[0]?.startsWith(q.slice(0, Math.max(4, q.length - 3))) && q.length >= 5))
    .map(([i]) => dict.people[i]!.pinfl);
  return { best: [...new Set(bySurname)].slice(0, 8), score: bySurname.length ? 1 : 0 };
}

export function parse(raw: string, now: string, dict: ChatDict, ctx: ChatContext = {}): ParsedQuery {
  const text = norm(raw);
  const toks = tokens(text);
  const q: ParsedQuery = {
    text,
    intent: 'help',
    kind: null,
    overview: false,
    pinfl: null,
    personChoices: [],
    aspect: 'all',
    units: [],
    region: null,
    dept: null,
    category: null,
    period: null,
    compare: null,
    groupBy: null,
    top: null,
    inherited: [],
  };
  if (!text) return q;
  if (RE.greeting.test(text)) return { ...q, intent: 'greeting' };
  if (RE.help.test(text)) return q;

  // Davr
  const per = parsePeriod(text, now);
  q.period = per.period;
  q.compare = per.compare;

  // Bo'limlar
  for (const u of UNIT_PATTERNS) if (u.re.test(text)) q.units.push(u.code);
  if (q.units.includes('BUXGALTERIYA') && /\bbuxgalteriya\s+hisobi\s+bolim/.test(text)) q.units = q.units.filter((u) => u !== 'BUXGALTERIYA');

  // Viloyat
  let bestRegion: { code: number; score: number } | null = null;
  for (const r of dict.regions) {
    const score = r.stems.filter((s) => toks.some((t) => t.startsWith(s))).length;
    if (score && (!bestRegion || score > bestRegion.score)) bestRegion = { code: r.code, score };
  }
  if (bestRegion) {
    // «Toshkent shahri» / «Toshkent viloyati» — aniqroq
    const tosh = dict.regions.filter((r) => r.stems[0] === 'toshkent');
    if (tosh.length > 1 && dict.regions.find((r) => r.code === bestRegion!.code)?.stems[0] === 'toshkent') {
      const city = tosh.find((r) => /shahr/.test(norm(r.name)));
      const prov = tosh.find((r) => /viloyat/.test(norm(r.name)));
      bestRegion.code = /\bshahar|\bshahri|\bshahrida/.test(text) && city ? city.code : prov ? prov.code : bestRegion.code;
    }
    q.region = bestRegion.code;
  }

  // Markaz bo'limi (departament): nomining kamida 2 muhim bo'lagi
  let bestDept: { id: string; score: number } | null = null;
  for (const d of dict.depts) {
    const sig = d.toks.filter((x) => x.length >= 4 && !GENERIC_CAT.has(x) && !['bolimi', 'bolim', 'boshqarma', 'boshqarmasi', 'xizmati', 'markaz', 'markazi'].includes(x));
    if (!sig.length) continue;
    const score = sig.filter((w) => toks.some((t) => prefixMatch(t, w))).length;
    if (score >= Math.min(2, sig.length) && (!bestDept || score > bestDept.score)) bestDept = { id: d.id, score };
  }
  if (bestDept) q.dept = bestDept.id;

  // Ko'rsatkich
  const isPayroll = RE.payroll.test(text);
  const isIncome = RE.income.test(text);
  const isExpense = RE.expense.test(text);
  const isResult = RE.result.test(text);
  if (isPayroll) q.kind = 'payroll';
  else if (isResult || (isIncome && isExpense)) {
    q.kind = 'result';
    q.overview = true;
  } else if (isIncome) q.kind = 'income';
  else if (isExpense) q.kind = 'expense';

  // Modda (ish haqi bo'lmasa)
  if (q.kind !== 'payroll') {
    let best: { c: DictCat; score: number; total: number } | null = null;
    for (const c of dict.cats) {
      if (q.kind === 'income' && c.kind !== 'income') continue;
      if ((q.kind === 'expense' || q.kind === 'result') && c.kind !== 'expense') continue;
      if (!c.toks.length) continue;
      const sig = c.toks.slice(0, 3);
      const score = sig.filter((w) => w.length >= 4 && toks.some((t) => !STOP.has(t) && prefixMatch(t, w))).length;
      if (score && score === sig.length && (!best || score > best.score || (score === best.score && c.toks.length < best.total))) best = { c, score, total: c.toks.length };
    }
    if (best) {
      q.category = best.c.code;
      if (!q.kind) q.kind = best.c.kind;
    }
  }

  // Shaxs
  const pin = text.match(/\b(\d{14})\b/);
  if (pin) q.pinfl = pin[1]!;
  else {
    const catToks = new Set(q.category ? (dict.cats.find((c) => c.code === q.category)?.toks ?? []) : []);
    const free = toks.filter((t) => !per.used.has(t) && !catToks.has(t) && !UNIT_PATTERNS.some((u) => u.re.test(t)) && !dict.regions.some((r) => r.stems.some((s) => t.startsWith(s))));
    const found = findPeople(free, dict);
    if (found.best.length === 1 && found.score >= 2) q.pinfl = found.best[0]!;
    else if (found.best.length > 1 || (found.best.length === 1 && found.score === 1)) q.personChoices = found.best;
  }

  // Guruhlash va tartib
  if (RE.byMonth.test(text)) q.groupBy = 'month';
  else if (RE.byUnit.test(text)) q.groupBy = 'unit';
  else if (RE.byCategory.test(text)) q.groupBy = 'category';
  if (RE.top.test(text)) q.top = RE.bottom.test(text) ? 'asc' : 'desc';
  if (q.top && !q.groupBy) q.groupBy = /\bhudud|\bviloyat|\bbolim|\byonalish/.test(text) ? 'unit' : 'category';

  // Oldingi javobga ishora: «uning ish haqi», «shu bo'lim xarajati», «shu davr»
  const refersPerson = /\buning\b|\bunga\b|\bshu\s+(xodim|odam|kishi)/.test(text) && !q.pinfl && !q.personChoices.length && Boolean(ctx.pinfl);
  if (refersPerson) {
    q.pinfl = ctx.pinfl!;
    q.inherited.push('xodim');
  }
  const refersPlace = /\bshu\s+(bolim|hudud|viloyat|yonalish|joy)|\bbu\s+(bolim|hudud|viloyat)|\bshuning\b/.test(text);
  const refersPeriod = /\bshu\s+davr|\bshu\s+vaqt|\bxuddi\s+shu\s+davr/.test(text);

  // Niyat
  const wantsStaff = RE.staff.test(text) && !q.pinfl && !q.personChoices.length && (RE.count.test(text) || RE.list.test(text) || !q.kind);
  if (q.pinfl || q.personChoices.length) {
    q.intent = 'person';
    q.aspect = isPayroll ? 'payroll' : RE.moves.test(text) ? 'moves' : RE.where.test(text) && !RE.info.test(text) ? 'where' : 'all';
  } else if (RE.units.test(text)) q.intent = 'units';
  else if (RE.sources.test(text) && !q.kind) q.intent = 'sources';
  else if (wantsStaff && !isPayroll) q.intent = 'staff';
  else if (RE.records.test(text) && (q.kind || q.category || q.units.length || q.region !== null)) q.intent = 'records';
  else if (q.kind) q.intent = 'money';

  // Kontekst (davom savollari): «fevraldagi-chi?», «Fermerniki-chi?», «oylar bo'yicha»
  const followUp = q.intent === 'help' && (q.period || q.compare || q.units.length || q.region !== null || q.groupBy || q.category || q.dept || /\bchi\b|\bchi\?|\besa\b|\bnima\s+bolgan/.test(text));
  if (followUp && ctx.intent) {
    q.intent = ctx.intent === 'greeting' || ctx.intent === 'help' ? 'money' : ctx.intent;
    if (q.intent === 'person' && ctx.pinfl) {
      q.pinfl = ctx.pinfl;
      q.inherited.push('xodim');
      if (isPayroll || ctx.kind === 'payroll') q.aspect = 'payroll';
    }
    if (q.intent === 'person' && !q.pinfl) q.intent = 'money';
  }
  if (q.intent === 'person' && refersPeriod && !q.period && ctx.period) {
    q.period = ctx.period;
    q.inherited.push('davr');
  }
  if (q.intent === 'money' || q.intent === 'records' || q.intent === 'staff' || (followUp && ctx.intent)) {
    if (!q.kind && ctx.kind && q.intent !== 'staff') {
      q.kind = ctx.kind;
      q.overview = ctx.kind === 'result';
      q.inherited.push("ko'rsatkich");
    }
    const hasPlace = q.units.length || q.region !== null || q.dept;
    if (!hasPlace && (followUp || refersPlace)) {
      if (ctx.units?.length) q.units = ctx.units;
      if (ctx.region !== undefined && ctx.region !== null) q.region = ctx.region;
      if (ctx.dept) q.dept = ctx.dept;
      if (ctx.units?.length || ctx.region !== null && ctx.region !== undefined || ctx.dept) q.inherited.push("bo'lim");
    }
    if (!q.period && ctx.period && (followUp || refersPeriod)) {
      q.period = ctx.period;
      q.inherited.push('davr');
    }
    if (!q.category && ctx.category && followUp && !q.groupBy) {
      q.category = ctx.category;
      q.inherited.push('modda');
    }
    if (q.intent === 'money' && !q.kind) q.kind = 'expense';
  }
  // Faqat joy yoki davr yozilgan bo'lsa (kontekstsiz) — umumiy ko'rinish
  if (q.intent === 'help' && (q.units.length || q.region !== null || q.dept) && !ctx.intent) {
    q.intent = 'money';
    q.kind = 'result';
    q.overview = true;
  }
  return q;
}