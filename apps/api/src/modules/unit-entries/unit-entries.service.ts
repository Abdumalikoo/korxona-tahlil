import { BadRequestException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { entryUnitLabel, isSegment } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { unitBranches } from '../unit-lease/unit-lease.branches';
import { monthLabel, monthsBetween } from '../unit-lease/unit-lease.service';

// ═══════════════════════════════════════════════════════════
// Yo'nalish xarajatlari — qo'lda kiritish jadvali (Tax free › Asosiy vositalar / Reklama / Boshqa; Fermer › Asosiy vositalar / TMZ / Boshqa).
//
//  • Jadvalda to'g'ridan-to'g'ri yoziladi: qator qo'shish, tahrirlash, o'chirish; Excel'dan nusxa olib qo'yish;
//    shablon (Filial — ro'yxatdan tanlanadi) → to'ldirib yuklash; Excel'ga yuklab olish.
//  • Har qator — bitta xarajat yozuvi (yo'nalish, o'z moddasi). Qator o'zgarsa — xarajat ham; o'chirilsa — savatga.
//  • Asosiy vositalar va TMZda: soni × narxi = summa (summa qo'lda ham yozilishi mumkin).
//  • Qator tafsiloti (filial, soni, narxi, izoh) `settings`da («unit.entries.<BO'LIM>.<TUR>») — migratsiya kerak emas.
//  • Xarajatlar bo'limida o'chirilgan yozuv bu jadvalda ko'rinmaydi (savatdan tiklansa — qaytadi).
// ═══════════════════════════════════════════════════════════

const TASHKENT_OFFSET_HOURS = 5;
const MAX_ROWS_PER_SAVE = 2000;

export const ENTRY_KINDS = {
  ASSET: { label: 'Asosiy vositalar', category: 'UNIT_ASSET', categoryLabel: 'Asosiy vositalar (xarid)', qty: true },
  AD: { label: 'Reklama xarajatlari', category: 'REKLAMA', categoryLabel: 'Reklama xarajatlari', qty: false },
  OTHER: { label: 'Boshqa xarajatlar', category: 'UNIT_OTHER', categoryLabel: 'Boshqa xarajatlar', qty: false },
  TMZ: { label: 'TMZ', category: 'UNIT_TMZ', categoryLabel: 'TMZ (tovar-moddiy zaxiralar)', qty: true },
} as const;
export type EntryKindCode = keyof typeof ENTRY_KINDS;

export interface EntryRow {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  name: string;
  /** Filial kodi (TF01 …) yoki null */
  branch: string | null;
  counterparty: string | null;
  docNo: string | null;
  qty: number | null;
  priceTiyin: string | null;
  amountTiyin: string;
  note: string | null;
  expenseId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EntryInput {
  id?: unknown;
  date?: unknown;
  name?: unknown;
  branch?: unknown;
  counterparty?: unknown;
  docNo?: unknown;
  qty?: unknown;
  priceTiyin?: unknown;
  amountTiyin?: unknown;
  note?: unknown;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = DATE_RE.exec(v.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === v.trim() ? v.trim() : null;
}

const str = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const r = value as unknown as Record<string, unknown>;
    if ('result' in r) return r.result;
    if ('text' in r) return r.text;
    if ('richText' in r && Array.isArray(r.richText)) return (r.richText as { text: string }[]).map((p) => p.text).join('');
    if ('formula' in r) return null;
  }
  return value;
}

/** Excel katagi → so'm (son) yoki null (bo'sh) yoki NaN (xato) */
function num(v: unknown): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  const n = Number(String(v).replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/** Excel sana: Date, seriya raqami, «05.01.2026» yoki «2026-01-05» */
function excelDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86_400_000)).toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  const a = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (a) return validDate(`${a[3]}-${a[2]!.padStart(2, '0')}-${a[1]!.padStart(2, '0')}`);
  return validDate(s.slice(0, 10));
}

