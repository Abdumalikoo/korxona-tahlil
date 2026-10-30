import { SAFAR_PART, safarExpenseMeta } from '../acc-23106/acc23106.safar-ids';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { loadLocationRefs } from '../payroll/payroll.service';
import { ASSET_GROUP_CODES, policyRouting, readPolicy } from '../expense-policy/policy.util';
import { NO_DEPARTMENT, type CenterDetailResult, type CenterEmployeeRow, type DepartmentDetailResult, type DepartmentRow } from './center.types';
import type { DrillBase, MoneyPart } from './districts.types';
import { bounds, compareRange, parseDay, trendMonths } from './structure.engine';
import { COMPARE_LABELS, type CompareMode, type DateRange, type SectionFilter } from './structure.types';
import { covers, placementAt, readPlacements } from '../../common/placements/placements';
import { CENTRAL_REGION } from '../../common/segments/segments';

const TASHKENT_MS = 5 * 3600_000;
const MAX_DAYS = 3 * 366;
const TREND_MONTHS = 12;
const NO_DEPARTMENT_NAME = "Bo'limga biriktirilmagan";

export interface CenterQuery {
  from?: string;
  to?: string;
  section?: string;
  compare?: string;
}

function todayIso(): string {
  return new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
}
function monthOf(date: Date): string {
  return new Date(date.getTime() + TASHKENT_MS).toISOString().slice(0, 7);
}
function monthStart(period: string): Date {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1) - TASHKENT_MS);
}
function monthEnd(period: string): Date {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1) - TASHKENT_MS);
}
function fmt(tiyin: bigint): string {
  const som = Number(tiyin) / 100;
  const abs = Math.abs(som);
  const sign = som < 0 ? '−' : '';
  const text =
    abs >= 1e9 ? `${(abs / 1e9).toFixed(2).replace('.', ',')} mlrd` : abs >= 1e6 ? `${(abs / 1e6).toFixed(1).replace('.', ',')} mln` : abs >= 1e3 ? `${Math.round(abs / 1e3)} ming` : `${Math.round(abs)}`;
  return `${sign}${text} so'm`;
}
function pctText(current: bigint, previous: bigint): number | null {
  if (previous === 0n) return null;
  return (Number(current - previous) / Number(previous < 0n ? -previous : previous)) * 100;
}

type Part = { label: string; amount: bigint; previous: bigint };

interface DeptAcc {
  id: string;
  name: string;
  order: number;
  income: bigint;
  previousIncome: bigint;
  expense: bigint;
  previousExpense: bigint;
  payroll: bigint;
  previousPayroll: bigint;
  headcount: number;
  parts: Map<string, Part>;
  incomeParts: Map<string, Part>;
  expenseTrend: bigint[];
  employees: Map<string, { salary: bigint; previousSalary: bigint; periods: Set<string> }>;
}

interface Collected {
  base: DrillBase;
  name: string;
  depts: Map<string, DeptAcc>;
  income: bigint;
  previousIncome: bigint;
  own: bigint;
  previousOwn: bigint;
  regional: bigint;
  previousRegional: bigint;
  /** 2-guruh: asosiy vositalar sarfi (eskirish) */
  assets: bigint;
  previousAssets: bigint;
  payroll: bigint;
  previousPayroll: bigint;
  headcount: number;
  previousHeadcount: number;
  incomeParts: Map<string, Part>;
  ownParts: Map<string, Part>;
  regionalParts: Map<string, Part>;
  regionalBy: Map<number | null, bigint>;
  /** Hudud → modda → oy (joriy davr): «Hududlar uchun — kimga» ichma-ich ochilishi uchun */
  regionalByParts: Map<number | null, Map<string, { label: string; amount: bigint; months: Map<string, bigint> }>>;
  regionName: Map<number, string>;
  trend: { income: bigint[]; own: bigint[]; regional: bigint[]; assets: bigint[] };
  /** inCenter — davr oxirida Markazda (joylashuv davri bo'yicha hududga o'tgan bo'lsa — yo'q: bo'lim ro'yxatiga chiqmaydi) */
  employees: Map<string, { fullName: string; position: string | null; employmentType: string; isActive: boolean; departmentId: string | null; inCenter: boolean }>;
}

