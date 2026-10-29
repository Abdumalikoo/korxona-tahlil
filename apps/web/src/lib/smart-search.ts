// ═══════════════════════════════════════════════════════════
// Aqlli qidiruv (bank ko'chirmasi va boshqa ro'yxatlar): yozilgan so'zlar matnda bormi —
//   • kirill / lotin farq qilmaydi («аренда» = «arenda», «Аndijon» — aralash harf);
//   • qo'shimcha farq qilmaydi (so'z boshi: «ijaraga», «ijarasi» = «ijara»);
//   • 1–2 harf xato yoki tushib qolgan («ijra», «arnda», «elktr») ham topiladi;
//   • ma'nodosh so'zlar: «ijara» → аренда, «elektr» → электроэнергия, «soliq» → налог …
// Hamma so'z topilsa — mos (VA); natija — moslik bali (kattasi yaxshiroq), mos bo'lmasa — 0.
// ═══════════════════════════════════════════════════════════

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu',
  я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h', і: 'i',
};

/** Solishtirish uchun: kichik harf, kirill → lotin, tutuq belgilarisiz, faqat harf va raqam so'zlari */
export function normText(value: string): string {
  return Array.from(String(value ?? '').toLowerCase(), (ch) => CYR[ch] ?? ch)
    .join('')
    .replace(/[ʻʼ‘’`'´]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Ma'nodosh so'zlar (o'zak ko'rinishida, lotinda): bittasi yozilsa — hammasi izlanadi */
const SYNONYMS: string[][] = [
  ['ijara', 'arenda', 'ijar'],
  ['elektr', 'elektroenerg', 'energiya', 'svet'],
  ['suv', 'voda', 'vodosnab', 'vodokanal', 'vodootvod'],
  ['gaz', 'gazosnab', 'prirodn'],
  ['kommunal', 'komunal', 'kommunaln'],
  ['internet', 'svyaz', 'aloqa', 'telekom', 'uztelekom', 'provayder'],
  ['telefon', 'mobil', 'sotov', 'uzmobile', 'beeline', 'ucell'],
  ['soliq', 'nalog', 'byudjet', 'budjet', 'ndfl', 'qqs', 'nds'],
  ['ishhaqi', 'zarplat', 'zarabot', 'oylik', 'ish haqi'],
  ['yoqilgi', 'benzin', 'toplivo', 'gsm', 'propan', 'metan', 'dizel'],
  ['sugurta', 'straxov', 'strahov'],
  ['jarima', 'penya', 'peni', 'shtraf', 'neustoyk'],
  ['komissiya', 'komissiy', 'xizmat haqi'],
  ['tamir', 'remont'],
  ['xizmat', 'uslug', 'servis'],
  ['qaytar', 'vozvrat', 'qaytarish'],
  ['depozit', 'deposit'],
  ['kredit', 'zaym', 'qarz', 'ssuda'],
  ['kanselyar', 'kanstovar', 'kants', 'kanc'],
  ['oziq', 'ovqat', 'pitanie', 'produkt'],
  ['transport', 'avtotrans', 'perevoz', 'tashish'],
  ['mebel', 'jihoz'],
  ['kompyuter', 'noutbuk', 'printer', 'orgtexn'],
  ['dastur', 'litsenz', 'programm', 'obuna', 'podpisk'],
  ['reklama', 'marketing', 'reklam'],
  ['trening', 'seminar', 'oqitish', 'obuchen', 'kurs'],
  ['safar', 'komandirov', 'xizmat safari'],
  ['pochta', 'kuryer', 'dostavk'],
];
const SYN_INDEX = (() => {
  const m = new Map<string, string[]>();
  for (const group of SYNONYMS) {
    const g = group.map((w) => w.replace(/\s+/g, ''));
    for (const w of g) m.set(w, g);
  }
  return m;
})();

/** Levenshtein masofasi (limitdan oshsa — erta to'xtaydi) */
function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      // Yonma-yon almashgan harflar («ijra» ↔ «ijar») — bitta xato
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prevPrev[j - 2]! + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    prevPrev = prev;
    prev = cur;
  }
  return prev[b.length]!;
}

/** Bitta izlanayotgan so'z (variant) va matndagi so'z mosligi: 1 — aynan / boshi, 0.85 — o'zak, 0.7 — xato harf, 0 — yo'q */
function wordScore(q: string, w: string): number {
  if (w === q) return 1;
  if (q.length <= 2) return w.startsWith(q) ? 0.9 : 0;
  if (w.startsWith(q)) return 0.95;
  if (q.length >= 5 && q.startsWith(w) && w.length >= 4) return 0.85;
  // Qisqa so'zda (5 harfgacha) xato faqat o'rtada: birinchi harf mos bo'lsin («ijra» ≠ «ajratma»)
  if (q.length >= 4 && (q.length > 5 || q[0] === w[0])) {
    // So'z boshini solishtirish (qo'shimchasiz): «ijra» ~ «ijaraga» ning boshi «ijar»
    const lim = q.length >= 7 ? 2 : 1;
    const head = w.slice(0, q.length);
    if (head.length === q.length && distance(q, head, lim) <= lim) return 0.75;
    // Bitta harf tushib qolgan («elktr» ~ «elektr…»): so'z boshi bittaga uzun
    if (w.length > q.length && distance(q, w.slice(0, q.length + 1), lim) <= lim) return 0.7;
  }
  return 0;
}

export interface SmartQuery {
  /** Izlanayotgan so'zlar (har biri — variantlari bilan) */
  /** strict — xato yozilgan so'z lug'at orqali tuzatilgan: asl so'z faqat aynan / so'z boshi bo'yicha */
  terms: { word: string; variants: string[]; strict?: boolean }[];
  /** Chiqarib tashlanadigan so'zlar («-terminal») — bular bor matn mos emas */
  excluded: string[];
  /** Matn → moslik bali (0 — mos emas) */
  score: (text: string) => number;
}

/** So'rovni tayyorlash; bo'sh bo'lsa — null. Raqamlar (INN, hujjat №, summa) — aynan qism sifatida izlanadi */
export function smartQuery(input: string): SmartQuery | null {
  // «-so'z» / «−so'z» — chiqarib tashlash; qolganlari — izlanadi
  const raw = String(input ?? '').trim().split(/\s+/).filter(Boolean);
  const excluded = raw.filter((w) => /^[-−]/.test(w)).flatMap((w) => normText(w.slice(1)).split(' ')).filter((w) => w.length >= 2);
  const words = normText(raw.filter((w) => !/^[-−]/.test(w)).join(' ')).split(' ').filter(Boolean);
  if (!words.length) return null;
  const terms = words.map((word) => {
    // Ma'nodosh so'zlar guruhi: aynan, so'z boshi bo'yicha yoki 1 harf xato bilan («ijra» → ijara, «arnda» → arenda)
    const keys = [...SYN_INDEX.keys()];
    const key =
      (SYN_INDEX.has(word) ? word : null) ??
      (word.length >= 4 ? keys.find((k) => k.startsWith(word) || word.startsWith(k)) : undefined) ??
      (word.length >= 4 ? keys.find((k) => k.length >= 4 && distance(word, k.slice(0, word.length + 1), 1) <= 1) : undefined);
    const syn = key ? SYN_INDEX.get(key) : undefined;
    // Xato yozilgan so'z lug'at orqali tuzatilgan bo'lsa («ijra» → ijara) — asl so'zning o'zi faqat aynan / so'z boshi
    // bo'yicha izlanadi (xato harf bilan emas: aks holda «ijra» → «ijro», MIB to'lovlari chiqardi)
    const strict = Boolean(syn && key) && !syn!.includes(word) && !key!.startsWith(word) && !word.startsWith(key!);
    return { word, variants: [...new Set([word, ...(syn ?? [])])], strict };
  });
  const score = (text: string) => {
    const norm = normText(text);
    if (!norm) return 0;
    const tokens = norm.split(' ');
    // Chiqarib tashlanganlardan biri bor — mos emas (so'z boshi bo'yicha: «-terminal» → «terminallar»)
    if (excluded.some((x) => (/^\d+$/.test(x) ? norm.replace(/\s/g, '').includes(x) : tokens.some((w) => w.startsWith(x))))) return 0;
    let total = 0;
    for (const t of terms) {
      let best = 0;
      if (/^\d+$/.test(t.word)) best = norm.replace(/\s/g, '').includes(t.word) ? 1 : 0;
      else
        for (const v of t.variants) {
          // Ko'p so'zli variant («ish haqi») — butun matnda
          if (v.length >= 6 && norm.replace(/\s/g, '').includes(v)) best = Math.max(best, v === t.word ? 1 : 0.9);
          for (const w of tokens) {
            const s = v === t.word && t.strict ? (w.startsWith(v) ? 0.95 : 0) : wordScore(v, w) * (v === t.word ? 1 : 0.9);
            if (s > best) best = s;
            if (best === 1) break;
          }
          if (best === 1) break;
        }
      if (best === 0) return 0;
      total += best;
    }
    return total / terms.length;
  };
  return { terms, excluded, score };
}

/** Ajratish uchun keraksiz umumiy so'zlar (to'lov izohlarida ko'p uchraydi, ma'no farqlamaydi) */
const STOP = new Set(['oplata', 'opl', 'tolov', 'tulov', 'tolovi', 'tulovi', 'summa', 'summasi', 'sum', 'som', 'uchun', 'boyicha', 'buyicha', 'shartnoma', 'shartnomaga', 'dogovor', 'dogovoru', 'dog', 'schet', 'schetu', 'faktura', 'akt', 'nds', 'qqs', 'bez', 'vkl', 'tom', 'chisle', 'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr', 'yanvar', 'yanvarya', 'fevralya', 'marta', 'aprelya', 'maya', 'iyunya', 'iyulya', 'avgusta', 'sentyabrya', 'oktyabrya', 'noyabrya', 'dekabrya', 'god', 'goda', 'yil', 'yilga', 'oy', 'oyi', 'mchj', 'ooo', 'ajj', 'aj', 'xk', 'chp', 'ip',
  // Shartnoma rasmiyatchiligi va oy qisqartmalari — hamma to'lovda bor, ajratmaydi
  'asosan', 'asosida', 'sonli', 'sonly', 'oylari', 'oylar', 'oylik', 'kushimcha', 'qoshimcha', 'kelishuv', 'kelishuvga', 'kelishuvi', 'perebros', 'perechislenie', 'summi', 'summy',
  'viloyati', 'viloyat', 'tumani', 'tuman', 'shaxar', 'shahar', 'shahri', 'yanv', 'fevr', 'avg', 'sent', 'sentyabr', 'okt', 'noyab', 'dek', 'soglasno', 'osnovanii', 'plata', 'platezh', 'pul', 'mablag', 'mablagi',
  'utkazilmo', 'utkazilmokda', 'otkazilmoqda', 'otkazildi', 'utkazildi', 'dagi', 'resp', 'respublika']);
/** Oy nomidan yasalgan so'zlar («apreldagi», «yanvarga», «за марта») — ajratmaydi */
const MONTH_FORM = /^(yanvar|fevral|mart|aprel|iyun|iyul|avgust|sentabr|sentyabr|oktabr|oktyabr|noyabr|dekabr)[a-z]*$/;

/**
 * Natijalarni ajratish: topilgan matnlarda eng ko'p uchraydigan farqlovchi so'zlar («terminal 34», «ofis 20»).
 * Izlanayotgan so'zlar, umumiy so'zlar va hamma matnda bor so'zlar chiqmaydi.
 */
export function facetWords(texts: string[], q: SmartQuery | null, limit = 12): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const seen = new Set<string>();
    for (const w of normText(t).split(' ')) {
      if (w.length < 4 || /\d/.test(w) || STOP.has(w) || MONTH_FORM.test(w) || seen.has(w)) continue;
      // Izlanayotgan so'zning o'zi / variantlari — ajratmaydi
      if (q && q.terms.some((term) => term.variants.some((v) => wordScore(v, w) > 0))) continue;
      seen.add(w);
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    // Natijalarning yarmidan ko'pida bor so'z — ajratmaydi (hamma ijarada «asosan», «sonli» …)
    .filter(([, n]) => n >= 2 && n <= texts.length / 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}
