import type { SalaryComponent } from '@prisma/client';
import type ExcelJS from 'exceljs';
import { SERVICE_CODES } from './salary-composition.constants';
import { cellText, columnLetter, parseNumber, toTiyin } from './salary-composition.excel';
import { headKey, isQualifier } from './salary-composition.vedomost';

// ═══════════════════════════════════════════════════════════
// Ish haqi tarkibi — ISTALGAN shakldagi faylni o'qish va har ustun uchun komponent TAKLIFI.
//
// 1) Jadval topiladi ma'lumotning o'zidan: eng ko'p 14 xonali PINFL bo'lgan ustun — PINFL; birinchi PINFL li
//    qator — ma'lumot boshi; undan yuqoridagi (6 tagacha) qatorlar — sarlavha (ko'p qatorli, birlashtirilgan
//    kataklar ham). Ustun raqamlari (1, 2, 3 …) va yashirin kodlar qatori sarlavhaga qo'shilmaydi.
// 2) Har ustun turi: summa / jami (ФОТ, итого) / ushlanma (НДФЛ, аванс, қўлига …) / aniqlovchi (%, kun, soni) / ma'lumot.
// 3) Summa ustuni uchun komponent — ustuvorlik tartibida:
//      foydalanuvchi shu yuklashda tanlagani → avval o'rgatilgani (sarlavha bo'yicha eslab qolingan) →
//      tanish shakl qoidasi (buxgalteriya vedomosti) → nomi aynan mos → o'xshash nom (taxmin) → tanilmadi.
// 4) Saqlanganda tasdiqlangan moslashlar eslab qolinadi — keyingi oy shu sarlavha o'zi taniladi
//    (shakl har oy o'zgarsa ham: faqat yangi ustunlar so'raladi).
// ═══════════════════════════════════════════════════════════

export type SmartKind = 'amount' | 'total' | 'deduct' | 'qualifier' | 'info';
export type SmartSource = 'user' | 'learned' | 'rule' | 'name' | 'similar' | 'none';

/** Moslashni «hisobga olinmasin» deb belgilash */
export const SKIP = 'SKIP';

export interface SmartColumn {
  col: number;
  letter: string;
  /** Sarlavha (yuqoridan pastga: «Хўжалик … › Ишлаган даврига … › Премия») */
  label: string;
  /** Solishtirish kalitlari: to'liq yo'l va oxirgi nom */
  key: string;
  leaf: string;
  kind: SmartKind;
  /** Summa bor xodimlar soni va jami (tiyin) */
  nonZero: number;
  sumTiyin: bigint;
  /** Qo'llangan komponent (null — tarkibga kirmaydi) */
  code: string | null;
  source: SmartSource;
  /** Taxmin ishonchi 0–1 */
  score: number;
  /** Nega shunday (ekran uchun) */
  reason: string | null;
}

export interface LearnedItem {
  code: string;
  leaf: string;
  label: string;
  at: string;
}
export type Learned = Record<string, LearnedItem>;

export interface SmartScan {
  headerTop: number;
  headerBottom: number;
  dataStart: number;
  pinflCol: number;
  nameCol: number | null;
  daysCol: number | null;
  rateCol: number | null;
  totalCol: number | null;
  columns: SmartColumn[];
}

