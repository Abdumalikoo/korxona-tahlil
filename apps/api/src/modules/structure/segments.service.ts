import { BadRequestException, Injectable } from '@nestjs/common';
import { SEGMENTS, entryUnitLabel, entryUnitOf, segmentKey, segmentLabel } from '../../common/segments/segments';
import { policyRouting, readPolicy, unitOfKey } from '../expense-policy/policy.util';
import { PrismaService } from '../prisma/prisma.service';
import { bounds, compareRange, parseDay, trendMonths } from './structure.engine';
import { COMPARE_LABELS, type CompareMode, type DateRange, type SectionFilter } from './structure.types';

// ═══════════════════════════════════════════════════════════
// Solishtirma › yo'nalish (Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari) — Markaz sahifasidagidek alohida:
//  • daromad manbalari (xizmat turlari), xarajat tarkibi (guruh → modda), natija va rentabellik;
//  • 12 oylik dinamika; korxona jamidagi ulushi;
//  • siyosat bo'yicha: boshqa bo'limlardan shu bo'lim hisobiga kelgan va shu bo'limdan boshqasiga o'tgan xarajatlar.
// Hisob Solishtirma bilan bir xil (regions.service): xarajat — siyosat yo'nalishi bo'yicha (bo'lim qoidasi, so'ng umumiy).
// Har qatorda «f» — Bosh sahifa yozuvlari filtri (explore/records): bosilsa aynan o'sha yozuvlar ochiladi.
// ═══════════════════════════════════════════════════════════

const TASHKENT_MS = 5 * 3600_000;
const MAX_DAYS = 3 * 366;
const TREND_MONTHS = 12;

export interface SegFilter {
  unit: string;
  cats?: string[];
  exact?: boolean;
}

export interface SegPart {
  code: string;
  label: string;
  amountTiyin: string;
  previousTiyin: string;
  count: number;
  f: SegFilter;
  children?: SegPart[];
}

export interface SegFlow {
  /** Manba (kelgan) yoki maqsad (o'tgan) bo'lim kodi */
  unit: string;
  unitLabel: string;
  code: string;
  label: string;
  amountTiyin: string;
  previousTiyin: string;
  count: number;
  f: SegFilter;
}

const monthOf = (d: Date) => new Date(d.getTime() + TASHKENT_MS).toISOString().slice(0, 7);
const monthStart = (p: string) => {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1) - TASHKENT_MS);
};
const monthEnd = (p: string) => {
  const [y, m] = p.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1) - TASHKENT_MS);
};

/** Bo'lim kodi → yozuvlar filtri birligi (Bosh sahifa: center | regions | s:KOD) */
function exploreUnit(code: string): string {
  return code === 'CENTER' ? 'center' : code === 'REGION' ? 'regions' : segmentKey(code);
}

@Injectable()
export class SegmentsService {
  constructor(private readonly prisma: PrismaService) {}

  private parseRange(from?: string, to?: string): DateRange {
    const today = new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
    const range = { from: from || `${today.slice(0, 4)}-01-01`, to: to || today };
    const a = parseDay(range.from);
    const b = parseDay(range.to);
    if (a === null || b === null) throw new BadRequestException("Sana noto'g'ri (YYYY-MM-DD)");
    if (a > b) throw new BadRequestException('Boshlanish sanasi tugash sanasidan keyin');
    if ((b - a) / 86_400_000 > MAX_DAYS) throw new BadRequestException('Davr 3 yildan oshmasin');
    return range;
  }

  /** Yo'nalishlar ro'yxati (menyu va tugmalar uchun) */
  list() {
    return SEGMENTS.map((s) => ({ code: s.code, label: s.label }));
  }

