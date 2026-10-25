// ═══════════════════════════════════════════════════════════
// 1C «Подразделения» daraxti — bo'lim kodlari (ID) va ularning tizimdagi joyi.
//
// HOZIRCHA ISHLATILMAYDI — faqat ma'lumotnoma. Kelajakda fayl / ma'lumot 1C bo'lim kodi bilan kelsa
// (masalan, «1.14.3.1» yoki «5.2. Tax Free Buxoro»), shu ro'yxat orqali to'g'ri joyga yo'naltiriladi:
//   resolveSubdivision('1.14.3.1') → Markaz (bo'lim: «Quyoshli xonadon», ota: 1.14.3 → 1.14 → 1)
//   resolveSubdivision('5.2')      → Tax free (filial hududi: Buxoro viloyati)
//
// Qoidalar:
//  • code — 1C dagi raqam aynan (nuqta bilan); id — tizimdagi unikal kalit (odatda code bilan bir xil).
//  • Joy (target) ota bo'limdan meros olinadi; bolada alohida yozilsa — o'sha (masalan, 1.18 — Buxgalteriya xizmatlari).
//  • unit: CENTER (Markaz), REGION (Hududlar) yoki yo'nalish (TAX_FREE, FERMER, BUXGALTERIYA, MARKSHEYDER);
//    regionCode — filial / bo'linma qaysi viloyatda (bo'lsa); level — hududiy bo'linma darajasi (viloyat / tuman).
//  • 1C da bir xil kod ikki marta bo'lsa (5.9 — Urganch va Namangan) — id farqlanadi, code bo'yicha qidirishda
//    nom ham kerak bo'ladi (aks holda «noaniq» qaytadi).
// Manba: 1C «Подразделения» skrinshotlari (2026-10-25). Yopiq (ochilmagan) shoxlarning ichi hali kiritilmagan.
// ═══════════════════════════════════════════════════════════

export type SubdivisionUnit = 'CENTER' | 'REGION' | 'TAX_FREE' | 'FERMER' | 'BUXGALTERIYA' | 'MARKSHEYDER';

export interface SubdivisionTarget {
  unit: SubdivisionUnit | null;
  /** Viloyat kodi (regions jadvali): filial yoki bo'linma joyi */
  regionCode?: number;
  /** Hududiy bo'linma darajasi */
  level?: 'VILOYAT' | 'TUMAN';
}

export interface Subdivision {
  /** Unikal kalit */
  id: string;
  /** 1C dagi kod (nuqtalar bilan, oxirgi nuqtasiz) */
  code: string;
  name: string;
  parentId: string | null;
  /** Shu bo'limda aniq belgilangan joy (bo'lmasa — otasidan) */
  target?: SubdivisionTarget;
  /** Ochiq savol / izoh */
  note?: string;
}

const s = (id: string, name: string, parentId: string | null, target?: SubdivisionTarget, note?: string, code = id): Subdivision => ({ id, code, name, parentId, ...(target ? { target } : {}), ...(note ? { note } : {}) });

