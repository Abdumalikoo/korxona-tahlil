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
export type Intent = 'person' | 'money' | 'staff' | 'records' | 'units' | 'sources' | 'help' | 'greeting' | 'compareUnits' | 'hr' | 'topPay';
export type GroupBy = 'month' | 'category' | 'unit' | 'party' | 'position' | 'age' | 'gender' | 'education' | 'region' | 'district' | null;
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
  yoy: /\botgan\s+yil\w*\s+(shu|xuddi\s+shu|ayni)\s+(davr|oy)\w*|\botgan\s+yil\w*\s+bilan\s+(solishtir|taqqos)\w*|\byilma[\s-]*yil|\bbir\s+yil\s+oldingi(\s+bilan)?/,
  unpaid: /\btolanmagan|\bqarz|\bkreditor|\bdebitor|\btolanmay/,
  byParty: /\bkontragent\w*\s+boy|\bmijoz\w*\s+boy|\bkimga\s+(eng\s+)?(kop|tolangan)|\bkimlarga|\bkimlardan|\bqaysi\s+(mijoz|kontragent|firma|kompaniya)/,
  hired: /\bishga\s+(kirgan|olingan|qabul)|\byangi\s+(kelgan|olingan)\s+xodim|\bqabul\s+qilingan/,
  female: /\bayol|\bxotin\s*qiz|\bqizlar\b/,
  male: /\berkak/,
  avgPay: /\bortacha\s+(ish\s*haq|oylik|maosh)|\b(ish\s*haq\w*|oylik|maosh)\s+ortacha/,
  hrGroup: {
    position: /\blavozim\w*\s+boy/,
    age: /\byosh\w*\s+boy/,
    gender: /\bjins\w*\s+boy|\berkak\s+va\s+ayol|\bayol\s+va\s+erkak/,
    education: /\bmalumot\w*\s+boy|\btalim\w*\s+boy/,
    region: /\b(viloyat|hudud)\w*\s+boy/,
    district: /\btuman\w*\s+boy/,
    unit: /\b(bolim|yonalish)\w*\s+boy/,
  },
};

// ─────────── Xatolarni tuzatish (sun'iy intellektsiz: so'z lug'atiga eng yaqin) ───────────

/** Tizim so'zlari — shularga 1–2 harf farqi bilan yozilgan so'z to'g'rilanadi («xarjat» → «xarajat») */
export const VOCAB = (
  'xarajat daromad tushum natija foyda zarar oylik maosh xodim xodimlar soni royxat royxati solishtir taqqosla ' +
  'fermer marksheyder buxgalteriya markaz hududlar viloyat viloyati tumani yanvar fevral aprel iyun iyul avgust sentabr oktabr noyabr dekabr ' +
  'chorak oxirgi otgan yozuvlar moddalar boyicha lavozim lavozimlar yoshi jinsi malumot malumoti ayollar erkaklar tolanmagan qarzdorlik ' +
  'kontragent mijoz mijozlar ortacha ulushi foizi barcha hammasi kochishlari qaysi bolimda bolimlar manbalar ' +
  // To'g'ri so'zlar — tuzatilmasin (bir-biriga yaqin: olgan/otgan, buxgalter/buxgalteriya …)
  'olgan olganlar kirgan kirganlar ishga ishlagan ishlaydi tolangan tolov berilgan otkazilgan tushgan kelgan ketgan qilgan bolgan katta kichik ' +
  'yosh yoshli ayol erkak buxgalter mutaxassis haydovchi boshliq maslahatchi direktor qancha nechta bilan uchun shahar shahri sentyabr oktyabr ' +
  'million milliard ming somdan kamida kopi yuqori past oshgan kamaygan ortgan necha kimlar kimga hisobida xizmat xizmati xizmatlari'
).split(/\s+/);

export function lev(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
    cur = [];
  }
  return prev[b.length]!;
}

