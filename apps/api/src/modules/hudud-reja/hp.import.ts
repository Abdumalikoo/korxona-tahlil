import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { cellRaw, excelDate } from '../regional-data/rd.util';
import { KIND_ORDER, KINDS, MAX_ROWS, PERIOD_RE, SAMPLE_MARK, SERVICE_CODE, type Col, type ImportKind, type KindDef } from './hp.const';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';

// ═══════════════════════════════════════════════════════════
// Excel faylni o'qish va tekshirish (bazaga hech narsa yozilmaydi).
//   • Varaq turi 1-qatordagi ustun nomlaridan aniqlanadi (varaq nomi ham hisobga olinadi).
//   • Har bir katak turi bo'yicha tekshiriladi; xato va ogohlantirishlar qator raqami bilan.
//   • NAMUNA qatorlari o'tkazib yuboriladi; bo'sh qatorlar e'tiborsiz.
//   • Bir xil kalitli qatorlar — ikkalasi ham xato (qaysi biri to'g'ri ekanini foydalanuvchi hal qiladi).
//   • Formulalar bajarilmaydi — faqat faylda saqlangan qiymat olinadi; makrosli fayl qabul qilinmaydi.
// ═══════════════════════════════════════════════════════════

export type Level = 'error' | 'warning' | 'info';

export interface Issue {
  row: number | null;
  col?: string;
  level: Level;
  message: string;
}

export interface ParsedRow {
  row: number;
  key: string;
  values: Record<string, unknown>;
}

export interface Refs {
  regions: Map<number, { name: string; isActive: boolean }>;
  services: Map<string, { label: string; isActive: boolean }>;
  employees: Map<string, { fullName: string; regionCode: number; isActive: boolean }>;
  /** Katalogdagi tarif (so'm) oy bo'yicha — daromad ≈ soni × tarif tekshiruvi uchun */
  tariffAt: (service: string, region: number, period: string) => number | null;
  currentPeriod: string;
}

