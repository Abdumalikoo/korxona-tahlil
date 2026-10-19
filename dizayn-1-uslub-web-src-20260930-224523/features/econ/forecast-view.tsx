'use client';

import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Mark } from '@/features/reactions/mark';
import { compact, pct } from '@/features/structure/api';
import { Findings, KpiStrip, PanelHeader, Segmented, SmallButton } from '@/features/structure/parts';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState, type ReactNode } from 'react';
import {
  econApi,
  forecastMark,
  higherIsBetter,
  RELIABILITY,
  TARGET_OPTIONS,
  type EconOverview,
  type ForecastResult,
  type Reliability,
  type Target,
  type UnitForecastSummary,
  type UnitsForecastResult,
} from './api';
import { ForecastChart, ForecastLegend, SeasonChart, SparkForecast, targetColor } from './forecast-chart';

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]';
const HORIZONS = [
  { value: '3', label: '3 oy' },
  { value: '6', label: '6 oy' },
  { value: '12', label: '12 oy' },
] as const;

type SortKey = 'name' | 'next' | 'change' | 'year' | 'reliability';

export function ReliabilityPill({ value, className }: { value: Reliability; className?: string }) {
  const r = RELIABILITY[value];
  return (
    <span title={r.hint} className={cn('inline-flex whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-semibold', r.tone, className)}>
      {r.label}
    </span>
  );
}

function signedPct(value: number | null): string {
  return value === null ? '—' : pct(value, true);
}

function changeClass(value: number | null, target: Target): string {
  if (value === null || Math.abs(value) < 1) return 'text-[--color-text-muted]';
  return value > 0 === higherIsBetter(target) ? 'text-[--color-income]' : 'text-[--color-expense]';
}

// ═══════════════════════════════════════════════════════════
// Model haqida: nima tanlandi va nega
// ═══════════════════════════════════════════════════════════

