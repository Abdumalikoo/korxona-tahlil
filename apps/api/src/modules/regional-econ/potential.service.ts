import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CENTRAL_REGION, monthName, shiftPeriod } from '../regional-data/rd.util';
import { loadLookups } from './econ.loader';
import { priceAt, regimeMonth } from './forecast.calc';
import { ForecastService, resolveForecastBase } from './forecast.service';
import { lastRegimeStart, MAX_WINDOW, MIN_WINDOW, potentialOf, seasonalIndex, yoyGrowth } from './potential.calc';

// ═══════════════════════════════════════════════════════════
// C. Hudud salohiyati — faqat yuklangan daromad ma'lumotidan (hudud × xizmat):
//   barqaror oyna (uzilishsiz, eng ko'pi 12 oy) → o'rtacha qiymat va o'rtacha oy-oy o'sish →
//   salohiyat = Ȳ × (1 + g)^((n+1)/2 + k − 1). Hudud salohiyati — xizmatlar yig'indisi.
// Tarix tasdiqlangan tariflar bo'yicha joriy narxga keltiriladi (prognoz bilan bir xil).
// ═══════════════════════════════════════════════════════════

const CACHE_MS = 60_000;
const T = (x: number) => String(Math.round(x));
const pctTxt = (x: number) => `${x < 0 ? '−' : x > 0 ? '+' : ''}${Math.abs(x * 100).toFixed(1).replace('.', ',')}%`;

export type WindowReason = 'EVENT' | 'DETECTED' | 'DATA' | 'MAX';
export const WINDOW_REASON: Record<WindowReason, string> = {
  EVENT: 'voqealar jurnalidagi uzilishdan keyin',
  DETECTED: 'avtomatik topilgan uzilishdan keyin',
  DATA: "ma'lumot shu oydan boshlangan",
  MAX: "so'nggi 12 oy (uzilish yo'q)",
};

@Injectable()
export class PotentialService {
  private cache = new Map<string, { at: number; value: Awaited<ReturnType<PotentialService['build']>> }>();

  /** Ma'lumot ommaviy o'zgarganda (masalan, demo qo'shilganda) keshni tozalash */
  clearCache() {
    this.cache.clear();
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly forecasts: ForecastService,
  ) {}