export interface SheetResult {
  kind: ImportKind;
  sheet: string;
  rows: ParsedRow[];
  issues: Issue[];
  /** Ma'lumotli qatorlar (namuna va bo'sh qatorsiz) */
  dataRows: number;
  samples: number;
  /** Xatoli qatorlar raqamlari */
  errorRows: number[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\*/g, '')
    .replace(/[ʻʼ‘’`']/g, '')
    .trim()
    .replace(/[\s-]+/g, '_');

function detectKind(header: string[], sheetName: string, wanted: ImportKind | 'ALL'): ImportKind | null {
  const keys = new Set(header.map(norm).filter(Boolean));
  const ref = ["yo'riqnoma", 'yoriqnoma', 'hududlar', 'xizmat_royxati', 'xodimlar'];
  if (ref.includes(norm(sheetName))) return null;
  let best: { kind: ImportKind; score: number } | null = null;
  for (const k of KIND_ORDER) {
    const def = KINDS[k];
    const match = (c: Col) => keys.has(c.key) || keys.has(norm(c.label));
    const req = def.cols.filter((c) => c.required);
    const hit = req.filter(match).length;
    const all = def.cols.filter(match).length;
    const unknown = [...keys].filter((h) => !def.cols.some((c) => c.key === h || norm(c.label) === h)).length;
    // Varaq nomi mos — eng kuchli belgi; so'ng majburiy ustunlar to'liqligi; ko'p mos va kam begona ustun
    const score = (norm(sheetName) === norm(def.sheet) ? 1e6 : 0) + (hit === req.length ? 1000 : 0) + all * 10 - unknown;
    if (all >= 2 && (!best || score > best.score)) best = { kind: k, score };
  }
  // Bitta tur so'ralgan bo'lsa va varaqda shu turning kamida 2 ustuni bo'lsa — shu tur deb tekshiramiz
  if (wanted !== 'ALL' && best?.kind !== wanted) {
    const def = KINDS[wanted];
    const all = def.cols.filter((c) => keys.has(c.key) || keys.has(norm(c.label))).length;
    if (all >= 2 && (best?.score ?? 0) < 1e6) return wanted;
  }
  return best ? best.kind : null;
}

function text(v: unknown): string {
  const r = cellRaw(v);
  if (r === null || r === undefined) return '';
  if (r instanceof Date) return r.toISOString().slice(0, 10);
  return String(r).trim();
}

function num(v: unknown): number | null | undefined {
  const r = cellRaw(v);
  if (r === null || r === undefined || String(r).trim() === '') return null;
  const n = typeof r === 'number' ? r : Number(String(r).replace(/[\s ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function month(v: unknown): string | null | undefined {
  const r = cellRaw(v);
  if (r === null || r === undefined || String(r).trim() === '') return null;
  if (r instanceof Date) return new Date(r.getTime() + 5 * 3600_000).toISOString().slice(0, 7);
  const s = String(r).trim();
  if (PERIOD_RE.test(s)) return s;
  let m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}`;
  m = /^(\d{1,2})[./](\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1]!.padStart(2, '0')}`;
  m = /^\d{1,2}\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1]!.padStart(2, '0')}`;
  if (typeof r === 'number' && r > 20000 && r < 80000) return new Date(Math.round((r - 25569) * 86_400_000)).toISOString().slice(0, 7);
  return undefined;
}

function bool(v: unknown): boolean | null | undefined {
  const s = text(v).toLowerCase();
  if (!s) return null;
  if (['ha', 'xa', 'bor', '1', 'true', 'faol', 'yes'].includes(s)) return true;
  if (["yo'q", 'yoq', 'yo‘q', 'yo`q', '0', 'false', 'nofaol', 'no'].includes(s)) return false;
  return undefined;
}

const fmtSom = (n: number) => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ');

function parseCell(col: Col, raw: unknown, def: KindDef, refs: Refs, issues: Issue[], row: number): unknown {
  const err = (message: string) => issues.push({ row, col: col.key, level: 'error', message: `${col.label}: ${message}` });
  const warn = (message: string) => issues.push({ row, col: col.key, level: 'warning', message: `${col.label}: ${message}` });
  const empty = text(raw) === '';
  if (empty) {
    if (col.required) err("majburiy, lekin bo'sh");
    return null;
  }
  switch (col.type) {
    case 'month': {
      const m = month(raw);
      if (!m) return err(`«${text(raw)}» — oy YYYY-MM ko'rinishida bo'lishi kerak`), null;
      if (m < '2015-01') return err(`${m} — imkonsiz sana`), null;
      return m;
    }
    case 'region': {
      const n = num(raw);
      if (n === null || n === undefined || !Number.isInteger(n)) return err(`«${text(raw)}» — hudud kodi butun son bo'lishi kerak`), null;
      const r = refs.regions.get(n);
      if (!r) return err(`${n} — bunday hudud yo'q`), null;
      if (n === 0) return err('0 — Markaz; bu yerda faqat hududlar'), null;
      return n;
    }
    case 'service': {
      const code = text(raw).toUpperCase().replace(/\s+/g, '');
      if (!SERVICE_CODE.test(code)) return err(`«${text(raw)}» — xizmat kodi SRV_01 ko'rinishida bo'lishi kerak`), null;
      if (!refs.services.has(code) && def.kind !== 'SERVICES') return err(`${code} — katalogda bunday xizmat yo'q`), null;
      return code;
    }
    case 'employee': {
      const r = cellRaw(raw);
      const code = (typeof r === 'number' ? r.toFixed(0) : text(raw)).replace(/\s+/g, '');
      if (!/^\d{14}$/.test(code)) return err(`«${text(raw)}» — PINFL 14 ta raqam bo'lishi kerak`), null;
      if (!refs.employees.has(code)) return err(`${code} — Xodimlar bo'limida bunday xodim yo'q`), null;
      return code;
    }
    case 'int':
    case 'num': {
      const n = num(raw);
      if (n === undefined || n === null) return err(`«${text(raw)}» — son emas`), null;
      if (n < 0) return err(`${n} — manfiy bo'lishi mumkin emas`), null;
      if (col.type === 'int' && !Number.isInteger(n)) return err(`${n} — butun son bo'lishi kerak`), null;
      if (col.key === 'xizmat_soni' && !Number.isInteger(n)) warn(`${n} — kasr son (xizmatlar soni odatda butun)`);
      if ((col.key === 'ishlangan_kun' || col.key === 'ish_kunlari' || col.key === 'ta_til_kun') && n > 31) return err(`${n} — oyda 31 kundan ko'p bo'lmaydi`), null;
      return n;
    }
    case 'money': {
      const n = num(raw);
      if (n === undefined || n === null) return err(`«${text(raw)}» — summa son bo'lishi kerak`), null;
      if (n < 0) return err(`${fmtSom(n)} — manfiy bo'lishi mumkin emas`), null;
      if (n > 9e13) return err(`${fmtSom(n)} — juda katta summa`), null;
      return Math.round(n * 100); // tiyin
    }
    case 'bool': {
      const b = bool(raw);
      if (b === undefined) return err(`«${text(raw)}» — «ha» yoki «yo'q»`), null;
      return b;
    }
    case 'date': {
      const d = excelDate(raw);
      if (!d) return err(`«${text(raw)}» — sana YYYY-MM-DD ko'rinishida bo'lishi kerak`), null;
      if (d < '2000-01-01' || d > '2100-01-01') return err(`${d} — imkonsiz sana`), null;
      return d;
    }
    case 'text': {
      const s = text(raw);
      return s.length > 500 ? s.slice(0, 500) : s;
    }
  }
}

function checkSheet(ws: ExcelJS.Worksheet, kind: ImportKind, refs: Refs): SheetResult {
  const def = KINDS[kind];
  const issues: Issue[] = [];
  const header: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (header[i - 1] = norm(text(c.value))));
  const colIndex = new Map<string, number>();
  for (const c of def.cols) {
    const i = header.findIndex((h) => h === c.key || h === norm(c.label));
    if (i >= 0) colIndex.set(c.key, i + 1);
  }
  const missing = def.cols.filter((c) => c.required && !colIndex.has(c.key));
  if (missing.length) {
    issues.push({ row: 1, level: 'error', message: `Majburiy ustun yo'q: ${missing.map((c) => `${c.key} (${c.label})`).join(', ')}` });
    return { kind, sheet: ws.name, rows: [], issues, dataRows: 0, samples: 0, errorRows: [] };
  }
  const unknown = header.filter((h) => h && !def.cols.some((c) => c.key === h || norm(c.label) === h));
  if (unknown.length) issues.push({ row: 1, level: 'info', message: `Tanilmagan ustunlar e'tiborsiz qoldirildi: ${unknown.join(', ')}` });