/** Komponent nomlarining boshqa yozilishlari (kirill / lotin / ruscha) — taxmin uchun */
const ALIASES: Record<string, string[]> = {
  OKLAD: ['оклад', 'oklad', 'асосийишхаки', 'asosiyishhaqi', 'должностнойоклад', 'окладподням', 'тарифставка'],
  OKLAD_40: ['надбавкакосновномуокладу', 'oklad40', 'ustama40', '40'],
  STAJ: ['стаж', 'staj', 'выслуг', 'узокйиллар', 'uzoqyillar', 'xizmatmuddati'],
  TATIL: ['отпуск', 'tatil', 'таътил', 'mehnattatil', 'мехнаттатил', 'отпускные'],
  TATIL_KOMP: ['компенсацияотпуск', 'foydalanilmagan', 'фойдаланилмаган', 'tatilkompensatsiya'],
  KASALLIK: ['больничн', 'kasallik', 'касаллик', 'бетоб', 'betob', 'вактинчамехнатгалаёкатсиз'],
  DEKRET: ['декрет', 'dekret', 'хомиладорлик', 'homiladorlik', 'туғруқ', 'тугрук'],
  MODDIY: ['моддийёрдам', 'moddiyyordam', 'матпомощ', 'материальнаяпомощ', 'командировк', 'komandirovka', 'перерасчет'],
  KPI: ['kpi', 'кпи'],
  BAYRAM: ['байрам', 'bayram', 'праздн', 'bayrampuli'],
  CHORAK: ['квартал', 'chorak', 'чорак', 'choraklik'],
  PREMIYA_BOSHQA: ['премия', 'premiya', 'мукофот', 'mukofot', 'бонус', 'bonus'],
  TRANSPORT: ['транспорт', 'transport', 'йулкира', "yo'lkira", 'yolkira'],
  OVQAT: ['овкат', 'ovqat', 'питан', 'тушлик', 'tushlik'],
  SERTIFIKAT: ['сертификат', 'sertifikat', 'илмийдаража', 'ilmiydaraja', 'учен'],
  USTAMA_BOSHQA: ['устама', 'ustama', 'надбавк', 'кушимча', 'qoshimcha', 'доплат'],
  JARIMA: ['жарима', 'jarima', 'штраф'],
  UNVON: ['звани', 'унвон', 'unvon'],
  FRONT: ['фронт', 'front'],
  TUMAN_KOEF: ['tuman', 'туман', 'районкоэф'],
};

/** Jami ustunlari — tarkibga qo'shilmaydi (ikki marta sanalmasin) */
const TOTAL_WORDS = ['фот', 'итого', 'всего', 'жами', 'jami', 'hammasi', 'хаммаси', 'начисленовсего', 'umumiysumma'];
/** Ushlanmalar va to'lovlar — hisoblangan ish haqi emas */
const DEDUCT_WORDS = ['ндфл', 'даромадсолиг', 'daromadsolig', 'инпс', 'inps', 'профсоюз', 'kasaba', 'касаба', 'алимент', 'aliment', 'миб', 'ушлан', 'ushlan', 'удерж', 'аванс', 'avans', 'кулига', 'qoliga', 'колдик', 'qoldiq', 'квыдаче', 'кперечислен', 'необлагаем', 'хумо', 'humo', 'узкард', 'uzcard', 'пенсион', 'jshds', 'жшдс', 'налог', 'солик', 'soliq'];
/** Ma'lumot ustunlari (summa emas) */
const INFO_WORDS = ['разряд', 'razryad', 'коэф', 'koef', 'стир', 'инн', 'stir', 'лавозим', 'lavozim', 'должност', 'hudud', 'худуд', 'булим', 'bolim', 'отдел', 'тр', 'tr', 'n', '', 'номер', 'raqam', 'сана', 'sana', 'дата', 'соат', 'часы', 'soat', 'кунлик', 'kunlik', 'бирkunlik'];
const NAME_WORDS = ['фио', 'фиш', 'fio', 'fish', 'familiya', 'фамилия', 'исм', 'xodim', 'ходим', 'жисмонийшахснингфиш'];
const DAYS_WORDS = ['кун', 'kun', 'день', 'дней', 'отраб', 'ishlagan', 'ишлаган'];
const RATE_WORDS = ['ставка', 'stavka'];

const hasAny = (k: string, words: string[]) => words.some((w) => k.includes(w));
/** Aniqlovchi (%, kun, soni, summa) — kirill va lotin yozuvida */
const LATIN_QUAL = new Set(['summa', 'foiz', 'soni', 'kun', 'miqdori', 'kol', 'kolvo']);
const isQual = (t: string) => isQualifier(t) || LATIN_QUAL.has(headKey(t));

function isPinflCell(v: ExcelJS.CellValue): string | null {
  const t = cellText(v);
  if (!t) return null;
  const d = t.replace(/[\s.]/g, '');
  return /^\d{14}$/.test(d) ? d : null;
}

const TR: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h' };
const STOP = new Set(['ot', 'dan', 'va', 'uchun', 'po', 'za', 'iz', 'na', 'k', 'i', 'v', 's', 'bilan', 'boyicha', 'ham', 'yoki', 'summa', 'summasi', 'mos', 'beriladigan']);

