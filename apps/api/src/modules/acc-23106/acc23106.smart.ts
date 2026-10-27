import type { PayoutKind } from './acc23106.purpose';

// ═══════════════════════════════════════════════════════════
// 23106 — to'lov izohidan «nima uchun»ni AQLLI aniqlash.
//
// 1) Yozilishni bir xillash (fold): kirill → lotin; bir-birining o'rniga yoziladigan harflar bitta harf
//    (o/a/u/ў → a, x/h/ҳ → x, q/k → k, ts/ц → s, y/i → i, ye/yo/yu/ya → unli), tutuq belgilari olib tashlanadi,
//    ikkilangan harflar bitta qilinadi. Natija: «камандировочный» = «komandirovichniy» = «командировочные».
// 2) Lug'at: har guruhga iboralar (eng kuchli), so'z o'zaklari va «butun so'z» (qo'shimchalari bilan) yozuvlari —
//    ruscha, o'zbekcha (kirill / lotin), qisqartmalar.
// 3) Xatoga chidamli: harf tushib qolgan / almashgan so'z ham topiladi (5–9 harfli o'zakda 1 ta, 10+ da 2 ta xato).
//    Qisqa so'zlarda xato kechirilmaydi (adashmaslik uchun).
// 4) Ball: har guruh bo'yicha topilganlar yig'indisi; eng ko'pi tanlanadi (teng bo'lsa — aniqroq guruh oldin).
//    Ishonch: HIGH — aniq; LOW — faqat taxminiy moslik yoki ikki guruh deyarli teng («Tekshirish kerak»);
//    NONE — hech narsa topilmadi (Boshqa).
// Izohning xodim ismi qismi («сотруднику …», «xodimi …») hisobga olinmaydi — «SAFAROV» safar emas.
// ═══════════════════════════════════════════════════════════

export type Confidence = 'HIGH' | 'LOW' | 'NONE';

export interface SmartResult {
  kind: PayoutKind;
  confidence: Confidence;
  score: number;
  /** Ikkinchi ehtimoliy guruh (ishonch past bo'lsa) */
  alt: PayoutKind | null;
  /** Topilgan so'zlar (izohdagi ko'rinishda) — «nega shunday» tushuntirish uchun */
  hits: string[];
}

// ─────────── 1. Yozilishni bir xillash ───────────

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
  і: 'i', ї: 'i', є: 'e', ң: 'n', ә: 'a', ө: 'o', ү: 'u', ұ: 'u', һ: 'h',
};

