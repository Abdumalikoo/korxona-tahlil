import { inverse, lnGamma, mean, multiply, studentTInv, transpose, tPValue, fPValue, type Matrix } from './econ.math';

// ═══════════════════════════════════════════════════════════
// Panel regressiya: umumiy (pooled OLS), qat'iy ta'sirlar (FE — hudud ichidagi o'zgarish),
// tasodifiy ta'sirlar (RE — Swamy-Arora), Xausman testi.
// Standart xatolar hududlar bo'yicha klasterlangan (bir hududning oylari o'zaro bog'liq bo'lishi mumkin).
// ═══════════════════════════════════════════════════════════

export interface RegCoef {
  name: string;
  value: number;
  se: number;
  t: number;
  p: number;
  lo95: number;
  hi95: number;
}

export interface RegResult {
  n: number;
  k: number;
  /** Klasterlar soni (hududlar) */
  groups: number;
  df: number;
  coefficients: RegCoef[];
  /** Koeffitsientlar kovariatsiya matritsasi (klasterlangan) */
  cov: Matrix;
  /** Klassik kovariatsiya σ²(X'X)⁻¹ — Xausman testi uchun */
  covClassic: Matrix;
  r2: number;
  adjR2: number;
  f: number;
  fP: number;
  residuals: number[];
  fitted: number[];
  sigma: number;
  durbinWatson: number;
}

/** Regulyarlashgan quyi to'liqmas gamma P(a, x) */
function lowerGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 500; n += 1) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // Uzluksiz kasr (Lentz)
  let b = x + 1 - a;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** Xi-kvadrat: P(X > x) */
export function chiSquarePValue(x: number, df: number): number {
  if (!(x > 0)) return 1;
  return Math.max(0, 1 - lowerGammaP(df / 2, x / 2));
}

/**
 * OLS, klasterlangan standart xatolar bilan.
 * absorbed — modeldan oldin olib tashlangan parametrlar soni (FE da hududlar soni), erkinlik darajasi uchun.
 * intercept — modelda ozod had bormi (F-test erkinlik darajasi uchun).
 */
export function regress(
  y: number[],
  X: Matrix,
  names: string[],
  clusters: number[],
  options: { absorbed?: number; intercept?: boolean } = {},
): RegResult | { error: string } {
  const n = y.length;
  const k = names.length;
  const absorbed = options.absorbed ?? 0;
  if (n < k + absorbed + 3) return { error: `Kuzatuvlar kam: ${n} ta` };

  const scales = names.map((_, j) => Math.max(1e-12, ...X.map((row) => Math.abs(row[j]!))));
  const Xs = X.map((row) => row.map((v, j) => v / scales[j]!));
  const Xt = transpose(Xs);
  const bread = inverse(multiply(Xt, Xs));
  if (!bread) return { error: "Omillar bir-birini to'liq takrorlaydi — modelni hisoblab bo'lmaydi" };
  const bs = multiply(bread, multiply(Xt, y.map((v) => [v]))).map((r) => r[0]!);
  const fitted = Xs.map((row) => row.reduce((s, v, j) => s + v * bs[j]!, 0));
  const residuals = y.map((v, i) => v - fitted[i]!);
  const sse = residuals.reduce((s, e) => s + e * e, 0);
  const my = mean(y);
  const sst = y.reduce((s, v) => s + (v - my) ** 2, 0);
  const df = n - k - absorbed;

  // Klasterlangan "sendvich": (X'X)⁻¹ [Σ_g X_g'e_g e_g'X_g] (X'X)⁻¹
  const groupIds = [...new Set(clusters)];
  const G = groupIds.length;
  const meat: Matrix = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const byGroup = new Map<number, number[]>();
  clusters.forEach((g, i) => {
    let score = byGroup.get(g);
    if (!score) {
      score = new Array<number>(k).fill(0);
      byGroup.set(g, score);
    }
    for (let j = 0; j < k; j += 1) score[j]! += Xs[i]![j]! * residuals[i]!;
  });
  for (const score of byGroup.values()) {
    for (let a = 0; a < k; a += 1) for (let b = 0; b < k; b += 1) meat[a]![b]! += score[a]! * score[b]!;
  }
  // Stata/linearmodels kabi: hudud effektlari klasterlar ichida — ularni tuzatishga qo'shmaymiz
  const correction = G > 1 ? (G / (G - 1)) * ((n - 1) / Math.max(1, n - k)) : 1;
  const covScaled = multiply(multiply(bread, meat), bread).map((row) => row.map((v) => v * correction));
  const cov = covScaled.map((row, a) => row.map((v, b) => v / (scales[a]! * scales[b]!)));
  const sigma2 = sse / Math.max(1, df);
  const covClassic = bread.map((row, a) => row.map((v, b) => (v * sigma2) / (scales[a]! * scales[b]!)));
  const tDf = Math.max(1, G > 1 ? G - 1 : df);
  const tCrit = studentTInv(0.975, tDf);

  const coefficients: RegCoef[] = names.map((name, j) => {
    const value = bs[j]! / scales[j]!;
    const se = Math.sqrt(Math.max(0, cov[j]![j]!));
    const t = se > 0 ? value / se : 0;
    return { name, value, se, t, p: se > 0 ? tPValue(t, tDf) : 1, lo95: value - tCrit * se, hi95: value + tCrit * se };
  });

  const r2 = sst > 0 ? 1 - sse / sst : 0;
  const dfModel = k - (options.intercept === false ? 0 : 1);
  const adjR2 = 1 - (1 - r2) * ((n - 1) / Math.max(1, df));
  const f = dfModel > 0 && df > 0 && sse > 0 ? ((sst - sse) / Math.max(1, dfModel)) / (sse / df) : 0;
  let dw = 0;
  for (let i = 1; i < n; i += 1) if (clusters[i] === clusters[i - 1]) dw += (residuals[i]! - residuals[i - 1]!) ** 2;

  return {
    n,
    k,
    groups: G,
    df,
    coefficients,
    cov,
    covClassic,
    r2,
    adjR2,
    f,
    fP: dfModel > 0 && df > 0 ? fPValue(f, Math.max(1, dfModel), df) : 1,
    residuals,
    fitted,
    sigma: Math.sqrt(sse / Math.max(1, df)),
    durbinWatson: sse > 0 ? dw / sse : 2,
  };
}

