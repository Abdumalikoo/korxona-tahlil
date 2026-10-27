// ═══════════════════════════════════════════════════════════
// Internet to'lovlari — fayldan o'qish (sof funksiyalar, bazaga tegmaydi).
//
// Ikki shakl:
//  1) Bank ko'chirmasidan olingan ro'yxat: har oy uchun ikki ustun — «summa» va «shartnoma» (to'lov izohi):
//        |        | Yanvar | Yanvar    | Fevral | Fevral    | …
//        |        | summa  | shartnoma | summa  | shartnoma | …
//  2) Dastur shabloni: «To'lovlar» varag'i — Oy | Summa | To'lov izohi | Shartnoma № (ixtiyoriy),
//     «Shartnomalar» varag'i — ro'yxat (kimga to'lanadi, nima uchun, qayerga biriktiriladi).
//
// To'lov izohidan shartnoma raqami va sanasi ajratiladi:
//   «… сог.дог№CPIO-2789 от 06.01.2025 г.»          → CPIO-2789, 06.01.2025
//   «26.11.2025-yildagi CPIO-4671-sonli shartnomaga» → CPIO-4671, 26.11.2025
//   «№1932368217 от 03.01.2025 dagi shartnomaga»     → 1932368217, 03.01.2025
//   «2026-yil 12-yanvardagi 1957194541-shartnomaga»  → 1957194541, 12.01.2026
// ═══════════════════════════════════════════════════════════

export interface ParsedPayment {
  /** Fayldagi joyi: «B3» yoki «To'lovlar!4» */
  ref: string;
  period: string;
  amountTiyin: bigint;
  /** To'lov izohi — bankdagi matn */
  text: string;
  contractNo: string | null;
  contractDate: string | null;
  /** «Предоплата» — oldindan to'lov */
  prepaid: boolean;
}

export interface RegistryRow {
  contractNo: string;
  contractDate: string | null;
  provider: string | null;
  purpose: string | null;
  /** center — Markaz (umumiy), dept:<id|nomi>, region:<kod|nomi> — shablondan o'qilganda nom bo'lishi mumkin */
  unitKind: 'center' | 'department' | 'region' | null;
  unitName: string | null;
}

export const MONTHS_UZ = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

/** Oy nomi (o'zbek / rus, lotin / kirill, qisqa) → 1..12 */
const MONTH_WORDS: [RegExp, number][] = [
  [/^(yanv|янв|jan)/, 1],
  [/^(fev|фев|feb)/, 2],
  [/^(mart|март|mar)/, 3],
  [/^(apr|апр)/, 4],
  [/^(may|май|мая)/, 5],
  [/^(iyun|июн|jun)/, 6],
  [/^(iyul|июл|jul)/, 7],
  [/^(avg|авг|aug)/, 8],
  [/^(sen|сен|sep)/, 9],
  [/^(okt|окт|oct)/, 10],
  [/^(noy|ноя|nov)/, 11],
  [/^(dek|дек|dec)/, 12],
];

