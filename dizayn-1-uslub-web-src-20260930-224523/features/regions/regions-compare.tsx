'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { compact, num, pct, som, TONE, type CompareMode, type SectionFilter } from '@/features/structure/api';
import { Legend, LineChart, Sparkline } from '@/features/structure/charts';
import {
  CompareToggle,
  Findings,
  GroupTitle,
  KpiStrip,
  ModelCard,
  PanelHeader,
  SearchBox,
  SectionToggle,
  SmallButton,
  ViewTabs,
} from '@/features/structure/parts';
import { changePct, csvPct, csvSom, downloadCsv } from '@/features/structure/stats';
import { formatDate, formatPeriod, formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { Mark } from '@/features/reactions/mark';
import { regionsApi, statsOf, unitMark, type RegionsResult, type UnitStats } from './api';
import { RegionCard } from './region-card';
import { Bridge, EXPENSE_BAR, ExpenseMix, MIX_COLORS, MIX_LABELS, PairedBars, ProfitBars, ProfitHeatmap, RegionScatter } from './regions-charts';

type View = 'table' | 'pairs' | 'rating' | 'map' | 'months' | 'mix';
type SortKey = 'name' | 'income' | 'expense' | 'profit' | 'margin' | 'delta' | 'headcount' | 'perHead';

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]';

