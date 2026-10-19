// ═══════════════════════════════════════════════════════════
// Katta modellar — matematik yadro (tashqi kutubxonasiz)
//
//  - tavsifiy statistika va taqsimotlar (normal, Student t, Fisher F);
//  - matritsalar va eng kichik kvadratlar usuli (OLS) — standart xato, t, p, R²;
//  - Holt-Winters (ETS) prognozi: oddiy, trendli (so'nuvchi) va mavsumiy;
//  - o'tmishda sinash (backtest) va ishonch oraliqlari (simulyatsiya);
//  - takrorlanadigan tasodifiy sonlar (natija har safar bir xil chiqadi).
// ═══════════════════════════════════════════════════════════

// ─────────── Tavsifiy statistika ───────────

export function sum(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

export function mean(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

/** Tanlanma dispersiyasi (n − 1) */
export function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) ** 2;
  return s / (values.length - 1);
}

export function sd(values: number[]): number {
  return Math.sqrt(variance(values));
}

/** Kvantil (0..1), chiziqli interpolyatsiya */
export function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

/** Pirson korrelyatsiyasi; ma'lumot yetmasa null */
export function pearson(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// ─────────── Taqsimotlar ───────────

/** ln Γ(x) — Lanczos yaqinlashuvi */
export function lnGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const xx = x - 1;
  let a = c[0]!;
  const t = xx + g + 0.5;
  for (let i = 1; i < g + 2; i += 1) a += c[i]! / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Uzluksiz kasr — to'liqmas beta funksiya uchun */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regulyarlashgan to'liqmas beta funksiya I_x(a, b) */
export function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betaContinuedFraction(a, b, x)) / a;
  return 1 - (bt * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Student t taqsimoti: P(T ≤ t) */
export function studentTCdf(t: number, df: number): number {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (df <= 0) return NaN;
  const x = df / (df + t * t);
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

/** Ikki tomonlama p-qiymat */
export function tPValue(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  // To'g'ridan-to'g'ri dum orqali — juda kichik p ham aniq chiqadi
  return Math.min(1, incompleteBeta(df / (df + t * t), df / 2, 0.5));
}

/** Student t kvantili (bisektsiya) */
export function studentTInv(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let lo = -1000;
  let hi = 1000;
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Fisher F taqsimoti: P(F > f) */
export function fPValue(f: number, df1: number, df2: number): number {
  if (!(f > 0)) return 1;
  const x = df2 / (df2 + df1 * f);
  return incompleteBeta(x, df2 / 2, df1 / 2);
}

/** Standart normal taqsimot funksiyasi */
export function normalCdf(z: number): number {
  // Abramowitz–Stegun 26.2.17 yaqinlashuvi (xato < 7,5·10⁻⁸)
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

/** Standart normal kvantili (Acklam) */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  if (p < low) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - low) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

// ─────────── Takrorlanadigan tasodifiy sonlar ───────────

/** Mulberry32 — bir xil urug' har doim bir xil ketma-ketlik beradi */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normal taqsimlangan son (Box–Muller) */
export function gaussian(random: () => number): number {
  let u = 0;
  while (u === 0) u = random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Satrdan urug' (masalan: "income|r:26") */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ─────────── Matritsalar ───────────

export type Matrix = number[][];

export function transpose(a: Matrix): Matrix {
  if (!a.length) return [];
  return a[0]!.map((_, j) => a.map((row) => row[j]!));
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  const n = a.length;
  const m = b[0]?.length ?? 0;
  const k = b.length;
  const out: Matrix = Array.from({ length: n }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let p = 0; p < k; p += 1) {
      const aip = a[i]![p]!;
      if (aip === 0) continue;
      for (let j = 0; j < m; j += 1) out[i]![j]! += aip * b[p]![j]!;
    }
  }
  return out;
}

/** Teskari matritsa (Gauss–Jordan, bosh element tanlash bilan); aylanib qolsa null */
export function inverse(source: Matrix): Matrix | null {
  const n = source.length;
  const a = source.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  const scale = Math.max(1e-300, ...source.flat().map((v) => Math.abs(v)));
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    if (Math.abs(a[pivot]![col]!) < 1e-12 * scale) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const pv = a[col]![col]!;
    for (let j = 0; j < 2 * n; j += 1) a[col]![j]! /= pv;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = a[r]![col]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) a[r]![j]! -= f * a[col]![j]!;
    }
  }
  return a.map((row) => row.slice(n));
}

// ─────────── Eng kichik kvadratlar usuli (OLS) ───────────

export interface OlsCoefficient {
  name: string;
  value: number;
  se: number;
  t: number;
  p: number;
  lo95: number;
  hi95: number;
}

