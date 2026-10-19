import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EconData, fmtPct, fmtSom, monthName, periodLabel, periodRange, shiftPeriod, tiyin } from './econ.data';
import { backtestEts, etsForecast, etsSimulateJoint, etsSimulatePaths, fitEts, mean, pearson, quantile, seedOf, type Backtest, type EtsFit } from './econ.math';
import {
  RELIABILITY_LABEL,
  TARGET_LABEL,
  type EconOverview,
  type ForecastHow,
  type ForecastResult,
  type ModelReadiness,
  type Panel,
  type Reliability,
  type Target,
  type UnitForecastSummary,
  type UnitSeries,
  type UnitsForecastResult,
  type YearEnd,
} from './econ.types';

const TARGETS: Target[] = ['income', 'expense', 'result', 'payroll'];

const MODEL_NAME: Record<EtsFit['kind'], string> = {
  mean: "O'rtacha qiymat",
  ses: 'Eksponensial tekislash',
  holt: 'Trendli model (Holt)',
  seasonal: 'Mavsumiy model (Holt-Winters)',
};

function num(value: number, digits = 2): string {
  return value.toFixed(digits).replace('.', ',');
}

/** Maqsadli ko'rsatkich qatori (so'm) */
function seriesOf(u: UnitSeries, target: Target): number[] {
  if (target === 'income') return u.income;
  if (target === 'expense') return u.expense;
  if (target === 'payroll') return u.payroll;
  return u.income.map((v, i) => v - u.expense[i]!);
}

/** Model tushuntirishi — oddiy tilda */
function explain(fit: EtsFit): string {
  const a = Math.round(fit.params.alpha * 100);
  if (fit.kind === 'mean') return "Ma'lumot juda kam, shuning uchun o'tgan oylarning oddiy o'rtachasi olinadi. Bu faqat mo'ljal.";
  if (fit.kind === 'ses') {
    return `Oxirgi oylarga ko'proq vazn beradi: har yangi oy bahoni ${a}% ga o'zgartiradi. Aniq o'sish yoki pasayish trendi topilmadi, shuning uchun keyingi oylar bir xil darajada kutiladi.`;
  }
  const damp = fit.params.phi < 0.99 ? ` Trend uzoq muddatda sekinlashadi (so'nish φ = ${num(fit.params.phi)}), shunda bir necha oylik o'sish abadiy davom etadi deb hisoblanmaydi.` : '';
  if (fit.kind === 'holt') return `Daraja va trendni (o'sish yoki pasayish yo'nalishini) hisobga oladi. Har yangi oy darajani ${a}% ga yangilaydi.${damp}`;
  return `Daraja, trend va har yili takrorlanadigan oylik mavsumni hisobga oladi (masalan, yil oxiridagi ko'tarilish). Har yangi oy darajani ${a}% ga yangilaydi.${damp}`;
}

/** Natija hisobi uchun bir tomon (daromad yoki xarajat) */
interface Side {
  fit: EtsFit;
  /** Prognoz o'rtachalari (tiyin), joriy oydan boshlab */
  means: string[];
  fitted: (string | null)[];
  yearEnd: YearEnd;
  model: string;
  /** Bu tomonda yozuv yo'q — nol deb olindi */
  zero: boolean;
}

/** Yozuvi yo'q qator uchun "model": har doim nol, tebranishsiz */
function zeroFit(n: number): EtsFit {
  return {
    kind: 'mean',
    params: { alpha: 0, beta: 0, gamma: 0, phi: 1 },
    level: 0,
    trend: 0,
    season: [],
    period: 12,
    fitted: new Array<number>(n).fill(0),
    residuals: new Array<number>(n).fill(0),
    sigma: 0,
    aicc: 0,
    paramCount: 1,
  };
}

/** "2026-01".."2026-08" → "yanvar–avgust" */
function monthSpan(from: number, to: number): string {
  return from === to ? monthName(from) : `${monthName(from)}–${monthName(to)}`;
}

/** Yil yakuni izohi: har bir qism alohida ko'rsatiladi — foydalanuvchi o'zi qo'shib tekshira oladi */
function yearNote(
  word: string,
  year: number,
  currentPeriod: string,
  actual: number,
  soFar: number,
  currentExpected: number,
  rest: number,
  lo: number,
  hi: number,
  previousYear: number | null,
): string {
  const m = Number(currentPeriod.slice(5, 7));
  const total = actual + currentExpected + rest;
  const parts = [
    ...(m > 1 ? [`haqiqiy (${monthSpan(1, m - 1)}) ${fmtSom(actual)}`] : []),
    `${monthName(m)} ${fmtSom(currentExpected)} (hozircha ${fmtSom(soFar)} yozilgan)`,
    ...(m < 12 ? [`prognoz (${monthSpan(m + 1, 12)}) ${fmtSom(rest)}`] : []),
  ];
  return (
    `${year}-yil jami ${word}: ~${fmtSom(total)} = ${parts.join(' + ')}; 80% oraliq ${fmtSom(lo)} – ${fmtSom(hi)}.` +
    (previousYear !== null && previousYear !== 0
      ? ` ${year - 1}-yilda ${fmtSom(previousYear)} edi (${total >= previousYear ? '+' : '−'}${fmtPct((Math.abs(total - previousYear) / Math.abs(previousYear)) * 100)}).`
      : '')
  );
}


