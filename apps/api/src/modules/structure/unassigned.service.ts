import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { expandCategories, readPolicy } from '../expense-policy/policy.util';
import { bounds, parseDay } from './structure.engine';
import type { DateRange, SectionFilter } from './structure.types';

// ═══════════════════════════════════════════════════════════
// «Hududga biriktirilmagan» yozuvlar — ichida nima bor.
//
// Solishtirmadagi bilan aynan bir xil tanlov:
//  • hududi ham, Markaz bo'limi ham ko'rsatilmagan (regionCode = null, departmentId = null);
//  • xarajatda Xarajatlar siyosati moddalari chiqariladi — ular qayerda yozilgan bo'lsa ham Markazga o'tadi.
// Natija: jami, moddalar bo'yicha, manba (qo'lda / fayldan / ish haqi …) bo'yicha, oylar bo'yicha va yozuvlar ro'yxati.
// ═══════════════════════════════════════════════════════════

const TASHKENT_MS = 5 * 3600_000;
const MAX_DAYS = 3 * 366;
/** Bir tomonda ko'rsatiladigan yozuvlar soni (eng kattalari) — jami va guruhlar hamma yozuv bo'yicha */
export const UNASSIGNED_ITEM_LIMIT = 500;

export const SOURCE_LABELS: Record<string, string> = {
  MANUAL: "Qo'lda kiritilgan",
  IMPORT: 'Fayldan yuklangan',
  PAYROLL: 'Ish haqi vedomosti',
  LEASE: 'Ijara',
  VEHICLE: 'Mashinalar',
  WAREHOUSE: 'Ombor kirimi',
  ASSET: 'Asosiy vositalar sarfi',
  TAX: 'Soliqlar',
};

export interface UnassignedItem {
  id: string;
  date: string;
  period: string;
  amountTiyin: string;
  categoryCode: string;
  categoryLabel: string;
  section: string;
  source: string;
  /** Xarajatda — kontragent, daromadda — mijoz */
  counterparty: string | null;
  description: string | null;
  documentNo: string | null;
  /** Fayldan yuklangan bo'lsa — fayl nomi */
  fileName: string | null;
}

export interface UnassignedGroup {
  key: string;
  label: string;
  totalTiyin: string;
  count: number;
}

export interface UnassignedSide {
  totalTiyin: string;
  count: number;
  byCategory: UnassignedGroup[];
  bySource: UnassignedGroup[];
  /** Fayl bo'yicha (faqat fayldan yuklanganlar) */
  byFile: UnassignedGroup[];
  items: UnassignedItem[];
  /** Ro'yxat qisqartirildimi (eng katta UNASSIGNED_ITEM_LIMIT ta ko'rsatiladi) */
  truncated: boolean;
}

export interface UnassignedResult {
  range: DateRange;
  section: SectionFilter;
  months: { period: string; incomeTiyin: string; expenseTiyin: string }[];
  income: UnassignedSide;
  expense: UnassignedSide;
  /** Siyosat bo'yicha Markazga o'tgani uchun bu ro'yxatga kirmagan xarajat (hududsiz yozilgan) */
  policyExcludedTiyin: string;
}

interface Row {
  id: string;
  date: Date;
  period: string;
  amountTiyin: bigint;
  categoryCode: string;
  section: string;
  source: string;
  counterparty: string | null;
  description: string | null;
  documentNo: string | null;
  importBatchId: string | null;
}

function todayIso(): string {
  return new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
}

function dayOf(date: Date): string {
  return new Date(date.getTime() + TASHKENT_MS).toISOString().slice(0, 10);
}

function groupBy(rows: Row[], keyOf: (r: Row) => string | null, labelOf: (key: string) => string): UnassignedGroup[] {
  const map = new Map<string, { total: bigint; count: number }>();
  for (const r of rows) {
    const key = keyOf(r);
    if (key === null) continue;
    const g = map.get(key) ?? { total: 0n, count: 0 };
    g.total += r.amountTiyin;
    g.count += 1;
    map.set(key, g);
  }
  return [...map.entries()]
    .sort((a, b) => (b[1].total > a[1].total ? 1 : b[1].total < a[1].total ? -1 : a[0].localeCompare(b[0])))
    .map(([key, g]) => ({ key, label: labelOf(key), totalTiyin: g.total.toString(), count: g.count }));
}

@Injectable()
export class UnassignedService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: { from?: string; to?: string; section?: string }): Promise<UnassignedResult> {
    const raw = query.section || 'ALL';
    if (raw !== 'ALL' && raw !== 'DOIMIY' && raw !== 'BOSHQA') throw new BadRequestException("Bo'lim noto'g'ri: ALL, DOIMIY yoki BOSHQA");
    const section: SectionFilter = raw;
    const today = todayIso();
    const range: DateRange = { from: query.from || `${today.slice(0, 4)}-01-01`, to: query.to || today };
    const a = parseDay(range.from);
    const b = parseDay(range.to);
    if (a === null || b === null) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    if (a > b) throw new BadRequestException('Boshlanish sanasi tugash sanasidan keyin');
    if ((b - a) / 86_400_000 > MAX_DAYS) throw new BadRequestException('Davr 3 yildan oshmasin');

