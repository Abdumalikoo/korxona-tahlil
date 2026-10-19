import { BadRequestException, Injectable } from '@nestjs/common';
import { EconData, fmtPct, fmtSom, tiyin } from './econ.data';
import { mean, pearson, sd, tPValue } from './econ.math';
import { demean, hausman, independentColumns, isRegError, regress, type RegResult } from './econ.regress';
import type { FactorKey, FactorsResult, ModelTable, Panel, Significance, UnitSeries } from './econ.types';

// ═══════════════════════════════════════════════════════════
// Omillar tahlili: daromad nimaga bog'liq?
//
//  1. Umumiy regressiya (pooled OLS) — barcha hudud-oylar birga;
//  2. Qat'iy ta'sirlar (FE) — faqat hudud ICHIDAGI o'zgarish: "shu hududda xodim ko'paysa";
//  3. Tasodifiy ta'sirlar (RE) va Xausman testi — qaysi biriga ishonish kerak;
//  4. Elastiklik (log-log, FE) — "1% ko'paysa, necha % o'zgaradi";
//  5. Kobb-Duglas — mehnat (xodimlar) va boshqa resurslar (ish haqidan tashqari xarajat),
//     miqyos samarasi, hududlarning umumiy samaradorligi (TFP);
//  6. Korrelyatsiya matritsasi.
//
// Kuzatuv — bitta hudud va bitta tugagan oy. Markaz va biriktirilmagan yozuvlar kirmaydi
// (Markazning o'z daromadi yo'q — u butun korxonaga xizmat qiladi).
// Mavsum (chorak) va umumiy vaqt trendi har bir modelda hisobga olinadi.
// ═══════════════════════════════════════════════════════════

export const FACTORS: Record<FactorKey, { label: string; short: string; unit: 'kishi' | 'som' }> = {
  headcount: { label: 'Xodimlar soni', short: 'xodimlar', unit: 'kishi' },
  payroll: { label: 'Ish haqi xarajati', short: 'ish haqi', unit: 'som' },
  nonpayroll: { label: 'Ish haqidan tashqari xarajatlar', short: 'boshqa xarajatlar', unit: 'som' },
  vehicle: { label: 'Mashina xarajatlari', short: 'mashinalar', unit: 'som' },
  lease: { label: 'Ijara', short: 'ijara', unit: 'som' },
  other: { label: 'Qolgan xarajatlar', short: 'qolgan xarajatlar', unit: 'som' },
};

const ALL_KEYS = Object.keys(FACTORS) as FactorKey[];
const DEFAULT_FACTORS: FactorKey[] = ['headcount', 'nonpayroll'];

interface Obs {
  unit: number;
  key: string;
  name: string;
  period: string;
  t: number;
  quarter: number;
  y: number;
  x: Record<FactorKey, number>;
}

function factorValue(u: UnitSeries, key: FactorKey, i: number): number {
  switch (key) {
    case 'headcount':
      return u.headcount[i]!;
    case 'payroll':
      return u.payroll[i]!;
    case 'nonpayroll':
      return u.lease[i]! + u.vehicle[i]! + u.otherExpense[i]!;
    case 'vehicle':
      return u.vehicle[i]!;
    case 'lease':
      return u.lease[i]!;
    default:
      return u.otherExpense[i]!;
  }
}

function significance(p: number): Significance {
  return p < 0.05 ? 'strong' : p < 0.1 ? 'weak' : 'none';
}

const SIGN_TEXT: Record<Significance, string> = {
  strong: 'ishonchli',
  weak: 'taxminiy',
  none: "ta'siri aniqlanmadi",
};

function num(value: number, digits = 2): string {
  return value.toFixed(digits).replace('.', ',');
}

function signedSom(value: number): string {
  return `${value >= 0 ? '+' : '−'}${fmtSom(Math.abs(value))}`;
}

/** Darajalar modelidagi koeffitsient ma'nosi — oddiy tilda */
function levelMeaning(key: FactorKey, c: { value: number; lo95: number; hi95: number; p: number }, within: boolean): string {
  const f = FACTORS[key];
  const where = within ? 'Hudud ichida ' : '';
  const cap = (text: string) => (within ? text : text.charAt(0).toUpperCase() + text.slice(1));
  if (f.unit === 'kishi') {
    return cap(`${where}xodimlar soni 1 kishiga ko'payganda oylik daromad o'rtacha ${signedSom(c.value)} o'zgargan (95%: ${signedSom(c.lo95)} … ${signedSom(c.hi95)}).`);
  }
  const per = 1e6;
  return cap(`${where}${f.short} 1 mln so'mga ko'payganda daromad o'rtacha ${signedSom(c.value * per)} o'zgargan (95%: ${signedSom(c.lo95 * per)} … ${signedSom(c.hi95 * per)}).`);
}

