import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { ENTRY_UNIT_CODES, entryUnitLabel, isSegment } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { UnitPayrollService } from '../unit-payroll/unit-payroll.service';
import { HR_GROUP_LABELS, HR_SHEET, HR_SHEETS, type HrColumn, type HrGroup, type HrSheetCode, type HrSheetDef } from './hr-sheets.config';
import { clearHrCache, hrPeople, loadSnapshot, nameIndex, normName, prevKey, rowObject, sheetKey, unitOfPlace, type HrSnapshot } from './hr-sheets.store';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';

// ═══════════════════════════════════════════════════════════
// Xodimlar › Ma'lumotnomalar (10, 16, 37, 51-jadval) va «Miya» — PINFL bo'yicha xodimning hamma ma'lumoti.
//
//  • Shablon — asl jadval shaklida (sarlavha, ustunlar tartibi). To'ldirilgan fayl yuklanadi → tahlil
//    (topilgan ustunlar, xato qatorlar, takrorlar, avvalgisiga nisbatan yangi / chiqib ketgan / o'zgargan,
//    bo'limlar bo'yicha) → «Saqlash». Har yuklash jadvalning yangi to'liq holati; oldingisi bitta saqlanadi
//    («Oldingi holatga qaytarish»).
//  • Saqlangan ma'lumot «miya»ni oziqlaydi: bo'lim ish haqi shablonlarida xodimlar ro'yxati (tuzilma nomi bo'yicha),
//    vedomostdagi PINFL'lar nomi va lavozimi, xodim kartasi.
//  • Shaxsiy ma'lumotlar (pasport, telefon, manzil …) ro'yxatda yashiriladi, faqat xodim kartasida;
//    hamma amallar — faqat administrator. Audit jurnaliga faqat sonlar yoziladi.
// ═══════════════════════════════════════════════════════════

const HEADER_SCAN_ROWS = 30;
const MAX_ROWS = 20_000;
const PENDING_TTL_MS = 30 * 60_000;
const TASHKENT_OFFSET_HOURS = 5;
const PREVIEW_ROWS = 25;

interface Pending {
  token: string;
  code: HrSheetCode;
  fileName: string;
  cols: string[];
  rows: (string | null)[][];
  userId: string;
  at: number;
}

const normHeader = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[ʻʼ‘’'`´"«»]/g, '')
    .replace(/[^a-zа-яёқғўҳ0-9]/gi, '');

const pad = (n: number) => String(n).padStart(2, '0');
const fmtDate = (d: Date) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;

function rawValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const r = value as unknown as Record<string, unknown>;
    if ('result' in r) return r.result;
    if ('text' in r) return r.text;
    if ('richText' in r && Array.isArray(r.richText)) return (r.richText as { text: string }[]).map((p) => p.text).join('');
    if ('formula' in r) return null;
    if ('error' in r) return null;
  }
  return value;
}

/** Katak → matn (ustun turiga qarab) */
function cellText(value: ExcelJS.CellValue, col: HrColumn): string | null {
  const v = rawValue(value);
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : fmtDate(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    if (col.kind === 'date' && v > 20000 && v < 80000) return fmtDate(new Date(Math.round((v - 25569) * 86_400_000)));
    if (col.kind === 'pinfl' || col.kind === 'int' || Number.isInteger(v)) return String(Math.round(v));
    return String(v);
  }
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (col.kind === 'pinfl') return s.replace(/\D/g, '') || s;
  return s.slice(0, 1000);
}

function mask(v: string | null): string | null {
  if (!v) return v;
  if (v.length <= 3) return '•••';
  return `${'•'.repeat(Math.min(6, v.length - 3))}${v.slice(-3)}`;
}