/** Matndagi xato yozilgan so'zlarni lug'atdagi eng yaqiniga almashtiradi; ism bo'laklariga tegmaydi */
export function correctTypos(text: string, vocab: string[], nameToks: Set<string>): { text: string; fixes: { from: string; to: string }[] } {
  const words = vocab.filter((w) => w.length >= 4);
  const exact = new Set(vocab);
  const fixes: { from: string; to: string }[] = [];
  const out = text.split(' ').map((t) => {
    if (t.length < 4 || /\d/.test(t) || exact.has(t)) return t;
    if (words.some((w) => t.startsWith(w))) return t; // to'g'ri so'z + qo'shimcha
    const sk = skel(t);
    if (nameToks.has(sk) || [...nameToks].some((n) => n.length >= 4 && (sk.startsWith(n) || (n.startsWith(sk) && sk.length >= 5)))) return t;
    let best: { w: string; d: number; cut: number } | null = null;
    for (const w of words) {
      const lim = w.length >= 7 ? 2 : 1;
      for (let cut = w.length - 1; cut <= Math.min(t.length, w.length + 1); cut++) {
        if (cut < 3) continue;
        const d = lev(t.slice(0, cut), w, lim);
        if (d > 0 && d <= lim && (!best || d < best.d || (d === best.d && w.length > best.w.length))) best = { w, d, cut };
      }
    }
    if (!best) return t;
    const fixed = best.w + t.slice(best.cut);
    fixes.push({ from: t, to: fixed });
    return fixed;
  });
  return { text: out.join(' '), fixes };
}

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
export interface DictDistrict {
  id: string;
  regionCode: number;
  name: string;
  stem: string;
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
  districts: DictDistrict[];
  /** Lavozim nomlaridagi so'zlar (ma'lumotnomalar va bazadan) */
  positionToks: string[];
  /** Ism bo'laklari (xato tuzatishda tegilmaydi) */
  nameToks: Set<string>;
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
  /** Bir nechta viloyat (solishtirish uchun) */
  regions: number[];
  district: string | null;
  dept: string | null;
  category: string | null;
  period: PeriodSpec | null;
  compare: PeriodSpec | null;
  /** O'tgan yilning shu davri bilan solishtirish */
  yoy: boolean;
  groupBy: GroupBy;
  top: 'desc' | 'asc' | null;
  /** Kontragent / mijoz / izohdagi so'z */
  party: string | null;
  /** Summa chegarasi (so'm) */
  minSom: number | null;
  maxSom: number | null;
  /** To'lanmagan (qarz) yozuvlar */
  unpaid: boolean;
  /** Xodimlar tahlili filtrlari */
  hr: { gender: 'F' | 'M' | null; minAge: number | null; maxAge: number | null; education: string | null; positions: string[]; hired: boolean };
  /** Tuzatilgan so'zlar */
  fixes: { from: string; to: string }[];
  /** Kontekstdan olingan maydonlar */
  inherited: string[];
}

export interface ChatContext {
  pinfl?: string | null;
  units?: string[];
  region?: number | null;
  regions?: number[];
  district?: string | null;
  party?: string | null;
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
  const rawFixed = String(raw ?? '').replace(/(\d),(\d)/g, '$1.$2');
  // Qo'shtirnoq ichidagi so'z — kontragent / izoh bo'yicha qidiruv
  const quoted = rawFixed.match(/[«"“„]([^»"”“]{2,60})[»"”“]/);
  const vocab = [...VOCAB, ...dict.regions.flatMap((r) => r.stems), ...dict.districts.map((d) => d.stem)];
  const corrected = correctTypos(norm(rawFixed), vocab, dict.nameToks);
  const text = corrected.text;
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
    regions: [],
    district: null,
    dept: null,
    category: null,
    period: null,
    compare: null,
    yoy: false,
    groupBy: null,
    top: null,
    party: null,
    minSom: null,
    maxSom: null,
    unpaid: false,
    hr: { gender: null, minAge: null, maxAge: null, education: null, positions: [], hired: false },
    fixes: corrected.fixes,
    inherited: [],
  };
  if (!text) return q;
  if (RE.greeting.test(text)) return { ...q, intent: 'greeting' };
  if (RE.help.test(text)) return q;

  // Davr («o'tgan yilning shu davri bilan» — davr emas, solishtirish)
  q.yoy = RE.yoy.test(text);
  const per = parsePeriod(q.yoy ? text.replace(RE.yoy, ' ') : text, now);
  q.period = per.period;
  q.compare = per.compare;

  // Summa chegarasi: «5 mln dan katta», «500 ming so'mdan kam»
  const amt = text.match(/(\d[\d ]*(?:\.\d+)?)\s*(mlrd|milliard|mln|million|millon|ming)?\s*(som)?\s*(dan|tadan|somdan)\s+(katta|kop|ortiq|yuqori|oshgan|ziyod|kichik|kam|past)/);
  if (amt) {
    const mul = /^(mlrd|milliard)$/.test(amt[2] ?? '') ? 1e9 : /^(mln|million|millon)$/.test(amt[2] ?? '') ? 1e6 : amt[2] === 'ming' ? 1e3 : 1;
    const v = Number(amt[1]!.replace(/ /g, '')) * mul;
    if (Number.isFinite(v) && v > 0) {
      if (/kichik|kam|past/.test(amt[5]!)) q.maxSom = v;
      else q.minSom = v;
      tokens(amt[0]).forEach((x) => per.used.add(x));
    }
  }
  q.unpaid = RE.unpaid.test(text);

