import { loadCenterCategories } from '../expense-policy/policy.util';
import { BadRequestException, Injectable } from '@nestjs/common';
import { normalCdf } from '../econ/econ.math';
import { PrismaService } from '../prisma/prisma.service';
import { QualityService } from '../regional-data/quality.service';
import { regionalEmployees } from '../regional-data/rd.employees';
import { assertPeriod, CENTRAL_REGION, currentPeriod, monthName, shiftPeriod } from '../regional-data/rd.util';
import { loadLookups, loadMonths } from './econ.loader';
import { ForecastService, resolveForecastBase } from './forecast.service';
import { KpiService } from './kpi.service';
import { PotentialService } from './potential.service';
import { RegionalEconService } from './regional-econ.service';
import { applyScenario, type BaseRegion, type Levers, NO_LEVERS, sigmaFromBand } from './scenario.calc';

// ═══════════════════════════════════════════════════════════
// J. Hududlar paneli: barcha modellar bitta joyda (natija, Markaz ulushi, prognoz, salohiyat, KPI, sifat)
//    + avtomatik izohlar (matn faqat raqamlardan, qoidalar asosida).
// «Nega o'zgardi?» — natija o'zgarishini omillarga ajratish (daromad: hajm va narx; ish haqi: xodimlar soni
//    va o'rtacha ish haqi; xarajat: moddalar; Markaz ulushi).
// I. Stsenariylar — 3-bosqich prognozi ustiga «agar … bo'lsa» dastaklari.
// ═══════════════════════════════════════════════════════════

const T = (x: number | bigint) => (typeof x === 'bigint' ? x.toString() : String(Math.round(x)));
const N = (s: string | null | undefined) => (s ? Number(s) : 0);
const pct = (x: number | null) => (x === null || !Number.isFinite(x) ? '—' : `${x < 0 ? '−' : x > 0 ? '+' : ''}${Math.abs(x * 100).toFixed(1).replace('.', ',')}%`);
const pctAbs = (x: number | null) => (x === null || !Number.isFinite(x) ? '—' : `${Math.abs(x * 100).toFixed(1).replace('.', ',')}%`);
const money = (t: number) => {
  const a = Math.abs(t) / 100;
  const s = t < 0 ? '−' : '';
  return a >= 1e9 ? `${s}${(a / 1e9).toFixed(2).replace('.', ',')} mlrd so'm` : a >= 1e6 ? `${s}${(a / 1e6).toFixed(1).replace('.', ',')} mln so'm` : a >= 1e3 ? `${s}${Math.round(a / 1e3)} ming so'm` : `${s}${Math.round(a)} so'm`;
};
const signed = (t: number) => `${t > 0 ? '+' : ''}${money(t)}`;

export type Light = 'red' | 'amber' | 'green' | 'none';