  async potential(to?: string, h?: string | number) {
    const base = resolveForecastBase(to, h);
    const key = `${base.last}|${base.horizon}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    const value = await this.build(base);
    if (this.cache.size > 20) this.cache.clear();
    this.cache.set(key, { at: Date.now(), value });
    return value;
  }

  private async build(base: ReturnType<typeof resolveForecastBase>) {
    const { last, horizon: H, periods, future } = base;
    const lk = await loadLookups(this.prisma);
    const regionWhere = { not: null, notIn: [CENTRAL_REGION] };
    const [incomes, events, tariffs, cats, fc] = await Promise.all([
      this.prisma.income.findMany({ where: { deletedAt: null, period: { in: periods }, regionCode: regionWhere }, select: { period: true, regionCode: true, categoryCode: true, amountTiyin: true } }),
      this.prisma.analysisEvent.findMany({ where: { deletedAt: null, isBreak: true }, select: { date: true, kind: true, regionCode: true, categoryCode: true, title: true } }),
      this.prisma.serviceTariff.findMany({ where: { status: 'APPROVED' }, select: { categoryCode: true, regionCode: true, priceTiyin: true, validFrom: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
      this.forecasts.forecast(last, H),
    ]);
    const label = new Map(cats.map((c) => [c.code, c.label]));
    const pIndex = new Map(periods.map((p, i) => [p, i]));
    const by = new Map<string, number[]>();
    const months = new Map<number, Set<string>>();
    for (const r of incomes) {
      const k = `${r.regionCode}|${r.categoryCode}`;
      const arr = by.get(k) ?? new Array<number>(periods.length).fill(0);
      arr[pIndex.get(r.period)!]! += Number(r.amountTiyin);
      by.set(k, arr);
      const s = months.get(r.regionCode!) ?? new Set<string>();
      s.add(r.period);
      months.set(r.regionCode!, s);
    }

    const insights: { level: 'good' | 'warn' | 'bad' | 'info'; regionCode: number | null; text: string }[] = [];
    const detectedAll: string[] = [];
    const regions = lk.regions.map((reg) => {
      const code = reg.code;
      const have = months.get(code);
      const fr = fc.regions.find((r) => r.code === code);
      if (!have || !have.has(last)) {
        return { code, name: reg.name, hasData: false, actualLastTiyin: '0', fittedLastTiyin: '0', utilization: null as number | null, ahead: future.map(() => '0'), aheadSeasonal: future.map(() => '0'), seasonalServices: 0, forecast: future.map(() => '0'), services: [] as ReturnType<typeof svc>[] };
      }
      // Uzluksiz ma'lumot oynasi
      let ds = periods.length - 1;
      while (ds > 0 && have.has(periods[ds - 1]!)) ds--;
      const codes = [...by.keys()].filter((k) => k.startsWith(`${code}|`)).map((k) => k.split('|')[1]!);
      function svc(sc: string) {
        const raw = by.get(`${code}|${sc}`)!;
        const pLast = priceAt(tariffs, sc, code, last);
        const adj = raw.map((v, i) => {
          const pm = priceAt(tariffs, sc, code, periods[i]!);
          return pLast && pm && pm !== pLast ? (v * pLast) / pm : v;
        });
        const notes: string[] = [];
        if (adj.some((v, i) => v !== raw[i])) notes.push("Tarix tasdiqlangan tarif bo'yicha joriy narxga keltirildi");
        let start = ds;
        let reason: WindowReason = ds > 0 ? 'DATA' : 'MAX';
        const breaks: { period: string; source: 'EVENT' | 'DETECTED'; text: string }[] = [];
        // Jurnal uzilishlari (tarif bilan tushuntirilgani — tuzatilgan, kesilmaydi)
        for (const e of events) {
          if (!((e.regionCode === null || e.regionCode === code) && (e.categoryCode === null || e.categoryCode === sc))) continue;
          const m = regimeMonth(e.date);
          const i = pIndex.get(m);
          if (i === undefined || m > last) continue;
          if (e.kind === 'TARIFF' && priceAt(tariffs, sc, code, shiftPeriod(m, -1)) && priceAt(tariffs, sc, code, m)) continue;
          breaks.push({ period: m, source: 'EVENT', text: e.title });
          if (i > start) {
            start = i;
            reason = 'EVENT';
          }
        }
        // Avtomatik uzilish (jurnaldan keyingi qismda). 24 oydan ko'p ma'lumot bo'lsa — mavsumdan tozalangan qatorda
        // (aks holda mavsumiy tebranish «uzilish» bo'lib ko'rinadi)
        const seg = adj.slice(start);
        const segPs = periods.slice(start);
        // Mavsum indekslari butun uzluksiz tarixdan (uzilishdan keyingi qisqa qism uchun ham)
        let forDetect = seg;
        const full = adj.slice(ds);
        const fullPs = periods.slice(ds);
        if (full.length >= 24) {
          const g0 = yoyGrowth(full) ?? 0;
          const idx = new Map<number, number>();
          for (let m = 1; m <= 12; m++) {
            const v = seasonalIndex(full, fullPs, m, g0);
            if (v !== null && v > 0) idx.set(m, v);
          }
          if (idx.size === 12) forDetect = seg.map((v, i) => v / idx.get(Number(segPs[i]!.slice(5)))!);
        }
        const det = lastRegimeStart(forDetect);
        for (const b of det.breaks) {
          const i = start + b.index;
          const after = adj.slice(i, i + 3);
          const before = adj.slice(Math.max(start, i - 3), i);
          const ma = after.reduce((t, v) => t + v, 0) / after.length;
          const mb = before.reduce((t, v) => t + v, 0) / before.length;
          breaks.push({ period: periods[i]!, source: 'DETECTED', text: `daraja ${mb ? pctTxt(ma / mb - 1) : "o'zgargan"}` });
        }
        if (det.start > 0) {
          start += det.start;
          reason = 'DETECTED';
        }
        const yoy = yoyGrowth(adj.slice(start));
        const stableArr = adj.slice(start);
        const stablePs = periods.slice(start);
        if (periods.length - start > MAX_WINDOW) {
          start = periods.length - MAX_WINDOW;
          reason = 'MAX';
        }
        const win = adj.slice(start);
        const pot = potentialOf(win, H, yoy)!;
        if (win.length < MIN_WINDOW) notes.push(`Barqaror oyna qisqa (${win.length} oy) — salohiyat taxminiy`);
        const fcs = fr?.revenue.services.find((s) => s.key === sc);
        const actualLast = raw[raw.length - 1]!;
        // Mavsum (≥ 24 oy barqaror ma'lumot bo'lsa): shu oy uchun salohiyat = yillik daraja × mavsum indeksi
        const sLast = yoy !== null ? seasonalIndex(stableArr, stablePs, Number(last.slice(5)), pot.growth) : null;
        const sAhead = future.map((f) => (yoy !== null ? seasonalIndex(stableArr, stablePs, Number(f.slice(5)), pot.growth) : null));
        const seasonal = sLast !== null && sAhead.every((x) => x !== null) ? { last: sLast, ahead: sAhead as number[] } : null;
        const fittedS = pot.fittedLast * (seasonal?.last ?? 1);
        return {
          key: sc,
          label: label.get(sc) ?? sc,
          window: { from: periods[start]!, to: last, n: win.length, reason, reasonText: WINDOW_REASON[reason] },
          windowValues: win.map((v, i) => ({ period: periods[start + i]!, valueTiyin: T(v) })),
          breaks: breaks.sort((a, b) => a.period.localeCompare(b.period)),
          meanTiyin: T(pot.mean),
          growth: pot.growth,
          growthMethod: (yoy !== null ? 'YOY' : win.length >= 2 && win.every((v) => v > 0) ? 'TREND' : 'PAIRS') as 'YOY' | 'TREND' | 'PAIRS',
          cv: pot.cv,
          stable: pot.cv !== null && pot.cv <= 0.25,
          short: win.length < MIN_WINDOW,
          fittedLastTiyin: T(pot.fittedLast),
          actualLastTiyin: T(actualLast),
          utilization: fittedS > 0 ? actualLast / fittedS : null,
          ahead: pot.ahead.map(T),
          /** Mavsum indeksi (null — 24 oydan kam barqaror ma'lumot, mavsum hisoblanmagan) */
          seasonal,
          /** Shu oy uchun salohiyat: yillik daraja × mavsum indeksi */
          aheadSeasonal: pot.ahead.map((v, i) => T(v * (seasonal?.ahead[i] ?? 1))),
          fittedLastSeasonalTiyin: T(fittedS),
          forecast: future.map((_, i) => fcs?.forecast[i]?.meanTiyin ?? '0'),
          exponent: (pot.n + 1) / 2,
          notes,
        };
      }
      const services = codes.map(svc).filter((s) => Number(s.meanTiyin) !== 0 || Number(s.actualLastTiyin) !== 0);
      services.sort((a, b) => Number(b.ahead[0]) - Number(a.ahead[0]));
      const sum = (f: (s: (typeof services)[number]) => string) => services.reduce((t, s) => t + Number(f(s)), 0);
      const actualLast = sum((s) => s.actualLastTiyin);
      const fitted = sum((s) => s.fittedLastSeasonalTiyin);
      for (const s of services) for (const b of s.breaks) if (b.source === 'DETECTED') detectedAll.push(`${reg.name} — ${s.label}, ${monthName(b.period)} (${b.text})`);
      return {
        code,
        name: reg.name,
        hasData: true,
        actualLastTiyin: T(actualLast),
        fittedLastTiyin: T(fitted),
        utilization: fitted > 0 ? actualLast / fitted : null,
        ahead: future.map((_, i) => T(services.reduce((t, s) => t + Number(s.ahead[i]), 0))),
        aheadSeasonal: future.map((_, i) => T(services.reduce((t, s) => t + Number(s.aheadSeasonal[i]), 0))),
        seasonalServices: services.filter((s) => s.seasonal).length,
        forecast: future.map((_, i) => fr?.revenue.forecast[i]?.meanTiyin ?? '0'),
        services,
      };
    });

    for (const r of regions) {
      if (!r.hasData || r.utilization === null) continue;
      if (r.utilization < 0.9) insights.push({ level: 'warn', regionCode: r.code, text: `${r.name}: ${monthName(last)} fakti barqaror darajadan ${pctTxt(r.utilization - 1)} past — salohiyat to'liq ishlatilmagan.` });
      else if (r.utilization > 1.1) insights.push({ level: 'good', regionCode: r.code, text: `${r.name}: ${monthName(last)} fakti barqaror darajadan ${pctTxt(r.utilization - 1)} yuqori (tezlashish yoki bir martalik tushum — tekshiring).` });
      const gap = Number(r.aheadSeasonal[0]) - Number(r.forecast[0]);
      if (Number(r.aheadSeasonal[0]) > 0 && gap / Number(r.aheadSeasonal[0]) > 0.1) insights.push({ level: 'info', regionCode: r.code, text: `${r.name}: prognoz salohiyatdan ${pctTxt(-gap / Number(r.aheadSeasonal[0]))} past — oxirgi oylardagi pasayish davom etishi kutilmoqda.` });
    }
    if (detectedAll.length)
      insights.push({ level: 'info', regionCode: null, text: `Avtomatik topilgan uzilishlar (${detectedAll.length}): ${detectedAll.slice(0, 5).join('; ')}${detectedAll.length > 5 ? ' …' : ''}. Sababini voqealar jurnaliga yozib qo'ying.` });
    const order = { bad: 0, warn: 1, good: 2, info: 3 };
    insights.sort((a, b) => order[a.level] - order[b.level]);

