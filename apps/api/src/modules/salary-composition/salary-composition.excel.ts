import { BadRequestException } from '@nestjs/common';
import type { SalaryComponent } from '@prisma/client';
import ExcelJS from 'exceljs';
import {
    CENTRAL_REGION,
    GROUP_LABELS,
    GROUP_ORDER,
    SERVICE_CODES,
    TEMPLATE_ROWS,
} from './salary-composition.constants';
import type { CompositionView, FixedKey, PayrollInfo } from './salary-composition.types';

// ═══════════════════════════════════════════════════════════
// Excel yordamchilari
// ═══════════════════════════════════════════════════════════

/** Formula natijasi, matn yoki boy matnni oddiy qiymatga aylantiradi */
export function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object') {
    const record = value as unknown as Record<string, unknown>;

    if ('result' in record) return record.result;
    if ('text' in record) return record.text;
    if ('richText' in record && Array.isArray(record.richText)) {
      return (record.richText as { text: string }[]).map((part) => part.text).join('');
    }
    if ('error' in record) return null;
  }
  return value;
}

export function cellText(value: ExcelJS.CellValue): string {
  const raw = cellValue(value);
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') {
    return Number.isInteger(raw) ? raw.toFixed(0) : String(raw);
  }
  return String(raw).trim();
}

