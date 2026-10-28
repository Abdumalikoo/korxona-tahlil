import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';
import { runExclusive } from '../../common/locks';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseBankStatement, text, type StatementChecks } from '../unit-bank/unit-bank.service';
import { cleanPurpose, interpret, QOMITA_PAYER_RE, type Confidence, type StatementDept, type StatementTarget } from './qomita-statement.parse';
import { QomitaService } from './qomita.service';
import { QOMITA_BANK_TAG, QOMITA_SEGMENT } from './qomita.util';

// ═══════════════════════════════════════════════════════════
// Daromadlar › Qo'mita mablag'lari › Bank ko'chirmasidan yuklash.
//  • O'qish: fayldagi kirimlar (Qo'mitadan kelganlari; xohlasa — hammasi); har qatorga taklif — qaysi bo'lim, qaysi oy,
//    nega (izoh ustuni, avvalgi tanlov, to'lov maqsadi); allaqachon yozilgani belgilanadi. Hech narsa saqlanmaydi.
//  • Qabul qilish: fayl qayta o'qiladi, foydalanuvchi tanlovi (qator → bo'lim / depozit / qarz / o'tkazish, oy) bo'yicha
//    bo'lim ajratmasi Qo'mita daromadi bo'lib yoziladi. Depozit va qarz qaytishi — daromad emas, yozilmaydi.
//    Tanlov eslab qolinadi (shartnoma / majburiyat raqami → bo'lim).
//  • Yuklashlar ro'yxati va yuklashni butunlay o'chirish (yozuvlari bilan).
// Saqlash: settings «qomita.bank.memory», «qomita.bank.uploads»; yozuvlarda importBatchId = «qomita-bank:<id>» — migratsiyasiz.
// ═══════════════════════════════════════════════════════════

export { QOMITA_BANK_TAG };
const MEMORY_KEY = 'qomita.bank.memory';
const UPLOADS_KEY = 'qomita.bank.uploads';
const MAX_UPLOADS = 200;
const MAX_MEMORY = 2000;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const COMMENT_HEAD = /izoh|izox|комментар|примечан|eslatma|изоҳ|изох|comment|note/i;

export interface StatementRowView {
  rowIndex: number;
  docDate: string;
  docNo: string;
  payer: string;
  amountTiyin: string;
  purpose: string;
  comment: string;
  fromQomita: boolean;
  target: StatementTarget;
  period: string;
  reasons: string[];
  periodReason: string;
  confidence: Confidence;
  signature: string | null;
  /** Shu sana va summada Qo'mita daromadi allaqachon bor */
  duplicate: boolean;
}

export interface QomitaUpload {
  id: string;
  fileName: string;
  at: string;
  by: string;
  written: number;
  totalTiyin: string;
  /** Daromad emas deb o'tkazilganlar (depozit, qarz) */
  notIncome: number;
  skipped: number;
  removedAt?: string | null;
}

/** Katak qiymati → matn (formula natijasi, boy matn) */
function cellText(v: unknown): string {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((t) => t.text).join('').trim();
    return text(o.result ?? o.text ?? '');
  }
  return text(v);
}