  const rows: ParsedRow[] = [];
  let samples = 0;
  let dataRows = 0;
  const errorRows = new Set<number>();
  const last = ws.actualRowCount ? ws.rowCount : 0;
  if (last - 1 > MAX_ROWS) throw new BadRequestException(`«${ws.name}» varag'ida ${last - 1} qator — ko'pi bilan ${MAX_ROWS}. Faylni bo'lib yuklang`);

  for (let r = 2; r <= last; r++) {
    const row = ws.getRow(r);
    const cells = def.cols.map((c) => (colIndex.has(c.key) ? row.getCell(colIndex.get(c.key)!).value : null));
    const texts = cells.map((v) => text(v));
    if (texts.every((t) => t === '')) continue;
    if (texts.some((t) => t.toUpperCase().includes(SAMPLE_MARK))) {
      samples += 1;
      continue;
    }
    dataRows += 1;
    const before = issues.length;
    const values: Record<string, unknown> = {};
    def.cols.forEach((c, i) => (values[c.key] = colIndex.has(c.key) ? parseCell(c, cells[i], def, refs, issues, r) : null));
    const bad = issues.slice(before).some((x) => x.level === 'error');
    if (!bad) rowChecks(def, values, refs, issues, r);
    if (issues.slice(before).some((x) => x.level === 'error')) {
      errorRows.add(r);
      continue;
    }
    rows.push({ row: r, key: def.key.map((k) => String(values[k] ?? '')).join('|'), values });
  }

  // Takroriy kalitlar — ikkalasi ham xato
  const byKey = new Map<string, ParsedRow[]>();
  for (const p of rows) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);
  const dupRows = new Set<number>();
  for (const [key, list] of byKey) {
    if (list.length < 2) continue;
    for (const p of list) {
      dupRows.add(p.row);
      errorRows.add(p.row);
      issues.push({ row: p.row, level: 'error', message: `Takroriy qator: ${def.key.join(' + ')} = ${key.replace(/\|/g, ' / ')} — ${list.map((x) => x.row).filter((x) => x !== p.row).join(', ')}-qatorda ham bor` });
    }
  }
  const kept = rows.filter((p) => !dupRows.has(p.row));
  fileChecks(def, kept, refs, issues);
  return { kind, sheet: ws.name, rows: kept, issues, dataRows, samples, errorRows: [...errorRows].sort((a, b) => a - b) };
}