function ModelPanel({ data }: { data: ForecastResult }) {
  const p = data.model.params;
  const acc = data.accuracy;
  return (
    <Card className="flex flex-col">
      <div className="border-b border-[--color-line] px-5 py-3.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[--color-text-faint]">Tanlangan model</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{data.model.name}</h3>
          <ReliabilityPill value={data.reliability} />
        </div>
      </div>
      <div className="flex-1 space-y-3 px-5 py-4 text-sm leading-relaxed">
        <p>{data.model.explain}</p>
        {p && (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-[--color-text-muted]">Daraja (α)</dt>
              <dd className="font-semibold tabular-nums">{p.alpha.toFixed(2).replace('.', ',')}</dd>
            </div>
            {data.model.kind !== 'ses' && (
              <>
                <div>
                  <dt className="text-[--color-text-muted]">Trend (β)</dt>
                  <dd className="font-semibold tabular-nums">{p.beta.toFixed(3).replace('.', ',')}</dd>
                </div>
                <div>
                  <dt className="text-[--color-text-muted]">So&apos;nish (φ)</dt>
                  <dd className="font-semibold tabular-nums">{p.phi.toFixed(2).replace('.', ',')}</dd>
                </div>
              </>
            )}
            {data.model.kind === 'seasonal' && (
              <div>
                <dt className="text-[--color-text-muted]">Mavsum (γ)</dt>
                <dd className="font-semibold tabular-nums">{p.gamma.toFixed(2).replace('.', ',')}</dd>
              </div>
            )}
          </dl>
        )}
        <div className="rounded-[--radius-control] border border-[--color-line] bg-[--color-surface-muted] px-3 py-2.5 text-xs text-[--color-text-muted]">
          {data.model.kind === 'combined' ? (
            <p>
              <span className="font-semibold text-[--color-text]">Qanday hisoblanadi: </span>
              natija = daromad prognozi − xarajat prognozi. Har ikkisi o&apos;z modeli bilan (uch xil usul sinalib) topiladi, shuning uchun natija, daromad va
              xarajat raqamlari har doim bir-biriga qo&apos;shiladi.
            </p>
          ) : (
            <p>
              <span className="font-semibold text-[--color-text]">Qanday tanlandi: </span>
              tizim uch xil usulni (oddiy tekislash, trendli, mavsumiy) sinab ko&apos;radi va oxirgi oylarni eng to&apos;g&apos;ri oldindan aytganini tanlaydi.
              Murakkabroq usul oddiyidan aniq yaxshi bo&apos;lsagina olinadi.
            </p>
          )}
          {acc.points > 0 && (
            <p className="mt-1.5">
              <span className="font-semibold text-[--color-text]">Sinov: </span>
              oxirgi {acc.points} oy yashirildi va model ularni bilmasdan aytib berdi — o&apos;rtacha xato {pct((acc.wape ?? 0) * 100)}
              {acc.basis === 'income' && ' (daromad hajmiga nisbatan)'}
              {acc.naiveWape !== null && data.target !== 'result' && <> (oddiy usul «o&apos;tgan oy takrorlanadi» — {pct(acc.naiveWape * 100)})</>}.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// Sinov jadvali: model aytgan va haqiqatda bo'lgan
// ═══════════════════════════════════════════════════════════

function BacktestPanel({ data }: { data: ForecastResult }) {
  const rows = data.accuracy.rows;
  if (rows.length === 0) return null;
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3.5">
        <h3 className="text-sm font-semibold">O&apos;tmishda sinov</h3>
        <p className="mt-0.5 text-xs text-[--color-text-muted]">Har oy uchun model faqat undan oldingi ma&apos;lumotni ko&apos;rib aytgan qiymat.</p>
      </div>
      <table className="w-full text-sm">
        <thead className="border-y border-[--color-line] bg-[--color-surface-muted]">
          <tr>
            <th className={cn(TH, 'pl-5 text-left')}>Oy</th>
            <th className={cn(TH, 'text-right')}>Haqiqiy</th>
            <th className={cn(TH, 'text-right')}>Model aytgan</th>
            <th className={cn(TH, 'pr-5 text-right')}>{data.accuracy.basis === 'value' ? 'Xato' : 'Farq'}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[--color-line]">
          {rows.map((r) => {
            const a = Number(r.actualTiyin);
            const f = Number(r.predictedTiyin);
            const byValue = data.accuracy.basis === 'value';
            const err = byValue && a !== 0 ? ((f - a) / Math.abs(a)) * 100 : null;
            return (
              <tr key={r.period}>
                <td className="py-2 pl-5 pr-3">{formatPeriod(r.period)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{compact(a)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[--color-text-muted]">{compact(f)}</td>
                <td className={cn('whitespace-nowrap py-2 pl-3 pr-5 text-right tabular-nums', err !== null && Math.abs(err) > 15 ? 'font-semibold text-amber-700' : 'text-[--color-text-muted]')}>
                  {byValue ? (err === null ? '—' : pct(err, true)) : `${f - a >= 0 ? '+' : '−'}${compact(Math.abs(f - a))}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// Prognoz oylari jadvali
// ═══════════════════════════════════════════════════════════

function ForecastTable({ data }: { data: ForecastResult }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
        <div>
          <h3 className="text-sm font-semibold">Oylar bo&apos;yicha prognoz</h3>
          <p className="mt-0.5 text-xs text-[--color-text-muted]">80% — 10 holatdan 8 tasida qiymat shu oraliqda bo&apos;ladi; 95% — deyarli har doim.</p>
        </div>
        <SmallButton
          onClick={() =>
            downloadCsv(
              `prognoz-${data.target}-${data.unit}`,
              ['Oy', 'Turi', 'Qiymat', '80% dan', '80% gacha', '95% dan', '95% gacha'],
              [
                ...data.history.map((h) => [h.period, 'haqiqiy', csvSom(h.valueTiyin), null, null, null, null]),
                ...data.forecast.map((f) => [f.period, 'prognoz', csvSom(f.meanTiyin), csvSom(f.lo80Tiyin), csvSom(f.hi80Tiyin), csvSom(f.lo95Tiyin), csvSom(f.hi95Tiyin)]),
              ],
            )
          }
        >
          CSV yuklab olish
        </SmallButton>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y border-[--color-line] bg-[--color-surface-muted]">
            <tr>
              <th className={cn(TH, 'pl-5 text-left')}>Oy</th>
              <th className={cn(TH, 'text-right')}>Kutilmoqda</th>
              <th className={cn(TH, 'text-right')}>80% oraliq</th>
              <th className={cn(TH, 'pr-5 text-right')}>95% oraliq</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[--color-line]">
            {data.forecast.map((f) => (
              <tr key={f.period}>
                <td className="whitespace-nowrap py-2 pl-5 pr-3">
                  {formatPeriod(f.period)}
                  {f.actualSoFarTiyin && <span className="block text-[11px] text-[--color-text-faint]">hozircha {compact(f.actualSoFarTiyin)}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{compact(f.meanTiyin)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {compact(f.lo80Tiyin)} – {compact(f.hi80Tiyin)}
                </td>
                <td className="whitespace-nowrap py-2 pl-3 pr-5 text-right tabular-nums text-[--color-text-muted]">
                  {compact(f.lo95Tiyin)} – {compact(f.hi95Tiyin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// Hududlar bo'yicha prognoz jadvali
// ═══════════════════════════════════════════════════════════

const RELIABILITY_ORDER: Record<Reliability, number> = { high: 0, medium: 1, low: 2, none: 3 };

function UnitsTable({
  data,
  target,
  selected,
  onSelect,
}: {
  data: UnitsForecastResult;
  target: Target;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'change', dir: higherIsBetter(target) ? 'asc' : 'desc' });
  const color = targetColor(target);
  const rows = useMemo(() => {
    const value = (u: UnitForecastSummary): number | string => {
      switch (sort.key) {
        case 'name':
          return u.name.toLowerCase();
        case 'next':
          return Number(u.nextAvgTiyin);
        case 'year':
          return Number(u.yearEndTiyin ?? 0);
        case 'reliability':
          return RELIABILITY_ORDER[u.reliability];
        default:
          return u.changePercent ?? (sort.dir === 'asc' ? Infinity : -Infinity);
      }
    };
    const body = data.units.filter((u) => u.kind !== 'total');
    body.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    const total = data.units.find((u) => u.kind === 'total');
    return total ? [total, ...body] : body;
  }, [data, sort]);

  const th = (label: string, key: SortKey, className?: string) => (
    <th className={cn(TH, className)}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === 'desc' ? 'asc' : 'desc' }))}
        className={cn('inline-flex items-center gap-1 uppercase hover:text-[--color-text]', sort.key === key && 'text-[--color-text]')}
      >
        {label}
        <span className="text-[10px]">{sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
        <div>
          <h3 className="text-sm font-semibold">Hududlar bo&apos;yicha: keyingi 3 oy</h3>
          <p className="mt-0.5 text-xs text-[--color-text-muted]">Har bir hudud uchun alohida model tanlanadi. Qatorni bosing — yuqoridagi grafik shu hududga o&apos;tadi.</p>
        </div>
        <SmallButton
          onClick={() =>
            downloadCsv(
              `prognoz-hududlar-${target}`,
              ['Hudud', "Oxirgi 3 oy o'rtachasi", "Keyingi 3 oy o'rtachasi", '80% dan', '80% gacha', "O'zgarish %", 'Yil oxirigacha', 'Ishonchlilik', 'Model'],
              rows.map((u) => [
                u.name,
                csvSom(u.recentAvgTiyin),
                csvSom(u.nextAvgTiyin),
                csvSom(u.nextLo80Tiyin),
                csvSom(u.nextHi80Tiyin),
                u.changePercent === null ? null : Math.round(u.changePercent * 10) / 10,
                u.yearEndTiyin === null ? null : csvSom(u.yearEndTiyin),
                RELIABILITY[u.reliability].label,
                u.model,
              ]),
            )
          }
        >
          CSV yuklab olish
        </SmallButton>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y border-[--color-line] bg-[--color-surface-muted]">
            <tr>
              {th('Hudud', 'name', 'pl-5 text-left')}
              <th className={cn(TH, 'text-right')}>Oxirgi 3 oy</th>
              {th('Keyingi 3 oy', 'next', 'text-right')}
              {th("O'zgarish", 'change', 'text-right')}
              {th('Yil oxirigacha', 'year', 'text-right')}
              <th className={cn(TH, 'text-left')}>12 oy + prognoz</th>
              {th('Ishonch', 'reliability', 'pr-5 text-right')}
            </tr>
          </thead>
          <tbody className="divide-y divide-[--color-line]">
            {rows.map((u) => (
              <tr
                key={u.key}
                onClick={() => onSelect(u.key)}
                className={cn(
                  'cursor-pointer hover:bg-[--color-surface-muted]',
                  u.kind === 'total' && 'bg-[--color-surface-muted] font-medium',
                  selected === u.key && 'outline outline-2 -outline-offset-2 outline-slate-700',
                )}
              >
                <td className="py-2.5 pl-5 pr-3">
                  <span className="flex items-center gap-2">
                    <Mark item={forecastMark(u, target)} />
                    <span className="truncate">{u.name}</span>
                    {u.kind === 'center' && <span className="text-[10px] font-semibold uppercase text-[--color-text-faint]">markaz</span>}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[--color-text-muted]">{compact(u.recentAvgTiyin)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                  <span className="font-semibold">{u.reliability === 'none' ? '—' : compact(u.nextAvgTiyin)}</span>
                  {u.reliability !== 'none' && (
                    <span className="block text-[11px] text-[--color-text-faint]">
                      {compact(u.nextLo80Tiyin)} – {compact(u.nextHi80Tiyin)}
                    </span>
                  )}
                </td>
                <td className={cn('whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums', changeClass(u.changePercent, target))}>{signedPct(u.changePercent)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{u.yearEndTiyin === null ? '—' : compact(u.yearEndTiyin)}</td>
                <td className="px-3 py-2.5">
                  <SparkForecast values={u.spark} from={u.sparkForecastFrom} color={color} />
                </td>
                <td className="py-2.5 pl-3 pr-5 text-right">
                  <ReliabilityPill value={u.reliability} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// Prognoz bo'limi
// ═══════════════════════════════════════════════════════════

export function ForecastView({ overview }: { overview: EconOverview }) {
  const [target, setTarget] = useState<Target>('income');
  const [unit, setUnit] = useState('all');
  const [horizon, setHorizon] = useState<'3' | '6' | '12'>('6');

  const forecast = useAsync(() => econApi.forecast(target, unit, Number(horizon)).then((r) => r.data), [target, unit, horizon]);
  const units = useAsync(() => econApi.unitsForecast(target, 3).then((r) => r.data), [target]);
  const data = forecast.data;

  const unitOptions = [
    { key: 'all', name: 'Butun korxona' },
    ...overview.units.filter((u) => u.kind === 'region'),
    ...overview.units.filter((u) => u.kind === 'center'),
    ...overview.units.filter((u) => u.kind === 'unassigned'),
  ];
  const word = TARGET_OPTIONS.find((o) => o.value === target)!.label.toLowerCase();

  let body: ReactNode;
  if (forecast.error) body = <Card><ErrorState message={forecast.error} onRetry={forecast.reload} /></Card>;
  else if (!data) body = <Card><LoadingState label="Model hisoblanmoqda" /></Card>;
  else if (data.forecast.length === 0) {
    body = (
      <Card>
        <EmptyState title="Prognoz uchun ma'lumot yetarli emas" description={data.notes.join(' ')} />
      </Card>
    );
  } else {
    const next3 = data.forecast.slice(0, 3);
    const nextAvg = next3.reduce((s, f) => s + Number(f.meanTiyin), 0) / next3.length;
    const recent = data.history.slice(-3).map((h) => Number(h.valueTiyin));
    const recentAvg = recent.reduce((s, v) => s + v, 0) / Math.max(1, recent.length);
    const change = recentAvg !== 0 ? ((nextAvg - recentAvg) / Math.abs(recentAvg)) * 100 : null;
    const first = data.forecast[0]!;
    const ye = data.yearEnd;
    const yeChange = ye && ye.previousYearTiyin && Number(ye.previousYearTiyin) !== 0 ? ((Number(ye.totalTiyin) - Number(ye.previousYearTiyin)) / Math.abs(Number(ye.previousYearTiyin))) * 100 : null;

    body = (
      <div className="space-y-4">
        <KpiStrip
          items={[
            {
              label: `${formatPeriod(first.period)} (joriy oy)`,
              value: compact(first.meanTiyin),
              sub: first.actualSoFarTiyin ? `hozircha ${compact(first.actualSoFarTiyin)} yozilgan` : `80%: ${compact(first.lo80Tiyin)} – ${compact(first.hi80Tiyin)}`,
              mark: <Mark item={forecastMark({ key: data.unit, name: data.unitName }, target)} />,
            },
            {
              label: "Keyingi 3 oy, o'rtacha",
              value: compact(nextAvg),
              sub: (
                <span>
                  oxirgi 3 oyga nisbatan <span className={cn('font-semibold', changeClass(change, target))}>{signedPct(change)}</span>
                </span>
              ),
            },
            {
              label: ye ? `${ye.year}-yil jami (taxmin)` : 'Yil jami',
              value: ye ? compact(ye.totalTiyin) : '—',
              sub: ye ? (
                <span>
                  <span className="block">
                    {Number(ye.currentPeriod.slice(5, 7)) > 1 && <>haqiqiy {compact(ye.actualTiyin)} + </>}
                    {formatPeriod(ye.currentPeriod).split(' ')[0]} {compact(ye.currentExpectedTiyin)}
                    {Number(ye.currentPeriod.slice(5, 7)) < 12 && <> + prognoz {compact(ye.restTiyin)}</>}
                  </span>
                  80%: {compact(ye.lo80Tiyin)} – {compact(ye.hi80Tiyin)}
                  {yeChange !== null && (
                    <>
                      {' · '}o&apos;tgan yilga <span className={cn('font-semibold', changeClass(yeChange, target))}>{signedPct(yeChange)}</span>
                    </>
                  )}
                </span>
              ) : undefined,
            },
            {
              label: 'Ishonchlilik',
              value: RELIABILITY[data.reliability].label,
              valueClass: data.reliability === 'high' ? 'text-[--color-income]' : data.reliability === 'low' ? 'text-amber-700' : undefined,
              sub:
                data.accuracy.wape !== null
                  ? `sinovda o'rtacha xato ${pct(data.accuracy.wape * 100)}${data.accuracy.basis === 'income' ? ' (daromadga nisbatan)' : ''}`
                  : "sinash uchun ma'lumot kam",
            },
          ]}
        />

        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[--color-line] px-5 py-3.5">
            <div>
              <h3 className="text-sm font-semibold">
                {data.unitName}: {data.targetLabel.toLowerCase()}
              </h3>
              <p className="mt-0.5 text-xs text-[--color-text-muted]">
                {data.history.length} ta tugagan oy asosida, {data.forecast.length} oy oldinga · {data.model.name}
              </p>
            </div>
            <ReliabilityPill value={data.reliability} />
          </div>
          <div className="px-3 pb-2 pt-3">
            <ForecastChart data={data} />
          </div>
          <div className="border-t border-[--color-line] px-5 py-2.5">
            <ForecastLegend target={target} />
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-5">
          <div className="xl:col-span-3">
            <Findings title="Prognoz xulosalari" notes={data.notes} />
          </div>
          <div className="xl:col-span-2">
            <ModelPanel data={data} />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <ForecastTable data={data} />
          <div className="space-y-4">
            {data.model.seasonal && (
              <Card>
                <div className="px-5 py-3.5">
                  <h3 className="text-sm font-semibold">Yillik mavsum</h3>
                  <p className="mt-0.5 text-xs text-[--color-text-muted]">Har oy odatda o&apos;rtachadan qancha yuqori yoki past bo&apos;ladi.</p>
                </div>
                <div className="px-3 pb-3">
                  <SeasonChart seasonal={data.model.seasonal} target={target} />
                </div>
              </Card>
            )}
            <BacktestPanel data={data} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Prognoz"
        description={`Kelgusi oylarda ${word} qancha bo'lishi — o'tgan oylardagi qonuniyat asosida, ehtimol oraliqlari bilan`}
        actions={<Segmented value={target} options={TARGET_OPTIONS} onChange={setTarget} />}
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="text-xs text-[--color-text-muted]">Hudud:</span>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="h-8 min-w-[12rem] rounded-[--radius-control] border border-[--color-line] bg-white px-2 text-sm outline-none focus:border-slate-500"
            >
              {unitOptions.map((u) => (
                <option key={u.key} value={u.key}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <span className="flex items-center gap-2">
            <span className="text-xs text-[--color-text-muted]">Muddat:</span>
            <Segmented value={horizon} options={[...HORIZONS]} onChange={setHorizon} size="sm" />
          </span>
          <span className="text-xs text-[--color-text-faint]">
            Ma&apos;lumot: {formatPeriod(overview.firstPeriod)} – {formatPeriod(overview.lastFullPeriod)} ({overview.fullMonths} oy)
          </span>
        </div>
      </PanelHeader>

      {body}

      {units.error ? (
        <Card>
          <ErrorState message={units.error} onRetry={units.reload} />
        </Card>
      ) : !units.data ? (
        <Card>
          <LoadingState label="Hududlar hisoblanmoqda" />
        </Card>
      ) : (
        <>
          <UnitsTable
            data={units.data}
            target={target}
            selected={unit}
            onSelect={(key) => {
              setUnit(key);
              if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
          <Findings title="Hududlar bo'yicha xulosa" notes={units.data.notes} />
        </>
      )}
    </div>
  );
}