/** Bitta so'z / matnni bir xil ko'rinishga keltirish (faqat lotin harflari va probel) */
export function fold(text: string): string {
  let t = (text ?? '').toLowerCase().replace(/[а-яёўқғҳіїєңәөүұһ]/g, (ch) => CYR[ch] ?? ch);
  t = t.replace(/[‘’ʻʼ`´'"]/g, '');
  t = t.replace(/[^a-z]+/g, ' ');
  t = t
    .replace(/sh/g, '\u0001')
    .replace(/ch/g, '\u0002')
    .replace(/kh/g, 'x')
    .replace(/ts/g, 's')
    .replace(/h/g, 'x')
    .replace(/q/g, 'k')
    .replace(/w/g, 'v')
    .replace(/c/g, 's')
    .replace(/y([aeou])/g, '$1')
    .replace(/y/g, 'i')
    .replace(/[ou]/g, 'a')
    .replace(/\u0001/g, 'sh')
    .replace(/\u0002/g, 'ch')
    .replace(/([a-z])\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

/** Izohning xodim ismigacha bo'lgan qismi (ism — tahlilga kirmaydi) */
export function purposeBody(purpose: string): string {
  return (purpose ?? '').split(/сотрудник|работник|получател|xodim(?:i|ga|lar)|ходим(?:и|га|лар)|ф\.?\s*и\.?\s*о\.?\s*:/i)[0] ?? '';
}

// ─────────── 2. Lug'at ───────────

/**
 * p — ibora (bir necha so'z, har biri o'zak sifatida), s — o'zak (so'z boshi), w — butun so'z (+ qo'shimchalar).
 * Yozilishi qanday bo'lsa ham farqi yo'q — hammasi fold() dan o'tadi.
 */
interface Entry {
  p?: string;
  s?: string;
  w?: string;
}

const W_SUF = ['', 'i', 'ga', 'da', 'dan', 'dagi', 'lar', 'ni', 'ning', 'iga', 'ida', 'idan', 'larga', 'ini', 'a', 'e', 'u', 'ov', 'nie', 'nii', 'niya'];

const DICT: Record<Exclude<PayoutKind, 'BOSHQA'>, Entry[]> = {
  SAFAR: [
    { p: 'xizmat safari' },
    { p: 'хизмат сафари' },
    { p: 'служебная командировка' },
    { p: 'safar xarajat' },
    { p: 'сафар харажат' },
    { p: 'командировочные расходы' },
    { p: 'kunlik xarajat' },
    { p: 'кунлик харажат' },
    { p: 'кунлик пул' },
    { p: 'суточные расходы' },
    { p: "yo'l kira" },
    { p: 'йўл кира' },
    { p: "yo'l xarajat" },
    { p: 'йўл харажат' },
    { p: 'yo‘l puli' },
    { p: 'турар жой харажат' },
    { p: 'yashash xarajat' },
    { p: 'mehmonxona xarajat' },
    { p: 'меҳмонхона харажат' },
    { s: 'командиров' },
    { s: 'komandirov' },
    { s: 'командирав' },
    { s: 'командир' },
    { s: 'суточн' },
    { s: 'sutochn' },
    { s: 'проездн' },
    { s: 'проживан' },
    { w: 'safar' },
    { w: 'сафар' },
    { w: 'камандир' },
  ],
  BAYRAM: [
    { s: 'байрам' },
    { s: 'bayram' },
    { s: 'праздн' },
    { s: 'prazdnik' },
    { s: 'наврўз' },
    { s: 'navruz' },
    { s: 'навруз' },
    { p: 'янги йил' },
    { p: 'yangi yil' },
    { p: 'новый год' },
    { p: 'новогодн' },
    { p: 'xotin qizlar' },
    { p: 'хотин қизлар' },
    { p: 'женский день' },
    { p: 'мустақиллик' },
    { s: 'mustaqillik' },
    { p: 'ўқитувчилар куни' },
    { p: 'день независимости' },
  ],
  MODDIY: [
    { p: 'moddiy yordam' },
    { p: 'моддий ёрдам' },
    { p: 'материальная помощь' },
    { p: 'мат помощь' },
    { s: 'матпомощ' },
    { p: 'bir martalik yordam' },
    { p: 'бир марталик ёрдам' },
    { p: 'yordam puli' },
    { p: 'ёрдам пули' },
    { p: 'моддий кўмак' },
    { p: 'единовременная помощь' },
    { s: 'дафн' },
    { s: 'похорон' },
  ],
  TATIL: [
    { s: 'таътил' },
    { s: 'tatil' },
    { s: 'отпуск' },
    { s: 'otpusk' },
    { p: 'mehnat tatili' },
    { p: 'меҳнат таътили' },
    { p: 'ta til puli' },
    { p: 'неиспользованный отпуск' },
  ],
  KASALLIK: [
    { s: 'касаллик' },
    { s: 'kasallik' },
    { s: 'больнич' },
    { s: 'bolnich' },
    { s: 'нетрудоспособ' },
    { p: 'листок нетрудоспособности' },
    { p: 'vaqtincha mehnatga layoqatsiz' },
    { p: 'вақтинча меҳнатга лаёқатсиз' },
    { s: 'лаёқатсиз' },
    { s: 'layoqatsiz' },
    { s: 'декрет' },
    { s: 'homiladorlik' },
    { s: 'ҳомиладорлик' },
    { s: 'туғруқ' },
    { s: 'tugruq' },
    { s: 'беременн' },
  ],
  MUKOFOT: [
    { s: 'мукофот' },
    { s: 'mukofot' },
    { s: 'премиал' },
    { s: 'преми' },
    { s: 'premiy' },
    { s: 'premiya' },
    { s: 'рағбат' },
    { s: 'ragbat' },
    { s: 'бонус' },
    { s: 'bonus' },
    { s: 'поощр' },
    { s: 'вознагражд' },
    { w: 'kpi' },
    { w: 'кпи' },
    { p: 'pul mukofoti' },
  ],
  ISH_HAQI: [
    { p: 'ish haqi' },
    { p: 'иш ҳақи' },
    { p: 'иш хаки' },
    { p: 'заработная плата' },
    { p: 'oylik maosh' },
    { s: 'зарплат' },
    { s: 'zarplat' },
    { s: 'заработн' },
    { s: 'аванс' },
    { s: 'avans' },
    { s: 'маош' },
    { s: 'maosh' },
    { w: 'oylik' },
    { w: 'ойлик' },
    { w: 'зп' },
    { s: 'бўнак' },
    { s: 'бунак' },
    { s: 'bo‘nak' },
  ],
};

/** Teng ballda — aniqroq guruh oldin («bayram mukofoti» — bayram; «ойлик мукофот» — mukofot) */
const PRIORITY: PayoutKind[] = ['BAYRAM', 'SAFAR', 'MODDIY', 'TATIL', 'KASALLIK', 'MUKOFOT', 'ISH_HAQI'];
/** Ish haqi so'zlari (avans, oylik) boshqa to'lovlar bilan birga ko'p keladi — kuchsizroq */
const KIND_WEIGHT: Partial<Record<PayoutKind, number>> = { ISH_HAQI: 0.75 };
/** Birga kelishi tabiiy juftliklar — «Tekshirish kerak» qilinmaydi */
const COMPATIBLE = new Set(['BAYRAM>MUKOFOT', 'BAYRAM>MODDIY', 'MODDIY>MUKOFOT', 'TATIL>MODDIY', 'KASALLIK>MODDIY', 'SAFAR>MUKOFOT']);

interface Compiled {
  kind: PayoutKind;
  type: 'p' | 's' | 'w';
  words: string[];
  weight: number;
  label: string;
}

const COMPILED: Compiled[] = (() => {
  const out: Compiled[] = [];
  const seen = new Set<string>();
  for (const [kind, list] of Object.entries(DICT) as [PayoutKind, Entry[]][]) {
    for (const e of list) {
      const raw = e.p ?? e.s ?? e.w ?? '';
      const type: Compiled['type'] = e.p ? 'p' : e.s ? 's' : 'w';
      const f = fold(raw);
      if (!f) continue;
      const words = type === 'p' ? f.split(' ') : [f.replace(/ /g, '')];
      const key = `${kind}|${type}|${words.join(' ')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Bir so'zli ibora — o'zak bilan bir xil
      const t: Compiled['type'] = type === 'p' && words.length === 1 ? 's' : type;
      out.push({ kind, type: t, words, weight: (t === 'p' ? 3 : 2) * (KIND_WEIGHT[kind] ?? 1), label: raw });
    }
  }
  return out;
})();

