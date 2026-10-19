import { Injectable } from '@nestjs/common';
import { EfficiencyService } from '../econ/econ.efficiency';
import { FactorsService } from '../econ/econ.factors';
import { ScenarioService } from '../econ/econ.scenario';
import { EconService } from '../econ/econ.service';
import type { FactorsResult, ForecastResult, ModelTable, UnitForecastSummary } from '../econ/econ.types';
import { mln } from './report.common';
import { fmtPct, fmtSom, periodLabel, periodShort, safeFile, signedSom, uzDate } from './reports.format';
import type { Cell, Column, KpiItem, ReportDoc, ReportSection, Tone } from './reports.types';

// ═══════════════════════════════════════════════════════════
// Katta modellar hisoboti: prognoz, hududlar, omillar, samaradorlik (DEA),
// zararsizlik, risk va manba ma'lumot — Katta modellar bo'limi bilan bir xil hisob.
// Natija prognozi = daromad prognozi − xarajat prognozi (hujjat ichida qo'shiluvchan).
// ═══════════════════════════════════════════════════════════

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const RELIABILITY: Record<string, string> = { high: 'Ishonchli', medium: "O'rtacha", low: 'Taxminiy', none: "Ma'lumot kam" };
const SIGNIFICANCE: Record<string, string> = { strong: 'Ishonchli', weak: 'Taxminiy', none: 'Aniqlanmadi' };
const SIGNIFICANCE_TONES: Record<string, Tone> = { Ishonchli: 'good', Taxminiy: 'warn', Aniqlanmadi: 'neutral' };
const METHOD: Record<string, string> = { pooled: 'Umumiy (OLS)', fixed: "Qat'iy ta'sirlar (FE)", random: "Tasodifiy ta'sirlar (RE)", elasticity: 'Elastiklik (log-log FE)' };
const EFF_STATUS: Record<string, string> = { frontier: 'Chegarada', near: 'Yaqin', mid: "O'rtacha", low: 'Past' };
const EFF_TONES: Record<string, Tone> = { Chegarada: 'good', Yaqin: 'good', "O'rtacha": 'warn', Past: 'bad' };
const BE_STATUS: Record<string, string> = { safe: 'Xavfsiz', thin: 'Chegarada', loss: 'Zararda', na: '—' };
const BE_TONES: Record<string, Tone> = { Xavfsiz: 'good', Chegarada: 'warn', Zararda: 'bad' };
const RISK_LEVEL: Record<string, string> = { high: 'Yuqori', medium: "O'rtacha", low: 'Past' };
const RISK_TONES: Record<string, Tone> = { Yuqori: 'bad', "O'rtacha": 'warn', Past: 'good' };

const som = (tiyin: string | number) => Number(tiyin) / 100;
const pct1 = (share: number | null) => (share === null ? null : Math.round(share * 1000) / 10);

/** "2026-01".."2026-08" → "yanvar–avgust" */
function monthSpan(from: string, to: string): string {
  const a = MONTHS[Number(from.slice(5, 7)) - 1]!;
  const b = MONTHS[Number(to.slice(5, 7)) - 1]!;
  return a === b ? a : `${a}–${b}`;
}