export interface OlsResult {
  n: number;
  k: number;
  df: number;
  coefficients: OlsCoefficient[];
  r2: number;
  adjR2: number;
  f: number;
  fP: number;
  sigma: number;
  fitted: number[];
  residuals: number[];
  /** Darbin–Uotson: 2 ga yaqin — qoldiqlar mustaqil */
  durbinWatson: number;
  /** Omillar orasidagi o'zaro bog'liqlik (VIF), ozod haddan tashqari */
  vif: Record<string, number>;
}

export type OlsFailure = { error: string };

/**
 * y = Xβ + ε. X ning birinchi ustuni odatda 1 (ozod had).
 * Ustunlarni o'lchamlashtirib hisoblaydi — so'mdagi katta sonlarda ham barqaror.
 */
export function ols(y: number[], X: Matrix, names: string[]): OlsResult | OlsFailure {
  const n = y.length;
  const k = names.length;
  if (n !== X.length) return { error: "Qatorlar soni mos emas" };
  if (n < k + 3) return { error: `Kuzatuvlar kam: ${n} ta, kamida ${k + 3} ta kerak` };

  // Ustunlarni o'lchamlashtirish
  const scales = names.map((_, j) => Math.max(1e-12, ...X.map((row) => Math.abs(row[j]!))));
  const Xs = X.map((row) => row.map((v, j) => v / scales[j]!));
  const Xt = transpose(Xs);
  const XtXinv = inverse(multiply(Xt, Xs));
  if (!XtXinv) return { error: "Omillar bir-birini to'liq takrorlaydi (kollinearlik) — modelni hisoblab bo'lmaydi" };
  const Xty = multiply(Xt, y.map((v) => [v]));
  const betaScaled = multiply(XtXinv, Xty).map((r) => r[0]!);

  const fitted = Xs.map((row) => row.reduce((s, v, j) => s + v * betaScaled[j]!, 0));
  const residuals = y.map((v, i) => v - fitted[i]!);
  const sse = residuals.reduce((s, e) => s + e * e, 0);
  const my = mean(y);
  const hasIntercept = names[0] === 'const';
  const sst = y.reduce((s, v) => s + (hasIntercept ? (v - my) ** 2 : v * v), 0);
  const df = n - k;
  const sigma2 = sse / df;
  const r2 = sst > 0 ? 1 - sse / sst : 0;
  const adjR2 = 1 - (1 - r2) * ((n - (hasIntercept ? 1 : 0)) / df);
  const dfModel = k - (hasIntercept ? 1 : 0);
  const f = dfModel > 0 && sse > 0 ? (sst - sse) / dfModel / sigma2 : 0;
  const tCrit = studentTInv(0.975, df);

  const coefficients: OlsCoefficient[] = names.map((name, j) => {
    const value = betaScaled[j]! / scales[j]!;
    const se = Math.sqrt(Math.max(0, sigma2 * XtXinv[j]![j]!)) / scales[j]!;
    const t = se > 0 ? value / se : value === 0 ? 0 : Infinity;
    return { name, value, se, t, p: se > 0 ? tPValue(t, df) : 0, lo95: value - tCrit * se, hi95: value + tCrit * se };
  });

  let dwNum = 0;
  for (let i = 1; i < n; i += 1) dwNum += (residuals[i]! - residuals[i - 1]!) ** 2;

  // VIF: har bir omilni qolganlari bilan tushuntirish
  const vif: Record<string, number> = {};
  if (hasIntercept && k > 2) {
    for (let j = 1; j < k; j += 1) {
      const target = X.map((row) => row[j]!);
      const others = X.map((row) => row.filter((_, c) => c !== j));
      const sub = olsCore(target, others);
      vif[names[j]!] = sub !== null && sub < 1 ? 1 / (1 - sub) : Infinity;
    }
  }

  return {
    n,
    k,
    df,
    coefficients,
    r2,
    adjR2,
    f,
    fP: dfModel > 0 ? fPValue(f, dfModel, df) : 1,
    sigma: Math.sqrt(sigma2),
    fitted,
    residuals,
    durbinWatson: sse > 0 ? dwNum / sse : 2,
    vif,
  };
}