  // Kontragent / mijoz: qo'shtirnoqda, «Artelga to'langan», «kontragent Artel», «Mijoz X dan tushgan»
  const partyM =
    text.match(/\b([a-z0-9]{3,}?)(ga|ka|qa)\s+(tolangan|tolov|berilgan|otkazilgan)/) ??
    text.match(/\b(?:kontragent|mijoz|firma|kompaniya)\s+([a-z0-9]{3,})/) ??
    text.match(/\b([a-z0-9]{3,}?)(dan|tan)\s+(tushgan|kelgan|tushum)/);
  if (quoted) q.party = norm(quoted[1]);
  else if (partyM && !STOP.has(partyM[1]!)) q.party = partyM[1]!;
  if (q.party) tokens(q.party).forEach((x) => per.used.add(x));

  // Bo'limlar
  for (const u of UNIT_PATTERNS) if (u.re.test(text)) q.units.push(u.code);
  if (q.units.includes('BUXGALTERIYA') && /\bbuxgalteriya\s+hisobi\s+bolim/.test(text)) q.units = q.units.filter((u) => u !== 'BUXGALTERIYA');

  // Tuman: «Qibray tumani», «Asaka tumanida» (viloyat nomi bilan bir xil bo'lsa — faqat «tuman» so'zi bilan)
  const regionStems = new Set(dict.regions.flatMap((r) => r.stems));
  const districtHits = dict.districts.filter((d) =>
    toks.some((t, i) => t.startsWith(d.stem) && (/^tuman/.test(toks[i + 1] ?? '') || (!regionStems.has(d.stem) && d.stem.length >= 5 && /\btuman/.test(text)))),
  );
  const districtTok = new Set<string>();
  if (districtHits.length) {
    q.district = districtHits[0]!.id;
    toks.forEach((t, i) => {
      if (t.startsWith(districtHits[0]!.stem)) {
        districtTok.add(t);
        if (toks[i + 1]?.startsWith('tuman')) districtTok.add(toks[i + 1]!);
      }
    });
  }

  // Viloyat(lar)
  const regionHits: number[] = [];
  let bestRegion: { code: number; score: number } | null = null;
  for (const r of dict.regions) {
    const score = r.stems.filter((s) => toks.some((t) => t.startsWith(s) && !districtTok.has(t))).length;
    if (score) regionHits.push(r.code);
    if (score && (!bestRegion || score > bestRegion.score)) bestRegion = { code: r.code, score };
  }
  // Toshkent: shahar va viloyat ikkalasi mos keladi — bittasi qoladi
  const toshCodes = dict.regions.filter((r) => r.stems[0] === 'toshkent').map((r) => r.code);
  const nonTosh = regionHits.filter((c) => !toshCodes.includes(c));
  if (regionHits.some((c) => toshCodes.includes(c))) {
    const city = dict.regions.find((r) => toshCodes.includes(r.code) && /shahr/.test(norm(r.name)));
    const prov = dict.regions.find((r) => toshCodes.includes(r.code) && /viloyat/.test(norm(r.name)));
    const pick = /\btoshkent\s+(shahar|shahri|shahrida)/.test(text) && city ? city.code : prov ? prov.code : toshCodes[0]!;
    q.regions = [...nonTosh, pick];
  } else q.regions = nonTosh;
  if (q.regions.length === 1) bestRegion = { code: q.regions[0]!, score: 1 };
  else if (q.regions.length > 1) bestRegion = null;
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

  // Modda (ish haqi bo'lmasa; «buxgalterlar soni» kabi xodim savolida — pul so'zi bo'lmasa modda izlanmaydi)
  const headcountQ = !q.kind && (RE.count.test(text) || RE.list.test(text) || RE.staff.test(text) || RE.female.test(text) || RE.male.test(text));
  if (q.kind !== 'payroll' && !headcountQ) {
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
    const free = toks.filter((t) => !per.used.has(t) && !catToks.has(t) && !districtTok.has(t) && !UNIT_PATTERNS.some((u) => u.re.test(t)) && !dict.regions.some((r) => r.stems.some((s) => t.startsWith(s))));
    const found = findPeople(free, dict);
    if (found.best.length === 1 && found.score >= 2) q.pinfl = found.best[0]!;
    else if (found.best.length > 1 || (found.best.length === 1 && found.score === 1)) q.personChoices = found.best;
  }

