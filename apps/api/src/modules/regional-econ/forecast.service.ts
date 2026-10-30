import { loadCenterCategories } from '../expense-policy/policy.util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { median } from '../econ/econ.math';
import { PrismaService } from '../prisma/prisma.service';
import { regionalEmployees, regionalEmployeesMany } from '../regional-data/rd.employees';
import { CENTRAL_REGION, currentPeriod, monthName, periodDays, shiftPeriod } from '../regional-data/rd.util';
import { loadLookups, loadMonths, PAYROLL_CATEGORY, unitOf } from './econ.loader';
import {
  type Accuracy,
  type Band,
  diffBands,
  employeeMonthly,
  forecastSeries,
  MODEL_LABELS,
  type ModelKind,
  pooledWape,
  priceAt,
  regimeMonth,
  type Reliability,
  scaleBand,
  sumBands,
} from './forecast.calc';
import { RegionalEconService } from './regional-econ.service';

// ═══════════════════════════════════════════════════════════
// 3-bosqich. Hudud prognozi (Katta modellar):
//   Daromad   — hudud × xizmat qatorlari (ETS), voqealar jurnalidagi tarkibiy uzilishlar va tasdiqlangan tariflar bilan;
//   Ish haqi  — xodim darajasida: shtat kartasi (maosh × stavka × odatiy nisbat) yoki so'nggi 3 oy;
//               bo'shash / ishga kirish sanalari va kelgusi maosh o'zgarishlari hisobga olinadi;
//   Xarajat   — takroriy (+ belgilanmagan) xarajat qatori (ETS) + bir martalik xarajat uchun o'rtacha zaxira;
//   Markaz ulushi — Markaz xarajati prognozi × so'nggi 3 oydagi taqsimot ulushi (2-bosqich qoidalari);
//   Natija    = Daromad − Ish haqi − Xarajat − Markaz ulushi.
// Pul ichkarida tiyinda (son), tashqariga — tiyin satri.
// ═══════════════════════════════════════════════════════════

const WINDOW = 36;
const CACHE_MS = 60_000;
const HMAX = 12;

type BandOut = { meanTiyin: string; loTiyin: string; hiTiyin: string };
const T = (x: number) => String(Math.round(x));
const bandOut = (b: Band): BandOut => ({ meanTiyin: T(b.mean), loTiyin: T(b.lo), hiTiyin: T(b.hi) });
const flat = (v: number): Band => ({ mean: v, lo: v, hi: v });
const pctTxt = (x: number) => `${x < 0 ? '−' : x > 0 ? '+' : ''}${Math.abs(x * 100).toFixed(1).replace('.', ',')}%`;
const mln = (t: number) => `${(t / 1e8).toFixed(1).replace('.', ',')} mln so'm`;

export function resolveForecastBase(to?: string, h?: string | number) {
  const cur = currentPeriod();
  const ok = to && /^\d{4}-(0[1-9]|1[0-2])$/.test(to);
  const last = ok && to! < cur ? to! : shiftPeriod(cur, -1);
  const horizon = Math.min(HMAX, Math.max(1, Math.round(Number(h) || 3)));
  const periods = Array.from({ length: WINDOW }, (_, i) => shiftPeriod(last, i - WINDOW + 1));
  const future = Array.from({ length: horizon }, (_, i) => shiftPeriod(last, i + 1));
  return { last, horizon, periods, future };
}

export interface SeriesOut {
  key: string;
  label: string;
  history: { period: string; valueTiyin: string }[];
  forecast: BandOut[];
  model: ModelKind;
  modelLabel: string;
  fromPeriod: string | null;
  used: number;
  accuracy: Accuracy;
  reliability: Reliability;
  notes: string[];
}

@Injectable()
export class ForecastService {
  private cache = new Map<string, { at: number; value: Awaited<ReturnType<ForecastService['build']>> }>();

  /** Ma'lumot ommaviy o'zgarganda (masalan, demo qo'shilganda) keshni tozalash */
  clearCache() {
    this.cache.clear();
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly econ: RegionalEconService,
  ) {}