export function isRegError(value: RegResult | { error: string }): value is { error: string } {
  return 'error' in value;
}

/** Guruh bo'yicha o'rtachadan ayirish (FE uchun "ichki" o'zgarish) */
export function demean(values: number[], groups: number[]): { within: number[]; means: Map<number, number> } {
  const sums = new Map<number, { s: number; n: number }>();
  values.forEach((v, i) => {
    const g = sums.get(groups[i]!) ?? { s: 0, n: 0 };
    g.s += v;
    g.n += 1;
    sums.set(groups[i]!, g);
  });
  const means = new Map([...sums].map(([g, { s, n }]) => [g, s / n]));
  return { within: values.map((v, i) => v - means.get(groups[i]!)!), means };
}

/** Qism-matritsa bilan Xausman statistikasi: (b_FE − b_RE)' [V_FE − V_RE]⁻¹ (b_FE − b_RE) */
export function hausman(bFe: number[], vFe: Matrix, bRe: number[], vRe: Matrix): { stat: number; df: number; p: number } | null {
  const k = bFe.length;
  const diff = bFe.map((v, i) => v - bRe[i]!);
  const vd = vFe.map((row, a) => row.map((v, b) => v - vRe[a]![b]!));
  const scales = diff.map((_, i) => Math.sqrt(Math.abs(vd[i]![i]!)) || 1);
  const vs = vd.map((row, a) => row.map((v, b) => v / (scales[a]! * scales[b]!)));
  const inv = inverse(vs);
  if (!inv) return null;
  const ds = diff.map((v, i) => v / scales[i]!);
  let stat = 0;
  for (let a = 0; a < k; a += 1) for (let b = 0; b < k; b += 1) stat += ds[a]! * inv[a]![b]! * ds[b]!;
  if (!Number.isFinite(stat)) return null;
  stat = Math.max(0, stat);
  return { stat, df: k, p: chiSquarePValue(stat, k) };
}

/**
 * Chiziqli bog'liq bo'lmagan ustunlarni tanlash: ustunlar tartib bo'yicha qo'shiladi,
 * oldingilar bilan to'liq takrorlanadigani (yoki o'zgarmasi) tashlanadi.
 */
export function independentColumns(X: Matrix, count: number): number[] {
  const kept: number[] = [];
  for (let j = 0; j < count; j += 1) {
    const trial = [...kept, j];
    const cols = trial.map((c) => X.map((row) => row[c]!));
    const scales = cols.map((col) => Math.max(1e-12, ...col.map((v) => Math.abs(v))));
    const Xs = X.map((_, i) => trial.map((_, t) => cols[t]![i]! / scales[t]!));
    const xtx = multiply(transpose(Xs), Xs);
    // Nisbiy shart: diagonal elementga nisbatan juda kichik bosh element — bog'liq ustun
    const inv = inverse(xtx);
    if (!inv) continue;
    const cond = Math.max(...inv.map((row, a) => Math.abs(row[a]!) * Math.abs(xtx[a]![a]!)));
    if (!Number.isFinite(cond) || cond > 1e10) continue;
    kept.push(j);
  }
  return kept;
}