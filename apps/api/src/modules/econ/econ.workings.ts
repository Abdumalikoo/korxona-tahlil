import type { BreakevenUnit, EfficiencyUnit, FactorsResult, ForecastResult, ModelTable, RiskUnit } from './econ.types';

// ═══════════════════════════════════════════════════════════
// Katta modellar — hisob-kitob ishlanishi (Excel va slaydlar uchun).
// Saytdagi «Qanday hisoblandi?» (web: features/econ/calcs.ts) bilan bir xil formulalar.
// ═══════════════════════════════════════════════════════════

export interface Working {
  /** Qaysi qator (hudud, oy, omil) */
  subject: string;
  title: string;
  formula: string;
  steps: string[];
  result: string;
}

const NBSP = ' ';
const MINUS = '−';
const SIM_PATHS = 2000;

function group(v: number): string {
  return Math.abs(Math.round(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Tiyin → to'liq so'm */
function full(tiyin: number, unit = true): string {
  const v = Math.round(tiyin / 100);
  return `${v < 0 ? MINUS : ''}${group(v)}${unit ? `${NBSP}so'm` : ''}`;
}

function dec(v: number, d = 2): string {
  return `${v < 0 ? MINUS : ''}${Math.abs(v).toFixed(d).replace('.', ',')}`;
}

function pct(v: number, sign = false): string {
  return `${sign && v > 0 ? '+' : v < 0 ? MINUS : ''}${Math.abs(v).toFixed(1).replace('.', ',')}%`;
}

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
function month(period: string): string {
  return `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
}

/** Har model sahifasi ostidagi asosiy formulalar */
export const MODEL_FORMULAS = {
  forecast: [
    "Xato e = Haqiqiy − Prognoz; Daraja(t) = Daraja(t−1) + φ×Trend(t−1) + α×e; Trend(t) = φ×Trend(t−1) + β×e; mavsumiy modelda Mavsum(oy) += γ×e",
    "Prognoz(h) = Daraja + (φ + φ² + … + φʰ)×Trend (+ Mavsum); 80% oraliq — 2000 ta simulyatsiya yo'lining 10% va 90% kvantillari",
    'Yil jami = Tugagan oylar (haqiqiy) + Joriy oy (max(yozilgan, prognoz)) + Qolgan oylar (prognoz)',
    "Sinov xatosi WAPE = Σ|Haqiqiy − Model| ÷ Σ|Haqiqiy| × 100; ustunlik = (1 − WAPE ÷ oddiy usul WAPE) × 100",
  ],
  factors: [
    'Daromad = a + b₁×Omil₁ + b₂×Omil₂ + … (eng kichik kvadratlar); FE — har hudud o\'z o\'zgarmasi bilan',
    "t = b ÷ SE; 95% oraliq = b ± t* × SE; p < 0,05 — kuchli, p < 0,10 — zaif",
    "Hudud ta'siri = Haqiqiy oylik daromad − Resurslarga ko'ra kutilgan daromad",
    "Kobb-Duglas: ln(Daromad) = ln A + α×ln(Xodimlar) + β×ln(Xarajat) + trend; α + β > 1 — o'suvchi miqyos",
  ],
  efficiency: [
    "Samaradorlik (DEA, CRS) = hudud daromadi ÷ shu resurslar bilan namuna hududlar kombinatsiyasi oladigan daromad",
    'Miqyos = CRS ÷ VRS; Imkoniyat = Daromad ÷ CRS; Farq = Imkoniyat − Daromad; Daromad/xarajat = Daromad ÷ Xarajat',
  ],
  breakeven: [
    "Xarajat = F + v × Daromad (regressiya); Zararsizlik = F ÷ (1 − v)",
    'Xavfsizlik zaxirasi = (Daromad − Zararsizlik) ÷ Daromad; Leverej = Daromad×(1 − v) ÷ Foyda',
  ],
  risk: [
    `Daromad va xarajat o'zaro bog'liqligi bilan ${SIM_PATHS} marta simulyatsiya qilinadi`,
    `Ehtimollik = (holat yuz bergan yo'llar) ÷ ${SIM_PATHS} × 100; 10%/90% — natijalar kvantillari`,
  ],
};

// ─────────── Prognoz ───────────

export function forecastWorkings(f: ForecastResult, subject: string): Working[] {
  const out: Working[] = [];
  const p = f.model.params;
  const kind = f.model.kind;
  const params =
    !p || kind === 'mean' || kind === 'combined'
      ? []
      : kind === 'ses'
        ? [`α = ${dec(p.alpha)}`]
        : kind === 'holt'
          ? [`α = ${dec(p.alpha)}; β = ${dec(p.beta, 3)}; φ = ${dec(p.phi)}`]
          : [`α = ${dec(p.alpha)}; β = ${dec(p.beta, 3)}; φ = ${dec(p.phi)}; γ = ${dec(p.gamma)}`];
  out.push({
    subject,
    title: `Model: ${f.model.name}`,
    formula:
      kind === 'combined'
        ? 'Natija prognozi = Daromad prognozi − Xarajat prognozi'
        : kind === 'mean'
          ? "Prognoz = o'tgan oylar o'rtachasi"
          : kind === 'ses'
            ? 'Xato e = Haqiqiy − Prognoz; Daraja(t) = Daraja(t−1) + α×e; Prognoz = oxirgi Daraja'
            : MODEL_FORMULAS.forecast[0]!,
    steps: params.length ? params : [kind === 'combined' ? "Daromad va xarajat o'z modellari bilan alohida" : "Parametr yo'q"],
    result: f.model.name,
  });
  for (const point of f.forecast.slice(0, 3)) {
    out.push({
      subject,
      title: `${month(point.period)}: prognoz`,
      formula: "Model prognozi; 80% oraliq — simulyatsiya kvantillari",
      steps: [
        `80% oraliq: ${full(Number(point.lo80Tiyin), false)} – ${full(Number(point.hi80Tiyin), false)}`,
        ...(point.actualSoFarTiyin ? [`Joriy oyda hozircha yozilgan: ${full(Number(point.actualSoFarTiyin))} (prognoz undan kam bo'lmaydi)`] : []),
      ],
      result: full(Number(point.meanTiyin)),
    });
  }
  const ye = f.yearEnd;
  if (ye) {
    out.push({
      subject,
      title: `${ye.year}-yil jami`,
      formula: MODEL_FORMULAS.forecast[2]!,
      steps: [
        `= ${full(Number(ye.actualTiyin), false)} + ${full(Number(ye.currentExpectedTiyin), false)} + ${full(Number(ye.restTiyin), false)}`,
        `80% oraliq: ${full(Number(ye.lo80Tiyin), false)} – ${full(Number(ye.hi80Tiyin), false)}`,
      ],
      result: full(Number(ye.totalTiyin)),
    });
  }
  const acc = f.accuracy;
  if (acc.wape !== null && acc.rows.length) {
    const err = acc.rows.reduce((s, r) => s + Math.abs(Number(r.actualTiyin) - Number(r.predictedTiyin)), 0);
    // Natija uchun xato daromad hajmiga nisbatan olinadi (backend: basis = 'income')
    const act = acc.basis === 'income' ? err / acc.wape : acc.rows.reduce((s, r) => s + Math.abs(Number(r.actualTiyin)), 0);
    const paren = (v: number) => (v < 0 ? `(${full(v, false)})` : full(v, false));
    out.push({
      subject,
      title: 'Sinov xatosi (WAPE)',
      formula: acc.basis === 'income' ? 'Σ|Haqiqiy − Model| ÷ Σ Daromad (shu oylar) × 100' : 'Σ|Haqiqiy − Model| ÷ Σ|Haqiqiy| × 100',
      steps: [
        ...acc.rows.map((r) => `${month(r.period)}: |${paren(Number(r.actualTiyin))} − ${paren(Number(r.predictedTiyin))}| = ${full(Math.abs(Number(r.actualTiyin) - Number(r.predictedTiyin)), false)}`),
        `= ${full(err, false)} ÷ ${full(act, false)} × 100`,
        ...(acc.naiveWape !== null && acc.skill !== null ? [`Oddiy usul xatosi ${pct(acc.naiveWape * 100)}; ustunlik ${pct(acc.skill)}`] : []),
      ],
      result: pct(acc.wape * 100),
    });
  }
  return out;
}

// ─────────── Omillar ───────────

export function coefWorkings(model: ModelTable, factors: FactorsResult['factors']): Working[] {
  return model.coefficients.map((c) => {
    const per = factors.find((x) => x.key === c.key)?.unit === 'kishi' ? 1 : 1e6;
    const unit = per === 1 ? "so'm / 1 kishi" : "so'm / 1 mln so'm";
    // Koeffitsient so'mda: xodim uchun — 1 kishiga, pul omili uchun — 1 mln so'mga
    const v = (x: number) => `${x < 0 ? MINUS : ''}${group(x * per)}`;
    const tCrit = c.se > 0 ? (c.hi95 - c.value) / c.se : 0;
    return {
      subject: c.label,
      title: `${c.label} (${unit})`,
      formula: 't = b ÷ SE; 95% oraliq = b ± t* × SE',
      steps: [
        `b = ${v(c.value)}; SE = ${v(c.se)}`,
        `t = ${dec(c.t)}; t* = ${dec(tCrit, 3)}`,
        `95% oraliq = ${v(c.lo95)} … ${v(c.hi95)}`,
        `p = ${c.p < 0.001 ? '< 0,001' : dec(c.p, 3)}`,
      ],
      result: `${v(c.value)} ${unit}`,
    };
  });
}

export function unitEffectWorkings(f: FactorsResult): Working[] {
  return f.unitEffects.map((u) => ({
    subject: u.name,
    title: "Hudud ta'siri (oyiga)",
    formula: "Haqiqiy − Kutilgan",
    steps: [`= ${full(Number(u.actualTiyin), false)} − ${full(Number(u.expectedTiyin), false)}`, `${u.months} oy o'rtachasi`],
    result: full(Number(u.effectTiyin)),
  }));
}

// ─────────── Samaradorlik ───────────

export function efficiencyWorkings(u: EfficiencyUnit): Working {
  const inc = Number(u.incomeTiyin);
  return {
    subject: u.name,
    title: 'Samaradorlik va imkoniyat',
    formula: 'Imkoniyat = Daromad ÷ CRS; Miqyos = CRS ÷ VRS',
    steps: [
      u.peers.length ? `Namuna: ${u.peers.map((p) => `${p.name} ×${dec(p.weight, 3)}`).join(', ')}` : "O'zi chegarada (namuna)",
      `Imkoniyat = ${full(inc, false)} ÷ ${dec(u.crs, 4)} = ${full(Number(u.potentialIncomeTiyin))}`,
      `Farq = ${full(Number(u.potentialIncomeTiyin), false)} − ${full(inc, false)} = ${full(Number(u.gapTiyin))}`,
      `Miqyos = ${dec(u.crs, 3)} ÷ ${dec(u.vrs, 3)} = ${dec(u.scale, 3)}`,
      ...(u.roi !== null ? [`Daromad/xarajat = ${full(inc, false)} ÷ ${full(Number(u.expenseTiyin), false)} = ${dec(u.roi)}`] : []),
    ],
    result: `CRS ${pct(u.crs * 100)}`,
  };
}

// ─────────── Zararsizlik ───────────

export function breakevenWorkings(u: BreakevenUnit): Working | null {
  if (!u.breakevenTiyin || u.fixedTiyin === null || u.variableRate === null) return null;
  const F = Number(u.fixedTiyin);
  const v = u.variableRate;
  const be = Number(u.breakevenTiyin);
  const avgI = Number(u.avgIncomeTiyin);
  const contribution = avgI * (1 - v);
  return {
    subject: u.name,
    title: 'Zararsizlik nuqtasi',
    formula: 'F ÷ (1 − v); zaxira = (Daromad − Zararsizlik) ÷ Daromad',
    steps: [
      `F = ${full(F)}; v = ${dec(v, 4)} (${u.method === 'regression' ? `regressiya, R² = ${dec(u.r2 ?? 0)}` : 'hammasi doimiy deb olindi'})`,
      `Zararsizlik = ${full(F, false)} ÷ (1 − ${dec(v, 4)}) = ${full(be)}`,
      `Zaxira = (${full(avgI, false)} − ${full(be, false)}) ÷ ${full(avgI, false)} × 100 = ${pct((u.safetyMargin ?? 0) * 100)}`,
      ...(u.leverage !== null ? [`Leverej = ${full(contribution, false)} ÷ ${full(contribution - F, false)} = ${dec(u.leverage, 1)}`] : []),
    ],
    result: `${full(be)} oyiga`,
  };
}

// ─────────── Risk ───────────

export function riskWorkings(u: RiskUnit): Working {
  return {
    subject: u.name,
    title: 'Zarar ehtimoli',
    formula: `Natijasi < 0 bo'lgan yo'llar ÷ ${SIM_PATHS} × 100`,
    steps: [
      `${Math.round(u.lossProbability * SIM_PATHS)} ÷ ${SIM_PATHS} × 100 = ${pct(u.lossProbability * 100)}`,
      `Kamida 1 oy zarar: ${Math.round(u.anyMonthLossProbability * SIM_PATHS)} ÷ ${SIM_PATHS} = ${pct(u.anyMonthLossProbability * 100)}`,
      `Kutilgan natija ${full(Number(u.expectedResultTiyin))}; 10%–90%: ${full(Number(u.p10Tiyin), false)} … ${full(Number(u.p90Tiyin), false)}`,
    ],
    result: pct(u.lossProbability * 100),
  };
}