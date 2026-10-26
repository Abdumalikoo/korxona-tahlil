import ExcelJS from 'exceljs';
import { monthLabel } from '../../common/period';
import type { BankDir, BankKind } from './bank-analysis.rules';

// ═══════════════════════════════════════════════════════════
// Hisobot (pivot): guruhlar → ierarxik jadval, ustunlarda oylar.
// Darajalar (tartibini foydalanuvchi tanlaydi):
//  • category    — hisobot moddasi (siz bergan, bo'lmasa — tur);
//  • kind        — tur (soliq, kommunal, ijara …);
//  • counterparty— kontragent (nomi + INN; bir xil INN — bitta qator);
//  • service     — xizmat / izoh (guruh nomi yoki fakturadagi xizmat, bankdagi izoh).
// Excel — «T/p · Xarajatlar izohi · Umumiy · oylar · Umumiy · INN · Izoh» shaklida.
// ═══════════════════════════════════════════════════════════

export type PivotLevel = 'category' | 'kind' | 'counterparty' | 'service';
export const PIVOT_LEVELS: PivotLevel[] = ['category', 'kind', 'counterparty', 'service'];
export const PIVOT_LEVEL_LABEL: Record<PivotLevel, string> = { category: 'Hisobot moddasi', kind: 'Tur', counterparty: 'Kontragent', service: 'Xizmat / izoh' };

/** Pivot uchun guruh (BankAnalysisService.groups natijasidan) */
export interface PivotGroup {
  key: string;
  dir: BankDir;
  kind: BankKind;
  kindLabel: string;
  counterparty: string;
  inn: string | null;
  name: string | null;
  category: string | null;
  samples: string[];
  count: number;
  totalTiyin: string;
  byMonth: Record<string, string>;
  pattern: string;
  postedCount: number;
}

export interface PivotNode {
  id: string;
  level: PivotLevel;
  label: string;
  inn: string | null;
  comment: string | null;
  count: number;
  /** Shu qatordagi guruhlar soni */
  groups: number;
  totalTiyin: string;
  byMonth: Record<string, string>;
  /** Faqat bitta guruhdan iborat bo'lsa — uni ochish uchun */
  groupKey: string | null;
  /** Ichidagi hamma guruh kalitlari (moddaga birdan biriktirish uchun) */
  keys: string[];
  children: PivotNode[];
}

export interface PivotQuery {
  dir: BankDir;
  levels: PivotLevel[];
  kinds: string[] | null;
  categories: string[] | null;
  patterns: string[] | null;
  search: string;
  minTiyin: bigint;
}

const big = (v: string) => {
  try {
    return BigInt(v);
  } catch {
    return 0n;
  }
};

export function parsePivotQuery(q: Record<string, unknown>): PivotQuery {
  const list = (v: unknown) => (typeof v === 'string' && v.trim() ? v.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 50) : null);
  const levels = (list(q.levels) ?? ['category', 'counterparty', 'service']).filter((l): l is PivotLevel => (PIVOT_LEVELS as string[]).includes(l));
  const min = Number(String(q.min ?? '').replace(/[\s,]/g, ''));
  return {
    dir: q.dir === 'IN' ? 'IN' : 'OUT',
    levels: [...new Set(levels)].length ? [...new Set(levels)] : ['category', 'counterparty', 'service'],
    kinds: list(q.kinds),
    categories: list(q.categories),
    patterns: list(q.patterns),
    search: typeof q.q === 'string' ? q.q.trim().toLowerCase().slice(0, 100) : '',
    minTiyin: Number.isFinite(min) && min > 0 ? BigInt(Math.round(min * 100)) : 0n,
  };
}

