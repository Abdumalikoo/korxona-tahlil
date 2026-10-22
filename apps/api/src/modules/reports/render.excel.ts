import ExcelJS from 'exceljs';
import { colLetter as colLetterOf, detectCalc, evaluate, excelFormula, inputsReady } from './reports.calc';
import { excelFormat, PALETTE, cellTone, TONE_COLOR, uzDate } from './reports.format';
import type { Block, KpiBlock, ReportDoc, TableBlock } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Excel: "Xulosa" varag'i + har bir bo'lim alohida varaq.
// Raqamlar haqiqiy son (formatlangan) — filtr, saralash, formulalar ishlaydi.
// ═══════════════════════════════════════════════════════════

const argb = (hex: string) => `FF${hex}`;

/** Excel varaq nomi: taqiqlangan belgilarsiz, 31 belgigacha, boshi va oxirida apostrof bo'lmasin, takrorlanmasin */
function sheetName(title: string, used: Set<string>): string {
  const clean = (text: string) => text.replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim();
  const base = clean(title.replace(/[\\/*?:[\]]/g, ' ').slice(0, 28)) || 'Varaq';
  let name = base;
  let i = 2;
  while (used.has(name.toLowerCase())) name = `${clean(base.slice(0, 25))} ${i++}`;
  used.add(name.toLowerCase());
  return name;
}

function widthOf(blocks: Block[]): number {
  return Math.max(4, ...blocks.map((b) => (b.type === 'table' ? b.columns.length : b.type === 'chart' ? b.series.length + 1 : 4)));
}

export async function renderExcel(doc: ReportDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Korxona tahlil';
  wb.created = new Date();
  // Excel ochilganda formulalar qayta hisoblansin
  wb.calcProperties = { fullCalcOnLoad: true };
  const used = new Set<string>();

  // ─────────── Xulosa ───────────
  const cover = wb.addWorksheet(sheetName(doc.coverSheet ?? 'Xulosa', used), { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  cover.columns = [{ width: 4 }, { width: 44 }, { width: 22 }, { width: 44 }];
  let r = 1;
  cover.mergeCells(r, 1, r, 4);
  cover.getCell(r, 1).value = doc.title;
  cover.getCell(r, 1).font = { bold: true, size: 18, color: { argb: argb(PALETTE.navy) } };
  cover.getRow(r).height = 30;
  r += 1;
  cover.mergeCells(r, 1, r, 4);
  cover.getCell(r, 1).value = doc.subtitle;
  cover.getCell(r, 1).font = { size: 11, color: { argb: argb(PALETTE.muted) } };
  r += 2;
  for (const line of [...doc.meta, `Tayyorlangan: ${uzDate(doc.generatedAt.slice(0, 10))} ${doc.generatedAt.slice(11, 16)}`]) {
    cover.mergeCells(r, 2, r, 4);
    cover.getCell(r, 2).value = line;
    cover.getCell(r, 2).font = { color: { argb: argb(PALETTE.text) } };
    r += 1;
  }
  // Muqovada: o'z nomi bor KPI guruhlari (fakt / reja / prognoz) hammasi, aks holda birinchisi
  const kpiBlocks = doc.sections.flatMap((s) => s.blocks).filter((b): b is KpiBlock => b.type === 'kpis');
  const coverKpis = kpiBlocks.some((b) => b.title) ? kpiBlocks.filter((b) => b.title) : kpiBlocks.slice(0, 1);
  for (const block of coverKpis) {
    r += 1;
    if (block.title) {
      cover.getCell(r, 2).value = block.title;
      cover.getCell(r, 2).font = { bold: true, size: 12, color: { argb: argb(PALETTE.navy) } };
      r += 1;
    }
    for (const k of block.items) {
      cover.getCell(r, 2).value = k.label;
      cover.getCell(r, 2).font = { bold: true, color: { argb: argb(PALETTE.text) } };
      cover.getCell(r, 3).value = k.value;
      cover.getCell(r, 3).font = { bold: true, size: 12, color: { argb: argb(TONE_COLOR[k.tone ?? 'neutral']) } };
      cover.getCell(r, 4).value = k.sub ?? '';
      cover.getCell(r, 4).font = { color: { argb: argb(PALETTE.muted) } };
      r += 1;
    }
  }
  if (doc.highlights.length) {
    r += 1;
    cover.mergeCells(r, 1, r, 4);
    cover.getCell(r, 1).value = 'Asosiy xulosalar';
    cover.getCell(r, 1).font = { bold: true, size: 13, color: { argb: argb(PALETTE.navy) } };
    r += 1;
    doc.highlights.forEach((h, i) => {
      cover.mergeCells(r, 1, r, 4);
      const c = cover.getCell(r, 1);
      c.value = `${i + 1}. ${h}`;
      c.alignment = { wrapText: true, vertical: 'top' };
      cover.getRow(r).height = Math.max(18, Math.ceil(h.length / 110) * 15);
      r += 1;
    });
  }
  r += 1;
  cover.mergeCells(r, 1, r, 4);
  cover.getCell(r, 1).value = `Bo'limlar: ${doc.sections.map((s) => s.title).join(' · ')}`;
  cover.getCell(r, 1).font = { size: 9, color: { argb: argb(PALETTE.faint) } };

  // ─────────── Bo'limlar ───────────
  for (const section of doc.sections) {
    const span = widthOf(section.blocks);
    const ws = wb.addWorksheet(sheetName(section.sheet ?? section.title, used), { views: [{ showGridLines: false }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    ws.columns = Array.from({ length: span }, (_, i) => ({ width: i === 0 ? 36 : 17 }));
    let row = 1;
    ws.mergeCells(row, 1, row, span);
    ws.getCell(row, 1).value = section.title;
    ws.getCell(row, 1).font = { bold: true, size: 15, color: { argb: argb(PALETTE.navy) } };
    ws.getRow(row).height = 26;
    row += 1;
    if (section.intro) {
      ws.mergeCells(row, 1, row, span);
      ws.getCell(row, 1).value = section.intro;
      ws.getCell(row, 1).font = { size: 10, color: { argb: argb(PALETTE.muted) } };
      ws.getCell(row, 1).alignment = { wrapText: true };
      row += 1;
    }
    row += 1;

    for (const block of section.blocks) {
      if (block.type === 'kpis') {
        if (block.title) {
          ws.getCell(row, 1).value = block.title;
          ws.getCell(row, 1).font = { bold: true, size: 12, color: { argb: argb(PALETTE.navy) } };
          row += 1;
        }
        for (const k of block.items) {
          ws.getCell(row, 1).value = k.label;
          ws.getCell(row, 1).font = { bold: true, color: { argb: argb(PALETTE.text) } };
          ws.getCell(row, 2).value = k.value;
          ws.getCell(row, 2).font = { bold: true, color: { argb: argb(TONE_COLOR[k.tone ?? 'neutral']) } };
          if (k.sub) {
            ws.mergeCells(row, 3, row, Math.max(3, span));
            ws.getCell(row, 3).value = k.sub;
            ws.getCell(row, 3).font = { color: { argb: argb(PALETTE.muted) } };
          }
          row += 1;
        }
        row += 1;
      } else if (block.type === 'table') {
        row = writeTable(ws, block, row) + 1;
      } else if (block.type === 'chart') {
        const table: TableBlock = {
          type: 'table',
          title: `${block.title} (${block.unit})`,
          columns: [{ label: '' }, ...block.series.map((s) => ({ label: s.name, format: 'decimal' as const }))],
          rows: block.labels.map((l, i) => [l, ...block.series.map((s) => Math.round((s.values[i] ?? 0) * 100) / 100)]),
        };
        row = writeTable(ws, table, row) + 1;
      } else if (block.type === 'formulas') {
        if (block.title) {
          ws.getCell(row, 1).value = block.title;
          ws.getCell(row, 1).font = { bold: true, size: 11, color: { argb: argb(PALETTE.navy) } };
          row += 1;
        }
        const head = ws.getRow(row);
        head.getCell(1).value = block.headers?.[0] ?? "Ko'rsatkich";
        head.getCell(2).value = block.headers?.[1] ?? 'Qanday hisoblanadi';
        ws.mergeCells(row, 2, row, span);
        for (const c of [1, 2]) {
          const cell = head.getCell(c);
          cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(PALETTE.navy) } };
          cell.alignment = { vertical: 'middle' };
        }
        head.height = 22;
        row += 1;
        for (const item of block.items) {
          ws.getCell(row, 1).value = item.name;
          ws.getCell(row, 1).font = { bold: true, color: { argb: argb(PALETTE.ink) } };
          ws.getCell(row, 1).alignment = { vertical: 'top', wrapText: true };
          ws.mergeCells(row, 2, row, span);
          ws.getCell(row, 2).value = item.formula;
          ws.getCell(row, 2).alignment = { vertical: 'top', wrapText: true };
          ws.getRow(row).height = Math.max(18, Math.ceil(item.formula.length / Math.max(40, (span - 1) * 15)) * 15);
          for (let c = 1; c <= span; c += 1) ws.getCell(row, c).border = { bottom: { style: 'thin', color: { argb: argb(PALETTE.line) } } };
          row += 1;
        }
        row += 1;
      } else {
        if (block.title) {
          ws.getCell(row, 1).value = block.title;
          ws.getCell(row, 1).font = { bold: true, size: 12, color: { argb: argb(PALETTE.navy) } };
          row += 1;
        }
        block.items.forEach((t, i) => {
          ws.mergeCells(row, 1, row, span);
          const c = ws.getCell(row, 1);
          c.value = `${i + 1}. ${t}`;
          c.alignment = { wrapText: true, vertical: 'top' };
          ws.getRow(row).height = Math.max(18, Math.ceil(t.length / (span * 14)) * 15);
          row += 1;
        });
        row += 1;
      }
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

function writeTable(ws: ExcelJS.Worksheet, block: TableBlock, start: number): number {
  let row = start;
  if (block.title) {
    ws.getCell(row, 1).value = block.title;
    ws.getCell(row, 1).font = { bold: true, size: 12, color: { argb: argb(PALETTE.navy) } };
    row += 1;
  }
  const head = ws.getRow(row);
  block.columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.label;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(PALETTE.navy) } };
    cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', wrapText: true };
  });
  head.height = 30;
  row += 1;
  // Jonli formulalar: qatorlar va jami qatori (qiymatlar hisobot bilan aynan bir xil bo'lsagina)
  const calc = detectCalc(block);
  const firstRow = row;
  const lastRow = row + block.rows.length - 1;
  const totalRow = block.total ? lastRow + 1 : null;
  const shareBase = block.columns.map((_, i) => {
    const t = block.total?.[i];
    return typeof t === 'number' ? t : block.rows.reduce((s, r) => s + (typeof r[i] === 'number' ? (r[i] as number) : 0), 0);
  });
  const write = (values: typeof block.rows[number], bold: boolean, index: number) => {
    const r = ws.getRow(row);
    const isTotal = index === -1;
    values.forEach((v, i) => {
      const col = block.columns[i];
      const cell = r.getCell(i + 1);
      const rc = calc.rows[i];
      const mode = isTotal ? calc.total[i] : rc ? 'row' : null;
      if (mode === 'sum' && block.rows.length) {
        cell.value = { formula: `SUM(${colLetterOf(i)}${firstRow}:${colLetterOf(i)}${lastRow})`, result: v as number };
      } else if (mode === 'row' && rc && (typeof v === 'number' || (v === null && inputsReady(rc, values) && evaluate(rc, values, shareBase) === null))) {
        const f = excelFormula(rc, row, firstRow, lastRow, totalRow, rc.kind === 'share' && typeof block.total?.[rc.a] === 'number');
        cell.value = typeof v === 'number' ? { formula: f, result: v } : { formula: f };
      } else {
        cell.value = v === null ? null : v;
      }
      const fmt = typeof v === 'number' || mode ? excelFormat(col?.format) : undefined;
      if (fmt) cell.numFmt = fmt;
      const tone = cellTone(v, col, block.rowTone?.[index]);
      cell.font = { bold, color: { argb: argb(tone === 'neutral' ? PALETTE.ink : TONE_COLOR[tone]) } };
      cell.border = { bottom: { style: 'thin', color: { argb: argb(PALETTE.line) } } };
      cell.alignment = { vertical: 'middle', horizontal: typeof v === 'number' || mode ? 'right' : 'left', wrapText: typeof v === 'string' && v.length > 36 };
      if (bold) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(PALETTE.panel) } };
    });
    row += 1;
  };
  block.rows.forEach((values, i) => write(values, false, i));
  if (block.total) write(block.total, true, -1);
  if (block.note) {
    ws.getCell(row, 1).value = block.note;
    ws.getCell(row, 1).font = { size: 9, italic: true, color: { argb: argb(PALETTE.muted) } };
    row += 1;
  }
  return row;
}