function shiftPeriod(period: string, delta: number): string {
  const index = Number(period.slice(0, 4)) * 12 + Number(period.slice(5, 7)) - 1 + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

@Injectable()
export class ModelsReport {
  constructor(
    private readonly econ: EconService,
    private readonly factorsService: FactorsService,
    private readonly efficiencyService: EfficiencyService,
    private readonly scenarios: ScenarioService,
  ) {}

  async build(): Promise<ReportDoc> {
    const [overview, income, expense, result, unitsIncome, unitsExpense, factors, efficiency, breakeven, risk] = await Promise.all([
      this.econ.overview(),
      this.econ.forecast({ target: 'income', unit: 'all', horizon: '6' }),
      this.econ.forecast({ target: 'expense', unit: 'all', horizon: '6' }),
      this.econ.forecast({ target: 'result', unit: 'all', horizon: '6' }),
      this.econ.unitsForecast({ target: 'income', horizon: '3' }),
      this.econ.unitsForecast({ target: 'expense', horizon: '3' }),
      this.factorsService.analyze({}),
      this.efficiencyService.efficiency({ months: '12', mode: 'resources' }),
      this.efficiencyService.breakeven({ months: '12' }),
      this.scenarios.risk({ horizon: '3' }),
    ]);
    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
    const current = overview.currentPeriod;
    const sections: ReportSection[] = [];

    // ─────────── Yil yakuni: haqiqiy + prognoz (daromad, xarajat, natija = D − X) ───────────
    const yi = income.yearEnd;
    const ye = expense.yearEnd;
    const year = yi?.year ?? ye?.year ?? Number(current.slice(0, 4));
    const yr = result.yearEnd;
    const actualSpan = current.slice(5, 7) === '01' ? null : monthSpan(`${year}-01`, shiftPeriod(current, -1));
    const currentName = MONTHS[Number(current.slice(5, 7)) - 1]!;
    const restSpan = current.slice(5, 7) === '12' ? null : monthSpan(shiftPeriod(current, 1), `${year}-12`);
    const yearNet = yi && ye ? som(yi.totalTiyin) - som(ye.totalTiyin) : null;
    // Yil yakuni = haqiqiy (tugagan oylar) + joriy oy (kamida yozilgani) + qolgan oylar prognozi
    const partsText = (y: NonNullable<ForecastResult['yearEnd']>) =>
      [
        ...(actualSpan ? [`haqiqiy (${actualSpan}) ${fmtSom(som(y.actualTiyin))}`] : []),
        `${currentName} ${fmtSom(som(y.currentExpectedTiyin))} (hozircha ${fmtSom(som(y.currentSoFarTiyin))})`,
        ...(restSpan ? [`prognoz (${restSpan}) ${fmtSom(som(y.restTiyin))}`] : []),
      ].join(' + ');

    const totalRisk = risk.units.find((u) => u.kind === 'total');
    const effAvg = efficiency.units.length ? efficiency.units.reduce((s, u) => s + u.crs, 0) / efficiency.units.length : null;
    const beTotal = breakeven.units.find((u) => u.kind === 'total');

    // ─────────── 1. Bir qarashda ───────────
    const kpis: KpiItem[] = [
      { label: `${year}-yil daromadi (taxmin)`, value: yi ? fmtSom(som(yi.totalTiyin)) : '—', sub: yi ? partsText(yi) : income.notes[0] },
      {
        label: `${year}-yil natijasi (taxmin)`,
        value: yearNet === null ? '—' : fmtSom(yearNet),
        sub: yi && ye ? `daromad − xarajat (${fmtSom(som(ye.totalTiyin))})` : undefined,
        tone: yearNet === null ? 'neutral' : yearNet >= 0 ? 'good' : 'bad',
      },
      { label: 'Zarar ehtimoli, 3 oy', value: totalRisk ? fmtPct(totalRisk.lossProbability * 100, 0) : '—', sub: `${periodLabel(risk.periodFrom)} – ${periodLabel(risk.periodTo)}`, tone: totalRisk && totalRisk.lossProbability >= 0.2 ? 'bad' : 'neutral' },
      { label: "O'rtacha samaradorlik", value: effAvg === null ? '—' : fmtPct(effAvg * 100, 0), sub: efficiency.frontier.length ? `chegarada: ${efficiency.frontier.join(', ')}` : undefined },
      {
        label: 'Zararsizlik daromadi (oyiga)',
        value: beTotal?.breakevenTiyin ? fmtSom(som(beTotal.breakevenTiyin)) : '—',
        sub: beTotal?.safetyMargin != null ? `zaxira ${fmtPct(beTotal.safetyMargin * 100, 0)}; o'rtacha daromad ${fmtSom(som(beTotal.avgIncomeTiyin))}` : undefined,
        tone: beTotal?.status === 'loss' ? 'bad' : beTotal?.status === 'thin' ? 'warn' : 'neutral',
      },
      { label: "Ma'lumot", value: `${overview.fullMonths} oy`, sub: `${periodLabel(overview.firstPeriod)} – ${periodLabel(overview.lastFullPeriod)}` },
    ];
    const keyNotes = [income.notes[0], expense.notes[0], unitsIncome.notes[1], efficiency.notes[1], breakeven.notes[1], risk.notes[1]].filter((x): x is string => Boolean(x));
    sections.push({ title: 'Bir qarashda', intro: 'Butun korxona bo\'yicha asosiy natijalar.', blocks: [{ type: 'kpis', items: kpis }, { type: 'notes', title: 'Asosiy xulosalar', items: keyNotes }] });

    // ─────────── 2. Prognoz ───────────
    const hist = income.history.slice(-12);
    const expHist = new Map(expense.history.map((h) => [h.period, som(h.valueTiyin)]));
    const expFc = new Map(expense.forecast.map((f) => [f.period, f]));
    const fc = income.forecast;
    const label = (p: string) => `${periodShort(p)}${p === current ? '*' : ''}`;
    const chartLabels = [...hist.map((h) => label(h.period)), ...fc.map((f) => label(f.period))];
    const zeros = (n: number) => new Array<number>(n).fill(0);
    const forecastBlocks: ReportSection['blocks'] = [];
    if (fc.length) {
      forecastBlocks.push(
        {
          type: 'chart',
          title: 'Daromad: haqiqiy va prognoz',
          kind: 'bar',
          stacked: true,
          unit: "mln so'm",
          labels: chartLabels,
          series: [
            { name: 'Haqiqiy', values: [...hist.map((h) => mln(som(h.valueTiyin))), ...zeros(fc.length)], color: '2F7A57' },
            { name: 'Prognoz', values: [...zeros(hist.length), ...fc.map((f) => mln(som(f.meanTiyin)))], color: '94A3B8' },
          ],
        },
        {
          type: 'chart',
          title: 'Natija (daromad − xarajat): haqiqiy va prognoz',
          kind: 'bar',
          stacked: true,
          unit: "mln so'm",
          labels: chartLabels,
          series: [
            { name: 'Haqiqiy', values: [...hist.map((h) => mln(som(h.valueTiyin) - (expHist.get(h.period) ?? 0))), ...zeros(fc.length)], color: '1B3354' },
            { name: 'Prognoz', values: [...zeros(hist.length), ...fc.map((f) => mln(som(f.meanTiyin) - som(expFc.get(f.period)?.meanTiyin ?? 0)))], color: '94A3B8' },
          ],
        },
      );
    }
    const tableRows: Cell[][] = [
      ...hist.map((h) => {
        const e = expHist.get(h.period) ?? null;
        return [periodLabel(h.period), 'haqiqiy', som(h.valueTiyin), e, e === null ? null : som(h.valueTiyin) - e, null, null] as Cell[];
      }),
      ...fc.map((f) => {
        const e = expFc.get(f.period);
        return [periodLabel(f.period), f.period === current ? 'prognoz (joriy oy)' : 'prognoz', som(f.meanTiyin), e ? som(e.meanTiyin) : null, e ? som(f.meanTiyin) - som(e.meanTiyin) : null, som(f.lo80Tiyin), som(f.hi80Tiyin)] as Cell[];
      }),
    ];
    const soFarInc = fc[0]?.actualSoFarTiyin;
    const soFarExp = expense.forecast[0]?.actualSoFarTiyin;
    forecastBlocks.push({
      type: 'table',
      title: "Oylar bo'yicha (so'm)",
      columns: [
        { label: 'Oy', width: 1.1 },
        { label: 'Turi', width: 1.1 },
        { label: 'Daromad', format: 'money' },
        { label: 'Xarajat', format: 'money' },
        { label: 'Natija', format: 'money', toneBy: 'up' },
        { label: 'Daromad 80%: dan', format: 'money' },
        { label: 'Daromad 80%: gacha', format: 'money' },
      ],
      rows: tableRows,
      note:
        `Natija = daromad − xarajat. 80% oraliq — daromad shu chegaralar ichida bo'lish ehtimoli 80%.` +
        (soFarInc != null ? ` Joriy oy (${periodLabel(current)}) hali tugamagan: hozircha daromad ${fmtSom(som(soFarInc))}${soFarExp != null ? `, xarajat ${fmtSom(som(soFarExp))}` : ''} yozilgan.` : ''),
    });
    if (yi && ye) {
      const prevNet = yi.previousYearTiyin !== null && ye.previousYearTiyin !== null ? som(yi.previousYearTiyin) - som(ye.previousYearTiyin) : null;
      const row = (label: string, y: NonNullable<ForecastResult['yearEnd']>, band: boolean): Cell[] => [
        label,
        som(y.actualTiyin),
        som(y.currentSoFarTiyin),
        som(y.currentExpectedTiyin),
        som(y.restTiyin),
        som(y.totalTiyin),
        band ? som(y.lo80Tiyin) : null,
        band ? som(y.hi80Tiyin) : null,
      ];
      forecastBlocks.push({
        type: 'table',
        title: `${year}-yil yakuni (so'm)`,
        columns: [
          { label: "Ko'rsatkich", width: 1 },
          { label: actualSpan ? `Haqiqiy (${actualSpan})` : 'Haqiqiy', format: 'money' },
          { label: `${currentName}: hozircha yozilgan`, format: 'money' },
          { label: `${currentName}: kutilgan`, format: 'money' },
          { label: restSpan ? `Prognoz (${restSpan})` : 'Prognoz', format: 'money' },
          { label: 'Jami yil', format: 'money' },
          { label: '80%: dan', format: 'money' },
          { label: '80%: gacha', format: 'money' },
        ],
        rows: [row('Daromad', yi, true), row('Xarajat', ye, true), yr ? row('Natija', yr, true) : ['Natija', som(yi.actualTiyin) - som(ye.actualTiyin), null, null, null, yearNet, null, null]],
        note:
          `Jami yil = haqiqiy + ${currentName} (kutilgan) + prognoz. ${currentName[0]!.toUpperCase()}${currentName.slice(1)}: kutilgan = max(hozircha yozilgan, oy prognozi) — yozilgan summa hech qachon tashlanmaydi. ` +
          `Natija = daromad − xarajat (har bir ustunda). ${year - 1}-yil: daromad ${yi.previousYearTiyin === null ? '—' : fmtSom(som(yi.previousYearTiyin))}, xarajat ${ye.previousYearTiyin === null ? '—' : fmtSom(som(ye.previousYearTiyin))}, natija ${prevNet === null ? '—' : fmtSom(prevNet)}.`,
      });
    }
    forecastBlocks.push({
      type: 'table',
      title: 'Model va aniqlik',
      columns: [
        { label: "Ko'rsatkich", width: 1 },
        { label: 'Model', width: 1.6 },
        { label: 'Ishonchlilik', width: 0.9 },
        { label: 'Sinov oylari', format: 'int', width: 0.7 },
        { label: "O'rtacha xato", format: 'pct', width: 0.8 },
        { label: 'Oddiy usul xatosi', format: 'pct', width: 0.8 },
        { label: 'Yutuq', format: 'signedPct', toneBy: 'up', width: 0.8 },
      ],
      rows: [income, expense, result].map((f) => [
        f.targetLabel,
        f.model.name,
        RELIABILITY[f.reliability] ?? f.reliability,
        f.accuracy.points,
        f.accuracy.wape === null ? null : f.accuracy.wape * 100,
        f.accuracy.naiveWape === null ? null : f.accuracy.naiveWape * 100,
        f.accuracy.skill,
      ]),
      note: "Sinov: oxirgi oylarni yashirib, model ularni qanchalik to'g'ri aytganini tekshirish. Oddiy usul — «o'tgan oy takrorlanadi». Yutuq — model oddiy usuldan necha foiz aniqroq.",
    });
    forecastBlocks.push({ type: 'notes', title: 'Izohlar', items: [...income.notes, ...expense.notes.filter((n) => !n.startsWith('Sinov'))] });
    sections.push({
      title: 'Prognoz: butun korxona',
      intro: `Oxirgi ${hist.length} oy va keyingi ${fc.length} oy; * — joriy (tugamagan) oy. Daromad — ${income.model.name}, xarajat — ${expense.model.name}.`,
      blocks: forecastBlocks,
    });

    // ─────────── 3. Hududlar prognozi ───────────
    const expByKey = new Map(unitsExpense.units.map((u) => [u.key, u]));
    const unitRow = (u: UnitForecastSummary): Cell[] => {
      const e = expByKey.get(u.key);
      return [u.name, som(u.recentAvgTiyin), som(u.nextAvgTiyin), u.changePercent, e ? som(e.nextAvgTiyin) : null, e ? som(u.nextAvgTiyin) - som(e.nextAvgTiyin) : null, u.yearEndTiyin === null ? null : som(u.yearEndTiyin), RELIABILITY[u.reliability] ?? u.reliability];
    };
    const unitsList = unitsIncome.units.filter((u) => u.kind !== 'total').sort((a, b) => (b.changePercent ?? -1e9) - (a.changePercent ?? -1e9));
    const totalUnit = unitsIncome.units.find((u) => u.kind === 'total');
    sections.push({
      title: 'Hududlar: keyingi 3 oy',
      intro: `O'rtacha oylik, oxirgi 3 tugagan oyga nisbatan (${periodLabel(unitsIncome.currentPeriod)} dan boshlab).`,
      blocks: [
        {
          type: 'table',
          columns: [
            { label: 'Hudud', width: 1.8 },
            { label: 'Daromad: oxirgi 3 oy', format: 'money' },
            { label: 'Daromad: keyingi 3 oy', format: 'money' },
            { label: "O'zgarish", format: 'signedPct', toneBy: 'up', width: 0.8 },
            { label: 'Xarajat: keyingi 3 oy', format: 'money' },
            { label: 'Natija: keyingi 3 oy', format: 'money', toneBy: 'up' },
            { label: `Daromad ${year}-yil`, format: 'money' },
            { label: 'Ishonch', width: 0.8 },
          ],
          rows: unitsList.map(unitRow),
          ...(totalUnit ? { total: unitRow(totalUnit) } : {}),
          note: 'Natija = daromad prognozi − xarajat prognozi. Har bir hudud o\'z modeli bilan hisoblanadi, shuning uchun hududlar yig\'indisi korxona prognoziga aniq teng bo\'lmasligi mumkin.',
        },
        { type: 'notes', items: unitsIncome.notes },
      ],
    });

    // ─────────── 4. Omillar ───────────
    sections.push(this.factorsSection(factors));

    // ─────────── 5. Samaradorlik ───────────
    const e = efficiency;
    const effBlocks: ReportSection['blocks'] = [];
    if (e.units.length) {
      effBlocks.push(
        {
          type: 'chart',
          title: 'Samaradorlik (100% — eng yaxshilar)',
          kind: 'barh',
          unit: '%',
          labels: e.units.map((u) => `${u.rank}. ${u.name}`),
          series: [{ name: 'Samaradorlik', values: e.units.map((u) => Math.round(u.crs * 1000) / 10) }],
        },
        {
          type: 'table',
          columns: [
            { label: '#', format: 'int', width: 0.35 },
            { label: 'Hudud', width: 1.6 },
            { label: 'Samaradorlik', format: 'pct', width: 0.8 },
            { label: 'Hajm hisobga olingan', format: 'pct', width: 0.8 },
            { label: 'Holat', width: 0.8, tones: EFF_TONES },
            { label: 'Daromad (oy)', format: 'money' },
            { label: 'Xarajat (oy)', format: 'money' },
            { label: 'Xodimlar', format: 'decimal', width: 0.7 },
            { label: 'Imkoniyat (oy)', format: 'money' },
            { label: 'Namuna', width: 1.4 },
          ],
          rows: e.units.map((u) => [
            u.rank,
            u.name,
            Math.round(u.crs * 1000) / 10,
            Math.round(u.vrs * 1000) / 10,
            EFF_STATUS[u.status] ?? u.status,
            som(u.incomeTiyin),
            som(u.expenseTiyin),
            u.headcount,
            som(u.gapTiyin),
            u.peers.map((p) => p.name).join(', ') || "o'zi namuna",
          ]),
          note: 'Imkoniyat — namuna hududlar kabi ishlaganda oyiga qo\'shimcha daromad. Oylik o\'rtacha qiymatlar.',
        },
      );
    }
    effBlocks.push({ type: 'notes', items: [...e.notes, ...e.warnings] });
    sections.push({ title: 'Samaradorlik chegarasi (DEA)', intro: `${e.months} oy · resurslar: ${e.inputs.join(', ').toLowerCase()}; natija: daromad.`, blocks: effBlocks });

    // ─────────── 6. Zararsizlik ───────────
    const be = breakeven;
    sections.push({
      title: 'Zararsizlik nuqtasi',
      intro: `Oxirgi ${be.months} oy: oyiga qancha daromad kerak va hozir qancha zaxira bor.`,
      blocks: [
        {
          type: 'table',
          columns: [
            { label: 'Hudud', width: 1.7 },
            { label: "O'rtacha daromad", format: 'money' },
            { label: "O'rtacha xarajat", format: 'money' },
            { label: 'Doimiy xarajat', format: 'money' },
            { label: "O'zgaruvchan ulush", format: 'pct', width: 0.8 },
            { label: 'Zararsizlik daromadi', format: 'money' },
            { label: 'Zaxira', format: 'signedPct', toneBy: 'up', width: 0.7 },
            { label: 'Holat', width: 0.8, tones: BE_TONES },
          ],
          rows: be.units.map((u) => [
            u.name,
            som(u.avgIncomeTiyin),
            som(u.avgExpenseTiyin),
            u.fixedTiyin === null ? null : som(u.fixedTiyin),
            pct1(u.variableRate),
            u.breakevenTiyin === null ? null : som(u.breakevenTiyin),
            pct1(u.safetyMargin),
            BE_STATUS[u.status] ?? u.status,
          ]),
          note: "Xarajat = doimiy + o'zgaruvchan ulush × daromad (regressiya). Zararsizlik daromadi = doimiy / (1 − o'zgaruvchan ulush). Zaxira = (o'rtacha daromad − zararsizlik) / o'rtacha daromad.",
        },
        { type: 'notes', items: be.notes },
      ],
    });

    // ─────────── 7. Risk ───────────
    const regionsRisk = risk.units.filter((u) => u.kind === 'region');
    const riskBlocks: ReportSection['blocks'] = [];
    if (regionsRisk.length >= 2) {
      riskBlocks.push({
        type: 'chart',
        title: 'Davr jamida zarar ehtimoli',
        kind: 'barh',
        unit: '%',
        labels: regionsRisk.map((u) => u.name),
        series: [{ name: 'Zarar ehtimoli', values: regionsRisk.map((u) => Math.round(u.lossProbability * 1000) / 10), color: 'B3423B' }],
      });
    }
    riskBlocks.push(
      {
        type: 'table',
        columns: [
          { label: 'Hudud', width: 1.7 },
          { label: 'Kutilgan natija', format: 'money', toneBy: 'up' },
          { label: '10% yomon holat', format: 'money' },
          { label: '10% yaxshi holat', format: 'money' },
          { label: 'Zarar ehtimoli', format: 'pct', width: 0.8 },
          { label: 'Kamida 1 oy zarar', format: 'pct', width: 0.8 },
          { label: 'Daromad 10%+ tushishi', format: 'pct', width: 0.8 },
          { label: 'Xavf', width: 0.7, tones: RISK_TONES },
        ],
        rows: risk.units.map((u) => [
          u.name,
          som(u.expectedResultTiyin),
          som(u.p10Tiyin),
          som(u.p90Tiyin),
          pct1(u.lossProbability),
          pct1(u.anyMonthLossProbability),
          pct1(u.incomeDropProbability),
          RISK_LEVEL[u.level] ?? u.level,
        ]),
        note: `${periodLabel(risk.periodFrom)} – ${periodLabel(risk.periodTo)} (${risk.horizon} oy) jamida; daromad va xarajat birga simulyatsiya qilinadi (2000 yo'l).`,
      },
      { type: 'notes', items: risk.notes },
    );
    sections.push({ title: 'Risk: zararga tushish ehtimoli', blocks: riskBlocks });

    // ─────────── 8. Manba ma'lumot ───────────
    const o = overview;
    sections.push({
      title: "Manba ma'lumot",
      intro: `Butun korxona, oylar bo'yicha (hisob davri bo'yicha). ${o.sources.join(' · ')}`,
      blocks: [
        {
          type: 'table',
          columns: [
            { label: 'Oy', width: 1.2 },
            { label: 'Daromad', format: 'money' },
            { label: 'Xarajat', format: 'money' },
            { label: 'shundan ish haqi', format: 'money' },
            { label: 'Natija', format: 'money', toneBy: 'up' },
            { label: 'Xodimlar', format: 'int', width: 0.7 },
          ],
          rows: o.months.map((p, i) => {
            const inc = som(o.total.incomeTiyin[i]!);
            const exp = som(o.total.expenseTiyin[i]!);
            return [`${periodLabel(p)}${p === o.currentPeriod ? ' (joriy)' : ''}`, inc, exp, som(o.total.payrollTiyin[i]!), inc - exp, o.total.headcount[i]!];
          }),
        },
        {
          type: 'table',
          title: 'Modellar tayyorligi',
          columns: [{ label: 'Model', width: 1.4 }, { label: 'Tayyor', width: 0.6, tones: { Ha: 'good', "Yo'q": 'warn' } }, { label: 'Izoh', width: 4 }],
          rows: o.readiness.map((r) => [r.title, r.ready ? 'Ha' : "Yo'q", r.text]),
        },
        { type: 'notes', title: "Ma'lumot sifati", items: o.warnings.length ? o.warnings.map((w) => w.text) : ['Jiddiy muammo topilmadi.'] },
      ],
    });

    // ─────────── 9. Usullar ───────────
    sections.push({
      title: 'Usullar',
      blocks: [
        {
          type: 'notes',
          items: [
            "Prognoz — Holt-Winters oilasi (tekislash, trendli, mavsumiy): qaysi usul oxirgi oylarni yaxshiroq aytgan bo'lsa, o'sha tanlanadi; oraliqlar simulyatsiya bilan.",
            "Omillar — panel regressiya (OLS, FE, RE), Xausman testi; standart xatolar hududlar bo'yicha klasterlangan; elastiklik — log-log FE; Kobb-Duglas.",
            "Samaradorlik — DEA (ma'lumotlarni qamrab olish tahlili): hududlar bir-biri bilan solishtiriladi, tashqi me'yor kerak emas.",
            "Zararsizlik — oylik xarajatning doimiy va daromadga bog'liq qismi regressiya bilan ajratiladi.",
            "Risk — daromad va xarajat birga simulyatsiya qilinadi (2000 yo'l), ularning o'zaro bog'liqligi hisobga olinadi.",
            "Barcha raqamlar faqat Daromadlar, Xarajatlar va Xodimlar bo'limlaridan olinadi; hech narsa o'zgartirilmaydi. Oylar yozuvning hisob davri (oy) bo'yicha olinadi.",
          ],
        },
      ],
    });

    const highlights = [
      ...(yi ? [`${year}-yil daromadi ~${fmtSom(som(yi.totalTiyin))}: ${partsText(yi)}.`] : []),
      ...(yearNet !== null ? [`${year}-yil natijasi ~${fmtSom(yearNet)} (daromad − xarajat prognozi).`] : []),
      ...(totalRisk ? [`Keyingi 3 oyda korxona bo'yicha zarar ehtimoli ${fmtPct(totalRisk.lossProbability * 100, 0)}; kutilgan natija ${signedSom(som(totalRisk.expectedResultTiyin))}.`] : []),
      ...keyNotes.slice(2, 5),
    ];

    return {
      kind: 'Katta modellar',
      title: 'Katta modellar hisoboti',
      subtitle: `Butun korxona · ma'lumot ${periodLabel(o.firstPeriod)} – ${periodLabel(o.lastFullPeriod)}`,
      meta: [
        `Ma'lumot: ${periodLabel(o.firstPeriod)} – ${periodLabel(o.lastFullPeriod)} (${o.fullMonths} ta tugagan oy); joriy oy — ${periodLabel(current)}`,
        `Holat sanasi: ${uzDate(today)}; modellar har safar yangi ma'lumot bilan qayta hisoblanadi`,
        "Manba: Daromadlar, Xarajatlar, Xodimlar bo'limlari",
      ],
      highlights: highlights.slice(0, 6),
      sections,
      fileBase: safeFile(`Katta modellar - hisobot - ${today}`),
      generatedAt: new Date(Date.now() + 5 * 3600_000).toISOString(),
    };
  }

  // ─────────── Omillar bo'limi ───────────

  private factorsSection(f: FactorsResult): ReportSection {
    const blocks: ReportSection['blocks'] = [];
    const main = f.preferred ? f[f.preferred] : null;
    const per = (key: string) => (f.factors.find((x) => x.key === key)?.unit === 'kishi' ? 1 : 1e6);
    const unitText = (key: string) => (per(key) === 1 ? "so'm / 1 kishi" : "so'm / 1 mln so'm");
    if (main) {
      blocks.push({
        type: 'table',
        title: `Asosiy model — ${main.name}`,
        columns: [
          { label: 'Omil', width: 1.5 },
          { label: 'Birlik', width: 1 },
          { label: "Ta'sir (oyiga)", format: 'money', toneBy: 'up' },
          { label: '95%: dan', format: 'money' },
          { label: '95%: gacha', format: 'money' },
          { label: 'p', format: 'decimal3', width: 0.6 },
          { label: 'Ishonch', width: 0.8, tones: SIGNIFICANCE_TONES },
          { label: "Ma'nosi", width: 3 },
        ],
        rows: main.coefficients.map((c) => [c.label, unitText(c.key), c.value * per(c.key), c.lo95 * per(c.key), c.hi95 * per(c.key), c.p, SIGNIFICANCE[c.significance] ?? c.significance, c.meaning]),
        note: "Ta'sir — omil 1 birlikka oshganda oylik daromad necha so'mga o'zgaradi (boshqa omillar o'zgarmaganda). p < 0,05 — ishonchli, p < 0,10 — taxminiy.",
      });
    }
    const models = [f.pooled, f.fixed, f.random, f.elasticity].filter((m): m is ModelTable => Boolean(m));
    if (models.length) {
      const coef = (m: ModelTable | null, key: string) => {
        const c = m?.coefficients.find((x) => x.key === key);
        return c ? c.value * (m!.method === 'elasticity' ? 1 : per(key)) : null;
      };
      const columns: Column[] = [{ label: 'Omil', width: 1.5 }];
      if (f.pooled) columns.push({ label: 'OLS', format: 'money' });
      if (f.fixed) columns.push({ label: 'FE', format: 'money' });
      if (f.random) columns.push({ label: 'RE', format: 'money' });
      if (f.elasticity) columns.push({ label: 'Elastiklik', format: 'decimal3', width: 0.8 });
      blocks.push({
        type: 'table',
        title: 'Usullar solishtirmasi',
        columns,
        rows: f.factors.map((fac) => {
          const row: Cell[] = [`${fac.label} (${unitText(fac.key)})`];
          if (f.pooled) row.push(coef(f.pooled, fac.key));
          if (f.fixed) row.push(coef(f.fixed, fac.key));
          if (f.random) row.push(coef(f.random, fac.key));
          if (f.elasticity) row.push(coef(f.elasticity, fac.key));
          return row;
        }),
        note: 'Elastiklik — omil 1% oshganda daromad necha foiz o\'zgaradi.',
      });
      blocks.push({
        type: 'table',
        title: "Modellar sifati",
        columns: [
          { label: 'Model', width: 1.6 },
          { label: 'Kuzatuv', format: 'int', width: 0.7 },
          { label: 'Hududlar', format: 'int', width: 0.7 },
          { label: 'R²', format: 'decimal3', width: 0.7 },
          { label: 'Tuzatilgan R²', format: 'decimal3', width: 0.8 },
          { label: 'F testi p', format: 'decimal3', width: 0.7 },
          { label: 'Durbin-Watson', format: 'decimal', width: 0.8 },
        ],
        rows: models.map((m) => [METHOD[m.method] ?? m.name, m.n, m.groups, m.r2, m.adjR2, m.fP, m.durbinWatson]),
      });
    }
    if (f.cobbDouglas && f.cobbDouglas.tfp.length) {
      blocks.push({
        type: 'table',
        title: "Kobb-Duglas: umumiy samaradorlik (TFP) indeksi",
        columns: [{ label: 'Hudud', width: 2 }, { label: "TFP (100 — o'rtacha)", format: 'decimal', width: 1 }],
        rows: [...f.cobbDouglas.tfp].sort((a, b) => b.index - a.index).map((t) => [t.name, t.index]),
      });
    }
    if (f.unitEffects.length) {
      const effects = [...f.unitEffects].sort((a, b) => Number(b.effectTiyin) - Number(a.effectTiyin));
      blocks.push(
        {
          type: 'chart',
          title: "Hudud effekti: kutilganidan ko'p/kam daromad (oyiga)",
          kind: 'barh',
          unit: "mln so'm",
          labels: effects.map((u) => u.name),
          series: [{ name: 'Hudud effekti', values: effects.map((u) => mln(som(u.effectTiyin))) }],
        },
        {
          type: 'table',
          title: 'Hudud effekti',
          columns: [{ label: 'Hudud', width: 1.8 }, { label: "Haqiqiy o'rtacha", format: 'money' }, { label: 'Resurslariga ko\'ra kutilgan', format: 'money' }, { label: 'Farq', format: 'money', toneBy: 'up' }, { label: 'Oylar', format: 'int', width: 0.6 }],
          rows: effects.map((u) => [u.name, som(u.actualTiyin), som(u.expectedTiyin), som(u.effectTiyin), u.months]),
        },
      );
    }
    const notes = [f.hausman?.text, f.cobbDouglas?.text, ...f.notes, ...f.warnings].filter((x): x is string => Boolean(x));
    if (notes.length) blocks.push({ type: 'notes', title: 'Izohlar', items: notes });
    return {
      title: "Omillar: daromad nimaga bog'liq",
      intro: `${f.units} hudud × ${f.months} oy = ${f.observations} kuzatuv${f.periodFrom && f.periodTo ? ` (${periodLabel(f.periodFrom)} – ${periodLabel(f.periodTo)})` : ''} · asosiy model: ${f.preferred ? METHOD[f.preferred] : '—'}.`,
      blocks,
    };
  }
}