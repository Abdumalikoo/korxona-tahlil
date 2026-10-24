import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  centerCoverage,
  changePct,
  compare,
  completeness,
  drivers,
  duplicateGroups,
  pctOf,
  planFact,
  PRIORITY_LABEL,
  ranks,
  risks as buildRisks,
  som,
  summaries,
  toSom,
  totals,
  unitStats,
  type Driver,
  type PlanFact,
  type Risk,
  type Totals,
  type UnitStat,
} from './general.calc';
import { COMPARE_LABEL, GENERAL_THRESHOLDS, NO_HISTORY, STATUS_LABEL, type CompareKind, type DataStatus } from './general.config';
import { GeneralSources } from './general.sources';
import { mln } from './report.common';
import { monthsOf, previousRange, rangeText, ReportData, todayIso, yearAgoRange, type Range, type Row } from './reports.data';
import { fmtPct, PALETTE, periodLabel, periodShort, safeFile } from './reports.format';
import type { Block, Cell, KpiItem, ReportDoc, ReportFormat, ReportParams, ReportSection, Tone } from './reports.types';

// ═══════════════════════════════════════════════════════════
// «Umumiy hisobot» (avvalgi nomi — «Rahbariyat uchun qisqa hisobot», tur kaliti 'executive' saqlangan).
// Rahbar 2–3 daqiqada: davr qanday yakunlandi, reja bajarildimi, natija nimaga o'zgardi,
// qaysi hududlar yaxshi/yomon, qanday xavflar bor, nima qilish kerak va raqamlarga qanchalik ishonish mumkin.
// Hisoblash — general.calc.ts (BigInt, testlangan); manbalar — general.sources.ts; chegaralar — general.config.ts.
// PDF/PowerPoint — qisqa; batafsil jadvallar — Excel (formats: ['xlsx']).
// ═══════════════════════════════════════════════════════════

const XLSX: ReportFormat[] = ['xlsx'];
const PRINT: ReportFormat[] = ['pdf', 'pptx'];

type View = 'short' | 'full';

const pctOrDash = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);
const somCell = (t: bigint | null): Cell => (t === null ? null : toSom(t));
const rankText = (r: { rank: number; of: number } | undefined) => (r ? `${r.rank}/${r.of}` : '—');

function upTone(v: number | null, inverse = false): Tone {
  if (v === null || Math.abs(v) < 0.5) return 'neutral';
  return (v > 0) !== inverse ? 'good' : 'bad';
}

@Injectable()
export class ExecutiveReport {
  constructor(
    private readonly data: ReportData,
    private readonly sources: GeneralSources,
  ) {}

  /** Davr: berilmagan bo'lsa — eng oxirgi yopilgan oy, u ham bo'lmasa — oxirgi to'liq oy */
  private async resolveRange(params: ReportParams): Promise<Range> {
    if (params.from && params.to) return this.data.parseRange(params.from, params.to);
    const closed = await this.sources.lastClosedMonth();
    const today = todayIso();
    const month = closed ?? (() => {
      const y = Number(today.slice(0, 4));
      const m = Number(today.slice(5, 7));
      const d = new Date(Date.UTC(y, m - 2, 1));
      return d.toISOString().slice(0, 7);
    })();
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    return this.data.parseRange(`${month}-01`, `${month}-${String(last).padStart(2, '0')}`);
  }

