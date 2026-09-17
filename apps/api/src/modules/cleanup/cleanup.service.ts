import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/** O'chirilgan yozuvlar shuncha kun saqlanadi */
const RETENTION_DAYS = 15;

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  private cutoffDate(): Date {
    return new Date(Date.now() - RETENTION_DAYS * 24 * 3600 * 1000);
  }

  /**
   * Har kuni soat 3:00 da savatni tozalaydi.
   * 15 kundan eski yozuvlar butunlay ochiriladi.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupTrash(): Promise<void> {
    const cutoff = this.cutoffDate();

    const [expenses, incomes] = await Promise.all([
      this.prisma.expense.deleteMany({
        where: { deletedAt: { not: null, lt: cutoff } },
      }),
      this.prisma.income.deleteMany({
        where: { deletedAt: { not: null, lt: cutoff } },
      }),
    ]);

    if (expenses.count > 0 || incomes.count > 0) {
      this.logger.log(
        `Savat tozalandi: ${expenses.count} xarajat, ${incomes.count} daromad`,
      );
    }
  }

  /** Qolda ishga tushirish - sozlamalardan */
  async cleanupNow(): Promise<{ expenses: number; incomes: number }> {
    const cutoff = this.cutoffDate();

    const [expenses, incomes] = await Promise.all([
      this.prisma.expense.deleteMany({
        where: { deletedAt: { not: null, lt: cutoff } },
      }),
      this.prisma.income.deleteMany({
        where: { deletedAt: { not: null, lt: cutoff } },
      }),
    ]);

    return { expenses: expenses.count, incomes: incomes.count };
  }

  /** Savatda nechta yozuv borligi */
  async trashStats() {
    const cutoff = this.cutoffDate();

    const [expenses, incomes, expiring] = await Promise.all([
      this.prisma.expense.count({ where: { deletedAt: { not: null } } }),
      this.prisma.income.count({ where: { deletedAt: { not: null } } }),
      this.prisma.expense.count({
        where: { deletedAt: { not: null, lt: cutoff } },
      }),
    ]);

    return {
      expenses,
      incomes,
      total: expenses + incomes,
      retentionDays: RETENTION_DAYS,
      expiringSoon: expiring,
    };
  }
}
