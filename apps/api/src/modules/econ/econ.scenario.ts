import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EconData, fmtPct, fmtSom, periodLabel, periodRange, shiftPeriod, tiyin } from './econ.data';
import { FactorsService } from './econ.factors';
import { etsSimulateJoint, fitEts, gaussian, mean, pearson, quantile, rng, seedOf, type EtsFit } from './econ.math';
import type { Panel, RiskResult, RiskUnit, ScenarioBand, ScenarioChanges, ScenarioResult, UnitSeries } from './econ.types';

// ═══════════════════════════════════════════════════════════
// Stsenariy simulyatori va risk (Monte-Karlo).
//
// 1. Bazaviy yo'l: daromad va xarajat prognoz modellari (Holt-Winters) bilan birga simulyatsiya
//    qilinadi (2000 ta mumkin bo'lgan kelajak), ularning tasodifiy og'ishlari o'zaro bog'liq bo'lishi hisobga olinadi.
// 2. Stsenariy: xarajat tarkibiy qismlari (ish haqi, ijara, mashinalar, qolganlari) foizga o'zgartiriladi;
//    daromadga ta'sir Omillar modelidagi elastiklik orqali (faqat ishonchli aniqlangan bo'lsa) va
//    to'g'ridan-to'g'ri daromad o'zgarishi (narx, hajm) orqali qo'shiladi.
// 3. Bir xil tasodifiy yo'llar ikkala holat uchun ishlatiladi — farq faqat stsenariydan.
// Joriy (tugamagan) oy — bazaviy; o'zgarishlar keyingi oydan boshlab qo'llanadi.
// ═══════════════════════════════════════════════════════════

const PATHS = 2000;
const LIMIT = 90;

function pctArg(value: unknown, label: string): number {
  if (value === undefined || value === null || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < -LIMIT || n > 300) throw new BadRequestException(`${label}: −${LIMIT}% dan +300% gacha bo'lsin`);
  return n / 100;
}

function band(values: number[][], i: number): ScenarioBand {
  const col = values.map((p) => p[i]!);
  return { meanTiyin: tiyin(mean(col)), lo80Tiyin: tiyin(quantile(col, 0.1)), hi80Tiyin: tiyin(quantile(col, 0.9)) };
}

/** Ishorali foiz: "+10%", "−3,0%" (ulushdan) */
function sp(v: number, digits = 1): string {
  return `${v >= 0 ? '+' : '−'}${fmtPct(Math.abs(v) * 100, digits)}`;
}

function signed(v: number): string {
  return `${v >= 0 ? '+' : '−'}${fmtSom(Math.abs(v))}`;
}

interface Model {
  income: EtsFit;
  expense: EtsFit;
  rho: number;
  months: number;
  shares: { payroll: number; lease: number; vehicle: number; other: number };
  recentIncome: number;
  recentExpense: number;
}

@Injectable()
export class ScenarioService {
  constructor(
    private readonly data: EconData,
    private readonly factors: FactorsService,
  ) {}

