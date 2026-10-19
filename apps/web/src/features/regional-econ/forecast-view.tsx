'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { FIELD } from '@/features/purchases/bits';
import { compact, TONE } from '@/features/structure/api';
import { KpiStrip, PanelHeader, Segmented, SmallButton } from '@/features/structure/parts';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatPeriodShort } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, useMemo, useState } from 'react';
import { type BandT, fcApi, type FcAccuracy, type RegionalForecast, type RegionForecast, RELIABILITY, type Reliability, share } from './api';
import { InsightList } from './performance-view';

// ═══════════════════════════════════════════════════════════
// Katta modellar › Hudud prognozi (3-bosqich): daromad (hudud × xizmat), ish haqi (xodim bo'yicha),
// xarajat, Markaz ulushi va natija; o'tmishda sinalgan aniqlik; saqlangan versiyalar va prognoz–fakt.
// ═══════════════════════════════════════════════════════════

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';
type View = 'overview' | 'revenue' | 'payroll' | 'opex' | 'runs';
const VIEWS: { value: View; label: string }[] = [
  { value: 'overview', label: 'Umumiy' },
  { value: 'revenue', label: 'Daromad' },
  { value: 'payroll', label: 'Ish haqi' },
  { value: 'opex', label: 'Xarajat' },
  { value: 'runs', label: 'Versiyalar' },
];
const HORIZONS = [
  { value: '3', label: '3 oy' },
  { value: '6', label: '6 oy' },
  { value: '12', label: '12 oy' },
];

const n = (t: string | null | undefined) => (t ? Number(t) : 0);
const neg = (t: string) => n(t) < 0;
const wapeText = (w: number | null) => (w === null ? '—' : `±${(w * 100).toFixed(1).replace('.', ',')}%`);
const bandSum = (bs: BandT[]) => bs.reduce((s, b) => s + n(b.meanTiyin), 0);

function RelBadge({ r, title }: { r: Reliability; title?: string }) {
  return (
    <span className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold', RELIABILITY[r].cls)} title={title}>
      {RELIABILITY[r].label}
    </span>
  );
}

function AccCell({ a }: { a: FcAccuracy }) {
  if (a.wape === null) return <span className="text-(--color-text-faint)">sinalmagan</span>;
  const better = a.naiveWape !== null && a.wape < a.naiveWape;
  return (
    <span title={`1 oy oldinga xato ${wapeText(a.wape)} (${a.points} marta sinaldi); oddiy usul (o'tgan oy) ${wapeText(a.naiveWape)}; 2 oy ${wapeText(a.byH[1] ?? null)}, 3 oy ${wapeText(a.byH[2] ?? null)}`}>
      {wapeText(a.wape)}
      {a.naiveWape !== null && <span className={cn('ml-1 text-[10px]', better ? 'text-(--color-income)' : 'text-amber-700')}>{better ? '▲' : '▼'} {wapeText(a.naiveWape)}</span>}
    </span>
  );
}

// ─────────────────────────── Grafik ───────────────────────────

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  if (out[out.length - 1]! < max) out.push(out[out.length - 1]! + step);
  return out;
}

interface ChartSeries {
  name: string;
  color: string;
  history: number[];
  forecast: BandT[];
}

