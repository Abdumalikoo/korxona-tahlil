import type ExcelJS from 'exceljs';

// ═══════════════════════════════════════════════════════════
// Biznes-reja (2026 йил режаси, 1–6-иловалар) va choraklik ijro — umumiy tuzilma.
// Bir xil tuzilma: ekrandagi hisobot ham, formulali Excel ham shundan quriladi.
// Pul — млн.сўм (asl rejadagi kabi).
// ═══════════════════════════════════════════════════════════

export const S = {
  UO: 'Умумий объем',
  R: 'Расшифрофка Ф-2',
  H: 'Хомийлик',
  SF: 'Соф фойдани тақсимлаш',
  HU: 'Худудлар (свод)',
  IH: 'Иш хаки (2)',
  KPI: 'КПЭ',
  SOL: 'Соликлар',
  F2: 'Ф-2',
} as const;

export const REQUIRED_SHEETS = Object.values(S);

/** Fakt qatori: kalit, bo'lim, nomi, turi */
export type LineKind = 'in' | 'out' | 'count' | 'balance';
export interface FactLine {
  key: string;
  section: string;
  name: string;
  kind: LineKind;
  /** Ҳудудий хизматлар — «Факт ҳудудлар»dan avtomatik (kiritilmaydi) */
  derived?: boolean;
  hint?: string;
}

export const CENTER_REV: [number, string][] = [
  [10, 'Солиқ хизмати органларига техник кўмаклашиш'],
  [11, 'Солиқ қўмитаси оргтехникаларига техник хизмат'],
  [12, 'Электрон ҳужжат айланиши ва виртуал касса дастури'],
  [13, 'ЯТИАМ'],
  [14, 'E-pos терминали'],
  [15, 'Узум банк'],
  [16, 'Солиқ маслаҳати'],
  [17, 'Маркшейдерлик'],
];
export const UO_REG: [string, number, string][] = [
  ['1.12', 23, 'Компьютер ва техник хизматлар'],
  ['1.13', 24, 'Ахборот хизматлари'],
  ['1.14', 25, 'Интерактив хизматлар'],
  ['1.15', 26, 'Электрон солиқ ҳисоботларни тайёрлаш ва юбориш'],
  ['1.16', 27, 'Жисмоний шахслар йиллик даромади декларацияси'],
];
export const COST: [number, string][] = [
  [22, 'Ишлаб чиқариш ходимлари иш ҳақи ва тенглаштирилган тўловлар'],
  [23, 'Ижтимоий солиқ'],
  [24, 'Ижара ва коммунал тўловлар'],
  [25, 'Канцелярия ва хўжалик моллари'],
  [26, 'Асосий воситалар эскириши'],
  [27, 'Хизмат сафари'],
  [28, 'Бошқа ишлаб чиқариш харажатлари'],
];
export const ADM: [number, string][] = [
  [31, 'Бошқарув ходимлари иш ҳақи'],
  [32, 'Ижтимоий солиқ'],
  [33, 'Ижара ва коммунал'],
  [34, 'Алоқа ва интернет'],
  [35, 'Транспорт (таъмир, ЁММ ва б.)'],
  [36, 'Хизмат сафари'],
  [37, 'Канцелярия ва хўжалик моллари'],
  [38, 'Асосий воситалар эскириши'],
  [39, 'Бошқа маъмурий харажатлар'],
];
export const OPX: [number, string][] = [
  [41, 'Онлайн НКМ ва виртуал касса ойлик тўлови'],
  [42, 'Солиқ ва мажбурий тўловлар'],
  [43, 'Роуминг оператори (ЭСФ)'],
  [44, 'Фискал модул'],
  [45, 'Асосий восита ва бошқа ТМЗ'],
  [46, 'Дастурий маҳсулотларни такомиллаштириш'],
  [47, 'ДСҚ оргтехникаси учун тонер-картридж'],
  [48, 'Бошқа харажатлар'],
];
export const FIN: [string, string][] = [
  ['F120', 'Дивидендлар шаклидаги даромадлар'],
  ['F130', 'Фоизлар шаклидаги даромадлар'],
  ['F140', 'Молиявий ижарадан даромадлар'],
  ['F150', 'Валюта курси фарқидан даромадлар'],
  ['F160', 'Молиявий фаолиятнинг бошқа даромадлари'],
  ['F180', 'Фоизлар шаклидаги харажатлар'],
  ['F190', 'Молиявий ижара бўйича фоиз харажатлари'],
  ['F200', 'Валюта курси фарқидан зарарлар'],
  ['F210', 'Молиявий фаолиятнинг бошқа харажатлари'],
  ['F050', 'Сотиш харажатлари'],
  ['F230', 'Фавқулодда фойда (+) ёки зарар (−)'],
  ['F250', 'Фойда солиғи'],
  ['F260', 'Фойдадан бошқа солиқлар ва мажбурий тўловлар'],
];
export const FIN_IN = ['F120', 'F130', 'F140', 'F150', 'F160'];
export const FIN_OUT = ['F180', 'F190', 'F200', 'F210'];
export const TAX: [number, string][] = [
  [8, 'Даромад (фойда) солиғи'],
  [9, 'Қўшилган қиймат солиғи (ҚҚС)'],
  [10, 'Акциз солиғи'],
  [11, 'Ижтимоий тўлов (ЯИТ)'],
  [12, 'Ер ости бойликларидан фойдаланганлик солиғи'],
  [13, 'Бошқа солиқлар'],
];
export const PAY: [number, string][] = [
  [9, 'Бошқарув органлари'],
  [15, 'Маъмурий бошқарув ходимлари (марказий аппарат)'],
  [16, 'Call-марказ'],
  [17, 'Мобил илова'],
  [18, 'Tax free'],
  [19, 'Ҳудудий бўлинмалар'],
  [34, 'Техник ва хизмат кўрсатувчи ходимлар'],
];
export const HOM: [number, string][] = [
  [9, 'Президент ва Ҳукумат қарорларига асосан'],
  [11, 'Президент Администрацияси ва Ҳукумат топшириқларига асосан'],
  [13, 'Бошқа асосларга кўра'],
];
export const BAL: [string, string][] = [
  ['B_ACT', 'Жами активлар (ўртача)'],
  ['B_CUR', 'Жорий (айланма) активлар'],
  ['B_CL', 'Жорий мажбуриятлар'],
  ['B_EQ', 'Ўз капитали'],
  ['B_LIAB', 'Жами мажбуриятлар'],
];

