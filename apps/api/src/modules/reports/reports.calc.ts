import type { Cell, ColumnFormat, TableBlock } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Excel uchun jonli formulalar.
// Har bir jadval ustuni uchun qatordagi qiymat qaysi formula bilan hosil bo'lgani aniqlanadi
// (natija = A − B, o'zgarish, rentabellik, ulush, bo'lish, qator yig'indisi) va jami qatori uchun SUM.
// Formula faqat BARCHA qatorlarda hisobot qiymatini aynan qaytarsa qo'yiladi — aks holda qiymat o'zi qoladi.
// Ustun faqat o'zidan chapdagi ustunlarga tayanadi (aylanma havola bo'lmaydi).
// ═══════════════════════════════════════════════════════════

export type RowCalc =
  | { kind: 'rowsum'; from: number; to: number }
  | { kind: 'sub'; a: number; b: number }
  | { kind: 'margin'; a: number; b: number }
  | { kind: 'change'; a: number; b: number }
  | { kind: 'share'; a: number }
  | { kind: 'div'; a: number; b: number; scale: number };

export interface TableCalc {
  /** Ustun bo'yicha qator formulasi (yo'q bo'lsa null) */
  rows: (RowCalc | null)[];
  /** Jami qatori: 'sum' — ustun yig'indisi, 'row' — qator formulasi jami qatoriga ham, null — qiymat */
  total: ('sum' | 'row' | null)[];
}

const NUMERIC: ColumnFormat[] = ['money', 'mln', 'int', 'decimal', 'decimal3', 'pct', 'signedPct'];

const isNum = (v: Cell | undefined): v is number => typeof v === 'number' && Number.isFinite(v);
const close = (x: number, y: number) => Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));

/** Formula natijasi (kirishlar son bo'lmasa yoki nolga bo'linsa — null) */
export function evaluate(calc: RowCalc, row: Cell[], shareBase: number[] | null): number | null {
  const v = (i: number) => (isNum(row[i]) ? (row[i] as number) : null);
  switch (calc.kind) {
    case 'rowsum': {
      let s = 0;
      for (let i = calc.from; i <= calc.to; i += 1) {
        const x = v(i);
        if (x === null) return null;
        s += x;
      }
      return s;
    }
    case 'sub': {
      const a = v(calc.a);
      const b = v(calc.b);
      return a === null || b === null ? null : a - b;
    }
    case 'margin': {
      const a = v(calc.a);
      const b = v(calc.b);
      return a === null || b === null || a === 0 ? null : ((a - b) / a) * 100;
    }
    case 'change': {
      const a = v(calc.a);
      const b = v(calc.b);
      return a === null || b === null || b === 0 ? null : ((a - b) / Math.abs(b)) * 100;
    }
    case 'share': {
      const a = v(calc.a);
      const base = shareBase?.[calc.a] ?? 0;
      return a === null || !base ? null : (a / base) * 100;
    }
    case 'div': {
      const a = v(calc.a);
      const b = v(calc.b);
      return a === null || b === null || b === 0 ? null : (a / b) * calc.scale;
    }
  }
}

/** Formula kirishlari hammasi son (bo'sh katak formulani buzmasligi uchun) */
export function inputsReady(calc: RowCalc, row: Cell[]): boolean {
  const refs = calc.kind === 'rowsum' ? Array.from({ length: calc.to - calc.from + 1 }, (_, k) => calc.from + k) : calc.kind === 'share' ? [calc.a] : [calc.a, calc.b];
  return refs.every((i) => isNum(row[i]));
}

/** Formula barcha qatorlarda hisobot qiymatiga mosmi */
function fits(block: TableBlock, c: number, calc: RowCalc, shareBase: number[]): boolean {
  let matched = 0;
  let varied = false;
  for (const row of block.rows) {
    const value = row[c];
    if (typeof value === 'string') continue; // matnli katak ("yangi" kabi) o'zgarmaydi
    const expected = evaluate(calc, row, shareBase);
    if (!isNum(value)) {
      if (expected !== null) return false;
      continue;
    }
    if (expected === null || !close(value, expected)) return false;
    matched += 1;
    // Tasodifiy moslikni istisno qilish: kirishlar haqiqatan ishlatilgan bo'lsin (A − 0, A / 1 emas)
    if (calc.kind === 'sub' && isNum(row[calc.b]) && row[calc.b] !== 0 && isNum(row[calc.a]) && row[calc.a] !== 0) varied = true;
    if (calc.kind === 'div' && isNum(row[calc.b]) && row[calc.b] !== 1 && row[calc.b] !== 0) varied = true;
    if (calc.kind === 'rowsum' && calc.to > calc.from) varied = true;
    if (calc.kind === 'margin' || calc.kind === 'change' || calc.kind === 'share') varied = true;
  }
  return matched >= 2 && varied;
}

