import { detectCalc, evaluate, type RowCalc } from './reports.calc';
import { fmtPct, grouped } from './reports.format';
import type { Cell, ColumnFormat, FormulaItem, FormulasBlock, ReportDoc, ReportSection, TableBlock } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Hisob-kitoblar raqamlar bilan ("ishlanishi bilan").
//
// Har bir jadval uchun ustun qanday hisoblangani (reports.calc.ts aniqlaydi — Excel formulalari bilan bir xil)
// hisobotning o'z raqamlari qo'yilib yoziladi:
//   Natija (Jami) = Daromad − Xarajat = 635 800 000 − 370 100 000 = 265 700 000
//
//  • Asosiylari — jadvalning jami qatori (jami bo'lmasa — birinchi qator namunasi) — jadval ostida,
//    Excel, PowerPoint, PDF va ekrandagi ko'rinishda;
//  • Ilova — har bir qatorning hisob-kitobi — PDF oxirida va ekranda.
// Natija faqat hisobotdagi qiymatga aynan teng bo'lsa yoziladi (calc shuni kafolatlaydi).
// ═══════════════════════════════════════════════════════════

const MAX_SUM_TERMS = 6;
/** Jami qatori yo'q jadvalda shuncha qatorgacha — hammasi asosiylarda, ko'p bo'lsa — birinchisi namuna */
const MAX_KEY_ROWS = 6;
const MAX_APPENDIX_LINES = 400;