/** Faqat R² (VIF uchun) */
function olsCore(y: number[], X: Matrix): number | null {
  const k = X[0]?.length ?? 0;
  const scales = Array.from({ length: k }, (_, j) => Math.max(1e-12, ...X.map((row) => Math.abs(row[j]!))));
  const Xs = X.map((row) => row.map((v, j) => v / scales[j]!));
  const Xt = transpose(Xs);
  const inv = inverse(multiply(Xt, Xs));
  if (!inv) return null;
  const beta = multiply(inv, multiply(Xt, y.map((v) => [v]))).map((r) => r[0]!);
  const my = mean(y);
  let sse = 0;
  let sst = 0;
  Xs.forEach((row, i) => {
    const f = row.reduce((s, v, j) => s + v * beta[j]!, 0);
    sse += (y[i]! - f) ** 2;
    sst += (y[i]! - my) ** 2;
  });
  return sst > 0 ? 1 - sse / sst : null;
}

export function isOlsFailure(value: OlsResult | OlsFailure): value is OlsFailure {
  return 'error' in value;
}

// ─────────── Holt-Winters (ETS) prognozi ───────────

export type EtsKind = 'mean' | 'ses' | 'holt' | 'seasonal';

export interface EtsParams {
  alpha: number;
  beta: number;
  gamma: number;
  phi: number;
}

export interface EtsFit {
  kind: EtsKind;
  params: EtsParams;
  /** Oxirgi holat */
  level: number;
  trend: number;
  /** Oxirgi m ta mavsum koeffitsienti (eng eskisidan) */
  season: number[];
  period: number;
  fitted: number[];
  residuals: number[];
  sigma: number;
  aicc: number;
  /** Parametrlar soni (holat boshlang'ich qiymatlari bilan) */
  paramCount: number;
  /** Har oydan keyingi daraja (bazaviy qiymat) — «model qanday ko'radi» chizig'i uchun */
  levels?: number[];
  /** Model qanday tanlangani va tozalangani (fitEts to'ldiradi) */
  diag?: EtsDiagnostics;
}

/** Model tanlash va tayyorlash tafsilotlari — foydalanuvchiga ko'rsatish uchun */
export interface EtsDiagnostics {
  /** Bir martalik keskin sakrashlar: modelni o'rgatishda o'rniga mo'tadil qiymat olingan */
  cleaned: { index: number; value: number; used: number }[];
  /** Sinab ko'rilgan modellar: oldindan aytish xatosi (1, 2, 3 oy oldinga) */
  candidates: { kind: EtsKind; error: number | null; byHorizon: (number | null)[]; points: number }[];
  /** test — o'tmishda sinov bo'yicha; aicc — ma'lumot kam, axborot mezoni bo'yicha; only — yagona mumkin model */
  chosenBy: 'test' | 'aicc' | 'only';
  /** Model ichki tebranishi (o'rgatish xatolari) */
  sigmaModel: number;
  /** Sinovdagi haqiqiy 1 oylik xatolar tebranishi (bo'lsa) */
  sigmaTest: number | null;
  testPoints: number;
}

interface EtsState {
  level: number;
  trend: number;
  season: number[];
}

/** Boshlang'ich holat */
function initialState(y: number[], kind: EtsKind, m: number): EtsState {
  if (kind === 'seasonal') {
    const first = y.slice(0, m);
    const second = y.slice(m, 2 * m);
    const m1 = mean(first);
    const m2 = mean(second);
    const season = first.map((v, i) => ((v - m1) + (second[i]! - m2)) / 2);
    return { level: m1, trend: (m2 - m1) / m, season };
  }
  if (kind === 'holt') {
    const head = y.slice(0, Math.min(4, y.length));
    const diffs = head.slice(1).map((v, i) => v - head[i]!);
    return { level: y[0]!, trend: diffs.length ? mean(diffs) : 0, season: [] };
  }
  return { level: kind === 'ses' ? mean(y.slice(0, Math.min(3, y.length))) : mean(y), trend: 0, season: [] };
}

/** Bir qadamli xatolar bilan modelni qatordan o'tkazish (xato-tuzatish ko'rinishi) */
function runEts(y: number[], kind: EtsKind, p: EtsParams, m: number): { fitted: number[]; residuals: number[]; levels: number[]; state: EtsState } {
  const state = initialState(y, kind, m);
  const season = [...state.season];
  let { level, trend } = state;
  const fitted: number[] = [];
  const residuals: number[] = [];
  const levels: number[] = [];
  for (let t = 0; t < y.length; t += 1) {
    const s = kind === 'seasonal' ? season[t % m]! : 0;
    const hat = kind === 'mean' ? level : level + p.phi * trend + s;
    const e = y[t]! - hat;
    fitted.push(hat);
    residuals.push(e);
    if (kind === 'mean') {
      levels.push(level);
      continue;
    }
    const newLevel = level + (kind === 'ses' ? 0 : p.phi * trend) + p.alpha * e;
    if (kind !== 'ses') trend = p.phi * trend + p.beta * e;
    if (kind === 'seasonal') season[t % m] = s + p.gamma * e;
    level = newLevel;
    levels.push(level);
  }
  // Mavsumni navbat bo'yicha tartiblash: keyingi oyning koeffitsienti birinchi
  const ordered = kind === 'seasonal' ? Array.from({ length: m }, (_, i) => season[(y.length + i) % m]!) : [];
  return { fitted, residuals, levels, state: { level, trend, season: ordered } };
}

