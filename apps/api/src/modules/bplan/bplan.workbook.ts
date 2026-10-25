import ExcelJS from 'exceljs';
import { ADM, BAL, CENTER_REV, colName as CL, COST, FACT_LINES, FIN, GROUPS, HOM, OPX, PAY, REG_COLS, REGIONS, S, TAX, UO_REG, type Facts, type Mode } from './bplan.model';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';

// ═══════════════════════════════════════════════════════════
// Choraklik ijro — to'liq formulali Excel.
// Asl reja varaqlari o'zgarishsiz qoladi; ustiga «Созлама», «Факт», «Факт ҳудудлар»,
// «Ижро …» (formulalar) va «Текширув» qo'shiladi. Chorak va tartib «Созлама»da tanlanadi.
// ═══════════════════════════════════════════════════════════

const FONT = 'Times New Roman';
const F_N: Partial<ExcelJS.Font> = { name: FONT, size: 11 };
const F_B: Partial<ExcelJS.Font> = { name: FONT, size: 11, bold: true };
const F_T: Partial<ExcelJS.Font> = { name: FONT, size: 14, bold: true };
const F_S: Partial<ExcelJS.Font> = { name: FONT, size: 9, italic: true, color: { argb: 'FF595959' } };
const F_H: Partial<ExcelJS.Font> = { name: FONT, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
const fill = (hex: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${hex}` } });
const FILL_H = fill('1F4E79');
const FILL_SUB = fill('DDEBF7');
const FILL_TOT = fill('BDD7EE');
const FILL_IN = fill('FFF2CC');
const FILL_SET = fill('E2EFDA');
const GREEN = fill('C6EFCE');
const AMBER = fill('FFEB9C');
const RED = fill('FFC7CE');
const thin: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: 'FFA6A6A6' } };
const BOX: Partial<ExcelJS.Borders> = { left: thin, right: thin, top: thin, bottom: thin };
const NUM = '#,##0.0;[Red]-#,##0.0;"–"';
const INT = '#,##0;[Red]-#,##0;"–"';
const PCT = '0.0%;[Red]-0.0%;"–"';
const WRAP: Partial<ExcelJS.Alignment> = { wrapText: true, vertical: 'middle' };
const CENTER: Partial<ExcelJS.Alignment> = { horizontal: 'center', vertical: 'middle', wrapText: true };

const q = (sheet: string) => `'${sheet.replace(/'/g, "''")}'`;

type Val = string | number | ExcelJS.CellRichTextValue | null | undefined;

/**
 * Foydalanuvchi matni (nomlar, izohlar): «=» bilan boshlansa ham formula bo'lib qolmasin —
 * katakka oddiy matn sifatida yoziladi (Excel'da formula ishga tushmaydi).
 */
export function txt(v: string | null | undefined): Val {
  if (v === null || v === undefined || v === '') return v;
  return /^[=+\-@\t\r]/.test(v) ? ({ richText: [{ text: v }] } as ExcelJS.CellRichTextValue) : v;
}

function put(ws: ExcelJS.Worksheet, ref: string, value: Val, o: { font?: Partial<ExcelJS.Font>; fill?: ExcelJS.Fill; fmt?: string; align?: Partial<ExcelJS.Alignment>; border?: boolean } = {}) {
  const c = ws.getCell(ref);
  if (value !== undefined && value !== null && value !== '') {
    if (typeof value === 'string' && value.startsWith('=')) c.value = { formula: value.slice(1) } as ExcelJS.CellFormulaValue;
    else c.value = value;
  }
  c.font = o.font ?? F_N;
  if (o.fill) c.fill = o.fill;
  if (o.fmt) c.numFmt = o.fmt;
  if (o.align) c.alignment = o.align;
  if (o.border !== false) c.border = BOX;
  return c;
}

function title(ws: ExcelJS.Worksheet, text: string, sub: string, width: number) {
  ws.mergeCells(1, 1, 1, width);
  put(ws, 'A1', text, { font: F_T, border: false, align: { vertical: 'middle' } });
  ws.mergeCells(2, 1, 2, width);
  put(ws, 'A2', sub, { font: F_S, border: false });
  ws.getRow(1).height = 22;
}

function header(ws: ExcelJS.Worksheet, row: number, labels: string[], widths?: number[]) {
  labels.forEach((lab, i) => put(ws, `${CL(i + 1)}${row}`, lab, { font: F_H, fill: FILL_H, align: CENTER }));
  ws.getRow(row).height = 42;
  widths?.forEach((w, i) => (ws.getColumn(i + 1).width = w));
}

/** Давр: чорак ёки йил бошидан йиғма */
function per(a: string, b: string, c: string, d: string): string {
  return `IF(РЕЖИМ="Чорак",CHOOSE(ЧОРАК,${a},${b},${c},${d}),CHOOSE(ЧОРАК,${a},(${a})+(${b}),(${a})+(${b})+(${c}),(${a})+(${b})+(${c})+(${d})))`;
}

function cf(ws: ExcelJS.Worksheet, ref: string, rules: { formula: string; fill: ExcelJS.Fill }[]) {
  ws.addConditionalFormatting({
    ref,
    rules: rules.map((r, i) => ({ type: 'expression', priority: i + 1, formulae: [r.formula], style: { fill: r.fill } })) as ExcelJS.ConditionalFormattingRule[],
  });
}

export interface BuildOptions {
  year: number;
  quarter: number;
  mode: Mode;
  facts: Facts;
  /** Манба изоҳи: калит → матн (масалан, «Даромадлар: Узум банк») */
  notes?: Record<string, string>;
}

