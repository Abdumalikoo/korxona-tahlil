import ExcelJS from 'exceljs';
import { translit } from '../../modules/leases/leases.match';
import { cellValue } from '../../modules/salary-composition/salary-composition.excel';

// ═══════════════════════════════════════════════════════════
// Umumiy shablon tizimi: Excel faylni «shablon ta'rifi» bo'yicha o'qish va bo'sh shablon yaratish.
//
// Ta'rif — maydonlar ro'yxati: har birining sarlavha sinonimlari (kirill/lotin farqi yo'q — hammasi lotin kalitga
// keltiriladi), ixtiyoriy guruh sarlavhasi (ikki qatorli sarlavha: «Шартнома / жами сумма»), turi (matn, son, sana).
//  • Sarlavha qatori avtomatik topiladi: har varaqning birinchi qatorlaridan eng ko'p maydon tanilgani;
//    birlashgan kataklar (guruh sarlavhasi) ExcelJS'da asosiy katak qiymatini beradi — shu bilan guruh aniqlanadi.
//  • Ma'lumot qatorlari: «Жами», imzo («Масъул шахс», «Имзо», «Сана: «___»»), ustun raqamlari qatori (1, 2, 3 …)
//    va kalit maydoni bo'sh qatorlar tashlanadi — sababi bilan.
//  • Sana: Excel sanasi, Excel raqami (46224), «26.08.2026», «26.08.2026, 18:60» (vaqt e'tiborsiz), «2026-08-26».
//  • Son: «1 234 567,50», «1,234,567.50», «-» — bo'sh.
// Shu ta'rifdan bo'sh shablon (sarlavhalar, guruhlar, kengliklar, «Yo'riqnoma» varag'i) ham yaratiladi.
// ═══════════════════════════════════════════════════════════

export type FieldKind = 'text' | 'number' | 'date';

export interface TemplateField {
  key: string;
  /** Shablondagi sarlavha (bo'sh shablon uchun) */
  label: string;
  /** Sarlavha sinonimlari — lotin kalit ko'rinishida (sheetKey bilan solishtiriladi) */
  aliases: string[];
  /** Guruh sarlavhasi sinonimlari (ikki qatorli sarlavha); berilmasa — maydon guruhsiz (yoki guruh = o'zi) */
  group?: string[];
  /** Bo'sh shablonda guruh nomi */
  groupLabel?: string;
  kind: FieldKind;
  required?: boolean;
  /** Bo'sh shablonda ustun kengligi */
  width?: number;
}

export interface TemplateSpec {
  id: string;
  title: string;
  fields: TemplateField[];
  /** Qator «ma'lumot» hisoblanishi uchun to'ldirilishi shart maydon */
  rowKey: string;
  /** Sarlavha qidiriladigan qatorlar soni */
  scanRows?: number;
  /** Bo'sh shablon yo'riqnomasi */
  help?: string[];
}

export type CellOut = string | number | null;

export interface TemplateRow {
  /** Excel qator raqami */
  row: number;
  values: Record<string, CellOut>;
  /** O'qishdagi ogohlantirishlar (sana, son) */
  warnings: string[];
}

export interface TemplateParse {
  sheet: string;
  headerRow: number;
  /** Maydon → ustun raqami */
  columns: Record<string, number>;
  /** Topilmagan maydonlar (majburiylari bo'lsa — xato) */
  missing: string[];
  rows: TemplateRow[];
  skipped: { row: number; reason: string }[];
}

