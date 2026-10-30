'use client';

import { changeOf, ExcelButton, Field, FilterBar, MoneyCell, NameCell, PctInline, PillTabs, ReportCard, RTable, SelectBox, StatTiles, STICKY_NAME, STICKY_NO, sum, TableNote, Td, Th, Tr } from '@/components/report/report';
import { MiniButton, NotesList } from '@/components/report/report-extra-b';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Toast } from '@/components/ui/toast';
import { FIELD } from '@/features/purchases/bits';
import { compact, TONE } from '@/features/structure/api';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatPeriodShort } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, type ReactNode, useMemo, useState } from 'react';
import { type BandT, fcApi, type FcAccuracy, type Insight, type RegionalForecast, type RegionForecast, RELIABILITY, type Reliability, share } from './api';

// ═══════════════════════════════════════════════════════════
// Katta modellar › Hudud prognozi (3-bosqich): daromad (hudud × xizmat), ish haqi (xodim bo'yicha),
// xarajat, Markaz ulushi va natija; o'tmishda sinalgan aniqlik; saqlangan versiyalar va prognoz–fakt.
// Ko'rinish — Solishtirma hisobot uslubida (kartalar, filtrlar qatori, yorliqlar, jadvallar).
// ═══════════════════════════════════════════════════════════

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
/** Oraliq: «1 234 … 5 678» (to'liq summa) */
const rangeText = (b: BandT) => `${sum(b.loTiyin)} … ${sum(b.hiTiyin)}`;

function RelBadge({ r, title }: { r: Reliability; title?: string }) {
  return (
    <span className={cn('inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', RELIABILITY[r].cls)} title={title}>
      {RELIABILITY[r].label}
    </span>
  );
}

function AccCell({ a }: { a: FcAccuracy }) {
  if (a.wape === null) return <span className="text-(--color-text-faint)">sinalmagan</span>;
  const better = a.naiveWape !== null && a.wape < a.naiveWape;
  return (
    <span className="whitespace-nowrap" title={`1 oy oldinga xato ${wapeText(a.wape)} (${a.points} marta sinaldi); oddiy usul (o'tgan oy) ${wapeText(a.naiveWape)}; 2 oy ${wapeText(a.byH[1] ?? null)}, 3 oy ${wapeText(a.byH[2] ?? null)}`}>
      {wapeText(a.wape)}
      {a.naiveWape !== null && <span className={cn('ml-1 text-[11px] font-semibold', better ? 'text-(--color-income)' : 'text-(--color-warn)')}>{better ? '▲' : '▼'} {wapeText(a.naiveWape)}</span>}
    </span>
  );
}

/** Avtomatik xulosalar — hisobot kartasida */
function InsightsCard({ items }: { items: Insight[] }) {
  if (!items.length) return null;
  const cls = {
    bad: 'border-red-200 bg-red-50 text-red-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    info: 'border-sky-100 bg-sky-50/60 text-sky-900',
  };
  const icon = { bad: '▼', warn: '!', good: '▲', info: 'i' };
  return (
    <ReportCard title="Avtomatik xulosalar" badge={`${items.length} ta`}>
      <ul className="grid gap-2 px-5 pb-5 lg:grid-cols-2">
        {items.map((it, i) => (
          <li key={i} className={cn('flex gap-2.5 rounded-xl border px-3 py-2 text-sm leading-snug', cls[it.level])}>
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-white/70 text-[10px] font-bold">{icon[it.level]}</span>
            <span>{it.text}</span>
          </li>
        ))}
      </ul>
    </ReportCard>
  );
}

