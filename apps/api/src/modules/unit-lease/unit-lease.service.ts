import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { entryUnitLabel, isSegment } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { LEASE_KINDS, unitBranches, type LeaseKind, type UnitBranch } from './unit-lease.branches';

// ═══════════════════════════════════════════════════════════
// Yo'nalish ijara va kommunal to'lovlari (Xarajatlar › Tax free › Ijara va kommunal).
//
//  • Shablon — tanlangan oylar oralig'i uchun (masalan, yanvar–aprel): qatorlar — filiallar (13 ta),
//    ustunlar — har oy uchun «Ijara» va «Kommunal», oxirida «Jami».
//  • To'ldirilgan fayl yuklansa — undagi hamma oylar o'qiladi; saqlashda tanlangan oylar yoziladi.
//  • Bir oy qayta yuklansa — o'sha oyning oldingi ma'lumoti (va xarajatlari) almashtiriladi.
//  • Har filial × oy × tur (summa > 0) — alohida xarajat: yo'nalish, modda «Ijara» yoki «Kommunal to'lovlar».
//  • Saqlash joyi: `settings` («unit.lease.<BO'LIM>») — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

const TASHKENT_OFFSET_HOURS = 5;
const MAX_MONTHS = 24;
const MONTHS_UZ = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
const CODE_MARK = 'KOD';
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface LeaseCell {
  ijaraTiyin: string;
  kommunalTiyin: string;
}

/** Bir oyning saqlangan holati */
interface MonthState {
  batchId: string;
  fileName: string;
  savedAt: string;
  uploadedBy: string;
  /** filial kodi → summalar */
  cells: Record<string, LeaseCell>;
  expenseIds: string[];
}

interface LeaseBatch {
  id: string;
  fileName: string;
  createdAt: string;
  uploadedById: string;
  uploadedBy: string;
  months: string[];
  totalTiyin: string;
  status: 'COMMITTED' | 'CANCELLED';
  cancelledAt: string | null;
}

interface LeaseStore {
  months: Record<string, MonthState>;
  batches: LeaseBatch[];
}

export const monthLabel = (p: string) => `${MONTHS_UZ[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

/** from..to (ikkalasi ham kiradi) */
export function monthsBetween(from: string, to: string): string[] {
  if (!PERIOD_RE.test(from ?? '') || !PERIOD_RE.test(to ?? '')) throw new BadRequestException("Oylar oralig'i noto'g'ri (YYYY-MM)");
  if (from > to) throw new BadRequestException("Boshlanish oyi tugash oyidan keyin bo'lmasin");
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number) as [number, number];
  for (;;) {
    const p = `${y}-${String(m).padStart(2, '0')}`;
    out.push(p);
    if (p === to) break;
    if (out.length > MAX_MONTHS) throw new BadRequestException(`Ko'pi bilan ${MAX_MONTHS} oy tanlang`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object') {
    const r = value as unknown as Record<string, unknown>;
    if ('result' in r) return r.result;
    if ('text' in r) return r.text;
    if ('richText' in r && Array.isArray(r.richText)) return (r.richText as { text: string }[]).map((p) => p.text).join('');
    if ('formula' in r) return null;
  }
  return value;
}

/** Bo'sh — 0; manfiy yoki matn — null (xato) */
function parseAmount(v: unknown): bigint | null {
  if (v === null || v === undefined || String(v).trim() === '' || String(v).trim() === '-') return 0n;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? BigInt(Math.round(v * 100)) : null;
  const n = Number(String(v).replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n * 100)) : null;
}

