import { SAFAR_PART, safarExpenseMeta } from '../acc-23106/acc23106.safar-ids';
import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { UnitPayrollService } from '../unit-payroll/unit-payroll.service';
import { entryUnitLabel, isSegment } from '../../common/segments/segments';
import { PrismaService } from '../prisma/prisma.service';
import { loadCenterCategories } from '../expense-policy/policy.util';
import {
  UNASSIGNED_KEY,
  type DistrictDetailResult,
  type DistrictRow,
  type DrillBase,
  type EmployeeDetailResult,
  type EmployeeMonth,
  type EmployeeRow,
  type MoneyPart,
  type RegionDistrictsResult,
  type ServiceRow,
} from './districts.types';
import { bounds, compareRange, parseDay, periodsEndingIn, trendMonths } from './structure.engine';
import { COMPARE_LABELS, type CompareMode, type DateRange, type SectionFilter } from './structure.types';
import { CENTRAL_REGION } from '../../common/segments/segments';
import { loadLocationRefs } from '../payroll/payroll.service';
import { REGION_VAT } from '../taxes/taxes.service';
import { Nazorat3802Service } from '../qomita/nazorat-3802.service';
import { QOMITA_COVER } from '../qomita/qomita.util';

const TASHKENT_MS = 5 * 3600_000;
const MAX_DAYS = 3 * 366;
const TREND_MONTHS = 12;
const UNASSIGNED_NAME = "Tumanga bo'linmagan";

/** Summani ulushlarga bo'lish (tiyingacha): qoldiq tiyinlar — eng katta kasr qismlarga; yig'indi aniq teng */
export function splitByShare<K>(amount: bigint, weights: Map<K, bigint>): { key: K; amount: bigint }[] {
  const list = [...weights.entries()].filter(([, w]) => w > 0n);
  const total = list.reduce((s, [, w]) => s + w, 0n);
  if (total === 0n) return [];
  const parts = list.map(([key, w]) => ({ key, amount: (amount * w) / total, rem: (amount * w) % total }));
  let left = amount - parts.reduce((s, p) => s + p.amount, 0n);
  for (const p of [...parts].sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : 0))) {
    if (left <= 0n) break;
    p.amount += 1n;
    left -= 1n;
  }
  return parts.map(({ key, amount: a }) => ({ key, amount: a }));
}

export interface DrillQuery {
  from?: string;
  to?: string;
  section?: string;
  compare?: string;
}

function todayIso(): string {
  return new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
}

/** Yozuv sanasining oyi (Toshkent vaqti) */
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
    abs >= 1e9
      ? `${(abs / 1e9).toFixed(2).replace('.', ',')} mlrd`
      : abs >= 1e6
        ? `${(abs / 1e6).toFixed(1).replace('.', ',')} mln`
        : abs >= 1e3
          ? `${Math.round(abs / 1e3)} ming`
          : `${Math.round(abs)}`;
  return `${sign}${text} so'm`;
}

function pct(current: bigint, previous: bigint): string {
  if (previous === 0n) return '';
  const value = (Number(current - previous) / Number(previous < 0n ? -previous : previous)) * 100;
  return `${value > 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}%`;
}

/** Bitta tuman (yoki "tumanga bo'linmagan") bo'yicha yig'uvchi */
interface Acc {
  id: string;
  name: string;
  order: number;
  income: bigint;
  previousIncome: bigint;
  quantity: number;
  previousQuantity: number;
  expense: bigint;
  previousExpense: bigint;
  payroll: bigint;
  lease: bigint;
  other: bigint;
  services: Map<string, { amount: bigint; previous: bigint; quantity: number; previousQuantity: number }>;
  parts: Map<string, { label: string; amount: bigint; previous: bigint }>;
  employees: Map<string, { salary: bigint; previousSalary: bigint; plan: bigint; fact: bigint; bonus: bigint; paidPeriods: Set<string> }>;
  plan: bigint;
  fact: bigint;
  /** «Tumanga bo'linmagan» daromaddan shu tumanga taqsimlangan qism (joriy davr) */
  allocatedIncome: bigint;
  incomeTrend: bigint[];
  expenseTrend: bigint[];
}

/** Summani og'irliklarga proporsional bo'lish (tiyin aniq: qoldiq eng katta ulushga) */
export function splitByWeights(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((a, w) => a + (w > 0n ? w : 0n), 0n);
  if (sum === 0n || total === 0n) return weights.map(() => 0n);
  const out = weights.map((w) => (w > 0n ? (total * w) / sum : 0n));
  const rest = total - out.reduce((a, v) => a + v, 0n);
  if (rest !== 0n) {
    let best = 0;
    weights.forEach((w, i) => {
      if (w > weights[best]!) best = i;
    });
    out[best]! += rest;
  }
  return out;
}

/** Bo'lish asosi: xodimlar tushumi (Natijalar / Reja va tushum) → xodimlar soni → ish haqi */
export type AllocationBasis = 'fact' | 'headcount' | 'payroll';
export const BASIS_LABEL: Record<AllocationBasis, string> = {
  fact: "xodimlar tushumi (reja/tushum fayli) ulushiga",
  headcount: 'xodimlar soniga',
  payroll: "ish haqi xarajatiga",
};

interface Collected {
  base: DrillBase;
  region: { code: number; name: string };
  accs: Map<string, Acc>;
  serviceLabel: Map<string, string>;
  employees: Map<string, { fullName: string; position: string | null; employmentType: string }>;
  notes: string[];
}

/**
 * Solishtirma ichkarisi — viloyat tumanlari, tuman, xodim.
 *
 * Faqat uch bo'lim ma'lumoti ishlatiladi:
 *  • Daromad — Hududlar tushumi (tuman kesimida yuklangan yozuvlar tumanga). Tumansiz yozilgan daromad
 *    tumanlarga taqsimlanadi: xodimlar tushumi (Natijalar / Reja va tushum) ulushiga, bo'lmasa xodimlar soniga,
 *    bo'lmasa ish haqiga qarab (allocatedIncomeTiyin — shundan taqsimlangan qism);
 *  • Xarajat — ish haqi (har bir xodimning oyligi o'sha oy qaysi tumanda ishlagan bo'lsa, o'sha tumanga),
 *    ijara (shartnomadagi tuman), tuman ko'rsatilgan boshqa xarajatlar; qolgani — "Tumanga bo'linmagan";
 *  • Xodimlar — reestr, joylashuv tarixi, ish haqi va Natijalar fayli (reja/fakt daromadga qo'shilmaydi).
 * Tumanlar yig'indisi + "Tumanga bo'linmagan" = viloyat jamisi (Solishtirmadagi bilan bir xil).
 */