  /** Birlik uchun daromad va xarajat modellari */
  private model(panel: Panel, u: UnitSeries): Model | null {
    const full = EconData.fullCount(panel);
    const first = u.income.findIndex((v, i) => i < full && (v !== 0 || u.expense[i] !== 0));
    if (first < 0 || full - first < 6) return null;
    const inc = u.income.slice(first, full);
    const exp = u.expense.slice(first, full);
    const a = fitEts(inc);
    const b = fitEts(exp);
    if (!a || !b) return null;
    const skip = a.kind === 'seasonal' || b.kind === 'seasonal' ? 12 : 1;
    const rho = pearson(a.residuals.slice(skip), b.residuals.slice(skip)) ?? 0;
    const last = Array.from({ length: Math.min(3, full - first) }, (_, k) => full - 1 - k);
    const sum = (arr: number[]) => last.reduce((s, i) => s + arr[i]!, 0);
    const total = sum(u.expense) || 1;
    return {
      income: a,
      expense: b,
      rho,
      months: inc.length,
      shares: {
        payroll: sum(u.payroll) / total,
        lease: sum(u.lease) / total,
        vehicle: sum(u.vehicle) / total,
        other: sum(u.otherExpense) / total,
      },
      recentIncome: sum(u.income) / last.length,
      recentExpense: total / last.length,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Stsenariy
  // ═══════════════════════════════════════════════════════════

  async scenario(body: Partial<ScenarioChanges> & { unit?: string; horizon?: number | string; useElasticity?: boolean; asOf?: string }): Promise<ScenarioResult> {
    const changes: ScenarioChanges = {
      headcount: pctArg(body?.headcount, 'Xodimlar soni'),
      wage: pctArg(body?.wage, 'Bir xodimga ish haqi'),
      vehicle: pctArg(body?.vehicle, 'Mashina xarajatlari'),
      lease: pctArg(body?.lease, 'Ijara'),
      other: pctArg(body?.other, 'Qolgan xarajatlar'),
      income: pctArg(body?.income, "Daromad (narx, hajm)"),
    };
    const horizon = body?.horizon === undefined ? 6 : Number(body.horizon);
    if (!Number.isInteger(horizon) || horizon < 2 || horizon > 12) throw new BadRequestException("Muddat 2 dan 12 oygacha bo'lsin");
    const useElasticity = body?.useElasticity !== false;

    const panel = await this.data.panel(body?.asOf);
    const u = EconData.pick(panel, body?.unit ?? 'all');
    if (!u) throw new NotFoundException('Hudud topilmadi');
    const m = this.model(panel, u);
    if (!m) throw new BadRequestException(`${u.name}: stsenariy uchun kamida 6 ta tugagan oy ma'lumoti kerak`);

    // Elastikliklar (Omillar: xodimlar soni va ish haqidan tashqari xarajatlar)
    const factorResult = await this.factors.analyze({ factors: 'headcount,nonpayroll', asOf: body?.asOf });
    const pick = (key: 'headcount' | 'nonpayroll') => {
      const c = factorResult.elasticity?.coefficients.find((x) => x.key === key);
      if (!c) return { value: 0, se: 0, used: false, p: null as number | null };
      const used = useElasticity && c.significance !== 'none' && c.value > 0;
      return { value: used ? c.value : 0, se: used ? c.se : 0, used, p: c.p };
    };
    const eH = pick('headcount');
    const eK = pick('nonpayroll');

    // Xarajat ko'paytuvchisi (tarkib bo'yicha)
    const s = m.shares;
    const payrollFactor = (1 + changes.headcount) * (1 + changes.wage);
    const expenseFactor = s.payroll * payrollFactor + s.lease * (1 + changes.lease) + s.vehicle * (1 + changes.vehicle) + s.other * (1 + changes.other) + Math.max(0, 1 - s.payroll - s.lease - s.vehicle - s.other);
    const npShare = s.lease + s.vehicle + s.other;
    const npChange = npShare > 0 ? (s.lease * changes.lease + s.vehicle * changes.vehicle + s.other * changes.other) / npShare : 0;

    const periods = periodRange(panel.currentPeriod, shiftPeriod(panel.currentPeriod, horizon - 1));
    const seed = seedOf(`scenario|${u.key}|${m.months}`);
    const sim = etsSimulateJoint(m.income, m.expense, m.rho, horizon, seed, PATHS);
    const random = rng(seed + 7);

    const baseI = sim.a;
    const baseE = sim.b;
    const scnI: number[][] = [];
    const scnE: number[][] = [];
    for (let p = 0; p < PATHS; p += 1) {
      // Elastiklik noaniqligi: har bir yo'lda o'z qiymati
      const eh = eH.used ? Math.max(0, eH.value + gaussian(random) * eH.se) : 0;
      const ek = eK.used ? Math.max(0, eK.value + gaussian(random) * eK.se) : 0;
      const incomeFactor = (1 + changes.income) * Math.pow(1 + changes.headcount, eh) * Math.pow(1 + npChange, ek);
      scnI.push(baseI[p]!.map((v, i) => (i === 0 ? v : v * incomeFactor)));
      scnE.push(baseE[p]!.map((v, i) => (i === 0 ? v : v * expenseFactor)));
    }
    const result = (I: number[][], E: number[][]) => I.map((row, p) => row.map((v, i) => v - E[p]![i]!));
    const baseR = result(baseI, baseE);
    const scnR = result(scnI, scnE);
    const totals = (rows: number[][]) => rows.map((r) => r.reduce((a, b) => a + b, 0));
    const lossProb = (R: number[][]) => Array.from({ length: horizon }, (_, i) => R.filter((r) => r[i]! < 0).length / PATHS);
    const summary = (I: number[][], E: number[][], R: number[][]) => {
      const t = totals(R);
      return {
        incomeTiyin: tiyin(mean(totals(I))),
        expenseTiyin: tiyin(mean(totals(E))),
        resultTiyin: tiyin(mean(t)),
        resultLo80Tiyin: tiyin(quantile(t, 0.1)),
        resultHi80Tiyin: tiyin(quantile(t, 0.9)),
        lossProbability: t.filter((v) => v < 0).length / PATHS,
      };
    };
    const base = summary(baseI, baseE, baseR);
    const scn = summary(scnI, scnE, scnR);
    // Stsenariy yaxshiroq bo'lish ehtimoli (bir xil yo'llarda)
    const bt = totals(baseR);
    const st = totals(scnR);
    const betterProb = st.filter((v, p) => v > bt[p]!).length / PATHS;

    const out: ScenarioResult = {
      unit: u.key,
      unitName: u.name,
      horizon,
      periods,
      changes,
      useElasticity,
      elasticity: {
        headcount: { value: eH.value, se: eH.se, used: eH.used, p: eH.p },
        nonpayroll: { value: eK.value, se: eK.se, used: eK.used, p: eK.p },
      },
      shares: s,
      expenseFactor,
      baseline: {
        income: periods.map((_, i) => band(baseI, i)),
        expense: periods.map((_, i) => band(baseE, i)),
        result: periods.map((_, i) => band(baseR, i)),
        lossProbability: lossProb(baseR),
      },
      scenario: {
        income: periods.map((_, i) => band(scnI, i)),
        expense: periods.map((_, i) => band(scnE, i)),
        result: periods.map((_, i) => band(scnR, i)),
        lossProbability: lossProb(scnR),
      },
      totals: { baseline: base, scenario: scn, betterProbability: betterProb },
      notes: [],
    };

    // ─────────── Xulosalar ───────────
    const notes = out.notes;
    const dI = Number(scn.incomeTiyin) - Number(base.incomeTiyin);
    const dE = Number(scn.expenseTiyin) - Number(base.expenseTiyin);
    const dR = Number(scn.resultTiyin) - Number(base.resultTiyin);
    const next = horizon - 1;
    notes.push(
      `${u.name}, ${periodLabel(periods[1]!)} – ${periodLabel(periods[periods.length - 1]!)} (${next} oy): natija ${signed(dR / 100)} o'zgaradi — ` +
        `daromad ${signed(dI / 100)}, xarajat ${signed(dE / 100)}.`,
    );
    notes.push(
      `Jami natija (${horizon} oy, joriy oy bilan): bazaviy ${fmtSom(Number(base.resultTiyin) / 100)}, stsenariy ${fmtSom(Number(scn.resultTiyin) / 100)} ` +
        `(80%: ${fmtSom(Number(scn.resultLo80Tiyin) / 100)} … ${fmtSom(Number(scn.resultHi80Tiyin) / 100)}).`,
    );
    notes.push(
      `Zarar bilan yakunlash ehtimoli: bazaviy ${fmtPct(base.lossProbability * 100, 0)}, stsenariy ${fmtPct(scn.lossProbability * 100, 0)}. ` +
        `Stsenariy ${fmtPct(betterProb * 100, 0)} holatda bazaviydan yaxshiroq natija beradi.`,
    );
    const effects: string[] = [];
    if (changes.headcount !== 0) {
      effects.push(
        eH.used
          ? `xodimlar soni ${sp(changes.headcount, 0)} — ish haqi xarajati o'zgaradi, daromad esa elastiklik bo'yicha ~${sp(Math.pow(1 + changes.headcount, eH.value) - 1)} o'zgaradi`
          : `xodimlar soni ${sp(changes.headcount, 0)} — faqat xarajatga ta'sir qiladi (xodimlarning daromadga ta'siri Omillar modelida ishonchli aniqlanmagan)`,
      );
    }
    if (npChange !== 0 && eK.used) {
      effects.push(`boshqa xarajatlar ${sp(npChange)} — daromad elastiklik bo'yicha ~${sp(Math.pow(1 + npChange, eK.value) - 1)} o'zgaradi`);
    } else if (npChange !== 0) {
      effects.push(`boshqa xarajatlar ${sp(npChange)} — daromadga ta'siri aniqlanmagan, faqat xarajat o'zgaradi`);
    }
    if (changes.wage !== 0) effects.push(`bir xodimga ish haqi ${sp(changes.wage, 0)} — faqat xarajatga`);
    if (changes.income !== 0) effects.push(`daromad to'g'ridan-to'g'ri ${sp(changes.income, 0)} (narx yoki hajm)`);
    if (effects.length) notes.push(`Qanday hisoblandi: ${effects.join('; ')}.`);
    notes.push(
      `Xarajat tarkibi (oxirgi 3 oy): ish haqi ${fmtPct(s.payroll * 100, 0)}, ijara ${fmtPct(s.lease * 100, 0)}, mashinalar ${fmtPct(s.vehicle * 100, 0)}, qolganlari ${fmtPct(s.other * 100, 0)}. ` +
        `Stsenariyda oylik xarajat ${sp(expenseFactor - 1)} o'zgaradi.`,
    );
    notes.push("Eslatma: stsenariy — «agar … bo'lsa» hisobi. Elastiklik o'tgan oylardagi bog'liqlikka asoslanadi; katta o'zgarishlarda (±30% dan ko'p) aniqligi pasayadi.");
    return out;
  }

  // ═══════════════════════════════════════════════════════════
  // Risk xaritasi: har bir hudud uchun zararga tushish ehtimoli
  // ═══════════════════════════════════════════════════════════

  async risk(query: { horizon?: string; asOf?: string }): Promise<RiskResult> {
    const horizon = query.horizon ? Number(query.horizon) : 3;
    if (![3, 6, 12].includes(horizon)) throw new BadRequestException("Muddat: 3, 6 yoki 12 oy");
    const panel = await this.data.panel(query.asOf);
    const list = [panel.total, ...panel.units.filter((u) => u.kind === 'region')];
    const units: RiskUnit[] = [];
    for (const u of list) {
      const m = this.model(panel, u);
      if (!m) continue;
      // Joriy oy chiqarib tashlanadi: keyingi `horizon` oy
      const sim = etsSimulateJoint(m.income, m.expense, m.rho, horizon + 1, seedOf(`risk|${u.key}|${m.months}`), PATHS);
      const R = sim.a.map((row, p) => row.slice(1).map((v, i) => v - sim.b[p]![i + 1]!));
      const I = sim.a.map((row) => row.slice(1).reduce((a, b) => a + b, 0) / horizon);
      const t = R.map((r) => r.reduce((a, b) => a + b, 0));
      const anyLoss = R.filter((r) => r.some((v) => v < 0)).length / PATHS;
      const drop = m.recentIncome > 0 ? I.filter((v) => v < m.recentIncome * 0.9).length / PATHS : 0;
      units.push({
        key: u.key,
        name: u.name,
        kind: u.kind,
        months: m.months,
        expectedResultTiyin: tiyin(mean(t)),
        p10Tiyin: tiyin(quantile(t, 0.1)),
        p90Tiyin: tiyin(quantile(t, 0.9)),
        lossProbability: t.filter((v) => v < 0).length / PATHS,
        anyMonthLossProbability: anyLoss,
        incomeDropProbability: drop,
        recentResultTiyin: tiyin((m.recentIncome - m.recentExpense) * horizon),
        level: 'low',
      });
    }
    for (const x of units) x.level = x.lossProbability >= 0.5 ? 'high' : x.lossProbability >= 0.2 || x.anyMonthLossProbability >= 0.5 ? 'medium' : 'low';
    units.sort((a, b) => (a.kind === 'total' ? -1 : b.kind === 'total' ? 1 : b.lossProbability - a.lossProbability || b.anyMonthLossProbability - a.anyMonthLossProbability));

    const notes: string[] = [];
    const regions = units.filter((x) => x.kind === 'region');
    const total = units.find((x) => x.kind === 'total');
    const periodsText = `${periodLabel(shiftPeriod(panel.currentPeriod, 1))} – ${periodLabel(shiftPeriod(panel.currentPeriod, horizon))}`;
    if (total) {
      notes.push(
        `Butun korxona, ${periodsText}: kutilayotgan natija ${fmtSom(Number(total.expectedResultTiyin) / 100)} (80%: ${fmtSom(Number(total.p10Tiyin) / 100)} … ${fmtSom(Number(total.p90Tiyin) / 100)}); zarar bilan yakunlash ehtimoli ${fmtPct(total.lossProbability * 100, 0)}.`,
      );
    }
    const high = regions.filter((x) => x.level === 'high');
    const medium = regions.filter((x) => x.level === 'medium');
    notes.push(`Yuqori xavf (zarar ehtimoli 50%+): ${high.length ? high.map((x) => `${x.name} (${fmtPct(x.lossProbability * 100, 0)})`).join(', ') : "yo'q"}.`);
    if (medium.length) notes.push(`O'rtacha xavf: ${medium.map((x) => `${x.name} (${fmtPct(x.lossProbability * 100, 0)})`).join(', ')}.`);
    const drops = regions.filter((x) => x.incomeDropProbability >= 0.5);
    if (drops.length) notes.push(`Daromadi oxirgi 3 oyga nisbatan 10% dan ko'proq tushish ehtimoli yuqori: ${drops.map((x) => x.name).join(', ')}.`);
    notes.push("Ehtimollar 2000 ta mumkin bo'lgan kelajakni simulyatsiya qilib hisoblangan (Monte-Karlo): daromad va xarajat prognoz modellari, ularning o'zaro bog'liqligi bilan.");
    return { horizon, periodFrom: shiftPeriod(panel.currentPeriod, 1), periodTo: shiftPeriod(panel.currentPeriod, horizon), units, notes };
  }
}