function rowChecks(def: KindDef, v: Record<string, unknown>, refs: Refs, issues: Issue[], row: number): void {
  const p = v.oy as string | undefined;
  const future = refs.currentPeriod;
  if (p) {
    const allowNext = def.kind === 'EMP_MONTHS' || def.kind === 'FACTORS';
    const limit = allowNext ? nextPeriod(future) : future;
    if (p > limit) issues.push({ row, col: 'oy', level: 'error', message: `Oy: ${p} — kelajak oyi (${allowNext ? 'kelasi oydan keyin' : 'hali tugamagan'}) ` });
    else if (!allowNext && p === future) issues.push({ row, col: 'oy', level: 'warning', message: `${p} — joriy oy hali tugamagan: ma'lumot to'liq bo'lmasligi mumkin` });
    else if (allowNext && p > lastClosed(future)) issues.push({ row, col: 'oy', level: 'info', message: `${p} — tugamagan oy: ishlangan kun rejalashtirilgan deb olinadi` });
  }
  if (def.kind === 'STATS' || def.kind === 'EMP_SERVICES') {
    const qty = v.xizmat_soni as number;
    const rev = v.daromad_sum as number; // tiyin
    const own = v.tarif as number | null;
    const cat = refs.tariffAt(v.xizmat_id as string, v.hudud_id as number, p!);
    const price = own !== null && own !== undefined ? own / 100 : cat;
    if (qty === 0 && rev > 0) issues.push({ row, level: 'warning', message: `Xizmatlar soni 0, lekin daromad ${fmtSom(rev / 100)} so'm` });
    if (qty > 0 && rev === 0) issues.push({ row, level: 'warning', message: `${qty} ta xizmat, lekin daromad 0` });
    if (price && qty > 0 && rev > 0) {
      const formula = qty * price;
      const diff = rev / 100 - formula;
      if (Math.abs(diff) > Math.max(1000, formula * 0.01))
        issues.push({ row, level: 'warning', message: `Daromad soni × tarifdan farq qiladi: ${fmtSom(rev / 100)} ≠ ${qty} × ${fmtSom(price)} = ${fmtSom(formula)} (farq ${diff > 0 ? '+' : ''}${fmtSom(diff)})` });
    }
    if (own && cat && Math.abs(own / 100 - cat) > 0.5) issues.push({ row, col: 'tarif', level: 'info', message: `Tarif ${fmtSom(own / 100)} — katalogdagidan (${fmtSom(cat)}) farq qiladi` });
  }
  if (def.kind === 'EMP_MONTHS' || def.kind === 'EMP_SERVICES') {
    const e = refs.employees.get(v.xodim_id as string);
    if (e && e.regionCode !== v.hudud_id) issues.push({ row, level: 'info', message: `Xodim hozir boshqa hududda (${refs.regions.get(e.regionCode)?.name ?? e.regionCode}) — tarixiy yozuv ko'rsatilgan hududda qoladi` });
  }
  if (def.kind === 'SERVICES') {
    const s = refs.services.get(v.xizmat_id as string);
    if (s && norm(s.label) !== norm(String(v.xizmat_nomi ?? ''))) issues.push({ row, col: 'xizmat_nomi', level: 'warning', message: `Nomi katalogdagidan farq qiladi («${s.label}») — nom o'zgartirilmaydi` });
    if (!s) issues.push({ row, level: 'info', message: `${v.xizmat_id} — yangi xizmat, katalogga qo'shiladi` });
    if ((v.amaldagi_tarif as number) <= 0) issues.push({ row, col: 'amaldagi_tarif', level: 'error', message: "Tarif 0 dan katta bo'lishi kerak" });
    if (v.amal_tugash_sanasi && v.amal_boshlanish_sanasi && (v.amal_tugash_sanasi as string) < (v.amal_boshlanish_sanasi as string))
      issues.push({ row, level: 'error', message: 'Amal tugashi boshlanishidan oldin' });
  }
}

