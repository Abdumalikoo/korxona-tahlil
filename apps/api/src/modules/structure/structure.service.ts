import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  aggregate,
  bounds,
  classify,
  compareRange,
  computeInsights,
  filterByPath,
  levelsFor,
  parseDay,
  percentChange,
  periodsEndingIn,
  toNodes,
  toRecords,
  trendMonths,
  type Lookups,
  type Row,
} from './structure.engine';
import {
  COMPARE_LABELS,
  LEVEL_LABELS,
  type CompareMode,
  type DateRange,
  type FlowPart,
  type FlowResult,
  type Insights,
  type PathStep,
  type SectionFilter,
  type SectionSplit,
  type StructureKind,
  type StructureTree,
} from './structure.types';

const TASHKENT_MS = 5 * 3600_000;
const MAX_DAYS = 3 * 366;
/** Yo'l bo'laklari ajratgichi (kalitlarda uchramaydi) */
const PATH_SEPARATOR = '~';

export interface TreeQuery {
  from?: string;
  to?: string;
  section?: string;
  path?: string;
  compare?: string;
  /** "1" — «Doimiy / Boshqa» bosqichisiz (birinchi daraja: daromad turi yoki xarajat guruhi) */
  flat?: string;
}

export interface FlowQuery {
  from?: string;
  to?: string;
  section?: string;
  compare?: string;
}

function todayIso(): string {
  return new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
}

function monthStart(period: string): Date {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1) - TASHKENT_MS);
}

function monthEnd(period: string): Date {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1) - TASHKENT_MS);
}

function inRange(row: Row, b: { start: Date; end: Date }): boolean {
  return row.date >= b.start && row.date < b.end;
}

/**
 * Daromad va xarajat tarkibi: ichma-ich kirish, oqim va modellar.
 *
 * Yozuvlar bir so'rovda yuklanadi (joriy + oldingi davr + 12 oylik trend),
 * guruhlash va tahlil structure.engine.ts da bajariladi.
 */

/** Yozuv sanasining oyi (Toshkent vaqti), "YYYY-MM" */
function monthOf(date: Date): string {
  return new Date(date.getTime() + 5 * 3600_000).toISOString().slice(0, 7);
}
@Injectable()
export class StructureService {
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════ Kirish ma'lumotlari ═══════════

  assertKind(kind: string): StructureKind {
    if (kind !== 'expense' && kind !== 'income') {
      throw new BadRequestException("Tur noto'g'ri: expense yoki income");
    }
    return kind;
  }

  private parseSection(value?: string): SectionFilter {
    if (!value || value === 'ALL') return 'ALL';
    if (value === 'DOIMIY' || value === 'BOSHQA') return value;
    throw new BadRequestException("Bo'lim noto'g'ri: ALL, DOIMIY yoki BOSHQA");
  }

  private parseCompare(value?: string): CompareMode {
    if (!value || value === 'prev') return 'prev';
    if (value === 'yoy') return 'yoy';
    throw new BadRequestException("Solishtirish noto'g'ri: prev yoki yoy");
  }

  private parseRange(from?: string, to?: string): DateRange {
    const today = todayIso();
    const range = { from: from || `${today.slice(0, 4)}-01-01`, to: to || today };
    const a = parseDay(range.from);
    const b = parseDay(range.to);
    if (a === null || b === null) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    if (a > b) throw new BadRequestException('Boshlanish sanasi tugash sanasidan keyin');
    if ((b - a) / 86_400_000 > MAX_DAYS) throw new BadRequestException('Davr 3 yildan oshmasin');
    return range;
  }