const norm = (s: string) => s.toLowerCase().replace(/[«»"'`ʻʼ‘’“”]/g, '').replace(/\s+/g, ' ').trim();

@Injectable()
export class UnitEntriesService implements OnModuleInit {
  private readonly logger = new Logger(UnitEntriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Moddalar bo'lmasa — yaratiladi (bor bo'lsa tegilmaydi) */
  async onModuleInit(): Promise<void> {
    for (const k of Object.values(ENTRY_KINDS)) {
      await this.prisma.category
        .upsert({ where: { code: k.category }, update: {}, create: { code: k.category, label: k.categoryLabel, order: 70 } })
        .catch((e: unknown) => this.logger.warn(`«${k.categoryLabel}» moddasini tekshirib bo'lmadi: ${String(e)}`));
    }
  }

  unitOf(raw: unknown): string {
    if (isSegment(raw)) return raw;
    throw new BadRequestException("Bo'lim noto'g'ri");
  }

  kindOf(raw: unknown): EntryKindCode {
    if (typeof raw === 'string' && raw in ENTRY_KINDS) return raw as EntryKindCode;
    throw new BadRequestException("Tur noto'g'ri (ASSET, AD, OTHER, TMZ)");
  }

  private key(unit: string, kind: EntryKindCode) {
    return `unit.entries.${unit}.${kind}`;
  }

  private read(value: unknown): EntryRow[] {
    const rows = (value as { rows?: unknown } | null)?.rows;
    return Array.isArray(rows) ? (rows as EntryRow[]) : [];
  }

  private dayDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d, -TASHKENT_OFFSET_HOURS));
  }

  private branchName(unit: string, code: string | null): string | null {
    return code ? (unitBranches(unit).find((b) => b.code === code)?.name ?? null) : null;
  }

  private description(unit: string, r: Pick<EntryRow, 'name' | 'branch' | 'qty' | 'note'>, kind: EntryKindCode): string {
    const branch = this.branchName(unit, r.branch);
    return [r.name, ENTRY_KINDS[kind].qty && r.qty && r.qty !== 1 ? `${r.qty} dona` : null, branch, r.note].filter(Boolean).join(' — ').slice(0, 500);
  }

  // ═══════════ Ko'rish ═══════════

  meta(unit: string, kind: EntryKindCode) {
    const k = ENTRY_KINDS[kind];
    return { unit, unitLabel: entryUnitLabel(unit), kind, label: k.label, qty: k.qty, category: k.category, branches: unitBranches(unit).map((b) => ({ code: b.code, no: b.no, name: b.name })) };
  }

  async list(unit: string, kind: EntryKindCode, from: string, to: string) {
    const months = monthsBetween(from, to);
    const lo = `${months[0]}-01`;
    const hi = `${months[months.length - 1]}-31`;
    const all = this.read((await this.prisma.setting.findUnique({ where: { key: this.key(unit, kind) } }))?.value ?? null);
    const inRange = all.filter((r) => r.date >= lo && r.date <= hi);
    const ids = inRange.map((r) => r.expenseId).filter((x): x is string => Boolean(x));
    const alive = new Set(ids.length ? (await this.prisma.expense.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } })).map((e) => e.id) : []);
    const rows = inRange.filter((r) => r.expenseId && alive.has(r.expenseId)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const byMonth = months.map((p) => {
      const list = rows.filter((r) => r.date.startsWith(p));
      return { period: p, label: monthLabel(p), count: list.length, totalTiyin: list.reduce((s, r) => s + BigInt(r.amountTiyin), 0n).toString() };
    });
    return {
      ...this.meta(unit, kind),
      from: months[0],
      to: months[months.length - 1],
      rows,
      /** Xarajatlar bo'limida o'chirilgani (savatda) — bu yerda ko'rinmaydi */
      deletedElsewhere: inRange.length - rows.length,
      byMonth,
      totalTiyin: rows.reduce((s, r) => s + BigInt(r.amountTiyin), 0n).toString(),
    };
  }

  // ═══════════ Saqlash (qo'shish va tahrirlash) ═══════════

  /** Kiritilgan qatorni tekshirish: xatolar ro'yxati yoki tayyor qiymatlar */
  private clean(unit: string, kind: EntryKindCode, raw: EntryInput): { ok: Omit<EntryRow, 'id' | 'expenseId' | 'createdAt' | 'updatedAt'> | null; errors: string[] } {
    const errors: string[] = [];
    const date = validDate(raw?.date);
    if (!date) errors.push("Sana noto'g'ri");
    else if (date > new Date(Date.now() + 86_400_000 * 1).toISOString().slice(0, 10)) errors.push('Kelajak sanasi');
    const name = str(raw?.name, 300);
    if (!name || name.length < 2) errors.push('Nomi yozilmagan');
    const branchRaw = str(raw?.branch, 20);
    const branches = unitBranches(unit);
    const branch = branchRaw && branches.length ? (branches.find((b) => b.code === branchRaw)?.code ?? null) : null;
    if (branchRaw && branches.length && !branch) errors.push("Filial noto'g'ri");
    let qty: number | null = null;
    let price: bigint | null = null;
    if (ENTRY_KINDS[kind].qty) {
      const q = raw?.qty === null || raw?.qty === undefined || raw?.qty === '' ? null : Number(raw.qty);
      if (q !== null && (!Number.isFinite(q) || q <= 0 || q > 1_000_000)) errors.push("Soni noto'g'ri");
      else qty = q;
      if (raw?.priceTiyin !== null && raw?.priceTiyin !== undefined && raw?.priceTiyin !== '') {
        try {
          price = BigInt(String(raw.priceTiyin));
          if (price < 0n) errors.push('Narx manfiy');
        } catch {
          errors.push("Narx noto'g'ri");
        }
      }
    }
    let amount: bigint | null = null;
    if (raw?.amountTiyin !== null && raw?.amountTiyin !== undefined && raw?.amountTiyin !== '') {
      try {
        amount = BigInt(String(raw.amountTiyin));
      } catch {
        errors.push("Summa noto'g'ri");
      }
    }
    // Asosiy vositada: summa bo'sh bo'lsa — soni × narxi
    if (amount === null && price !== null) amount = BigInt(Math.round(Number(price) * (qty ?? 1)));
    if (amount === null || amount <= 0n) errors.push("Summa 0 dan katta bo'lsin");
    if (amount !== null && amount > 10n ** 17n) errors.push('Summa juda katta');
    if (errors.length) return { ok: null, errors };
    return {
      ok: {
        date: date!,
        name: name!,
        branch,
        counterparty: str(raw?.counterparty, 200),
        docNo: str(raw?.docNo, 100),
        qty,
        priceTiyin: price === null ? null : price.toString(),
        amountTiyin: amount!.toString(),
        note: str(raw?.note, 500),
      },
      errors,
    };
  }

  /**
   * Qatorlarni saqlash: id bo'lsa — tahrirlash, bo'lmasa — yangi. Hammasi to'g'ri bo'lsagina saqlanadi
   * (xato bo'lsa — qaysi qatorda nima xato ekani qaytadi, hech narsa yozilmaydi).
   */
  async save(unit: string, kind: EntryKindCode, body: { rows?: unknown }, userId: string) {
    if (!Array.isArray(body?.rows) || !body.rows.length) throw new BadRequestException("Saqlash uchun qator yo'q");
    if (body.rows.length > MAX_ROWS_PER_SAVE) throw new BadRequestException(`Bir martada ${MAX_ROWS_PER_SAVE} qatordan ko'p emas`);
    const inputs = body.rows as EntryInput[];
    const cleaned = inputs.map((r, i) => ({ i, id: typeof r?.id === 'string' && r.id ? r.id : null, ...this.clean(unit, kind, r) }));
    const bad = cleaned.filter((c) => c.errors.length);
    if (bad.length) {
      throw new BadRequestException({ message: `${bad.length} ta qatorda xato: ${bad.slice(0, 3).map((b) => `${b.i + 1}-qator — ${b.errors.join(', ')}`).join('; ')}`, details: { rows: bad.map((b) => ({ index: b.i, errors: b.errors })) } });
    }
    const k = ENTRY_KINDS[kind];
    const key = this.key(unit, kind);
    const now = new Date().toISOString();
    const result = await this.prisma.$transaction(
      async (tx) => {
        const rows = this.read((await tx.setting.findUnique({ where: { key } }))?.value ?? null);
        const byId = new Map(rows.map((r) => [r.id, r]));
        let created = 0;
        let updated = 0;
        const saved: EntryRow[] = [];
        for (const c of cleaned) {
          const v = c.ok!;
          const data = {
            date: this.dayDate(v.date),
            period: v.date.slice(0, 7),
            amountTiyin: BigInt(v.amountTiyin),
            categoryCode: k.category,
            segment: unit,
            regionCode: null,
            departmentId: null,
            description: this.description(unit, v, kind),
            counterparty: v.counterparty,
            documentNo: v.docNo,
          };
          const existing = c.id ? byId.get(c.id) : undefined;
          if (existing) {
            let expenseId = existing.expenseId;
            const alive = expenseId ? await tx.expense.findFirst({ where: { id: expenseId, deletedAt: null }, select: { id: true } }) : null;
            if (alive) await tx.expense.update({ where: { id: alive.id }, data });
            else expenseId = (await tx.expense.create({ data: { ...data, paymentMethod: 'BANK', paymentStatus: 'PAID', source: 'MANUAL', section: 'BOSHQA', createdById: userId }, select: { id: true } })).id;
            Object.assign(existing, v, { expenseId, updatedAt: now });
            saved.push(existing);
            updated += 1;
          } else {
            const e = await tx.expense.create({ data: { ...data, paymentMethod: 'BANK', paymentStatus: 'PAID', source: 'MANUAL', section: 'BOSHQA', createdById: userId }, select: { id: true } });
            const row: EntryRow = { id: randomUUID(), ...v, expenseId: e.id, createdAt: now, updatedAt: now };
            rows.push(row);
            byId.set(row.id, row);
            saved.push(row);
            created += 1;
          }
        }
        const value = { rows } as object;
        await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
        return { created, updated, saved };
      },
      { timeout: 120_000 },
    );
    const total = result.saved.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
    await this.audit.log({
      userId,
      action: result.created ? 'CREATE' : 'UPDATE',
      entity: 'unit_entries',
      entityId: `${unit}:${kind}`,
      summary: `${entryUnitLabel(unit)} › ${k.label}: ${result.created ? `+${result.created} ta` : ''}${result.created && result.updated ? ', ' : ''}${result.updated ? `${result.updated} ta tahrirlandi` : ''} — ${(Number(total) / 100).toLocaleString('uz-UZ')} so'm`,
    });
    return { created: result.created, updated: result.updated, rows: result.saved };
  }

  /** O'chirish: qatorlar olib tashlanadi, xarajatlari savatga tushadi */
  async remove(unit: string, kind: EntryKindCode, body: { ids?: unknown }, userId: string) {
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === 'string'))] : [];
    if (!ids.length) throw new BadRequestException('Hech narsa belgilanmagan');
    const key = this.key(unit, kind);
    const out = await this.prisma.$transaction(async (tx) => {
      const rows = this.read((await tx.setting.findUnique({ where: { key } }))?.value ?? null);
      const drop = rows.filter((r) => ids.includes(r.id));
      const expenseIds = drop.map((r) => r.expenseId).filter((x): x is string => Boolean(x));
      if (expenseIds.length) await tx.expense.updateMany({ where: { id: { in: expenseIds }, deletedAt: null }, data: { deletedAt: new Date() } });
      const value = { rows: rows.filter((r) => !ids.includes(r.id)) } as object;
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      return { count: drop.length, total: drop.reduce((s, r) => s + BigInt(r.amountTiyin), 0n) };
    });
    await this.audit.log({ userId, action: 'DELETE', entity: 'unit_entries', entityId: `${unit}:${kind}`, summary: `${entryUnitLabel(unit)} › ${ENTRY_KINDS[kind].label}: ${out.count} ta o'chirildi (${(Number(out.total) / 100).toLocaleString('uz-UZ')} so'm)` });
    return { count: out.count };
  }

  // ═══════════ Excel: shablon, yuklash, yuklab olish ═══════════

  private columns(kind: EntryKindCode, hasBranches: boolean) {
    const cols: { key: string; header: string; width: number }[] = [
      { key: 'date', header: 'Sana', width: 13 },
      { key: 'name', header: 'Nomi', width: 40 },
    ];
    if (hasBranches) cols.push({ key: 'branch', header: 'Filial', width: 44 });
    cols.push({ key: 'counterparty', header: 'Kontragent', width: 28 }, { key: 'docNo', header: 'Hujjat №', width: 14 });
    if (ENTRY_KINDS[kind].qty) cols.push({ key: 'qty', header: 'Soni', width: 9 }, { key: 'price', header: 'Narxi', width: 16 });
    cols.push({ key: 'amount', header: 'Summa', width: 16 }, { key: 'note', header: 'Izoh', width: 30 });
    return cols;
  }

  private async book(unit: string, kind: EntryKindCode, rows: EntryRow[]): Promise<Buffer> {
    const branches = unitBranches(unit);
    const cols = this.columns(kind, branches.length > 0);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const ws = wb.addWorksheet('Kiritish', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map((c) => ({ header: c.header, key: c.key, width: c.width }));
    const h = ws.getRow(1);
    h.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    h.height = 22;
    for (const r of rows) {
      ws.addRow({
        date: new Date(`${r.date}T00:00:00Z`),
        name: r.name,
        branch: this.branchName(unit, r.branch) ?? '',
        counterparty: r.counterparty ?? '',
        docNo: r.docNo ?? '',
        qty: r.qty ?? null,
        price: r.priceTiyin ? Number(r.priceTiyin) / 100 : null,
        amount: Number(r.amountTiyin) / 100,
        note: r.note ?? '',
      });
    }
    const idx = (k: string) => cols.findIndex((c) => c.key === k) + 1;
    ws.getColumn(idx('date')).numFmt = 'dd.mm.yyyy';
    ws.getColumn(idx('amount')).numFmt = '#,##0.00';
    if (ENTRY_KINDS[kind].qty) ws.getColumn(idx('price')).numFmt = '#,##0.00';
    const last = Math.max(ws.rowCount, 1) + 300;
    if (branches.length) {
      const ref = wb.addWorksheet('Filiallar');
      ref.columns = [
        { header: '№', key: 'no', width: 5 },
        { header: 'Filial', key: 'name', width: 80 },
      ];
      ref.getRow(1).font = { bold: true };
      branches.forEach((b) => ref.addRow({ no: b.no, name: b.name }));
      const col = ws.getColumn(idx('branch')).letter;
      for (let r = 2; r <= last; r++) {
        ws.getCell(`${col}${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`Filiallar!$B$2:$B$${branches.length + 1}`], showErrorMessage: true, errorTitle: 'Filial', error: "Ro'yxatdan tanlang" };
      }
    }
    for (let r = 2; r <= last; r++) {
      ws.getCell(r, idx('date')).dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2015, 0, 1))], showErrorMessage: true, errorTitle: 'Sana', error: 'Sana kiriting (kk.oo.yyyy)' };
    }
    const help = wb.addWorksheet("Yo'riqnoma");
    help.getColumn(1).width = 110;
    [
      `${entryUnitLabel(unit)} — ${ENTRY_KINDS[kind].label}`,
      '',
      "• «Kiritish» varag'ida har qator — bitta xarajat. Majburiy: Sana, Nomi, Summa" + (ENTRY_KINDS[kind].qty ? " (yoki Soni va Narxi — summa o'zi hisoblanadi)." : '.'),
      branches.length ? "• Filial — ro'yxatdan tanlanadi (katakni bosing)." : '',
      "• Summalar so'mda. Sarlavhalarni o'zgartirmang.",
      "• Yuklanganda qatorlar jadvalga qo'shiladi — tekshirib «Saqlash» bosiladi.",
    ]
      .filter((t, i) => t || i === 1)
      .forEach((t, i) => {
        help.getCell(i + 1, 1).value = t;
        if (i === 0) help.getCell(1, 1).font = { bold: true, size: 12 };
      });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  async template(unit: string, kind: EntryKindCode) {
    const label = `${entryUnitLabel(unit)}-${ENTRY_KINDS[kind].label}`.replace(/\s+/g, '-');
    return { buffer: await this.book(unit, kind, []), filename: `${label}-shablon.xlsx` };
  }

  async exportExcel(unit: string, kind: EntryKindCode, from: string, to: string) {
    const data = await this.list(unit, kind, from, to);
    const label = `${entryUnitLabel(unit)}-${ENTRY_KINDS[kind].label}`.replace(/\s+/g, '-');
    return { buffer: await this.book(unit, kind, [...data.rows].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))), filename: `${label}-${data.from}_${data.to}.xlsx` };
  }

  /**
   * Faylni o'qish (saqlanmaydi): qatorlar jadvalga qoralama bo'lib tushadi — foydalanuvchi tekshirib saqlaydi.
   * Ustunlar sarlavha bo'yicha topiladi; Filial — nomi yoki № bo'yicha.
   */
  async parseFile(unit: string, kind: EntryKindCode, file: Express.Multer.File | undefined) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatida saqlang");
    }
    const ws = wb.getWorksheet('Kiritish') ?? wb.worksheets[0];
    if (!ws) throw new BadRequestException('Faylda varaq topilmadi');
    const want: Record<string, string[]> = {
      date: ['sana', 'дата'],
      name: ['nomi', 'nom', 'наименование'],
      branch: ['filial', 'филиал'],
      counterparty: ['kontragent', 'kimga', 'yetkazib beruvchi', 'контрагент'],
      docNo: ['hujjat', 'документ'],
      qty: ['soni', 'miqdor', 'количество'],
      price: ['narxi', 'narx', 'цена'],
      amount: ['summa', 'сумма'],
      note: ['izoh', 'примечание'],
    };
    const col: Record<string, number> = {};
    let headerRow = 0;
    for (let r = 1; r <= Math.min(ws.rowCount, 10) && !headerRow; r++) {
      const found: Record<string, number> = {};
      ws.getRow(r).eachCell((cell, c) => {
        const h = norm(String(cellValue(cell.value) ?? ''));
        for (const [k, keys] of Object.entries(want)) if (!(k in found) && keys.some((x) => h.startsWith(x))) found[k] = c;
      });
      if ('date' in found && 'amount' in found) {
        headerRow = r;
        Object.assign(col, found);
      }
    }
    if (!headerRow) throw new BadRequestException("Sarlavhalar topilmadi: kamida «Sana» va «Summa» ustunlari kerak — shablonni yuklab oling");
    const branches = unitBranches(unit);
    const byName = new Map(branches.map((b) => [norm(b.name), b.code]));
    const rows: (EntryInput & { rowIndex: number; errors: string[] })[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (k: string) => (col[k] ? cellValue(row.getCell(col[k]).value) : null);
      const vals = Object.keys(col).map(get);
      if (vals.every((v) => v === null || v === undefined || String(v).trim() === '')) continue;
      const errors: string[] = [];
      const date = excelDate(get('date'));
      if (!date) errors.push("Sana noto'g'ri");
      let branch: string | null = null;
      const bRaw = str(get('branch'), 300);
      if (bRaw && branches.length) {
        const n = Number(bRaw);
        branch = (Number.isInteger(n) ? branches.find((b) => b.no === n)?.code : null) ?? byName.get(norm(bRaw)) ?? branches.find((b) => norm(b.name).includes(norm(bRaw)))?.code ?? null;
        if (!branch) errors.push('Filial topilmadi');
      }
      const amount = num(get('amount'));
      const qty = num(get('qty'));
      const price = num(get('price'));
      if (Number.isNaN(amount) || Number.isNaN(qty) || Number.isNaN(price)) errors.push("Son noto'g'ri");
      rows.push({
        rowIndex: r,
        date: date ?? '',
        name: str(get('name'), 300) ?? '',
        branch,
        counterparty: str(get('counterparty'), 200),
        docNo: str(get('docNo'), 100),
        qty: qty !== null && !Number.isNaN(qty) ? qty : null,
        priceTiyin: price !== null && !Number.isNaN(price) ? String(Math.round(price * 100)) : null,
        amountTiyin: amount !== null && !Number.isNaN(amount) ? String(Math.round(amount * 100)) : null,
        note: str(get('note'), 500),
        errors,
      });
      if (rows.length > MAX_ROWS_PER_SAVE) throw new BadRequestException(`Qatorlar juda ko'p — ${MAX_ROWS_PER_SAVE} tagacha`);
    }
    if (!rows.length) throw new BadRequestException("Faylda qator topilmadi");
    return { fileName: String(file.originalname ?? '').slice(0, 200), rows };
  }
}