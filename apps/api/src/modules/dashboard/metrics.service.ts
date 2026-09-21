import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const TASHKENT_OFFSET_HOURS = 5;
const CENTRAL_REGION = 0;

export interface DepartmentRating {
  departmentId: string | null;
  name: string;
  incomeTiyin: bigint;
  expenseTiyin: bigint;
  profitTiyin: bigint;
  marginPercent: number | null;
  employeeCount: number;
  /** Xodim boshiga daromad */
  perEmployeeTiyin: bigint | null;
}

export interface PerEmployeeMetrics {
  employeeCount: number;
  incomePerEmployeeTiyin: bigint;
  expensePerEmployeeTiyin: bigint;
  payrollPerEmployeeTiyin: bigint;
  /** Ish haqi umumiy xarajatdagi ulushi */
  payrollSharePercent: number | null;
  totalIncomeTiyin: bigint;
  totalExpenseTiyin: bigint;
  totalPayrollTiyin: bigint;
}

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  private toDate(iso: string): Date {
    const [year, month, day] = iso.split('-').map(Number);
    return new Date(
      Date.UTC(year ?? 2026, (month ?? 1) - 1, day ?? 1, -TASHKENT_OFFSET_HOURS),
    );
  }

  private percent(part: bigint, total: bigint): number | null {
    if (total === 0n) return null;
    return Number((part * 10000n) / (total < 0n ? -total : total)) / 100;
  }

  // --------- Bolim reytingi ---------

  /**
   * Bolimlarni foyda va samaradorlik boyicha baholaydi.
   * Xodimlar soni bilan birga — xodim boshiga daromad hisoblanadi.
   */
  async departmentRating(
    dateFrom: string,
    dateTo: string,
  ): Promise<{
    rows: DepartmentRating[];
    best: DepartmentRating | null;
    worst: DepartmentRating | null;
  }> {
    const from = this.toDate(dateFrom);
    const to = this.toDate(dateTo);

    const [departments, incomes, expenses, employees] = await Promise.all([
      this.prisma.department.findMany({
        where: { isActive: true },
        select: { id: true, name: true, index: true },
      }),
      this.prisma.income.groupBy({
        by: ['departmentId'],
        where: { deletedAt: null, date: { gte: from, lte: to } },
        _sum: { amountTiyin: true },
      }),
      this.prisma.expense.groupBy({
        by: ['departmentId'],
        where: { deletedAt: null, date: { gte: from, lte: to } },
        _sum: { amountTiyin: true },
      }),
      this.prisma.employee.groupBy({
        by: ['departmentId'],
        where: { isActive: true, regionCode: CENTRAL_REGION },
        _count: { _all: true },
      }),
    ]);

    const incomeMap = new Map(
      incomes.map((r) => [r.departmentId ?? '', r._sum.amountTiyin ?? 0n]),
    );
    const expenseMap = new Map(
      expenses.map((r) => [r.departmentId ?? '', r._sum.amountTiyin ?? 0n]),
    );
    const employeeMap = new Map(
      employees.map((r) => [r.departmentId ?? '', r._count._all]),
    );

    const rows = departments
      .map((dept) => {
        const income = incomeMap.get(dept.id) ?? 0n;
        const expense = expenseMap.get(dept.id) ?? 0n;
        const profit = income - expense;
        const count = employeeMap.get(dept.id) ?? 0;

        return {
          departmentId: dept.id,
          name: dept.name,
          incomeTiyin: income,
          expenseTiyin: expense,
          profitTiyin: profit,
          marginPercent: this.percent(profit, income),
          employeeCount: count,
          perEmployeeTiyin: count > 0 ? income / BigInt(count) : null,
        };
      })
      .filter((row) => row.incomeTiyin > 0n || row.expenseTiyin > 0n);

    // Reyting uchun faqat daromadi borlar
    const rated = rows.filter((row) => row.incomeTiyin > 0n);
    const sorted = [...rated].sort((a, b) => {
      const aMargin = a.marginPercent ?? -999;
      const bMargin = b.marginPercent ?? -999;
      return bMargin - aMargin;
    });

    return {
      rows: rows.sort((a, b) => (b.profitTiyin > a.profitTiyin ? 1 : -1)),
      best: sorted[0] ?? null,
      worst: sorted.length > 1 ? (sorted[sorted.length - 1] ?? null) : null,
    };
  }

  // --------- Xodim boshiga korsatkichlar ---------

  async perEmployee(
    dateFrom: string,
    dateTo: string,
  ): Promise<PerEmployeeMetrics> {
    const from = this.toDate(dateFrom);
    const to = this.toDate(dateTo);

    const [employeeCount, income, expense, payroll] = await Promise.all([
      this.prisma.employee.count({ where: { isActive: true } }),
      this.prisma.income.aggregate({
        where: { deletedAt: null, date: { gte: from, lte: to } },
        _sum: { amountTiyin: true },
      }),
      this.prisma.expense.aggregate({
        where: { deletedAt: null, date: { gte: from, lte: to } },
        _sum: { amountTiyin: true },
      }),
      this.prisma.expense.aggregate({
        where: {
          deletedAt: null,
          source: 'PAYROLL',
          date: { gte: from, lte: to },
        },
        _sum: { amountTiyin: true },
      }),
    ]);

    const totalIncome = income._sum.amountTiyin ?? 0n;
    const totalExpense = expense._sum.amountTiyin ?? 0n;
    const totalPayroll = payroll._sum.amountTiyin ?? 0n;
    const count = BigInt(Math.max(employeeCount, 1));

    return {
      employeeCount,
      incomePerEmployeeTiyin: totalIncome / count,
      expensePerEmployeeTiyin: totalExpense / count,
      payrollPerEmployeeTiyin: totalPayroll / count,
      payrollSharePercent: this.percent(totalPayroll, totalExpense),
      totalIncomeTiyin: totalIncome,
      totalExpenseTiyin: totalExpense,
      totalPayrollTiyin: totalPayroll,
    };
  }

  // --------- Savollar-javoblar ---------

  /**
   * Tayyor savollarga javob beradi.
   * Har javob raqam va qisqa izohdan iborat.
   */
  async answer(
    question: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<{
    question: string;
    answer: string;
    details: { label: string; value: string }[];
  }> {
    const from = this.toDate(dateFrom);
    const to = this.toDate(dateTo);

    switch (question) {
      case 'top-expense':
        return this.answerTopExpense(from, to);
      case 'worst-month':
        return this.answerWorstMonth();
      case 'payroll-trend':
        return this.answerPayrollTrend();
      case 'best-region':
        return this.answerBestRegion(from, to);
      default:
        return {
          question,
          answer: 'Bu savolga javob topilmadi',
          details: [],
        };
    }
  }

  private formatSum(tiyin: bigint): string {
    const sum = Number(tiyin) / 100;

    if (sum >= 1_000_000_000) return `${(sum / 1_000_000_000).toFixed(2)} mlrd som`;
    if (sum >= 1_000_000) return `${Math.round(sum / 1_000_000)} mln som`;
    return `${Math.round(sum).toLocaleString('uz-UZ')} som`;
  }

  /** Qayerga eng kop pul ketyapti */
  private async answerTopExpense(from: Date, to: Date) {
    const [grouped, categories] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['categoryCode'],
        where: { deletedAt: null, date: { gte: from, lte: to } },
        _sum: { amountTiyin: true },
      }),
      this.prisma.category.findMany({
        select: { code: true, label: true, parentCode: true },
      }),
    ]);

    const catMap = new Map(categories.map((c) => [c.code, c]));
    const groups = new Map<string, { label: string; amount: bigint }>();

    for (const row of grouped) {
      const category = catMap.get(row.categoryCode);
      const rootCode = category?.parentCode ?? row.categoryCode;
      const label = catMap.get(rootCode)?.label ?? rootCode;

      const item = groups.get(rootCode) ?? { label, amount: 0n };
      item.amount += row._sum.amountTiyin ?? 0n;
      groups.set(rootCode, item);
    }

    const sorted = [...groups.values()].sort((a, b) =>
      b.amount > a.amount ? 1 : -1,
    );

    const total = sorted.reduce((sum, item) => sum + item.amount, 0n);
    const top = sorted[0];

    if (!top) {
      return {
        question: 'top-expense',
        answer: 'Bu davrda xarajat yoq',
        details: [],
      };
    }

    const share = this.percent(top.amount, total) ?? 0;

    return {
      question: 'top-expense',
      answer: `${top.label} \u2014 ${this.formatSum(top.amount)} (${share.toFixed(0)}%)`,
      details: sorted.slice(0, 5).map((item) => ({
        label: item.label,
        value: this.formatSum(item.amount),
      })),
    };
  }

  /** Qaysi oy eng yomon bolgan */
  private async answerWorstMonth() {
    const [incomes, expenses] = await Promise.all([
      this.prisma.income.groupBy({
        by: ['period'],
        where: { deletedAt: null },
        _sum: { amountTiyin: true },
      }),
      this.prisma.expense.groupBy({
        by: ['period'],
        where: { deletedAt: null },
        _sum: { amountTiyin: true },
      }),
    ]);

    const incomeMap = new Map(incomes.map((r) => [r.period, r._sum.amountTiyin ?? 0n]));
    const expenseMap = new Map(
      expenses.map((r) => [r.period, r._sum.amountTiyin ?? 0n]),
    );

    const periods = new Set([...incomeMap.keys(), ...expenseMap.keys()]);

    const rows = [...periods]
      .map((period) => ({
        period,
        profit: (incomeMap.get(period) ?? 0n) - (expenseMap.get(period) ?? 0n),
      }))
      .sort((a, b) => (a.profit > b.profit ? 1 : -1));

    const worst = rows[0];

    if (!worst) {
      return { question: 'worst-month', answer: 'Malumot yoq', details: [] };
    }

    return {
      question: 'worst-month',
      answer: `${worst.period} \u2014 ${this.formatSum(worst.profit)}`,
      details: rows.slice(0, 5).map((row) => ({
        label: row.period,
        value: this.formatSum(row.profit),
      })),
    };
  }

  /** Ish haqi osib boryaptimi */
  private async answerPayrollTrend() {
    const grouped = await this.prisma.expense.groupBy({
      by: ['period'],
      where: { deletedAt: null, source: 'PAYROLL' },
      _sum: { amountTiyin: true },
      orderBy: { period: 'asc' },
    });

    if (grouped.length < 2) {
      return {
        question: 'payroll-trend',
        answer: 'Solishtirish uchun malumot yetarli emas',
        details: [],
      };
    }

    const first = grouped[0]!;
    const last = grouped[grouped.length - 1]!;

    const firstAmount = first._sum.amountTiyin ?? 0n;
    const lastAmount = last._sum.amountTiyin ?? 0n;
    const change = this.percent(lastAmount - firstAmount, firstAmount);

    const direction =
      change === null ? 'ozgarmadi' : change > 0 ? 'oshdi' : 'kamaydi';

    return {
      question: 'payroll-trend',
      answer: `${first.period} dan ${last.period} gacha ${Math.abs(change ?? 0).toFixed(0)}% ${direction}`,
      details: grouped.slice(-6).map((row) => ({
        label: row.period,
        value: this.formatSum(row._sum.amountTiyin ?? 0n),
      })),
    };
  }

  /** Qaysi hudud eng kop daromad keltiryapti */
  private async answerBestRegion(from: Date, to: Date) {
    const [grouped, regions] = await Promise.all([
      this.prisma.income.groupBy({
        by: ['regionCode'],
        where: {
          deletedAt: null,
          date: { gte: from, lte: to },
          regionCode: { not: null },
        },
        _sum: { amountTiyin: true },
      }),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
    ]);

    const regionMap = new Map(regions.map((r) => [r.code, r.name]));

    const sorted = grouped
      .map((row) => ({
        name: regionMap.get(row.regionCode ?? -1) ?? 'Nomalum',
        amount: row._sum.amountTiyin ?? 0n,
      }))
      .sort((a, b) => (b.amount > a.amount ? 1 : -1));

    const top = sorted[0];

    if (!top) {
      return {
        question: 'best-region',
        answer: 'Hududiy daromad yoq',
        details: [],
      };
    }

    return {
      question: 'best-region',
      answer: `${top.name} \u2014 ${this.formatSum(top.amount)}`,
      details: sorted.slice(0, 5).map((item) => ({
        label: item.name,
        value: this.formatSum(item.amount),
      })),
    };
  }
}