const isNum = (v: Cell | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Hisob-kitobdagi son: pul — to'liq so'm (yaxlitlashsiz qo'shiladi), foiz — 1 xona */
function numText(value: number, format: ColumnFormat | undefined): string {
  switch (format) {
    case 'money':
    case 'mln':
      return grouped(value);
    case 'int':
      return grouped(value);
    case 'pct':
    case 'signedPct':
      return fmtPct(value);
    case 'decimal':
      return value.toFixed(2).replace('.', ',');
    case 'decimal3':
      return value.toFixed(3).replace('.', ',');
    default:
      return grouped(value, Number.isInteger(value) ? 0 : 2);
  }
}

/** Qator nomi: birinchi matnli katak */
function rowLabel(row: Cell[], fallback: string): string {
  const text = row.find((c) => typeof c === 'string' && c.trim() !== '');
  return typeof text === 'string' ? text : fallback;
}

/** Ustun nomi (bo'sh bo'lsa — tartib raqami) */
function colName(block: TableBlock, c: number): string {
  return block.columns[c]?.label?.trim() || `${c + 1}-ustun`;
}

/** Ulush asosi — jami qatori, bo'lmasa qatorlar yig'indisi (calc bilan bir xil) */
function shareBase(block: TableBlock): number[] {
  return block.columns.map((_, i) => {
    const t = block.total?.[i];
    if (isNum(t)) return t;
    return block.rows.reduce<number>((s, r) => s + (isNum(r[i]) ? (r[i] as number) : 0), 0);
  });
}

/**
 * Bitta katak hisob-kitobi: "Nomlar bilan = Raqamlar bilan = Natija".
 * Qiymat hisobotdagidan farq qilsa (bo'lmasligi kerak) — null.
 */
function working(block: TableBlock, calc: RowCalc, row: Cell[], c: number, base: number[]): string | null {
  const result = row[c];
  if (!isNum(result)) return null;
  const value = evaluate(calc, row, base);
  // Faqat hisobotdagi qiymatga aynan teng bo'lsa (Excel formulasi bilan bir xil qoida)
  if (value === null || Math.abs(value - result) > 1e-6 * Math.max(1, Math.abs(value), Math.abs(result))) return null;

  const fmt = (i: number) => block.columns[i]?.format;
  const v = (i: number) => numText(row[i] as number, fmt(i));
  const n = (i: number) => colName(block, i);
  const out = numText(result, fmt(c));

  switch (calc.kind) {
    case 'rowsum': {
      const idx = Array.from({ length: calc.to - calc.from + 1 }, (_, k) => calc.from + k);
      return `${idx.map(n).join(' + ')} = ${idx.map(v).join(' + ')} = ${out}`;
    }
    case 'sub':
      return `${n(calc.a)} − ${n(calc.b)} = ${v(calc.a)} − ${v(calc.b)} = ${out}`;
    case 'margin':
      return `(${n(calc.a)} − ${n(calc.b)}) ÷ ${n(calc.a)} × 100% = (${v(calc.a)} − ${v(calc.b)}) ÷ ${v(calc.a)} × 100% = ${out}`;
    case 'change':
      return `(${n(calc.a)} − ${n(calc.b)}) ÷ |${n(calc.b)}| × 100% = (${v(calc.a)} − ${v(calc.b)}) ÷ ${numText(Math.abs(row[calc.b] as number), fmt(calc.b))} × 100% = ${out}`;
    case 'share':
      return `${n(calc.a)} ÷ Jami ${n(calc.a)} × 100% = ${v(calc.a)} ÷ ${numText(base[calc.a] ?? 0, fmt(calc.a))} × 100% = ${out}`;
    case 'div':
      return calc.scale === 100
        ? `${n(calc.a)} ÷ ${n(calc.b)} × 100% = ${v(calc.a)} ÷ ${v(calc.b)} × 100% = ${out}`
        : `${n(calc.a)} ÷ ${n(calc.b)} = ${v(calc.a)} ÷ ${v(calc.b)} = ${out}`;
  }
}

/** Jami qatori yig'indi bo'lsa: "a + b + c = T" (ko'p bo'lsa — boshi, oxiri va soni) */
function sumWorking(block: TableBlock, c: number): string | null {
  const total = block.total?.[c];
  if (!isNum(total)) return null;
  const fmt = block.columns[c]?.format;
  const values = block.rows.map((r) => r[c]).filter(isNum);
  if (values.length === 0) return null;
  const terms = values.map((x) => (x < 0 ? `(${numText(x, fmt)})` : numText(x, fmt)));
  const shown =
    terms.length <= MAX_SUM_TERMS
      ? terms.join(' + ')
      : `${terms.slice(0, 3).join(' + ')} + … + ${terms[terms.length - 1]} (${terms.length} ta qator)`;
  return `${shown} = ${numText(total, fmt)}`;
}

export interface TableWorkings {
  /** Jadval ostida: asosiy hisob-kitoblar */
  key: FormulaItem[];
  /** Ilova: har bir qator */
  appendix: FormulaItem[];
}

export function tableWorkings(block: TableBlock): TableWorkings {
  const calc = detectCalc(block);
  const base = shareBase(block);
  const key: FormulaItem[] = [];
  const appendix: FormulaItem[] = [];
  const hasTotal = Array.isArray(block.total);

  for (let c = 1; c < block.columns.length; c += 1) {
    const rowCalc = calc.rows[c];
    const totalKind = calc.total[c];

    // Asosiylari: jami qatori
    // Jami qatoridagi ulush har doim 100% — yozilmaydi
    if (hasTotal && totalKind === 'row' && rowCalc?.kind === 'share') {
      // o'tkazib yuboriladi
    } else if (hasTotal && totalKind === 'row' && rowCalc) {
      const text = working(block, rowCalc, block.total!, c, base);
      if (text) key.push({ name: `${colName(block, c)} (Jami)`, formula: text });
    } else if (hasTotal && totalKind === 'sum') {
      const text = sumWorking(block, c);
      const label = colName(block, c);
      const name = /^jami/i.test(label) ? `${label} (ustun yig'indisi)` : `Jami ${label.toLowerCase()} (ustun yig'indisi)`;
      if (text) key.push({ name, formula: text });
    } else if (!hasTotal && rowCalc) {
      // Jami qatori yo'q: qatorlar kam bo'lsa — hammasi, ko'p bo'lsa — birinchisi namuna sifatida
      const withValue = block.rows.filter((r) => isNum(r[c]));
      const few = withValue.length <= MAX_KEY_ROWS;
      for (const r of few ? withValue : withValue.slice(0, 1)) {
        const text = working(block, rowCalc, r, c, base);
        if (text) key.push({ name: `${colName(block, c)} — ${rowLabel(r, 'qator')}${few ? '' : ' (namuna)'}`, formula: text });
      }
    }

    // Ilova: har bir qator
    if (rowCalc) {
      block.rows.forEach((r, i) => {
        if (appendix.length >= MAX_APPENDIX_LINES) return;
        const text = working(block, rowCalc, r, c, base);
        if (text) appendix.push({ name: `${rowLabel(r, `${i + 1}-qator`)} — ${colName(block, c)}`, formula: text });
      });
    }
  }
  return { key, appendix };
}

/**
 * Hujjatga hisob-kitoblarni qo'shadi: har bir jadval ostiga asosiylari.
 * Ilova bo'limini qaytaradi (PDF va ekran uchun; bo'lmasa — null).
 */
export function addWorkings(doc: ReportDoc): ReportSection | null {
  const appendixBlocks: FormulasBlock[] = [];

  for (const section of doc.sections) {
    const blocks: typeof section.blocks = [];
    for (const block of section.blocks) {
      blocks.push(block);
      if (block.type !== 'table' || block.rows.length === 0) continue;
      const w = tableWorkings(block);
      const title = block.title ?? section.title;
      if (w.key.length > 0) {
        blocks.push({
          type: 'formulas',
          title: `Hisob-kitob: ${title}`,
          headers: ["Ko'rsatkich", 'Hisob-kitob (hisobot raqamlari bilan)'],
          items: w.key,
        });
      }
      if (w.appendix.length > 0) {
        appendixBlocks.push({
          type: 'formulas',
          title: `${section.title}${block.title ? ` — ${block.title}` : ''}`,
          headers: ['Qator va ustun', 'Hisob-kitob'],
          items: w.appendix,
        });
      }
    }
    section.blocks = blocks;
  }

  if (appendixBlocks.length === 0) return null;
  return {
    title: 'Ilova: har bir qatorning hisob-kitobi',
    intro: "Jadvallardagi har bir hisoblangan katak — qaysi ustunlardan va qanday raqamlar bilan chiqqani. Pul — so'mda, yaxlitlashsiz.",
    blocks: appendixBlocks,
  };
}