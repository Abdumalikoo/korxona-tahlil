import { backtestEts, etsSimulatePaths, fitEts, seedOf } from './econ.math';
import type { Reliability } from './econ.types';

// ═══════════════════════════════════════════════════════════
// Bitta oylik qator uchun qisqa prognoz — boshqa bo'limlar (Nazorat) uchun.
// Faqat tugagan oylar o'rgatiladi; birinchi prognoz oyi — joriy oy.
// ═══════════════════════════════════════════════════════════

export interface OutlookStep {
  period: string;
  mean: number;
  lo80: number;
  hi80: number;
  /** Chegara berilgan bo'lsa: qiymat chegaradan yuqori bo'lish ehtimoli (0..1) */
  pAbove: number | null;
}

export interface Outlook {
  model: string;
  reliability: Reliability;
  /** Sinovdagi o'rtacha nisbiy xato (0..1) */
  wape: number | null;
  /** Joriy oy + keyingi oylar */
  steps: OutlookStep[];
  months: number;
}

const MODEL_SHORT: Record<string, string> = {
  mean: "o'rtacha",
  ses: 'eksponensial tekislash',
  holt: 'trendli model',
  seasonal: 'mavsumiy model',
};

function shift(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/**
 * values — tugagan oylar (eskisidan yangisiga, so'mda), oxirgisi currentPeriod dan oldingi oy.
 * Boshidagi nol oylar tashlanadi (modda keyinroq paydo bo'lgan bo'lishi mumkin).
 */
export function outlookOf(
  values: number[],
  currentPeriod: string,
  options: { steps: number; nonNegative: boolean; threshold?: number | null; seedKey: string },
): Outlook | null {
  const first = values.findIndex((v) => v !== 0);
  if (first < 0) return null;
  const y = values.slice(first);
  if (y.length < 4) return null;
  const fit = fitEts(y);
  if (!fit) return null;
  const sim = etsSimulatePaths(fit, options.steps, seedOf(options.seedKey), options.nonNegative, 0, 2000, options.threshold ?? null);
  const holdout = y.length >= 12 ? 6 : y.length >= 8 ? 3 : 0;
  const bt = holdout ? backtestEts(y, holdout, 12, options.nonNegative) : null;
  const wape = bt?.wape ?? null;
  const reliability: Reliability =
    wape === null ? 'low' : y.length >= 18 && wape < 0.1 ? 'high' : y.length >= 9 && wape < 0.25 ? 'medium' : 'low';
  return {
    model: MODEL_SHORT[fit.kind] ?? fit.kind,
    reliability,
    wape,
    months: y.length,
    steps: sim.bands.map((b, i) => ({
      period: shift(currentPeriod, i),
      mean: b.mean,
      lo80: b.lo80,
      hi80: b.hi80,
      pAbove: options.threshold === null || options.threshold === undefined ? null : sim.above[i]!,
    })),
  };
}