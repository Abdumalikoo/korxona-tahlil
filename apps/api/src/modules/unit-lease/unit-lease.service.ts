import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { entryUnitLabel, isSegment } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_LEASE_KINDS, LEASE_CONFIG, type LeaseKindDef, type LeaseUnitConfig, type UnitBranch } from './unit-lease.branches';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { cellValue } from '../../common/excel/cells';
import { somToTiyin } from '../../common/money';
import { MAX_RANGE_MONTHS as MAX_MONTHS, monthLabel, monthsBetween, PERIOD_RE } from '../../common/period';
// Avvalgi importlar buzilmasin (boshqa modullar shu yerdan olardi)
export { monthLabel, monthsBetween };

// ═══════════════════════════════════════════════════════════
// Yo'nalish doimiy to'lovlari: Tax free › Ijara va kommunal, Fermer xo'jaligi › Ijara va internet.
//
//  • Shablon — tanlangan oylar oralig'i uchun (masalan, yanvar–aprel): qatorlar — filiallar/joylar,
//    ustunlar — har oy uchun bo'limning to'lov turlari (Ijara + Kommunal yoki Internet), oxirida «Jami».
//  • Tax free filiallari qat'iy (13 ta); Fermer joylari sahifada tahrirlanadi («unit.lease.branches.<BO'LIM>»).
//  • To'ldirilgan fayl yuklansa — undagi hamma oylar o'qiladi; saqlashda tanlangan oylar yoziladi.
//  • Bir oy qayta yuklansa — o'sha oyning oldingi ma'lumoti (va xarajatlari) almashtiriladi.
//  • Har filial × oy × tur (summa > 0) — alohida xarajat: yo'nalish, turning moddasi (Ijara / Kommunal / Internet).
//  • Saqlash joyi: `settings` («unit.lease.<BO'LIM>») — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

const TASHKENT_OFFSET_HOURS = 5;
const CODE_MARK = 'KOD';

/** Katak: turning maydoni → tiyin (ijaraTiyin, kommunalTiyin, internetTiyin …) */
export type LeaseCell = Record<string, string>;

interface BranchStore {
  /** Oxirgi berilgan kod raqami (o'chirilgan kod qayta berilmaydi) */
  seq: number;
  branches: UnitBranch[];
}

const amt = (cell: LeaseCell | null | undefined, k: LeaseKindDef): bigint => {
  try {
    return BigInt(cell?.[k.field] ?? '0');
  } catch {
    return 0n;
  }
};
const cellSum = (cell: LeaseCell | null | undefined, kinds: LeaseKindDef[]) => kinds.reduce((s, k) => s + amt(cell, k), 0n);

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