export const SECTIONS = [
  '1. Соф тушум — Марказий аппарат',
  '2. Соф тушум — Ҳудудий бўлинмалар',
  '3. Асосий фаолиятнинг бошқа даромадлари',
  '4. Таннарх',
  '5. Маъмурий харажатлар',
  '6. Бошқа операцион харажатлар',
  '7. Молиявий фаолият, фавқулодда ва солиқлар (Ф-2)',
  '8. Бюджетга тўловлар (5-илова)',
  '9. Иш ҳақи фонди ва ходимлар сони',
  '10. Ҳомийлик',
  '11. Баланс кўрсаткичлари (КПЭ учун)',
];

export const FACT_LINES: FactLine[] = [
  ...CENTER_REV.map(([r, n]) => ({ key: `R${r}`, section: SECTIONS[0]!, name: n, kind: 'in' as const })),
  ...UO_REG.map(([c, r, n]) => ({ key: `U${r}`, section: SECTIONS[1]!, name: `${c} ${n}`, kind: 'in' as const, derived: true })),
  { key: 'R20', section: SECTIONS[2]!, name: 'Бошқа даромадлар', kind: 'in' },
  ...COST.map(([r, n]) => ({ key: `R${r}`, section: SECTIONS[3]!, name: n, kind: 'out' as const })),
  ...ADM.map(([r, n]) => ({ key: `R${r}`, section: SECTIONS[4]!, name: n, kind: 'out' as const })),
  ...OPX.map(([r, n]) => ({ key: `R${r}`, section: SECTIONS[5]!, name: n, kind: 'out' as const })),
  ...FIN.map(([k, n]) => ({ key: k, section: SECTIONS[6]!, name: n, kind: (FIN_IN.includes(k) || k === 'F230' ? 'in' : 'out') as LineKind })),
  ...TAX.map(([r, n]) => ({ key: `T${r}`, section: SECTIONS[7]!, name: n, kind: 'out' as const })),
  ...PAY.map(([r, n]) => ({ key: `P${r}`, section: SECTIONS[8]!, name: `Иш ҳақи: ${n}`, kind: 'out' as const })),
  ...PAY.map(([r, n]) => ({ key: `N${r}`, section: SECTIONS[8]!, name: `Ходимлар сони: ${n}`, kind: 'count' as const })),
  ...HOM.map(([r, n]) => ({ key: `H${r}`, section: SECTIONS[9]!, name: n, kind: 'out' as const })),
  ...BAL.map(([k, n]) => ({ key: k, section: SECTIONS[10]!, name: n, kind: 'balance' as const })),
];
export const FACT_KEYS = new Set(FACT_LINES.map((l) => l.key));

/** Ҳудудий хизмат гуруҳлари («Худудлар (свод)» 2026 режа қатори, 2025 факт қатори, бошланғич боғлаш) */
export const GROUPS: { name: string; plan: number; prior: number; uo: string }[] = [
  { name: 'Компьютер ва техник хизматлар', plan: 13, prior: 12, uo: '1.12' },
  { name: 'Ахборот хизматлари', plan: 16, prior: 15, uo: '1.13' },
  { name: 'Интерактив хизматлар', plan: 31, prior: 30, uo: '1.14' },
  { name: 'Электрон солиқ ҳисоботлари', plan: 67, prior: 66, uo: '1.15' },
  { name: 'Жисмоний шахслар декларацияси', plan: 70, prior: 69, uo: '1.16' },
  { name: 'Бошқа хизматлар', plan: 73, prior: 72, uo: '1.15' },
  { name: 'Янги жорий этилган хизматлар', plan: 76, prior: 75, uo: '1.15' },
];

