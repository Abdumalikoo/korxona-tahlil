// ═══════════════════════════════════════════════════════════
// Ijara importi — hudud va tuman nomlarini tanib olish
//
// Excel'da nomlar turlicha yoziladi: kirillcha («Хўжаобод тумани»), katta harfda («CHUST TUMAN»),
// qisqartma bilan («Кармана т», «Зарафшон ш»), apostrof o'rniga ` yoki ‘ bilan («DO`STLIK»).
// Shu yerda hammasi bitta kalitga keltiriladi: lotincha, kichik harf, belgilarsiz, turi (shahar / tuman) alohida.
// Aniq mos kelmasa — eng yaqin nom (1–2 harf farq) taklif qilinadi.
// ═══════════════════════════════════════════════════════════

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's',
  ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ь: '', ы: 'i', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g',
  ҳ: 'h', і: 'i', ї: 'i', є: 'e', ң: 'ng', ө: 'o', ү: 'u', ә: 'a',
};

/** Kirill → lotin (o'zbekcha), kichik harflarda */
export function translit(value: string): string {
  let out = '';
  for (const ch of value.toLowerCase()) out += CYRILLIC[ch] ?? ch;
  return out;
}

export type PlaceKind = 'city' | 'district' | 'region' | null;

const SUFFIX_KIND: Record<string, Exclude<PlaceKind, null>> = {
  shahri: 'city', shahar: 'city', shaxri: 'city', shaxar: 'city', sh: 'city', shah: 'city',
  tumani: 'district', tuman: 'district', tum: 'district', t: 'district',
  viloyati: 'region', viloyat: 'region', vil: 'region', v: 'region',
  respublikasi: 'region', respublika: 'region', resp: 'region',
};

export interface PlaceKey {
  /** Nomning o'zi: "xojaobod", "toshkent" */
  base: string;
  /** Qo'shimchadan: shahar / tuman / viloyat */
  kind: PlaceKind;
  /** To'liq (qo'shimcha bilan) kalit */
  full: string;
}

/** "Хўжаобод тумани" → { base: 'xojaobod', kind: 'district' } */
export function placeKey(value: string): PlaceKey {
  const latin = translit(value)
    .replace(/[‘’ʻʼ`'"«»]/g, '')
    .replace(/\(.*?\)/g, ' ');
  const words = latin.split(/[^a-z0-9]+/).filter(Boolean);
  let kind: PlaceKind = null;
  while (words.length > 1) {
    const last = words[words.length - 1] as string;
    const found = SUFFIX_KIND[last];
    if (!found) break;
    kind = kind ?? found;
    words.pop();
  }
  const base = words.join('');
  return { base, kind, full: `${base}${kind ?? ''}` };
}

/** Levenshtein masofasi (qisqa satrlar uchun) */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length] as number;
}

export interface MatchResult<T> {
  item: T | null;
  /** Aniq emas, taxminiy moslik — ogohlantirish matni */
  approximate: boolean;
  /** Bir nechta mos — qaysi biri olinganini aytish uchun */
  ambiguous: boolean;
}

/**
 * Nomlar ro'yxatidan eng mosini topadi:
 *  1) to'liq kalit (nom + turi) bir xil;
 *  2) nom bir xil, turi mos (yoki biri ko'rsatilmagan) — yagona bo'lsa;
 *  3) 1–2 harf farqli yagona eng yaqin nom (taxminiy).
 */
export function matchPlace<T>(text: string, items: { key: PlaceKey; item: T }[]): MatchResult<T> {
  const key = placeKey(text);
  if (!key.base) return { item: null, approximate: false, ambiguous: false };

  const sameBase = items.filter((x) => x.key.base === key.base);
  const exact = sameBase.filter((x) => x.key.kind === key.kind);
  if (exact.length >= 1) return { item: exact[0]!.item, approximate: false, ambiguous: exact.length > 1 };

  const compatible = sameBase.filter((x) => !key.kind || !x.key.kind);
  if (compatible.length === 1) return { item: compatible[0]!.item, approximate: false, ambiguous: false };
  if (sameBase.length === 1) return { item: sameBase[0]!.item, approximate: !!key.kind && !!sameBase[0]!.key.kind, ambiguous: false };
  if (sameBase.length > 1) {
    // Turi ko'rsatilmagan va shahar ham, tuman ham bor — tumanni olamiz
    const district = sameBase.find((x) => x.key.kind === 'district') ?? sameBase[0]!;
    return { item: district.item, approximate: false, ambiguous: true };
  }

  const limit = key.base.length >= 9 ? 2 : key.base.length >= 5 ? 1 : 0;
  if (limit === 0) return { item: null, approximate: false, ambiguous: false };
  let best: { d: number; list: { key: PlaceKey; item: T }[] } = { d: limit + 1, list: [] };
  for (const x of items) {
    if (key.kind && x.key.kind && key.kind !== x.key.kind) continue;
    const d = distance(key.base, x.key.base);
    if (d < best.d) best = { d, list: [x] };
    else if (d === best.d) best.list.push(x);
  }
  if (best.list.length === 1 && best.d <= limit) return { item: best.list[0]!.item, approximate: true, ambiguous: false };
  return { item: null, approximate: false, ambiguous: false };
}