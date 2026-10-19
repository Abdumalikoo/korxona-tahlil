import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
    amountFor,
    assertPeriod,
    buildPlace,
    currentPeriod,
    loadLookups,
    periodsBetween,
    vatOf,
} from './leases.shared';
import {
    LEASE_CATEGORY,
    type LeaseKindValue,
    type MonthCloseSummary,
    type MonthRow,
    type MonthView,
} from './leases.types';

/**
 * Oyni yopish — shu oyda amalda bo'lgan har bir ijara uchun
 * "Ijara" kategoriyasida xarajat yozuvi yaratiladi.
 * Narx o'zgarsa, yopilgan oy o'zi o'zgarmaydi — "qayta yopish" kerak.
 */
/** O'tgan oylarga yozish natijasi */
export interface AccrueResult {
  /** Yozuv qo'shilgan oylar */
  periods: string[];
  /** Shu jarayonda yopilgan (avval yopilmagan) oylar */
  closedPeriods: string[];
  /** Avval yopilgan, yangi ijaralar qo'shilgan oylar */
  appendedPeriods: string[];
  /** Yangi ijaralar bo'yicha yaratilgan xarajat yozuvlari soni */
  expenses: number;
  totalTiyin: string;
}

interface LeaseForAccrual {
  id: string;
  title: string;
  number: string;
  lessorName: string;
  regionCode: number;
  districtId: string | null;
  departmentId: string | null;
  vatIncluded: boolean;
}

@Injectable()
export class LeaseMonthsService {
  constructor(private readonly prisma: PrismaService) {}

