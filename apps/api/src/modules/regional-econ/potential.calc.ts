// ═══════════════════════════════════════════════════════════
// C. Salohiyat — sof funksiyalar (bazaga bog'liq emas, testlanadi).
//
// Barqaror oyna: oxirgi tarkibiy uzilishdan keyingi oylar (eng ko'pi 12).
//   Uzilish — voqealar jurnalidan (isBreak) yoki avtomatik: Chow testi (ikki to'g'ri chiziq bitta chiziqdan
//   sezilarli yaxshi, F ≥ 10) va uzilish nuqtasida daraja sakrashi ≥ 15%. Bir tekis o'sish uzilish hisoblanmaydi.
// O'rtacha qiymat  Ȳ = (y₁ + … + yₙ) / n            — oynaning o'rtasiga ((n+1)/2-oy) tegishli
// O'rtacha o'sish  g = e^b − 1, b — ln(y) ning oy bo'yicha to'g'ri chiziq qiyaligi (log-chiziqli trend):
//   har oy o'rtacha necha foiz o'zgarishi; oy-oy foizlar o'rtachasidan farqli, tasodifiy tebranishda yuqoriga og'maydi.
//   (Qiymatlardan biri 0 yoki manfiy bo'lsa — musbat juftliklar bo'yicha oy-oy o'sishlar o'rtachasi.)
//   Barqaror qator ≥ 24 oy bo'lsa — mavsumdan xoli yillik solishtiruv: (Σ oxirgi 12 ÷ Σ oldingi 12)^(1/12) − 1.
// Salohiyat (k-oy oldinga) = Ȳ × (1 + g)^((n+1)/2 + k − 1)
//   Misol: 198, 195, 200 → Ȳ = 197,67; b = (ln200 − ln198)/2, g = 0,50%; keyingi oy = 197,67 × 1,0050² ≈ 199,7
// Oxirgi oy uchun «me'yor»: Ȳ × (1 + g)^((n−1)/2) — faktni salohiyat bilan solishtirish uchun.
// ═══════════════════════════════════════════════════════════

export const MAX_WINDOW = 12;
export const MIN_WINDOW = 3;
export const CHOW_F = 10;
export const MIN_JUMP = 0.15;

export interface ChowBreak {
  /** Yangi rejimning birinchi indeksi */
  index: number;
  f: number;
  /** Uzilish nuqtasida daraja sakrashi (nisbiy) */
  jump: number;
}