export function monthOfWord(word: string): number | null {
  const w = word.trim().toLowerCase().replace(/[ʻʼ'`]/g, '');
  for (const [re, m] of MONTH_WORDS) if (re.test(w)) return m;
  return null;
}

/** Matndan oy va yil — oy nomi yonidagi yil: «январь 2026г», «Mart  2026yil», «2026-yil mart oyi» */
export function periodOfText(text: string): string | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ');
  const tries: [RegExp, number, number][] = [
    [/([a-zа-яё'ʻ`]{3,})\s*(20\d{2})\s*(?:г|y|-?yil|года)?/gi, 1, 2],
    [/(20\d{2})\s*-?\s*yil(?:ning)?\s+([a-zа-яё'ʻ`]{3,})/gi, 2, 1],
  ];
  for (const [re, wi, yi] of tries) {
    for (const m of t.matchAll(re)) {
      const w = m[wi]!;
      const month = monthOfWord(w);
      if (month && (w.length >= 4 || ['май', 'may', 'мая'].includes(w))) return `${m[yi]}-${String(month).padStart(2, '0')}`;
    }
  }
  return null;
}

function dmy(d: string, m: string, y: string): string | null {
  const day = Number(d);
  const month = Number(m);
  const year = Number(y.length === 2 ? `20${y}` : y);
  if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000 && year <= 2100)) return null;
  return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
}

function cleanNo(raw: string): string {
  return raw.replace(/^[№#\s]+/, '').replace(/[.,;:]+$/, '').trim().toUpperCase();
}

/** Shartnoma raqami va sanasi to'lov izohidan */
export function parseContract(text: string): { contractNo: string | null; contractDate: string | null } {
  const t = text.replace(/\s+/g, ' ');
  let no: string | null = null;
  let date: string | null = null;

  // 1) «сог.дог№X от DD.MM.YYYY» / «дог. № X от …» / «договор № X»
  let m = /(?:сог\.?\s*)?дог(?:овор[ауы]?)?\.?\s*№?\s*([A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9\-/.]*?)\.?\s+от\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i.exec(t);
  if (m) {
    no = cleanNo(m[1]!);
    date = dmy(m[2]!, m[3]!, m[4]!);
  }
  if (!no) {
    m = /(?:сог\.?\s*)?дог(?:овор[ауы]?)?\.?\s*№\s*([A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9\-/.]*)/i.exec(t);
    if (m) no = cleanNo(m[1]!);
  }
  // 2) «DD.MM.YYYY-yildagi X-sonli shartnoma»
  if (!no) {
    m = /(\d{1,2})\.(\d{1,2})\.(\d{4})\s*-?\s*y(?:il)?dagi\s+№?\s*([A-Za-z0-9][A-Za-z0-9\-/.]*?)\s*-?\s*sonli\s+shartnoma/i.exec(t);
    if (m) {
      no = cleanNo(m[4]!);
      date = dmy(m[1]!, m[2]!, m[3]!);
    }
  }
  if (!no) {
    m = /№?\s*([A-Za-z0-9][A-Za-z0-9\-/.]*?)\s*-?\s*sonli\s+shartnoma/i.exec(t);
    if (m) no = cleanNo(m[1]!);
  }
  // 3) «№X от DD.MM.YYYY dagi shartnoma»
  if (!no) {
    m = /№\s*([A-Za-z0-9][A-Za-z0-9\-/.]*)\s+от\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i.exec(t);
    if (m) {
      no = cleanNo(m[1]!);
      date = dmy(m[2]!, m[3]!, m[4]!);
    }
  }
  // 4) «2026-yil 12-yanvardagi X-shartnoma»
  if (!no) {
    m = /(20\d{2})\s*-?\s*yil\s+(\d{1,2})\s*-?\s*([a-zʻ'`]+?)dagi\s+№?\s*([A-Za-z0-9][A-Za-z0-9\-/.]*?)\s*-?\s*shartnoma/i.exec(t);
    if (m) {
      no = cleanNo(m[4]!);
      const month = monthOfWord(m[3]!);
      if (month) date = dmy(m[2]!, String(month), m[1]!);
    }
  }
  if (!no) {
    m = /№?\s*([A-Za-z0-9][A-Za-z0-9\-/.]{3,})\s*-?\s*shartnoma/i.exec(t);
    if (m) no = cleanNo(m[1]!);
  }
  // Sana alohida (raqam topilib, sana topilmagan bo'lsa)
  if (no && !date) {
    m = /от\s+(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i.exec(t) ?? /(\d{1,2})\.(\d{1,2})\.(\d{4})\s*-?\s*y/i.exec(t);
    if (m) date = dmy(m[1]!, m[2]!, m[3]!);
  }
  return { contractNo: no, contractDate: date };
}

export function amountOf(value: unknown): bigint | null {
  if (value === null || value === undefined || value === '') return null;
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'object' && value && 'result' in value) return amountOf((value as { result: unknown }).result);
  else n = Number(String(value).replace(/[\s  ]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return BigInt(Math.round(n * 100));
}

export function textOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    const v = value as { richText?: { text: string }[]; text?: string; result?: unknown };
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if (typeof v.text === 'string') return v.text;
    if ('result' in v) return textOf(v.result);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** Oy ustuni sarlavhasi: «Yanvar», «2026-01», «Январь 2026», sana */
export function periodOfHeader(value: unknown, defaultYear: number): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 7);
  const text = textOf(value).trim();
  if (!text) return null;
  const iso = /^(20\d{2})[-./](\d{1,2})$/.exec(text);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}`;
  const mmY = /^(\d{1,2})[-./](20\d{2})$/.exec(text);
  if (mmY) return `${mmY[2]}-${String(Number(mmY[1])).padStart(2, '0')}`;
  const word = /^([A-Za-zА-Яа-яЁё'ʻ`]+)\s*(20\d{2})?/.exec(text);
  if (!word) return null;
  const month = monthOfWord(word[1]!);
  if (!month) return null;
  return `${word[2] ?? defaultYear}-${String(month).padStart(2, '0')}`;
}

export function colName(index: number): string {
  let n = index;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Varaq — oddiy massiv (1-indeksli emas: rows[r][c], 0 dan) */
export type Grid = unknown[][];

export function makePayment(ref: string, period: string, amountTiyin: bigint, text: string, explicitNo?: string | null): ParsedPayment {
  const parsed = parseContract(text);
  return {
    ref,
    period,
    amountTiyin,
    text: text.replace(/\s+/g, ' ').trim(),
    contractNo: explicitNo ? cleanNo(explicitNo) : parsed.contractNo,
    contractDate: parsed.contractDate,
    prepaid: /предоплат|oldindan/i.test(text),
  };
}

/**
 * 1-shakl: oy juftliklari (summa | shartnoma). Sarlavha qatori — kamida bitta oy nomi bor qator.
 * Yil: matndan (2026г) yoki defaultYear.
 */
export function parsePairsGrid(grid: Grid, defaultYear: number): { payments: ParsedPayment[]; warnings: string[] } | null {
  const warnings: string[] = [];
  for (let h = 0; h < Math.min(grid.length, 10); h++) {
    const header = grid[h] ?? [];
    const months = new Map<number, string>();
    for (let c = 0; c < header.length; c++) {
      const p = periodOfHeader(header[c], defaultYear);
      if (p) months.set(c, p);
    }
    if (months.size === 0) continue;
    // Juftlik: shu oy nomi bilan birinchi ustun — summa, ikkinchisi — izoh (yoki 2-sarlavha qatori bo'yicha)
    const sub = grid[h + 1] ?? [];
    const pairs: { period: string; amountCol: number; textCol: number }[] = [];
    const used = new Set<number>();
    const cols = [...months.keys()].sort((a, b) => a - b);
    for (const c of cols) {
      if (used.has(c)) continue;
      const period = months.get(c)!;
      const next = cols.find((x) => x > c && months.get(x) === period && !used.has(x));
      const subA = textOf(sub[c]).toLowerCase();
      const subB = next !== undefined ? textOf(sub[next]).toLowerCase() : '';
      let amountCol = c;
      let textCol = next ?? c + 1;
      if (/shartnoma|izoh|назнач|договор|dogovor/.test(subA) && /summa|сумм/.test(subB)) [amountCol, textCol] = [textCol, amountCol];
      used.add(c);
      if (next !== undefined) used.add(next);
      pairs.push({ period, amountCol, textCol });
    }
    const dataStart = /summa|сумм|shartnoma|договор/i.test(sub.map(textOf).join(' ')) ? h + 2 : h + 1;
    const payments: ParsedPayment[] = [];
    for (let r = dataStart; r < grid.length; r++) {
      const row = grid[r] ?? [];
      for (const pair of pairs) {
        const amount = amountOf(row[pair.amountCol]);
        const text = textOf(row[pair.textCol]);
        if (amount === null && !text.trim()) continue;
        const ref = `${colName(pair.amountCol + 1)}${r + 1}`;
        if (amount === null) {
          warnings.push(`${ref}: izoh bor, summa yo'q — o'tkazib yuborildi`);
          continue;
        }
        // Izohdagi oy ustundagidan farq qilsa — ustun bo'yicha olinadi, ogohlantiramiz
        const textPeriod = periodOfText(text);
        const period = pair.period;
        if (textPeriod && textPeriod.slice(5) !== period.slice(5)) warnings.push(`${ref}: izohda ${textPeriod}, ustun — ${period}; ustun bo'yicha olindi`);
        const yearFixed = textPeriod && textPeriod.slice(5) === period.slice(5) ? textPeriod : period;
        payments.push(makePayment(ref, yearFixed, amount, text));
      }
    }
    return { payments, warnings };
  }
  return null;
}

/** 2-shakl: shablonning «To'lovlar» varag'i — Oy | Summa | To'lov izohi | Shartnoma № */
export function parseTemplatePayments(grid: Grid, defaultYear: number): { payments: ParsedPayment[]; warnings: string[] } {
  const warnings: string[] = [];
  const payments: ParsedPayment[] = [];
  const header = (grid[0] ?? []).map((v) => textOf(v).toLowerCase());
  const col = (re: RegExp, fallback: number) => {
    const i = header.findIndex((h) => re.test(h));
    return i >= 0 ? i : fallback;
  };
  const cPeriod = col(/^oy|месяц|davr/, 0);
  const cAmount = col(/summa|сумм/, 1);
  const cText = col(/izoh|назнач|matn/, 2);
  const cNo = col(/shartnoma|договор/, 3);
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const amount = amountOf(row[cAmount]);
    const text = textOf(row[cText]);
    const no = textOf(row[cNo]).trim();
    if (amount === null && !text.trim() && !no) continue;
    const ref = `To'lovlar!${r + 1}`;
    if (amount === null) {
      warnings.push(`${ref}: summa yo'q — o'tkazib yuborildi`);
      continue;
    }
    const period = periodOfHeader(row[cPeriod], defaultYear) ?? periodOfText(text);
    if (!period) {
      warnings.push(`${ref}: oy aniqlanmadi — o'tkazib yuborildi`);
      continue;
    }
    payments.push(makePayment(ref, period, amount, text, no || null));
  }
  return { payments, warnings };
}

/** Shablonning «Shartnomalar» varag'i */
export function parseRegistryGrid(grid: Grid): RegistryRow[] {
  const header = (grid[0] ?? []).map((v) => textOf(v).toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const cNo = col(/shartnoma\s*(№|raqam)|^№|договор/);
  if (cNo < 0) return [];
  const cDate = col(/sana|дата/);
  const cProv = col(/kimga|provayder|kontragent|поставщик/);
  const cPurpose = col(/nima uchun|izoh|maqsad|manzil/);
  const cKind = col(/biriktir|turi/);
  const cUnit = header.findIndex((h, i) => i !== cKind && /nomi|qayer/.test(h));
  const out: RegistryRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] ?? [];
    const no = cleanNo(textOf(row[cNo]));
    if (!no || /^(JAMI|ИТОГО|ВСЕГО|JAMI:)$/i.test(no)) continue;
    const kindText = cKind >= 0 ? textOf(row[cKind]).toLowerCase() : '';
    const unitKind = /bo.?lim/.test(kindText) ? 'department' : /hudud|viloyat/.test(kindText) ? 'region' : /markaz/.test(kindText) ? 'center' : null;
    const str = (c: number) => (c >= 0 ? textOf(row[c]).trim() || null : null);
    out.push({ contractNo: no, contractDate: str(cDate), provider: str(cProv), purpose: str(cPurpose), unitKind, unitName: str(cUnit) });
  }
  return out;
}
// ═══════════════════════════════════════════════════════════
// 3-shakl: bank ko'chirmasi (выписка) — hisobdagi HAMMA to'lovlar; internet to'lovlari izohdagi shartnoma
// raqami bo'yicha ajratib olinadi:
//   1) izohda ro'yxatdagi shartnoma raqami bor (CPIO-2789, 1932368217 …) — internet to'lovi;
//   2) raqam ro'yxatda yo'q, lekin izoh yoki oluvchi nomida «интернет / internet / передача данных …» — internet
//      (yangi shartnoma, ro'yxatga qo'shish taklif qilinadi; oluvchi — provayder);
//   3) qolganlari — internet emas, o'tkazib yuboriladi (soni va summasi ko'rsatiladi).
// Oy: izohdagi oy nomi («январь 2026») bo'lsa — shu, bo'lmasa hujjat sanasi oyi.
// ═══════════════════════════════════════════════════════════

export const INTERNET_WORDS = /интернет|internet|передач[аиу]\s+данных|ma.?lumot(lar)?\s+uzatish|канал[аы]?\s+связи|aloqa\s+kanal|ip[\s-]?tv|wi-?fi|оптоволок|optik\s+tola|tas-?ix/i;

export interface BankLikeRow {
  rowIndex: number;
  docDate: string;
  docNo: string;
  accountName: string;
  inn: string;
  debitTiyin: string;
  purpose: string;
}

/** Ro'yxatdagi raqam izohda (ajratgichlar: «CPIO-2789» = «CPIO 2789» = «CPIO2789»; raqam ichida emas) */
function registryMatcher(contractNos: string[]): (text: string) => string | null {
  const list = [...new Set(contractNos.map((n) => n.trim().toUpperCase()).filter((n) => n.replace(/[^A-ZА-Я0-9]/g, '').length >= 4))]
    // Uzunroq raqam birinchi (CPIO-27 va CPIO-2789 — 2789 topilsin)
    .sort((a, b) => b.length - a.length)
    .map((no) => {
      const body = no
        .split(/[^A-ZА-Я0-9]+/)
        .filter(Boolean)
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('[\\s\\-/._]*');
      return { no, re: new RegExp(`(^|[^A-ZА-Я0-9])${body}($|[^A-ZА-Я0-9])`) };
    });
  return (text) => {
    const t = text.toUpperCase();
    return list.find((x) => x.re.test(t))?.no ?? null;
  };
}

export function pickInternetPayments(
  rows: BankLikeRow[],
  contractNos: string[],
): { payments: ParsedPayment[]; providers: Map<string, string>; skipped: number; skippedTiyin: bigint; warnings: string[] } {
  const find = registryMatcher(contractNos);
  const known = new Set(contractNos.map((n) => n.trim().toUpperCase()));
  const payments: ParsedPayment[] = [];
  const providers = new Map<string, string>();
  const warnings: string[] = [];
  let skipped = 0;
  let skippedTiyin = 0n;
  for (const r of rows) {
    const amount = (() => {
      try {
        return BigInt(r.debitTiyin);
      } catch {
        return 0n;
      }
    })();
    if (amount <= 0n) continue;
    const text = r.purpose.replace(/\s+/g, ' ').trim();
    const parsed = parseContract(text);
    const inRegistry = parsed.contractNo && known.has(parsed.contractNo) ? parsed.contractNo : find(text);
    const isInternet = Boolean(inRegistry) || INTERNET_WORDS.test(text) || INTERNET_WORDS.test(r.accountName);
    if (!isInternet) {
      skipped += 1;
      skippedTiyin += amount;
      continue;
    }
    // Oy: izohdan (hujjat sanasidan 1 yildan uzoq bo'lsa — hujjat sanasi)
    const docPeriod = r.docDate.slice(0, 7);
    const textPeriod = periodOfText(text);
    const far = textPeriod ? Math.abs(Number(textPeriod.slice(0, 4)) * 12 + Number(textPeriod.slice(5)) - (Number(docPeriod.slice(0, 4)) * 12 + Number(docPeriod.slice(5)))) > 12 : false;
    const period = textPeriod && !far ? textPeriod : docPeriod;
    const ref = `Bank!${r.rowIndex}${r.docNo ? ` · №${r.docNo}` : ''}`;
    const p = makePayment(ref, period, amount, text, inRegistry);
    if (!p.contractNo) warnings.push(`${ref}: internet to'lovi, lekin izohda shartnoma raqami topilmadi — «${text.slice(0, 80)}»`);
    if (p.contractNo && r.accountName.trim() && !providers.has(p.contractNo)) providers.set(p.contractNo, r.accountName.trim().slice(0, 120));
    payments.push(p);
  }
  return { payments, providers, skipped, skippedTiyin, warnings };
}