  async forecast(to?: string, h?: string | number) {
    const base = resolveForecastBase(to, h);
    const key = `${base.last}|${base.horizon}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await this.build(base);
    if (this.cache.size > 20) this.cache.clear();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Vedomost bo'yicha xodim × oy (faqat tasdiqlangan yuklashlar) */
  private async payrollEntries(periods: string[]) {
    const batches = await this.prisma.payrollBatch.findMany({ where: { period: { in: periods }, status: 'COMMITTED' }, select: { id: true } });
    if (!batches.length) return new Map<string, Map<string, number>>();
    const rows = await this.prisma.payrollEntry.findMany({ where: { deletedAt: null, batchId: { in: batches.map((b) => b.id) } }, select: { employeePinfl: true, period: true, totalTiyin: true } });
    const out = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const m = out.get(r.period) ?? new Map<string, number>();
      m.set(r.employeePinfl, (m.get(r.employeePinfl) ?? 0) + Number(r.totalTiyin));
      out.set(r.period, m);
    }
    return out;
  }

  /** Hudud ish haqi (vedomost bo'yicha) oy × hudud */
  private async payrollByRegion(periods: string[]) {
    const entries = await this.payrollEntries(periods);
    const out = new Map<string, Map<number, number>>();
    const staffByPeriod = await regionalEmployeesMany(this.prisma, periods);
    for (const p of periods) {
      const staff = staffByPeriod.get(p) ?? [];
      const region = new Map(staff.map((e) => [e.pinfl, e.regionCode]));
      const m = new Map<number, number>();
      for (const [pin, v] of entries.get(p) ?? []) {
        const r = region.get(pin);
        if (r !== undefined) m.set(r, (m.get(r) ?? 0) + v);
      }
      out.set(p, m);
    }
    return out;
  }

  private async build(base: ReturnType<typeof resolveForecastBase>) {
    const { last, horizon: H, periods, future } = base;
    const lk = await loadLookups(this.prisma);
    const regionWhere = { not: null, notIn: [CENTRAL_REGION] };
    const [incomes, allRegionalExpenses, ownCentral, events, tariffsAll, cats, budgets, closes, salaries, centerCats] = await Promise.all([
      this.prisma.income.findMany({ where: { deletedAt: null, period: { in: periods }, regionCode: regionWhere }, select: { period: true, regionCode: true, categoryCode: true, amountTiyin: true } }),
      this.prisma.expense.findMany({ where: { deletedAt: null, period: { in: periods }, regionCode: regionWhere }, select: { period: true, regionCode: true, amountTiyin: true, source: true, recurrence: true, categoryCode: true, departmentId: true } }),
      this.prisma.expense.findMany({ where: { deletedAt: null, period: { in: periods }, OR: [{ regionCode: CENTRAL_REGION }, { regionCode: null, departmentId: { not: null } }] }, select: { period: true, regionCode: true, departmentId: true, amountTiyin: true } }),
      this.prisma.analysisEvent.findMany({ where: { deletedAt: null, isBreak: true }, select: { date: true, kind: true, regionCode: true, categoryCode: true, title: true } }),
      this.prisma.serviceTariff.findMany({ where: { status: 'APPROVED' }, select: { categoryCode: true, regionCode: true, priceTiyin: true, validFrom: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
      this.prisma.expenseBudget.findMany({ where: { period: { in: future }, categoryCode: { not: PAYROLL_CATEGORY } }, select: { period: true, regionCode: true, amountTiyin: true } }),
      this.prisma.regionalPeriodClose.findMany({ where: { period: last }, select: { period: true } }),
      this.prisma.employeeSalary.findMany({ select: { employeePinfl: true, effectiveFrom: true, rate: true, baseSalaryTiyin: true }, orderBy: { effectiveFrom: 'asc' } }),
      loadCenterCategories(this.prisma).catch(() => new Set<string>()),
    ]);
    // Xarajatlar siyosati (Solishtirmadagidek): Markaz hisobidagi moddalar hududda emas — Markaz xarajatida
    const expenses = allRegionalExpenses.filter((e) => !centerCats.has(e.categoryCode));
    const central = [
      ...ownCentral,
      ...allRegionalExpenses.filter((e) => centerCats.has(e.categoryCode)).map((e) => ({ period: e.period, regionCode: CENTRAL_REGION as number | null, departmentId: e.departmentId, amountTiyin: e.amountTiyin })),
    ];
    const catLabel = new Map(cats.map((c) => [c.code, c.label]));
    const pIndex = new Map(periods.map((p, i) => [p, i]));
    const notes: string[] = [];

    // ── Hudud qaysi oylarda ma'lumotga ega (uzluksiz oxirgi oyna) ──
    const has = new Map<number, Set<string>>();
    for (const r of [...incomes, ...expenses]) {
      const s = has.get(r.regionCode!) ?? new Set<string>();
      s.add(r.period);
      has.set(r.regionCode!, s);
    }
    const windowStart = (code: number): number | null => {
      const s = has.get(code);
      if (!s || !s.has(last)) return null;
      let i = periods.length - 1;
      while (i > 0 && s.has(periods[i - 1]!)) i--;
      return i;
    };

    // ── Daromad: hudud × xizmat ──
    const incomeBy = new Map<string, number[]>();
    for (const r of incomes) {
      const k = `${r.regionCode}|${r.categoryCode}`;
      const arr = incomeBy.get(k) ?? new Array<number>(periods.length).fill(0);
      arr[pIndex.get(r.period)!]! += Number(r.amountTiyin);
      incomeBy.set(k, arr);
    }
    const breakFor = (region: number, code: string | null) =>
      events
        .filter((e) => (e.regionCode === null || e.regionCode === region) && (code === null || e.categoryCode === null || e.categoryCode === code))
        .map((e) => ({ ...e, month: regimeMonth(e.date) }))
        .filter((e) => e.month <= last && e.month > periods[0]!);

    const regionsOut = [];
    const allRevenue: Band[][] = [];
    const allPayroll: Band[][] = [];
    const allOpex: Band[][] = [];
    const allOverhead: Band[][] = [];
    const allResult: Band[][] = [];
    const lowSeries: string[] = [];
    const adjustNotes: string[] = [];

    // ── Ish haqi: xodim darajasida ──
    const recentP = [shiftPeriod(last, -2), shiftPeriod(last, -1), last];
    const btOrigins = [shiftPeriod(last, -2), shiftPeriod(last, -1), last];
    const needP = [...new Set([...recentP, ...btOrigins.flatMap((o) => [shiftPeriod(o, -3), shiftPeriod(o, -2), shiftPeriod(o, -1)])])].sort();
    const entries = await this.payrollEntries(needP);
    const salaryBy = new Map<string, { from: Date; rate: number; base: number }[]>();
    for (const s of salaries) {
      const l = salaryBy.get(s.employeePinfl) ?? [];
      l.push({ from: new Date(s.effectiveFrom), rate: s.rate, base: Number(s.baseSalaryTiyin) });
      salaryBy.set(s.employeePinfl, l);
    }
    const cardAt = (pin: string, period: string): number | null => {
      const end = periodDays(period).last;
      let v: number | null = null;
      for (const c of salaryBy.get(pin) ?? []) if (c.from <= end) v = c.base * c.rate;
      return v;
    };
    const staffCache = new Map<string, Awaited<ReturnType<typeof regionalEmployees>>>();
    const staffOf = async (p: string) => {
      let s = staffCache.get(p);
      if (!s) staffCache.set(p, (s = await regionalEmployees(this.prisma, p)));
      return s;
    };
    /** Bir oy uchun xodimlar bo'yicha taxmin, «hist» oylari ma'lumotidan */
    const predictPayroll = async (target: string, hist: string[]) => {
      const staff = await staffOf(target);
      const ratios = new Map<string, number>();
      const regionRatios = new Map<number, number[]>();
      const regionLast = new Map<number, number[]>();
      const lastHist = hist[hist.length - 1]!;
      for (const e of staff) {
        const rs: number[] = [];
        for (const p of hist) {
          const a = entries.get(p)?.get(e.pinfl);
          const c = cardAt(e.pinfl, p);
          if (a && c) rs.push(a / c);
        }
        if (rs.length) {
          const r = median(rs);
          ratios.set(e.pinfl, r);
          regionRatios.set(e.regionCode, [...(regionRatios.get(e.regionCode) ?? []), r]);
        }
        const a = entries.get(lastHist)?.get(e.pinfl);
        if (a) regionLast.set(e.regionCode, [...(regionLast.get(e.regionCode) ?? []), a]);
      }
      return staff.map((e) => {
        const recent = hist.map((p) => entries.get(p)?.get(e.pinfl) ?? 0);
        const rr = regionRatios.get(e.regionCode);
        const rl = regionLast.get(e.regionCode);
        const est = employeeMonthly({
          baseTiyin: cardAt(e.pinfl, target),
          ratio: ratios.get(e.pinfl) ?? null,
          regionRatio: rr?.length ? median(rr) : null,
          recent,
          regionMedian: rl?.length ? median(rl) : null,
        });
        return { ...e, ...est, recent };
      });
    };
    // Mavsumiy ish haqi tuzatmasi (choraklik / yillik mukofotlar): o'tgan yilning shu oyi ÷ undan oldingi 3 oy medianasi.
    // 5% dan kam farq — e'tiborsiz; 0,7–2,0 oralig'ida cheklanadi. Ma'lumot yetmasa — 1.
    const payLong = await this.payrollByRegion(periods.slice(-27));
    const payFactor = (code: number, target: string): number => {
      const a = payLong.get(shiftPeriod(target, -12))?.get(code) ?? 0;
      const base = [-13, -14, -15].map((k) => payLong.get(shiftPeriod(target, k))?.get(code) ?? 0).filter((v) => v > 0);
      if (!a || base.length < 2) return 1;
      const f = a / median(base);
      if (!Number.isFinite(f) || Math.abs(f - 1) < 0.05) return 1;
      return Math.min(2, Math.max(0.7, f));
    };
    // Tekshiruv: oxirgi 3 oyning har birini oldingi 3 oy bilan aytib ko'rish
    const payBt = new Map<number, { err: number; act: number; n: number }>();
    for (const o of btOrigins) {
      const hist = [shiftPeriod(o, -3), shiftPeriod(o, -2), shiftPeriod(o, -1)];
      if (!hist.some((p) => entries.get(p)?.size)) continue;
      if (!entries.get(o)?.size) continue;
      const pred = await predictPayroll(o, hist);
      const staffO = await staffOf(o);
      const regionOf = new Map(staffO.map((e) => [e.pinfl, e.regionCode]));
      const act = new Map<number, number>();
      for (const [pin, v] of entries.get(o) ?? []) {
        const r = regionOf.get(pin);
        if (r !== undefined) act.set(r, (act.get(r) ?? 0) + v);
      }
      const pr = new Map<number, number>();
      for (const e of pred) pr.set(e.regionCode, (pr.get(e.regionCode) ?? 0) + e.value);
      for (const [code, v] of pr) pr.set(code, v * payFactor(code, o));
      for (const code of new Set([...act.keys(), ...pr.keys()])) {
        const x = payBt.get(code) ?? { err: 0, act: 0, n: 0 };
        x.err += Math.abs((act.get(code) ?? 0) - (pr.get(code) ?? 0));
        x.act += act.get(code) ?? 0;
        x.n += 1;
        payBt.set(code, x);
      }
    }
    const futurePay = new Map<string, Awaited<ReturnType<typeof predictPayroll>>>();
    for (const f of future) futurePay.set(f, await predictPayroll(f, recentP));
    const lastStaff = await staffOf(last);
    const lastPayByRegion = new Map<number, number>();
    const lastRegionOf = new Map(lastStaff.map((e) => [e.pinfl, e.regionCode]));
    for (const [pin, v] of entries.get(last) ?? []) {
      const r = lastRegionOf.get(pin);
      if (r !== undefined) lastPayByRegion.set(r, (lastPayByRegion.get(r) ?? 0) + v);
    }
    const payHist = payLong;

    // ── Markaz ulushi: Markaz xarajati prognozi × so'nggi 3 oy ulushi ──
    const centralSeries = new Array<number>(periods.length).fill(0);
    for (const c of central) {
      const u = unitOf(c.regionCode, c.departmentId);
      if ('unit' in u) centralSeries[pIndex.get(c.period)!]! += Number(c.amountTiyin);
    }
    let firstCentral = centralSeries.findIndex((v) => v !== 0);
    if (firstCentral < 0) firstCentral = periods.length;
    const centralFc = forecastSeries(centralSeries.slice(firstCentral), H, 'central');
    const shareMonths = recentP;
    const [ohMonths, rules] = await Promise.all([loadMonths(this.prisma, shareMonths, lk), this.prisma.overheadRule.findMany()]);
    const oc = this.econ.computeOverhead(ohMonths, rules, lk);
    const centralTotal3 = Number(oc.units.filter((u) => u.kind !== 'unassigned').reduce((s, u) => s + u.expense, 0n));
    const shareOf = (code: number) => (centralTotal3 > 0 ? Number(oc.byRegion.get(code) ?? 0n) / centralTotal3 : 0);
    if (!rules.length) notes.push("Markaz xarajatini taqsimlash qoidalari yo'q — Markaz ulushi prognozda 0 (Markaz xarajati bo'limida qoidalarni belgilang).");

    for (const reg of lk.regions) {
      const code = reg.code;
      const ws = windowStart(code);
      const histPeriods = periods.slice(-12);
      // Daromad xizmatlari
      const services: SeriesOut[] = [];
      const serviceBands: Band[][] = [];
      const weights: { wape: number | null; weight: number }[] = [];
      const codes = [...incomeBy.keys()].filter((k) => k.startsWith(`${code}|`)).map((k) => k.split('|')[1]!);
      for (const sc of codes) {
        const raw = incomeBy.get(`${code}|${sc}`)!;
        const recent12 = raw.slice(-12).reduce((s, v) => s + v, 0);
        if (ws === null) continue;
        let start = ws;
        const sNotes: string[] = [];
        // Tarkibiy uzilishlar: tarif bilan tushuntirilsa — tarix narx bo'yicha tuzatiladi, aks holda kesiladi
        for (const b of breakFor(code, sc)) {
          if (b.kind === 'TARIFF') {
            const before = priceAt(tariffsAll, sc, code, shiftPeriod(b.month, -1));
            const after = priceAt(tariffsAll, sc, code, b.month);
            if (before && after) continue;
          }
          const bi = pIndex.get(b.month);
          if (bi !== undefined && bi > start) {
            start = bi;
            sNotes.push(`Uzilish: ${monthName(b.month)} — ${b.title} (oldingi oylar olinmadi)`);
          }
        }
        const pLast = priceAt(tariffsAll, sc, code, last);
        const y = raw.slice(start).map((v, i) => {
          const p = periods[start + i]!;
          const pm = priceAt(tariffsAll, sc, code, p);
          return pLast && pm && pm !== pLast ? (v * pLast) / pm : v;
        });
        if (pLast && raw.slice(start).some((_, i) => {
          const pm = priceAt(tariffsAll, sc, code, periods[start + i]!);
          return pm && pm !== pLast;
        })) sNotes.push('Tarix tasdiqlangan tarif bo\'yicha joriy narxga keltirildi');
        const res = forecastSeries(y, H, `${code}|${sc}|${last}`);
        // Kelgusi tariflar
        const fc = res.forecast.map((b, i) => {
          const pf = priceAt(tariffsAll, sc, code, future[i]!);
          if (pLast && pf && pf !== pLast) return scaleBand(b, pf / pLast);
          return b;
        });
        for (const f of future) {
          const pf = priceAt(tariffsAll, sc, code, f);
          const pPrev = priceAt(tariffsAll, sc, code, shiftPeriod(f, -1));
          if (pf && pPrev && pf !== pPrev) {
            const txt = `${catLabel.get(sc) ?? sc}: ${monthName(f)} dan yangi tarif (${pctTxt(pf / pPrev - 1)}) — prognoz shu nisbatda o'zgartirildi`;
            sNotes.push(txt);
            if (!adjustNotes.includes(txt)) adjustNotes.push(txt);
          }
        }
        const label = catLabel.get(sc) ?? sc;
        services.push({
          key: sc,
          label,
          history: histPeriods.map((p) => ({ period: p, valueTiyin: T(raw[pIndex.get(p)!]!) })),
          forecast: fc.map(bandOut),
          model: res.model,
          modelLabel: MODEL_LABELS[res.model],
          fromPeriod: periods[start] ?? null,
          used: res.used,
          accuracy: res.accuracy,
          reliability: res.reliability,
          notes: sNotes,
        });
        serviceBands.push(fc);
        weights.push({ wape: res.accuracy.wape, weight: recent12 });
        if ((res.reliability === 'low' || res.reliability === 'none') && recent12 > 0) lowSeries.push(`${reg.name} — ${label}`);
      }
      services.sort((a, b) => Number(b.forecast[0]?.meanTiyin ?? 0) - Number(a.forecast[0]?.meanTiyin ?? 0));
      const revenue = sumBands(serviceBands, H);
      const revHist = histPeriods.map((p) => codes.reduce((s, sc) => s + (incomeBy.get(`${code}|${sc}`)![pIndex.get(p)!] ?? 0), 0));
      const revWape = pooledWape(weights);

      // Ish haqi
      const paySeason = future.map((f) => payFactor(code, f));
      const payMean = future.map((f, i) => (futurePay.get(f) ?? []).filter((e) => e.regionCode === code).reduce((s, e) => s + e.value, 0) * paySeason[i]!);
      const bt = payBt.get(code);
      const payW = bt && bt.act > 0 ? bt.err / bt.act : null;
      const relSigma = (payW ?? 0.05) * 1.25;
      const payroll: Band[] = payMean.map((m, i) => {
        const s = m * relSigma * Math.sqrt(i + 1);
        return { mean: m, lo: Math.max(0, m - 1.2816 * s), hi: m + 1.2816 * s };
      });
      const headNow = lastStaff.filter((e) => e.regionCode === code).length;
      const headFc = future.map((f) => (futurePay.get(f) ?? []).filter((e) => e.regionCode === code).length);
      const basisCount = (futurePay.get(future[0]!) ?? []).filter((e) => e.regionCode === code).reduce<Record<string, number>>((acc, e) => ((acc[e.basis] = (acc[e.basis] ?? 0) + 1), acc), {});

      // Xarajat: takroriy qator + bir martalik zaxira
      const recArr = new Array<number>(periods.length).fill(0);
      const oneArr = new Array<number>(periods.length).fill(0);
      for (const e of expenses) {
        if (e.regionCode !== code || e.source === 'PAYROLL') continue;
        const i = pIndex.get(e.period)!;
        if (e.recurrence === 'ONE_TIME') oneArr[i]! += Number(e.amountTiyin);
        else recArr[i]! += Number(e.amountTiyin);
      }
      const recRes = ws === null ? null : forecastSeries(recArr.slice(ws), H, `opex|${code}|${last}`);
      const oneAllow = oneArr.slice(-6).reduce((s, v) => s + v, 0) / 6;
      const opexRec = recRes ? recRes.forecast : Array.from({ length: H }, () => flat(0));
      const opex = sumBands([opexRec, Array.from({ length: H }, () => flat(oneAllow))], H);
      const budget = future.map((f) => {
        const rows = budgets.filter((b) => b.period === f && b.regionCode === code);
        return rows.length ? T(rows.reduce((s, b) => s + Number(b.amountTiyin), 0)) : null;
      });

      // Markaz ulushi
      const share = shareOf(code);
      const overhead = centralFc.forecast.map((b) => scaleBand(b, share));
      const result = diffBands(revenue, [payroll, opex, overhead], H);

      allRevenue.push(revenue);
      allPayroll.push(payroll);
      allOpex.push(opex);
      allOverhead.push(overhead);
      allResult.push(result);

      const lastRev = revHist[revHist.length - 1] ?? 0;
      const lastPay = lastPayByRegion.get(code) ?? 0;
      const lastOpex = recArr[periods.length - 1]! + oneArr[periods.length - 1]!;
      regionsOut.push({
        code,
        name: reg.name,
        hasData: ws !== null,
        fromPeriod: ws === null ? null : periods[ws]!,
        last: { revenueTiyin: T(lastRev), payrollTiyin: T(lastPay), opexTiyin: T(lastOpex), resultTiyin: T(lastRev - lastPay - lastOpex) },
        revenue: {
          history: histPeriods.map((p, i) => ({ period: p, valueTiyin: T(revHist[i]!) })),
          forecast: revenue.map(bandOut),
          wape: revWape,
          reliability: (revWape === null ? 'low' : revWape <= 0.1 ? 'high' : revWape <= 0.2 ? 'medium' : 'low') as Reliability,
          services,
        },
        payroll: {
          history: histPeriods.map((p) => ({ period: p, valueTiyin: T(payHist.get(p)?.get(code) ?? 0) })),
          forecast: payroll.map(bandOut),
          wape: payW,
          backtestMonths: bt?.n ?? 0,
          headcountNow: headNow,
          headcount: headFc,
          basis: basisCount,
          /** Mavsumiy tuzatma (o'tgan yilning shu oyidagi mukofot va h.k.), 1 — yo'q */
          seasonal: paySeason,
        },
        opex: {
          history: histPeriods.map((p) => ({ period: p, valueTiyin: T(recArr[pIndex.get(p)!]! + oneArr[pIndex.get(p)!]!) })),
          recurring: recRes
            ? { forecast: recRes.forecast.map(bandOut), model: recRes.model, modelLabel: MODEL_LABELS[recRes.model], accuracy: recRes.accuracy, reliability: recRes.reliability }
            : null,
          oneTimeAllowanceTiyin: T(oneAllow),
          forecast: opex.map(bandOut),
          /** Xarajat rejasi (ish haqisiz moddalar) — xarajat prognozi bilan solishtirish uchun */
          budget,
        },
        overhead: { share, forecast: overhead.map(bandOut) },
        result: result.map(bandOut),
      });
    }

    const total = {
      revenue: sumBands(allRevenue, H),
      payroll: sumBands(allPayroll, H),
      opex: sumBands(allOpex, H),
      overhead: sumBands(allOverhead, H),
    };
    const totalResult = diffBands(total.revenue, [total.payroll, total.opex, total.overhead], H);
    const totalWape = pooledWape(regionsOut.map((r) => ({ wape: r.revenue.wape, weight: Number(r.last.revenueTiyin) })));
    const payBtAll = [...payBt.values()].reduce((s, x) => ({ err: s.err + x.err, act: s.act + x.act }), { err: 0, act: 0 });

    // Xulosalar
    const insights: { level: 'good' | 'warn' | 'bad' | 'info'; regionCode: number | null; text: string }[] = [];
    const overBudget: string[] = [];
    for (const r of regionsOut) {
      if (!r.hasData) continue;
      const m0 = Number(r.result[0]!.meanTiyin);
      const hi0 = Number(r.result[0]!.hiTiyin);
      if (m0 < 0) insights.push({ level: 'bad', regionCode: r.code, text: `${r.name}: ${monthName(future[0]!)} da zarar kutilmoqda (${mln(m0)}, Markaz ulushi bilan).` });
      else if (Number(r.result[0]!.loTiyin) < 0 && hi0 > 0) insights.push({ level: 'warn', regionCode: r.code, text: `${r.name}: natija noaniq — 80% oraliq zarar tomonga ham o'tadi.` });
      const lr = Number(r.last.revenueTiyin);
      const fr = Number(r.revenue.forecast[0]!.meanTiyin);
      if (lr > 0 && Math.abs(fr / lr - 1) >= 0.15) insights.push({ level: fr < lr ? 'warn' : 'good', regionCode: r.code, text: `${r.name}: keyingi oy daromadi ${monthName(last)} ga nisbatan ${pctTxt(fr / lr - 1)} kutilmoqda.` });
      const lp = Number(r.last.payrollTiyin);
      const fp = Number(r.payroll.forecast[r.payroll.forecast.length - 1]!.meanTiyin);
      if (lp > 0 && fp / lp - 1 >= 0.1) insights.push({ level: 'warn', regionCode: r.code, text: `${r.name}: ish haqi davr oxirigacha ${pctTxt(fp / lp - 1)} o'sadi (maosh o'zgarishlari / yangi xodimlar).` });
      const b = r.opex.budget.map((x, i) => (x === null ? null : Number(r.opex.forecast[i]!.meanTiyin) / Number(x) - 1));
      const over = b.findIndex((x) => x !== null && x > 0.1);
      if (over >= 0) overBudget.push(`${r.name} (${monthName(future[over]!)}: ${pctTxt(b[over]!)})`);
    }
    if (overBudget.length) insights.push({ level: 'warn', regionCode: null, text: `Xarajat prognozi rejadan 10% dan ko'p yuqori — ${overBudget.length} ta hudud: ${overBudget.join(', ')}.` });
    for (const a of adjustNotes) insights.push({ level: 'info', regionCode: null, text: a });
    if (lowSeries.length) insights.push({ level: 'info', regionCode: null, text: `Ishonchliligi past qatorlar (${lowSeries.length}): ${lowSeries.slice(0, 6).join('; ')}${lowSeries.length > 6 ? ' …' : ''}. Tarix qisqa yoki tebranish katta.` });
    if (!closes.length) notes.push(`${monthName(last)} hali yopilmagan — prognoz asosi o'zgarishi mumkin.`);
    const order = { bad: 0, warn: 1, good: 2, info: 3 };
    insights.sort((a, b) => order[a.level] - order[b.level]);

    return {
      lastActual: last,
      lastLabel: monthName(last),
      horizon: H,
      periods: future,
      periodLabels: future.map(monthName),
      history: periods.slice(-12),
      generatedAt: new Date().toISOString(),
      total: {
        revenue: total.revenue.map(bandOut),
        payroll: total.payroll.map(bandOut),
        opex: total.opex.map(bandOut),
        overhead: total.overhead.map(bandOut),
        result: totalResult.map(bandOut),
        revenueWape: totalWape,
        payrollWape: payBtAll.act > 0 ? payBtAll.err / payBtAll.act : null,
        last: {
          revenueTiyin: T(regionsOut.reduce((s, r) => s + Number(r.last.revenueTiyin), 0)),
          payrollTiyin: T(regionsOut.reduce((s, r) => s + Number(r.last.payrollTiyin), 0)),
          opexTiyin: T(regionsOut.reduce((s, r) => s + Number(r.last.opexTiyin), 0)),
        },
      },
      central: { forecast: centralFc.forecast.map(bandOut), model: centralFc.model, modelLabel: MODEL_LABELS[centralFc.model], allocatedShare: regionsOut.reduce((s, r) => s + r.overhead.share, 0) },
      regions: regionsOut,
      insights,
      notes,
      method: [
        "Daromad: har hudud × xizmat alohida qator. Model (o'rtacha / SES / Holt / mavsumiy) ma'lumot uzunligi va o'tmishdagi aniqlikka qarab avtomatik tanlanadi: har model oxirgi 6 oyga 1, 2 va 3 oy oldinga «bilmasdan» aytib ko'riladi, eng kam xato qilgani olinadi; hudud jami — xizmatlar yig'indisi.",
        "Bir martalik keskin sakrashlar (qo'shni oylardan odatiy tebranishdan 4,5 barobar ko'p farq qilgan va boshqa yillarning shu oyida takrorlanmagan oylar) modelni o'rgatishda qo'shni oylar darajasida olinadi — bitta g'ayrioddiy oy prognozni surib yubormaydi. Oxirgi oy tegilmaydi.",
        "Voqealar jurnalidagi tarkibiy uzilishdan oldingi oylar olinmaydi. Tasdiqlangan tarif o'zgarishi esa tarixni joriy narxga keltiradi (oylar kesilmaydi), kelgusi tarif prognozni shu nisbatda o'zgartiradi.",
        "Ish haqi — xodim bo'yicha: shtat kartasi bo'lsa maosh × stavka × odatiy nisbat (so'nggi 3 oy: to'langan ÷ karta), bo'lmasa so'nggi 3 oy medianasi; yangi xodim — hududdagi o'rtacha. Bo'shash va ishga kirish sanalari, kelgusi maosh o'zgarishlari hisobga olinadi. Bo'sh shtat o'rinlari kirmaydi.",
        "Ish haqi mavsumi: o'tgan yilning shu oyida hudud ish haqi undan oldingi 3 oy medianasidan 5% dan ko'p farq qilgan bo'lsa (choraklik yoki yil oxiri mukofoti), prognoz shu nisbatda tuzatiladi.",
        "Xarajat: takroriy va belgilanmagan xarajatlar qatori (ETS) + bir martalik xarajatlar uchun so'nggi 6 oy o'rtachasi zaxira sifatida.",
        "Markaz ulushi: Markaz xarajati prognozi × hududning so'nggi 3 oydagi taqsimot ulushi (Markaz xarajati bo'limi qoidalari bilan).",
        "Tekshiruv: oxirgi 6 oyning har biri uchun model faqat oldingi ma'lumotda o'rgatilib, 1–3 oy oldinga aytildi; xato WAPE = Σ|xato| ÷ Σ|haqiqiy|. Ish haqi usuli oxirgi 3 oyda xuddi shunday sinaldi.",
        "Oraliq — 80%: model 400 ta tasodifiy kelajak yo'lini hisoblaydi; og'ish o'lchami o'tmishdagi sinovda model haqiqatda qilgan xatolardan kam olinmaydi (oraliq o'ziga ortiqcha ishonmaydi). Yig'indilarda qatorlar mustaqil deb olinadi (σ = √Σσ²), shuning uchun jami oraliq biroz tor bo'lishi mumkin.",
      ],
    };
  }

  /** Bir hudud xodimlari bo'yicha ish haqi prognozi (batafsil) */
  async payrollDetail(to: string | undefined, h: string | number | undefined, regionRaw: string | number) {
    const { last, future } = resolveForecastBase(to, h);
    const code = Number(regionRaw);
    const lk = await loadLookups(this.prisma);
    const reg = lk.regions.find((r) => r.code === code);
    if (!reg) throw new BadRequestException('Hudud topilmadi');
    const recentP = [shiftPeriod(last, -2), shiftPeriod(last, -1), last];
    const [entries, salaries, emps] = await Promise.all([
      this.payrollEntries(recentP),
      this.prisma.employeeSalary.findMany({ select: { employeePinfl: true, effectiveFrom: true, rate: true, baseSalaryTiyin: true }, orderBy: { effectiveFrom: 'asc' } }),
      this.prisma.employee.findMany({ select: { pinfl: true, fullName: true, position: true, hiredAt: true, firedAt: true } }),
    ]);
    const empBy = new Map(emps.map((e) => [e.pinfl, e]));
    const cards = new Map<string, { from: Date; rate: number; base: number }[]>();
    for (const s of salaries) cards.set(s.employeePinfl, [...(cards.get(s.employeePinfl) ?? []), { from: new Date(s.effectiveFrom), rate: s.rate, base: Number(s.baseSalaryTiyin) }]);
    const cardAt = (pin: string, p: string) => {
      const end = periodDays(p).last;
      let v: { base: number; rate: number; from: Date } | null = null;
      for (const c of cards.get(pin) ?? []) if (c.from <= end) v = c;
      return v;
    };
    const staffBy = new Map<string, Awaited<ReturnType<typeof regionalEmployees>>>();
    const staffMany = await regionalEmployeesMany(this.prisma, [last, ...future]);
    for (const p of [last, ...future]) staffBy.set(p, (staffMany.get(p) ?? []).filter((e) => e.regionCode === code));
    const pins = new Set<string>();
    for (const s of staffBy.values()) for (const e of s) pins.add(e.pinfl);
    // Hudud nisbati va medianasi
    const ratiosAll: number[] = [];
    const lastAll: number[] = [];
    for (const e of staffBy.get(last)!) {
      for (const p of recentP) {
        const a = entries.get(p)?.get(e.pinfl);
        const c = cardAt(e.pinfl, p);
        if (a && c) ratiosAll.push(a / (c.base * c.rate));
      }
      const a = entries.get(last)?.get(e.pinfl);
      if (a) lastAll.push(a);
    }
    const regionRatio = ratiosAll.length ? median(ratiosAll) : null;
    const regionMedian = lastAll.length ? median(lastAll) : null;
    const rows = [...pins].map((pin) => {
      const e = empBy.get(pin);
      const recent = recentP.map((p) => entries.get(p)?.get(pin) ?? 0);
      const rs: number[] = [];
      for (const p of recentP) {
        const a = entries.get(p)?.get(pin);
        const c = cardAt(pin, p);
        if (a && c) rs.push(a / (c.base * c.rate));
      }
      const ratio = rs.length ? median(rs) : null;
      const months = future.map((f) => {
        const active = staffBy.get(f)!.some((x) => x.pinfl === pin);
        if (!active) return null;
        const c = cardAt(pin, f);
        return employeeMonthly({ baseTiyin: c ? c.base * c.rate : null, ratio, regionRatio, recent, regionMedian });
      });
      const c0 = cardAt(pin, last);
      const changes: string[] = [];
      for (const f of future) {
        const c = cardAt(pin, f);
        const prev = cardAt(pin, shiftPeriod(f, -1));
        if (c && prev && c.base * c.rate !== prev.base * prev.rate) changes.push(`${monthName(f)}: maosh ${pctTxt((c.base * c.rate) / (prev.base * prev.rate) - 1)}`);
        if (c && !prev && staffBy.get(f)!.some((x) => x.pinfl === pin)) changes.push(`${monthName(f)}: shtat kartasi boshlanadi`);
      }
      if (e?.firedAt && e.firedAt > periodDays(last).last) changes.push(`Bo'shaydi: ${e.firedAt.toISOString().slice(0, 10)}`);
      if (e?.hiredAt && e.hiredAt > periodDays(last).last) changes.push(`Ishga kiradi: ${e.hiredAt.toISOString().slice(0, 10)}`);
      return {
        pinfl: pin,
        fullName: e?.fullName ?? pin,
        position: e?.position ?? null,
        cardTiyin: c0 ? T(c0.base * c0.rate) : null,
        rate: c0?.rate ?? null,
        ratio,
        recent: recent.map(T),
        months: months.map((m) => (m ? { valueTiyin: T(m.value), basis: m.basis } : null)),
        changes,
      };
    });
    rows.sort((a, b) => a.fullName.localeCompare(b.fullName));
    return { region: { code, name: reg.name }, lastActual: last, recentPeriods: recentP, periods: future, regionRatio, regionMedianTiyin: regionMedian === null ? null : T(regionMedian), rows };
  }

  // ─────────────────────────── Versiyalar ───────────────────────────
  async saveRun(to: string | undefined, h: string | number | undefined, note: string | null | undefined, userId: string) {
    const f = await this.forecast(to, h);
    const summary = {
      periods: f.periods,
      regions: f.regions.map((r) => ({
        code: r.code,
        name: r.name,
        revenue: r.revenue.forecast.map((b) => b.meanTiyin),
        revenueLo: r.revenue.forecast.map((b) => b.loTiyin),
        revenueHi: r.revenue.forecast.map((b) => b.hiTiyin),
        payroll: r.payroll.forecast.map((b) => b.meanTiyin),
        opex: r.opex.forecast.map((b) => b.meanTiyin),
        overhead: r.overhead.forecast.map((b) => b.meanTiyin),
        result: r.result.map((b) => b.meanTiyin),
        revenueWape: r.revenue.wape,
        payrollWape: r.payroll.wape,
        models: Object.fromEntries(r.revenue.services.map((s) => [s.key, s.model])),
      })),
      total: { revenue: f.total.revenue.map((b) => b.meanTiyin), payroll: f.total.payroll.map((b) => b.meanTiyin), opex: f.total.opex.map((b) => b.meanTiyin), result: f.total.result.map((b) => b.meanTiyin) },
    };
    const row = await this.prisma.forecastRun.create({
      data: { lastActual: f.lastActual, horizon: f.horizon, note: note ? String(note).trim().slice(0, 300) || null : null, summary: summary as object, createdById: userId },
    });
    await this.audit.log({ userId, action: 'CREATE', entity: 'forecast_run', entityId: row.id, summary: `Prognoz versiyasi saqlandi: ${monthName(f.lastActual)} gacha, ${f.horizon} oy` });
    return { id: row.id };
  }

  async deleteRun(id: string, userId: string) {
    const row = await this.prisma.forecastRun.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Versiya topilmadi');
    await this.prisma.forecastRun.delete({ where: { id } });
    await this.audit.log({ userId, action: 'DELETE', entity: 'forecast_run', entityId: id, summary: `Prognoz versiyasi o'chirildi (${row.lastActual})` });
    return { ok: true };
  }

  /** Saqlangan versiyalar va ular haqiqiy natija bilan qanchalik mos chiqqani */
  async runs() {
    const rows = await this.prisma.forecastRun.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, fullName: true } });
    const uname = new Map(users.map((u) => [u.id, u.fullName]));
    const cur = currentPeriod();
    type Summary = { periods: string[]; regions: { code: number; name: string; revenue: string[]; payroll: string[]; opex: string[]; result: string[] }[] };
    const wanted = [...new Set(rows.flatMap((r) => (r.summary as unknown as Summary).periods ?? []).filter((p) => p < cur))].sort();
    const lk = await loadLookups(this.prisma);
    const months = wanted.length ? await loadMonths(this.prisma, wanted, lk) : [];
    const pay = wanted.length ? await this.payrollByRegion(wanted) : new Map<string, Map<number, number>>();
    const actual = new Map(months.map((m) => [m.period, m]));
    return rows.map((r) => {
      const s = r.summary as unknown as Summary;
      const comps = { revenue: { e: 0, a: 0 }, payroll: { e: 0, a: 0 }, opex: { e: 0, a: 0 } };
      const monthsOut = (s.periods ?? []).map((p, i) => {
        const m = actual.get(p);
        if (!m || p >= cur || !m.regions.size) return { period: p, label: monthName(p), available: false as const };
        let fr = 0, ar = 0, fpay = 0, apay = 0, fo = 0, ao = 0;
        const regionErr: { code: number; name: string; forecastTiyin: string; actualTiyin: string; error: number | null }[] = [];
        for (const reg of s.regions) {
          const am = m.regions.get(reg.code);
          const a = Number(am?.revenue ?? 0n);
          const f = Number(reg.revenue[i] ?? 0);
          fr += f;
          ar += a;
          fpay += Number(reg.payroll[i] ?? 0);
          apay += pay.get(p)?.get(reg.code) ?? 0;
          fo += Number(reg.opex[i] ?? 0);
          ao += Number((am?.opex ?? 0n));
          regionErr.push({ code: reg.code, name: reg.name, forecastTiyin: T(f), actualTiyin: T(a), error: a ? (f - a) / a : null });
        }
        comps.revenue.e += Math.abs(fr - ar); comps.revenue.a += ar;
        comps.payroll.e += Math.abs(fpay - apay); comps.payroll.a += apay;
        comps.opex.e += Math.abs(fo - ao); comps.opex.a += ao;
        regionErr.sort((a, b) => Math.abs(b.error ?? 0) - Math.abs(a.error ?? 0));
        return {
          period: p,
          label: monthName(p),
          available: true as const,
          revenue: { forecastTiyin: T(fr), actualTiyin: T(ar), error: ar ? (fr - ar) / ar : null },
          payroll: { forecastTiyin: T(fpay), actualTiyin: T(apay), error: apay ? (fpay - apay) / apay : null },
          opex: { forecastTiyin: T(fo), actualTiyin: T(ao), error: ao ? (fo - ao) / ao : null },
          worst: regionErr.slice(0, 3),
        };
      });
      const w = (c: { e: number; a: number }) => (c.a > 0 ? c.e / c.a : null);
      return {
        id: r.id,
        lastActual: r.lastActual,
        lastLabel: monthName(r.lastActual),
        horizon: r.horizon,
        note: r.note,
        createdAt: r.createdAt,
        createdBy: uname.get(r.createdById) ?? null,
        checked: monthsOut.filter((m) => m.available).length,
        wape: { revenue: w(comps.revenue), payroll: w(comps.payroll), opex: w(comps.opex) },
        months: monthsOut,
      };
    });
  }
}