  async build(params: ReportParams): Promise<ReportDoc> {
    const compareKind: CompareKind = params.options?.compare === 'prev' ? 'prev' : 'yoy';
    const view: View = params.options?.view === 'full' ? 'full' : 'short';
    const range = await this.resolveRange(params);
    // O'tgan teng davr: davr to'liq oylardan iborat bo'lsa — shuncha oy oldin (kunlar emas), aks holda — teng kunlar
    const prev = GeneralSources.wholeMonths(range) ? previousMonths(range) : previousRange(range);
    const yoy = yearAgoRange(range);
    const months = monthsOf(range);
    const trendMonths = (() => {
      const end = range.to.slice(0, 7);
      const out: string[] = [];
      let y = Number(end.slice(0, 4));
      let m = Number(end.slice(5, 7));
      for (let i = 0; i < 12; i += 1) {
        out.unshift(`${y}-${String(m).padStart(2, '0')}`);
        m -= 1;
        if (m === 0) {
          m = 12;
          y -= 1;
        }
      }
      return out;
    })();
    const trend: Range = { from: `${trendMonths[0]}-01`, to: range.to };
    const trendYoY = yearAgoRange(trend);
    const asOf = GeneralSources.asOfMonth(range);

    const [labels, rowsAll, headcount, regionsList, closed] = await Promise.all([
      this.data.labels(),
      this.data.rows([range, prev, yoy, trend, trendYoY]),
      this.data.averageHeadcountByUnit(range),
      this.sources.activeRegions(),
      this.sources.closedMonths(),
    ]);
    const pick = (r: Range) => {
      const f = ReportData.inRange(r);
      return { incomes: rowsAll.incomes.filter(f), expenses: rowsAll.expenses.filter(f) };
    };
    const cur = pick(range);
    const P = pick(prev);
    const Y = pick(yoy);
    const T = totals(cur.incomes, cur.expenses);
    const cmpPrev = compare('prev', T, totals(P.incomes, P.expenses));
    const cmpYoy = compare('yoy', T, totals(Y.incomes, Y.expenses));
    const cmp = compareKind === 'yoy' ? cmpYoy : cmpPrev;
    const base = compareKind === 'yoy' ? Y : P;

    // ─────────── Qo'shimcha manbalar (parallel, bir-biriga bog'liq emas) ───────────
    const [companyPlan, regionPlans, fcIncome, fcResult, riskRes, reactionsRes, controlsRes, alertsRes] = await Promise.all([
      this.sources.companyPlan(range),
      this.sources.regionPlans(range, regionsList.map((r) => r.code)),
      this.sources.forecast('income', asOf),
      this.sources.forecast('result', asOf),
      this.sources.risk(asOf),
      this.sources.reactionsAt(range),
      this.sources.controlsAt(range),
      this.sources.alertsAt(range),
    ]);

    // ─────────── Hududlar va Markaz ───────────
    const unitNames = labels.units;
    const units = unitStats(cur.incomes, cur.expenses, unitNames, headcount, months, regionsList.map((r) => r.key));
    const regions = units.filter((u) => u.kind === 'region');
    const center = units.find((u) => u.kind === 'center') ?? null;
    const unassigned = units.find((u) => u.kind === 'none' && (u.income !== 0n || u.expense !== 0n)) ?? null;
    // Yo'nalishlar (Tax free, Marksheyder …) — reytingga kirmaydi, Markaz jadvalida alohida qator
    const segmentUnits = units.filter((u) => u.kind === 'segment' && (u.income !== 0n || u.expense !== 0n));
    const withData = regions.filter((u) => u.income !== 0n || u.expense !== 0n);
    const rankResult = ranks(withData, (u) => u.key, (u) => u.result);
    const rankMargin = ranks(withData, (u) => u.key, (u) => u.margin);
    const rankPerEmp = ranks(withData, (u) => u.key, (u) => u.perEmployee);
    const coverage = centerCoverage(units);

    // Hududlar oylik rejasi: fakt — Daromadlar bo'limidagi shu hududning xizmat (SRV_*) tushumi
    const regionPF = new Map<string, { pf: PlanFact; versions: string; status: DataStatus }>();
    if (regionPlans.value) {
      for (const rp of regionPlans.value) {
        const key = `r:${rp.regionCode}`;
        const fact = cur.incomes.filter((r) => r.unit === key && /^SRV_\d{2,3}$/.test(r.categoryCode)).reduce((s, r) => s + r.tiyin, 0n);
        const versions = rp.versions.map((v) => `${v.period}: ${v.version === null ? "yo'q" : `v${v.version}`}`).join(', ');
        const pf = rp.status === 'full' ? planFact(fact, rp.plan) : planFact(fact, null, rp.status === 'partial' ? "Davrning hamma oylari uchun tasdiqlangan reja yo'q" : "Tasdiqlangan reja yo'q");
        regionPF.set(key, { pf, versions, status: rp.status });
      }
    }
    const planned = regions.filter((u) => regionPF.get(u.key)?.pf.execution !== undefined && regionPF.get(u.key)?.pf.execution !== null);
    const rankPlan = ranks(planned, (u) => u.key, (u) => regionPF.get(u.key)!.pf.execution);

    // ─────────── Reja–fakt (butun korxona) ───────────
    const cp = companyPlan.value;
    const revPF = cp ? planFact(cp.revenueFact, cp.revenuePlan) : null;
    const costPF = cp ? planFact(cp.costFact, cp.costPlan) : null;
    const profitPF = cp ? planFact(cp.profitFact, cp.profitPlan) : null;

    // ─────────── Sabablar ───────────
    const incomeName = (code: string) => labels.incomeCategory.get(code) ?? code;
    const expenseName = (code: string) => labels.expenseCategory.get(code)?.label ?? code;
    const hasBase = cmp.base !== null;
    const drv = drivers(cur, base, { income: incomeName, expense: expenseName });
    const growing = drv.all.filter((d) => d.kind === 'expense' && d.delta > 0n).sort((a, b) => (b.delta > a.delta ? 1 : -1))[0] ?? null;

    // ─────────── Ma'lumot holati ───────────
    const comp = completeness(months, closed, regionsList, cur.incomes, todayIso(), range.to);
    const baseComp = completeness(monthsOf(compareKind === 'yoy' ? yoy : prev), closed, regionsList, base.incomes, todayIso(), (compareKind === 'yoy' ? yoy : prev).to);
    const dups = duplicateGroups([...cur.incomes, ...cur.expenses]);

    // ─────────── Prognoz ───────────
    const ye = fcResult.value?.yearEnd ?? null;
    const resultWape = fcResult.value?.accuracy.wape ?? null;
    const incomeWape = fcIncome.value?.accuracy.wape ?? null;
    const totalRisk = riskRes.value?.units.find((u) => u.kind === 'total') ?? null;
    const lossProb = totalRisk ? totalRisk.lossProbability : null;

    // ─────────── Munosabat va Nazorat ───────────
    const reactions = reactionsRes.value ?? [];
    const openReactions = reactions.filter((r) => r.open);
    const overdue = openReactions.filter((r) => r.overdue);
    const ctrls = controlsRes.value ?? [];
    const breached = ctrls.filter((c) => c.status === 'breach');
    const responsible = (target: { unit?: string; category?: string }) => {
      const r = openReactions.find((x) => (target.unit && x.units.includes(target.unit)) || (target.category && x.categories.includes(target.category)));
      return r ? { owner: r.owner ?? "Mas'ul tayinlanishi kerak", due: r.due } : null;
    };

    // ─────────── Xavflar ───────────
    const riskList: Risk[] = buildRisks({
      current: T,
      comparison: cmp,
      plan: revPF && cp ? { revenue: revPF, source: companyPlan.note } : null,
      regionPlans: regions.filter((u) => regionPF.get(u.key)?.pf.execution != null).map((u) => ({ name: u.name, pf: regionPF.get(u.key)!.pf })),
      lossRegions: withData.filter((u) => u.result < 0n).sort((a, b) => (a.result < b.result ? -1 : 1)).map((u) => ({ key: u.key, name: u.name, result: u.result })),
      lossProbability: lossProb,
      forecastWape: resultWape,
      breachedControls: breached.map((c) => ({ label: c.label, owner: c.owner })),
      overdueReactions: overdue.map((r) => ({ title: r.title, owner: r.owner, due: r.due })),
      growingExpense: growing,
      completeness: comp,
      alerts: alertsRes.value ?? [],
      duplicates: dups,
      responsible,
    });
    const highRisks = riskList.filter((r) => r.priority === 1).length;
    const topRisks = riskList.slice(0, GENERAL_THRESHOLDS.maxRecommendations);

    // ─────────── Xulosalar ───────────
    const sortedRes = [...withData].sort((a, b) => (b.result > a.result ? 1 : b.result < a.result ? -1 : 0));
    const highlights = summaries({
      current: T,
      comparison: cmp,
      plan: revPF,
      planSource: cp ? companyPlan.note : null,
      best: sortedRes[0] ?? null,
      worst: sortedRes[sortedRes.length - 1] ?? null,
      yearEnd: ye ? { total: BigInt(ye.totalTiyin), wape: resultWape } : null,
      highRisks,
      incompleteRegions: comp.waiting.length,
    });

    const sections: ReportSection[] = [];
    const partialNote = comp.status === 'full' ? '' : " · ma'lumot qisman";

    // ═════════ 1. Rahbariyat xulosasi ═════════
    const kFact: KpiItem[] = [
      { label: 'Daromad', value: som(T.income), sub: `${cmp.incomeChange === null ? `${cmp.label}: hisoblanmaydi` : `${signed(cmp.incomeChange)} — ${cmp.label}`}${partialNote}`, tone: upTone(cmp.incomeChange) },
      { label: 'Xarajat', value: som(T.expense), sub: `${cmp.expenseChange === null ? `${cmp.label}: hisoblanmaydi` : `${signed(cmp.expenseChange)} — ${cmp.label}`}${partialNote}`, tone: upTone(cmp.expenseChange, true) },
      { label: T.result >= 0n ? 'Foyda' : 'Zarar', value: som(T.result), sub: cmp.resultDelta === null ? `${cmp.label}: ma'lumot yo'q` : `${signedSom(cmp.resultDelta)} — ${cmp.label}`, tone: T.result >= 0n ? 'good' : 'bad' },
      { label: 'Rentabellik', value: T.margin === null ? 'Hisoblanmaydi' : fmtPct(T.margin), sub: T.margin === null ? 'Daromad nol' : cmp.base?.margin != null ? `${cmp.label}: ${fmtPct(cmp.base.margin)}` : 'natija ÷ daromad', tone: T.margin !== null && T.margin < 0 ? 'bad' : 'neutral' },
    ];
    const kPlan: KpiItem[] = [
      revPF && revPF.execution !== null
        ? { label: 'Daromad rejasi bajarilishi', value: fmtPct(revPF.execution), sub: `fakt ${som(revPF.fact)} / reja ${som(revPF.plan!)}`, tone: revPF.execution >= 100 ? 'good' : revPF.execution < GENERAL_THRESHOLDS.planExecutionWarnPct ? 'bad' : 'warn' }
        : { label: 'Daromad rejasi bajarilishi', value: STATUS_LABEL[revPF?.status ?? companyPlan.status], sub: revPF?.note || companyPlan.note, tone: 'neutral' },
      costPF && costPF.gap !== null && costPF.plan !== null
        ? { label: "Xarajat rejasidan og'ish", value: signedSom(costPF.gap), sub: `fakt ${som(costPF.fact)} / reja ${som(costPF.plan)}`, tone: costPF.gap > 0n ? 'bad' : 'good' }
        : { label: "Xarajat rejasidan og'ish", value: STATUS_LABEL[costPF?.status ?? companyPlan.status], sub: costPF?.note || companyPlan.note, tone: 'neutral' },
    ];
    const kForecast: KpiItem[] = [
      ye
        ? { label: `${ye.year}-yil yakuni (prognoz)`, value: som(BigInt(ye.totalTiyin)), sub: `haqiqiy ${som(BigInt(ye.actualTiyin))} + prognoz ${som(BigInt(ye.forecastTiyin))}`, tone: BigInt(ye.totalTiyin) >= 0n ? 'neutral' : 'warn' }
        : { label: 'Yil yakuni (prognoz)', value: STATUS_LABEL[fcResult.status], sub: fcResult.note, tone: 'neutral' },
      resultWape !== null
        ? { label: "Modelning o'rtacha xatosi", value: fmtPct(resultWape), sub: `WAPE, ${fcResult.value!.accuracy.points} oy sinov; daromadga nisbatan`, tone: resultWape > GENERAL_THRESHOLDS.forecastErrorPct ? 'warn' : 'neutral' }
        : { label: "Modelning o'rtacha xatosi", value: fcResult.value ? 'Hisoblanmaydi' : STATUS_LABEL[fcResult.status], sub: fcResult.value ? 'Sinov uchun tarix yetarli emas' : fcResult.note, tone: 'neutral' },
      lossProb !== null
        ? { label: '3 oylik zarar xavfi', value: fmtPct(lossProb * 100, 0), sub: 'model ehtimoli, haqiqiy natija emas', tone: lossProb * 100 >= GENERAL_THRESHOLDS.lossProbabilityHighPct ? 'bad' : 'neutral' }
        : { label: '3 oylik zarar xavfi', value: STATUS_LABEL[riskRes.status === 'full' ? 'na' : riskRes.status], sub: riskRes.note || "Model natijasi yo'q", tone: 'neutral' },
      { label: 'Yuqori ustuvor xavflar', value: String(highRisks), sub: `jami ${riskList.length} ta xavf`, tone: highRisks ? 'bad' : 'good' },
    ];
    const kpiTable: Cell[][] = [
      ...kFact.map((k) => [k.label, k.value, k.sub ?? '', comp.status === 'full' ? STATUS_LABEL.full : STATUS_LABEL.partial, 'Daromadlar va Xarajatlar bo‘limlari']),
      ...kPlan.map((k) => [k.label, k.value, k.sub ?? '', STATUS_LABEL[companyPlan.status], 'Hisobotlar › Choraklik ijro (biznes-reja)']),
      [kForecast[0]!.label, kForecast[0]!.value, kForecast[0]!.sub ?? '', STATUS_LABEL[fcResult.status], 'Katta modellar › Prognoz (natija)'],
      [kForecast[1]!.label, kForecast[1]!.value, kForecast[1]!.sub ?? '', STATUS_LABEL[fcResult.status], 'Katta modellar › Prognoz (tarixiy sinov)'],
      [kForecast[2]!.label, kForecast[2]!.value, kForecast[2]!.sub ?? '', STATUS_LABEL[riskRes.status], 'Katta modellar › Risk'],
      [kForecast[3]!.label, kForecast[3]!.value, kForecast[3]!.sub ?? '', STATUS_LABEL.full, 'Shu hisobot: xavf qoidalari'],
    ];
    sections.push({
      title: 'Rahbariyat xulosasi',
      sheet: 'KPI_va_formulalar',
      intro: `${rangeText(range)}; taqqoslash — ${cmp.label}${cmp.base ? '' : " (bu davrda ma'lumot yo'q)"}. Fakt, reja va prognoz alohida guruhlarda.`,
      blocks: [
        { type: 'kpis', title: 'Fakt', items: kFact },
        { type: 'kpis', title: 'Reja', items: kPlan },
        { type: 'kpis', title: 'Prognoz va xavf', items: kForecast },
        trendChart(trendMonths, rowsAll, trend, PRINT),
        {
          type: 'table',
          title: "Ko'rsatkichlar: qiymat, holat va manba",
          formats: XLSX,
          columns: [{ label: "Ko'rsatkich", width: 1.6 }, { label: 'Qiymat' }, { label: 'Izoh / taqqoslash', width: 2 }, { label: "Ma'lumot holati" }, { label: 'Manba', width: 1.6 }],
          rows: kpiTable,
        },
      ],
    });

    // ═════════ 2. Reja va moliyaviy dinamika ═════════
    const cmpRow = (name: string, cur0: bigint, a: Totals | null, b: Totals | null, pick0: (t: Totals) => bigint, pct: boolean): Cell[] => {
      const av = a ? pick0(a) : null;
      const bv = b ? pick0(b) : null;
      const ch = (base0: bigint | null) => (pct ? pctOrDash(changePct(cur0, base0)) : null);
      return [name, toSom(cur0), somCell(av), av === null ? null : toSom(cur0 - av), ch(av), somCell(bv), bv === null ? null : toSom(cur0 - bv), ch(bv)];
    };
    const planBlocks: Block[] = [];
    if (cp && revPF && costPF && profitPF) {
      const pfRow = (name: string, pf: PlanFact): Cell[] => [name, somCell(pf.plan), toSom(pf.fact), somCell(pf.gap), pctOrDash(pf.execution)];
      planBlocks.push({
        type: 'table',
        title: `Reja–fakt: ${cp.label}`,
        columns: [{ label: "Ko'rsatkich", width: 1.4 }, { label: 'Reja', format: 'money' }, { label: 'Fakt', format: 'money' }, { label: 'Farq (fakt − reja)', format: 'money', toneBy: 'row' }, { label: 'Bajarilish, %', format: 'pct' }],
        rows: [pfRow('Daromad', revPF), pfRow('Xarajat', costPF), pfRow('Sof foyda', profitPF)],
        rowTone: ['up', 'down', 'up'],
        note: `Manba: ${companyPlan.note}. Fakt biznes-reja belgilashi bo'yicha (Choraklik ijro bilan bir xil); hisobotdagi daromad bilan farqi: ${som(cp.revenueFact - T.income)}.`,
      });
      planBlocks.push({
        type: 'chart',
        title: 'Reja va fakt',
        kind: 'bar',
        unit: "mln so'm",
        labels: ['Daromad', 'Xarajat', 'Sof foyda'],
        series: [
          { name: 'Reja', values: [revPF, costPF, profitPF].map((p) => mln(toSom(p.plan ?? 0n))), color: PALETTE.slate },
          { name: 'Fakt', values: [revPF, costPF, profitPF].map((p) => mln(toSom(p.fact))), color: PALETTE.navy },
        ],
        formats: view === 'full' ? PRINT : ['pptx'],
      });
    } else {
      planBlocks.push({ type: 'notes', title: 'Reja–fakt (butun korxona)', items: [`${STATUS_LABEL[companyPlan.status]}: ${companyPlan.note}.`] });
    }
    const regionPlanRows = regions
      .filter((u) => regionPF.has(u.key))
      .map((u) => {
        const x = regionPF.get(u.key)!;
        return [u.name, somCell(x.pf.plan), toSom(x.pf.fact), somCell(x.pf.gap), pctOrDash(x.pf.execution), rankText(rankPlan.get(u.key)), x.versions, x.pf.execution !== null ? STATUS_LABEL.full : x.pf.note] as Cell[];
      });
    if (regionPlanRows.length) {
      planBlocks.push({
        type: 'table',
        title: 'Hududlar oylik rejasi (Hudud uchun reja, tasdiqlangan versiyalar)',
        formats: view === 'full' ? undefined : XLSX,
        columns: [{ label: 'Hudud', width: 1.4 }, { label: 'Reja', format: 'money' }, { label: 'Fakt (xizmatlar)', format: 'money' }, { label: 'Farq', format: 'money', toneBy: 'up' }, { label: 'Bajarilish, %', format: 'pct' }, { label: "O'rin" }, { label: 'Versiyalar', width: 1.6 }, { label: 'Holat', width: 1.4 }],
        rows: regionPlanRows,
        note: "Bajarilish foizi faqat davrning hamma oylari uchun tasdiqlangan reja bo'lgan hududlarda; fakt — Daromadlar bo'limidagi hudud xizmatlari (SRV_*) tushumi.",
      });
    } else if (regionPlans.status !== 'full') {
      planBlocks.push({ type: 'notes', items: [`Hududlar rejasi: ${STATUS_LABEL[regionPlans.status]} — ${regionPlans.note}.`], formats: XLSX });
    }
    sections.push({
      title: 'Reja va moliyaviy dinamika',
      sheet: 'Reja_fakt',
      intro: `Joriy davr ${rangeText(range)}; o'tgan teng davr ${rangeText(prev)}; o'tgan yilning shu davri ${rangeText(yoy)}. Baza nol yoki ma'lumot yo'q bo'lsa — foiz chiqarilmaydi.`,
      blocks: [
        {
          type: 'table',
          title: 'Davrlar taqqoslash',
          columns: [
            { label: "Ko'rsatkich", width: 1.2 },
            { label: 'Joriy davr', format: 'money' },
            { label: "O'tgan teng davr", format: 'money' },
            { label: 'Farq', format: 'money', toneBy: 'row' },
            { label: '%', format: 'signedPct', toneBy: 'row' },
            { label: "O'tgan yil shu davri", format: 'money' },
            { label: 'Farq', format: 'money', toneBy: 'row' },
            { label: '%', format: 'signedPct', toneBy: 'row' },
          ],
          rows: [
            cmpRow('Daromad', T.income, cmpPrev.base, cmpYoy.base, (t) => t.income, true),
            cmpRow('Xarajat', T.expense, cmpPrev.base, cmpYoy.base, (t) => t.expense, true),
            cmpRow('Moliyaviy natija', T.result, cmpPrev.base, cmpYoy.base, (t) => t.result, true),
          ],
          rowTone: ['up', 'down', 'up'],
          note: `Rentabellik: joriy ${fmtPct(T.margin)}; o'tgan teng davr ${fmtPct(cmpPrev.base?.margin ?? null)}; o'tgan yil ${fmtPct(cmpYoy.base?.margin ?? null)}. Natija foizi faqat baza musbat bo'lganda.`,
        },
        ...planBlocks,
      ],
    });

    // ═════════ 3. Dinamika (Excel) ═════════
    const incM = sumByMonth(rowsAll.incomes, trend);
    const expM = sumByMonth(rowsAll.expenses, trend);
    const incY = sumByMonth(rowsAll.incomes, trendYoY);
    const expY = sumByMonth(rowsAll.expenses, trendYoY);
    sections.push({
      title: 'Moliyaviy dinamika',
      sheet: 'Dinamikalar',
      formats: XLSX,
      intro: `Oxirgi 12 oy (${periodShort(trendMonths[0]!)} – ${periodShort(trendMonths[11]!)}) va o'tgan yilning shu oylari.`,
      blocks: [
        {
          type: 'table',
          columns: [{ label: 'Oy' }, { label: 'Daromad', format: 'money' }, { label: 'Xarajat', format: 'money' }, { label: 'Natija', format: 'money', toneBy: 'up' }, { label: 'Rentabellik, %', format: 'pct' }, { label: "O'tgan yil: daromad", format: 'money' }, { label: "O'tgan yil: natija", format: 'money', toneBy: 'up' }],
          rows: trendMonths.map((m) => {
            const ly = `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
            const i = incM.get(m) ?? 0n;
            const e = expM.get(m) ?? 0n;
            const li = incY.get(ly);
            const le = expY.get(ly);
            return [periodLabel(m), toSom(i), toSom(e), toSom(i - e), i > 0n ? pctOrDash(pctOf(i - e, i)) : null, li === undefined ? null : toSom(li), li === undefined && le === undefined ? null : toSom((li ?? 0n) - (le ?? 0n))];
          }),
        },
      ],
    });

    // ═════════ 4. Natija o'zgarishining sabablari ═════════
    if (hasBase) {
      const dRow = (d: Driver): Cell[] => [d.name, d.kind === 'income' ? 'Daromad' : 'Xarajat', toSom(d.current), toSom(d.base), toSom(d.delta), toSom(d.effect), d.effect > 0n ? 'Ijobiy' : d.effect < 0n ? 'Salbiy' : '—'];
      const cols = [
        { label: 'Modda', width: 2.2 },
        { label: 'Turi', width: 0.8 },
        { label: 'Joriy', format: 'money' as const },
        { label: 'Taqqoslash', format: 'money' as const },
        { label: "Mutlaq o'zgarish", format: 'money' as const },
        { label: "Natijaga ta'siri", format: 'money' as const, toneBy: 'up' as const },
        { label: "Yo'nalish", width: 0.8, tones: { Ijobiy: 'good', Salbiy: 'bad' } as Record<string, Tone> },
      ];
      sections.push({
        title: "Natija o'zgarishining sabablari",
        sheet: 'Ozgarish_sabablari',
        intro: `${cmp.label}ga nisbatan. Daromad — xizmat turi, xarajat — xarajat moddasi darajasida. Ta'sir: daromad = joriy − taqqoslash; xarajat = −(joriy − taqqoslash). Barcha moddalar ta'siri yig'indisi = natija o'zgarishi.`,
        blocks: [
          {
            type: 'table',
            columns: cols,
            rows: [...drv.top.map(dRow), ...(drv.rest ? [[`Qolgan moddalar (${drv.rest.count} ta)`, '—', null, null, null, toSom(drv.rest.effect), drv.rest.effect > 0n ? 'Ijobiy' : drv.rest.effect < 0n ? 'Salbiy' : '—'] as Cell[]] : [])],
            total: ['Natija o‘zgarishi (barcha moddalar)', null, toSom(T.result), toSom(cmp.base!.result), toSom(T.result - cmp.base!.result), toSom(drv.totalEffect), null],
            formats: undefined,
          },
          {
            type: 'table',
            title: "Barcha moddalar (to'liq ro'yxat)",
            formats: XLSX,
            columns: cols,
            rows: drv.all.map(dRow),
            total: ['Jami', null, null, null, null, toSom(drv.totalEffect), null],
          },
        ],
      });
    } else {
      sections.push({ title: "Natija o'zgarishining sabablari", sheet: 'Ozgarish_sabablari', blocks: [{ type: 'notes', items: [`Hisoblanmaydi: ${cmp.label} uchun daromad va xarajat ma'lumoti yo'q.`] }] });
    }

    // ═════════ 5. Hududlar va Markaz ═════════
    const regionRow = (u: UnitStat): Cell[] => [
      `${u.name}${u.monthsWithData < u.months ? ' *' : ''}`,
      toSom(u.income),
      toSom(u.expense),
      toSom(u.result),
      rankText(rankResult.get(u.key)),
      pctOrDash(u.margin),
      rankText(rankMargin.get(u.key)),
      u.perEmployee === null ? null : toSom(u.perEmployee),
      rankText(rankPerEmp.get(u.key)),
    ];
    const regCols = [
      { label: 'Hudud', width: 1.7 },
      { label: 'Daromad', format: 'money' as const },
      { label: 'Xarajat', format: 'money' as const },
      { label: 'Natija', format: 'money' as const, toneBy: 'up' as const },
      { label: "O'rin", width: 0.55 },
      { label: 'Rentabellik, %', format: 'pct' as const },
      { label: "O'rin", width: 0.55 },
      { label: '1 xodimga natija', format: 'money' as const, toneBy: 'up' as const },
      { label: "O'rin", width: 0.55 },
    ];
    const noData = regions.filter((u) => u.income === 0n && u.expense === 0n);
    const regionBlocks: Block[] = [
      {
        type: 'table',
        title: 'Hududlar: natija va samaradorlik (uch mustaqil reyting)',
        columns: regCols,
        rows: sortedRes.map(regionRow),
        total: ['Hududlar jami', toSom(withData.reduce((s, u) => s + u.income, 0n)), toSom(withData.reduce((s, u) => s + u.expense, 0n)), toSom(coverage.regionsResult), null, null, null, null, null],
        note: [
          "Reyting — mutlaq natija, rentabellik va bir xodimga natija bo'yicha alohida; yagona umumiy ball yo'q.",
          sortedRes.some((u) => u.monthsWithData < u.months) ? "* — davrning ayrim oylarida daromad yozuvi yo'q (ma'lumot qisman)." : '',
          noData.length ? `Ma'lumoti yo'q hududlar (reytingda emas): ${noData.map((u) => u.name).join(', ')}.` : '',
          "Bir xodimga natija = natija ÷ davrdagi o'rtacha faol xodimlar soni (xodim 0 — hisoblanmaydi).",
        ].filter(Boolean).join(' '),
      },
      {
        type: 'table',
        title: "Markaz va yo'nalishlar (reytingga kirmaydi)",
        columns: [{ label: "Ko'rsatkich", width: 2.2 }, { label: 'Qiymat', format: 'money' }],
        rows: [
          ['Markaz xarajati (siyosat bo‘yicha Markazga tegishli moddalar)', toSom(coverage.centerExpense)],
          ["Markazning o'z daromadi", toSom(coverage.centerIncome)],
          ['Markaz sof xarajati (xarajat − daromad)', toSom(coverage.centerNet)],
          ['Hududlarning jami natijasi', toSom(coverage.regionsResult)],
          ...segmentUnits.map((u) => [`${u.name} natijasi (yo'nalish)`, toSom(u.result)] as Cell[]),
          ...(unassigned ? [['Hududga biriktirilmagan yozuvlar natijasi', toSom(unassigned.result)] as Cell[]] : []),
        ],
        note: `Markazni qoplash: ${coverage.coverageNet === null ? 'hisoblanmaydi (Markaz sof xarajati ≤ 0)' : fmtPct(coverage.coverageNet)} = hududlar natijasi ÷ Markaz sof xarajati × 100 (Solishtirma bilan bir xil). Yalpi xarajatga nisbatan: ${coverage.coverageGross === null ? 'hisoblanmaydi' : fmtPct(coverage.coverageGross)}. Markaz xarajati hududlarga taqsimlanmaydi.`,
      },
    ];
    if (sortedRes.length) {
      regionBlocks.push({
        type: 'chart',
        title: 'Hududlar natijasi (rentabellik qavsda)',
        kind: 'barh',
        unit: "mln so'm",
        labels: sortedRes.map((u) => `${u.name} (${u.margin === null ? '—' : fmtPct(u.margin)})`),
        series: [{ name: 'Natija', values: sortedRes.map((u) => mln(toSom(u.result))), color: PALETTE.navy }],
        formats: PRINT,
      });
    }
    sections.push({ title: 'Hududlar va Markaz', sheet: 'Hududlar', intro: 'Hudud natijasi = hudud daromadi − hudud xarajati (Markaz moddalari — xarajat siyosati bo‘yicha Markazda).', blocks: regionBlocks });

    // ═════════ 6. Xavflar va tavsiyalar ═════════
    const riskCols = [
      { label: 'Ustuvorlik', width: 0.7, tones: { Yuqori: 'bad', "O'rta": 'warn' } as Record<string, Tone> },
      { label: 'Xavf', width: 1.3 },
      { label: 'Dalil', width: 2 },
      { label: 'Tavsiya', width: 2 },
      { label: "Mas'ul / muddat", width: 1.3 },
      { label: 'Tekshirish ko‘rsatkichi', width: 1.1 },
    ];
    const riskRow = (r: Risk): Cell[] => [PRIORITY_LABEL[r.priority], r.title, r.evidence, r.recommendation, `${r.owner}; ${r.due}`, r.check];
    sections.push({
      title: 'Xavflar va tavsiyalar',
      sheet: 'Xavflar_tavsiyalar',
      intro: `Ko'pi bilan ${GENERAL_THRESHOLDS.maxRecommendations} ta, ustuvorlik bo'yicha. Bir xil sababdagilar birlashtirilgan. Mas'ul va muddat — mavjud Munosabatdan; yangi topshiriq avtomatik yaratilmaydi.`,
      blocks: topRisks.length
        ? [
            { type: 'table', columns: riskCols, rows: topRisks.map(riskRow), formats: view === 'full' ? undefined : PRINT },
            { type: 'table', title: "Barcha xavflar (shart bilan)", formats: XLSX, columns: [...riskCols, { label: 'Shart', width: 1.6 }, { label: 'Hudud / modda', width: 1.3 }], rows: riskList.map((r) => [...riskRow(r), r.condition, r.target]) },
          ]
        : [{ type: 'notes', items: ['Belgilangan chegaralar bo‘yicha xavf aniqlanmadi.'] }],
    });

    // ═════════ 7. Ma'lumot sifati va prognoz ishonchliligi ═════════
    const statusRows: Cell[][] = [
      ['Daromad va xarajat (fakt)', STATUS_LABEL[comp.status], comp.status === 'full' ? "Barcha oylar yopilgan, hamma hududlar hisobot bergan" : [comp.openMonths.length ? `yopilmagan oylar: ${comp.openMonths.join(', ')}` : '', comp.waiting.length ? `kutilayotgan hududlar: ${comp.waiting.length}` : '', comp.partialCurrent ? `joriy oy tugamagan: ${comp.partialCurrent.days}/${comp.partialCurrent.ofDays} kun` : ''].filter(Boolean).join('; ')],
      [`Taqqoslash bazasi (${COMPARE_LABEL[compareKind]})`, cmp.base ? STATUS_LABEL[baseComp.status] : STATUS_LABEL.nosource, cmp.base ? (baseComp.status !== comp.status ? "Taqqoslash davri ma'lumot qamrovi joriy davrdan farq qiladi — o'zgarish foizlarini ehtiyotkorlik bilan talqin qiling" : '') : "Bu davrda yozuv yo'q"],
      ['Biznes-reja (butun korxona)', STATUS_LABEL[companyPlan.status], companyPlan.note],
      ['Hududlar oylik rejasi', STATUS_LABEL[regionPlans.status], regionPlans.note || `${regionPlanRows.filter((r) => r[4] !== null).length} ta hududda to'liq reja`],
      ['Yil yakuni prognozi', STATUS_LABEL[fcResult.status], fcResult.value ? `${fcResult.value.model.name}; ${fcResult.value.reliabilityText}` : fcResult.note],
      ['Zarar xavfi modeli', STATUS_LABEL[riskRes.status], riskRes.note],
      ['Munosabatlar', STATUS_LABEL[reactionsRes.status === 'full' ? 'partial' : reactionsRes.status], reactionsRes.value ? `${reactionsRes.note}; ochiq ${openReactions.length}, muddati o'tgan ${overdue.length}` : reactionsRes.note],
      ['Nazorat', STATUS_LABEL[controlsRes.status], controlsRes.value ? `davr oxirgi oyi holatida: buzilgan ${breached.length} / ${ctrls.length}` : controlsRes.note],
      ['Avtomatik ogohlantirishlar', STATUS_LABEL[alertsRes.status], alertsRes.status === 'full' ? `${alertsRes.value!.length} ta` : alertsRes.note || NO_HISTORY],
      ['Takroriy yozuvlar', dups.count ? STATUS_LABEL.partial : STATUS_LABEL.full, dups.count ? `${dups.count} ta ehtimoliy takror (bir kun, summa, modda, birlik): ${som(dups.amount)}` : 'Aniqlanmadi'],
    ];
    const relRows: Cell[][] = [fcIncome, fcResult].map((f, i) => {
      const name = i === 0 ? 'Daromad prognozi' : 'Natija prognozi';
      const a = f.value?.accuracy;
      return [name, f.value ? f.value.model.name : STATUS_LABEL[f.status], a?.wape ?? null, a?.points ?? null, a?.naiveWape ?? null, f.value ? f.value.reliabilityText : f.note];
    });
    sections.push({
      title: "Ma'lumot sifati va prognoz ishonchliligi",
      sheet: 'Malumot_sifati',
      intro: "Null qiymat nolga almashtirilmaydi; qisman ma'lumot bo'lsa — butun korxona bo'yicha to'liq xulosa berilmaydi.",
      blocks: [
        ...(() => {
          const cols = [{ label: 'Blok', width: 1.4 }, { label: 'Holat', width: 0.7, tones: { "To'liq": 'good', Qisman: 'warn', Xato: 'bad' } as Record<string, Tone> }, { label: 'Izoh', width: 3 }];
          if (view === 'full') return [{ type: 'table' as const, columns: cols, rows: statusRows }];
          // Qisqa ko'rinish: PDF/PowerPoint'da faqat to'liq bo'lmagan bloklar; hammasi — Excel'da
          const issues = statusRows.filter((r) => r[1] !== STATUS_LABEL.full);
          const okCount = statusRows.length - issues.length;
          return [
            { type: 'table' as const, columns: cols, rows: issues.length ? issues : [['Barcha bloklar', STATUS_LABEL.full, '']], note: okCount && issues.length ? `Qolgan ${okCount} ta blok — «To'liq» (Excel faylida hammasi).` : undefined, formats: PRINT },
            { type: 'table' as const, columns: cols, rows: statusRows, formats: XLSX },
          ];
        })(),
        ...(comp.waiting.length ? [{ type: 'table' as const, title: 'Kutilayotgan hududlar', columns: [{ label: 'Hudud', width: 1.4 }, { label: "Daromad yozuvi yo'q oylar", width: 2.6 }], rows: comp.waiting.map((w) => [w.name, w.months.map(periodLabel).join(', ')] as Cell[]), formats: view === 'full' ? undefined : XLSX }] : []),
        {
          type: 'notes',
          title: "Asosiy ta'riflar",
          formats: view === 'full' ? [] : ['pdf'],
          items: [
            "Natija = daromad − xarajat; rentabellik = natija ÷ daromad × 100%. Baza nol yoki manfiy bo'lsa — o'zgarish foizi chiqarilmaydi.",
            "Reja bajarilishi = fakt ÷ reja × 100%: biznes-reja — faqat to'liq choraklarda; hududlar rejasi — tasdiqlangan oylik versiyalar.",
            "Markazni qoplash = hududlar natijasi ÷ Markaz sof xarajati × 100%. Prognoz va zarar ehtimoli — model natijasi, haqiqiy natija emas.",
            "Batafsil jadvallar, barcha formulalar va xavf chegaralari — Excel faylida (Metodika varag'i).",
          ],
        },
        {
          type: 'table',
          title: 'Prognoz ishonchliligi (tarixiy sinov)',
          columns: [{ label: 'Prognoz', width: 1.1 }, { label: 'Model', width: 1.4 }, { label: 'Xato (WAPE), %', format: 'pct' }, { label: 'Sinov oylari', format: 'int' }, { label: 'Oddiy usul xatosi, %', format: 'pct' }, { label: 'Ishonchlilik', width: 2 }],
          rows: relRows,
          note: `WAPE = Σ|haqiqiy − prognoz| ÷ Σ|haqiqiy| × 100; natija prognozi xatosi daromad hajmiga nisbatan. ${GENERAL_THRESHOLDS.forecastErrorPct}% dan yuqori — ishonchlilik ogohlantirishi. Prognoz — haqiqiy natija emas.`,
        },
      ],
    });

    // ═════════ 8. Metodika ═════════
    const t = GENERAL_THRESHOLDS;
    sections.push({
      title: 'Metodika va ta’riflar',
      sheet: 'Metodika',
      formats: view === 'full' ? ['xlsx', 'pdf'] : XLSX,
      blocks: [
        {
          type: 'formulas',
          items: [
            { name: 'Daromad (D)', formula: "Davr sanalaridagi Daromadlar bo'limi yozuvlari yig'indisi (o'chirilganlar hisobga olinmaydi). To'langan summa va kunlik tushum alohida tushunchalar — qo'shilmaydi." },
            { name: 'Xarajat (X)', formula: "Davr sanalaridagi Xarajatlar bo'limi yozuvlari yig'indisi; Markaz va hudud — xarajat siyosati bo'yicha, Markaz xarajati hududlarga taqsimlanmaydi." },
            { name: 'Moliyaviy natija (N)', formula: 'N = D − X' },
            { name: 'Rentabellik (R)', formula: 'R = N ÷ D × 100%; D = 0 bo‘lsa hisoblanmaydi' },
            { name: "O'zgarish, %", formula: '(joriy − baza) ÷ baza × 100; baza ≤ 0 yoki ma’lumot yo‘q bo‘lsa — chiqarilmaydi' },
            { name: 'Reja bajarilishi', formula: 'fakt ÷ reja × 100%; reja 0 yoki yo‘q — hisoblanmaydi. Rejadan og‘ish = fakt − reja' },
            { name: 'Biznes-reja', formula: "Choraklik; faqat davr to'liq chorak(lar)ga mos kelganda. Oylik taqsimot to'qilmaydi. Fakt — Choraklik ijro belgilashi bo'yicha" },
            { name: 'Hududlar rejasi', formula: "«Hudud uchun reja»ning har oy uchun amaldagi (tasdiqlangan) versiyasi; davrning hamma oylarida bo'lsagina foiz. Versiyalar jadvalda" },
            { name: "Moddaning natijaga ta'siri", formula: "Daromad: joriy − taqqoslash; xarajat: −(joriy − taqqoslash). Σ ta'sir = N(joriy) − N(taqqoslash)" },
            { name: 'Bir xodimga natija', formula: "Hudud natijasi ÷ davr oylari bo'yicha o'rtacha faol xodimlar soni" },
            { name: 'Markazni qoplash', formula: "Hududlar jami natijasi ÷ Markaz sof xarajati (xarajat − o'z daromadi) × 100. Qo'shimcha: yalpi xarajatga nisbatan" },
            { name: 'Yil yakuni prognozi', formula: "Yil boshidan haqiqiy natija + qolgan oylar prognozi (Katta modellar); davr oxiri holatida hisoblanadi" },
            { name: 'Zarar xavfi', formula: 'Model bo‘yicha keyingi 3 oy jamida zarar ehtimoli; faqat model natijasi bo‘lsa' },
            { name: 'Munosabat va Nazorat', formula: "Munosabat holati — yaratilgan/yopilgan sanalardan davr oxiriga tiklanadi; Nazorat — davr oxirgi oyi holatida. Ogohlantirishlar faqat oxirgi tekshirilgan oy uchun" },
            { name: "Pul aniqligi", formula: "Hisob tiyinda (BigInt); so'm, mln va foizga faqat ko'rsatishda yaxlitlanadi" },
          ],
        },
        {
          type: 'table',
          title: "Xavf chegaralari (dastlabki sozlamalar — tasdiqlangan korxona normativi emas)",
          columns: [{ label: 'Qoida', width: 2 }, { label: 'Chegara', width: 0.8 }, { label: 'Natija', width: 1.2 }],
          rows: [
            ['Reja bajarilishi', `< ${t.planExecutionWarnPct}%`, 'Ogohlantirish'],
            ["Xarajat o'sishi", `> ${t.expenseGrowthPct}%`, 'Tekshiruv'],
            ['Daromad pasayishi', `> ${t.incomeDropPct}%`, 'Tekshiruv'],
            ['Model zarar ehtimoli', `≥ ${t.lossProbabilityHighPct}%`, 'Yuqori xavf'],
            ['Prognoz xatosi (WAPE)', `> ${t.forecastErrorPct}%`, 'Ishonchlilik ogohlantirishi'],
          ],
          note: "Chegaralar apps/api/src/modules/reports/general.config.ts da; rahbariyat tasdig'i kerak.",
        },
      ],
    });

    // ─────────── Muqova ───────────
    const planVersions = [...regionPF.values()].map((x) => x.versions).filter(Boolean);
    const dataVersion = createHash('sha256')
      .update(JSON.stringify([range, T.income.toString(), T.expense.toString(), T.incomeRows, T.expenseRows, cp ? cp.revenuePlan.toString() : null, planVersions]))
      .digest('hex')
      .slice(0, 12);
    const meta = [
      `Davr: ${rangeText(range)} (${months.length} oy); taqqoslash: ${cmp.label}`,
      `Ko'rinish: ${view === 'full' ? "to'liq" : 'qisqa'}; qamrov: butun korxona`,
      `Ma'lumot: ${STATUS_LABEL[comp.status]}${comp.openMonths.length ? `; yopilmagan oylar: ${comp.openMonths.join(', ')}` : ''}${comp.waiting.length ? `; kutilayotgan hududlar: ${comp.waiting.length}` : ''}`,
      `Reja: ${cp ? companyPlan.note : `${STATUS_LABEL[companyPlan.status]} — ${companyPlan.note}`}`,
      `Ma'lumot versiyasi: ${dataVersion} (uch format bir xil versiyadan bo'lsa — raqamlar bir xil)`,
    ];

    return {
      kind: 'Umumiy hisobot',
      title: 'Umumiy hisobot',
      subtitle: `Butun korxona · ${rangeText(range)}`,
      meta,
      highlights,
      sections,
      fileBase: safeFile(`Umumiy hisobot - ${range.from}_${range.to}`),
      generatedAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
      coverSheet: 'Qisqa_hisobot',
      ownMethodology: true,
    };
  }
}

/** Shuncha to'liq oy oldingi davr: 2025-04-01…2025-06-30 → 2025-01-01…2025-03-31 */
export function previousMonths(range: Range): Range {
  const n = monthsOf(range).length;
  const y = Number(range.from.slice(0, 4));
  const m = Number(range.from.slice(5, 7));
  const start = new Date(Date.UTC(y, m - 1 - n, 1));
  const end = new Date(Date.UTC(y, m - 1, 0));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function signed(v: number): string {
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmtPct(Math.abs(v))}`;
}

function signedSom(t: bigint): string {
  return `${t > 0n ? '+' : t < 0n ? '−' : ''}${som(t < 0n ? -t : t)}`;
}

function sumByMonth(rows: Row[], range: Range): Map<string, bigint> {
  const f = ReportData.inRange(range);
  const m = new Map<string, bigint>();
  for (const r of rows) if (f(r)) m.set(r.month, (m.get(r.month) ?? 0n) + r.tiyin);
  return m;
}

function trendChart(months: string[], rows: { incomes: Row[]; expenses: Row[] }, range: Range, formats: ReportFormat[]): Block {
  const inc = sumByMonth(rows.incomes, range);
  const exp = sumByMonth(rows.expenses, range);
  return {
    type: 'chart',
    title: 'Moliyaviy dinamika: daromad, xarajat va natija',
    kind: 'bar',
    unit: "mln so'm",
    labels: months.map(periodShort),
    series: [
      { name: 'Daromad', values: months.map((m) => mln(toSom(inc.get(m) ?? 0n))), color: PALETTE.green },
      { name: 'Xarajat', values: months.map((m) => mln(toSom(exp.get(m) ?? 0n))), color: PALETTE.red },
      { name: 'Natija', values: months.map((m) => mln(toSom((inc.get(m) ?? 0n) - (exp.get(m) ?? 0n)))), color: PALETTE.navy, asLine: true },
    ],
    formats,
  };
}