import { calcChange, decimalText, moneyText, pctText, Q, type Calc } from '@/lib/calc';
import { formatPeriod } from '@/lib/format';
import type { BreakevenUnit, EfficiencyUnit, FactorCoef, ForecastPoint, ForecastResult, ScenarioResult } from './api';

type YearEnd = NonNullable<ForecastResult['yearEnd']>;

// ═══════════════════════════════════════════════════════════
// Katta modellar — «Qanday hisoblandi?»
// Formulalar backend (apps/api/src/modules/econ) bilan aynan bir xil:
//   econ.math.ts (ETS, simulyatsiya, sinov), econ.efficiency.ts (DEA, zararsizlik),
//   econ.regress / econ.factors (regressiya), econ.scenario.ts (stsenariy)
// ═══════════════════════════════════════════════════════════

const SIM_PATHS = 2000;

const n2 = (v: number, d = 2) => decimalText(v, d);

// ─────────── Prognoz ───────────

/** O'rtacha (oylar ro'yxatidan) */
export function avgOfCalc(title: string, rows: { label: string; tiyin: number }[], note?: string): Calc {
  const total = rows.reduce((s, r) => s + r.tiyin, 0);
  const avg = rows.length ? total / rows.length : 0;
  return {
    title,
    formula: `${title} = (${rows.length} oy yig'indisi) ÷ ${rows.length}`,
    inputs: rows.map((r) => Q.money(r.label, r.tiyin)),
    steps: [`Yig'indi = ${rows.map((r) => moneyText(r.tiyin, false)).join(' + ')} = ${moneyText(total)}`, `= ${moneyText(total, false)} ÷ ${rows.length}`, `= ${moneyText(avg)}`],
    result: moneyText(avg),
    note,
    formulaId: 'mean',
  };
}

/** Model formulasi (tanlangan usul) — oddiy tilda va parametrlar bilan */
export function modelFormula(data: ForecastResult): string {
  const p = data.model.params;
  const a = p ? n2(p.alpha) : 'α';
  const b = p ? n2(p.beta, 3) : 'β';
  const f = p ? n2(p.phi) : 'φ';
  const g = p ? n2(p.gamma) : 'γ';
  switch (data.model.kind) {
    case 'mean':
      return "Prognoz = o'tgan oylar o'rtachasi (aniq qonuniyat topilmadi)";
    case 'ses':
      return `Xato e = Haqiqiy − Prognoz; Daraja(t) = Daraja(t−1) + ${a}×e; Prognoz = oxirgi Daraja`;
    case 'holt':
      return `Xato e = Haqiqiy − Prognoz; Daraja(t) = Daraja(t−1) + ${f}×Trend(t−1) + ${a}×e; Trend(t) = ${f}×Trend(t−1) + ${b}×e; Prognoz(h) = Daraja + (${f} + ${f}² + … + ${f}ʰ)×Trend`;
    case 'seasonal':
      return `Xato e = Haqiqiy − Prognoz; Daraja(t) = Daraja(t−1) + ${f}×Trend(t−1) + ${a}×e; Trend(t) = ${f}×Trend(t−1) + ${b}×e; Mavsum(oy) = Mavsum(oy) + ${g}×e; Prognoz(h) = Daraja + (${f} + … + ${f}ʰ)×Trend + Mavsum(oy)`;
    case 'combined':
      return "Natija prognozi = Daromad prognozi − Xarajat prognozi (har biri o'z modeli bilan)";
    default:
      return "Ma'lumot yetarli emas";
  }
}