  private activeClose(period: string) {
    return this.prisma.leaseMonthClose.findFirst({
      where: { period, cancelledAt: null },

      orderBy: { closedAt: 'desc' },
    });
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((u) => [u.id, u.fullName]));
  }

  private leasesWithTerms(leaseIds?: string[]) {
    return this.prisma.lease.findMany({
      where: { deletedAt: null, ...(leaseIds ? { id: { in: leaseIds } } : {}) },
      include: { terms: { select: { validFrom: true, monthlyTiyin: true } } },
      orderBy: [{ regionCode: 'asc' }, { title: 'asc' }],
    });
  }

  /**
   * Yopilgan oylardan qaysilarining summasi hozirgi shartlarga mos emas.
   * leaseIds berilsa — faqat shu ijaralar bo'yicha.
   */
  async stalePeriods(leaseIds?: string[]): Promise<string[]> {
    const closes = await this.prisma.leaseMonthClose.findMany({
      where: { cancelledAt: null },
      select: { period: true },
    });
    if (closes.length === 0) return [];

    const closed = [...new Set(closes.map((c) => c.period))];

    const [leases, accruals] = await Promise.all([
      this.leasesWithTerms(leaseIds),
      this.prisma.leaseAccrual.findMany({
        where: { period: { in: closed }, ...(leaseIds ? { leaseId: { in: leaseIds } } : {}) },
        select: { leaseId: true, period: true, amountTiyin: true },
      }),
    ]);

    const accrued = new Map(accruals.map((a) => [`${a.leaseId}|${a.period}`, a.amountTiyin]));
    const stale = new Set<string>();

    for (const period of closed) {
      for (const lease of leases) {
        const expected = amountFor(lease, lease.terms, period);
        const actual = accrued.get(`${lease.id}|${period}`) ?? 0n;
        if (expected !== actual) {
          stale.add(period);
          break;
        }
      }
    }

    // O'chirilgan ijaralar bo'yicha qolgan yozuvlar ham farq hisoblanadi
    if (!leaseIds) {
      const liveIds = new Set(leases.map((l) => l.id));
      for (const accrual of accruals) {
        if (!liveIds.has(accrual.leaseId)) stale.add(accrual.period);
      }
    }


    return [...stale].sort();
  }

  /** Yopilgan oylar va hali yopilmagan oylar */
  async list(): Promise<{ closes: MonthCloseSummary[]; openPeriods: string[] }> {
    const [closes, first, stale] = await Promise.all([
      this.prisma.leaseMonthClose.findMany({
        where: { cancelledAt: null },
        orderBy: { period: 'desc' },
      }),
      this.prisma.lease.findFirst({
        where: { deletedAt: null },
        orderBy: { startPeriod: 'asc' },
        select: { startPeriod: true },
      }),
      this.stalePeriods(),
    ]);

    const names = await this.userNames(closes.map((c) => c.closedById));
    const staleSet = new Set(stale);
    const closedSet = new Set(closes.map((c) => c.period));

    const openPeriods = first
      ? periodsBetween(first.startPeriod, currentPeriod())
          .filter((p) => !closedSet.has(p))
          .reverse()
      : [];

    return {
      closes: closes.map((c) => ({
        id: c.id,
        period: c.period,

        leaseCount: c.leaseCount,
        totalTiyin: c.totalTiyin.toString(),
        closedAt: c.closedAt.toISOString(),
        closedBy: c.closedById ? (names.get(c.closedById) ?? null) : null,
        stale: staleSet.has(c.period),
      })),
      openPeriods,
    };
  }

  /** Oy ko'rinishi: hozirgi shartlar bo'yicha hisob va (yopilgan bo'lsa) yozilgan summa */
  async view(periodInput: string): Promise<MonthView> {
    const period = assertPeriod(periodInput, 'Oy');

    const [close, leases, lookups] = await Promise.all([
      this.activeClose(period),
      this.leasesWithTerms(),
      loadLookups(this.prisma),
    ]);

    const accruals = close
      ? await this.prisma.leaseAccrual.findMany({
          where: { closeId: close.id },
          select: { leaseId: true, amountTiyin: true },
        })
      : [];
    const accrued = new Map(accruals.map((a) => [a.leaseId, a.amountTiyin]));

    const rows: MonthRow[] = [];
    let expectedTotal = 0n;
    for (const lease of leases) {
      const expected = amountFor(lease, lease.terms, period);

      const actual = accrued.get(lease.id);
      if (expected === 0n && actual === undefined) continue;
      expectedTotal += expected;
      rows.push({
        leaseId: lease.id,
        number: lease.number,
        title: lease.title,
        kind: lease.kind as LeaseKindValue,
        place: buildPlace(lease, lookups),
        lessorName: lease.lessorName,
        expectedTiyin: expected.toString(),
        accruedTiyin: close ? (actual ?? 0n).toString() : null,
        changed: close ? (actual ?? 0n) !== expected : false,
      });
    }

    // O'chirilgan ijaralar bo'yicha yozilgan summalar
    const liveIds = new Set(leases.map((l) => l.id));
    const orphanIds = accruals.filter((a) => !liveIds.has(a.leaseId)).map((a) => a.leaseId);
    if (orphanIds.length > 0) {
      const orphans = await this.prisma.lease.findMany({ where: { id: { in: orphanIds } } });
      for (const lease of orphans) {
        rows.push({
          leaseId: lease.id,
          number: lease.number,
          title: `${lease.title} (o'chirilgan)`,
          kind: lease.kind as LeaseKindValue,
          place: buildPlace(lease, lookups),
          lessorName: lease.lessorName,
          expectedTiyin: '0',
          accruedTiyin: (accrued.get(lease.id) ?? 0n).toString(),
          changed: true,

        });
      }
    }

    const names = close ? await this.userNames([close.closedById]) : new Map<string, string>();

    return {
      period,
      close: close
        ? {
            id: close.id,
            closedAt: close.closedAt.toISOString(),
            closedBy: close.closedById ? (names.get(close.closedById) ?? null) : null,
            leaseCount: close.leaseCount,
            totalTiyin: close.totalTiyin.toString(),
          }
        : null,
      rows,
      expectedTotalTiyin: expectedTotal.toString(),
      stale: rows.some((r) => r.changed),
    };
  }

  /**
   * Oyni yopish. Oy allaqachon yopilgan bo'lsa — replace=true bilan
   * eski yozuvlar bekor qilinib, hozirgi shartlar bo'yicha qayta yoziladi.
   */
  async close(periodInput: string, userId: string, replace = false): Promise<MonthCloseSummary> {
    const period = assertPeriod(periodInput, 'Oy');
    if (period > currentPeriod()) {
      throw new BadRequestException('Kelajakdagi oyni yopib bo\'lmaydi');
    }


    const existing = await this.activeClose(period);
    if (existing && !replace) {
      throw new ConflictException('Bu oy allaqachon yopilgan. Qayta hisoblash uchun "Qayta yopish"ni tanlang');
    }

    const leases = await this.leasesWithTerms();
    const items = leases
      .map((lease) => ({ lease, amount: amountFor(lease, lease.terms, period) }))
      .filter((item) => item.amount > 0n);

    if (items.length === 0 && !existing) {
      throw new BadRequestException('Bu oyda amaldagi ijara yo\'q');
    }

    const [year, month] = period.split('-').map(Number) as [number, number];
    const date = new Date(Date.UTC(year, month - 1, 1));
    const total = items.reduce((sum, item) => sum + item.amount, 0n);

    const created = await this.prisma.$transaction(
      async (tx) => {
        if (existing) await this.cancelInTx(tx, existing.id);

        const close = await tx.leaseMonthClose.create({
          data: { period, leaseCount: items.length, totalTiyin: total, closedById: userId },
        });

        for (const { lease, amount } of items) {
          await this.writeAccrual(tx, close.id, lease, period, date, amount, userId);
        }

        return close;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );

    const names = await this.userNames([userId]);
    return {

      id: created.id,
      period,
      leaseCount: created.leaseCount,
      totalTiyin: created.totalTiyin.toString(),
      closedAt: created.closedAt.toISOString(),
      closedBy: names.get(userId) ?? null,
      stale: false,
    };
  }

  /** Bitta ijara, bitta oy: xarajat yozuvi (hudud + tuman/bo'lim bilan) va hisob qatori */
  private async writeAccrual(
    tx: Prisma.TransactionClient,
    closeId: string,
    lease: LeaseForAccrual,
    period: string,
    date: Date,
    amount: bigint,
    userId: string,
  ): Promise<void> {
    const expense = await tx.expense.create({
      data: {
        date,
        period,
        amountTiyin: amount,
        categoryCode: LEASE_CATEGORY,
        departmentId: lease.departmentId,
        districtId: lease.districtId,
        regionCode: lease.regionCode,
        description: `Ijara: ${lease.title}`,
        documentNo: lease.number,
        counterparty: lease.lessorName,
        vatTiyin: lease.vatIncluded ? vatOf(amount) : null,
        source: 'LEASE',
        createdById: userId,
      },
      select: { id: true },
    });
    await tx.leaseAccrual.create({
      data: { closeId, leaseId: lease.id, period, amountTiyin: amount, expenseId: expense.id },
    });
  }

  /**
   * Yangi (import qilingan) ijaralarni o'tgan oylar xarajatiga yozish —
   * boshlanish oyidan joriy oygacha (tugash oyidan keyin emas).
   *  · oy yopilgan bo'lsa — shu ijaralar yopilishga qo'shiladi, boshqa ijaralarga tegilmaydi;
   *  · oy yopilmagan bo'lsa — oy odatdagidek yopiladi (shu oydagi barcha amaldagi ijaralar).
   */
  async accrueLeases(leaseIds: string[], userId: string): Promise<AccrueResult> {
    const now = currentPeriod();
    const leases = await this.leasesWithTerms(leaseIds);
    const periods = new Set<string>();
    for (const lease of leases) {
      if (lease.startPeriod > now) continue;
      const until = lease.endPeriod && lease.endPeriod < now ? lease.endPeriod : now;
      for (const p of periodsBetween(lease.startPeriod, until)) periods.add(p);
    }

    const result: AccrueResult = { periods: [], closedPeriods: [], appendedPeriods: [], expenses: 0, totalTiyin: '0' };
    let total = 0n;
    const ids = new Set(leaseIds);

    for (const period of [...periods].sort()) {
      const existing = await this.activeClose(period);
      if (!existing) {
        try {
          await this.close(period, userId, false);
        } catch (error) {
          if (error instanceof BadRequestException) continue; // shu oyda summa yo'q
          throw error;
        }
        const own = await this.prisma.leaseAccrual.findMany({
          where: { period, leaseId: { in: [...ids] } },
          select: { amountTiyin: true },
        });
        if (own.length === 0) continue;
        result.closedPeriods.push(period);
        result.periods.push(period);
        result.expenses += own.length;
        total += own.reduce((sum, a) => sum + a.amountTiyin, 0n);
        continue;
      }

      const already = new Set(
        (
          await this.prisma.leaseAccrual.findMany({
            where: { period, leaseId: { in: [...ids] } },
            select: { leaseId: true },
          })
        ).map((a) => a.leaseId),
      );
      const items = leases
        .filter((lease) => !already.has(lease.id))
        .map((lease) => ({ lease, amount: amountFor(lease, lease.terms, period) }))
        .filter((item) => item.amount > 0n);
      if (items.length === 0) continue;

      const [year, month] = period.split('-').map(Number) as [number, number];
      const date = new Date(Date.UTC(year, month - 1, 1));
      const sum = items.reduce((acc, item) => acc + item.amount, 0n);

      await this.prisma.$transaction(
        async (tx) => {
          for (const { lease, amount } of items) {
            await this.writeAccrual(tx, existing.id, lease, period, date, amount, userId);
          }
          await tx.leaseMonthClose.update({
            where: { id: existing.id },
            data: { leaseCount: existing.leaseCount + items.length, totalTiyin: existing.totalTiyin + sum },
          });
        },
        { timeout: 120_000, maxWait: 10_000 },
      );

      result.appendedPeriods.push(period);
      result.periods.push(period);
      result.expenses += items.length;
      total += sum;
    }

    result.totalTiyin = total.toString();
    return result;
  }

  /** Oy yopilishini bekor qilish — xarajat yozuvlari o'chiriladi */
  async cancel(periodInput: string): Promise<{ period: string; removed: number }> {
    const period = assertPeriod(periodInput, 'Oy');
    const existing = await this.activeClose(period);
    if (!existing) throw new NotFoundException('Bu oy yopilmagan');

    const removed = await this.prisma.$transaction((tx) => this.cancelInTx(tx, existing.id), {
      timeout: 60_000,
    });
    return { period, removed };
  }

  private async cancelInTx(
    tx: Prisma.TransactionClient,
    closeId: string,
  ): Promise<number> {
    const accruals = await tx.leaseAccrual.findMany({
      where: { closeId },
      select: { expenseId: true },
    });
    const expenseIds = accruals.map((a) => a.expenseId).filter((id): id is string => Boolean(id));


    if (expenseIds.length > 0) {
      await tx.expense.updateMany({
        where: { id: { in: expenseIds }, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
    await tx.leaseAccrual.deleteMany({ where: { closeId } });
    await tx.leaseMonthClose.update({ where: { id: closeId }, data: { cancelledAt: new Date() } });
    return accruals.length;
  }
}