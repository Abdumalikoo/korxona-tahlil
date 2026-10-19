'use client';

import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { compact } from '@/features/structure/api';
import { KpiStrip, PanelHeader, Segmented, SmallButton } from '@/features/structure/parts';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { type Insight, type PerfRow, RANGE_OPTIONS, type RangeMode, reApi, share } from './api';

// ═══════════════════════════════════════════════════════════
// Katta modellar › Hudud natijasi (G): har hudud daromadi, xarajati, natijasi,
// Markaz ulushi bilan tuzatilgan natija, nisbatlar, o'sish, reja, tengdoshlar guruhi.
// ═══════════════════════════════════════════════════════════

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';
type SortKey = 'adjusted' | 'adjustedMargin' | 'revenue' | 'growth' | 'coverage' | 'perHead';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'adjusted', label: 'Tuzatilgan natija' },
  { value: 'adjustedMargin', label: 'Rentabellik' },
  { value: 'revenue', label: 'Daromad' },
  { value: 'growth', label: "O'sish" },
  { value: 'coverage', label: 'Qoplash' },
  { value: 'perHead', label: '1 xodimga' },
];

const PEER: Record<'A' | 'B' | 'C', { label: string; cls: string }> = {
  A: { label: 'Katta', cls: 'bg-brand-100 text-brand-800' },
  B: { label: "O'rta", cls: 'bg-sky-100 text-sky-800' },
  C: { label: 'Kichik', cls: 'bg-slate-100 text-slate-700' },
};

const tone = (t: string | bigint) => (BigInt(t) < 0n ? 'text-(--color-expense)' : 'text-heading');
const num = (t: string | null) => (t === null ? -Infinity : Number(t));