/** Bitta oy prognozi va 80% oraliq */
export function pointCalc(data: ForecastResult, point: ForecastPoint): Calc {
  const mean = Number(point.meanTiyin);
  return {
    title: `${formatPeriod(point.period)}: prognoz`,
    formula: modelFormula(data),
    inputs: [
      Q.money('Prognoz (eng ehtimolli)', mean),
      Q.money('80% oraliq — quyi', point.lo80Tiyin),
      Q.money('80% oraliq — yuqori', point.hi80Tiyin),
      ...(point.actualSoFarTiyin ? [Q.money('Joriy oyda hozircha yozilgan', point.actualSoFarTiyin)] : []),
    ],
    steps: [
      `Model: ${data.model.name}`,
      `Oraliq: modelning tasodifiy xatosi bilan ${SIM_PATHS} ta ehtimoliy yo'l simulyatsiya qilinadi`,
      `80% oraliq = shu oy qiymatlarining 10% va 90% kvantillari: ${moneyText(Number(point.lo80Tiyin), false)} – ${moneyText(Number(point.hi80Tiyin), false)}`,
      ...(point.actualSoFarTiyin ? [`Joriy oy hozircha yozilgandan kam bo'la olmaydi: ≥ ${moneyText(Number(point.actualSoFarTiyin))}`] : []),
    ],
    result: moneyText(mean),
    note: "Haqiqiy qiymat 10 holatdan 8 tasida 80% oralig'iga tushadi.",
  };
}

/** Keyingi 3 oy o'rtachasining oxirgi 3 oyga nisbatan o'zgarishi */
export function nextVsRecentCalc(data: ForecastResult): Calc {
  const next3 = data.forecast.slice(0, 3);
  const recent = data.history.slice(-3);
  const nextAvg = next3.reduce((s, f) => s + Number(f.meanTiyin), 0) / Math.max(1, next3.length);
  const recentAvg = recent.reduce((s, h) => s + Number(h.valueTiyin), 0) / Math.max(1, recent.length);
  const c = calcChange("Keyingi 3 oy: o'zgarish", Q.money("Keyingi 3 oy o'rtachasi", nextAvg), Q.money("Oxirgi 3 oy o'rtachasi", recentAvg));
  return {
    ...c,
    steps: [
      `Keyingi 3 oy o'rtachasi = (${next3.map((f) => moneyText(Number(f.meanTiyin), false)).join(' + ')}) ÷ ${next3.length} = ${moneyText(nextAvg)}`,
      `Oxirgi 3 oy o'rtachasi = (${recent.map((h) => moneyText(Number(h.valueTiyin), false)).join(' + ')}) ÷ ${recent.length} = ${moneyText(recentAvg)}`,
      ...c.steps,
    ],
  };
}

/** Yil jami: haqiqiy + joriy oy + qolgan oylar prognozi */
export function yearEndCalc(ye: YearEnd): Calc {
  const actual = Number(ye.actualTiyin);
  const cur = Number(ye.currentExpectedTiyin);
  const rest = Number(ye.restTiyin);
  return {
    title: `${ye.year}-yil jami (taxmin)`,
    formula: 'Yil jami = Tugagan oylar (haqiqiy) + Joriy oy (kutilgan) + Qolgan oylar (prognoz)',
    inputs: [
      Q.money('Tugagan oylar — haqiqiy', actual),
      Q.money('Joriy oyda hozircha yozilgan', ye.currentSoFarTiyin),
      Q.money('Joriy oy — kutilgan', cur),
      Q.money('Qolgan oylar — prognoz', rest),
    ],
    steps: [
      `Joriy oy kutilgani = max(hozircha yozilgan, joriy oy prognozi) = ${moneyText(cur)}`,
      `= ${moneyText(actual, false)} + ${moneyText(cur, false)} + ${moneyText(rest, false)}`,
      `= ${moneyText(Number(ye.totalTiyin))}`,
      `80% oraliq (simulyatsiyadagi yil jamilari 10%–90%): ${moneyText(Number(ye.lo80Tiyin), false)} – ${moneyText(Number(ye.hi80Tiyin), false)}`,
    ],
    result: moneyText(Number(ye.totalTiyin)),
    note: ye.previousYearTiyin ? `O'tgan yil jami: ${moneyText(Number(ye.previousYearTiyin))}` : undefined,
    formulaId: 'sum',
  };
}