function lineFit(y: number[], offset: number) {
  const n = y.length;
  const xs = y.map((_, i) => offset + i);
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (y[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const b = sxx ? sxy / sxx : 0;
  const a = my - b * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (y[i]! - (a + b * xs[i]!)) ** 2;
  return { a, b, sse, at: (x: number) => a + b * x };
}

/** Eng kuchli bitta uzilish (yo'q bo'lsa null). Har segmentda kamida minSeg oy */
export function chowBreak(y: number[], minSeg = 3): ChowBreak | null {
  const n = y.length;
  if (n < 2 * minSeg) return null;
  const full = lineFit(y, 0);
  let best: ChowBreak | null = null;
  for (let k = minSeg; k <= n - minSeg; k++) {
    const a = lineFit(y.slice(0, k), 0);
    const b = lineFit(y.slice(k), k);
    const sseSplit = a.sse + b.sse;
    const df = n - 4;
    if (df <= 0) continue;
    const f = sseSplit > 1e-9 * Math.max(1, full.sse) ? (full.sse - sseSplit) / 2 / (sseSplit / df) : full.sse > 1e-9 ? Infinity : 0;
    const before = a.at(k - 0.5);
    const after = b.at(k - 0.5);
    const jump = before !== 0 ? Math.abs(after / before - 1) : after !== 0 ? Infinity : 0;
    if (f >= CHOW_F && jump >= MIN_JUMP && (!best || f > best.f)) best = { index: k, f, jump };
  }
  return best;
}

/** Oxirgi rejim boshi: uzilish topilsa, undan keyingi qismda yana qidiriladi */
export function lastRegimeStart(y: number[], minSeg = 3): { start: number; breaks: ChowBreak[] } {
  let start = 0;
  const breaks: ChowBreak[] = [];
  for (let guard = 0; guard < 6; guard++) {
    const b = chowBreak(y.slice(start), minSeg);
    if (!b) break;
    breaks.push({ ...b, index: start + b.index });
    start += b.index;
  }
  return { start, breaks };
}

export interface Potential {
  n: number;
  mean: number;
  growth: number;
  /** Variatsiya koeffitsienti: σ / Ȳ */
  cv: number | null;
  /** Oxirgi oy me'yori */
  fittedLast: number;
  /** k = 1..h oy oldinga */
  ahead: number[];
}

/** O'rtacha oylik o'sish: log-chiziqli trend qiyaligi (barcha qiymatlar musbat bo'lsa) */
export function avgGrowth(y: number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  if (y.every((v) => v > 0)) {
    const ly = y.map((v) => Math.log(v));
    const mx = (n - 1) / 2;
    const my = ly.reduce((s, v) => s + v, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += (i - mx) * (ly[i]! - my);
      sxx += (i - mx) ** 2;
    }
    return Math.exp(sxy / sxx) - 1;
  }
  const g: number[] = [];
  for (let i = 1; i < n; i++) if (y[i - 1]! > 0 && y[i]! >= 0) g.push(y[i]! / y[i - 1]! - 1);
  return g.length ? g.reduce((s, v) => s + v, 0) / g.length : 0;
}

/**
 * Mavsumdan xoli o'sish: barqaror qator ≥ 24 oy bo'lsa — oxirgi 12 oy yig'indisi ÷ oldingi 12 oy, oyiga keltirilgan.
 * (12 oylik oynada mavsum fazasi log-trend qiyaligini buzadi; yillik solishtiruv mavsumni yo'qotadi.) Aks holda null.
 */
export function yoyGrowth(stable: number[]): number | null {
  if (stable.length < 24) return null;
  const last = stable.slice(-12).reduce((s, v) => s + v, 0);
  const prev = stable.slice(-24, -12).reduce((s, v) => s + v, 0);
  if (last <= 0 || prev <= 0) return null;
  return (last / prev) ** (1 / 12) - 1;
}

export function potentialOf(win: number[], h: number, growthOverride: number | null = null): Potential | null {
  const n = win.length;
  if (!n) return null;
  const mean = win.reduce((s, v) => s + v, 0) / n;
  const growth = growthOverride ?? (n >= 2 ? avgGrowth(win) : 0);
  const sd = n >= 2 ? Math.sqrt(win.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const center = (n + 1) / 2;
  return {
    n,
    mean,
    growth,
    cv: mean ? sd / Math.abs(mean) : null,
    fittedLast: mean * (1 + growth) ** (n - center),
    ahead: Array.from({ length: h }, (_, i) => mean * (1 + growth) ** (n + 1 + i - center)),
  };
}

/**
 * Mavsum indeksi (oy uchun): barqaror qator ≥ 24 oy bo'lsa — oxirgi ikki 12 oylik blokda shu kalendar oy qiymati
 * ÷ (blok o'rtachasi × trend tuzatmasi (1+g)^(o'rin − 5,5)); ikki blok o'rtachasi. Aks holda null (mavsum hisoblanmaydi).
 * stable va periods bir xil uzunlikda, oxirgisi — oxirgi to'liq oy.
 */
export function seasonalIndex(stable: number[], periods: string[], month: number, g: number): number | null {
  if (stable.length < 24 || periods.length !== stable.length) return null;
  const ratios: number[] = [];
  for (const [from, to] of [[-12, undefined], [-24, -12]] as const) {
    const block = stable.slice(from, to);
    const ps = periods.slice(from, to);
    const mean = block.reduce((a, v) => a + v, 0) / block.length;
    const pos = ps.findIndex((p) => Number(p.slice(5)) === month);
    if (mean > 0 && pos >= 0) ratios.push(block[pos]! / (mean * (1 + g) ** (pos - 5.5)));
  }
  return ratios.length ? ratios.reduce((a, v) => a + v, 0) / ratios.length : null;
}