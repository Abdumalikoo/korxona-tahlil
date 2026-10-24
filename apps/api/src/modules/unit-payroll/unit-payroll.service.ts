import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { createHash, randomUUID } from 'node:crypto';
import { entryUnitLabel, isSegment } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Bo'lim (yo'nalish) ish haqi — masalan, Xarajatlar › Tax free › Ish haqi.
//
// Umumiy vedomostdan ALOHIDA:
//  • Shablon — avvalgidek: 1-varaq «Ish haqi» (PINFL, Summa), 2-varaq — FAQAT shu bo'lim xodimlari.
//  • Bo'lim xodimlari ro'yxatini tizim o'zi yuritadi («miya»): vedomostda yangi PINFL kelsa — saqlanganda
//    ro'yxatga qo'shiladi va keyingi shablonning 2-varag'ida chiqadi. Qo'lda qo'shish / chiqarish ham bor.
//  • Saqlanganda — bitta xarajat yozuvi: shu yo'nalish (segment), modda «Ish haqi» (PAYROLL_BASE).
//  • Bazaga migratsiya kerak emas: ro'yxat va vedomost tafsiloti `settings` jadvalida.
// ═══════════════════════════════════════════════════════════

const STAFF_KEY = 'unit.staff';
const PAYROLL_CATEGORY = 'PAYROLL_BASE';
const TASHKENT_OFFSET_HOURS = 5;
const MAX_ROWS = 5000;

export interface StaffItem {
  pinfl: string;
  fullName: string;
  position: string | null;
  /** Faol — shablonning 2-varag'ida chiqadi */
  active: boolean;
  addedAt: string;
  /** Qanday qo'shilgan: vedomostdan (avtomatik) yoki qo'lda */
  source: 'UPLOAD' | 'MANUAL';
  leftAt: string | null;
}

export interface UnitPayrollRow {
  pinfl: string;
  fullName: string;
  amountTiyin: string;
}

export interface UnitPayrollBatch {
  id: string;
  period: string;
  fileName: string;
  fileHash: string;
  status: 'COMMITTED' | 'CANCELLED';
  createdAt: string;
  cancelledAt: string | null;
  uploadedById: string;
  uploadedBy: string;
  totalTiyin: string;
  count: number;
  zeroCount: number;
  /** Shu yuklashdan qo'shilgan yangi xodimlar soni */
  newStaff: number;
  expenseId: string | null;
  rows: UnitPayrollRow[];
}

/** Tahlilda qator holati */
export type RowStatus = 'KNOWN' | 'RETURNING' | 'REGISTRY' | 'NEW';

const payrollKey = (unit: string, period: string) => `unit.payroll.${unit}.${period}`;

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object') {
    const record = value as unknown as Record<string, unknown>;
    if ('result' in record) return record.result;
    if ('text' in record) return record.text;
    if ('richText' in record && Array.isArray(record.richText)) return (record.richText as { text: string }[]).map((p) => p.text).join('');
  }
  return value;
}

const isBlank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

function parsePinfl(v: unknown): string | null {
  if (isBlank(v)) return null;
  const digits = String(v).replace(/\D/g, '');
  return /^\d{14}$/.test(digits) ? digits : null;
}

/** Bo'sh yoki 0 — hisoblanmagan (0). Manfiy yoki matn — null (xato) */
function parseAmount(v: unknown): bigint | null {
  if (isBlank(v)) return 0n;
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? BigInt(Math.round(v * 100)) : null;
  const n = Number(String(v).replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? BigInt(Math.round(n * 100)) : null;
}

function cleanName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length >= 3 && s.length <= 150 ? s : null;
}

function cleanPosition(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 120) : null;
}

function readStaff(raw: unknown): StaffItem[] {
  if (!Array.isArray(raw)) return [];
  const out: StaffItem[] = [];
  const seen = new Set<string>();
  for (const r of raw as Partial<StaffItem>[]) {
    if (!r || typeof r.pinfl !== 'string' || !/^\d{14}$/.test(r.pinfl) || seen.has(r.pinfl)) continue;
    seen.add(r.pinfl);
    out.push({
      pinfl: r.pinfl,
      fullName: typeof r.fullName === 'string' && r.fullName ? r.fullName : r.pinfl,
      position: typeof r.position === 'string' ? r.position : null,
      active: r.active !== false,
      addedAt: typeof r.addedAt === 'string' ? r.addedAt : new Date(0).toISOString(),
      source: r.source === 'MANUAL' ? 'MANUAL' : 'UPLOAD',
      leftAt: typeof r.leftAt === 'string' ? r.leftAt : null,
    });
  }
  return out;
}

