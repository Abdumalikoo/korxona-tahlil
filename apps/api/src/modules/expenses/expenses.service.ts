import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import type { Prisma, Expense } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type { CreateExpenseDto } from "./dto/create-expense.dto";
import type { UpdateExpenseDto } from "./dto/update-expense.dto";
import type { QueryExpenseDto } from "./dto/query-expense.dto";

const DEFAULT_LIMIT = 50;
const TASHKENT_OFFSET_HOURS = 5;

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  // --------- Yordamchilar ---------

  /**
   * ISO sanani Toshkent kuni boshiga tenglashtirilgan UTC ga ogiradi.
   * Buxgalter tunda kiritsa ham yozuv togri kunga tushishi uchun.
   */
  private toStoredDate(iso: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!match) {
      throw new BadRequestException("Sana notogri formatda");
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    return new Date(Date.UTC(year, month - 1, day, -TASHKENT_OFFSET_HOURS, 0, 0, 0));
  }

  /** Sanadan davr kalitini hisoblaydi: "2026-09" */
  private toPeriod(iso: string): string {
    const match = /^(\d{4})-(\d{2})/.exec(iso);
    if (!match) {
      throw new BadRequestException("Sana notogri formatda");
    }
    return `${match[1]}-${match[2]}`;
  }

  /**
   * Kategoriya yozuv kiritish uchun yaroqli ekanini tekshiradi.
   * Ota-kategoriyaga yozish taqiqlangan - aks holda yigindilar ikki marta sanaladi.
   */
  private async assertWritableCategory(code: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { code },
      select: { isLeaf: true, isActive: true, label: true },
    });

    if (!category) {
      throw new BadRequestException("Kategoriya topilmadi");
    }
    if (!category.isActive) {
      throw new BadRequestException(`"${category.label}" kategoriyasi arxivlangan`);
    }
    if (!category.isLeaf) {
      throw new BadRequestException(
        `"${category.label}" - bosh kategoriya. Uning ichidagi aniq moddani tanlang`,
      );
    }
  }

  private async assertDepartmentExists(id: string): Promise<void> {
    const department = await this.prisma.department.findUnique({
      where: { id },
      select: { isActive: true },
    });

    if (!department) {
      throw new BadRequestException("Bolim topilmadi");
    }
    if (!department.isActive) {
      throw new BadRequestException("Bolim arxivlangan");
    }
  }

  /** Filtrlardan Prisma where shartini quradi */
  private async buildWhere(query: QueryExpenseDto): Promise<Prisma.ExpenseWhereInput> {
    const where: Prisma.ExpenseWhereInput = { deletedAt: null };

    if (query.period) {
      where.period = query.period;
    } else if (query.periodFrom || query.periodTo) {
      where.period = {
        ...(query.periodFrom ? { gte: query.periodFrom } : {}),
        ...(query.periodTo ? { lte: query.periodTo } : {}),
      };
    }

    if (query.departmentId) {
      where.departmentId = query.departmentId;
    }

    if (query.categoryCode) {
      where.categoryCode = query.categoryCode;
    } else if (query.rootCategoryCode) {
      // Ildiz kategoriya berilsa - barcha bolalarini qamraymiz
      const children = await this.prisma.category.findMany({
        where: { parentCode: query.rootCategoryCode },
        select: { code: true },
      });
      where.categoryCode = { in: children.map((c) => c.code) };
    }

    if (query.paymentMethod) {
      where.paymentMethod = query.paymentMethod;
    }

    if (query.paymentStatus) {
      where.paymentStatus = query.paymentStatus;
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { description: { contains: term, mode: "insensitive" } },
        { counterparty: { contains: term, mode: "insensitive" } },
        { documentNo: { contains: term, mode: "insensitive" } },
        { responsible: { contains: term, mode: "insensitive" } },
      ];
    }

    return where;
  }

  /**
   * Saralash tartibini quradi.
   * Korsatilmasa - sana boyicha kamayish (eng yangisi tepada).
   */
  private buildOrderBy(query: QueryExpenseDto): Prisma.ExpenseOrderByWithRelationInput[] {
    const order = query.sortOrder ?? "desc";

    switch (query.sortBy) {
      case "amountTiyin":
        return [{ amountTiyin: order }, { date: "desc" }];
      case "categoryCode":
        return [{ categoryCode: order }, { date: "desc" }];
      case "createdAt":
        return [{ createdAt: order }];
      case "date":
        return [{ date: order }, { createdAt: "desc" }];
      default:
        return [{ date: "desc" }, { createdAt: "desc" }];
    }
  }

  // --------- Asosiy amallar ---------

  async create(dto: CreateExpenseDto, userId: string): Promise<Expense> {
    await this.assertWritableCategory(dto.categoryCode);

    if (dto.departmentId) {
      await this.assertDepartmentExists(dto.departmentId);
    }

    // QQS umumiy summadan oshmasligi kerak
    if (dto.vatTiyin !== undefined && dto.vatTiyin > dto.amountTiyin) {
      throw new BadRequestException("QQS summasi umumiy summadan katta bolishi mumkin emas");
    }

    return this.prisma.expense.create({
      data: {
        date: this.toStoredDate(dto.date),
        period: this.toPeriod(dto.date),
        amountTiyin: BigInt(dto.amountTiyin),
        categoryCode: dto.categoryCode,
        departmentId: dto.departmentId ?? null,
        description: dto.description ?? null,
        paymentMethod: dto.paymentMethod ?? "BANK",
        documentNo: dto.documentNo ?? null,
        counterparty: dto.counterparty ?? null,
        paymentStatus: dto.paymentStatus ?? "PAID",
        dueDate: dto.dueDate ? this.toStoredDate(dto.dueDate) : null,
        responsible: dto.responsible ?? null,
        vatTiyin: dto.vatTiyin !== undefined ? BigInt(dto.vatTiyin) : null,
        source: "MANUAL",
        createdById: userId,
      },
      include: {
        category: { select: { code: true, label: true, behavior: true } },
        department: { select: { id: true, code: true, name: true } },
      },
    });
  }

  /**
   * Oxshash yozuv bor-yoqligini tekshiradi.
   *
   * Bir xil sana, summa va kategoriya - dublikat belgisi.
   * Bu tosiq emas, ogohlantirish: bir kunda ikkita taksi
   * chindan ham bolishi mumkin.
   */
  async findSimilar(params: {
    date: string;
    amountTiyin: number;
    categoryCode: string;
    excludeId?: string;
  }) {
    const items = await this.prisma.expense.findMany({
      where: {
        deletedAt: null,
        date: this.toStoredDate(params.date),
        amountTiyin: BigInt(params.amountTiyin),
        categoryCode: params.categoryCode,
        ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
      },
      take: 5,
      orderBy: { createdAt: "desc" },
      include: {
        category: { select: { code: true, label: true } },
        department: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    return { items, count: items.length };
  }

  async findAll(query: QueryExpenseDto) {
    const where = await this.buildWhere(query);
    const page = query.page ?? 1;
    const limit = query.limit ?? DEFAULT_LIMIT;

    const [items, total, sum, unpaid] = await Promise.all([
      this.prisma.expense.findMany({
        where,
        orderBy: this.buildOrderBy(query),
        skip: (page - 1) * limit,
        take: limit,
        include: {
          category: { select: { code: true, label: true, behavior: true } },
          department: { select: { id: true, code: true, name: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
      }),
      this.prisma.expense.count({ where }),
      this.prisma.expense.aggregate({ where, _sum: { amountTiyin: true } }),
      this.prisma.expense.aggregate({
        where: { ...where, paymentStatus: { in: ["UNPAID", "PARTIAL"] } },
        _sum: { amountTiyin: true },
        _count: { _all: true },
      }),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        sumTiyin: sum._sum.amountTiyin ?? 0n,
        /** Tolanmagan va qisman tolangan xarajatlar - kreditorlik qarzi */
        unpaidTiyin: unpaid._sum.amountTiyin ?? 0n,
        unpaidCount: unpaid._count._all,
      },
    };
  }

  async findOne(id: string): Promise<Expense> {
    const expense = await this.prisma.expense.findFirst({
      where: { id, deletedAt: null },
      include: {
        category: { select: { code: true, label: true, behavior: true, parentCode: true } },
        department: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });

    if (!expense) {
      throw new NotFoundException("Xarajat yozuvi topilmadi");
    }

    return expense;
  }

  async update(id: string, dto: UpdateExpenseDto): Promise<Expense> {
    await this.findOne(id);

    if (dto.categoryCode) {
      await this.assertWritableCategory(dto.categoryCode);
    }
    if (dto.departmentId) {
      await this.assertDepartmentExists(dto.departmentId);
    }

    const data: Prisma.ExpenseUpdateInput = {};

    if (dto.date) {
      data.date = this.toStoredDate(dto.date);
      data.period = this.toPeriod(dto.date);
    }
    if (dto.amountTiyin !== undefined) {
      data.amountTiyin = BigInt(dto.amountTiyin);
    }
    if (dto.categoryCode) {
      data.category = { connect: { code: dto.categoryCode } };
      data.categoryOverridden = true;
    }
    if (dto.departmentId !== undefined) {
      data.department = dto.departmentId
        ? { connect: { id: dto.departmentId } }
        : { disconnect: true };
    }
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.paymentMethod !== undefined) data.paymentMethod = dto.paymentMethod;
    if (dto.documentNo !== undefined) data.documentNo = dto.documentNo;
    if (dto.counterparty !== undefined) data.counterparty = dto.counterparty;
    if (dto.paymentStatus !== undefined) data.paymentStatus = dto.paymentStatus;
    if (dto.dueDate !== undefined) {
      data.dueDate = dto.dueDate ? this.toStoredDate(dto.dueDate) : null;
    }
    if (dto.responsible !== undefined) data.responsible = dto.responsible;
    if (dto.vatTiyin !== undefined) data.vatTiyin = BigInt(dto.vatTiyin);

    return this.prisma.expense.update({
      where: { id },
      data,
      include: {
        category: { select: { code: true, label: true, behavior: true } },
        department: { select: { id: true, code: true, name: true } },
      },
    });
  }

  /** Yumshoq ochirish - moliyaviy yozuv butunlay yoqotilmaydi */
  async remove(id: string): Promise<{ success: true }> {
    await this.findOne(id);

    await this.prisma.expense.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return { success: true };
  }

  // --------- Tahlil ---------

  /** Kategoriyalar kesimida yigindi */
  async summaryByCategory(query: QueryExpenseDto) {
    const where = await this.buildWhere(query);

    const grouped = await this.prisma.expense.groupBy({
      by: ["categoryCode"],
      where,
      _sum: { amountTiyin: true },
      _count: { _all: true },
    });

    const categories = await this.prisma.category.findMany({
      select: { code: true, label: true, parentCode: true, behavior: true },
    });
    const map = new Map(categories.map((c) => [c.code, c]));

    const total = grouped.reduce((acc, row) => acc + (row._sum.amountTiyin ?? 0n), 0n);

    const rows = grouped
      .map((row) => {
        const category = map.get(row.categoryCode);
        const amount = row._sum.amountTiyin ?? 0n;

        return {
          categoryCode: row.categoryCode,
          label: category?.label ?? row.categoryCode,
          parentCode: category?.parentCode ?? null,
          behavior: category?.behavior ?? null,
          amountTiyin: amount,
          count: row._count._all,
          /** Ulush foizi, ikki kasr xonasi bilan */
          sharePercent: total > 0n ? Number((amount * 10000n) / total) / 100 : 0,
        };
      })
      .sort((a, b) => (b.amountTiyin > a.amountTiyin ? 1 : -1));

    return { rows, totalTiyin: total };
  }

  /** Bolimlar kesimida yigindi */
  async summaryByDepartment(query: QueryExpenseDto) {
    const where = await this.buildWhere(query);

    const grouped = await this.prisma.expense.groupBy({
      by: ["departmentId"],
      where,
      _sum: { amountTiyin: true },
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
          name: department?.name ?? "Bolimsiz",
          amountTiyin: amount,
          count: row._count._all,
          sharePercent: total > 0n ? Number((amount * 10000n) / total) / 100 : 0,
        };
      })
      .sort((a, b) => (b.amountTiyin > a.amountTiyin ? 1 : -1));

    return { rows, totalTiyin: total };
  }

  /** Doimiy va ozgaruvchan xarajatlar nisbati */
  async summaryByBehavior(query: QueryExpenseDto) {
    const where = await this.buildWhere(query);

    const expenses = await this.prisma.expense.findMany({
      where,
      select: { amountTiyin: true, category: { select: { behavior: true } } },
    });

    const totals = { FIXED: 0n, VARIABLE: 0n, MIXED: 0n };

    for (const expense of expenses) {
      totals[expense.category.behavior] += expense.amountTiyin;
    }

    const total = totals.FIXED + totals.VARIABLE + totals.MIXED;

    return {
      fixedTiyin: totals.FIXED,
      variableTiyin: totals.VARIABLE,
      mixedTiyin: totals.MIXED,
      totalTiyin: total,
    };
  }

  /** Oylik dinamika - grafik uchun */
  async monthlyTrend(months: number, departmentId?: string) {
    const periods = this.lastPeriodKeys(months);

    const grouped = await this.prisma.expense.groupBy({
      by: ["period"],
      where: {
        deletedAt: null,
        period: { in: periods },
        ...(departmentId ? { departmentId } : {}),
      },
      _sum: { amountTiyin: true },
      _count: { _all: true },
    });

    const map = new Map(grouped.map((row) => [row.period, row]));

    // Malumot bolmagan oylar ham nol bilan qaytadi - grafikda uzilish bolmasligi uchun
    return periods.map((period) => ({
      period,
      amountTiyin: map.get(period)?._sum.amountTiyin ?? 0n,
      count: map.get(period)?._count._all ?? 0,
    }));
  }

  /** Joriy davrni otgan oy va otgan yilning shu oyi bilan solishtiradi */
  async comparison(period: string, departmentId?: string) {
    const previous = this.shiftPeriod(period, -1);
    const lastYear = this.shiftPeriod(period, -12);

    const filter = departmentId ? { departmentId } : {};

    const [current, prev, year] = await Promise.all([
      this.prisma.expense.aggregate({
        where: { deletedAt: null, period, ...filter },
        _sum: { amountTiyin: true },
      }),
      this.prisma.expense.aggregate({
        where: { deletedAt: null, period: previous, ...filter },
        _sum: { amountTiyin: true },
      }),
      this.prisma.expense.aggregate({
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

  /**
   * Ozgarish foizi.
   * Baza nol bolsa null - "cheksiz osish" korsatilmasligi kerak.
   */
  /**
   * Keskin ozgargan kategoriyalarni topadi.
   *
   * Joriy davrni oldingi davr bilan solishtiradi va berilgan
   * chegaradan koproq ozgargan moddalarni qaytaradi.
   */
  async spikes(period: string, thresholdPercent = 30, departmentId?: string) {
    const previous = this.shiftPeriod(period, -1);
    const filter = departmentId ? { departmentId } : {};

    const [current, prior, categories] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ["categoryCode"],
        where: { deletedAt: null, period, ...filter },
        _sum: { amountTiyin: true },
      }),
      this.prisma.expense.groupBy({
        by: ["categoryCode"],
        where: { deletedAt: null, period: previous, ...filter },
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
      diffTiyin: bigint;
      changePercent: number | null;
      isNew: boolean;
    }[] = [];

    for (const row of current) {
      const currentSum = row._sum.amountTiyin ?? 0n;
      const previousSum = priorMap.get(row.categoryCode) ?? 0n;
      const diff = currentSum - previousSum;

      const isNew = previousSum === 0n;
      const change = this.percentChange(currentSum, previousSum);

      const significant = isNew || (change !== null && change >= thresholdPercent);
      if (!significant) continue;

      rows.push({
        categoryCode: row.categoryCode,
        label: labels.get(row.categoryCode) ?? row.categoryCode,
        currentTiyin: currentSum,
        previousTiyin: previousSum,
        diffTiyin: diff,
        changePercent: change,
        isNew,
      });
    }

    rows.sort((a, b) => (b.diffTiyin > a.diffTiyin ? 1 : -1));

    return { period, previousPeriod: previous, thresholdPercent, rows };
  }

  private percentChange(current: bigint, base: bigint): number | null {
    if (base === 0n) return null;
    const diff = current - base;
    return Number((diff * 10000n) / (base < 0n ? -base : base)) / 100;
  }

  private lastPeriodKeys(count: number): string[] {
    const now = new Date(Date.now() + TASHKENT_OFFSET_HOURS * 3600000);
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth() + 1;

    const result: string[] = [];

    for (let i = 0; i < count; i += 1) {
      result.unshift(`${year}-${String(month).padStart(2, "0")}`);
      month -= 1;
      if (month === 0) {
        month = 12;
        year -= 1;
      }
    }

    return result;
  }

  private shiftPeriod(period: string, deltaMonths: number): string {
    const [yearStr, monthStr] = period.split("-");
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

    return `${year}-${String(month).padStart(2, "0")}`;
  }
}