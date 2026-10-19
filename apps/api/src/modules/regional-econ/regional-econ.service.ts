import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { assertPeriod, CENTRAL_REGION, currentPeriod, monthName, shiftPeriod } from '../regional-data/rd.util';
import { allocate, DRIVER_LABELS, DRIVERS, type Driver, growth, ratio, ROLE_LABELS, ROLES, type Role } from './allocation.calc';
import { CENTER_UNIT, type Lookups, loadLookups, loadMonths, type MonthData, UNASSIGNED_UNIT } from './econ.loader';
import { type RuleRow, ruleFor, suggestRule } from './econ.rules';

// ═══════════════════════════════════════════════════════════
// F. Markaz xarajatini hududlarga taqsimlash va G. Hudud natijasi (Katta modellar).
//
//   Hudud operatsion natijasi   = Daromad − (Ish haqi + Operatsion xarajat)
//   Taqsimlangan Markaz ulushi  = Σ_bo'lim Σ_oy  Xarajat(bo'lim, oy) × Drayver(hudud, oy) / Σ Drayver(oy)
//   Tuzatilgan natija           = Operatsion natija − Taqsimlangan Markaz ulushi
//   Tekshiruv: Σ taqsimlangan + Markazda qolgan = Markaz xarajati (aniq, tiyingacha);
//              Σ hudud tuzatilgan + Markaz tuzatilgan + biriktirilmagan = korxona natijasi.
// Har oy alohida taqsimlanadi (o'sha oy qoidasi va drayveri bilan), keyin davr bo'yicha qo'shiladi.
// ═══════════════════════════════════════════════════════════

export type RangeMode = 'M' | 'Q' | 'Y';

export interface Range {
  mode: RangeMode;
  from: string;
  to: string;
  periods: string[];
  label: string;
  prevPeriods: string[];
  prevLabel: string;
}

export function resolveRange(toRaw?: string, modeRaw?: string): Range {
  const to = toRaw && /^\d{4}-(0[1-9]|1[0-2])$/.test(toRaw) ? toRaw : currentPeriod();
  const mode: RangeMode = modeRaw === 'Q' || modeRaw === 'Y' ? modeRaw : 'M';
  let periods: string[];
  let prevPeriods: string[];
  if (mode === 'M') {
    periods = [to];
    prevPeriods = [shiftPeriod(to, -1)];
  } else if (mode === 'Q') {
    periods = [-2, -1, 0].map((k) => shiftPeriod(to, k));
    prevPeriods = periods.map((p) => shiftPeriod(p, -3));
  } else {
    const n = Number(to.slice(5));
    periods = Array.from({ length: n }, (_, i) => shiftPeriod(to, i - n + 1));
    prevPeriods = periods.map((p) => shiftPeriod(p, -12));
  }
  const lab = (ps: string[]) =>
    mode === 'Y' ? `${ps[0]!.slice(0, 4)} yil boshidan ${monthName(ps[ps.length - 1]!).split(' ')[0]!.toLowerCase()} oxirigacha` : ps.length === 1 ? monthName(ps[0]!) : `${monthName(ps[0]!)} – ${monthName(ps[ps.length - 1]!)}`;
  return { mode, from: periods[0]!, to, periods, label: lab(periods), prevPeriods, prevLabel: lab(prevPeriods) };
}

type Retain = 'NO_RULE' | 'CORPORATE' | 'REVENUE' | 'ZERO_DRIVER';
const RETAIN_LABELS: Record<Retain, string> = {
  NO_RULE: "Qoida belgilanmagan — Markazda qoldi",
  CORPORATE: 'Umumkorporativ — Markazda qoladi',
  REVENUE: "Daromad keltiruvchi — o'z daromadi bilan Markazda",
  ZERO_DRIVER: "Drayver qiymatlari yo'q (hammasi 0) — taqsimlanmadi",
};

interface UnitAgg {
  key: string;
  name: string;
  kind: 'department' | 'center' | 'unassigned';
  income: bigint;
  expense: bigint;
  allocated: bigint;
  retained: bigint;
  byRegion: Map<number, bigint>;
  retainReasons: Map<Retain, bigint>;
  rulesUsed: Set<string>;
  months: { period: string; role: string | null; driver: string | null; expense: bigint; allocated: bigint; reason: Retain | null }[];
}

interface OverheadCalc {
  units: UnitAgg[];
  byRegion: Map<number, bigint>;
  centralExpense: bigint;
  centralIncome: bigint;
  allocated: bigint;
  /** Har oy SUPPORT qoidasi bilan taqsimlangan summa (sezgirlik tahlili uchun) */
  supportPool: Map<string, bigint>;
}

