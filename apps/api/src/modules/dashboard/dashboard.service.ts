import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const TASHKENT_OFFSET_HOURS = 5;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // --------- Yordamchilar ---------

  private shiftPeriod(period: string, delta: number): string {
    const [yearStr, monthStr] = period.split('-');
    let year = Number(yearStr);
    let month = Number(monthStr) + delta;

    while (month <= 0) {
      month += 12;
      year -= 1;
    }
    while (month > 12) {
      month -= 12;
      year += 1;
    }

    return `${year}-${String(month).padStart(2, '0')}`;
  }

  private lastPeriods(count: number, from?: string): string[] {
    let year: number;
    let month: number;

    if (from) {
      const [y, m] = from.split('-');
      year = Number(y);
      month = Number(m);
    } else {
      const now = new Date(Date.now() + TASHKENT_OFFSET_HOURS * 3600000);
      year = now.getUTCFullYear();
      month = now.getUTCMonth() + 1;
    }

    const result: string[] = [];

    for (let i = 0; i < count; i += 1) {
      result.unshift(`${year}-${String(month).padStart(2, '0')}`);
      month -= 1;
      if (month === 0) {
        month = 12;
        year -= 1;
      }
    }

    return result;
  }

  /** Nol bazada null qaytaradi - "cheksiz osish" korsatilmasligi kerak */
  private percentChange(current: bigint, base: bigint): number | null {
    if (base === 0n) return null;
    const diff = current - base;
    return Number((diff * 10000n) / (base < 0n ? -base : base)) / 100;
  }

  private percent(part: bigint, total: bigint): number | null {
    if (total === 0n) return null;
    return Number((part * 10000n) / (total < 0n ? -total : total)) / 100;
  }

  // --------- Asosiy korsatkichlar ---------

  /**
   * Joriy davr yigindisi va otgan davrlar bilan solishtirish.
   */
  async overview(period: string) {
    const previous = this.shiftPeriod(period, -1);
    const lastYear = this.shiftPeriod(period, -12);

    const periods = [period, previous, lastYear];

    const [incomes, expenses] = await Promise.all([
      this.prisma.income.groupBy({
        by: ['period'],
        where: { deletedAt: null, period: { in: periods } },
        _sum: { amountTiyin: true, paidTiyin: true },
        _count: { _all: true },
      }),
      this.prisma.expense.groupBy({
        by: ['period'],
        where: { deletedAt: null, period: { in: periods } },
        _sum: { amountTiyin: true },
        _count: { _all: true },
      }),
    ]);

    const incomeMap = new Map(incomes.map((r) => [r.period, r]));
    const expenseMap = new Map(expenses.map((r) => [r.period, r]));

    function build(key: string) {
      const income = incomeMap.get(key)?._sum.amountTiyin ?? 0n;
      const paid = incomeMap.get(key)?._sum.paidTiyin ?? 0n;
      const expense = expenseMap.get(key)?._sum.amountTiyin ?? 0n;

      return {
        period: key,
        incomeTiyin: income,
        paidTiyin: paid,
        expenseTiyin: expense,
        profitTiyin: income - expense,
      };
    }

    const current = build(period);
    const prev = build(previous);
    const year = build(lastYear);

    return {
      current: {
        ...current,
        marginPercent: this.percent(current.profitTiyin, current.incomeTiyin),
        incomeCount: incomeMap.get(period)?._count._all ?? 0,
        expenseCount: expenseMap.get(period)?._count._all ?? 0,
      },
      previous: {
        ...prev,
        incomeChange: this.percentChange(current.incomeTiyin, prev.incomeTiyin),
        expenseChange: this.percentChange(current.expenseTiyin, prev.expenseTiyin),
        profitChange: this.percentChange(current.profitTiyin, prev.profitTiyin),
      },
      lastYear: {
        ...year,
        incomeChange: this.percentChange(current.incomeTiyin, year.incomeTiyin),
        expenseChange: this.percentChange(current.expenseTiyin, year.expenseTiyin),
        profitChange: this.percentChange(current.profitTiyin, year.profitTiyin),
      },
    };
  }

  // --------- Dinamika ---------

  /** Daromad va xarajat - oxirgi N oy */
  async trend(months = 12, from?: string) {
    const periods = this.lastPeriods(months, from);

    const [incomes, expenses] = await Promise.all([
      this.prisma.income.groupBy({
        by: ['period'],
        where: { deletedAt: null, period: { in: periods } },
        _sum: { amountTiyin: true },
      }),
      this.prisma.expense.groupBy({
        by: ['period'],
        where: { deletedAt: null, period: { in: periods } },
        _sum: { amountTiyin: true },
      }),
    ]);

    const incomeMap = new Map(incomes.map((r) => [r.period, r._sum.amountTiyin ?? 0n]));
    const expenseMap = new Map(expenses.map((r) => [r.period, r._sum.amountTiyin ?? 0n]));

    return periods.map((p) => {
      const income = incomeMap.get(p) ?? 0n;
      const expense = expenseMap.get(p) ?? 0n;

      return {
        period: p,
        incomeTiyin: income,
        expenseTiyin: expense,
        profitTiyin: income - expense,
      };
    });
  }

  // --------- Bolimlar kesimi ---------

  /** Har bolimning daromadi, xarajati va foydasi */
  async departmentPnL(period: string) {
    const [departments, incomes, expenses] = await Promise.all([
      this.prisma.department.findMany({
        where: { isActive: true },
        orderBy: { index: 'asc' },
        select: { id: true, name: true, index: true },
      }),
      this.prisma.income.groupBy({
        by: ['departmentId'],
        where: { deletedAt: null, period },
        _sum: { amountTiyin: true },
      }),
      this.prisma.expense.groupBy({
        by: ['departmentId'],
        where: { deletedAt: null, period },
        _sum: { amountTiyin: true },
      }),
    ]);

    const incomeMap = new Map(
      incomes.map((r) => [r.departmentId ?? '', r._sum.amountTiyin ?? 0n]),
    );
    const expenseMap = new Map(
      expenses.map((r) => [r.departmentId ?? '', r._sum.amountTiyin ?? 0n]),
    );

    const rows = departments
      .map((dept) => {
        const income = incomeMap.get(dept.id) ?? 0n;
        const expense = expenseMap.get(dept.id) ?? 0n;
        const profit = income - expense;

        return {
          departmentId: dept.id,
          name: dept.name,
          index: dept.index,
          incomeTiyin: income,
          expenseTiyin: expense,
          profitTiyin: profit,
          marginPercent: this.percent(profit, income),
        };
      })
      // Faqat harakat bolgan bolimlar
      .filter((row) => row.incomeTiyin > 0n || row.expenseTiyin > 0n);

    // Bolimsiz yozuvlar
    const generalIncome = incomeMap.get('') ?? 0n;
    const generalExpense = expenseMap.get('') ?? 0n;

    if (generalIncome > 0n || generalExpense > 0n) {
      rows.push({
        departmentId: null as unknown as string,
        name: 'Umumkorxona',
        index: 999,
        incomeTiyin: generalIncome,
        expenseTiyin: generalExpense,
        profitTiyin: generalIncome - generalExpense,
        marginPercent: this.percent(generalIncome - generalExpense, generalIncome),
      });
    }

    const totals = rows.reduce(
      (acc, row) => ({
        incomeTiyin: acc.incomeTiyin + row.incomeTiyin,
        expenseTiyin: acc.expenseTiyin + row.expenseTiyin,
      }),
      { incomeTiyin: 0n, expenseTiyin: 0n },
    );

    return {
      rows: rows.sort((a, b) => (b.profitTiyin > a.profitTiyin ? 1 : -1)),
      totals: {
        ...totals,
        profitTiyin: totals.incomeTiyin - totals.expenseTiyin,
        marginPercent: this.percent(
          totals.incomeTiyin - totals.expenseTiyin,
          totals.incomeTiyin,
        ),
      },
    };
  }

  // --------- Ogohlantirishlar ---------

  /**
   * Etibor talab qiladigan holatlar.
   * Faqat muammo borida qaytadi.
   */
  async alerts(period: string) {
    const previous = this.shiftPeriod(period, -1);

    const [spikes, unpaidExpenses, unpaidIncomes] = await Promise.all([
      // Keskin osgan kategoriyalar
      this.findSpikes(period, previous),
      // Tolanmagan xarajatlar
      this.prisma.expense.aggregate({
        where: {
          deletedAt: null,
          period,
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
        _sum: { amountTiyin: true },
        _count: { _all: true },
      }),
      // Debitorlik qarzi
      this.prisma.income.findMany({
        where: {
          deletedAt: null,
          period,
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
        select: { amountTiyin: true, paidTiyin: true },
      }),
    ]);

    const receivable = unpaidIncomes.reduce(
      (sum, item) => sum + (item.amountTiyin - item.paidTiyin),
      0n,
    );

    return {
      spikes,
      payable: {
        totalTiyin: unpaidExpenses._sum.amountTiyin ?? 0n,
        count: unpaidExpenses._count._all,
      },
      receivable: {
        totalTiyin: receivable,
        count: unpaidIncomes.length,
      },
    };
  }

  private async findSpikes(period: string, previous: string) {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'alerts.expenseSpikePercent' },
    });
    const threshold = typeof setting?.value === 'number' ? setting.value : 30;

    const [current, prior, categories] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['categoryCode'],
        where: { deletedAt: null, period },
        _sum: { amountTiyin: true },
      }),
      this.prisma.expense.groupBy({
        by: ['categoryCode'],
        where: { deletedAt: null, period: previous },
        _sum: { amountTiyin: true },
      }),
      this.prisma.category.findMany({ select: { code: true, label: true } }),
    ]);

    const labels = new Map(categories.map((c) => [c.code, c.label]));
    const priorMap = new Map(prior.map((r) => [r.categoryCode, r._sum.amountTiyin ?? 0n]));

    const rows: {
      categoryCode: string;
      label: string;
      currentTiyin: bigint;
      previousTiyin: bigint;
      changePercent: number | null;
      isNew: boolean;
    }[] = [];

    for (const row of current) {
      const currentSum = row._sum.amountTiyin ?? 0n;
      const previousSum = priorMap.get(row.categoryCode) ?? 0n;
      const isNew = previousSum === 0n;
      const change = this.percentChange(currentSum, previousSum);

      if (!isNew && (change === null || change < threshold)) continue;

      rows.push({
        categoryCode: row.categoryCode,
        label: labels.get(row.categoryCode) ?? row.categoryCode,
        currentTiyin: currentSum,
        previousTiyin: previousSum,
        changePercent: change,
        isNew,
      });
    }

    return rows.sort((a, b) => (b.currentTiyin > a.currentTiyin ? 1 : -1)).slice(0, 5);
  }

  // --------- Xarajat strukturasi ---------

  /** Ildiz kategoriyalar boyicha - doira yoki ustunlar uchun */
  async expenseStructure(period: string) {
    const [grouped, categories] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['categoryCode'],
        where: { deletedAt: null, period },
        _sum: { amountTiyin: true },
      }),
      this.prisma.category.findMany({
        select: { code: true, label: true, parentCode: true },
      }),
    ]);

    const map = new Map(categories.map((c) => [c.code, c]));

    // Ildiz kategoriya boyicha yigamiz
    const roots = new Map<string, { label: string; totalTiyin: bigint }>();

    for (const row of grouped) {
      const category = map.get(row.categoryCode);
      const rootCode = category?.parentCode ?? row.categoryCode;
      const rootLabel = map.get(rootCode)?.label ?? rootCode;

      const current = roots.get(rootCode) ?? { label: rootLabel, totalTiyin: 0n };
      current.totalTiyin += row._sum.amountTiyin ?? 0n;
      roots.set(rootCode, current);
    }

    const total = [...roots.values()].reduce((sum, r) => sum + r.totalTiyin, 0n);

    return {
      rows: [...roots.entries()]
        .map(([code, value]) => ({
          code,
          label: value.label,
          amountTiyin: value.totalTiyin,
          sharePercent: this.percent(value.totalTiyin, total) ?? 0,
        }))
        .sort((a, b) => (b.amountTiyin > a.amountTiyin ? 1 : -1)),
      totalTiyin: total,
    };
  }
}