export function detectCalc(block: TableBlock): TableCalc {
  const n = block.columns.length;
  const numeric = block.columns.map((col, i) => i > 0 && NUMERIC.includes(col.format ?? 'text'));
  const rowsFor = (c: number) => block.rows.map((r) => r[c]);
  // Ulush asosi: jami qatoridagi qiymat, bo'lmasa qatorlar yig'indisi
  const shareBase = block.columns.map((_, i) => {
    const t = block.total?.[i];
    if (isNum(t)) return t;
    return rowsFor(i).reduce<number>((s, v) => s + (isNum(v) ? v : 0), 0);
  });
  const rows: (RowCalc | null)[] = new Array(n).fill(null);
  const total: ('sum' | 'row' | null)[] = new Array(n).fill(null);

  for (let c = 1; c < n; c += 1) {
    if (!numeric[c]) continue;
    const fmt = block.columns[c]!.format;
    const left = Array.from({ length: c }, (_, i) => i).filter((i) => numeric[i]);
    const candidates: RowCalc[] = [];
    if (fmt === 'money' || fmt === 'int' || fmt === 'mln') {
      // Qator yig'indisi: chapdagi ketma-ket sonli ustunlar (kamida 2 ta)
      for (let from = 1; from < c - 1; from += 1) {
        if (Array.from({ length: c - from }, (_, k) => from + k).every((i) => numeric[i] && block.columns[i]!.format === fmt)) candidates.push({ kind: 'rowsum', from, to: c - 1 });
      }
      for (const a of left) for (const b of left) if (a !== b) candidates.push({ kind: 'sub', a, b });
      for (const a of left) for (const b of left) if (a !== b) candidates.push({ kind: 'div', a, b, scale: 1 });
    } else if (fmt === 'pct' || fmt === 'signedPct') {
      for (const a of left) for (const b of left) if (a !== b) candidates.push({ kind: 'margin', a, b });
      for (const a of left) for (const b of left) if (a !== b) candidates.push({ kind: 'change', a, b });
      for (const a of left) candidates.push({ kind: 'share', a });
      for (const a of left) for (const b of left) if (a !== b) candidates.push({ kind: 'div', a, b, scale: 100 });
    } else {
      for (const a of left) for (const b of left) if (a !== b) candidates.push({ kind: 'div', a, b, scale: 1 });
    }
    rows[c] = candidates.find((calc) => fits(block, c, calc, shareBase)) ?? null;
  }

  if (block.total) {
    for (let c = 1; c < n; c += 1) {
      const t = block.total[c];
      if (!numeric[c] || !isNum(t)) continue;
      const calc = rows[c];
      if (calc) {
        const v = evaluate(calc, block.total, shareBase);
        if (v !== null && close(v, t)) {
          total[c] = 'row';
          continue;
        }
      }
      const values = rowsFor(c);
      if (values.every((v) => v === null || isNum(v)) && close(values.reduce<number>((s, v) => s + (isNum(v) ? v : 0), 0), t)) total[c] = 'sum';
    }
  }
  return { rows, total };
}

/** 0 → A, 25 → Z, 26 → AA */
export function colLetter(index: number): string {
  let s = '';
  let i = index;
  do {
    s = String.fromCharCode(65 + (i % 26)) + s;
    i = Math.floor(i / 26) - 1;
  } while (i >= 0);
  return s;
}

/** Excel formulasi (bosh "=" belgisisiz) — qator r uchun; firstRow..lastRow — ma'lumot qatorlari, totalRow — jami (bo'lsa) */
export function excelFormula(calc: RowCalc, r: number, firstRow: number, lastRow: number, totalRow: number | null, shareFromTotal: boolean): string {
  const L = (i: number) => `${colLetter(i)}${r}`;
  switch (calc.kind) {
    case 'rowsum':
      return `SUM(${L(calc.from)}:${L(calc.to)})`;
    case 'sub':
      return `${L(calc.a)}-${L(calc.b)}`;
    case 'margin':
      return `IF(${L(calc.a)}=0,"",(${L(calc.a)}-${L(calc.b)})/${L(calc.a)}*100)`;
    case 'change':
      return `IF(${L(calc.b)}=0,"",(${L(calc.a)}-${L(calc.b)})/ABS(${L(calc.b)})*100)`;
    case 'share': {
      const col = colLetter(calc.a);
      const base = shareFromTotal && totalRow !== null ? `${col}$${totalRow}` : `SUM(${col}$${firstRow}:${col}$${lastRow})`;
      return `IF(${base}=0,"",${L(calc.a)}/${base}*100)`;
    }
    case 'div':
      return `IF(${L(calc.b)}=0,"",${L(calc.a)}/${L(calc.b)}${calc.scale !== 1 ? `*${calc.scale}` : ''})`;
  }
}