const norm = (s: string) => s.toLowerCase().replace(/[«»"'`ʻʼ‘’“”]/g, '').replace(/\s+/g, ' ').trim();

function readStore(raw: unknown): LeaseStore {
  const v = (raw ?? {}) as Partial<LeaseStore>;
  return {
    months: v.months && typeof v.months === 'object' && !Array.isArray(v.months) ? (v.months as Record<string, MonthState>) : {},
    batches: Array.isArray(v.batches) ? (v.batches as LeaseBatch[]) : [],
  };
}

@Injectable()
export class UnitLeaseService implements OnModuleInit {
  private readonly logger = new Logger(UnitLeaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** «Ijara» va «Kommunal to'lovlar» moddalari bo'lmasa — yaratiladi (bor bo'lsa tegilmaydi) */
  async onModuleInit(): Promise<void> {
    for (const k of LEASE_KINDS) {
      await this.prisma.category
        .upsert({ where: { code: k.category }, update: {}, create: { code: k.category, label: k.categoryLabel, order: 50 } })
        .catch((e: unknown) => this.logger.warn(`«${k.categoryLabel}» moddasini tekshirib bo'lmadi: ${String(e)}`));
    }
  }

  unitOf(raw: unknown): string {
    if (isSegment(raw) && unitBranches(raw).length) return raw;
    throw new BadRequestException("Bu bo'lim uchun filiallar ro'yxati yo'q");
  }

  private key(unit: string) {
    return `unit.lease.${unit}`;
  }

  private async store(unit: string): Promise<LeaseStore> {
    return readStore((await this.prisma.setting.findUnique({ where: { key: this.key(unit) } }))?.value ?? null);
  }

  private periodEnd(period: string): Date {
    const [y, m] = period.split('-').map(Number) as [number, number];
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return new Date(Date.UTC(ny, nm - 1, 1, -TASHKENT_OFFSET_HOURS) - 86_400_000);
  }

  branches(unit: string) {
    return { unit, label: entryUnitLabel(unit), branches: unitBranches(unit), kinds: LEASE_KINDS.map((k) => ({ key: k.key, label: k.label })) };
  }

  // ═══════════ Shablon ═══════════

  async template(unit: string, from: string, to: string): Promise<{ buffer: Buffer; filename: string }> {
    const months = monthsBetween(from, to);
    const branches = unitBranches(unit);
    const label = entryUnitLabel(unit);
    const saved = (await this.store(unit)).months;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const ws = wb.addWorksheet('Ijara va kommunal', { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });
    const thin = { style: 'thin' as const, color: { argb: 'FF9CA3AF' } };
    const border: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
    const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
    const kinds = LEASE_KINDS;
    const firstCol = 3;
    const colOf = (mi: number, ki: number) => firstCol + mi * kinds.length + ki;
    const totalCol0 = colOf(months.length, 0);

    // 1-qator: sarlavha
    ws.getCell(1, 1).value = `${label} — ijara va kommunal to'lovlari · ${monthLabel(months[0]!)}${months.length > 1 ? ` – ${monthLabel(months[months.length - 1]!)}` : ''} (so'm)`;
    ws.getCell(1, 1).font = { bold: true, size: 12 };
    ws.mergeCells(1, 1, 1, Math.min(totalCol0 + kinds.length - 1, 12));

    // 2–3: oylar va turlar
    const head = (r: number, c: number, v: string, argb: string) => {
      const cell = ws.getCell(r, c);
      cell.value = v;
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = fill(argb);
      cell.border = border;
    };
    head(2, 1, '№', 'FFE5E7EB');
    head(2, 2, 'Filial', 'FFE5E7EB');
    ws.mergeCells(2, 1, 3, 1);
    ws.mergeCells(2, 2, 3, 2);
    months.forEach((p, mi) => {
      const c0 = colOf(mi, 0);
      head(2, c0, monthLabel(p), mi % 2 ? 'FFDBEAFE' : 'FFE0E7FF');
      ws.mergeCells(2, c0, 2, c0 + kinds.length - 1);
      kinds.forEach((k, ki) => head(3, colOf(mi, ki), k.label, mi % 2 ? 'FFDBEAFE' : 'FFE0E7FF'));
    });
    head(2, totalCol0, 'Jami', 'FFFEF3C7');
    ws.mergeCells(2, totalCol0, 2, totalCol0 + kinds.length - 1);
    kinds.forEach((k, ki) => head(3, totalCol0 + ki, k.label, 'FFFEF3C7'));

    // 4: kodlar qatori (yashirin) — fayl o'qilganda ustunlar shu bo'yicha topiladi
    const codeRow = ws.getRow(4);
    codeRow.getCell(1).value = CODE_MARK;
    codeRow.getCell(2).value = unit;
    months.forEach((p, mi) => kinds.forEach((k, ki) => (codeRow.getCell(colOf(mi, ki)).value = `${p}|${k.key}`)));
    codeRow.hidden = true;

    // 5..: filiallar (oldin saqlangan summalar bo'lsa — yozib qo'yiladi, tahrirlash mumkin)
    const first = 5;
    branches.forEach((b, bi) => {
      const r = first + bi;
      const row = ws.getRow(r);
      row.getCell(1).value = b.no;
      row.getCell(2).value = b.name;
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'top' };
      row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
      months.forEach((p, mi) =>
        kinds.forEach((k, ki) => {
          const cell = row.getCell(colOf(mi, ki));
          const prev = saved[p]?.cells?.[b.code];
          const v = prev ? BigInt(k.key === 'IJARA' ? prev.ijaraTiyin : prev.kommunalTiyin) : 0n;
          cell.value = v ? Number(v) / 100 : null;
          cell.numFmt = '#,##0.00';
          cell.fill = fill('FFFFFBEB');
        }),
      );
      kinds.forEach((_, ki) => {
        const refs = months.map((__, mi) => ws.getCell(r, colOf(mi, ki)).address).join('+');
        const cell = row.getCell(totalCol0 + ki);
        cell.value = { formula: refs || '0' };
        cell.numFmt = '#,##0.00';
        cell.font = { bold: true };
      });
      for (let c = 1; c < totalCol0 + kinds.length; c++) row.getCell(c).border = border;
    });

    // Jami qatori
    const last = first + branches.length - 1;
    const tr = ws.getRow(last + 1);
    tr.getCell(2).value = 'JAMI';
    tr.font = { bold: true };
    for (let c = firstCol; c < totalCol0 + kinds.length; c++) {
      const L = ws.getColumn(c).letter;
      tr.getCell(c).value = { formula: `SUM(${L}${first}:${L}${last})` };
      tr.getCell(c).numFmt = '#,##0.00';
      tr.getCell(c).fill = fill('FFF3F4F6');
      tr.getCell(c).border = border;
    }
    tr.getCell(1).border = border;
    tr.getCell(2).border = border;

    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 58;
    for (let c = firstCol; c < totalCol0 + kinds.length; c++) ws.getColumn(c).width = 15;
    ws.getRow(2).height = 20;

    const note = ws.getCell(last + 3, 2);
    note.value = "Summalarni so'mda yozing (bo'sh — 0). Qator va ustunlarni o'chirmang, nomini o'zgartirmang. Saqlanganda shu oylarning oldingi ma'lumoti almashtiriladi.";
    note.font = { italic: true, color: { argb: 'FF6B7280' } };

    const data = await wb.xlsx.writeBuffer();
    const tag = months.length > 1 ? `${months[0]}_${months[months.length - 1]}` : months[0]!;
    return { buffer: Buffer.from(data), filename: `Ijara-kommunal-${label.replace(/\s+/g, '-')}-${tag}.xlsx` };
  }

  // ═══════════ Tahlil — hech narsa saqlanmaydi ═══════════

  async analyze(unit: string, file: Express.Multer.File | undefined) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatidagi Excel fayl yuklang");
    }
    const branches = unitBranches(unit);
    const byNo = new Map(branches.map((b) => [b.no, b]));
    const byName = new Map(branches.map((b) => [norm(b.name), b]));

    // Kodlar qatori bor varaq (shablon)
    let ws: ExcelJS.Worksheet | undefined;
    let codeRowNo = 0;
    for (const sheet of wb.worksheets) {
      for (let r = 1; r <= Math.min(sheet.rowCount, 12); r++) {
        if (String(cellValue(sheet.getRow(r).getCell(1).value) ?? '').trim().toUpperCase() === CODE_MARK) {
          ws = sheet;
          codeRowNo = r;
          break;
        }
      }
      if (ws) break;
    }
    if (!ws) throw new BadRequestException("Shablon topilmadi — avval shu sahifadan «Shablon»ni yuklab oling va o'shani to'ldiring");
    const fileUnit = String(cellValue(ws.getRow(codeRowNo).getCell(2).value) ?? '').trim();
    if (fileUnit && fileUnit !== unit) throw new BadRequestException(`Bu shablon boshqa bo'lim uchun (${entryUnitLabel(fileUnit)})`);

    const cols: { col: number; period: string; kind: LeaseKind }[] = [];
    ws.getRow(codeRowNo).eachCell((cell, col) => {
      const m = /^(\d{4}-(0[1-9]|1[0-2]))\|(IJARA|KOMMUNAL)$/.exec(String(cellValue(cell.value) ?? '').trim());
      if (m) cols.push({ col, period: m[1]!, kind: m[3] as LeaseKind });
    });
    if (!cols.length) throw new BadRequestException("Shablonda oylar ustuni topilmadi — shablonni qaytadan yuklab oling");
    const months = [...new Set(cols.map((c) => c.period))].sort();

    const cells = new Map<string, Map<string, { ijara: bigint; kommunal: bigint }>>(); // filial → oy → summa
    const invalid: { row: number; column: string; reason: string }[] = [];
    const unknownRows: { row: number; text: string }[] = [];
    const seen = new Set<string>();

    for (let r = codeRowNo + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const noRaw = cellValue(row.getCell(1).value);
      const nameRaw = String(cellValue(row.getCell(2).value) ?? '').trim();
      if (/^jami$/i.test(nameRaw)) continue;
      const no = typeof noRaw === 'number' ? noRaw : Number(String(noRaw ?? '').trim());
      const branch = (Number.isInteger(no) ? byNo.get(no) : undefined) ?? byName.get(norm(nameRaw));
      const hasAny = cols.some((c) => {
        const v = cellValue(row.getCell(c.col).value);
        return v !== null && v !== undefined && String(v).trim() !== '' && Number(v) !== 0;
      });
      if (!branch) {
        if (hasAny) unknownRows.push({ row: r, text: nameRaw || String(noRaw ?? '') });
        continue;
      }
      if (seen.has(branch.code)) {
        if (hasAny) invalid.push({ row: r, column: 'B', reason: `Filial takrorlangan: ${branch.no}` });
        continue;
      }
      seen.add(branch.code);
      const per = new Map<string, { ijara: bigint; kommunal: bigint }>();
      for (const c of cols) {
        const raw = cellValue(row.getCell(c.col).value);
        const v = parseAmount(raw);
        const cur = per.get(c.period) ?? { ijara: 0n, kommunal: 0n };
        if (v === null) {
          invalid.push({ row: r, column: ws.getColumn(c.col).letter, reason: `Summa noto'g'ri: «${String(raw).slice(0, 30)}»` });
        } else if (c.kind === 'IJARA') cur.ijara = v;
        else cur.kommunal = v;
        per.set(c.period, cur);
      }
      cells.set(branch.code, per);
    }

    const saved = (await this.store(unit)).months;
    const monthInfo = months.map((p) => {
      let ijara = 0n;
      let kommunal = 0n;
      for (const per of cells.values()) {
        ijara += per.get(p)?.ijara ?? 0n;
        kommunal += per.get(p)?.kommunal ?? 0n;
      }
      const prev = saved[p];
      const prevTotal = prev ? Object.values(prev.cells).reduce((s, x) => s + BigInt(x.ijaraTiyin) + BigInt(x.kommunalTiyin), 0n) : null;
      return {
        period: p,
        label: monthLabel(p),
        ijaraTiyin: ijara.toString(),
        kommunalTiyin: kommunal.toString(),
        totalTiyin: (ijara + kommunal).toString(),
        empty: ijara + kommunal === 0n,
        saved: prev ? { fileName: prev.fileName, savedAt: prev.savedAt, totalTiyin: (prevTotal ?? 0n).toString() } : null,
      };
    });

    return {
      unit,
      label: entryUnitLabel(unit),
      fileName: String(file.originalname ?? 'ijara-kommunal.xlsx').slice(0, 200),
      sheetName: ws.name,
      months: monthInfo,
      branches: branches.map((b) => ({
        code: b.code,
        no: b.no,
        name: b.name,
        inFile: cells.has(b.code),
        cells: Object.fromEntries(months.map((p) => [p, { ijaraTiyin: (cells.get(b.code)?.get(p)?.ijara ?? 0n).toString(), kommunalTiyin: (cells.get(b.code)?.get(p)?.kommunal ?? 0n).toString() }])),
      })),
      missingBranches: branches.filter((b) => !cells.has(b.code)).map((b) => ({ no: b.no, name: b.name })),
      invalid,
      unknownRows,
      totalTiyin: monthInfo.reduce((s, m) => s + BigInt(m.totalTiyin), 0n).toString(),
    };
  }

  // ═══════════ Saqlash ═══════════

  async commit(unit: string, body: { fileName?: unknown; months?: unknown; rows?: unknown }, userId: string) {
    const branches = unitBranches(unit);
    const known = new Map(branches.map((b) => [b.code, b]));
    if (!Array.isArray(body?.months) || !body.months.length) throw new BadRequestException('Saqlash uchun kamida bitta oy tanlang');
    const months = [...new Set(body.months.map(String))].sort();
    if (months.some((p) => !PERIOD_RE.test(p))) throw new BadRequestException("Oy noto'g'ri");
    if (months.length > MAX_MONTHS) throw new BadRequestException(`Ko'pi bilan ${MAX_MONTHS} oy`);
    if (!Array.isArray(body.rows)) throw new BadRequestException("Ma'lumot yo'q");
    const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : 'ijara-kommunal.xlsx';

    // oy → filial → summalar
    const data = new Map<string, Map<string, { ijara: bigint; kommunal: bigint }>>(months.map((p) => [p, new Map()]));
    for (const raw of body.rows as { branch?: unknown; period?: unknown; ijaraTiyin?: unknown; kommunalTiyin?: unknown }[]) {
      const branch = known.get(String(raw?.branch ?? ''));
      const period = String(raw?.period ?? '');
      if (!branch) throw new BadRequestException(`Noma'lum filial: ${String(raw?.branch ?? '').slice(0, 20)}`);
      const per = data.get(period);
      if (!per) continue; // tanlanmagan oy — saqlanmaydi
      let ijara: bigint;
      let kommunal: bigint;
      try {
        ijara = BigInt(String(raw.ijaraTiyin ?? '0'));
        kommunal = BigInt(String(raw.kommunalTiyin ?? '0'));
      } catch {
        throw new BadRequestException(`Summa noto'g'ri: ${branch.no}-filial, ${period}`);
      }
      if (ijara < 0n || kommunal < 0n) throw new BadRequestException(`Manfiy summa: ${branch.no}-filial, ${period}`);
      per.set(branch.code, { ijara, kommunal });
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);
    const label = entryUnitLabel(unit);
    const key = this.key(unit);
    const batchId = randomUUID();
    const now = new Date().toISOString();

    const result = await this.prisma.$transaction(
      async (tx) => {
        const store = readStore((await tx.setting.findUnique({ where: { key } }))?.value ?? null);
        let replaced = 0;
        let created = 0;
        let total = 0n;
        for (const p of months) {
          const prev = store.months[p];
          if (prev?.expenseIds.length) {
            await tx.expense.updateMany({ where: { id: { in: prev.expenseIds }, deletedAt: null }, data: { deletedAt: new Date() } });
          }
          if (prev) replaced += 1;
          const per = data.get(p)!;
          const cells: Record<string, LeaseCell> = {};
          const expenseIds: string[] = [];
          for (const b of branches) {
            const v = per.get(b.code) ?? { ijara: 0n, kommunal: 0n };
            cells[b.code] = { ijaraTiyin: v.ijara.toString(), kommunalTiyin: v.kommunal.toString() };
            for (const k of LEASE_KINDS) {
              const amount = k.key === 'IJARA' ? v.ijara : v.kommunal;
              if (amount <= 0n) continue;
              const e = await tx.expense.create({
                data: {
                  date: this.periodEnd(p),
                  period: p,
                  amountTiyin: amount,
                  categoryCode: k.category,
                  segment: unit,
                  regionCode: null,
                  departmentId: null,
                  description: `${k.label} — ${b.name}`.slice(0, 500),
                  counterparty: b.name.slice(0, 200),
                  documentNo: fileName.slice(0, 100),
                  paymentMethod: 'BANK',
                  paymentStatus: 'PAID',
                  source: 'IMPORT',
                  section: 'DOIMIY',
                  createdById: userId,
                },
                select: { id: true },
              });
              expenseIds.push(e.id);
              created += 1;
              total += amount;
            }
          }
          store.months[p] = { batchId, fileName, savedAt: now, uploadedBy: user?.fullName ?? '', cells, expenseIds };
        }
        // Oylari to'liq almashtirilgan eski yuklashlar — tarixda «almashtirilgan» bo'lib qoladi (holati hisoblanadi)
        store.batches.push({ id: batchId, fileName, createdAt: now, uploadedById: userId, uploadedBy: user?.fullName ?? '', months, totalTiyin: total.toString(), status: 'COMMITTED', cancelledAt: null });
        if (store.batches.length > 200) store.batches = store.batches.slice(-200);
        const value = store as unknown as object;
        await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
        return { replaced, created, total };
      },
      { timeout: 60_000 },
    );

    await this.audit.log({
      userId,
      action: 'IMPORT',
      entity: 'unit_lease',
      entityId: `${unit}:${batchId}`,
      summary: `${label} ijara va kommunal: ${months.map(monthLabel).join(', ')} — ${(Number(result.total) / 100).toLocaleString('uz-UZ')} so'm, ${result.created} ta xarajat${result.replaced ? `, ${result.replaced} oy almashtirildi` : ''}`,
    });

    return { success: true as const, batchId, months, expensesCreated: result.created, replacedMonths: result.replaced, totalTiyin: result.total.toString() };
  }

  // ═══════════ Ko'rish, tarix, bekor qilish ═══════════

  async data(unit: string, from: string, to: string) {
    const months = monthsBetween(from, to);
    const store = await this.store(unit);
    const branches = unitBranches(unit);
    return {
      unit,
      label: entryUnitLabel(unit),
      months: months.map((p) => {
        const s = store.months[p];
        const sum = (k: 'ijaraTiyin' | 'kommunalTiyin') => (s ? Object.values(s.cells).reduce((a, c) => a + BigInt(c[k]), 0n) : 0n);
        return { period: p, label: monthLabel(p), saved: s ? { fileName: s.fileName, savedAt: s.savedAt, uploadedBy: s.uploadedBy } : null, ijaraTiyin: sum('ijaraTiyin').toString(), kommunalTiyin: sum('kommunalTiyin').toString() };
      }),
      branches: branches.map((b) => ({
        code: b.code,
        no: b.no,
        name: b.name,
        cells: Object.fromEntries(months.map((p) => [p, store.months[p]?.cells?.[b.code] ?? null])),
      })),
    };
  }

  async batches(unit: string) {
    const store = await this.store(unit);
    return [...store.batches]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((b) => {
        const live = b.months.filter((p) => store.months[p]?.batchId === b.id);
        const state = b.status === 'CANCELLED' ? 'CANCELLED' : live.length === b.months.length ? 'ACTIVE' : live.length ? 'PARTIAL' : 'REPLACED';
        return { ...b, monthLabels: b.months.map(monthLabel), liveMonths: live, state };
      });
  }

  /** Yuklashni bekor qilish: shu yuklash bilan turgan oylar ma'lumoti va xarajatlari o'chadi (savatga) */
  async cancel(unit: string, id: string, userId: string) {
    const key = this.key(unit);
    const out = await this.prisma.$transaction(async (tx) => {
      const store = readStore((await tx.setting.findUnique({ where: { key } }))?.value ?? null);
      const b = store.batches.find((x) => x.id === id);
      if (!b) throw new NotFoundException('Yuklash topilmadi');
      if (b.status === 'CANCELLED') throw new BadRequestException('Bu yuklash allaqachon bekor qilingan');
      const cleared: string[] = [];
      for (const p of b.months) {
        const s = store.months[p];
        if (s?.batchId !== b.id) continue;
        if (s.expenseIds.length) await tx.expense.updateMany({ where: { id: { in: s.expenseIds }, deletedAt: null }, data: { deletedAt: new Date() } });
        delete store.months[p];
        cleared.push(p);
      }
      b.status = 'CANCELLED';
      b.cancelledAt = new Date().toISOString();
      const value = store as unknown as object;
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      return { b, cleared };
    });
    await this.audit.log({ userId, action: 'DELETE', entity: 'unit_lease', entityId: `${unit}:${id}`, summary: `${entryUnitLabel(unit)} ijara va kommunal yuklashi bekor qilindi: ${out.b.fileName}${out.cleared.length ? ` (${out.cleared.map(monthLabel).join(', ')})` : ''}` });
    return { success: true as const, clearedMonths: out.cleared };
  }
}

export type { UnitBranch };