/** Sinov xatosi (WAPE) va oddiy usul bilan solishtirish */
export function wapeCalc(data: ForecastResult): Calc | null {
  const acc = data.accuracy;
  if (acc.wape === null || acc.rows.length === 0) return null;
  const rows = acc.rows.map((r) => ({ period: r.period, a: Number(r.actualTiyin), p: Number(r.predictedTiyin) }));
  const absErr = rows.reduce((s, r) => s + Math.abs(r.a - r.p), 0);
  // Natija uchun xato daromad hajmiga nisbatan olinadi (backend: basis = 'income')
  const absAct = acc.basis === 'income' ? absErr / acc.wape : rows.reduce((s, r) => s + Math.abs(r.a), 0);
  return {
    title: "Sinovdagi o'rtacha xato (WAPE)",
    formula: acc.basis === 'income' ? 'WAPE = Σ|Haqiqiy − Model aytgan| ÷ Σ Daromad (shu oylar) × 100' : "WAPE = Σ|Haqiqiy − Model aytgan| ÷ Σ|Haqiqiy| × 100",
    inputs: rows.flatMap((r) => [Q.money(`${formatPeriod(r.period)} — haqiqiy`, r.a), Q.money(`${formatPeriod(r.period)} — model`, r.p)]),
    steps: [
      `Xatolar: ${rows.map((r) => moneyText(Math.abs(r.a - r.p), false)).join(' + ')} = ${moneyText(absErr)}`,
      acc.basis === 'income'
        ? `Shu oylardagi daromad hajmi = ${moneyText(absAct)}`
        : `Haqiqiylar: ${rows.map((r) => moneyText(Math.abs(r.a), false)).join(' + ')} = ${moneyText(absAct)}`,
      `= ${moneyText(absErr, false)} ÷ ${moneyText(absAct, false)} × 100 = ${pctText(acc.wape * 100)}`,
      ...(acc.naiveWape !== null && acc.skill !== null
        ? [`Oddiy usul («o'tgan oy takrorlanadi») xatosi ${pctText(acc.naiveWape * 100)}; aniqlik ustunligi = (1 − ${n2(acc.wape, 4)} ÷ ${n2(acc.naiveWape, 4)}) × 100 = ${pctText(acc.skill)}`]
        : []),
    ],
    result: pctText(acc.wape * 100),
    note: `Har bir sinalgan oy uchun model faqat undan oldingi oylarni ko'rib o'rgatilgan. Ishonchlilik: xato < 10% va ≥ 18 oy — ishonchli; < 25% va ≥ 9 oy — o'rtacha; aks holda — taxminiy.${acc.basis === 'income' ? ' Natija uchun xato daromad hajmiga nisbatan olinadi.' : ''}`,
  };
}

// ─────────── Omillar (regressiya) ───────────

/**
 * Koeffitsient: t = b ÷ SE, 95% oraliq = b ± t* × SE.
 * fmt — sahifadagi ko'rinish (masalan, «1 kishiga so'm» yoki «1 mln so'mga»), sonlar shu birlikda ko'rsatiladi.
 */
export function coefCalc(c: FactorCoef, fmt: (value: number) => string, unitWord: string): Calc {
  const tCrit = c.se > 0 ? (c.hi95 - c.value) / c.se : 0;
  return {
    title: `${c.label}: ta'sir`,
    formula: 'Daromad = a + b₁×Omil₁ + b₂×Omil₂ + … (eng kichik kvadratlar usuli); t = b ÷ SE; 95% oraliq = b ± t* × SE',
    inputs: [],
    steps: [
      `b (ta'sir) = ${fmt(c.value)} ${unitWord}`,
      `SE (standart xato) = ${fmt(c.se)}`,
      `t = b ÷ SE = ${n2(c.t)}`,
      `95% oraliq = b ± ${n2(tCrit, 3)} × SE = ${fmt(c.lo95)} … ${fmt(c.hi95)}`,
      `p = ${c.p < 0.001 ? '< 0,001' : n2(c.p, 3)} → ${c.significance === 'strong' ? 'kuchli (p < 0,05)' : c.significance === 'weak' ? 'zaif (p < 0,10)' : 'ahamiyatsiz (p ≥ 0,10)'}`,
    ],
    result: `${fmt(c.value)} ${unitWord}`,
    note: c.meaning,
  };
}