const LEVER_LIMITS: Record<string, [number, number]> = {
  tariffPct: [-0.5, 1],
  elasticity: [-3, 1],
  volumePct: [-0.5, 1],
  wagePct: [-0.5, 1],
  headcount: [-500, 500],
  opexPct: [-1, 2],
  oneTimeTiyin: [0, 1e15],
  centralPct: [-1, 2],
};

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly econ: RegionalEconService,
    private readonly forecasts: ForecastService,
    private readonly potentials: PotentialService,
    private readonly kpis: KpiService,
    private readonly quality: QualityService,
  ) {}

  // ─────────────────────────── Panel ───────────────────────────
  async dashboard(to?: string) {
    const { last } = resolveForecastBase(to, 3);
    const next = shiftPeriod(last, 1);
    const [perf, ytd, fc, pot, kpiLast, kpiNext, q] = await Promise.all([
      this.econ.performance(last, 'M'),
      this.econ.performance(last, 'Y'),
      this.forecasts.forecast(last, 3),
      this.potentials.potential(last, 3),
      this.kpis.list(last),
      this.kpis.list(next),
      this.quality.check(last),
    ]);
    const rows = perf.rows.map((r) => {
      const y = ytd.rows.find((x) => x.code === r.code)!;
      const f = fc.regions.find((x) => x.code === r.code);
      const p = pot.regions.find((x) => x.code === r.code);
      const k = kpiLast.regions.find((x) => x.code === r.code);
      const kRev = k?.metrics.find((m) => m.metric === 'REVENUE');
      const res0 = f?.result[0];
      const sig = res0 ? sigmaFromBand(N(res0.loTiyin), N(res0.hiTiyin)) : 0;
      const lossProb = res0 ? (sig > 0 ? normalCdf(-N(res0.meanTiyin) / sig) : N(res0.meanTiyin) < 0 ? 1 : 0) : null;
      const kpiStates = (k?.metrics ?? []).reduce<Record<string, number>>((acc, m) => (m.state !== 'none' ? ((acc[m.state] = (acc[m.state] ?? 0) + 1), acc) : acc), {});
      // Holat (svetofor) — sabablari bilan
      const red: string[] = [];
      const amber: string[] = [];
      if (r.hasData) {
        if (N(r.adjustedTiyin) < 0) red.push(N(r.resultTiyin) < 0 ? "o'z xarajatini qoplamaydi" : 'Markaz ulushi bilan zararda');
        if (res0 && N(res0.meanTiyin) < 0) red.push(`${monthName(next)} da zarar kutilmoqda`);
        if (kRev?.state === 'missed') red.push('daromad KPI bajarilmagan');
        if (p?.utilization !== null && p?.utilization !== undefined && p.utilization < 0.9) amber.push(`salohiyatdan ${pctAbs(1 - p.utilization)} past`);
        if (r.revenueGrowth !== null && r.revenueGrowth <= -0.1) amber.push(`daromad ${pct(r.revenueGrowth)}`);
        if (kRev?.state === 'near') amber.push('daromad KPI ga yaqin, lekin bajarilmagan');
        if (lossProb !== null && lossProb >= 0.3 && !(res0 && N(res0.meanTiyin) < 0)) amber.push(`zarar ehtimoli ${pctAbs(lossProb)}`);
        if (r.budget?.variance !== null && r.budget?.variance !== undefined && r.budget.variance > 0.1) amber.push(`xarajat rejadan ${pct(r.budget.variance)}`);
      }
      const light: Light = !r.hasData ? 'none' : red.length ? 'red' : amber.length ? 'amber' : 'green';
      return {
        code: r.code,
        name: r.name,
        light,
        reasons: [...red, ...amber],
        revenueTiyin: r.revenueTiyin,
        revenueGrowth: r.revenueGrowth,
        resultTiyin: r.resultTiyin,
        adjustedTiyin: r.adjustedTiyin,
        adjustedMargin: r.adjustedMargin,
        coverage: r.coverage,
        headcount: r.headcount,
        ytdRevenueTiyin: y.revenueTiyin,
        ytdAdjustedTiyin: y.adjustedTiyin,
        ytdRevenueGrowth: y.revenueGrowth,
        utilization: p?.utilization ?? null,
        potentialNextTiyin: p?.aheadSeasonal[0] ?? null,
        forecastRevenueNextTiyin: f?.revenue.forecast[0]?.meanTiyin ?? null,
        forecastResultNext: res0 ?? null,
        lossProb,
        reliability: f?.revenue.reliability ?? 'none',
        kpi: { revenueAchievement: kRev?.achievement ?? null, revenueState: kRev?.state ?? 'none', states: kpiStates },
      };
    });

    const active = rows.filter((r) => r.light !== 'none');
    const sum = (f: (r: (typeof rows)[number]) => string | null) => active.reduce((s, r) => s + N(f(r)), 0);
    const rev = sum((r) => r.revenueTiyin);
    const prevRev = perf.rows.reduce((s, r) => s + N(r.prev.revenueTiyin), 0);
    const adj = sum((r) => r.adjustedTiyin);
    const opRes = sum((r) => r.resultTiyin);
    const ytdRev = sum((r) => r.ytdRevenueTiyin);
    const ytdPrev = ytd.rows.reduce((s, r) => s + N(r.prev.revenueTiyin), 0);
    const fcRev = N(fc.total.revenue[0]?.meanTiyin);
    const fcRes = N(fc.total.result[0]?.meanTiyin);
    const potNext = N(pot.total.aheadSeasonal[0]);
    const lights = { red: active.filter((r) => r.light === 'red').length, amber: active.filter((r) => r.light === 'amber').length, green: active.filter((r) => r.light === 'green').length };

    // ── Avtomatik izoh ──
    const story: { title: string; text: string; tone: 'good' | 'warn' | 'bad' | 'info' }[] = [];
    story.push({
      title: 'Umumiy holat',
      tone: adj < 0 ? 'bad' : 'info',
      text: `${monthName(last)} da hududlar daromadi ${money(rev)} (${monthName(shiftPeriod(last, -1))} ga nisbatan ${pct(prevRev ? rev / prevRev - 1 : null)}). Operatsion natija ${money(opRes)}, Markaz ulushi bilan ${money(adj)}. Yil boshidan daromad ${money(ytdRev)}${ytdPrev ? ` (o'tgan yilning shu davriga nisbatan ${pct(ytdRev / ytdPrev - 1)})` : ''}.`,
    });
    const grow = active.filter((r) => r.revenueGrowth !== null).sort((a, b) => b.revenueGrowth! - a.revenueGrowth!);
    if (grow.length >= 2) {
      const best = grow[0]!;
      const worst = grow[grow.length - 1]!;
      const margins = active.filter((r) => r.adjustedMargin !== null).sort((a, b) => b.adjustedMargin! - a.adjustedMargin!);
      story.push({
        title: 'Yetakchilar va orqada qolganlar',
        tone: 'info',
        text: `${best.revenueGrowth! >= 0.0005 ? `Eng katta o'sish — ${best.name} (${pct(best.revenueGrowth)})` : `Hech bir hududda daromad o'smadi; eng kam o'zgarish — ${best.name} (${pct(best.revenueGrowth)})`}${worst.revenueGrowth! <= -0.0005 ? `, eng katta pasayish — ${worst.name} (${pct(worst.revenueGrowth)})` : ''}.${margins.length >= 2 ? ` Tuzatilgan rentabellik bo'yicha eng yuqori — ${margins[0]!.name} (${pctAbs(margins[0]!.adjustedMargin)}), eng past — ${margins[margins.length - 1]!.name} (${margins[margins.length - 1]!.adjustedMargin! < 0 ? pct(margins[margins.length - 1]!.adjustedMargin) : pctAbs(margins[margins.length - 1]!.adjustedMargin)}).` : ''}`,
      });
    }
    const reds = active.filter((r) => r.light === 'red');
    if (reds.length) story.push({ title: "E'tibor talab qiladi", tone: 'bad', text: reds.map((r) => `${r.name}: ${r.reasons.slice(0, 2).join(', ')}`).join('; ') + '.' });
    const risky = active.filter((r) => r.lossProb !== null && r.lossProb >= 0.3).sort((a, b) => b.lossProb! - a.lossProb!);
    story.push({
      title: 'Keyingi oy',
      tone: fcRes < 0 ? 'bad' : risky.length ? 'warn' : 'good',
      text: `${monthName(next)} prognozi: daromad ${money(fcRev)} (salohiyat ${money(potNext)}, farq ${pct(potNext ? fcRev / potNext - 1 : null)}), natija Markaz ulushi bilan ${money(fcRes)}.${risky.length ? ` Zarar ehtimoli 30% dan yuqori: ${risky.slice(0, 4).map((r) => `${r.name} (${pctAbs(r.lossProb)})`).join(', ')}.` : ' Zarar ehtimoli yuqori hudud yo\'q.'}`,
    });
    const st = kpiLast.states;
    const kTot = st.met + st.near + st.missed;
    story.push({
      title: 'KPI',
      tone: kTot && st.missed > kTot / 3 ? 'warn' : 'info',
      text: kTot
        ? `${monthName(last)}: ${kTot} ta ko'rsatkichdan ${st.met} tasi bajarildi, ${st.near} tasi yaqin, ${st.missed} tasi bajarilmadi. ${monthName(next)} uchun ${kpiNext.counts.APPROVED} ta maqsad tasdiqlangan${kpiNext.counts.PROPOSED ? `, ${kpiNext.counts.PROPOSED} tasi tasdiq kutmoqda` : ''}.`
        : `${monthName(last)} uchun tasdiqlangan KPI yo'q. ${monthName(next)} uchun ${kpiNext.counts.APPROVED} ta tasdiqlangan.`,
    });
    story.push({
      title: "Ma'lumot",
      tone: q.errors ? 'bad' : q.warnings ? 'warn' : 'good',
      text: `${monthName(last)} ${q.closed ? 'yopilgan' : 'hali yopilmagan'}; sifat tekshiruvi: ${q.errors} ta xato, ${q.warnings} ta ogohlantirish.${q.errors ? ' Xatolar tuzatilmaguncha xulosalar to\'liq ishonchli emas.' : ''}`,
    });

    return {
      lastActual: last,
      lastLabel: monthName(last),
      next,
      nextLabel: monthName(next),
      ytdLabel: ytd.range.label,
      totals: {
        revenueTiyin: T(rev),
        revenueGrowth: prevRev ? rev / prevRev - 1 : null,
        resultTiyin: T(opRes),
        adjustedTiyin: T(adj),
        ytdRevenueTiyin: T(ytdRev),
        ytdGrowth: ytdPrev ? ytdRev / ytdPrev - 1 : null,
        forecastRevenueTiyin: T(fcRev),
        forecastResultTiyin: T(fcRes),
        potentialTiyin: T(potNext),
        utilization: pot.total.utilization,
        centerAdjustedTiyin: perf.center.adjustedTiyin,
        companyResultTiyin: perf.company.resultTiyin,
      },
      lights,
      kpi: { last: kpiLast.states, nextApproved: kpiNext.counts.APPROVED, nextProposed: kpiNext.counts.PROPOSED },
      quality: { closed: q.closed, errors: q.errors, warnings: q.warnings },
      rows,
      story,
      method: [
        "Holat: qizil — Markaz ulushi bilan zarar, keyingi oy zarar prognozi yoki daromad KPI bajarilmagan; sariq — salohiyatdan 10% dan ko'p past, daromad 10% dan ko'p kamaygan, KPI ga yaqin, zarar ehtimoli ≥ 30% yoki xarajat rejadan 10% dan ko'p oshgan; yashil — qolganlari.",
        "Raqamlar tegishli bo'limlardan: Hudud natijasi, Markaz xarajati, Hudud prognozi, Salohiyat, KPI va Hududchi sifat tekshiruvi. Izohlar faqat shu raqamlardan avtomatik yoziladi.",
        "Zarar ehtimoli — keyingi oy natija prognozi va uning 80% oralig'idan (normal yaqinlashuv).",
      ],
    };
  }

  // ─────────────────────────── «Nega o'zgardi?» ───────────────────────────
  async explain(regionRaw: string | number, periodRaw?: string) {
    const code = Number(regionRaw);
    const period = periodRaw ? assertPeriod(periodRaw) : shiftPeriod(currentPeriod(), -1);
    const prev = shiftPeriod(period, -1);
    const lk = await loadLookups(this.prisma);
    const reg = lk.regions.find((r) => r.code === code);
    if (!reg || code === CENTRAL_REGION) throw new BadRequestException('Hudud topilmadi');
    const [incomes, expenses, cats, icats, staff1, staff0, months, rules] = await Promise.all([
      this.prisma.income.findMany({ where: { deletedAt: null, regionCode: code, period: { in: [prev, period] } }, select: { period: true, categoryCode: true, amountTiyin: true, quantity: true } }),
      this.prisma.expense.findMany({ where: { deletedAt: null, regionCode: code, period: { in: [prev, period] } }, select: { period: true, categoryCode: true, amountTiyin: true, source: true } }).then(async (rows) => {
        // Xarajatlar siyosati: Markaz hisobidagi moddalar hudud xarajatiga kirmaydi (Solishtirmadagidek)
        const centerCats = await loadCenterCategories(this.prisma).catch(() => new Set<string>());
        return rows.filter((r) => !centerCats.has(r.categoryCode));
      }),
      this.prisma.category.findMany({ select: { code: true, label: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
      regionalEmployees(this.prisma, period),
      regionalEmployees(this.prisma, prev),
      loadMonths(this.prisma, [prev, period], lk),
      this.prisma.overheadRule.findMany(),
    ]);
    const label = new Map([...cats, ...icats].map((c) => [c.code, c.label]));
    // Daromad: xizmat bo'yicha, hajm va narx
    const svc = new Map<string, { r0: number; r1: number; q0: number; q1: number; qok0: boolean; qok1: boolean }>();
    for (const i of incomes) {
      const x = svc.get(i.categoryCode) ?? { r0: 0, r1: 0, q0: 0, q1: 0, qok0: true, qok1: true };
      const cur = i.period === period;
      if (cur) {
        x.r1 += Number(i.amountTiyin);
        if (i.quantity === null) x.qok1 = false;
        else x.q1 += i.quantity;
      } else {
        x.r0 += Number(i.amountTiyin);
        if (i.quantity === null) x.qok0 = false;
        else x.q0 += i.quantity;
      }
      svc.set(i.categoryCode, x);
    }
    const services = [...svc.entries()].map(([k, x]) => {
      const ok = x.qok0 && x.qok1 && x.q0 > 0 && x.q1 > 0;
      const p0 = ok ? x.r0 / x.q0 : null;
      const p1 = ok ? x.r1 / x.q1 : null;
      return {
        key: k,
        label: label.get(k) ?? k,
        prevTiyin: T(x.r0),
        curTiyin: T(x.r1),
        deltaTiyin: T(x.r1 - x.r0),
        volumeEffectTiyin: ok ? T((x.q1 - x.q0) * p0!) : null,
        priceEffectTiyin: ok ? T((p1! - p0!) * x.q1) : null,
        q0: ok ? x.q0 : null,
        q1: ok ? x.q1 : null,
      };
    });
    services.sort((a, b) => Math.abs(N(b.deltaTiyin)) - Math.abs(N(a.deltaTiyin)));
    // Xarajat: moddalar (ish haqisiz)
    const ex = new Map<string, { a0: number; a1: number }>();
    let pay0 = 0;
    let pay1 = 0;
    for (const e of expenses) {
      const cur = e.period === period;
      if (e.source === 'PAYROLL') {
        if (cur) pay1 += Number(e.amountTiyin);
        else pay0 += Number(e.amountTiyin);
        continue;
      }
      const x = ex.get(e.categoryCode) ?? { a0: 0, a1: 0 };
      if (cur) x.a1 += Number(e.amountTiyin);
      else x.a0 += Number(e.amountTiyin);
      ex.set(e.categoryCode, x);
    }
    const opex = [...ex.entries()].map(([k, x]) => ({ key: k, label: label.get(k) ?? (k || 'Boshqa'), prevTiyin: T(x.a0), curTiyin: T(x.a1), deltaTiyin: T(x.a1 - x.a0) })).sort((a, b) => Math.abs(N(b.deltaTiyin)) - Math.abs(N(a.deltaTiyin)));
    // Ish haqi: xodimlar soni va o'rtacha
    const h1 = staff1.filter((e) => e.regionCode === code).length;
    const h0 = staff0.filter((e) => e.regionCode === code).length;
    const avg0 = h0 ? pay0 / h0 : 0;
    const avg1 = h1 ? pay1 / h1 : 0;
    const headEffect = h0 ? (h1 - h0) * avg0 : pay1 - pay0;
    const avgEffect = h0 ? (avg1 - avg0) * h1 : 0;
    // Markaz ulushi
    const oc0 = this.econ.computeOverhead(months.filter((m) => m.period === prev), rules, lk);
    const oc1 = this.econ.computeOverhead(months.filter((m) => m.period === period), rules, lk);
    const oh0 = Number(oc0.byRegion.get(code) ?? 0n);
    const oh1 = Number(oc1.byRegion.get(code) ?? 0n);
    const rev0 = services.reduce((s, x) => s + N(x.prevTiyin), 0);
    const rev1 = services.reduce((s, x) => s + N(x.curTiyin), 0);
    const op0 = opex.reduce((s, x) => s + N(x.prevTiyin), 0);
    const op1 = opex.reduce((s, x) => s + N(x.curTiyin), 0);
    const res0 = rev0 - pay0 - op0 - oh0;
    const res1 = rev1 - pay1 - op1 - oh1;
    const steps = [
      { key: 'start', label: `${monthName(prev)} natijasi`, valueTiyin: T(res0) },
      { key: 'revenue', label: 'Daromad o\'zgarishi', valueTiyin: T(rev1 - rev0) },
      { key: 'payroll', label: "Ish haqi o'zgarishi", valueTiyin: T(-(pay1 - pay0)) },
      { key: 'opex', label: "Xarajat o'zgarishi", valueTiyin: T(-(op1 - op0)) },
      { key: 'overhead', label: "Markaz ulushi o'zgarishi", valueTiyin: T(-(oh1 - oh0)) },
      { key: 'end', label: `${monthName(period)} natijasi`, valueTiyin: T(res1) },
    ];
    // Matn
    const parts: string[] = [];
    const topS = services.filter((s) => N(s.deltaTiyin) !== 0).slice(0, 2);
    parts.push(
      `Daromad ${signed(rev1 - rev0)}${topS.length ? ` — asosan ${topS.map((s) => `«${s.label}» ${signed(N(s.deltaTiyin))}${s.volumeEffectTiyin !== null ? ` (hajm ${signed(N(s.volumeEffectTiyin))}, narx ${signed(N(s.priceEffectTiyin))})` : ''}`).join(', ')}` : ''}.`,
    );
    parts.push(
      `Ish haqi ${signed(pay1 - pay0)}: ${h1 !== h0 ? `xodimlar soni ${h0} → ${h1} (${signed(headEffect)})` : `xodimlar soni o'zgarmadi (${h1})`}${avg0 && Math.abs(avg1 / avg0 - 1) >= 0.0005 ? `, o'rtacha ish haqi ${pct(avg1 / avg0 - 1)} (${signed(avgEffect)})` : ''}.`,
    );
    const topO = opex.filter((o) => N(o.deltaTiyin) !== 0).slice(0, 2);
    parts.push(`Xarajat ${signed(op1 - op0)}${topO.length ? ` — asosan ${topO.map((o) => `«${o.label}» ${signed(N(o.deltaTiyin))}`).join(', ')}` : ''}.`);
    if (oh0 || oh1) parts.push(`Markaz ulushi ${signed(oh1 - oh0)}.`);
    const drivers = [
      { k: 'daromad', v: rev1 - rev0 },
      { k: 'ish haqi', v: -(pay1 - pay0) },
      { k: 'xarajat', v: -(op1 - op0) },
      { k: 'Markaz ulushi', v: -(oh1 - oh0) },
    ].sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
    const headline = `${reg.name}: natija ${money(res0)} dan ${money(res1)} ga o'zgardi (${signed(res1 - res0)}). Eng katta ta'sir — ${drivers[0]!.k} (${signed(drivers[0]!.v)}).`;
    return {
      region: { code, name: reg.name },
      period,
      periodLabel: monthName(period),
      prev,
      prevLabel: monthName(prev),
      headline,
      parts,
      steps,
      check: { ok: Math.round(res0 + (rev1 - rev0) - (pay1 - pay0) - (op1 - op0) - (oh1 - oh0) - res1) === 0 },
      services,
      opex,
      payroll: { prevTiyin: T(pay0), curTiyin: T(pay1), h0, h1, avg0Tiyin: T(avg0), avg1Tiyin: T(avg1), headEffectTiyin: T(headEffect), avgEffectTiyin: T(avgEffect) },
      overhead: { prevTiyin: T(oh0), curTiyin: T(oh1) },
      method: [
        "Natija o'zgarishi = Δ daromad − Δ ish haqi − Δ xarajat − Δ Markaz ulushi (qoldiqsiz).",
        "Xizmat daromadi: soni ikkala oyda ham bo'lsa — hajm ta'siri (Δsoni × o'tgan oy narxi) va narx ta'siri (Δnarx × joriy soni).",
        "Ish haqi: xodimlar soni ta'siri (Δsoni × o'tgan oy o'rtachasi) va o'rtacha ish haqi ta'siri (Δo'rtacha × joriy soni).",
      ],
    };
  }

  // ─────────────────────────── Stsenariy ───────────────────────────
  async scenario(input: { to?: string; h?: number | string; levers?: Partial<Levers> }) {
    const fc = await this.forecasts.forecast(input.to, input.h ?? 6);
    const H = fc.horizon;
    const raw = input.levers ?? {};
    const L: Levers = { ...NO_LEVERS };
    for (const [k, [lo, hi]] of Object.entries(LEVER_LIMITS)) {
      const v = (raw as Record<string, unknown>)[k];
      if (v === undefined || v === null || v === '') continue;
      const x = Number(v);
      if (!Number.isFinite(x) || x < lo || x > hi) throw new BadRequestException(`Dastak qiymati chegaradan tashqarida: ${k}`);
      (L as unknown as Record<string, number>)[k] = k === 'headcount' ? Math.round(x) : x;
    }
    L.start = Math.max(0, Math.min(H - 1, Math.round(Number(raw.start ?? 0)) || 0));
    L.regionCode = raw.regionCode === null || raw.regionCode === undefined || (raw.regionCode as unknown) === '' ? null : Number(raw.regionCode);
    if (L.regionCode !== null && !fc.regions.some((r) => r.code === L.regionCode)) throw new BadRequestException('Hudud topilmadi');
    L.tariffService = raw.tariffService ? String(raw.tariffService) : null;

    const base: BaseRegion[] = fc.regions
      .filter((r) => r.hasData)
      .map((r) => ({
        code: r.code,
        name: r.name,
        services: r.revenue.services.map((s) => ({ key: s.key, forecast: s.forecast.map((b) => N(b.meanTiyin)) })),
        payroll: r.payroll.forecast.map((b) => N(b.meanTiyin)),
        headcount: r.payroll.headcount,
        opex: r.opex.forecast.map((b) => N(b.meanTiyin)),
        overhead: r.overhead.forecast.map((b) => N(b.meanTiyin)),
        resultSigma: r.result.map((b) => sigmaFromBand(N(b.loTiyin), N(b.hiTiyin))),
      }));
    const out = applyScenario(base, H, L);
    const months = fc.periods.map((p, i) => {
      const agg = (k: 'base' | 'scen', f: 'revenue' | 'payroll' | 'opex' | 'overhead' | 'result') => out.reduce((s, r) => s + r[k][i]![f], 0);
      return {
        period: p,
        label: monthName(p),
        base: { revenue: T(agg('base', 'revenue')), payroll: T(agg('base', 'payroll')), opex: T(agg('base', 'opex')), overhead: T(agg('base', 'overhead')), result: T(agg('base', 'result')) },
        scen: { revenue: T(agg('scen', 'revenue')), payroll: T(agg('scen', 'payroll')), opex: T(agg('scen', 'opex')), overhead: T(agg('scen', 'overhead')), result: T(agg('scen', 'result')) },
      };
    });
    const tot = (k: 'base' | 'scen', f: 'revenue' | 'payroll' | 'opex' | 'overhead' | 'result') => months.reduce((s, m) => s + N(m[k][f]), 0);
    const d = { revenue: tot('scen', 'revenue') - tot('base', 'revenue'), payroll: tot('scen', 'payroll') - tot('base', 'payroll'), opex: tot('scen', 'opex') - tot('base', 'opex'), overhead: tot('scen', 'overhead') - tot('base', 'overhead'), result: tot('scen', 'result') - tot('base', 'result') };
    const scope = L.regionCode === null ? 'barcha hududlarda' : `${fc.regions.find((r) => r.code === L.regionCode)!.name}da`;
    const startLabel = monthName(fc.periods[L.start]!);
    const lev: string[] = [];
    if (L.tariffPct) lev.push(`tarif ${pct(L.tariffPct)}${L.tariffService ? ` («${fc.regions.flatMap((r) => r.revenue.services).find((s) => s.key === L.tariffService)?.label ?? L.tariffService}»)` : ''}${L.elasticity ? `, talab elastikligi ${L.elasticity < 0 ? '−' : ''}${Math.abs(L.elasticity).toFixed(2).replace('.', ',')}` : ''}`);
    if (L.volumePct) lev.push(`hajm ${pct(L.volumePct)}`);
    if (L.wagePct) lev.push(`maosh ${pct(L.wagePct)}`);
    if (L.headcount) lev.push(`xodimlar ${L.headcount > 0 ? '+' : ''}${L.headcount}`);
    if (L.opexPct) lev.push(`xarajat ${pct(L.opexPct)}`);
    if (L.oneTimeTiyin) lev.push(`bir martalik xarajat ${money(L.oneTimeTiyin)}`);
    if (L.centralPct) lev.push(`Markaz xarajati ${pct(L.centralPct)}`);
    const touched = out.filter((r) => r.touched);
    const lossBase = touched.filter((r) => r.base.some((m) => m.result < 0)).length;
    const lossScen = touched.filter((r) => r.scen.some((m) => m.result < 0)).length;
    const narrative = lev.length
      ? [
          `${startLabel} dan ${scope}: ${lev.join(', ')}.`,
          `${H} oyda ${[
            Math.round(d.revenue) ? `daromad ${signed(d.revenue)}` : '',
            Math.round(d.payroll) ? `ish haqi ${signed(d.payroll)}` : '',
            Math.round(d.opex) ? `xarajat ${signed(d.opex)}` : '',
            Math.round(d.overhead) ? `Markaz ulushi ${signed(d.overhead)}` : '',
          ]
            .filter(Boolean)
            .join(', ')} — natija ${signed(d.result)} (${money(tot('base', 'result'))} → ${money(tot('scen', 'result'))}).`,
          `Zararli oyi bor hududlar: ${lossBase} → ${lossScen}.`,
        ]
      : ['Dastaklar tanlanmagan — stsenariy asos prognoziga teng.'];
    return {
      lastActual: fc.lastActual,
      horizon: H,
      periods: fc.periods,
      periodLabels: fc.periodLabels,
      levers: L,
      services: [...new Map(fc.regions.flatMap((r) => r.revenue.services.map((s) => [s.key, s.label] as const))).entries()].map(([key, label]) => ({ key, label })),
      months,
      delta: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, T(v)])),
      regions: out.map((r) => ({
        code: r.code,
        name: r.name,
        touched: r.touched,
        baseResult: r.base.map((m) => T(m.result)),
        scenResult: r.scen.map((m) => T(m.result)),
        scenRevenue: r.scen.map((m) => T(m.revenue)),
        baseLoss: r.base.map((m) => m.lossProb),
        scenLoss: r.scen.map((m) => m.lossProb),
        breakEvenTariff: r.breakEvenTariff,
        deltaTiyin: T(r.scen.reduce((s, m) => s + m.result, 0) - r.base.reduce((s, m) => s + m.result, 0)),
      })),
      narrative,
      method: [
        'Asos — Hudud prognozi (xizmatlar daromadi, xodimlar bo\'yicha ish haqi, xarajat, Markaz ulushi).',
        "Tarif: xizmat daromadi × (1 + t) × (1 + e·t); e — talab elastikligi (masalan −0,3: narx 10% oshsa, hajm 3% kamayadi).",
        "Xodim qo'shish: hududning keyingi oydagi o'rtacha ish haqi bilan. Bir martalik xarajat — boshlanish oyiga.",
        "Zarar ehtimoli — natija prognozining 80% oralig'idan (normal yaqinlashuv); stsenariyda tebranish daromad nisbatida o'zgaradi.",
        'Zararsizlik tarifi — natija 0 bo\'lishi uchun barcha xizmatlar tarifini qancha o\'zgartirish kerak (elastiklik hisobga olinmagan).',
      ],
    };
  }
}