interface PerfRow {
  code: number;
  name: string;
  revenueTiyin: string;
  resultTiyin: string;
  adjustedTiyin: string;
  allocatedTiyin: string;
  coverage: number | null;
  payrollShare: number | null;
  revenueGrowth: number | null;
  adjustedMargin: number | null;
  prev: { hasData: boolean };
  budget: { variance: number | null } | null;
  fteMissing: number;
  peer: 'A' | 'B' | 'C' | null;
  hasData: boolean;
}

const S = (x: bigint) => x.toString();
const mapObj = (m: Map<number, bigint>) => Object.fromEntries([...m.entries()].map(([k, v]) => [k, v.toString()]));
const sum = (xs: Iterable<bigint>) => {
  let s = 0n;
  for (const x of xs) s += x;
  return s;
};
const pct = (x: number | null) => (x === null ? '—' : `${x < 0 ? '−' : ''}${Math.abs(x * 100).toFixed(1).replace('.', ',')}%`);
const mln = (t: bigint) => `${(Number(t) / 1e8).toFixed(1).replace('.', ',')} mln so'm`;

export function driverWeights(m: MonthData, driver: Driver, unitKey: string, regionCodes: number[]): Map<number, number> {
  const w = new Map<number, number>();
  for (const code of regionCodes) {
    const r = m.regions.get(code);
    if (!r) continue;
    const v =
      driver === 'HEADCOUNT' ? r.headcount
        : driver === 'FTE' ? r.fte
          : driver === 'PAYROLL_RECORDS' ? r.payrollRecords
            : driver === 'REVENUE' ? Number(r.revenue)
              : driver === 'TRANSACTIONS' ? r.incomeCount + r.expenseCount
                : driver === 'EQUAL' ? 1
                  : (m.manual.get(unitKey)?.get(code) ?? 0);
    w.set(code, v);
  }
  return w;
}