    const act = regions.reduce((s, r) => s + Number(r.actualLastTiyin), 0);
    const fit = regions.reduce((s, r) => s + Number(r.fittedLastTiyin), 0);
    return {
      lastActual: last,
      lastLabel: monthName(last),
      horizon: H,
      periods: future,
      periodLabels: future.map(monthName),
      total: {
        actualLastTiyin: T(act),
        fittedLastTiyin: T(fit),
        utilization: fit > 0 ? act / fit : null,
        ahead: future.map((_, i) => T(regions.reduce((s, r) => s + Number(r.ahead[i]), 0))),
        aheadSeasonal: future.map((_, i) => T(regions.reduce((s, r) => s + Number(r.aheadSeasonal[i]), 0))),
        forecast: future.map((_, i) => T(regions.reduce((s, r) => s + Number(r.forecast[i]), 0))),
      },
      regions,
      insights,
      method: [
        "Barqaror oyna: oxirgi tarkibiy uzilishdan keyingi oylar, eng ko'pi 12 oy. Uzilish — voqealar jurnalidan yoki avtomatik (Chow testi: ikki chiziq bitta chiziqdan sezilarli yaxshi, F ≥ 10, va daraja sakrashi ≥ 15%). Bir tekis o'sish uzilish emas; 24 oydan ko'p ma'lumotda test mavsumdan tozalangan qatorda o'tkaziladi (mavsumiy tebranish uzilish emas).",
        "O'rtacha qiymat Ȳ = oyna oylari yig'indisi ÷ oylar soni.",
        "O'rtacha o'sish g: barqaror qator 24 oy va undan uzun bo'lsa — mavsumdan xoli yillik solishtiruv (Σ oxirgi 12 oy ÷ Σ oldingi 12 oy)^(1/12) − 1; qisqaroq bo'lsa — log-chiziqli trend: ln(qiymat) ga to'g'ri chiziq, g = e^qiyalik − 1 (tasodifiy tebranish o'sishni sun'iy oshirmaydi).",
        "Salohiyat (k-oy oldinga) = Ȳ × (1 + g)^((n+1)/2 + k − 1): Ȳ oynaning o'rtasiga tegishli, shuning uchun o'sish o'rtadan hisoblanadi. Misol: 198, 195, 200 → Ȳ = 197,67, g = 0,50% → 197,67 × 1,0050² ≈ 199,7.",
        "Mavsum: barqaror ma'lumot 24 oy va undan ko'p bo'lsa — har kalendar oy uchun indeks (oxirgi ikki yil: oy qiymati ÷ yil o'rtachasi, trend tuzatilgan). «Shu oy uchun salohiyat» = yillik daraja × mavsum indeksi; KPI taklifi shundan olinadi.",
        "Foydalanish = oxirgi oy fakti ÷ shu oy uchun barqaror daraja (Ȳ × (1+g)^((n−1)/2), mavsum indeksi bilan).",
        "Hudud salohiyati — xizmatlar salohiyati yig'indisi. Tarix tasdiqlangan tariflar bo'yicha joriy narxga keltiriladi; kelgusi tarif salohiyatga qo'shilmaydi (u prognozda).",
        "Variatsiya koeffitsienti (σ ÷ Ȳ) 25% dan katta bo'lsa — qator beqaror, salohiyat ehtiyotkorlik bilan.",
        "Ma'lumot 24 oydan kam bo'lsa mavsum ajratilmaydi: salohiyat — yillik o'rtacha darajadagi oylik qiymat, mavsumiy past oyda foydalanish 100% dan past chiqishi tabiiy.",
      ],
    };
  }
}