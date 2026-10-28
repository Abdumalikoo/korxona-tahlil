// ═══════════════════════════════════════════════════════════
// Bank ko'chirmasi › Ajralib turgan to'lovlar (sof hisob — baza yo'q, testlanadi).
// Tanlangan davrdagi har to'lov uchun uchta belgi (bir to'lovda bir nechtasi bo'lishi mumkin):
//  • ONCE   — bir martalik: shu kontragentga (tashkilot; jismoniy shaxslar — umumiy guruh emas) davrda faqat bitta to'lov;
//  • AMOUNT — odatdan tashqari summa: shu guruhning (kamida 5 to'lov) odatiy (median) summasidan chiqimda 3, kirimda
//             5 baravar katta yoki kichik (kirim tabiiy ravishda ko'proq tebranadi);
//  • TEXT   — izohi butunlay boshqacha: shu turdagi (masalan, «Ish haqi») kamida 5 to'lov ichida izohi eng o'xshash
//             to'lovga ham 20 foizdan kam o'xshaydi (so'zlar to'plami bo'yicha; sana, raqam, summa e'tiborga olinmaydi).
// Foydalanuvchi «oddiy» deb belgilagani — ro'yxatda «oddiy» bo'lib qoladi (sukut bo'yicha ko'rsatilmaydi).
// ═══════════════════════════════════════════════════════════

export type OutlierCode = 'ONCE' | 'AMOUNT' | 'TEXT';

export interface OutlierRow {
  key: string;
  dir: 'OUT' | 'IN';
  amountTiyin: bigint;
  purpose: string;
  /** Kontragent kaliti (inn:…, name:…, person) */
  counterparty: string;
  /** O'xshashlik guruhi */
  group: string;
  /** Tur (guruh turi) */
  kind: string;
}

export interface OutlierHit {
  key: string;
  reasons: { code: OutlierCode; text: string }[];
  /** Saralash: sabablar soni, keyin summa */
  score: number;
}

export const AMOUNT_FACTOR: Record<'OUT' | 'IN', number> = { OUT: 3, IN: 5 };
/** Eng o'xshash to'lov bilan o'xshashlik (umumiy so'zlar / hamma so'zlar) shundan kam — «butunlay boshqacha» */
export const TEXT_MAX_SIMILARITY = 0.2;
const MIN_GROUP_AMOUNT = 5;
const MIN_KIND_TEXT = 5;

const STOP = new Set([
  'от', 'для', 'по', 'за', 'на', 'из', 'без', 'или', 'при', 'сум', 'сўм', 'сумма', 'суммы', 'som', 'год', 'года', 'йил', 'yil', 'ойи', 'учун', 'uchun', 'oyi',
  'ндс', 'qqs', 'том', 'числе', 'шу', 'жумладан', 'jumladan', 'согласно', 'асосан', 'asosan', 'основании', 'va', 'ва', 'the',
]);

