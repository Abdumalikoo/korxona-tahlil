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
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
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
    if (distance(q, head, lim) <= lim) return 0.75;
    if (distance(q, w.slice(0, q.length + 1), lim) <= lim || distance(q, w.slice(0, Math.max(1, q.length - 1)), lim) <= lim) return 0.7;
  }
  return 0;
}

export interface SmartQuery {
  /** Izlanayotgan so'zlar (har biri — variantlari bilan) */
  terms: { word: string; variants: string[] }[];
  /** Matn → moslik bali (0 — mos emas) */
  score: (text: string) => number;
}

/** So'rovni tayyorlash; bo'sh bo'lsa — null. Raqamlar (INN, hujjat №, summa) — aynan qism sifatida izlanadi */
export function smartQuery(input: string): SmartQuery | null {
  const words = normText(input).split(' ').filter(Boolean);
  if (!words.length) return null;
  const terms = words.map((word) => {
    // Ma'nodosh so'zlar guruhi: aynan, so'z boshi bo'yicha yoki 1 harf xato bilan («ijra» → ijara, «arnda» → arenda)
    const keys = [...SYN_INDEX.keys()];
    const key =
      (SYN_INDEX.has(word) ? word : null) ??
      (word.length >= 4 ? keys.find((k) => k.startsWith(word) || word.startsWith(k)) : undefined) ??
      (word.length >= 4 ? keys.find((k) => k.length >= 4 && distance(word, k.slice(0, word.length + 1), 1) <= 1) : undefined);
    const syn = key ? SYN_INDEX.get(key) : undefined;
    return { word, variants: [...new Set([word, ...(syn ?? [])])] };
  });
  const score = (text: string) => {
    const norm = normText(text);
    if (!norm) return 0;
    const tokens = norm.split(' ');
    let total = 0;
    for (const t of terms) {
      let best = 0;
      if (/^\d+$/.test(t.word)) best = norm.replace(/\s/g, '').includes(t.word) ? 1 : 0;
      else
        for (const v of t.variants) {
          // Ko'p so'zli variant («ish haqi») — butun matnda
          if (v.length >= 6 && norm.replace(/\s/g, '').includes(v)) best = Math.max(best, v === t.word ? 1 : 0.9);
          for (const w of tokens) {
            const s = wordScore(v, w) * (v === t.word ? 1 : 0.9);
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
  return { terms, score };
}
