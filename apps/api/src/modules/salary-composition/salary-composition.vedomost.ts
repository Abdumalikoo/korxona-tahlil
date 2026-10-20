import type { SalaryComponent } from '@prisma/client';
import ExcelJS from 'exceljs';
import { CENTRAL_REGION, SERVICE_CODES } from './salary-composition.constants';
import { cellText, columnLetter, parseNumber, toSom } from './salary-composition.excel';
import type { FixedKey, PayrollInfo } from './salary-composition.types';

// ═══════════════════════════════════════════════════════════
// Ish haqi tarkibi — buxgalteriya vedomosti shakli («OYLIK MARKAZ»):
//   №, СТИР, ПИНФЛ, разряд, коэфф, ФИО, Лавозими, Hududi, Оклад по дням, 1 кунлик иш ҳақи, ставка, кун, соат,
//   «Бюджет маблағлари ҳисобидан бериладиган қўшимчалар» (ишлаган даврига мос / ишлаган кунидан қатъий назар) → бюджетдан ФОТ,
//   «Хўжалик ҳисобидан бериладиган қўшимчалар» → хўжалик ФОТ, «Бир ойлик иш ҳақи фонди (ФОТ)», ушланмалар, аванс, қолдиқ.
// Ikki ish:
//   1) Shablon — shu shaklda (sarlavhalar 2–5-qator, raqamlar 6-qator, yashirin kodlar, JAMI, xodimlar ro'yxati, formulalar).
//   2) O'qish — buxgalteriyaning o'z fayli ham (har oy varag'i: «Январь (умумий) (2026)» …) sarlavhalar bo'yicha taniladi:
//      har bir summa ustuni komponentga, foiz / soni / kun ustunlari va yordamchi hisoblar o'tkazib yuboriladi.
//      Tekshiruv: tarkib yig'indisi = fayldagi «Бир ойлик иш ҳақи фонди (ФОТ)».
// ═══════════════════════════════════════════════════════════