/** 0,35 → "35%" */
function share(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Parametrlar oddiy tilda — har biri nima qiladi */
function paramsText(fit: EtsFit): string {
  if (fit.kind === 'mean') return "Parametr yo'q: o'tgan oylarning o'rtachasi olinadi.";
  const p = fit.params;
  const parts = [
    `α = ${num(p.alpha)}: har yangi oy «asosiy daraja»ni ${share(p.alpha)} ga o'zgartiradi, ${share(1 - p.alpha)} — avvalgi bilim saqlanadi` +
      (p.alpha >= 0.6 ? ' (model oxirgi oylarga tez moslashadi)' : p.alpha <= 0.2 ? " (model uzoq tarixga tayanadi, bir oylik tebranishga berilmaydi)" : ''),
  ];
  if (fit.kind !== 'ses') {
    parts.push(`β = ${num(p.beta, 3)}: o'sish/pasayish sur'ati (trend) har oy shu ulushda yangilanadi`);
    parts.push(
      p.phi >= 0.995
        ? `φ = ${num(p.phi)}: trend so'nmaydi — o'sish sur'ati keyingi oylarda ham saqlanadi deb olinadi`
        : `φ = ${num(p.phi)}: trend har oy ${share(1 - p.phi)} ga susayadi — o'sish abadiy davom etadi deb hisoblanmaydi`,
    );
  }
  if (fit.kind === 'seasonal') parts.push(`γ = ${num(p.gamma)}: har oyning mavsumiy farqi shu ulushda yangilanadi`);
  return parts.join('; ') + '.';
}

/** Bitta qator (daromad, xarajat, ish haqi) modeli bo'yicha «Model qanday ishlaydi» */
function buildHow(args: {
  fit: EtsFit;
  word: string;
  periods: string[];
  y: number[];
  currentPeriod: string;
  forecastPeriods: string[];
  means: number[];
  floor: number | null;
  bt: Backtest | null;
  simPaths: number;
}): ForecastHow {
  const { fit, word, periods, y, forecastPeriods, means, floor, bt } = args;
  const diag = fit.diag;
  const n = y.length;
  const cleaned = (diag?.cleaned ?? []).map((c) => ({ period: periods[c.index]!, actualTiyin: tiyin(c.value), usedTiyin: tiyin(c.used) }));
  const candidates = (diag?.candidates ?? []).map((c) => ({
    kind: c.kind,
    name: MODEL_NAME[c.kind],
    wape: c.error,
    byHorizon: c.byHorizon,
    points: c.points,
    chosen: c.kind === fit.kind,
  }));
  const chosenBy = diag?.chosenBy ?? 'only';

  // Prognoz tarkibi: daraja + trend hissasi + mavsum hissasi
  const columns: ForecastHow['breakdown']['columns'] = [
    { key: 'level', label: 'Asosiy daraja', hint: "Model hozir ko'rayotgan «odatiy oy» qiymati (tasodifiy tebranishsiz)" },
  ];
  if (fit.kind === 'holt' || fit.kind === 'seasonal') columns.push({ key: 'trend', label: 'Trend hissasi', hint: "O'sish yoki pasayish yo'nalishi: shu oygacha to'plangan (so'nish bilan)" });
  if (fit.kind === 'seasonal') columns.push({ key: 'season', label: 'Mavsum hissasi', hint: "Shu kalendar oyi odatda o'rtachadan qancha yuqori yoki past" });
  let damp = 0;
  const rows = forecastPeriods.map((period, i) => {
    damp += fit.params.phi ** (i + 1);
    const level = fit.level;
    const trend = fit.kind === 'holt' || fit.kind === 'seasonal' ? damp * fit.trend : 0;
    const season = fit.kind === 'seasonal' ? fit.season[i % fit.period]! : 0;
    const values: Record<string, string> = { level: tiyin(level) };
    if (fit.kind === 'holt' || fit.kind === 'seasonal') values.trend = tiyin(trend);
    if (fit.kind === 'seasonal') values.season = tiyin(season);
    const sumT = Object.values(values).reduce((acc, v) => acc + BigInt(v), 0n);
    const meanT = BigInt(tiyin(means[i]!));
    let note: string | null = null;
    if (i === 0 && floor !== null && meanT > sumT) note = `Joriy oyda allaqachon ${fmtSom(floor)} yozilgan — oy uchun kamida shu summa olinadi`;
    else if (meanT > sumT && sumT < 0n) note = `${word[0]!.toUpperCase()}${word.slice(1)} manfiy bo'lmaydi — 0 olinadi`;
    return { period, values, sumTiyin: sumT.toString(), meanTiyin: meanT.toString(), note };
  });

  const levels = (fit.levels ?? []).map((l, i) => ({ period: periods[i]!, levelTiyin: tiyin(l) }));
  const intervals = {
    modelSigmaTiyin: tiyin(diag?.sigmaModel ?? fit.sigma),
    testSigmaTiyin: diag?.sigmaTest != null ? tiyin(diag.sigmaTest) : null,
    usedSigmaTiyin: tiyin(fit.sigma),
    text:
      `Kelajak bitta raqam emas: model ${args.simPaths} ta tasodifiy «kelajak yo'li»ni hisoblaydi — har oyda tasodifiy og'ish qo'shiladi va u keyingi oylarga ham ta'sir qiladi. ` +
      `Har oy uchun yo'llarning o'rtadagi 80% qismi — 80% oraliq. Og'ish o'lchami σ = ${fmtSom(fit.sigma)}` +
      (diag?.sigmaTest != null && diag.sigmaTest >= (diag.sigmaModel ?? 0)
        ? ` — o'tmishdagi sinovda model haqiqatda qilgan xatolardan olindi (model ichidagi ${fmtSom(diag.sigmaModel)} dan katta), shuning uchun oraliq o'ziga ortiqcha ishonmaydi.`
        : ' — model o\'rgatilgandagi xatolardan.') +
      " Shu sababli oraliq uzoq oylarda kengayadi: kelajak qanchalik uzoq bo'lsa, noaniqlik shuncha ko'p.",
  };
  const horizon = bt?.byHorizon ?? [];
  const coverage = bt && bt.points > 0 ? { inside: bt.inside80, total: bt.points } : null;

  const from = periods[0]!;
  const to = periods[n - 1]!;
  const winner = candidates.find((c) => c.chosen);
  const testedText =
    chosenBy === 'test' && candidates.length > 1
      ? `${candidates.length} ta model sinaldi: har biri o'tmishdagi oylarga faqat oldingi ma'lumotni ko'rib 1, 2 va 3 oy oldinga «bilmasdan» aytdi. ` +
        candidates.map((c) => `${c.name} — ${c.wape === null ? 'sinab bo\'lmadi' : `o'rtacha xato ${fmtPct(c.wape * 100)}`}`).join('; ') +
        `. Eng kam xato qilgan — «${winner?.name ?? MODEL_NAME[fit.kind]}» tanlandi (murakkab model oddiyidan kamida 3% aniqroq bo'lsagina olinadi).`
      : chosenBy === 'aicc'
        ? "Sinash uchun ma'lumot hali kam (12 oydan oz) — modellar axborot mezoni (AICc) bo'yicha solishtirildi: aniqlik va soddalik muvozanati."
        : "Ma'lumot uzunligiga mos yagona model ishlatildi.";
  const steps = [
    {
      title: "Ma'lumot",
      text:
        `${n} ta tugagan oy (${periodLabel(from)} – ${periodLabel(to)}) olindi. Joriy oy (${periodLabel(args.currentPeriod)}) hali tugamagan — o'rgatishga kirmaydi, ` +
        `faqat unda yozilgan summa «kamida shuncha» sifatida hisobga olinadi.`,
    },
    {
      title: 'Tozalash',
      text: cleaned.length
        ? `${cleaned.length} ta oyda bir martalik keskin sakrash topildi (${cleaned.map((c) => periodLabel(c.period)).join(', ')}) — modelni o'rgatishda ular qo'shni oylar darajasida olindi, ` +
          "aks holda bitta g'ayrioddiy oy butun prognozni surib yuborardi. Haqiqiy yozuvlar o'zgarmaydi."
        : "Bir martalik keskin sakrash topilmadi — barcha oylar o'zgarishsiz ishlatildi. (Har yili takrorlanadigan ko'tarilishlar sakrash hisoblanmaydi — bu mavsum.)",
    },
    { title: 'Modellarni sinash', text: testedText },
    { title: 'Tanlangan model', text: `${explain(fit)} ${paramsText(fit)}` },
    {
      title: 'Kelajak qanday aytiladi',
      text:
        fit.kind === 'seasonal'
          ? "Har oy prognozi = asosiy daraja + trend hissasi + shu oyning mavsum hissasi. Pastdagi jadvalda har oy uchun bu qismlar va ularning yig'indisi ko'rsatilgan."
          : fit.kind === 'holt'
            ? "Har oy prognozi = asosiy daraja + trend hissasi (so'nish bilan to'plangan). Pastdagi jadvalda har oy uchun qismlar ko'rsatilgan."
            : 'Har oy prognozi = asosiy daraja: aniq trend topilmagani uchun keyingi oylar bir xil darajada kutiladi.',
    },
    { title: "Ehtimol oralig'i", text: intervals.text },
    {
      title: 'Qanchalik ishonish mumkin',
      text:
        horizon.some((h) => h.wape !== null)
          ? `O'tmishda sinov: 1 oy oldinga ${horizon[0]?.wape != null ? fmtPct(horizon[0].wape * 100) : '—'}, 2 oy — ${horizon[1]?.wape != null ? fmtPct(horizon[1].wape * 100) : '—'}, ` +
            `3 oy — ${horizon[2]?.wape != null ? fmtPct(horizon[2].wape * 100) : '—'} o'rtacha xato.` +
            (coverage ? ` ${coverage.total} oydan ${coverage.inside} tasida haqiqiy qiymat 80% oraliq ichida bo'ldi (kutilgani ~${Math.round(coverage.total * 0.8)}).` : '')
          : "Sinash uchun hali ma'lumot kam — natijani yo'nalish sifatida qabul qiling.",
    },
  ];
  return { steps, candidates, chosenBy, cleaned, breakdown: { columns, rows }, levels, intervals, horizon, coverage };
}

@Injectable()
export class EconService {
  /** Hisoblangan prognozlar keshi — ma'lumot jadvali yangilanguncha amal qiladi */
  private memo = new Map<string, ForecastResult>();
  /** Tanlangan modellar (natija = daromad − xarajat uchun qayta ishlatiladi) */
  private fits = new Map<string, EtsFit | null>();
  private memoBuiltAt = 0;

  constructor(private readonly data: EconData) {}

  private parseTarget(value?: string): Target {
    if (!value) return 'income';
    if ((TARGETS as string[]).includes(value)) return value as Target;
    throw new BadRequestException("Ko'rsatkich noto'g'ri: income, expense, result yoki payroll");
  }

  private parseHorizon(value?: string | number, fallback = 6): number {
    if (value === undefined || value === '') return fallback;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 24) throw new BadRequestException("Prognoz muddati 1 dan 24 oygacha bo'lsin");
    return n;
  }

  // ═══════════════════════════════════════════════════════════
  // Umumiy ko'rinish: qancha ma'lumot bor, qaysi model tayyor
  // ═══════════════════════════════════════════════════════════

  async overview(asOf?: string): Promise<EconOverview> {
    const panel = await this.data.panel(asOf);
    const full = EconData.fullCount(panel);
    const t = panel.total;
    const regionUnits = panel.units.filter((u) => u.kind === 'region');
    const activeRegions = regionUnits.filter((u) => EconData.activeMonths(panel, u) >= 6);
    const withHeads = activeRegions.filter((u) => u.headcount.slice(0, full).some((v) => v > 0));
    const panelObs = withHeads.reduce(
      (s, u) => s + u.income.slice(0, full).filter((v, i) => v > 0 && u.headcount[i]! > 0).length,
      0,
    );
    const companyMonths = EconData.activeMonths(panel, t);

    const readiness: ModelReadiness[] = [
      {
        id: 'forecast',
        title: 'Prognoz',
        ready: companyMonths >= 6,
        text:
          companyMonths >= 33
            ? `${companyMonths} oy ma'lumot bor — trend va yillik mavsum bilan to'liq prognoz.`
            : companyMonths >= 6
              ? `${companyMonths} oy ma'lumot bor — trendli prognoz. Yillik mavsumni ajratish uchun taxminan 33 oy kerak.`
              : `Kamida 6 oy kerak, hozir ${companyMonths} oy.`,
      },
      {
        id: 'factors',
        title: 'Omillar tahlili (regressiya)',
        ready: panelObs >= 30 && withHeads.length >= 3,
        text: `Hudud × oy kuzatuvlari: ${panelObs} ta (kamida 30 ta va 3 ta hudud kerak).`,
      },
      {
        id: 'elasticity',
        title: 'Elastiklik',
        ready: panelObs >= 30,
        text: `Daromad, xarajat va xodimlar musbat bo'lgan kuzatuvlar: ${panelObs} ta (kamida 30).`,
      },
      {
        id: 'panel',
        title: 'Hududlar paneli',
        ready: activeRegions.length >= 3 && full >= 6,
        text: `Kamida 6 oy ma'lumoti bor hududlar: ${activeRegions.length} ta (kamida 3 ta kerak).`,
      },
      {
        id: 'cobb-douglas',
        title: 'Kobb-Duglas',
        ready: panelObs >= 30 && withHeads.length >= 3,
        text: `Xodimlar soni bilan birga kuzatuvlar: ${panelObs} ta (kamida 30).`,
      },
      {
        id: 'efficiency',
        title: 'Samaradorlik chegarasi',
        ready: activeRegions.length >= 4,
        text: `Taqqoslanadigan hududlar: ${activeRegions.length} ta (kamida 4 ta).`,
      },
      {
        id: 'breakeven',
        title: 'Zararsizlik nuqtasi',
        ready: companyMonths >= 8,
        text: `Doimiy va o'zgaruvchan xarajatni ajratish uchun kamida 8 oy kerak, hozir ${companyMonths} oy.`,
      },
      {
        id: 'scenario',
        title: 'Stsenariy va risk',
        ready: companyMonths >= 6,
        text: companyMonths >= 6 ? 'Prognoz modeli asosida ishlaydi.' : 'Avval prognoz uchun ma\'lumot yetishi kerak.',
      },
    ];

    return {
      asOf: panel.asOf,
      months: panel.months,
      firstPeriod: panel.months[0]!,
      lastFullPeriod: panel.lastFullPeriod,
      currentPeriod: panel.currentPeriod,
      fullMonths: full,
      units: panel.units.map((u) => ({
        key: u.key,
        name: u.name,
        kind: u.kind,
        fullMonths: EconData.activeMonths(panel, u),
        incomeTiyin: tiyin(u.income.slice(0, full).reduce((s, v) => s + v, 0)),
        expenseTiyin: tiyin(u.expense.slice(0, full).reduce((s, v) => s + v, 0)),
        headcount: u.headcount[full - 1] ?? u.headcount[u.headcount.length - 1] ?? 0,
      })),
      total: {
        incomeTiyin: t.income.map(tiyin),
        expenseTiyin: t.expense.map(tiyin),
        payrollTiyin: t.payroll.map(tiyin),
        headcount: t.headcount,
      },
      readiness,
      warnings: EconData.warnings(panel),
      sources: [
        "Daromadlar bo'limi — yozuv oyi bo'yicha",
        "Xarajatlar bo'limi — ish haqi, ijara, mashinalar va boshqa xarajatlar",
        "Xodimlar bo'limi — oy ichida ishlagan xodimlar soni",
      ],
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Prognoz: bitta birlik va ko'rsatkich
  // ═══════════════════════════════════════════════════════════

  async forecast(query: { target?: string; unit?: string; horizon?: string; asOf?: string }): Promise<ForecastResult> {
    const target = this.parseTarget(query.target);
    const horizon = this.parseHorizon(query.horizon, 6);
    const panel = await this.data.panel(query.asOf);
    const u = EconData.pick(panel, query.unit ?? 'all');
    if (!u) throw new NotFoundException('Hudud topilmadi');
    return this.forecastUnit(panel, u, target, horizon);
  }

  private forecastUnit(panel: Panel, u: UnitSeries, target: Target, horizon: number): ForecastResult {
    if (this.memoBuiltAt !== panel.builtAt) {
      this.memo.clear();
      this.fits.clear();
      this.memoBuiltAt = panel.builtAt;
    }
    const key = `${target}|${u.key}|${horizon}`;
    const cached = this.memo.get(key);
    if (cached) return cached;
    const result = this.computeForecast(panel, u, target, horizon);
    this.memo.set(key, result);
    return result;
  }

  private computeForecast(panel: Panel, u: UnitSeries, target: Target, horizon: number): ForecastResult {
    // Natija alohida model bilan emas: daromad prognozi − xarajat prognozi (hamma joyda qo'shiluvchan)
    if (target === 'result') return this.computeResult(panel, u, horizon);
    const full = EconData.fullCount(panel);
    const raw = seriesOf(u, target);
    // Birlik ishlay boshlagan oydan olinadi (undan oldingi bo'sh oylar hisobga kirmaydi)
    const first = u.income.findIndex((v, i) => i < full && (v !== 0 || u.expense[i] !== 0));
    const startIndex = first < 0 ? full : first;
    const y = raw.slice(startIndex, full);
    const periods = panel.months.slice(startIndex, full);
    // Bu yerda faqat daromad, xarajat, ish haqi (natija — computeResult)
    const nonNegative = true;
    const currentIndex = panel.months.indexOf(panel.currentPeriod);
    // Tarixiy ko'rinishda «joriy» oy hali boshlanmagan — yozilgan summa yo'q
    const actualSoFar = currentIndex >= 0 && !panel.asOf ? raw[currentIndex]! : null;

    const base: ForecastResult = {
      target,
      targetLabel: TARGET_LABEL[target],
      unit: u.key,
      unitName: u.name,
      horizon,
      history: periods.map((p, i) => ({ period: p, valueTiyin: tiyin(y[i]!), fittedTiyin: null })),
      forecast: [],
      model: { kind: 'none', name: 'Model yo\'q', explain: '', params: null, seasonal: null },
      accuracy: { points: 0, wape: null, basis: 'value', naiveWape: null, skill: null, rows: [] },
      reliability: 'none',
      reliabilityText: RELIABILITY_LABEL.none,
      yearEnd: null,
      notes: [],
      how: null,
    };

    if (y.length < 4 || y.every((v) => v === 0)) {
      base.notes.push(`Prognoz uchun kamida 4 ta tugagan oy kerak — ${u.name} bo'yicha hozircha ${y.length} oy ma'lumot bor.`);
      return base;
    }

    const fit = fitEts(y);
    this.fits.set(`${target}|${u.key}`, fit);
    if (!fit) {
      base.notes.push("Model tuzilmadi — ma'lumot yetarli emas.");
      return base;
    }

    // Yil oxirigacha kerak bo'ladigan oylar
    const year = Number(panel.currentPeriod.slice(0, 4));
    const toDecember = 12 - Number(panel.currentPeriod.slice(5, 7)) + 1;
    const steps = Math.max(horizon, toDecember, 3);
    const seed = seedOf(`${target}|${u.key}|${y.length}`);
    // Joriy oy tugamagan: uning qiymati kamida allaqachon yozilgan summa (haqiqiy yozuvlar tashlanmaydi)
    const floor = actualSoFar !== null && actualSoFar > 0 ? actualSoFar : null;
    const rawCurrent = Math.max(0, etsForecast(fit, 1)[0]!);
    const sim = etsSimulatePaths(fit, steps, seed, nonNegative, toDecember, 2000, null, floor);
    const near = etsSimulatePaths(fit, 3, seed + 1, nonNegative, 3, 2000, null, floor);
    const forecastPeriods = periodRange(panel.currentPeriod, shiftPeriod(panel.currentPeriod, steps - 1));

    base.history = periods.map((p, i) => ({
      period: p,
      valueTiyin: tiyin(y[i]!),
      fittedTiyin: fit.kind === 'seasonal' && i < fit.period ? null : i === 0 && fit.kind !== 'mean' ? null : tiyin(fit.fitted[i]!),
    }));
    base.forecast = forecastPeriods.slice(0, horizon).map((period, i) => {
      const b = sim.bands[i]!;
      return {
        period,
        meanTiyin: tiyin(b.mean),
        lo80Tiyin: tiyin(b.lo80),
        hi80Tiyin: tiyin(b.hi80),
        lo95Tiyin: tiyin(b.lo95),
        hi95Tiyin: tiyin(b.hi95),
        actualSoFarTiyin: i === 0 && actualSoFar !== null ? tiyin(actualSoFar) : null,
      };
    });

    // Mavsumiy ta'sir: kalendar oylari bo'yicha
    let seasonal: ForecastResult['model']['seasonal'] = null;
    if (fit.kind === 'seasonal') {
      const startMonth = Number(panel.currentPeriod.slice(5, 7));
      seasonal = fit.season
        .map((effect, i) => ({ month: ((startMonth - 1 + i) % 12) + 1, effectTiyin: tiyin(effect) }))
        .sort((a, b) => a.month - b.month);
    }
    base.model = {
      kind: fit.kind,
      name: MODEL_NAME[fit.kind],
      explain: explain(fit),
      params: fit.kind === 'mean' ? null : fit.params,
      seasonal,
    };

    // O'tmishda sinash
    const holdout = y.length >= 12 ? 6 : y.length >= 8 ? 3 : 0;
    const bt = holdout > 0 ? backtestEts(y, holdout, 12, nonNegative) : null;
    let wapeForGrade: number | null = null;
    if (bt && bt.points > 0) {
      wapeForGrade = bt.wape;
      base.accuracy = {
        points: bt.points,
        wape: bt.wape,
        basis: 'value',
        naiveWape: bt.naiveWape,
        skill: bt.wape !== null && bt.naiveWape ? (1 - bt.wape / bt.naiveWape) * 100 : null,
        rows: bt.rows.map((r) => ({ period: periods[r.index]!, actualTiyin: tiyin(r.actual), predictedTiyin: tiyin(r.predicted) })),
      };
    }

    const reliability: Reliability =
      wapeForGrade === null
        ? 'low'
        : y.length >= 18 && wapeForGrade < 0.1
          ? 'high'
          : y.length >= 9 && wapeForGrade < 0.25
            ? 'medium'
            : 'low';
    base.reliability = reliability;
    base.reliabilityText =
      RELIABILITY_LABEL[reliability] +
      (wapeForGrade !== null ? ` — sinovda o'rtacha xato ${fmtPct(wapeForGrade * 100)}` : ' — sinash uchun ma\'lumot kam');

    const word0 = target === 'income' ? 'daromad' : target === 'expense' ? 'xarajat' : 'ish haqi xarajati';
    base.how = buildHow({
      fit,
      word: word0,
      periods,
      y,
      currentPeriod: panel.currentPeriod,
      forecastPeriods: forecastPeriods.slice(0, horizon),
      means: sim.bands.slice(0, horizon).map((b) => b.mean),
      floor,
      bt,
      simPaths: 2000,
    });

    // Yil oxiri = tugagan oylar (haqiqiy) + joriy oy (kamida yozilgani) + qolgan oylar prognozi
    const yearMonths = panel.months.map((p, i) => ({ p, i })).filter(({ p }) => p.startsWith(`${year}-`) && p < panel.currentPeriod);
    const actualYear = yearMonths.reduce((s, { i }) => s + raw[i]!, 0);
    const currentExpected = sim.bands[0]!.mean;
    const restYear = sim.bands.slice(1, toDecember).reduce((s, b) => s + b.mean, 0);
    const forecastYear = currentExpected + restYear;
    const previousYearMonths = panel.months.map((p, i) => ({ p, i })).filter(({ p }) => p.startsWith(`${year - 1}-`));
    const previousYear = previousYearMonths.length === 12 && previousYearMonths[0]!.i >= startIndex ? previousYearMonths.reduce((s, { i }) => s + raw[i]!, 0) : null;
    // Tiyinda aniq qo'shiladi: jami = haqiqiy + joriy oy + qolgan oylar (har bir oy jadvaldagidek yaxlitlangan)
    const actualT = BigInt(tiyin(actualYear));
    const currentT = BigInt(tiyin(currentExpected));
    const restT = sim.bands.slice(1, toDecember).reduce((s, b) => s + BigInt(tiyin(b.mean)), 0n);
    base.yearEnd = {
      year,
      actualTiyin: actualT.toString(),
      currentPeriod: panel.currentPeriod,
      currentSoFarTiyin: tiyin(actualSoFar ?? 0),
      currentExpectedTiyin: currentT.toString(),
      restTiyin: restT.toString(),
      forecastTiyin: (currentT + restT).toString(),
      totalTiyin: (actualT + currentT + restT).toString(),
      lo80Tiyin: tiyin(actualYear + quantile(sim.totals, 0.1)),
      hi80Tiyin: tiyin(actualYear + quantile(sim.totals, 0.9)),
      previousYearTiyin: previousYear === null ? null : tiyin(previousYear),
    };

    // ─────────── Xulosalar ───────────
    const notes = base.notes;
    const word = target === 'income' ? 'daromad' : target === 'expense' ? 'xarajat' : target === 'payroll' ? 'ish haqi xarajati' : 'natija';
    const nextAvg = mean(near.bands.map((b) => b.mean));
    const nextLo = quantile(near.totals, 0.1) / 3;
    const nextHi = quantile(near.totals, 0.9) / 3;
    const recent = y.slice(-3);
    const recentAvg = mean(recent);

    notes.push(
      `${u.name}: keyingi 3 oyda ${word} oyiga o'rtacha ${fmtSom(nextAvg)} bo'lishi kutilmoqda (80% ehtimol bilan ${fmtSom(nextLo)} – ${fmtSom(nextHi)}).`,
    );
    if (recentAvg !== 0) {
      const change = ((nextAvg - recentAvg) / Math.abs(recentAvg)) * 100;
      notes.push(
        Math.abs(change) < 3
          ? `Bu oxirgi 3 oy darajasiga teng (${fmtSom(recentAvg)}).`
          : `Bu oxirgi 3 oy o'rtachasidan (${fmtSom(recentAvg)}) ${fmtPct(Math.abs(change))} ${change > 0 ? "ko'p" : 'kam'}.`,
      );
    }
    if (panel.asOf) {
      notes.unshift(
        `Tarixiy ko'rinish: ${periodLabel(panel.asOf)} oxirida turgandek hisoblangan — keyingi oylar yozuvlari olinmagan, prognoz ${periodLabel(panel.currentPeriod)} dan boshlanadi.`,
      );
    }
    if (actualSoFar !== null && base.forecast[0]) {
      notes.push(
        actualSoFar >= rawCurrent && actualSoFar > 0
          ? `Joriy oy (${periodLabel(panel.currentPeriod)}) hali tugamagan: hozircha ${fmtSom(actualSoFar)} yozilgan — bu model kutganidan (${fmtSom(rawCurrent)}) ko'p, shuning uchun oy uchun kamida yozilgan summa olinadi.`
          : `Joriy oy (${periodLabel(panel.currentPeriod)}) hali tugamagan: hozircha ${fmtSom(actualSoFar)} yozilgan, model oy oxirigacha taxminan ${fmtSom(currentExpected)} kutmoqda.`,
      );
    }
    notes.push(
      yearNote(word, year, panel.currentPeriod, actualYear, actualSoFar ?? 0, currentExpected, restYear, actualYear + quantile(sim.totals, 0.1), actualYear + quantile(sim.totals, 0.9), previousYear),
    );
    if (bt && bt.points > 0 && bt.wape !== null) {
      const skill = base.accuracy.skill;
      notes.push(
        `Sinov: oxirgi ${bt.points} oyni yashirib tekshirdik — model o'rtacha ${fmtPct((wapeForGrade ?? bt.wape) * 100)} xato qildi` +
          (bt.naiveWape === null || skill === null
            ? '.'
            : skill >= 5
              ? `, "o'tgan oy takrorlanadi" degan oddiy usul esa ${fmtPct(bt.naiveWape * 100)} — model ${fmtPct(skill, 0)} aniqroq.`
              : skill > -10
                ? `, oddiy usul ("o'tgan oy takrorlanadi") bilan deyarli bir xil (${fmtPct(bt.naiveWape * 100)}). Ya'ni oylar orasida aniq qonuniyat kam — darajani oxirgi oylar belgilaydi.`
                : `, oddiy usul ("o'tgan oy takrorlanadi") esa ${fmtPct(bt.naiveWape * 100)}. Qator juda notekis — prognozni ehtiyotkorlik bilan qabul qiling.`),
      );
    }
    if (seasonal) {
      const sorted = [...seasonal].sort((a, b) => Number(b.effectTiyin) - Number(a.effectTiyin));
      const hi = sorted[0]!;
      const lo = sorted[sorted.length - 1]!;
      notes.push(
        `Mavsum: eng yuqori oy — ${monthName(hi.month)} (o'rtachadan +${fmtSom(Number(hi.effectTiyin) / 100)}), eng past — ${monthName(lo.month)} (${fmtSom(Number(lo.effectTiyin) / 100)}).`,
      );
    }
    if (base.how && base.how.cleaned.length > 0) {
      notes.push(
        `${base.how.cleaned.map((c) => periodLabel(c.period)).join(', ')} — bir martalik keskin sakrash: model o'rgatishda yumshatildi, prognoz unga qarab surilib ketmaydi.`,
      );
    }
    if (reliability === 'low') {
      notes.push("Diqqat: prognoz taxminiy — ma'lumot kam yoki oylar orasida tebranish katta. Uni aniq reja sifatida emas, yo'nalish sifatida qabul qiling.");
    }

    return base;
  }

  /**
   * Natija prognozi = daromad prognozi − xarajat prognozi.
   * Nuqtaviy qiymatlar va yil yakuni daromad va xarajat prognozlaridan aynan ayirma sifatida olinadi
   * (Katta modellar, hisobotlar va Rahbariyat hisoboti bir-biriga qo'shiladi);
   * oraliqlar ikkala qatorni birga simulyatsiya qilib (qoldiqlar korrelyatsiyasi bilan) topiladi.
   */
  private computeResult(panel: Panel, u: UnitSeries, horizon: number): ForecastResult {
    const full = EconData.fullCount(panel);
    const first = u.income.findIndex((v, i) => i < full && (v !== 0 || u.expense[i] !== 0));
    const startIndex = first < 0 ? full : first;
    const raw = seriesOf(u, 'result');
    const y = raw.slice(startIndex, full);
    const periods = panel.months.slice(startIndex, full);
    const currentIndex = panel.months.indexOf(panel.currentPeriod);
    const soFarInc = currentIndex >= 0 ? u.income[currentIndex]! : 0;
    const soFarExp = currentIndex >= 0 ? u.expense[currentIndex]! : 0;

    const year = Number(panel.currentPeriod.slice(0, 4));
    const forecastPeriods = periodRange(panel.currentPeriod, shiftPeriod(panel.currentPeriod, horizon - 1));
    // Bir tomon (daromad yoki xarajat): model, prognoz va yil yakuni. Yozuvi umuman yo'q tomon — nol
    const side = (target: 'income' | 'expense', series: number[], soFar: number): Side | null => {
      const r = this.forecastUnit(panel, u, target, horizon);
      const fit = this.fits.get(`${target}|${u.key}`) ?? null;
      if (fit && r.yearEnd && r.forecast.length) {
        return { fit, means: r.forecast.map((f) => f.meanTiyin), fitted: r.history.map((h) => h.fittedTiyin), yearEnd: r.yearEnd, model: MODEL_NAME[fit.kind].toLowerCase(), zero: false };
      }
      const window = series.slice(startIndex, full);
      if (window.length < 4 || window.some((v) => v !== 0)) return null;
      const yearActual = panel.months.reduce((s, p, i) => s + (p.startsWith(`${year}-`) && p < panel.currentPeriod ? series[i]! : 0), 0);
      const prev = panel.months.map((p, i) => ({ p, i })).filter(({ p }) => p.startsWith(`${year - 1}-`));
      const previous = prev.length === 12 && prev[0]!.i >= startIndex ? prev.reduce((s, { i }) => s + series[i]!, 0) : null;
      return {
        fit: zeroFit(window.length),
        means: forecastPeriods.map((_, i) => tiyin(i === 0 ? soFar : 0)),
        fitted: window.map(() => '0'),
        yearEnd: {
          year,
          actualTiyin: tiyin(yearActual),
          currentPeriod: panel.currentPeriod,
          currentSoFarTiyin: tiyin(soFar),
          currentExpectedTiyin: tiyin(soFar),
          restTiyin: '0',
          forecastTiyin: tiyin(soFar),
          totalTiyin: tiyin(yearActual + soFar),
          lo80Tiyin: tiyin(yearActual + soFar),
          hi80Tiyin: tiyin(yearActual + soFar),
          previousYearTiyin: previous === null ? null : tiyin(previous),
        },
        model: "yozuv yo'q — nol",
        zero: true,
      };
    };

    const base: ForecastResult = {
      target: 'result',
      targetLabel: TARGET_LABEL.result,
      unit: u.key,
      unitName: u.name,
      horizon,
      history: periods.map((p, i) => ({ period: p, valueTiyin: tiyin(y[i]!), fittedTiyin: null })),
      forecast: [],
      model: { kind: 'none', name: "Model yo'q", explain: '', params: null, seasonal: null },
      accuracy: { points: 0, wape: null, basis: 'income', naiveWape: null, skill: null, rows: [] },
      reliability: 'none',
      reliabilityText: RELIABILITY_LABEL.none,
      yearEnd: null,
      notes: [],
      how: null,
    };
    const inc = side('income', u.income, soFarInc);
    const exp = side('expense', u.expense, soFarExp);
    if (!inc || !exp || (inc.zero && exp.zero)) {
      base.notes.push(`${u.name}: natija prognozi uchun daromad va xarajat prognozi kerak — kamida 4 ta tugagan oy ma'lumoti bo'lishi lozim (hozir ${y.length} oy).`);
      return base;
    }
    const fitI = inc.fit;
    const fitE = exp.fit;
    base.history = periods.map((p, i) => {
      const fi = inc.fitted[i];
      const fe = exp.fitted[i];
      return { period: p, valueTiyin: tiyin(y[i]!), fittedTiyin: fi != null && fe != null ? String(BigInt(fi) - BigInt(fe)) : null };
    });

    const toDecember = 12 - Number(panel.currentPeriod.slice(5, 7)) + 1;
    const steps = Math.max(horizon, toDecember, 3);
    const skip = fitI.kind === 'seasonal' || fitE.kind === 'seasonal' ? 12 : 1;
    const rho = pearson(fitI.residuals.slice(skip), fitE.residuals.slice(skip)) ?? 0;
    const joint = etsSimulateJoint(fitI, fitE, rho, steps, seedOf(`result|${u.key}|${y.length}`));
    // Har bir yo'lda: natija = daromad − xarajat; joriy oy kamida yozilgan summalar
    const diff = joint.a.map((pa, k) =>
      pa.map((vi, i) => (i === 0 ? Math.max(soFarInc, vi) - Math.max(soFarExp, joint.b[k]![i]!) : vi - joint.b[k]![i]!)),
    );
    const stepValues = (i: number) => diff.map((path) => path[i]!);
    const totalOf = (n: number) => diff.map((path) => path.slice(0, n).reduce((s, v) => s + v, 0));

    base.forecast = forecastPeriods.map((period, i) => {
      const values = stepValues(i);
      return {
        period,
        meanTiyin: String(BigInt(inc.means[i]!) - BigInt(exp.means[i]!)),
        lo80Tiyin: tiyin(quantile(values, 0.1)),
        hi80Tiyin: tiyin(quantile(values, 0.9)),
        lo95Tiyin: tiyin(quantile(values, 0.025)),
        hi95Tiyin: tiyin(quantile(values, 0.975)),
        actualSoFarTiyin: i === 0 && currentIndex >= 0 && !panel.asOf ? tiyin(soFarInc - soFarExp) : null,
      };
    });
    base.model = {
      kind: 'combined',
      name: 'Daromad − xarajat',
      explain:
        `Natija alohida model bilan emas, daromad prognozi (${inc.model}) minus xarajat prognozi (${exp.model}) sifatida hisoblanadi — ` +
        `shuning uchun natija, daromad va xarajat raqamlari har doim bir-biriga qo'shiladi. Oraliqlar ikkala qatorni birga simulyatsiya qilib topiladi ` +
        `(ularning tasodifiy og'ishlari orasidagi bog'liqlik ρ = ${num(rho)}).`,
      params: null,
      seasonal: null,
    };

    // Model qanday ishlaydi: natija = daromad − xarajat, har oy uchun tarkib
    const cleanedCount = (this.forecastUnit(panel, u, 'income', horizon).how?.cleaned.length ?? 0) + (this.forecastUnit(panel, u, 'expense', horizon).how?.cleaned.length ?? 0);
    base.how = {
      steps: [
        {
          title: 'Usul',
          text:
            "Natija alohida model bilan emas, ikki prognoz ayirmasi sifatida topiladi: natija = daromad prognozi − xarajat prognozi. " +
            "Shunda Prognoz, Solishtirma va hisobotlardagi raqamlar har doim bir-biriga qo'shiladi.",
        },
        { title: 'Daromad modeli', text: inc.zero ? "Daromad yozuvlari yo'q — nol olinadi." : `${MODEL_NAME[fitI.kind]}. ${explain(fitI)} Batafsil — «Daromad» tanlovida.` },
        { title: 'Xarajat modeli', text: exp.zero ? "Xarajat yozuvlari yo'q — nol olinadi." : `${MODEL_NAME[fitE.kind]}. ${explain(fitE)} Batafsil — «Xarajat» tanlovida.` },
        ...(cleanedCount > 0
          ? [{ title: 'Tozalash', text: `Daromad va xarajat qatorlarida jami ${cleanedCount} ta bir martalik keskin sakrash modelni o'rgatishda yumshatilgan (har biri o'z tanlovida ko'rsatilgan).` }]
          : []),
        {
          title: "Ehtimol oralig'i",
          text:
            `Daromad va xarajat birga 2000 marta simulyatsiya qilinadi; ularning tasodifiy og'ishlari o'zaro bog'liq (ρ = ${num(rho)}): ` +
            (rho > 0.3 ? "daromad oshgan oyda xarajat ham oshishga moyil — natija oralig'i shuning hisobiga torroq." : rho < -0.3 ? "biri oshganda ikkinchisi kamayishga moyil — natija oralig'i kengroq." : "bog'liqlik kuchsiz."),
        },
      ],
      candidates: [],
      chosenBy: 'combined',
      // Sakrashlar daromad va xarajat tanlovlarida alohida ko'rsatiladi
      cleaned: [],
      breakdown: {
        columns: [
          { key: 'income', label: 'Daromad prognozi', hint: "Daromad modeli bo'yicha" },
          { key: 'expense', label: '− Xarajat prognozi', hint: "Xarajat modeli bo'yicha (ayiriladi)" },
        ],
        rows: forecastPeriods.map((period, i) => {
          const vi = BigInt(inc.means[i]!);
          const ve = BigInt(exp.means[i]!);
          return { period, values: { income: vi.toString(), expense: (-ve).toString() }, sumTiyin: (vi - ve).toString(), meanTiyin: (vi - ve).toString(), note: null };
        }),
      },
      levels: [],
      intervals: null,
      horizon: [],
      coverage: null,
    };

    // Sinov: daromad va xarajat modellari bir xil oylarda sinaladi, natija = ayirma
    const holdout = y.length >= 12 ? 6 : y.length >= 8 ? 3 : 0;
    const yI = u.income.slice(startIndex, full);
    const yE = u.expense.slice(startIndex, full);
    if (holdout > 0) {
      const bi = backtestEts(yI, holdout, 12, true);
      const be = backtestEts(yE, holdout, 12, true);
      const byIndex = new Map(be.rows.map((r) => [r.index, r]));
      const rows = bi.rows.filter((r) => byIndex.has(r.index)).map((r) => ({ index: r.index, actual: r.actual - byIndex.get(r.index)!.actual, predicted: r.predicted - byIndex.get(r.index)!.predicted }));
      // Xato daromad hajmiga nisbatan (natija nolga yaqin bo'lishi mumkin); daromad yo'q birlikda — xarajatga nisbatan
      const incomeScale = rows.reduce((s, r) => s + Math.abs(yI[r.index]!), 0);
      const scale = incomeScale > 0 ? incomeScale : rows.reduce((s, r) => s + Math.abs(yE[r.index]!), 0);
      const err = rows.reduce((s, r) => s + Math.abs(r.actual - r.predicted), 0);
      const naive = rows.reduce((s, r) => s + Math.abs(r.actual - y[r.index - 1]!), 0);
      const wape = rows.length && scale > 0 ? err / scale : null;
      const naiveWape = rows.length && scale > 0 ? naive / scale : null;
      base.accuracy = {
        points: rows.length,
        wape,
        basis: incomeScale > 0 ? 'income' : 'value',
        naiveWape,
        skill: wape !== null && naiveWape ? (1 - wape / naiveWape) * 100 : null,
        rows: rows.map((r) => ({ period: periods[r.index]!, actualTiyin: tiyin(r.actual), predictedTiyin: tiyin(r.predicted) })),
      };
    }
    const wape = base.accuracy.wape;
    const reliability: Reliability = wape === null ? 'low' : y.length >= 18 && wape < 0.1 ? 'high' : y.length >= 9 && wape < 0.25 ? 'medium' : 'low';
    base.reliability = reliability;
    base.reliabilityText =
      RELIABILITY_LABEL[reliability] + (wape !== null ? ` — sinovda o'rtacha xato ${fmtPct(wape * 100)} (daromad hajmiga nisbatan)` : " — sinash uchun ma'lumot kam");

    // Yil yakuni: daromad va xarajat yil yakunlarining aynan ayirmasi
    const yi = inc.yearEnd;
    const ye = exp.yearEnd;
    const d = (a: string, b: string) => String(BigInt(a) - BigInt(b));
    const actualYear = Number(d(yi.actualTiyin, ye.actualTiyin)) / 100;
    const totals = totalOf(toDecember);
    const previousYear = yi.previousYearTiyin !== null && ye.previousYearTiyin !== null ? Number(d(yi.previousYearTiyin, ye.previousYearTiyin)) / 100 : null;
    base.yearEnd = {
      year,
      actualTiyin: d(yi.actualTiyin, ye.actualTiyin),
      currentPeriod: panel.currentPeriod,
      currentSoFarTiyin: d(yi.currentSoFarTiyin, ye.currentSoFarTiyin),
      currentExpectedTiyin: d(yi.currentExpectedTiyin, ye.currentExpectedTiyin),
      restTiyin: d(yi.restTiyin, ye.restTiyin),
      forecastTiyin: d(yi.forecastTiyin, ye.forecastTiyin),
      totalTiyin: d(yi.totalTiyin, ye.totalTiyin),
      lo80Tiyin: tiyin(actualYear + quantile(totals, 0.1)),
      hi80Tiyin: tiyin(actualYear + quantile(totals, 0.9)),
      previousYearTiyin: previousYear === null ? null : tiyin(previousYear),
    };

    // ─────────── Xulosalar ───────────
    const notes = base.notes;
    const next = base.forecast.slice(0, 3).map((f) => Number(f.meanTiyin) / 100);
    const near = totalOf(Math.min(3, steps));
    const nextAvg = mean(next);
    notes.push(
      `${u.name}: keyingi 3 oyda natija oyiga o'rtacha ${fmtSom(nextAvg)} bo'lishi kutilmoqda (80% ehtimol bilan ${fmtSom(quantile(near, 0.1) / 3)} – ${fmtSom(quantile(near, 0.9) / 3)}).`,
    );
    notes.push(`Oxirgi 3 oy o'rtacha natijasi: ${fmtSom(mean(y.slice(-3)))}.`);
    notes.push(`Keyingi 3 oy jamida zarar ehtimoli — ${fmtPct((near.filter((v) => v < 0).length / Math.max(1, near.length)) * 100, 0)}.`);
    if (currentIndex >= 0) {
      notes.push(
        `Joriy oy (${periodLabel(panel.currentPeriod)}) hali tugamagan: hozircha daromad ${fmtSom(soFarInc)}, xarajat ${fmtSom(soFarExp)} yozilgan; oy uchun kutilayotgan natija ${fmtSom(Number(base.yearEnd.currentExpectedTiyin) / 100)}.`,
      );
    }
    notes.push(
      yearNote(
        'natija',
        year,
        panel.currentPeriod,
        actualYear,
        Number(base.yearEnd.currentSoFarTiyin) / 100,
        Number(base.yearEnd.currentExpectedTiyin) / 100,
        Number(base.yearEnd.restTiyin) / 100,
        Number(base.yearEnd.lo80Tiyin) / 100,
        Number(base.yearEnd.hi80Tiyin) / 100,
        previousYear,
      ) + ` Bu daromad (${fmtSom(Number(yi.totalTiyin) / 100)}) − xarajat (${fmtSom(Number(ye.totalTiyin) / 100)}).`,
    );
    if (base.accuracy.points > 0 && wape !== null) {
      notes.push(
        `Sinov: oxirgi ${base.accuracy.points} oyni yashirib tekshirdik — daromad va xarajat modellari ayirmasi o'rtacha ${fmtPct(wape * 100)} xato qildi (daromad hajmiga nisbatan)` +
          (base.accuracy.naiveWape !== null ? `, oddiy usul ("o'tgan oy takrorlanadi") — ${fmtPct(base.accuracy.naiveWape * 100)}.` : '.'),
      );
    }
    if (reliability === 'low') {
      notes.push("Diqqat: prognoz taxminiy — ma'lumot kam yoki oylar orasida tebranish katta. Uni aniq reja sifatida emas, yo'nalish sifatida qabul qiling.");
    }
    return base;
  }

  // ═══════════════════════════════════════════════════════════
  // Barcha hududlar bo'yicha qisqa prognoz (jadval uchun)
  // ═══════════════════════════════════════════════════════════

  async unitsForecast(query: { target?: string; horizon?: string; asOf?: string }): Promise<UnitsForecastResult> {
    const target = this.parseTarget(query.target);
    const horizon = this.parseHorizon(query.horizon, 3);
    const panel = await this.data.panel(query.asOf);
    const full = EconData.fullCount(panel);
    const list = [panel.total, ...panel.units];

    // Bu ko'rsatkich umuman yo'q birliklar (masalan, daromadi yo'q Markaz) jadvalga kirmaydi
    const relevant = list.filter((u) => seriesOf(u, target).slice(0, full).some((v) => v !== 0));
    const units: UnitForecastSummary[] = relevant.map((u) => {
      const result = this.forecastUnit(panel, u, target, Math.max(3, horizon));
      const history = result.history.map((h) => Number(h.valueTiyin) / 100);
      const recent = history.slice(-3);
      const next = result.forecast.slice(0, 3);
      const recentAvg = recent.length ? mean(recent) : 0;
      const nextAvg = next.length ? mean(next.map((f) => Number(f.meanTiyin) / 100)) : 0;
      const spark = history.slice(-12);
      return {
        key: u.key,
        name: u.name,
        kind: u.kind,
        fullMonths: EconData.activeMonths(panel, u),
        recentAvgTiyin: tiyin(recentAvg),
        nextAvgTiyin: tiyin(nextAvg),
        nextLo80Tiyin: tiyin(next.length ? mean(next.map((f) => Number(f.lo80Tiyin) / 100)) : 0),
        nextHi80Tiyin: tiyin(next.length ? mean(next.map((f) => Number(f.hi80Tiyin) / 100)) : 0),
        changePercent: next.length && recentAvg !== 0 ? ((nextAvg - recentAvg) / Math.abs(recentAvg)) * 100 : null,
        yearEndTiyin: result.yearEnd?.totalTiyin ?? null,
        reliability: result.reliability,
        wape: result.accuracy.wape,
        model: result.model.name,
        spark: [...spark, ...next.map((f) => Number(f.meanTiyin) / 100)].map(tiyin),
        sparkForecastFrom: spark.length,
      };
    });

    // Xulosalar
    const notes: string[] = [];
    const word = target === 'income' ? 'daromadi' : target === 'expense' ? 'xarajati' : target === 'payroll' ? 'ish haqi xarajati' : 'natijasi';
    const regions = units.filter((x) => x.kind === 'region' && x.reliability !== 'none' && x.changePercent !== null);
    const good = (x: UnitForecastSummary) => (target === 'expense' || target === 'payroll' ? -(x.changePercent ?? 0) : x.changePercent ?? 0);
    if (target !== 'result' && regions.length >= 2) {
      const sorted = [...regions].sort((a, b) => good(b) - good(a));
      const best = sorted[0]!;
      const worst = sorted[sorted.length - 1]!;
      const direction = (x: UnitForecastSummary) => `${x.changePercent! > 0 ? '+' : '−'}${fmtPct(Math.abs(x.changePercent!))}`;
      const up = target === 'income';
      if (good(best) > 0) {
        notes.push(`Keyingi 3 oyda ${word} eng yaxshi ${up ? "o'sishi" : 'kamayishi'} kutilayotgan hudud — ${best.name} (${direction(best)}).`);
      } else {
        notes.push(
          `Keyingi 3 oyda barcha hududlarda ${word} ${up ? 'pasayishi' : "o'sishi"} kutilmoqda; eng kam ${up ? 'pasayish' : "o'sish"} — ${best.name} (${direction(best)}).`,
        );
      }
      if (good(worst) < 0 && worst.key !== best.key) {
        notes.push(
          `Eng ko'p ${up ? 'pasayishi' : "o'sishi"} kutilayotgan — ${worst.name} (${direction(worst)}). Bu hududni Munosabatga qo'shish mumkin.`,
        );
      }
      const falling = regions.filter((x) => good(x) < -10).length;
      if (falling >= Math.max(3, regions.length / 2)) {
        notes.push(`${falling} ta hududda ${word} 10% dan ko'proq ${up ? 'pasayishi' : "o'sishi"} kutilmoqda — bu umumiy (masalan, mavsumiy) holat bo'lishi mumkin: bunday paytda hududlarni bir-biri bilan solishtirish muhimroq.`);
      }
    }
    if (target === 'result') {
      const losing = units.filter((x) => x.kind === 'region' && x.reliability !== 'none' && Number(x.nextAvgTiyin) < 0);
      if (losing.length) notes.push(`Keyingi 3 oyda zarar kutilayotgan hududlar: ${losing.map((x) => x.name).join(', ')}.`);
      else notes.push('Keyingi 3 oyda hech bir hududda o\'rtacha zarar kutilmayapti.');
    }
    const weak = units.filter((x) => x.reliability === 'low' && x.kind !== 'total').length;
    if (weak > 0) notes.push(`${weak} ta birlik bo'yicha prognoz taxminiy (ma'lumot kam yoki tebranish katta).`);
    const none = units.filter((x) => x.reliability === 'none').length;
    if (none > 0) notes.push(`${none} ta birlikda prognoz uchun ma'lumot yetarli emas.`);
    notes.push(`Hisob ${full} ta tugagan oy asosida; joriy oy (${periodLabel(panel.currentPeriod)}) prognozning birinchi oyi.`);

    return {
      target,
      targetLabel: TARGET_LABEL[target],
      horizon,
      currentPeriod: panel.currentPeriod,
      units: units.filter((x) => x.kind !== 'unassigned' || x.fullMonths > 0),
      notes,
    };
  }
}