  async view(codeRaw: string, query: { from?: string; to?: string; section?: string; compare?: string }) {
    const code = SEGMENTS.find((s) => s.code === codeRaw)?.code;
    if (!code) throw new BadRequestException("Yo'nalish noto'g'ri");
    const section: SectionFilter = !query.section || query.section === 'ALL' ? 'ALL' : query.section === 'DOIMIY' || query.section === 'BOSHQA' ? query.section : (() => {
      throw new BadRequestException("Bo'lim noto'g'ri: ALL, DOIMIY yoki BOSHQA");
    })();
    const compare: CompareMode = !query.compare || query.compare === 'prev' ? 'prev' : query.compare === 'yoy' ? 'yoy' : (() => {
      throw new BadRequestException("Solishtirish noto'g'ri: prev yoki yoy");
    })();
    const range = this.parseRange(query.from, query.to);
    const previous = compareRange(range, compare);
    const months = trendMonths(range, TREND_MONTHS);
    const monthIndex = new Map(months.map((p, i) => [p, i]));
    const cur = bounds(range);
    const prev = bounds(previous);
    const start = new Date(Math.min(prev.start.getTime(), monthStart(months[0]!).getTime()));
    const end = new Date(Math.max(cur.end.getTime(), monthEnd(months[months.length - 1]!).getTime()));
    const inCur = (d: Date) => d >= cur.start && d < cur.end;
    const inPrev = (d: Date) => d >= prev.start && d < prev.end;
    const sectionWhere = section !== 'ALL' ? { section } : {};
    const key = segmentKey(code);

    const [cats, incomeCats, incomes, expenses, policy] = await Promise.all([
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true, order: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
      this.prisma.income.findMany({ where: { deletedAt: null, date: { gte: start, lt: end }, ...sectionWhere }, select: { date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, segment: true } }),
      this.prisma.expense.findMany({ where: { deletedAt: null, date: { gte: start, lt: end }, ...sectionWhere }, select: { date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, segment: true, source: true } }),
      readPolicy(this.prisma),
    ]);
    const routing = policyRouting(policy, cats);
    const catLabel = new Map(cats.map((c) => [c.code, c.label]));
    const catParent = new Map(cats.map((c) => [c.code, c.parentCode]));
    const catOrder = new Map(cats.map((c) => [c.code, c.order ?? 0]));
    const incLabel = new Map(incomeCats.map((c) => [c.code, c.label]));

    const zero = () => months.map(() => 0n);
    const trend = { income: zero(), expense: zero() };
    let income = 0n;
    let prevIncome = 0n;
    let expense = 0n;
    let prevExpense = 0n;
    let incomeCount = 0;
    let expenseCount = 0;
    let companyIncome = 0n;
    let companyExpense = 0n;
    let payroll = 0n;
    let inTotal = 0n;
    let outTotal = 0n;
    const incParts = new Map<string, { cur: bigint; prev: bigint; count: number }>();
    const expLeaf = new Map<string, { cur: bigint; prev: bigint; count: number }>();
    const flowIn = new Map<string, { unit: string; code: string; cur: bigint; prev: bigint; count: number }>();
    const flowOut = new Map<string, { unit: string; code: string; cur: bigint; prev: bigint; count: number }>();
    const add = (m: Map<string, { cur: bigint; prev: bigint; count: number }>, k: string, v: bigint, c: boolean, p: boolean) => {
      const x = m.get(k) ?? { cur: 0n, prev: 0n, count: 0 };
      if (c) {
        x.cur += v;
        x.count += 1;
      }
      if (p) x.prev += v;
      m.set(k, x);
    };

    for (const r of incomes) {
      const c = inCur(r.date);
      const p = inPrev(r.date);
      if (c) companyIncome += r.amountTiyin;
      if (r.segment !== code) continue;
      if (c) {
        income += r.amountTiyin;
        incomeCount += 1;
      }
      if (p) prevIncome += r.amountTiyin;
      if (c || p) add(incParts, r.categoryCode, r.amountTiyin, c, p);
      const i = monthIndex.get(monthOf(r.date));
      if (i !== undefined) trend.income[i]! += r.amountTiyin;
    }

    for (const r of expenses) {
      const c = inCur(r.date);
      const p = inPrev(r.date);
      if (c) companyExpense += r.amountTiyin;
      const source = entryUnitOf(r);
      const routed = routing.route(r);
      const ownerKey = routed?.key ?? (r.segment ? segmentKey(r.segment) : null);
      const mine = ownerKey === key;
      const writtenHere = r.segment === code;
      if (writtenHere && !mine && (c || p)) {
        // Shu bo'limda yozilgan, siyosat bo'yicha boshqa bo'lim hisobida
        const target = routed ? (unitOfKey(routed.key) ?? 'CENTER') : 'CENTER';
        const k = `${target}|${r.categoryCode}`;
        const x = flowOut.get(k) ?? { unit: target, code: r.categoryCode, cur: 0n, prev: 0n, count: 0 };
        if (c) {
          x.cur += r.amountTiyin;
          x.count += 1;
          outTotal += r.amountTiyin;
        }
        if (p) x.prev += r.amountTiyin;
        flowOut.set(k, x);
      }
      if (!mine) continue;
      if (!writtenHere && (c || p)) {
        const from = source ?? 'CENTER';
        const k = `${from}|${r.categoryCode}`;
        const x = flowIn.get(k) ?? { unit: from, code: r.categoryCode, cur: 0n, prev: 0n, count: 0 };
        if (c) {
          x.cur += r.amountTiyin;
          x.count += 1;
          inTotal += r.amountTiyin;
        }
        if (p) x.prev += r.amountTiyin;
        flowIn.set(k, x);
      }
      if (c) {
        expense += r.amountTiyin;
        expenseCount += 1;
        if (r.source === 'PAYROLL') payroll += r.amountTiyin;
      }
      if (p) prevExpense += r.amountTiyin;
      if (writtenHere && (c || p)) add(expLeaf, r.categoryCode, r.amountTiyin, c, p);
      const i = monthIndex.get(monthOf(r.date));
      if (i !== undefined) trend.expense[i]! += r.amountTiyin;
    }

    const sortParts = (a: SegPart, b: SegPart) => (BigInt(b.amountTiyin) > BigInt(a.amountTiyin) ? 1 : BigInt(b.amountTiyin) < BigInt(a.amountTiyin) ? -1 : a.label.localeCompare(b.label));
    const incomeParts: SegPart[] = [...incParts.entries()]
      .map(([c, v]) => ({ code: c, label: incLabel.get(c) ?? c, amountTiyin: v.cur.toString(), previousTiyin: v.prev.toString(), count: v.count, f: { unit: key, cats: [c] } }))
      .sort(sortParts);

    // Xarajat tarkibi: guruh (eng yuqori ota modda) → modda (shu bo'limda yozilgan va shu bo'lim hisobida qolganlari)
    const rootOf = (c: string) => {
      let cur = c;
      for (let d = 0; d < 20; d += 1) {
        const p = catParent.get(cur);
        if (!p) break;
        cur = p;
      }
      return cur;
    };
    const groups = new Map<string, string[]>();
    for (const c of expLeaf.keys()) groups.set(rootOf(c), [...(groups.get(rootOf(c)) ?? []), c]);
    const leaf = (c: string): SegPart => {
      const v = expLeaf.get(c)!;
      return { code: c, label: catLabel.get(c) ?? c, amountTiyin: v.cur.toString(), previousTiyin: v.prev.toString(), count: v.count, f: { unit: key, cats: [c], exact: true } };
    };
    const expenseParts: SegPart[] = [...groups.entries()]
      .map(([root, codes]) => {
        const kids = codes.map(leaf).sort(sortParts);
        const sum = (k: 'amountTiyin' | 'previousTiyin') => kids.reduce((s, x) => s + BigInt(x[k]), 0n).toString();
        if (kids.length === 1 && codes[0] === root) return kids[0]!;
        return {
          code: root,
          label: catLabel.get(root) ?? root,
          amountTiyin: sum('amountTiyin'),
          previousTiyin: sum('previousTiyin'),
          count: kids.reduce((s, x) => s + x.count, 0),
          f: { unit: key, cats: codes, exact: true },
          children: kids,
        };
      })
      .sort((a, b) => sortParts(a, b) || (catOrder.get(a.code) ?? 0) - (catOrder.get(b.code) ?? 0));

    const flows = (m: typeof flowIn, dir: 'in' | 'out'): SegFlow[] =>
      [...m.values()]
        .filter((x) => x.cur !== 0n || x.prev !== 0n)
        .sort((a, b) => (b.cur > a.cur ? 1 : b.cur < a.cur ? -1 : 0))
        .map((x) => ({
          unit: x.unit,
          unitLabel: entryUnitLabel(x.unit),
          code: x.code,
          label: catLabel.get(x.code) ?? x.code,
          amountTiyin: x.cur.toString(),
          previousTiyin: x.prev.toString(),
          count: x.count,
          // Kelgan — o'sha bo'limda yozilgan; o'tgan — shu bo'limda yozilgan
          f: { unit: dir === 'in' ? exploreUnit(x.unit) : key, cats: [x.code], exact: true },
        }));

    const result = income - expense;
    const prevResult = prevIncome - prevExpense;
    return {
      code,
      label: segmentLabel(code),
      unitKey: key,
      section,
      compare,
      compareLabel: COMPARE_LABELS[compare],
      range,
      previousRange: previous,
      months,
      totals: {
        incomeTiyin: income.toString(),
        previousIncomeTiyin: prevIncome.toString(),
        expenseTiyin: expense.toString(),
        previousExpenseTiyin: prevExpense.toString(),
        resultTiyin: result.toString(),
        previousResultTiyin: prevResult.toString(),
        /** Natija / daromad (daromad yo'q — null) */
        margin: income > 0n ? Number(result) / Number(income) : null,
        previousMargin: prevIncome > 0n ? Number(prevResult) / Number(prevIncome) : null,
        incomeCount,
        expenseCount,
        payrollTiyin: payroll.toString(),
        incomingTiyin: inTotal.toString(),
        outgoingTiyin: outTotal.toString(),
        incomeShare: companyIncome > 0n ? Number(income) / Number(companyIncome) : null,
        expenseShare: companyExpense > 0n ? Number(expense) / Number(companyExpense) : null,
      },
      trend: { income: trend.income.map(String), expense: trend.expense.map(String), result: trend.income.map((v, i) => (v - trend.expense[i]!).toString()) },
      incomeParts,
      expenseParts,
      incoming: flows(flowIn, 'in'),
      outgoing: flows(flowOut, 'out'),
    };
  }
}