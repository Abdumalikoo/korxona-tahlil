import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface IntegrityIssue {
  /** Muammo turi - tuzatish uchun kalit */
  code: string;
  severity: IssueSeverity;
  title: string;
  description: string;
  count: number;
  /** Tuzatish mumkinmi */
  fixable: boolean;
  /** Qisqa tafsilotlar - eng ko'pi 10 ta */
  details?: string[];
}

const STALE_DRAFT_HOURS = 24;

@Injectable()
export class IntegrityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Barcha tekshiruvlarni bajaradi */
  async check(): Promise<{
    issues: IntegrityIssue[];
    checkedAt: string;
    healthy: boolean;
  }> {
    const issues = await Promise.all([
      this.checkPayrollMismatch(),
      this.checkOrphanEntries(),
      this.checkStaleDrafts(),
      this.checkExpensesWithoutPlacement(),
      this.checkArchivedEmployeePayroll(),
      this.checkNegativeAmounts(),
      this.checkDuplicateExpenses(),
    ]);

    const found = issues.filter((issue): issue is IntegrityIssue => issue !== null);

    return {
      issues: found,
      checkedAt: new Date().toISOString(),
      healthy: found.filter((i) => i.severity === 'error').length === 0,
    };
  }

  // --------- Tekshiruvlar ---------

  /**
   * Yuklash summasi va undan yaratilgan xarajatlar mos kelmasa.
   * Bu eng jiddiy muammo - raqamlar notogri korinadi.
   */
  private async checkPayrollMismatch(): Promise<IntegrityIssue | null> {
    const batches = await this.prisma.payrollBatch.findMany({
      where: { status: 'COMMITTED' },
      select: { id: true, period: true, totalTiyin: true },
    });

    const details: string[] = [];

    for (const batch of batches) {
      const expenses = await this.prisma.expense.aggregate({
        where: { payrollBatchId: batch.id, deletedAt: null },
        _sum: { amountTiyin: true },
      });

      const created = expenses._sum.amountTiyin ?? 0n;

      if (created !== batch.totalTiyin) {
        const expected = Number(batch.totalTiyin) / 100;
        const actual = Number(created) / 100;

        details.push(
          `${batch.period}: kutilgan ${expected.toLocaleString('uz-UZ')}, ` +
            `mavjud ${actual.toLocaleString('uz-UZ')}`,
        );
      }
    }

    if (details.length === 0) return null;

    return {
      code: 'payroll_mismatch',
      severity: 'error',
      title: 'Ish haqi summalari mos kelmaydi',
      description:
        'Yuklash summasi va undan yaratilgan xarajatlar farq qiladi. ' +
        'Bu davr uchun faylni qaytadan yuklash kerak.',
      count: details.length,
      fixable: false,
      details: details.slice(0, 10),
    };
  }

  /** Batch ochirilgan, lekin qatorlar qolgan */
  private async checkOrphanEntries(): Promise<IntegrityIssue | null> {
    const orphans = await this.prisma.payrollEntry.findMany({
      where: { batchId: null },
      select: { id: true, period: true },
      take: 100,
    });

    if (orphans.length === 0) return null;

    const periods = [...new Set(orphans.map((item) => item.period))];

    return {
      code: 'orphan_entries',
      severity: 'warning',
      title: 'Bogliqsiz ish haqi qatorlari',
      description:
        'Bu qatorlar hech qaysi yuklashga tegishli emas. ' +
        'Ular hisobotlarga tasir qilmaydi, lekin bazani ogirlashtiradi.',
      count: orphans.length,
      fixable: true,
      details: periods.slice(0, 10),
    };
  }

  /** Uzoq vaqt DRAFT holatda qolgan yuklashlar */
  private async checkStaleDrafts(): Promise<IntegrityIssue | null> {
    const cutoff = new Date(Date.now() - STALE_DRAFT_HOURS * 3600 * 1000);

    const drafts = await this.prisma.payrollBatch.findMany({
      where: { status: 'DRAFT', createdAt: { lt: cutoff } },
      select: { period: true, fileName: true, createdAt: true },
      take: 20,
    });

    if (drafts.length === 0) return null;

    return {
      code: 'stale_drafts',
      severity: 'info',
      title: 'Tugallanmagan yuklashlar',
      description:
        'Bu yuklashlar tasdiqlanmagan va bir kundan ortiq turibdi. ' +
        'Ular bekor qilinishi mumkin.',
      count: drafts.length,
      fixable: true,
      details: drafts.map(
        (item) => `${item.period} - ${item.fileName}`,
      ).slice(0, 10),
    };
  }

  /** Xarajatda na bolim, na hudud korsatilgan */
  private async checkExpensesWithoutPlacement(): Promise<IntegrityIssue | null> {
    const count = await this.prisma.expense.count({
      where: {
        deletedAt: null,
        departmentId: null,
        regionCode: null,
        source: 'PAYROLL',
      },
    });

    if (count === 0) return null;

    return {
      code: 'expenses_without_placement',
      severity: 'warning',
      title: 'Joylashuvsiz ish haqi xarajatlari',
      description:
        'Bu xarajatlarda bolim ham, hudud ham korsatilmagan. ' +
        'Ular bolimlar va hududlar kesimida korinmaydi.',
      count,
      fixable: false,
    };
  }

  /** Arxivlangan xodimda yangi ish haqi bor */
  private async checkArchivedEmployeePayroll(): Promise<IntegrityIssue | null> {
    const entries = await this.prisma.payrollEntry.findMany({
      where: {
        employee: { isActive: false },
      },
      select: {
        period: true,
        employee: { select: { fullName: true, firedAt: true } },
      },
      take: 50,
    });

    // Bosgan sanadan keyingi davrlar
    const suspicious = entries.filter((entry) => {
      if (!entry.employee.firedAt) return false;

      const fired = entry.employee.firedAt;
      const firedPeriod = `${fired.getFullYear()}-${String(fired.getMonth() + 1).padStart(2, '0')}`;

      return entry.period > firedPeriod;
    });

    if (suspicious.length === 0) return null;

    return {
      code: 'archived_employee_payroll',
      severity: 'warning',
      title: 'Boshagan xodimlarda ish haqi',
      description:
        'Bu xodimlar arxivlangan, lekin boshaganidan keyingi davrlarda ' +
        'ish haqi yozuvlari bor.',
      count: suspicious.length,
      fixable: false,
      details: suspicious
        .map((item) => `${item.employee.fullName} - ${item.period}`)
        .slice(0, 10),
    };
  }

  /** Manfiy yoki nol summalar */
  private async checkNegativeAmounts(): Promise<IntegrityIssue | null> {
    const [expenses, incomes] = await Promise.all([
      this.prisma.expense.count({
        where: { deletedAt: null, amountTiyin: { lte: 0 } },
      }),
      this.prisma.income.count({
        where: { deletedAt: null, amountTiyin: { lte: 0 } },
      }),
    ]);

    const total = expenses + incomes;
    if (total === 0) return null;

    return {
      code: 'invalid_amounts',
      severity: 'error',
      title: 'Notogri summalar',
      description:
        'Nol yoki manfiy summali yozuvlar bor. Ular hisobotlarni buzadi.',
      count: total,
      fixable: false,
      details: [
        expenses > 0 ? `Xarajatlar: ${expenses} ta` : '',
        incomes > 0 ? `Daromadlar: ${incomes} ta` : '',
      ].filter(Boolean),
    };
  }

  /** Bir xil sana, summa va kategoriyali takroriy yozuvlar */
  private async checkDuplicateExpenses(): Promise<IntegrityIssue | null> {
    const duplicates = await this.prisma.$queryRaw<
      { period: string; count: bigint }[]
    >`
      SELECT period, COUNT(*)::bigint AS count
      FROM (
        SELECT period, date, "amountTiyin", "categoryCode", COUNT(*) AS c
        FROM expenses
        WHERE "deletedAt" IS NULL AND source = 'MANUAL'
        GROUP BY period, date, "amountTiyin", "categoryCode"
        HAVING COUNT(*) > 1
      ) AS dups
      GROUP BY period
      ORDER BY period DESC
      LIMIT 10
    `;

    if (duplicates.length === 0) return null;

    const total = duplicates.reduce((sum, row) => sum + Number(row.count), 0);

    return {
      code: 'duplicate_expenses',
      severity: 'info',
      title: 'Takroriy xarajat yozuvlari',
      description:
        'Bir xil sana, summa va kategoriyali yozuvlar bor. ' +
        'Ular haqiqiy bolishi mumkin, lekin tekshirish foydali.',
      count: total,
      fixable: false,
      details: duplicates.map((row) => `${row.period}: ${row.count} ta`),
    };
  }

  // --------- Tuzatish ---------

  /** Muammoni tuzatadi - faqat fixable bolganlar */
  async fix(code: string): Promise<{ fixed: number; message: string }> {
    switch (code) {
      case 'orphan_entries': {
        const result = await this.prisma.payrollEntry.deleteMany({
          where: { batchId: null },
        });
        return {
          fixed: result.count,
          message: `${result.count} ta bogliqsiz qator ochirildi`,
        };
      }

      case 'stale_drafts': {
        const cutoff = new Date(Date.now() - STALE_DRAFT_HOURS * 3600 * 1000);

        const drafts = await this.prisma.payrollBatch.findMany({
          where: { status: 'DRAFT', createdAt: { lt: cutoff } },
          select: { id: true },
        });

        const ids = drafts.map((item) => item.id);

        await this.prisma.payrollEntry.deleteMany({
          where: { batchId: { in: ids } },
        });

        const result = await this.prisma.payrollBatch.updateMany({
          where: { id: { in: ids } },
          data: { status: 'CANCELLED' },
        });

        return {
          fixed: result.count,
          message: `${result.count} ta tugallanmagan yuklash bekor qilindi`,
        };
      }

      default:
        return { fixed: 0, message: 'Bu muammoni avtomatik tuzatib bolmaydi' };
    }
  }
}