function signed(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${compact(Math.abs(value))}`;
}

function toneOf(delta: number | null, good: boolean): string {
  if (delta === null || Math.abs(delta) < 0.5) return 'text-[--color-text-muted]';
  return delta > 0 === good ? 'text-[--color-income]' : 'text-[--color-expense]';
}


function sortValue(s: UnitStats, key: SortKey): number | string {
  switch (key) {
    case 'name':
      return s.unit.name.toLowerCase();
    case 'income':
      return s.income;
    case 'expense':
      return s.expense;
    case 'margin':
      return s.margin ?? Number.NEGATIVE_INFINITY;
    case 'delta':
      return s.profitDelta;
    case 'headcount':
      return s.unit.headcount;
    case 'perHead':
      return s.incomePerHead ?? Number.NEGATIVE_INFINITY;
    default:
      return s.profit;
  }
}

// ═══════════════════════════════════════════════════════════
// Asosiy jadval
// ═══════════════════════════════════════════════════════════

function SortTh({ label, column, sort, onSort, className }: { label: string; column: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === column;
  return (
    <th className={cn(TH, className)}>
      <button type="button" onClick={() => onSort(column)} className={cn('inline-flex items-center gap-1 uppercase hover:text-[--color-text]', active && 'text-[--color-text]')}>
        {label}
        <span className="text-[10px]">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

function UnitRow({ s, rank, onOpen, strong, section }: { s: UnitStats; rank: number | null; onOpen: (key: string) => void; strong?: boolean; section: SectionFilter }) {
  const u = s.unit;
  return (
    <tr className={cn('group cursor-pointer hover:bg-[--color-surface-muted]', strong && 'bg-slate-50')} onClick={() => onOpen(u.key)}>
      <td className="py-2.5 pl-5 pr-1 text-right text-xs tabular-nums text-[--color-text-faint]">{rank ?? ''}</td>
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-2">
          <Mark item={unitMark(u, 'RESULT', section)} />
          <span className={cn('block max-w-[14rem] truncate group-hover:underline', u.kind !== 'region' && 'font-medium')} title={u.name}>
            {u.name}
          </span>
        </span>
        {u.kind !== 'region' && (
          <span className="text-xs text-[--color-text-faint]">{u.kind === 'center' ? "Markaz bo'limlari va xodimlari" : 'hudud belgilanmagan yozuvlar'}</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{num(s.income)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
        {num(s.expense)}
        <span className="block text-xs text-[--color-text-faint]">ish haqi {compact(s.payroll)}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums" style={{ color: s.profit >= 0 ? TONE.income : TONE.expense }}>
        {num(s.profit)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[--color-text-muted]">{pct(s.margin)}</td>
      <td className={cn('hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums md:table-cell', toneOf(s.profitDelta === 0 ? null : s.profitDelta, true))}>
        {signed(s.profitDelta)}
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums lg:table-cell">{String(u.headcount).replace('.', ',')}</td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums lg:table-cell">{s.incomePerHead === null ? '—' : compact(s.incomePerHead)}</td>
      <td className="hidden px-3 py-2.5 2xl:table-cell">
        <Sparkline values={s.profitTrend.slice(-12).map(String)} color={s.profit >= 0 ? TONE.income : TONE.expense} />
      </td>
      <td className={cn('whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-xs tabular-nums', s.lossMonths > 0 ? 'text-[--color-expense]' : 'text-[--color-text-faint]')}>
        {s.activeMonths > 0 ? `${s.lossMonths} / ${s.activeMonths}` : '—'}
      </td>
    </tr>
  );
}

function TotalRow({ label, rows, previousProfit }: { label: string; rows: UnitStats[]; previousProfit: number }) {
  const income = rows.reduce((s, r) => s + r.income, 0);
  const expense = rows.reduce((s, r) => s + r.expense, 0);
  const payroll = rows.reduce((s, r) => s + r.payroll, 0);
  const heads = rows.reduce((s, r) => s + r.unit.headcount, 0);
  const profit = income - expense;
  return (
    <tr className="border-t-2 border-[--color-line] bg-[--color-surface-muted] font-semibold">
      <td />
      <td className="px-3 py-2.5">{label}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{num(income)}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
        {num(expense)}
        <span className="block text-xs font-normal text-[--color-text-faint]">ish haqi {compact(payroll)}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums" style={{ color: profit >= 0 ? TONE.income : TONE.expense }}>
        {num(profit)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{pct(income > 0 ? (profit / income) * 100 : null)}</td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums md:table-cell">{signed(profit - previousProfit)}</td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums lg:table-cell">{Math.round(heads)}</td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums lg:table-cell">{heads > 0 ? compact(income / heads) : '—'}</td>
      <td className="hidden 2xl:table-cell" />
      <td />
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════
// Asosiy komponent
// ═══════════════════════════════════════════════════════════

/**
 * Solishtirma: har bir hudud va Markaz — daromad (shu hududda bajarilgan ishlar)
 * va xarajat (shu hudud xodimlari ish haqi + hudud xarajatlari).
 */
export function RegionsCompare({ range }: { range: DateRange }) {
  const [section, setSection] = useState<SectionFilter>('ALL');
  const [compare, setCompare] = useState<CompareMode>('prev');
  const result = useAsync(() => regionsApi.compare(range, section, compare).then((r) => r.data), [range.from, range.to, section, compare]);
  const data = result.data;

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Hududlar va Markaz: daromad va xarajat"
        description={
          data
            ? `${formatDate(data.range.from)} — ${formatDate(data.range.to)} · solishtirish: ${data.compareLabel} (${formatDate(data.previousRange.from)} — ${formatDate(data.previousRange.to)})`
            : 'Har bir hudud qancha daromad keltirgani va qancha xarajat qilgani'
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <CompareToggle value={compare} onChange={setCompare} />
            <SectionToggle value={section} onChange={setSection} />
          </div>
        }
      >
        <p className="text-xs leading-relaxed text-[--color-text-muted]">
          Ma&apos;lumot faqat <b className="text-[--color-text]">Daromadlar</b>, <b className="text-[--color-text]">Xarajatlar</b> va{' '}
          <b className="text-[--color-text]">Xodimlar</b> bo&apos;limlaridan olinadi — o&apos;sha yerda qanday yozilgan bo&apos;lsa, shunday. Daromad — shu hududga yozilgan tushumlar;
          xarajat — shu hududga yozilgan xarajatlar (xodimlar ish haqi, ijara, mashinalar va boshqalar); xodimlar soni — Xodimlar bo&apos;limidan. Markaz bo&apos;limlariniki —
          Markazga, hududi ko&apos;rsatilmagan yozuvlar — alohida qatorda.
        </p>
      </PanelHeader>

      {result.error ? (
        <Card>
          <ErrorState message={result.error} onRetry={result.reload} />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingState label="Hududlar hisoblanmoqda" />
        </Card>
      ) : (
        <Body data={data} loading={result.loading} />
      )}
    </div>
  );
}

function Body({ data, loading }: { data: RegionsResult; loading: boolean }) {
  const [view, setView] = useState<View>('table');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'profit', dir: 'desc' });
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const all = useMemo(() => data.units.map(statsOf), [data]);
  const regions = all.filter((s) => s.unit.kind === 'region');
  const activeRegions = regions.filter((s) => s.income !== 0 || s.expense !== 0);
  const center = all.find((s) => s.unit.kind === 'center') ?? null;
  const unassigned = all.find((s) => s.unit.kind === 'unassigned') ?? null;
  const withCenter = center ? [...activeRegions, center] : activeRegions;

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sign = sort.dir === 'asc' ? 1 : -1;
    return regions
      .filter((s) => !q || s.unit.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const va = sortValue(a, sort.key);
        const vb = sortValue(b, sort.key);
        if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb), 'uz') * sign;
        return (va - vb) * sign;
      });
  }, [regions, query, sort]);
  const byProfit = [...activeRegions].sort((a, b) => b.profit - a.profit);
  const rankOf = new Map(byProfit.map((s, i) => [s.unit.key, i + 1]));

  const onSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));

  // ─────────── Jami ko'rsatkichlar ───────────
  const sum = (list: UnitStats[], pick: (s: UnitStats) => number) => list.reduce((a, s) => a + pick(s), 0);
  const rIncome = sum(regions, (s) => s.income);
  const rExpense = sum(regions, (s) => s.expense);
  const rProfit = rIncome - rExpense;
  const rPrevIncome = sum(regions, (s) => s.previousIncome);
  const rPrevExpense = sum(regions, (s) => s.previousExpense);
  const rPrevProfit = rPrevIncome - rPrevExpense;
  const winners = activeRegions.filter((s) => s.profit > 0).length;
  const prevActive = regions.filter((s) => s.previousIncome !== 0 || s.previousExpense !== 0);
  const prevWinners = prevActive.filter((s) => s.previousProfit > 0).length;
  const centerNet = center ? center.expense - center.income : 0;
  const coverage = centerNet > 0 ? (rProfit / centerNet) * 100 : null;
  const totalIncome = sum(all, (s) => s.income);
  const totalExpense = sum(all, (s) => s.expense);
  const totalPrevProfit = sum(all, (s) => s.previousProfit);
  const heads = sum(regions, (s) => s.unit.headcount);
  const openStats = openKey ? (all.find((s) => s.unit.key === openKey) ?? null) : null;

  const exportCsv = () =>
    downloadCsv(
      `solishtirma-hududlar-${data.range.from}_${data.range.to}`,
      ['Hudud', 'Turi', "Daromad, so'm", "Xarajat, so'm", "shundan ish haqi, so'm", "Foyda, so'm", 'Rentabellik, %', `${data.compareLabel}: foyda, so'm`, "Foyda farqi, so'm", "Xodimlar (o'rtacha)", "Bir xodimga daromad, so'm", 'Zarar oylari (12 oy)'],
      [
        ...[...byProfit, ...regions.filter((s) => s.income === 0 && s.expense === 0), ...(center ? [center] : []), ...(unassigned ? [unassigned] : [])].map((s) => [
          s.unit.name,
          s.unit.kind === 'center' ? 'Markaz' : s.unit.kind === 'unassigned' ? 'Biriktirilmagan' : 'Hudud',
          csvSom(s.income),
          csvSom(s.expense),
          csvSom(s.payroll),
          csvSom(s.profit),
          csvPct(s.margin),
          csvSom(s.previousProfit),
          csvSom(s.profitDelta),
          String(s.unit.headcount).replace('.', ','),
          s.incomePerHead === null ? '' : csvSom(s.incomePerHead),
          s.lossMonths,
        ]),
        ['Jami', '', csvSom(totalIncome), csvSom(totalExpense), csvSom(sum(all, (s) => s.payroll)), csvSom(totalIncome - totalExpense), csvPct(totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : null), csvSom(totalPrevProfit), csvSom(totalIncome - totalExpense - totalPrevProfit), '', '', ''],
        [],
        [`Davr: ${data.range.from} — ${data.range.to}; solishtirish: ${data.compareLabel} (${data.previousRange.from} — ${data.previousRange.to})`],
      ],
    );

  // Markazni qoplash: har hudud foydasining hissasi
  const contributors = byProfit.filter((s) => s.profit > 0).slice(0, 5);
  const months12 = data.months.slice(-12);
  const trendSum = (list: UnitStats[], pick: 'incomeTrend' | 'expenseTrend') =>
    months12.map((_, i) => list.reduce((a, s) => a + Number(s.unit[pick].slice(-12)[i] ?? 0), 0));

  const avgIncomePerHead = heads > 0 ? rIncome / heads : null;
  const avgExpensePerHead = heads > 0 ? rExpense / heads : null;
  const efficiency = activeRegions.filter((s) => s.incomePerHead !== null).sort((a, b) => b.incomePerHead! - a.incomePerHead!);
  const effMax = Math.max(...efficiency.flatMap((s) => [s.incomePerHead ?? 0, s.expensePerHead ?? 0]), 1);
  const movers = [...activeRegions].filter((s) => s.previousIncome !== 0 || s.previousExpense !== 0).sort((a, b) => b.profitDelta - a.profitDelta);
  const improved = movers.filter((s) => s.profitDelta > 0).slice(0, 5);
  const worsened = [...movers].reverse().filter((s) => s.profitDelta < 0).slice(0, 5);

  const views: { value: View; label: string; hint: string }[] = [
    { value: 'table', label: 'Jadval', hint: 'Barcha hududlar va Markaz — raqamlar' },
    { value: 'pairs', label: 'Daromad va xarajat', hint: 'Har hudud uchun ikki chiziq' },
    { value: 'rating', label: 'Foyda reytingi', hint: "Foydadan zararga qarab tartiblangan" },
    { value: 'map', label: 'Hududlar xaritasi', hint: 'Xarajat × daromad; diagonaldan pastda — zarar' },
    { value: 'months', label: 'Oylar kesimi', hint: 'Har hudud oylik foydasi (12 oy)' },
    { value: 'mix', label: 'Xarajat tuzilmasi', hint: 'Ish haqi, ijara, mashinalar, boshqa — 100%' },
  ];

  return (
    <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}>
      <KpiStrip
        items={[
          {
            label: 'Hududlar daromadi',
            value: som(rIncome),
            sub: (
              <>
                <b className={cn('font-medium', toneOf(changePct(rIncome, rPrevIncome), true))}>{pct(changePct(rIncome, rPrevIncome), true)}</b> · avval {compact(rPrevIncome)}
              </>
            ),
          },
          {
            label: 'Hududlar xarajati',
            value: som(rExpense),
            sub: (
              <>
                <b className={cn('font-medium', toneOf(changePct(rExpense, rPrevExpense), false))}>{pct(changePct(rExpense, rPrevExpense), true)}</b> · avval {compact(rPrevExpense)}
              </>
            ),
          },
          {
            label: rProfit >= 0 ? 'Hududlar foydasi' : 'Hududlar zarari',
            value: som(rProfit),
            valueClass: rProfit < 0 ? 'text-[--color-expense]' : undefined,
            sub: (
              <>
                <b className={cn('font-medium', toneOf(rProfit - rPrevProfit === 0 ? null : rProfit - rPrevProfit, true))}>{signed(rProfit - rPrevProfit)}</b> · avval {compact(rPrevProfit)}
              </>
            ),
          },
          {
            label: 'Foydada ishlayotgan hududlar',
            value: `${winners} / ${activeRegions.length}`,
            valueClass: winners < activeRegions.length ? undefined : 'text-[--color-income]',
            sub: `avval ${prevWinners} / ${prevActive.length} · zararda ${activeRegions.length - winners} ta`,
          },
        ]}
      />
      <KpiStrip
        items={[
          {
            label: 'Markaz xarajati',
            value: som(center?.expense ?? 0),
            sub: rIncome > 0 && center ? `hududlar daromadining ${pct((center.expense / rIncome) * 100)} i` : undefined,
          },
          {
            label: 'Markazni qoplash',
            value: coverage === null ? '—' : pct(coverage),
            valueClass: coverage !== null && coverage < 100 ? 'text-[--color-expense]' : coverage !== null ? 'text-[--color-income]' : undefined,
            sub: 'hududlar foydasi ÷ Markaz sof xarajati',
          },
          {
            label: 'Korxona natijasi',
            value: som(totalIncome - totalExpense),
            valueClass: totalIncome - totalExpense < 0 ? 'text-[--color-expense]' : undefined,
            sub: `hududlar + Markaz${unassigned ? ' + biriktirilmagan' : ''} · avval ${compact(totalPrevProfit)}`,
          },
          {
            label: 'Bir xodimga (hududlar)',
            value: avgIncomePerHead === null ? '—' : `${compact(avgIncomePerHead)} daromad`,
            sub: avgExpensePerHead === null ? undefined : `${compact(avgExpensePerHead)} xarajat · ${Math.round(heads)} xodim`,
          },
        ]}
      />

      <Findings notes={data.notes} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold">Hududlar solishtirmasi · {activeRegions.length} ta hudud va Markaz</h3>
            <p className="mt-0.5 text-xs text-[--color-text-muted]">Qatorni yoki grafikdagi hududni bosing — hudud kartasi ochiladi (tarkib, 12 oy, xulosa).</p>
          </div>
          <div className="flex items-center gap-2">
            {view === 'table' && <SearchBox value={query} onChange={setQuery} placeholder="Hudud nomi…" />}
            <SmallButton onClick={exportCsv}>Excel (CSV)</SmallButton>
          </div>
        </div>
        <ViewTabs value={view} options={views} onChange={setView} />

        {view === 'table' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[--color-line] bg-[--color-surface-muted]">
                <tr>
                  <th className={cn(TH, 'w-8 pl-5 text-right')}>#</th>
                  <SortTh label="Hudud" column="name" sort={sort} onSort={onSort} className="text-left" />
                  <SortTh label="Daromad" column="income" sort={sort} onSort={onSort} className="text-right" />
                  <SortTh label="Xarajat" column="expense" sort={sort} onSort={onSort} className="text-right" />
                  <SortTh label="Foyda" column="profit" sort={sort} onSort={onSort} className="text-right" />
                  <SortTh label="Rent." column="margin" sort={sort} onSort={onSort} className="text-right" />
                  <SortTh label="Farq" column="delta" sort={sort} onSort={onSort} className="hidden text-right md:table-cell" />
                  <SortTh label="Xodim" column="headcount" sort={sort} onSort={onSort} className="hidden text-right lg:table-cell" />
                  <SortTh label="Daromad/xodim" column="perHead" sort={sort} onSort={onSort} className="hidden text-right lg:table-cell" />
                  <th className={cn(TH, 'hidden text-left 2xl:table-cell')}>Foyda, 12 oy</th>
                  <th className={cn(TH, 'pr-5 text-right')} title="So'nggi 12 oyda zarar bilan yopilgan oylar / ma'lumoti bor oylar">
                    Zarar oylari
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-line]">
                {sorted.map((s) => (
                  <UnitRow key={s.unit.key} s={s} rank={rankOf.get(s.unit.key) ?? null} onOpen={setOpenKey} section={data.section} />
                ))}
              </tbody>
              <tbody>
                <TotalRow label={`Hududlar jami · ${regions.length} ta`} rows={regions} previousProfit={rPrevProfit} />
              </tbody>
              <tbody className="divide-y divide-[--color-line] border-t border-[--color-line]">
                {center && <UnitRow s={center} rank={null} onOpen={setOpenKey} strong section={data.section} />}
                {unassigned && <UnitRow s={unassigned} rank={null} onOpen={setOpenKey} strong section={data.section} />}
              </tbody>
              <tbody>
                <TotalRow label="Korxona bo'yicha jami" rows={all} previousProfit={totalPrevProfit} />
              </tbody>
            </table>
            <p className="border-t border-[--color-line] px-5 py-2.5 text-xs text-[--color-text-muted]">
              # — foyda bo&apos;yicha o&apos;rin. Farq — foydaning {data.compareLabel}ga nisbatan o&apos;zgarishi. Xodim — Xodimlar bo&apos;limidagi shu hudud xodimlari (davr ichida ishlaganlar).
              Zarar oylari — so&apos;nggi 12 oyda zarar bilan yopilgan oylar.
            </p>
          </div>
        )}
        {view === 'pairs' && (
          <div className="space-y-3 px-5 py-4">
            <Legend items={[{ color: TONE.income, label: 'Daromad' }, { color: EXPENSE_BAR, label: 'Xarajat' }]} />
            <PairedBars rows={[...byProfit, ...(center ? [center] : [])]} onOpen={setOpenKey} />
          </div>
        )}
        {view === 'rating' && (
          <div className="px-5 py-4">
            <ProfitBars rows={byProfit} onOpen={setOpenKey} />
          </div>
        )}
        {view === 'map' && (
          <div className="space-y-2 px-5 py-4">
            <p className="text-xs leading-relaxed text-[--color-text-muted]">
              Har doira — hudud: o&apos;ngga qancha uzoq — xarajat shuncha katta, yuqoriga — daromad katta. Qizil uzuq chiziq — daromad xarajatga teng joy; undan pastdagi
              (pushti zonadagi) hududlar zararda. Doira kattaligi — xodimlar soni. Kulrang — Markaz.
            </p>
            <RegionScatter rows={withCenter} onOpen={setOpenKey} />
          </div>
        )}
        {view === 'months' && (
          <div className="space-y-2 px-5 py-4">
            <p className="text-xs leading-relaxed text-[--color-text-muted]">
              Har katak — hududning o&apos;sha oydagi foydasi (daromad − xarajat). Yashil — foyda, qizil — zarar; rang qancha to&apos;q bo&apos;lsa, summa shuncha katta. B —
              mlrd, M — mln, K — ming so&apos;m.
            </p>
            <ProfitHeatmap months={months12} rows={[...byProfit, ...(center ? [center] : [])]} onOpen={setOpenKey} />
          </div>
        )}
        {view === 'mix' && (
          <div className="space-y-3 px-5 py-4">
            <Legend items={Object.keys(MIX_COLORS).map((k) => ({ color: MIX_COLORS[k]!, label: MIX_LABELS[k]! }))} />
            <ExpenseMix rows={[...byProfit, ...(center ? [center] : [])]} onOpen={setOpenKey} />
          </div>
        )}
      </Card>

      <GroupTitle title="Tahliliy modellar" description={`Solishtirish: ${data.compareLabel}`} />

      <div className="grid gap-4 xl:grid-cols-2">
        <ModelCard
          index={1}
          title="Hududlardan korxona natijasigacha"
          question="Hududlar topgan foyda Markaz xarajatini qoplaydimi?"
          aside={
            <>
              <p className="text-base font-semibold tabular-nums" style={{ color: coverage !== null && coverage >= 100 ? TONE.income : TONE.expense }}>
                {coverage === null ? '—' : pct(coverage)}
              </p>
              <p className="text-[11px] text-[--color-text-muted]">Markazni qoplash</p>
            </>
          }
          howTo="Yuqoridan pastga o'qiladi: hududlarning jami foydasidan Markaz xarajati ayriladi (Markaz daromadi qo'shiladi), keyin hech qaysi hududga biriktirilmagan yozuvlar. Oxirgi qator — korxonaning umumiy natijasi."
        >
          <Bridge
            steps={[
              { label: 'Hududlar foydasi', value: rProfit, total: true, hint: `${activeRegions.length} ta hudud` },
              ...(center && center.income !== 0 ? [{ label: 'Markaz daromadi', value: center.income }] : []),
              ...(center ? [{ label: 'Markaz xarajati', value: -center.expense, hint: `ish haqi ${compact(center.payroll)}` }] : []),
              ...(unassigned && unassigned.income !== 0 ? [{ label: 'Biriktirilmagan daromad', value: unassigned.income }] : []),
              ...(unassigned && unassigned.expense !== 0 ? [{ label: 'Biriktirilmagan xarajat', value: -unassigned.expense }] : []),
              { label: 'Korxona natijasi', value: totalIncome - totalExpense, total: true },
            ]}
          />
          {contributors.length > 0 && rProfit > 0 && (
            <div className="mt-4 border-t border-[--color-line] pt-3">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">Markazni eng ko&apos;p ta&apos;minlayotgan hududlar</h4>
              <ul className="space-y-1.5 text-sm">
                {contributors.map((s) => (
                  <li key={s.unit.key} className="flex items-center justify-between gap-3">
                    <button type="button" className="truncate text-left hover:underline" onClick={() => setOpenKey(s.unit.key)}>
                      {s.unit.name}
                    </button>
                    <span className="whitespace-nowrap tabular-nums text-[--color-text-muted]">
                      {compact(s.profit)} · <b className="font-medium text-[--color-text]">{pct((s.profit / Math.max(rProfit, 1)) * 100)}</b> hududlar foydasining
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ModelCard>

        <ModelCard
          index={2}
          title="Natijasi o'zgargan hududlar"
          question={`${data.compareLabel[0]!.toUpperCase() + data.compareLabel.slice(1)}ga nisbatan kim yaxshilandi, kim yomonlashdi?`}
          howTo="Farq — hudud foydasining (daromad − xarajat) avvalgi davrdagi foydaga nisbatan o'zgarishi, so'mda. Hududni bosing — kartasi ochiladi."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            {[
              { title: 'Yaxshilanganlar', list: improved },
              { title: 'Yomonlashganlar', list: worsened },
            ].map((group) => {
              const max = Math.max(...movers.map((s) => Math.abs(s.profitDelta)), 1);
              return (
                <div key={group.title}>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">{group.title}</h4>
                  {group.list.length === 0 ? (
                    <p className="py-3 text-sm text-[--color-text-faint]">Yo&apos;q</p>
                  ) : (
                    <ul className="divide-y divide-[--color-line]">
                      {group.list.map((s) => (
                        <li key={s.unit.key}>
                          <button type="button" onClick={() => setOpenKey(s.unit.key)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 py-2 text-left text-sm hover:bg-[--color-surface-muted]">
                            <span className="min-w-0">
                              <span className="block truncate">{s.unit.name}</span>
                              <span className="mt-1 block h-1 bg-[--color-surface-sunken]">
                                <span className="block h-full" style={{ width: `${(Math.abs(s.profitDelta) / max) * 100}%`, background: s.profitDelta >= 0 ? TONE.income : TONE.expense }} />
                              </span>
                            </span>
                            <span className="text-right">
                              <span className="block font-medium tabular-nums" style={{ color: s.profitDelta >= 0 ? TONE.income : TONE.expense }}>
                                {signed(s.profitDelta)}
                              </span>
                              <span className="block text-xs tabular-nums text-[--color-text-muted]">
                                {compact(s.previousProfit)} → {compact(s.profit)}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </ModelCard>

        <ModelCard
          index={3}
          title="Samaradorlik: bir xodimga daromad va xarajat"
          question="Qaysi hududda bitta xodim ko'proq daromad keltiradi?"
          aside={
            <>
              <p className="text-base font-semibold tabular-nums">{avgIncomePerHead === null ? '—' : compact(avgIncomePerHead)}</p>
              <p className="text-[11px] text-[--color-text-muted]">o&apos;rtacha daromad/xodim</p>
            </>
          }
          howTo="Yashil — bir xodimga to'g'ri keladigan daromad, qizg'ish — bir xodimga xarajat (ish haqi va hudud xarajatlari). Yashil qizg'ishdan uzun bo'lsa, hudud foydada. Vertikal chiziq — hududlar o'rtachasi."
        >
          <div className="space-y-2.5">
            {efficiency.map((s) => (
              <button key={s.unit.key} type="button" onClick={() => setOpenKey(s.unit.key)} className="grid w-full grid-cols-[minmax(7rem,10rem)_1fr_5.5rem] items-center gap-x-3 text-left text-sm hover:bg-[--color-surface-muted]">
                <span className="truncate" title={s.unit.name}>{s.unit.name}</span>
                <span className="relative block space-y-0.5 py-0.5">
                  {avgIncomePerHead !== null && <span className="absolute inset-y-0 w-px bg-[--color-text]" style={{ left: `${(avgIncomePerHead / effMax) * 100}%` }} />}
                  <span className="block h-2" style={{ width: `${((s.incomePerHead ?? 0) / effMax) * 100}%`, background: TONE.income }} />
                  <span className="block h-2" style={{ width: `${((s.expensePerHead ?? 0) / effMax) * 100}%`, background: EXPENSE_BAR }} />
                </span>
                <span className="text-right text-xs tabular-nums">
                  {compact(s.incomePerHead ?? 0)}
                  <span className="block text-[--color-text-muted]">{compact(s.expensePerHead ?? 0)}</span>
                </span>
              </button>
            ))}
          </div>
        </ModelCard>

        <ModelCard
          index={4}
          title="12 oylik dinamika: hududlar va Markaz"
          question="Hududlar daromadi, xarajati va Markaz xarajati oyma-oy qanday o'zgarmoqda?"
          howTo="Yashil — hududlar jami daromadi, qizg'ish — hududlar jami xarajati, kulrang — Markaz xarajati. Yashil va qizg'ish orasidagi masofa — hududlar foydasi; u kulrang chiziqdan katta bo'lsa, o'sha oy hududlar Markazni to'liq qoplagan."
        >
          <LineChart
            width={600}
            height={280}
            labels={months12.map((m) => formatPeriodShort(m).split(' ')[0]!)}
            tooltipLabels={months12.map((m) => formatPeriod(m))}
            series={[
              { label: 'Hududlar daromadi', color: TONE.income, values: trendSum(activeRegions, 'incomeTrend') },
              { label: 'Hududlar xarajati', color: EXPENSE_BAR, values: trendSum(activeRegions, 'expenseTrend') },
              ...(center ? [{ label: 'Markaz xarajati', color: TONE.slate, values: trendSum([center], 'expenseTrend'), dashed: true }] : []),
            ]}
          />
          <div className="mt-2">
            <Legend
              items={[
                { color: TONE.income, label: 'Hududlar daromadi', line: true },
                { color: EXPENSE_BAR, label: 'Hududlar xarajati', line: true },
                ...(center ? [{ color: TONE.slate, label: 'Markaz xarajati', line: true }] : []),
              ]}
            />
          </div>
        </ModelCard>
      </div>


      <RegionCard data={data} stats={openStats} regions={activeRegions} onClose={() => setOpenKey(null)} />
    </div>
  );
}