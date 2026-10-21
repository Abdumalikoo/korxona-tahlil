'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { IconChevronRight } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import { change, csvSom, downloadCsv, exploreApi, monthLabel, pct, pctSigned, SERIES, share, short, som, type PnlRow, type ResultExplore, type UnitRow, type XNode } from './api';
import { ChartCard, StackedMonths, type Series } from './charts';
import { DrillProvider, useDrill } from './drill';
import { Chg } from './drill-table';
import { Kpi, SectionTitle, SpansNote } from './parts';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa › Tahlil › Natija jadvali:
//  ko'rsatkichlar → foyda va zarar hisoboti (oylar kesimida) → Markaz va hududlar natijasi → grafiklar.
// ═══════════════════════════════════════════════════════════

export function ResultExplorer({ range }: { range: DateRange }) {
  const res = useAsync(() => exploreApi.result(range.from, range.to).then((r) => r.data), [range.from, range.to]);
  if (res.loading && !res.data) return <LoadingState />;
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  const d = res.data!;
  const t = d.totals;
  const resultSeries: Series[] = [
    { key: 'income', label: 'Daromad', color: SERIES[0]!, values: d.pnl.income.values, kind: 'income', f: {} },
  ];
  const expenseSeries: Series[] = [{ key: 'expense', label: 'Xarajat', color: SERIES[1]!, values: d.pnl.expense.values, kind: 'expense', f: {} }];
  return (
    <DrillProvider range={range}>
      <div className="space-y-4">
        <SpansNote cur={d.cur} prev={d.prev} ly={d.ly} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Daromad" cur={t.income.cur} prev={t.income.prev} ly={t.income.ly} kind="income" drill={{ kind: 'income', f: {}, title: 'Daromad › Jami' }} sub={`${t.income.count.toLocaleString('uz')} ta yozuv`} />
          <Kpi label="Xarajat" cur={t.expense.cur} prev={t.expense.prev} ly={t.expense.ly} kind="expense" drill={{ kind: 'expense', f: {}, title: 'Xarajat › Jami' }} sub={`${t.expense.count.toLocaleString('uz')} ta yozuv`} />
          <Kpi label="Natija (foyda / zarar)" cur={t.result.cur} prev={t.result.prev} ly={t.result.ly} kind="result" tone="auto" sub={`Daromad − xarajat`} />
          <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4 shadow-card">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Rentabellik</p>
            <p className={cn('money mt-1.5 text-xl font-semibold', (t.margin ?? 0) < 0 ? 'text-(--color-expense)' : 'text-heading')}>{pct(t.margin)}</p>
            <div className="mt-1.5 space-y-0.5 text-xs text-(--color-text-muted)">
              <p className="flex justify-between gap-2">
                <span>O&apos;tgan davr</span>
                <span className="money">{pct(t.marginPrev)}</span>
              </p>
              <p className="flex justify-between gap-2">
                <span>O&apos;tgan yil</span>
                <span className="money">{pct(t.marginLy)}</span>
              </p>
              <p className="flex justify-between gap-2">
                <span>Debitorlik / kreditorlik</span>
                <span className="money">
                  {short(t.receivable)} / {short(t.payable)}
                </span>
              </p>
            </div>
          </div>
        </div>

        <SectionTitle hint="Daromad ▸ Markaz / Hududlar ▸ moddalar; Xarajat ▸ guruhlar ▸ moddalar">Foyda va zarar hisoboti</SectionTitle>
        <PnlTable d={d} />

        <SectionTitle hint="▸ bosilsa — eng katta daromad va xarajat moddalari">Markaz va hududlar natijasi</SectionTitle>
        <UnitsTable units={d.units} totals={d.totals} />

        <SectionTitle hint="Jadvallar bilan bir xil ma'lumot; ustun bosilsa — o'sha oy yozuvlari">Grafiklar</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Oylar bo'yicha daromad">
            <StackedMonths months={d.monthList} series={resultSeries} root="Daromad" />
          </ChartCard>
          <ChartCard title="Oylar bo'yicha xarajat">
            <StackedMonths months={d.monthList} series={expenseSeries} root="Xarajat" />
          </ChartCard>
          <ChartCard title="Oylar bo'yicha natija" description="Yashil — foyda, qizil — zarar">
            <ResultBars months={d.monthList} values={d.pnl.result.values} />
          </ChartCard>
        </div>
      </div>
    </DrillProvider>
  );
}

// ───────────────────────── Foyda va zarar ─────────────────────────

