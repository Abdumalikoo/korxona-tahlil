'use client';

import { Card } from '@/components/ui/card';
import { compact, num, pct, TONE } from '@/features/structure/api';
import { Segmented, SmallButton } from '@/features/structure/parts';
import { csvPct, csvSom, downloadCsv } from '@/features/structure/stats';
import { formatPeriod, formatPeriodShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import { KIND_ORDER, type UnitPart, type UnitStats } from './api';
import type { CoverResult } from './center-cover';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Umumiy — aniq jadvallar (grafiklar sahifa oxirida):
//   • UnitDetail       — umumiy jadvalda qator ochilsa: daromad va xarajat tarkibi (joriy / o'tgan / o'zgarish / ulush)
//   • CompareTable     — har bir birlik: daromad, xarajat, natija, rentabellik, xodimlar — joriy va o'tgan davr
//   • MonthsTable      — birliklar × oylar: daromad / xarajat / natija
//   • CoverTable       — Markazni qoplash: har bir hudud qancha beradi, qancha qoladi
// Hamma summalar to'liq (so'm) — «qisqa» tugmasi bilan mln/mlrd ko'rinishiga o'tadi.
// ═══════════════════════════════════════════════════════════

const TH = 'px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-(--color-text-muted) whitespace-nowrap';

export type Fmt = 'full' | 'short';

export function money(tiyin: number, fmt: Fmt): string {
  if (Math.round(tiyin / 100) === 0) return '—';
  return fmt === 'full' ? num(tiyin) : compact(tiyin);
}

function change(cur: number, prev: number): number | null {
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** O'zgarish: % va summa farqi; up — o'sish yaxshimi */
function Delta({ cur, prev, up = true, className }: { cur: number; prev: number; up?: boolean; className?: string }) {
  const c = change(cur, prev);
  const diff = cur - prev;
  const good = c === null || Math.abs(c) < 0.05 ? null : c > 0 === up;
  return (
    <td className={cn('px-2.5 py-2 text-right tabular-nums', className)}>
      <span className={cn('block text-xs font-semibold', good === null ? 'text-(--color-text-faint)' : good ? 'text-(--color-income)' : 'text-(--color-expense)')}>
        {c === null ? (Math.round(diff / 100) ? 'yangi' : '—') : pct(c, true)}
      </span>
      {Math.round(diff / 100) !== 0 && <span className="block text-[10.5px] text-(--color-text-faint)">{`${diff > 0 ? '+' : '−'}${compact(Math.abs(diff))}`}</span>}
    </td>
  );
}

export function FmtToggle({ value, onChange }: { value: Fmt; onChange: (v: Fmt) => void }) {
  return (
    <Segmented
      size="sm"
      value={value}
      onChange={onChange}
      options={[
        { value: 'full', label: "To'liq summa" },
        { value: 'short', label: 'Qisqa (mln)' },
      ]}
    />
  );
}

function Head({ title, hint, children }: { title: string; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-heading">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-(--color-text-muted)">{hint}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const kindOrder = (s: UnitStats) => KIND_ORDER[s.unit.kind];

// ───────────────────────── Qator ichi: tarkib ─────────────────────────

function PartsTable({ title, parts, total, up, fmt }: { title: string; parts: UnitPart[]; total: number; up: boolean; fmt: Fmt }) {
  const list = [...parts].filter((p) => Number(p.amountTiyin) !== 0 || Number(p.previousTiyin) !== 0).sort((a, b) => Number(b.amountTiyin) - Number(a.amountTiyin));
  const prevTotal = list.reduce((a, p) => a + Number(p.previousTiyin), 0);
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">{title}</p>
      {list.length ? (
        <table className="w-full text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-(--color-text-faint)">
            <tr>
              <th className="py-1 text-left font-semibold">Modda</th>
              <th className="py-1 text-right font-semibold">Joriy</th>
              <th className="py-1 text-right font-semibold">Ulush</th>
              <th className="py-1 text-right font-semibold">O&apos;tgan</th>
              <th className="py-1 text-right font-semibold">O&apos;zgarish</th>
            </tr>
          </thead>
          <tbody>
            {list.map((p) => {
              const v = Number(p.amountTiyin);
              const pv = Number(p.previousTiyin);
              return (
                <tr key={p.key} className="border-t border-(--color-line)/70">
                  <td className="max-w-[16rem] truncate py-1 pr-2 text-heading" title={p.label}>
                    {p.label}
                  </td>
                  <td className="py-1 pl-2 text-right font-medium tabular-nums text-heading">{money(v, fmt)}</td>
                  <td className="py-1 pl-2 text-right tabular-nums text-(--color-text-muted)">{pct(total ? (v / total) * 100 : null)}</td>
                  <td className="py-1 pl-2 text-right tabular-nums text-(--color-text-muted)">{money(pv, fmt)}</td>
                  <Delta cur={v} prev={pv} up={up} className="py-1 pl-2 pr-0" />
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-(--color-line) font-semibold text-heading">
              <td className="py-1">Jami</td>
              <td className="py-1 text-right tabular-nums">{money(total, fmt)}</td>
              <td className="py-1 text-right tabular-nums">100%</td>
              <td className="py-1 text-right tabular-nums">{money(prevTotal, fmt)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      ) : (
        <p className="text-xs text-(--color-text-faint)">Tarkib yo&apos;q</p>
      )}
    </div>
  );
}

/** Umumiy jadvalda qator ochilganda — o'sha birlikning daromad va xarajat tarkibi */
export function UnitDetail({ s, fmt, onOpen }: { s: UnitStats; fmt: Fmt; onOpen: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-6 xl:flex-row">
        <PartsTable title="Daromad tarkibi" parts={s.unit.incomeParts} total={s.income} up fmt={fmt} />
        <PartsTable title="Xarajat tarkibi" parts={s.unit.expenseParts} total={s.expense} up={false} fmt={fmt} />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-(--color-text-muted)">
        <span>
          Yozuvlar: daromad <b className="text-heading">{s.unit.incomeCount}</b> ta, xarajat <b className="text-heading">{s.unit.expenseCount}</b> ta
        </span>
        {s.unit.headcount > 0 && (
          <span>
            Xodim boshiga: daromad <b className="text-heading">{compact(s.incomePerHead ?? 0)}</b>, xarajat <b className="text-heading">{compact(s.expensePerHead ?? 0)}</b>
          </span>
        )}
        {s.activeMonths > 0 && (
          <span>
            Oxirgi 12 oyda zararli oylar: <b className={s.lossMonths ? 'text-(--color-expense)' : 'text-heading'}>{s.lossMonths}</b> / {s.activeMonths}
          </span>
        )}
        <button type="button" onClick={onOpen} className="ml-auto font-semibold text-brand-700 hover:underline">
          {s.unit.kind === 'center' ? 'Markaz sahifasini ochish ›' : s.unit.kind === 'unassigned' ? "Biriktirilmagan yozuvlarni ko'rish ›" : s.unit.kind === 'segment' ? "Solishtirmada ko'rish ›" : 'Hudud sahifasini ochish ›'}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── Taqqoslash jadvali ─────────────────────────

export function CompareTable({ units, compareLabel, onOpen }: { units: UnitStats[]; compareLabel: string; onOpen: (s: UnitStats) => void }) {
  const [fmt, setFmt] = useState<Fmt>('full');
  const list = [...units].sort((a, b) => kindOrder(a) - kindOrder(b) || b.profit - a.profit);
  const regions = list.filter((s) => s.unit.kind === 'region');
  type Tot = { income: number; previousIncome: number; expense: number; previousExpense: number; headcount: number; previousHeadcount: number };
  const tot = (rows: UnitStats[]): Tot =>
    rows.reduce((a, s) => ({ income: a.income + s.income, previousIncome: a.previousIncome + s.previousIncome, expense: a.expense + s.expense, previousExpense: a.previousExpense + s.previousExpense, headcount: a.headcount + s.unit.headcount, previousHeadcount: a.previousHeadcount + s.unit.previousHeadcount }), {
      income: 0,
      previousIncome: 0,
      expense: 0,
      previousExpense: 0,
      headcount: 0,
      previousHeadcount: 0,
    });
  const margin = (i: number, e: number) => (i > 0 ? ((i - e) / i) * 100 : null);

  const cells = (t: Tot, strong: boolean, isCenter = false) => {
    const p = t.income - t.expense;
    const pp = t.previousIncome - t.previousExpense;
    const m = margin(t.income, t.expense);
    const mp = margin(t.previousIncome, t.previousExpense);
    return (
      <>
        <td className={cn('border-l border-(--color-line) px-2.5 py-2 text-right tabular-nums', strong ? 'font-bold text-heading' : 'font-medium text-heading')}>{money(t.income, fmt)}</td>
        <td className="px-2.5 py-2 text-right tabular-nums text-(--color-text-muted)">{money(t.previousIncome, fmt)}</td>
        <Delta cur={t.income} prev={t.previousIncome} />
        <td className={cn('border-l border-(--color-line) px-2.5 py-2 text-right tabular-nums', strong ? 'font-bold text-heading' : 'font-medium text-heading')}>{money(t.expense, fmt)}</td>
        <td className="px-2.5 py-2 text-right tabular-nums text-(--color-text-muted)">{money(t.previousExpense, fmt)}</td>
        <Delta cur={t.expense} prev={t.previousExpense} up={false} />
        <td className={cn('border-l border-(--color-line) px-2.5 py-2 text-right font-semibold tabular-nums')} style={{ color: p >= 0 ? TONE.income : TONE.expense }}>
          {money(p, fmt)}
        </td>
        <td className="px-2.5 py-2 text-right tabular-nums text-(--color-text-muted)">{money(pp, fmt)}</td>
        <Delta cur={p} prev={pp} />
        <td className="border-l border-(--color-line) px-2.5 py-2 text-right tabular-nums">{isCenter ? <span className="text-(--color-text-faint)">—</span> : pct(m)}</td>
        <td className={cn('px-2.5 py-2 text-right text-xs tabular-nums', m !== null && mp !== null && m - mp > 0 ? 'text-(--color-income)' : m !== null && mp !== null && m - mp < 0 ? 'text-(--color-expense)' : 'text-(--color-text-faint)')}>
          {isCenter || m === null || mp === null ? '—' : `${m - mp > 0 ? '+' : m - mp < 0 ? '−' : ''}${Math.abs(m - mp).toFixed(1).replace('.', ',')} p.p.`}
        </td>
        <td className="border-l border-(--color-line) px-2.5 py-2 text-right tabular-nums">
          {t.headcount || '—'}
          {t.previousHeadcount !== t.headcount && t.previousHeadcount > 0 && <span className="block text-[10.5px] text-(--color-text-faint)">o&apos;tgan {t.previousHeadcount}</span>}
        </td>
      </>
    );
  };

  const exportCsv = () => {
    const row = (name: string, t: Tot) => {
      const p = t.income - t.expense;
      const pp = t.previousIncome - t.previousExpense;
      return [name, csvSom(t.income), csvSom(t.previousIncome), csvPct(change(t.income, t.previousIncome)), csvSom(t.expense), csvSom(t.previousExpense), csvPct(change(t.expense, t.previousExpense)), csvSom(p), csvSom(pp), csvPct(margin(t.income, t.expense)), csvPct(margin(t.previousIncome, t.previousExpense)), t.headcount, t.previousHeadcount];
    };
    downloadCsv(
      'umumiy-taqqoslash.csv',
      ['Birlik', "Daromad (so'm)", `Daromad — ${compareLabel}`, 'Daromad o‘zgarishi %', "Xarajat (so'm)", `Xarajat — ${compareLabel}`, 'Xarajat o‘zgarishi %', "Natija (so'm)", `Natija — ${compareLabel}`, 'Rentabellik %', `Rentabellik — ${compareLabel} %`, 'Xodimlar', `Xodimlar — ${compareLabel}`],
      [...list.map((s) => row(s.unit.name, tot([s]))), row('Hududlar jami', tot(regions)), row('Korxona jami', tot(list))],
    );
  };

  return (
    <Card className="overflow-hidden">
      <Head title="Taqqoslash: joriy davr va o'tgan davr" hint={`Har bir birlik uchun: joriy, ${compareLabel} va o'zgarish (% va summa). Qatorni bosing — birlik sahifasi ochiladi`}>
        <FmtToggle value={fmt} onChange={setFmt} />
        <SmallButton onClick={exportCsv}>CSV</SmallButton>
      </Head>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1400px] border-collapse whitespace-nowrap text-[13px]">
          <thead>
            <tr className="border-t border-(--color-line) bg-(--color-surface-muted) text-center">
              <th className={TH} />
              <th colSpan={3} className={cn(TH, 'border-l border-(--color-line) text-center')}>
                Daromad
              </th>
              <th colSpan={3} className={cn(TH, 'border-l border-(--color-line) text-center')}>
                Xarajat
              </th>
              <th colSpan={3} className={cn(TH, 'border-l border-(--color-line) text-center')}>
                Natija
              </th>
              <th colSpan={2} className={cn(TH, 'border-l border-(--color-line) text-center')}>
                Rentabellik
              </th>
              <th className={cn(TH, 'border-l border-(--color-line) text-center')}>Xodim</th>
            </tr>
            <tr className="border-y border-(--color-line) bg-(--color-surface-muted)">
              <th className={cn(TH, 'sticky left-0 z-10 bg-(--color-surface-muted) text-left')}>Birlik</th>
              {[0, 1, 2].map((i) => (
                <FragmentHead key={i} />
              ))}
              <th className={cn(TH, 'border-l border-(--color-line) text-right')}>Joriy</th>
              <th className={cn(TH, 'text-right')}>O&apos;zgarish</th>
              <th className={cn(TH, 'border-l border-(--color-line) text-right')}>Soni</th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => {
              const isCenter = s.unit.kind === 'center';
              return (
                <tr key={s.unit.key} onClick={() => onOpen(s)} className={cn('cursor-pointer border-b border-(--color-line) hover:bg-(--color-surface-muted)', isCenter && 'bg-[#f6f4fc]')}>
                  <td className={cn('sticky left-0 z-[1] px-2.5 py-2 font-medium', isCenter ? 'bg-[#f6f4fc]' : 'bg-white')}>
                    {s.unit.name}
                    {s.unit.kind === 'unassigned' && <span className="block text-[10.5px] text-(--color-text-faint)">hududi ko&apos;rsatilmagan</span>}
                    {s.unit.kind === 'segment' && <span className="block text-[10.5px] text-(--color-text-faint)">yo&apos;nalish</span>}
                  </td>
                  {cells(tot([s]), false, isCenter)}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-b border-(--color-line) bg-(--color-surface-muted)">
              <td className="sticky left-0 z-[1] bg-(--color-surface-muted) px-2.5 py-2.5 font-semibold">
                Hududlar jami <span className="block text-[10.5px] font-normal text-(--color-text-faint)">{regions.length} ta hudud</span>
              </td>
              {cells(tot(regions), true)}
            </tr>
            <tr className="border-t-2 border-t-(--color-text-faint) bg-[#eef2f8]">
              <td className="sticky left-0 z-[1] bg-[#eef2f8] px-2.5 py-2.5 font-bold text-heading">
                Korxona jami <span className="block text-[10.5px] font-normal text-(--color-text-faint)">Markaz + hududlar</span>
              </td>
              {cells(tot(list), true)}
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

function FragmentHead() {
  return (
    <>
      <th className={cn(TH, 'border-l border-(--color-line) text-right')}>Joriy</th>
      <th className={cn(TH, 'text-right')}>O&apos;tgan</th>
      <th className={cn(TH, 'text-right')}>O&apos;zgarish</th>
    </>
  );
}

// ───────────────────────── Oylar jadvali ─────────────────────────

type Metric = 'profit' | 'income' | 'expense';

export function MonthsTable({ units, months, range, onOpen }: { units: UnitStats[]; months: string[]; range: { from: string; to: string }; onOpen: (s: UnitStats) => void }) {
  const [metric, setMetric] = useState<Metric>('profit');
  const [fmt, setFmt] = useState<Fmt>('short');
  const list = [...units].sort((a, b) => kindOrder(a) - kindOrder(b) || b.profit - a.profit);
  const inRange = (m: string) => m >= range.from.slice(0, 7) && m <= range.to.slice(0, 7);
  const valuesOf = (s: UnitStats): number[] =>
    months.map((_, i) => {
      const inc = Number(s.unit.incomeTrend[i] ?? 0);
      const exp = Number(s.unit.expenseTrend[i] ?? 0);
      return metric === 'income' ? inc : metric === 'expense' ? exp : inc - exp;
    });
  const rows = list.map((s) => ({ s, values: valuesOf(s) }));
  const sumRows = (rs: typeof rows) => months.map((_, i) => rs.reduce((a, r) => a + r.values[i]!, 0));
  const regTotal = sumRows(rows.filter((r) => r.s.unit.kind === 'region'));
  const total = sumRows(rows);
  // Rang shkalasi hududlar bo'yicha (Markaz qiymati katta bo'lib, hammasini och qilib qo'ymasin)
  const scaleRows = rows.filter((r) => r.s.unit.kind === 'region');
  const max = Math.max(1, ...(scaleRows.length ? scaleRows : rows).flatMap((r) => r.values.map(Math.abs)));
  const signedMetric = metric === 'profit';

  const cell = (v: number, key: string, heat: boolean, inR: boolean) => {
    const color = signedMetric ? (v >= 0 ? TONE.income : TONE.expense) : metric === 'income' ? TONE.income : TONE.expense;
    return (
      <td key={key} className={cn('relative px-2 py-1.5 text-right tabular-nums', !inR && 'text-(--color-text-muted)')} title={`${num(v)} so'm`}>
        {heat && Math.round(v / 100) !== 0 && <span className="absolute inset-0.5 rounded" style={{ background: color, opacity: 0.05 + Math.min(1, Math.abs(v) / max) * 0.22 }} />}
        <span className={cn('relative', signedMetric && v < 0 && 'text-(--color-expense)')}>{money(v, fmt)}</span>
      </td>
    );
  };

  const exportCsv = () =>
    downloadCsv(
      `umumiy-oylar-${metric}.csv`,
      ['Birlik', ...months.map(formatPeriod), "Jami (so'm)"],
      [...rows.map((r) => [r.s.unit.name, ...r.values.map(csvSom), csvSom(r.values.reduce((a, b) => a + b, 0))]), ['Hududlar jami', ...regTotal.map(csvSom), csvSom(regTotal.reduce((a, b) => a + b, 0))], ['Korxona jami', ...total.map(csvSom), csvSom(total.reduce((a, b) => a + b, 0))]],
    );

  return (
    <Card className="overflow-hidden">
      <Head title="Oylar bo'yicha: Markaz va hududlar" hint="Har bir birlikning har oydagi ko'rsatkichi. Qalin ustunlar — tanlangan davr oylari; kataklar rangi — kattaligiga qarab">
        <Segmented
          size="sm"
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'profit', label: 'Natija' },
            { value: 'income', label: 'Daromad' },
            { value: 'expense', label: 'Xarajat' },
          ]}
        />
        <FmtToggle value={fmt} onChange={setFmt} />
        <SmallButton onClick={exportCsv}>CSV</SmallButton>
      </Head>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse whitespace-nowrap text-[12.5px]" style={{ minWidth: 220 + months.length * (fmt === 'full' ? 118 : 78) + 140 }}>
          <thead>
            <tr className="border-y border-(--color-line) bg-(--color-surface-muted)">
              <th className={cn(TH, 'sticky left-0 z-10 bg-(--color-surface-muted) text-left')}>Birlik</th>
              {months.map((m) => (
                <th key={m} className={cn(TH, 'text-right', inRange(m) && 'text-heading')}>
                  {formatPeriodShort(m)}
                </th>
              ))}
              <th className={cn(TH, 'border-l border-(--color-line) text-right')}>Jami</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isCenter = r.s.unit.kind === 'center';
              const sum = r.values.reduce((a, b) => a + b, 0);
              return (
                <tr key={r.s.unit.key} onClick={() => onOpen(r.s)} className={cn('cursor-pointer border-b border-(--color-line) hover:bg-(--color-surface-muted)', isCenter && 'bg-[#f6f4fc]')}>
                  <td className={cn('sticky left-0 z-[1] max-w-[13rem] truncate px-2.5 py-1.5 font-medium', isCenter ? 'bg-[#f6f4fc]' : 'bg-white')}>{r.s.unit.name}</td>
                  {r.values.map((v, i) => cell(v, months[i]!, true, inRange(months[i]!)))}
                  <td className={cn('border-l border-(--color-line) px-2.5 py-1.5 text-right font-semibold tabular-nums', signedMetric && sum < 0 && 'text-(--color-expense)')} title={`${num(sum)} so'm`}>
                    {money(sum, fmt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {(
              [
                ['Hududlar jami', regTotal, 'bg-(--color-surface-muted)'],
                ['Korxona jami', total, 'bg-[#eef2f8] font-bold'],
              ] as const
            ).map(([label, vals, cls]) => {
              const sum = vals.reduce((a, b) => a + b, 0);
              return (
                <tr key={label} className={cn('border-b border-(--color-line) font-semibold', cls)}>
                  <td className={cn('sticky left-0 z-[1] px-2.5 py-2', cls)}>{label}</td>
                  {vals.map((v, i) => cell(v, months[i]!, false, inRange(months[i]!)))}
                  <td className={cn('border-l border-(--color-line) px-2.5 py-2 text-right tabular-nums', signedMetric && sum < 0 && 'text-(--color-expense)')} title={`${num(sum)} so'm`}>
                    {money(sum, fmt)}
                  </td>
                </tr>
              );
            })}
          </tfoot>
        </table>
      </div>
      <p className="border-t border-(--color-line) px-5 py-2 text-[11px] text-(--color-text-faint)">
        «Jami» — jadvaldagi hamma oylar yig&apos;indisi ({formatPeriod(months[0] ?? '')} — {formatPeriod(months[months.length - 1] ?? '')}); tanlangan davr jamisi yuqoridagi jadvallarda.
      </p>
    </Card>
  );
}

// ───────────────────────── Markazni qoplash ─────────────────────────

const STATUS: Record<'full' | 'partial' | 'none', { label: string; cls: string }> = {
  full: { label: "To'liq ulush", cls: 'bg-(--color-income-soft) text-(--color-income)' },
  partial: { label: 'Borini beradi', cls: 'bg-(--color-warn-soft) text-(--color-warn)' },
  none: { label: 'Zararda', cls: 'bg-(--color-expense-soft) text-(--color-expense)' },
};

export function CoverTable({ cover, onOpenCode }: { cover: CoverResult; onOpenCode: (code: number | null | undefined) => void }) {
  const [fmt, setFmt] = useState<Fmt>('full');
  const [open, setOpen] = useState(true);
  const t = cover.rows.reduce((a, r) => ({ income: a.income + r.income, profit: a.profit + r.profit, equal: a.equal + r.equalShare, equalRest: a.equalRest + r.equalRest, share: a.share + r.share, rest: a.rest + r.rest }), { income: 0, profit: 0, equal: 0, equalRest: 0, share: 0, rest: 0 });
  const exportCsv = () =>
    downloadCsv(
      'markazni-qoplash.csv',
      ['Hudud', "Daromad (so'm)", "Foyda (so'm)", "Teng ulush (so'm)", "Teng taqsimdan keyin (so'm)", "Optimal ulush (so'm)", 'Markazni qoplash %', 'Foydasidan %', "Qolgan foyda (so'm)", 'Qolgan rentabellik %', 'Holat'],
      cover.rows.map((r) => [r.name, csvSom(r.income), csvSom(r.profit), csvSom(r.equalShare), csvSom(r.equalRest), csvSom(r.share), csvPct(r.coverPct), csvPct(r.ofProfitPct), csvSom(r.rest), csvPct(r.restMargin), STATUS[r.status].label]),
    );
  return (
    <Card className="overflow-hidden">
      <Head
        title="Markazni qoplash: har bir hudud ulushi"
        hint={
          <>
            Markaz sof xarajati <b className="tabular-nums text-heading">{money(cover.centerNet, 'full')}</b> so&apos;m hududlar foydasidan qoplanadi. «Teng» — har hududga {money(cover.equalShare, 'full')} so&apos;m; «optimal» — hech bir hudud zararga
            tushmaydigan eng tekis taqsim.
          </>
        }
      >
        <FmtToggle value={fmt} onChange={setFmt} />
        <SmallButton onClick={exportCsv}>CSV</SmallButton>
        <SmallButton onClick={() => setOpen((v) => !v)}>{open ? 'Yig‘ish' : 'Ochish'}</SmallButton>
      </Head>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] border-collapse whitespace-nowrap text-[13px]">
            <thead>
              <tr className="border-y border-(--color-line) bg-(--color-surface-muted)">
                <th className={cn(TH, 'w-8 text-center')}>#</th>
                <th className={cn(TH, 'text-left')}>Hudud</th>
                <th className={cn(TH, 'text-right')}>Daromad</th>
                <th className={cn(TH, 'text-right')}>Foyda</th>
                <th className={cn(TH, 'border-l border-(--color-line) text-right')}>Teng ulush</th>
                <th className={cn(TH, 'text-right')}>Teng taqsimdan keyin</th>
                <th className={cn(TH, 'border-l border-(--color-line) text-right')}>Optimal ulush</th>
                <th className={cn(TH, 'text-right')}>Markazdan %</th>
                <th className={cn(TH, 'text-right')}>Foydasidan %</th>
                <th className={cn(TH, 'border-l border-(--color-line) text-right')}>Qolgan foyda</th>
                <th className={cn(TH, 'text-right')}>Qolgan rent.</th>
                <th className={cn(TH, 'text-center')}>Holat</th>
              </tr>
            </thead>
            <tbody>
              {cover.rows.map((r, i) => (
                <tr key={r.key} onClick={() => onOpenCode(r.code)} className="cursor-pointer border-b border-(--color-line) hover:bg-(--color-surface-muted)">
                  <td className="px-2 py-2 text-center text-xs text-(--color-text-faint) tabular-nums">{i + 1}</td>
                  <td className="px-2.5 py-2 font-medium">{r.name}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{money(r.income, fmt)}</td>
                  <td className={cn('px-2.5 py-2 text-right font-semibold tabular-nums', r.profit < 0 && 'text-(--color-expense)')}>{money(r.profit, fmt)}</td>
                  <td className="border-l border-(--color-line) px-2.5 py-2 text-right tabular-nums text-(--color-text-muted)">{money(r.equalShare, fmt)}</td>
                  <td className={cn('px-2.5 py-2 text-right tabular-nums', r.equalRest < 0 ? 'font-semibold text-(--color-expense)' : 'text-(--color-text-muted)')}>{money(r.equalRest, fmt)}</td>
                  <td className="border-l border-(--color-line) px-2.5 py-2 text-right font-semibold tabular-nums text-heading">{money(r.share, fmt)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{pct(r.coverPct)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums text-(--color-text-muted)">{pct(r.ofProfitPct)}</td>
                  <td className={cn('border-l border-(--color-line) px-2.5 py-2 text-right font-semibold tabular-nums', r.rest < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{money(r.rest, fmt)}</td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{pct(r.restMargin)}</td>
                  <td className="px-2.5 py-2 text-center">
                    <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS[r.status].cls)}>{STATUS[r.status].label}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-t-(--color-text-faint) bg-[#eef2f8] font-semibold text-heading">
                <td />
                <td className="px-2.5 py-2.5">Jami ({cover.rows.length} ta hudud)</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums">{money(t.income, fmt)}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums">{money(t.profit, fmt)}</td>
                <td className="border-l border-(--color-line) px-2.5 py-2.5 text-right tabular-nums">{money(t.equal, fmt)}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums">{money(t.equalRest, fmt)}</td>
                <td className="border-l border-(--color-line) px-2.5 py-2.5 text-right tabular-nums">{money(t.share, fmt)}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums">{pct(cover.centerNet > 0 ? (t.share / cover.centerNet) * 100 : null)}</td>
                <td />
                <td className="border-l border-(--color-line) px-2.5 py-2.5 text-right tabular-nums">{money(t.rest, fmt)}</td>
                <td className="px-2.5 py-2.5 text-right tabular-nums">{pct(t.income > 0 ? (t.rest / t.income) * 100 : null)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-(--color-line) px-5 py-2.5 text-xs text-(--color-text-muted)">
        <span>
          Qoplandi: <b className="tabular-nums text-heading">{money(cover.covered, 'full')}</b> ({pct(cover.centerNet > 0 ? (cover.covered / cover.centerNet) * 100 : null)})
        </span>
        {cover.shortfall > 0 ? (
          <span className="text-(--color-expense)">
            Yetishmovchilik: <b className="tabular-nums">{money(cover.shortfall, 'full')}</b>
          </span>
        ) : (
          <span className="text-(--color-income)">
            Qoplagandan ortgan foyda: <b className="tabular-nums">{money(cover.surplus, 'full')}</b>
          </span>
        )}
        <span>Teng bo&apos;linsa zararga tushadigan hududlar: {cover.equalLosers}</span>
      </div>
    </Card>
  );
}