/** So'z o'zaklari (lotin yozuvida, 5 harfgacha): «Премия от оклада» → [premi, oklad] */
export function stems(text: string): string[] {
  const latin = text
    .toLowerCase()
    .replace(/[а-яёўқғҳ]/g, (ch) => TR[ch] ?? ch)
    .replace(/[‘’ʻʼ`']/g, '');
  return [...new Set(latin.split(/[^a-z0-9]+/).filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w)).map((w) => w.slice(0, 5)))];
}

/** Komponentga taxmin: 0–1 (1 — aynan mos) */
function similarity(leaf: string, path: string, component: { code: string; name: string }, leafStems: string[] = [], pathStems: string[] = []): number {
  const own = [headKey(component.name), headKey(component.code)];
  const aliases = [...own, ...(ALIASES[component.code] ?? []).map(headKey)].filter((a) => a.length >= 2);
  let best = 0;
  for (const a of aliases) {
    if (leaf === a) return 1;
    if (a.length >= 4 && leaf.includes(a)) best = Math.max(best, 0.6 + 0.35 * Math.min(1, a.length / Math.max(leaf.length, 1)));
    else if (a.length >= 4 && path.includes(a)) best = Math.max(best, 0.55);
    else if (leaf.length >= 5 && a.includes(leaf)) best = Math.max(best, 0.6);
  }
  // So'zlar bo'yicha: umumiy o'zaklar ulushi; manba (byudjet / xo'jalik) yo'lda bo'lsa — qo'shimcha
  if (leafStems.length) {
    const comp = stems(component.name);
    if (comp.length) {
      const like = (a: string, b: string) => a === b || (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a) || a.slice(0, 3) === b.slice(0, 3) && Math.min(a.length, b.length) >= 4 && a.slice(0, 4) === b.slice(0, 4)));
      const common = leafStems.filter((x) => comp.some((y) => like(x, y))).length;
      if (common) {
        // Ikkala tomondan: komponent nomining va sarlavhaning qancha qismi mos
        let score = common / Math.max(leafStems.length, comp.length) + 0.2 * (common / leafStems.length);
        const extra = comp.filter((x) => !leafStems.some((y) => like(x, y)));
        const inPath = extra.filter((x) => pathStems.some((y) => like(x, y))).length;
        if (extra.length && inPath) score += 0.25 * (inPath / comp.length) + (inPath === extra.length ? 0.1 : 0);
        best = Math.max(best, Math.min(0.95, 0.35 + score * 0.6));
      }
    }
  }
  return best;
}

/** Eng mos komponent (bir xil ishonchda — tartibdagi birinchisi) */
export function guessComponent(leaf: string, path: string, components: SalaryComponent[], raw?: { leaf: string; path: string }): { code: string; score: number } | null {
  let best: { code: string; score: number; order: number } | null = null;
  const ls = raw ? stems(raw.leaf) : [];
  const ps = raw ? stems(raw.path) : [];
  for (const c of components) {
    if (!c.isActive) continue;
    // Umumiy komponentlar («Boshqa …») — aniqrog'i bo'lsa, o'shani tanlash uchun
    const generic = c.code === 'BOSHQA' || c.code.endsWith('_BOSHQA');
    const s = similarity(leaf, path, c, ls, ps) - (generic ? 0.1 : 0);
    if (s <= 0) continue;
    if (!best || s > best.score || (s === best.score && c.sortOrder < best.order)) best = { code: c.code, score: s, order: c.sortOrder };
  }
  return best && best.score >= 0.55 ? { code: best.code, score: Math.round(best.score * 100) / 100 } : null;
}

/** O'rgatilgan moslash: to'liq yo'l bo'yicha, bo'lmasa — oxirgi nom bir xil yagona yozuv bo'yicha */
function learnedFor(learned: Learned, key: string, leaf: string): LearnedItem | null {
  const exact = learned[key];
  if (exact) return exact;
  const byLeaf = Object.values(learned).filter((x) => x.leaf === leaf);
  const codes = new Set(byLeaf.map((x) => x.code));
  return byLeaf.length && codes.size === 1 ? byLeaf[0]! : null;
}

export interface SmartOptions {
  /** Tanish shakl qoidasi: ustun → komponent (buxgalteriya vedomosti yoki dastur shabloni) */
  rule?: Map<number, string>;
  /** Tanish shakl qoidasi o'tkazgan summa ustunlari: ustun → sabab */
  ruleSkipped?: Map<number, string>;
  /** Tanish shakl: qoidada bo'lmagan ustunlar summa emas (jami, foiz, ma'lumot) */
  trusted?: boolean;
  learned: Learned;
  /** Shu yuklashda foydalanuvchi tanlagani: ustun harfi → kod yoki SKIP */
  user?: Record<string, string>;
}

/** Varaqni tahlil qiladi; PINFL ustuni topilmasa — null */
export function smartScan(ws: ExcelJS.Worksheet, components: SalaryComponent[], opts: SmartOptions): SmartScan | null {
  const lastCol = Math.min(ws.columnCount, 260);
  const lastRow = Math.min(ws.rowCount, 3000);
  const codes = new Set([...components.map((c) => c.code), ...Object.values(SERVICE_CODES)]);
  const known = new Set(components.map((c) => c.code));

  // ─── PINFL ustuni: ma'lumotning o'zidan ───
  const count = new Map<number, number>();
  const firstRow = new Map<number, number>();
  for (let r = 1; r <= Math.min(lastRow, 800); r++) {
    for (let c = 1; c <= lastCol; c++) {
      if (!isPinflCell(ws.getCell(r, c).value)) continue;
      count.set(c, (count.get(c) ?? 0) + 1);
      if (!firstRow.has(c)) firstRow.set(c, r);
    }
  }
  let pinflCol = 0;
  for (const [c, n] of count) if (!pinflCol || n > (count.get(pinflCol) ?? 0)) pinflCol = c;
  if (!pinflCol || (count.get(pinflCol) ?? 0) < 1) return null;
  const dataStart = firstRow.get(pinflCol)!;

  // ─── Sarlavha qatorlari ───
  // Ma'lumot boshidan yuqoriga: ustun raqamlari va yashirin kodlar qatori o'tkaziladi; bo'sh qator yoki
  // bitta matnli sarlavha (fayl nomi, «… qaydnomasi») — sarlavha bloki tugadi
  const headerRows: number[] = [];
  for (let r = dataStart - 1; r >= Math.max(1, dataStart - 7); r--) {
    let ints = 0;
    let codeCells = 0;
    let texts = 0;
    let filled = 0;
    const seen = new Set<string>();
    for (let c = 1; c <= lastCol; c++) {
      const v = ws.getCell(r, c).value;
      const t = cellText(v);
      if (!t) continue;
      filled += 1;
      if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 400) ints += 1;
      else if (codes.has(t.toUpperCase())) codeCells += 1;
      else if (/[a-zа-яўқғҳ]/i.test(t)) {
        // Birlashtirilgan katak bir necha ustunda takrorlanadi — bitta matn deb sanaladi
        if (!seen.has(t)) texts += 1;
        seen.add(t);
      }
    }
    if (!filled) {
      if (headerRows.length) break;
      continue;
    }
    if (ints >= 5 && texts <= 1) continue; // ustun raqamlari
    if (codeCells >= 3) continue; // yashirin kodlar
    if (texts <= 1 && headerRows.length) break; // sarlavha matni (jadval nomi)
    if (texts > 0) headerRows.unshift(r);
  }
  const headerTop = headerRows[0] ?? Math.max(1, dataStart - 1);
  const headerBottom = headerRows[headerRows.length - 1] ?? headerTop;

  // ─── Ma'lumot qatorlari ───
  const dataRows: number[] = [];
  for (let r = dataStart; r <= lastRow; r++) if (isPinflCell(ws.getCell(r, pinflCol).value)) dataRows.push(r);

  const columns: SmartColumn[] = [];
  let nameCol: number | null = null;
  let daysCol: number | null = null;
  let rateCol: number | null = null;
  const totals: { col: number; sum: bigint; main: boolean }[] = [];
  let prevLeafRaw = '';
  let prev: { leafRaw: string; parent: string; qualifier: boolean } | null = null;

  for (let c = 1; c <= lastCol; c++) {
    if (c === pinflCol) continue;
    const levels: string[] = [];
    for (const r of headerRows) {
      const t = cellText(ws.getCell(r, c).value).replace(/\s+/g, ' ').trim();
      if (t && levels[levels.length - 1] !== t) levels.push(t);
    }
    // Qiymatlar
    let nonZero = 0;
    let sum = 0n;
    let texts = 0;
    let numbers = 0;
    let smallInts = 0;
    let sequence = 0;
    let lastInt = 0;
    let maxAbs = 0;
    for (const r of dataRows) {
      const v = ws.getCell(r, c).value;
      const n = parseNumber(v);
      if (n === null) continue;
      if (Number.isNaN(n)) {
        if (cellText(v).length > 1) texts += 1;
        continue;
      }
      numbers += 1;
      if (Math.abs(n) > maxAbs) maxAbs = Math.abs(n);
      if (Number.isInteger(n) && n >= 0 && n <= 31) smallInts += 1;
      // Tartib raqami (1, 2, 3 …)
      if (Number.isInteger(n) && n === lastInt + 1) sequence += 1;
      lastInt = Number.isInteger(n) ? n : -10;
      if (n !== 0) {
        nonZero += 1;
        sum += toTiyin(Math.abs(n));
      }
    }
    if (!levels.length && !numbers && !texts) continue;

    // Oxirgi nom: aniqlovchi (%, kun, сумма) bo'lmagan eng pastki daraja
    let leafRaw = '';
    let qualifier = '';
    for (let k = levels.length - 1; k >= 0; k--) {
      const t = levels[k]!;
      if (!qualifier && isQual(t) && k === levels.length - 1) qualifier = t;
      else {
        leafRaw = t;
        break;
      }
    }
    // «овқат | кун» keyin «сумма»: summa ustunining nomi — oldingi (aniqlovchi) ustunda
    const parent = levels.slice(0, qualifier ? -1 : levels.length).join('|');
    if (qualifier && prev && prev.qualifier && prev.parent === `${parent}|${prev.leafRaw}`) leafRaw = prev.leafRaw;
    if (!leafRaw) leafRaw = prevLeafRaw;
    prevLeafRaw = leafRaw;
    prev = { leafRaw, parent: levels.slice(0, -1).join('|'), qualifier: Boolean(qualifier) && !/^(сумма|summa)$/i.test(qualifier.trim()) };
    const leaf = headKey(leafRaw);
    const key = headKey(levels.join(' '));
    const label = levels.join(' › ') || `${columnLetter(c)} ustun`;
    const base = { col: c, letter: columnLetter(c), label, key, leaf, nonZero, sumTiyin: sum, code: null as string | null, source: 'none' as SmartSource, score: 0, reason: null as string | null };

    // Matnli ustun — F.I.Sh. yoki ma'lumot
    if (texts > numbers) {
      if (nameCol === null && (hasAny(leaf, NAME_WORDS) || texts >= Math.max(1, dataRows.length * 0.5))) nameCol = c;
      continue;
    }
    if (!numbers && !levels.length) continue;

    let kind: SmartKind;
    const q = qualifier ? headKey(qualifier) : '';
    const isSequence = numbers >= 2 && sequence >= numbers * 0.9 && !opts.rule?.has(c);
    const ruled = opts.rule?.has(c) ?? false;
    const percentHead = /%/.test(leafRaw) && !/сумма|summa/i.test(leafRaw);
    const smallOnly = maxAbs <= 100;
    if (isSequence) kind = 'info';
    else if (!levels.length && !ruled) kind = 'info'; // sarlavhasiz — yordamchi hisob
    else if (!ruled && percentHead && smallOnly) kind = 'qualifier';
    else if (!ruled && /(сони|soni|кво|колво|миқдори|soat)$/.test(leaf) && smallOnly) kind = 'qualifier';
    else if (!ruled && hasAny(leaf, DAYS_WORDS) && numbers > 0 && smallInts >= numbers * 0.9 && !hasAny(leaf, ['сумма', 'summa', 'пул', 'pul'])) {
      if (daysCol === null) daysCol = c;
      kind = 'info';
    }
    else if (rateCol === null && hasAny(leaf, RATE_WORDS)) {
      rateCol = c;
      kind = 'info';
    } else if (qualifier && q !== 'сумма' && q !== 'summa') kind = 'qualifier';
    else if (hasAny(key, DEDUCT_WORDS)) kind = 'deduct';
    else if (!ruled && (TOTAL_WORDS.includes(leaf) || /(^|[^a-zа-яёўқғҳ])(фот|итого|всего|жами|jami|hammasi)([^a-zа-яёўқғҳ]|$)/i.test(leafRaw))) kind = 'total';
    else if (daysCol === null && hasAny(leaf, DAYS_WORDS) && smallInts >= numbers * 0.9 && !hasAny(leaf, ['сумма', 'summa', 'пул', 'pul'])) {
      daysCol = c;
      kind = 'info';
    } else if ((INFO_WORDS.includes(leaf) || hasAny(leaf, INFO_WORDS.filter((w) => w.length >= 4))) && !opts.rule?.has(c)) kind = 'info';
    else kind = 'amount';

    // Tanish shakl: qoidada yo'q va o'tkazilganlar ro'yxatida ham yo'q ustun — summa emas (jami, foiz, yordamchi)
    if (opts.trusted && kind === 'amount' && !opts.rule?.has(c) && !opts.ruleSkipped?.has(c)) kind = 'info';
    if (opts.rule?.has(c)) kind = 'amount';

    const item: SmartColumn = { ...base, kind };
    if (kind === 'total') {
      const main = /биройликишхакифонди|начисленовсего|итогоначислено|жамихисобланган|jamihisoblangan|^фот$|^жами$|^итого$|^jami$/.test(leaf);
      totals.push({ col: c, sum, main });
    }
    if (kind === 'amount') {
      // Komponent taklifi — ustuvorlik tartibida
      const chosen = opts.user?.[item.letter];
      const learned = learnedFor(opts.learned, key, leaf);
      const rule = opts.rule?.get(c);
      const exact = components.find((x) => x.isActive && (headKey(x.name) === leaf || headKey(x.code) === leaf));
      if (chosen !== undefined) {
        item.code = chosen === SKIP ? null : known.has(chosen) ? chosen : null;
        item.source = 'user';
        item.score = 1;
        item.reason = chosen === SKIP ? "siz «hisobga olinmasin» dedingiz" : null;
      } else if (learned && (learned.code === SKIP || known.has(learned.code))) {
        item.code = learned.code === SKIP ? null : learned.code;
        item.source = 'learned';
        item.score = 1;
        item.reason = learned.code === SKIP ? 'avval «hisobga olinmasin» deb belgilangan' : null;
      } else if (rule) {
        item.code = rule;
        item.source = 'rule';
        item.score = 1;
      } else if (opts.ruleSkipped?.has(c)) {
        item.code = null;
        item.source = 'rule';
        item.reason = opts.ruleSkipped.get(c)!;
      } else if (exact) {
        item.code = exact.code;
        item.source = 'name';
        item.score = 1;
      } else {
        const g = guessComponent(leaf, key, components, { leaf: leafRaw, path: levels.join(' ') });
        if (g) {
          item.code = g.code;
          item.source = 'similar';
          item.score = g.score;
        } else item.reason = 'tanilmadi';
      }
    }
    columns.push(item);
  }

  // Asosiy jami (ФОТ): nomi aniq bo'lgani, bo'lmasa — eng kattasi
  const mains = totals.filter((t) => t.main);
  const pick = (mains.length ? mains : totals).sort((a, b) => (b.sum > a.sum ? 1 : b.sum < a.sum ? -1 : 0))[0];
  return { headerTop, headerBottom, dataStart, pinflCol, nameCol, daysCol, rateCol, totalCol: pick?.col ?? null, columns };
}

/** Saqlangan moslashlarni tekshirib o'qish (settings qiymati) */
export function readLearned(value: unknown): Learned {
  const items = (value as { items?: unknown } | null)?.items;
  if (!items || typeof items !== 'object') return {};
  const out: Learned = {};
  for (const [k, v] of Object.entries(items as Record<string, unknown>)) {
    const x = v as Partial<LearnedItem> | null;
    if (typeof k === 'string' && x && typeof x.code === 'string' && typeof x.leaf === 'string') {
      out[k] = { code: x.code, leaf: x.leaf, label: typeof x.label === 'string' ? x.label.slice(0, 300) : '', at: typeof x.at === 'string' ? x.at : '' };
    }
  }
  return out;
}

export const LEARNED_KEY = 'salary.composition.columns';
export const LEARNED_MAX = 3000;