function PnlTable({ d }: { d: ResultExplore }) {
  const { open } = useDrill();
  const [opened, setOpened] = useState<Set<string>>(new Set(['income', 'expense']));
  const months = d.monthList;
  const toggle = (k: string) => setOpened((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const rowOf = (r: PnlRow, depth: number, path: string[], id: string, cls?: string, up = true): ReactNode[] => {
    const has = Boolean(r.children?.length);
    const isOpen = opened.has(id);
    const drill = (month?: string, which: 'cur' | 'prev' | 'ly' = 'cur', expected?: number) =>
      r.kind && r.f ? open({ kind: r.kind, f: month ? { ...r.f, month } : r.f, which, title: [...path, r.label, ...(month ? [formatPeriod(month)] : [])].join(' › '), expected }) : undefined;
    const money = (v: number, onClick?: () => void, strong?: boolean) => (
      <td className={cn('px-2 py-1.5 text-right whitespace-nowrap', strong && 'font-semibold')}>
        {v && r.kind ? (
          <button type="button" onClick={onClick} className="money rounded px-1 -mx-1 hover:bg-brand-50 hover:text-brand-700 hover:underline" title={`${som(v)} so'm — yozuvlar`}>
            {som(v)}
          </button>
        ) : (
          <span className={cn('money', !v && 'text-(--color-text-faint)', !r.kind && v < 0 && 'text-(--color-expense)')}>{v ? som(v) : '—'}</span>
        )}
      </td>
    );
    const out: ReactNode[] = [
      <tr key={id} className={cn('border-t border-(--color-line)', cls, depth === 1 && 'bg-(--color-surface-muted)/40', depth >= 2 && 'bg-(--color-surface-muted)/70')}>
        <td className="sticky left-0 z-10 bg-inherit py-1.5 pr-2" style={{ paddingLeft: 10 + depth * 18 }}>
          <div className="flex min-w-0 items-center gap-1">
            {has ? (
              <button type="button" onClick={() => toggle(id)} className="flex size-5 shrink-0 items-center justify-center rounded text-(--color-text-muted) hover:bg-brand-50" aria-expanded={isOpen}>
                <IconChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
              </button>
            ) : (
              <span className="size-5 shrink-0" />
            )}
            <span className={cn('truncate', depth === 0 ? 'font-semibold text-heading' : 'text-heading')} title={r.label}>
              {r.label}
            </span>
          </div>
        </td>
        {months.map((m, i) => (
          <MoneyCell key={m} v={r.values[i] ?? 0} click={r.kind ? () => drill(m, 'cur', r.values[i]) : undefined} strong={depth === 0} signed={!r.kind} />
        ))}
        {money(r.total, () => drill(undefined, 'cur', r.total), true)}
        {money(r.prev, () => drill(undefined, 'prev', r.prev))}
        <Chg v={change(r.total, r.prev)} diff={r.total - r.prev} up={up} />
        {money(r.ly, () => drill(undefined, 'ly', r.ly))}
        <Chg v={change(r.total, r.ly)} diff={r.total - r.ly} up={up} />
      </tr>,
    ];
    if (has && isOpen) r.children!.forEach((c) => out.push(...rowOf(c, depth + 1, [...path, r.label], `${id}/${c.key}`, undefined, up)));
    return out;
  };

  const marginRow = (
    <tr className="border-t border-(--color-line) bg-(--color-surface-muted) text-(--color-text-muted)">
      <td className="sticky left-0 z-10 bg-inherit py-1.5 pr-2 pl-[34px] font-medium">Rentabellik (natija / daromad)</td>
      {d.pnl.margin.values.map((v, i) => (
        <td key={i} className={cn('money px-2 py-1.5 text-right', (v ?? 0) < 0 && 'text-(--color-expense)')}>
          {pct(v)}
        </td>
      ))}
      <td className="money px-2 py-1.5 text-right font-semibold text-heading">{pct(d.pnl.margin.total)}</td>
      <td className="money px-2 py-1.5 text-right">{pct(d.pnl.margin.prev)}</td>
      <td className="money px-2 py-1.5 text-right text-xs">{d.pnl.margin.total !== null && d.pnl.margin.prev !== null ? `${pctSigned(d.pnl.margin.total - d.pnl.margin.prev).replace('%', ' p.p.')}` : '—'}</td>
      <td className="money px-2 py-1.5 text-right">{pct(d.pnl.margin.ly)}</td>
      <td className="money px-2 py-1.5 text-right text-xs">{d.pnl.margin.total !== null && d.pnl.margin.ly !== null ? `${pctSigned(d.pnl.margin.total - d.pnl.margin.ly).replace('%', ' p.p.')}` : '—'}</td>
    </tr>
  );

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [['Ko‘rsatkich', ...months.map(formatPeriod), "Jami (so'm)", "O'tgan davr (so'm)", "O'tgan yil (so'm)"]];
    const add = (r: PnlRow, depth: number) => {
      rows.push([`${'   '.repeat(depth)}${r.label}`, ...r.values.map(csvSom), csvSom(r.total), csvSom(r.prev), csvSom(r.ly)]);
      r.children?.forEach((c) => add(c, depth + 1));
    };
    add(d.pnl.income, 0);
    add(d.pnl.expense, 0);
    add(d.pnl.result, 0);
    rows.push(['Rentabellik, %', ...d.pnl.margin.values.map((v) => (v === null ? null : Math.round(v * 1000) / 10)), d.pnl.margin.total === null ? null : Math.round(d.pnl.margin.total * 1000) / 10, d.pnl.margin.prev === null ? null : Math.round(d.pnl.margin.prev * 1000) / 10, d.pnl.margin.ly === null ? null : Math.round(d.pnl.margin.ly * 1000) / 10]);
    downloadCsv('Foyda va zarar hisoboti', rows);
  };

  return (
    <section className="overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white shadow-card">
      <header className="flex flex-wrap items-start gap-3 border-b border-(--color-line) px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-heading">Daromad, xarajat va natija — oylar bo&apos;yicha</h2>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">Har bir summa bosiladi: o&apos;sha oy / davr yozuvlari ochiladi</p>
        </div>
        <button type="button" onClick={exportCsv} className="h-8 rounded-(--radius-control) border border-(--color-line) px-2.5 text-xs font-medium text-heading hover:bg-brand-50">
          Excel
        </button>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 300 + months.length * 120 + 560 }}>
          <thead className="bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
            <tr>
              <th className="sticky left-0 z-10 min-w-64 bg-(--color-surface-muted) px-3 py-2 text-left font-semibold">Ko&apos;rsatkich</th>
              {months.map((m) => (
                <th key={m} className="px-2 py-2 text-right font-semibold whitespace-nowrap">
                  {monthLabel(m)}
                </th>
              ))}
              <th className="px-2 py-2 text-right font-semibold">Jami</th>
              <th className="px-2 py-2 text-right font-semibold">O&apos;tgan davr</th>
              <th className="w-24 px-2 py-2 text-right font-semibold">O&apos;zgarish</th>
              <th className="px-2 py-2 text-right font-semibold">O&apos;tgan yil</th>
              <th className="w-24 px-2 py-2 text-right font-semibold">O&apos;zgarish</th>
            </tr>
          </thead>
          <tbody className="[&>tr]:bg-white">
            {rowOf(d.pnl.income, 0, [], 'income', 'text-(--color-income)')}
            {rowOf(d.pnl.expense, 0, [], 'expense', 'border-t-2 border-(--color-line-strong)', false)}
            {rowOf(d.pnl.result, 0, [], 'result', 'border-t-2 border-(--color-line-strong) bg-brand-50/50!')}
            {marginRow}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MoneyCell({ v, click, strong, signed }: { v: number; click?: () => void; strong?: boolean; signed?: boolean }) {
  return (
    <td className={cn('px-2 py-1.5 text-right whitespace-nowrap', strong && 'font-medium')}>
      {v && click ? (
        <button type="button" onClick={click} className="money rounded px-1 -mx-1 text-heading hover:bg-brand-50 hover:text-brand-700 hover:underline" title={`${som(v)} so'm — yozuvlar`}>
          {som(v)}
        </button>
      ) : (
        <span className={cn('money', !v ? 'text-(--color-text-faint)' : signed && v < 0 ? 'text-(--color-expense)' : signed ? 'text-(--color-income)' : 'text-heading')}>{v ? som(v) : '—'}</span>
      )}
    </td>
  );
}

// ───────────────────────── Birliklar ─────────────────────────

function UnitsTable({ units, totals }: { units: UnitRow[]; totals: ResultExplore['totals'] }) {
  const { open } = useDrill();
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<'order' | 'result' | 'margin'>('order');
  const list = [...units].sort((a, b) => (sort === 'result' ? b.result.cur - a.result.cur : sort === 'margin' ? (b.margin ?? -9) - (a.margin ?? -9) : 0));
  const filterOf = (u: UnitRow) => ({ unit: u.key });

  const exportCsv = () =>
    downloadCsv('Markaz va hududlar natijasi', [
      ['Birlik', "Daromad (so'm)", "Xarajat (so'm)", "Natija (so'm)", 'Rentabellik, %', "O'tgan davr natija (so'm)", "O'tgan yil natija (so'm)", 'Daromad ulushi, %'],
      ...list.map((u) => [u.label, csvSom(u.income.cur), csvSom(u.expense.cur), csvSom(u.result.cur), u.margin === null ? null : Math.round(u.margin * 1000) / 10, csvSom(u.result.prev), csvSom(u.result.ly), totals.income.cur ? Math.round((u.income.cur / totals.income.cur) * 1000) / 10 : null]),
    ]);

  const sub = (u: UnitRow, title: string, nodes: XNode[], total: number) => (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">{title}</p>
      {nodes.length ? (
        <table className="w-full text-xs">
          <tbody>
            {nodes.map((n) => (
              <tr key={n.key} className="border-t border-(--color-line)/70">
                <td className="py-1 pr-2">
                  <button type="button" onClick={() => open({ kind: n.kind, f: n.f, title: [n.kind === 'income' ? 'Daromad' : 'Xarajat', u.label, n.label].join(' › '), expected: n.cur })} className="text-left text-heading hover:text-brand-700 hover:underline">
                    {n.label}
                  </button>
                </td>
                <td className="money w-28 py-1 text-right text-heading">{som(n.cur)}</td>
                <td className="money w-14 py-1 text-right text-(--color-text-muted)">{pct(share(n.cur, total))}</td>
                <td className="money w-16 py-1 text-right text-(--color-text-faint)">{pctSigned(change(n.cur, n.prev))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-(--color-text-faint)">Yo&apos;q</p>
      )}
    </div>
  );

  return (
    <section className="overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white shadow-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-heading">Har bir birlik: daromad, xarajat, natija</h2>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">Daromad yoki xarajat summasi bosilsa — o&apos;sha birlik yozuvlari</p>
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-8 rounded-(--radius-control) border border-(--color-line) bg-white px-2 text-xs" aria-label="Tartib">
          <option value="order">Markaz, so&apos;ng hududlar</option>
          <option value="result">Natija bo&apos;yicha</option>
          <option value="margin">Rentabellik bo&apos;yicha</option>
        </select>
        <button type="button" onClick={exportCsv} className="h-8 rounded-(--radius-control) border border-(--color-line) px-2.5 text-xs font-medium text-heading hover:bg-brand-50">
          Excel
        </button>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Birlik</th>
              <th className="w-36 px-2 py-2 text-right font-semibold">Daromad</th>
              <th className="w-20 px-2 py-2 text-right font-semibold">Ulushi</th>
              <th className="w-36 px-2 py-2 text-right font-semibold">Xarajat</th>
              <th className="w-36 px-2 py-2 text-right font-semibold">Natija</th>
              <th className="w-24 px-2 py-2 text-right font-semibold">Rentabellik</th>
              <th className="w-32 px-2 py-2 text-right font-semibold">O&apos;tgan davr natija</th>
              <th className="w-24 px-2 py-2 text-right font-semibold">O&apos;zgarish</th>
              <th className="w-32 px-2 py-2 text-right font-semibold">O&apos;tgan yil natija</th>
            </tr>
          </thead>
          <tbody>
            {list.flatMap((u) => {
              const isOpen = opened.has(u.key);
              const rows: ReactNode[] = [
                <tr key={u.key} className={cn('border-t border-(--color-line)', u.key === 'center' && 'bg-brand-50/30')}>
                  <td className="py-1.5 pr-2 pl-2.5">
                    <button
                      type="button"
                      onClick={() => setOpened((s) => { const n = new Set(s); if (n.has(u.key)) n.delete(u.key); else n.add(u.key); return n; })}
                      className="flex items-center gap-1.5 text-left font-medium text-heading hover:text-brand-700"
                      aria-expanded={isOpen}
                    >
                      <IconChevronRight className={cn('size-3.5 text-(--color-text-muted) transition-transform', isOpen && 'rotate-90')} />
                      {u.label}
                    </button>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button type="button" disabled={!u.income.cur} onClick={() => open({ kind: 'income', f: filterOf(u), title: `Daromad › ${u.label}`, expected: u.income.cur })} className="money text-heading hover:text-brand-700 hover:underline disabled:text-(--color-text-faint) disabled:no-underline">
                      {u.income.cur ? som(u.income.cur) : '—'}
                    </button>
                  </td>
                  <td className="money px-2 py-1.5 text-right text-xs text-(--color-text-muted)">{pct(share(u.income.cur, totals.income.cur))}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button type="button" disabled={!u.expense.cur} onClick={() => open({ kind: 'expense', f: filterOf(u), title: `Xarajat › ${u.label}`, expected: u.expense.cur })} className="money text-heading hover:text-brand-700 hover:underline disabled:text-(--color-text-faint) disabled:no-underline">
                      {u.expense.cur ? som(u.expense.cur) : '—'}
                    </button>
                  </td>
                  <td className={cn('money px-2 py-1.5 text-right font-semibold', u.result.cur < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{som(u.result.cur)}</td>
                  <td className={cn('money px-2 py-1.5 text-right', (u.margin ?? 0) < 0 && 'text-(--color-expense)')}>{pct(u.margin)}</td>
                  <td className="money px-2 py-1.5 text-right text-(--color-text-muted)">{som(u.result.prev)}</td>
                  <Chg v={change(u.result.cur, u.result.prev)} diff={u.result.cur - u.result.prev} up />
                  <td className="money px-2 py-1.5 text-right text-(--color-text-muted)">{som(u.result.ly)}</td>
                </tr>,
              ];
              if (isOpen)
                rows.push(
                  <tr key={`${u.key}-x`} className="bg-(--color-surface-muted)/50">
                    <td colSpan={9} className="px-6 py-3">
                      <div className="flex flex-col gap-6 lg:flex-row">
                        {sub(u, 'Eng katta daromad moddalari', u.incomeTop, u.income.cur)}
                        {sub(u, 'Eng katta xarajat guruhlari', u.expenseTop, u.expense.cur)}
                      </div>
                    </td>
                  </tr>,
                );
              return rows;
            })}
          </tbody>
          <tfoot className="border-t-2 border-(--color-line-strong) bg-(--color-surface-muted) font-semibold text-heading">
            <tr>
              <td className="px-3 py-2">Jami</td>
              <td className="money px-2 py-2 text-right">{som(totals.income.cur)}</td>
              <td className="money px-2 py-2 text-right text-xs">100%</td>
              <td className="money px-2 py-2 text-right">{som(totals.expense.cur)}</td>
              <td className={cn('money px-2 py-2 text-right', totals.result.cur < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{som(totals.result.cur)}</td>
              <td className="money px-2 py-2 text-right">{pct(totals.margin)}</td>
              <td className="money px-2 py-2 text-right">{som(totals.result.prev)}</td>
              <Chg v={change(totals.result.cur, totals.result.prev)} diff={totals.result.cur - totals.result.prev} up />
              <td className="money px-2 py-2 text-right">{som(totals.result.ly)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">
        Birlik qoidasi Solishtirma bilan bir xil: hudud kodi bo&apos;lsa — o&apos;sha hudud; hudud yo&apos;q, bo&apos;lim bor — Markaz. Markaz xarajatlari hududlarga taqsimlanmagan (taqsimlangan ko&apos;rinish — Solishtirma bo&apos;limida).
      </p>
    </section>
  );
}

/** Natija: musbat — yuqoriga (yashil), manfiy — pastga (qizil) */
function ResultBars({ months, values }: { months: string[]; values: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...values.map(Math.abs), 0);
  if (!max) return <p className="py-10 text-center text-sm text-(--color-text-muted)">Bu davrda ma&apos;lumot yo&apos;q</p>;
  const H = 110;
  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <div className="relative flex gap-[2px]" style={{ height: H * 2 }}>
        <div className="absolute inset-x-0 border-t border-(--color-line-strong)" style={{ top: H }} />
        {months.map((m, i) => {
          const v = values[i] ?? 0;
          const h = Math.max(v ? 2 : 0, (Math.abs(v) / max) * (H - 4));
          return (
            <div key={m} className={cn('relative flex-1 rounded-sm', hover === i && 'bg-brand-50/60')} onMouseEnter={() => setHover(i)}>
              <div className="absolute inset-x-[15%]" style={v >= 0 ? { bottom: H, height: h, background: 'var(--color-income)', borderRadius: '4px 4px 0 0' } : { top: H, height: h, background: 'var(--color-expense)', borderRadius: '0 0 4px 4px' }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[2px]">
        {months.map((m) => (
          <span key={m} className="flex-1 truncate text-center text-[10px] text-(--color-text-muted)">
            {monthLabel(m)}
          </span>
        ))}
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute top-0 z-20 rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 py-1.5 text-xs shadow-lg" style={{ left: `clamp(0px, calc(${((hover + 0.5) / months.length) * 100}% - 5rem), calc(100% - 10rem))` }}>
          <p className="font-semibold text-heading">{formatPeriod(months[hover]!)}</p>
          <p className={cn('money', (values[hover] ?? 0) < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{som(values[hover] ?? 0)} so&apos;m</p>
        </div>
      )}
    </div>
  );
}