/** Sarlavhani solishtirish kaliti: kichik harf, ў→у, қ→к, ғ→г, ҳ→х, ё→е, faqat harf va raqam */
export function headKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/ў/g, 'у')
    .replace(/қ/g, 'к')
    .replace(/ғ/g, 'г')
    .replace(/ҳ/g, 'х')
    .replace(/ё/g, 'е')
    .replace(/[‘’ʻʼ`'ʻ]/g, '')
    .replace(/[^a-z0-9а-я]/g, '');
}

const QUALIFIERS = new Set(['', '%', '%%', 'сумма', 'кво', 'колво', 'кун', 'день', 'сони']);
const isQualifier = (raw: string) => {
  const k = headKey(raw);
  return raw.trim() === '%' || raw.trim() === '%%' || QUALIFIERS.has(k);
};
const isAmountQualifier = (raw: string) => headKey(raw) === 'сумма';

type Zone = 'B' | 'H' | 'F';
type Section = 'W' | 'N' | '';

/** Vedomost ustuni → komponent: zona | bo'lim | sarlavha (kalit) [| nechanchi marta] */
interface Rule {
  zone: Zone;
  section?: Section;
  test: (key: string, path: string) => boolean;
  occurrence?: number;
  code: string | null;
  /** code=null bo'lsa — nega o'tkazildi */
  why?: string;
}

const eq = (k: string) => (key: string) => key === k;
const starts = (k: string) => (key: string) => key.startsWith(k);

const RULES: Rule[] = [
  { zone: 'H', test: (k, p) => p.includes('жарималар') && k.includes('сумма'), code: 'JARIMA_EDO' },
  // ─── Byudjet ───
  { zone: 'B', test: eq('окладподням'), code: 'OKLAD' },
  { zone: 'B', test: starts('надбавкакосновномуокладу'), code: 'OKLAD_40' },
  { zone: 'B', section: 'W', test: eq('премияотоклада'), code: 'PREM_OKLAD_B' },
  { zone: 'B', section: 'W', test: eq('премияотбр'), code: 'PREM_BR_B' },
  { zone: 'B', section: 'N', test: eq('премияотбр'), code: 'PREM_BR_BX' },
  { zone: 'B', test: starts('foydalanilmaganmehnat'), code: 'TATIL_KOMP' },
  { zone: 'B', test: starts('tuman'), code: 'TUMAN_KOEF' },
  { zone: 'B', test: starts('биройликокладимикдоридамоддий'), code: 'MODDIY_OKLAD' },
  { zone: 'B', test: starts('биройликокладимикдоридамукофот'), code: 'MUKOFOT_OKLAD' },
  { zone: 'B', test: starts('больничн'), code: 'KASALLIK' },
  { zone: 'B', test: starts('налоготбольн'), code: null, why: "kasallik nafaqasidan soliq — ish haqi emas" },
  { zone: 'B', test: starts('декрет'), code: 'DEKRET' },
  { zone: 'B', test: starts('отпускн'), code: 'TATIL' },
  { zone: 'B', test: starts('моддийердам'), code: 'MODDIY' },
  { zone: 'B', test: (k) => k.includes('жарима'), code: 'JARIMA' },
  // ─── Xo'jalik ───
  { zone: 'H', test: starts('2окладгача'), code: 'IKKI_OKLAD' },
  { zone: 'H', test: starts('узокйиллархизмат'), code: 'STAJ' },
  { zone: 'H', test: starts('звания'), code: 'UNVON' },
  { zone: 'H', test: starts('транспорт'), code: 'TRANSPORT' },
  // «Моддий рағб. … устама (фронт 45%)» = oy front summasi + farq — shu olinadi (farq manfiy bo'lishi mumkin)
  { zone: 'H', test: (k) => k.includes('фронт') && k.includes('45'), code: 'FRONT' },
  { zone: 'H', test: (k) => k.includes('фронт'), code: 'FRONT_OY' },
  { zone: 'H', test: starts('фарксумма'), code: 'FRONT_FARQ' },
  { zone: 'H', test: starts('овкат'), code: 'OVQAT' },
  { zone: 'H', test: starts('фаркларлавозим'), code: null, why: "lavozim farqi — FOT ga kirmaydi" },
  { zone: 'H', section: 'W', test: starts('премияотоклада'), code: 'KPI' },
  { zone: 'H', test: starts('премияотмрот'), code: 'PREM_MROT' },
  { zone: 'H', section: 'N', test: eq('премияотоклада'), occurrence: 0, code: 'PREM_OKLAD_X' },
  { zone: 'H', section: 'N', test: eq('премияотоклада'), occurrence: 1, code: 'PREM_OKLAD_K' },
  { zone: 'H', section: 'N', test: eq('премияотбр'), code: 'PREM_BR_H' },
  { zone: 'H', test: (k) => /^премияза\d*квартал/.test(k) || k.includes('квартал'), code: 'CHORAK' },
];

/** Vedomost shakli uchun kerakli komponentlar (bazada bo'lmasa — yaratiladi) */
export const VEDOMOST_COMPONENTS: { code: string; name: string; group: 'BUDGET' | 'HOJALIK'; category: 'ASOSIY' | 'TATIL' | 'PREMIYA' | 'KOMPENSATSIYA' | 'USTAMA' | 'JARIMA' | 'BOSHQA'; sign: 1 | -1; sortOrder: number }[] = [
  { code: 'PREM_OKLAD_B', name: 'Premiya okladdan (byudjet)', group: 'BUDGET', category: 'PREMIYA', sign: 1, sortOrder: 22 },
  { code: 'PREM_BR_B', name: 'Premiya BR dan (byudjet)', group: 'BUDGET', category: 'PREMIYA', sign: 1, sortOrder: 24 },
  { code: 'TUMAN_KOEF', name: 'Tuman koeffitsienti', group: 'BUDGET', category: 'ASOSIY', sign: 1, sortOrder: 35 },
  { code: 'MODDIY_OKLAD', name: 'Bir oylik oklad miqdorida moddiy yordam', group: 'BUDGET', category: 'KOMPENSATSIYA', sign: 1, sortOrder: 82 },
  { code: 'MUKOFOT_OKLAD', name: 'Bir oylik oklad miqdorida mukofot', group: 'BUDGET', category: 'PREMIYA', sign: 1, sortOrder: 84 },
  { code: 'PREM_BR_BX', name: "Premiya BR dan (ishlagan kunidan qat'i nazar)", group: 'BUDGET', category: 'PREMIYA', sign: 1, sortOrder: 86 },
  { code: 'IKKI_OKLAD', name: "2 okladgacha qo'shimcha", group: 'HOJALIK', category: 'USTAMA', sign: 1, sortOrder: 102 },
  { code: 'UNVON', name: "Unvon uchun qo'shimcha", group: 'HOJALIK', category: 'USTAMA', sign: 1, sortOrder: 104 },
  { code: 'FRONT', name: "Moddiy rag'batlantirish ustamasi (front)", group: 'HOJALIK', category: 'USTAMA', sign: 1, sortOrder: 106 },
  { code: 'FRONT_FARQ', name: 'Front farq summalari', group: 'HOJALIK', category: 'USTAMA', sign: 1, sortOrder: 107 },
  { code: 'PREM_MROT', name: 'Premiya MROT dan', group: 'HOJALIK', category: 'PREMIYA', sign: 1, sortOrder: 115 },
  { code: 'PREM_OKLAD_X', name: "Premiya okladdan (qat'i nazar)", group: 'HOJALIK', category: 'PREMIYA', sign: 1, sortOrder: 121 },
  { code: 'PREM_BR_H', name: "Premiya BR dan (xo'jalik)", group: 'HOJALIK', category: 'PREMIYA', sign: 1, sortOrder: 122 },
  { code: 'PREM_OKLAD_K', name: "Premiya (oklad soni bo'yicha)", group: 'HOJALIK', category: 'PREMIYA', sign: 1, sortOrder: 126 },
  { code: 'JARIMA_EDO', name: 'Jarima (EDO va test)', group: 'HOJALIK', category: 'JARIMA', sign: -1, sortOrder: 195 },
  { code: 'VED_FARQ', name: "Vedomost farqi (+, ustunsiz qo'shilgan)", group: 'HOJALIK', category: 'BOSHQA', sign: 1, sortOrder: 197 },
  { code: 'VED_FARQ_M', name: 'Vedomost farqi (−, ustunsiz ayirilgan)', group: 'HOJALIK', category: 'BOSHQA', sign: -1, sortOrder: 198 },
];

// ═══════════════════════════════════════════════════════════
// Shablon tuzilishi
// ═══════════════════════════════════════════════════════════

type ColKind = 'fixed' | 'qual' | 'amount' | 'calc' | 'info' | 'deduct' | 'check';

interface TCol {
  /** 2–5-qatorlar: [guruh, bo'lim, nom, aniqlovchi] — bo'shlari yuqoridagi bilan birlashadi */
  head: [string, string?, string?, string?];
  kind: ColKind;
  code?: string;
  fixed?: FixedKey | 'position' | 'place' | 'oklad' | 'daily' | 'hours' | 'num' | 'stir' | 'grade' | 'coef' | 'workdays';
  width?: number;
  calc?: 'budget' | 'hojalik' | 'fot' | 'net' | 'rest' | 'payroll' | 'diff';
}

const BG = 'Бюджет маблағлари ҳисобидан бериладиган қўшимчалар';
const HG = 'Хўжалик ҳисобидан бериладиган қўшимчалар';
const W = 'Ишлаган даврига мос бериладиган';
const N = 'Ишлаган кунларидан қатъий назар бериладиган қўшимчалар';

const pair = (g: string, s: string, name: string, q: string, code: string): TCol[] => [
  { head: [g, s, name, q], kind: 'qual', width: 7 },
  { head: [g, s, name, 'сумма'], kind: 'amount', code, width: 14 },
];

export const LAYOUT: TCol[] = [
  { head: ['№'], kind: 'fixed', fixed: 'num', width: 5 },
  { head: ['СТИР'], kind: 'fixed', fixed: 'stir', width: 11 },
  { head: ['ПИНФЛ'], kind: 'fixed', fixed: 'pinfl', width: 16 },
  { head: ['разряд'], kind: 'fixed', fixed: 'grade', width: 7 },
  { head: ['коэфф'], kind: 'fixed', fixed: 'coef', width: 7 },
  { head: ['ФИО'], kind: 'fixed', fixed: 'fullName', width: 34 },
  { head: ['Лавозими'], kind: 'fixed', fixed: 'position', width: 24 },
  { head: ['Hududi'], kind: 'fixed', fixed: 'place', width: 16 },
  { head: ['Оклад по дням'], kind: 'fixed', fixed: 'oklad', width: 13 },
  { head: ['1 кунлик иш ҳақи суммаси'], kind: 'fixed', fixed: 'daily', width: 12 },
  { head: ['ставка'], kind: 'fixed', fixed: 'rate', width: 7 },
  { head: ['Факт. отраб (день)'], kind: 'fixed', fixed: 'days', width: 8 },
  { head: ['Факт. отраб (часы)'], kind: 'fixed', fixed: 'hours', width: 8 },
  // ─── Byudjet ───
  { head: [BG, W, 'Оклад по дням'], kind: 'amount', code: 'OKLAD', width: 14 },
  { head: [BG, W, 'Надбавка к основному окладу 40%'], kind: 'amount', code: 'OKLAD_40', width: 14 },
  ...pair(BG, W, 'Премия от оклада', '%', 'PREM_OKLAD_B'),
  ...pair(BG, W, 'Премия от БР', '%', 'PREM_BR_B'),
  { head: [BG, W, "Foydalanilmagan mehnat ta'tili uchun"], kind: 'amount', code: 'TATIL_KOMP', width: 14 },
  { head: [BG, W, 'Tuman. koyff.'], kind: 'amount', code: 'TUMAN_KOEF', width: 12 },
  ...pair(BG, N, 'Бир ойлик оклади миқдорида моддий ёрдам', '%%', 'MODDIY_OKLAD'),
  ...pair(BG, N, 'Бир ойлик оклади миқдорида мукофот', '%%', 'MUKOFOT_OKLAD'),
  ...pair(BG, N, 'Премия от БР', '%%', 'PREM_BR_BX'),
  { head: [BG, N, 'Больничные'], kind: 'amount', code: 'KASALLIK', width: 13 },
  { head: [BG, N, 'декрет'], kind: 'amount', code: 'DEKRET', width: 13 },
  { head: [BG, N, 'Отпускные'], kind: 'amount', code: 'TATIL', width: 13 },
  { head: [BG, N, 'Моддий ёрдам/перерасчёт'], kind: 'amount', code: 'MODDIY', width: 13 },
  { head: [BG, '20 % Жарима'], kind: 'amount', code: 'JARIMA', width: 12 },
  { head: ['Ишлаган даври учун бюджетдан ФОТ'], kind: 'calc', calc: 'budget', width: 16 },
  // ─── Xo'jalik ───
  ...pair(HG, W, '2 окладгача қўшимча', '%%', 'IKKI_OKLAD'),
  ...pair(HG, W, 'Узоқ йиллар хизмат қилганлиги учун', '%%', 'STAJ'),
  ...pair(HG, W, 'Звания учун кўшимча', '%%', 'UNVON'),
  ...pair(HG, W, 'транспорт', 'кун', 'TRANSPORT'),
  { head: [HG, W, 'Фронт сумма'], kind: 'amount', code: 'FRONT', width: 14 },
  { head: [HG, W, 'Фарк суммалар'], kind: 'amount', code: 'FRONT_FARQ', width: 13 },
  ...pair(HG, W, 'овқат', 'кун', 'OVQAT'),
  ...pair(HG, W, 'Премия от оклада (КПИ)', '%', 'KPI'),
  { head: [HG, W, 'ЖАРИМАЛАР (EDO) ва тест учун', 'Жарима суммаси'], kind: 'amount', code: 'JARIMA_EDO', width: 13 },
  ...pair(HG, W, 'Премия от МРОТ', 'к-во', 'PREM_MROT'),
  ...pair(HG, N, 'Премия от оклада', 'к-во', 'PREM_OKLAD_X'),
  ...pair(HG, N, 'Премия от БР', 'к-во', 'PREM_BR_H'),
  { head: [HG, N, 'Премия за квартал'], kind: 'amount', code: 'CHORAK', width: 14 },
  ...pair(HG, N, 'Премия от оклада', 'к-во', 'PREM_OKLAD_K'),
  { head: ['ФОТ Хўжалик ҳисобидан'], kind: 'calc', calc: 'hojalik', width: 16 },
  { head: ['кол-во раб дней'], kind: 'info', fixed: 'workdays', width: 8 },
  { head: ['Бир ойлик иш ҳақи фонди (ФОТ)'], kind: 'calc', calc: 'fot', width: 17 },
  // ─── Ushlanmalar (dastur o'qimaydi — buxgalteriya uchun) ───
  { head: ['Необлагаемая часть'], kind: 'deduct', width: 11 },
  { head: ['Ушлаб қолинган', 'НДФЛ'], kind: 'deduct', width: 13 },
  { head: ['Ушлаб қолинган', 'втч ИНПС'], kind: 'deduct', width: 11 },
  { head: ['Ушлаб қолинган', 'профсоюз'], kind: 'deduct', width: 11 },
  { head: ['Ушлаб қолинган', 'Алимент ва МИБ ушланмалари'], kind: 'deduct', width: 12 },
  { head: ['қўлига олиш учун сумма'], kind: 'calc', calc: 'net', width: 15 },
  { head: ['Олинган аванс', 'Ҳумо'], kind: 'deduct', width: 12 },
  { head: ['Олинган аванс', 'Узкард'], kind: 'deduct', width: 12 },
  { head: ['Колдиқ'], kind: 'calc', calc: 'rest', width: 15 },
  // ─── Tekshiruv ───
  { head: ['Tekshiruv (dastur)', 'Soliq hisoboti'], kind: 'check', calc: 'payroll', width: 15 },
  { head: ['Tekshiruv (dastur)', 'Farq (ФОТ − soliq)'], kind: 'check', calc: 'diff', width: 13 },
];

const HEAD_TOP = 2;
const HEAD_ROWS = 4; // 2..5
const NUM_ROW = HEAD_TOP + HEAD_ROWS; // 6
const CODE_ROW = NUM_ROW + 1; // 7 (yashirin)
const TOTAL_ROW = CODE_ROW + 1; // 8
const FIRST_DATA = TOTAL_ROW + 1; // 9

const MONTHS_CYR = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

export interface VedomostEmployee {
  pinfl: string;
  fullName: string;
  position: string | null;
  regionCode: number;
  region: { name: string } | null;
  department: { name: string } | null;
}

export function buildVedomostWorkbook(params: { period: string; components: SalaryComponent[]; employees: VedomostEmployee[]; payroll: PayrollInfo; workDays?: number | null }): ExcelJS.Workbook {
  const { period, components, employees, payroll } = params;
  const active = new Set(components.filter((c) => c.isActive).map((c) => c.code));
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Korxona tahlil';
  wb.created = new Date();
  const [y, m] = period.split('-').map(Number) as [number, number];
  const ws = wb.addWorksheet(`${MONTHS_CYR[m - 1]} ${y}`, { views: [{ state: 'frozen', xSplit: 8, ySplit: TOTAL_ROW }] });

  const thin = { style: 'thin' as const, color: { argb: 'FF9CA3AF' } };
  const border: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const COLOR: Record<ColKind | 'B' | 'H', string> = {
    fixed: 'FFF3F4F6',
    qual: 'FFF9FAFB',
    amount: 'FFFFFFFF',
    calc: 'FFFEF3C7',
    info: 'FFF3F4F6',
    deduct: 'FFFCE7F3',
    check: 'FFE0E7FF',
    B: 'FFDBEAFE',
    H: 'FFDCFCE7',
  };
  const cols = LAYOUT.filter((c) => !c.code || active.has(c.code) || c.kind !== 'amount');
  const L = (i: number) => columnLetter(i + 1);
  const idx = (pred: (c: TCol) => boolean) => cols.findIndex(pred);

  // 1-qator: sarlavha
  ws.getCell(1, 6).value = `${MONTHS_CYR[m - 1]} ойи ${y} — ${params.workDays ? `${params.workDays} иш куни` : '___ иш куни'} · Ish haqi tarkibi (Korxona tahlil)`;
  ws.getCell(1, 6).font = { bold: true, size: 12 };

  // 2–5: sarlavhalar (bir xil qiymatlar birlashtiriladi)
  const grid: string[][] = cols.map((c) => {
    const h = [...c.head];
    // Pastdagi bo'sh qatorlar yuqoridagi bilan birlashadi
    const out: string[] = [];
    for (let r = 0; r < HEAD_ROWS; r++) out.push(h[r] ?? out[r - 1] ?? '');
    return out;
  });
  for (let r = 0; r < HEAD_ROWS; r++) {
    for (let c = 0; c < cols.length; c++) {
      const cell = ws.getCell(HEAD_TOP + r, c + 1);
      cell.value = grid[c]![r]!;
    }
  }
  // Vertikal birlashtirish (bir ustunda pastga), keyin gorizontal (bir qatorda yonma-yon, yuqorisi bir xil bo'lsa)
  const merged = new Set<string>();
  const key = (r: number, c: number) => `${r}:${c}`;
  for (let c = 0; c < cols.length; c++) {
    let r = 0;
    while (r < HEAD_ROWS) {
      let r2 = r;
      while (r2 + 1 < HEAD_ROWS && grid[c]![r2 + 1] === grid[c]![r]) r2++;
      if (r2 > r) {
        // Faqat yonidagi ustunlar bilan gorizontal birlashmaydigan bo'lsa
        ws.mergeCells(HEAD_TOP + r, c + 1, HEAD_TOP + r2, c + 1);
        for (let k = r; k <= r2; k++) merged.add(key(k, c));
      }
      r = r2 + 1;
    }
  }
  for (let r = 0; r < HEAD_ROWS; r++) {
    let c = 0;
    while (c < cols.length) {
      let c2 = c;
      const same = (a: number, b: number) => {
        for (let k = 0; k <= r; k++) if (grid[a]![k] !== grid[b]![k]) return false;
        return true;
      };
      while (c2 + 1 < cols.length && same(c, c2 + 1) && !merged.has(key(r, c2 + 1)) && !merged.has(key(r, c))) c2++;
      if (c2 > c && grid[c]![r]) {
        ws.mergeCells(HEAD_TOP + r, c + 1, HEAD_TOP + r, c2 + 1);
        for (let k = c; k <= c2; k++) merged.add(key(r, k));
      }
      c = c2 + 1;
    }
  }
  cols.forEach((c, i) => {
    const zone = c.head[0] === BG ? 'B' : c.head[0] === HG ? 'H' : null;
    for (let r = 0; r < HEAD_ROWS; r++) {
      const cell = ws.getCell(HEAD_TOP + r, i + 1);
      cell.font = { bold: r < 3, size: r === 0 ? 10 : 9 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = border;
      cell.fill = fill(zone && c.kind !== 'calc' ? COLOR[zone] : COLOR[c.kind]);
    }
    ws.getColumn(i + 1).width = c.width ?? 12;
    // 6: raqamlar, 7: kodlar (yashirin)
    const n = ws.getCell(NUM_ROW, i + 1);
    n.value = i + 1;
    n.alignment = { horizontal: 'center' };
    n.font = { size: 8, color: { argb: 'FF6B7280' } };
    n.border = border;
    const code = ws.getCell(CODE_ROW, i + 1);
    code.value = c.code ?? (c.fixed === 'pinfl' ? SERVICE_CODES.pinfl : c.fixed === 'fullName' ? SERVICE_CODES.fullName : c.fixed === 'days' ? SERVICE_CODES.days : c.fixed === 'rate' ? SERVICE_CODES.rate : c.calc === 'fot' ? SERVICE_CODES.total : null);
  });
  ws.getRow(HEAD_TOP).height = 30;
  ws.getRow(HEAD_TOP + 1).height = 30;
  ws.getRow(HEAD_TOP + 2).height = 48;
  ws.getRow(HEAD_TOP + 3).height = 18;
  ws.getRow(CODE_ROW).hidden = true;

  // Formulalar uchun ustun harflari
  const amountCols = (zone: string) => cols.map((c, i) => ({ c, i })).filter((x) => x.c.kind === 'amount' && x.c.head[0] === zone);
  const fineIdx = idx((c) => c.code === 'JARIMA');
  const at = (calc: TCol['calc']) => idx((c) => c.calc === calc);
  const deduct = (name: string) => idx((c) => c.kind === 'deduct' && c.head.includes(name));
  const budgetIdx = at('budget');
  const hojIdx = at('hojalik');
  const fotIdx = at('fot');
  const netIdx = at('net');
  const restIdx = at('rest');
  const payIdx = at('payroll');
  const diffIdx = at('diff');

  const prepared = employees;
  const lastRow = FIRST_DATA + Math.max(prepared.length, 1) + 40 - 1;
  const formula = (calc: TCol['calc'], r: number): string | null => {
    const sum = (list: { i: number }[]) => (list.length ? list.map((x) => `${L(x.i)}${r}`).join('+') : '0');
    switch (calc) {
      case 'budget': {
        const plus = amountCols(BG).filter((x) => x.i !== fineIdx);
        return `(${sum(plus)})${fineIdx >= 0 ? `-${L(fineIdx)}${r}` : ''}`;
      }
      case 'hojalik': {
        const edo = idx((c) => c.code === 'JARIMA_EDO');
        return `(${sum(amountCols(HG).filter((x) => x.i !== edo))})${edo >= 0 ? `-${L(edo)}${r}` : ''}`;
      }
      case 'fot':
        return `${L(budgetIdx)}${r}+${L(hojIdx)}${r}`;
      case 'net':
        return `${L(fotIdx)}${r}-${['НДФЛ', 'профсоюз', 'Алимент ва МИБ ушланмалари'].map((n) => `${L(deduct(n))}${r}`).join('-')}`;
      case 'rest':
        return `${L(netIdx)}${r}-${L(deduct('Ҳумо'))}${r}-${L(deduct('Узкард'))}${r}`;
      case 'payroll':
        return null;
      case 'diff':
        return `IF(${L(payIdx)}${r}="","",${L(fotIdx)}${r}-${L(payIdx)}${r})`;
      default:
        return null;
    }
  };

  // 8: JAMI
  const tr = ws.getRow(TOTAL_ROW);
  cols.forEach((c, i) => {
    const cell = tr.getCell(i + 1);
    if (i === idx((x) => x.fixed === 'fullName')) cell.value = { formula: `"JAMI: "&COUNTA(${L(idx((x) => x.fixed === 'pinfl'))}${FIRST_DATA}:${L(idx((x) => x.fixed === 'pinfl'))}${lastRow})&" xodim"` };
    else if (['amount', 'calc', 'deduct', 'check'].includes(c.kind) || c.fixed === 'oklad') cell.value = { formula: `SUBTOTAL(9,${L(i)}${FIRST_DATA}:${L(i)}${lastRow})` };
    cell.font = { bold: true };
    cell.fill = fill('FFE5E7EB');
    cell.border = border;
    cell.numFmt = '#,##0.00';
  });

  // Xodimlar
  for (let k = 0; k <= lastRow - FIRST_DATA; k++) {
    const r = FIRST_DATA + k;
    const e = prepared[k];
    const row = ws.getRow(r);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.border = { left: thin, right: thin, bottom: { style: 'hair', color: { argb: 'FFD1D5DB' } } };
      if (c.kind === 'calc' || c.kind === 'check') {
        const f = formula(c.calc, r);
        const pin = `${L(idx((x) => x.fixed === 'pinfl'))}${r}`;
        if (c.calc === 'payroll') {
          const p = e ? payroll.map.get(e.pinfl) : undefined;
          cell.value = p === undefined ? null : toSom(p);
        } else if (f) cell.value = { formula: `IF(${pin}="","",${f})` };
        cell.numFmt = '#,##0.00';
        cell.fill = fill(c.kind === 'check' ? 'FFEEF2FF' : 'FFFFFBEB');
        if (c.calc === 'fot') cell.font = { bold: true };
      } else if (c.kind === 'amount' || c.kind === 'deduct' || c.fixed === 'oklad' || c.fixed === 'daily') {
        cell.numFmt = '#,##0.00';
      } else if (c.kind === 'qual') {
        cell.numFmt = '0.##';
      }
      if (!e) return;
      if (c.fixed === 'num') cell.value = k + 1;
      if (c.fixed === 'pinfl') {
        cell.value = e.pinfl;
        cell.numFmt = '@';
      }
      if (c.fixed === 'fullName') cell.value = e.fullName;
      if (c.fixed === 'position') cell.value = e.position ?? null;
      if (c.fixed === 'place') cell.value = e.regionCode === CENTRAL_REGION ? (e.department?.name ?? 'Markaz') : (e.region?.name ?? '');
      if (c.fixed === 'rate') cell.value = 1;
      if (c.fixed === 'days' && params.workDays) cell.value = params.workDays;
      if (c.fixed === 'workdays' && params.workDays) cell.value = params.workDays;
    });
  }

  // Farq 1 so'mdan katta — qizil
  if (diffIdx >= 0) {
    const d = L(diffIdx);
    ws.addConditionalFormatting({
      ref: `${d}${FIRST_DATA}:${d}${lastRow}`,
      rules: [
        {
          type: 'expression',
          priority: 1,
          formulae: [`AND(${d}${FIRST_DATA}<>"",ABS(${d}${FIRST_DATA})>1)`],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFECACA' } }, font: { color: { argb: 'FFB91C1C' }, bold: true } },
        },
      ],
    });
  }

  // Yo'riqnoma
  const help = wb.addWorksheet("Yo'riqnoma");
  help.getColumn(1).width = 120;
  [
    `ISH HAQI TARKIBI — ${period} (buxgalteriya vedomosti shakli)`,
    '',
    "1. Bu varaq buxgalteriyadagi «OYLIK» vedomost bilan bir xil: ustunlar tartibi va nomlari o'sha. Summalarni o'z vedomostingizdan nusxalab qo'yishingiz mumkin.",
    "2. Xodimlar (PINFL, F.I.O., lavozim, bo'lim) oldindan yozilgan — shu oy soliq hisobotidagi (Ish haqi) xodimlar. Yangi xodimni pastdagi bo'sh qatorga qo'shing.",
    "3. Sariq ustunlar o'zi hisoblanadi: «бюджетдан ФОТ», «Хўжалик ФОТ», «Бир ойлик иш ҳақи фонди (ФОТ)», «қўлига», «Колдиқ».",
    "4. %, к-во, кун ustunlari — ma'lumot uchun; dastur faqat «сумма» ustunlarini o'qiydi. Jarima musbat yoziladi — o'zi ayiriladi.",
    "5. «Farq» qizil bo'lsa — xodimning ФОТ i soliq hisobotidagi summaga mos emas.",
    "6. Buxgalteriyaning o'z faylini (masalan «Январь (умумий) (2026)» varag'i) to'g'ridan-to'g'ri yuklasangiz ham bo'ladi — dastur ustunlarni nomidan taniydi va kerakli varaqni tanlaydi.",
    '',
    payroll.uploaded ? `Soliq hisoboti yuklangan: ${payroll.map.size} xodim.` : "DIQQAT: bu oy uchun soliq hisoboti (Ish haqi) hali yuklanmagan — tekshiruv ustuni bo'sh.",
  ].forEach((line, i) => {
    const cell = help.getCell(i + 1, 1);
    cell.value = line;
    cell.alignment = { wrapText: true };
    if (i === 0) cell.font = { bold: true, size: 13 };
  });
  return wb;
}

// ═══════════════════════════════════════════════════════════
// O'qish
// ═══════════════════════════════════════════════════════════

export interface VedomostDetect {
  headerRow: number;
  /** Shu qatordan keyin xodimlar (raqamlar, kodlar, JAMI — o'tkaziladi) */
  dataStart: number;
  fixed: Partial<Record<FixedKey, number>>;
  comps: Map<string, number>;
  skipped: { column: string; label: string; reason: string }[];
  /** Vedomost shakli (FIO va PINFL bo'sh qatorlar — jami / bo'sh — jimgina o'tkaziladi) */
  vedomost: true;
}

/** Sarlavha qatorlarini topadi: «ПИНФЛ» yozilgan qator va undan keyingi 3–4 qator */
export function detectVedomost(sheet: ExcelJS.Worksheet, components: SalaryComponent[]): VedomostDetect | null {
  const lastCol = Math.min(sheet.columnCount, 260);
  const scan = Math.min(sheet.rowCount, 15);
  let top = 0;
  let pinflCol = 0;
  for (let r = 1; r <= scan && !top; r++) {
    for (let c = 1; c <= Math.min(lastCol, 20); c++) {
      if (headKey(cellText(sheet.getCell(r, c).value)) === 'пинфл') {
        top = r;
        pinflCol = c;
        break;
      }
    }
  }
  if (!top) return null;
  const text = (r: number, c: number) => cellText(sheet.getCell(r, c).value).replace(/\s+/g, ' ').trim();

  // Sarlavha oxiri: raqamlar qatori (1, 2, 3 …) yoki birinchi 14 xonali PINFL
  let numRow = 0;
  let dataStart = 0;
  for (let r = top + 1; r <= Math.min(sheet.rowCount, top + 10); r++) {
    const pin = text(r, pinflCol).replace(/\D/g, '');
    if (pin.length === 14) {
      dataStart = r;
      break;
    }
    if (!numRow) {
      let small = 0;
      for (let c = 1; c <= Math.min(lastCol, 40); c++) {
        const v = sheet.getCell(r, c).value;
        if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 400) small += 1;
      }
      if (small >= 5) numRow = r;
    }
  }
  let bottom = numRow ? numRow - 1 : dataStart ? dataStart - 1 : top + 3;
  bottom = Math.max(top, Math.min(bottom, top + 4));
  if (!dataStart) dataStart = numRow ? numRow + 1 : bottom + 1;

  // Yashirin kodlar qatori (dastur shabloni)
  const codeSet = new Set(components.map((c) => c.code));
  for (let r = top; r < dataStart; r++) {
    const comps = new Map<string, number>();
    const fixed: Partial<Record<FixedKey, number>> = {};
    for (let c = 1; c <= lastCol; c++) {
      const v = text(r, c).toUpperCase();
      if (codeSet.has(v) && !comps.has(v)) comps.set(v, c);
      if (v === SERVICE_CODES.pinfl) fixed.pinfl = c;
      if (v === SERVICE_CODES.fullName) fixed.fullName = c;
      if (v === SERVICE_CODES.days) fixed.days = c;
      if (v === SERVICE_CODES.rate) fixed.rate = c;
      if (v === SERVICE_CODES.total) fixed.total = c;
    }
    if (comps.size >= 5 && fixed.pinfl) return { headerRow: r, dataStart, fixed, comps, skipped: [], vedomost: true };
  }

  // Sarlavhalar bo'yicha
  const fixed: Partial<Record<FixedKey, number>> = { pinfl: pinflCol };
  const comps = new Map<string, number>();
  const skipped: VedomostDetect['skipped'] = [];
  const seen = new Map<string, number>();
  const frontParts = new Map<string, { c: number; label: string }>();
  let prevLeaf = '';
  let prevQualified = false;
  let prevKey = '';
  for (let c = 1; c <= lastCol; c++) {
    const levels: string[] = [];
    for (let r = top; r <= bottom; r++) {
      const t = text(r, c);
      if (t && levels[levels.length - 1] !== t) levels.push(t);
    }
    if (!levels.length) {
      prevLeaf = '';
      continue;
    }
    const z0 = headKey(levels[0]!);
    // Zona: guruh sarlavhasi («… бериладиган кушимчалар»); «… ФОТ» jami ustunlari — zona emas
    const isTotal = z0.includes('фот');
    const zone: Zone = isTotal ? 'F' : z0.includes('бюджетмаблаг') ? 'B' : z0.includes('хужаликхисоб') || z0.includes('хожаликхисоб') ? 'H' : 'F';
    const s1 = levels[1] ? headKey(levels[1]) : '';
    const section: Section = zone === 'F' ? '' : s1.startsWith('ишлагандавр') ? 'W' : s1.startsWith('ишлаганкунлар') ? 'N' : '';
    // Nom va aniqlovchi
    const rest = levels.slice(zone === 'F' ? 0 : section ? 2 : 1);
    let qual = '';
    let leafRaw = '';
    for (let k = rest.length - 1; k >= 0; k--) {
      const t = rest[k]!;
      if (!leafRaw && isQualifier(t) && !qual) qual = t;
      else if (!leafRaw) leafRaw = t;
    }
    // Faqat «сумма» — oldingi ustunning nomi (masalan «овқат | кун», keyin «сумма»)
    if (!leafRaw) leafRaw = prevLeaf;
    const leaf = headKey(leafRaw);
    const col = columnLetter(c);
    const label = levels.join(' › ');

    if (zone === 'F') {
      if (leaf === 'фио') fixed.fullName = c;
      else if (leaf === 'ставка') fixed.rate = c;
      else if (leaf.startsWith('фактотрабдень')) fixed.days = c;
      else if (leaf.startsWith('биройликишхакифонди')) fixed.total = c;
      prevLeaf = leafRaw;
      continue;
    }
    // Aniqlovchi ustun (% / soni / kun) — o'tkaziladi
    const sameAsPrev = leaf === prevKey && !qual && !prevQualified;
    let isAmount = !qual || isAmountQualifier(qual);
    // Bir nomli ikki ustun ketma-ket, aniqlovchisiz (masalan «Бир ойлик оклади … мукофот» 22 | 23): birinchisi — foiz
    const nextLevels: string[] = [];
    for (let r = top; r <= bottom; r++) {
      const t = text(r, c + 1);
      if (t && nextLevels[nextLevels.length - 1] !== t) nextLevels.push(t);
    }
    const nextLeaf = nextLevels.length ? headKey(nextLevels[nextLevels.length - 1]!) : '';
    if (!qual && nextLeaf === leaf && !sameAsPrev) isAmount = false;
    prevLeaf = leafRaw;
    prevKey = leaf;
    prevQualified = Boolean(qual) && !isAmountQualifier(qual);
    if (!isAmount) continue;
    // EDO / test jarimalari: faqat «Жарима суммаси» — ayiriladi (xo'jalik ФОТ dan), qolganlari (soni, %) — o'tkaziladi
    if (zone === 'H' && headKey(levels.join(' ')).includes('жарималар') && !leaf.includes('сумма')) continue;

    const occKey = `${zone}|${section}|${leaf}`;
    const occ = seen.get(occKey) ?? 0;
    seen.set(occKey, occ + 1);
    const pathKey = headKey(levels.join(' '));
    const rule = RULES.find((x) => x.zone === zone && (!x.section || x.section === section) && x.test(leaf, pathKey) && (x.occurrence === undefined || x.occurrence === occ));
    if (!rule) {
      skipped.push({ column: col, label, reason: 'tanilmadi' });
      continue;
    }
    if (!rule.code) {
      skipped.push({ column: col, label, reason: rule.why ?? "o'tkazildi" });
      continue;
    }
    if (rule.code === 'FRONT_OY' || rule.code === 'FRONT_FARQ') {
      frontParts.set(rule.code, { c, label });
      continue;
    }
    if (!codeSet.has(rule.code)) {
      skipped.push({ column: col, label, reason: `komponent «${rule.code}» bazada yo'q` });
      continue;
    }
    if (comps.has(rule.code)) {
      skipped.push({ column: col, label, reason: `«${rule.code}» oldingi ustunda olindi` });
      continue;
    }
    comps.set(rule.code, c);
  }
  // Front: umumiy «(фронт 45%)» ustuni bo'lsa — oy summasi va farq alohida olinmaydi (ikki marta sanalmasin)
  const oy = frontParts.get('FRONT_OY');
  const farq = frontParts.get('FRONT_FARQ');
  if (comps.has('FRONT')) {
    if (oy) skipped.push({ column: columnLetter(oy.c), label: oy.label, reason: '«фронт 45%» ustuni ichida' });
    if (farq) skipped.push({ column: columnLetter(farq.c), label: farq.label, reason: '«фронт 45%» ustuni ichida' });
  } else {
    if (oy) comps.set('FRONT', oy.c);
    if (farq && codeSet.has('FRONT_FARQ')) comps.set('FRONT_FARQ', farq.c);
  }
  if (comps.size < 3 || !fixed.fullName) return null;
  // Faqat summasi bor (0 emas) o'tkazilgan ustunlar — foydalanuvchi bilsin
  const meaningful = skipped.filter((s) => {
    const c = colIndex(s.column);
    for (let r = dataStart; r <= Math.min(sheet.rowCount, dataStart + 400); r++) {
      const n = parseNumber(sheet.getCell(r, c).value);
      if (n && !Number.isNaN(n)) return true;
    }
    return false;
  });
  return { headerRow: bottom, dataStart, fixed, comps, skipped: meaningful, vedomost: true };
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const MONTH_KEYS: string[][] = [
  ['январ', 'yanvar', 'january'],
  ['феврал', 'fevral', 'february'],
  ['март', 'mart', 'march'],
  ['апрел', 'aprel', 'april'],
  ['май', 'may'],
  ['июн', 'iyun', 'june'],
  ['июл', 'iyul', 'july'],
  ['август', 'avgust', 'august'],
  ['сентябр', 'sentabr', 'sentyabr', 'september'],
  ['октябр', 'oktabr', 'october'],
  ['ноябр', 'noyabr', 'november'],
  ['декабр', 'dekabr', 'december'],
];

/** Varaq tanlash: oy nomi (va yil) mos, «умумий» / «марказ» — ustun; GPX (ГПХ) va yordamchi varaqlar — oxirida */
export function rankSheets(names: string[], period: string): string[] {
  const [y, m] = period.split('-');
  const keys = MONTH_KEYS[Number(m) - 1]!;
  const score = (name: string) => {
    const k = name.toLowerCase();
    let s = 0;
    if (keys.some((x) => k.includes(x))) s += 10;
    if (k.includes(String(y))) s += 4;
    if (/умумий|umumiy/.test(k)) s += 2;
    if (/марказ|markaz/.test(k)) s += 1;
    if (/гпх|gpx|gph|chernov|лист|sheet/.test(k)) s -= 8;
    if (k === 'tarkib') s += 15;
    return s;
  };
  return [...names].sort((a, b) => score(b) - score(a));
}