/** Xizmat nomidan oy va sana olib tashlanadi (oylar ustunlarda): «ПРОПУСК … за сентябрь 2026 г.» → «ПРОПУСК …» */
const MONTHS_RE = /(?<![\p{L}])(?:за\s+|uchun\s+)?(?:январ|феврал|март(?!\p{L}*карт)|апрел|ма[йя](?![\p{L}])|июн|июл|август|сент[яа]бр|октябр|ноябр|декабр|yanvar|fevral|mart(?![a-z]*kart)|aprel|may(?![a-z])|iyun|iyul|avgust|sentabr|oktabr|noyabr|dekabr)\p{L}*(?:[\s-]+(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сент[яа]бр|октябр|ноябр|декабр)\p{L}*)?(?:\s+(?:ойи|oyi)(?:\s+учун|\s+uchun)?)?(?:\s+\d{4}(?:\s*(?:г\.?|йил|yil|года?))?)?/giu;
export function cleanService(text: string): string {
  const t = text
    .replace(/(?:(?<![\p{L}])(?:с|по|до|dan|gacha)\s*)?(?<!\d)\d{1,2}[./-]\d{1,2}[./-]\d{2,4}(?!\d)\s*(?:г\.?(?![\p{L}])|йил|yil)?/gu, ' ')
    .replace(MONTHS_RE, ' ')
    .replace(/(?<![\p{L}\d])(?:20\d{2})\s*(?:г\.?|йил|yil)?(?![\p{L}\d])/gu, ' ')
    .replace(/(?<![\p{L}])(?:от|dan)\s*$/u, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/[\s.,;:–-]+$/u, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t || text.trim();
}
const serviceLabel = (g: PivotGroup) => g.name ?? cleanService(g.samples[0] ?? '—');
const categoryLabel = (g: PivotGroup) => g.category ?? g.kindLabel;

function keyOf(level: PivotLevel, g: PivotGroup): string {
  if (level === 'category') return `c:${categoryLabel(g).toLowerCase()}`;
  if (level === 'kind') return `k:${g.kind}`;
  if (level === 'counterparty') return g.inn ? `i:${g.inn}` : `n:${g.counterparty.toLowerCase()}`;
  return `s:${g.key}`;
}

function labelOf(level: PivotLevel, g: PivotGroup): string {
  if (level === 'category') return categoryLabel(g);
  if (level === 'kind') return g.kindLabel;
  if (level === 'counterparty') return g.counterparty;
  return serviceLabel(g);
}

export function buildPivot(all: PivotGroup[], months: string[], q: PivotQuery) {
  const groups = all.filter((g) => {
    if (g.dir !== q.dir) return false;
    if (q.kinds && !q.kinds.includes(g.kind)) return false;
    if (q.categories && !q.categories.includes(categoryLabel(g))) return false;
    if (q.patterns && !q.patterns.includes(g.pattern)) return false;
    if (q.minTiyin && big(g.totalTiyin) < q.minTiyin) return false;
    if (q.search) {
      const t = q.search;
      if (!(g.counterparty.toLowerCase().includes(t) || (g.inn ?? '').includes(t) || (g.name ?? '').toLowerCase().includes(t) || (g.category ?? '').toLowerCase().includes(t) || g.samples.some((x) => x.toLowerCase().includes(t)))) return false;
    }
    return true;
  });

  const make = (list: PivotGroup[], depth: number, prefix: string): PivotNode[] => {
    const level = q.levels[depth]!;
    const buckets = new Map<string, PivotGroup[]>();
    for (const g of list) {
      const k = keyOf(level, g);
      const b = buckets.get(k) ?? [];
      b.push(g);
      buckets.set(k, b);
    }
    const nodes = [...buckets.entries()].map(([k, l]) => {
      const byMonth: Record<string, bigint> = Object.fromEntries(months.map((p) => [p, 0n]));
      let total = 0n;
      let count = 0;
      for (const g of l) {
        for (const p of months) byMonth[p]! += big(g.byMonth[p] ?? '0');
        total += big(g.totalTiyin);
        count += g.count;
      }
      const first = l[0]!;
      const inns = new Set(l.map((g) => g.inn).filter(Boolean));
      // Izoh: xizmat darajasida — bank / faktura izohi; kontragentda — nima beradi (xizmatlari)
      const comment =
        level === 'service'
          ? first.samples.filter((s) => s !== serviceLabel(first)).slice(0, 2).join(' · ') || null
          : level === 'counterparty'
            ? [...new Set(l.map(serviceLabel))].slice(0, 3).join(' · ')
            : null;
      const id = `${prefix}/${k}`;
      return {
        id,
        level,
        label: labelOf(level, first),
        inn: level === 'counterparty' || (level === 'service' && inns.size === 1) ? (first.inn ?? null) : null,
        comment,
        count,
        groups: l.length,
        totalTiyin: total.toString(),
        byMonth: Object.fromEntries(Object.entries(byMonth).map(([p, v]) => [p, v.toString()])),
        groupKey: l.length === 1 ? first.key : null,
        keys: l.map((g) => g.key),
        children: depth + 1 < q.levels.length ? make(l, depth + 1, id) : [],
      } satisfies PivotNode;
    });
    return nodes.sort((a, b) => (big(b.totalTiyin) > big(a.totalTiyin) ? 1 : big(b.totalTiyin) < big(a.totalTiyin) ? -1 : a.label.localeCompare(b.label)));
  };

  const rows = groups.length ? make(groups, 0, '') : [];
  const byMonth: Record<string, bigint> = Object.fromEntries(months.map((p) => [p, 0n]));
  let total = 0n;
  for (const g of groups) {
    for (const p of months) byMonth[p]! += big(g.byMonth[p] ?? '0');
    total += big(g.totalTiyin);
  }
  return {
    months,
    dir: q.dir,
    levels: q.levels,
    rows,
    total: { totalTiyin: total.toString(), byMonth: Object.fromEntries(Object.entries(byMonth).map(([p, v]) => [p, v.toString()])), groups: groups.length, count: groups.reduce((s, g) => s + g.count, 0) },
    /** Filtr uchun: mavjud turlar va moddalar (yo'nalish bo'yicha) */
    facets: {
      kinds: [...new Map(all.filter((g) => g.dir === q.dir).map((g) => [g.kind, g.kindLabel])).entries()].map(([code, label]) => ({ code, label })),
      categories: [...new Set(all.filter((g) => g.dir === q.dir).map(categoryLabel))].sort((a, b) => a.localeCompare(b)),
    },
  };
}

/** Excel: rasmdagi shakl — T/p, izoh, Umumiy, oylar, Umumiy, INN, Izoh */
export async function pivotWorkbook(p: ReturnType<typeof buildPivot>, title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Korxona tahlil';
  const ws = wb.addWorksheet('Hisobot', { views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }] });
  const months = p.months;
  const cols = 2 + 1 + months.length + 1 + 2;
  const thin = { style: 'thin' as const, color: { argb: 'FFBFC5CE' } };
  const border: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
  const red = { color: { argb: 'FFDC2626' } };

  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  ws.mergeCells(1, 1, 1, Math.min(cols, 14));
  const head = ['T/p', p.dir === 'OUT' ? 'Xarajatlar izohi' : 'Daromadlar izohi', 'Umumiy', ...months.map((m) => monthLabel(m).split(' ')[0]!), 'Umumiy', 'INN', 'Izoh'];
  head.forEach((h, i) => {
    const c = ws.getCell(3, i + 1);
    c.value = h;
    c.font = { bold: true, ...(h === 'Umumiy' ? red : {}) };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.fill = fill('FFDBEAFE');
    c.border = border;
  });
  ws.getRow(3).height = 30;

  let r = 4;
  const write = (n: PivotNode, depth: number, no: string) => {
    const row = ws.getRow(r);
    row.getCell(1).value = depth === 0 ? Number(no) : null;
    row.getCell(2).value = `${'    '.repeat(depth)}${n.label}`;
    row.getCell(3).value = Number(n.totalTiyin) / 100;
    months.forEach((m, i) => {
      const v = Number(n.byMonth[m] ?? '0') / 100;
      row.getCell(4 + i).value = v || '-';
    });
    row.getCell(4 + months.length).value = Number(n.totalTiyin) / 100;
    row.getCell(5 + months.length).value = n.inn ?? '';
    row.getCell(6 + months.length).value = n.comment ?? '';
    for (let c = 1; c <= cols; c++) {
      const cell = row.getCell(c);
      cell.border = border;
      if (c >= 3 && c <= 4 + months.length) {
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'right' };
      }
    }
    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(3).font = { bold: depth === 0, ...red, italic: depth > 0 };
    row.getCell(4 + months.length).font = { bold: depth === 0, ...red, italic: depth > 0 };
    if (depth === 0) {
      row.getCell(2).font = { bold: true };
      for (let c = 4; c < 4 + months.length; c++) row.getCell(c).font = { bold: true };
    } else if (depth > 1) row.getCell(2).font = { italic: true, color: { argb: 'FF4B5563' } };
    row.getCell(6 + months.length).alignment = { wrapText: false };
    r += 1;
    n.children.forEach((ch) => write(ch, depth + 1, ''));
  };
  p.rows.forEach((n, i) => write(n, 0, String(i + 1)));

  const tr = ws.getRow(r);
  tr.getCell(2).value = 'JAMI';
  tr.getCell(3).value = Number(p.total.totalTiyin) / 100;
  months.forEach((m, i) => (tr.getCell(4 + i).value = Number(p.total.byMonth[m] ?? '0') / 100));
  tr.getCell(4 + months.length).value = Number(p.total.totalTiyin) / 100;
  for (let c = 1; c <= cols; c++) {
    const cell = tr.getCell(c);
    cell.font = { bold: true, ...(c === 3 || c === 4 + months.length ? red : {}) };
    cell.fill = fill('FFF3F4F6');
    cell.border = border;
    if (c >= 3 && c <= 4 + months.length) cell.numFmt = '#,##0.00';
  }

  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 52;
  ws.getColumn(3).width = 18;
  months.forEach((_, i) => (ws.getColumn(4 + i).width = 15));
  ws.getColumn(4 + months.length).width = 18;
  ws.getColumn(5 + months.length).width = 12;
  ws.getColumn(6 + months.length).width = 60;
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: cols } };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
