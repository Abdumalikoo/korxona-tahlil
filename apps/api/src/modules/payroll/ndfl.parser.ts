import type ExcelJS from 'exceljs';
import { cellValue } from '../../common/excel/cells';
import { somToTiyin } from '../../common/money';

// ═══════════════════════════════════════════════════════════
// Soliq hisoboti (JShDS hisob-kitobi ilovalari) — to'g'ridan-to'g'ri o'qish.
//
//  • 4-ilova (odatda «list01»): mehnatga haq to'lash tarzidagi daromadlar (oylik);
//  • 5-ilova (odatda «list02»): mulkiy, moddiy naf tarzidagi va boshqa daromadlar
//    (mehnat ta'tili pullari va h.k.). Bir xodimning bir nechta daromadi — alohida qatorlarda.
//
// Har ilovada ikki xil summa bor:
//  • «Jami hisoblangan …» — yil boshidan O'SIB BORUVCHI (hamma oylar yig'indisi) — OLINMAYDI;
//  • «shundan, hisobot davrida hisoblangan …» — shu oyniki — OLINADI.
// Bir xodim ikkala ilovada ham bo'lishi mumkin — PINFL bo'yicha qo'shiladi (oylik + boshqa daromad).
// Soliq idorasi to'g'rilagan PINFL («Правильный ПИНФЛ») bo'lsa — o'sha olinadi.
// Ustunlar sarlavha matnidan topiladi (kirill va lotin yozuvida); tartibi o'zgarsa ham o'qiladi.
// ═══════════════════════════════════════════════════════════

export type NdflKind = 'SALARY' | 'OTHER';

export interface NdflSheet {
  name: string;
  kind: NdflKind;
  label: string;
  /** PINFL li qatorlar */
  rows: number;
  /** Turli xodimlar */
  people: number;
  /** Hisobot davri (shu oy) daromadi */
  monthTiyin: bigint;
  /** Yil boshidan o'sib boruvchi jami (ma'lumot uchun) */
  cumulativeTiyin: bigint;
  /** Shu oy hisoblangan daromad solig'i (ma'lumot uchun) */
  taxMonthTiyin: bigint;
  /** Soliq idorasi to'g'rilagan PINFL lar */
  corrected: number;
  /** Shu oy daromadi yo'q (faqat o'tgan oylar jamisi bor) */
  zeroMonth: number;
  /** 5-ilova: daromad turlari */
  types: { code: string; label: string; rows: number; monthTiyin: bigint }[];
}

export interface NdflPerson {
  pinfl: string;
  fullName: string | null;
  /** 4-ilova: oylik (shu oy) */
  salaryTiyin: bigint;
  /** 5-ilova: boshqa daromadlar (shu oy) */
  otherTiyin: bigint;
  taxTiyin: bigint;
  /** Birinchi uchragan joyi */
  sheet: string;
  rowIndex: number;
}

export interface NdflResult {
  sheets: NdflSheet[];
  people: NdflPerson[];
  invalid: { sheet: string; rowIndex: number; reason: string }[];
  /** Ikkala ilovada ham bor xodimlar */
  inBoth: number;
  /** Shu oy summasi «jami»dan katta qatorlar (fayl xatosi bo'lishi mumkin) */
  monthOverCumulative: number;
  /** Fayl nomidagi oy (masalan «NDFL_yanvar_2026») — tanlangan oy bilan solishtirish uchun */
  periodHint: string | null;
}

const OTHER_TYPES: Record<string, string> = {
  '1': 'Mulkiy daromad',
  '2': 'Mol-mulkni ijaraga berishdan',
  '3': 'Moddiy naf tarzidagi',
  '4': "Soliq ushlanmagan moddiy naf",
  '5': 'Boshqa daromadlar',
};