// ─────────── 3. Xatoga chidamli taqqoslash ───────────

/** Levenshtein masofasi (chegaradan oshsa — erta to'xtaydi) */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

const tolerance = (len: number) => (len >= 10 ? 2 : len >= 5 ? 1 : 0);

/** So'z o'zak bilan boshlanadimi: 1 — aniq, 0.6 — xato bilan, 0 — yo'q */
function stemMatch(token: string, stem: string): number {
  if (token.startsWith(stem)) return 1;
  const tol = tolerance(stem.length);
  if (!tol || token.length < stem.length - tol || token[0] !== stem[0]) return 0;
  for (let d = -tol; d <= tol; d++) {
    const n = stem.length + d;
    if (n < 3 || n > token.length) continue;
    if (distance(token.slice(0, n), stem, tol) <= tol) return 0.6;
  }
  return 0;
}

/** Butun so'z (qo'shimchalari bilan) */
function wordMatch(token: string, word: string): number {
  for (const suf of W_SUF) if (token === word + suf) return 1;
  const tol = word.length >= 5 ? 1 : 0;
  if (!tol || token[0] !== word[0]) return 0;
  for (const suf of ['', 'i', 'ga', 'da']) if (distance(token, word + suf, tol) <= tol) return 0.6;
  return 0;
}

