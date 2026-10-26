// ═══════════════════════════════════════════════════════════
// 23106 hisob raqami ko'chirmasi — «Назначение платежа» izohidan:
//  • nima uchun to'langan (bayram puli, mukofot, xizmat safari, moddiy yordam, ta'til puli, ish haqi …);
//  • asos — buyruq sanasi va raqami («29.12.2025 даги 358-if-sonli buyruqqa asosan …»);
//  • xodimning F.I.Sh. («… сотруднику FAMILIYA ISM OTASINING ISMI»).
// Kirill va lotin yozuvida, katta-kichik harfdan qat'i nazar.
// ═══════════════════════════════════════════════════════════

export type PayoutKind = 'BAYRAM' | 'MUKOFOT' | 'SAFAR' | 'MODDIY' | 'TATIL' | 'KASALLIK' | 'ISH_HAQI' | 'BOSHQA';

export const KIND_LABELS: Record<PayoutKind, string> = {
  BAYRAM: 'Bayram puli',
  MUKOFOT: 'Mukofot (premiya)',
  SAFAR: 'Xizmat safari',
  MODDIY: 'Moddiy yordam',
  TATIL: "Ta'til puli",
  KASALLIK: 'Kasallik varaqasi',
  ISH_HAQI: 'Ish haqi / avans',
  BOSHQA: 'Boshqa',
};

/** Tartib muhim: aniqrog'i oldin («bayram mukofoti» — bayram) */
const KIND_RULES: { kind: PayoutKind; re: RegExp }[] = [
  { kind: 'BAYRAM', re: /bayram|байрам|праздн/i },
  { kind: 'SAFAR', re: /xizmat\s*safar|хизмат\s*сафар|командиров|komandirov|safar\s*xarajat|сафар\s*харажат/i },
  { kind: 'MODDIY', re: /moddiy\s*yordam|моддий\s*ёрдам|моддий\s*ердам|мат\.?\s*помощ|материальн\w*\s*помощ/i },
  { kind: 'TATIL', re: /ta.?til\s*pul|таътил|отпуск|mehnat\s*ta.?til/i },
  { kind: 'KASALLIK', re: /kasallik|касаллик|больнич|vaqtincha\s*mehnatga/i },
  { kind: 'MUKOFOT', re: /mukofot|мукофот|преми|premiya|рағбат|rag.?bat/i },
  { kind: 'ISH_HAQI', re: /ish\s*haq|иш\s*ҳақ|иш\s*хақ|иш\s*хак|заработн|oylik|ойлик|аванс|avans/i },
];

export function purposeKind(text: string): PayoutKind {
  return KIND_RULES.find((r) => r.re.test(text))?.kind ?? 'BOSHQA';
}