  private parsePath(value?: string): string[] {
    if (!value) return [];
    const parts = value.split(PATH_SEPARATOR).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 8 || parts.some((p) => p.length > 120)) throw new BadRequestException("Yo'l noto'g'ri");
    return parts;
  }

  // ═══════════ Ma'lumotnomalar va yozuvlar ═══════════

  private async lookups(kind: StructureKind): Promise<Lookups> {
    const [categories, regions, departments] = await Promise.all([
      kind === 'expense'
        ? this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } })
        : this.prisma.incomeCategory
            .findMany({ select: { code: true, label: true } })
            .then((rows) => rows.map((r) => ({ ...r, parentCode: null as string | null }))),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
    ]);
    return {
      categoryLabel: new Map(categories.map((c) => [c.code, c.label])),
      categoryParent: new Map(categories.map((c) => [c.code, c.parentCode])),
      regionName: new Map(regions.map((r) => [r.code, r.name])),
      departmentName: new Map(departments.map((d) => [d.id, d.name])),
      vehicleOf: new Map(),
    };
  }

  private async loadRows(kind: StructureKind, start: Date, end: Date, section: SectionFilter): Promise<Row[]> {
    const where = {
      deletedAt: null,
      date: { gte: start, lt: end },
      ...(section !== 'ALL' ? { section } : {}),
    };

    if (kind === 'expense') {
      const rows = await this.prisma.expense.findMany({
        where,
        select: {
          id: true, date: true, amountTiyin: true, categoryCode: true, source: true,
          section: true, departmentId: true, regionCode: true, description: true, counterparty: true, documentNo: true,
        },
      });
      // Oy — yozuv SANASI bo'yicha (Toshkent vaqti): ro'yxatlar, Katta modellar va hisobotlar bilan bir xil
      return rows.map((r) => ({ ...r, period: monthOf(r.date), amount: r.amountTiyin }));
    }

    const rows = await this.prisma.income.findMany({
      where,
      select: {
        id: true, date: true, amountTiyin: true, categoryCode: true, source: true,
        section: true, departmentId: true, regionCode: true, description: true, clientName: true, contractNo: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      date: r.date,
      period: monthOf(r.date),
      amount: r.amountTiyin,
      categoryCode: r.categoryCode,
      source: r.source,
      section: r.section,
      departmentId: r.departmentId,
      regionCode: r.regionCode,
      description: r.description,
      counterparty: r.clientName,
      documentNo: r.contractNo,
    }));
  }

  /** VEHICLE manbali xarajatlar uchun: xarajat id → mashina */
  private async attachVehicles(rows: Row[], lk: Lookups): Promise<void> {
    const ids = rows.filter((r) => r.source === 'VEHICLE').map((r) => r.id);
    for (let i = 0; i < ids.length; i += 5000) {
      const links = await this.prisma.vehicleRecord.findMany({
        where: { expenseId: { in: ids.slice(i, i + 5000) } },
        select: { expenseId: true, vehicle: { select: { id: true, plateNumber: true, model: true } } },
      });
      for (const link of links) {
        if (link.expenseId) {
          lk.vehicleOf.set(link.expenseId, { id: link.vehicle.id, label: `${link.vehicle.plateNumber} · ${link.vehicle.model}` });
        }
      }
    }
  }

  /** Joriy, oldingi davr va 12 oylik trendni qamrab oluvchi oyna */
  private window(range: DateRange, previous: DateRange, months: string[]) {
    const current = bounds(range);
    const prev = bounds(previous);
    const trendStart = monthStart(months[0]!);
    const trendEnd = monthEnd(months[months.length - 1]!);
    return {
      current,
      prev,
      start: new Date(Math.min(prev.start.getTime(), trendStart.getTime())),
      end: new Date(Math.max(current.end.getTime(), trendEnd.getTime())),
    };
  }

  // ═══════════ Ichma-ich kirish ═══════════

  async tree(kindInput: string, query: TreeQuery): Promise<StructureTree> {
    const kind = this.assertKind(kindInput);
    const section = this.parseSection(query.section);
    const range = this.parseRange(query.from, query.to);
    const compare = this.parseCompare(query.compare);
    const compareLabel = COMPARE_LABELS[compare];
    const previous = compareRange(range, compare);
    const months = trendMonths(range);
    const pathKeys = this.parsePath(query.path);

    const flat = query.flat === '1' || query.flat === 'true';
    const levels = levelsFor(kind, section, pathKeys, flat);
    if (pathKeys.length >= levels.length) throw new BadRequestException("Yo'l juda chuqur");
    const level = levels[pathKeys.length]!;
    const nextLevel = levels[pathKeys.length + 1] ?? null;

    const win = this.window(range, previous, months);
    const [lk, allRows] = await Promise.all([
      this.lookups(kind),
      this.loadRows(kind, win.start, win.end, section),
    ]);
    if (kind === 'expense' && pathKeys.includes('m:VEHICLE')) await this.attachVehicles(allRows, lk);

    // Yo'l: har bosqich nomi
    const path: PathStep[] = [];
    let scope = allRows;
    pathKeys.forEach((key, i) => {
      const lv = levels[i]!;
      const match = scope.find((row) => classify(lv, row, kind, lk).key === key);
      path.push({ level: lv, key, label: match ? classify(lv, match, kind, lk).label : key });
      scope = scope.filter((row) => classify(lv, row, kind, lk).key === key);
    });

    const rows = filterByPath(allRows, levels, pathKeys, kind, lk);
    const monthSet = new Set(months);
    const current = rows.filter((r) => inRange(r, win.current));
    const prev = rows.filter((r) => inRange(r, win.prev));
    const trendRows = rows.filter((r) => monthSet.has(r.period));

    const total = current.reduce((s, r) => s + r.amount, 0n);
    const previousTotal = prev.reduce((s, r) => s + r.amount, 0n);
    const totalTrend = months.map((p) => trendRows.filter((r) => r.period === p).reduce((s, r) => s + r.amount, 0n).toString());

    const base = {
      kind,
      section,
      compare,
      compareLabel,
      range,
      previousRange: previous,
      months,
      path,
      level,
      levelLabel: LEVEL_LABELS[level],
      nextLevel,
      totalTiyin: total.toString(),
      previousTotalTiyin: previousTotal.toString(),
      changePercent: percentChange(total, previousTotal),
      count: current.length,
      totalTrend,
    };

    if (level === 'records') {
      return { ...base, nodes: [], records: toRecords(current, kind, lk), recordsTotal: current.length, insights: null };
    }

    if (level === 'employee') {
      return this.employees(base, range, previous, months, pathKeys[pathKeys.length - 1]!, compareLabel);
    }

    const items = aggregate(current, prev, trendRows, months, (row) => classify(level, row, kind, lk));

    let sectionTrend: Insights['sectionTrend'] = null;
    if (pathKeys.length === 0 && section === 'ALL') {
      sectionTrend = months.map((period) => {
        const monthRows = trendRows.filter((r) => r.period === period);
        return {
          period,
          doimiyTiyin: monthRows.filter((r) => r.section === 'DOIMIY').reduce((s, r) => s + r.amount, 0n).toString(),
          boshqaTiyin: monthRows.filter((r) => r.section === 'BOSHQA').reduce((s, r) => s + r.amount, 0n).toString(),
        };
      });
    }

    return {
      ...base,
      nodes: toNodes(items, level, nextLevel !== null),
      records: null,
      recordsTotal: 0,
      insights: computeInsights(items, months, kind, sectionTrend, compareLabel),
    };
  }

  /** Ish haqi → joy → xodimlar (tasdiqlangan yuklamalardan, hudud tarixi hisobga olinadi) */
  private async employees(
    base: Omit<StructureTree, 'nodes' | 'records' | 'recordsTotal' | 'insights'>,
    range: DateRange,
    previous: DateRange,
    months: string[],
    placeKey: string,
    compareLabel: string,
  ): Promise<StructureTree> {
    const currentPeriods = new Set(periodsEndingIn(range));
    const previousPeriods = new Set(periodsEndingIn(previous));
    const all = [...new Set([...currentPeriods, ...previousPeriods, ...months])];

    const [entries, locations] = await Promise.all([
      this.prisma.payrollEntry.findMany({
        where: { deletedAt: null, period: { in: all }, batch: { status: 'COMMITTED' } },
        select: {
          employeePinfl: true,
          period: true,
          totalTiyin: true,
          baseTiyin: true,
          bonusTiyin: true,
          employee: { select: { fullName: true, employmentType: true, regionCode: true, departmentId: true } },
        },
      }),
      this.prisma.employeeLocation.findMany({
        where: { period: { in: all } },
        select: { employeePinfl: true, period: true, regionCode: true, employmentType: true },
      }),
    ]);
    const locationOf = new Map(locations.map((l) => [`${l.employeePinfl}|${l.period}`, l]));

    const keyOf = (entry: (typeof entries)[number]): string => {
      const location = locationOf.get(`${entry.employeePinfl}|${entry.period}`);
      const type = location?.employmentType ?? entry.employee.employmentType;
      const region = location?.regionCode ?? entry.employee.regionCode;
      if (type === 'SHARTNOMA') return 'shartnoma';
      if (region === 0) return entry.employee.departmentId ? `d:${entry.employee.departmentId}` : 'r:0';
      return `r:${region}`;
    };

    const monthIndex = new Map(months.map((p, i) => [p, i]));
    const map = new Map<string, { label: string; amount: bigint; previous: bigint; count: number; trend: bigint[] }>();
    // Ish haqi (reestr) — yozilgan joyi bo'yicha to'liq summa (Markazga ajratilgan bayram, choraklik ham shu ish haqi ichida)
    const fullOf = (e: { baseTiyin: bigint; bonusTiyin: bigint; totalTiyin: bigint }) => (e.baseTiyin === 0n ? e.totalTiyin + e.bonusTiyin : e.baseTiyin);
    for (const entry of entries) {
      if (keyOf(entry) !== placeKey) continue;
      const key = `e:${entry.employeePinfl}`;
      let item = map.get(key);
      if (!item) {
        item = { label: entry.employee.fullName, amount: 0n, previous: 0n, count: 0, trend: months.map(() => 0n) };
        map.set(key, item);
      }
      if (currentPeriods.has(entry.period)) {
        item.amount += fullOf(entry);
        item.count += 1;
      }
      if (previousPeriods.has(entry.period)) item.previous += fullOf(entry);
      const index = monthIndex.get(entry.period);
      if (index !== undefined) item.trend[index]! += fullOf(entry);
    }

    const items = [...map.entries()]
      // Ish haqi — doimiy xarajat
      .map(([key, item]) => ({ bucket: { key, label: item.label, module: null }, ...item, doimiy: item.amount }))
      .filter((item) => item.amount !== 0n || item.previous !== 0n)
      .sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));

    return {
      ...base,
      nodes: toNodes(items, 'employee', false),
      records: null,
      recordsTotal: 0,
      insights: computeInsights(items, months, 'expense', null, compareLabel),
    };
  }

  // ═══════════ Oqim: pul qayerdan keladi, qayerga ketadi ═══════════

  async flow(query: FlowQuery): Promise<FlowResult> {
    const section = this.parseSection(query.section);
    const range = this.parseRange(query.from, query.to);
    const compare = this.parseCompare(query.compare);
    const previous = compareRange(range, compare);
    const months = trendMonths(range);
    const win = this.window(range, previous, months);

    const [expenseLk, incomes, expenses] = await Promise.all([
      this.lookups('expense'),
      this.loadRows('income', win.start, win.end, section),
      this.loadRows('expense', win.start, win.end, section),
    ]);

    const incomeBucket = (row: Row) => {
      if (row.source === 'IMPORT' && row.regionCode !== null) return { key: 'REGIONAL', label: 'Hududlar tushumi' };
      return row.section === 'BOSHQA'
        ? { key: 'ONEOFF', label: 'Bir martalik tushumlar' }
        : { key: 'CONTRACT', label: 'Shartnomalar va doimiy tushumlar' };
    };
    const expenseBucket = (row: Row) => {
      const b = classify('group', row, 'expense', expenseLk);
      return { key: b.key, label: b.label };
    };

    const parts = (rows: Row[], bucketOf: (row: Row) => { key: string; label: string }, limit: number) => {
      const map = new Map<string, FlowPart & { amount: bigint; prev: bigint }>();
      for (const row of rows) {
        const current = inRange(row, win.current);
        const prev = inRange(row, win.prev);
        if (!current && !prev) continue;
        const b = bucketOf(row);
        const item = map.get(b.key) ?? { ...b, amountTiyin: '0', previousTiyin: '0', amount: 0n, prev: 0n };
        if (current) item.amount += row.amount;
        if (prev) item.prev += row.amount;
        map.set(b.key, item);
      }
      const sorted = [...map.values()].filter((p) => p.amount > 0n || p.prev > 0n).sort((a, b) => Number(b.amount - a.amount));
      const head = sorted.slice(0, limit);
      const tail = sorted.slice(limit);
      if (tail.length > 0) {
        head.push({
          key: 'rest',
          label: `Boshqalar (${tail.length} ta)`,
          amountTiyin: '0',
          previousTiyin: '0',
          amount: tail.reduce((s, p) => s + p.amount, 0n),
          prev: tail.reduce((s, p) => s + p.prev, 0n),
        });
      }
      const total = head.reduce((s, p) => s + p.amount, 0n);
      const prevTotal = head.reduce((s, p) => s + p.prev, 0n);
      return {
        totalTiyin: total.toString(),
        previousTiyin: prevTotal.toString(),
        parts: head.map((p) => ({ key: p.key, label: p.label, amountTiyin: p.amount.toString(), previousTiyin: p.prev.toString() })),
        total,
        prevTotal,
      };
    };

    const split = (rows: Row[]): SectionSplit => {
      let doimiy = 0n;
      let boshqa = 0n;
      let previousDoimiy = 0n;
      let previousBoshqa = 0n;
      for (const row of rows) {
        const isDoimiy = row.section === 'DOIMIY';
        if (inRange(row, win.current)) {
          if (isDoimiy) doimiy += row.amount;
          else boshqa += row.amount;
        }
        if (inRange(row, win.prev)) {
          if (isDoimiy) previousDoimiy += row.amount;
          else previousBoshqa += row.amount;
        }
      }
      return {
        doimiyTiyin: doimiy.toString(),
        boshqaTiyin: boshqa.toString(),
        previousDoimiyTiyin: previousDoimiy.toString(),
        previousBoshqaTiyin: previousBoshqa.toString(),
      };
    };

    const income = parts(incomes, incomeBucket, 6);
    const expense = parts(expenses, expenseBucket, 9);
    const profit = income.total - expense.total;
    const previousProfit = income.prevTotal - expense.prevTotal;

    return {
      section,
      compare,
      compareLabel: COMPARE_LABELS[compare],
      range,
      previousRange: previous,
      income: { totalTiyin: income.totalTiyin, previousTiyin: income.previousTiyin, parts: income.parts },
      expense: { totalTiyin: expense.totalTiyin, previousTiyin: expense.previousTiyin, parts: expense.parts },
      profitTiyin: profit.toString(),
      previousProfitTiyin: previousProfit.toString(),
      marginPercent: income.total > 0n ? Math.round((Number(profit) / Number(income.total)) * 1000) / 10 : null,
      previousMarginPercent:
        income.prevTotal > 0n ? Math.round((Number(previousProfit) / Number(income.prevTotal)) * 1000) / 10 : null,
      split: { income: split(incomes), expense: split(expenses) },
      months,
      monthly: months.map((period) => ({
        period,
        incomeTiyin: incomes.filter((r) => r.period === period).reduce((s, r) => s + r.amount, 0n).toString(),
        expenseTiyin: expenses.filter((r) => r.period === period).reduce((s, r) => s + r.amount, 0n).toString(),
      })),
    };
  }
}