export const SUBDIVISIONS: Subdivision[] = [
  // ─── 1. Markaziy apparati ───
  s('1', 'Markaziy apparati', null, { unit: 'CENTER' }),
  s('1.1', 'Rahbariyat', '1'),
  s('1.2', 'Ichki audit', '1'),
  s('1.3', 'Korporativ maslaxatchi', '1'),
  s('1.4', "Soliq xizmatining yagona axborot-maslahat \"Call-markazi\" bo'limi", '1'),
  s('1.5', "Soliq to'lovchilarga xizmat ko'rsatish markazi", '1'),
  s('1.6', "Buxgalteriya hisobi bo'limi", '1'),
  s('1.7', "Xaridlar va xo'jalik ishlari bo'yicha bosh mutaxassis", '1'),
  s('1.8', "Komplayens-nazorat xizmati bo'limi", '1'),
  s('1.9', "Kadrlar bilan ishlash bo'limi", '1'),
  s('1.10', 'Yuridik byuro', '1'),
  s('1.11', "Murojaatlar bilan ishlash va ijro nazorati bo'yicha bosh mutaxassis", '1'),
  s('1.12', 'Axborot xizmati', '1'),
  s('1.13', "Strategik rejalashtirish va yig'ma axborot-tahlil bo'limi", '1'),
  s('1.14', 'Axborot-kommunikatsiya texnologiyalari va raqamlashtirish boshqarmasi', '1'),
  s('1.14.1', "Tovar(xizmat)larning bozor narxini aniqlash bo'yicha xizmatlar ko'rsatish bo'limi", '1.14'),
  s('1.14.2', "Dasturiy mahsullar bilan ishlash va biznes jarayonlarni raqamlashtirish bo'limi", '1.14'),
  s('1.14.3', "To'lov tizimi va marketing bo'limi", '1.14'),
  s('1.14.3.1', 'Quyoshli xonadon', '1.14.3'),
  s('1.14.3.2', 'Ijtimoiy keshbek', '1.14.3'),
  s('1.14.3.3', '4% lik tushum', '1.14.3'),
  s('1.14.3.4', 'Reklama', '1.14.3'),
  s('1.15', "Raqamli texnologiyalar xalqaro markazi rezidentlariga xizmat ko'rsatish bo'limi", '1'),
  s('1.16', "Soliq to'lovchilarga xizmat ko'rsatish bo'yicha xududiy bo'linmalar faoliyatini muvofiqlashtirish bo'limi", '1'),
  s('1.17', "Dasturiy mahsullarni takomillashtirish bo'yicha loyiha menejerlari sho'basi", '1'),
  s('1.17.1', 'Virtual kassa', '1.17'),
  s('1.17.2', 'Elektron schot faktura', '1.17'),
  s('1.17.3', 'Virtual kassa HUDUD - Diller', '1.17', undefined, "Nomida «HUDUD» bor — Markazdami yoki hududlardami, aniqlash kerak"),
  s('1.18', "Soliq to'lovchilarga buxgalteriya xizmatlari ko'rsatish bo'limi", '1', { unit: 'BUXGALTERIYA' }, "Yo'nalish «Buxgalteriya xizmatlari» deb olindi"),
  s('1.18.1', 'Soliq maslahati', '1.18'),
  s('1.19', "Texnik va xizmat ko'rsatuvchi xodimlar", '1'),

  // ─── 2. Hududiy bo'linmalar ───
  s('2', "Soliq to'lovchilarga xizmat ko'rsatish bo'yicha viloyatlar hududiy bo'linmalari", null, { unit: 'REGION', level: 'VILOYAT' }, "Ichidagi viloyatlar (2.1, 2.2 …) hali kiritilmagan"),

  // ─── 3. GPX ───
  s('3', 'GPX', null, { unit: null }, "GPX (fuqarolik-huquqiy shartnoma) — qaysi joyga tegishli, aniqlash kerak"),

  // ─── 4. Fermer xo'jaliklari ───
  s('4', "Fermer xo'jaliklariga xizmat ko'rsatish bo'yicha hududiy bo'linmalar faoliyatini muvofiqlashtirish bo'limi", null, { unit: 'FERMER' }),
  s('4.1', "Fermer xo'jaliklariga xizmat ko'rsatish bo'yicha viloyat xududiy bo'linmalari", '4', { unit: 'FERMER', level: 'VILOYAT' }),
  s('4.2', "Fermer xo'jaliklariga xizmat ko'rsatish bo'yicha tuman hududiy bo'linmalari", '4', { unit: 'FERMER', level: 'TUMAN' }),

  // ─── 5. Tax free ───
  s('5', "Chet el fuqarolariga qo'shilgan qiymat solig'ini qaytarish bo'yicha \"Tax free\" filiali", null, { unit: 'TAX_FREE' }),
  s('5.1', 'Mobil ilova', '5'),
  s('5.2', 'Tax Free Buxoro', '5', { unit: 'TAX_FREE', regionCode: 6 }),
  s('5.3', 'Tax Free Samarqand', '5', { unit: 'TAX_FREE', regionCode: 18 }),
  s('5.4', "Tax Free Farg'ona", '5', { unit: 'TAX_FREE', regionCode: 30 }),
  s('5.5', 'Tax Free Nukus', '5', { unit: 'TAX_FREE', regionCode: 35 }),
  s('5.6', 'Tax Free Andijon', '5', { unit: 'TAX_FREE', regionCode: 3 }),
  s('5.7', 'Tax Free Qarshi', '5', { unit: 'TAX_FREE', regionCode: 10 }),
  s('5.8', 'Tax Free Termez', '5', { unit: 'TAX_FREE', regionCode: 22 }),
  s('5.9', 'Tax Free Urganch', '5', { unit: 'TAX_FREE', regionCode: 33 }, "1C da 5.9 kodi ikki marta (Urganch va Namangan)"),
  s('5.9#2', 'Tax Free Namangan', '5', { unit: 'TAX_FREE', regionCode: 14 }, "1C da kodi 5.9 (Urganch bilan bir xil) — 1C da 5.10 bo'lishi kerakmi?", '5.9'),

  // ─── 6. Marksheyderlik ───
  s('6', "Marksheyderlik xizmati bo'limi", null, { unit: 'MARKSHEYDER' }),
];