export async function buildWorkbook(source: Buffer, o: BuildOptions): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await assertSafeXlsx(source);
  await wb.xlsx.load(source as unknown as ExcelJS.Buffer);
  for (const n of Object.values(S)) if (!wb.getWorksheet(n)) throw new Error(`«${n}» варағи топилмади`);
  const original = wb.worksheets.map((w) => w.name);

  // ═══════════ Созлама ═══════════
  const st = wb.addWorksheet('Созлама', { properties: { tabColor: { argb: 'FF548235' } } });
  title(st, 'Ҳисобот созламаси', 'Чоракни ва ҳисоблаш тартибини танланг — барча «Ижро» варақлари ўзи қайта ҳисобланади', 6);
  st.getColumn(1).width = 34;
  st.getColumn(2).width = 18;
  put(st, 'A4', 'Йил', { font: F_B });
  put(st, 'B4', o.year, { font: F_B, fill: FILL_SET, align: CENTER });
  put(st, 'A5', 'Чорак (1–4)', { font: F_B });
  put(st, 'B5', o.quarter, { font: F_B, fill: FILL_SET, align: CENTER });
  put(st, 'A6', 'Ҳисоблаш тартиби', { font: F_B });
  put(st, 'B6', o.mode === 'quarter' ? 'Чорак' : 'Йил бошидан', { font: F_B, fill: FILL_SET, align: CENTER });
  put(st, 'A7', 'Давр номи', { font: F_B });
  put(st, 'B7', '=IF(B6="Чорак",B5&"-чорак "&B4,IF(B5=1,"1-чорак ",IF(B5=2,"1-ярим йил ",IF(B5=3,"9 ой ","Йил ")))&B4)', { font: F_B, align: CENTER });
  put(st, 'A8', 'Ўлчов бирлиги');
  put(st, 'B8', 'млн.сўм', { align: CENTER });
  st.getCell('B5').dataValidation = { type: 'list', allowBlank: false, formulae: ['"1,2,3,4"'] };
  st.getCell('B6').dataValidation = { type: 'list', allowBlank: false, formulae: ['"Чорак,Йил бошидан"'] };
  put(st, 'C5', '← рўйхатдан танланг', { font: F_S, border: false });
  put(st, 'C6', '← «Чорак» — фақат шу чорак; «Йил бошидан» — 1-чоракдан шу чоракгача йиғма', { font: F_S, border: false });
  wb.definedNames.add(`'Созлама'!$B$5`, 'ЧОРАК');
  wb.definedNames.add(`'Созлама'!$B$6`, 'РЕЖИМ');
  wb.definedNames.add(`'Созлама'!$B$7`, 'ДАВР');
  put(st, 'A10', '«Факт ҳудудлар» гуруҳини «Умумий объем» қаторига боғлаш', { font: F_B, border: false });
  put(st, 'A11', 'Гуруҳ', { font: F_B, fill: FILL_SUB });
  put(st, 'A12', '«Умумий объем» қатори', { font: F_B, fill: FILL_SUB });
  GROUPS.forEach((gr, i) => {
    const col = CL(2 + i);
    st.getColumn(2 + i).width = 17;
    put(st, `${col}11`, txt(gr.name), { fill: FILL_SUB, align: CENTER });
    put(st, `${col}12`, o.facts.groupMap[i] ?? gr.uo, { font: F_B, fill: FILL_SET, align: CENTER });
    st.getCell(`${col}12`).dataValidation = { type: 'list', allowBlank: false, formulae: [`"${UO_REG.map(([c]) => c).join(',')}"`] };
  });
  st.getRow(11).height = 45;
  put(st, 'A13', '«Бошқа» ва «Янги жорий этилган» хизматлар режада алоҳида қатор эмас — улар қайси қатор фактига қўшилишини шу ерда белгиланг.', { font: F_S, border: false });
  const MAP = "'Созлама'!$B$12:$H$12";

  // ═══════════ Факт ═══════════
  const fk = wb.addWorksheet('Факт', { properties: { tabColor: { argb: 'FFBF8F00' } }, views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });
  title(fk, 'Факт кўрсаткичлар (чораклар бўйича)', 'Сариқ катаклар — киритилади (дастур ўзи тўлдиради). Ҳудудий хизматлар — «Факт ҳудудлар»дан. млн.сўм', 8);
  header(fk, 4, ['Калит', 'Кўрсаткич', '1-чорак', '2-чорак', '3-чорак', '4-чорак', 'Жами йил', 'Манба / изоҳ'], [8, 62, 14, 14, 14, 14, 15, 40]);
  const FROW: Record<string, number> = {};
  let r = 5;
  let section = '';
  for (const line of FACT_LINES) {
    if (line.section !== section) {
      section = line.section;
      fk.mergeCells(`A${r}:H${r}`);
      put(fk, `A${r}`, txt(section), { font: F_B, fill: FILL_SUB });
      r += 1;
    }
    FROW[line.key] = r;
    put(fk, `A${r}`, line.key, { font: F_S, align: CENTER });
    put(fk, `B${r}`, txt(line.name), { align: WRAP });
    const vals = o.facts.lines[line.key] ?? [];
    for (let i = 0; i < 4; i += 1) {
      const col = 'CDEF'[i]!;
      if (line.derived) put(fk, `${col}${r}`, null, { fmt: NUM });
      else put(fk, `${col}${r}`, typeof vals[i] === 'number' ? round(vals[i] as number) : null, { fill: FILL_IN, fmt: NUM });
    }
    put(fk, `G${r}`, line.kind === 'balance' ? `=F${r}` : line.kind === 'count' ? `=IFERROR(AVERAGE(C${r}:F${r}),"")` : `=SUM(C${r}:F${r})`, { font: F_B, fmt: NUM });
    put(fk, `H${r}`, txt(o.notes?.[line.key]) ?? (line.derived ? 'Ўзи йиғилади' : line.kind === 'balance' ? 'Бухгалтерия баланси; «Жами» — 4-чорак' : line.kind === 'count' ? 'Чорак ўртачаси, киши; «Жами» — ўртача' : ''), {
      font: F_S,
      align: WRAP,
    });
    r += 1;
  }
  const F = (key: string, col: string) => `'Факт'!$${col}$${FROW[key]}`;
  const fper = (key: string) => per(F(key, 'C'), F(key, 'D'), F(key, 'E'), F(key, 'F'));

  // ═══════════ Факт ҳудудлар ═══════════
  const fh = wb.addWorksheet('Факт ҳудудлар', { properties: { tabColor: { argb: 'FFBF8F00' } }, views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }] });
  title(fh, 'Ҳудудлар факти — хизмат гуруҳлари бўйича (чораклар)', 'Сариқ катаклар — киритилади (дастур ўзи тўлдиради). Ҳар чорак алоҳида жадвал. млн.сўм', 9);
  fh.getColumn(1).width = 30;
  for (let i = 0; i <= GROUPS.length; i += 1) fh.getColumn(2 + i).width = 15;
  const BLOCK = 20;
  const FH_ROW: Record<string, number> = {};
  const FH_TOT: Record<number, number> = {};
  for (let qn = 1; qn <= 4; qn += 1) {
    const top = 4 + (qn - 1) * BLOCK;
    fh.mergeCells(top, 1, top, 9);
    put(fh, `A${top}`, `${qn}-чорак`, { font: F_B, fill: FILL_SUB });
    header(fh, top + 1, ['Ҳудуд', ...GROUPS.map((g) => g.name), 'Жами']);
    REGIONS.forEach((reg, i) => {
      const rr = top + 2 + i;
      FH_ROW[`${qn}:${i}`] = rr;
      put(fh, `A${rr}`, txt(reg.name));
      GROUPS.forEach((_, j) => {
        const v = o.facts.regions[qn - 1]?.[i]?.[j];
        put(fh, `${CL(2 + j)}${rr}`, typeof v === 'number' ? round(v) : null, { fill: FILL_IN, fmt: NUM });
      });
      put(fh, `I${rr}`, `=SUM(B${rr}:H${rr})`, { font: F_B, fmt: NUM });
    });
    const tr = top + 2 + REGIONS.length;
    FH_TOT[qn] = tr;
    put(fh, `A${tr}`, 'Жами', { font: F_B, fill: FILL_TOT });
    for (let j = 0; j <= GROUPS.length; j += 1) {
      const col = CL(2 + j);
      put(fh, `${col}${tr}`, `=SUM(${col}${top + 2}:${col}${tr - 1})`, { font: F_B, fill: FILL_TOT, fmt: NUM });
    }
  }
  for (const [code, row] of UO_REG) {
    const fr = FROW[`U${row}`]!;
    'CDEF'.split('').forEach((col, i) => {
      const tr = FH_TOT[i + 1]!;
      put(fk, `${col}${fr}`, `=SUMIF(${MAP},"${code}",'Факт ҳудудлар'!$B$${tr}:$H$${tr})`, { fmt: NUM });
    });
  }

  // ═══════════ Ижро — ёрдамчилар ═══════════
  const EXEC_HDR = ['№', 'Кўрсаткич', '2025 йил', '2026 йил режа', 'Давр режаси', 'Давр факти', 'Фарқ (+/−)', 'Бажарилиш, %', 'Йиллик режадан, %'];
  const EXEC_W = [8, 58, 13, 14, 14, 14, 13, 12, 12];
  const execSheet = (name: string, ttl: string) => {
    const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: 'FF1F4E79' } }, views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });
    title(ws, ttl, '', 9);
    put(ws, 'A2', '="Давр: "&ДАВР&"   ·   млн.сўм   ·   режа — асл режа варақларидан, факт — «Факт» варағидан"', { font: F_S, border: false });
    header(ws, 4, EXEC_HDR, EXEC_W);
    ws.getColumn(11).hidden = true;
    return ws;
  };
  const execRow = (ws: ExcelJS.Worksheet, rr: number, num: Val, name: string, prior: string | null, annual: string | null, planQ: string[] | null, fact: string | null, level = 0, kind = 1) => {
    const font = level === 0 ? F_B : F_N;
    const fl = level === 0 ? FILL_SUB : undefined;
    put(ws, `A${rr}`, num ?? '', { font, fill: fl, align: CENTER });
    put(ws, `B${rr}`, txt(name), { font, fill: fl, align: { wrapText: true, vertical: 'middle', indent: level === 0 ? 0 : 2 } });
    put(ws, `C${rr}`, prior ? `=${prior}` : null, { font, fill: fl, fmt: NUM });
    put(ws, `D${rr}`, annual ? `=${annual}` : null, { font, fill: fl, fmt: NUM });
    put(ws, `E${rr}`, planQ ? `=${per(planQ[0]!, planQ[1]!, planQ[2]!, planQ[3]!)}` : null, { font, fill: fl, fmt: NUM });
    put(ws, `F${rr}`, fact ? `=${fact}` : null, { font, fill: fl, fmt: NUM });
    put(ws, `G${rr}`, `=F${rr}-E${rr}`, { font, fill: fl, fmt: NUM });
    put(ws, `H${rr}`, `=IF(E${rr}=0,"",F${rr}/E${rr})`, { font, fill: fl, fmt: PCT });
    put(ws, `I${rr}`, `=IF(D${rr}=0,"",F${rr}/D${rr})`, { font, fill: fl, fmt: PCT });
    ws.getCell(`K${rr}`).value = kind;
  };
  const execFormat = (ws: ExcelJS.Worksheet, first: number, last: number) => {
    const h = `H${first}`;
    const k = `$K${first}`;
    cf(ws, `H${first}:H${last}`, [
      { formula: `AND(ISNUMBER(${h}),${k}=1,${h}>=1)`, fill: GREEN },
      { formula: `AND(ISNUMBER(${h}),${k}=1,${h}>=0.9,${h}<1)`, fill: AMBER },
      { formula: `AND(ISNUMBER(${h}),${k}=1,${h}<0.9)`, fill: RED },
      { formula: `AND(ISNUMBER(${h}),${k}=-1,${h}<=1)`, fill: GREEN },
      { formula: `AND(ISNUMBER(${h}),${k}=-1,${h}>1,${h}<=1.1)`, fill: AMBER },
      { formula: `AND(ISNUMBER(${h}),${k}=-1,${h}>1.1)`, fill: RED },
    ]);
  };
  const rq = (sheet: string, cols: string, row: number) => cols.split('').map((c) => `${q(sheet)}!${c}${row}`);
  const srcText = (sheet: string, addr: string): string => {
    const v = wb.getWorksheet(sheet)!.getCell(addr).value as unknown;
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && v && 'richText' in (v as object)) return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
    if (typeof v === 'object' && v && 'result' in (v as object)) return String((v as { result: unknown }).result ?? '');
    return String(v);
  };

  // ═══════════ Ижро Расшифровка ═══════════
  const ef = execSheet('Ижро Ф-2', 'Молиявий натижалар тўғрисидаги ҳисобот (Ф-2) ижроси');
  const er = execSheet('Ижро Расшифровка', 'Молиявий-иқтисодий кўрсаткичлар ижроси (2-илова)');
  const LEAF: Record<number, string> = {};
  for (const [row] of [...CENTER_REV, ...COST, ...ADM, ...OPX]) LEAF[row] = `R${row}`;
  LEAF[20] = 'R20';
  const CHILD: Record<number, number[]> = { 8: [10, 11, 12, 13, 14, 15, 16, 17, 18], 19: [20], 21: [22, 23, 24, 25, 26, 27, 28], 29: [30, 40], 30: [31, 32, 33, 34, 35, 36, 37, 38, 39], 40: [41, 42, 43, 44, 45, 46, 47, 48] };
  const ER: Record<number, number> = {};
  let ro = 5;
  for (let row = 8; row <= 52; row += 1) {
    if (!srcText(S.R, `B${row}`)) continue;
    ER[row] = ro;
    ro += 1;
  }
  for (const [rowS, out] of Object.entries(ER)) {
    const row = Number(rowS);
    const name = srcText(S.R, `B${row}`).trim();
    if (row === 9) {
      put(er, `B${out}`, name, { font: F_S });
      continue;
    }
    let fact: string | null = null;
    if (LEAF[row]) fact = fper(LEAF[row]!);
    else if (row === 18) fact = UO_REG.map(([, x]) => fper(`U${x}`)).join('+');
    else if (CHILD[row]) fact = CHILD[row]!.filter((c) => ER[c]).map((c) => `F${ER[c]}`).join('+');
    else if (row === 49) fact = ['F120', 'F130', 'F140', 'F150', 'F160'].map(fper).join('+');
    else if (row === 50) fact = fper('F120');
    else if (row === 51) fact = ['F180', 'F190', 'F200', 'F210'].map(fper).join('+');
    else if (row === 52) fact = `F${ER[8]}+F${ER[19]}+F${ER[49]}-F${ER[21]}-F${ER[29]}-F${ER[51]}`;
    const level = [8, 19, 21, 29, 49, 51, 52].includes(row) ? 0 : 1;
    const exp = (row >= 21 && row <= 48) || row === 51;
    execRow(er, out, srcText(S.R, `A${row}`), name, `${q(S.R)}!D${row}`, `${q(S.R)}!E${row}`, rq(S.R, 'FGHI', row), fact, level, exp ? -1 : 1);
  }
  execFormat(er, 5, ro - 1);

  // ═══════════ Ижро Ф-2 ═══════════
  const f2 = wb.getWorksheet(S.F2)!;
  const codes: { code: number; row: number }[] = [];
  for (let row = 5; row <= 30; row += 1) {
    const c = Number(srcText(S.F2, `B${row}`));
    if (Number.isFinite(c) && c > 0) codes.push({ code: c, row });
  }
  const OUT: Record<number, number> = {};
  codes.forEach((c, i) => (OUT[c.code] = 5 + i));
  const RZ = (row: number) => `'Ижро Расшифровка'!F${ER[row]}`;
  const G = (c: number) => `F${OUT[c]}`;
  const F2FACT: Record<number, string> = {
    10: RZ(8),
    20: RZ(21),
    60: RZ(30),
    70: RZ(40),
    90: RZ(19),
    30: `${G(10)}-${G(20)}`,
    40: `${G(50)}+${G(60)}+${G(70)}`,
    100: `${G(30)}-${G(40)}+${G(90)}`,
    110: [120, 130, 140, 150, 160].map(G).join('+'),
    170: [180, 190, 200, 210].map(G).join('+'),
    220: `${G(100)}+${G(110)}-${G(170)}`,
    240: `${G(220)}+${G(230)}`,
    270: `${G(240)}-${G(250)}-${G(260)}`,
  };
  for (const k of [50, 120, 130, 140, 150, 160, 180, 190, 200, 210, 230, 250, 260]) F2FACT[k] = fper(`F${String(k).padStart(3, '0')}`);
  for (const { code, row } of codes) {
    execRow(
      ef,
      OUT[code]!,
      code,
      srcText(S.F2, `A${row}`),
      `${q(S.F2)}!C${row}`,
      `${q(S.F2)}!D${row}`,
      rq(S.F2, 'EFGH', row),
      F2FACT[code] ?? null,
      [10, 30, 40, 100, 110, 170, 220, 240, 270].includes(code) ? 0 : 1,
      [20, 40, 50, 60, 70, 170, 180, 190, 200, 210, 250, 260].includes(code) ? -1 : 1,
    );
  }
  execFormat(ef, 5, 4 + codes.length);

  // ═══════════ Ижро хизматлар ═══════════
  const eu = execSheet('Ижро хизматлар', 'Хизмат кўрсатиш режаси ижроси (1-илова)');
  const UO_CENTER: Record<number, string> = { 12: 'R10', 13: 'R11', 14: 'R12', 15: 'R15', 16: 'R13', 17: 'R14', 18: 'R17', 19: 'R16' };
  const rows: [number, number | 'S'][] = [[8, 0], [9, 'S'], [10, 0], ...[12, 13, 14, 15, 16, 17, 18, 19].map((x) => [x, 1] as [number, number]), [20, 'S'], [21, 0], [22, 1], ...UO_REG.map(([, x]) => [x, 2] as [number, number])];
  const EU: Record<number, number> = {};
  rows.forEach(([x], i) => (EU[x] = 5 + i));
  for (const [row, lv] of rows) {
    const out = EU[row]!;
    if (lv === 'S') {
      eu.mergeCells(`A${out}:I${out}`);
      put(eu, `A${out}`, (srcText(S.UO, `A${row}`) || srcText(S.UO, `B${row}`)).trim(), { font: F_B, fill: FILL_TOT });
      continue;
    }
    const plan = row === 19 ? rq(S.R, 'FGHI', 16) : rq(S.UO, 'GHIJ', row);
    let fact: string | null = null;
    if (UO_CENTER[row]) fact = fper(UO_CENTER[row]!);
    else if (UO_REG.some(([, x]) => x === row)) fact = fper(`U${row}`);
    else if (row === 10) fact = [12, 13, 14, 15, 16, 17, 18, 19].map((x) => `F${EU[x]}`).join('+');
    else if (row === 22) fact = UO_REG.map(([, x]) => `F${EU[x]}`).join('+');
    else if (row === 21) fact = `F${EU[22]}`;
    else if (row === 8) fact = `F${EU[10]}+F${EU[21]}`;
    execRow(eu, out, srcText(S.UO, `A${row}`), srcText(S.UO, `B${row}`).trim(), `${q(S.UO)}!C${row}`, `${q(S.UO)}!D${row}`, plan, fact, lv === 0 ? 0 : 1);
  }
  execFormat(eu, 5, 4 + rows.length);

  // ═══════════ Ижро ҳудудлар ═══════════
  const eh = wb.addWorksheet('Ижро ҳудудлар', { properties: { tabColor: { argb: 'FF1F4E79' } }, views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });
  title(eh, 'Ҳудудий бўлинмалар ижроси (4-илова)', '', 11);
  put(eh, 'A2', '="Давр: "&ДАВР&"   ·   млн.сўм   ·   давр режаси = йиллик режа ÷ 4 × чораклар сони (асл режадаги тартиб)"', { font: F_S, border: false });
  header(eh, 4, ['№', 'Ҳудуд', '2025 йил (факт)', '2026 йил режа', 'Давр режаси', 'Давр факти', 'Фарқ (+/−)', 'Бажарилиш, %', 'Йиллик режадан, %', 'Улуши (факт), %', 'Ўрни'], [6, 32, 14, 14, 14, 14, 13, 12, 12, 11, 8]);
  const QN = 'IF(РЕЖИМ="Чорак",1,ЧОРАК)';
  const first = 5;
  const tot = first + REGIONS.length;
  REGIONS.forEach((reg, i) => {
    const rr = first + i;
    const col = REG_COLS[i]!;
    put(eh, `A${rr}`, i + 1, { align: CENTER });
    put(eh, `B${rr}`, reg.name);
    put(eh, `C${rr}`, `=${GROUPS.map((g) => `${q(S.HU)}!${col}${g.prior}`).join('+')}`, { fmt: NUM });
    put(eh, `D${rr}`, `=${GROUPS.map((g) => `${q(S.HU)}!${col}${g.plan}`).join('+')}`, { fmt: NUM });
    put(eh, `E${rr}`, `=D${rr}/4*${QN}`, { fmt: NUM });
    const fq = [1, 2, 3, 4].map((qn) => `'Факт ҳудудлар'!$I$${FH_ROW[`${qn}:${i}`]}`);
    put(eh, `F${rr}`, `=${per(fq[0]!, fq[1]!, fq[2]!, fq[3]!)}`, { fmt: NUM });
    put(eh, `G${rr}`, `=F${rr}-E${rr}`, { fmt: NUM });
    put(eh, `H${rr}`, `=IF(E${rr}=0,"",F${rr}/E${rr})`, { fmt: PCT });
    put(eh, `I${rr}`, `=IF(D${rr}=0,"",F${rr}/D${rr})`, { fmt: PCT });
    put(eh, `J${rr}`, `=IF($F$${tot}=0,"",F${rr}/$F$${tot})`, { fmt: PCT });
    put(eh, `K${rr}`, `=IF(H${rr}="","",RANK(H${rr},$H$${first}:$H$${tot - 1}))`, { fmt: INT, align: CENTER });
  });
  put(eh, `A${tot}`, '', { font: F_B, fill: FILL_TOT });
  put(eh, `B${tot}`, 'Жами ҳудудлар', { font: F_B, fill: FILL_TOT });
  for (const c of 'CDEFG') put(eh, `${c}${tot}`, `=SUM(${c}${first}:${c}${tot - 1})`, { font: F_B, fill: FILL_TOT, fmt: NUM });
  put(eh, `H${tot}`, `=IF(E${tot}=0,"",F${tot}/E${tot})`, { font: F_B, fill: FILL_TOT, fmt: PCT });
  put(eh, `I${tot}`, `=IF(D${tot}=0,"",F${tot}/D${tot})`, { font: F_B, fill: FILL_TOT, fmt: PCT });
  put(eh, `J${tot}`, `=IF(F${tot}=0,"",1)`, { font: F_B, fill: FILL_TOT, fmt: PCT });
  put(eh, `K${tot}`, '', { font: F_B, fill: FILL_TOT });
  const pctRules = (c: string) => [
    { formula: `AND(ISNUMBER(${c}),${c}>=1)`, fill: GREEN },
    { formula: `AND(ISNUMBER(${c}),${c}>=0.9,${c}<1)`, fill: AMBER },
    { formula: `AND(ISNUMBER(${c}),${c}<0.9)`, fill: RED },
  ];
  cf(eh, `H${first}:H${tot}`, pctRules(`H${first}`));
  const m0 = tot + 3;
  eh.mergeCells(m0 - 1, 1, m0 - 1, 10);
  put(eh, `A${m0 - 1}`, 'Хизмат гуруҳлари бўйича бажарилиш, % (факт ÷ давр режаси)', { font: F_B, border: false });
  header(eh, m0, ['№', 'Ҳудуд', ...GROUPS.map((g) => g.name)]);
  REGIONS.forEach((reg, i) => {
    const rr = m0 + 1 + i;
    const col = REG_COLS[i]!;
    put(eh, `A${rr}`, i + 1, { align: CENTER });
    put(eh, `B${rr}`, reg.name);
    GROUPS.forEach((g, j) => {
      const fq = [1, 2, 3, 4].map((qn) => `'Факт ҳудудлар'!$${CL(2 + j)}$${FH_ROW[`${qn}:${i}`]}`);
      const planp = `${q(S.HU)}!${col}${g.plan}/4*${QN}`;
      put(eh, `${CL(3 + j)}${rr}`, `=IF(N(${planp})=0,"",(${per(fq[0]!, fq[1]!, fq[2]!, fq[3]!)})/(${planp}))`, { fmt: PCT });
    });
  });
  cf(eh, `C${m0 + 1}:${CL(2 + GROUPS.length)}${m0 + REGIONS.length}`, pctRules(`C${m0 + 1}`));

  // ═══════════ Ижро солиқлар ═══════════
  const es = execSheet('Ижро солиқлар', 'Давлат бюджети ва мақсадли жамғармаларга тўловлар ижроси (5-илова)');
  execRow(es, 5, '', 'Жами', `${q(S.SOL)}!D7`, `SUM(${q(S.SOL)}!H7:K7)`, rq(S.SOL, 'HIJK', 7), TAX.map((_, k) => `F${6 + k}`).join('+'), 0, -1);
  TAX.forEach(([row, n], k) => execRow(es, 6 + k, k + 1, n, `${q(S.SOL)}!D${row}`, `SUM(${q(S.SOL)}!H${row}:K${row})`, rq(S.SOL, 'HIJK', row), fper(`T${row}`), 1, -1));
  execFormat(es, 5, 5 + TAX.length);

  // ═══════════ Ижро иш ҳақи ═══════════
  const ei = execSheet('Ижро иш ҳақи', 'Иш ҳақи фонди ва ходимлар сони ижроси (5-илова)');
  let o2 = 5;
  ei.mergeCells(`B${o2}:I${o2}`);
  put(ei, `A${o2}`, '', { font: F_B, fill: FILL_TOT });
  put(ei, `B${o2}`, 'Иш ҳақи фонди, млн.сўм (давр режаси = йиллик ÷ 4 × чораклар сони)', { font: F_B, fill: FILL_TOT });
  o2 += 1;
  const payFirst = o2;
  for (const [row, n] of PAY) {
    const annual = `${q(S.IH)}!P${row}`;
    execRow(ei, o2, srcText(S.IH, `A${row}`), n, `${q(S.IH)}!D${row}`, annual, [1, 2, 3, 4].map(() => `${annual}/4`), fper(`P${row}`), 1, -1);
    o2 += 1;
  }
  execRow(ei, o2, '', 'Жами иш ҳақи фонди', `${q(S.IH)}!D8`, `${q(S.IH)}!P8`, [1, 2, 3, 4].map(() => `${q(S.IH)}!P8/4`), Array.from({ length: PAY.length }, (_, i) => `F${payFirst + i}`).join('+'), 0, -1);
  const payTot = o2;
  execFormat(ei, payFirst, payTot);
  o2 += 2;
  ei.mergeCells(`B${o2}:I${o2}`);
  put(ei, `A${o2}`, '', { font: F_B, fill: FILL_TOT });
  put(ei, `B${o2}`, 'Ходимлар сони (ўртача), киши', { font: F_B, fill: FILL_TOT });
  o2 += 1;
  const hcFirst = o2;
  for (const [row, n] of PAY) {
    const fr = FROW[`N${row}`]!;
    const rng = `'Факт'!$C$${fr}:$F$${fr}`;
    const avg = `IF(РЕЖИМ="Чорак",INDEX(${rng},ЧОРАК),AVERAGE(INDEX(${rng},1):INDEX(${rng},ЧОРАК)))`;
    put(ei, `A${o2}`, srcText(S.IH, `A${row}`), { align: CENTER });
    put(ei, `B${o2}`, n, { align: { wrapText: true, indent: 2 } });
    put(ei, `C${o2}`, `=${q(S.IH)}!C${row}`, { fmt: INT });
    put(ei, `D${o2}`, `=${q(S.IH)}!O${row}`, { fmt: INT });
    put(ei, `E${o2}`, `=${q(S.IH)}!O${row}`, { fmt: INT });
    put(ei, `F${o2}`, `=IFERROR(${avg},"")`, { fmt: '#,##0.0' });
    put(ei, `G${o2}`, `=IF(F${o2}="","",F${o2}-E${o2})`, { fmt: '#,##0.0;[Red]-#,##0.0' });
    put(ei, `H${o2}`, `=IF(OR(F${o2}="",N(E${o2})=0),"",F${o2}/E${o2})`, { fmt: PCT });
    put(ei, `I${o2}`, '');
    o2 += 1;
  }
  put(ei, `B${o2}`, 'Жами', { font: F_B, fill: FILL_SUB });
  for (const c of 'CDEF') put(ei, `${c}${o2}`, `=SUM(${c}${hcFirst}:${c}${o2 - 1})`, { font: F_B, fill: FILL_SUB, fmt: c === 'F' ? '#,##0.0' : INT });
  put(ei, `G${o2}`, `=IF(N(F${o2})=0,"",F${o2}-E${o2})`, { font: F_B, fill: FILL_SUB, fmt: '#,##0.0;[Red]-#,##0.0' });
  put(ei, `H${o2}`, `=IF(OR(N(F${o2})=0,N(E${o2})=0),"",F${o2}/E${o2})`, { font: F_B, fill: FILL_SUB, fmt: PCT });
  const hcTot = o2;
  o2 += 2;
  put(ei, `B${o2}`, 'Бир ходимга ўртача ойлик иш ҳақи, минг сўм', { font: F_B, fill: FILL_SUB });
  put(ei, `E${o2}`, `=IF(E${hcTot}=0,"",E${payTot}*1000/E${hcTot}/(3*${QN}))`, { font: F_B, fill: FILL_SUB, fmt: '#,##0' });
  put(ei, `F${o2}`, `=IF(N(F${hcTot})=0,"",F${payTot}*1000/F${hcTot}/(3*${QN}))`, { font: F_B, fill: FILL_SUB, fmt: '#,##0' });
  put(ei, `H${o2}`, `=IF(OR(E${o2}="",F${o2}=""),"",F${o2}/E${o2})`, { font: F_B, fill: FILL_SUB, fmt: PCT });

  // ═══════════ Ижро соф фойда ═══════════
  const ep = execSheet('Ижро соф фойда', 'Соф фойдани тақсимлаш ижроси (3-илова)');
  const NP = `'Ижро Ф-2'!F${OUT[270]}`;
  for (let row = 8; row <= 14; row += 1) {
    const out = row - 3;
    const share = `IF(${q(S.SF)}!$E$8=0,0,${q(S.SF)}!E${row}/${q(S.SF)}!$E$8)`;
    let fact = row === 8 ? NP : `MAX(0,${NP})*${share}`;
    let plan = rq(S.SF, 'GHIJ', row);
    let annual = `${q(S.SF)}!E${row}`;
    if (row === 9) {
      fact = `F${out + 1}`;
      plan = rq(S.SF, 'GHIJ', 10);
      annual = `${q(S.SF)}!E10`;
    }
    execRow(ep, out, srcText(S.SF, `A${row}`), srcText(S.SF, `B${row}`).trim(), `${q(S.SF)}!C${row}`, annual, plan, fact, row <= 9 ? 0 : 1);
  }
  put(ep, 'B13', 'Факт тақсимоти режадаги улушлар бўйича (давлат улуши 50%, ривожлантириш 50%); зарар бўлса — тақсимланмайди.', { font: F_S, border: false });
  execFormat(ep, 5, 11);

  // ═══════════ Ижро ҳомийлик ═══════════
  const eo = execSheet('Ижро ҳомийлик', 'Ҳомийлик ёрдамлари ижроси (2а-илова)');
  execRow(eo, 5, '', 'Жами', `${q(S.H)}!C7`, `${q(S.H)}!E7`, rq(S.H, 'GHIJ', 7), 'F6+F7+F8', 0, -1);
  HOM.forEach(([row, n], k) => execRow(eo, 6 + k, srcText(S.H, `A${row}`), n, `${q(S.H)}!C${row}`, `${q(S.H)}!E${row}`, rq(S.H, 'GHIJ', row), fper(`H${row}`), 1, -1));
  execFormat(eo, 5, 8);

  // ═══════════ Ижро КПЭ ═══════════
  const ek = wb.addWorksheet('Ижро КПЭ', { properties: { tabColor: { argb: 'FF1F4E79' } }, views: [{ state: 'frozen', xSplit: 3, ySplit: 4 }] });
  title(ek, 'Асосий самарадорлик кўрсаткичлари (КПЭ) ижроси (6-илова)', 'Йиғма даврлар: 1-чорак, 1-ярим йил, 9 ой, йил. Факт — танланган чоракгача мавжуд даврлар учун.', 15);
  const khdr = ['№', 'Кўрсаткич', 'Улуши, %'];
  for (const p of ['1-чорак', '1-ярим йил', '9 ой', 'Йил']) khdr.push(`${p}\nмақсад`, `${p}\nфакт`, `${p}\n%`);
  header(ek, 4, khdr, [5, 50, 9, 13, 13, 9, 13, 13, 9, 13, 13, 9, 13, 13, 9]);
  const revCells = (c: string) => [...CENTER_REV.map(([x]) => F(`R${x}`, c)), ...UO_REG.map(([, x]) => F(`U${x}`, c))].join('+');
  const npCells = (c: string) => {
    const plus = [revCells(c), F('R20', c), ...['F120', 'F130', 'F140', 'F150', 'F160', 'F230'].map((k) => F(k, c))].join('+');
    const minus = [...[...COST, ...ADM, ...OPX].map(([x]) => F(`R${x}`, c)), ...['F050', 'F180', 'F190', 'F200', 'F210', 'F250', 'F260'].map((k) => F(k, c))].join('+');
    return `(${plus}-(${minus}))`;
  };
  const bal = (key: string, n: number) => `INDEX('Факт'!$C$${FROW[key]}:$F$${FROW[key]},${n})`;
  const kRows: Record<number, string> = { 8: 'rev', 9: 'np', 10: 'roa', 13: 'cov', 14: 'fin', 15: 'div' };
  const kpi = wb.getWorksheet(S.KPI)!;
  let ko = 5;
  const npRow = 6;
  for (let row = 8; row <= 20; row += 1) {
    put(ek, `A${ko}`, srcText(S.KPI, `A${row}`), { align: CENTER });
    put(ek, `B${ko}`, srcText(S.KPI, `B${row}`), { align: WRAP });
    put(ek, `C${ko}`, `=${q(S.KPI)}!C${row}`, { align: CENTER });
    for (let n = 1; n <= 4; n += 1) {
      const tc = CL(4 + (n - 1) * 3);
      const fc = CL(5 + (n - 1) * 3);
      const pc = CL(6 + (n - 1) * 3);
      put(ek, `${tc}${ko}`, `=${q(S.KPI)}!${'DEFG'[n - 1]}${row}`, { fmt: '#,##0.00' });
      const cols = 'CDEF'.slice(0, n).split('');
      const avail = (e: string) => `IF(ЧОРАК>=${n},${e},"")`;
      let f: string | null = null;
      switch (kRows[row]) {
        case 'rev':
          f = avail(`(${cols.map((c) => `(${revCells(c)})`).join('+')})*1000`);
          break;
        case 'np':
          f = avail(`(${cols.map(npCells).join('+')})*1000`);
          break;
        case 'roa':
          f = avail(`IF(N(${bal('B_ACT', n)})=0,"",${fc}${npRow}/1000/${bal('B_ACT', n)})`);
          break;
        case 'cov':
          f = avail(`IF(N(${bal('B_CL', n)})=0,"",${bal('B_CUR', n)}/${bal('B_CL', n)})`);
          break;
        case 'fin':
          f = avail(`IF(N(${bal('B_LIAB', n)})=0,"",${bal('B_EQ', n)}/${bal('B_LIAB', n)})`);
          break;
        case 'div':
          f = avail(`IF(N(${fc}${npRow})<=0,0,${fc}${npRow}/2)`);
          break;
      }
      put(ek, `${fc}${ko}`, f ? `=${f}` : '–', { fmt: '#,##0.00', align: f ? undefined : CENTER });
      put(ek, `${pc}${ko}`, f ? `=IF(OR(NOT(ISNUMBER(${fc}${ko})),N(${tc}${ko})=0),"",${fc}${ko}/${tc}${ko})` : '', { fmt: PCT });
    }
    ko += 1;
  }
  void kpi;
  for (let n = 1; n <= 4; n += 1) {
    const pc = CL(6 + (n - 1) * 3);
    cf(ek, `${pc}5:${pc}${ko - 1}`, [
      { formula: `AND(ISNUMBER(${pc}5),${pc}5>=1)`, fill: GREEN },
      { formula: `AND(ISNUMBER(${pc}5),${pc}5<1)`, fill: RED },
    ]);
  }
  put(
    ek,
    `B${ko + 1}`,
    'Изоҳ: 1–2 ва 8-қаторлар минг сўмда (асл КПЭ варағидагидек). Активлар рентабеллиги = соф фойда ÷ ўртача активлар (улуш); қоплаш коэффициенти = жорий активлар ÷ жорий мажбуриятлар; молиявий мустақиллик = ўз капитали ÷ жами мажбуриятлар («Факт» 11-бўлим).',
    { font: F_S, align: WRAP, border: false },
  );
  ek.getRow(ko + 1).height = 48;

  // ═══════════ Текширув ═══════════
  const tk = wb.addWorksheet('Текширув', { properties: { tabColor: { argb: 'FF548235' } } });
  title(tk, 'Асл режадаги тафовутлар (жонли текширув)', 'Ҳар бир қатор формула — асл варақлар тузатилса, «Фарқ» ўзи 0 га тушади', 6);
  header(tk, 4, ['№', 'Нима текширилади', 'Қиймат 1', 'Қиймат 2', 'Фарқ', 'Ҳолат'], [5, 80, 15, 15, 14, 14]);
  CHECKS.forEach(([txt, a, b], i) => {
    const rr = 5 + i;
    put(tk, `A${rr}`, i + 1, { align: CENTER });
    put(tk, `B${rr}`, txt, { align: WRAP });
    put(tk, `C${rr}`, `=${a}`, { fmt: NUM });
    put(tk, `D${rr}`, `=${b}`, { fmt: NUM });
    put(tk, `E${rr}`, `=C${rr}-D${rr}`, { fmt: NUM });
    put(tk, `F${rr}`, `=IF(ABS(E${rr})<0.05,"✓ мос","⚠ фарқ бор")`, { font: F_B, align: CENTER });
    tk.getRow(rr).height = 32;
  });
  cf(tk, `F5:F${4 + CHECKS.length}`, [
    { formula: 'F5="⚠ фарқ бор"', fill: RED },
    { formula: 'F5="✓ мос"', fill: GREEN },
  ]);

  // ═══════════ Йўриқнома ═══════════
  const yo = wb.addWorksheet('Йўриқнома', { properties: { tabColor: { argb: 'FF548235' } } });
  title(yo, 'Чораклик ижро ҳисоботи — йўриқнома', '"Солиқ-сервис" АЖ бизнес-режаси асосида · «Korxona tahlil» дастуридан', 2);
  yo.getColumn(1).width = 4;
  yo.getColumn(2).width = 120;
  [
    '1. «Созлама» варағида чоракни (1–4) ва тартибни танланг: «Чорак» — фақат шу чорак, «Йил бошидан» — 1-чоракдан шу чоракгача йиғма (1-ярим йил, 9 ой).',
    '2. «Факт» ва «Факт ҳудудлар» сариқ катаклари дастурдан тўлдирилган (Ҳисоботлар → Choraklik ijro). Қўлда ҳам ўзгартириш мумкин — ҳамма ижро ўзи қайта ҳисобланади.',
    '3. «Созлама»нинг пастида ҳудудий хизмат гуруҳлари қайси «Умумий объем» қаторига қўшилишини белгиланг.',
    '4. «Ижро …» варақлари — тайёр ҳисобот: йиллик режа, давр режаси, давр факти, фарқ ва бажарилиш %. Даромадда ≥100% яшил, харажатда ≤100% яшил.',
    '5. Режа қийматлари асл варақлардан (1–6-иловалар) формула орқали олинади — режани ўзгартирсангиз ижро ҳам ўзгаради.',
    '6. «Текширув» — асл режадаги жамилар ва боғланишлардаги тафовутлар (жонли формула). Тузатилгач «✓ мос» бўлади.',
    'Ҳудудлар ва иш ҳақи бўйича чорак режаси асл режадаги каби йиллик режа ÷ 4 олинади; бошқа кўрсаткичларда — асл варақдаги чорак устунлари.',
  ].forEach((t, i) => {
    put(yo, `B${4 + i}`, t, { align: WRAP, border: false });
    yo.getRow(4 + i).height = 30;
  });

  // Тартиб: йўриқнома, созлама, факт, ижро, текширув, кейин асл варақлар
  const order = ['Йўриқнома', 'Созлама', 'Факт', 'Факт ҳудудлар', 'Ижро Ф-2', 'Ижро Расшифровка', 'Ижро хизматлар', 'Ижро ҳудудлар', 'Ижро солиқлар', 'Ижро иш ҳақи', 'Ижро соф фойда', 'Ижро ҳомийлик', 'Ижро КПЭ', 'Текширув', ...original];
  order.forEach((name, i) => {
    const ws = wb.getWorksheet(name);
    if (ws) (ws as unknown as { orderNo: number }).orderNo = i + 1;
  });
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: 'visible' }];
  wb.calcProperties = { fullCalcOnLoad: true };
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