/** Buyruq: «13.01.2026 даги 00003-son», «07.01.2026 йилдаги 00001-xs-son», «29.12.2025 даги 358-if-sonli» */
export function purposeOrder(text: string): { date: string | null; no: string | null } {
  const m = /(\d{1,2})\.(\d{1,2})\.(\d{4})\s*(?:й(?:ил)?\.?|y(?:il)?\.?)?\s*(?:даги|dagi|йилдаги|yildagi)?\s*([0-9][\p{L}\p{N}-]*?)\s*-?\s*(?:son|сон)/iu.exec(text);
  if (!m) {
    const d = /(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(text);
    return { date: d ? iso(d[1]!, d[2]!, d[3]!) : null, no: null };
  }
  return { date: iso(m[1]!, m[2]!, m[3]!), no: m[4]!.replace(/-+$/, '').slice(0, 40) };
}

function iso(d: string, m: string, y: string): string | null {
  const dd = Number(d);
  const mm = Number(m);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** Izohdagi xodim F.I.Sh. («сотруднику …», «xodimi …», «ходимига …») */
export function purposeName(text: string): string | null {
  const m = /(?:сотруднику|сотрудника|работнику|xodimi(?:ga)?|xodimga|ходими(?:га)?|ходимга)\s+(.{5,120})$/iu.exec(text.trim());
  if (!m) return null;
  const name = m[1]!.replace(/[.,;\s]+$/, '').replace(/\s+/g, ' ').trim();
  // F.I.Sh. — asosan bosh harflar, kamida ikki so'z
  const letters = name.replace(/[^\p{L}]/gu, '');
  const upper = name.replace(/[^\p{Lu}]/gu, '');
  if (name.split(' ').length < 2 || !letters.length || upper.length / letters.length < 0.7) return null;
  return name.slice(0, 120);
}

const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h' };

/** Ismni solishtirish kaliti: lotin, kichik harf, tutuq belgisiz; familiya va ism (birinchi ikki so'z) */
export function nameKey(full: string): string {
  const latin = full
    .toLowerCase()
    .replace(/[а-яёўқғҳ]/g, (ch) => TR[ch] ?? ch)
    .replace(/[‘’ʻʼ`'.]/g, '')
    .replace(/[^a-z\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return latin.split(' ').slice(0, 2).join(' ');
}

/** To'lov turi → ish haqi tarkibidagi komponentlar (nazorat uchun); null — nazorat qilinmaydi */
export function kindComponents(kind: PayoutKind, comps: { code: string; category: string }[]): Set<string> | null {
  const by = (pred: (c: { code: string; category: string }) => boolean) => new Set(comps.filter(pred).map((c) => c.code));
  switch (kind) {
    case 'BAYRAM':
      return by((c) => c.code === 'BAYRAM');
    case 'MUKOFOT':
      return by((c) => c.category === 'PREMIYA' && c.code !== 'BAYRAM');
    case 'MODDIY':
      return by((c) => c.code === 'MODDIY' || c.code === 'MODDIY_OKLAD');
    case 'TATIL':
      return by((c) => c.code === 'TATIL' || c.code === 'TATIL_KOMP');
    case 'KASALLIK':
      return by((c) => c.code === 'KASALLIK');
    default:
      return null;
  }
}

/** Oy nomlari (o'zbek lotin/kirill, rus) → oy raqami */
const MONTH_RES: [RegExp, number][] = [
  [/yanvar|январ/i, 1],
  [/fevral|феврал/i, 2],
  [/(?<![\p{L}])mart(?![\p{L}])|(?<![\p{L}])март(?:а|и)?(?![\p{L}])/iu, 3],
  [/aprel|апрел/i, 4],
  [/(?<![\p{L}])may(?:ning)?(?![\p{L}])|(?<![\p{L}])ма[йя](?:а|и|нинг)?(?![\p{L}])/iu, 5],
  [/iyun|июн/i, 6],
  [/iyul|июл/i, 7],
  [/avgust|август/i, 8],
  [/sentabr|sentyabr|сентябр|сентабр/i, 9],
  [/oktabr|oktyabr|октябр|октабр/i, 10],
  [/noyabr|ноябр/i, 11],
  [/dekabr|декабр/i, 12],
];

/**
 * Izohdagi «qaysi oy uchun» (masalan, «2026 йил январ ойи учун иш ҳақи», «за январь», «yanvar oyi uchun avans»).
 * Yil — izohdagi 4 xonali yil yoki to'lov sanasidan (oy to'lov oyidan keyin bo'lsa — o'tgan yil). Topilmasa — null.
 */
export function purposeMonth(text: string, docDate: string): string | null {
  // Faqat «… oy(i) uchun / за …» atrofidagi oy nomi — buyruq sanasi ichidagi sonlar emas
  // Xodim ismi qismi olib tashlanadi («… сотруднику YANVAROV …» oy deb olinmasin)
  const head = text.split(/сотрудник|работник|xodim|ходим/i)[0] ?? '';
  const hit = MONTH_RES.find(([re]) => re.test(head));
  if (!hit) return null;
  const m = hit[1];
  const years = [...head.matchAll(/(?<!\d)(20\d{2})\s*(?:-?\s*y(?:il)?\.?|-?\s*й(?:ил)?\.?|г\.?|года|йил)/giu)].map((x) => Number(x[1]));
  const payY = Number(docDate.slice(0, 4));
  const payM = Number(docDate.slice(5, 7));
  let y = years.length ? years[years.length - 1]! : payY;
  if (!years.length && m > payM + 1) y = payY - 1; // dekabr uchun yanvarda to'langan
  if (y < 2000 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * To'lov qaysi oy uchun (hisoblangan oy) — HAMMA modul shu qoidani ishlatadi (23106, uchlik nazorat, solishtirma):
 *  1) izohdagi «… oyi uchun» (to'lovdan 12 oy oldingidan keyingi oygacha bo'lsa);
 *  2) bo'lmasa — buyruq oyi (to'lovdan 13 oydan ko'p oldin emas);
 *  3) bo'lmasa — to'lov oyi.
 */
export function accrualMonth(purpose: string, docDate: string, orderDate: string | null): string {
  const named = purposeMonth(purpose ?? '', docDate);
  const payMonth = docDate.slice(0, 7);
  const lowest = `${Number(docDate.slice(0, 4)) - 1}-${docDate.slice(5, 7)}`;
  const [y, m] = payMonth.split('-').map(Number) as [number, number];
  const nextPay = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  if (named && named >= lowest && named <= nextPay) return named;
  if (orderDate && orderDate >= lowest && orderDate <= docDate.slice(0, 10)) return orderDate.slice(0, 7);
  return payMonth;
}

/** Bank to'lovi qaysi oyga olinadi: ACCRUAL — hisoblangan oy (yuqoridagi qoida), PAID — to'langan oy */
export function bankMonthOf(row: { purpose?: string | null; docDate: string; orderDate?: string | null }, mode: 'ACCRUAL' | 'PAID'): string {
  return mode === 'PAID' ? row.docDate.slice(0, 7) : accrualMonth(row.purpose ?? '', row.docDate, row.orderDate ?? null);
}