/** Izoh so'zlari: sana, raqam, belgilarsiz; kamida 3 harf */
export function words(purpose: string): string[] {
  return [
    ...new Set(
      String(purpose ?? '')
        .toLowerCase()
        .replace(/[ʻʼ‘’`']/g, '')
        .replace(/\d+([.,/-]\d+)*/g, ' ')
        .replace(/[^\p{L}\s]+/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !STOP.has(w)),
    ),
  ];
}

/** O'xshashlik: umumiy so'zlar / birlashma (Jaccard) */
export function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sb = new Set(b);
  const common = a.filter((w) => sb.has(w)).length;
  return common / (a.length + b.length - common);
}

const median = (xs: bigint[]) => {
  const s = [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2n;
};
const fmt = (t: bigint) => `${(Number(t) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 0 }).replace(/,/g, ' ')} so'm`;
const times = (x: number) => x.toFixed(1).replace('.', ',');

export function findOutliers(rows: OutlierRow[], opts: { months: number; kindLabel?: (kind: string) => string } = { months: 1 }): OutlierHit[] {
  const hits = new Map<string, OutlierHit>();
  const hit = (r: OutlierRow, code: OutlierCode, text: string) => {
    const h = hits.get(r.key) ?? { key: r.key, reasons: [], score: 0 };
    if (!h.reasons.some((x) => x.code === code)) h.reasons.push({ code, text });
    hits.set(r.key, h);
  };
  const by = (f: (r: OutlierRow) => string) => {
    const m = new Map<string, OutlierRow[]>();
    for (const r of rows) m.set(f(r), [...(m.get(f(r)) ?? []), r]);
    return m;
  };

  // 1) Bir martalik — kontragent bo'yicha (davr bir oydan uzun bo'lsa)
  if (opts.months > 1)
    for (const [cp, list] of by((r) => `${r.dir}|${r.counterparty}`)) {
      if (list.length !== 1 || cp.endsWith('|person')) continue;
      hit(list[0]!, 'ONCE', 'bu kontragentga davr ichida bitta to‘lov');
    }

  // 2) Odatdan tashqari summa — guruh ichida
  for (const list of by((r) => r.group).values()) {
    if (list.length < MIN_GROUP_AMOUNT) continue;
    const med = median(list.map((r) => r.amountTiyin));
    if (med <= 0n) continue;
    const f = BigInt(AMOUNT_FACTOR[list[0]!.dir]);
    for (const r of list) {
      if (r.amountTiyin >= med * f) hit(r, 'AMOUNT', `odatiy summadan ${times(Number(r.amountTiyin) / Number(med))} baravar katta (odatda ~${fmt(med)})`);
      else if (r.amountTiyin > 0n && r.amountTiyin * f <= med) hit(r, 'AMOUNT', `odatiy summadan ${times(Number(med) / Number(r.amountTiyin))} baravar kichik (odatda ~${fmt(med)})`);
    }
  }

  // 3) Izohi butunlay boshqacha — tur ichida eng o'xshash to'lov bilan
  for (const [k, list] of by((r) => `${r.dir}|${r.kind}`)) {
    if (list.length < MIN_KIND_TEXT) continue;
    // Bir xil izohlar bir marta solishtiriladi (tezlik)
    const uniq = new Map<string, { w: string[]; n: number }>();
    for (const r of list) {
      const w = words(r.purpose);
      const key = w.slice().sort().join(' ');
      const u = uniq.get(key) ?? { w, n: 0 };
      u.n += 1;
      uniq.set(key, u);
    }
    const all = [...uniq.entries()];
    const best = new Map<string, number>();
    for (const [ka, a] of all) {
      // Aynan shu izoh boshqa to'lovda ham bo'lsa — o'xshash bor
      let s = a.n > 1 ? 1 : 0;
      for (const [kb, b] of all) {
        if (s >= TEXT_MAX_SIMILARITY) break;
        if (kb !== ka) s = Math.max(s, similarity(a.w, b.w));
      }
      best.set(ka, s);
    }
    const label = opts.kindLabel?.(k.split('|')[1]!) ?? k.split('|')[1]!;
    for (const r of list) {
      const w = words(r.purpose);
      if (w.length < 2) continue;
      const s = best.get(w.slice().sort().join(' ')) ?? 1;
      if (s < TEXT_MAX_SIMILARITY) hit(r, 'TEXT', `izohi «${label}» turidagi boshqa ${list.length - 1} ta to‘lovning hech biriga o‘xshamaydi (eng yaqini ${Math.round(s * 100)}%)`);
    }
  }

  const amount = new Map(rows.map((r) => [r.key, r.amountTiyin]));
  return [...hits.values()]
    .map((h) => ({ ...h, score: h.reasons.length * 1e15 + Number(amount.get(h.key) ?? 0n) }))
    .sort((a, b) => b.score - a.score);
}
