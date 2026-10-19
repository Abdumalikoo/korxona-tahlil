import { cleanOutliers, etsForecast, type EtsKind, etsSimulate, fitEts, fitEtsKind, median, seedOf } from '../econ/econ.math';

// ═══════════════════════════════════════════════════════════
// Hudud prognozi — sof hisob funksiyalari (bazaga bog'liq emas, testlanadi).
//
// Model: Katta modellar › Prognoz bilan bir xil ETS oilasi (o'rtacha, SES, Holt, mavsumiy Holt-Winters);
// tur ma'lumot uzunligiga va o'tmishdagi aniqligiga qarab avtomatik tanlanadi.
// Tekshiruv — «sirpanuvchi boshlanish» (rolling origin): oxirgi 6 oyning har biri uchun model faqat
// undan oldingi ma'lumotda o'rgatiladi va 1–3 oy oldinga aytadi; xato WAPE = Σ|xato| ÷ Σ|haqiqiy|.
// Taqqoslash uchun oddiy usul (o'tgan oy takrorlanadi) xatosi ham beriladi.
// Oraliq — 80%: model tenglamalari bo'yicha simulyatsiya (10–90 persentil).
// ═══════════════════════════════════════════════════════════

export const Z80 = 1.2816;

export type ModelKind = 'mean' | 'ses' | 'holt' | 'seasonal' | 'short' | 'zero';
export const MODEL_LABELS: Record<ModelKind, string> = {
  mean: "O'rtacha daraja",
  ses: 'Eksponensial tekislash (SES)',
  holt: 'Trendli (Holt, so‘nuvchi)',
  seasonal: 'Mavsumiy (Holt-Winters)',
  short: "Ma'lumot kam — mavjud oylar o'rtachasi",
  zero: "So'nggi 6 oyda bo'lmagan — 0",
};

export type Reliability = 'high' | 'medium' | 'low' | 'none';

export interface Band {
  mean: number;
  lo: number;
  hi: number;
}

export interface Accuracy {
  /** Sinalgan nuqtalar (1 oy oldinga) */
  points: number;
  /** 1 oy oldinga WAPE */
  wape: number | null;
  /** Oddiy usul (o'tgan oy) WAPE */
  naiveWape: number | null;
  /** Gorizont bo'yicha WAPE: [1 oy, 2 oy, 3 oy] */
  byH: (number | null)[];
}

export interface SeriesResult {
  model: ModelKind;
  forecast: Band[];
  accuracy: Accuracy;
  reliability: Reliability;
  /** O'qitishda ishlatilgan oylar soni */
  used: number;
}

