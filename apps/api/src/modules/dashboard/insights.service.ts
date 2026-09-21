import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const TASHKENT_OFFSET_HOURS = 5;

/** Shu foizdan ko'p o'zgarish e'tiborga loyiq */
const SIGNIFICANT_PERCENT = 20;

/** Shu summadan kichik o'zgarishlar ko'rsatilmaydi (tiyinda) */
const MIN_AMOUNT_TIYIN = 100_000_00n;

export type InsightKind = 'up' | 'down' | 'new' | 'gone';
export type InsightArea = 'expense' | 'income';

export interface Insight {
  kind: InsightKind;
  area: InsightArea;
  /** Nima o'zgargani — kategoriya, hudud, bo'lim nomi */
  subject: string;
  /** Oddiy tilda tushuntirish */
  message: string;
  currentTiyin: bigint;
  previousTiyin: bigint;
  diffTiyin: bigint;
  changePercent: number | null;
}

@Injectable()
export class InsightsService {
  constructor(private readonly prisma: PrismaService) {}

  // --------- Yordamchilar ---------

  private toDate(iso: string): Date {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(
      Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1, -TASHKENT_OFFSET_HOURS),
    );
  }

  /**
   * Oldingi shuncha muddatni hisoblaydi.
   * 3 oylik oraliq berilsa — undan oldingi 3 oy qaytadi.
   */
  private previousRange(from: string, to: string): { from: Date; to: Date } {
    const start = this.toDate(from);
    const end = this.toDate(to);

    const durationMs = end.getTime() - start.getTime();

    return {
      from: new Date(start.getTime() - durationMs - 86400000),
      to: new Date(start.getTime() - 86400000),
    };
  }

  private percentChange(current: bigint, base: bigint): number | null {
    if (base === 0n) return null;
    const diff = current - base;
    return Number((diff * 10000n) / (base < 0n ? -base : base)) / 100;
  }

  private formatSum(tiyin: bigint): string {
    const abs = tiyin < 0n ? -tiyin : tiyin;
    const sum = Number(abs) / 100;

    if (sum >= 1_000_000_000) return `${(sum / 1_000_000_000).toFixed(1)} mlrd`;
    if (sum >= 1_000_000) return `${Math.round(sum / 1_000_000)} mln`;
    if (sum >= 1_000) return `${Math.round(sum / 1_000)} ming`;
    return String(Math.round(sum));
  }

  // --------- Asosiy metod ---------

  /**
   * Tanlangan oraliqni oldingi shuncha muddat bilan solishtiradi
   * va etiborga loyiq ozgarishlarni topadi.
   */
  async findChanges(dateFrom: string, dateTo: string): Promise<{
    insights: Insight[];
    currentRange: { from: string; to: string };
    previousRange: { from: string; to: string };
  }> {
    const current = { from: this.toDate(dateFrom), to: this.toDate(dateTo) };
    const previous = this.previousRange(dateFrom, dateTo);

    const [expenseGroups, incomeRegions, payroll] = await Promise.all([
      this.compareExpenseGroups(current, previous),
      this.compareIncomeRegions(current, previous),
      this.comparePayroll(current, previous),
    ]);

    const insights = [...expenseGroups, ...incomeRegions, ...payroll].sort(
      (a, b) => {
        const aDiff = a.diffTiyin < 0n ? -a.diffTiyin : a.diffTiyin;
        const bDiff = b.diffTiyin < 0n ? -b.diffTiyin : b.diffTiyin;
        return bDiff > aDiff ? 1 : -1;
      },
    );

    return {
      insights: insights.slice(0, 12),
      currentRange: { from: dateFrom, to: dateTo },
      previousRange: {
        from: previous.from.toISOString().slice(0, 10),
        to: previous.to.toISOString().slice(0, 10),
      },
    };
  }

  // --------- Xarajat guruhlari ---------

  private async compareExpenseGroups(
    current: { from: Date; to: Date },
    previous: { from: Date; to: Date },
  ): Promise<Insight[]> {
    const [currentRows, previousRows, categories] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['categoryCode'],
        where: { deletedAt: null, date: { gte: current.from, lte: current.to } },
        _sum: { amountTiyin: true },
      }),
      this.prisma.expense.groupBy({
        by: ['categoryCode'],
        where: { deletedAt: null, date: { gte: previous.from, lte: previous.to } },
        _sum: { amountTiyin: true },
      }),
      this.prisma.category.findMany({
        select: { code: true, label: true, parentCode: true },
      }),
    ]);

    const catMap = new Map(categories.map((c) => [c.code, c]));

    /** Kategoriyani ildiz guruhiga yigadi */
    const groupBy = (
      rows: { categoryCode: string; _sum: { amountTiyin: bigint | null } }[],
    ) => {
      const groups = new Map<string, { label: string; amount: bigint }>();

      for (const row of rows) {
        const category = catMap.get(row.categoryCode);
        const rootCode = category?.parentCode ?? row.categoryCode;
        const label = catMap.get(rootCode)?.label ?? rootCode;

        const item = groups.get(rootCode) ?? { label, amount: 0n };
        item.amount += row._sum.amountTiyin ?? 0n;
        groups.set(rootCode, item);
      }

      return groups;
    };

    const currentGroups = groupBy(currentRows);
    const previousGroups = groupBy(previousRows);

    const insights: Insight[] = [];
    const allKeys = new Set([...currentGroups.keys(), ...previousGroups.keys()]);

    for (const key of allKeys) {
      const now = currentGroups.get(key);
      const before = previousGroups.get(key);

      const currentAmount = now?.amount ?? 0n;
      const previousAmount = before?.amount ?? 0n;
      const diff = currentAmount - previousAmount;
      const label = now?.label ?? before?.label ?? key;

      const absDiff = diff < 0n ? -diff : diff;
      if (absDiff < MIN_AMOUNT_TIYIN) continue;

      // Yangi paydo bo'lgan
      if (previousAmount === 0n && currentAmount > 0n) {
        insights.push({
          kind: 'new',
          area: 'expense',
          subject: label,
          message: `Yangi xarajat moddasi: ${this.formatSum(currentAmount)} som`,
          currentTiyin: currentAmount,
          previousTiyin: 0n,
          diffTiyin: diff,
          changePercent: null,
        });
        continue;
      }

      // Yo'qolgan
      if (currentAmount === 0n && previousAmount > 0n) {
        insights.push({
          kind: 'gone',
          area: 'expense',
          subject: label,
          message: `Xarajat toxtadi. Oldin ${this.formatSum(previousAmount)} som edi`,
          currentTiyin: 0n,
          previousTiyin: previousAmount,
          diffTiyin: diff,
          changePercent: null,
        });
        continue;
      }

      const change = this.percentChange(currentAmount, previousAmount);
      if (change === null || Math.abs(change) < SIGNIFICANT_PERCENT) continue;

      insights.push({
        kind: change > 0 ? 'up' : 'down',
        area: 'expense',
        subject: label,
        message:
          change > 0
            ? `${Math.round(change)}% oshdi \u2014 ${this.formatSum(diff)} som kop`
            : `${Math.round(Math.abs(change))}% tushdi \u2014 ${this.formatSum(diff)} som kam`,
        currentTiyin: currentAmount,
        previousTiyin: previousAmount,
        diffTiyin: diff,
        changePercent: change,
      });
    }

    return insights;
  }

  // --------- Daromad hududlari ---------

  private async compareIncomeRegions(
    current: { from: Date; to: Date },
    previous: { from: Date; to: Date },
  ): Promise<Insight[]> {
    const [currentRows, previousRows, regions] = await Promise.all([
      this.prisma.income.groupBy({
        by: ['regionCode'],
        where: {
          deletedAt: null,
          date: { gte: current.from, lte: current.to },
          regionCode: { not: null },
        },
        _sum: { amountTiyin: true },
      }),
      this.prisma.income.groupBy({
        by: ['regionCode'],
        where: {
          deletedAt: null,
          date: { gte: previous.from, lte: previous.to },
          regionCode: { not: null },
        },
        _sum: { amountTiyin: true },
      }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
    ]);

    const regionMap = new Map(regions.map((r) => [r.code, r.name]));

    const currentMap = new Map(
      currentRows.map((r) => [r.regionCode ?? -1, r._sum.amountTiyin ?? 0n]),
    );
    const previousMap = new Map(
      previousRows.map((r) => [r.regionCode ?? -1, r._sum.amountTiyin ?? 0n]),
    );

    const insights: Insight[] = [];
    const allKeys = new Set([...currentMap.keys(), ...previousMap.keys()]);

    for (const code of allKeys) {
      const currentAmount = currentMap.get(code) ?? 0n;
      const previousAmount = previousMap.get(code) ?? 0n;
      const diff = currentAmount - previousAmount;
      const name = regionMap.get(code) ?? 'Nomalum hudud';

      const absDiff = diff < 0n ? -diff : diff;
      if (absDiff < MIN_AMOUNT_TIYIN) continue;

      if (previousAmount === 0n && currentAmount > 0n) {
        insights.push({
          kind: 'new',
          area: 'income',
          subject: name,
          message: `Yangi hududdan daromad: ${this.formatSum(currentAmount)} som`,
          currentTiyin: currentAmount,
          previousTiyin: 0n,
          diffTiyin: diff,
          changePercent: null,
        });
        continue;
      }

      const change = this.percentChange(currentAmount, previousAmount);
      if (change === null || Math.abs(change) < SIGNIFICANT_PERCENT) continue;

      insights.push({
        kind: change > 0 ? 'up' : 'down',
        area: 'income',
        subject: name,
        message:
          change > 0
            ? `Daromad ${Math.round(change)}% oshdi \u2014 ${this.formatSum(diff)} som kop`
            : `Daromad ${Math.round(Math.abs(change))}% tushdi \u2014 ${this.formatSum(diff)} som kam`,
        currentTiyin: currentAmount,
        previousTiyin: previousAmount,
        diffTiyin: diff,
        changePercent: change,
      });
    }

    return insights;
  }

  // --------- Ish haqi ---------

  private async comparePayroll(
    current: { from: Date; to: Date },
    previous: { from: Date; to: Date },
  ): Promise<Insight[]> {
    const [currentSum, previousSum] = await Promise.all([
      this.prisma.expense.aggregate({
        where: {
          deletedAt: null,
          source: 'PAYROLL',
          date: { gte: current.from, lte: current.to },
        },
        _sum: { amountTiyin: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          deletedAt: null,
          source: 'PAYROLL',
          date: { gte: previous.from, lte: previous.to },
        },
        _sum: { amountTiyin: true },
      }),
    ]);

    const currentAmount = currentSum._sum.amountTiyin ?? 0n;
    const previousAmount = previousSum._sum.amountTiyin ?? 0n;
    const diff = currentAmount - previousAmount;

    const absDiff = diff < 0n ? -diff : diff;
    if (absDiff < MIN_AMOUNT_TIYIN) return [];

    const change = this.percentChange(currentAmount, previousAmount);
    if (change === null || Math.abs(change) < 10) return [];

    return [
      {
        kind: change > 0 ? 'up' : 'down',
        area: 'expense',
        subject: 'Ish haqi fondi',
        message:
          change > 0
            ? `${Math.round(change)}% oshdi \u2014 ${this.formatSum(diff)} som kop`
            : `${Math.round(Math.abs(change))}% kamaydi \u2014 ${this.formatSum(diff)} som kam`,
        currentTiyin: currentAmount,
        previousTiyin: previousAmount,
        diffTiyin: diff,
        changePercent: change,
      },
    ];
  }
}