/** 14 ҳудуд — «Худудлар (свод)» F..S тартибида; stem — дастурдаги (лотин) номни топиш учун */
export const REGIONS: { name: string; stem: string; extra?: string }[] = [
  { name: 'Қорақалпоғистон Республикаси', stem: 'qoraqalp' },
  { name: 'Андижон вилояти', stem: 'andijon' },
  { name: 'Бухоро вилояти', stem: 'buxoro' },
  { name: 'Жиззах вилояти', stem: 'jizzax' },
  { name: 'Қашқадарё вилояти', stem: 'qashqa' },
  { name: 'Навоий вилояти', stem: 'navoiy' },
  { name: 'Наманган вилояти', stem: 'namangan' },
  { name: 'Самарқанд вилояти', stem: 'samarqand' },
  { name: 'Сурхондарё вилояти', stem: 'surxon' },
  { name: 'Сирдарё вилояти', stem: 'sirdar' },
  { name: 'Тошкент вилояти', stem: 'toshkent', extra: 'vil' },
  { name: 'Фарғона вилояти', stem: 'farg' },
  { name: 'Хоразм вилояти', stem: 'xorazm' },
  { name: 'Тошкент шаҳри', stem: 'toshkent', extra: 'sh' },
];

export function colName(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
export const REG_COLS = REGIONS.map((_, i) => colName(6 + i)); // F..S

/** Дастурдаги ҳудуд номини (лотин/кирилл) 14 тадан бирига мослаш */
export function regionIndex(name: string): number {
  const n = name
    .toLowerCase()
    .replace(/[‘’ʻʼ'`]/g, '')
    .replace(/ш/g, 'sh')
    .replace(/х/g, 'x')
    .replace(/қ/g, 'q')
    .replace(/ғ/g, 'g')
    .replace(/ў/g, 'o');
  const cyr: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', ц: 's', ч: 'ch', ъ: '', ь: '', э: 'e', ю: 'yu', я: 'ya', ҳ: 'h' };
  const lat = n.replace(/[а-яёҳ]/g, (ch) => cyr[ch] ?? ch);
  for (let i = 0; i < REGIONS.length; i += 1) {
    const r = REGIONS[i]!;
    if (!lat.includes(r.stem)) continue;
    if (!r.extra) return i;
    const city = /shah|sh\.|city|shahar/.test(lat) && !/viloyat/.test(lat);
    if (r.extra === 'sh' ? city : !city) return i;
  }
  return -1;
}

// ═══════════ Режа (асл файл) ═══════════

export type Grid = Record<string, Record<string, number>>;

/** Асл файлдан керакли варақларнинг сон қийматлари (формула натижалари ҳам) */
export function readPlanGrid(wb: ExcelJS.Workbook): Grid {
  const g: Grid = {};
  for (const name of REQUIRED_SHEETS) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    const out: Record<string, number> = {};
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (c) => {
        const v = c.value as unknown;
        let num: unknown = v;
        if (v && typeof v === 'object') {
          const o = v as { result?: unknown; formula?: unknown; sharedFormula?: unknown };
          num = 'result' in o ? o.result : undefined;
        }
        if (typeof num === 'number' && Number.isFinite(num)) out[c.address] = num;
        else if (typeof num === 'string' && num.trim() !== '' && Number.isFinite(Number(num.replace(',', '.')))) out[c.address] = Number(num.replace(',', '.'));
      });
    });
    g[name] = out;
  }
  return g;
}

export function gv(g: Grid, sheet: string, addr: string): number {
  return g[sheet]?.[addr] ?? 0;
}

// ═══════════ Ҳисоб ═══════════

export type Mode = 'quarter' | 'ytd';
export type Q4 = [number, number, number, number];

export function per(q: number[], quarter: number, mode: Mode): number {
  if (mode === 'quarter') return q[quarter - 1] ?? 0;
  let s = 0;
  for (let i = 0; i < quarter; i += 1) s += q[i] ?? 0;
  return s;
}

export interface ExecRow {
  code: string;
  name: string;
  level: 0 | 1 | 2;
  /** 1 — даромад (кўпи яхши), -1 — харажат */
  sign: 1 | -1;
  prior: number | null;
  annual: number | null;
  plan: number | null;
  fact: number | null;
}

export interface Facts {
  /** калит → 4 чорак (null — киритилмаган) */
  lines: Record<string, (number | null)[]>;
  /** чорак → ҳудуд → гуруҳ */
  regions: (number | null)[][][];
  /** гуруҳ → «Умумий объем» қатори коди */
  groupMap: string[];
}

export function factQ(f: Facts, key: string): number[] {
  if (key.startsWith('U')) {
    const row = Number(key.slice(1));
    const code = UO_REG.find(([, r]) => r === row)?.[0];
    return [0, 1, 2, 3].map((qi) => {
      let s = 0;
      GROUPS.forEach((_, gi) => {
        if ((f.groupMap[gi] ?? GROUPS[gi]!.uo) !== code) return;
        for (const reg of f.regions[qi] ?? []) s += reg?.[gi] ?? 0;
      });
      return s;
    });
  }
  const v = f.lines[key] ?? [];
  return [0, 1, 2, 3].map((i) => v[i] ?? 0);
}