  // Xodimlar tahlili filtrlari
  q.hr.gender = RE.female.test(text) ? 'F' : RE.male.test(text) ? 'M' : null;
  const ageMin = text.match(/\b(\d{2})\s*yosh\w*\s+(katta|oshgan|yuqori|ortiq)/);
  const ageMax = text.match(/\b(\d{2})\s*(yoshgacha|yosh\w*\s+(kichik|kam|yosh))/);
  const ageRange = text.match(/\b(\d{2})\s*[-–]\s*(\d{2})\s*yosh/) ?? text.match(/\b(\d{2})\s+(\d{2})\s+yosh/);
  if (ageRange) {
    q.hr.minAge = Number(ageRange[1]);
    q.hr.maxAge = Number(ageRange[2]);
  } else {
    if (ageMin) q.hr.minAge = Number(ageMin[1]) + 1;
    if (ageMax) q.hr.maxAge = Number(ageMax[1]);
  }
  q.hr.education = /\btugallanmagan\s+oliy/.test(text) ? 'tugallanmagan oliy' : /\borta[\s-]*maxsus/.test(text) ? 'orta maxsus' : /\boliy\s+malumot|\boliy\s+talim|\boliy\b(?!\s+(majlis|sud))/.test(text) && RE.staff.test(text) ? 'oliy' : null;
  q.hr.hired = RE.hired.test(text);
  const posStop = new Set(['bolim', 'bolimi', 'boshligi', 'bosh', 'xizmati', 'xizmatlari', 'boyicha', 'markaz', 'hududiy', 'fermer', 'xojaliklarida', 'xojaliklariga', 'buxgalteriya', 'hisobi', 'soliq', 'statistika', 'xizmatining']);
  for (const t of toks) {
    if (t.length < 5 || STOP.has(t) || posStop.has(t) || UNIT_PATTERNS.some((u) => u.re.test(t)) || /^buxgalteriya/.test(t)) continue;
    const hit = dict.positionToks.find((w) => w.length >= 5 && !posStop.has(w) && (t.startsWith(w.slice(0, Math.max(5, w.length - 2))) || (w.startsWith(t) && t.length >= 6)));
    if (hit && !q.hr.positions.includes(hit)) q.hr.positions.push(hit);
  }