/** Hudud ta'siri: haqiqiy − resurslarga ko'ra kutilgan */
export function unitEffectCalc(u: { name: string; effectTiyin: string; actualTiyin: string; expectedTiyin: string; months: number }): Calc {
  return {
    title: `${u.name}: hudud ta'siri`,
    formula: "Hudud ta'siri = Haqiqiy oylik daromad − Resurslarga ko'ra kutilgan oylik daromad",
    inputs: [Q.money("Haqiqiy (oylik o'rtacha)", u.actualTiyin), Q.money("Kutilgan (modeldan)", u.expectedTiyin), Q.count('Oylar', u.months)],
    steps: [`= ${moneyText(Number(u.actualTiyin), false)} − ${moneyText(Number(u.expectedTiyin), false)}`, `= ${moneyText(Number(u.effectTiyin))}`],
    result: `${moneyText(Number(u.effectTiyin))} oyiga`,
    note: "Kutilgan = hudud o'rtacha omillari (xodimlar, xarajatlar) × koeffitsientlar. Musbat — resurslariga nisbatan ko'proq daromad qilmoqda.",
    formulaId: 'delta',
  };
}

// ─────────── Samaradorlik (DEA) ───────────

export function efficiencyCalc(u: EfficiencyUnit): Calc {
  return {
    title: `${u.name}: samaradorlik`,
    formula: "Samaradorlik (DEA) = hudud daromadi ÷ shu resurslar bilan eng yaxshi hududlar kombinatsiyasi olishi mumkin bo'lgan daromad",
    inputs: [
      Q.money("Oylik daromad", u.incomeTiyin),
      Q.money('Oylik xarajat', u.expenseTiyin),
      { label: 'Xodimlar', value: u.headcount, kind: 'ratio' },
      { label: 'Doimiy miqyos (CRS)', value: u.crs * 100, kind: 'pct' },
      { label: 'Hajm hisobga olingan (VRS)', value: u.vrs * 100, kind: 'pct' },
    ],
    steps: [
      u.peers.length ? `Namuna hududlar (vazni): ${u.peers.map((p) => `${p.name} ×${n2(p.weight, 3)}`).join(', ')}` : "Hududning o'zi chegarada (namuna)",
      'Har hudud uchun chiziqli dasturlash masalasi yechiladi',
      `Miqyos samaradorligi = CRS ÷ VRS = ${n2(u.crs, 3)} ÷ ${n2(u.vrs, 3)} = ${n2(u.scale, 3)}`,
      `Holat: ${u.crs >= 0.999 ? '≥ 99,9% — chegarada' : u.crs >= 0.9 ? '≥ 90% — chegaraga yaqin' : u.crs >= 0.7 ? '70–90% — o\'rtacha' : '< 70% — past'}`,
    ],
    result: pctText(u.crs * 100),
  };
}

export function potentialCalc(u: EfficiencyUnit): Calc {
  const inc = Number(u.incomeTiyin);
  const pot = Number(u.potentialIncomeTiyin);
  return {
    title: `${u.name}: imkoniyat`,
    formula: "Imkoniyat = Oylik daromad ÷ Samaradorlik (CRS); Farq = Imkoniyat − Daromad",
    inputs: [Q.money('Oylik daromad', inc), { label: 'Samaradorlik (CRS)', value: u.crs * 100, kind: 'pct' }],
    steps: [`Imkoniyat = ${moneyText(inc, false)} ÷ ${n2(u.crs, 4)} = ${moneyText(pot)}`, `Farq = ${moneyText(pot, false)} − ${moneyText(inc, false)} = ${moneyText(Number(u.gapTiyin))}`],
    result: `+${moneyText(Number(u.gapTiyin))} oyiga`,
    note: 'Namuna hududlar kabi ishlaganda shu resurslar bilan olinishi mumkin bo\'lgan daromad.',
  };
}

export function roiCalc(u: EfficiencyUnit): Calc | null {
  if (u.roi === null) return null;
  return {
    title: `${u.name}: daromad / xarajat`,
    formula: 'Nisbat = Oylik daromad ÷ Oylik xarajat',
    inputs: [Q.money('Oylik daromad', u.incomeTiyin), Q.money('Oylik xarajat', u.expenseTiyin)],
    steps: [`= ${moneyText(Number(u.incomeTiyin), false)} ÷ ${moneyText(Number(u.expenseTiyin), false)}`, `= ${n2(u.roi)}`],
    result: `${n2(u.roi)} barobar`,
    note: "1 dan katta — har so'm xarajatga bir so'mdan ko'p daromad.",
    formulaId: 'ratio',
  };
}

// ─────────── Zararsizlik ───────────

