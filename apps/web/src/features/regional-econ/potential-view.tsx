'use client';

import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { FIELD } from '@/features/purchases/bits';
import { compact } from '@/features/structure/api';
import { KpiStrip, PanelHeader, Segmented, SmallButton } from '@/features/structure/parts';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatPeriodShort } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, useState } from 'react';
import { potApi, type PotentialResult, type RegionPotential, type ServicePotential, share } from './api';
import { InsightList } from './performance-view';

// ═══════════════════════════════════════════════════════════
// Katta modellar › Salohiyat (C): har hudud va xizmat uchun barqaror oynadagi o'rtacha qiymat va
// o'rtacha o'sishdan kelib chiqqan salohiyat; prognoz va fakt bilan solishtiruv; hisob ochiq ko'rinadi.
// ═══════════════════════════════════════════════════════════

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';
const HORIZONS = [
  { value: '3', label: '3 oy' },
  { value: '6', label: '6 oy' },
  { value: '12', label: '12 oy' },
];
const n = (t: string | null | undefined) => (t ? Number(t) : 0);
const num = (x: number, d = 2) => x.toFixed(d).replace('.', ',');

function UtilBar({ u }: { u: number | null }) {
  if (u === null) return <span className="text-(--color-text-faint)">—</span>;
  const w = Math.max(0, Math.min(1.3, u)) / 1.3;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="relative h-2 w-20 rounded bg-(--color-surface-muted)">
        <div className={cn('h-2 rounded', u < 0.9 ? 'bg-amber-400' : u > 1.1 ? 'bg-emerald-500' : 'bg-brand-500')} style={{ width: `${w * 100}%` }} />
        <div className="absolute top-[-2px] h-3 w-px bg-slate-500" style={{ left: `${(1 / 1.3) * 100}%` }} />
      </div>
      <span className={cn('money w-14 text-right', u < 0.9 ? 'text-amber-700' : u > 1.1 ? 'text-(--color-income)' : 'text-heading')}>{share(u)}</span>
    </div>
  );
}