@Injectable()
export class DistrictsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly units?: UnitPayrollService,
    @Optional() private readonly nazorat?: Nazorat3802Service,
  ) {}

  // ─────────── Parametrlar ───────────

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

  // ─────────── Asosiy yig'ish ───────────

  private async collect(regionCode: number, query: DrillQuery): Promise<Collected> {
    if (!Number.isInteger(regionCode) || regionCode === CENTRAL_REGION) {
      throw new BadRequestException("Viloyat kodi noto'g'ri (Markazda tumanlar yo'q)");
    }

    const section = this.parseSection(query.section);
    const compare = this.parseCompare(query.compare);
    const range = this.parseRange(query.from, query.to);
    const previous = compareRange(range, compare);
    const months = trendMonths(range, TREND_MONTHS);
    const monthIndex = new Map(months.map((p, i) => [p, i]));

    const current = bounds(range);
    const prev = bounds(previous);
    const start = new Date(Math.min(prev.start.getTime(), monthStart(months[0]!).getTime()));
    const end = new Date(Math.max(current.end.getTime(), monthEnd(months[months.length - 1]!).getTime()));
    const inCurrent = (d: Date) => d >= current.start && d < current.end;
    const inPrevious = (d: Date) => d >= prev.start && d < prev.end;
    const sectionWhere = section !== 'ALL' ? { section } : {};

    const region = await this.prisma.region.findUnique({ where: { code: regionCode }, select: { code: true, name: true } });
    if (!region) throw new NotFoundException('Viloyat topilmadi');

    const [districts, serviceCats, expenseCats, incomes, expenses] = await Promise.all([
      this.prisma.district.findMany({ where: { regionCode }, select: { id: true, name: true, code: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } }),
      this.prisma.income.findMany({
        where: { deletedAt: null, regionCode, date: { gte: start, lt: end }, ...sectionWhere },
        select: { date: true, amountTiyin: true, quantity: true, categoryCode: true, districtId: true },
      }),
      this.prisma.expense.findMany({
        where: { deletedAt: null, regionCode, date: { gte: start, lt: end }, ...sectionWhere },
        select: { id: true, date: true, amountTiyin: true, categoryCode: true, source: true, districtId: true, payrollBatchId: true, period: true },
      }),
    ]);
    // Qo'mita 3802 hovuzidan shu viloyat xodimlariga qoplangan ish haqi — viloyat (tuman) daromadi, Solishtirma bilan bir xil
    const cov = this.nazorat ? await this.nazorat.coverage().catch(() => null) : null;
    for (const [period, m] of cov?.covered ?? []) {
      const date = new Date(`${period}-15T07:00:00Z`);
      if (date < start || date >= end) continue;
      for (const c of m.values()) if (c.regionCode === regionCode && c.amount > 0n) incomes.push({ date, amountTiyin: c.amount, quantity: 0, categoryCode: QOMITA_COVER.code, districtId: c.districtId } as (typeof incomes)[number]);
    }

    // Xarajatlar siyosati: Markaz hisobidagi moddalar viloyat/tuman xarajatiga kirmaydi (Solishtirma bilan bir xil)
    // Umumiy siyosat va Hududlar bo'limi qoidalari: boshqa bo'lim hisobidagi moddalar tuman xarajatiga kirmaydi
    const centerCategories = await loadCenterCategories(this.prisma, expenseCats.map((c) => ({ code: c.code, parentCode: c.parentCode })));
    if (centerCategories.size) {
      for (let i = expenses.length - 1; i >= 0; i--) if (centerCategories.has(expenses[i]!.categoryCode)) expenses.splice(i, 1);
    }

    const districtById = new Map(districts.map((d) => [d.id, d]));
    const serviceLabel = new Map(serviceCats.map((c) => [c.code, c.label]));
    const categoryLabel = new Map(expenseCats.map((c) => [c.code, c.label]));
    const categoryParent = new Map(expenseCats.map((c) => [c.code, c.parentCode]));

    // ── Yig'uvchilar: barcha tumanlar (ma'lumoti bo'lmasa ham ro'yxatda) ──
    const accs = new Map<string, Acc>();
    const make = (id: string, name: string, order: number): Acc => ({
      id,
      name,
      order,
      income: 0n,
      previousIncome: 0n,
      quantity: 0,
      previousQuantity: 0,
      expense: 0n,
      previousExpense: 0n,
      payroll: 0n,
      lease: 0n,
      other: 0n,
      services: new Map(),
      parts: new Map(),
      employees: new Map(),
      plan: 0n,
      fact: 0n,
      allocatedIncome: 0n,
      incomeTrend: months.map(() => 0n),
      expenseTrend: months.map(() => 0n),
    });
    for (const d of districts) accs.set(d.id, make(d.id, d.name, d.code));
    const acc = (districtId: string | null | undefined): Acc => {
      const key = districtId && districtById.has(districtId) ? districtId : UNASSIGNED_KEY;
      let a = accs.get(key);
      if (!a) {
        a = make(UNASSIGNED_KEY, UNASSIGNED_NAME, 1_000_000);
        accs.set(key, a);
      }
      return a;
    };

    // ── Daromad ──
    for (const row of incomes) {
      const a = acc(row.districtId);
      const cur = inCurrent(row.date);
      const old = inPrevious(row.date);
      const q = row.quantity ?? 0;
      if (cur) {
        a.income += row.amountTiyin;
        a.quantity += q;
      }
      if (old) {
        a.previousIncome += row.amountTiyin;
        a.previousQuantity += q;
      }
      if (cur || old) {
        const s = a.services.get(row.categoryCode) ?? { amount: 0n, previous: 0n, quantity: 0, previousQuantity: 0 };
        if (cur) {
          s.amount += row.amountTiyin;
          s.quantity += q;
        }
        if (old) {
          s.previous += row.amountTiyin;
          s.previousQuantity += q;
        }
        a.services.set(row.categoryCode, s);
      }
      const i = monthIndex.get(monthOf(row.date));
      if (i !== undefined) a.incomeTrend[i]! += row.amountTiyin;
    }

    // ── Xarajat: summani tumanlarga bo'lish ──
    type Share = { districtId: string | null; amount: bigint; pinfl?: string };
    const addExpense = (date: Date, share: Share, kind: 'PAYROLL' | 'LEASE' | 'OTHER', partKey: string, partLabel: string, period: string) => {
      const a = acc(share.districtId);
      const cur = inCurrent(date);
      const old = inPrevious(date);
      if (cur) {
        a.expense += share.amount;
        if (kind === 'PAYROLL') a.payroll += share.amount;
        else if (kind === 'LEASE') a.lease += share.amount;
        else a.other += share.amount;
      }
      if (old) a.previousExpense += share.amount;
      if (cur || old) {
        const p = a.parts.get(partKey) ?? { label: partLabel, amount: 0n, previous: 0n };
        if (cur) p.amount += share.amount;
        if (old) p.previous += share.amount;
        a.parts.set(partKey, p);
        if (share.pinfl) {
          const e = a.employees.get(share.pinfl) ?? { salary: 0n, previousSalary: 0n, plan: 0n, fact: 0n, bonus: 0n, paidPeriods: new Set<string>() };
          if (cur) {
            e.salary += share.amount;
            if (share.amount > 0n) e.paidPeriods.add(period);
          }
          if (old) e.previousSalary += share.amount;
          a.employees.set(share.pinfl, e);
        }
      }
      const i = monthIndex.get(monthOf(date));
      if (i !== undefined) a.expenseTrend[i]! += share.amount;
    };

    // Ish haqi: partiya bo'yicha xodimlar oyligi → o'sha oy ishlagan tumani
    const payrollRows = expenses.filter((e) => e.source === 'PAYROLL' && e.payrollBatchId);
    const batchIds = [...new Set(payrollRows.map((e) => e.payrollBatchId!))];
    const entries = batchIds.length
      ? await this.prisma.payrollEntry.findMany({
          where: { batchId: { in: batchIds }, deletedAt: null },
          select: { batchId: true, employeePinfl: true, period: true, totalTiyin: true, baseTiyin: true, bonusTiyin: true },
        })
      : [];
    const pinfls = [...new Set(entries.map((e) => e.employeePinfl))];
    const periods = [...new Set(entries.map((e) => e.period))];

    // Xodim joyi — ish haqi xarajatini viloyatga yozgan qoida bilan aynan bir xil (joylashuv yozuvi + «joylashuv davri»):
    // shunda tumanlar yig'indisi viloyat ish haqiga teng bo'ladi (shtat ham, shartnoma ham — o'z tumaniga)
    const [registry, locationMaps] = await Promise.all([
      this.prisma.employee.findMany({
        where: { OR: [{ pinfl: { in: pinfls } }, { regionCode }] },
        select: { pinfl: true, fullName: true, position: true, employmentType: true, regionCode: true, districtId: true },
      }),
      Promise.all(periods.map(async (p) => [p, await loadLocationRefs(this.prisma, p, pinfls)] as const)),
    ]);
    const registryBy = new Map(registry.map((e) => [e.pinfl, e]));
    const locationBy = new Map(locationMaps.flatMap(([p, m]) => [...m.entries()].map(([pin, l]) => [`${pin}:${p}`, l] as const)));
    /** Ijtimoiy soliqni tumanlarga bo'lish uchun: oy → tuman → to'liq ish haqi (soliq bazasi bilan bir xil: oklad yoki jami + mukofot) */
    const fullBy = new Map<string, Map<string | null, bigint>>();

    const entriesByBatch = new Map<string, typeof entries>();
    for (const e of entries) {
      const list = entriesByBatch.get(e.batchId ?? '') ?? [];
      list.push(e);
      entriesByBatch.set(e.batchId ?? '', list);
    }

    let staleBatches = 0;
    for (const row of payrollRows) {
      const shares: Share[] = [];
      for (const entry of entriesByBatch.get(row.payrollBatchId!) ?? []) {
        const person = registryBy.get(entry.employeePinfl);
        const loc = locationBy.get(`${entry.employeePinfl}:${entry.period}`);
        const effRegion = loc?.regionCode ?? person?.regionCode;
        const effDistrict = loc ? loc.districtId : (person?.districtId ?? null);
        if (effRegion !== regionCode) continue;
        shares.push({ districtId: effDistrict, amount: entry.totalTiyin, pinfl: entry.employeePinfl });
        const full = entry.baseTiyin === 0n ? entry.totalTiyin + entry.bonusTiyin : entry.baseTiyin;
        if (full > 0n) {
          const m = fullBy.get(entry.period) ?? new Map<string | null, bigint>();
          m.set(effDistrict, (m.get(effDistrict) ?? 0n) + full);
          fullBy.set(entry.period, m);
        }
      }
      const assigned = shares.reduce((s, x) => s + x.amount, 0n);
      // Bir partiyada viloyatga bir nechta yozuv bo'lishi mumkin emas, lekin ehtiyot uchun:
      // xodimlar ulushi faqat birinchi (asosiy) yozuvga, qolgani — tumanga bo'linmagan
      const sameBatch = payrollRows.filter((r) => r.payrollBatchId === row.payrollBatchId);
      const isFirst = sameBatch[0]?.id === row.id;
      const batchTotal = sameBatch.reduce((s, r) => s + r.amountTiyin, 0n);
      if (!isFirst) continue;
      for (const share of shares) addExpense(row.date, share, 'PAYROLL', 'PAYROLL', 'Ish haqi', row.period);
      const rest = batchTotal - assigned;
      if (rest !== 0n) {
        staleBatches += 1;
        addExpense(row.date, { districtId: null, amount: rest }, 'PAYROLL', 'PAYROLL', 'Ish haqi', row.period);
      }
    }

    // Ijara: shartnomadagi tuman
    const leaseRows = expenses.filter((e) => e.source === 'LEASE');
    const accruals = leaseRows.length
      ? await this.prisma.leaseAccrual.findMany({
          where: { expenseId: { in: leaseRows.map((e) => e.id) } },
          select: { expenseId: true, lease: { select: { districtId: true } } },
        })
      : [];
    const leaseDistrict = new Map(accruals.map((a) => [a.expenseId!, a.lease.districtId]));
    for (const row of leaseRows) {
      const districtId = row.districtId ?? leaseDistrict.get(row.id) ?? null;
      addExpense(row.date, { districtId, amount: row.amountTiyin }, 'LEASE', 'LEASE', 'Ijara', row.period);
    }

    // Qolganlari: mashinalar, xizmat safari (23106) va boshqa xarajatlar — yozuvda tuman bo'lsa o'sha tumanga
    const safarIds = await safarExpenseMeta(this.prisma);
    // Hudud daromadidan QQS (tumansiz) — daromad tumanlarga taqsimlangandan keyin, o'sha ulushda (pastda)
    const vatRows: { row: (typeof expenses)[number]; key: string; label: string }[] = [];
    for (const row of expenses) {
      if (row.source === 'PAYROLL' || row.source === 'LEASE') continue;
      const top = categoryParent.get(row.categoryCode) ?? row.categoryCode;
      const [key, label] = row.source === 'VEHICLE' ? ['VEHICLE', 'Mashina xarajatlari'] : safarIds.has(row.id) ? [SAFAR_PART.key, SAFAR_PART.label] : [`c:${top}`, categoryLabel.get(top) ?? top];
      // Ish haqidan soliq (ijtimoiy soliq — viloyatga bitta yozuv) — tumanlarga shu oy to'liq ish haqi ulushiga qarab
      if (row.categoryCode === REGION_VAT.code && !row.districtId) {
        vatRows.push({ row, key, label });
        continue;
      }
      const base = row.source === 'TAX' && !row.districtId ? fullBy.get(row.period ?? monthOf(row.date)) : undefined;
      if (base && base.size) {
        for (const part of splitByShare(row.amountTiyin, base)) addExpense(row.date, { districtId: part.key, amount: part.amount }, 'OTHER', key, label, row.period);
        continue;
      }
      addExpense(row.date, { districtId: row.districtId, amount: row.amountTiyin }, 'OTHER', key, label, row.period);
    }
    // PAYROLL yozuvi partiyasiz bo'lsa (qo'lda) — tumanga bo'linmagan
    for (const row of expenses) {
      if (row.source === 'PAYROLL' && !row.payrollBatchId) {
        addExpense(row.date, { districtId: row.districtId, amount: row.amountTiyin }, 'PAYROLL', 'PAYROLL', 'Ish haqi', row.period);
      }
    }

    // ── Natijalar fayli (reja/fakt) — daromadga qo'shilmaydi, ma'lumot uchun ──
    const resultPeriods = periodsEndingIn(range);
    const results = resultPeriods.length
      ? await this.prisma.employeeResult.findMany({
          where: { regionCode, period: { in: resultPeriods }, batch: { cancelledAt: null } },
          select: { employeePinfl: true, districtId: true, planTiyin: true, factTiyin: true, bonusTiyin: true },
        })
      : [];
    const missing = results.map((r) => r.employeePinfl).filter((p) => !registryBy.has(p));
    if (missing.length) {
      const extra = await this.prisma.employee.findMany({
        where: { pinfl: { in: [...new Set(missing)] } },
        select: { pinfl: true, fullName: true, position: true, employmentType: true, regionCode: true, districtId: true },
      });
      for (const e of extra) registryBy.set(e.pinfl, e);
    }
    for (const r of results) {
      const a = acc(r.districtId);
      a.plan += r.planTiyin;
      a.fact += r.factTiyin;
      const e = a.employees.get(r.employeePinfl) ?? { salary: 0n, previousSalary: 0n, plan: 0n, fact: 0n, bonus: 0n, paidPeriods: new Set<string>() };
      e.plan += r.planTiyin;
      e.fact += r.factTiyin;
      e.bonus += r.bonusTiyin;
      a.employees.set(r.employeePinfl, e);
    }

    const notes: string[] = [];

    // ── «Tumanga bo'linmagan» daromad tumanlarga taqsimlanadi ──
    // Hududlar tushumi viloyat darajasida (tumansiz) yuklangan bo'lsa ham, har tuman o'z ulushini ko'rishi kerak.
    // Asos: shu davrda tumandagi xodimlar tushumi (fakt) → xodimlar soni → ish haqi. Asos bo'lmasa — bo'linmaydi.
    const allocation = this.allocateUnassignedIncome(accs);
    // QQS (daromaddan 12%) — tumanlarga daromad bilan bir xil ulushda: har tuman QQS = o'z daromadining 12%
    for (const v of vatRows) {
      const parts = allocation ? splitByWeights(v.row.amountTiyin, allocation.weights) : null;
      if (!parts) {
        addExpense(v.row.date, { districtId: null, amount: v.row.amountTiyin }, 'OTHER', v.key, v.label, v.row.period);
        continue;
      }
      allocation!.ids.forEach((id, i) => {
        if (parts[i]) addExpense(v.row.date, { districtId: id, amount: parts[i]! }, 'OTHER', v.key, v.label, v.row.period);
      });
    }
    if (allocation) {
      notes.push(
        `Tumanga bo'linmagan daromad ${fmt(allocation.amount)} tumanlarga ${BASIS_LABEL[allocation.basis]} qarab taqsimlandi (Hududlar tushumi tuman kesimida yuklanmagan).`,
      );
    }
    if (staleBatches > 0) {
      notes.push(
        "Ish haqining bir qismi tumanlarga to'liq taqsimlanmadi (xodim joylashuvi ish haqi yuklangandan keyin o'zgargan) — farq \"Tumanga bo'linmagan\" qatorida.",
      );
    }

    const employees = new Map(
      [...registryBy.values()].map((e) => [e.pinfl, { fullName: e.fullName, position: e.position, employmentType: e.employmentType }]),
    );

    return {
      base: { section, compare, compareLabel: COMPARE_LABELS[compare], range, previousRange: previous, months },
      region,
      accs,
      serviceLabel,
      employees,
      notes,
    };
  }

  // ─────────── Tumanga bo'linmagan daromadni taqsimlash ───────────

  private allocateUnassignedIncome(accs: Map<string, Acc>): { amount: bigint; basis: AllocationBasis; ids: string[]; weights: bigint[] } | null {
    const u = accs.get(UNASSIGNED_KEY);
    if (!u) return null;
    const hasIncome = u.income !== 0n || u.previousIncome !== 0n || u.incomeTrend.some((v) => v !== 0n);
    if (!hasIncome) return null;
    const real = [...accs.values()].filter((a) => a.id !== UNASSIGNED_KEY);
    if (!real.length) return null;

    const sum = (w: bigint[]) => w.reduce((a, v) => a + (v > 0n ? v : 0n), 0n);
    let basis: AllocationBasis = 'fact';
    let weights = real.map((a) => a.fact);
    if (sum(weights) === 0n) {
      basis = 'headcount';
      weights = real.map((a) => BigInt([...a.employees.values()].filter((e) => e.salary > 0n).length));
    }
    if (sum(weights) === 0n) {
      basis = 'payroll';
      weights = real.map((a) => a.payroll);
    }
    if (sum(weights) === 0n) return null;

    const amount = u.income;
    const give = (field: 'income' | 'previousIncome') => {
      const parts = splitByWeights(u[field], weights);
      real.forEach((a, i) => (a[field] += parts[i]!));
      if (field === 'income') real.forEach((a, i) => (a.allocatedIncome += parts[i]!));
      u[field] = 0n;
    };
    give('income');
    give('previousIncome');
    // Soni (xizmatlar) — butun son
    const splitNum = (total: number) => splitByWeights(BigInt(Math.round(total)), weights).map(Number);
    const q = splitNum(u.quantity);
    const pq = splitNum(u.previousQuantity);
    real.forEach((a, i) => {
      a.quantity += q[i]!;
      a.previousQuantity += pq[i]!;
    });
    u.quantity = 0;
    u.previousQuantity = 0;
    // Xizmatlar tarkibi
    for (const [code, srv] of u.services) {
      const am = splitByWeights(srv.amount, weights);
      const pr = splitByWeights(srv.previous, weights);
      const sq = splitNum(srv.quantity);
      const spq = splitNum(srv.previousQuantity);
      real.forEach((a, i) => {
        if (am[i] === 0n && pr[i] === 0n) return;
        const t = a.services.get(code) ?? { amount: 0n, previous: 0n, quantity: 0, previousQuantity: 0 };
        t.amount += am[i]!;
        t.previous += pr[i]!;
        t.quantity += sq[i]!;
        t.previousQuantity += spq[i]!;
        a.services.set(code, t);
      });
    }
    u.services.clear();
    // Oylik daromad trendi
    u.incomeTrend.forEach((v, m) => {
      if (v === 0n) return;
      const parts = splitByWeights(v, weights);
      real.forEach((a, i) => (a.incomeTrend[m]! += parts[i]!));
      u.incomeTrend[m] = 0n;
    });
    return { amount, basis, ids: real.map((a) => a.id), weights };
  }

  // ─────────── Natijaga aylantirish ───────────

  private toRow(a: Acc, serviceLabel: Map<string, string>): DistrictRow {
    const topServices = [...a.services.entries()]
      .filter(([, s]) => s.amount > 0n)
      .sort((x, y) => (y[1].amount > x[1].amount ? 1 : y[1].amount < x[1].amount ? -1 : 0))
      .slice(0, 3)
      .map(([code, s]) => ({ label: serviceLabel.get(code) ?? code, amountTiyin: s.amount.toString() }));

    const headcount = [...a.employees.values()].filter((e) => e.salary > 0n).length;

    return {
      id: a.id,
      name: a.name,
      unassigned: a.id === UNASSIGNED_KEY,
      incomeTiyin: a.income.toString(),
      previousIncomeTiyin: a.previousIncome.toString(),
      quantity: a.quantity,
      previousQuantity: a.previousQuantity,
      expenseTiyin: a.expense.toString(),
      previousExpenseTiyin: a.previousExpense.toString(),
      payrollTiyin: a.payroll.toString(),
      leaseTiyin: a.lease.toString(),
      otherTiyin: a.other.toString(),
      resultTiyin: (a.income - a.expense).toString(),
      previousResultTiyin: (a.previousIncome - a.previousExpense).toString(),
      headcount,
      planTiyin: a.plan.toString(),
      factTiyin: a.fact.toString(),
      allocatedIncomeTiyin: a.allocatedIncome.toString(),
      topServices,
      incomeTrend: a.incomeTrend.map(String),
      expenseTrend: a.expenseTrend.map(String),
    };
  }

  private isEmpty(a: Acc): boolean {
    return (
      a.income === 0n &&
      a.previousIncome === 0n &&
      a.expense === 0n &&
      a.previousExpense === 0n &&
      a.fact === 0n &&
      a.plan === 0n &&
      a.incomeTrend.every((v) => v === 0n) &&
      a.expenseTrend.every((v) => v === 0n)
    );
  }

  // ─────────── 1) Viloyat → tumanlar ───────────

  async regionDistricts(regionCode: number, query: DrillQuery): Promise<RegionDistrictsResult> {
    return this.regionOf(await this.collect(regionCode, query), regionCode);
  }

  private async regionOf(c: Collected, regionCode: number): Promise<RegionDistrictsResult> {
    const all = [...c.accs.values()];

    const districts = all
      // Tumanga bo'linmagan qator — faqat summasi bo'lsa
      .filter((a) => a.id !== UNASSIGNED_KEY || !this.isEmpty(a))
      .sort((x, y) => x.order - y.order)
      .map((a) => this.toRow(a, c.serviceLabel));

    const sum = (f: (a: Acc) => bigint) => all.reduce((s, a) => s + f(a), 0n);
    const totals = {
      incomeTiyin: sum((a) => a.income).toString(),
      previousIncomeTiyin: sum((a) => a.previousIncome).toString(),
      expenseTiyin: sum((a) => a.expense).toString(),
      previousExpenseTiyin: sum((a) => a.previousExpense).toString(),
      quantity: all.reduce((s, a) => s + a.quantity, 0),
    };

    // Mustaqil tekshiruv: viloyat jamisi to'g'ridan-to'g'ri bazadan
    const cur = bounds(c.base.range);
    const sectionWhere = c.base.section !== 'ALL' ? { section: c.base.section } : {};
    const [incomeDb, expenseDb] = await Promise.all([
      this.prisma.income.aggregate({
        where: { deletedAt: null, regionCode, date: { gte: cur.start, lt: cur.end }, ...sectionWhere },
        _sum: { amountTiyin: true },
      }),
      // Moddalar bo'yicha — siyosat bo'yicha Markaz hisobidagilari tumanlarga kirmaydi (yuklashdagi qoida bilan bir xil)
      this.prisma.expense.groupBy({
        by: ['categoryCode'],
        where: { deletedAt: null, regionCode, date: { gte: cur.start, lt: cur.end }, ...sectionWhere },
        _sum: { amountTiyin: true },
      }),
    ]);
    const cats = await this.prisma.category.findMany({ select: { code: true, parentCode: true } });
    const centerCategories = await loadCenterCategories(this.prisma, cats.map((x) => ({ code: x.code, parentCode: x.parentCode })));
    const expenseOwn = expenseDb.filter((g) => !centerCategories.has(g.categoryCode)).reduce((t, g) => t + (g._sum.amountTiyin ?? 0n), 0n);
    const rowsIncome = districts.reduce((s, d) => s + BigInt(d.incomeTiyin), 0n);
    const rowsExpense = districts.reduce((s, d) => s + BigInt(d.expenseTiyin), 0n);
    // Bazadagi daromad + Qo'mita 3802 hovuzidan shu viloyat xodimlariga qoplangani (yozuv emas — hisob)
    let covIncome = 0n;
    const cov = this.nazorat ? await this.nazorat.coverage().catch(() => null) : null;
    for (const [period, m] of cov?.covered ?? []) {
      const date = new Date(`${period}-15T07:00:00Z`);
      if (date < cur.start || date >= cur.end) continue;
      for (const c of m.values()) if (c.regionCode === regionCode && c.amount > 0n) covIncome += c.amount;
    }
    const check = {
      incomeOk: rowsIncome === (incomeDb._sum.amountTiyin ?? 0n) + covIncome,
      expenseOk: rowsExpense === expenseOwn,
    };

    return {
      ...c.base,
      region: c.region,
      totals,
      districts,
      check,
      notes: [...this.regionNotes(districts, c.base.compareLabel), ...c.notes],
    };
  }

  /** Oddiy tildagi xulosalar: eng ko'p daromad, xarajati eng ko'p o'sgan tuman va h.k. */
  private regionNotes(rows: DistrictRow[], compareLabel: string): string[] {
    const notes: string[] = [];
    const real = rows.filter((r) => !r.unassigned);
    const withIncome = real.filter((r) => BigInt(r.incomeTiyin) > 0n);

    if (withIncome.length > 0) {
      const best = [...withIncome].sort((a, b) => (BigInt(b.incomeTiyin) > BigInt(a.incomeTiyin) ? 1 : -1))[0]!;
      notes.push(`Eng ko'p daromad — ${best.name}: ${fmt(BigInt(best.incomeTiyin))}, ${best.quantity.toLocaleString('ru-RU')} ta xizmat.`);
    } else if (real.length > 0) {
      notes.push("Bu davr uchun tumanlar kesimidagi daromad yuklanmagan — Hududlar tushumini yangi shablon bilan yuklang.");
    }

    const grown = real
      .map((r) => ({ r, diff: BigInt(r.expenseTiyin) - BigInt(r.previousExpenseTiyin) }))
      .filter((x) => x.diff > 0n && BigInt(x.r.previousExpenseTiyin) > 0n)
      .sort((a, b) => (b.diff > a.diff ? 1 : -1));
    if (grown[0]) {
      const { r, diff } = grown[0];
      notes.push(
        `Xarajati eng ko'p o'sgan — ${r.name}: ${compareLabel}ga nisbatan +${fmt(diff)} (${pct(BigInt(r.expenseTiyin), BigInt(r.previousExpenseTiyin))}).`,
      );
    }

    const losing = real.filter((r) => BigInt(r.incomeTiyin) > 0n && BigInt(r.resultTiyin) < 0n);
    if (losing.length > 0) {
      notes.push(`Xarajati daromadidan ko'p tumanlar: ${losing.map((r) => r.name).join(', ')}.`);
    }

    const unassigned = rows.find((r) => r.unassigned);
    if (unassigned && (BigInt(unassigned.incomeTiyin) !== 0n || BigInt(unassigned.expenseTiyin) !== 0n)) {
      notes.push(
        BigInt(unassigned.incomeTiyin) !== 0n
          ? `Tumanga bo'linmagan: daromad ${fmt(BigInt(unassigned.incomeTiyin))}, xarajat ${fmt(BigInt(unassigned.expenseTiyin))} — tumanlarda xodim ma'lumoti yo'q, bo'lib bo'lmadi.`
          : `Tumanga bo'linmagan xarajat ${fmt(BigInt(unassigned.expenseTiyin))} — bazada tumansiz yozilgan.`,
      );
    }
    return notes;
  }

  // ─────────── 2) Tuman ───────────

  async district(districtId: string, query: DrillQuery & { region?: string }): Promise<DistrictDetailResult> {
    let regionCode: number;
    if (districtId === UNASSIGNED_KEY) {
      regionCode = Number(query.region);
      if (!Number.isInteger(regionCode)) throw new BadRequestException("Tumanga bo'linmagan qism uchun viloyat kodi kerak (?region=)");
    } else {
      const d = await this.prisma.district.findUnique({ where: { id: districtId }, select: { regionCode: true } });
      if (!d) throw new NotFoundException('Tuman topilmadi');
      regionCode = d.regionCode;
    }

    const c = await this.collect(regionCode, query);
    const a = c.accs.get(districtId);
    if (!a) {
      if (districtId === UNASSIGNED_KEY) throw new NotFoundException("Bu viloyatda tumanga bo'linmagan yozuv yo'q");
      throw new NotFoundException('Tuman topilmadi');
    }
    return this.detailOf(c, a);
  }

  /** Bitta tuman tafsiloti — yig'ilgan ma'lumotdan (tuman sahifasi va to'liq hisobot uchun bir xil) */
  private detailOf(c: Collected, a: Acc): DistrictDetailResult {
    const services: ServiceRow[] = [...a.services.entries()]
      .map(([code, s]) => ({
        code,
        label: c.serviceLabel.get(code) ?? code,
        quantity: s.quantity,
        previousQuantity: s.previousQuantity,
        amountTiyin: s.amount.toString(),
        previousTiyin: s.previous.toString(),
        averageTiyin: s.quantity > 0 ? (s.amount / BigInt(s.quantity)).toString() : null,
      }))
      .filter((s) => s.amountTiyin !== '0' || s.previousTiyin !== '0')
      .sort((x, y) => (BigInt(y.amountTiyin) > BigInt(x.amountTiyin) ? 1 : BigInt(y.amountTiyin) < BigInt(x.amountTiyin) ? -1 : 0));

    const expenseParts: MoneyPart[] = [...a.parts.entries()]
      .map(([key, p]) => ({ key, label: p.label, amountTiyin: p.amount.toString(), previousTiyin: p.previous.toString() }))
      .filter((p) => p.amountTiyin !== '0' || p.previousTiyin !== '0')
      .sort((x, y) => (BigInt(y.amountTiyin) > BigInt(x.amountTiyin) ? 1 : -1));

    const employees: EmployeeRow[] = [...a.employees.entries()]
      .map(([pinfl, e]) => {
        const person = c.employees.get(pinfl);
        return {
          pinfl,
          fullName: person?.fullName ?? pinfl,
          position: person?.position ?? null,
          employmentType: person?.employmentType ?? 'SHTAT',
          salaryTiyin: e.salary.toString(),
          previousSalaryTiyin: e.previousSalary.toString(),
          planTiyin: e.plan.toString(),
          factTiyin: e.fact.toString(),
          bonusTiyin: e.bonus.toString(),
          paidMonths: e.paidPeriods.size,
        };
      })
      .filter((e) => e.salaryTiyin !== '0' || e.previousSalaryTiyin !== '0' || e.factTiyin !== '0' || e.planTiyin !== '0')
      .sort((x, y) => x.fullName.localeCompare(y.fullName, 'uz'));

    const summary = this.toRow(a, c.serviceLabel);
    const notes: string[] = [];
    const expenseDiff = BigInt(summary.expenseTiyin) - BigInt(summary.previousExpenseTiyin);
    if (expenseDiff !== 0n && BigInt(summary.previousExpenseTiyin) > 0n) {
      const grown = expenseParts
        .map((p) => ({ p, diff: BigInt(p.amountTiyin) - BigInt(p.previousTiyin) }))
        .sort((x, y) => (y.diff > x.diff ? 1 : -1))[0];
      notes.push(
        `Xarajat ${c.base.compareLabel}ga nisbatan ${expenseDiff > 0n ? "o'sdi" : 'kamaydi'}: ${expenseDiff > 0n ? '+' : ''}${fmt(expenseDiff)} (${pct(BigInt(summary.expenseTiyin), BigInt(summary.previousExpenseTiyin))})` +
          (grown && grown.diff > 0n ? `; eng ko'p o'sgani — ${grown.p.label} (+${fmt(grown.diff)}).` : '.'),
      );
    }
    if (services[0]) {
      notes.push(`Eng ko'p daromad keltirgan xizmat — ${services[0].label}: ${fmt(BigInt(services[0].amountTiyin))}, ${services[0].quantity.toLocaleString('ru-RU')} ta.`);
    }
    if (a.id === UNASSIGNED_KEY) {
      notes.push("Bu qismdagi yozuvlarda tuman ko'rsatilmagan — ular viloyat jamisiga kiradi, lekin biror tumanga bog'lab bo'lmaydi.");
    }

    return {
      ...c.base,
      region: c.region,
      district: { id: a.id, name: a.name, unassigned: a.id === UNASSIGNED_KEY },
      summary,
      services,
      expenseParts,
      employees,
      notes: [...notes, ...c.notes],
    };
  }

  // ─────────── To'liq hisobot: viloyat + barcha tumanlar tafsiloti (bitta yig'ishdan) ───────────

  async regionFull(regionCode: number, query: DrillQuery): Promise<RegionDistrictsResult & { details: DistrictDetailResult[] }> {
    const c = await this.collect(regionCode, query);
    const base = await this.regionOf(c, regionCode);
    const details = base.districts
      .map((row) => c.accs.get(row.id))
      .filter((a): a is Acc => Boolean(a))
      .map((a) => this.detailOf(c, a));
    return { ...base, details };
  }

  /**
   * Barcha xodimlarning oylari (to'liq hisobot): ish haqi, reja, fakt, bonus va o'sha oy qaysi hudud/tumanda ishlagani.
   * Xodim sahifasidagi (employee) bilan bir xil manbalar, faqat bitta so'rovda hammasi.
   */
  async employeesMonths(query: DrillQuery): Promise<{ range: DateRange; rows: (EmployeeMonth & { pinfl: string; fullName: string; position: string | null; employmentType: string })[] }> {
    const range = this.parseRange(query.from, query.to);
    const periods = periodsEndingIn(range);
    if (!periods.length) return { range, rows: [] };
    const [entries, results, locations] = await Promise.all([
      this.prisma.payrollEntry.findMany({
        where: { period: { in: periods }, deletedAt: null, batch: { status: 'COMMITTED' } },
        select: { employeePinfl: true, period: true, totalTiyin: true },
      }),
      this.prisma.employeeResult.findMany({
        where: { period: { in: periods }, batch: { cancelledAt: null } },
        select: { employeePinfl: true, period: true, planTiyin: true, factTiyin: true, bonusTiyin: true },
      }),
      this.prisma.employeeLocation.findMany({
        where: { period: { in: periods } },
        select: { employeePinfl: true, period: true, region: { select: { name: true } }, district: { select: { id: true, name: true } } },
      }),
    ]);
    const pinfls = [...new Set([...entries.map((e) => e.employeePinfl), ...results.map((r) => r.employeePinfl)])];
    const people = pinfls.length
      ? await this.prisma.employee.findMany({
          where: { pinfl: { in: pinfls } },
          select: { pinfl: true, fullName: true, position: true, employmentType: true, region: { select: { name: true } }, district: { select: { name: true } } },
        })
      : [];
    const personBy = new Map(people.map((p) => [p.pinfl, p]));
    const locationBy = new Map(locations.map((l) => [`${l.employeePinfl}:${l.period}`, l]));
    const acc = new Map<string, { pinfl: string; period: string; salary: bigint; plan: bigint; fact: bigint; bonus: bigint }>();
    const get = (pinfl: string, period: string) => {
      const key = `${pinfl}:${period}`;
      const v = acc.get(key) ?? { pinfl, period, salary: 0n, plan: 0n, fact: 0n, bonus: 0n };
      acc.set(key, v);
      return v;
    };
    for (const e of entries) get(e.employeePinfl, e.period).salary += e.totalTiyin;
    for (const r of results) {
      const v = get(r.employeePinfl, r.period);
      v.plan += r.planTiyin;
      v.fact += r.factTiyin;
      v.bonus += r.bonusTiyin;
    }
    const rows = [...acc.values()]
      .map((v) => {
        const person = personBy.get(v.pinfl);
        const loc = locationBy.get(`${v.pinfl}:${v.period}`);
        return {
          pinfl: v.pinfl,
          fullName: person?.fullName ?? v.pinfl,
          position: person?.position ?? null,
          employmentType: person?.employmentType ?? 'SHTAT',
          period: v.period,
          regionName: loc?.region.name ?? person?.region.name ?? '',
          districtId: loc ? (loc.district?.id ?? null) : null,
          districtName: loc ? (loc.district?.name ?? null) : (person?.district?.name ?? null),
          salaryTiyin: v.salary.toString(),
          planTiyin: v.plan.toString(),
          factTiyin: v.fact.toString(),
          bonusTiyin: v.bonus.toString(),
        };
      })
      .sort((a, b) => a.regionName.localeCompare(b.regionName, 'uz') || a.fullName.localeCompare(b.fullName, 'uz') || a.period.localeCompare(b.period));
    return { range, rows };
  }

  // ─────────── 3) Xodim ───────────

  async employee(pinfl: string, query: DrillQuery): Promise<EmployeeDetailResult> {
    const range = this.parseRange(query.from, query.to);
    const person = await this.prisma.employee.findUnique({
      where: { pinfl },
      select: {
        pinfl: true,
        fullName: true,
        position: true,
        employmentType: true,
        isActive: true,
        region: { select: { name: true } },
        district: { select: { name: true } },
      },
    });
    if (!person) throw new NotFoundException('Xodim topilmadi');

    const periods = periodsEndingIn(range);
    const [entries, results, locations] = await Promise.all([
      this.prisma.payrollEntry.findMany({
        where: { employeePinfl: pinfl, period: { in: periods }, deletedAt: null, batch: { status: 'COMMITTED' } },
        select: { period: true, totalTiyin: true },
      }),
      this.prisma.employeeResult.findMany({
        where: { employeePinfl: pinfl, period: { in: periods }, batch: { cancelledAt: null } },
        select: { period: true, planTiyin: true, factTiyin: true, bonusTiyin: true },
      }),
      this.prisma.employeeLocation.findMany({
        where: { employeePinfl: pinfl, period: { in: periods } },
        select: { period: true, region: { select: { name: true } }, district: { select: { id: true, name: true } } },
      }),
    ]);

    const byPeriod = new Map<string, { salary: bigint; plan: bigint; fact: bigint; bonus: bigint }>();
    const get = (p: string) => {
      const v = byPeriod.get(p) ?? { salary: 0n, plan: 0n, fact: 0n, bonus: 0n };
      byPeriod.set(p, v);
      return v;
    };
    for (const e of entries) get(e.period).salary += e.totalTiyin;
    for (const r of results) {
      const v = get(r.period);
      v.plan += r.planTiyin;
      v.fact += r.factTiyin;
      v.bonus += r.bonusTiyin;
    }
    // Yo'nalish sahifalarida (Tax free …) yuklangan ish haqi ham — xodim o'sha oy yo'nalishda ishlagan
    if (this.units) {
      for (const p of periods) {
        for (const u of await this.units.allBatches(p)) {
          if (u.batch.status !== 'COMMITTED') continue;
          for (const r of u.batch.rows ?? []) if (r.pinfl === pinfl) get(p).salary += BigInt(r.amountTiyin);
        }
      }
    }
    const locationBy = new Map(locations.map((l) => [l.period, l]));
    // Har oy joyi — hamma sahifa bilan bir xil qoida: yo'nalish «miya»dan (ko'chishlar, ish haqi tarkibi bo'yicha),
    // Markaz bo'limi va hudud/tuman — loadLocationRefs (tarkibdagi bo'lim, natijalar fayli), bo'lmasa Xodimlar bazasi
    const placeBy = new Map<string, { unit: string | null; label: string }>();
    const reg = await this.prisma.employee.findUnique({ where: { pinfl }, select: { department: { select: { name: true } } } });
    for (const p of byPeriod.keys()) {
      const unit = this.units ? ((await this.units.unitsAt([pinfl], p)).get(pinfl) ?? null) : null;
      const ref = (await loadLocationRefs(this.prisma, p, [pinfl])).get(pinfl);
      let label: string;
      if (unit && isSegment(unit)) label = entryUnitLabel(unit);
      else if (unit === 'CENTER' || (!unit && ref?.regionCode === CENTRAL_REGION)) label = `Markaz › ${ref?.department?.name ?? reg?.department?.name ?? "bo'limsiz"}`;
      else {
        const loc = locationBy.get(p);
        const rn = ref?.region.name ?? loc?.region.name ?? person.region.name;
        const dn = ref?.district?.name ?? loc?.district?.name ?? null;
        label = dn ? `${rn} › ${dn}` : rn;
      }
      placeBy.set(p, { unit, label });
    }

    const months = [...byPeriod.keys()]
      .sort()
      .map((period) => {
        const v = byPeriod.get(period)!;
        const loc = locationBy.get(period);
        return {
          period,
          /** Shu oy qayerda ishlagan: «Markaz › bo'lim», «Tax free», «Viloyat › tuman» */
          placeLabel: placeBy.get(period)?.label ?? null,
          unit: placeBy.get(period)?.unit ?? null,
          regionName: loc?.region.name ?? person.region.name,
          districtId: loc ? (loc.district?.id ?? null) : null,
          districtName: loc ? (loc.district?.name ?? null) : (person.district?.name ?? null),
          salaryTiyin: v.salary.toString(),
          planTiyin: v.plan.toString(),
          factTiyin: v.fact.toString(),
          bonusTiyin: v.bonus.toString(),
        };
      });

    const total = (f: (m: (typeof months)[number]) => string) => months.reduce((s, m) => s + BigInt(f(m)), 0n).toString();

    return {
      range,
      employee: {
        pinfl: person.pinfl,
        fullName: person.fullName,
        position: person.position,
        employmentType: person.employmentType,
        regionName: person.region.name,
        districtName: person.district?.name ?? null,
        isActive: person.isActive,
      },
      months,
      totals: {
        salaryTiyin: total((m) => m.salaryTiyin),
        planTiyin: total((m) => m.planTiyin),
        factTiyin: total((m) => m.factTiyin),
        bonusTiyin: total((m) => m.bonusTiyin),
      },
    };
  }
}