/** Sarlavha kaliti: lotin, kichik harf, faqat harf va raqam */
export function sheetKey(text: unknown): string {
  return translit(String(text ?? ''))
    .replace(/[‘’ʻʼ`']/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Jami va imzo qatorlari: «Жами», «Итого», «Масъул шахс: ___», «Имзо: ___», «Сана: «___»» */
const SKIP_ROW = /^(jami|itogo|vsego)(\b|:|$)|^masul shaxs|^imzo\b|^sana\s*:|_{3,}/;

/** Katak matni (formula natijasi, boy matn) */
function textOf(v: ExcelJS.CellValue): string {
  const raw = cellValue(v);
  if (raw === null || raw === undefined) return '';
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw).trim();
}

/** Son: Excel soni yoki matn («1 234,5», «1,234.5»); «-» va bo'sh — null; o'qilmasa — NaN */
export function numberOf(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return null;
  let s = String(v).replace(/[\s ]/g, '');
  if (s === '' || s === '-' || s === '—' || s === '___') return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /,\d{3}$/.test(s) && s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : Number.NaN;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(Math.min(d, last))}`;
};

/** Sana → «YYYY-MM-DD»: Excel sanasi, Excel raqami, «dd.mm.yyyy[, hh:mm]», «yyyy-mm-dd»; o'qilmasa — null */
export function dateOf(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return iso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null;
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

const matches = (k: string, aliases: string[]) => k !== '' && aliases.some((a) => k === a);

/** Varaqdagi sarlavha: qator r (ustun nomi) va undan yuqoridagi qator (guruh) bo'yicha maydonlarni topish */
function locate(ws: ExcelJS.Worksheet, r: number, spec: TemplateSpec): Record<string, number> {
  const cols: Record<string, number> = {};
  const used = new Set<number>();
  const width = Math.min(ws.columnCount, 200);
  const head = (row: number, c: number) => (row >= 1 ? sheetKey(textOf(ws.getRow(row).getCell(c).value)) : '');
  // Guruhli maydonlar avval (aniqroq), keyin guruhsizlari
  const order = [...spec.fields].sort((a, b) => Number(Boolean(b.group)) - Number(Boolean(a.group)));
  for (const f of order) {
    for (let c = 1; c <= width; c++) {
      if (used.has(c)) continue;
      const sub = head(r, c);
      const grp = head(r - 1, c);
      if (f.group) {
        if (matches(grp, f.group) && matches(sub, f.aliases)) {
          cols[f.key] = c;
          used.add(c);
          break;
        }
      } else if (matches(sub, f.aliases) && (grp === '' || grp === sub || !spec.fields.some((g) => g.group && matches(grp, g.group)))) {
        cols[f.key] = c;
        used.add(c);
        break;
      }
    }
  }
  return cols;
}

/** Ishchi kitobni shablon bo'yicha o'qish: eng mos varaq va sarlavha qatori */
export function parseWithTemplate(wb: ExcelJS.Workbook, spec: TemplateSpec): TemplateParse | null {
  let best: { ws: ExcelJS.Worksheet; r: number; cols: Record<string, number>; score: number } | null = null;
  for (const ws of wb.worksheets) {
    const last = Math.min(ws.rowCount, spec.scanRows ?? 20);
    for (let r = 1; r <= last; r++) {
      const cols = locate(ws, r, spec);
      const score = Object.keys(cols).length + spec.fields.filter((f) => f.required && cols[f.key]).length;
      if (!best || score > best.score) best = { ws, r, cols, score };
    }
  }
  if (!best || !best.cols[spec.rowKey]) return null;
  const { ws, r: headerRow, cols } = best;
  const rows: TemplateRow[] = [];
  const skipped: { row: number; reason: string }[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw = (c: number) => cellValue(row.getCell(c).value);
    const keyText = textOf(row.getCell(cols[spec.rowKey]!).value);
    // Chapdan birinchi to'ldirilgan katak (ustunlar chapdan o'ngga)
    const firstText = [1, ...Object.values(cols).sort((x, y) => x - y)].map((c) => textOf(row.getCell(c).value)).find((t) => t !== '') ?? '';
    const first = translit(firstText).replace(/[‘’ʻʼ`']/g, '').trim();
    if (SKIP_ROW.test(first)) {
      skipped.push({ row: r, reason: 'jami yoki imzo qatori' });
      continue;
    }
    if (!keyText) {
      if (first) skipped.push({ row: r, reason: "kalit maydon bo'sh" });
      continue;
    }
    // Ustun raqamlari qatori (1, 2, 3 …) — sarlavha ostida
    const nums = Object.values(cols).map((c) => raw(c));
    if (nums.filter((x) => typeof x === 'number').length >= Math.max(3, nums.length - 2) && typeof raw(cols[spec.rowKey]!) === 'number') {
      skipped.push({ row: r, reason: 'ustun raqamlari qatori' });
      continue;
    }
    const values: Record<string, CellOut> = {};
    const warnings: string[] = [];
    for (const f of spec.fields) {
      const c = cols[f.key];
      if (!c) {
        values[f.key] = null;
        continue;
      }
      const v = raw(c);
      if (f.kind === 'text') values[f.key] = textOf(row.getCell(c).value) || null;
      else if (f.kind === 'number') {
        const n = numberOf(v);
        if (Number.isNaN(n)) warnings.push(`«${f.label}» son emas: ${String(v).slice(0, 30)}`);
        values[f.key] = n === null || Number.isNaN(n) ? null : n;
      } else {
        const d = dateOf(v);
        const t = v instanceof Date ? '' : String(v ?? '').trim();
        if (!d && v !== null && v !== '' && v !== 0 && !['-', 'йўқ', 'yoq'].includes(t.toLowerCase())) warnings.push(`«${f.label}» sana emas: ${t.slice(0, 30)}`);
        values[f.key] = d;
      }
    }
    rows.push({ row: r, values, warnings });
  }
  const missing = spec.fields.filter((f) => !cols[f.key]).map((f) => f.key);
  return { sheet: ws.name, headerRow, columns: cols, missing, rows, skipped };
}

/** Bo'sh shablon: guruhli ikki qatorli sarlavha, kengliklar, «Yo'riqnoma» varag'i */
export async function buildTemplate(spec: TemplateSpec): Promise<Buffer> {
  return Buffer.from(await buildTemplateWorkbook(spec).xlsx.writeBuffer());
}

/** Bo'sh shablon kitobi (to'ldirib berish uchun — masalan, joriy ma'lumot bilan); ma'lumot 5-qatordan */
export function buildTemplateWorkbook(spec: TemplateSpec): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Korxona tahlil';
  const ws = wb.addWorksheet(spec.title.slice(0, 31));
  ws.getCell(1, 1).value = spec.title;
  ws.getCell(1, 1).font = { bold: true, size: 13 };
  const top = 3;
  const fill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
  spec.fields.forEach((f, i) => {
    const c = i + 1;
    const g = ws.getCell(top, c);
    const s = ws.getCell(top + 1, c);
    g.value = f.groupLabel ?? f.label;
    s.value = f.label;
    for (const cell of [g, s]) {
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = fill;
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    }
    ws.getColumn(c).width = f.width ?? 14;
    if (f.kind === 'number') ws.getColumn(c).numFmt = '#,##0';
    if (f.kind === 'date') ws.getColumn(c).numFmt = 'dd.mm.yyyy';
  });
  // Guruhsiz ustunlar — ikki qator birlashtiriladi; guruhlilar — guruh qatori yonma-yon birlashtiriladi
  let i = 0;
  while (i < spec.fields.length) {
    const f = spec.fields[i]!;
    if (!f.groupLabel) {
      ws.mergeCells(top, i + 1, top + 1, i + 1);
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < spec.fields.length && spec.fields[j + 1]!.groupLabel === f.groupLabel) j++;
    if (j > i) ws.mergeCells(top, i + 1, top, j + 1);
    i = j + 1;
  }
  ws.getRow(top).height = 30;
  ws.getRow(top + 1).height = 30;
  ws.views = [{ state: 'frozen', ySplit: top + 1 }];
  const help = wb.addWorksheet("Yo'riqnoma");
  help.getColumn(1).width = 120;
  [spec.title, '', ...(spec.help ?? [])].forEach((t, k) => {
    help.getCell(k + 1, 1).value = t;
    if (k === 0) help.getCell(1, 1).font = { bold: true, size: 12 };
  });
  return wb;
}