function elasticityMeaning(key: FactorKey, c: { value: number; lo95: number; hi95: number }): string {
  const f = FACTORS[key];
  const v = c.value;
  const sg = (x: number) => `${x < 0 ? '−' : ''}${num(Math.abs(x))}`;
  return `${f.label} 1% ko'payganda daromad ${v >= 0 ? '+' : '−'}${num(Math.abs(v))}% o'zgaradi (95%: ${sg(c.lo95)}% … ${sg(c.hi95)}%).`;
}

@Injectable()
export class FactorsService {
  private memo = new Map<string, FactorsResult>();
  /** Kesh qaysi jadvalga tegishli: qurilgan vaqt | joriy oy (tarixiy ko'rinishlar alohida) */
  private memoStamp = '';

  constructor(private readonly data: EconData) {}

  parseFactors(value?: string): FactorKey[] {
    if (!value) return [...DEFAULT_FACTORS];
    const keys = [...new Set(value.split(',').map((s) => s.trim()).filter(Boolean))];
    for (const k of keys) if (!(ALL_KEYS as string[]).includes(k)) throw new BadRequestException(`Noma'lum omil: ${k}`);
    let list = keys as FactorKey[];
    // "Ish haqidan tashqari" o'z ichiga mashina, ijara va qolganlarni oladi — ikkalasi birga bo'lmaydi
    if (list.includes('nonpayroll')) list = list.filter((k) => k !== 'vehicle' && k !== 'lease' && k !== 'other');
    if (list.length === 0) throw new BadRequestException('Kamida bitta omil tanlang');
    if (list.length > 4) throw new BadRequestException("Ko'pi bilan 4 ta omil");
    return ALL_KEYS.filter((k) => list.includes(k));
  }

  async analyze(query: { factors?: string; asOf?: string }): Promise<FactorsResult> {
    const factors = this.parseFactors(query.factors);
    const panel = await this.data.panel(query.asOf);
    const stamp = `${panel.builtAt}|${panel.currentPeriod}`;
    if (this.memoStamp !== stamp) {
      this.memo.clear();
      this.memoStamp = stamp;
    }
    const key = factors.join(',');
    const cached = this.memo.get(key);
    if (cached) return cached;
    const result = this.compute(panel, factors);
    this.memo.set(key, result);
    return result;
  }

  private observations(panel: Panel): Obs[] {
    const full = EconData.fullCount(panel);
    const regions = panel.units.filter((u) => u.kind === 'region');
    const obs: Obs[] = [];
    regions.forEach((u, ui) => {
      const first = u.income.findIndex((v, i) => i < full && (v !== 0 || u.expense[i] !== 0));
      if (first < 0) return;
      for (let i = first; i < full; i += 1) {
        // Hudud ishlamagan oylar (xodim ham, yozuv ham yo'q) kirmaydi
        if (u.headcount[i] === 0 && u.income[i] === 0) continue;
        const period = panel.months[i]!;
        const month = Number(period.slice(5, 7));
        const x = {} as Record<FactorKey, number>;
        for (const k of ALL_KEYS) x[k] = factorValue(u, k, i);
        obs.push({ unit: ui, key: u.key, name: u.name, period, t: i, quarter: Math.ceil(month / 3), y: u.income[i]!, x });
      }
    });
    return obs;
  }