/** Jadval boshidagi № va nom sarlavhalari */
function HeadNo() {
  return <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>;
}
function HeadName({ children, className }: { children: ReactNode; className?: string }) {
  return <Th className={cn(STICKY_NAME, 'z-[2] min-w-44 text-left', className)}>{children}</Th>;
}
function NoCell({ i }: { i?: number }) {
  return <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i ?? ''}</Td>;
}
/** Tanlangan qator foni */
const SELECTED = '[&>td]:bg-brand-50';

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
    <>
      <FilterBar
        actions={
          <span className="max-w-[36rem] text-right text-xs text-(--color-text-muted)">
            <b className="font-semibold text-heading">Hudud prognozi</b> ·{' '}
            {d ? `${d.lastLabel} gacha haqiqiy ma'lumot asosida · ${d.periodLabels[0]} – ${d.periodLabels[d.periodLabels.length - 1]}` : 'Daromad, ish haqi, xarajat va natija — hududlar bo‘yicha'}
          </span>
        }
      >
        <Field label="Prognoz muddati">
          <SelectBox value={h} options={HORIZONS} onChange={setH} className="min-w-28" />
        </Field>
        {d && view !== 'runs' && (
          <Field label="Hudud">
            <SelectBox
              value={region === null ? '' : String(region)}
              options={[{ value: '', label: 'Barcha hududlar' }, ...d.regions.map((r) => ({ value: String(r.code), label: r.name }))]}
              onChange={(v) => setRegion(v ? Number(v) : null)}
              className="w-60"
            />
          </Field>
        )}
      </FilterBar>
      <PillTabs value={view} onChange={setView} options={VIEWS} />
    </>
  );
  if (res.error || !d) return <div className="space-y-4">{header}<LoadingCard label="Modellar o'rgatilmoqda va o'tmishda sinalmoqda" error={res.error} onRetry={res.reload} /></div>;
  const sel = region === null ? null : (d.regions.find((r) => r.code === region) ?? null);

  return (
    <div className="space-y-4">
      {header}
      {view === 'overview' && <Overview d={d} sel={sel} onSelect={setRegion} />}
      {view === 'revenue' && <RevenueView d={d} sel={sel} onSelect={setRegion} />}
      {view === 'payroll' && <PayrollView d={d} sel={sel} onSelect={setRegion} month={month} h={Number(h)} />}
      {view === 'opex' && <OpexView d={d} sel={sel} />}
      {view === 'runs' && <RunsView d={d} month={month} h={Number(h)} />}
      {d.notes.length > 0 && (
        <ReportCard title="Diqqat" className="border-l-4 border-l-amber-400">
          <NotesList notes={d.notes} />
        </ReportCard>
      )}
      {view !== 'runs' && (
        <ReportCard title="Qanday hisoblanadi">
          <NotesList notes={d.method} />
        </ReportCard>
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
  const exportCsv = () =>
    downloadCsv(
      `Hudud-prognozi-${d.lastActual}-${d.horizon}oy.csv`,
      ['Hudud', ...d.periodLabels.flatMap((p) => [`Daromad ${p}`, `Ish haqi ${p}`, `Xarajat ${p}`, `Markaz ulushi ${p}`, `Natija ${p}`, `Natija 80% past ${p}`, `Natija 80% yuqori ${p}`])],
      d.regions.map((r) => [r.name, ...d.periods.flatMap((_, i) => [csvSom(r.revenue.forecast[i]!.meanTiyin), csvSom(r.payroll.forecast[i]!.meanTiyin), csvSom(r.opex.forecast[i]!.meanTiyin), csvSom(r.overhead.forecast[i]!.meanTiyin), csvSom(r.result[i]!.meanTiyin), csvSom(r.result[i]!.loTiyin), csvSom(r.result[i]!.hiTiyin)])]),
      [],
    );
  return (
    <>
      <StatTiles
        items={[
          { label: `Daromad · ${d.periodLabels[0]}`, value: fr, previous: lr || null, growthGood: true, tone: 'green', note: `${d.lastLabel}: ${compact(scope.last.revenueTiyin)} (${lr ? share(fr / lr - 1, true) : '—'}) · aniqlik ${wapeText(scope.wape)}` },
          { label: `Ish haqi · ${d.periodLabels[0]}`, value: n(scope.payroll[0]!.meanTiyin), tone: 'purple', note: `${d.lastLabel}: ${compact(scope.last.payrollTiyin)} · aniqlik ${wapeText(scope.pw)}` },
          { label: 'Xarajat va Markaz ulushi', value: n(scope.opex[0]!.meanTiyin) + n(scope.overhead[0]!.meanTiyin), tone: 'red', note: `xarajat ${compact(scope.opex[0]!.meanTiyin)} + Markaz ${compact(scope.overhead[0]!.meanTiyin)}` },
          { label: `Natija · ${d.periodLabels[0]}`, value: n(r0.meanTiyin), signed: true, tone: 'blue', note: `80%: ${compact(r0.loTiyin)} … ${compact(r0.hiTiyin)}` },
          { label: 'Natija · davr jami', value: bandSum(scope.result), signed: true, tone: 'cyan', note: `${d.periodLabels[0]} – ${d.periodLabels[d.periodLabels.length - 1]}` },
        ]}
      />
      <ReportCard title="Hududlar bo'yicha prognoz" badge={`Keyingi oy (${d.periodLabels[0]}) va butun davr`} actions={<ExcelButton onClick={exportCsv} />}>
        <RTable minWidth={1080}>
          <thead>
            <tr>
              <HeadNo />
              <HeadName>Hudud</HeadName>
              <Th>Daromad</Th>
              <Th>Ish haqi</Th>
              <Th>Xarajat</Th>
              <Th>Markaz ulushi</Th>
              <Th>Natija (80% oraliq)</Th>
              <Th>Davr natijasi</Th>
              <Th>Ishonchlilik</Th>
            </tr>
          </thead>
          <tbody>
            <Tr total>
              <Td className={STICKY_NO} />
              <NameCell>Jami hududlar</NameCell>
              <MoneyCell value={n(t.revenue[0]!.meanTiyin)} />
              <MoneyCell value={n(t.payroll[0]!.meanTiyin)} />
              <MoneyCell value={n(t.opex[0]!.meanTiyin)} />
              <MoneyCell value={n(t.overhead[0]!.meanTiyin)} />
              <MoneyCell value={n(t.result[0]!.meanTiyin)} className={cn(neg(t.result[0]!.meanTiyin) && 'text-(--color-expense)')} />
              <MoneyCell value={bandSum(t.result)} className={cn(bandSum(t.result) < 0 && 'text-(--color-expense)')} />
              <Td className="text-xs font-normal">Markaz: {share(d.central.allocatedShare)} taqsimlanadi</Td>
            </Tr>
            {d.regions.map((r, i) => {
              const lr2 = n(r.last.revenueTiyin);
              const f0 = n(r.revenue.forecast[0]!.meanTiyin);
              const active = sel?.code === r.code;
              return (
                <Tr key={r.code} onClick={() => onSelect(active ? null : r.code)} title="Bosing — hudud tanlanadi" className={cn(active && SELECTED, !r.hasData && 'opacity-50')}>
                  <NoCell i={i + 1} />
                  <NameCell drill>{r.name}</NameCell>
                  <Td className="whitespace-nowrap">
                    {sum(f0)}
                    {lr2 > 0 && <PctInline value={changeOf(f0, lr2)} />}
                  </Td>
                  <MoneyCell value={n(r.payroll.forecast[0]!.meanTiyin)} />
                  <MoneyCell value={n(r.opex.forecast[0]!.meanTiyin)} />
                  <MoneyCell value={n(r.overhead.forecast[0]!.meanTiyin)} className="text-(--color-text-muted)" />
                  <Td className={cn('whitespace-nowrap font-semibold', neg(r.result[0]!.meanTiyin) ? 'text-(--color-expense)' : 'text-heading')}>
                    {sum(r.result[0]!.meanTiyin)}
                    <div className="text-[11px] font-normal text-(--color-text-muted)">{rangeText(r.result[0]!)}</div>
                  </Td>
                  <MoneyCell value={bandSum(r.result)} strong className={bandSum(r.result) < 0 ? 'text-(--color-expense)' : 'text-heading'} />
                  <Td>
                    <RelBadge r={r.hasData ? r.revenue.reliability : 'none'} title={`Daromad aniqligi ${wapeText(r.revenue.wape)}, ish haqi ${wapeText(r.payroll.wape)}`} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </RTable>
        <TableNote>Qatorni bosing — hudud tanlanadi (yuqoridagi kartalar va grafik shu hududga o&apos;tadi). Natija ostida — 80% ishonch oralig&apos;i; foiz — {d.lastLabel} faktiga nisbatan.</TableNote>
      </ReportCard>
      <InsightsCard items={insights} />
      <ReportCard title={`${sel ? sel.name : 'Barcha hududlar'}: daromad va xarajat`} badge="xarajat = ish haqi + xarajat">
        <div className="px-4 pb-4">
          <FcChart
            history={d.history}
            periods={d.periods}
            series={[
              { name: 'Daromad', color: TONE.income, history: scope.rh, forecast: scope.revenue },
              { name: 'Ish haqi + xarajat', color: TONE.expense, history: scope.ch, forecast: cost },
            ]}
          />
        </div>
      </ReportCard>
    </>
  );
}

/** Oylar ustunlari: prognoz va oraliq */
function MonthCells({ bands, strong }: { bands: BandT[]; strong?: boolean }) {
  return (
    <>
      {bands.map((b, i) => (
        <Td key={i} className={cn('whitespace-nowrap', strong && 'font-semibold', neg(b.meanTiyin) && 'text-(--color-expense)')} title={`80%: ${rangeText(b)}`}>
          {sum(b.meanTiyin)}
        </Td>
      ))}
    </>
  );
}

function RevenueView({ d, sel, onSelect }: SelProps) {
  if (!sel) {
    return (
      <ReportCard title="Daromad prognozi — hududlar" badge={`${d.regions.length} ta hudud`}>
        <RTable minWidth={900}>
          <thead>
            <tr>
              <HeadNo />
              <HeadName>Hudud</HeadName>
              <Th>{d.lastLabel} (fakt)</Th>
              {d.periods.map((p) => (
                <Th key={p}>{formatPeriodShort(p)}</Th>
              ))}
              <Th>Aniqlik</Th>
              <Th>Xizmatlar</Th>
            </tr>
          </thead>
          <tbody>
            {d.regions.map((r, i) => (
              <Tr key={r.code} onClick={() => onSelect(r.code)}>
                <NoCell i={i + 1} />
                <NameCell drill>{r.name}</NameCell>
                <MoneyCell value={n(r.last.revenueTiyin)} className="text-(--color-text-muted)" />
                <MonthCells bands={r.revenue.forecast} />
                <Td>{wapeText(r.revenue.wape)}</Td>
                <Td className="text-xs text-(--color-text-muted)">{r.revenue.services.length} ta</Td>
              </Tr>
            ))}
          </tbody>
        </RTable>
        <TableNote>Hudud jami — xizmatlar prognozlari yig&apos;indisi. Hududni bosing — xizmatlar bo&apos;yicha ochiladi. Katakcha ustiga borganda — 80% oraliq.</TableNote>
      </ReportCard>
    );
  }
  return (
    <>
      <ReportCard title="Xizmatlar bo'yicha" badge={`${sel.revenue.services.length} ta`}>
        <RTable minWidth={1000}>
          <thead>
            <tr>
              <HeadNo />
              <HeadName className="min-w-[220px]">Xizmat</HeadName>
              <Th>{formatPeriodShort(d.lastActual)} fakt</Th>
              {d.periods.map((p) => (
                <Th key={p}>{formatPeriodShort(p)}</Th>
              ))}
              <Th>Model</Th>
              <Th>Aniqlik</Th>
              <Th>Ishonch</Th>
            </tr>
          </thead>
          <tbody>
            {sel.revenue.services.map((s, i) => (
              <Fragment key={s.key}>
                <Tr>
                  <NoCell i={i + 1} />
                  <NameCell sub={`${s.used} oy ma'lumot${s.fromPeriod ? `, ${formatPeriodShort(s.fromPeriod)} dan` : ''}`}>
                    <span className="font-medium text-heading">{s.label}</span>
                  </NameCell>
                  <MoneyCell value={n(s.history[s.history.length - 1]?.valueTiyin ?? '0')} className="text-(--color-text-muted)" />
                  <MonthCells bands={s.forecast} />
                  <Td className="text-xs">{s.modelLabel}</Td>
                  <Td className="text-xs">
                    <AccCell a={s.accuracy} />
                  </Td>
                  <Td>
                    <RelBadge r={s.reliability} />
                  </Td>
                </Tr>
                {s.notes.length > 0 && (
                  <Tr muted>
                    <Td className={STICKY_NO} />
                    <Td colSpan={5 + d.periods.length} className="text-left text-[11px] text-sky-800">
                      {s.notes.map((x) => (
                        <div key={x}>↳ {x}</div>
                      ))}
                    </Td>
                  </Tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </RTable>
        <TableNote>Aniqlik — o&apos;tmishda 1 oy oldinga aytilganda o&apos;rtacha xato; ▲ — oddiy usuldan (o&apos;tgan oy takrorlanadi) yaxshi. Katakcha ustiga borganda — 80% oraliq.</TableNote>
      </ReportCard>
      <ReportCard title={`${sel.name}: daromad`}>
        <div className="px-4 pb-4">
          <FcChart history={d.history} periods={d.periods} series={[{ name: 'Daromad', color: TONE.income, history: sel.revenue.history.map((x) => n(x.valueTiyin)), forecast: sel.revenue.forecast }]} height={240} />
        </div>
      </ReportCard>
    </>
  );
}

const BASIS: Record<string, string> = { CARD: 'shtat kartasi', RECENT: "so'nggi 3 oy", REGION: "hudud o'rtachasi", NONE: "ma'lumot yo'q" };

function PayrollView({ d, sel, onSelect, month, h }: SelProps & { month: string; h: number }) {
  return (
    <>
      <ReportCard title="Ish haqi prognozi — xodimlar bo'yicha hisoblangan" badge={`${d.regions.length} ta hudud`}>
        <RTable minWidth={900}>
          <thead>
            <tr>
              <HeadNo />
              <HeadName>Hudud</HeadName>
              <Th>Xodimlar</Th>
              <Th>{formatPeriodShort(d.lastActual)} fakt</Th>
              {d.periods.map((p) => (
                <Th key={p}>{formatPeriodShort(p)}</Th>
              ))}
              <Th>Aniqlik</Th>
              <Th className="text-left">Asos</Th>
            </tr>
          </thead>
          <tbody>
            {d.regions.map((r, i) => {
              const active = sel?.code === r.code;
              return (
                <Tr key={r.code} onClick={() => onSelect(active ? null : r.code)} className={cn(active && SELECTED)}>
                  <NoCell i={i + 1} />
                  <NameCell drill>{r.name}</NameCell>
                  <Td className="whitespace-nowrap">
                    {r.payroll.headcountNow}
                    {r.payroll.headcount[r.payroll.headcount.length - 1] !== r.payroll.headcountNow && <span className="text-xs text-(--color-text-muted)"> → {r.payroll.headcount[r.payroll.headcount.length - 1]}</span>}
                  </Td>
                  <MoneyCell value={n(r.last.payrollTiyin)} className="text-(--color-text-muted)" />
                  <MonthCells bands={r.payroll.forecast} />
                  <Td>{r.payroll.backtestMonths ? wapeText(r.payroll.wape) : '—'}</Td>
                  <Td className="text-left text-[11px] text-(--color-text-muted)">
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
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </RTable>
        <TableNote>Aniqlik — oxirgi 3 oyni shu usul bilan oldindan aytib ko&apos;rilgandagi xato. Hududni bosing — xodimlar ro&apos;yxati.</TableNote>
      </ReportCard>
      {sel && <PayrollEmployees month={month} h={h} code={sel.code} />}
    </>
  );
}

function PayrollEmployees({ month, h, code }: { month: string; h: number; code: number }) {
  const res = useAsync(() => fcApi.payroll(month, h, code).then((r) => r.data), [month, h, code]);
  const d = res.data;
  if (res.error || !d) return <LoadingCard label="Xodimlar hisoblanmoqda" error={res.error} onRetry={res.reload} />;
  return (
    <ReportCard title={`${d.region.name}: xodimlar`} badge={`${d.rows.length} ta`}>
      {/* Uzun ro'yxat: jadval o'z ichida aylanadi, sarlavha qotib turadi */}
      <div className="max-h-[600px] overflow-auto px-4 pb-4">
        <table className="w-full min-w-[1000px] border-separate border-spacing-0 rounded-xl border border-(--color-line) text-sm">
          <thead>
            <tr>
              <Th className={cn(STICKY_NO, 'top-0 z-[3]')}>№</Th>
              <Th className={cn(STICKY_NAME, 'top-0 z-[3] min-w-52 text-left')}>Xodim</Th>
              <Th className="sticky top-0 z-[2]">Karta</Th>
              <Th className="sticky top-0 z-[2]">Nisbat</Th>
              {d.recentPeriods.map((p) => (
                <Th key={p} className="sticky top-0 z-[2] text-(--color-text-muted)">{formatPeriodShort(p)}</Th>
              ))}
              {d.periods.map((p) => (
                <Th key={p} className="sticky top-0 z-[2]">{formatPeriodShort(p)}</Th>
              ))}
              <Th className="sticky top-0 z-[2] text-left">O&apos;zgarishlar</Th>
            </tr>
          </thead>
          <tbody>
            {d.rows.map((r, i) => (
              <Tr key={r.pinfl}>
                <NoCell i={i + 1} />
                <NameCell sub={r.position || undefined}>
                  <span className="font-medium text-heading">{r.fullName}</span>
                </NameCell>
                <Td className="whitespace-nowrap">
                  {r.cardTiyin ? sum(r.cardTiyin) : <span className="text-(--color-warn)">yo&apos;q</span>}
                  {r.rate !== null && r.rate !== 1 && <div className="text-[10px] text-(--color-text-muted)">{String(r.rate).replace('.', ',')} st.</div>}
                </Td>
                <Td>{r.ratio === null ? '—' : r.ratio.toFixed(2).replace('.', ',')}</Td>
                {r.recent.map((v, j) => (
                  <Td key={j} className="whitespace-nowrap text-(--color-text-muted)">{n(v) ? sum(v) : '—'}</Td>
                ))}
                {r.months.map((m, j) => (
                  <Td key={j} className="whitespace-nowrap" title={m ? BASIS[m.basis] : 'ishlamaydi'}>
                    {m ? sum(m.valueTiyin) : <span className="text-(--color-text-faint)">—</span>}
                    {m && m.basis !== 'CARD' && <div className="text-[10px] text-(--color-warn)">{BASIS[m.basis]}</div>}
                  </Td>
                ))}
                <Td className="text-left text-[11px] text-sky-800">{r.changes.join('; ')}</Td>
              </Tr>
            ))}
          </tbody>
        </table>
      </div>
      <TableNote>
        Karta = maosh × stavka; nisbat = to&apos;langan ÷ karta (so&apos;nggi 3 oy medianasi; hudud bo&apos;yicha {d.regionRatio === null ? '—' : d.regionRatio.toFixed(2).replace('.', ',')}). Och rangli oylar — oxirgi haqiqiy oylar.
      </TableNote>
    </ReportCard>
  );
}

function OpexView({ d, sel }: { d: RegionalForecast; sel: RegionForecast | null }) {
  const rows = sel ? [sel] : d.regions;
  return (
    <ReportCard title="Xarajat prognozi (ish haqisiz)" badge={sel ? sel.name : `${rows.length} ta hudud`}>
      <RTable minWidth={960}>
        <thead>
          <tr>
            <HeadNo />
            <HeadName>Hudud</HeadName>
            <Th>{formatPeriodShort(d.lastActual)} fakt</Th>
            <Th>Model (takroriy)</Th>
            <Th>Bir martalik zaxira</Th>
            {d.periods.map((p) => (
              <Th key={p}>{formatPeriodShort(p)}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <Fragment key={r.code}>
              <Tr>
                <NoCell i={i + 1} />
                <NameCell>
                  <span className="font-medium text-heading">{r.name}</span>
                </NameCell>
                <MoneyCell value={n(r.last.opexTiyin)} className="text-(--color-text-muted)" />
                <Td className="text-xs">
                  {r.opex.recurring ? (
                    <>
                      {r.opex.recurring.modelLabel} · <AccCell a={r.opex.recurring.accuracy} />
                    </>
                  ) : (
                    '—'
                  )}
                </Td>
                <Td className="whitespace-nowrap">{n(r.opex.oneTimeAllowanceTiyin) ? sum(r.opex.oneTimeAllowanceTiyin) : '—'}</Td>
                <MonthCells bands={r.opex.forecast} strong />
              </Tr>
              {r.opex.budget.some((b) => b !== null) && (
                <Tr muted>
                  <Td className={STICKY_NO} />
                  <Td colSpan={4} className="text-right text-xs text-(--color-text-muted)">Reja / farq</Td>
                  {r.opex.budget.map((b, j) => {
                    const diff = b === null ? null : n(r.opex.forecast[j]!.meanTiyin) / n(b) - 1;
                    return (
                      <Td key={j} className="whitespace-nowrap text-xs">
                        {b === null ? '—' : sum(b)}
                        {diff !== null && <div className={cn('font-semibold', diff > 0.1 ? 'text-(--color-expense)' : 'text-(--color-text-muted)')}>{share(diff, true)}</div>}
                      </Td>
                    );
                  })}
                </Tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </RTable>
      <TableNote>Takroriy va belgilanmagan xarajatlar — model; bir martalik — so&apos;nggi 6 oy o&apos;rtachasi zaxira sifatida. Reja — «Xarajat rejasi»dan.</TableNote>
    </ReportCard>
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
        <ReportCard title="Joriy prognozni versiya sifatida saqlash" badge={`${d.lastLabel} gacha · ${d.horizon} oy`}>
          <div className="flex flex-wrap items-end gap-3 px-5 pb-5">
            <div className="min-w-64 flex-1">
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
        </ReportCard>
      )}
      {runs.error || !runs.data ? (
        <LoadingCard label="Versiyalar yuklanmoqda" error={runs.error} onRetry={runs.reload} />
      ) : !list.length ? (
        <ReportCard title="Saqlangan versiyalar">
          <EmptyNote>Hali saqlangan versiya yo&apos;q.</EmptyNote>
        </ReportCard>
      ) : (
        <ReportCard title="Saqlangan versiyalar" badge={`${list.length} ta`}>
          <RTable minWidth={900}>
            <thead>
              <tr>
                <HeadNo />
                <HeadName>Versiya</HeadName>
                <Th className="text-left">Kim, qachon</Th>
                <Th>Tekshirilgan oy</Th>
                <Th>Daromad xatosi</Th>
                <Th>Ish haqi xatosi</Th>
                <Th>Xarajat xatosi</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <Fragment key={r.id}>
                  <Tr onClick={() => setOpen(open === r.id ? null : r.id)} title="Bosing — oylar bo'yicha prognoz va fakt" className={cn(open === r.id && SELECTED)}>
                    <NoCell i={i + 1} />
                    <NameCell drill sub={r.note || undefined}>
                      {r.lastLabel} gacha · {r.horizon} oy
                    </NameCell>
                    <Td className="text-left text-xs text-(--color-text-muted)">
                      {r.createdBy ?? '—'}, {new Date(r.createdAt).toLocaleDateString('ru-RU')}
                    </Td>
                    <Td>
                      {r.checked} / {r.horizon}
                    </Td>
                    <Td>{wapeText(r.wape.revenue)}</Td>
                    <Td>{wapeText(r.wape.payroll)}</Td>
                    <Td>{wapeText(r.wape.opex)}</Td>
                    <Td>{isAdmin && <MiniButton onClick={() => setDel(r.id)}>O&apos;chirish</MiniButton>}</Td>
                  </Tr>
                  {open === r.id && (
                    <Tr muted>
                      <Td colSpan={8} className="px-5 py-3 text-left">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-(--color-text-muted)">
                              <th className="py-1 font-semibold">Oy</th>
                              <th className="px-3 py-1 text-right font-semibold">Daromad: prognoz → fakt</th>
                              <th className="px-3 py-1 text-right font-semibold">Ish haqi: prognoz → fakt</th>
                              <th className="px-3 py-1 text-right font-semibold">Xarajat: prognoz → fakt</th>
                              <th className="py-1 pl-4 font-semibold">Eng katta farq (hudud daromadi)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {r.months.map((m) => (
                              <tr key={m.period} className="border-t border-(--color-line)">
                                <td className="py-1.5 font-medium">{m.label}</td>
                                {m.available ? (
                                  <>
                                    {[m.revenue, m.payroll, m.opex].map((c, j) => (
                                      <td key={j} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                                        {sum(c.forecastTiyin)} → {sum(c.actualTiyin)}{' '}
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
                      </Td>
                    </Tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </RTable>
          <TableNote>Qatorni bosing — versiyaning har oyi bo&apos;yicha prognoz va haqiqiy natija ochiladi.</TableNote>
        </ReportCard>
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