/** Bo'sh — 0; manfiy yoki matn — null (xato) */
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

  /** «Ijara», «Kommunal to'lovlar», «Internet xizmatlari» moddalari bo'lmasa — yaratiladi (bor bo'lsa tegilmaydi) */
  async onModuleInit(): Promise<void> {
    for (const k of ALL_LEASE_KINDS) {
      await this.prisma.category
        .upsert({ where: { code: k.category }, update: {}, create: { code: k.category, label: k.categoryLabel, order: 50 } })
        .catch((e: unknown) => this.logger.warn(`«${k.categoryLabel}» moddasini tekshirib bo'lmadi: ${String(e)}`));
    }
  }

  unitOf(raw: unknown): string {
    if (isSegment(raw) && LEASE_CONFIG[raw]) return raw;
    throw new BadRequestException("Bu bo'lim uchun ijara jadvali yo'q");
  }

  private cfg(unit: string): LeaseUnitConfig {
    const c = LEASE_CONFIG[unit];
    if (!c) throw new BadRequestException("Bu bo'lim uchun ijara jadvali yo'q");
    return c;
  }

  private key(unit: string) {
    return `unit.lease.${unit}`;
  }

  private branchKey(unit: string) {
    return `unit.lease.branches.${unit}`;
  }

  private async branchStore(unit: string): Promise<BranchStore> {
    const cfg = this.cfg(unit);
    const raw = (await this.prisma.setting.findUnique({ where: { key: this.branchKey(unit) } }))?.value as Partial<BranchStore> | null | undefined;
    const list = Array.isArray(raw?.branches)
      ? raw!.branches.filter((b): b is UnitBranch => Boolean(b && typeof b.code === 'string' && typeof b.name === 'string'))
      : null;
    if (list) return { seq: Number(raw?.seq) || list.length, branches: list.map((b, i) => ({ code: b.code, no: i + 1, name: b.name })) };
    // Hali tahrirlanmagan — bitta boshlang'ich joy
    return { seq: 1, branches: [{ code: `${cfg.codePrefix}01`, no: 1, name: cfg.defaultBranch || entryUnitLabel(unit) }] };
  }

  /** Filiallar/joylar: Tax free — qat'iy ro'yxat, qolganlari — sahifada tahrirlanadi */
  async branchesOf(unit: string): Promise<UnitBranch[]> {
    const cfg = this.cfg(unit);
    return cfg.branches ?? (await this.branchStore(unit)).branches;
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

  async branches(unit: string) {
    const cfg = this.cfg(unit);
    return {
      unit,
      label: entryUnitLabel(unit),
      title: cfg.title,
      branchLabel: cfg.branchLabel,
      editable: cfg.branches === null,
      branches: await this.branchesOf(unit),
      kinds: cfg.kinds.map((k) => ({ key: k.key, label: k.label, field: k.field })),
    };
  }

  /**
   * Joylar ro'yxatini saqlash (faqat tahrirlanadigan bo'limlar). Kod o'zgarmaydi: mavjud joy nomi o'zgarsa —
   * saqlangan summalar o'sha joyda qoladi. Saqlangan summasi bor joyni o'chirib bo'lmaydi.
   */
  async saveBranches(unit: string, body: { branches?: unknown }, userId: string) {
    const cfg = this.cfg(unit);
    if (cfg.branches) throw new BadRequestException(`${entryUnitLabel(unit)} filiallari ro'yxati qat'iy — o'zgartirib bo'lmaydi`);
    if (!Array.isArray(body?.branches)) throw new BadRequestException("Ro'yxat yo'q");
    const input = (body.branches as { code?: unknown; name?: unknown }[]).map((b) => ({
      code: typeof b?.code === 'string' ? b.code : '',
      name: typeof b?.name === 'string' ? b.name.replace(/\s+/g, ' ').trim().slice(0, 200) : '',
    }));
    if (!input.length) throw new BadRequestException('Kamida bitta joy qolsin');
    if (input.length > 200) throw new BadRequestException("Ko'pi bilan 200 ta joy");
    const empty = input.findIndex((b) => !b.name);
    if (empty >= 0) throw new BadRequestException(`${empty + 1}-qator: nomi bo'sh`);
    const seen = new Set<string>();
    for (const b of input) {
      const n = norm(b.name);
      if (seen.has(n)) throw new BadRequestException(`Takrorlangan nom: «${b.name}»`);
      seen.add(n);
    }

    const prev = await this.branchStore(unit);
    const prevCodes = new Map(prev.branches.map((b) => [b.code, b]));
    let seq = prev.seq;
    const next: UnitBranch[] = input.map((b, i) => {
      if (b.code && prevCodes.has(b.code)) return { code: b.code, no: i + 1, name: b.name };
      seq += 1;
      return { code: `${cfg.codePrefix}${String(seq).padStart(2, '0')}`, no: i + 1, name: b.name };
    });

    const removed = prev.branches.filter((b) => !next.some((x) => x.code === b.code));
    if (removed.length) {
      const store = await this.store(unit);
      for (const b of removed) {
        const used = Object.entries(store.months).filter(([, m]) => cellSum(m.cells?.[b.code], cfg.kinds) > 0n).map(([p]) => p).sort();
        if (used.length) {
          throw new BadRequestException(`«${b.name}» — ${used.map(monthLabel).join(', ')} uchun summalar saqlangan. Avval o'sha oylarni qayta yuklang (0 bilan) yoki yuklashni bekor qiling`);
        }
      }
    }

    const key = this.branchKey(unit);
    const value = { seq, branches: next } as unknown as object;
    await this.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    await this.audit.log({
      userId,
      action: 'UPDATE',
      entity: 'unit_lease',
      entityId: `${unit}:branches`,
      summary: `${entryUnitLabel(unit)} ${cfg.title.toLowerCase()} — joylar: ${next.length} ta${removed.length ? `, o'chirildi: ${removed.map((b) => b.name).join(', ')}` : ''}`.slice(0, 500),
    });
    return { branches: next };
  }

  // ═══════════ Shablon ═══════════

  async template(unit: string, from: string, to: string): Promise<{ buffer: Buffer; filename: string }> {
    const months = monthsBetween(from, to);
    const cfg = this.cfg(unit);
    const branches = await this.branchesOf(unit);
    const label = entryUnitLabel(unit);
    const saved = (await this.store(unit)).months;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const ws = wb.addWorksheet(cfg.title, { views: [{ state: 'frozen', xSplit: 2, ySplit: 4 }] });
    const thin = { style: 'thin' as const, color: { argb: 'FF9CA3AF' } };
    const border: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };
    const fill = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
    const kinds = cfg.kinds;
    const firstCol = 3;
    const colOf = (mi: number, ki: number) => firstCol + mi * kinds.length + ki;
    const totalCol0 = colOf(months.length, 0);

    // 1-qator: sarlavha
    ws.getCell(1, 1).value = `${label} — ${cfg.title.toLowerCase()} to'lovlari · ${monthLabel(months[0]!)}${months.length > 1 ? ` – ${monthLabel(months[months.length - 1]!)}` : ''} (so'm)`;
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
    head(2, 2, cfg.branchLabel, 'FFE5E7EB');
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
          const v = amt(saved[p]?.cells?.[b.code], k);
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
    return { buffer: Buffer.from(data), filename: `${cfg.title.replace(/\s+/g, '-')}-${label.replace(/\s+/g, '-')}-${tag}.xlsx` };
  }

  // ═══════════ Tahlil — hech narsa saqlanmaydi ═══════════

  async analyze(unit: string, file: Express.Multer.File | undefined) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    const wb = new ExcelJS.Workbook();
    await assertSafeXlsx(file.buffer);
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatidagi Excel fayl yuklang");
    }
    const cfg = this.cfg(unit);
    const kinds = cfg.kinds;
    const kindByKey = new Map(kinds.map((k) => [k.key, k]));
    const branches = await this.branchesOf(unit);
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

    const cols: { col: number; period: string; kind: LeaseKindDef }[] = [];
    ws.getRow(codeRowNo).eachCell((cell, col) => {
      const m = /^(\d{4}-(0[1-9]|1[0-2]))\|([A-Z_]+)$/.exec(String(cellValue(cell.value) ?? '').trim());
      const k = m ? kindByKey.get(m[3]!) : undefined;
      if (m && k) cols.push({ col, period: m[1]!, kind: k });
    });
    if (!cols.length) throw new BadRequestException("Shablonda oylar ustuni topilmadi — shablonni qaytadan yuklab oling");
    const months = [...new Set(cols.map((c) => c.period))].sort();

    const cells = new Map<string, Map<string, Map<string, bigint>>>(); // filial → oy → tur → summa
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
        if (hasAny) invalid.push({ row: r, column: 'B', reason: `${cfg.branchLabel} takrorlangan: ${branch.no}` });
        continue;
      }
      seen.add(branch.code);
      const per = new Map<string, Map<string, bigint>>();
      for (const c of cols) {
        const raw = cellValue(row.getCell(c.col).value);
        const v = somToTiyin(raw, { dashIsZero: true });
        const cur = per.get(c.period) ?? new Map<string, bigint>();
        if (v === null) {
          invalid.push({ row: r, column: ws.getColumn(c.col).letter, reason: `Summa noto'g'ri: «${String(raw).slice(0, 30)}»` });
        } else cur.set(c.kind.key, v);
        per.set(c.period, cur);
      }
      cells.set(branch.code, per);
    }

    const saved = (await this.store(unit)).months;
    const cellOf = (code: string, p: string): LeaseCell =>
      Object.fromEntries(kinds.map((k) => [k.field, (cells.get(code)?.get(p)?.get(k.key) ?? 0n).toString()]));
    const monthInfo = months.map((p) => {
      const sums = new Map(kinds.map((k) => [k.key, 0n]));
      for (const per of cells.values()) for (const k of kinds) sums.set(k.key, sums.get(k.key)! + (per.get(p)?.get(k.key) ?? 0n));
      const total = [...sums.values()].reduce((a, b) => a + b, 0n);
      const prev = saved[p];
      const prevTotal = prev ? Object.values(prev.cells).reduce((s, x) => s + cellSum(x, kinds), 0n) : null;
      return {
        period: p,
        label: monthLabel(p),
        ...Object.fromEntries(kinds.map((k) => [k.field, sums.get(k.key)!.toString()])),
        totalTiyin: total.toString(),
        empty: total === 0n,
        saved: prev ? { fileName: prev.fileName, savedAt: prev.savedAt, totalTiyin: (prevTotal ?? 0n).toString() } : null,
      };
    });

    return {
      unit,
      label: entryUnitLabel(unit),
      title: cfg.title,
      branchLabel: cfg.branchLabel,
      kinds: kinds.map((k) => ({ key: k.key, label: k.label, field: k.field })),
      fileName: String(file.originalname ?? 'ijara.xlsx').slice(0, 200),
      sheetName: ws.name,
      months: monthInfo,
      branches: branches.map((b) => ({
        code: b.code,
        no: b.no,
        name: b.name,
        inFile: cells.has(b.code),
        cells: Object.fromEntries(months.map((p) => [p, cellOf(b.code, p)])),
      })),
      missingBranches: branches.filter((b) => !cells.has(b.code)).map((b) => ({ no: b.no, name: b.name })),
      invalid,
      unknownRows,
      totalTiyin: monthInfo.reduce((s, m) => s + BigInt(m.totalTiyin), 0n).toString(),
    };
  }

  // ═══════════ Saqlash ═══════════

  async commit(unit: string, body: { fileName?: unknown; months?: unknown; rows?: unknown }, userId: string) {
    const cfg = this.cfg(unit);
    const kinds = cfg.kinds;
    const branches = await this.branchesOf(unit);
    const known = new Map(branches.map((b) => [b.code, b]));
    if (!Array.isArray(body?.months) || !body.months.length) throw new BadRequestException('Saqlash uchun kamida bitta oy tanlang');
    const months = [...new Set(body.months.map(String))].sort();
    if (months.some((p) => !PERIOD_RE.test(p))) throw new BadRequestException("Oy noto'g'ri");
    if (months.length > MAX_MONTHS) throw new BadRequestException(`Ko'pi bilan ${MAX_MONTHS} oy`);
    if (!Array.isArray(body.rows)) throw new BadRequestException("Ma'lumot yo'q");
    const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : 'ijara.xlsx';

    // oy → filial → tur → summa
    const data = new Map<string, Map<string, Map<string, bigint>>>(months.map((p) => [p, new Map()]));
    for (const raw of body.rows as ({ branch?: unknown; period?: unknown } & Record<string, unknown>)[]) {
      const branch = known.get(String(raw?.branch ?? ''));
      const period = String(raw?.period ?? '');
      if (!branch) throw new BadRequestException(`Noma'lum filial: ${String(raw?.branch ?? '').slice(0, 20)}`);
      const per = data.get(period);
      if (!per) continue; // tanlanmagan oy — saqlanmaydi
      const v = new Map<string, bigint>();
      for (const k of kinds) {
        let x: bigint;
        try {
          x = BigInt(String(raw[k.field] ?? '0'));
        } catch {
          throw new BadRequestException(`Summa noto'g'ri: ${branch.no}-${cfg.branchLabel.toLowerCase()}, ${period}`);
        }
        if (x < 0n) throw new BadRequestException(`Manfiy summa: ${branch.no}-${cfg.branchLabel.toLowerCase()}, ${period}`);
        v.set(k.key, x);
      }
      per.set(branch.code, v);
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
            const v = per.get(b.code) ?? new Map<string, bigint>();
            cells[b.code] = Object.fromEntries(kinds.map((k) => [k.field, (v.get(k.key) ?? 0n).toString()]));
            for (const k of kinds) {
              const amount = v.get(k.key) ?? 0n;
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
      summary: `${label} ${cfg.title.toLowerCase()}: ${months.map(monthLabel).join(', ')} — ${(Number(result.total) / 100).toLocaleString('uz-UZ')} so'm, ${result.created} ta xarajat${result.replaced ? `, ${result.replaced} oy almashtirildi` : ''}`,
    });

    return { success: true as const, batchId, months, expensesCreated: result.created, replacedMonths: result.replaced, totalTiyin: result.total.toString() };
  }

  // ═══════════ Ko'rish, tarix, bekor qilish ═══════════

  async data(unit: string, from: string, to: string) {
    const months = monthsBetween(from, to);
    const cfg = this.cfg(unit);
    const store = await this.store(unit);
    const branches = await this.branchesOf(unit);
    return {
      unit,
      label: entryUnitLabel(unit),
      title: cfg.title,
      branchLabel: cfg.branchLabel,
      editable: cfg.branches === null,
      kinds: cfg.kinds.map((k) => ({ key: k.key, label: k.label, field: k.field })),
      months: months.map((p) => {
        const s = store.months[p];
        const sums = Object.fromEntries(cfg.kinds.map((k) => [k.field, (s ? Object.values(s.cells).reduce((a, c) => a + amt(c, k), 0n) : 0n).toString()]));
        return { period: p, label: monthLabel(p), saved: s ? { fileName: s.fileName, savedAt: s.savedAt, uploadedBy: s.uploadedBy } : null, ...sums };
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
    await this.audit.log({ userId, action: 'DELETE', entity: 'unit_lease', entityId: `${unit}:${id}`, summary: `${entryUnitLabel(unit)} ${this.cfg(unit).title.toLowerCase()} yuklashi bekor qilindi: ${out.b.fileName}${out.cleared.length ? ` (${out.cleared.map(monthLabel).join(', ')})` : ''}` });
    return { success: true as const, clearedMonths: out.cleared };
  }
}

export type { UnitBranch };