@Injectable()
export class QomitaStatementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly qomita: QomitaService,
  ) {}

  private async read<T>(key: string, fallback: T): Promise<T> {
    const v = (await this.prisma.setting.findUnique({ where: { key } }))?.value;
    return (v ?? fallback) as T;
  }

  private async write(key: string, value: unknown) {
    const v = value as object;
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
  }

  private async departments(): Promise<(StatementDept & { index: number })[]> {
    return this.prisma.department.findMany({ where: { isActive: true }, select: { id: true, name: true, index: true }, orderBy: [{ order: 'asc' }, { name: 'asc' }] });
  }

  /** Fayl → kirim qatorlari (izoh ustuni bilan) */
  private async parse(file: Express.Multer.File | undefined) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuklanmadi');
    await assertSafeXlsx(file.buffer);
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi — .xlsx bank ko'chirmasi kerak");
    }
    const parsed = parseBankStatement(wb, { credits: true });
    const ws = wb.getWorksheet(parsed.sheetName)!;
    const headerRows = parsed.checks.headerRows;
    // Izoh ustuni: sarlavhasi «Izoh / Комментарий» yoki jadvaldan o'ngdagi sarlavhasiz ustun (qo'lda yozilgan)
    let lastHead = 0;
    const heads = new Map<number, string>();
    for (const r of headerRows)
      ws.getRow(r).eachCell((c, col) => {
        const t = cellText(c.value);
        if (!t) return;
        lastHead = Math.max(lastHead, col);
        heads.set(col, `${heads.get(col) ?? ''} ${t}`.trim());
      });
    const dataRows = parsed.rows.map((r) => r.rowIndex);
    let commentCol: number | null = null;
    let best = 0;
    for (let col = 1; col <= ws.columnCount; col++) {
      const head = heads.get(col) ?? '';
      if (!(col > lastHead || (COMMENT_HEAD.test(head) && !/назнач|maqsad|мақсад/i.test(head)))) continue;
      let n = 0;
      for (const r of dataRows) {
        const t = cellText(ws.getRow(r).getCell(col).value);
        if (t && !/^[\d\s.,-]+$/.test(t)) n++;
      }
      if (n > best) {
        best = n;
        commentCol = col;
      }
    }
    const rows = parsed.rows
      .filter((r) => BigInt(r.debitTiyin) === 0n && BigInt(r.creditTiyin) > 0n)
      .map((r) => ({
        rowIndex: r.rowIndex,
        docDate: r.docDate,
        docNo: r.docNo,
        payer: r.accountName,
        amountTiyin: BigInt(r.creditTiyin),
        purposeRaw: r.purpose,
        purpose: cleanPurpose(r.purpose, r.accountName),
        comment: commentCol ? cellText(ws.getRow(r.rowIndex).getCell(commentCol).value).slice(0, 200) : '',
      }));
    return { fileName: file.originalname, sheetName: parsed.sheetName, checks: parsed.checks, rows, commentColumn: commentCol };
  }

  /** Shu sanalarda yozilgan Qo'mita daromadlari: «sana|summa» */
  private async existing(dates: string[]): Promise<Set<string>> {
    if (!dates.length) return new Set();
    const sorted = [...dates].sort();
    const rows = await this.prisma.income.findMany({
      where: { segment: QOMITA_SEGMENT, deletedAt: null, date: { gte: new Date(`${sorted[0]}T00:00:00+05:00`), lte: new Date(`${sorted[sorted.length - 1]}T23:59:59+05:00`) } },
      select: { date: true, amountTiyin: true },
    });
    const day = (d: Date) => new Date(d.getTime() + 5 * 3_600_000).toISOString().slice(0, 10);
    return new Set(rows.map((r) => `${day(r.date)}|${r.amountTiyin}`));
  }

  /** Faylni o'qish — taklif bilan; all — Qo'mitadan bo'lmagan kirimlar ham */
  async analyze(file: Express.Multer.File | undefined, all = false) {
    const p = await this.parse(file);
    const [deps, memory] = await Promise.all([this.departments(), this.read<Record<string, StatementTarget>>(MEMORY_KEY, {})]);
    const fromQ = (r: (typeof p.rows)[number]) => QOMITA_PAYER_RE.test(r.payer) || QOMITA_PAYER_RE.test(r.purpose);
    const picked = p.rows.filter((r) => all || fromQ(r));
    const have = await this.existing(picked.map((r) => r.docDate));
    const rows: StatementRowView[] = picked.map((r) => {
      const it = interpret({ docDate: r.docDate, purpose: r.purpose, comment: r.comment, payer: r.payer }, deps, memory);
      const duplicate = have.has(`${r.docDate}|${r.amountTiyin}`);
      return {
        rowIndex: r.rowIndex,
        docDate: r.docDate,
        docNo: r.docNo,
        payer: r.payer,
        amountTiyin: r.amountTiyin.toString(),
        purpose: r.purpose.slice(0, 600),
        comment: r.comment,
        fromQomita: fromQ(r),
        ...it,
        target: duplicate ? 'SKIP' : it.target,
        duplicate,
      };
    });
    rows.sort((a, b) => b.docDate.localeCompare(a.docDate) || a.rowIndex - b.rowIndex);
    return {
      fileName: p.fileName,
      sheetName: p.sheetName,
      checks: p.checks as StatementChecks,
      commentColumn: p.commentColumn,
      incomingTotal: p.rows.length,
      qomitaCount: p.rows.filter(fromQ).length,
      rows,
      departments: deps.map((d) => ({ id: d.id, name: d.name })),
    };
  }

  /**
   * Qabul qilish: decisions — [{ rowIndex, target, period }] (fayl qayta o'qiladi, summa va sana — fayldan).
   * Allaqachon yozilgani (sana + summa) — o'tkaziladi.
   */
  async commit(file: Express.Multer.File | undefined, decisionsRaw: unknown, userId: string) {
    let decisions: unknown = decisionsRaw;
    if (typeof decisionsRaw === 'string') {
      try {
        decisions = JSON.parse(decisionsRaw);
      } catch {
        throw new BadRequestException("Tanlovlar noto'g'ri");
      }
    }
    if (!Array.isArray(decisions) || !decisions.length) throw new BadRequestException('Hech qaysi qator tanlanmagan');
    if (decisions.length > 5000) throw new BadRequestException("Qatorlar juda ko'p");
    const p = await this.parse(file);
    const deps = await this.departments();
    const byRow = new Map(p.rows.map((r) => [r.rowIndex, r]));
    const have = await this.existing(p.rows.map((r) => r.docDate));
    const id = randomUUID();
    const tag = `${QOMITA_BANK_TAG}${id}`;
    const memory = await this.read<Record<string, StatementTarget>>(MEMORY_KEY, {});
    const codes = new Map<string, string>();
    const plan: { row: (typeof p.rows)[number]; dep: (typeof deps)[number]; period: string }[] = [];
    let notIncome = 0;
    let skipped = 0;
    const seen = new Set<number>();
    for (const raw of decisions as { rowIndex?: unknown; target?: unknown; period?: unknown }[]) {
      const rowIndex = Number(raw?.rowIndex);
      const row = byRow.get(rowIndex);
      if (!row || seen.has(rowIndex)) throw new BadRequestException(`Qator topilmadi: ${String(raw?.rowIndex).slice(0, 10)} — faylni qayta yuklang`);
      seen.add(rowIndex);
      const target = typeof raw?.target === 'string' ? raw.target : '';
      const sig = interpret({ docDate: row.docDate, purpose: row.purpose, comment: row.comment, payer: row.payer }, deps, {}).signature;
      if (target === 'SKIP') {
        skipped++;
        continue;
      }
      if (target === 'DEPOSIT' || target === 'LOAN') {
        notIncome++;
        if (sig) memory[sig] = target;
        continue;
      }
      const dep = target.startsWith('dep:') ? deps.find((d) => d.id === target.slice(4)) : undefined;
      if (!dep) throw new BadRequestException(`Bo'lim topilmadi (${row.docDate.split('-').reverse().join('.')} kirimi)`);
      const period = typeof raw?.period === 'string' && PERIOD_RE.test(raw.period) ? raw.period : null;
      if (!period) throw new BadRequestException(`Qaysi oy uchun — tanlang (${row.docDate.split('-').reverse().join('.')} kirimi)`);
      if (have.has(`${row.docDate}|${row.amountTiyin}`)) {
        skipped++;
        continue;
      }
      have.add(`${row.docDate}|${row.amountTiyin}`);
      if (sig) memory[sig] = `dep:${dep.id}`;
      plan.push({ row, dep, period });
    }
    for (const x of plan) if (!codes.has(x.dep.id)) codes.set(x.dep.id, await this.qomita.ensureIncomeCode(x.dep));
    const total = plan.reduce((s, x) => s + x.row.amountTiyin, 0n);
    if (plan.length)
      await this.prisma.$transaction(
        plan.map((x) =>
          this.prisma.income.create({
            data: {
              date: new Date(`${x.row.docDate}T12:00:00+05:00`),
              period: x.period,
              amountTiyin: x.row.amountTiyin,
              paidTiyin: x.row.amountTiyin,
              categoryCode: codes.get(x.dep.id)!,
              segment: QOMITA_SEGMENT,
              regionCode: null,
              departmentId: null,
              districtId: null,
              description: (x.row.comment ? `${x.row.comment} — ${x.row.purpose}` : x.row.purpose).slice(0, 500) || "Qo'mita ajratmasi",
              clientName: x.row.payer.slice(0, 200) || "Qo'mita",
              contractNo: x.row.docNo ? x.row.docNo.slice(0, 60) : null,
              paymentMethod: 'BANK',
              paymentStatus: 'PAID',
              source: 'IMPORT',
              section: 'DOIMIY',
              importBatchId: tag,
              createdById: userId,
            },
          }),
        ),
      );
    // Xotira (eng yangi tanlovlar qoladi)
    const mem = Object.entries(memory).slice(-MAX_MEMORY);
    await runExclusive(`setting:${MEMORY_KEY}`, () => this.write(MEMORY_KEY, Object.fromEntries(mem)));
    const entry: QomitaUpload = { id, fileName: p.fileName.slice(0, 200), at: new Date().toISOString(), by: userId, written: plan.length, totalTiyin: total.toString(), notIncome, skipped, removedAt: null };
    if (plan.length || notIncome)
      await runExclusive(`setting:${UPLOADS_KEY}`, async () => {
        const list = await this.read<QomitaUpload[]>(UPLOADS_KEY, []);
        await this.write(UPLOADS_KEY, [entry, ...(Array.isArray(list) ? list : [])].slice(0, MAX_UPLOADS));
      });
    await this.audit.log({
      userId,
      action: 'IMPORT',
      entity: 'qomita_income',
      entityId: id,
      summary: `Qo'mita mablag'lari — bank ko'chirmasi «${entry.fileName}»: ${plan.length} ta ajratma (${(Number(total) / 100).toLocaleString('uz-UZ')} so'm), daromad emas ${notIncome}, o'tkazildi ${skipped}`,
    });
    return { uploadId: id, written: plan.length, totalTiyin: total.toString(), notIncome, skipped };
  }

  /** Yuklashlar (yozuvlari hali bor-yo'qligi bilan) */
  async uploads() {
    const list = await this.read<QomitaUpload[]>(UPLOADS_KEY, []);
    const arr = Array.isArray(list) ? list : [];
    const live = await this.prisma.income.groupBy({ by: ['importBatchId'], where: { importBatchId: { in: arr.map((u) => `${QOMITA_BANK_TAG}${u.id}`) }, deletedAt: null }, _count: { _all: true }, _sum: { amountTiyin: true } });
    const byTag = new Map(live.map((l) => [l.importBatchId, l]));
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(arr.map((u) => u.by))] } }, select: { id: true, fullName: true } });
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    return arr.map((u) => {
      const l = byTag.get(`${QOMITA_BANK_TAG}${u.id}`);
      return { ...u, by: name.get(u.by) ?? '—', liveCount: l?._count._all ?? 0, liveTiyin: (l?._sum.amountTiyin ?? 0n).toString() };
    });
  }

  /** Yuklashni o'chirish: shu fayldan yozilgan hamma ajratma (yumshoq o'chirish — tiklash mumkin) */
  async removeUpload(id: string, userId: string) {
    const list = await this.read<QomitaUpload[]>(UPLOADS_KEY, []);
    const u = (Array.isArray(list) ? list : []).find((x) => x.id === id);
    if (!u) throw new NotFoundException('Yuklash topilmadi');
    const res = await this.prisma.income.updateMany({ where: { importBatchId: `${QOMITA_BANK_TAG}${id}`, deletedAt: null }, data: { deletedAt: new Date() } });
    await runExclusive(`setting:${UPLOADS_KEY}`, async () => {
      const cur = await this.read<QomitaUpload[]>(UPLOADS_KEY, []);
      await this.write(UPLOADS_KEY, (Array.isArray(cur) ? cur : []).map((x) => (x.id === id ? { ...x, removedAt: new Date().toISOString() } : x)));
    });
    await this.audit.log({ userId, action: 'DELETE', entity: 'qomita_income', entityId: id, summary: `Qo'mita mablag'lari — bank ko'chirmasi «${u.fileName}» yuklashi o'chirildi: ${res.count} ta yozuv` });
    return { removed: res.count };
  }
}