/** Oy chegarasi: sana oyning 15-kunidan keyin bo'lsa — keyingi oydan */
export function regimeMonth(date: Date): string {
  const d = new Date(date);
  const p = d.toISOString().slice(0, 7);
  if (d.getUTCDate() <= 15) return p;
  const [y, m] = p.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

/** Sirpanuvchi tekshiruv: oxirgi `origins` oy, har birida 1..H oy oldinga */
/**
 * Model turini tanlash: oxirgi oylarni bir qadam oldinga aytib ko'rish xatosi bo'yicha.
 * Mavsumiy (Holt-Winters) — kamida 27 oy bo'lsa nomzod va 27-oydan keyingi oylarda sinaladi (Katta modellardagi
 * umumiy tanlovdan farqli: u mavsumiyni sinash uchun yetarli oy yo'q deb chiqarib tashlardi).
 * Murakkabroq tur oddiyidan kamida 3% aniqroq bo'lsagina tanlanadi.
 */
export function chooseKind(y: number[], m = 12): EtsKind | null {
  const n = y.length;
  if (n < 3) return null;
  if (n < 6) return 'mean';
  const cands: EtsKind[] = n >= 2 * m + 3 ? ['ses', 'holt', 'seasonal'] : ['ses', 'holt'];
  const minT = cands.includes('seasonal') ? 2 * m + 3 : 5;
  const from = Math.max(minT, n - 6);
  if (n - from < 2) return fitEts(y, m)?.kind ?? null;
  let best: { kind: EtsKind; err: number } | null = null;
  for (const kind of cands) {
    let err = 0;
    let ok = true;
    for (let t = from; t < n; t++) {
      const fit = fitEtsKind(y.slice(0, t), kind, m);
      if (!fit) {
        ok = false;
        break;
      }
      err += Math.abs(y[t]! - Math.max(0, etsForecast(fit, 1)[0]!));
    }
    if (!ok) continue;
    if (!best || err < best.err * 0.97) best = { kind, err };
  }
  return best?.kind ?? null;
}

export function rollingBacktest(y: number[], origins = 6, H = 3, kind: EtsKind | null = null): Accuracy {
  const errs: number[][] = Array.from({ length: H }, () => []);
  const acts: number[][] = Array.from({ length: H }, () => []);
  let naiveErr = 0;
  let naiveAct = 0;
  const start = Math.max(4, y.length - origins);
  for (let t = start; t < y.length; t++) {
    // Har bir sinov oyida ham xuddi asosiy prognozdagidek: sakrashlar tozalanadi, keyin o'rgatiladi
    const fit = kind ? fitEtsKind(cleanOutliers(y.slice(0, t)).values, kind) : fitEts(y.slice(0, t));
    if (!fit) continue;
    const f = etsForecast(fit, H);
    for (let k = 0; k < H && t + k < y.length; k++) {
      errs[k]!.push(Math.abs(y[t + k]! - Math.max(0, f[k]!)));
      acts[k]!.push(Math.abs(y[t + k]!));
    }
    naiveErr += Math.abs(y[t]! - y[t - 1]!);
    naiveAct += Math.abs(y[t]!);
  }
  const w = (e: number[], a: number[]) => {
    const sa = a.reduce((s, x) => s + x, 0);
    return e.length && sa > 0 ? e.reduce((s, x) => s + x, 0) / sa : null;
  };
  const byH = errs.map((e, k) => w(e, acts[k]!));
  return { points: errs[0]!.length, wape: byH[0] ?? null, naiveWape: naiveAct > 0 && errs[0]!.length ? naiveErr / naiveAct : null, byH };
}

export function reliabilityOf(acc: Accuracy, used: number): Reliability {
  if (used < 3) return 'none';
  if (acc.points < 3 || acc.wape === null) return 'low';
  if (acc.wape <= 0.1) return 'high';
  if (acc.wape <= 0.2) return 'medium';
  return 'low';
}

/** Bitta qator prognozi (so'mda). y — xronologik, oxirgisi oxirgi to'liq oy */
export function forecastSeries(y: number[], h: number, key: string, nonNegative = true): SeriesResult {
  const emptyAcc: Accuracy = { points: 0, wape: null, naiveWape: null, byH: [null, null, null] };
  const tail = y.slice(-6);
  if (!y.length || (tail.length >= 3 && tail.every((v) => v === 0))) {
    return { model: 'zero', forecast: Array.from({ length: h }, () => ({ mean: 0, lo: 0, hi: 0 })), accuracy: emptyAcc, reliability: y.length ? 'medium' : 'none', used: y.length };
  }
  if (y.length < 3) {
    const m = y.reduce((s, v) => s + v, 0) / y.length;
    const spread = Math.abs(m) * 0.25;
    return { model: 'short', forecast: Array.from({ length: h }, () => ({ mean: m, lo: Math.max(nonNegative ? 0 : -Infinity, m - spread), hi: m + spread })), accuracy: emptyAcc, reliability: 'none', used: y.length };
  }
  // Katta modellar › Prognoz bilan bir xil yadro: sakrashlarni tozalash, 1–3 oy oldinga sinab tanlash, oraliqni sinov xatosi bilan kalibrlash
  const fit = fitEts(y);
  if (!fit) {
    const m = y.reduce((s, v) => s + v, 0) / y.length;
    return { model: 'short', forecast: Array.from({ length: h }, () => ({ mean: m, lo: m * 0.75, hi: m * 1.25 })), accuracy: emptyAcc, reliability: 'low', used: y.length };
  }
  const bands = etsSimulate(fit, h, seedOf(key), nonNegative, 400);
  // Mavsumiy model faqat 27-oydan keyin sinaladi — sinov nuqtalari kam bo'lsa, umumiy tanlov bilan to'ldiriladi
  let accuracy = rollingBacktest(y, 6, 3, fit.kind);
  if (accuracy.points < 3) accuracy = rollingBacktest(y);
  return {
    model: fit.kind,
    forecast: bands.map((b) => ({ mean: b.mean, lo: b.lo80, hi: b.hi80 })),
    accuracy,
    reliability: reliabilityOf(accuracy, y.length),
    used: y.length,
  };
}

/** Oraliqlarni qo'shish: o'rtachalar yig'indisi, σ = √Σσ² (qatorlar mustaqil deb) */
export function sumBands(list: Band[][], h: number, nonNegative = true): Band[] {
  return Array.from({ length: h }, (_, i) => {
    let mean = 0;
    let v = 0;
    for (const b of list) {
      const x = b[i];
      if (!x) continue;
      mean += x.mean;
      const s = (x.hi - x.lo) / (2 * Z80);
      v += s * s;
    }
    const s = Math.sqrt(v);
    return { mean, lo: nonNegative ? Math.max(0, mean - Z80 * s) : mean - Z80 * s, hi: mean + Z80 * s };
  });
}

/** a − b − c ... (natija uchun): o'rtachalar ayirmasi, dispersiyalar yig'indisi */
export function diffBands(plus: Band[], minus: Band[][], h: number): Band[] {
  return Array.from({ length: h }, (_, i) => {
    const p = plus[i] ?? { mean: 0, lo: 0, hi: 0 };
    let mean = p.mean;
    let v = ((p.hi - p.lo) / (2 * Z80)) ** 2;
    for (const m of minus) {
      const x = m[i];
      if (!x) continue;
      mean -= x.mean;
      v += ((x.hi - x.lo) / (2 * Z80)) ** 2;
    }
    const s = Math.sqrt(v);
    return { mean, lo: mean - Z80 * s, hi: mean + Z80 * s };
  });
}

/** Ko'paytirish (tarif omili): oraliq ham shu omil bilan */
export function scaleBand(b: Band, k: number): Band {
  return { mean: b.mean * k, lo: b.lo * k, hi: b.hi * k };
}

/** Bir nechta qatorning WAPE sini birlashtirish (vaznli) */
export function pooledWape(items: { wape: number | null; weight: number }[]): number | null {
  const ok = items.filter((i) => i.wape !== null && i.weight > 0);
  const w = ok.reduce((s, i) => s + i.weight, 0);
  return w > 0 ? ok.reduce((s, i) => s + i.wape! * i.weight, 0) / w : null;
}

/** Xodim bo'yicha ish haqi: kartadagi maosh × stavka × odatiy nisbat (bonus, ushlanma) yoki so'nggi 3 oy medianasi */
export function employeeMonthly(opts: {
  baseTiyin: number | null;
  ratio: number | null;
  regionRatio: number | null;
  recent: number[];
  regionMedian: number | null;
}): { value: number; basis: 'CARD' | 'RECENT' | 'REGION' | 'NONE' } {
  if (opts.baseTiyin !== null && opts.baseTiyin > 0) return { value: opts.baseTiyin * (opts.ratio ?? opts.regionRatio ?? 1), basis: 'CARD' };
  const r = opts.recent.filter((x) => x > 0);
  if (r.length) return { value: median(r), basis: 'RECENT' };
  if (opts.regionMedian !== null) return { value: opts.regionMedian, basis: 'REGION' };
  return { value: 0, basis: 'NONE' };
}

export interface TariffRow {
  categoryCode: string;
  regionCode: number | null;
  priceTiyin: bigint;
  validFrom: Date;
}

/** Xizmat narxi oy bo'yicha (hududga xos tarif umumiysidan ustun) */
export function priceAt(tariffs: TariffRow[], code: string, region: number, period: string): number | null {
  let best: { p: string; price: number; specific: boolean } | null = null;
  for (const t of tariffs) {
    if (t.categoryCode !== code || (t.regionCode !== null && t.regionCode !== region)) continue;
    const p = regimeMonth(t.validFrom);
    if (p > period) continue;
    const specific = t.regionCode !== null;
    if (!best || p > best.p || (p === best.p && specific && !best.specific)) best = { p, price: Number(t.priceTiyin), specific };
  }
  return best ? best.price : null;
}