  private compute(panel: Panel, selected: FactorKey[]): FactorsResult {
    let factors = [...selected];
    const all = this.observations(panel);
    const warnings: string[] = [];
    const notes: string[] = [];
    const unitNames = new Map(all.map((o) => [o.unit, { key: o.key, name: o.name }]));

    const result: FactorsResult = {
      factors: factors.map((k) => ({ key: k, label: FACTORS[k].label, unit: FACTORS[k].unit })),
      available: ALL_KEYS.map((k) => ({ key: k, label: FACTORS[k].label, unit: FACTORS[k].unit })),
      observations: 0,
      units: 0,
      months: 0,
      periodFrom: all.length ? all.reduce((m, o) => (o.period < m ? o.period : m), all[0]!.period) : null,
      periodTo: all.length ? all.reduce((m, o) => (o.period > m ? o.period : m), all[0]!.period) : null,
      pooled: null,
      fixed: null,
      random: null,
      hausman: null,
      preferred: null,
      elasticity: null,
      cobbDouglas: null,
      unitEffects: [],
      correlation: null,
      regionMeans: [],
      points: [],
      warnings,
      notes,
    };

    // Omillar musbat bo'lishi kerak emas (masalan, mashina xarajati 0 bo'lishi mumkin), lekin xodimlar > 0
    const obs = all.filter((o) => o.x.headcount > 0);
    const dropped = all.length - obs.length;
    if (dropped > 0) warnings.push(`${dropped} ta hudud-oyda Xodimlar bo'limida xodim yo'q — ular modelga kirmadi.`);
    const groups = [...new Set(obs.map((o) => o.unit))];
    result.observations = obs.length;
    result.units = groups.length;
    result.months = new Set(obs.map((o) => o.period)).size;
    if (obs.length < 30 || groups.length < 3) {
      notes.push(`Omillar tahlili uchun kamida 3 ta hudud va 30 ta hudud-oy kerak. Hozir: ${groups.length} ta hudud, ${obs.length} ta kuzatuv.`);
      return result;
    }
    if (groups.length < 8) warnings.push(`Hududlar soni kam (${groups.length} ta) — standart xatolar taxminiy.`);

    // Nazorat o'zgaruvchilari: trend (oy) va chorak (birinchi uchragan chorak — asos)
    const present = [...new Set(obs.map((o) => o.quarter))].sort();
    const quartersAll = present.slice(1);
    const controlsAll = (o: Obs) => [o.t, ...quartersAll.map((q) => (o.quarter === q ? 1 : 0))];

    // Bir-birini takrorlaydigan yoki o'zgarmas ustunlarni tashlash (omillar birinchi navbatda saqlanadi)
    // Ustunlar: 0 — ozod had, 1..F — omillar, F+1 — trend, keyin choraklar
    const F = factors.length;
    const design = obs.map((o) => [1, ...factors.map((k) => o.x[k]), ...controlsAll(o)]);
    const kept = new Set(independentColumns(design, design[0]!.length));
    const droppedFactors = factors.filter((_, j) => !kept.has(1 + j));
    for (const k of droppedFactors) {
      warnings.push(
        sd(obs.map((o) => o.x[k])) === 0
          ? `«${FACTORS[k].label}» barcha kuzatuvlarda bir xil — modeldan chiqarildi.`
          : `«${FACTORS[k].label}» boshqa tanlangan omillarni to'liq takrorlaydi — modeldan chiqarildi.`,
      );
    }
    const useTrend = kept.has(1 + F);
    const quarters = quartersAll.filter((_, j) => kept.has(2 + F + j));
    factors = factors.filter((k) => !droppedFactors.includes(k));
    if (factors.length === 0) {
      notes.push("Tanlangan omillarning barchasi o'zgarmas yoki bir-birini takrorlaydi — boshqa omillarni tanlang.");
      return result;
    }
    result.factors = factors.map((k) => ({ key: k, label: FACTORS[k].label, unit: FACTORS[k].unit }));
    for (const k of factors) {
      const within = demean(obs.map((o) => o.x[k]), obs.map((o) => o.unit)).within;
      if (sd(within) < 1e-9) warnings.push(`«${FACTORS[k].label}» har bir hudud ichida o'zgarmagan — hudud ichidagi ta'sirini (FE) baholab bo'lmaydi.`);
    }
    const controlNames = [...(useTrend ? ['trend'] : []), ...quarters.map((q) => `q${q}`)];
    const controls = (o: Obs) => [...(useTrend ? [o.t] : []), ...quarters.map((q) => (o.quarter === q ? 1 : 0))];
    const clusters = obs.map((o) => o.unit);
    const y = obs.map((o) => o.y);
    const Xf = obs.map((o) => factors.map((k) => o.x[k]));
    const Xc = obs.map((o) => controls(o));

    const table = (
      name: string,
      method: ModelTable['method'],
      reg: RegResult,
      names: string[],
      meaning: (k: FactorKey, c: RegResult['coefficients'][number]) => string,
      extra: Partial<ModelTable> = {},
    ): ModelTable => ({
      name,
      method,
      n: reg.n,
      groups: reg.groups,
      r2: reg.r2,
      adjR2: reg.adjR2,
      f: reg.f,
      fP: reg.fP,
      durbinWatson: reg.durbinWatson,
      coefficients: reg.coefficients
        .map((c, j) => ({ c, name: names[j]! }))
        .filter(({ name: n }) => (factors as string[]).includes(n))
        .map(({ c, name: n }) => ({
          key: n as FactorKey,
          label: FACTORS[n as FactorKey].label,
          value: c.value,
          se: c.se,
          t: c.t,
          p: c.p,
          lo95: c.lo95,
          hi95: c.hi95,
          significance: significance(c.p),
          meaning: meaning(n as FactorKey, c),
        })),
      trendPerMonth: reg.coefficients[names.indexOf('trend')]?.value ?? null,
      ...extra,
    });

    // ─────────── 1. Umumiy regressiya ───────────
    const pooledNames = ['const', ...factors, ...controlNames];
    const pooled = regress(
      y,
      obs.map((_, i) => [1, ...Xf[i]!, ...Xc[i]!]),
      pooledNames,
      clusters,
    );
    if (!isRegError(pooled)) {
      result.pooled = table('Umumiy regressiya (OLS)', 'pooled', pooled, pooledNames, (k, c) => levelMeaning(k, c, false));
    } else warnings.push(`Umumiy regressiya: ${pooled.error}`);

    // ─────────── 2. Qat'iy ta'sirlar (FE) ───────────
    const feNames = [...factors, ...controlNames];
    const Xall = obs.map((_, i) => [...Xf[i]!, ...Xc[i]!]);
    const yd = demean(y, clusters);
    const colsD = feNames.map((_, j) => demean(Xall.map((r) => r[j]!), clusters));
    const Xd = obs.map((_, i) => colsD.map((c) => c.within[i]!));
    const fe = regress(yd.within, Xd, feNames, clusters, { absorbed: groups.length, intercept: false });
    if (!isRegError(fe)) {
      result.fixed = table("Qat'iy ta'sirlar (FE) — hudud ichidagi o'zgarish", 'fixed', fe, feNames, (k, c) => levelMeaning(k, c, true), {
        withinR2: fe.r2,
      });

      // Hudud effekti: resurslari va mavsumni hisobga olgandan keyin qolgan doimiy farq (oyiga)
      const beta = fe.coefficients.map((c) => c.value);
      const effects = groups.map((g) => {
        const ym = yd.means.get(g)!;
        const xm = colsD.map((c) => c.means.get(g)!);
        return { g, alpha: ym - xm.reduce((s, v, j) => s + v * beta[j]!, 0) };
      });
      const avgAlpha = mean(effects.map((e) => e.alpha));
      result.unitEffects = effects
        .map((e) => {
          const rows = obs.filter((o) => o.unit === e.g);
          const actual = mean(rows.map((o) => o.y));
          const effect = e.alpha - avgAlpha;
          return {
            key: unitNames.get(e.g)!.key,
            name: unitNames.get(e.g)!.name,
            effectTiyin: tiyin(effect),
            actualTiyin: tiyin(actual),
            expectedTiyin: tiyin(actual - effect),
            months: rows.length,
          };
        })
        .sort((a, b) => Number(b.effectTiyin) - Number(a.effectTiyin));
    } else warnings.push(`FE modeli: ${fe.error}`);

    // ─────────── 3. Tasodifiy ta'sirlar (RE, Swamy-Arora) va Xausman ───────────
    if (!isRegError(fe) && groups.length > feNames.length + 1) {
      const sigmaE2 = fe.sigma ** 2;
      // Hududlar o'rtachalari regressiyasi; hamma hududda bir xil bo'lgan ustunlar (masalan, trend) tashlanadi
      const varying = colsD.map((c, j) => ({ c, j })).filter(({ c }) => sd(groups.map((g) => c.means.get(g)!)) > 1e-9);
      const between = regress(
        groups.map((g) => yd.means.get(g)!),
        groups.map((g) => [1, ...varying.map(({ c }) => c.means.get(g)!)]),
        ['const', ...varying.map(({ j }) => feNames[j]!)],
        groups,
      );
      if (!isRegError(between)) {
        const counts = new Map<number, number>();
        clusters.forEach((g) => counts.set(g, (counts.get(g) ?? 0) + 1));
        const tHarm = groups.length / groups.reduce((s, g) => s + 1 / counts.get(g)!, 0);
        const sigmaB2 = between.residuals.reduce((s, e) => s + e * e, 0) / Math.max(1, groups.length - varying.length - 1);
        const sigmaU2 = Math.max(0, sigmaB2 - sigmaE2 / tHarm);
        const theta = (g: number) => 1 - Math.sqrt(sigmaE2 / (counts.get(g)! * sigmaU2 + sigmaE2));
        const yr = obs.map((o, i) => y[i]! - theta(o.unit) * yd.means.get(o.unit)!);
        const Xr = obs.map((o, i) => [1 - theta(o.unit), ...Xall[i]!.map((v, j) => v - theta(o.unit) * colsD[j]!.means.get(o.unit)!)]);
        const reNames = ['const', ...feNames];
        const re = regress(yr, Xr, reNames, clusters);
        if (!isRegError(re)) {
          result.random = table("Tasodifiy ta'sirlar (RE)", 'random', re, reNames, (k, c) => levelMeaning(k, c, false), {
            rho: sigmaU2 + sigmaE2 > 0 ? sigmaU2 / (sigmaU2 + sigmaE2) : 0,
          });
          // Xausman: faqat tanlangan omillar bo'yicha
          const idxFe = factors.map((k) => feNames.indexOf(k));
          const idxRe = factors.map((k) => reNames.indexOf(k));
          const pick = (m: number[][], idx: number[]) => idx.map((a) => idx.map((b) => m[a]![b]!));
          const h = hausman(
            idxFe.map((i) => fe.coefficients[i]!.value),
            pick(fe.covClassic, idxFe),
            idxRe.map((i) => re.coefficients[i]!.value),
            pick(re.covClassic, idxRe),
          );
          if (h) {
            const preferFe = h.p < 0.05;
            result.hausman = {
              stat: h.stat,
              df: h.df,
              p: h.p,
              text: preferFe
                ? `Xausman testi (p = ${num(h.p, 3)}): hududlarning o'ziga xos xususiyatlari omillar bilan bog'liq — hudud ichidagi o'zgarishga (FE) ishonish kerak.`
                : `Xausman testi (p = ${num(h.p, 3)}): FE va RE natijalari o'rtasida muhim farq yo'q — aniqroq RE modeli ishlatiladi.`,
            };
            result.preferred = preferFe ? 'fixed' : 'random';
          }
        }
      }
    }
    if (!result.preferred) result.preferred = result.fixed ? 'fixed' : result.pooled ? 'pooled' : null;

    // ─────────── 4. Elastiklik (log-log, FE) ───────────
    const logObs = obs.map((o, i) => ({ o, i })).filter(({ o }) => o.y > 0 && factors.every((k) => o.x[k] > 0));
    const logGroups = new Set(logObs.map(({ o }) => o.unit));
    if (logObs.length >= 30 && logGroups.size >= 3) {
      const lc = logObs.map(({ o }) => o.unit);
      const ly = demean(logObs.map(({ o }) => Math.log(o.y)), lc);
      const lcols = [...factors.map((k) => logObs.map(({ o }) => Math.log(o.x[k]))), ...controlNames.map((_, j) => logObs.map(({ i }) => Xc[i]![j]!))].map((c) =>
        demean(c, lc),
      );
      const lX = logObs.map((_, r) => lcols.map((c) => c.within[r]!));
      const el = regress(ly.within, lX, feNames, lc, { absorbed: logGroups.size, intercept: false });
      if (!isRegError(el)) {
        result.elasticity = table('Elastiklik (log-log, hudud ichida)', 'elasticity', el, feNames, (k, c) => elasticityMeaning(k, c), { withinR2: el.r2 });
        if (logObs.length < obs.length) {
          result.elasticity.note = `${obs.length - logObs.length} ta kuzatuvda omil yoki daromad 0 — logarifm olinmaydi, ular kirmadi.`;
        }
      }
    }

    // ─────────── 5. Kobb-Duglas: Y = A · L^α · K^β ───────────
    const cdObs = obs.filter((o) => o.y > 0 && o.x.nonpayroll > 0);
    const cdGroups = [...new Set(cdObs.map((o) => o.unit))];
    if (cdObs.length >= 30 && cdGroups.length >= 3) {
      const cdNames = ['const', 'lnL', 'lnK', ...controlNames];
      const cd = regress(
        cdObs.map((o) => Math.log(o.y)),
        cdObs.map((o) => [1, Math.log(o.x.headcount), Math.log(o.x.nonpayroll), ...controls(o)]),
        cdNames,
        cdObs.map((o) => o.unit),
      );
      if (!isRegError(cd)) {
        const a = cd.coefficients[1]!;
        const b = cd.coefficients[2]!;
        const s = a.value + b.value;
        const sSe = Math.sqrt(Math.max(0, cd.cov[1]![1]! + cd.cov[2]![2]! + 2 * cd.cov[1]![2]!));
        const tS = sSe > 0 ? (s - 1) / sSe : 0;
        const pS = sSe > 0 ? tPValue(tS, Math.max(1, cd.groups - 1)) : 1;
        const returns: 'increasing' | 'constant' | 'decreasing' = pS < 0.05 ? (s > 1 ? 'increasing' : 'decreasing') : 'constant';
        const trend = cd.coefficients[3]!.value;
        const tfpYear = (Math.exp(12 * trend) - 1) * 100;
        // Hudud umumiy samaradorligi (TFP): model tushuntira olmagan o'rtacha qoldiq
        const byUnit = new Map<number, number[]>();
        cdObs.forEach((o, i) => byUnit.set(o.unit, [...(byUnit.get(o.unit) ?? []), cd.residuals[i]!]));
        const tfp = [...byUnit.entries()]
          .map(([g, res]) => ({ key: unitNames.get(g)!.key, name: unitNames.get(g)!.name, index: Math.exp(mean(res)) * 100 }))
          .sort((x, z) => z.index - x.index);
        result.cobbDouglas = {
          n: cd.n,
          r2: cd.r2,
          alpha: { value: a.value, se: a.se, p: a.p, lo95: a.lo95, hi95: a.hi95 },
          beta: { value: b.value, se: b.se, p: b.p, lo95: b.lo95, hi95: b.hi95 },
          sum: s,
          sumSe: sSe,
          sumP: pS,
          returns,
          tfpGrowthYear: tfpYear,
          tfp,
          text:
            `Daromad ≈ A · Xodimlar^${num(a.value)} · Xarajat^${num(b.value)}. ` +
            (returns === 'increasing'
              ? `α + β = ${num(s)} > 1 — miqyos samarasi o'suvchi: hududni kattalashtirish (xodim va xarajatni birdek oshirish) daromadni undan tezroq oshiradi.`
              : returns === 'decreasing'
                ? `α + β = ${num(s)} < 1 — miqyos samarasi kamayuvchi: resurslarni 10% oshirish daromadni 10% dan kam oshiradi; kattalashtirishdan ko'ra samaradorlikni oshirish foydaliroq.`
                : `α + β = ${num(s)} — 1 dan statistik farq qilmaydi (p = ${num(pS, 2)}): miqyos samarasi doimiy, ya'ni resurslar 10% oshsa daromad ham taxminan 10% oshadi.`),
        };
      }
    }

    // ─────────── 6. Korrelyatsiya ───────────
    const corrKeys: (FactorKey | 'income')[] = ['income', ...ALL_KEYS.filter((k) => obs.some((o) => o.x[k] !== 0))];
    const series = (k: FactorKey | 'income') => obs.map((o) => (k === 'income' ? o.y : o.x[k]));
    result.correlation = {
      keys: corrKeys,
      labels: corrKeys.map((k) => (k === 'income' ? 'Daromad' : FACTORS[k].label)),
      matrix: corrKeys.map((a) => corrKeys.map((b) => (a === b ? 1 : pearson(series(a), series(b))))),
    };

    // ─────────── Grafiklar uchun ───────────
    result.regionMeans = groups.map((g) => {
      const rows = obs.filter((o) => o.unit === g);
      const factorsMean = {} as Record<FactorKey, number>;
      for (const k of ALL_KEYS) factorsMean[k] = mean(rows.map((o) => o.x[k])) * (FACTORS[k].unit === 'som' ? 100 : 1);
      return {
        key: unitNames.get(g)!.key,
        name: unitNames.get(g)!.name,
        months: rows.length,
        incomeTiyin: Math.round(mean(rows.map((o) => o.y)) * 100),
        factors: factorsMean,
      };
    });
    result.points = obs.map((o) => {
      const f = {} as Record<FactorKey, number>;
      for (const k of ALL_KEYS) f[k] = FACTORS[k].unit === 'som' ? Math.round(o.x[k] * 100) : o.x[k];
      return { key: o.key, period: o.period, incomeTiyin: Math.round(o.y * 100), factors: f };
    });

    // ─────────── Xulosalar ───────────
    const main = result.preferred === 'random' ? result.random : result.preferred === 'fixed' ? result.fixed : result.pooled;
    notes.push(
      `${result.units} ta hudud, ${result.months} oy — jami ${result.observations} ta kuzatuv. Mavsum (chorak) va umumiy vaqt trendi hisobga olingan.`,
    );
    if (main) {
      const strong = main.coefficients.filter((c) => c.significance === 'strong');
      const none = main.coefficients.filter((c) => c.significance === 'none');
      for (const c of main.coefficients) notes.push(`${c.meaning.replace(/\.$/, '')} — ${SIGN_TEXT[c.significance]} (p ${c.p < 0.001 ? '< 0,001' : `= ${num(c.p, 3)}`}).`);
      if (strong.length === 0) {
        notes.push("Tanlangan omillarning hech biri daromadga ishonchli ta'sir ko'rsatmadi — daromad ko'proq boshqa narsalarga (buyurtmalar, narx, mavsum) bog'liq bo'lishi mumkin.");
      } else if (none.length > 0) {
        notes.push(`Ta'siri aniqlanmagan omillar: ${none.map((c) => c.label.toLowerCase()).join(', ')} — ularning o'zgarishi daromadda sezilmagan.`);
      }
      // Odatiy o'zgarish ta'siri — eng kuchli omil
      if (result.fixed && main.coefficients.length > 1) {
        const withinSd = (k: FactorKey) => sd(demean(obs.map((o) => o.x[k]), clusters).within);
        const impact = main.coefficients.map((c) => ({ c, v: Math.abs(c.value * withinSd(c.key)) })).sort((p, q) => q.v - p.v)[0]!;
        notes.push(`Odatiy oylik o'zgarish hisobida eng kuchli omil — ${impact.c.label.toLowerCase()} (daromadga ~${fmtSom(impact.v)} ta'sir).`);
      }
    }
    if (result.hausman) notes.push(result.hausman.text);
    if (result.fixed?.withinR2 !== undefined) {
      notes.push(`Hudud ichidagi oylik o'zgarishlarning ${fmtPct((result.fixed.withinR2 ?? 0) * 100)} i shu omillar, mavsum va trend bilan tushuntiriladi.`);
    }
    if (result.elasticity) {
      for (const c of result.elasticity.coefficients.filter((x) => x.significance !== 'none')) notes.push(c.meaning);
    }
    if (result.cobbDouglas) {
      notes.push(result.cobbDouglas.text);
      const t = result.cobbDouglas.tfp;
      if (t.length >= 2) {
        notes.push(
          `Umumiy samaradorlik (TFP) — bir xil xodim va xarajat bilan eng ko'p daromad oladigan hudud: ${t[0]!.name} (${num(t[0]!.index, 0)}), eng kam: ${t[t.length - 1]!.name} (${num(t[t.length - 1]!.index, 0)}); 100 — o'rtacha.`,
        );
      }
    }
    const ue = result.unitEffects;
    if (ue.length >= 2) {
      const top = ue[0]!;
      const low = ue[ue.length - 1]!;
      notes.push(
        `Resurslariga nisbatan kutilganidan ko'p daromad olayotgan hudud — ${top.name} (${signedSom(Number(top.effectTiyin) / 100)} / oy), kam — ${low.name} (${signedSom(Number(low.effectTiyin) / 100)} / oy).`,
      );
    }
    if (factors.includes('payroll')) {
      const flagged = EconData.warnings(panel).filter((w) => w.text.includes('ish haqi xarajati odatdagidan'));
      if (flagged.length) warnings.push(`Ish haqi ${flagged.length} ta oyda g'ayrioddiy katta (takrorlangan paket bo'lishi mumkin) — «Ish haqi» omili natijasi buzilishi mumkin.`);
    }
    notes.push("Eslatma: bu bog'liqlik, sabab emas. Masalan, daromadi o'sayotgan hududga xodim qo'shilgan bo'lishi ham mumkin. Qarorni boshqa ma'lumotlar bilan birga qabul qiling.");

    return result;
  }
}