/** Nomni solishtirish uchun: kichik harf, faqat harf va raqam */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BB\u02BC`']/g, '')
    .replace(/[^a-z0-9\u0400-\u04ff]/g, '');
}

/** Katakdagi son. Bo'sh → null, son emas → NaN */
export function parseNumber(value: ExcelJS.CellValue): number | null {
  const raw = cellValue(value);
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return raw;

  let str = String(raw).replace(/[\s\u00a0]/g, '');
  if (str === '' || str === '-') return null;
  if (str.includes(',') && !str.includes('.')) {
    str = str.replace(',', '.');
  } else {
    str = str.replace(/,/g, '');
  }
  const parsed = Number(str);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function toTiyin(amount: number): bigint {
  return BigInt(Math.round(amount * 100));
}

export function toSom(tiyin: bigint): number {
  return Number(tiyin) / 100;
}

export function columnLetter(index: number): string {
  let result = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════
// Shablon
// ═══════════════════════════════════════════════════════════

export interface TemplateEmployee {
  pinfl: string;
  fullName: string;
  regionCode: number;
  region: { name: string } | null;
  department: { name: string } | null;
}

export function buildTemplateWorkbook(params: {
  period: string;
  components: SalaryComponent[];
  employees: TemplateEmployee[];
  payroll: PayrollInfo;
}): ExcelJS.Workbook {
  const { period, components, employees, payroll } = params;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Korxona tahlil';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Tarkib', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }],
  });

  // ─────────── Ustunlar joylashuvi ───────────
  const FIXED = 4; // A PINFL, B F.I.O., C Kun, D Stavka
  const firstComp = FIXED + 1;
  const lastComp = FIXED + components.length;
  const totalCol = lastComp + 1;
  const payrollCol = lastComp + 2;
  const diffCol = lastComp + 3;

  const L = (col: number) => columnLetter(col);
  const firstRow = 5;
  const lastRow = firstRow + TEMPLATE_ROWS - 1;

  const border: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFD0D5DD' } },
    left: { style: 'thin', color: { argb: 'FFD0D5DD' } },
    bottom: { style: 'thin', color: { argb: 'FFD0D5DD' } },
    right: { style: 'thin', color: { argb: 'FFD0D5DD' } },
  };
  const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

  const COLORS = {
    fixed: 'FFE5E7EB',
    BUDGET: 'FFDBEAFE',
    HOJALIK: 'FFDCFCE7',
    minus: 'FFFEE2E2',
    check: 'FFFEF3C7',
  };

  // ─────────── 1-qator: guruh sarlavhalari ───────────
  const groupCell = (from: number, to: number, label: string, color: string) => {
    if (to > from) sheet.mergeCells(1, from, 1, to);
    const cell = sheet.getCell(1, from);
    cell.value = label;
    cell.font = { bold: true, size: 11 };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    for (let c = from; c <= to; c++) {
      sheet.getCell(1, c).fill = fill(color);
      sheet.getCell(1, c).border = border;
    }
  };

  groupCell(1, FIXED, 'Xodim', COLORS.fixed);

  let cursor = firstComp;
  for (const group of GROUP_ORDER) {
    const count = components.filter((c) => c.group === group).length;
    if (count === 0) continue;
    groupCell(cursor, cursor + count - 1, GROUP_LABELS[group], COLORS[group]);
    cursor += count;
  }
  groupCell(totalCol, diffCol, 'Tekshiruv', COLORS.check);

  // ─────────── 2-qator: nomlar, 3-qator: kodlar (yashirin) ───────────
  const headers: { col: number; name: string; code: string; color: string; width: number }[] = [
    { col: 1, name: 'PINFL', code: SERVICE_CODES.pinfl, color: COLORS.fixed, width: 17 },
    { col: 2, name: 'F.I.O.', code: SERVICE_CODES.fullName, color: COLORS.fixed, width: 34 },
    { col: 3, name: 'Ishlagan kun', code: SERVICE_CODES.days, color: COLORS.fixed, width: 9 },
    { col: 4, name: 'Stavka', code: SERVICE_CODES.rate, color: COLORS.fixed, width: 8 },
    ...components.map((c, i) => ({
      col: firstComp + i,
      name: c.sign < 0 ? `${c.name} (−)` : c.name,
      code: c.code,
      color: c.sign < 0 ? COLORS.minus : COLORS[c.group],
      width: 15,
    })),
    { col: totalCol, name: 'JAMI (tarkib)', code: SERVICE_CODES.total, color: COLORS.check, width: 17 },
    { col: payrollCol, name: 'Soliq hisoboti', code: SERVICE_CODES.payroll, color: COLORS.check, width: 17 },
    { col: diffCol, name: 'Farq', code: SERVICE_CODES.diff, color: COLORS.check, width: 14 },
  ];

  for (const h of headers) {
    const nameCell = sheet.getCell(2, h.col);
    nameCell.value = h.name;
    nameCell.font = { bold: true, size: 10 };
    nameCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    nameCell.fill = fill(h.color);
    nameCell.border = border;

    const codeCell = sheet.getCell(3, h.col);
    codeCell.value = h.code;
    codeCell.font = { size: 8, color: { argb: 'FF9CA3AF' } };

    sheet.getColumn(h.col).width = h.width;
  }
  sheet.getRow(2).height = 42;
  sheet.getRow(3).hidden = true;

  // ─────────── 4-qator: JAMI ───────────
  const totalsRow = sheet.getRow(4);
  totalsRow.getCell(1).value = 'JAMI';
  totalsRow.getCell(2).value = {
    formula: `COUNTA(A${firstRow}:A${lastRow})&" xodim"`,
  };
  for (let col = firstComp; col <= diffCol; col++) {
    const letter = L(col);
    totalsRow.getCell(col).value = {
      formula: `SUBTOTAL(9,${letter}${firstRow}:${letter}${lastRow})`,
    };
    totalsRow.getCell(col).numFmt = '#,##0.00';
  }
  for (let col = 1; col <= diffCol; col++) {
    const cell = totalsRow.getCell(col);
    cell.font = { bold: true };
    cell.fill = fill('FFF3F4F6');
    cell.border = border;
  }

  // ─────────── Ma'lumot qatorlari ───────────
  const plus = components
    .map((c, i) => ({ c, col: firstComp + i }))
    .filter((x) => x.c.sign > 0)
    .map((x) => L(x.col));
  const minus = components
    .map((c, i) => ({ c, col: firstComp + i }))
    .filter((x) => x.c.sign < 0)
    .map((x) => L(x.col));

  const amountValidation: ExcelJS.DataValidation = {
    type: 'decimal',
    operator: 'greaterThanOrEqual',
    formulae: [0],
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: 'Noto\'g\'ri qiymat',
    error: 'Faqat musbat son kiriting (jarima ham musbat yoziladi)',
  };

  for (let r = firstRow; r <= lastRow; r++) {
    const row = sheet.getRow(r);

    const pinflCell = row.getCell(1);
    pinflCell.numFmt = '@';

    row.getCell(2).value = {
      formula: `IF(A${r}="","",IFERROR(VLOOKUP(TEXT(A${r},"0"),Xodimlar!$A:$B,2,FALSE),"Reestrda yo'q"))`,
    };
    row.getCell(2).font = { color: { argb: 'FF4B5563' } };

    row.getCell(3).numFmt = '0';
    row.getCell(4).numFmt = '0.00';

    for (let col = firstComp; col <= lastComp; col++) {
      const cell = row.getCell(col);
      cell.numFmt = '#,##0.00';
      cell.dataValidation = amountValidation;
    }

    const plusPart = plus.length ? `SUM(${plus.map((l) => `${l}${r}`).join(',')})` : '0';
    const minusPart = minus.length ? `-SUM(${minus.map((l) => `${l}${r}`).join(',')})` : '';

    row.getCell(totalCol).value = { formula: `IF(A${r}="","",${plusPart}${minusPart})` };
    row.getCell(payrollCol).value = {
      formula: `IF(A${r}="","",IFERROR(VLOOKUP(TEXT(A${r},"0"),Xodimlar!$A:$D,4,FALSE),0))`,
    };
    row.getCell(diffCol).value = {
      formula: `IF(A${r}="","",${L(totalCol)}${r}-${L(payrollCol)}${r})`,
    };

    for (const col of [totalCol, payrollCol, diffCol]) {
      row.getCell(col).numFmt = '#,##0.00';
      row.getCell(col).font = { bold: col === totalCol };
    }
  }

  // Farq 1 so'mdan katta bo'lsa — qizil
  const diffLetter = L(diffCol);
  sheet.addConditionalFormatting({
    ref: `${diffLetter}${firstRow}:${diffLetter}${lastRow}`,
    rules: [
      {
        type: 'expression',
        priority: 1,
        formulae: [`AND(${diffLetter}${firstRow}<>"",ABS(${diffLetter}${firstRow})>1)`],
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFECACA' } },
          font: { color: { argb: 'FFB91C1C' }, bold: true },
        },
      },
    ],
  });

  // ─────────── Xodimlar varag'i ───────────
  const ref = workbook.addWorksheet('Xodimlar', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ref.columns = [
    { header: 'PINFL', key: 'pinfl', width: 17 },
    { header: 'F.I.O.', key: 'fullName', width: 36 },
    { header: "Bo'lim / hudud", key: 'unit', width: 26 },
    { header: `Ish haqi (soliq hisoboti, ${period})`, key: 'payroll', width: 22 },
  ];
  ref.getRow(1).font = { bold: true };
  ref.getRow(1).fill = fill(COLORS.fixed);

  for (const emp of employees) {
    const payrollTiyin = payroll.map.get(emp.pinfl);
    const row = ref.addRow({
      pinfl: emp.pinfl,
      fullName: emp.fullName,
      unit:
        emp.regionCode === CENTRAL_REGION
          ? (emp.department?.name ?? 'Markaz')
          : (emp.region?.name ?? ''),
      payroll: payrollTiyin === undefined ? null : toSom(payrollTiyin),
    });
    row.getCell(1).numFmt = '@';
    row.getCell(4).numFmt = '#,##0.00';
  }

  // ─────────── Yo'riqnoma ───────────
  const help = workbook.addWorksheet("Yo'riqnoma");
  help.getColumn(1).width = 110;
  const lines = [
    `ISH HAQI TARKIBI — ${period}`,
    '',
    '1. "Tarkib" varag\'ida A ustuniga PINFL, keyin har bir komponent summasini (so\'mda) yozing yoki nusxalab qo\'ying.',
    '2. F.I.O., JAMI, Soliq hisoboti va Farq ustunlari o\'zi hisoblanadi — ularni to\'ldirmang.',
    '3. Bo\'sh katak = 0. Faqat bor summalarni yozing.',
    '4. Jarima MUSBAT son bilan yoziladi — tizim o\'zi ayiradi.',
    '5. "Farq" qizil bo\'lsa — xodimning tarkibi soliq hisobotidagi summaga mos emas (1 so\'mgacha farq e\'tiborga olinmaydi).',
    '6. Ustun sarlavhalarini o\'zgartirsangiz ham bo\'ladi — tizim ustunni yashirin 3-qatordagi kod orqali taniydi.',
    '7. Yangi komponent kerak bo\'lsa — Sozlamalar → Ish haqi komponentlari bo\'limida qo\'shing va shablonni qayta yuklab oling.',
    '',
    payroll.uploaded
      ? `Soliq hisoboti yuklangan: ${payroll.map.size} xodim.`
      : 'DIQQAT: bu oy uchun soliq hisoboti (Ish haqi) hali yuklanmagan — "Soliq hisoboti" ustuni 0 chiqadi.',
  ];
  lines.forEach((line, index) => {
    const cell = help.getCell(index + 1, 1);
    cell.value = line;
    cell.alignment = { wrapText: true };
    if (index === 0) cell.font = { bold: true, size: 14 };
  });

  return workbook;
}

// ═══════════════════════════════════════════════════════════
// Faylni o'qish
// ═══════════════════════════════════════════════════════════

/** Sarlavha qatorini topadi: avval yashirin kodlar, bo'lmasa — nomlar bo'yicha */
export function detectColumns(
  sheet: ExcelJS.Worksheet,
  components: SalaryComponent[],
): { headerRow: number; fixed: Partial<Record<FixedKey, number>>; comps: Map<string, number> } {
  const codeSet = new Map(components.map((c) => [c.code, c.code]));
  const fixedByCode: Record<string, FixedKey> = {
    [SERVICE_CODES.pinfl]: 'pinfl',
    [SERVICE_CODES.fullName]: 'fullName',
    [SERVICE_CODES.days]: 'days',
    [SERVICE_CODES.rate]: 'rate',
    [SERVICE_CODES.total]: 'total',
  };

  const scanRows = Math.min(sheet.rowCount, 12);
  const lastCol = Math.min(sheet.columnCount, 300);

  // ─── 1-usul: kodlar ───
  let best = { row: 0, fixed: {} as Partial<Record<FixedKey, number>>, comps: new Map<string, number>() };

  for (let r = 1; r <= scanRows; r++) {
    const fixed: Partial<Record<FixedKey, number>> = {};
    const comps = new Map<string, number>();

    for (let c = 1; c <= lastCol; c++) {
      const value = cellText(sheet.getCell(r, c).value).toUpperCase();
      if (!value) continue;
      const key = fixedByCode[value];
      if (key && fixed[key] === undefined) fixed[key] = c;
      const code = codeSet.get(value);
      if (code && !comps.has(code)) comps.set(code, c);
    }

    if (fixed.pinfl !== undefined && comps.size >= best.comps.size && comps.size > 0) {
      best = { row: r, fixed, comps };
    }
  }

  if (best.row > 0 && best.comps.size >= 2) {
    return { headerRow: best.row, fixed: best.fixed, comps: best.comps };
  }

  // ─── 2-usul: nomlar ───
  const byName = new Map<string, string>();
  for (const c of components) {
    byName.set(normalize(c.name), c.code);
    byName.set(normalize(`${c.name} (−)`), c.code);
    byName.set(normalize(c.code), c.code);
  }
  const fixedByName: Record<string, FixedKey> = {
    pinfl: 'pinfl',
    fio: 'fullName',
    ishlagankun: 'days',
    kun: 'days',
    stavka: 'rate',
    jami: 'total',
    jamitarkib: 'total',
  };

  let bestByName = { row: 0, fixed: {} as Partial<Record<FixedKey, number>>, comps: new Map<string, number>() };

  for (let r = 1; r <= scanRows; r++) {
    const fixed: Partial<Record<FixedKey, number>> = {};
    const comps = new Map<string, number>();

    for (let c = 1; c <= lastCol; c++) {
      const value = normalize(cellText(sheet.getCell(r, c).value));
      if (!value) continue;
      const key = fixedByName[value];
      if (key && fixed[key] === undefined) fixed[key] = c;
      const code = byName.get(value);
      if (code && !comps.has(code)) comps.set(code, c);
    }

    if (fixed.pinfl !== undefined && comps.size > bestByName.comps.size) {
      bestByName = { row: r, fixed, comps };
    }
  }

  if (bestByName.row > 0 && bestByName.comps.size > 0) {
    return { headerRow: bestByName.row, fixed: bestByName.fixed, comps: bestByName.comps };
  }

  throw new BadRequestException(
    'Shablon tanilmadi: PINFL va komponent ustunlari topilmadi. Tizimdan yuklab olingan shablondan foydalaning.',
  );
}

// ═══════════════════════════════════════════════════════════
// Hisobot (eksport)
// ═══════════════════════════════════════════════════════════

export function buildExportWorkbook(view: CompositionView): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Korxona tahlil';
  workbook.created = new Date();

  const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const MONEY = '#,##0.00';

  // ─────────── Tarkib ───────────
  const sheet = workbook.addWorksheet('Tarkib', { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
  const comps = view.components.filter((c) => view.byComponent.some((t) => t.code === c.code));

  const header = [
    '№',
    'PINFL',
    'F.I.O.',
    "Bo'lim / hudud",
    'Kun',
    'Stavka',
    ...comps.map((c) => (c.sign < 0 ? `${c.name} (−)` : c.name)),
    'JAMI (tarkib)',
    'Soliq hisoboti',
    'Farq',
  ];
  const headRow = sheet.addRow(header);
  headRow.font = { bold: true };
  headRow.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
  headRow.height = 40;
  headRow.eachCell((cell) => {
    cell.fill = fill('FFE5E7EB');
  });

  const sums = new Array<number>(comps.length + 3).fill(0);

  view.rows.forEach((row, index) => {
    const amounts = comps.map((c) => toSom(BigInt(row.items[c.code] ?? '0')));
    const total = toSom(BigInt(row.totalTiyin));
    const payroll = row.payrollTiyin === null ? null : toSom(BigInt(row.payrollTiyin));
    const diff = row.diffTiyin === null ? null : toSom(BigInt(row.diffTiyin));

    amounts.forEach((a, i) => (sums[i] += a));
    sums[comps.length] += total;
    sums[comps.length + 1] += payroll ?? 0;
    sums[comps.length + 2] += diff ?? 0;

    const excelRow = sheet.addRow([
      index + 1,
      row.pinfl,
      row.fullName,
      row.unitName ?? '',
      row.workedDays,
      row.rate,
      ...amounts.map((a) => (a === 0 ? null : a)),
      total,
      payroll,
      diff,
    ]);

    if (row.state === 'diff' || row.state === 'not_in_payroll') {
      excelRow.getCell(header.length).fill = fill('FFFECACA');
      excelRow.getCell(header.length).font = { bold: true, color: { argb: 'FFB91C1C' } };
    }
  });

  const totalRow = sheet.addRow(['', '', 'JAMI', '', '', '', ...sums]);
  totalRow.font = { bold: true };
  totalRow.eachCell((cell) => {
    cell.fill = fill('FFF3F4F6');
  });

  sheet.getColumn(1).width = 5;
  sheet.getColumn(2).width = 17;
  sheet.getColumn(3).width = 34;
  sheet.getColumn(4).width = 22;
  sheet.getColumn(5).width = 7;
  sheet.getColumn(6).width = 8;
  for (let col = 7; col <= header.length; col++) {
    sheet.getColumn(col).width = 15;
    sheet.getColumn(col).numFmt = MONEY;
  }

  // ─────────── Guruhlar ───────────
  const groups = workbook.addWorksheet('Guruhlar');
  groups.columns = [
    { header: 'Guruh / komponent', key: 'name', width: 40 },
    { header: 'Xodimlar', key: 'employees', width: 10 },
    { header: "Summa (so'm)", key: 'amount', width: 20 },
    { header: 'Ulushi, %', key: 'share', width: 12 },
  ];
  groups.getRow(1).font = { bold: true };
  groups.getRow(1).fill = fill('FFE5E7EB');

  for (const category of view.byCategory) {
    const row = groups.addRow({
      name: category.label,
      amount: toSom(BigInt(category.totalTiyin)),
      share: category.sharePercent,
    });
    row.font = { bold: true };
    row.fill = fill('FFF3F4F6');

    for (const item of view.byComponent.filter((c) => c.category === category.category)) {
      groups.addRow({
        name: `    ${item.name}`,
        employees: item.employees,
        amount: toSom(BigInt(item.totalTiyin)),
      });
    }
  }
  groups.getColumn(3).numFmt = MONEY;

  // ─────────── Farqlar ───────────
  const people = [
    ...view.check.mismatches.map((p) => ({ ...p, kind: 'Summa farq qiladi' })),
    ...view.check.missingInComposition.map((p) => ({ ...p, kind: 'Tarkibda yo\'q' })),
    ...view.check.notInPayroll.map((p) => ({ ...p, kind: 'Soliq hisobotida yo\'q' })),
  ];

  if (people.length > 0) {
    const diffs = workbook.addWorksheet('Farqlar');
    diffs.columns = [
      { header: 'PINFL', key: 'pinfl', width: 17 },
      { header: 'F.I.O.', key: 'fullName', width: 34 },
      { header: 'Holat', key: 'kind', width: 22 },
      { header: 'Tarkib', key: 'composition', width: 18 },
      { header: 'Soliq hisoboti', key: 'payroll', width: 18 },
      { header: 'Farq', key: 'diff', width: 16 },
    ];
    diffs.getRow(1).font = { bold: true };
    diffs.getRow(1).fill = fill('FFFEE2E2');

    for (const p of people) {
      diffs.addRow({
        pinfl: p.pinfl,
        fullName: p.fullName,
        kind: p.kind,
        composition: toSom(BigInt(p.compositionTiyin)),
        payroll: toSom(BigInt(p.payrollTiyin)),
        diff: toSom(BigInt(p.diffTiyin)),
      });
    }
    for (const col of [4, 5, 6]) diffs.getColumn(col).numFmt = MONEY;
  }

  return workbook;
}
