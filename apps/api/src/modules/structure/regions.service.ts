import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SEGMENTS, segmentKey, segmentLabel, segmentOfKey, unitKeyOf } from '../../common/segments/segments';
import { ASSET_CHARGE_CATEGORY, ASSET_GROUP_CODES, policyRouting, readPolicy } from '../expense-policy/policy.util';
import { bounds, compareRange, parseDay, trendMonths } from './structure.engine';
import type { RegionUnit, RegionsResult, UnitKind, UnitPart } from './regions.types';
import { COMPARE_LABELS, type CompareMode, type DateRange, type SectionFilter } from './structure.types';

const TASHKENT_MS = 5 * 3600_000;
const MAX_DAYS = 3 * 366;

/** Sohalar kesimi: modda (kod) → birlik → joriy va taqqoslash davri summasi (to'liq hisobot uchun) */
export interface SohaCell {
  amount: bigint;
  previous: bigint;
  count: number;
}

export interface SohaSink {
  /** Daromad: xizmat turi kodi → birlik kaliti ("r:3", "center", "none") → summa */
  income: Map<string, Map<string, SohaCell>>;
  /** Xarajat: modda kodi → birlik kaliti → summa (Xarajatlar siyosati moddalari — Markazda, Solishtirmadagidek) */
  expense: Map<string, Map<string, SohaCell>>;
  /** Siyosat bo'yicha boshqa hisobga o'tkazilgan moddalar kodlari */
  policyCodes: Set<string>;
  /** Siyosatdagi modda kim hisobidan: "center" yoki "s:KOD" */
  payerOf?: (code: string) => string;
  incomeLabels: Map<string, string>;
  categories: { code: string; label: string; parentCode: string | null }[];
}

function addSoha(map: Map<string, Map<string, SohaCell>>, code: string, unitKey: string, amount: bigint, isCurrent: boolean, isPrevious: boolean) {
  let byUnit = map.get(code);
  if (!byUnit) {
    byUnit = new Map();
    map.set(code, byUnit);
  }
  const cell = byUnit.get(unitKey) ?? { amount: 0n, previous: 0n, count: 0 };
  if (isCurrent) {
    cell.amount += amount;
    cell.count += 1;
  }
  if (isPrevious) cell.previous += amount;
  byUnit.set(unitKey, cell);
}

export interface RegionsQuery {
  from?: string;
  to?: string;
  section?: string;
  compare?: string;
}

/** Hisob-kitob uchun ichki birlik */
interface Acc {
  key: string;
  code: number | null;
  name: string;
  kind: UnitKind;
  income: bigint;
  previousIncome: bigint;
  expense: bigint;
  previousExpense: bigint;
  payroll: bigint;
  previousPayroll: bigint;
  expenseParts: Map<string, { label: string; amount: bigint; previous: bigint }>;
  incomeParts: Map<string, { label: string; amount: bigint; previous: bigint }>;
  /** Xodimlar bo'limidan: davr ichida ishlagan xodimlar soni */
  headcount: number;
  previousHeadcount: number;
  incomeTrend: bigint[];
  expenseTrend: bigint[];
  incomeCount: number;
  expenseCount: number;
  /** Markaz: siyosat bo'yicha hududlar uchun to'langan qism (expense ichida) */
  centerRegional: bigint;
  /** Markaz: asosiy vositalar sarfi */
  centerAssets: bigint;
  previousCenterAssets: bigint;
  previousCenterRegional: bigint;
  regionalBy: Map<number | null, bigint>;
}

function todayIso(): string {
  return new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
}

/** Yozuv sanasining oyi (Toshkent vaqti), "YYYY-MM" — oylar dinamikasi sanadan olinadi */
function monthOf(date: Date): string {
  return new Date(date.getTime() + 5 * 3600_000).toISOString().slice(0, 7);
}

function monthStart(period: string): Date {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1) - TASHKENT_MS);
}

function monthEnd(period: string): Date {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1) - TASHKENT_MS);
}