  // Guruhlash va tartib
  const hrGroup = (Object.entries(RE.hrGroup) as [Exclude<GroupBy, null>, RegExp][]).find(([, re]) => re.test(text))?.[0] ?? null;
  if (RE.byMonth.test(text)) q.groupBy = 'month';
  else if (RE.byParty.test(text)) q.groupBy = 'party';
  else if (hrGroup && ['position', 'age', 'gender', 'education', 'district'].includes(hrGroup)) q.groupBy = hrGroup;
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
  const hrFilters = Boolean(q.hr.gender || q.hr.minAge || q.hr.maxAge || q.hr.education || q.hr.hired || q.hr.positions.length || q.district || (hrGroup && hrGroup !== 'unit'));
  const isPayrollQ = isPayroll;
  if ((q.pinfl || q.personChoices.length) && q.party && !RE.info.test(text)) {
    // «Artelga to'langan» — shaxs emas, kontragent
    q.pinfl = null;
    q.personChoices = [];
  }
  const places = [...q.units.filter((u) => !(u === 'REGION' && q.regions.length)), ...q.regions.map((r) => `r:${r}`)];
  if (isPayrollQ && !q.pinfl && !q.personChoices.length && (RE.avgPay.test(text) || ((q.top || /\bkim(lar)?\b|\bxodimlar/.test(text)) && !RE.byUnit.test(text) && q.groupBy !== 'unit'))) {
    q.intent = 'topPay';
    if (!q.top) q.top = 'desc';
  } else if (!q.pinfl && !q.personChoices.length && (hrFilters || (hrGroup && (RE.staff.test(text) || wantsStaff))) && !q.kind) {
    q.intent = 'hr';
    if (hrGroup === 'region' || hrGroup === 'unit') q.groupBy = hrGroup;
  } else if (q.pinfl || q.personChoices.length) {
    q.intent = 'person';
    q.aspect = isPayroll ? 'payroll' : RE.moves.test(text) ? 'moves' : RE.where.test(text) && !RE.info.test(text) ? 'where' : 'all';
  } else if (RE.units.test(text)) q.intent = 'units';
  else if (RE.sources.test(text) && !q.kind) q.intent = 'sources';
  else if (wantsStaff && !isPayroll) q.intent = 'staff';
  else if (RE.records.test(text) && (q.kind || q.category || q.units.length || q.region !== null)) q.intent = 'records';
  else if (q.kind) q.intent = 'money';
  // Faqat filtr (kontragent, summa, qarz) — pul savoli
  if (q.intent === 'help' && (q.party || q.unpaid || q.minSom || q.maxSom)) {
    q.intent = 'money';
    q.kind = /\btushgan|\btushum|\bmijoz|\bkelgan|\bdebitor/.test(text) ? 'income' : 'expense';
  }
  if (q.intent === 'money' && places.length >= 2) q.intent = 'compareUnits';
  if ((q.intent === 'money' || q.intent === 'help') && RE.compare.test(text) && /\bbolimlar|\bhududlar|\bviloyatlar|\byonalishlar/.test(text) && places.length < 2) {
    q.intent = 'money';
    q.kind = q.kind ?? 'result';
    q.overview = q.kind === 'result';
    q.groupBy = 'unit';
    q.units = q.units.filter((u) => u !== 'REGION');
  }
  if (q.intent === 'money' && q.yoy && q.compare === null) {
    // A — o'tgan yilning shu davri, B — tanlangan davr
    const cur = q.period ?? { from: `${now.slice(0, 4)}-01`, to: now, label: `${spanLabel(`${now.slice(0, 4)}-01`, now)}` };
    const from = addMonths(cur.from, -12);
    const to = addMonths(cur.to, -12);
    q.period = { from, to, label: spanLabel(from, to) };
    q.compare = cur;
  }

  // Kontekst (davom savollari): «fevraldagi-chi?», «Fermerniki-chi?», «oylar bo'yicha»
  const followUp = q.intent === 'help' && (q.period || q.compare || q.yoy || q.units.length || q.region !== null || q.district || q.groupBy || q.category || q.dept || q.party || q.unpaid || q.minSom || q.maxSom || /\bchi\b|\bchi\?|\besa\b|\bnima\s+bolgan/.test(text));
  if (followUp && ctx.intent) {
    q.intent = ctx.intent === 'greeting' || ctx.intent === 'help' ? 'money' : ctx.intent;
    if (q.intent === 'person' && ctx.pinfl) {
      q.pinfl = ctx.pinfl;
      q.inherited.push('xodim');
      if (isPayroll || ctx.kind === 'payroll') q.aspect = 'payroll';
    }
    if (q.intent === 'person' && !q.pinfl) q.intent = 'money';
    if (q.intent === 'compareUnits' && (q.units.length || q.region !== null)) q.intent = 'money';
    if (q.yoy && q.intent === 'money' && !q.compare) {
      const cur = q.period ?? ctx.period ?? { from: `${now.slice(0, 4)}-01`, to: now, label: spanLabel(`${now.slice(0, 4)}-01`, now) };
      q.period = { from: addMonths(cur.from, -12), to: addMonths(cur.to, -12), label: spanLabel(addMonths(cur.from, -12), addMonths(cur.to, -12)) };
      q.compare = cur;
    }
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
    const hasPlace = q.units.length || q.region !== null || q.dept || q.district || q.regions.length;
    if (!hasPlace && (followUp || refersPlace)) {
      if (ctx.units?.length) q.units = ctx.units;
      if (ctx.region !== undefined && ctx.region !== null) q.region = ctx.region;
      if (ctx.regions?.length) q.regions = ctx.regions;
      if (ctx.district) q.district = ctx.district;
      if (ctx.dept) q.dept = ctx.dept;
      if (ctx.units?.length || (ctx.region !== null && ctx.region !== undefined) || ctx.dept || ctx.district) q.inherited.push("bo'lim");
    }
    if (!q.party && ctx.party && followUp) {
      q.party = ctx.party;
      q.inherited.push('kontragent');
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
  if (q.intent === 'help' && (q.units.length || q.region !== null || q.dept || q.district) && !ctx.intent) {
    q.intent = 'money';
    q.kind = 'result';
    q.overview = true;
  }
  return q;
}