function FcChart({ history, periods, series, height = 280 }: { history: string[]; periods: string[]; series: ChartSeries[]; height?: number }) {
  const W = 960;
  const H = height;
  const pad = { l: 66, r: 16, t: 16, b: 28 };
  const all = [...history, ...periods];
  const N = all.length;
  const vals = series.flatMap((s) => [...s.history, ...s.forecast.flatMap((b) => [n(b.loTiyin), n(b.hiTiyin)])]);
  if (!vals.length) return null;
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const x = (i: number) => pad.l + (i * (W - pad.l - pad.r)) / Math.max(1, N - 1);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const hN = history.length;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Prognoz grafigi">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={TONE.grid} strokeWidth={t === 0 ? 1.2 : 0.7} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={TONE.axis}>
              {compact(String(t))}
            </text>
          </g>
        ))}
        <rect x={x(hN - 1)} y={pad.t} width={W - pad.r - x(hN - 1)} height={H - pad.t - pad.b} fill="#f6f8fc" />
        {all.map((p, i) =>
          i % (N > 16 ? 2 : 1) === 0 ? (
            <text key={p} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill={i >= hN ? TONE.ink : TONE.axis} fontWeight={i >= hN ? 600 : 400}>
              {formatPeriodShort(p)}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          const lastH = s.history[s.history.length - 1] ?? 0;
          const fx = s.forecast.map((_, i) => x(hN + i));
          const band = [
            `${x(hN - 1)},${y(lastH)}`,
            ...s.forecast.map((b, i) => `${fx[i]},${y(n(b.hiTiyin))}`),
            ...[...s.forecast].reverse().map((b, i) => `${fx[s.forecast.length - 1 - i]},${y(n(b.loTiyin))}`),
          ].join(' ');
          return (
            <g key={s.name}>
              <polygon points={band} fill={s.color} opacity={0.13} />
              <polyline points={s.history.map((v, i) => `${x(i)},${y(v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={2.2} />
              <polyline points={[`${x(hN - 1)},${y(lastH)}`, ...s.forecast.map((b, i) => `${fx[i]},${y(n(b.meanTiyin))}`)].join(' ')} fill="none" stroke={s.color} strokeWidth={2.2} strokeDasharray="6 4" />
              {s.forecast.map((b, i) => (
                <circle key={i} cx={fx[i]} cy={y(n(b.meanTiyin))} r={3} fill="#fff" stroke={s.color} strokeWidth={1.8}>
                  <title>{`${s.name}, ${formatPeriodShort(periods[i]!)}: ${compact(b.meanTiyin)} (80%: ${compact(b.loTiyin)} – ${compact(b.hiTiyin)})`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-(--color-text-muted)">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="h-0.5 w-5" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
        <span>— haqiqiy, - - - prognoz, soha — 80% oraliq</span>
      </div>
    </div>
  );
}

// ─────────────────────────── Asosiy ko'rinish ───────────────────────────

export function RegionalForecastView() {
  const { month } = usePeriod();
  const [h, setH] = useState('3');
  const [view, setView] = useState<View>('overview');
  const [region, setRegion] = useState<number | null>(null);
  const res = useAsync(() => fcApi.forecast(month, Number(h)).then((r) => r.data), [month, h]);
  const d = res.data;
  const header = (
    <PanelHeader
      title="Hudud prognozi"
      description={d ? `${d.lastLabel} gacha haqiqiy ma'lumot asosida · ${d.periodLabels[0]} – ${d.periodLabels[d.periodLabels.length - 1]}` : 'Daromad, ish haqi, xarajat va natija — hududlar bo‘yicha'}
      actions={
        <>
          <Segmented value={h} onChange={setH} options={HORIZONS} size="sm" />
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented value={view} onChange={setView} options={VIEWS} size="sm" />
        {d && view !== 'runs' && (
          <select value={region ?? ''} onChange={(e) => setRegion(e.target.value ? Number(e.target.value) : null)} className={cn(FIELD, 'h-8 w-60 text-xs')}>
            <option value="">Barcha hududlar</option>
            {d.regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </PanelHeader>
  );
  if (res.error) return <div className="space-y-4">{header}<Card><ErrorState message={res.error} onRetry={res.reload} /></Card></div>;
  if (!d) return <div className="space-y-4">{header}<Card><LoadingState label="Modellar o'rgatilmoqda va o'tmishda sinalmoqda" /></Card></div>;
  const sel = region === null ? null : (d.regions.find((r) => r.code === region) ?? null);

  return (
    <div className="space-y-4">
      {header}
      {d.notes.length > 0 && (
        <Card className="border-l-4 border-l-amber-400">
          <ul className="space-y-1 px-5 py-3 text-sm text-amber-900">
            {d.notes.map((x) => (
              <li key={x}>• {x}</li>
            ))}
          </ul>
        </Card>
      )}
      {view === 'overview' && <Overview d={d} sel={sel} onSelect={setRegion} />}
      {view === 'revenue' && <RevenueView d={d} sel={sel} onSelect={setRegion} />}
      {view === 'payroll' && <PayrollView d={d} sel={sel} onSelect={setRegion} month={month} h={Number(h)} />}
      {view === 'opex' && <OpexView d={d} sel={sel} />}
      {view === 'runs' && <RunsView d={d} month={month} h={Number(h)} />}
      {view !== 'runs' && (
        <Card>
          <div className="px-5 py-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Qanday hisoblanadi</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {d.method.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}

type SelProps = { d: RegionalForecast; sel: RegionForecast | null; onSelect: (c: number | null) => void };

function Overview({ d, sel, onSelect }: SelProps) {
  const t = d.total;
  const scope = sel
    ? { revenue: sel.revenue.forecast, payroll: sel.payroll.forecast, opex: sel.opex.forecast, overhead: sel.overhead.forecast, result: sel.result, last: sel.last, rh: sel.revenue.history.map((x) => n(x.valueTiyin)), ch: sel.payroll.history.map((x, i) => n(x.valueTiyin) + n(sel.opex.history[i]?.valueTiyin)), wape: sel.revenue.wape, pw: sel.payroll.wape }
    : {
        revenue: t.revenue, payroll: t.payroll, opex: t.opex, overhead: t.overhead, result: t.result, last: { ...t.last, resultTiyin: String(n(t.last.revenueTiyin) - n(t.last.payrollTiyin) - n(t.last.opexTiyin)) },
        rh: d.history.map((_, i) => d.regions.reduce((s, r) => s + n(r.revenue.history[i]?.valueTiyin), 0)),
        ch: d.history.map((_, i) => d.regions.reduce((s, r) => s + n(r.payroll.history[i]?.valueTiyin) + n(r.opex.history[i]?.valueTiyin), 0)),
        wape: t.revenueWape, pw: t.payrollWape,
      };
  const cost: BandT[] = scope.payroll.map((p, i) => {
    const m = n(p.meanTiyin) + n(scope.opex[i]!.meanTiyin);
    const s = Math.sqrt(((n(p.hiTiyin) - n(p.loTiyin)) / 2.563) ** 2 + ((n(scope.opex[i]!.hiTiyin) - n(scope.opex[i]!.loTiyin)) / 2.563) ** 2);
    return { meanTiyin: String(m), loTiyin: String(m - 1.2816 * s), hiTiyin: String(m + 1.2816 * s) };
  });
  const r0 = scope.result[0]!;
  const lr = n(scope.last.revenueTiyin);
  const fr = n(scope.revenue[0]!.meanTiyin);
  const insights = sel ? d.insights.filter((i) => i.regionCode === sel.code || i.regionCode === null) : d.insights;
  return (
    <>
      <KpiStrip
        items={[
          { label: `Daromad · ${d.periodLabels[0]}`, value: `${compact(scope.revenue[0]!.meanTiyin)} so'm`, sub: `${d.lastLabel}: ${compact(scope.last.revenueTiyin)} (${lr ? share(fr / lr - 1, true) : '—'}) · aniqlik ${wapeText(scope.wape)}` },
          { label: `Ish haqi · ${d.periodLabels[0]}`, value: `${compact(scope.payroll[0]!.meanTiyin)} so'm`, sub: `${d.lastLabel}: ${compact(scope.last.payrollTiyin)} · aniqlik ${wapeText(scope.pw)}` },
          { label: `Xarajat va Markaz ulushi`, value: `${compact(String(n(scope.opex[0]!.meanTiyin) + n(scope.overhead[0]!.meanTiyin)))} so'm`, sub: `xarajat ${compact(scope.opex[0]!.meanTiyin)} + Markaz ${compact(scope.overhead[0]!.meanTiyin)}` },
          { label: `Natija · ${d.periodLabels[0]}`, value: `${compact(r0.meanTiyin)} so'm`, valueClass: neg(r0.meanTiyin) ? 'text-(--color-expense)' : 'text-heading', sub: `80%: ${compact(r0.loTiyin)} … ${compact(r0.hiTiyin)} · davr jami ${compact(String(bandSum(scope.result)))}` },
        ]}
      />
      <Card>
        <div className="px-5 pt-4">
          <h3 className="text-sm font-bold text-heading">{sel ? sel.name : 'Barcha hududlar'}: daromad va xarajat (ish haqi + xarajat)</h3>
        </div>
        <div className="px-3 pb-3">
          <FcChart
            history={d.history}
            periods={d.periods}
            series={[
              { name: 'Daromad', color: TONE.income, history: scope.rh, forecast: scope.revenue },
              { name: 'Ish haqi + xarajat', color: TONE.expense, history: scope.ch, forecast: cost },
            ]}
          />
        </div>
      </Card>
      <InsightList items={insights} />
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-(--color-line) px-5 py-2.5">
          <p className="text-xs text-(--color-text-muted)">Keyingi oy ({d.periodLabels[0]}) va butun davr · qatorni bosing — hudud tanlanadi</p>
          <SmallButton
            onClick={() =>
              downloadCsv(
                `Hudud-prognozi-${d.lastActual}-${d.horizon}oy.csv`,
                ['Hudud', ...d.periodLabels.flatMap((p) => [`Daromad ${p}`, `Ish haqi ${p}`, `Xarajat ${p}`, `Markaz ulushi ${p}`, `Natija ${p}`, `Natija 80% past ${p}`, `Natija 80% yuqori ${p}`])],
                d.regions.map((r) => [r.name, ...d.periods.flatMap((_, i) => [csvSom(r.revenue.forecast[i]!.meanTiyin), csvSom(r.payroll.forecast[i]!.meanTiyin), csvSom(r.opex.forecast[i]!.meanTiyin), csvSom(r.overhead.forecast[i]!.meanTiyin), csvSom(r.result[i]!.meanTiyin), csvSom(r.result[i]!.loTiyin), csvSom(r.result[i]!.hiTiyin)])]),
                [],
              )
            }
          >
            CSV
          </SmallButton>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-(--color-surface-muted) text-left">
              <tr>
                <th className={TH}>Hudud</th>
                <th className={cn(TH, 'text-right')}>Daromad</th>
                <th className={cn(TH, 'text-right')}>Ish haqi</th>
                <th className={cn(TH, 'text-right')}>Xarajat</th>
                <th className={cn(TH, 'text-right')}>Markaz ulushi</th>
                <th className={cn(TH, 'text-right')}>Natija (80% oraliq)</th>
                <th className={cn(TH, 'text-right')}>Davr natijasi</th>
                <th className={TH}>Ishonchlilik</th>
              </tr>
            </thead>
            <tbody>
              {d.regions.map((r) => {
                const lr2 = n(r.last.revenueTiyin);
                const f0 = n(r.revenue.forecast[0]!.meanTiyin);
                return (
                  <tr key={r.code} onClick={() => onSelect(sel?.code === r.code ? null : r.code)} className={cn('cursor-pointer border-t border-(--color-line) hover:bg-brand-50/40', sel?.code === r.code && 'bg-brand-50/70', !r.hasData && 'opacity-50')}>
                    <td className="px-3 py-2 font-medium text-heading">{r.name}</td>
                    <td className="money px-3 py-2 text-right">
                      {compact(r.revenue.forecast[0]!.meanTiyin)}
                      {lr2 > 0 && <div className={cn('text-[11px]', f0 < lr2 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{share(f0 / lr2 - 1, true)}</div>}
                    </td>
                    <td className="money px-3 py-2 text-right">{compact(r.payroll.forecast[0]!.meanTiyin)}</td>
                    <td className="money px-3 py-2 text-right">{compact(r.opex.forecast[0]!.meanTiyin)}</td>
                    <td className="money px-3 py-2 text-right text-(--color-text-muted)">{compact(r.overhead.forecast[0]!.meanTiyin)}</td>
                    <td className={cn('money px-3 py-2 text-right font-semibold', neg(r.result[0]!.meanTiyin) ? 'text-(--color-expense)' : 'text-heading')}>
                      {compact(r.result[0]!.meanTiyin)}
                      <div className="text-[11px] font-normal text-(--color-text-muted)">
                        {compact(r.result[0]!.loTiyin)} … {compact(r.result[0]!.hiTiyin)}
                      </div>
                    </td>
                    <td className={cn('money px-3 py-2 text-right font-bold', bandSum(r.result) < 0 ? 'text-(--color-expense)' : 'text-heading')}>{compact(String(bandSum(r.result)))}</td>
                    <td className="px-3 py-2">
                      <RelBadge r={r.hasData ? r.revenue.reliability : 'none'} title={`Daromad aniqligi ${wapeText(r.revenue.wape)}, ish haqi ${wapeText(r.payroll.wape)}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-(--color-line) bg-brand-50 font-bold text-heading">
                <td className="px-3 py-2.5">Jami hududlar</td>
                <td className="money px-3 py-2.5 text-right">{compact(t.revenue[0]!.meanTiyin)}</td>
                <td className="money px-3 py-2.5 text-right">{compact(t.payroll[0]!.meanTiyin)}</td>
                <td className="money px-3 py-2.5 text-right">{compact(t.opex[0]!.meanTiyin)}</td>
                <td className="money px-3 py-2.5 text-right">{compact(t.overhead[0]!.meanTiyin)}</td>
                <td className="money px-3 py-2.5 text-right">{compact(t.result[0]!.meanTiyin)}</td>
                <td className="money px-3 py-2.5 text-right">{compact(String(bandSum(t.result)))}</td>
                <td className="px-3 py-2.5 text-xs font-normal">Markaz: {share(d.central.allocatedShare)} taqsimlanadi</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </>
  );
}

/** Oylar ustunlari: prognoz va oraliq */
function MonthCells({ bands, strong }: { bands: BandT[]; strong?: boolean }) {
  return (
    <>
      {bands.map((b, i) => (
        <td key={i} className={cn('money px-3 py-2 text-right', strong && 'font-semibold', neg(b.meanTiyin) && 'text-(--color-expense)')} title={`80%: ${compact(b.loTiyin)} – ${compact(b.hiTiyin)}`}>
          {compact(b.meanTiyin)}
        </td>
      ))}
    </>
  );
}

function RevenueView({ d, sel, onSelect }: SelProps) {
  if (!sel) {
    return (
      <Card className="overflow-hidden">
        <div className="border-b border-(--color-line) px-5 py-3">
          <h3 className="text-sm font-bold text-heading">Daromad prognozi — hududlar</h3>
          <p className="text-xs text-(--color-text-muted)">Hudud jami — xizmatlar prognozlari yig&apos;indisi. Hududni bosing — xizmatlar bo&apos;yicha ochiladi.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-(--color-surface-muted) text-left">
              <tr>
                <th className={TH}>Hudud</th>
                <th className={cn(TH, 'text-right')}>{d.lastLabel} (fakt)</th>
                {d.periods.map((p) => (
                  <th key={p} className={cn(TH, 'text-right')}>{formatPeriodShort(p)}</th>
                ))}
                <th className={cn(TH, 'text-right')}>Aniqlik</th>
                <th className={TH}>Xizmatlar</th>
              </tr>
            </thead>
            <tbody>
              {d.regions.map((r) => (
                <tr key={r.code} onClick={() => onSelect(r.code)} className="cursor-pointer border-t border-(--color-line) hover:bg-brand-50/40">
                  <td className="px-3 py-2 font-medium text-heading">{r.name}</td>
                  <td className="money px-3 py-2 text-right text-(--color-text-muted)">{compact(r.last.revenueTiyin)}</td>
                  <MonthCells bands={r.revenue.forecast} />
                  <td className="money px-3 py-2 text-right">{wapeText(r.revenue.wape)}</td>
                  <td className="px-3 py-2 text-xs text-(--color-text-muted)">{r.revenue.services.length} ta</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    );
  }
  return (
    <>
      <Card>
        <div className="px-5 pt-4">
          <h3 className="text-sm font-bold text-heading">{sel.name}: daromad</h3>
        </div>
        <div className="px-3 pb-3">
          <FcChart history={d.history} periods={d.periods} series={[{ name: 'Daromad', color: TONE.income, history: sel.revenue.history.map((x) => n(x.valueTiyin)), forecast: sel.revenue.forecast }]} height={240} />
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-(--color-line) px-5 py-3">
          <h3 className="text-sm font-bold text-heading">Xizmatlar bo&apos;yicha</h3>
          <p className="text-xs text-(--color-text-muted)">Aniqlik — o&apos;tmishda 1 oy oldinga aytilganda o&apos;rtacha xato; ▲ — oddiy usuldan (o&apos;tgan oy takrorlanadi) yaxshi</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-(--color-surface-muted) text-left">
              <tr>
                <th className={cn(TH, 'min-w-[220px]')}>Xizmat</th>
                <th className={cn(TH, 'text-right')}>{formatPeriodShort(d.lastActual)} fakt</th>
                {d.periods.map((p) => (
                  <th key={p} className={cn(TH, 'text-right')}>{formatPeriodShort(p)}</th>
                ))}
                <th className={TH}>Model</th>
                <th className={cn(TH, 'text-right')}>Aniqlik</th>
                <th className={TH}>Ishonch</th>
              </tr>
            </thead>
            <tbody>
              {sel.revenue.services.map((s) => (
                <Fragment key={s.key}>
                  <tr className="border-t border-(--color-line)">
                    <td className="px-3 py-2">
                      <div className="font-medium text-heading">{s.label}</div>
                      <div className="text-[11px] text-(--color-text-muted)">
                        {s.used} oy ma&apos;lumot{s.fromPeriod ? `, ${formatPeriodShort(s.fromPeriod)} dan` : ''}
                      </div>
                    </td>
                    <td className="money px-3 py-2 text-right text-(--color-text-muted)">{compact(s.history[s.history.length - 1]?.valueTiyin ?? '0')}</td>
                    <MonthCells bands={s.forecast} />
                    <td className="px-3 py-2 text-xs">{s.modelLabel}</td>
                    <td className="money px-3 py-2 text-right text-xs">
                      <AccCell a={s.accuracy} />
                    </td>
                    <td className="px-3 py-2">
                      <RelBadge r={s.reliability} />
                    </td>
                  </tr>
                  {s.notes.length > 0 && (
                    <tr>
                      <td colSpan={5 + d.periods.length} className="px-3 pb-2 text-[11px] text-sky-800">
                        {s.notes.map((x) => (
                          <div key={x}>↳ {x}</div>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

const BASIS: Record<string, string> = { CARD: 'shtat kartasi', RECENT: "so'nggi 3 oy", REGION: "hudud o'rtachasi", NONE: "ma'lumot yo'q" };

function PayrollView({ d, sel, onSelect, month, h }: SelProps & { month: string; h: number }) {
  return (
    <>
      <Card className="overflow-hidden">
        <div className="border-b border-(--color-line) px-5 py-3">
          <h3 className="text-sm font-bold text-heading">Ish haqi prognozi — xodimlar bo&apos;yicha hisoblangan</h3>
          <p className="text-xs text-(--color-text-muted)">Aniqlik — oxirgi 3 oyni shu usul bilan oldindan aytib ko&apos;rilgandagi xato. Hududni bosing — xodimlar ro&apos;yxati.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-(--color-surface-muted) text-left">
              <tr>
                <th className={TH}>Hudud</th>
                <th className={cn(TH, 'text-right')}>Xodimlar</th>
                <th className={cn(TH, 'text-right')}>{formatPeriodShort(d.lastActual)} fakt</th>
                {d.periods.map((p) => (
                  <th key={p} className={cn(TH, 'text-right')}>{formatPeriodShort(p)}</th>
                ))}
                <th className={cn(TH, 'text-right')}>Aniqlik</th>
                <th className={TH}>Asos</th>
              </tr>
            </thead>
            <tbody>
              {d.regions.map((r) => (
                <tr key={r.code} onClick={() => onSelect(sel?.code === r.code ? null : r.code)} className={cn('cursor-pointer border-t border-(--color-line) hover:bg-brand-50/40', sel?.code === r.code && 'bg-brand-50/70')}>
                  <td className="px-3 py-2 font-medium text-heading">{r.name}</td>
                  <td className="money px-3 py-2 text-right">
                    {r.payroll.headcountNow}
                    {r.payroll.headcount[r.payroll.headcount.length - 1] !== r.payroll.headcountNow && <span className="text-xs text-(--color-text-muted)"> → {r.payroll.headcount[r.payroll.headcount.length - 1]}</span>}
                  </td>
                  <td className="money px-3 py-2 text-right text-(--color-text-muted)">{compact(r.last.payrollTiyin)}</td>
                  <MonthCells bands={r.payroll.forecast} />
                  <td className="money px-3 py-2 text-right">{r.payroll.backtestMonths ? wapeText(r.payroll.wape) : '—'}</td>
                  <td className="px-3 py-2 text-[11px] text-(--color-text-muted)">
                    {Object.entries(r.payroll.basis)
                      .map(([k, v]) => `${BASIS[k] ?? k}: ${v}`)
                      .join(', ')}
                    {(r.payroll.seasonal ?? []).some((f) => f !== 1) && (
                      <div className="text-sky-800">
                        mavsum:{' '}
                        {(r.payroll.seasonal ?? [])
                          .map((f, i) => (f !== 1 ? `${formatPeriodShort(d.periods[i]!)} ×${f.toFixed(2).replace('.', ',')}` : null))
                          .filter(Boolean)
                          .join(', ')}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {sel && <PayrollEmployees month={month} h={h} code={sel.code} />}
    </>
  );
}

function PayrollEmployees({ month, h, code }: { month: string; h: number; code: number }) {
  const res = useAsync(() => fcApi.payroll(month, h, code).then((r) => r.data), [month, h, code]);
  const d = res.data;
  if (res.error) return <Card><ErrorState message={res.error} onRetry={res.reload} /></Card>;
  if (!d) return <Card><LoadingState /></Card>;
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-(--color-line) px-5 py-3">
        <h3 className="text-sm font-bold text-heading">{d.region.name}: xodimlar ({d.rows.length})</h3>
        <p className="text-xs text-(--color-text-muted)">
          Karta = maosh × stavka; nisbat = to&apos;langan ÷ karta (so&apos;nggi 3 oy medianasi; hudud bo&apos;yicha {d.regionRatio === null ? '—' : d.regionRatio.toFixed(2).replace('.', ',')}).
        </p>
      </div>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="sticky top-0 bg-(--color-surface-muted) text-left">
            <tr>
              <th className={TH}>Xodim</th>
              <th className={cn(TH, 'text-right')}>Karta</th>
              <th className={cn(TH, 'text-right')}>Nisbat</th>
              {d.recentPeriods.map((p) => (
                <th key={p} className={cn(TH, 'text-right text-(--color-text-faint)')}>{formatPeriodShort(p)}</th>
              ))}
              {d.periods.map((p) => (
                <th key={p} className={cn(TH, 'text-right')}>{formatPeriodShort(p)}</th>
              ))}
              <th className={TH}>O&apos;zgarishlar</th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.pinfl} className="border-t border-(--color-line)">
                <td className="px-3 py-1.5">
                  <div className="font-medium text-heading">{r.fullName}</div>
                  {r.position && <div className="text-[11px] text-(--color-text-muted)">{r.position}</div>}
                </td>
                <td className="money px-3 py-1.5 text-right">
                  {r.cardTiyin ? compact(r.cardTiyin) : <span className="text-amber-700">yo&apos;q</span>}
                  {r.rate !== null && r.rate !== 1 && <div className="text-[10px] text-(--color-text-muted)">{String(r.rate).replace('.', ',')} st.</div>}
                </td>
                <td className="money px-3 py-1.5 text-right">{r.ratio === null ? '—' : r.ratio.toFixed(2).replace('.', ',')}</td>
                {r.recent.map((v, i) => (
                  <td key={i} className="money px-3 py-1.5 text-right text-(--color-text-muted)">{n(v) ? compact(v) : '—'}</td>
                ))}
                {r.months.map((m, i) => (
                  <td key={i} className="money px-3 py-1.5 text-right" title={m ? BASIS[m.basis] : 'ishlamaydi'}>
                    {m ? compact(m.valueTiyin) : <span className="text-(--color-text-faint)">—</span>}
                    {m && m.basis !== 'CARD' && <div className="text-[10px] text-amber-700">{BASIS[m.basis]}</div>}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-[11px] text-sky-800">{r.changes.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function OpexView({ d, sel }: { d: RegionalForecast; sel: RegionForecast | null }) {
  const rows = sel ? [sel] : d.regions;
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-(--color-line) px-5 py-3">
        <h3 className="text-sm font-bold text-heading">Xarajat prognozi (ish haqisiz)</h3>
        <p className="text-xs text-(--color-text-muted)">Takroriy va belgilanmagan xarajatlar — model; bir martalik — so&apos;nggi 6 oy o&apos;rtachasi zaxira sifatida. Reja — «Xarajat rejasi»dan.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-(--color-surface-muted) text-left">
            <tr>
              <th className={TH}>Hudud</th>
              <th className={cn(TH, 'text-right')}>{formatPeriodShort(d.lastActual)} fakt</th>
              <th className={TH}>Model (takroriy)</th>
              <th className={cn(TH, 'text-right')}>Bir martalik zaxira</th>
              {d.periods.map((p) => (
                <th key={p} className={cn(TH, 'text-right')}>{formatPeriodShort(p)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.code}>
                <tr className="border-t border-(--color-line)">
                  <td className="px-3 py-2 font-medium text-heading">{r.name}</td>
                  <td className="money px-3 py-2 text-right text-(--color-text-muted)">{compact(r.last.opexTiyin)}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.opex.recurring ? (
                      <>
                        {r.opex.recurring.modelLabel} · <AccCell a={r.opex.recurring.accuracy} />
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="money px-3 py-2 text-right">{n(r.opex.oneTimeAllowanceTiyin) ? compact(r.opex.oneTimeAllowanceTiyin) : '—'}</td>
                  <MonthCells bands={r.opex.forecast} strong />
                </tr>
                {r.opex.budget.some((b) => b !== null) && (
                  <tr className="text-xs">
                    <td colSpan={4} className="px-3 pb-2 text-right text-(--color-text-muted)">Reja / farq</td>
                    {r.opex.budget.map((b, i) => {
                      const diff = b === null ? null : n(r.opex.forecast[i]!.meanTiyin) / n(b) - 1;
                      return (
                        <td key={i} className="money px-3 pb-2 text-right">
                          {b === null ? '—' : compact(b)}
                          {diff !== null && <div className={cn(diff > 0.1 ? 'text-(--color-expense)' : 'text-(--color-text-muted)')}>{share(diff, true)}</div>}
                        </td>
                      );
                    })}
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RunsView({ d, month, h }: { d: RegionalForecast; month: string; h: number }) {
  const { isAdmin } = useAuth();
  const [tick, setTick] = useState(0);
  const runs = useAsync(() => fcApi.runs().then((r) => r.data), [tick]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [del, setDel] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const list = useMemo(() => runs.data ?? [], [runs.data]);
  return (
    <>
      {isAdmin && (
        <Card>
          <div className="flex flex-wrap items-end gap-3 px-5 py-4">
            <div className="min-w-64 flex-1">
              <p className="mb-1 text-sm font-medium text-heading">Joriy prognozni versiya sifatida saqlash</p>
              <p className="mb-2 text-xs text-(--color-text-muted)">
                {d.lastLabel} gacha ma&apos;lumot, {d.horizon} oy. Oylar o&apos;tgach, shu versiya haqiqiy natija bilan avtomatik solishtiriladi.
              </p>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Izoh (masalan: byudjet uchun rasmiy prognoz)" className={FIELD} />
            </div>
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await fcApi.saveRun(month, h, note.trim() || null);
                  setNote('');
                  setToast({ message: 'Versiya saqlandi' });
                  setTick((t) => t + 1);
                } catch (e) {
                  setToast({ message: errorMessage(e), tone: 'error' });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Saqlash
            </Button>
          </div>
        </Card>
      )}
      {runs.error ? (
        <Card><ErrorState message={runs.error} onRetry={runs.reload} /></Card>
      ) : !runs.data ? (
        <Card><LoadingState /></Card>
      ) : !list.length ? (
        <Card><p className="px-5 py-6 text-sm text-(--color-text-muted)">Hali saqlangan versiya yo&apos;q.</p></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-(--color-surface-muted) text-left">
                <tr>
                  <th className={TH}>Versiya</th>
                  <th className={TH}>Kim, qachon</th>
                  <th className={cn(TH, 'text-right')}>Tekshirilgan oy</th>
                  <th className={cn(TH, 'text-right')}>Daromad xatosi</th>
                  <th className={cn(TH, 'text-right')}>Ish haqi xatosi</th>
                  <th className={cn(TH, 'text-right')}>Xarajat xatosi</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="cursor-pointer border-t border-(--color-line) hover:bg-brand-50/40" onClick={() => setOpen(open === r.id ? null : r.id)}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-heading">
                          {r.lastLabel} gacha · {r.horizon} oy
                        </div>
                        {r.note && <div className="text-[11px] text-(--color-text-muted)">{r.note}</div>}
                      </td>
                      <td className="px-3 py-2 text-xs text-(--color-text-muted)">
                        {r.createdBy ?? '—'}, {new Date(r.createdAt).toLocaleDateString('ru-RU')}
                      </td>
                      <td className="money px-3 py-2 text-right">
                        {r.checked} / {r.horizon}
                      </td>
                      <td className="money px-3 py-2 text-right">{wapeText(r.wape.revenue)}</td>
                      <td className="money px-3 py-2 text-right">{wapeText(r.wape.payroll)}</td>
                      <td className="money px-3 py-2 text-right">{wapeText(r.wape.opex)}</td>
                      <td className="px-3 py-2 text-right">
                        {isAdmin && (
                          <SmallButton
                            onClick={(e) => {
                              e.stopPropagation();
                              setDel(r.id);
                            }}
                          >
                            O&apos;chirish
                          </SmallButton>
                        )}
                      </td>
                    </tr>
                    {open === r.id && (
                      <tr className="bg-(--color-surface-muted)/60">
                        <td colSpan={7} className="px-5 py-3">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-left text-(--color-text-muted)">
                                <th className="py-1">Oy</th>
                                <th className="px-3 py-1 text-right">Daromad: prognoz → fakt</th>
                                <th className="px-3 py-1 text-right">Ish haqi: prognoz → fakt</th>
                                <th className="px-3 py-1 text-right">Xarajat: prognoz → fakt</th>
                                <th className="py-1 pl-4">Eng katta farq (hudud daromadi)</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.months.map((m) => (
                                <tr key={m.period} className="border-t border-(--color-line)">
                                  <td className="py-1.5 font-medium">{m.label}</td>
                                  {m.available ? (
                                    <>
                                      {[m.revenue, m.payroll, m.opex].map((c, i) => (
                                        <td key={i} className="money whitespace-nowrap px-3 py-1.5 text-right">
                                          {compact(c.forecastTiyin)} → {compact(c.actualTiyin)}{' '}
                                          <b className={cn(c.error !== null && Math.abs(c.error) > 0.1 ? 'text-(--color-expense)' : 'text-heading')}>{share(c.error, true)}</b>
                                        </td>
                                      ))}
                                      <td className="py-1.5 pl-4 text-(--color-text-muted)">{m.worst.map((w) => `${w.name} ${share(w.error, true)}`).join(', ')}</td>
                                    </>
                                  ) : (
                                    <td colSpan={4} className="py-1.5 text-(--color-text-faint)">hali haqiqiy ma&apos;lumot yo&apos;q</td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <ConfirmDialog
        open={del !== null}
        title="Versiyani o'chirish"
        message="Saqlangan prognoz versiyasi o'chiriladi."
        danger
        confirmLabel="O'chirish"
        onCancel={() => setDel(null)}
        onConfirm={async () => {
          try {
            await fcApi.deleteRun(del!);
            setDel(null);
            setTick((t) => t + 1);
          } catch (e) {
            setToast({ message: errorMessage(e), tone: 'error' });
          }
        }}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}