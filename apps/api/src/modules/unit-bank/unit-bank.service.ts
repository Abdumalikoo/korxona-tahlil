import { BadRequestException, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { entryUnitLabel, isSegment } from '../../common/segments/segments';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { monthLabel, monthsBetween } from '../../common/period';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { cellValue } from '../../common/excel/cells';
import { somToTiyin } from '../../common/money';

// ═══════════════════════════════════════════════════════════
// Yo'nalish bank xarajatlari (Xarajatlar › Tax free › Bank xarajatlari).
//
// Shablon — bank ko'chirmasi (выписка) shakli: №пп, Дата документа, Дата обработки, № док, Наименование счёта,
// ИНН, № счёта, МФО, Обороты по дебету, Обороты по кредиту, Назначение платежа.
//  • Fayldagi ma'lumot aynan o'zidek olinadi; xarajat — «Обороты по дебету» > 0 bo'lgan har bir qator.
//  • Xarajat izohi — «Назначение платежа»; «За выд.ин.вал. по курсу ЦБ.» o'rniga «Naqd pul konvertatsiya to'lovi».
//  • Kirim qatorlari (faqat kredit) va «Итого» — xarajat emas, o'tkazib yuboriladi (soni va summasi ko'rsatiladi).
//  • Oy — hujjat sanasidan. Bir oy qayta yuklansa — o'sha oyning oldingi ma'lumoti (va xarajatlari) almashtiriladi.
//  • Saqlash joyi: `settings` («unit.bank.<BO'LIM>») — migratsiya kerak emas.
// ═══════════════════════════════════════════════════════════

const TASHKENT_OFFSET_HOURS = 5;
const MAX_ROWS = 20000;
export const BANK_CATEGORY = { code: 'BANK_XARAJAT', label: 'Bank xarajatlari' };

/** Izohdagi bank iborasi → xarajat yozuvidagi nom */
export const PURPOSE_RULES: { match: RegExp; text: string }[] = [
  { match: /за\s*выд\.?\s*ин\.?\s*вал\.?\s*по\s*курсу\s*ц\.?\s*б\.?/i, text: "Naqd pul konvertatsiya to'lovi" },
];

export function purposeText(raw: string): string {
  let out = raw.trim();
  for (const r of PURPOSE_RULES) out = out.replace(r.match, r.text);
  return out.replace(/\s+/g, ' ').trim();
}

/** Ko'chirma qatori — fayldagidek */
export interface BankRow {
  no: string;
  docDate: string; // YYYY-MM-DD
  procDate: string | null;
  docNo: string;
  accountName: string;
  inn: string;
  account: string;
  mfo: string;
  debitTiyin: string;
  creditTiyin: string;
  /** Fayldagi «Назначение платежа» */
  purpose: string;
  /** Xarajat izohi (qoidalar bo'yicha almashtirilgan) */
  description: string;
}

interface MonthState {
  batchId: string;
  fileName: string;
  savedAt: string;
  uploadedBy: string;
  rows: BankRow[];
  expenseIds: string[];
}

interface BankBatch {
  id: string;
  fileName: string;
  createdAt: string;
  uploadedById: string;
  uploadedBy: string;
  months: string[];
  rows: number;
  totalTiyin: string;
  status: 'COMMITTED' | 'CANCELLED';
  cancelledAt: string | null;
}

interface BankStore {
  months: Record<string, MonthState>;
  batches: BankBatch[];
}

type Field = 'no' | 'docDate' | 'procDate' | 'docNo' | 'accountName' | 'inn' | 'account' | 'mfo' | 'debit' | 'credit' | 'purpose';

/** Sarlavha → maydon (kichik harf, bo'shliqsiz matn bo'yicha) */
const HEADERS: { field: Field; test: (h: string) => boolean; label: string }[] = [
  { field: 'no', test: (h) => h.startsWith('№пп') || h === '№', label: '№\nпп' },
  { field: 'docDate', test: (h) => h.includes('датадокумента'), label: 'Дата\nдокумента' },
  { field: 'procDate', test: (h) => h.includes('датаобработки'), label: 'Дата\nобработки' },
  { field: 'docNo', test: (h) => h.startsWith('№док'), label: '№ док' },
  { field: 'accountName', test: (h) => h.includes('наименование'), label: 'Наименование счёта' },
  { field: 'inn', test: (h) => h === 'инн' || h.startsWith('инн'), label: 'ИНН' },
  { field: 'account', test: (h) => h.startsWith('№сч'), label: '№ счёта' },
  { field: 'mfo', test: (h) => h === 'мфо' || h.startsWith('мфо'), label: 'МФО' },
  { field: 'debit', test: (h) => h.includes('дебет'), label: 'Обороты по\nдебету' },
  { field: 'credit', test: (h) => h.includes('кредит'), label: 'Обороты по\nкредиту' },
  { field: 'purpose', test: (h) => h.includes('назначение'), label: 'Назначение платежа' },
];

export const text = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v)).trim();
const key = (h: string) => h.toLowerCase().replace(/[\s\n\r.:]+/g, '').replace('ё', 'е');