export function InsightList({ items }: { items: Insight[] }) {
  if (!items.length) return null;
  const cls = {
    bad: 'border-red-200 bg-red-50 text-red-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    good: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    info: 'border-sky-100 bg-sky-50/60 text-sky-900',
  };
  const icon = { bad: '▼', warn: '!', good: '▲', info: 'i' };
  return (
    <Card>
      <div className="px-5 py-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Avtomatik xulosalar</h3>
        <ul className="mt-2.5 grid gap-2 lg:grid-cols-2">
          {items.map((it, i) => (
            <li key={i} className={cn('flex gap-2.5 rounded-lg border px-3 py-2 text-sm leading-snug', cls[it.level])}>
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-white/70 text-[10px] font-bold">{icon[it.level]}</span>
              <span>{it.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export function RangeBar({ mode, onMode }: { mode: RangeMode; onMode: (m: RangeMode) => void }) {
  return <Segmented value={mode} onChange={onMode} options={RANGE_OPTIONS} size="sm" />;
}

export function PerformanceView() {
  const { month } = usePeriod();
  const [mode, setMode] = useState<RangeMode>('M');
  const [sort, setSort] = useState<SortKey>('adjusted');
  const [selected, setSelected] = useState<number | null>(null);
  const res = useAsync(() => reApi.performance(month, mode).then((r) => r.data), [month, mode]);
  const d = res.data;

  const rows = useMemo(() => {
    if (!d) return [];
    const key = (r: PerfRow): number => {
      switch (sort) {
        case 'adjusted': return Number(r.adjustedTiyin);
        case 'adjustedMargin': return r.adjustedMargin ?? -Infinity;
        case 'revenue': return Number(r.revenueTiyin);
        case 'growth': return r.revenueGrowth ?? -Infinity;
        case 'coverage': return r.coverage ?? -Infinity;
        case 'perHead': return num(r.revenuePerHeadTiyin);
      }
    };
    return [...d.rows].sort((a, b) => Number(b.hasData) - Number(a.hasData) || key(b) - key(a));
  }, [d, sort]);

  const header = (
    <PanelHeader
      title="Hudud natijasi"
      description={d ? `${d.range.label} · taqqoslash: ${d.range.prevLabel}` : 'Har hudud o‘z xarajatini va Markaz ulushini qoplaydimi'}
      actions={
        <>
          <RangeBar mode={mode} onMode={setMode} />
          {d && (
            <SmallButton
              onClick={() =>
                downloadCsv(
                  `Hudud-natijasi-${d.range.from}_${d.range.to}.csv`,
                  ['Hudud', 'Guruh', 'Daromad', 'Ish haqi', 'Boshqa xarajat', 'Operatsion natija', 'Rentabellik %', 'Markaz ulushi', 'Tuzatilgan natija', 'Tuzatilgan rentabellik %', 'Qoplash', 'Xodimlar', 'Stavkalar', '1 xodimga oyiga', "Daromad o'sishi %", 'Reja', 'Fakt (reja oylari)'],
                  d.rows.map((r) => [
                    r.name,
                    r.peer ? PEER[r.peer].label : '',
                    csvSom(r.revenueTiyin),
                    csvSom(r.payrollTiyin),
                    csvSom(r.opexTiyin),
                    csvSom(r.resultTiyin),
                    r.margin === null ? '' : (r.margin * 100).toFixed(1).replace('.', ','),
                    csvSom(r.allocatedTiyin),
                    csvSom(r.adjustedTiyin),
                    r.adjustedMargin === null ? '' : (r.adjustedMargin * 100).toFixed(1).replace('.', ','),
                    r.coverage === null ? '' : r.coverage.toFixed(2).replace('.', ','),
                    r.headcount,
                    r.fte,
                    r.revenuePerHeadTiyin === null ? '' : csvSom(r.revenuePerHeadTiyin),
                    r.revenueGrowth === null ? '' : (r.revenueGrowth * 100).toFixed(1).replace('.', ','),
                    r.budget ? csvSom(r.budget.planTiyin) : '',
                    r.budget ? csvSom(r.budget.factTiyin) : '',
                  ]),
                  [],
                )
              }
            >
              CSV
            </SmallButton>
          )}
        </>
      }
    >
      {d && d.openPeriods.length > 0 && (
        <p className="text-xs text-amber-800">Yopilmagan oy(lar) bor — Hududchi oyni yopgach raqamlar qat&apos;iylashadi.</p>
      )}
    </PanelHeader>
  );

  if (res.error) return <div className="space-y-4">{header}<Card><ErrorState message={res.error} onRetry={res.reload} /></Card></div>;
  if (!d) return <div className="space-y-4">{header}<Card><LoadingState label="Hisoblanmoqda" /></Card></div>;

  const active = d.rows.filter((r) => r.hasData);
  const sumT = (f: (r: PerfRow) => string) => active.reduce((s, r) => s + BigInt(f(r)), 0n);
  const rev = sumT((r) => r.revenueTiyin);
  const res0 = sumT((r) => r.resultTiyin);
  const alloc = sumT((r) => r.allocatedTiyin);
  const adj = sumT((r) => r.adjustedTiyin);
  const lossCount = active.filter((r) => BigInt(r.adjustedTiyin) < 0n).length;
  const sel = d.rows.find((r) => r.code === selected) ?? null;

  return (
    <div className="space-y-4">
      {header}
      <KpiStrip
        items={[
          { label: 'Hududlar daromadi', value: `${compact(rev.toString())} so'm`, sub: `Korxona daromadining ${share(d.company.regionsRevenueShare)} qismi` },
          { label: 'Operatsion natija', value: `${compact(res0.toString())} so'm`, valueClass: tone(res0), sub: `Rentabellik ${share(rev ? Number(res0) / Number(rev) : null)}` },
          { label: 'Markaz ulushi', value: `${compact(alloc.toString())} so'm`, sub: `Markaz xarajatidan hududlarga taqsimlangan` },
          { label: 'Tuzatilgan natija', value: `${compact(adj.toString())} so'm`, valueClass: tone(adj), sub: lossCount ? `${lossCount} ta hudud zararda` : "Hamma hudud o'zini qoplaydi" },
        ]}
      />
      <InsightList items={d.insights} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--color-line) px-5 py-2.5">
          <p className="text-xs text-(--color-text-muted)">Qatorni bosing — hudud natijasi bosqichma-bosqich ochiladi</p>
          <div className="flex items-center gap-2 text-xs text-(--color-text-muted)">
            Saralash:
            <Segmented value={sort} onChange={setSort} options={SORTS} size="sm" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-(--color-surface-muted) text-left">
              <tr>
                <th className={TH}>Hudud</th>
                <th className={cn(TH, 'text-right')}>Daromad</th>
                <th className={cn(TH, 'text-right')}>Ish haqi</th>
                <th className={cn(TH, 'text-right')}>Boshqa xarajat</th>
                <th className={cn(TH, 'text-right')}>Operatsion natija</th>
                <th className={cn(TH, 'text-right')}>Markaz ulushi</th>
                <th className={cn(TH, 'text-right')}>Tuzatilgan natija</th>
                <th className={cn(TH, 'text-right')} title="Daromad ÷ o'z xarajati">Qoplash</th>
                <th className={cn(TH, 'text-right')} title="O'rtacha xodimlar / shtat birligi">Xodim</th>
                <th className={cn(TH, 'text-right')} title="Oyiga bir xodimga daromad">1 xodimga</th>
                <th className={cn(TH, 'text-right')} title="Xarajat rejasi bajarilishi">Reja</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.code}
                  onClick={() => setSelected(selected === r.code ? null : r.code)}
                  className={cn('cursor-pointer border-t border-(--color-line) hover:bg-brand-50/40', selected === r.code && 'bg-brand-50/70', !r.hasData && 'opacity-50')}
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-heading">{r.name}</div>
                    {r.peer && (
                      <span className={cn('mt-0.5 inline-block whitespace-nowrap rounded px-1.5 py-px text-[10px] font-semibold', PEER[r.peer].cls)} title="Daromad bo'yicha guruh; o'rni — tuzatilgan rentabellik bo'yicha">
                        {PEER[r.peer].label} guruh · {r.peerRank}-o&apos;rin / {r.peerSize}
                      </span>
                    )}
                  </td>
                  <td className="money px-3 py-2 text-right">
                    {compact(r.revenueTiyin)}
                    {r.revenueGrowth !== null && (
                      <div className={cn('text-[11px]', r.revenueGrowth < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{share(r.revenueGrowth, true)}</div>
                    )}
                  </td>
                  <td className="money px-3 py-2 text-right">
                    {compact(r.payrollTiyin)}
                    <div className="text-[11px] text-(--color-text-muted)">{share(r.payrollShare)}</div>
                  </td>
                  <td className="money px-3 py-2 text-right">
                    {compact(r.opexTiyin)}
                    <div className="text-[11px] text-(--color-text-muted)">{share(r.opexShare)}</div>
                  </td>
                  <td className={cn('money px-3 py-2 text-right font-semibold', tone(r.resultTiyin))}>
                    {compact(r.resultTiyin)}
                    <div className="text-[11px] font-normal text-(--color-text-muted)">{share(r.margin)}</div>
                  </td>
                  <td className="money px-3 py-2 text-right text-(--color-text-muted)">{BigInt(r.allocatedTiyin) ? `−${compact(r.allocatedTiyin)}` : '—'}</td>
                  <td className={cn('money px-3 py-2 text-right font-bold', tone(r.adjustedTiyin))}>
                    {compact(r.adjustedTiyin)}
                    <div className="text-[11px] font-normal text-(--color-text-muted)">{share(r.adjustedMargin)}</div>
                  </td>
                  <td className={cn('money px-3 py-2 text-right', r.coverage !== null && r.coverage < 1 && 'text-(--color-expense)')}>{r.coverage === null ? '—' : r.coverage.toFixed(2).replace('.', ',')}</td>
                  <td className="money px-3 py-2 text-right">
                    {r.headcount || '—'}
                    {r.fte !== r.headcount && r.fte > 0 && <div className="text-[11px] text-(--color-text-muted)">{r.fte} st.</div>}
                  </td>
                  <td className="money px-3 py-2 text-right">{r.revenuePerHeadTiyin ? compact(r.revenuePerHeadTiyin) : '—'}</td>
                  <td className="money px-3 py-2 text-right">
                    {r.budget ? (
                      <span className={cn(r.budget.variance !== null && r.budget.variance > 0.1 ? 'text-(--color-expense)' : 'text-heading')} title={`Reja ${compact(r.budget.planTiyin)}, fakt ${compact(r.budget.factTiyin)} (${r.budget.months} oy)`}>
                        {share(r.budget.variance, true)}
                      </span>
                    ) : (
                      <span className="text-(--color-text-faint)">yo&apos;q</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-(--color-line) text-sm">
              <tr className="bg-(--color-surface-muted)">
                <td className="px-3 py-2 font-semibold text-heading">Markaz</td>
                <td className="money px-3 py-2 text-right">{compact(d.center.incomeTiyin)}</td>
                <td colSpan={2} className="money px-3 py-2 text-right">{compact(d.center.expenseTiyin)}</td>
                <td className={cn('money px-3 py-2 text-right font-semibold', tone(d.center.resultTiyin))}>{compact(d.center.resultTiyin)}</td>
                <td className="money px-3 py-2 text-right text-(--color-income)">{BigInt(d.center.allocatedOutTiyin) ? `+${compact(d.center.allocatedOutTiyin)}` : '—'}</td>
                <td className={cn('money px-3 py-2 text-right font-bold', tone(d.center.adjustedTiyin))}>{compact(d.center.adjustedTiyin)}</td>
                <td colSpan={4} className="px-3 py-2 text-xs text-(--color-text-muted)">Hududlarga berilgan ulush Markaz xarajatidan chiqarildi</td>
              </tr>
              {d.unassigned && (
                <tr className="bg-amber-50/60">
                  <td className="px-3 py-2 font-semibold text-amber-900">Biriktirilmagan</td>
                  <td className="money px-3 py-2 text-right">{compact(d.unassigned.incomeTiyin)}</td>
                  <td colSpan={2} className="money px-3 py-2 text-right">{compact(d.unassigned.expenseTiyin)}</td>
                  <td colSpan={2} />
                  <td className={cn('money px-3 py-2 text-right font-bold', tone(d.unassigned.adjustedTiyin))}>{compact(d.unassigned.adjustedTiyin)}</td>
                  <td colSpan={4} className="px-3 py-2 text-xs text-amber-900">Hudud ham, bo&apos;lim ham ko&apos;rsatilmagan yozuvlar</td>
                </tr>
              )}
              <tr className="bg-brand-50 font-bold text-heading">
                <td className="px-3 py-2.5">Korxona jami</td>
                <td className="money px-3 py-2.5 text-right">{compact(d.company.incomeTiyin)}</td>
                <td colSpan={2} className="money px-3 py-2.5 text-right">{compact(d.company.expenseTiyin)}</td>
                <td colSpan={2} />
                <td className={cn('money px-3 py-2.5 text-right', tone(d.company.resultTiyin))}>{compact(d.company.resultTiyin)}</td>
                <td colSpan={4} className={cn('px-3 py-2.5 text-xs font-medium', d.reconciliation.ok ? 'text-(--color-income)' : 'text-(--color-expense)')}>
                  {d.reconciliation.ok ? '✓ Hududlar + Markaz = korxona (tiyingacha mos)' : `✗ Farq: ${compact(d.reconciliation.diffTiyin)}`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {sel && <RegionBreakdown row={sel} prevLabel={d.range.prevLabel} />}

      <Card>
        <div className="px-5 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Qanday hisoblanadi</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-(--color-text)">
            {d.method.map((m) => (
              <li key={m}>{m}</li>
            ))}
            <li>{d.reconciliation.formula}.</li>
          </ul>
        </div>
      </Card>
    </div>
  );
}

/** Tanlangan hudud: daromaddan tuzatilgan natijagacha zinapoya va oldingi davr bilan taqqoslash */
function RegionBreakdown({ row, prevLabel }: { row: PerfRow; prevLabel: string }) {
  const steps = [
    { label: 'Daromad', value: BigInt(row.revenueTiyin), kind: 'in' as const },
    { label: 'Ish haqi', value: -BigInt(row.payrollTiyin), kind: 'out' as const },
    { label: 'Boshqa xarajat', value: -BigInt(row.opexTiyin), kind: 'out' as const },
    { label: 'Operatsion natija', value: BigInt(row.resultTiyin), kind: 'total' as const },
    { label: 'Markaz ulushi', value: -BigInt(row.allocatedTiyin), kind: 'out' as const },
    { label: 'Tuzatilgan natija', value: BigInt(row.adjustedTiyin), kind: 'total' as const },
  ];
  const max = steps.reduce((m, s) => (s.value < 0n ? (-s.value > m ? -s.value : m) : s.value > m ? s.value : m), 1n);
  const w = (v: bigint) => `${Math.max(1, Math.round((Number(v < 0n ? -v : v) / Number(max)) * 100))}%`;
  const prevRows = [
    { label: 'Daromad', cur: row.revenueTiyin, prev: row.prev.revenueTiyin, g: row.revenueGrowth, good: 1 },
    { label: 'Xarajat', cur: row.expenseTiyin, prev: row.prev.expenseTiyin, g: row.expenseGrowth, good: -1 },
    { label: 'Operatsion natija', cur: row.resultTiyin, prev: row.prev.resultTiyin, g: row.resultGrowth, good: 1 },
  ];
  return (
    <Card>
      <div className="grid gap-6 px-5 py-4 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <h3 className="text-sm font-bold text-heading">{row.name}: daromaddan natijagacha</h3>
          <div className="mt-3 space-y-1.5">
            {steps.map((s) => (
              <div key={s.label} className="grid grid-cols-[150px_1fr_110px] items-center gap-3 text-sm">
                <span className={cn(s.kind === 'total' ? 'font-semibold text-heading' : 'text-(--color-text-muted)')}>{s.label}</span>
                <div className="h-4 rounded bg-(--color-surface-muted)">
                  <div
                    className={cn('h-4 rounded', s.kind === 'in' ? 'bg-emerald-400' : s.kind === 'out' ? 'bg-rose-300' : s.value < 0n ? 'bg-rose-500' : 'bg-brand-500')}
                    style={{ width: w(s.value) }}
                  />
                </div>
                <span className={cn('money text-right', s.kind === 'total' && 'font-bold', s.value < 0n && s.kind === 'total' && 'text-(--color-expense)')}>
                  {s.kind === 'out' && s.value !== 0n ? '−' : ''}
                  {compact((s.value < 0n && s.kind === 'out' ? -s.value : s.value).toString())}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-(--color-text-muted)">
            Xodimlar: o&apos;rtacha {row.headcount} kishi, {row.fte} shtat birligi
            {row.fteMissing > 0 && ` (${row.fteMissing} tasining stavkasi kiritilmagan — 1 deb olindi)`}. Qoplash Markaz ulushi bilan: {row.coverageFull === null ? '—' : row.coverageFull.toFixed(2).replace('.', ',')}.
          </p>
        </div>
        <div>
          <h3 className="text-sm font-bold text-heading">Taqqoslash: {prevLabel}</h3>
          {row.prev.hasData ? (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-(--color-text-muted)">
                  <th className="py-1" />
                  <th className="py-1 text-right">Oldin</th>
                  <th className="py-1 text-right">Hozir</th>
                  <th className="py-1 text-right">O&apos;zgarish</th>
                </tr>
              </thead>
              <tbody>
                {prevRows.map((p) => (
                  <tr key={p.label} className="border-t border-(--color-line)">
                    <td className="py-1.5">{p.label}</td>
                    <td className="money py-1.5 text-right">{compact(p.prev)}</td>
                    <td className="money py-1.5 text-right">{compact(p.cur)}</td>
                    <td className={cn('money py-1.5 text-right font-semibold', p.g === null ? 'text-(--color-text-faint)' : p.g * p.good >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)')}>{share(p.g, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-3 text-sm text-(--color-text-muted)">Oldingi davr uchun ma&apos;lumot yo&apos;q — o&apos;sish hisoblanmadi.</p>
          )}
        </div>
      </div>
    </Card>
  );
}