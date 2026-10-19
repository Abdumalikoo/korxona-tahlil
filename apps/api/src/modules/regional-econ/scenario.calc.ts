import { normalCdf } from '../econ/econ.math';
import { Z80 } from './forecast.calc';

// ═══════════════════════════════════════════════════════════
// I. Hudud stsenariylari — «agar … bo'lsa» (sof hisob, testlanadi).
// Asos — 3-bosqich prognozi (hudud × xizmat daromadi, xodimlar bo'yicha ish haqi, xarajat, Markaz ulushi).
// Har bir dastak tanlangan oydan boshlab va tanlangan hudud(lar)ga qo'llanadi:
//   Tarif ±%      → xizmat daromadi × (1 + t) × (1 + e·t)   (e — talab elastikligi: narx 10% oshsa hajm e·10% o'zgaradi)
//   Hajm ±%       → daromad × (1 + v)
//   Maosh indeks. → ish haqi × (1 + w)
//   Xodim ±N      → + N × (hudud o'rtacha oylik ish haqi) × (1 + w)
//   Xarajat ±%    → xarajat × (1 + o);  bir martalik xarajat — boshlanish oyiga
//   Markaz ±%     → Markaz ulushi × (1 + c)
//   Natija = Daromad − Ish haqi − Xarajat − Markaz ulushi.
// Zarar ehtimoli: P(natija < 0) = Φ(−natija / σ), σ — asos prognozining 80% oralig'idan (normal yaqinlashuv).
// ═══════════════════════════════════════════════════════════

export interface Levers {
  /** null — barcha hududlar */
  regionCode: number | null;
  /** Boshlanish oyi indeksi: 0 — birinchi prognoz oyi */
  start: number;
  tariffPct: number;
  /** null — barcha xizmatlar */
  tariffService: string | null;
  elasticity: number;
  volumePct: number;
  wagePct: number;
  headcount: number;
  opexPct: number;
  oneTimeTiyin: number;
  centralPct: number;
}

export const NO_LEVERS: Levers = { regionCode: null, start: 0, tariffPct: 0, tariffService: null, elasticity: 0, volumePct: 0, wagePct: 0, headcount: 0, opexPct: 0, oneTimeTiyin: 0, centralPct: 0 };

export interface BaseRegion {
  code: number;
  name: string;
  services: { key: string; forecast: number[] }[];
  payroll: number[];
  headcount: number[];
  opex: number[];
  overhead: number[];
  /** Natija σ (asos), oy bo'yicha */
  resultSigma: number[];
}

export interface ScenarioMonth {
  revenue: number;
  payroll: number;
  opex: number;
  overhead: number;
  result: number;
  lossProb: number | null;
}

export interface ScenarioRegion {
  code: number;
  name: string;
  touched: boolean;
  base: ScenarioMonth[];
  scen: ScenarioMonth[];
  /** Zararli oylar uchun: zararsizlikka yetish uchun kerakli tarif o'zgarishi (elastiklik hisobga olinmagan) */
  breakEvenTariff: (number | null)[];
}

const lossProb = (mean: number, sigma: number): number | null => (sigma > 0 ? normalCdf(-mean / sigma) : mean < 0 ? 1 : 0);

export function applyScenario(regions: BaseRegion[], h: number, L: Levers): ScenarioRegion[] {
  return regions.map((r) => {
    const touched = L.regionCode === null || L.regionCode === r.code;
    const avgPay = r.headcount[0] ? r.payroll[0]! / r.headcount[0]! : r.payroll[0] ?? 0;
    const base: ScenarioMonth[] = [];
    const scen: ScenarioMonth[] = [];
    const be: (number | null)[] = [];
    for (let i = 0; i < h; i++) {
      const on = touched && i >= L.start;
      let revB = 0;
      let revS = 0;
      for (const s of r.services) {
        const v = s.forecast[i] ?? 0;
        revB += v;
        let x = v;
        if (on) {
          if (L.tariffPct && (L.tariffService === null || L.tariffService === s.key)) x *= (1 + L.tariffPct) * (1 + L.elasticity * L.tariffPct);
          x *= 1 + L.volumePct;
        }
        revS += x;
      }
      const payB = r.payroll[i] ?? 0;
      const payS = on ? payB * (1 + L.wagePct) + L.headcount * avgPay * (1 + L.wagePct) : payB;
      const opB = r.opex[i] ?? 0;
      const opS = on ? opB * (1 + L.opexPct) + (i === L.start ? L.oneTimeTiyin : 0) : opB;
      const ohB = r.overhead[i] ?? 0;
      const ohS = on ? ohB * (1 + L.centralPct) : ohB;
      const resB = revB - payB - opB - ohB;
      const resS = revS - payS - opS - ohS;
      const sig = r.resultSigma[i] ?? 0;
      // σ ni daromad o'zgarishi nisbatida kengaytirish (tebranish asosan daromaddan)
      const sigS = revB > 0 ? sig * Math.max(0.2, revS / revB) : sig;
      base.push({ revenue: revB, payroll: payB, opex: opB, overhead: ohB, result: resB, lossProb: lossProb(resB, sig) });
      scen.push({ revenue: revS, payroll: payS, opex: opS, overhead: ohS, result: resS, lossProb: lossProb(resS, sigS) });
      // Zararsizlik: barcha xizmatlar tarifi qancha o'zgarsa natija 0 bo'ladi (stsenariy ustiga)
      be.push(resS < 0 && revS > 0 ? -resS / revS : null);
    }
    return { code: r.code, name: r.name, touched, base, scen, breakEvenTariff: be };
  });
}

/** Asos prognozining natija oralig'idan σ */
export function sigmaFromBand(lo: number, hi: number): number {
  return Math.max(0, (hi - lo) / (2 * Z80));
}