const qS = q;
export const CHECKS: [string, string, string][] = [
  ['Ҳудудлар 2025: «Жами» (D9) ва ҳудуд устунлари йиғиндиси (F9:S9) — устунларда «Янги жорий этилган хизматлар» (75-қатор) қўшилмаган', `${qS(S.HU)}!D9`, `SUM(${qS(S.HU)}!F9:S9)`],
  ['Ҳудудлар 2026: «Жами» (D10) ва ҳудуд устунлари (F10:S10) — D10 да «Бошқа хизматлар» (73) йўқ, устунларда «Янги» (76) йўқ', `${qS(S.HU)}!D10`, `SUM(${qS(S.HU)}!F10:S10)`],
  ['«Умумий объем» 2026 ҳудудлар: D21 (қўлда 42834) ва хизматлар йиғиндиси D22', `${qS(S.UO)}!D21`, `${qS(S.UO)}!D22`],
  ['«Умумий объем» 2025 ҳудудлар: C21 (Ҳудудлар свод) ва C22 (хизматлар йиғиндиси)', `${qS(S.UO)}!C21`, `${qS(S.UO)}!C22`],
  ['«Умумий объем» ҳудудий хизматлар (D22) ва «Ҳудудлар (свод)» 2026 жами (D10)', `${qS(S.UO)}!D22`, `${qS(S.HU)}!D10`],
  ['Иш ҳақи 2026: «Жами» P8 ва таркиб устунлари Q8:Z8 — устунлар жамисига Call-марказ, Мобил илова, Tax free (16–18) қўшилмаган', `${qS(S.IH)}!P8`, `SUM(${qS(S.IH)}!Q8:Z8)`],
  ['Иш ҳақи: 2026 ходимлар сони O8 (қўлда 325) ва қаторлар йиғиндиси', `${qS(S.IH)}!O8`, [9, 12, 15, 16, 17, 18, 19, 34].map((r) => `${qS(S.IH)}!O${r}`).join('+')],
  ['Иш ҳақи 2025: «Жами» D8 — «шу жумладан» деб ёзилган 16–18 қаторлар маъмурий ходимлар (15) устига қайта қўшилган', `${qS(S.IH)}!D8`, [9, 12, 15, 19, 34].map((r) => `${qS(S.IH)}!D${r}`).join('+')],
  ['Ижтимоий солиқ: Расшифровка 3.2 (таннарх) ва 5-илова ЯИТ — бир хил тўлов, катта фарқ', `${qS(S.R)}!E23+${qS(S.R)}!E32`, `${qS(S.SOL)}!E11`],
  ['Иш ҳақи: Расшифровка 3.1 (таннарх) ва 5-илова иш ҳақи фонди P8', `${qS(S.R)}!E22`, `${qS(S.IH)}!P8`],
  ['Расшифровка: «Бошқа операцион харажатлар» 2026 (E40 = SUM(E41:E51)) молиявий қаторларни (49–51) ҳам қамраб олган', `${qS(S.R)}!E40`, `SUM(${qS(S.R)}!E41:E48)`],
  ['Ҳудудлар: «Компьютер ва техник хизматлар» 2026 = 2025 + 200% (яъни +2 млн) — кўпайтириш эмас, қўшиш', `${qS(S.HU)}!D13`, `${qS(S.HU)}!D12*1.2`],
  ['«Умумий объем»: улуш F8 = D8/D10 (182%) — асос нотўғри', `${qS(S.UO)}!F8`, '100'],
  ['Ф-2: фойда солиғи (250) режада 0 — фойда бўлса ҳам (15% бўйича ҳисоб)', `${qS(S.F2)}!D28`, `${qS(S.F2)}!D27*0.15`],
  ['Соф тушум (Ф-2, 010) ва 1-илова «Жами соф тушум» (D8)', `${qS(S.F2)}!D5`, `${qS(S.UO)}!D8`],
];

export { FIN, BAL };