// ─────────── 4. Ball va qaror ───────────

const cache = new Map<string, SmartResult>();
const CACHE_MAX = 20000;

export function smartKind(purpose: string): SmartResult {
  const body = purposeBody(purpose);
  // Kesh — asl matn bo'yicha (topilgan so'zlar asl ko'rinishda qaytadi)
  const cacheKey = body.toLowerCase().replace(/\s+/g, ' ').trim();
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  // So'zlar: asl ko'rinishi (tushuntirish uchun) va bir xillashgani (taqqoslash uchun)
  const words = body.split(/[^\p{L}'’ʻʼ‘`]+/u).filter(Boolean);
  const originals: string[] = [];
  const tokens: string[] = [];
  for (const w of words) {
    const f = fold(w).replace(/ /g, '');
    if (!f) continue;
    tokens.push(f);
    originals.push(w);
  }
  const scores = new Map<PayoutKind, number>();
  const hits = new Map<PayoutKind, string[]>();
  const add = (kind: PayoutKind, v: number, label: string) => {
    scores.set(kind, (scores.get(kind) ?? 0) + v);
    const h = hits.get(kind) ?? [];
    if (!h.includes(label)) h.push(label);
    hits.set(kind, h);
  };
  for (const c of COMPILED) {
    let best = 0;
    let at = -1;
    if (c.type === 'p') {
      // Ibora: ketma-ket so'zlar (har biri o'zak sifatida; oraliqda bitta ortiqcha so'z bo'lishi mumkin)
      for (let i = 0; i < tokens.length; i++) {
        let q = 1;
        let j = i;
        let ok = true;
        for (let w = 0; w < c.words.length; w++) {
          let m = j < tokens.length ? stemMatch(tokens[j]!, c.words[w]!) : 0;
          if (!m && w > 0 && j + 1 < tokens.length) {
            m = stemMatch(tokens[j + 1]!, c.words[w]!) * 0.9;
            if (m) j += 1;
          }
          if (!m) {
            ok = false;
            break;
          }
          q = Math.min(q, m);
          j += 1;
        }
        if (ok && q > best) {
          best = q;
          at = i;
        }
      }
    } else {
      for (let i = 0; i < tokens.length; i++) {
        const m = c.type === 's' ? stemMatch(tokens[i]!, c.words[0]!) : wordMatch(tokens[i]!, c.words[0]!);
        if (m > best) {
          best = m;
          at = i;
        }
      }
    }
    if (best > 0) add(c.kind, c.weight * best, originals.slice(at, at + Math.max(1, c.words.length)).join(' ').toLowerCase());
  }
  // Bir guruhda bir nechta yozuv bitta so'zga tushsa — ballni cheklash (o'zak va ibora takrori)
  const ranked = [...scores.entries()]
    .map(([kind, score]) => ({ kind, score: Math.min(score, 6) }))
    .sort((a, b) => b.score - a.score || PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  let result: SmartResult;
  if (!ranked.length) result = { kind: 'BOSHQA', confidence: 'NONE', score: 0, alt: null, hits: [] };
  else {
    const top = ranked[0]!;
    const second = ranked[1];
    // Ikkinchi guruh ham aniq topilgan (≥ 2 ball) yoki deyarli teng — qaysi biri ekanini odam hal qilsin
    const close = second && (second.score >= top.score * 0.75 || second.score >= 2) && second.kind !== 'ISH_HAQI' && !COMPATIBLE.has(`${top.kind}>${second.kind}`) && !COMPATIBLE.has(`${second.kind}>${top.kind}`);
    const weak = top.score < 1.5;
    result = {
      kind: top.kind,
      confidence: weak || close ? 'LOW' : 'HIGH',
      score: Math.round(top.score * 10) / 10,
      alt: close ? second!.kind : weak && second ? second.kind : null,
      hits: hits.get(top.kind) ?? [],
    };
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(cacheKey, result);
  return result;
}