    const { start, end } = bounds(range);
    const where = {
      deletedAt: null,
      regionCode: null,
      departmentId: null,
      date: { gte: start, lt: end },
      ...(section !== 'ALL' ? { section } : {}),
    };

    const [expenseCategories, incomeCategories, incomes, expenses, policy] = await Promise.all([
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
      this.prisma.income.findMany({
        where,
        select: { id: true, date: true, period: true, amountTiyin: true, categoryCode: true, section: true, source: true, clientName: true, description: true, contractNo: true, importBatchId: true },
      }),
      this.prisma.expense.findMany({
        where,
        select: { id: true, date: true, period: true, amountTiyin: true, categoryCode: true, section: true, source: true, counterparty: true, description: true, documentNo: true, importBatchId: true },
      }),
      readPolicy(this.prisma),
    ]);
    const centerCategories = expandCategories(policy.centerCategories, expenseCategories);

    const incomeRows: Row[] = incomes.map((r) => ({
      id: r.id,
      date: r.date,
      period: r.period,
      amountTiyin: r.amountTiyin,
      categoryCode: r.categoryCode,
      section: r.section,
      source: r.source,
      counterparty: r.clientName ?? null,
      description: r.description ?? null,
      documentNo: r.contractNo ?? null,
      importBatchId: r.importBatchId ?? null,
    }));
    let policyExcluded = 0n;
    const expenseRows: Row[] = [];
    for (const r of expenses) {
      if (centerCategories.has(r.categoryCode)) {
        policyExcluded += r.amountTiyin;
        continue;
      }
      expenseRows.push({
        id: r.id,
        date: r.date,
        period: r.period,
        amountTiyin: r.amountTiyin,
        categoryCode: r.categoryCode,
        section: r.section,
        source: r.source,
        counterparty: r.counterparty ?? null,
        description: r.description ?? null,
        documentNo: r.documentNo ?? null,
        importBatchId: r.importBatchId ?? null,
      });
    }

    // Fayl nomlari
    const batchIds = [...new Set([...incomeRows, ...expenseRows].map((r) => r.importBatchId).filter((x): x is string => !!x))];
    const batches = batchIds.length ? await this.prisma.importBatch.findMany({ where: { id: { in: batchIds } }, select: { id: true, fileName: true } }) : [];
    const fileOf = new Map(batches.map((x) => [x.id, x.fileName]));

    const expenseLabel = new Map(expenseCategories.map((c) => [c.code, c.label]));
    const expenseParent = new Map(expenseCategories.map((c) => [c.code, c.parentCode]));
    const incomeLabel = new Map(incomeCategories.map((c) => [c.code, c.label]));
    const expenseCategoryText = (code: string) => {
      const parent = expenseParent.get(code);
      const own = expenseLabel.get(code) ?? code;
      return parent ? `${expenseLabel.get(parent) ?? parent} › ${own}` : own;
    };

    const side = (rows: Row[], categoryText: (code: string) => string): UnassignedSide => {
      const sorted = [...rows].sort((x, y) => (y.amountTiyin > x.amountTiyin ? 1 : y.amountTiyin < x.amountTiyin ? -1 : y.date.getTime() - x.date.getTime()));
      return {
        totalTiyin: rows.reduce((s, r) => s + r.amountTiyin, 0n).toString(),
        count: rows.length,
        byCategory: groupBy(rows, (r) => r.categoryCode, categoryText),
        bySource: groupBy(rows, (r) => r.source, (k) => SOURCE_LABELS[k] ?? k),
        byFile: groupBy(rows, (r) => r.importBatchId, (k) => fileOf.get(k) ?? 'Fayl'),
        items: sorted.slice(0, UNASSIGNED_ITEM_LIMIT).map((r) => ({
          id: r.id,
          date: dayOf(r.date),
          period: r.period,
          amountTiyin: r.amountTiyin.toString(),
          categoryCode: r.categoryCode,
          categoryLabel: categoryText(r.categoryCode),
          section: r.section,
          source: r.source,
          counterparty: r.counterparty,
          description: r.description,
          documentNo: r.documentNo,
          fileName: r.importBatchId ? (fileOf.get(r.importBatchId) ?? null) : null,
        })),
        truncated: rows.length > UNASSIGNED_ITEM_LIMIT,
      };
    };

    // Oylar bo'yicha (sana Toshkent vaqtida)
    const monthMap = new Map<string, { income: bigint; expense: bigint }>();
    const bump = (r: Row, k: 'income' | 'expense') => {
      const m = dayOf(r.date).slice(0, 7);
      const v = monthMap.get(m) ?? { income: 0n, expense: 0n };
      v[k] += r.amountTiyin;
      monthMap.set(m, v);
    };
    incomeRows.forEach((r) => bump(r, 'income'));
    expenseRows.forEach((r) => bump(r, 'expense'));

    return {
      range,
      section,
      months: [...monthMap.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([period, v]) => ({ period, incomeTiyin: v.income.toString(), expenseTiyin: v.expense.toString() })),
      income: side(incomeRows, (code) => incomeLabel.get(code) ?? code),
      expense: side(expenseRows, expenseCategoryText),
      policyExcludedTiyin: policyExcluded.toString(),
    };
  }
}