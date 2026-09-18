import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Income, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { CreateIncomeDto } from './dto/create-income.dto';
import type { QueryIncomeDto } from './dto/query-income.dto';
import type { UpdateIncomeDto } from './dto/update-income.dto';

const DEFAULT_LIMIT = 50;
const TASHKENT_OFFSET_HOURS = 5;

@Injectable()
export class IncomesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ─────────── Yordamchilar ───────────

  private toStoredDate(iso: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!match) {
      throw new BadRequestException('Sana noto\u2018g\u2018ri formatda');
    }
    return new Date(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), -TASHKENT_OFFSET_HOURS),
    );
  }

  private toPeriod(iso: string): string {
    const match = /^(\d{4})-(\d{2})/.exec(iso);
    if (!match) {
      throw new BadRequestException('Sana noto\u2018g\u2018ri formatda');
    }
    return `${match[1]}-${match[2]}`;
  }

  private async assertCategory(code: string): Promise<void> {
    const category = await this.prisma.incomeCategory.findUnique({
      where: { code },
      select: { isActive: true, label: true },
    });

    if (!category) {
      throw new BadRequestException('Xizmat turi topilmadi');
    }
    if (!category.isActive) {
      throw new BadRequestException(`"${category.label}" arxivlangan`);
    }
  }

  private async assertDepartment(id: string): Promise<void> {
    const department = await this.prisma.department.findUnique({
      where: { id },
      select: { isActive: true },
    });

    if (!department) {
      throw new BadRequestException('Bo\u2018lim topilmadi');
    }
    if (!department.isActive) {
      throw new BadRequestException('Bo\u2018lim arxivlangan');
    }
  }

  /**
   * To'langan summa va holatni muvofiqlashtiradi.
   * Foydalanuvchi ikkalasini alohida kiritishi mumkin, lekin ular
   * bir-biriga zid bo'lmasligi kerak.
   */
  private resolvePayment(
    amountTiyin: bigint,
    paidInput: number | undefined,
    statusInput: PaymentStatus | undefined,
  ): { paidTiyin: bigint; paymentStatus: PaymentStatus } {
    // To'langan summa aniq berilgan — holat shundan hisoblanadi
    if (paidInput !== undefined) {
      const paid = BigInt(paidInput);

      if (paid > amountTiyin) {
        throw new BadRequestException(
          'To\u2018langan summa shartnoma summasidan katta bo\u2018lishi mumkin emas',
        );
      }

      if (paid === 0n) return { paidTiyin: 0n, paymentStatus: 'UNPAID' };
      if (paid === amountTiyin) return { paidTiyin: paid, paymentStatus: 'PAID' };
      return { paidTiyin: paid, paymentStatus: 'PARTIAL' };
    }

    // Faqat holat berilgan — to'langan summa shundan kelib chiqadi
    const status = statusInput ?? 'PAID';

    if (status === 'PAID') return { paidTiyin: amountTiyin, paymentStatus: 'PAID' };
    if (status === 'UNPAID') return { paidTiyin: 0n, paymentStatus: 'UNPAID' };

    throw new BadRequestException(
      'Qisman to\u2018lov uchun to\u2018langan summani ko\u2018rsating',
    );
  }

  private async buildWhere(query: QueryIncomeDto): Promise<Prisma.IncomeWhereInput> {
    const where: Prisma.IncomeWhereInput = { deletedAt: null };

    // Sana oraligi eng aniq filtr - u boshqalardan ustun
    if (query.dateFrom || query.dateTo) {
      where.date = {
        ...(query.dateFrom ? { gte: this.toStoredDate(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: this.toStoredDate(query.dateTo) } : {}),
      };
    } else if (query.period) {
      where.period = query.period;
    } else if (query.periodFrom || query.periodTo) {
      where.period = {
        ...(query.periodFrom ? { gte: query.periodFrom } : {}),
        ...(query.periodTo ? { lte: query.periodTo } : {}),
      };
    }

    if (query.departmentId) where.departmentId = query.departmentId;
    if (query.categoryCode) where.categoryCode = query.categoryCode;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { clientName: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { contractNo: { contains: term, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  // ─────────── Asosiy amallar ───────────

  async create(dto: CreateIncomeDto, userId: string): Promise<Income> {
    await this.assertCategory(dto.categoryCode);
    if (dto.departmentId) await this.assertDepartment(dto.departmentId);

    const amount = BigInt(dto.amountTiyin);
    const { paidTiyin, paymentStatus } = this.resolvePayment(
      amount,
      dto.paidTiyin,
      dto.paymentStatus,
    );

    return this.prisma.income.create({
      data: {
        date: this.toStoredDate(dto.date),
        period: this.toPeriod(dto.date),
        amountTiyin: amount,
        paidTiyin,
        paymentStatus,
        categoryCode: dto.categoryCode,
        departmentId: dto.departmentId ?? null,
        clientName: dto.clientName ?? null,
        description: dto.description ?? null,
        contractNo: dto.contractNo ?? null,
        paymentMethod: dto.paymentMethod ?? 'BANK',
        source: 'MANUAL',
        createdById: userId,
      },
      include: {
        category: { select: { code: true, label: true } },
        department: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async findAll(query: QueryIncomeDto) {
    const where = await this.buildWhere(query);
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const [items, total, totals] = await Promise.all([
      this.prisma.income.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          category: { select: { code: true, label: true } },
          department: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.income.count({ where }),
      this.prisma.income.aggregate({
        where,
        _sum: { amountTiyin: true, paidTiyin: true },
      }),
    ]);

    const sumTiyin = totals._sum.amountTiyin ?? 0n;
    const paidTiyin = totals._sum.paidTiyin ?? 0n;

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        sumTiyin,
        paidTiyin,
        /** Debitorlik qarzi — hisoblangan, lekin tushmagan summa */
        receivableTiyin: sumTiyin - paidTiyin,
      },
    };
  }

  async findOne(id: string): Promise<Income> {
    const income = await this.prisma.income.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: { select: { code: true, label: true } },
        department: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    if (!income) {
      throw new NotFoundException('Daromad yozuvi topilmadi');
    }

    return income;
  }

  async update(id: string, dto: UpdateIncomeDto): Promise<Income> {
    const existing = await this.findOne(id);

    if (dto.categoryCode) await this.assertCategory(dto.categoryCode);
    if (dto.departmentId) await this.assertDepartment(dto.departmentId);

    const data: Prisma.IncomeUpdateInput = {};

    if (dto.date) {
      data.date = this.toStoredDate(dto.date);
      data.period = this.toPeriod(dto.date);
    }

    // Summa yoki to'lov o'zgarsa — ikkalasini qayta hisoblaymiz
    if (
      dto.amountTiyin !== undefined ||
      dto.paidTiyin !== undefined ||
      dto.paymentStatus !== undefined
    ) {
      const amount =
        dto.amountTiyin !== undefined ? BigInt(dto.amountTiyin) : existing.amountTiyin;

      const resolved = this.resolvePayment(
        amount,
        dto.paidTiyin ?? (dto.paymentStatus ? undefined : Number(existing.paidTiyin)),
        dto.paymentStatus,
      );

      data.amountTiyin = amount;
      data.paidTiyin = resolved.paidTiyin;
      data.paymentStatus = resolved.paymentStatus;
    }

    if (dto.categoryCode) data.category = { connect: { code: dto.categoryCode } };
    if (dto.departmentId !== undefined) {
      data.department = dto.departmentId
        ? { connect: { id: dto.departmentId } }
        : { disconnect: true };
    }
    if (dto.clientName !== undefined) data.clientName = dto.clientName;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.contractNo !== undefined) data.contractNo = dto.contractNo;
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;

    return this.prisma.income.update({
      where: { id },
      data,
      include: {
        category: { select: { code: true, label: true } },
        department: { select: { id: true, code: true, name: true } },
      },
    });
  }

  async remove(id: string): Promise<{ success: true }> {
    await this.findOne(id);
    await this.prisma.income.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { success: true };
  }

  // ─────────── Tahlil ───────────

  /** Xizmat turlari kesimida */
  /** Bir nechta yozuvni birdan ochiradi */
  async removeMany(ids: string[], userId?: string): Promise<{ count: number }> {
    if (ids.length === 0) {
      throw new BadRequestException("Ochirish uchun yozuv tanlanmadi");
    }

    const before = await this.prisma.income.aggregate({
      where: { id: { in: ids }, deletedAt: null },
      _sum: { amountTiyin: true },
    });

    const result = await this.prisma.income.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: { deletedAt: new Date() },
    });

    if (userId && result.count > 0) {
      await this.audit.log({
        userId,
        action: "DELETE",
        entity: "income",
        entityId: ids[0] ?? "",
        changes: {
          count: { from: null, to: result.count },
          totalTiyin: {
            from: null,
            to: (before._sum.amountTiyin ?? 0n).toString(),
          },
        },
        summary: `${result.count} ta daromad ochirildi`,
      });
    }

    return { count: result.count };
  }

  /** Filtrga mos barcha yozuvlarni ochiradi */
  async removeByFilter(
    query: QueryIncomeDto,
    userId?: string,
  ): Promise<{ count: number }> {
    const where = await this.buildWhere(query);

    const before = await this.prisma.income.aggregate({
      where,
      _sum: { amountTiyin: true },
    });

    const result = await this.prisma.income.updateMany({
      where,
      data: { deletedAt: new Date() },
    });

    if (userId && result.count > 0) {
      await this.audit.log({
        userId,
        action: "DELETE",
        entity: "income",
        entityId: query.period ?? "filter",
        changes: {
          count: { from: null, to: result.count },
          totalTiyin: {
            from: null,
            to: (before._sum.amountTiyin ?? 0n).toString(),
          },
        },
        summary: `Filtr boyicha ${result.count} ta daromad ochirildi`,
      });
    }

    return { count: result.count };
  }

  /** Filtrga nechta yozuv mos kelishi */
  async countByFilter(query: QueryIncomeDto): Promise<{ count: number }> {
    const where = await this.buildWhere(query);
    const count = await this.prisma.income.count({ where });
    return { count };
  }

  /** Ochirilgan yozuvni tiklaydi */
  async restore(id: string) {
    const income = await this.prisma.income.findUnique({ where: { id } });

    if (!income) {
      throw new NotFoundException("Yozuv topilmadi");
    }
    if (!income.deletedAt) {
      throw new BadRequestException("Bu yozuv ochirilmagan");
    }

    return this.prisma.income.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  /** Savatdagi yozuvlar */
  async findDeleted(period?: string) {
    return this.prisma.income.findMany({
      where: {
        deletedAt: { not: null },
        ...(period ? { period } : {}),
      },
      orderBy: { deletedAt: "desc" },
      take: 200,
      include: {
        category: { select: { code: true, label: true } },
        department: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });
  }

  /** Eng katta yozuvlar */
  async topIncomes(query: QueryIncomeDto, limit = 5) {
    const where = await this.buildWhere(query);

    return this.prisma.income.findMany({
      where,
      orderBy: { amountTiyin: "desc" },
      take: limit,
      include: {
        category: { select: { code: true, label: true } },
        department: { select: { id: true, name: true } },
        region: { select: { code: true, name: true } },
      },
    });
  }

  async summaryByCategory(query: QueryIncomeDto) {
    const where = await this.buildWhere(query);

    const grouped = await this.prisma.income.groupBy({
      by: ['categoryCode'],
      where,
      _sum: { amountTiyin: true, paidTiyin: true },
      _count: { _all: true },
    });

    const categories = await this.prisma.incomeCategory.findMany({
      select: { code: true, label: true },
    });
    const map = new Map(categories.map((c) => [c.code, c.label]));

    const total = grouped.reduce((acc, row) => acc + (row._sum.amountTiyin ?? 0n), 0n);

    const rows = grouped
      .map((row) => {
        const amount = row._sum.amountTiyin ?? 0n;
        return {
          categoryCode: row.categoryCode,
          label: map.get(row.categoryCode) ?? row.categoryCode,
          amountTiyin: amount,
          paidTiyin: row._sum.paidTiyin ?? 0n,
          count: row._count._all,
          sharePercent: total > 0n ? Number((amount * 10000n) / total) / 100 : 0,
        };
      })
      .sort((a, b) => (b.amountTiyin > a.amountTiyin ? 1 : -1));

    return { rows, totalTiyin: total };
  }

  /** Bo'limlar kesimida */
  async summaryByDepartment(query: QueryIncomeDto) {
    const where = await this.buildWhere(query);

    const grouped = await this.prisma.income.groupBy({
      by: ['departmentId'],
      where,
      _sum: { amountTiyin: true, paidTiyin: true },
      _count: { _all: true },
    });

    const departments = await this.prisma.department.findMany({
      select: { id: true, code: true, name: true },
    });
    const map = new Map(departments.map((d) => [d.id, d]));

    const total = grouped.reduce((acc, row) => acc + (row._sum.amountTiyin ?? 0n), 0n);

    const rows = grouped
      .map((row) => {
        const department = row.departmentId ? map.get(row.departmentId) : null;
        const amount = row._sum.amountTiyin ?? 0n;

        return {
          departmentId: row.departmentId,
          code: department?.code ?? null,
          name: department?.name ?? 'Bo\u2018limsiz',
          amountTiyin: amount,
          paidTiyin: row._sum.paidTiyin ?? 0n,
          count: row._count._all,
          sharePercent: total > 0n ? Number((amount * 10000n) / total) / 100 : 0,
        };
      })
      .sort((a, b) => (b.amountTiyin > a.amountTiyin ? 1 : -1));

    return { rows, totalTiyin: total };
  }

  /**
   * ABC-tahlil: mijozlarni daromad ulushi bo'yicha guruhlaydi.
   * A — jami daromadning 80% ini beruvchilar
   * B — keyingi 15%
   * C — qolgan 5%
   *
   * Amalda ko'rsatadiki, daromadning katta qismi kichik guruh mijozdan keladi.
   */
  async abcAnalysis(query: QueryIncomeDto) {
    const where = await this.buildWhere(query);

    const grouped = await this.prisma.income.groupBy({
      by: ['clientName'],
      where: { ...where, clientName: { not: null } },
      _sum: { amountTiyin: true },
      _count: { _all: true },
    });

    const total = grouped.reduce((acc, row) => acc + (row._sum.amountTiyin ?? 0n), 0n);
    if (total === 0n) {
      return { rows: [], totalTiyin: 0n, summary: { A: 0, B: 0, C: 0 } };
    }

    const sorted = grouped
      .map((row) => ({
        clientName: row.clientName ?? '',
        amountTiyin: row._sum.amountTiyin ?? 0n,
        count: row._count._all,
      }))
      .sort((a, b) => (b.amountTiyin > a.amountTiyin ? 1 : -1));

    let cumulative = 0n;
    const summary = { A: 0, B: 0, C: 0 };

    const rows = sorted.map((row) => {
      cumulative += row.amountTiyin;
      const cumulativePercent = Number((cumulative * 10000n) / total) / 100;

      let group: 'A' | 'B' | 'C';
      if (cumulativePercent <= 80) group = 'A';
      else if (cumulativePercent <= 95) group = 'B';
      else group = 'C';

      summary[group] += 1;

      return {
        ...row,
        sharePercent: Number((row.amountTiyin * 10000n) / total) / 100,
        cumulativePercent,
        group,
      };
    });

    return { rows, totalTiyin: total, summary };
  }

  /** Debitorlik qarzi — to'lanmagan va qisman to'langan yozuvlar */
  async receivables(query: QueryIncomeDto) {
    const where = await this.buildWhere(query);

    const items = await this.prisma.income.findMany({
      where: {
        ...where,
        paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
      },
      orderBy: { date: 'asc' },
      include: {
        category: { select: { code: true, label: true } },
        department: { select: { id: true, code: true, name: true } },
      },
    });

    const totalTiyin = items.reduce(
      (acc, item) => acc + (item.amountTiyin - item.paidTiyin),
      0n,
    );

    return { items, totalTiyin, count: items.length };
  }

  async monthlyTrend(months: number, departmentId?: string) {
    const periods = this.lastPeriodKeys(months);

    const grouped = await this.prisma.income.groupBy({
      by: ['period'],
      where: {
        deletedAt: null,
        period: { in: periods },
        ...(departmentId ? { departmentId } : {}),
      },
      _sum: { amountTiyin: true, paidTiyin: true },
      _count: { _all: true },
    });

    const map = new Map(grouped.map((row) => [row.period, row]));

    return periods.map((period) => ({
      period,
      amountTiyin: map.get(period)?._sum.amountTiyin ?? 0n,
      paidTiyin: map.get(period)?._sum.paidTiyin ?? 0n,
      count: map.get(period)?._count._all ?? 0,
    }));
  }

  async comparison(period: string, departmentId?: string) {
    const previous = this.shiftPeriod(period, -1);
    const lastYear = this.shiftPeriod(period, -12);
    const filter = departmentId ? { departmentId } : {};

    const [current, prev, year] = await Promise.all([
      this.prisma.income.aggregate({
        where: { deletedAt: null, period, ...filter },
        _sum: { amountTiyin: true },
      }),
      this.prisma.income.aggregate({
        where: { deletedAt: null, period: previous, ...filter },
        _sum: { amountTiyin: true },
      }),
      this.prisma.income.aggregate({
        where: { deletedAt: null, period: lastYear, ...filter },
        _sum: { amountTiyin: true },
      }),
    ]);

    const currentSum = current._sum.amountTiyin ?? 0n;
    const prevSum = prev._sum.amountTiyin ?? 0n;
    const yearSum = year._sum.amountTiyin ?? 0n;

    return {
      current: { period, amountTiyin: currentSum },
      previous: {
        period: previous,
        amountTiyin: prevSum,
        changePercent: this.percentChange(currentSum, prevSum),
      },
      lastYear: {
        period: lastYear,
        amountTiyin: yearSum,
        changePercent: this.percentChange(currentSum, yearSum),
      },
    };
  }

  private percentChange(current: bigint, base: bigint): number | null {
    if (base === 0n) return null;
    const diff = current - base;
    return Number((diff * 10000n) / (base < 0n ? -base : base)) / 100;
  }

  private lastPeriodKeys(count: number): string[] {
    const now = new Date(Date.now() + TASHKENT_OFFSET_HOURS * 3600_000);
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth() + 1;

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

  private shiftPeriod(period: string, deltaMonths: number): string {
    const [yearStr, monthStr] = period.split('-');
    let year = Number(yearStr);
    let month = Number(monthStr) + deltaMonths;

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
}