export function PotentialView() {
  const { month } = usePeriod();
  const [h, setH] = useState('3');
  const [region, setRegion] = useState<number | null>(null);
  const res = useAsync(() => potApi.potential(month, Number(h)).then((r) => r.data), [month, h]);
  const d = res.data;
  const header = (
    <PanelHeader
      title="Salohiyat"
      description={d ? `${d.lastLabel} gacha yuklangan daromad asosida · barqaror oyna o'rtachasi × o'rtacha o'sish` : "Hududlar qancha daromad keltira oladi — yuklangan ma'lumotdan"}
      actions={<Segmented value={h} onChange={setH} options={HORIZONS} size="sm" />}
    >
      {d && (
        <div className="flex justify-end">
          <select value={region ?? ''} onChange={(e) => setRegion(e.target.value ? Number(e.target.value) : null)} className={cn(FIELD, 'h-8 w-60 text-xs')}>
            <option value="">Barcha hududlar</option>
            {d.regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </PanelHeader>
  );
  if (res.error) return <div className="space-y-4">{header}<Card><ErrorState message={res.error} onRetry={res.reload} /></Card></div>;
  if (!d) return <div className="space-y-4">{header}<Card><LoadingState label="Barqaror oynalar va uzilishlar aniqlanmoqda" /></Card></div>;
  const sel = region === null ? null : (d.regions.find((r) => r.code === region) ?? null);
  const t = sel ? { actual: sel.actualLastTiyin, fitted: sel.fittedLastTiyin, util: sel.utilization, ahead: sel.aheadSeasonal, annual: sel.ahead, forecast: sel.forecast } : { actual: d.total.actualLastTiyin, fitted: d.total.fittedLastTiyin, util: d.total.utilization, ahead: d.total.aheadSeasonal, annual: d.total.ahead, forecast: d.total.forecast };
  const below = d.regions.filter((r) => r.utilization !== null && r.utilization < 0.9).length;
  const gap0 = n(t.forecast[0]) - n(t.ahead[0]);
  return (
    <div className="space-y-4">
      {header}
      <KpiStrip
        items={[
          { label: `Salohiyat · ${d.periodLabels[0]}`, value: `${compact(t.ahead[0]!)} so'm`, sub: `davr jami ${compact(String(t.ahead.reduce((s, v) => s + n(v), 0)))}${t.annual[0] !== t.ahead[0] ? ` · mavsumsiz ${compact(t.annual[0]!)}` : ''}` },
          { label: `Prognoz · ${d.periodLabels[0]}`, value: `${compact(t.forecast[0]!)} so'm`, valueClass: gap0 < 0 ? 'text-amber-700' : 'text-heading', sub: `salohiyatga nisbatan ${share(n(t.ahead[0]) ? gap0 / n(t.ahead[0]) : null, true)}` },
          { label: `Fakt · ${d.lastLabel}`, value: `${compact(t.actual)} so'm`, sub: `barqaror daraja ${compact(t.fitted)}` },
          { label: 'Foydalanish', value: share(t.util), valueClass: t.util !== null && t.util < 0.9 ? 'text-amber-700' : 'text-heading', sub: sel ? 'fakt ÷ barqaror daraja' : `${below} ta hudud 90% dan past` },
        ]}
      />
      <InsightList items={sel ? d.insights.filter((i) => i.regionCode === sel.code || i.regionCode === null) : d.insights} />
      {sel ? <RegionServices d={d} r={sel} /> : <RegionTable d={d} onSelect={setRegion} />}
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
    </div>
  );
}

function RegionTable({ d, onSelect }: { d: PotentialResult; onSelect: (c: number) => void }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-(--color-line) px-5 py-2.5">
        <p className="text-xs text-(--color-text-muted)">Qatorni bosing — xizmatlar va hisob ochiladi</p>
        <SmallButton
          onClick={() =>
            downloadCsv(
              `Salohiyat-${d.lastActual}.csv`,
              ['Hudud', `Fakt ${d.lastLabel}`, 'Barqaror daraja', 'Foydalanish %', ...d.periodLabels.map((p) => `Salohiyat ${p}`), ...d.periodLabels.map((p) => `Prognoz ${p}`)],
              d.regions.map((r) => [r.name, csvSom(r.actualLastTiyin), csvSom(r.fittedLastTiyin), r.utilization === null ? '' : (r.utilization * 100).toFixed(1).replace('.', ','), ...r.aheadSeasonal.map(csvSom), ...r.forecast.map(csvSom)]),
              [],
            )
          }
        >
          CSV
        </SmallButton>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-(--color-surface-muted) text-left">
            <tr>
              <th className={TH}>Hudud</th>
              <th className={cn(TH, 'text-right')}>{formatPeriodShort(d.lastActual)} fakt</th>
              <th className={cn(TH, 'text-right')}>Barqaror daraja</th>
              <th className={cn(TH, 'text-right')}>Foydalanish</th>
              {d.periods.map((p) => (
                <th key={p} className={cn(TH, 'text-right')}>Salohiyat {formatPeriodShort(p)}</th>
              ))}
              <th className={cn(TH, 'text-right')}>Prognoz {formatPeriodShort(d.periods[0]!)}</th>
              <th className={TH}>Uzilishlar</th>
            </tr>
          </thead>
          <tbody>
            {d.regions.map((r) => {
              const det = r.services.reduce((s, x) => s + x.breaks.filter((b) => b.source === 'DETECTED').length, 0);
              const ev = r.services.reduce((s, x) => s + x.breaks.filter((b) => b.source === 'EVENT').length, 0);
              const gap = n(r.forecast[0]) - n(r.aheadSeasonal[0]);
              return (
                <tr key={r.code} onClick={() => onSelect(r.code)} className={cn('cursor-pointer border-t border-(--color-line) hover:bg-brand-50/40', !r.hasData && 'opacity-50')}>
                  <td className="px-3 py-2 font-medium text-heading">{r.name}</td>
                  <td className="money px-3 py-2 text-right">{compact(r.actualLastTiyin)}</td>
                  <td className="money px-3 py-2 text-right text-(--color-text-muted)">{compact(r.fittedLastTiyin)}</td>
                  <td className="px-3 py-2">
                    <UtilBar u={r.utilization} />
                  </td>
                  {r.aheadSeasonal.map((v, i) => (
                    <td key={i} className={cn('money px-3 py-2 text-right', i === 0 && 'font-semibold')} title={`Yillik daraja (mavsumsiz): ${compact(r.ahead[i]!)}`}>
                      {compact(v)}
                      {v !== r.ahead[i] && <div className="text-[10px] font-normal text-(--color-text-muted)">mavsumsiz {compact(r.ahead[i]!)}</div>}
                    </td>
                  ))}
                  <td className="money px-3 py-2 text-right">
                    {compact(r.forecast[0]!)}
                    {n(r.aheadSeasonal[0]) > 0 && <div className={cn('text-[11px]', gap < 0 ? 'text-amber-700' : 'text-(--color-income)')}>{share(gap / n(r.aheadSeasonal[0]), true)}</div>}
                  </td>
                  <td className="px-3 py-2 text-xs text-(--color-text-muted)">
                    {ev > 0 && <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5">jurnal: {ev}</span>}
                    {det > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">avtomatik: {det}</span>}
                    {!ev && !det && '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RegionServices({ d, r }: { d: PotentialResult; r: RegionPotential }) {
  const [open, setOpen] = useState<string | null>(r.services[0]?.key ?? null);
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-(--color-line) px-5 py-3">
        <h3 className="text-sm font-bold text-heading">{r.name}: xizmatlar bo&apos;yicha salohiyat</h3>
        <p className="text-xs text-(--color-text-muted)">Qatorni bosing — hisob bosqichma-bosqich ochiladi</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <thead className="bg-(--color-surface-muted) text-left">
            <tr>
              <th className={cn(TH, 'min-w-[200px]')}>Xizmat</th>
              <th className={TH}>Barqaror oyna</th>
              <th className={cn(TH, 'text-right')}>Ȳ (o&apos;rtacha)</th>
              <th className={cn(TH, 'text-right')}>g (oyiga)</th>
              <th className={cn(TH, 'text-right')} title="Variatsiya koeffitsienti σ ÷ Ȳ">Tebranish</th>
              <th className={cn(TH, 'text-right')}>Foydalanish</th>
              {d.periods.map((p) => (
                <th key={p} className={cn(TH, 'text-right')}>{formatPeriodShort(p)}</th>
              ))}
              <th className={cn(TH, 'text-right')}>Prognoz</th>
            </tr>
          </thead>
          <tbody>
            {r.services.map((s) => (
              <Fragment key={s.key}>
                <tr onClick={() => setOpen(open === s.key ? null : s.key)} className={cn('cursor-pointer border-t border-(--color-line) hover:bg-brand-50/40', open === s.key && 'bg-brand-50/60')}>
                  <td className="px-3 py-2 font-medium text-heading">{s.label}</td>
                  <td className="min-w-[170px] px-3 py-2 text-xs">
                    <span className="whitespace-nowrap">
                      {formatPeriodShort(s.window.from)} – {formatPeriodShort(s.window.to)} · {s.window.n} oy
                    </span>
                    <div className={cn('text-[11px]', s.window.reason === 'DETECTED' ? 'text-amber-700' : 'text-(--color-text-muted)')}>{s.window.reasonText}</div>
                  </td>
                  <td className="money px-3 py-2 text-right">{compact(s.meanTiyin)}</td>
                  <td className={cn('money px-3 py-2 text-right', s.growth < 0 ? 'text-(--color-expense)' : 'text-heading')}>{share(s.growth, true)}</td>
                  <td className={cn('money px-3 py-2 text-right', !s.stable && 'text-amber-700')}>{s.cv === null ? '—' : share(s.cv)}</td>
                  <td className="px-3 py-2">
                    <UtilBar u={s.utilization} />
                  </td>
                  {s.aheadSeasonal.map((v, i) => (
                    <td key={i} className={cn('money px-3 py-2 text-right', i === 0 && 'font-semibold')} title={s.seasonal ? `Mavsum indeksi ${s.seasonal.ahead[i]!.toFixed(2).replace('.', ',')}; yillik daraja ${compact(s.ahead[i]!)}` : undefined}>
                      {compact(v)}
                      {s.seasonal && <div className="text-[10px] font-normal text-(--color-text-muted)">×{s.seasonal.ahead[i]!.toFixed(2).replace('.', ',')}</div>}
                    </td>
                  ))}
                  <td className="money px-3 py-2 text-right text-(--color-text-muted)">{compact(s.forecast[0]!)}</td>
                </tr>
                {open === s.key && (
                  <tr className="bg-(--color-surface-muted)/50">
                    <td colSpan={7 + d.periods.length} className="px-5 py-3">
                      <Workings s={s} d={d} />
                    </td>
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

/** Hisob: oyna qiymatlari → Ȳ → g → salohiyat */
function Workings({ s, d }: { s: ServicePotential; d: PotentialResult }) {
  const vals = s.windowValues.map((v) => n(v.valueTiyin));
  const max = Math.max(...vals, 1);
  const growths = vals.slice(1).map((v, i) => (vals[i]! > 0 ? v / vals[i]! - 1 : null));
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1.3fr]">
      <div>
        <p className="mb-2 text-xs font-semibold text-heading">Barqaror oyna ({s.window.n} oy)</p>
        <div className="flex h-24 items-end gap-1">
          {s.windowValues.map((v) => (
            <div key={v.period} className="flex flex-1 flex-col items-center gap-1" title={`${formatPeriodShort(v.period)}: ${compact(v.valueTiyin)}`}>
              <div className="w-full rounded-t bg-brand-400" style={{ height: `${(n(v.valueTiyin) / max) * 80}px` }} />
              <span className="text-[9px] text-(--color-text-muted)">{formatPeriodShort(v.period)}</span>
            </div>
          ))}
        </div>
        {s.breaks.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-[11px]">
            {s.breaks.map((b) => (
              <li key={b.period + b.source} className={b.source === 'DETECTED' ? 'text-amber-800' : 'text-(--color-text-muted)'}>
                {formatPeriodShort(b.period)}: {b.source === 'DETECTED' ? 'avtomatik uzilish' : 'jurnal'} — {b.text}
              </li>
            ))}
          </ul>
        )}
        {s.notes.map((x) => (
          <p key={x} className="mt-1 text-[11px] text-sky-800">↳ {x}</p>
        ))}
      </div>
      <div className="space-y-1.5 text-xs leading-relaxed">
        <p>
          <b>Ȳ</b> = ({s.windowValues.map((v) => compact(v.valueTiyin)).join(' + ')}) ÷ {s.window.n} = <b>{compact(s.meanTiyin)}</b>
        </p>
        <p>
          <b>g</b> ={' '}
          {s.growthMethod === 'YOY'
            ? "(oxirgi 12 oy ÷ oldingi 12 oy)^(1/12) − 1 — mavsumdan xoli yillik solishtiruv"
            : s.growthMethod === 'TREND'
              ? "log-chiziqli trend bo'yicha o'rtacha oylik o'zgarish"
              : "oy-oy o'sishlar o'rtachasi"}{' '}
          = <b>{share(s.growth, true)}</b> oyiga
          <span className="text-(--color-text-muted)"> (oy-oy: {growths.map((g) => (g === null ? '—' : share(g, true))).join('; ') || '—'})</span>
        </p>
        <p>
          Ȳ oynaning o&apos;rtasiga ({num(s.exponent, 1)}-oy) tegishli, shuning uchun {d.periodLabels[0]} uchun daraja ko&apos;rsatkichi {num(s.exponent, 1)}:
        </p>
        <p>
          <b>Salohiyat</b> = {compact(s.meanTiyin)} × (1 {s.growth < 0 ? '−' : '+'} {num(Math.abs(s.growth) * 100, 2)}%)<sup>{num(s.exponent, 1)}</sup> = <b>{compact(s.ahead[0]!)}</b>
          {s.seasonal ? ' (yillik daraja)' : ''}
        </p>
        {s.seasonal && (
          <p>
            <b>Mavsum</b>: {d.periodLabels[0]} indeksi {num(s.seasonal.ahead[0]!, 2)} (oxirgi ikki yilda shu oy ÷ yil o&apos;rtachasi) → shu oy uchun salohiyat ={' '}
            <b>
              {compact(s.ahead[0]!)} × {num(s.seasonal.ahead[0]!, 2)} = {compact(s.aheadSeasonal[0]!)}
            </b>
          </p>
        )}
        <p className="text-(--color-text-muted)">
          {d.lastLabel} uchun barqaror daraja {compact(s.fittedLastSeasonalTiyin)}{s.seasonal ? ` (mavsum ×${num(s.seasonal.last, 2)})` : ''}, fakt {compact(s.actualLastTiyin)} → foydalanish {share(s.utilization)}. Tebranish {s.cv === null ? '—' : share(s.cv)}
          {s.stable ? ' — barqaror.' : " — beqaror, salohiyat ehtiyotkorlik bilan."}
        </p>
      </div>
    </div>
  );
}