@Injectable()
export class HrSheetsService {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly unitPayroll: UnitPayrollService,
  ) {}

  sheetOf(raw: unknown): HrSheetDef {
    const d = typeof raw === 'string' ? HR_SHEET(raw.toUpperCase()) : undefined;
    if (!d) throw new BadRequestException("Jadval noto'g'ri (J10, J16, J37, J51)");
    return d;
  }

  private colsMeta(def: HrSheetDef) {
    return def.columns.map((c) => ({ key: c.key, header: c.header.replace(/\s*\n\s*/g, ' '), kind: c.kind ?? 'text', sensitive: Boolean(c.sensitive), group: c.group }));
  }

  // ═══════════ Ko'rinish ═══════════

  /** Hamma jadvallar holati va «miya» qamrovi */
  async overview() {
    const sheets = [];
    for (const def of HR_SHEETS) {
      const [s, prev] = await Promise.all([loadSnapshot(this.prisma, def.code), this.prisma.setting.findUnique({ where: { key: prevKey(def.code) }, select: { key: true } })]);
      sheets.push({
        code: def.code,
        no: def.no,
        label: def.label,
        hint: def.hint,
        byName: def.pinflKey === null,
        multi: def.multi,
        columns: this.colsMeta(def),
        current: s ? { fileName: s.fileName, uploadedAt: s.uploadedAt, uploadedBy: s.uploadedBy, count: s.rows.length } : null,
        hasPrev: Boolean(prev),
      });
    }
    const people = await hrPeople(this.prisma);
    const registry = new Set((await this.prisma.employee.findMany({ select: { pinfl: true } })).map((e) => e.pinfl));
    const units: Record<string, number> = {};
    let working = 0;
    let inRegistry = 0;
    for (const p of people.values()) {
      if (p.working) working += 1;
      if (registry.has(p.pinfl)) inRegistry += 1;
      if (p.unit && p.working) units[p.unit] = (units[p.unit] ?? 0) + 1;
    }
    return {
      sheets,
      people: { total: people.size, working, inRegistry, notInRegistry: people.size - inRegistry },
      units: Object.entries(units).map(([unit, count]) => ({ unit, label: entryUnitLabel(unit), count })).sort((a, b) => b.count - a.count),
    };
  }

  /** Jadval qatorlari (qidiruv, bo'lim bo'yicha, sahifalab). Shaxsiy ustunlar yashirilgan */
  async rows(code: string, query: { q?: string; unit?: string; page?: string; limit?: string }) {
    const def = this.sheetOf(code);
    const s = await loadSnapshot(this.prisma, def.code);
    const columns = this.colsMeta(def);
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(200, Math.max(10, Number(query.limit) || 50));
    if (!s) return { code: def.code, columns, total: 0, page, limit, rows: [], current: null };
    const people = await hrPeople(this.prisma);
    const byName = def.pinflKey ? null : nameIndex(people);
    const registry = new Set((await this.prisma.employee.findMany({ select: { pinfl: true } })).map((e) => e.pinfl));
    const q = (query.q ?? '').trim();
    const qn = normName(q);
    const qd = q.replace(/\D/g, '');
    const sens = new Set(def.columns.filter((c) => c.sensitive).map((c) => c.key));

    const all = s.rows.map((row, i) => {
      const o = rowObject(s, row);
      let pinfl = def.pinflKey ? o[def.pinflKey] : null;
      if (!pinfl && byName) {
        const pins = byName.get(normName(o[def.nameKey]));
        pinfl = pins && pins.length === 1 ? pins[0]! : null;
      }
      const unit = pinfl ? (people.get(pinfl)?.unit ?? null) : unitOfPlace(...def.placeKeys.map((k) => o[k]));
      return { i, o, pinfl, unit };
    });
    const filtered = all.filter((r) => {
      if (query.unit && (query.unit === 'NONE' ? r.unit !== null : r.unit !== query.unit)) return false;
      if (!q) return true;
      if (qd.length >= 4 && r.pinfl?.includes(qd)) return true;
      if (qn && normName(r.o[def.nameKey]).includes(qn)) return true;
      return qn.length >= 3 && def.columns.some((c) => !sens.has(c.key) && normName(r.o[c.key]).includes(qn));
    });
    const slice = filtered.slice((page - 1) * limit, page * limit);
    return {
      code: def.code,
      columns,
      total: filtered.length,
      page,
      limit,
      current: { fileName: s.fileName, uploadedAt: s.uploadedAt, uploadedBy: s.uploadedBy, count: s.rows.length },
      rows: slice.map((r) => ({
        n: r.i + 1,
        pinfl: r.pinfl,
        unit: r.unit,
        unitLabel: r.unit ? entryUnitLabel(r.unit) : null,
        inRegistry: r.pinfl ? registry.has(r.pinfl) : false,
        cells: Object.fromEntries(def.columns.map((c) => [c.key, sens.has(c.key) ? mask(r.o[c.key] ?? null) : (r.o[c.key] ?? null)])),
      })),
    };
  }

  // ═══════════ Shablon va eksport ═══════════

  private async book(def: HrSheetDef, data: (string | null)[][] | null): Promise<ExcelJS.Workbook> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const ws = wb.addWorksheet('Sheet1', { views: [{ state: 'frozen', ySplit: 9 }] });
    const n = def.columns.length;
    const thin = { style: 'thin' as const, color: { argb: 'FF000000' } };
    const border: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
    // 1-qator: jadval raqami (o'ngda)
    const mark = ws.getCell(1, n);
    mark.value = `${def.no}-jadval`;
    mark.font = { bold: true };
    mark.alignment = { horizontal: 'right' };
    // 7-qator: sarlavha
    ws.mergeCells(7, 1, 7, Math.max(2, n - 1));
    const t = ws.getCell(7, 1);
    t.value = def.title;
    t.font = { bold: true, size: 13 };
    t.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getRow(7).height = 36;
    // 9-qator: ustunlar
    def.columns.forEach((c, i) => {
      const cell = ws.getCell(9, i + 1);
      cell.value = c.header;
      cell.font = { bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = border;
      ws.getColumn(i + 1).width = c.width;
      if (c.kind === 'pinfl') ws.getColumn(i + 1).numFmt = '@';
    });
    ws.getRow(9).height = 42;
    if (data) {
      data.forEach((row, ri) => {
        const r = ws.getRow(10 + ri);
        def.columns.forEach((c, ci) => {
          const cell = r.getCell(ci + 1);
          const v = c.key === def.seqKey ? (row[ci] ?? String(ri + 1)) : row[ci];
          cell.value = v === null || v === undefined ? null : c.kind === 'int' && /^\d+$/.test(v) && v.length < 10 ? Number(v) : v;
          cell.border = border;
        });
      });
    } else {
      // Bo'sh shablon: 1-qatorda namuna o'rniga tartib raqami
      const r = ws.getRow(10);
      def.columns.forEach((c, ci) => {
        r.getCell(ci + 1).border = border;
        if (c.key === def.seqKey) r.getCell(ci + 1).value = 1;
      });
    }
    // Ko'rsatma varag'i
    const help = wb.addWorksheet("Ko'rsatma");
    help.getColumn(1).width = 110;
    [
      `${def.label} — to'ldirish tartibi`,
      '',
      "• Ma'lumot 10-qatordan boshlab yoziladi; 9-qatordagi ustun nomlarini o'zgartirmang (tartibi o'zgarsa ham o'qiladi).",
      def.pinflKey
        ? `• «${def.columns.find((c) => c.key === def.pinflKey)!.header}» — 14 raqamli JShShIR (PINFL). Xodim shu raqam bo'yicha tanib olinadi.`
        : "• Bu jadvalda JShShIR yo'q — xodim F.I.Sh. bo'yicha (10/16-jadvaldagi bilan bir xil yozilsa) tanib olinadi.",
      def.multi ? "• Bir xodimga bir necha qator yozish mumkin (har qabul / o'tkazish alohida)." : '• Bir xodim — bitta qator. Takror qator saqlanmaydi.',
      "• Sanalar: KK.OO.YYYY (masalan, 01.07.2026) yoki Excel sanasi.",
      "• Yuklanganda jadvalning yangi to'liq holati saqlanadi: faylda yo'q xodimlar shu jadvaldan chiqadi (oldingi holatga qaytarish mumkin).",
    ].forEach((line, i) => {
      help.getCell(i + 1, 1).value = line;
      if (i === 0) help.getCell(1, 1).font = { bold: true, size: 12 };
    });
    return wb;
  }

  async template(code: string): Promise<{ buffer: Buffer; filename: string }> {
    const def = this.sheetOf(code);
    const wb = await this.book(def, null);
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `${def.no}-jadval-shablon.xlsx` };
  }

  /** Saqlangan holat — asl shaklda, to'liq (shaxsiy ustunlar bilan; faqat administrator) */
  async export(code: string, userId: string): Promise<{ buffer: Buffer; filename: string }> {
    const def = this.sheetOf(code);
    const s = await loadSnapshot(this.prisma, def.code);
    if (!s) throw new NotFoundException("Bu jadval hali yuklanmagan");
    const idx = def.columns.map((c) => s.cols.indexOf(c.key));
    const data = s.rows.map((row) => idx.map((i) => (i >= 0 ? (row[i] ?? null) : null)));
    const wb = await this.book(def, data);
    await this.audit.log({ userId, action: 'EXPORT', entity: 'hr_sheet', entityId: def.code, summary: `${def.label}: ${s.rows.length} qator yuklab olindi` });
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), filename: `${def.no}-jadval.xlsx` };
  }

  // ═══════════ Yuklash: tahlil → saqlash ═══════════

  async analyze(code: string, file: Express.Multer.File | undefined, userId: string) {
    const def = this.sheetOf(code);
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    const wb = new ExcelJS.Workbook();
    await assertSafeXlsx(file.buffer);
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatidagi Excel fayl yuklang");
    }

    // Sarlavha qatori: ustun nomlari eng ko'p mos kelgan qator (F.I.Sh. ustuni bo'lishi shart)
    const want = def.columns.map((c) => ({ c, names: new Set([c.header, ...(c.aliases ?? [])].map(normHeader)) }));
    let best: { ws: ExcelJS.Worksheet; row: number; map: Map<string, number>; score: number } | null = null;
    for (const ws of wb.worksheets) {
      for (let r = 1; r <= Math.min(ws.rowCount, HEADER_SCAN_ROWS); r++) {
        const map = new Map<string, number>();
        ws.getRow(r).eachCell((cell, col) => {
          const h = normHeader(rawValue(cell.value));
          if (!h) return;
          const hit = want.find((w) => !map.has(w.c.key) && w.names.has(h));
          if (hit) map.set(hit.c.key, col);
        });
        if (map.has(def.nameKey) && (!best || map.size > best.score)) best = { ws, row: r, map, score: map.size };
      }
    }
    const minCols = Math.min(3, def.columns.length);
    if (!best || best.score < minCols) {
      throw new BadRequestException(`Sarlavha qatori topilmadi — bu ${def.no}-jadval shakliga o'xshamaydi. Shablonni yuklab oling yoki ustun nomlarini tekshiring`);
    }
    if (def.pinflKey && !best.map.has(def.pinflKey)) {
      throw new BadRequestException(`«${def.columns.find((c) => c.key === def.pinflKey)!.header}» (JShShIR) ustuni topilmadi`);
    }
    const { ws, row: headerRow, map } = best;

    const cols = def.columns.filter((c) => c.key !== def.seqKey).map((c) => c.key);
    const colDef = new Map(def.columns.map((c) => [c.key, c]));
    const rows: (string | null)[][] = [];
    const invalid: { row: number; reason: string }[] = [];
    const duplicates: { row: number; firstRow: number; name: string }[] = [];
    const seen = new Map<string, number>();
    let blank = 0;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const xr = ws.getRow(r);
      const vals = cols.map((k) => (map.has(k) ? cellText(xr.getCell(map.get(k)!).value, colDef.get(k)!) : null));
      if (vals.every((v) => v === null)) {
        blank += 1;
        continue;
      }
      const o = Object.fromEntries(cols.map((k, i) => [k, vals[i]]));
      const name = o[def.nameKey];
      if (!name) {
        invalid.push({ row: r, reason: "F.I.Sh. bo'sh" });
        continue;
      }
      if (def.pinflKey) {
        const p = o[def.pinflKey];
        if (!p || !/^\d{14}$/.test(p)) {
          invalid.push({ row: r, reason: `JShShIR noto'g'ri: «${p ? `${p.slice(0, 4)}…` : "bo'sh"}» (14 raqam bo'lishi kerak)` });
          continue;
        }
      }
      if (!def.multi) {
        const key = def.pinflKey ? o[def.pinflKey]! : normName(name);
        if (seen.has(key)) {
          duplicates.push({ row: r, firstRow: seen.get(key)!, name });
          continue;
        }
        seen.set(key, r);
      }
      rows.push(vals);
      if (rows.length > MAX_ROWS) throw new BadRequestException(`Ko'pi bilan ${MAX_ROWS} qator`);
    }
    if (!rows.length) throw new BadRequestException("Faylda saqlanadigan qator yo'q");

    // Avvalgisiga nisbatan
    const cur = await loadSnapshot(this.prisma, def.code);
    const keyOf = (o: Record<string, string | null>) => (def.pinflKey ? o[def.pinflKey]! : normName(o[def.nameKey]));
    const sig = (o: Record<string, string | null>) => cols.map((k) => o[k] ?? '').join('\u0001');
    const newObjs = rows.map((r) => Object.fromEntries(cols.map((k, i) => [k, r[i] ?? null])) as Record<string, string | null>);
    let diff: { added: number; removed: number; changed: number; same: number } | null = null;
    if (cur) {
      const oldObjs = cur.rows.map((r) => rowObject(cur, r));
      if (def.multi) {
        const oldSigs = new Map<string, number>();
        for (const o of oldObjs) oldSigs.set(sig(o), (oldSigs.get(sig(o)) ?? 0) + 1);
        let same = 0;
        for (const o of newObjs) {
          const k = sig(o);
          if (oldSigs.get(k)) {
            same += 1;
            oldSigs.set(k, oldSigs.get(k)! - 1);
          }
        }
        diff = { added: newObjs.length - same, removed: oldObjs.length - same, changed: 0, same };
      } else {
        const old = new Map(oldObjs.map((o) => [keyOf(o), sig(o)]));
        let added = 0;
        let changed = 0;
        let same = 0;
        const now = new Set<string>();
        for (const o of newObjs) {
          const k = keyOf(o);
          now.add(k);
          if (!old.has(k)) added += 1;
          else if (old.get(k) !== sig(o)) changed += 1;
          else same += 1;
        }
        diff = { added, removed: [...old.keys()].filter((k) => !now.has(k)).length, changed, same };
      }
    }

    // Bog'lanish: Xodimlar bazasi, boshqa jadvallar, bo'limlar («miya»)
    const people = await hrPeople(this.prisma);
    const pins = new Set<string>();
    let unmatchedNames = 0;
    let ambiguousNames = 0;
    if (def.pinflKey) for (const o of newObjs) pins.add(o[def.pinflKey]!);
    else {
      const idx = nameIndex(people);
      const reg = await this.prisma.employee.findMany({ select: { pinfl: true, fullName: true } });
      for (const e of reg) {
        const n = normName(e.fullName);
        const list = idx.get(n) ?? [];
        if (!list.includes(e.pinfl)) idx.set(n, [...list, e.pinfl]);
      }
      for (const o of newObjs) {
        const hit = idx.get(normName(o[def.nameKey]));
        if (!hit) unmatchedNames += 1;
        else if (hit.length > 1) ambiguousNames += 1;
        else pins.add(hit[0]!);
      }
    }
    const registry = new Set((await this.prisma.employee.findMany({ where: { pinfl: { in: [...pins] } }, select: { pinfl: true } })).map((e) => e.pinfl));
    const units: Record<string, number> = {};
    for (const o of newObjs) {
      const u = unitOfPlace(...def.placeKeys.map((k) => o[k]), def.positionKey ? o[def.positionKey] : null);
      if (u) units[u] = (units[u] ?? 0) + 1;
    }

    // Kutilayotgan saqlash
    this.sweep();
    const token = randomUUID();
    this.pending.set(token, { token, code: def.code, fileName: String(file.originalname ?? `${def.no}-jadval.xlsx`).slice(0, 200), cols, rows, userId, at: Date.now() });

    const sens = new Set(def.columns.filter((c) => c.sensitive).map((c) => c.key));
    return {
      token,
      code: def.code,
      label: def.label,
      fileName: String(file.originalname ?? '').slice(0, 200),
      sheetName: ws.name,
      headerRow,
      total: rows.length,
      blankRows: blank,
      columns: def.columns
        .filter((c) => c.key !== def.seqKey)
        .map((c) => ({ key: c.key, header: c.header.replace(/\s*\n\s*/g, ' '), found: map.has(c.key) })),
      invalid: invalid.slice(0, 200),
      invalidCount: invalid.length,
      duplicates: duplicates.slice(0, 100),
      duplicateCount: duplicates.length,
      diff,
      current: cur ? { fileName: cur.fileName, uploadedAt: cur.uploadedAt, count: cur.rows.length } : null,
      people: {
        identified: pins.size,
        inRegistry: registry.size,
        notInRegistry: pins.size - registry.size,
        alsoInOtherSheets: [...pins].filter((p) => people.get(p)?.sources.some((s) => s !== def.code)).length,
        unmatchedNames,
        ambiguousNames,
      },
      units: Object.entries(units).map(([unit, count]) => ({ unit, label: entryUnitLabel(unit), count })).sort((a, b) => b.count - a.count),
      preview: newObjs.slice(0, PREVIEW_ROWS).map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, sens.has(k) ? mask(v) : v]))),
    };
  }

  private sweep() {
    const now = Date.now();
    for (const [k, p] of this.pending) if (now - p.at > PENDING_TTL_MS) this.pending.delete(k);
  }

  async commit(code: string, body: { token?: unknown }, userId: string) {
    const def = this.sheetOf(code);
    this.sweep();
    const p = typeof body?.token === 'string' ? this.pending.get(body.token) : undefined;
    if (!p || p.code !== def.code) throw new BadRequestException('Tahlil eskirgan — faylni qaytadan yuklang');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);
    const snap: HrSnapshot = {
      code: def.code,
      batchId: randomUUID(),
      fileName: p.fileName,
      uploadedAt: new Date().toISOString(),
      uploadedBy: user?.fullName ?? '',
      uploadedById: userId,
      cols: p.cols,
      rows: p.rows,
    };
    const cur = await this.prisma.setting.findUnique({ where: { key: sheetKey(def.code) } });
    await this.prisma.$transaction(async (tx) => {
      if (cur) await tx.setting.upsert({ where: { key: prevKey(def.code) }, create: { key: prevKey(def.code), value: cur.value as object }, update: { value: cur.value as object } });
      const value = snap as unknown as object;
      await tx.setting.upsert({ where: { key: sheetKey(def.code) }, create: { key: sheetKey(def.code), value }, update: { value } });
    });
    this.pending.delete(p.token);
    clearHrCache();
    await this.audit.log({ userId, action: 'IMPORT', entity: 'hr_sheet', entityId: def.code, summary: `${def.label}: ${snap.rows.length} qator saqlandi (${snap.fileName})`.slice(0, 500) });
    return { success: true as const, code: def.code, count: snap.rows.length, fileName: snap.fileName };
  }

  /** Oldingi holatga qaytarish (joriy va oldingi almashadi) */
  async restore(code: string, userId: string) {
    const def = this.sheetOf(code);
    const [cur, prev] = await Promise.all([
      this.prisma.setting.findUnique({ where: { key: sheetKey(def.code) } }),
      this.prisma.setting.findUnique({ where: { key: prevKey(def.code) } }),
    ]);
    if (!prev) throw new BadRequestException("Oldingi holat yo'q");
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { key: sheetKey(def.code) }, create: { key: sheetKey(def.code), value: prev.value as object }, update: { value: prev.value as object } });
      if (cur) await tx.setting.upsert({ where: { key: prevKey(def.code) }, create: { key: prevKey(def.code), value: cur.value as object }, update: { value: cur.value as object } });
      else await tx.setting.delete({ where: { key: prevKey(def.code) } });
    });
    clearHrCache();
    const s = await loadSnapshot(this.prisma, def.code);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'hr_sheet', entityId: def.code, summary: `${def.label}: oldingi holatga qaytarildi (${s?.rows.length ?? 0} qator)` });
    return { success: true as const, count: s?.rows.length ?? 0, fileName: s?.fileName ?? null };
  }

  /** Jadvalni tozalash (oldingi holat sifatida saqlanadi — qaytarish mumkin) */
  async clear(code: string, userId: string) {
    const def = this.sheetOf(code);
    const cur = await this.prisma.setting.findUnique({ where: { key: sheetKey(def.code) } });
    if (!cur) throw new BadRequestException("Jadval bo'sh");
    await this.prisma.$transaction(async (tx) => {
      await tx.setting.upsert({ where: { key: prevKey(def.code) }, create: { key: prevKey(def.code), value: cur.value as object }, update: { value: cur.value as object } });
      await tx.setting.delete({ where: { key: sheetKey(def.code) } });
    });
    clearHrCache();
    await this.audit.log({ userId, action: 'DELETE', entity: 'hr_sheet', entityId: def.code, summary: `${def.label}: jadval tozalandi (qaytarish mumkin)` });
    return { success: true as const };
  }

  // ═══════════ Miya: qidiruv va xodim kartasi ═══════════

  /** PINFL yoki F.I.Sh. bo'yicha: ma'lumotnomalar + Xodimlar bazasi */
  async search(qRaw: string | undefined) {
    const q = (qRaw ?? '').trim();
    const qd = q.replace(/\D/g, '');
    const qn = normName(q);
    if (qd.length < 4 && qn.length < 3) return [];
    const people = await hrPeople(this.prisma);
    const out = new Map<string, { pinfl: string; fullName: string; position: string | null; place: string | null; unit: string | null; unitLabel: string | null; sources: string[]; inRegistry: boolean }>();
    const reg = await this.prisma.employee.findMany({
      where: qd.length >= 4 ? { pinfl: { contains: qd } } : { fullName: { contains: q, mode: 'insensitive' } as never },
      select: { pinfl: true, fullName: true, position: true },
      take: 30,
    });
    for (const p of people.values()) {
      if (out.size >= 30) break;
      if ((qd.length >= 4 && p.pinfl.includes(qd)) || (qn.length >= 3 && normName(p.fullName).includes(qn))) {
        out.set(p.pinfl, { pinfl: p.pinfl, fullName: p.fullName, position: p.position, place: p.place, unit: p.unit, unitLabel: p.unit ? entryUnitLabel(p.unit) : null, sources: [...p.sources], inRegistry: false });
      }
    }
    for (const e of reg) {
      const x = out.get(e.pinfl);
      if (x) x.inRegistry = true;
      else if (out.size < 30) out.set(e.pinfl, { pinfl: e.pinfl, fullName: e.fullName, position: e.position ?? null, place: null, unit: null, unitLabel: null, sources: [], inRegistry: true });
    }
    const regAll = new Set((await this.prisma.employee.findMany({ where: { pinfl: { in: [...out.keys()] } }, select: { pinfl: true } })).map((e) => e.pinfl));
    return [...out.values()].map((x) => ({ ...x, inRegistry: regAll.has(x.pinfl) })).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }

  /** Xodimning hamma ma'lumoti: ma'lumotnomalar, Xodimlar bazasi, bo'limi («miya»), ko'chishlar, ish haqi */
  async person(pinflRaw: string) {
    const pinfl = String(pinflRaw ?? '').replace(/\D/g, '');
    if (!/^\d{14}$/.test(pinfl)) throw new BadRequestException("JShShIR 14 raqam bo'lishi kerak");
    const people = await hrPeople(this.prisma);
    const hp = people.get(pinfl) ?? null;
    const emp = await this.prisma.employee.findUnique({
      where: { pinfl },
      include: { region: { select: { name: true } }, district: { select: { name: true } }, department: { select: { name: true } } },
    });
    if (!hp && !emp) throw new NotFoundException("Bu JShShIR bo'yicha xodim topilmadi");
    const fullName = emp?.fullName ?? hp!.fullName;

    // Ma'lumotnomalardagi qatorlar — guruhlangan maydonlar
    const sheets = [];
    for (const def of HR_SHEETS) {
      const s = await loadSnapshot(this.prisma, def.code);
      if (!s) continue;
      const names = new Set([normName(fullName), hp ? normName(hp.fullName) : ''].filter(Boolean));
      const mine = s.rows
        .map((r) => rowObject(s, r))
        .filter((o) => (def.pinflKey ? o[def.pinflKey] === pinfl : names.has(normName(o[def.nameKey]))));
      if (!mine.length) continue;
      sheets.push({
        code: def.code,
        no: def.no,
        label: def.label,
        fileName: s.fileName,
        uploadedAt: s.uploadedAt,
        records: mine.map((o) => {
          const groups = new Map<HrGroup, { label: string; value: string }[]>();
          for (const c of def.columns) {
            if (c.key === def.seqKey) continue;
            const v = o[c.key];
            if (v === null || v === undefined || v === '') continue;
            groups.set(c.group, [...(groups.get(c.group) ?? []), { label: c.header.replace(/\s*\n\s*/g, ' '), value: v }]);
          }
          return { groups: [...groups.entries()].map(([g, fields]) => ({ group: g, label: HR_GROUP_LABELS[g], fields })) };
        }),
      });
    }

    // «Miya»: hozirgi bo'limi (yo'nalishlar ro'yxati), ko'chishlar
    const now = new Date(Date.now() + TASHKENT_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 7);
    const staffIn: { unit: string; label: string; source: string }[] = [];
    for (const seg of ENTRY_UNIT_CODES.filter((c) => isSegment(c))) {
      const hit = (await this.unitPayroll.staffOf(seg, now)).find((s) => s.pinfl === pinfl && s.active);
      if (hit) staffIn.push({ unit: seg, label: entryUnitLabel(seg), source: hit.source });
    }
    const moves = await this.unitPayroll.moves({ pinfl });
    const regionalUnit = emp ? (emp.regionCode === 0 ? 'CENTER' : 'REGION') : null;
    const unitNow = staffIn[0]?.unit ?? regionalUnit;

    // Ish haqi: umumiy vedomost (oy bo'yicha) va bo'limlar vedomosti
    const entries = await this.prisma.payrollEntry.findMany({ where: { employeePinfl: pinfl, deletedAt: null }, select: { period: true, totalTiyin: true, baseTiyin: true } });
    const byPeriod = new Map<string, bigint>();
    for (const e of entries) byPeriod.set(e.period, (byPeriod.get(e.period) ?? 0n) + BigInt(e.totalTiyin ?? 0n));
    const unitPay: { unit: string; label: string; period: string; amountTiyin: string }[] = [];
    const keys = await this.prisma.setting.findMany({ where: { key: { startsWith: 'unit.payroll.' } }, select: { key: true, value: true } });
    for (const k of keys) {
      const m = /^unit\.payroll\.([A-Z_]+)\.(\d{4}-\d{2})$/.exec(k.key);
      if (!m) continue;
      const batches = ((k.value as { batches?: { status?: string; rows?: { pinfl: string; amountTiyin: string }[] }[] } | null)?.batches ?? []).filter((b) => b.status === 'COMMITTED');
      let sum = 0n;
      let hit = false;
      for (const b of batches)
        for (const r of b.rows ?? [])
          if (r.pinfl === pinfl) {
            hit = true;
            sum += BigInt(r.amountTiyin);
          }
      if (hit) unitPay.push({ unit: m[1]!, label: entryUnitLabel(m[1]!), period: m[2]!, amountTiyin: sum.toString() });
    }

    return {
      pinfl,
      fullName,
      position: emp?.position ?? hp?.position ?? null,
      place: hp?.place ?? null,
      status: hp?.status ?? (emp ? (emp.isActive ? 'faol' : 'arxivda') : null),
      working: emp ? emp.isActive : (hp?.working ?? true),
      hrUnit: hp?.unit ?? null,
      hrUnitLabel: hp?.unit ? entryUnitLabel(hp.unit) : null,
      sources: hp?.sources ?? [],
      registry: emp
        ? {
            fullName: emp.fullName,
            position: emp.position ?? null,
            employmentType: emp.employmentType,
            region: emp.region?.name ?? null,
            district: emp.district?.name ?? null,
            department: emp.department?.name ?? null,
            hiredAt: emp.hiredAt ? emp.hiredAt.toISOString().slice(0, 10) : null,
            firedAt: emp.firedAt ? emp.firedAt.toISOString().slice(0, 10) : null,
            isActive: emp.isActive,
          }
        : null,
      miya: {
        period: now,
        unit: unitNow,
        unitLabel: unitNow ? entryUnitLabel(unitNow) : null,
        staffIn,
        moves: moves.items.map((m) => ({ id: m.id, unit: m.unit, unitLabel: m.unitLabel, fromUnitLabel: m.fromUnitLabel, from: m.from, note: m.note, source: m.source })),
      },
      sheets,
      payroll: {
        months: [...byPeriod.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 24).map(([period, t]) => ({ period, totalTiyin: t.toString() })),
        units: unitPay.sort((a, b) => b.period.localeCompare(a.period)).slice(0, 48),
      },
    };
  }
}