export function breakevenCalc(u: BreakevenUnit): Calc | null {
  if (!u.breakevenTiyin || u.fixedTiyin === null || u.variableRate === null) return null;
  const F = Number(u.fixedTiyin);
  const v = u.variableRate;
  const be = Number(u.breakevenTiyin);
  const avgI = Number(u.avgIncomeTiyin);
  const contribution = avgI * (1 - v);
  const profit = contribution - F;
  return {
    title: `${u.name}: zararsizlik nuqtasi`,
    formula: 'Xarajat = F + v × Daromad; Zararsizlik = F ÷ (1 − v); Xavfsizlik zaxirasi = (Daromad − Zararsizlik) ÷ Daromad',
    inputs: [
      Q.money("Doimiy xarajat (F), oyiga", F, u.method === 'regression' ? `regressiya, R² = ${n2(u.r2 ?? 0)}` : "bog'liqlik topilmadi — hammasi doimiy"),
      { label: "O'zgaruvchan ulush (v)", value: v, kind: 'ratio' },
      Q.money("O'rtacha oylik daromad", avgI),
    ],
    steps: [
      `Zararsizlik = ${moneyText(F, false)} ÷ (1 − ${n2(v, 4)}) = ${moneyText(be)}`,
      `Xavfsizlik zaxirasi = (${moneyText(avgI, false)} − ${moneyText(be, false)}) ÷ ${moneyText(avgI, false)} × 100 = ${pctText((u.safetyMargin ?? 0) * 100)}`,
      ...(u.leverage !== null
        ? [`Leverej = Daromad×(1 − v) ÷ Foyda = ${moneyText(contribution, false)} ÷ ${moneyText(profit, false)} = ${n2(u.leverage, 1)}`]
        : []),
    ],
    result: `${moneyText(be)} oyiga`,
    note: u.leverage !== null ? `Daromad 10% o'zgarsa, foyda ~${pctText(u.leverage * 10, 0)} o'zgaradi.` : undefined,
  };
}

// ─────────── Stsenariy ───────────

export function expenseFactorCalc(r: ScenarioResult): Calc {
  const s = r.shares;
  const c = r.changes;
  const rest = Math.max(0, 1 - s.payroll - s.lease - s.vehicle - s.other);
  const payF = (1 + c.headcount) * (1 + c.wage);
  return {
    title: "Xarajat ko'paytuvchisi",
    formula: "K = Ish haqi ulushi × (1 + xodimlar)×(1 + maosh) + Ijara ulushi × (1 + ijara) + Mashina ulushi × (1 + mashina) + Boshqa ulushi × (1 + boshqa) + qolgan ulush",
    inputs: [
      { label: 'Ish haqi ulushi', value: s.payroll * 100, kind: 'pct' },
      { label: 'Ijara ulushi', value: s.lease * 100, kind: 'pct' },
      { label: 'Mashinalar ulushi', value: s.vehicle * 100, kind: 'pct' },
      { label: 'Boshqa ulushi', value: s.other * 100, kind: 'pct' },
    ],
    steps: [
      `Ish haqi omili = (1 ${c.headcount >= 0 ? '+' : '−'} ${n2(Math.abs(c.headcount), 3)}) × (1 ${c.wage >= 0 ? '+' : '−'} ${n2(Math.abs(c.wage), 3)}) = ${n2(payF, 4)}`,
      `K = ${n2(s.payroll, 4)}×${n2(payF, 4)} + ${n2(s.lease, 4)}×${n2(1 + c.lease, 4)} + ${n2(s.vehicle, 4)}×${n2(1 + c.vehicle, 4)} + ${n2(s.other, 4)}×${n2(1 + c.other, 4)} + ${n2(rest, 4)}`,
      `= ${n2(r.expenseFactor, 4)}`,
    ],
    result: `${n2(r.expenseFactor, 4)} (xarajat ${pctText((r.expenseFactor - 1) * 100, 1, true)})`,
    note: 'Ulushlar — oxirgi oylardagi xarajat tarkibidan. Har oylik xarajat shu songa ko\'paytiriladi (birinchi, joriy oydan tashqari).',
  };
}