/** «05.01.2026», Date yoki Excel seriya raqami → YYYY-MM-DD */
export function parseDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // ExcelJS sanani UTC yarim tun sifatida beradi
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86_400_000));
    return parseDate(d);
  }
  const s = text(v);
  let m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(s);
  if (m) {
    const [, d, mo, y] = m;
    const dd = Number(d);
    const mm = Number(mo);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** Bo'sh — 0; manfiy yoki matn — null */
function readStore(raw: unknown): BankStore {
  const v = (raw ?? {}) as Partial<BankStore>;
  return {
    months: v.months && typeof v.months === 'object' && !Array.isArray(v.months) ? (v.months as Record<string, MonthState>) : {},
    batches: Array.isArray(v.batches) ? (v.batches as BankBatch[]) : [],
  };
}

const cap = (s: unknown, n: number) => text(s).slice(0, n);

@Injectable()
export class UnitBankService implements OnModuleInit {
  private readonly logger = new Logger(UnitBankService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** «Bank xarajatlari» moddasi bo'lmasa — yaratiladi */
  async onModuleInit(): Promise<void> {
    await this.prisma.category
      .upsert({ where: { code: BANK_CATEGORY.code }, update: {}, create: { code: BANK_CATEGORY.code, label: BANK_CATEGORY.label, order: 60 } })
      .catch((e: unknown) => this.logger.warn(`«${BANK_CATEGORY.label}» moddasini tekshirib bo'lmadi: ${String(e)}`));
  }

  unitOf(raw: unknown): string {
    if (isSegment(raw)) return raw;
    throw new BadRequestException("Bo'lim noto'g'ri");
  }

  private storeKey(unit: string) {
    return `unit.bank.${unit}`;
  }

  private async store(unit: string): Promise<BankStore> {
    return readStore((await this.prisma.setting.findUnique({ where: { key: this.storeKey(unit) } }))?.value ?? null);
  }

  /** Hujjat sanasi — Toshkent vaqti bilan kun boshi */
  private dayDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d, -TASHKENT_OFFSET_HOURS));
  }

  // ═══════════ Shablon ═══════════

  async template(unit: string): Promise<{ buffer: Buffer; filename: string }> {
    const label = entryUnitLabel(unit);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const ws = wb.addWorksheet('Page 1', { views: [{ state: 'frozen', ySplit: 1 }] });
    const widths = [6, 12, 12, 14, 40, 12, 24, 8, 16, 16, 70];
    HEADERS.forEach((h, i) => {
      const c = ws.getCell(1, i + 1);
      c.value = h.label;
      c.font = { bold: true };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } };
      c.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
      ws.getColumn(i + 1).width = widths[i] ?? 14;
    });
    ws.getRow(1).height = 32;
    for (const col of [2, 3, 4, 6, 7, 8]) ws.getColumn(col).numFmt = '@';
    ws.getColumn(9).numFmt = '#,##0.00';
    ws.getColumn(10).numFmt = '#,##0.00';
    const help = wb.addWorksheet("Yo'riqnoma");
    help.getColumn(1).width = 110;
    [
      `${label} — bank xarajatlari shabloni (bank ko'chirmasi shakli)`,
      '',
      "• Bankdan olingan ko'chirmani (выписка) shu ustunlar bilan «Page 1» varag'iga qo'ying — ma'lumot aynan o'zidek olinadi.",
      '• Xarajat — «Обороты по дебету» summasi bor qatorlar. Faqat kredit (kirim) qatorlari va «Итого» qatori xarajat emas.',
      '• Sana — «Дата документа» (kk.oo.yyyy). Fayldagi har oy alohida saqlanadi; bir oy qayta yuklansa, oldingisi almashtiriladi.',
      "• «За выд.ин.вал. по курсу ЦБ.» izohi xarajatda «Naqd pul konvertatsiya to'lovi» deb yoziladi.",
    ].forEach((t, i) => {
      help.getCell(i + 1, 1).value = t;
      if (i === 0) help.getCell(1, 1).font = { bold: true, size: 12 };
    });
    const data = await wb.xlsx.writeBuffer();
    return { buffer: Buffer.from(data), filename: `Bank-xarajatlari-${label.replace(/\s+/g, '-')}-shablon.xlsx` };
  }

  // ═══════════ Fayl o'qish ═══════════

  private parse(wb: ExcelJS.Workbook) {
    return parseBankStatement(wb);
  }

  async analyze(unit: string, file: Express.Multer.File | undefined) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    const wb = new ExcelJS.Workbook();
    await assertSafeXlsx(file.buffer);
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx formatida saqlang (bank dasturidan «Excel» qilib oling)");
    }
    const p = this.parse(wb);
    if (!p.rows.length) throw new BadRequestException(`Faylda xarajat (debet) qatori topilmadi${p.inflowCount ? ` — ${p.inflowCount} ta faqat kirim (kredit) qatori bor` : ''}`);
    const saved = (await this.store(unit)).months;
    const months = [...new Set(p.rows.map((r) => r.period))].sort().map((period) => {
      const list = p.rows.filter((r) => r.period === period);
      const prev = saved[period];
      return {
        period,
        label: monthLabel(period),
        count: list.length,
        totalTiyin: list.reduce((s, r) => s + BigInt(r.debitTiyin), 0n).toString(),
        saved: prev ? { fileName: prev.fileName, savedAt: prev.savedAt, count: prev.rows.length, totalTiyin: prev.rows.reduce((s, r) => s + BigInt(r.debitTiyin), 0n).toString() } : null,
      };
    });
    const replaced = p.rows.filter((r) => r.description !== r.purpose.replace(/\s+/g, ' ').trim()).length;
    return {
      unit,
      label: entryUnitLabel(unit),
      fileName: String(file.originalname ?? 'bank.xlsx').slice(0, 200),
      sheetName: p.sheetName,
      months,
      rows: p.rows,
      invalid: p.invalid,
      inflow: { count: p.inflowCount, totalTiyin: p.inflowTiyin.toString() },
      renamedRows: replaced,
      totalTiyin: p.rows.reduce((s, r) => s + BigInt(r.debitTiyin), 0n).toString(),
    };
  }

  // ═══════════ Saqlash ═══════════

  private cleanRow(raw: Record<string, unknown>): BankRow & { period: string } {
    const docDate = parseDate(raw?.docDate);
    if (!docDate) throw new BadRequestException(`Sana noto'g'ri: ${cap(raw?.docDate, 20)}`);
    let debit: bigint;
    let credit: bigint;
    try {
      debit = BigInt(text(raw.debitTiyin) || '0');
      credit = BigInt(text(raw.creditTiyin) || '0');
    } catch {
      throw new BadRequestException(`Summa noto'g'ri: ${cap(raw?.docNo, 30)}`);
    }
    if (debit <= 0n || credit < 0n) throw new BadRequestException(`Debet summasi bo'lmagan qator: ${cap(raw?.docNo, 30)}`);
    const purpose = cap(raw.purpose, 1000);
    return {
      period: docDate.slice(0, 7),
      no: cap(raw.no, 20),
      docDate,
      procDate: parseDate(raw.procDate),
      docNo: cap(raw.docNo, 60),
      accountName: cap(raw.accountName, 300),
      inn: cap(raw.inn, 20),
      account: cap(raw.account, 40),
      mfo: cap(raw.mfo, 10),
      debitTiyin: debit.toString(),
      creditTiyin: credit.toString(),
      purpose,
      // Izoh serverda qayta hisoblanadi (qoidalar bitta joyda)
      description: purposeText(purpose).slice(0, 1000) || 'Bank xarajati',
    };
  }

  async commit(unit: string, body: { fileName?: unknown; months?: unknown; rows?: unknown }, userId: string) {
    if (!Array.isArray(body?.months) || !body.months.length) throw new BadRequestException('Saqlash uchun kamida bitta oy tanlang');
    const months = [...new Set(body.months.map(String))].sort();
    if (months.some((p) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(p))) throw new BadRequestException("Oy noto'g'ri");
    if (!Array.isArray(body.rows)) throw new BadRequestException("Ma'lumot yo'q");
    if (body.rows.length > MAX_ROWS) throw new BadRequestException(`Qatorlar juda ko'p — ${MAX_ROWS} tagacha`);
    const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim().slice(0, 200) : 'bank.xlsx';
    const byMonth = new Map<string, BankRow[]>(months.map((p) => [p, []]));
    for (const raw of body.rows as Record<string, unknown>[]) {
      const { period, ...row } = this.cleanRow(raw);
      byMonth.get(period)?.push(row); // tanlanmagan oy — saqlanmaydi
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } }).catch(() => null);
    const label = entryUnitLabel(unit);
    const storeKey = this.storeKey(unit);
    const batchId = randomUUID();
    const now = new Date().toISOString();

    const result = await this.prisma.$transaction(
      async (tx) => {
        const store = readStore((await tx.setting.findUnique({ where: { key: storeKey } }))?.value ?? null);
        let replaced = 0;
        let created = 0;
        let total = 0n;
        for (const p of months) {
          const prev = store.months[p];
          if (prev?.expenseIds.length) await tx.expense.updateMany({ where: { id: { in: prev.expenseIds }, deletedAt: null }, data: { deletedAt: new Date() } });
          if (prev) replaced += 1;
          const rows = byMonth.get(p)!;
          const expenseIds: string[] = [];
          for (const r of rows) {
            const e = await tx.expense.create({
              data: {
                date: this.dayDate(r.docDate),
                period: p,
                amountTiyin: BigInt(r.debitTiyin),
                categoryCode: BANK_CATEGORY.code,
                segment: unit,
                regionCode: null,
                departmentId: null,
                description: r.description.slice(0, 500),
                counterparty: r.accountName.slice(0, 200) || null,
                documentNo: r.docNo.slice(0, 100) || null,
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
            total += BigInt(r.debitTiyin);
          }
          store.months[p] = { batchId, fileName, savedAt: now, uploadedBy: user?.fullName ?? '', rows, expenseIds };
        }
        store.batches.push({ id: batchId, fileName, createdAt: now, uploadedById: userId, uploadedBy: user?.fullName ?? '', months, rows: created, totalTiyin: total.toString(), status: 'COMMITTED', cancelledAt: null });
        if (store.batches.length > 200) store.batches = store.batches.slice(-200);
        const value = store as unknown as object;
        await tx.setting.upsert({ where: { key: storeKey }, create: { key: storeKey, value }, update: { value } });
        return { replaced, created, total };
      },
      { timeout: 120_000 },
    );

    await this.audit.log({
      userId,
      action: 'IMPORT',
      entity: 'unit_bank',
      entityId: `${unit}:${batchId}`,
      summary: `${label} bank xarajatlari: ${months.map(monthLabel).join(', ')} — ${result.created} ta, ${(Number(result.total) / 100).toLocaleString('uz-UZ')} so'm${result.replaced ? `, ${result.replaced} oy almashtirildi` : ''}`,
    });
    return { success: true as const, batchId, months, expensesCreated: result.created, replacedMonths: result.replaced, totalTiyin: result.total.toString() };
  }

  // ═══════════ Ko'rish, tarix, bekor qilish ═══════════

  async data(unit: string, from: string, to: string) {
    const months = monthsBetween(from, to);
    const store = await this.store(unit);
    return {
      unit,
      label: entryUnitLabel(unit),
      months: months.map((p) => {
        const s = store.months[p];
        const rows = [...(s?.rows ?? [])].sort((a, b) => a.docDate.localeCompare(b.docDate) || a.docNo.localeCompare(b.docNo));
        return {
          period: p,
          label: monthLabel(p),
          saved: s ? { fileName: s.fileName, savedAt: s.savedAt, uploadedBy: s.uploadedBy } : null,
          count: rows.length,
          totalTiyin: rows.reduce((a, r) => a + BigInt(r.debitTiyin), 0n).toString(),
          rows,
        };
      }),
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

  async cancel(unit: string, id: string, userId: string) {
    const storeKey = this.storeKey(unit);
    const out = await this.prisma.$transaction(async (tx) => {
      const store = readStore((await tx.setting.findUnique({ where: { key: storeKey } }))?.value ?? null);
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
      await tx.setting.upsert({ where: { key: storeKey }, create: { key: storeKey, value }, update: { value } });
      return { b, cleared };
    });
    await this.audit.log({ userId, action: 'DELETE', entity: 'unit_bank', entityId: `${unit}:${id}`, summary: `${entryUnitLabel(unit)} bank xarajatlari yuklashi bekor qilindi: ${out.b.fileName}${out.cleared.length ? ` (${out.cleared.map(monthLabel).join(', ')})` : ''}` });
    return { success: true as const, clearedMonths: out.cleared };
  }
}

/**
 * Bank ko'chirmasi (выписка): sarlavha ustunlari bo'yicha; debet qatorlari, kirim (kredit) soni, xato qatorlar.
 * (Bo'lim bank xarajatlari va 23106 hisob raqami ko'chirmasi — bir xil shakl.)
 */
export function parseBankStatement(wb: ExcelJS.Workbook, opts: { credits?: boolean } = {}) {
  let ws: ExcelJS.Worksheet | undefined;
  let headerRow = 0;
  const cols = new Map<Field, number>();
  for (const sheet of wb.worksheets) {
    for (let r = 1; r <= Math.min(sheet.rowCount, 20); r++) {
      const row = sheet.getRow(r);
      const found = new Map<Field, number>();
      row.eachCell((cell, c) => {
        const h = key(text(cellValue(cell.value)));
        if (!h) return;
        const def = HEADERS.find((x) => !found.has(x.field) && x.test(h));
        if (def) found.set(def.field, c);
      });
      if (found.has('debit') && (found.has('docDate') || found.has('purpose'))) {
        ws = sheet;
        headerRow = r;
        for (const [f, c] of found) cols.set(f, c);
        break;
      }
    }
    if (ws) break;
  }
  if (!ws) throw new BadRequestException("Bank ko'chirmasi topilmadi: «Обороты по дебету» va «Дата документа» ustunlari bo'lgan varaq kerak");
  if (!cols.has('docDate') && !cols.has('procDate')) throw new BadRequestException("«Дата документа» ustuni topilmadi");

  const rows: (BankRow & { rowIndex: number; period: string })[] = [];
  const invalid: { rowIndex: number; reason: string }[] = [];
  let inflowCount = 0;
  let inflowTiyin = 0n;
  const get = (row: ExcelJS.Row, f: Field) => (cols.has(f) ? cellValue(row.getCell(cols.get(f)!).value) : null);

  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const vals = [...cols.values()].map((c) => text(cellValue(row.getCell(c).value)));
    if (vals.every((v) => !v)) continue;
    const accountName = text(get(row, 'accountName'));
    const purpose = text(get(row, 'purpose'));
    const docDateRaw = get(row, 'docDate');
    if (/^итого/i.test(accountName) || /^итого/i.test(text(get(row, 'no'))) || /входящее сальдо/i.test(purpose)) continue;
    const debit = somToTiyin(get(row, 'debit'));
    const credit = somToTiyin(get(row, 'credit'));
    if (debit === null || credit === null) {
      invalid.push({ rowIndex: r, reason: "Summa noto'g'ri" });
      continue;
    }
    if (debit === 0n) {
      if (credit > 0n) {
        inflowCount += 1;
        inflowTiyin += credit;
      }
      // Tahlil uchun kirim qatorlari ham kerak (bank ko'chirmasi tahlili) — boshqalar uchun o'tkaziladi
      if (!opts.credits || credit <= 0n) continue;
    }
    const docDate = parseDate(docDateRaw) ?? parseDate(get(row, 'procDate'));
    if (!docDate) {
      invalid.push({ rowIndex: r, reason: `Sana noto'g'ri: «${text(docDateRaw).slice(0, 20)}»` });
      continue;
    }
    rows.push({
      rowIndex: r,
      period: docDate.slice(0, 7),
      no: cap(get(row, 'no'), 20),
      docDate,
      procDate: parseDate(get(row, 'procDate')),
      docNo: cap(get(row, 'docNo'), 60),
      accountName: cap(accountName, 300),
      inn: cap(get(row, 'inn'), 20),
      account: cap(get(row, 'account'), 40),
      mfo: cap(get(row, 'mfo'), 10),
      debitTiyin: debit.toString(),
      creditTiyin: credit.toString(),
      purpose: cap(purpose, 1000),
      description: purposeText(purpose).slice(0, 1000) || 'Bank xarajati',
    });
    if (rows.length > MAX_ROWS) throw new BadRequestException(`Xarajat qatorlari juda ko'p — ${MAX_ROWS} tagacha`);
  }
  // Varaq yuqorisi (sarlavhagacha) — o'z hisob raqamini topish uchun (tahlilda faqat oxirgi raqamlari olinadi)
  const top: string[] = [];
  for (let r = 1; r < headerRow; r++) {
    const vals: string[] = [];
    ws.getRow(r).eachCell((cell) => {
      const t = text(cellValue(cell.value));
      if (t) vals.push(t);
    });
    if (vals.length) top.push(vals.join(' '));
  }
  return { sheetName: ws.name, rows, invalid, inflowCount, inflowTiyin, top };
}