/** Sarlavha matni — solishtirish uchun: kichik harf, ҳ→х, қ→к, ғ→г, ў→у, tutuq belgilarsiz, bitta bo'shliq */
function norm(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/ҳ/g, 'х')
    .replace(/қ/g, 'к')
    .replace(/ғ/g, 'г')
    .replace(/ў/g, 'у')
    .replace(/[‘’'`ʻʼ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const has = (s: string, ...words: string[]) => words.some((w) => s.includes(w));
const PERIOD_WORDS = ['хисобот даврида', 'hisobot davrida'];
const INCOME = ['даромад', 'daromad'];
const TAX_SUM = ['солик сумма', 'soliq summa'];
const EXEMPT = ['тортилмайдиган', 'tortilmaydigan', 'имтиёз', 'imtiyoz'];
const TOTAL = ['жами хисобланган', 'jami hisoblangan'];

interface Columns {
  pinfl: number;
  name: number | null;
  month: number;
  cumulative: number | null;
  taxMonth: number | null;
  type: number | null;
  corrected: number | null;
}

/** Varaqdagi sarlavha qatori va ustunlar; soliq hisoboti varag'i bo'lmasa — null */
function findColumns(ws: ExcelJS.Worksheet): { header: number; cols: Columns; kind: NdflKind } | null {
  const lastRow = Math.min(ws.rowCount, 40);
  const lastCol = Math.min(ws.columnCount, 80);
  for (let r = 1; r <= lastRow; r++) {
    let pinfl = -1;
    for (let c = 1; c <= lastCol; c++) {
      const t = norm(cellValue(ws.getCell(r, c).value));
      if (/^(жш ?шир|jsh ?shir|пинфл|pinfl)$/.test(t)) {
        pinfl = c;
        break;
      }
    }
    if (pinfl < 0) continue;
    // Sarlavha ikki qatorli (birlashtirilgan kataklar): yuqori + pastki matn
    const text = (c: number) => `${norm(cellValue(ws.getCell(r, c).value))} ${r + 1 <= ws.rowCount ? norm(cellValue(ws.getCell(r + 1, c).value)) : ''}`;
    const cols: Columns = { pinfl, name: null, month: -1, cumulative: null, taxMonth: null, type: null, corrected: null };
    let salary = false;
    for (let c = 1; c <= lastCol; c++) {
      if (c === pinfl) continue;
      const t = text(c);
      if (!t.trim()) continue;
      if (cols.name === null && has(t, 'ф.и.ш', 'f.i.sh', 'фиш')) cols.name = c;
      else if (has(t, 'правильный пинфл', 'togri pinfl')) cols.corrected = c;
      else if (has(t, 'даромад тури', 'daromad turi')) cols.type = c;
      else if (has(t, ...EXEMPT)) continue;
      else if (has(t, ...TAX_SUM)) {
        if (has(t, ...PERIOD_WORDS)) cols.taxMonth = c;
      } else if (has(t, ...INCOME)) {
        if (has(t, ...PERIOD_WORDS)) {
          if (cols.month < 0) cols.month = c;
          if (has(t, 'мехнатга хак', 'mehnatga haq')) salary = true;
        } else if (has(t, ...TOTAL) && cols.cumulative === null) cols.cumulative = c;
      }
    }
    return { header: r, cols, kind: salary ? 'SALARY' : 'OTHER' };
  }
  return null;
}

const MONTHS: [RegExp, string][] = [
  [/yanvar|январ/, '01'],
  [/fevral|феврал/, '02'],
  [/mart|март/, '03'],
  [/aprel|апрел/, '04'],
  [/may\b|may[_\s-]|май/, '05'],
  [/iyun|июн/, '06'],
  [/iyul|июл/, '07'],
  [/avgust|август/, '08'],
  [/sentabr|sentyabr|сентябр/, '09'],
  [/oktabr|oktyabr|октябр/, '10'],
  [/noyabr|ноябр/, '11'],
  [/dekabr|декабр/, '12'],
];

/** Fayl nomidan oy: «NDFL_yanvar_2026_2.xlsx» → «2026-01» */
export function periodFromName(fileName: string): string | null {
  const s = fileName.toLowerCase();
  const year = s.match(/20\d\d/)?.[0];
  const month = MONTHS.find(([re]) => re.test(s))?.[1];
  return year && month ? `${year}-${month}` : null;
}

/** Ish kitobi soliq hisobotimi (kamida bitta varaqda «ЖШ ШИР» va «hisobot davrida … daromad» ustunlari bor) */
export function isNdflWorkbook(wb: ExcelJS.Workbook): boolean {
  return wb.worksheets.some((ws) => {
    const f = findColumns(ws);
    return Boolean(f && f.cols.month > 0);
  });
}

function pinflOf(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = typeof v === 'number' ? v.toFixed(0) : String(v);
  const d = s.replace(/\D/g, '');
  return /^\d{14}$/.test(d) ? d : null;
}

export function parseNdfl(wb: ExcelJS.Workbook, fileName = ''): NdflResult {
  const people = new Map<string, NdflPerson>();
  const seenIn = new Map<string, Set<NdflKind>>();
  const out: NdflResult = { sheets: [], people: [], invalid: [], inBoth: 0, monthOverCumulative: 0, periodHint: periodFromName(fileName) };

  for (const ws of wb.worksheets) {
    const found = findColumns(ws);
    if (!found) continue;
    const { header, cols, kind } = found;
    if (cols.month < 0) {
      out.invalid.push({ sheet: ws.name, rowIndex: header, reason: "«hisobot davrida hisoblangan daromadlar» ustuni topilmadi — varaq o'qilmadi" });
      continue;
    }
    const sheet: NdflSheet = {
      name: ws.name,
      kind,
      label: kind === 'SALARY' ? "4-ilova · mehnatga haq to'lash tarzidagi daromadlar" : "5-ilova · mulkiy, moddiy naf va boshqa daromadlar",
      rows: 0,
      people: 0,
      monthTiyin: 0n,
      cumulativeTiyin: 0n,
      taxMonthTiyin: 0n,
      corrected: 0,
      zeroMonth: 0,
      types: [],
    };
    const types = new Map<string, { code: string; label: string; rows: number; monthTiyin: bigint }>();
    const pins = new Set<string>();

    for (let r = header + 2; r <= ws.rowCount; r++) {
      const get = (c: number | null) => (c ? cellValue(ws.getCell(r, c).value) : null);
      // Birlashtirilgan katak (izoh, «ЖАМИ» qatori) — ma'lumot qatori emas
      if (ws.getCell(r, cols.pinfl).isMerged) continue;
      const rawPinfl = get(cols.pinfl);
      if (/^(жами|jami)\b/.test(norm(rawPinfl))) continue;
      const monthRaw = get(cols.month);
      if ((rawPinfl === null || rawPinfl === '') && (monthRaw === null || monthRaw === '')) continue;
      const fixed = pinflOf(get(cols.corrected));
      const own = pinflOf(rawPinfl);
      const pinfl = fixed ?? own;
      if (!pinfl) {
        // «ЖАМИ» qatori va ustun raqamlari (1, 2, 3 …) — o'tkaziladi
        if (rawPinfl === null || rawPinfl === '' || typeof rawPinfl === 'number') continue;
        out.invalid.push({ sheet: ws.name, rowIndex: r, reason: "PINFL noto'g'ri" });
        continue;
      }
      if (fixed && fixed !== own) sheet.corrected += 1;
      const month = somToTiyin(monthRaw);
      if (month === null) {
        out.invalid.push({ sheet: ws.name, rowIndex: r, reason: "Hisobot davri summasi noto'g'ri" });
        continue;
      }
      const cumulative = somToTiyin(get(cols.cumulative)) ?? 0n;
      const tax = somToTiyin(get(cols.taxMonth)) ?? 0n;
      if (cumulative > 0n && month > cumulative) out.monthOverCumulative += 1;

      sheet.rows += 1;
      sheet.monthTiyin += month;
      sheet.cumulativeTiyin += cumulative;
      sheet.taxMonthTiyin += tax;
      if (month === 0n) sheet.zeroMonth += 1;
      pins.add(pinfl);
      if (kind === 'OTHER') {
        const code = String(get(cols.type) ?? '').replace(/\D/g, '') || '5';
        const t = types.get(code) ?? { code, label: OTHER_TYPES[code] ?? `Tur ${code}`, rows: 0, monthTiyin: 0n };
        t.rows += 1;
        t.monthTiyin += month;
        types.set(code, t);
      }

      const nameRaw = get(cols.name);
      const fullName = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim().replace(/\s+/g, ' ').slice(0, 160) : null;
      const p = people.get(pinfl) ?? { pinfl, fullName, salaryTiyin: 0n, otherTiyin: 0n, taxTiyin: 0n, sheet: ws.name, rowIndex: r };
      if (kind === 'SALARY') p.salaryTiyin += month;
      else p.otherTiyin += month;
      p.taxTiyin += tax;
      if (!p.fullName && fullName) p.fullName = fullName;
      people.set(pinfl, p);
      const k = seenIn.get(pinfl) ?? new Set<NdflKind>();
      k.add(kind);
      seenIn.set(pinfl, k);
    }
    sheet.people = pins.size;
    sheet.types = [...types.values()].sort((a, b) => a.code.localeCompare(b.code));
    out.sheets.push(sheet);
  }

  out.people = [...people.values()];
  out.inBoth = [...seenIn.values()].filter((s) => s.size > 1).length;
  return out;
}