export function incomeFactorCalc(r: ScenarioResult): Calc {
  const c = r.changes;
  const s = r.shares;
  const np = s.lease + s.vehicle + s.other;
  const npChange = np > 0 ? (s.lease * c.lease + s.vehicle * c.vehicle + s.other * c.other) / np : 0;
  const eh = r.elasticity.headcount.used ? r.elasticity.headcount.value : 0;
  const ek = r.elasticity.nonpayroll.used ? r.elasticity.nonpayroll.value : 0;
  const f = (1 + c.income) * Math.pow(1 + c.headcount, eh) * Math.pow(1 + npChange, ek);
  return {
    title: "Daromad ko'paytuvchisi (o'rtacha)",
    formula: "D = (1 + daromad o'zgarishi) × (1 + xodimlar)^eₓ × (1 + boshqa xarajatlar)^eₖ  — e: Omillar modelidagi elastikliklar",
    inputs: [
      { label: "Xodimlar elastikligi (eₓ)", value: eh, kind: 'ratio', source: r.elasticity.headcount.used ? 'Omillar tahlili' : 'ishlatilmadi (ahamiyatsiz yoki o\'chirilgan)' },
      { label: 'Xarajat elastikligi (eₖ)', value: ek, kind: 'ratio', source: r.elasticity.nonpayroll.used ? 'Omillar tahlili' : 'ishlatilmadi' },
    ],
    steps: [
      `Boshqa xarajatlar o'zgarishi (vaznli) = ${n2(npChange, 4)}`,
      `D = ${n2(1 + c.income, 4)} × ${n2(1 + c.headcount, 4)}^${n2(eh, 3)} × ${n2(1 + npChange, 4)}^${n2(ek, 3)}`,
      `= ${n2(f, 4)}`,
    ],
    result: `${n2(f, 4)} (daromad ${pctText((f - 1) * 100, 1, true)})`,
    note: "Har bir simulyatsiya yo'lida elastiklik o'z noaniqligi bilan tanlanadi — shuning uchun natija oralig'i kengayadi.",
  };
}

export function scenarioTotalCalc(r: ScenarioResult): Calc {
  const b = Number(r.totals.baseline.resultTiyin);
  const sc = Number(r.totals.scenario.resultTiyin);
  return {
    title: 'Stsenariy natijasi',
    formula: "Natija = Σ (Daromad − Xarajat) muddat oylari bo'yicha; Farq = Stsenariy − Hozirgi holat",
    inputs: [
      Q.money('Stsenariy: daromad', r.totals.scenario.incomeTiyin),
      Q.money('Stsenariy: xarajat', r.totals.scenario.expenseTiyin),
      Q.money('Hozirgi holat: natija', b),
    ],
    steps: [
      `Stsenariy natijasi = ${moneyText(Number(r.totals.scenario.incomeTiyin), false)} − ${moneyText(Number(r.totals.scenario.expenseTiyin), false)} = ${moneyText(sc)}`,
      `Farq = ${moneyText(sc, false)} − ${moneyText(b, false)} = ${moneyText(sc - b)}`,
      `Zarar ehtimoli = ${SIM_PATHS} ta yo'ldan natijasi < 0 bo'lganlar ulushi = ${pctText(r.totals.scenario.lossProbability * 100)}`,
      `Yaxshiroq bo'lish ehtimoli = ${pctText(r.totals.betterProbability * 100)}`,
    ],
    result: moneyText(sc),
    note: `${r.horizon} oy uchun (${r.periods[0] ? formatPeriod(r.periods[0]) : ''} — ${r.periods.length ? formatPeriod(r.periods[r.periods.length - 1]!) : ''}).`,
  };
}

/** Ehtimollik — simulyatsiya izohi */
export function probabilityCalc(title: string, value: number, what: string): Calc {
  return {
    title,
    formula: `Ehtimollik = (${what} bo'lgan yo'llar soni) ÷ ${SIM_PATHS} × 100`,
    inputs: [{ label: 'Ehtimollik', value: value * 100, kind: 'pct' }],
    steps: [`Model asosida ${SIM_PATHS} ta ehtimoliy kelajak yo'li simulyatsiya qilinadi`, `${Math.round(value * SIM_PATHS)} ta yo'lda ${what}`, `= ${Math.round(value * SIM_PATHS)} ÷ ${SIM_PATHS} × 100 = ${pctText(value * 100)}`],
    result: pctText(value * 100),
  };
}