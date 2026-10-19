import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertPeriod, CENTRAL_REGION, cellText, monthName, MAX_TIYIN, shiftPeriod, somToTiyin } from './rd.util';

// ═══════════════════════════════════════════════════════════
// Xarajat rejasi (byudjet): oy × hudud × modda.
// Jadvalda reja yonida — fakt (shu oy shu hudud xarajatlari, ish haqi ham) va farq.
// Kiritish: jadvalda yoki Excel (Hudud · Modda · Summa); «o'tgan oydan nusxa».
// Reja — rejalashtirish ma'lumoti, buxgalteriya fakti emas; ular aralashtirilmaydi.
// ═══════════════════════════════════════════════════════════

export interface BudgetItemInput {
  categoryCode: string;
  amountTiyin: string | null;
}

@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async categories() {
    const cats = await this.prisma.category.findMany({ where: { isActive: true, isLeaf: true }, select: { code: true, label: true, parentCode: true, order: true }, orderBy: [{ order: 'asc' }, { label: 'asc' }] });
    const parents = await this.prisma.category.findMany({ where: { code: { in: [...new Set(cats.map((c) => c.parentCode).filter((x): x is string => Boolean(x)))] } }, select: { code: true, label: true } });
    const pl = new Map(parents.map((p) => [p.code, p.label]));
    return cats.map((c) => ({ code: c.code, label: c.label, group: c.parentCode ? (pl.get(c.parentCode) ?? null) : null }));
  }

  private async assertRegion(regionCode: number) {
    if (!Number.isInteger(regionCode) || regionCode === CENTRAL_REGION) throw new BadRequestException('Hududni tanlang');
    const r = await this.prisma.region.findUnique({ where: { code: regionCode } });
    if (!r) throw new BadRequestException('Hudud topilmadi');
    return r;
  }

  /** Bitta hudud, bitta oy: moddalar bo'yicha reja va fakt */
  async grid(periodRaw: string, regionRaw: unknown) {
    const period = assertPeriod(periodRaw);
    const region = await this.assertRegion(Number(regionRaw));
    const [cats, budgets, facts] = await Promise.all([
      this.categories(),
      this.prisma.expenseBudget.findMany({ where: { period, regionCode: region.code } }),
      this.prisma.expense.findMany({ where: { deletedAt: null, period, regionCode: region.code }, select: { categoryCode: true, amountTiyin: true } }),
    ]);
    const plan = new Map(budgets.map((b) => [b.categoryCode, b.amountTiyin]));
    const fact = new Map<string, bigint>();
    for (const f of facts) fact.set(f.categoryCode, (fact.get(f.categoryCode) ?? 0n) + f.amountTiyin);
    const rows = cats.map((c) => ({
      ...c,
      planTiyin: plan.has(c.code) ? plan.get(c.code)!.toString() : null,
      factTiyin: (fact.get(c.code) ?? 0n).toString(),
    }));
    // Reja yoki fakti bor moddalar tepada
    const totalPlan = budgets.reduce((s, b) => s + b.amountTiyin, 0n);
    const totalFact = facts.reduce((s, f) => s + f.amountTiyin, 0n);
    return { period, periodLabel: monthName(period), regionCode: region.code, regionName: region.name, rows, totalPlanTiyin: totalPlan.toString(), totalFactTiyin: totalFact.toString() };
  }

  async save(periodRaw: string, regionRaw: unknown, itemsRaw: unknown, userId: string) {
    const period = assertPeriod(periodRaw);
    const region = await this.assertRegion(Number(regionRaw));
    const items = (Array.isArray(itemsRaw) ? itemsRaw : []) as BudgetItemInput[];
    if (items.length > 1000) throw new BadRequestException("Qatorlar juda ko'p");
    const codes = new Set((await this.categories()).map((c) => c.code));
    let saved = 0;
    let removed = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const it of items) {
        if (!codes.has(String(it.categoryCode))) throw new BadRequestException(`Modda topilmadi: ${it.categoryCode}`);
        const key = { period_regionCode_categoryCode: { period, regionCode: region.code, categoryCode: String(it.categoryCode) } };
        if (it.amountTiyin === null || it.amountTiyin === undefined || String(it.amountTiyin) === '') {
          const ex = await tx.expenseBudget.findUnique({ where: key });
          if (ex) {
            await tx.expenseBudget.delete({ where: { id: ex.id } });
            removed++;
          }
          continue;
        }
        let amount: bigint;
        try {
          amount = BigInt(String(it.amountTiyin));
        } catch {
          throw new BadRequestException(`Summa noto'g'ri: ${it.categoryCode}`);
        }
        if (amount < 0n || amount > MAX_TIYIN) throw new BadRequestException(`Summa noto'g'ri: ${it.categoryCode}`);
        const ex = await tx.expenseBudget.findUnique({ where: key });
        if (ex) await tx.expenseBudget.update({ where: { id: ex.id }, data: { amountTiyin: amount, updatedById: userId } });
        else await tx.expenseBudget.create({ data: { period, regionCode: region.code, categoryCode: String(it.categoryCode), amountTiyin: amount, updatedById: userId } });
        saved++;
      }
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'expense_budget', entityId: `${period}:${region.code}`, summary: `Xarajat rejasi ${monthName(period)}, ${region.name}: ${saved} ta modda${removed ? `, ${removed} tasi olib tashlandi` : ''}` });
    return this.grid(period, region.code);
  }

  /** O'tgan oy rejasini shu oyga nusxalash (bor qiymatlar o'zgarmaydi) */
  async copyPrevious(periodRaw: string, regionRaw: unknown, userId: string) {
    const period = assertPeriod(periodRaw);
    const region = await this.assertRegion(Number(regionRaw));
    const prev = shiftPeriod(period, -1);
    const [src, dst] = await Promise.all([
      this.prisma.expenseBudget.findMany({ where: { period: prev, regionCode: region.code } }),
      this.prisma.expenseBudget.findMany({ where: { period, regionCode: region.code } }),
    ]);
    if (!src.length) throw new BadRequestException(`${monthName(prev)} uchun reja yo'q`);
    const have = new Set(dst.map((d) => d.categoryCode));
    const add = src.filter((s) => !have.has(s.categoryCode));
    if (add.length) await this.prisma.expenseBudget.createMany({ data: add.map((s) => ({ period, regionCode: region.code, categoryCode: s.categoryCode, amountTiyin: s.amountTiyin, updatedById: userId })) });
    await this.audit.log({ userId, action: 'CREATE', entity: 'expense_budget', entityId: `${period}:${region.code}`, summary: `Xarajat rejasi ${monthName(prev)} dan ${monthName(period)} ga nusxalandi (${region.name}, ${add.length} ta modda)` });
    return this.grid(period, region.code);
  }

  /** Oy bo'yicha hamma hududlar: reja va fakt jami (ish stoli va keyingi tahlil uchun) */
  async summary(periodRaw: string) {
    const period = assertPeriod(periodRaw);
    const [regions, budgets, facts] = await Promise.all([
      this.prisma.region.findMany({ where: { isActive: true, code: { not: CENTRAL_REGION } }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.prisma.expenseBudget.findMany({ where: { period }, select: { regionCode: true, amountTiyin: true } }),
      this.prisma.expense.findMany({ where: { deletedAt: null, period, regionCode: { not: null, notIn: [CENTRAL_REGION] } }, select: { regionCode: true, amountTiyin: true } }),
    ]);
    return regions.map((r) => {
      const plan = budgets.filter((b) => b.regionCode === r.code).reduce((s, b) => s + b.amountTiyin, 0n);
      const fact = facts.filter((f) => f.regionCode === r.code).reduce((s, f) => s + f.amountTiyin, 0n);
      return { regionCode: r.code, name: r.name, planTiyin: plan.toString(), factTiyin: fact.toString(), hasPlan: budgets.some((b) => b.regionCode === r.code) };
    });
  }

  async template(periodRaw: string): Promise<{ buffer: Buffer; filename: string }> {
    const period = assertPeriod(periodRaw);
    const [regions, cats, budgets] = await Promise.all([
      this.prisma.region.findMany({ where: { isActive: true, code: { not: CENTRAL_REGION } }, select: { code: true, name: true }, orderBy: { code: 'asc' } }),
      this.categories(),
      this.prisma.expenseBudget.findMany({ where: { period } }),
    ]);
    const have = new Map(budgets.map((b) => [`${b.regionCode}|${b.categoryCode}`, b.amountTiyin]));
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Korxona tahlil';
    const ws = wb.addWorksheet(`Reja ${period}`, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'Hudud kodi', key: 'rc', width: 11 },
      { header: 'Hudud', key: 'rn', width: 26 },
      { header: 'Modda kodi', key: 'cc', width: 18 },
      { header: 'Modda', key: 'cl', width: 40 },
      { header: "Reja summa (so'm)", key: 'amount', width: 20 },
    ];
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB45309' } };
    ws.getColumn('amount').numFmt = '#,##0';
    for (const r of regions) for (const c of cats) {
      const v = have.get(`${r.code}|${c.code}`);
      ws.addRow({ rc: r.code, rn: r.name, cc: c.code, cl: c.label, amount: v !== undefined ? Number(v) / 100 : null });
    }
    ws.autoFilter = { from: 'A1', to: `E${ws.rowCount}` };
    const data = await wb.xlsx.writeBuffer();
    return { buffer: Buffer.from(data), filename: `Xarajat-rejasi-${period}.xlsx` };
  }

  /** Excel'dan: bo'sh summa — o'tkaziladi (o'chirmaydi); faqat to'ldirilganlar yoziladi */
  async importFile(periodRaw: string, file: Express.Multer.File | undefined, userId: string) {
    const period = assertPeriod(periodRaw);
    if (!file?.buffer?.length) throw new BadRequestException('Fayl yuklanmadi');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException("Faylni o'qib bo'lmadi (.xlsx bo'lishi kerak)");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Faylda varaq topilmadi');
    const [regions, cats] = await Promise.all([
      this.prisma.region.findMany({ where: { isActive: true, code: { not: CENTRAL_REGION } }, select: { code: true } }),
      this.categories(),
    ]);
    const rset = new Set(regions.map((r) => r.code));
    const cset = new Set(cats.map((c) => c.code));
    const rows: { regionCode: number; categoryCode: string; amount: bigint }[] = [];
    const errors: { rowIndex: number; reason: string }[] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const rc = Number(cellText(row.getCell(1).value));
      const cc = cellText(row.getCell(3).value);
      const amount = somToTiyin(row.getCell(5).value);
      if (!cc && !cellText(row.getCell(1).value)) continue;
      if (amount === null) continue;
      if (amount === undefined) {
        errors.push({ rowIndex: r, reason: "Summa noto'g'ri" });
        continue;
      }
      if (!rset.has(rc)) {
        errors.push({ rowIndex: r, reason: `Hudud kodi noto'g'ri: ${cellText(row.getCell(1).value)}` });
        continue;
      }
      if (!cset.has(cc)) {
        errors.push({ rowIndex: r, reason: `Modda kodi topilmadi: ${cc}` });
        continue;
      }
      rows.push({ regionCode: rc, categoryCode: cc, amount });
    }
    if (errors.length) return { saved: 0, errors };
    if (!rows.length) throw new BadRequestException("Faylda summa yozilgan qator yo'q");
    await this.prisma.$transaction(async (tx) => {
      for (const x of rows) {
        const key = { period_regionCode_categoryCode: { period, regionCode: x.regionCode, categoryCode: x.categoryCode } };
        const ex = await tx.expenseBudget.findUnique({ where: key });
        if (ex) await tx.expenseBudget.update({ where: { id: ex.id }, data: { amountTiyin: x.amount, updatedById: userId } });
        else await tx.expenseBudget.create({ data: { period, regionCode: x.regionCode, categoryCode: x.categoryCode, amountTiyin: x.amount, updatedById: userId } });
      }
    });
    await this.audit.log({ userId, action: 'IMPORT', entity: 'expense_budget', entityId: period, summary: `Xarajat rejasi ${monthName(period)}: Excel'dan ${rows.length} ta qator` });
    return { saved: rows.length, errors: [] as { rowIndex: number; reason: string }[] };
  }
}