@Injectable()
export class RegionalEconService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async rules(): Promise<RuleRow[]> {
    return this.prisma.overheadRule.findMany({ orderBy: { validFrom: 'desc' } });
  }

  private unitName(lk: Lookups, key: string): { name: string; kind: UnitAgg['kind'] } {
    if (key === CENTER_UNIT) return { name: "Markaz — bo'limsiz xarajatlar", kind: 'center' };
    if (key === UNASSIGNED_UNIT) return { name: 'Biriktirilmagan (hudud ham, bo\'lim ham yo\'q)', kind: 'unassigned' };
    const d = lk.departments.find((x) => x.id === key);
    return { name: d ? d.name : `Bo'lim ${key}`, kind: 'department' };
  }

  /** Oylar bo'yicha taqsimlash (sof hisob — ma'lumot oldindan yuklangan) */
  computeOverhead(months: MonthData[], rules: RuleRow[], lk: Lookups): OverheadCalc {
    const codes = lk.regions.map((r) => r.code);
    const units = new Map<string, UnitAgg>();
    const byRegion = new Map<number, bigint>(codes.map((c) => [c, 0n]));
    const supportPool = new Map<string, bigint>();
    const unit = (key: string) => {
      let u = units.get(key);
      if (!u) {
        const n = this.unitName(lk, key);
        u = { key, name: n.name, kind: n.kind, income: 0n, expense: 0n, allocated: 0n, retained: 0n, byRegion: new Map(), retainReasons: new Map(), rulesUsed: new Set(), months: [] };
        units.set(key, u);
      }
      return u;
    };
    for (const m of months) {
      for (const [key, money] of m.units) {
        const u = unit(key);
        u.income += money.income;
        u.expense += money.expense;
        const rule = ruleFor(rules, key, m.period);
        let reason: Retain | null = null;
        let allocated = 0n;
        if (!rule) reason = 'NO_RULE';
        else if (rule.role === 'CORPORATE') reason = 'CORPORATE';
        else if (rule.role === 'REVENUE') reason = 'REVENUE';
        else {
          const parts = allocate(money.expense, driverWeights(m, (rule.driver ?? 'HEADCOUNT') as Driver, key, codes));
          if (!parts.size && money.expense !== 0n) reason = 'ZERO_DRIVER';
          for (const [code, v] of parts) {
            u.byRegion.set(code, (u.byRegion.get(code) ?? 0n) + v);
            byRegion.set(code, (byRegion.get(code) ?? 0n) + v);
            allocated += v;
          }
          supportPool.set(m.period, (supportPool.get(m.period) ?? 0n) + allocated);
        }
        if (rule) u.rulesUsed.add(`${rule.role}/${rule.driver ?? ''}`);
        u.allocated += allocated;
        const kept = money.expense - allocated;
        u.retained += kept;
        if (reason && kept !== 0n) u.retainReasons.set(reason, (u.retainReasons.get(reason) ?? 0n) + kept);
        u.months.push({ period: m.period, role: rule?.role ?? null, driver: rule?.driver ?? null, expense: money.expense, allocated, reason });
      }
    }
    const list = [...units.values()].filter((u) => u.expense !== 0n || u.income !== 0n);
    const central = list.filter((u) => u.kind !== 'unassigned');
    return {
      units: list.sort((a, b) => (b.expense > a.expense ? 1 : b.expense < a.expense ? -1 : 0)),
      byRegion,
      centralExpense: sum(central.map((u) => u.expense)),
      centralIncome: sum(central.map((u) => u.income)),
      allocated: sum(list.map((u) => u.allocated)),
      supportPool,
    };
  }

  /** Bir xil yig'indini boshqa drayverlar bilan bo'lganda hudud ulushi qanday o'zgaradi */
  sensitivity(months: MonthData[], calc: OverheadCalc, lk: Lookups) {
    const codes = lk.regions.map((r) => r.code);
    const drivers = DRIVERS.filter((d) => d !== 'MANUAL');
    return drivers.map((d) => {
      const by = new Map<number, bigint>(codes.map((c) => [c, 0n]));
      let unallocated = 0n;
      for (const m of months) {
        const pool = calc.supportPool.get(m.period) ?? 0n;
        if (!pool) continue;
        const parts = allocate(pool, driverWeights(m, d, '', codes));
        if (!parts.size) unallocated += pool;
        for (const [c, v] of parts) by.set(c, (by.get(c) ?? 0n) + v);
      }
      return { driver: d, label: DRIVER_LABELS[d], byRegion: mapObj(by), unallocatedTiyin: S(unallocated) };
    });
  }

  private async closedSet(periods: string[]): Promise<Set<string>> {
    const rows = await this.prisma.regionalPeriodClose.findMany({ where: { period: { in: periods } }, select: { period: true } });
    return new Set(rows.map((r) => r.period));
  }

  // ─────────────────────────── F. Markaz xarajati ───────────────────────────
  async overhead(to?: string, mode?: string) {
    const range = resolveRange(to, mode);
    const lk = await loadLookups(this.prisma);
    const [months, rules, closed] = await Promise.all([loadMonths(this.prisma, range.periods, lk), this.rules(), this.closedSet(range.periods)]);
    const calc = this.computeOverhead(months, rules, lk);
    const incomeUnits = await this.unitsWithIncome();
    const unitsOut = calc.units.map((u) => {
      const sug = ruleFor(rules, u.key, range.to) ? null : suggestRule(u.key, u.name, incomeUnits.has(u.key));
      const last = u.months[u.months.length - 1];
      return {
        key: u.key,
        name: u.name,
        kind: u.kind,
        role: last?.role ?? null,
        roleLabel: last?.role ? ROLE_LABELS[last.role as Role] ?? last.role : null,
        driver: last?.driver ?? null,
        driverLabel: last?.driver ? DRIVER_LABELS[last.driver as Driver] ?? last.driver : null,
        ruleChanged: u.rulesUsed.size > 1 || (u.rulesUsed.size === 1 && u.months.some((m) => m.role === null)),
        incomeTiyin: S(u.income),
        expenseTiyin: S(u.expense),
        allocatedTiyin: S(u.allocated),
        retainedTiyin: S(u.retained),
        retained: [...u.retainReasons.entries()].map(([k, v]) => ({ reason: k, label: RETAIN_LABELS[k], amountTiyin: S(v) })),
        byRegion: mapObj(u.byRegion),
        suggestion: sug ? { ...sug, roleLabel: ROLE_LABELS[sug.role], driverLabel: sug.driver ? DRIVER_LABELS[sug.driver] : null } : null,
      };
    });
    const totalExpense = sum(calc.units.map((u) => u.expense));
    const totalRetained = sum(calc.units.map((u) => u.retained));
    const regions = lk.regions.map((r) => {
      const a = calc.byRegion.get(r.code) ?? 0n;
      return { code: r.code, name: r.name, allocatedTiyin: S(a), share: ratio(a, calc.allocated) };
    });
    const retainedBy = new Map<Retain, bigint>();
    for (const u of calc.units) for (const [k, v] of u.retainReasons) retainedBy.set(k, (retainedBy.get(k) ?? 0n) + v);
    const warnings: string[] = [];
    const noRule = calc.units.filter((u) => u.months.some((m) => m.reason === 'NO_RULE' && m.expense !== 0n));
    if (noRule.length) warnings.push(`${noRule.length} ta birlik uchun taqsimlash qoidasi belgilanmagan — xarajati Markazda qoldi. Pastdagi tavsiyalarni ko'rib tasdiqlang.`);
    const zero = calc.units.filter((u) => u.months.some((m) => m.reason === 'ZERO_DRIVER'));
    if (zero.length) warnings.push(`${zero.map((u) => u.name).join(', ')} — tanlangan drayver bo'yicha qiymat yo'q (masalan, qo'lda kiritilmagan), shu oylar taqsimlanmadi.`);
    const un = calc.units.find((u) => u.kind === 'unassigned');
    if (un && un.expense !== 0n) warnings.push(`${mln(un.expense)} xarajat hech qayerga biriktirilmagan (hudud ham, bo'lim ham yo'q). Xarajatlar bo'limida to'g'rilang.`);
    const open = range.periods.filter((p) => !closed.has(p));
    if (open.length) warnings.push(`Yopilmagan oylar: ${open.map(monthName).join(', ')} — raqamlar hali o'zgarishi mumkin.`);

    return {
      range,
      closedPeriods: [...closed],
      totals: {
        centralExpenseTiyin: S(calc.centralExpense),
        centralIncomeTiyin: S(calc.centralIncome),
        unassignedExpenseTiyin: S(un?.expense ?? 0n),
        totalExpenseTiyin: S(totalExpense),
        allocatedTiyin: S(calc.allocated),
        retainedTiyin: S(totalRetained),
        retainedByReason: [...retainedBy.entries()].map(([k, v]) => ({ reason: k, label: RETAIN_LABELS[k], amountTiyin: S(v) })),
      },
      reconciliation: {
        ok: calc.allocated + totalRetained === totalExpense && sum(calc.byRegion.values()) === calc.allocated,
        diffTiyin: S(totalExpense - calc.allocated - totalRetained),
        formula: "Taqsimlangan + Markazda qolgan = Markaz (va biriktirilmagan) xarajati",
      },
      regions,
      units: unitsOut,
      sensitivity: this.sensitivity(months, calc, lk),
      warnings,
      method: [
        "Har oy alohida: bo'lim xarajati × (hudud drayveri ÷ barcha hududlar drayveri).",
        "Yaxlitlash «eng katta qoldiq» usulida — bo'laklar yig'indisi tiyingacha xarajatga teng.",
        "Qoida tarixi saqlanadi: oy uchun shu oygacha kuchga kirgan oxirgi qoida qo'llanadi.",
        "Qoida yo'q, umumkorporativ yoki daromad keltiruvchi bo'lim xarajati Markazda qoladi.",
      ],
    };
  }

  private async unitsWithIncome(): Promise<Set<string>> {
    const since = shiftPeriod(currentPeriod(), -12);
    const rows = await this.prisma.income.findMany({ where: { deletedAt: null, departmentId: { not: null }, period: { gte: since } }, select: { departmentId: true, regionCode: true } });
    return new Set(rows.filter((r) => r.regionCode === null || r.regionCode === CENTRAL_REGION).map((r) => r.departmentId!));
  }

  // ─────────────────────────── G. Hudud natijasi ───────────────────────────
  async performance(to?: string, mode?: string) {
    const range = resolveRange(to, mode);
    const lk = await loadLookups(this.prisma);
    const [all, rules, closed] = await Promise.all([loadMonths(this.prisma, [...range.prevPeriods, ...range.periods], lk), this.rules(), this.closedSet(range.periods)]);
    const cur = all.filter((m) => range.periods.includes(m.period));
    const prev = all.filter((m) => range.prevPeriods.includes(m.period));
    const oc = this.computeOverhead(cur, rules, lk);
    const op = this.computeOverhead(prev, rules, lk);
    const n = cur.length;

    const agg = (ms: MonthData[], code: number) => {
      let revenue = 0n, payroll = 0n, opex = 0n, head = 0, fte = 0, fteMissing = 0, plan = 0n, planFact = 0n, planMonths = 0;
      for (const m of ms) {
        const r = m.regions.get(code);
        if (!r) continue;
        revenue += r.revenue;
        payroll += r.payroll;
        opex += r.opex;
        head += r.headcount;
        fte += r.fte;
        fteMissing = Math.max(fteMissing, r.fteMissing);
        if (r.budget !== null) {
          plan += r.budget;
          // Fakt — faqat rejasi kiritilgan moddalar bo'yicha (reja ish haqisiz bo'lsa, ish haqi solishtirilmaydi)
          planFact += r.budgetFact ?? 0n;
          planMonths++;
        }
      }
      return { revenue, payroll, opex, expense: payroll + opex, head, fte, fteMissing, plan, planFact, planMonths };
    };

    const rows = lk.regions.map((r) => {
      const a = agg(cur, r.code);
      const p = agg(prev, r.code);
      const alloc = oc.byRegion.get(r.code) ?? 0n;
      const prevAlloc = op.byRegion.get(r.code) ?? 0n;
      const result = a.revenue - a.expense;
      const adjusted = result - alloc;
      const prevResult = p.revenue - p.expense;
      const avgHead = n ? a.head / n : 0;
      const avgFte = n ? a.fte / n : 0;
      return {
        code: r.code,
        name: r.name,
        revenueTiyin: S(a.revenue),
        payrollTiyin: S(a.payroll),
        opexTiyin: S(a.opex),
        expenseTiyin: S(a.expense),
        resultTiyin: S(result),
        allocatedTiyin: S(alloc),
        adjustedTiyin: S(adjusted),
        margin: ratio(result, a.revenue),
        adjustedMargin: ratio(adjusted, a.revenue),
        payrollShare: ratio(a.payroll, a.revenue),
        opexShare: ratio(a.opex, a.revenue),
        coverage: ratio(a.revenue, a.expense),
        coverageFull: ratio(a.revenue, a.expense + alloc),
        headcount: Math.round(avgHead * 10) / 10,
        fte: Math.round(avgFte * 10) / 10,
        fteMissing: a.fteMissing,
        /** Oyiga bir xodimga daromad (so'mda emas — tiyin) */
        revenuePerHeadTiyin: avgHead ? S(BigInt(Math.round(Number(a.revenue) / n / avgHead))) : null,
        revenuePerFteTiyin: avgFte ? S(BigInt(Math.round(Number(a.revenue) / n / avgFte))) : null,
        prev: { revenueTiyin: S(p.revenue), expenseTiyin: S(p.expense), resultTiyin: S(prevResult), adjustedTiyin: S(prevResult - prevAlloc), hasData: p.revenue !== 0n || p.expense !== 0n },
        revenueGrowth: growth(a.revenue, p.revenue),
        expenseGrowth: growth(a.expense, p.expense),
        resultGrowth: growth(result, prevResult),
        budget: a.planMonths ? { planTiyin: S(a.plan), factTiyin: S(a.planFact), variance: ratio(a.planFact - a.plan, a.plan), months: a.planMonths } : null,
        peer: null as null | 'A' | 'B' | 'C',
        peerRank: null as number | null,
        peerSize: 0,
        hasData: a.revenue !== 0n || a.expense !== 0n,
      };
    });

    // Tengdoshlar guruhi: daromad bo'yicha uchga bo'linadi (katta / o'rta / kichik)
    const ranked = rows.filter((r) => BigInt(r.revenueTiyin) > 0n).sort((x, y) => (BigInt(y.revenueTiyin) > BigInt(x.revenueTiyin) ? 1 : -1));
    const k = ranked.length;
    ranked.forEach((r, i) => {
      r.peer = i < Math.ceil(k / 3) ? 'A' : i < Math.ceil((2 * k) / 3) ? 'B' : 'C';
    });
    for (const g of ['A', 'B', 'C'] as const) {
      const grp = rows.filter((r) => r.peer === g).sort((x, y) => (y.adjustedMargin ?? -Infinity) - (x.adjustedMargin ?? -Infinity));
      grp.forEach((r, i) => {
        r.peerRank = i + 1;
        r.peerSize = grp.length;
      });
    }

    // Markaz va biriktirilmagan
    const centerUnits = oc.units.filter((u) => u.kind !== 'unassigned');
    const cIncome = sum(centerUnits.map((u) => u.income));
    const cExpense = sum(centerUnits.map((u) => u.expense));
    const cAlloc = sum(centerUnits.map((u) => u.allocated));
    const un = oc.units.find((u) => u.kind === 'unassigned');
    const center = {
      incomeTiyin: S(cIncome),
      expenseTiyin: S(cExpense),
      allocatedOutTiyin: S(cAlloc),
      retainedTiyin: S(cExpense - cAlloc),
      resultTiyin: S(cIncome - cExpense),
      adjustedTiyin: S(cIncome - (cExpense - cAlloc)),
    };
    const unassigned = un
      ? { incomeTiyin: S(un.income), expenseTiyin: S(un.expense), allocatedOutTiyin: S(un.allocated), adjustedTiyin: S(un.income - (un.expense - un.allocated)) }
      : null;

    const regRevenue = sum(rows.map((r) => BigInt(r.revenueTiyin)));
    const regExpense = sum(rows.map((r) => BigInt(r.expenseTiyin)));
    const companyIncome = regRevenue + cIncome + (un?.income ?? 0n);
    const companyExpense = regExpense + cExpense + (un?.expense ?? 0n);
    const companyResult = companyIncome - companyExpense;
    const adjustedSum = sum(rows.map((r) => BigInt(r.adjustedTiyin))) + (cIncome - (cExpense - cAlloc)) + (un ? un.income - (un.expense - un.allocated) : 0n);

    const open = range.periods.filter((p) => !closed.has(p));
    const result = {
      range,
      closedPeriods: [...closed],
      openPeriods: open,
      rows,
      center,
      unassigned,
      company: {
        incomeTiyin: S(companyIncome),
        expenseTiyin: S(companyExpense),
        resultTiyin: S(companyResult),
        regionsRevenueShare: ratio(regRevenue, companyIncome),
      },
      reconciliation: {
        ok: adjustedSum === companyResult,
        diffTiyin: S(companyResult - adjustedSum),
        formula: "Σ hudud tuzatilgan natija + Markaz tuzatilgan natija + biriktirilmagan = korxona natijasi",
      },
      insights: [] as { level: 'good' | 'warn' | 'bad' | 'info'; regionCode: number | null; text: string }[],
      method: [
        'Operatsion natija = Daromad − (Ish haqi + Operatsion xarajat).',
        "Tuzatilgan natija = Operatsion natija − Markaz xarajatidan taqsimlangan ulush («Markaz xarajati» bo'limidagi qoidalar bilan).",
        "Xarajatni qoplash = Daromad ÷ Xarajat (1 dan katta — o'zini qoplaydi).",
        "Bir xodimga daromad — oyiga: davr daromadi ÷ oylar soni ÷ o'rtacha xodimlar soni.",
        range.mode === 'Y' ? "O'sish — o'tgan yilning shu oylariga nisbatan." : "O'sish — oldingi teng davrga nisbatan.",
        "Tengdoshlar guruhi — daromad bo'yicha: A (katta), B (o'rta), C (kichik); o'rin — tuzatilgan rentabellik bo'yicha.",
      ],
    };
    result.insights = this.insights(result.rows, oc, open, rules, range);
    return result;
  }

  /** Avtomatik xulosalar (qoidaga asoslangan, faqat raqamlardan) */
  private insights(
    rows: PerfRow[],
    oc: OverheadCalc,
    open: string[],
    rules: RuleRow[],
    range: Range,
  ) {
    const out: { level: 'good' | 'warn' | 'bad' | 'info'; regionCode: number | null; text: string }[] = [];
    const active = rows.filter((r) => r.hasData);
    if (!active.length) {
      out.push({ level: 'info', regionCode: null, text: `${range.label} uchun hududlar bo'yicha daromad va xarajat yozuvlari yo'q.` });
      return out;
    }
    const noRevenue = active.filter((r) => BigInt(r.revenueTiyin) === 0n);
    if (noRevenue.length) out.push({ level: 'warn', regionCode: null, text: `Daromadi kiritilmagan, lekin xarajati bor: ${noRevenue.map((r) => r.name).join(', ')}. Nisbatlar hisoblanmadi.` });
    for (const r of active) {
      const res = BigInt(r.resultTiyin);
      const adj = BigInt(r.adjustedTiyin);
      if (BigInt(r.revenueTiyin) === 0n) continue;
      if (res < 0n) out.push({ level: 'bad', regionCode: r.code, text: `${r.name}: o'z xarajatini ham qoplamaydi — operatsion zarar ${mln(-res)} (qoplash ${r.coverage?.toFixed(2).replace('.', ',')}).` });
      else if (adj < 0n) out.push({ level: 'warn', regionCode: r.code, text: `${r.name}: o'z xarajatini qoplaydi, lekin Markaz ulushi (${mln(BigInt(r.allocatedTiyin))}) bilan zararga o'tadi.` });
      if (r.payrollShare !== null && r.payrollShare > 0.7) out.push({ level: 'warn', regionCode: r.code, text: `${r.name}: ish haqi daromadning ${pct(r.payrollShare)} qismi — yuqori.` });
      if (r.revenueGrowth !== null && r.prev.hasData) {
        if (r.revenueGrowth <= -0.15) out.push({ level: 'bad', regionCode: r.code, text: `${r.name}: daromad ${range.prevLabel} ga nisbatan ${pct(-r.revenueGrowth)} kamaygan.` });
        else if (r.revenueGrowth >= 0.25) out.push({ level: 'good', regionCode: r.code, text: `${r.name}: daromad ${range.prevLabel} ga nisbatan ${pct(r.revenueGrowth)} o'sgan.` });
      }
      if (r.budget && r.budget.variance !== null && r.budget.variance > 0.1) out.push({ level: 'warn', regionCode: r.code, text: `${r.name}: xarajat rejadan ${pct(r.budget.variance)} oshgan.` });
    }
    const noRate = active.filter((r) => r.fteMissing > 0);
    if (noRate.length) {
      const total = noRate.reduce((s, r) => s + r.fteMissing, 0);
      out.push({ level: 'info', regionCode: null, text: `${total} ta xodimning stavkasi «Shtat va maosh»da kiritilmagan (${noRate.length} ta hudud) — shtat birligida 1 deb olindi. Aniq bo'lishi uchun Hududchi kiritsin.` });
    }
    for (const g of ['A', 'B', 'C'] as const) {
      const grp = active.filter((r) => r.peer === g && r.adjustedMargin !== null).sort((x, y) => y.adjustedMargin! - x.adjustedMargin!);
      if (grp.length >= 3) {
        const name = g === 'A' ? 'Katta' : g === 'B' ? "O'rta" : 'Kichik';
        out.push({ level: 'info', regionCode: null, text: `${name} hududlar guruhida eng yuqori tuzatilgan rentabellik — ${grp[0]!.name} (${pct(grp[0]!.adjustedMargin)}), eng pasti — ${grp[grp.length - 1]!.name} (${pct(grp[grp.length - 1]!.adjustedMargin)}).` });
      }
    }
    const totalCentral = sum(oc.units.map((u) => u.expense));
    if (totalCentral > 0n) {
      const share = ratio(oc.allocated, totalCentral)!;
      if (!rules.length) out.push({ level: 'warn', regionCode: null, text: "Markaz xarajatini taqsimlash qoidalari hali belgilanmagan — tuzatilgan natija operatsion natijaga teng. «Markaz xarajati» bo'limida qoidalarni tasdiqlang." });
      else out.push({ level: 'info', regionCode: null, text: `Markaz xarajatining ${pct(share)} qismi hududlarga taqsimlandi, qolgani Markazda.` });
    }
    if (open.length) out.push({ level: 'info', regionCode: null, text: `Yopilmagan oylar bor (${open.map(monthName).join(', ')}) — raqamlar o'zgarishi mumkin.` });
    const order = { bad: 0, warn: 1, good: 2, info: 3 };
    return out.sort((a, b) => order[a.level] - order[b.level]);
  }

  // ─────────────────────────── Qoidalar (faqat administrator yozadi) ───────────────────────────
  async ruleList() {
    const lk = await loadLookups(this.prisma);
    const [rules, incomeUnits] = await Promise.all([this.rules(), this.unitsWithIncome()]);
    const now = currentPeriod();
    const keys = [CENTER_UNIT, ...lk.departments.filter((d) => d.isActive || rules.some((r) => r.unitKey === d.id)).map((d) => d.id), UNASSIGNED_UNIT];
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rules.map((r) => r.createdById!).filter(Boolean))] } }, select: { id: true, fullName: true } });
    const uname = new Map(users.map((u) => [u.id, u.fullName]));
    return {
      roles: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
      drivers: DRIVERS.map((d) => ({ value: d, label: DRIVER_LABELS[d] })),
      currentPeriod: now,
      units: keys.map((key) => {
        const { name, kind } = this.unitName(lk, key);
        const cur = ruleFor(rules, key, now);
        const upcoming = rules.filter((r) => r.unitKey === key && r.validFrom > now).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
        const sug = suggestRule(key, name, incomeUnits.has(key));
        const fmt = (r: RuleRow) => ({
          id: r.id,
          role: r.role,
          roleLabel: ROLE_LABELS[r.role as Role] ?? r.role,
          driver: r.driver,
          driverLabel: r.driver ? (DRIVER_LABELS[r.driver as Driver] ?? r.driver) : null,
          validFrom: r.validFrom,
          note: r.note,
          createdBy: r.createdById ? (uname.get(r.createdById) ?? null) : null,
          createdAt: r.createdAt ?? null,
        });
        return {
          key,
          name,
          kind,
          current: cur ? fmt(cur) : null,
          upcoming: upcoming.map(fmt),
          history: rules.filter((r) => r.unitKey === key).map(fmt),
          suggestion: sug ? { ...sug, roleLabel: ROLE_LABELS[sug.role], driverLabel: sug.driver ? DRIVER_LABELS[sug.driver] : null } : null,
        };
      }),
    };
  }

  private async assertUnit(unitKey: string) {
    if (unitKey === CENTER_UNIT || unitKey === UNASSIGNED_UNIT) return;
    const d = await this.prisma.department.findUnique({ where: { id: unitKey }, select: { id: true } });
    if (!d) throw new BadRequestException("Bo'lim topilmadi");
  }

  async setRule(input: { unitKey?: string; role?: string; driver?: string | null; validFrom?: string; note?: string | null }, userId: string) {
    const unitKey = String(input.unitKey ?? '');
    await this.assertUnit(unitKey);
    const role = String(input.role ?? '') as Role;
    if (!ROLES.includes(role)) throw new BadRequestException('Rolni tanlang');
    let driver: Driver | null = null;
    if (role === 'SUPPORT') {
      driver = String(input.driver ?? '') as Driver;
      if (!DRIVERS.includes(driver)) throw new BadRequestException('Taqsimlash drayverini tanlang');
    }
    const validFrom = assertPeriod(input.validFrom);
    const note = input.note ? String(input.note).trim().slice(0, 500) || null : null;
    const row = await this.prisma.overheadRule.upsert({
      where: { unitKey_validFrom: { unitKey, validFrom } },
      create: { unitKey, role, driver, validFrom, note, createdById: userId },
      update: { role, driver, note, createdById: userId },
    });
    await this.audit.log({ userId, action: 'UPDATE', entity: 'overhead_rule', entityId: row.id, summary: `Taqsimlash qoidasi: ${unitKey} — ${ROLE_LABELS[role]}${driver ? `, ${DRIVER_LABELS[driver]}` : ''} (${monthName(validFrom)} dan)` });
    return row;
  }

  async deleteRule(id: string, userId: string) {
    const row = await this.prisma.overheadRule.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Qoida topilmadi');
    await this.prisma.overheadRule.delete({ where: { id } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'overhead_rule', entityId: id, summary: `Taqsimlash qoidasi o'chirildi: ${row.unitKey} (${monthName(row.validFrom)} dan)` });
    return { ok: true };
  }

  /** Qoidasi umuman yo'q birliklar uchun tavsiyalarni bir yo'la tasdiqlash */
  async acceptSuggestions(validFromRaw: string | undefined, userId: string) {
    const validFrom = assertPeriod(validFromRaw);
    const list = await this.ruleList();
    let created = 0;
    for (const u of list.units) {
      if (u.history.length || !u.suggestion) continue;
      await this.setRule({ unitKey: u.key, role: u.suggestion.role, driver: u.suggestion.driver, validFrom, note: `Tavsiya bo'yicha: ${u.suggestion.reason}` }, userId);
      created++;
    }
    return { created };
  }

  // ─────────────────────────── Qo'lda kiritiladigan drayver (MANUAL) ───────────────────────────
  async driverValues(periodRaw: string, unitKey: string) {
    const period = assertPeriod(periodRaw);
    await this.assertUnit(unitKey);
    const lk = await loadLookups(this.prisma);
    const rows = await this.prisma.overheadDriverValue.findMany({ where: { period, unitKey } });
    const v = new Map(rows.map((r) => [r.regionCode, r.value]));
    return { period, unitKey, unitName: this.unitName(lk, unitKey).name, regions: lk.regions.map((r) => ({ code: r.code, name: r.name, value: v.get(r.code) ?? null })) };
  }

  async setDriverValues(periodRaw: string, unitKey: string, values: { regionCode: number; value: number | null }[], userId: string) {
    const period = assertPeriod(periodRaw);
    await this.assertUnit(unitKey);
    if (!Array.isArray(values)) throw new BadRequestException("Qiymatlar ro'yxati kerak");
    const lk = await loadLookups(this.prisma);
    const valid = new Set(lk.regions.map((r) => r.code));
    let saved = 0;
    for (const x of values) {
      const code = Number(x.regionCode);
      if (!valid.has(code)) throw new BadRequestException(`Hudud topilmadi: ${x.regionCode}`);
      const key = { period_unitKey_regionCode: { period, unitKey, regionCode: code } };
      if (x.value === null || x.value === undefined || (x.value as unknown) === '') {
        await this.prisma.overheadDriverValue.deleteMany({ where: { period, unitKey, regionCode: code } });
        continue;
      }
      const value = Number(x.value);
      if (!Number.isFinite(value) || value < 0) throw new BadRequestException("Qiymat manfiy bo'lmagan son bo'lishi kerak");
      await this.prisma.overheadDriverValue.upsert({ where: key, create: { period, unitKey, regionCode: code, value, updatedById: userId }, update: { value, updatedById: userId } });
      saved++;
    }
    await this.audit.log({ userId, action: 'UPDATE', entity: 'overhead_driver', entityId: `${unitKey}:${period}`, summary: `Qo'lda drayver: ${monthName(period)}, ${saved} ta hudud` });
    return { saved };
  }
}