function fmt(tiyin: bigint | number): string {
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

function fmtPct(value: number): string {
  return `${value.toFixed(1).replace('.', ',')}%`;
}


/**
 * Solishtirma: har bir hudud va Markaz uchun
 * daromad (o'sha hududda bajarilgan ishlar) va xarajat (o'sha hudud xodimlari ish haqi + hudud xarajatlari).
 *
 * Ma'lumot faqat uchta bo'limdan olinadi, hech narsa qo'shilmaydi yoki o'zgartirilmaydi:
 *  - Daromadlar bo'limi — incomes jadvali;
 *  - Xarajatlar bo'limi — expenses jadvali (ish haqi, ijara, mashinalar va boshqalar shu yerda);
 *    Xarajatlar siyosatidagi moddalar (bayram puli, komandirovka, internet …) — qaysi hududda yozilgan bo'lsa ham
 *    Markaz xarajatiga o'tadi (Markaz ichida «hududlar uchun» guruhi, centerSplit);
 *  - Xodimlar bo'limi — employees jadvali (xodimlar soni).
 */
@Injectable()
export class RegionsService {
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

  /** To'liq hisobot uchun: Solishtirma natijasi + sohalar (xizmat turlari va moddalar) kesimi — bitta hisobdan */
  async full(query: RegionsQuery): Promise<{ result: RegionsResult; soha: SohaSink }> {
    const soha: SohaSink = { income: new Map(), expense: new Map(), policyCodes: new Set(), incomeLabels: new Map(), categories: [] };
    const result = await this.compare(query, soha);
    return { result, soha };
  }

  async compare(query: RegionsQuery, soha?: SohaSink): Promise<RegionsResult> {
    const section = this.parseSection(query.section);
    const compare = this.parseCompare(query.compare);
    const compareLabel = COMPARE_LABELS[compare];
    const range = this.parseRange(query.from, query.to);
    const previous = compareRange(range, compare);
    const months = trendMonths(range);
    const monthIndex = new Map(months.map((p, i) => [p, i]));

    const current = bounds(range);
    const prev = bounds(previous);
    const start = new Date(Math.min(prev.start.getTime(), monthStart(months[0]!).getTime()));
    const end = new Date(Math.max(current.end.getTime(), monthEnd(months[months.length - 1]!).getTime()));
    const inCurrent = (d: Date) => d >= current.start && d < current.end;
    const inPrevious = (d: Date) => d >= prev.start && d < prev.end;

    const sectionWhere = section !== 'ALL' ? { section } : {};

    const [regions, expenseCategories, incomeCategories, incomes, expenses, employees, policy] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true, isActive: true }, orderBy: { code: 'asc' } }),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
      this.prisma.income.findMany({
        where: { deletedAt: null, date: { gte: start, lt: end }, ...sectionWhere },
        select: { date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, segment: true },
      }),
      this.prisma.expense.findMany({
        where: { deletedAt: null, date: { gte: start, lt: end }, ...sectionWhere },
        select: { date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, source: true, segment: true },
      }),
      // Xodimlar bo'limi: hudud bo'yicha xodimlar soni
      this.prisma.employee.findMany({ select: { regionCode: true, hiredAt: true, firedAt: true, isActive: true } }),
      readPolicy(this.prisma),
    ]);
    // Xarajatlar siyosati: shu moddalar qayerda yozilgan bo'lsa ham — Markaz xarajati (hududlar uchun)
    // Xarajatlar siyosati: moddalar qayerda yozilgan bo'lsa ham — Markaz yoki yo'nalish (Tax free …) hisobidan
    const routing = policyRouting(policy, expenseCategories);
    const centerCategories = routing.moved;
    if (soha) {
      soha.policyCodes = new Set(centerCategories);
      soha.payerOf = (code: string) => routing.payerKey(code);
      soha.incomeLabels = new Map(incomeCategories.map((c) => [c.code, c.label]));
      soha.categories = expenseCategories.map((c) => ({ code: c.code, label: c.label, parentCode: c.parentCode }));
    }

    // ─────────── Birliklar ───────────

    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const units = new Map<string, Acc>();
    const make = (key: string, code: number | null, name: string, kind: UnitKind): Acc => ({
      key,
      code,
      name,
      kind,
      income: 0n,
      previousIncome: 0n,
      expense: 0n,
      previousExpense: 0n,
      payroll: 0n,
      previousPayroll: 0n,
      expenseParts: new Map(),
      incomeParts: new Map(),
      headcount: 0,
      previousHeadcount: 0,
      incomeTrend: months.map(() => 0n),
      expenseTrend: months.map(() => 0n),
      incomeCount: 0,
      expenseCount: 0,
      centerRegional: 0n,
      centerAssets: 0n,
      previousCenterAssets: 0n,
      previousCenterRegional: 0n,
      regionalBy: new Map(),
    });
    // Barcha faol hududlar (ma'lumoti bo'lmasa ham ro'yxatda turadi)
    units.set('center', make('center', 0, regionName.get(0) ?? 'Markaz', 'center'));
    // Yo'nalishlar (Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari) — har doim ro'yxatda
    for (const seg of SEGMENTS) units.set(segmentKey(seg.code), make(segmentKey(seg.code), null, seg.label, 'segment'));
    for (const region of regions) {
      if (region.code === 0 || !region.isActive) continue;
      units.set(`r:${region.code}`, make(`r:${region.code}`, region.code, region.name, 'region'));
    }
    const unit = (key: string): Acc => {
      let acc = units.get(key);
      if (!acc) {
        if (key === 'none') acc = make('none', null, 'Hududga biriktirilmagan', 'unassigned');
        else if (segmentOfKey(key)) acc = make(key, null, segmentLabel(segmentOfKey(key)!), 'segment');
        else {
          const code = Number(key.slice(2));
          acc = make(key, code, regionName.get(code) ?? `Hudud ${code}`, 'region');
        }
        units.set(key, acc);
      }
      return acc;
    };
    const addPart = (
      parts: Acc['expenseParts'],
      key: string,
      label: string,
      amount: bigint,
      isCurrent: boolean,
      isPrevious: boolean,
    ) => {
      const part = parts.get(key) ?? { label, amount: 0n, previous: 0n };
      if (isCurrent) part.amount += amount;
      if (isPrevious) part.previous += amount;
      parts.set(key, part);
    };

    // ─────────── Daromad: shu hududda bajarilgan ishlar ───────────

    const incomeLabel = new Map(incomeCategories.map((c) => [c.code, c.label]));
    for (const row of incomes) {
      const acc = unit(unitKeyOf(row.regionCode, row.departmentId, row.segment));
      const isCurrent = inCurrent(row.date);
      const isPrevious = inPrevious(row.date);
      if (isCurrent) {
        acc.income += row.amountTiyin;
        acc.incomeCount += 1;
      }
      if (isPrevious) acc.previousIncome += row.amountTiyin;
      if (soha && (isCurrent || isPrevious)) addSoha(soha.income, row.categoryCode, acc.key, row.amountTiyin, isCurrent, isPrevious);
      if (isCurrent || isPrevious) {
        addPart(acc.incomeParts, row.categoryCode, incomeLabel.get(row.categoryCode) ?? row.categoryCode, row.amountTiyin, isCurrent, isPrevious);
      }
      const index = monthIndex.get(monthOf(row.date));
      if (index !== undefined) acc.incomeTrend[index]! += row.amountTiyin;
    }

    // ─────────── Xarajat: hudud xarajatlari (ish haqidan tashqari) ───────────

    const categoryLabel = new Map(expenseCategories.map((c) => [c.code, c.label]));
    const categoryParent = new Map(expenseCategories.map((c) => [c.code, c.parentCode]));
    for (const row of expenses) {
      // Siyosat: bo'lim qoidasi (shu bo'limda yozilgan modda boshqa bo'lim hisobiga), so'ng umumiy siyosat
      const routed = routing.route(row);
      const byPolicy = routed !== null;
      const payer = routed?.key ?? null;
      const acc = payer ? unit(payer) : unit(unitKeyOf(row.regionCode, row.departmentId, row.segment));
      const isCurrent = inCurrent(row.date);
      const isPrevious = inPrevious(row.date);
      if (isCurrent) {
        acc.expense += row.amountTiyin;
        acc.expenseCount += 1;
      }
      if (isPrevious) acc.previousExpense += row.amountTiyin;
      if (soha && (isCurrent || isPrevious)) addSoha(soha.expense, row.categoryCode, acc.key, row.amountTiyin, isCurrent, isPrevious);
      const isAssetCharge = ASSET_GROUP_CODES.includes(row.categoryCode);
      if (isAssetCharge) {
        if (isCurrent) acc.centerAssets += row.amountTiyin;
        if (isPrevious) acc.previousCenterAssets += row.amountTiyin;
      } else if (byPolicy && payer === 'center' && routed?.origin === 'global') {
        const beneficiary = row.regionCode && row.regionCode !== 0 ? row.regionCode : null;
        if (isCurrent) {
          acc.centerRegional += row.amountTiyin;
          acc.regionalBy.set(beneficiary, (acc.regionalBy.get(beneficiary) ?? 0n) + row.amountTiyin);
        }
        if (isPrevious) acc.previousCenterRegional += row.amountTiyin;
      }
      if (isCurrent || isPrevious) {
        if (isAssetCharge) {
          if (row.categoryCode === ASSET_CHARGE_CATEGORY.code) addPart(acc.expenseParts, 'ASSET', 'Asosiy vositalar sarfi', row.amountTiyin, isCurrent, isPrevious);
          else addPart(acc.expenseParts, 'ASSET_X', "Asosiy vositalar (xarajatga o'tkazilgan)", row.amountTiyin, isCurrent, isPrevious);
        } else if (byPolicy) {
          addPart(acc.expenseParts, `h:${row.categoryCode}`, `${routed?.origin === 'unit' ? 'Boshqa bo‘limdan' : payer === 'center' ? 'Hududlar uchun' : 'Siyosat bo‘yicha'}: ${categoryLabel.get(row.categoryCode) ?? row.categoryCode}`, row.amountTiyin, isCurrent, isPrevious);
        } else if (row.source === 'PAYROLL') {
          if (isCurrent) acc.payroll += row.amountTiyin;
          if (isPrevious) acc.previousPayroll += row.amountTiyin;
          addPart(acc.expenseParts, 'PAYROLL', 'Ish haqi', row.amountTiyin, isCurrent, isPrevious);
        } else if (row.source === 'LEASE') addPart(acc.expenseParts, 'LEASE', 'Ijara', row.amountTiyin, isCurrent, isPrevious);
        else if (row.source === 'VEHICLE') addPart(acc.expenseParts, 'VEHICLE', 'Mashinalar', row.amountTiyin, isCurrent, isPrevious);
        else {
          const top = categoryParent.get(row.categoryCode) ?? row.categoryCode;
          addPart(acc.expenseParts, `c:${top}`, categoryLabel.get(top) ?? top, row.amountTiyin, isCurrent, isPrevious);
        }
      }
      const index = monthIndex.get(monthOf(row.date));
      if (index !== undefined) acc.expenseTrend[index]! += row.amountTiyin;
    }

    // ─────────── Xodimlar soni (Xodimlar bo'limidan) ───────────
    // Davr ichida ishlagan: ishga kirgan sanasi davr oxirigacha, bo'shagan sanasi (bo'lsa) davr boshidan keyin
    const workedIn = (e: (typeof employees)[number], b: { start: Date; end: Date }) =>
      (!e.hiredAt || e.hiredAt < b.end) && (!e.firedAt || e.firedAt >= b.start) && (e.isActive || e.firedAt !== null);
    for (const employee of employees) {
      const acc = unit(employee.regionCode === 0 ? 'center' : `r:${employee.regionCode}`);
      if (workedIn(employee, current)) acc.headcount += 1;
      if (workedIn(employee, prev)) acc.previousHeadcount += 1;
    }

    // ─────────── Natija ───────────

    const toParts = (map: Acc['expenseParts'], limit: number): UnitPart[] => {
      const sorted = [...map.entries()]
        .filter(([, p]) => p.amount !== 0n || p.previous !== 0n)
        .sort((a, b) => (b[1].amount > a[1].amount ? 1 : b[1].amount < a[1].amount ? -1 : 0));
      const head = sorted.slice(0, limit).map(([key, p]) => ({ key, label: p.label, amountTiyin: p.amount.toString(), previousTiyin: p.previous.toString() }));
      const tail = sorted.slice(limit);
      if (tail.length > 0) {
        head.push({
          key: 'rest',
          label: `Boshqalar (${tail.length} ta)`,
          amountTiyin: tail.reduce((s, [, p]) => s + p.amount, 0n).toString(),
          previousTiyin: tail.reduce((s, [, p]) => s + p.previous, 0n).toString(),
        });
      }
      return head;
    };

    const kindOrder: Record<UnitKind, number> = { region: 0, center: 1, segment: 2, unassigned: 3 };
    const list: RegionUnit[] = [...units.values()]
      .filter((u) => u.kind !== 'unassigned' || u.income !== 0n || u.expense !== 0n || u.previousIncome !== 0n || u.previousExpense !== 0n)
      .map((u) => ({
        key: u.key,
        code: u.code,
        name: u.name,
        kind: u.kind,
        ...(u.kind === 'segment' ? { segment: segmentOfKey(u.key) ?? undefined } : {}),
        incomeTiyin: u.income.toString(),
        previousIncomeTiyin: u.previousIncome.toString(),
        expenseTiyin: u.expense.toString(),
        previousExpenseTiyin: u.previousExpense.toString(),
        payrollTiyin: u.payroll.toString(),
        previousPayrollTiyin: u.previousPayroll.toString(),
        expenseParts: toParts(u.expenseParts, 6),
        incomeParts: toParts(u.incomeParts, 8),
        headcount: u.headcount,
        previousHeadcount: u.previousHeadcount,
        incomeTrend: u.incomeTrend.map((v) => v.toString()),
        expenseTrend: u.expenseTrend.map((v) => v.toString()),
        incomeCount: u.incomeCount,
        expenseCount: u.expenseCount,
        ...(u.kind === 'center'
          ? {
              centerSplit: {
                ownTiyin: (u.expense - u.centerRegional - u.centerAssets).toString(),
                regionalTiyin: u.centerRegional.toString(),
                previousOwnTiyin: (u.previousExpense - u.previousCenterRegional - u.previousCenterAssets).toString(),
                previousRegionalTiyin: u.previousCenterRegional.toString(),
                assetsTiyin: u.centerAssets.toString(),
                previousAssetsTiyin: u.previousCenterAssets.toString(),
                byRegion: [...u.regionalBy.entries()]
                  .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
                  .map(([code, amount]) => ({ code, amountTiyin: amount.toString() })),
              },
            }
          : {}),
      }))
      .sort((a, b) => {
        if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
        if (a.kind === 'segment') return SEGMENTS.findIndex((x) => segmentKey(x.code) === a.key) - SEGMENTS.findIndex((x) => segmentKey(x.code) === b.key);
        const pa = BigInt(a.incomeTiyin) - BigInt(a.expenseTiyin);
        const pb = BigInt(b.incomeTiyin) - BigInt(b.expenseTiyin);
        return pb > pa ? 1 : pb < pa ? -1 : 0;
      });

    return {
      section,
      compare,
      compareLabel,
      range,
      previousRange: previous,
      months,
      units: list,
      notes: this.notes(list, compareLabel),
    };
  }

  // ─────────── Oddiy tildagi xulosalar ───────────

  private notes(units: RegionUnit[], compareLabel: string): string[] {
    const notes: string[] = [];
    const profit = (u: RegionUnit) => BigInt(u.incomeTiyin) - BigInt(u.expenseTiyin);
    const previousProfit = (u: RegionUnit) => BigInt(u.previousIncomeTiyin) - BigInt(u.previousExpenseTiyin);
    const regions = units.filter((u) => u.kind === 'region' && (u.incomeTiyin !== '0' || u.expenseTiyin !== '0'));
    const center = units.find((u) => u.kind === 'center');
    const unassigned = units.find((u) => u.kind === 'unassigned');

    if (regions.length > 0) {
      const winners = regions.filter((u) => profit(u) > 0n);
      const losers = regions.filter((u) => profit(u) < 0n);
      notes.push(
        `${regions.length} ta hududdan ${winners.length} tasi foyda, ${losers.length} tasi zarar bilan ishlamoqda.` +
          (losers.length > 0 ? ` Zarardagilar: ${losers.slice(-3).reverse().map((u) => u.name).join(', ')}${losers.length > 3 ? ' va boshqalar' : ''}.` : ''),
      );
      const best = [...regions].sort((a, b) => (profit(b) > profit(a) ? 1 : -1))[0]!;
      const worst = [...regions].sort((a, b) => (profit(a) > profit(b) ? 1 : -1))[0]!;
      notes.push(
        `Eng ko'p foyda — ${best.name}: daromad ${fmt(BigInt(best.incomeTiyin))}, xarajat ${fmt(BigInt(best.expenseTiyin))}, foyda ${fmt(profit(best))}.`,
      );
      if (worst.key !== best.key) {
        notes.push(
          `${profit(worst) < 0n ? 'Eng katta zarar' : 'Eng kam foyda'} — ${worst.name}: daromad ${fmt(BigInt(worst.incomeTiyin))}, xarajat ${fmt(BigInt(worst.expenseTiyin))}` +
            ` (${profit(worst) < 0n ? 'zarar' : 'foyda'} ${fmt(profit(worst) < 0n ? -profit(worst) : profit(worst))}).`,
        );
      }

      const regionsProfit = regions.reduce((s, u) => s + profit(u), 0n);
      if (center && BigInt(center.expenseTiyin) > 0n) {
        const net = BigInt(center.expenseTiyin) - BigInt(center.incomeTiyin);
        const coverage = net > 0n ? (Number(regionsProfit) / Number(net)) * 100 : null;
        notes.push(
          `Markaz xarajati ${fmt(BigInt(center.expenseTiyin))}` +
            (BigInt(center.incomeTiyin) > 0n ? ` (o'z daromadi ${fmt(BigInt(center.incomeTiyin))})` : '') +
            `. Hududlarning jami foydasi ${fmt(regionsProfit)}` +
            (coverage === null
              ? '.'
              : coverage >= 100
                ? ` — Markaz xarajatini to'liq qoplaydi (${fmtPct(coverage)}).`
                : coverage > 0
                  ? ` — Markaz xarajatining faqat ${fmtPct(coverage)} ini qoplaydi.`
                  : ' — Markaz xarajatini qoplay olmaydi.'),
        );
      }

      const withHeads = regions.filter((u) => u.headcount > 0 && BigInt(u.incomeTiyin) > 0n);
      if (withHeads.length >= 2) {
        const perHead = (u: RegionUnit) => Number(u.incomeTiyin) / u.headcount;
        const top = [...withHeads].sort((a, b) => perHead(b) - perHead(a));
        notes.push(
          `Bir xodimga eng ko'p daromad — ${top[0]!.name} (${fmt(Math.round(perHead(top[0]!)))}), eng kam — ${top[top.length - 1]!.name} (${fmt(Math.round(perHead(top[top.length - 1]!)))}).`,
        );
      }

      const changes = regions
        .filter((u) => BigInt(u.previousIncomeTiyin) !== 0n || BigInt(u.previousExpenseTiyin) !== 0n)
        .map((u) => ({ u, d: profit(u) - previousProfit(u) }))
        .sort((a, b) => (b.d > a.d ? 1 : -1));
      if (changes.length >= 2) {
        const up = changes[0]!;
        const down = changes[changes.length - 1]!;
        if (up.d > 0n) notes.push(`${compareLabel[0]!.toUpperCase() + compareLabel.slice(1)}ga nisbatan natijasi eng ko'p yaxshilangan — ${up.u.name} (+${fmt(up.d)}).`);
        if (down.d < 0n) notes.push(`Natijasi eng ko'p yomonlashgan — ${down.u.name} (${fmt(down.d)}).`);
      }

      {
        const allExpense = units.reduce((s, u) => s + BigInt(u.expenseTiyin), 0n);
        const allPayroll = units.reduce((s, u) => s + BigInt(u.payrollTiyin), 0n);
        if (allExpense > 0n && allPayroll > 0n) notes.push(`Ish haqi barcha xarajatlarning ${fmtPct((Number(allPayroll) / Number(allExpense)) * 100)} ini tashkil qiladi.`);
      }
    }

    // Yo'nalishlar (Tax free, Marksheyder …): ma'lumoti borlari — qisqa natija
    const segs = units.filter((u) => u.kind === 'segment' && (u.incomeTiyin !== '0' || u.expenseTiyin !== '0'));
    if (segs.length > 0) {
      notes.push(
        `Yo'nalishlar: ${segs
          .map((u) => `${u.name} — daromad ${fmt(BigInt(u.incomeTiyin))}, xarajat ${fmt(BigInt(u.expenseTiyin))}, ${profit(u) < 0n ? 'zarar' : 'natija'} ${fmt(profit(u) < 0n ? -profit(u) : profit(u))}`)
          .join('; ')}.`,
      );
    }

    if (unassigned) {
      const allExpense = units.reduce((s, u) => s + BigInt(u.expenseTiyin), 0n);
      const allIncome = units.reduce((s, u) => s + BigInt(u.incomeTiyin), 0n);
      const e = BigInt(unassigned.expenseTiyin);
      const i = BigInt(unassigned.incomeTiyin);
      const parts: string[] = [];
      if (allExpense > 0n && e > 0n) parts.push(`xarajatning ${fmtPct((Number(e) / Number(allExpense)) * 100)} i (${fmt(e)})`);
      if (allIncome > 0n && i > 0n) parts.push(`daromadning ${fmtPct((Number(i) / Number(allIncome)) * 100)} i (${fmt(i)})`);
      if (parts.length > 0) {
        notes.push(`Hech qaysi hududga biriktirilmagan: ${parts.join(', ')}. Aniq natija uchun bu yozuvlarga hudud yoki bo'lim belgilash tavsiya etiladi.`);
      }
    }

    return notes;
  }
}