function nextPeriod(p: string): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
function lastClosed(p: string): string {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Fayl bo'yicha: yetishmayotgan oylar (nol deb olinmaydi) */
function fileChecks(def: KindDef, rows: ParsedRow[], refs: Refs, issues: Issue[]): void {
  if (def.kind !== 'STATS' && def.kind !== 'EMP_SERVICES' && def.kind !== 'EMP_MONTHS') return;
  const groupKey = def.kind === 'STATS' ? ['hudud_id', 'xizmat_id'] : ['xodim_id'];
  const months = new Map<string, Set<string>>();
  for (const r of rows) {
    const k = groupKey.map((g) => String(r.values[g])).join('|');
    if (!months.has(k)) months.set(k, new Set());
    months.get(k)!.add(String(r.values.oy));
  }
  let reported = 0;
  for (const [k, set] of months) {
    const list = [...set].sort();
    const gaps: string[] = [];
    let cur = list[0]!;
    while (cur < list[list.length - 1]!) {
      cur = nextPeriod(cur);
      if (!set.has(cur)) gaps.push(cur);
    }
    if (!gaps.length) continue;
    if (reported++ < 200) {
      const [a, b] = k.split('|');
      const label =
        def.kind === 'STATS'
          ? `${refs.regions.get(Number(a))?.name ?? a} · ${b} (${refs.services.get(b!)?.label ?? ''})`
          : `${refs.employees.get(a!)?.fullName ?? a}`;
      issues.push({ row: null, level: 'warning', message: `${label}: ${gaps.join(', ')} oy(lar)i yo'q — nol deb olinmaydi, prognozda «ma'lumot yo'q» bo'ladi` });
    }
  }
  if (reported > 200) issues.push({ row: null, level: 'warning', message: `Yana ${reported - 200} ta qatorda oylar uzilgan` });
}

export interface CheckedFile {
  fileHash: string;
  sheets: SheetResult[];
  ignored: string[];
}

export async function readWorkbook(buffer: Buffer, fileName: string, wanted: ImportKind | 'ALL', refs: Refs): Promise<CheckedFile> {
  if (!/\.(xlsx|xltx)$/i.test(fileName)) throw new BadRequestException("Faqat .xlsx yoki .xltx fayl qabul qilinadi (makrosli .xlsm va eski .xls emas)");
  if (buffer.length < 100 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new BadRequestException('Fayl Excel (.xlsx) formatida emas');
  if (buffer.includes(Buffer.from('vbaProject.bin'))) throw new BadRequestException('Faylda makros bor — qabul qilinmaydi. Makrossiz .xlsx sifatida saqlang');
  const wb = new ExcelJS.Workbook();
  await assertSafeXlsx(buffer);
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException("Faylni o'qib bo'lmadi — u buzilgan yoki Excel fayli emas");
  }
  const sheets: SheetResult[] = [];
  const ignored: string[] = [];
  const seen = new Set<ImportKind>();
  for (const ws of wb.worksheets) {
    const header: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => (header[i - 1] = text(c.value)));
    const kind = detectKind(header, ws.name, wanted);
    if (!kind || (wanted !== 'ALL' && kind !== wanted) || seen.has(kind)) {
      if (!["yo'riqnoma", 'hududlar', 'xizmat_royxati', 'xodimlar'].includes(norm(ws.name))) ignored.push(ws.name);
      continue;
    }
    const res = checkSheet(ws, kind, refs);
    if (res.dataRows === 0 && res.samples > 0 && wanted === 'ALL') continue; // faqat namunali varaq — tashlab ketamiz
    if (res.dataRows === 0 && wanted === 'ALL' && kind === 'SERVICES') continue;
    seen.add(kind);
    sheets.push(res);
  }
  if (sheets.length && sheets.every((x) => x.dataRows === 0 && !x.issues.some((i) => i.level === 'error'))) {
    const samples = sheets.reduce((a, x) => a + x.samples, 0);
    throw new BadRequestException(samples ? `Faylda faqat NAMUNA qatorlari bor (${samples} ta) — ma'lumot yo'q. Namunalar import qilinmaydi` : "Faylda ma'lumot yo'q");
  }
  if (!sheets.length) {
    const exp = wanted === 'ALL' ? 'shablon varaqlaridan birortasi' : `«${KINDS[wanted].sheet}» varag'i (ustunlari: ${KINDS[wanted].cols.filter((c) => c.required).map((c) => c.key).join(', ')})`;
    throw new BadRequestException(`Faylda ${exp} topilmadi yoki ma'lumot yo'q`);
  }
  return { fileHash: createHash('sha256').update(buffer).digest('hex'), sheets, ignored };
}