/** Faqat xatolar kvadratlari yig'indisi — parametr qidirishda tez (massivlarsiz) */
function sseEts(y: number[], kind: EtsKind, p: EtsParams, m: number, from: number, init: EtsState): number {
  const season = kind === 'seasonal' ? [...init.season] : [];
  let level = init.level;
  let trend = init.trend;
  let sse = 0;
  for (let t = 0; t < y.length; t += 1) {
    const s = kind === 'seasonal' ? season[t % m]! : 0;
    const hat = kind === 'mean' ? level : level + p.phi * trend + s;
    const e = y[t]! - hat;
    if (t >= from) sse += e * e;
    if (kind === 'mean') continue;
    const newLevel = level + (kind === 'ses' ? 0 : p.phi * trend) + p.alpha * e;
    if (kind !== 'ses') trend = p.phi * trend + p.beta * e;
    if (kind === 'seasonal') season[t % m] = s + p.gamma * e;
    level = newLevel;
  }
  return Number.isFinite(sse) ? sse : Infinity;
}

function aiccOf(sse: number, n: number, k: number): number {
  const s = Math.max(sse, 1e-9) / n;
  const aic = n * Math.log(s) + 2 * k;
  return n - k - 1 > 0 ? aic + (2 * k * (k + 1)) / (n - k - 1) : Infinity;
}