function readBatches(raw: unknown): UnitPayrollBatch[] {
  const list = (raw as { batches?: unknown } | null)?.batches;
  return Array.isArray(list) ? (list as UnitPayrollBatch[]) : [];
}

@Injectable()
export class UnitPayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ═══════════ Yordamchilar ═══════════

  unitOf(raw: unknown): string {
    if (isSegment(raw)) return raw;
    throw new BadRequestException("Bo'lim noto'g'ri — ish haqi faqat yo'nalishlar (Tax free …) uchun");
  }

  private assertPeriod(period: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) throw new BadRequestException("Davr noto'g'ri formatda (YYYY-MM)");
  }

  /** Davr oxirgi kuni — xarajat sanasi */
  private periodEndDate(period: string): Date {
    const [y, m] = period.split('-').map(Number) as [number, number];
    const ny = m === 12 ? y + 1 : y;
    const nm = m === 12 ? 1 : m + 1;
    return new Date(Date.UTC(ny, nm - 1, 1, -TASHKENT_OFFSET_HOURS) - 86_400_000);
  }

  private async readSetting(key: string): Promise<unknown> {
    return (await this.prisma.setting.findUnique({ where: { key } }))?.value ?? null;
  }

  private async writeSetting(key: string, value: unknown): Promise<void> {
    const v = value as object;
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  }

  async staffOf(unit: string): Promise<StaffItem[]> {
    const all = ((await this.readSetting(STAFF_KEY)) ?? {}) as Record<string, unknown>;
    return readStaff(all[unit]);
  }

  private async saveStaff(unit: string, items: StaffItem[]): Promise<void> {
    const all = { ...(((await this.readSetting(STAFF_KEY)) ?? {}) as Record<string, unknown>) };
    all[unit] = items;
    await this.writeSetting(STAFF_KEY, all);
  }

  private async batchesOf(unit: string, period: string): Promise<UnitPayrollBatch[]> {
    return readBatches(await this.readSetting(payrollKey(unit, period)));
  }

  /**
   * Shu oy saqlangan vedomost(lar) bo'yicha xodim → summa (ish haqi tarkibi bilan solishtirish uchun).
   * Saqlangan vedomost yo'q bo'lsa — null.
   */
  async payrollMap(unit: string, period: string): Promise<Map<string, bigint> | null> {
    this.assertPeriod(period);
    const committed = (await this.batchesOf(unit, period)).filter((b) => b.status === 'COMMITTED');
    if (!committed.length) return null;
    const map = new Map<string, bigint>();
    for (const b of committed) for (const r of b.rows ?? []) map.set(r.pinfl, (map.get(r.pinfl) ?? 0n) + BigInt(r.amountTiyin));
    return map;
  }

  /** Xodimlar bazasidagi (umumiy reestr) ismlar — bo'lsa */
  private async registryNames(pinfls: string[]): Promise<Map<string, { fullName: string; position: string | null }>> {
    if (!pinfls.length) return new Map();
    const rows = await this.prisma.employee.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, fullName: true, position: true } });
    return new Map(rows.map((r) => [r.pinfl, { fullName: r.fullName, position: r.position ?? null }]));
  }

  // ═══════════ Xodimlar ro'yxati ═══════════

  async staff(unit: string) {
    const items = await this.staffOf(unit);
    const names = await this.registryNames(items.map((i) => i.pinfl));
    const rows = items
      .map((i) => ({ ...i, fullName: names.get(i.pinfl)?.fullName ?? i.fullName, position: i.position ?? names.get(i.pinfl)?.position ?? null, inRegistry: names.has(i.pinfl) }))
      .sort((a, b) => Number(b.active) - Number(a.active) || a.fullName.localeCompare(b.fullName));
    return { unit, label: entryUnitLabel(unit), active: rows.filter((r) => r.active).length, total: rows.length, items: rows };
  }

  /** PINFL bo'yicha: ro'yxatda bormi, umumiy bazada ismi */
  async lookup(unit: string, pinflRaw: string) {
    const pinfl = parsePinfl(pinflRaw);
    if (!pinfl) throw new BadRequestException("PINFL 14 ta raqam bo'lishi kerak");
    const own = (await this.staffOf(unit)).find((s) => s.pinfl === pinfl) ?? null;
    const reg = (await this.registryNames([pinfl])).get(pinfl) ?? null;
    return { pinfl, inStaff: Boolean(own), active: own?.active ?? false, fullName: reg?.fullName ?? own?.fullName ?? null, position: reg?.position ?? own?.position ?? null, inRegistry: Boolean(reg) };
  }

  async addStaff(unit: string, body: { pinfl?: unknown; fullName?: unknown; position?: unknown }, userId: string) {
    const pinfl = parsePinfl(body?.pinfl);
    if (!pinfl) throw new BadRequestException("PINFL 14 ta raqam bo'lishi kerak");
    const items = await this.staffOf(unit);
    const reg = (await this.registryNames([pinfl])).get(pinfl);
    const fullName = cleanName(body?.fullName) ?? reg?.fullName ?? null;
    if (!fullName) throw new BadRequestException("F.I.Sh. kiriting (kamida 3 harf) — bu PINFL xodimlar bazasida yo'q");
    const position = cleanPosition(body?.position) ?? reg?.position ?? null;
    const now = new Date().toISOString();
    const existing = items.find((s) => s.pinfl === pinfl);
    if (existing?.active) throw new BadRequestException(`${existing.fullName} — ro'yxatda allaqachon bor`);
    if (existing) Object.assign(existing, { active: true, leftAt: null, fullName, position });
    else items.push({ pinfl, fullName, position, active: true, addedAt: now, source: 'MANUAL', leftAt: null });
    await this.saveStaff(unit, items);
    await this.audit.log({ userId, action: 'CREATE', entity: 'unit_staff', entityId: `${unit}:${pinfl}`, summary: `${entryUnitLabel(unit)} xodimlari: + ${fullName}` });
    return this.staff(unit);
  }

  /** Ro'yxatdan chiqarish (ishdan ketgan) yoki qaytarish; ism / lavozimni tuzatish */
  async updateStaff(unit: string, pinflRaw: string, body: { active?: unknown; fullName?: unknown; position?: unknown }, userId: string) {
    const pinfl = parsePinfl(pinflRaw);
    const items = await this.staffOf(unit);
    const item = pinfl ? items.find((s) => s.pinfl === pinfl) : undefined;
    if (!item) throw new NotFoundException("Xodim bo'lim ro'yxatida topilmadi");
    const changes: string[] = [];
    if (typeof body?.active === 'boolean' && body.active !== item.active) {
      item.active = body.active;
      item.leftAt = body.active ? null : new Date().toISOString();
      changes.push(body.active ? 'qaytarildi' : 'chiqarildi');
    }
    if (body?.fullName !== undefined) {
      const name = cleanName(body.fullName);
      if (!name) throw new BadRequestException("F.I.Sh. kamida 3 harf bo'lsin");
      item.fullName = name;
      changes.push('ism');
    }
    if (body?.position !== undefined) {
      item.position = cleanPosition(body.position);
      changes.push('lavozim');
    }
    if (!changes.length) return this.staff(unit);
    await this.saveStaff(unit, items);
    await this.audit.log({ userId, action: 'UPDATE', entity: 'unit_staff', entityId: `${unit}:${item.pinfl}`, summary: `${entryUnitLabel(unit)} xodimlari: ${item.fullName} — ${changes.join(', ')}` });
    return this.staff(unit);
  }

  // ═══════════ Shablon ═══════════

  async template(unit: string, period: string): Promise<{ buffer: Buffer; filename: string }> {
    this.assertPeriod(period);
    const label = entryUnitLabel(unit);
    const { items } = await this.staff(unit);
    const active = items.filter((i) => i.active);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';

    // 1-varaq — avvalgidek: PINFL va Summa
    const sheet = wb.addWorksheet('Ish haqi', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'PINFL', key: 'pinfl', width: 20 },
      { header: 'Summa', key: 'amount', width: 18 },
    ];
    const h = sheet.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    h.height = 22;
    sheet.getColumn('A').numFmt = '@';
    sheet.getColumn('B').numFmt = '#,##0';

    // 2-varaq — faqat shu bo'lim xodimlari (tizim ro'yxati — yangi xodim qo'shilsa, keyingi shablonda chiqadi)
    const ref = wb.addWorksheet(`${label} xodimlari`.slice(0, 31), { views: [{ state: 'frozen', ySplit: 1 }] });
    ref.columns = [
      { header: '№', key: 'n', width: 6 },
      { header: 'PINFL', key: 'pinfl', width: 20 },
      { header: 'F.I.Sh.', key: 'fullName', width: 42 },
      { header: 'Lavozim', key: 'position', width: 28 },
    ];
    const rh = ref.getRow(1);
    rh.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    rh.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
    rh.height = 22;
    ref.getColumn('B').numFmt = '@';
    active.forEach((s, i) => ref.addRow({ n: i + 1, pinfl: s.pinfl, fullName: s.fullName, position: s.position ?? '' }));
    if (active.length) ref.autoFilter = { from: 'A1', to: `D${ref.rowCount}` };
    else ref.addRow({ n: '', pinfl: '', fullName: `${label} xodimlari hali yo'q — birinchi vedomost saqlanganda ro'yxat o'zi to'ladi` });

    const data = await wb.xlsx.writeBuffer();
    return { buffer: Buffer.from(data), filename: `Ish-haqi-${label.replace(/\s+/g, '-')}-${period}.xlsx` };
  }

  // ═══════════ Tahlil — hech narsa saqlanmaydi ═══════════

  async analyze(unit: string, period: string, file: Express.Multer.File | undefined) {
    this.assertPeriod(period);
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatidagi Excel fayl yuklang");
    }
    const sheet = wb.worksheets[0];
    if (!sheet) throw new BadRequestException('Faylda varaq topilmadi');

    const parsed = new Map<string, { rowIndex: number; amountTiyin: bigint }>();
    const invalidRows: { rowIndex: number; reason: string }[] = [];
    const duplicates = new Set<string>();

    sheet.eachRow((row, rowIndex) => {
      if (rowIndex === 1) return;
      const rawPinfl = cellValue(row.getCell(1).value);
      const rawAmount = cellValue(row.getCell(2).value);
      if (isBlank(rawPinfl) && isBlank(rawAmount)) return;
      const pinfl = parsePinfl(rawPinfl);
      if (!pinfl) return void invalidRows.push({ rowIndex, reason: "PINFL noto'g'ri" });
      const amount = parseAmount(rawAmount);
      if (amount === null) return void invalidRows.push({ rowIndex, reason: "Summa noto'g'ri" });
      const prev = parsed.get(pinfl);
      if (prev) {
        prev.amountTiyin += amount;
        duplicates.add(pinfl);
        return;
      }
      parsed.set(pinfl, { rowIndex, amountTiyin: amount });
    });

    if (parsed.size === 0) throw new BadRequestException('Faylda yaroqli qator topilmadi (1-varaq: A — PINFL, B — Summa)');
    if (parsed.size > MAX_ROWS) throw new BadRequestException(`Qatorlar juda ko'p (${parsed.size}) — ${MAX_ROWS} tagacha`);

    const staff = await this.staffOf(unit);
    const byPinfl = new Map(staff.map((s) => [s.pinfl, s]));
    const names = await this.registryNames([...parsed.keys()]);

    const rows = [...parsed.entries()].map(([pinfl, r]) => {
      const own = byPinfl.get(pinfl);
      const reg = names.get(pinfl);
      const status: RowStatus = own ? (own.active ? 'KNOWN' : 'RETURNING') : reg ? 'REGISTRY' : 'NEW';
      return { rowIndex: r.rowIndex, pinfl, fullName: reg?.fullName ?? own?.fullName ?? null, position: own?.position ?? reg?.position ?? null, amountTiyin: r.amountTiyin.toString(), status };
    });

    const total = rows.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
    const inFile = new Set(parsed.keys());
    const notInFile = staff.filter((s) => s.active && !inFile.has(s.pinfl)).map((s) => ({ pinfl: s.pinfl, fullName: names.get(s.pinfl)?.fullName ?? s.fullName }));
    const previous = (await this.batchesOf(unit, period)).filter((b) => b.status === 'COMMITTED');

    return {
      unit,
      label: entryUnitLabel(unit),
      period,
      fileName: String(file.originalname ?? 'ish-haqi.xlsx').slice(0, 200),
      totalRows: parsed.size + invalidRows.length,
      validRows: rows.length,
      zeroRows: rows.filter((r) => r.amountTiyin === '0').length,
      knownRows: rows.filter((r) => r.status === 'KNOWN').length,
      /** Ro'yxatga yangi qo'shiladiganlar (bazadan topilgan + mutlaqo yangi) va qaytganlar */
      newRows: rows.filter((r) => r.status === 'REGISTRY' || r.status === 'NEW').length,
      returningRows: rows.filter((r) => r.status === 'RETURNING').length,
      /** Ismi noma'lum — saqlashdan oldin F.I.Sh. kiritiladi */
      unnamedRows: rows.filter((r) => !r.fullName).length,
      totalTiyin: total.toString(),
      invalidRows,
      duplicates: [...duplicates],
      notInFile,
      hasPrevious: previous.length > 0,
      previousCount: previous.length,
      previousTiyin: previous.reduce((s, b) => s + BigInt(b.totalTiyin), 0n).toString(),
      rows,
    };
  }

  // ═══════════ Saqlash ═══════════

  async commit(
    unit: string,
    period: string,
    body: { rows?: unknown; fileName?: unknown },
    replacePrevious: boolean,
    userId: string,
  ) {
    this.assertPeriod(period);
    if (!Array.isArray(body?.rows) || body.rows.length === 0) throw new BadRequestException("Saqlash uchun ma'lumot yo'q");
    if (body.rows.length > MAX_ROWS) throw new BadRequestException(`Qatorlar juda ko'p — ${MAX_ROWS} tagacha`);
    const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : 'ish-haqi.xlsx';

    // Qatorlar: PINFL, summa (tiyin), yangi xodim uchun F.I.Sh.
    const merged = new Map<string, { amount: bigint; fullName: string | null }>();
    for (const raw of body.rows as { pinfl?: unknown; amountTiyin?: unknown; fullName?: unknown }[]) {
      const pinfl = parsePinfl(raw?.pinfl);
      if (!pinfl) throw new BadRequestException(`Noto'g'ri PINFL: ${String(raw?.pinfl ?? '').slice(0, 20)}`);
      let amount: bigint;
      try {
        amount = BigInt(String(raw?.amountTiyin ?? '0'));
      } catch {
        throw new BadRequestException(`Noto'g'ri summa: ${pinfl}`);
      }
      if (amount < 0n) throw new BadRequestException(`Manfiy summa: ${pinfl}`);
      const prev = merged.get(pinfl);
      merged.set(pinfl, { amount: (prev?.amount ?? 0n) + amount, fullName: cleanName(raw?.fullName) ?? prev?.fullName ?? null });
    }

    const pinfls = [...merged.keys()];
    const staff = await this.staffOf(unit);
    const byPinfl = new Map(staff.map((s) => [s.pinfl, s]));
    const names = await this.registryNames(pinfls);

    const unnamed = pinfls.filter((p) => !byPinfl.has(p) && !names.has(p) && !merged.get(p)!.fullName);
    if (unnamed.length) {
      throw new BadRequestException(`${unnamed.length} ta yangi xodimning F.I.Sh. kiritilmagan: ${unnamed.slice(0, 5).join(', ')}${unnamed.length > 5 ? ' …' : ''}`);
    }

    const rows: UnitPayrollRow[] = pinfls.map((p) => ({
      pinfl: p,
      fullName: names.get(p)?.fullName ?? merged.get(p)!.fullName ?? byPinfl.get(p)?.fullName ?? p,
      amountTiyin: merged.get(p)!.amount.toString(),
    }));
    const total = rows.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
    const paid = rows.filter((r) => r.amountTiyin !== '0').length;
    const fileHash = createHash('sha256')
      .update(`${unit}:${period}:${JSON.stringify(rows.map((r) => [r.pinfl, r.amountTiyin]).sort())}`)
      .digest('hex');

    const key = payrollKey(unit, period);
    const label = entryUnitLabel(unit);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);

    const result = await this.prisma.$transaction(
      async (tx) => {
        const batches = readBatches((await tx.setting.findUnique({ where: { key } }))?.value ?? null);
        const committed = batches.filter((b) => b.status === 'COMMITTED');
        const now = new Date().toISOString();
        let replaced = 0;

        if (replacePrevious) {
          const ids = committed.map((b) => b.expenseId).filter((id): id is string => Boolean(id));
          if (ids.length) await tx.expense.updateMany({ where: { id: { in: ids }, deletedAt: null }, data: { deletedAt: new Date() } });
          for (const b of committed) {
            b.status = 'CANCELLED';
            b.cancelledAt = now;
          }
          replaced = committed.length;
        } else if (committed.some((b) => b.fileHash === fileHash)) {
          throw new BadRequestException("Bu vedomost shu oy uchun allaqachon saqlangan (xuddi shu ma'lumotlar). Ikki marta yozilmaydi");
        }

        let expenseId: string | null = null;
        if (total > 0n) {
          const expense = await tx.expense.create({
            data: {
              date: this.periodEndDate(period),
              period,
              amountTiyin: total,
              categoryCode: PAYROLL_CATEGORY,
              segment: unit,
              regionCode: null,
              departmentId: null,
              description: `Ish haqi — ${label} (${paid} xodim)`,
              documentNo: fileName.slice(0, 100),
              paymentMethod: 'BANK',
              paymentStatus: 'PAID',
              source: 'IMPORT',
              section: 'DOIMIY',
              createdById: userId,
            },
            select: { id: true },
          });
          expenseId = expense.id;
        }

        // «Miya»: yangi PINFL'lar bo'lim ro'yxatiga, ketgan deb belgilanganlar qaytadi
        let newStaff = 0;
        let returned = 0;
        for (const r of rows) {
          const own = byPinfl.get(r.pinfl);
          if (!own) {
            staff.push({ pinfl: r.pinfl, fullName: r.fullName, position: names.get(r.pinfl)?.position ?? null, active: true, addedAt: now, source: 'UPLOAD', leftAt: null });
            newStaff += 1;
          } else if (!own.active) {
            own.active = true;
            own.leftAt = null;
            returned += 1;
          }
        }

        const batch: UnitPayrollBatch = {
          id: randomUUID(),
          period,
          fileName,
          fileHash,
          status: 'COMMITTED',
          createdAt: now,
          cancelledAt: null,
          uploadedById: userId,
          uploadedBy: user?.fullName ?? '',
          totalTiyin: total.toString(),
          count: rows.length,
          zeroCount: rows.length - paid,
          newStaff,
          expenseId,
          rows,
        };
        const value = { batches: [...batches, batch] } as object;
        await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });

        const allStaff = { ...((((await tx.setting.findUnique({ where: { key: STAFF_KEY } }))?.value ?? {}) as Record<string, unknown>)) };
        allStaff[unit] = staff;
        await tx.setting.upsert({ where: { key: STAFF_KEY }, create: { key: STAFF_KEY, value: allStaff as object }, update: { value: allStaff as object } });

        return { batchId: batch.id, expenseId, replaced, newStaff, returned };
      },
      { timeout: 60_000 },
    );

    await this.audit.log({
      userId,
      action: 'CREATE',
      entity: 'unit_payroll',
      entityId: `${unit}:${period}:${result.batchId}`,
      summary: `${label} ish haqi ${period}: ${rows.length} xodim, ${(Number(total) / 100).toLocaleString('uz-UZ')} so'm${result.newStaff ? `, ${result.newStaff} yangi xodim` : ''}${result.replaced ? `, ${result.replaced} ta oldingisi almashtirildi` : ''}`,
    });

    return {
      success: true as const,
      batchId: result.batchId,
      expenseCreated: result.expenseId !== null,
      employees: rows.length,
      zeroCount: rows.length - paid,
      totalTiyin: total.toString(),
      newStaff: result.newStaff,
      returned: result.returned,
      replacedPrevious: result.replaced > 0,
    };
  }

  // ═══════════ Tarix va bekor qilish ═══════════

  async batches(unit: string, period: string) {
    this.assertPeriod(period);
    const list = await this.batchesOf(unit, period);
    return [...list]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ rows, fileHash: _h, ...b }) => ({ ...b, rowsCount: rows.length }));
  }

  async batch(unit: string, period: string, id: string) {
    this.assertPeriod(period);
    const b = (await this.batchesOf(unit, period)).find((x) => x.id === id);
    if (!b) throw new NotFoundException('Yuklash topilmadi');
    const { fileHash: _h, ...rest } = b;
    return rest;
  }

  async cancel(unit: string, period: string, id: string, userId: string) {
    this.assertPeriod(period);
    const key = payrollKey(unit, period);
    const out = await this.prisma.$transaction(async (tx) => {
      const batches = readBatches((await tx.setting.findUnique({ where: { key } }))?.value ?? null);
      const b = batches.find((x) => x.id === id);
      if (!b) throw new NotFoundException('Yuklash topilmadi');
      if (b.status !== 'COMMITTED') throw new BadRequestException('Bu yuklash allaqachon bekor qilingan');
      if (b.expenseId) await tx.expense.updateMany({ where: { id: b.expenseId, deletedAt: null }, data: { deletedAt: new Date() } });
      b.status = 'CANCELLED';
      b.cancelledAt = new Date().toISOString();
      const value = { batches } as object;
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      return b;
    });
    await this.audit.log({ userId, action: 'DELETE', entity: 'unit_payroll', entityId: `${unit}:${period}:${id}`, summary: `${entryUnitLabel(unit)} ish haqi ${period} bekor qilindi: ${out.fileName}` });
    return { success: true as const, id };
  }
}