const BY_ID = new Map(SUBDIVISIONS.map((x) => [x.id, x]));

/** «1.14.3.1.» / « 1.14.3.1 » / «1.14.3.1. Quyoshli xonadon» → «1.14.3.1» */
export function normalizeSubdivisionCode(raw: string): string | null {
  const m = /^\s*(\d+(?:\.\d+)*)\.?(?:\s|$)/.exec(String(raw ?? ''));
  return m ? m[1]! : null;
}

const nameKey = (v: string) => v.toLowerCase().replace(/[‘’ʻʼ`'"«»]/g, '').replace(/\s+/g, ' ').trim();

export type SubdivisionMatch = { status: 'FOUND'; subdivision: Subdivision; path: Subdivision[]; target: SubdivisionTarget } | { status: 'AMBIGUOUS'; candidates: Subdivision[] } | { status: 'NOT_FOUND' };

/**
 * Kod (va kerak bo'lsa nom) → bo'lim, uning yo'li (ildizdan) va amaldagi joyi (meros bilan).
 * Kod 1C da takrorlansa — nom bo'yicha tanlanadi; nom berilmasa yoki mos kelmasa — AMBIGUOUS.
 */
export function resolveSubdivision(raw: string, name?: string): SubdivisionMatch {
  const code = normalizeSubdivisionCode(raw);
  if (!code) return { status: 'NOT_FOUND' };
  let list = SUBDIVISIONS.filter((x) => x.code === code);
  if (!list.length) return { status: 'NOT_FOUND' };
  if (list.length > 1) {
    const rest = String(raw).replace(/^\s*\d+(?:\.\d+)*\.?\s*/, '');
    const want = nameKey(name ?? rest);
    const picked = want ? list.filter((x) => nameKey(x.name) === want || nameKey(x.name).includes(want) || want.includes(nameKey(x.name))) : [];
    if (picked.length !== 1) return { status: 'AMBIGUOUS', candidates: list };
    list = picked;
  }
  const sub = list[0]!;
  const path: Subdivision[] = [];
  for (let cur: Subdivision | undefined = sub; cur; cur = cur.parentId ? BY_ID.get(cur.parentId) : undefined) path.unshift(cur);
  const target = [...path].reverse().find((x) => x.target)?.target ?? { unit: null };
  return { status: 'FOUND', subdivision: sub, path, target };
}