/** Bir turdagi modelni moslash: parametrlar to'ri, so'ng eng yaxshi nuqta atrofida aniqlashtirish */
export function fitEtsKind(y: number[], kind: EtsKind, m = 12): EtsFit | null {
  const n = y.length;
  if (n < 3) return null;
  if (kind === 'holt' && n < 6) return null;
  if (kind === 'seasonal' && n < 2 * m + 3) return null;

  const alphas = kind === 'mean' ? [0] : [0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
  const betaShares = kind === 'holt' || kind === 'seasonal' ? [0.02, 0.1, 0.25, 0.5] : [0];
  const gammaShares = kind === 'seasonal' ? [0.05, 0.15, 0.3, 0.5] : [0];
  // 1 — so'nmaydigan trend; ma'lumot kam bo'lsa ehtiyotkor (so'nuvchi) variantlar ustun
  const phis = kind === 'holt' || kind === 'seasonal' ? [0.8, 0.9, 0.95, 0.98, 1] : [1];
  // Mavsumiy modelda birinchi mavsum boshlang'ich qiymatlarga sarflanadi
  const from = kind === 'seasonal' ? m : 1;
  const init = initialState(y, kind, m);
  const sseOf = (p: EtsParams): number => sseEts(y, kind, p, m, from, init);
  const make = (alpha: number, bs: number, gs: number, phi: number): EtsParams => ({ alpha, beta: alpha * bs, gamma: (1 - alpha) * gs, phi });

  type Point = { a: number; bs: number; gs: number; phi: number; sse: number };
  let found: Point | null = null;
  for (const a of alphas) {
    for (const bs of betaShares) {
      for (const gs of gammaShares) {
        for (const phi of phis) {
          const sse = sseOf(make(a, bs, gs, phi));
          if (!found || sse < found.sse) found = { a, bs, gs, phi, sse };
        }
      }
    }
  }
  if (!found) return null;
  let best: Point = found;

  // Aniqlashtirish: har bir parametrni kichik qadam bilan siljitib ko'ramiz (to'r orasidagi qiymatlar)
  if (kind !== 'mean') {
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    let step = 0.05;
    for (let round = 0; round < 3; round += 1) {
      for (const key of ['a', 'bs', 'gs', 'phi'] as const) {
        if (key === 'bs' && kind === 'ses') continue;
        if (key === 'gs' && kind !== 'seasonal') continue;
        if (key === 'phi' && kind === 'ses') continue;
        for (const dir of [-1, 1]) {
          const trial: Point = { ...best };
          if (key === 'a') trial.a = clamp(best.a + dir * step, 0.02, 0.95);
          if (key === 'bs') trial.bs = clamp(best.bs + dir * step, 0.01, 0.8);
          if (key === 'gs') trial.gs = clamp(best.gs + dir * step, 0.01, 0.8);
          if (key === 'phi') trial.phi = clamp(best.phi + dir * step * 0.4, 0.8, 1);
          const sse = sseOf(make(trial.a, trial.bs, trial.gs, trial.phi));
          if (sse < best.sse - 1e-9) best = { ...trial, sse };
        }
      }
      step /= 2;
    }
  }

  const params = make(best.a, best.bs, best.gs, best.phi);
  const run = runEts(y, kind, params, m);
  const fromUsed = kind === 'seasonal' ? m : kind === 'mean' ? 0 : 1;
  const used = n - fromUsed;
  const paramCount = { mean: 1, ses: 2, holt: 5, seasonal: 5 + (m - 1) + 1 }[kind];
  const sigma = Math.sqrt(best.sse / Math.max(1, used - (kind === 'mean' ? 1 : Math.min(paramCount, used - 1))));
  return {
    kind,
    params,
    level: run.state.level,
    trend: run.state.trend,
    season: run.state.season,
    period: m,
    fitted: run.fitted,
    residuals: run.residuals,
    levels: run.levels,
    sigma: kind === 'mean' ? sd(y) : sigma,
    aicc: aiccOf(best.sse, used, paramCount),
    paramCount,
  };
}

/**
 * Bir martalik keskin sakrashlarni topish (masalan, bir oyda xato yoki bir martalik katta to'lov).
 * Har bir oy qo'shni oylar medianasi bilan solishtiriladi; farq odatiy tebranishdan (MAD) 4,5 barobar katta bo'lsa
 * va boshqa yillarning shu oyida shunga o'xshash sakrash bo'lmasa (ya'ni mavsum emas) — model o'rgatishda
 * o'rniga qo'shnilar medianasi olinadi. Oxirgi oy tegilmaydi: u yangi daraja boshlanishi bo'lishi mumkin.
 * Haqiqiy yozuvlar o'zgarmaydi — faqat modelni o'rgatishda ishlatiladi.
 */
export function cleanOutliers(y: number[], m = 12): { values: number[]; cleaned: { index: number; value: number; used: number }[] } {
  const n = y.length;
  if (n < 8) return { values: [...y], cleaned: [] };
  const local = y.map((_, i) => {
    const window: number[] = [];
    for (let k = i - 2; k <= i + 2; k += 1) if (k >= 0 && k < n && k !== i) window.push(y[k]!);
    return median(window);
  });
  const dev = y.map((v, i) => v - local[i]!);
  const mad = median(dev.map((d) => Math.abs(d - median(dev)))) * 1.4826;
  const scale = Math.max(mad, Math.abs(median(y)) * 0.02);
  if (!(scale > 0)) return { values: [...y], cleaned: [] };
  const values = [...y];
  const cleaned: { index: number; value: number; used: number }[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const z = dev[i]! / scale;
    if (Math.abs(z) < 4.5) continue;
    // Mavsummi: boshqa yilning shu oyida ham shu yo'nalishda katta farq bormi
    let seasonal = false;
    for (let k = i % m; k < n; k += m) {
      if (k === i) continue;
      if (Math.sign(dev[k]!) === Math.sign(dev[i]!) && Math.abs(dev[k]!) > Math.abs(dev[i]!) * 0.4) seasonal = true;
    }
    if (seasonal) continue;
    values[i] = local[i]!;
    cleaned.push({ index: i, value: y[i]!, used: local[i]! });
  }
  return { values, cleaned };
}

const SELECT_HORIZON = 3;

/**
 * Modelni o'tmishda sinash: har bir boshlang'ich oydan faqat oldingi ma'lumot bilan o'rgatib,
 * 1–3 oy oldinga aytilgan qiymatni haqiqiy bilan solishtiramiz (rolling origin).
 */
function rollingErrors(y: number[], kind: EtsKind, m: number, from: number): { error: number | null; byHorizon: (number | null)[]; points: number; oneStep: number[] } | null {
  const n = y.length;
  const absErr = new Array<number>(SELECT_HORIZON).fill(0);
  const absAct = new Array<number>(SELECT_HORIZON).fill(0);
  const count = new Array<number>(SELECT_HORIZON).fill(0);
  const oneStep: number[] = [];
  for (let t = from; t < n; t += 1) {
    const fit = fitEtsKind(y.slice(0, t), kind, m);
    if (!fit) return null;
    const ahead = etsForecast(fit, SELECT_HORIZON);
    for (let h = 0; h < SELECT_HORIZON && t + h < n; h += 1) {
      const e = y[t + h]! - ahead[h]!;
      absErr[h] += Math.abs(e);
      absAct[h] += Math.abs(y[t + h]!);
      count[h] += 1;
      if (h === 0) oneStep.push(e);
    }
  }
  const byHorizon = absErr.map((e, h) => (count[h]! > 0 && absAct[h]! > 0 ? e / absAct[h]! : null));
  const totalErr = absErr.reduce((a, b) => a + b, 0);
  const totalAct = absAct.reduce((a, b) => a + b, 0);
  return { error: totalAct > 0 ? totalErr / totalAct : null, byHorizon, points: count[0]!, oneStep };
}

/**
 * Ma'lumot uzunligiga qarab mos modellar ichidan eng yaxshisi:
 *  1) bir martalik keskin sakrashlar o'rgatishdan chiqariladi (cleanOutliers);
 *  2) 12 oy va undan ko'p bo'lsa — har model o'tmishda 1, 2 va 3 oy oldinga aytib ko'riladi,
 *     eng kam xato qilgani olinadi (murakkabroq model oddiyidan kamida 3% aniqroq bo'lsagina);
 *     ma'lumot kam bo'lsa — AICc bo'yicha;
 *  3) ehtimol oraliqlari halol bo'lishi uchun tebranish (σ) sinovdagi haqiqiy xatolardan kam olinmaydi.
 */
export function fitEts(y: number[], m = 12): EtsFit | null {
  if (y.length < 3) return null;
  const { values, cleaned } = cleanOutliers(y, m);
  const n = values.length;
  let candidates: EtsKind[] = n >= 2 * m + 3 ? ['ses', 'holt', 'seasonal'] : n >= 6 ? ['ses', 'holt'] : ['mean'];
  // Hamma model bir xil oylarda sinaladi (oxirgi 6 oy); mavsumiy model kamida 2 yil + 3 oy o'rgangandan keyin sinaladi —
  // shunday sinov oylari 3 tadan kam bo'lsa, mavsumiy nomzod chiqariladi
  let from = Math.max(candidates.includes('seasonal') ? 2 * m + 3 : 5, n - 6);
  if (candidates.includes('seasonal') && n - from < 3) {
    candidates = ['ses', 'holt'];
    from = Math.max(5, n - 6);
  }

  const diag: EtsDiagnostics = { cleaned, candidates: [], chosenBy: 'only', sigmaModel: 0, sigmaTest: null, testPoints: 0 };
  let chosen: EtsKind | null = candidates.length === 1 ? candidates[0]! : null;
  let oneStep: number[] = [];

  if (!chosen && n >= 12) {
    let bestError = Infinity;
    const tested: { kind: EtsKind; r: NonNullable<ReturnType<typeof rollingErrors>> }[] = [];
    for (const kind of candidates) {
      const r = rollingErrors(values, kind, m, from);
      diag.candidates.push({ kind, error: r?.error ?? null, byHorizon: r?.byHorizon ?? [], points: r?.points ?? 0 });
      if (!r || r.error === null) continue;
      tested.push({ kind, r });
      if (chosen === null || r.error < bestError * 0.97) {
        chosen = kind;
        bestError = r.error;
      }
    }
    if (chosen) {
      diag.chosenBy = 'test';
      oneStep = tested.find((x) => x.kind === chosen)!.r.oneStep;
    }
  }

  let fit: EtsFit | null = null;
  if (chosen) fit = fitEtsKind(values, chosen, m);
  if (!fit) {
    for (const kind of candidates) {
      const f = fitEtsKind(values, kind, m);
      if (!diag.candidates.some((c) => c.kind === kind)) diag.candidates.push({ kind, error: null, byHorizon: [], points: 0 });
      if (!f) continue;
      const penalty = kind === 'seasonal' ? 2 : kind === 'holt' ? 1 : 0;
      if (!fit || f.aicc + penalty < fit.aicc) fit = f;
    }
    if (fit && candidates.length > 1) diag.chosenBy = 'aicc';
  }
  if (!fit) return null;

  diag.sigmaModel = fit.sigma;
  if (oneStep.length >= 4) {
    const sigmaTest = Math.sqrt(oneStep.reduce((s, e) => s + e * e, 0) / oneStep.length);
    diag.sigmaTest = sigmaTest;
    diag.testPoints = oneStep.length;
    // Oraliqlar sinovdagi haqiqiy xatolardan tor bo'lmasin (o'ziga ortiqcha ishonmaslik)
    if (sigmaTest > fit.sigma) fit.sigma = sigmaTest;
  }
  fit.diag = diag;
  return fit;
}

/** h qadam oldinga nuqtaviy prognoz */
export function etsForecast(fit: EtsFit, h: number): number[] {
  const out: number[] = [];
  let damp = 0;
  for (let i = 1; i <= h; i += 1) {
    damp += fit.params.phi ** i;
    if (fit.kind === 'mean') out.push(fit.level);
    else if (fit.kind === 'ses') out.push(fit.level);
    else out.push(fit.level + damp * fit.trend + (fit.kind === 'seasonal' ? fit.season[(i - 1) % fit.period]! : 0));
  }
  return out;
}

export interface ForecastBand {
  mean: number;
  lo80: number;
  hi80: number;
  lo95: number;
  hi95: number;
}

/**
 * Ishonch oraliqlari: model tenglamalari bo'yicha tasodifiy yo'llar simulyatsiyasi.
 * nonNegative — daromad va xarajat manfiy bo'lmaydi.
 */
export function etsSimulate(fit: EtsFit, h: number, seed: number, nonNegative: boolean, paths = 2000): ForecastBand[] {
  return etsSimulatePaths(fit, h, seed, nonNegative, 0, paths).bands;
}

/**
 * Simulyatsiya: har bir oy uchun oraliqlar, (sumSteps > 0 bo'lsa) birinchi sumSteps oy
 * yig'indisining har bir yo'ldagi qiymati — yil oxiri jami va risk uchun, hamda
 * (threshold berilsa) har oy qiymat chegaradan yuqori bo'lish ehtimoli — Nazorat uchun.
 */
export function etsSimulatePaths(
  fit: EtsFit,
  h: number,
  seed: number,
  nonNegative: boolean,
  sumSteps = 0,
  paths = 2000,
  threshold: number | null = null,
  /** Birinchi qadam (joriy, tugamagan oy) kamida shu qiymat: oyda allaqachon yozilgan summa */
  floorFirst: number | null = null,
): { bands: ForecastBand[]; totals: number[]; above: number[] } {
  const random = rng(seed);
  const point = etsForecast(fit, h);
  const samples: number[][] = Array.from({ length: h }, () => []);
  const totals: number[] = [];
  for (let s = 0; s < paths; s += 1) {
    let total = 0;
    let level = fit.level;
    let trend = fit.trend;
    const season = [...fit.season];
    for (let i = 0; i < h; i += 1) {
      const seasonal = fit.kind === 'seasonal' ? season[i % fit.period]! : 0;
      const hat = fit.kind === 'mean' ? level : level + (fit.kind === 'ses' ? 0 : fit.params.phi * trend) + seasonal;
      const e = gaussian(random) * fit.sigma;
      const raw = nonNegative ? Math.max(0, hat + e) : hat + e;
      // Joriy oy: yozilgan summadan kam bo'la olmaydi
      const value = i === 0 && floorFirst !== null ? Math.max(floorFirst, raw) : raw;
      samples[i]!.push(value);
      if (i < sumSteps) total += value;
      if (fit.kind === 'mean') continue;
      const newLevel = level + (fit.kind === 'ses' ? 0 : fit.params.phi * trend) + fit.params.alpha * e;
      if (fit.kind !== 'ses') trend = fit.params.phi * trend + fit.params.beta * e;
      if (fit.kind === 'seasonal') season[i % fit.period] = seasonal + fit.params.gamma * e;
      level = newLevel;
    }
    if (sumSteps > 0) totals.push(total);
  }
  const bands = point.map((p, i) => {
    const values = samples[i]!;
    const floor = i === 0 && floorFirst !== null ? floorFirst : nonNegative ? 0 : -Infinity;
    const clip = (v: number) => Math.max(floor, v);
    return {
      mean: clip(p),
      lo80: clip(quantile(values, 0.1)),
      hi80: clip(quantile(values, 0.9)),
      lo95: clip(quantile(values, 0.025)),
      hi95: clip(quantile(values, 0.975)),
    };
  });
  // Har oy uchun: chegaradan yuqori chiqqan yo'llar ulushi
  const above = threshold === null ? [] : samples.map((values) => values.filter((v) => v > threshold).length / Math.max(1, values.length));
  return { bands, totals, above };
}

/** Bir qadam: holatdan kutilgan qiymat va xato bilan yangilash (simulyatsiya uchun) */
interface SimState {
  level: number;
  trend: number;
  season: number[];
}

function stepEts(fit: EtsFit, st: SimState, i: number, e: number): number {
  const seasonal = fit.kind === 'seasonal' ? st.season[i % fit.period]! : 0;
  const hat = fit.kind === 'mean' ? st.level : st.level + (fit.kind === 'ses' ? 0 : fit.params.phi * st.trend) + seasonal;
  if (fit.kind !== 'mean') {
    const newLevel = st.level + (fit.kind === 'ses' ? 0 : fit.params.phi * st.trend) + fit.params.alpha * e;
    if (fit.kind !== 'ses') st.trend = fit.params.phi * st.trend + fit.params.beta * e;
    if (fit.kind === 'seasonal') st.season[i % fit.period] = seasonal + fit.params.gamma * e;
    st.level = newLevel;
  }
  return hat + e;
}

/**
 * Ikki qatorni (masalan, daromad va xarajat) birga simulyatsiya qilish:
 * ularning tasodifiy og'ishlari o'zaro bog'liq (rho) bo'lishi mumkin.
 * Natija: har bir qator uchun [yo'l][oy] qiymatlar.
 */
export function etsSimulateJoint(
  a: EtsFit,
  b: EtsFit,
  rho: number,
  h: number,
  seed: number,
  paths = 2000,
): { a: number[][]; b: number[][] } {
  const random = rng(seed);
  const r = Math.max(-0.95, Math.min(0.95, Number.isFinite(rho) ? rho : 0));
  const k = Math.sqrt(1 - r * r);
  const outA: number[][] = [];
  const outB: number[][] = [];
  for (let s = 0; s < paths; s += 1) {
    const sa: SimState = { level: a.level, trend: a.trend, season: [...a.season] };
    const sb: SimState = { level: b.level, trend: b.trend, season: [...b.season] };
    const pa: number[] = [];
    const pb: number[] = [];
    for (let i = 0; i < h; i += 1) {
      const z1 = gaussian(random);
      const z2 = r * z1 + k * gaussian(random);
      pa.push(Math.max(0, stepEts(a, sa, i, z1 * a.sigma)));
      pb.push(Math.max(0, stepEts(b, sb, i, z2 * b.sigma)));
    }
    outA.push(pa);
    outB.push(pb);
  }
  return { a: outA, b: outB };
}

export interface Backtest {
  /** Sinalgan oylar soni */
  points: number;
  /** O'rtacha nisbiy xato: Σ|xato| / Σ|haqiqiy| */
  wape: number | null;
  /** Oddiy usul (o'tgan oy takrorlanadi) xatosi */
  naiveWape: number | null;
  /** Har bir sinalgan oy: haqiqiy va model aytgan */
  rows: { index: number; actual: number; predicted: number }[];
  /** 1, 2, 3 oy oldinga aytilganda o'rtacha nisbiy xato */
  byHorizon: { h: number; wape: number | null; points: number }[];
  /** 80% oraliqqa tushgan oylar (1 oy oldinga, o'sha paytdagi model oralig'i bilan) */
  inside80: number;
}

/**
 * O'tmishda sinash: oxirgi oylarni yashirib, model ularni qanchalik to'g'ri aytganini tekshirish.
 * Har bir oy uchun model faqat undan oldingi ma'lumotda qaytadan o'rgatiladi.
 */
export function backtestEts(y: number[], holdout: number, m = 12, nonNegative = true): Backtest {
  const rows: Backtest['rows'] = [];
  const start = Math.max(4, y.length - holdout);
  const hErr = [0, 0, 0];
  const hAct = [0, 0, 0];
  const hCount = [0, 0, 0];
  let inside80 = 0;
  const clip = (v: number) => (nonNegative ? Math.max(0, v) : v);
  for (let t = start; t < y.length; t += 1) {
    const fit = fitEts(y.slice(0, t), m);
    if (!fit) continue;
    const ahead = etsForecast(fit, 3).map(clip);
    const predicted = ahead[0]!;
    rows.push({ index: t, actual: y[t]!, predicted });
    if (Math.abs(y[t]! - predicted) <= 1.2816 * fit.sigma) inside80 += 1;
    for (let h = 0; h < 3 && t + h < y.length; h += 1) {
      hErr[h] += Math.abs(y[t + h]! - ahead[h]!);
      hAct[h] += Math.abs(y[t + h]!);
      hCount[h] += 1;
    }
  }
  const absActual = sum(rows.map((r) => Math.abs(r.actual)));
  const absError = sum(rows.map((r) => Math.abs(r.actual - r.predicted)));
  const naiveError = sum(rows.map((r) => Math.abs(r.actual - y[r.index - 1]!)));
  return {
    points: rows.length,
    wape: rows.length && absActual > 0 ? absError / absActual : null,
    naiveWape: rows.length && absActual > 0 ? naiveError / absActual : null,
    rows,
    byHorizon: [0, 1, 2].map((h) => ({ h: h + 1, wape: hCount[h]! > 0 && hAct[h]! > 0 ? hErr[h]! / hAct[h]! : null, points: hCount[h]! })),
    inside80,
  };
}