const addPart = (parts: Map<string, Part>, key: string, label: string, amount: bigint, isCurrent: boolean, isPrevious: boolean) => {
  const p = parts.get(key) ?? { label, amount: 0n, previous: 0n };
  if (isCurrent) p.amount += amount;
  if (isPrevious) p.previous += amount;
  parts.set(key, p);
};
const toParts = (map: Map<string, Part>, limit = 12): MoneyPart[] => {
  const sorted = [...map.entries()].filter(([, p]) => p.amount !== 0n || p.previous !== 0n).sort((a, b) => (b[1].amount > a[1].amount ? 1 : b[1].amount < a[1].amount ? -1 : 0));
  // «Mashina xarajatlari» hech qachon «Boshqalar»ga qo'shilmaydi — ichida mashinalar bo'yicha ochiladi
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  const head = [...top, ...rest.filter(([key]) => key === 'VEHICLE' || key === SAFAR_PART.key)].map(([key, p]) => ({ key, label: p.label, amountTiyin: p.amount.toString(), previousTiyin: p.previous.toString() }));
  const tail = rest.filter(([key]) => key !== 'VEHICLE' && key !== SAFAR_PART.key);
  if (tail.length)
    head.push({
      key: 'rest',
      label: `Boshqalar (${tail.length} ta)`,
      amountTiyin: tail.reduce((s, [, p]) => s + p.amount, 0n).toString(),
      previousTiyin: tail.reduce((s, [, p]) => s + p.previous, 0n).toString(),
    });
  return head;
};

/**
 * Solishtirma › Markaz — hududlardagi kabi ichkariga kirish, faqat reja/tushum yo'q.
 *  • Daromad — Markazga yozilgan daromad (hudud kodi 0 yoki Markaz bo'limi): masalan kassa hisobotidan Markaz tushumi.
 *  • Xarajat ikki guruh: Markazning o'z xarajati (bo'limlar bo'yicha: ish haqi, ijara, mashinalar, boshqa) va
 *    Xarajatlar siyosatidagi «Markaz hisobidan» moddalar — hududlar uchun to'langan.
 *  • Xodimlar — Xodimlar bo'limidagi Markaz xodimlari (bo'limi bilan), ish haqi vedomostidan.
 * Jami — Solishtirmadagi Markaz qatori bilan bir xil yozuvlardan.
 */
@Injectable()
export class CenterService {
  constructor(private readonly prisma: PrismaService) {}

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

  private async collect(query: CenterQuery): Promise<Collected> {
    const section = this.parseSection(query.section);
    const compare = this.parseCompare(query.compare);
    const range = this.parseRange(query.from, query.to);
    const previousRange = compareRange(range, compare);
    const months = trendMonths(range, TREND_MONTHS);
    const monthIndex = new Map(months.map((p, i) => [p, i]));
    const current = bounds(range);
    const prev = bounds(previousRange);
    const start = new Date(Math.min(prev.start.getTime(), monthStart(months[0]!).getTime()));
    const end = new Date(Math.max(current.end.getTime(), monthEnd(months[months.length - 1]!).getTime()));
    const inCurrent = (d: Date) => d >= current.start && d < current.end;
    const inPrevious = (d: Date) => d >= prev.start && d < prev.end;
    const sectionWhere = section !== 'ALL' ? { section } : {};

    const [regions, departments, expenseCategories, incomeCategories, incomes, expenses, employees, policy] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true, index: true, isActive: true }, orderBy: { index: 'asc' } }),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
      this.prisma.income.findMany({
        where: { deletedAt: null, date: { gte: start, lt: end }, ...sectionWhere, OR: [{ regionCode: CENTRAL_REGION, segment: null }, { regionCode: null, departmentId: { not: null }, segment: null }] },
        select: { date: true, amountTiyin: true, categoryCode: true, departmentId: true },
      }),
      this.prisma.expense.findMany({
        where: { deletedAt: null, date: { gte: start, lt: end }, ...sectionWhere },
        select: { id: true, date: true, period: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, source: true, payrollBatchId: true, segment: true },
      }),
      this.prisma.employee.findMany({
        where: { regionCode: CENTRAL_REGION },
        select: { pinfl: true, fullName: true, position: true, employmentType: true, departmentId: true, hiredAt: true, firedAt: true, isActive: true },
      }),
      readPolicy(this.prisma),
    ]);
    // Siyosat: Markaz hisobidagi moddalar; yo'nalishlar (Tax free …) hisobidagilari Markazga kirmaydi
    const routing = policyRouting(policy, expenseCategories);
    // 23106 › xarajatga o'tkazilgan xizmat safarlari — alohida «Xizmat safari» moddasi (ichida xodim → oylar)
    const safarIds = await safarExpenseMeta(this.prisma);
    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const categoryLabel = new Map(expenseCategories.map((c) => [c.code, c.label]));
    const categoryParent = new Map(expenseCategories.map((c) => [c.code, c.parentCode]));
    const incomeLabel = new Map(incomeCategories.map((c) => [c.code, c.label]));

    const depts = new Map<string, DeptAcc>();
    const mk = (id: string, name: string, order: number): DeptAcc => ({
      id,
      name,
      order,
      income: 0n,
      previousIncome: 0n,
      expense: 0n,
      previousExpense: 0n,
      payroll: 0n,
      previousPayroll: 0n,
      headcount: 0,
      parts: new Map(),
      incomeParts: new Map(),
      expenseTrend: months.map(() => 0n),
      employees: new Map(),
    });
    for (const d of departments) if (d.isActive) depts.set(d.id, mk(d.id, d.name, d.index));
    const deptName = new Map(departments.map((d) => [d.id, d.name]));
    const dept = (id: string | null): DeptAcc => {
      const key = id ?? NO_DEPARTMENT;
      let acc = depts.get(key);
      if (!acc) {
        acc = key === NO_DEPARTMENT ? mk(NO_DEPARTMENT, NO_DEPARTMENT_NAME, 1e9) : mk(key, deptName.get(key) ?? "Bo'lim", 1e8);
        depts.set(key, acc);
      }
      return acc;
    };

    const c: Collected = {
      base: { section, compare, compareLabel: COMPARE_LABELS[compare], range, previousRange, months },
      name: regionName.get(CENTRAL_REGION) ?? 'Markaz',
      depts,
      income: 0n,
      previousIncome: 0n,
      own: 0n,
      previousOwn: 0n,
      regional: 0n,
      assets: 0n,
      previousAssets: 0n,
      previousRegional: 0n,
      payroll: 0n,
      previousPayroll: 0n,
      headcount: 0,
      previousHeadcount: 0,
      incomeParts: new Map(),
      ownParts: new Map(),
      regionalParts: new Map(),
      regionalBy: new Map(),
      regionalByParts: new Map(),
      regionName,
      trend: { income: months.map(() => 0n), own: months.map(() => 0n), regional: months.map(() => 0n), assets: months.map(() => 0n) },
      employees: new Map(),
    };

    // ── Daromad ──
    for (const row of incomes) {
      const isCurrent = inCurrent(row.date);
      const isPrevious = inPrevious(row.date);
      const d = dept(row.departmentId);
      const label = incomeLabel.get(row.categoryCode) ?? row.categoryCode;
      if (isCurrent) {
        c.income += row.amountTiyin;
        d.income += row.amountTiyin;
      }
      if (isPrevious) {
        c.previousIncome += row.amountTiyin;
        d.previousIncome += row.amountTiyin;
      }
      if (isCurrent || isPrevious) {
        addPart(c.incomeParts, row.categoryCode, label, row.amountTiyin, isCurrent, isPrevious);
        addPart(d.incomeParts, row.categoryCode, label, row.amountTiyin, isCurrent, isPrevious);
      }
      const i = monthIndex.get(monthOf(row.date));
      if (i !== undefined) c.trend.income[i]! += row.amountTiyin;
    }

    // ── Xarajat ──
    const payrollBatches = new Set<string>();
    const curPeriods = new Set<string>();
    const prevPeriods = new Set<string>();
    for (const row of expenses) {
      // Siyosat: bo'lim qoidasi, so'ng umumiy siyosat — boshqa bo'lim hisobidagilari Markazga kirmaydi
      const routed = routing.route(row);
      if (routed && routed.key !== 'center') continue;
      // «Hududlar uchun» — umumiy siyosat bo'yicha; boshqa bo'limdan bo'lim qoidasi bilan kelgani — Markazning o'z xarajati
      const byPolicy = routed?.origin === 'global';
      const isCenter = Boolean(routed) || (!row.segment && (row.regionCode === CENTRAL_REGION || (row.regionCode === null && row.departmentId !== null)));
      if (!byPolicy && !isCenter) continue;
      const isCurrent = inCurrent(row.date);
      const isPrevious = inPrevious(row.date);
      const i = monthIndex.get(monthOf(row.date));
      if (ASSET_GROUP_CODES.includes(row.categoryCode)) {
        // 2-guruh: asosiy vositalar — balansdagilarning oylik sarfi va xarajatga o'tkazilganlari
        if (isCurrent) c.assets += row.amountTiyin;
        if (isPrevious) c.previousAssets += row.amountTiyin;
        if (i !== undefined) c.trend.assets[i]! += row.amountTiyin;
        continue;
      }
      if (byPolicy) {
        // Hududlar uchun Markaz to'lagan
        const beneficiary = row.regionCode && row.regionCode !== CENTRAL_REGION ? row.regionCode : null;
        if (isCurrent) {
          c.regional += row.amountTiyin;
          c.regionalBy.set(beneficiary, (c.regionalBy.get(beneficiary) ?? 0n) + row.amountTiyin);
          // Ichma-ich: hudud → modda (1b dagi kalitlar bilan bir xil) → oy
          const [pk, pl] = safarIds.has(row.id) ? [SAFAR_PART.key, SAFAR_PART.label] : [row.categoryCode, categoryLabel.get(row.categoryCode) ?? row.categoryCode];
          const byPart = c.regionalByParts.get(beneficiary) ?? new Map();
          const part = byPart.get(pk) ?? { label: pl, amount: 0n, months: new Map<string, bigint>() };
          part.amount += row.amountTiyin;
          const mo = monthOf(row.date);
          part.months.set(mo, (part.months.get(mo) ?? 0n) + row.amountTiyin);
          byPart.set(pk, part);
          c.regionalByParts.set(beneficiary, byPart);
        }
        if (isPrevious) c.previousRegional += row.amountTiyin;
        if (isCurrent || isPrevious) {
          if (safarIds.has(row.id)) addPart(c.regionalParts, SAFAR_PART.key, SAFAR_PART.label, row.amountTiyin, isCurrent, isPrevious);
          else addPart(c.regionalParts, row.categoryCode, categoryLabel.get(row.categoryCode) ?? row.categoryCode, row.amountTiyin, isCurrent, isPrevious);
        }
        if (i !== undefined) c.trend.regional[i]! += row.amountTiyin;
        continue;
      }
      // Markaz bo'limlari siyosati: modda boshqa bo'lim hisobiga yoki «bo'limga biriktirilmagan»
      const d = dept(routing.depOf(row));
      let key: string;
      let label: string;
      if (row.source === 'PAYROLL') {
        key = 'PAYROLL';
        label = 'Ish haqi';
        if (row.payrollBatchId) payrollBatches.add(row.payrollBatchId);
        if (isCurrent) {
          c.payroll += row.amountTiyin;
          d.payroll += row.amountTiyin;
          curPeriods.add(row.period);
        }
        if (isPrevious) {
          c.previousPayroll += row.amountTiyin;
          d.previousPayroll += row.amountTiyin;
          prevPeriods.add(row.period);
        }
      } else if (row.source === 'LEASE') {
        key = 'LEASE';
        label = 'Ijara';
      } else if (row.source === 'VEHICLE') {
        key = 'VEHICLE';
        label = 'Mashina xarajatlari';
      } else if (safarIds.has(row.id)) {
        key = SAFAR_PART.key;
        label = SAFAR_PART.label;
      } else {
        const top = categoryParent.get(row.categoryCode) ?? row.categoryCode;
        key = `c:${top}`;
        label = categoryLabel.get(top) ?? top;
      }
      if (isCurrent) {
        c.own += row.amountTiyin;
        d.expense += row.amountTiyin;
      }
      if (isPrevious) {
        c.previousOwn += row.amountTiyin;
        d.previousExpense += row.amountTiyin;
      }
      if (isCurrent || isPrevious) {
        addPart(c.ownParts, key, label, row.amountTiyin, isCurrent, isPrevious);
        addPart(d.parts, key, label, row.amountTiyin, isCurrent, isPrevious);
      }
      if (i !== undefined) {
        c.trend.own[i]! += row.amountTiyin;
        d.expenseTrend[i]! += row.amountTiyin;
      }
    }

    // ── Xodimlar (Markaz) ──
    const workedIn = (e: (typeof employees)[number], b: { start: Date; end: Date }) =>
      (!e.hiredAt || e.hiredAt < b.end) && (!e.firedAt || e.firedAt >= b.start) && (e.isActive || e.firedAt !== null);
    // Joylashuv davrlari (Xodimlar › «shu oydan shu oygacha shu joyda»): davr oxiridagi joyi, bo'limi va lavozimi —
    // reestrdagidan ustun. Reestrda hududda, davr bo'yicha Markazda bo'lganlar ham qo'shiladi.
    const placements = await readPlacements(this.prisma);
    const curEnd = range.to.slice(0, 7);
    const prevEnd = previousRange.to.slice(0, 7);
    const placedIn = placements.filter((p) => p.unit === 'CENTER' && (covers(p, curEnd) || covers(p, prevEnd)) && !employees.some((e) => e.pinfl === p.pinfl)).map((p) => p.pinfl);
    if (placedIn.length) employees.push(...(await this.prisma.employee.findMany({ where: { pinfl: { in: [...new Set(placedIn)] } }, select: { pinfl: true, fullName: true, position: true, employmentType: true, departmentId: true, hiredAt: true, firedAt: true, isActive: true } })));
    const inCenterAt = (pinfl: string, period: string, registry: boolean) => {
      const pl = placementAt(placements, pinfl, period);
      return pl ? pl.unit === 'CENTER' : registry;
    };
    const registryCenter = new Set(employees.filter((e) => !placedIn.includes(e.pinfl)).map((e) => e.pinfl));
    for (const e of employees) {
      const pl = placementAt(placements, e.pinfl, curEnd);
      const depId = pl?.unit === 'CENTER' ? (pl.departmentId ?? e.departmentId) : e.departmentId;
      const nowIn = inCenterAt(e.pinfl, curEnd, registryCenter.has(e.pinfl));
      c.employees.set(e.pinfl, { fullName: e.fullName, position: pl?.position ?? e.position, employmentType: e.employmentType, isActive: e.isActive, departmentId: depId, inCenter: nowIn });
      if (nowIn && workedIn(e, current)) {
        c.headcount += 1;
        dept(depId).headcount += 1;
      }
      if (inCenterAt(e.pinfl, prevEnd, registryCenter.has(e.pinfl)) && workedIn(e, prev)) c.previousHeadcount += 1;
    }
    // Xodimlar ish haqi — Markaz ish haqi xarajati yozilgan vedomostlardan. Xodim shu oy QAYSI bo'limda ish haqi
    // olgan bo'lsa (natijalar fayli / joy o'zgarishi — ish haqi xarajati qanday guruhlangan bo'lsa), o'sha bo'lim
    // ro'yxatida chiqadi: reestrdagi bo'limi boshqa bo'lsa ham (aks holda bo'lim xarajati va xodimlar jami farq qiladi).
    if (payrollBatches.size) {
      const entries = await this.prisma.payrollEntry.findMany({
        where: { batchId: { in: [...payrollBatches] }, deletedAt: null },
        select: { employeePinfl: true, period: true, totalTiyin: true },
      });
      const periods = [...new Set(entries.map((e) => e.period))];
      const locs = new Map<string, Awaited<ReturnType<typeof loadLocationRefs>>>();
      for (const p of periods) locs.set(p, await loadLocationRefs(this.prisma, p, [...new Set(entries.filter((e) => e.period === p).map((e) => e.employeePinfl))]));
      // Reestrda Markazda bo'lmaganlar (shu oy Markazga o'tkazilgan) — nomi uchun
      const outside = [...new Set(entries.map((e) => e.employeePinfl))].filter((p) => !c.employees.has(p));
      const regOf = new Map<string, { regionCode: number; departmentId: string | null }>();
      if (outside.length) {
        const extra = await this.prisma.employee.findMany({
          where: { pinfl: { in: outside } },
          select: { pinfl: true, fullName: true, position: true, employmentType: true, departmentId: true, regionCode: true, isActive: true },
        });
        for (const e of extra) regOf.set(e.pinfl, { regionCode: e.regionCode, departmentId: e.departmentId });
        for (const e of extra) {
          const inCenter = periods.some((p) => locs.get(p)?.get(e.pinfl)?.regionCode === CENTRAL_REGION);
          // Reestrda Markazda emas — bo'lim ro'yxatiga faqat shu bo'limdan ish haqi olgan bo'lsa chiqadi (pastda, ish haqi
          // qatori bo'yicha); reestrdagi bo'sh bo'lim bilan «Bo'limga biriktirilmagan»ga tushmasin (inCenter: false)
          if (inCenter) c.employees.set(e.pinfl, { fullName: e.fullName, position: e.position, employmentType: e.employmentType, isActive: e.isActive, departmentId: e.departmentId, inCenter: false });
        }
      }
      for (const en of entries) {
        const emp = c.employees.get(en.employeePinfl);
        if (!emp) continue;
        const loc = locs.get(en.period)?.get(en.employeePinfl);
        const region = loc ? loc.regionCode : (regOf.get(en.employeePinfl)?.regionCode ?? CENTRAL_REGION);
        if (region !== CENTRAL_REGION) continue;
        const d = dept(loc?.department ? loc.department.id : emp.departmentId);
        const row = d.employees.get(en.employeePinfl) ?? { salary: 0n, previousSalary: 0n, periods: new Set<string>() };
        if (curPeriods.has(en.period)) {
          row.salary += en.totalTiyin;
          row.periods.add(en.period);
        }
        if (prevPeriods.has(en.period)) row.previousSalary += en.totalTiyin;
        d.employees.set(en.employeePinfl, row);
      }
    }
    return c;
  }

  private row(d: DeptAcc): DepartmentRow {
    const top = [...d.parts.values()].filter((p) => p.amount > 0n).sort((a, b) => (b.amount > a.amount ? 1 : -1)).slice(0, 3);
    return {
      id: d.id,
      name: d.name,
      unassigned: d.id === NO_DEPARTMENT,
      incomeTiyin: d.income.toString(),
      previousIncomeTiyin: d.previousIncome.toString(),
      expenseTiyin: d.expense.toString(),
      previousExpenseTiyin: d.previousExpense.toString(),
      payrollTiyin: d.payroll.toString(),
      previousPayrollTiyin: d.previousPayroll.toString(),
      otherTiyin: (d.expense - d.payroll).toString(),
      headcount: d.headcount,
      perHeadTiyin: d.headcount > 0 ? (d.expense / BigInt(d.headcount)).toString() : null,
      topParts: top.map((p) => ({ label: p.label, amountTiyin: p.amount.toString() })),
      expenseTrend: d.expenseTrend.map(String),
    };
  }

  async center(query: CenterQuery): Promise<CenterDetailResult> {
    return this.centerOf(await this.collect(query), 12);
  }

  /** To'liq hisobot: Markaz + barcha bo'limlar tafsiloti, moddalar cheklovsiz (bitta yig'ishdan) */
  async full(query: CenterQuery): Promise<CenterDetailResult & { details: DepartmentDetailResult[] }> {
    const c = await this.collect(query);
    const center = this.centerOf(c, Infinity);
    const details = await Promise.all(center.departments.map((d) => this.departmentOf(c, d.id, Infinity)));
    return { ...center, details };
  }

  private centerOf(c: Collected, limit: number): CenterDetailResult {
    const rows = [...c.depts.values()]
      // Faol bo'limlar har doim; «biriktirilmagan» — faqat yozuvi bo'lsa
      .filter((d) => d.id !== NO_DEPARTMENT || d.expense !== 0n || d.previousExpense !== 0n || d.income !== 0n || d.headcount > 0)
      .sort((a, b) => (a.id === NO_DEPARTMENT ? 1 : b.id === NO_DEPARTMENT ? -1 : b.expense > a.expense ? 1 : b.expense < a.expense ? -1 : a.order - b.order))
      .map((d) => this.row(d));
    const total = c.own + c.regional + c.assets;
    const previousTotal = c.previousOwn + c.previousRegional + c.previousAssets;

    // ── Xulosalar ──
    const notes: string[] = [];
    const net = total - c.income;
    notes.push(
      c.income > 0n
        ? `Markaz daromadi ${fmt(c.income)}, xarajati ${fmt(total)} — sof xarajat ${fmt(net)}${net <= 0n ? ' (Markaz o\'zini qoplaydi)' : ''}.`
        : `Markaz xarajati ${fmt(total)}; Markazga yozilgan daromad yo'q.`,
    );
    if (c.assets > 0n && total > 0n) notes.push(`Asosiy vositalar sarfi (eskirish) — ${fmt(c.assets)}: xarid balansda turadi, xarajatga faqat oylik sarfi o'tadi.`);
    if (c.regional > 0n && total > 0n) notes.push(`Xarajatning ${((Number(c.regional) / Number(total)) * 100).toFixed(1).replace('.', ',')}% i — hududlar uchun to'langan (${fmt(c.regional)}).`);
    const ch = pctText(c.own, c.previousOwn);
    if (ch !== null && Math.abs(ch) >= 10) notes.push(`O'z xarajati ${c.base.compareLabel}ga nisbatan ${ch > 0 ? '+' : ''}${ch.toFixed(1).replace('.', ',')}% (${fmt(c.previousOwn)} → ${fmt(c.own)}).`);
    const grown = [...c.depts.values()]
      .filter((d) => d.id !== NO_DEPARTMENT && d.previousExpense > 0n)
      .map((d) => ({ d, delta: d.expense - d.previousExpense, p: pctText(d.expense, d.previousExpense) ?? 0 }))
      .filter((x) => x.p >= 20 && x.delta > 0n)
      .sort((a, b) => (b.delta > a.delta ? 1 : -1))[0];
    if (grown) notes.push(`Eng ko'p o'sgan bo'lim — ${grown.d.name}: +${grown.p.toFixed(1).replace('.', ',')}% (${fmt(grown.delta)}).`);
    const withHeads = rows.filter((r) => !r.unassigned && r.perHeadTiyin !== null && r.headcount >= 2);
    if (withHeads.length >= 3) {
      const avg = withHeads.reduce((s, r) => s + Number(r.perHeadTiyin), 0) / withHeads.length;
      const hi = [...withHeads].sort((a, b) => Number(b.perHeadTiyin) - Number(a.perHeadTiyin))[0]!;
      if (Number(hi.perHeadTiyin) > avg * 1.5) notes.push(`Bir xodimga xarajat eng yuqori — ${hi.name}: ${fmt(BigInt(hi.perHeadTiyin!))} (o'rtacha ${fmt(BigInt(Math.round(avg)))}).`);
    }
    const none = c.depts.get(NO_DEPARTMENT);
    if (none && none.expense > 0n) notes.push(`${fmt(none.expense)} xarajat bo'limga biriktirilmagan — Xarajatlarda bo'limini ko'rsating.`);

    const regionalBy = [...c.regionalBy.entries()]
      .map(([code, amount]) => ({ regionCode: code, name: code === null ? 'Hudud ko\'rsatilmagan' : (c.regionName.get(code) ?? `Hudud ${code}`), amountTiyin: amount.toString(),
        parts: [...(c.regionalByParts.get(code) ?? new Map<string, { label: string; amount: bigint; months: Map<string, bigint> }>()).entries()]
          .filter(([, p]) => p.amount !== 0n)
          .sort((a, b) => (b[1].amount > a[1].amount ? 1 : b[1].amount < a[1].amount ? -1 : 0))
          .map(([key, p]) => ({ key, label: p.label, amountTiyin: p.amount.toString(), months: [...p.months.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([period, v]) => ({ period, amountTiyin: v.toString() })) })),
      }))
      .sort((a, b) => Number(BigInt(b.amountTiyin) - BigInt(a.amountTiyin)));

    return {
      ...c.base,
      center: { name: c.name },
      totals: {
        incomeTiyin: c.income.toString(),
        previousIncomeTiyin: c.previousIncome.toString(),
        ownExpenseTiyin: c.own.toString(),
        previousOwnExpenseTiyin: c.previousOwn.toString(),
        regionalExpenseTiyin: c.regional.toString(),
        previousRegionalExpenseTiyin: c.previousRegional.toString(),
        assetsExpenseTiyin: c.assets.toString(),
        previousAssetsExpenseTiyin: c.previousAssets.toString(),
        expenseTiyin: total.toString(),
        previousExpenseTiyin: previousTotal.toString(),
        payrollTiyin: c.payroll.toString(),
        previousPayrollTiyin: c.previousPayroll.toString(),
        headcount: c.headcount,
        previousHeadcount: c.previousHeadcount,
      },
      incomeParts: toParts(c.incomeParts, limit),
      ownParts: toParts(c.ownParts, limit),
      regionalParts: toParts(c.regionalParts, limit),
      regionalBy,
      departments: rows,
      trend: { income: c.trend.income.map(String), own: c.trend.own.map(String), regional: c.trend.regional.map(String), assets: c.trend.assets.map(String) },
      notes,
    };
  }

  async department(id: string, query: CenterQuery): Promise<DepartmentDetailResult> {
    return this.departmentOf(await this.collect(query), id, 12);
  }

  private async departmentOf(c: Collected, id: string, limit: number): Promise<DepartmentDetailResult> {
    const d = c.depts.get(id);
    if (!d) {
      const exists = id !== NO_DEPARTMENT && (await this.prisma.department.findUnique({ where: { id }, select: { id: true } }));
      if (!exists && id !== NO_DEPARTMENT) throw new NotFoundException("Bo'lim topilmadi");
    }
    const acc = d ?? c.depts.get(id) ?? {
      id,
      name: id === NO_DEPARTMENT ? NO_DEPARTMENT_NAME : "Bo'lim",
      order: 0,
      income: 0n,
      previousIncome: 0n,
      expense: 0n,
      previousExpense: 0n,
      payroll: 0n,
      previousPayroll: 0n,
      headcount: 0,
      parts: new Map(),
      incomeParts: new Map(),
      expenseTrend: c.base.months.map(() => 0n),
      employees: new Map(),
    };
    // Bo'lim xodimlari: reestrdagi (shu bo'lim) + davrda ish haqi olganlar
    const employees: CenterEmployeeRow[] = [];
    const seen = new Set<string>();
    const push = (pinfl: string) => {
      if (seen.has(pinfl)) return;
      seen.add(pinfl);
      const e = c.employees.get(pinfl);
      if (!e) return;
      const s = acc.employees.get(pinfl);
      employees.push({
        pinfl,
        fullName: e.fullName,
        position: e.position,
        employmentType: e.employmentType,
        salaryTiyin: (s?.salary ?? 0n).toString(),
        previousSalaryTiyin: (s?.previousSalary ?? 0n).toString(),
        paidMonths: s?.periods.size ?? 0,
        isActive: e.isActive,
      });
    };
    for (const pinfl of acc.employees.keys()) push(pinfl);
    for (const [pinfl, e] of c.employees) if ((e.departmentId ?? NO_DEPARTMENT) === id && e.isActive && e.inCenter) push(pinfl);
    employees.sort((a, b) => Number(BigInt(b.salaryTiyin) - BigInt(a.salaryTiyin)) || a.fullName.localeCompare(b.fullName));

    const notes: string[] = [];
    const ch = pctText(acc.expense, acc.previousExpense);
    if (ch !== null) notes.push(`Bo'lim xarajati ${fmt(acc.expense)} — ${c.base.compareLabel}ga nisbatan ${ch > 0 ? '+' : ''}${ch.toFixed(1).replace('.', ',')}%.`);
    else notes.push(`Bo'lim xarajati ${fmt(acc.expense)}.`);
    if (acc.headcount > 0) notes.push(`Xodimlar: ${acc.headcount} ta; bir xodimga ${fmt(acc.expense / BigInt(acc.headcount))}.`);
    // Tekshiruv: bo'lim ish haqi xarajati = xodimlar ro'yxatidagi ish haqi jami (farq bo'lsa — sababi bilan)
    const listed = employees.reduce((s, e) => s + BigInt(e.salaryTiyin), 0n);
    const gap = acc.payroll - listed;
    if (gap !== 0n)
      notes.push(
        gap > 0n
          ? `Ish haqi xarajati ${fmt(acc.payroll)}, xodimlar ro'yxatida ${fmt(listed)} — ${fmt(gap)} ro'yxatdagi xodimlarga bog'lanmagan (bo'limga qo'lda yozilgan yoki boshqa joydan o'tkazilgan ish haqi).`
          : `Xodimlar ro'yxatidagi ish haqi (${fmt(listed)}) bo'lim ish haqi xarajatidan (${fmt(acc.payroll)}) ${fmt(-gap)} ko'p — ularning bir qismi siyosat bo'yicha boshqa hisobga o'tgan.`,
      );
    const unpaid = employees.filter((e) => e.isActive && e.salaryTiyin === '0').length;
    if (unpaid) notes.push(`${unpaid} ta faol xodimga shu davrda ish haqi yozilmagan.`);
    return {
      ...c.base,
      department: { id, name: acc.name, unassigned: id === NO_DEPARTMENT },
      summary: this.row(acc),
      expenseParts: toParts(acc.parts, limit),
      incomeParts: toParts(acc.incomeParts, limit),
      employees,
      payrollTiyin: acc.payroll.toString(),
      listedPayrollTiyin: listed.toString(),
      notes,
    };
  }
}