'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { formatDate, formatPeriod, formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { compact, num, pct, som, structureApi, TONE, type CompareMode, type FlowPart, type FlowResult, type SectionFilter } from './api';
import { IncomeExpenseBars, Legend, LineChart, Sankey } from './charts';
import { Mark } from '@/features/reactions/mark';
import type { ItemFilter, MarkItem } from '@/features/reactions/api';
import { CompareToggle, Findings, GroupTitle, KpiStrip, ModelCard, PanelHeader, SectionToggle, ShareBar, SmallButton } from './parts';
import { changePct, csvPct, csvSom, cumulativeByMonth, downloadCsv, forecastYear, lastN, mean } from './stats';

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]';
const MONTH_SHORT = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyn', 'Iyl', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];

function change(current: string | number, previous: string | number): number | null {
  return changePct(Number(current), Number(previous));
}

/** O'sish yaxshimi — rang shunga qarab */
function toneOf(delta: number | null, good: boolean): string {
  if (delta === null || Math.abs(delta) < 0.5) return 'text-[--color-text-muted]';
  return delta > 0 === good ? 'text-[--color-income]' : 'text-[--color-expense]';
}

function signedCompact(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${compact(Math.abs(value))}`;
}

/** Munosabat filtri: tanlangan bo'lim (Doimiy / Boshqa) */
function sectionFilter(section: SectionFilter): ItemFilter {
  return section === 'ALL' ? {} : { section };
}

function sectionLabel(label: string, section: SectionFilter): string {
  return section === 'ALL' ? label : `${label} · ${section === 'DOIMIY' ? 'Doimiy' : 'Boshqa'}`;
}

/** Oqim qismlari → Munosabat moddasi */
function partMark(kind: 'INCOME' | 'EXPENSE', part: FlowPart, section: SectionFilter): MarkItem | null {
  const filter = sectionFilter(section);
  if (kind === 'INCOME') {
    if (part.key !== 'REGIONAL') return null;
    return { kind, label: sectionLabel('Hududlar tushumi', section), filter: { ...filter, source: 'IMPORT' }, origin: 'Daromad va xarajat tarkibi' };
  }
  if (part.key === 'm:PAYROLL') return { kind, label: sectionLabel('Ish haqi', section), filter: { ...filter, source: 'PAYROLL' }, origin: 'Daromad va xarajat tarkibi' };
  if (part.key === 'm:LEASE') return { kind, label: sectionLabel('Ijara', section), filter: { ...filter, source: 'LEASE' }, origin: 'Daromad va xarajat tarkibi' };
  if (part.key === 'm:VEHICLE') return { kind, label: sectionLabel('Mashinalar', section), filter: { ...filter, source: 'VEHICLE' }, origin: 'Daromad va xarajat tarkibi' };
  if (part.key.startsWith('c:')) return { kind, label: sectionLabel(part.label, section), filter: { ...filter, rootCategoryCode: part.key.slice(2) }, origin: 'Daromad va xarajat tarkibi' };
  return null;
}

function cap(text: string): string {
  return text[0]!.toUpperCase() + text.slice(1);
}

// ═══════════════════════════════════════════════════════════
// Hisoblar (bir joyda — kartalar va xulosalar bir xil raqamni ishlatadi)
// ═══════════════════════════════════════════════════════════

function derive(flow: FlowResult) {
  const income = Number(flow.income.totalTiyin);
  const expense = Number(flow.expense.totalTiyin);
  const profit = Number(flow.profitTiyin);
  const prevIncome = Number(flow.income.previousTiyin);
  const prevExpense = Number(flow.expense.previousTiyin);

  const months = flow.monthly.map((m) => m.period);
  const incomes = flow.monthly.map((m) => Number(m.incomeTiyin));
  const expenses = flow.monthly.map((m) => Number(m.expenseTiyin));
  const profits = incomes.map((v, i) => v - expenses[i]!);

  const months12 = lastN(months, 12);
  const inc12 = lastN(incomes, 12);
  const exp12 = lastN(expenses, 12);
  const prof12 = lastN(profits, 12);
  // Bir yil oldingi xuddi shu oylar; ma'lumot kiritilmagan oy (daromad ham, xarajat ham 0) — null
  const hasPrevYear = months.length >= 24;
  const emptyPrev = hasPrevYear ? incomes.slice(-24, -12).map((v, i) => v === 0 && expenses[expenses.length - 24 + i] === 0) : [];
  const prevSlice = (list: number[]) => (hasPrevYear ? list.slice(-24, -12).map((v, i) => (emptyPrev[i] ? null : v)) : null);
  const incPrev = prevSlice(incomes);
  const expPrev = prevSlice(expenses);
  const profPrev = prevSlice(profits);
  const prevSum = (list: (number | null)[] | null) => (list && list.some((v) => v !== null) ? list.reduce<number>((a, b) => a + (b ?? 0), 0) : null);

  // Har 100 so'm daromadga xarajat
  const ratio = income > 0 ? (expense / income) * 100 : null;
  const prevRatio = prevIncome > 0 ? (prevExpense / prevIncome) * 100 : null;
  const ratio12 = inc12.map((v, i) => (v > 0 ? (exp12[i]! / v) * 100 : null));
  const ratioPrev = incPrev && expPrev ? incPrev.map((v, i) => (v !== null && v > 0 ? ((expPrev[i] ?? 0) / v) * 100 : null)) : null;

  // Doimiy qoplash: doimiy daromad doimiy xarajatni necha foiz qoplaydi
  const s = flow.split;
  const coverage = Number(s.expense.doimiyTiyin) > 0 ? (Number(s.income.doimiyTiyin) / Number(s.expense.doimiyTiyin)) * 100 : null;
  const prevCoverage =
    Number(s.expense.previousDoimiyTiyin) > 0 ? (Number(s.income.previousDoimiyTiyin) / Number(s.expense.previousDoimiyTiyin)) * 100 : null;

  // Eng yaxshi va eng yomon oy (12 oy)
  let best = 0;
  let worst = 0;
  prof12.forEach((v, i) => {
    if (v > prof12[best]!) best = i;
    if (v < prof12[worst]!) worst = i;
  });

  const forecast = {
    income: forecastYear(months, incomes, flow.range.to),
    expense: forecastYear(months, expenses, flow.range.to),
  };
  const lossMonths = prof12.filter((v) => v < 0).length;

  return {
    income,
    expense,
    profit,
    prevIncome,
    prevExpense,
    months,
    incomes,
    expenses,
    profits,
    months12,
    inc12,
    exp12,
    prof12,
    incPrev,
    expPrev,
    profPrev,
    // Faqat ikkala yilda ham ma'lumot bor oylar bo'yicha (juft) solishtirish
    incPaired: incPrev && incPrev.some((v) => v !== null) ? inc12.reduce((a, v, i) => a + (incPrev[i] === null ? 0 : v), 0) : null,
    incPrevSum: prevSum(incPrev),
    profPaired: profPrev && profPrev.some((v) => v !== null) ? prof12.reduce((a, v, i) => a + (profPrev[i] === null ? 0 : v), 0) : null,
    profPrevSum: prevSum(profPrev),
    pairedMonths: incPrev ? incPrev.filter((v) => v !== null).length : 0,
    ratio,
    prevRatio,
    ratio12,
    ratioPrev,
    coverage,
    prevCoverage,
    best: { period: months12[best]!, value: prof12[best] ?? 0 },
    worst: { period: months12[worst]!, value: prof12[worst] ?? 0 },
    forecast,
    lossMonths,
    avgProfit12: mean(prof12),
  };
}

type Derived = ReturnType<typeof derive>;

function notesOf(flow: FlowResult, d: Derived): string[] {
  const notes: string[] = [];
  if (d.income > 0) {
    const spent = Math.round((d.expense / d.income) * 100);
    notes.push(
      d.profit >= 0
        ? `Har 100 so'm daromadning ${spent} so'mi xarajatga ketmoqda, ${100 - spent} so'mi foyda bo'lib qolmoqda.`
        : `Xarajat daromaddan ${compact(-d.profit)} so'mga ko'p: har 100 so'm daromadga ${spent} so'm xarajat to'g'ri kelmoqda.`,
    );
  }
  const incomeGrowth = change(d.income, d.prevIncome);
  const expenseGrowth = change(d.expense, d.prevExpense);
  if (incomeGrowth !== null && expenseGrowth !== null) {
    notes.push(
      expenseGrowth > incomeGrowth
        ? `${cap(flow.compareLabel)}ga nisbatan xarajat (${pct(expenseGrowth, true)}) daromaddan (${pct(incomeGrowth, true)}) tezroq o'smoqda — rentabellik pasaymoqda.`
        : `${cap(flow.compareLabel)}ga nisbatan daromad (${pct(incomeGrowth, true)}) xarajatdan (${pct(expenseGrowth, true)}) tezroq o'smoqda — rentabellik yaxshilanmoqda.`,
    );
  }
  const topExpense = [...flow.expense.parts].filter((p) => p.key !== 'rest').sort((a, b) => Number(b.amountTiyin) - Number(a.amountTiyin))[0];
  if (topExpense && d.expense > 0) {
    notes.push(`Eng katta xarajat yo'nalishi — «${topExpense.label}»: barcha xarajatlarning ${pct((Number(topExpense.amountTiyin) / d.expense) * 100)}.`);
  }
  const topIncome = [...flow.income.parts].sort((a, b) => Number(b.amountTiyin) - Number(a.amountTiyin))[0];
  if (topIncome && d.income > 0) {
    notes.push(`Asosiy daromad manbai — «${topIncome.label}»: barcha daromadning ${pct((Number(topIncome.amountTiyin) / d.income) * 100)}.`);
  }
  if (flow.section === 'ALL' && d.coverage !== null) {
    notes.push(
      d.coverage >= 100
        ? `Doimiy daromad doimiy xarajatni to'liq qoplaydi (${pct(d.coverage)}) — korxona muntazam tushumlar hisobiga yashay oladi.`
        : `Doimiy daromad doimiy xarajatning faqat ${pct(d.coverage)} ini qoplaydi — qolgani bir martalik tushumlarga bog'liq.`,
    );
  }
  if (d.prof12.length > 0) {
    notes.push(
      `So'nggi 12 oyda eng yaxshi oy — ${formatPeriod(d.best.period)} (${signedCompact(d.best.value)}), eng og'ir oy — ${formatPeriod(d.worst.period)} (${signedCompact(d.worst.value)})` +
        (d.lossMonths > 0 ? `; ${d.lossMonths} ta oy zarar bilan yopilgan.` : "; zarar bilan yopilgan oy yo'q."),
    );
  }
  const fi = d.forecast.income;
  const fe = d.forecast.expense;
  if (fi && fe) {
    notes.push(`Shu sur'at davom etsa, ${fi.year}-yil ${signedCompact(fi.forecastTiyin - fe.forecastTiyin)} so'm ${fi.forecastTiyin >= fe.forecastTiyin ? 'foyda' : 'zarar'} bilan yopiladi (taxminiy).`);
  }
  return notes;
}

// ═══════════════════════════════════════════════════════════
// Manbalar / yo'nalishlar jadvali
// ═══════════════════════════════════════════════════════════

function PartTable({
  title,
  description,
  parts,
  total,
  previous,
  growthGood,
  barColor,
  compareLabel,
  markOf,
}: {
  markOf?: (part: FlowPart) => MarkItem | null;
  title: string;
  description: string;
  parts: FlowPart[];
  total: string;
  previous: string;
  growthGood: boolean;
  barColor: string;
  compareLabel: string;
}) {
  const sum = Number(total) || 1;
  const sorted = [...parts].sort((a, b) => (a.key === 'rest' ? 1 : b.key === 'rest' ? -1 : Number(b.amountTiyin) - Number(a.amountTiyin)));
  const totalChange = change(total, previous);
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-[--color-text-muted]">{description}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y border-[--color-line] bg-[--color-surface-muted]">
            <tr>
              <th className={cn(TH, 'pl-5 text-left')}>Nomi</th>
              <th className={cn(TH, 'text-right')}>Summa</th>
              <th className={cn(TH, 'w-32 text-left')}>Ulush</th>
              <th className={cn(TH, 'text-right')} title={cap(compareLabel)}>Avval</th>
              <th className={cn(TH, 'pr-5 text-right')}>O&apos;zgarish</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[--color-line]">
            {sorted.map((part) => {
              const d = change(part.amountTiyin, part.previousTiyin);
              return (
                <tr key={part.key}>
                  <td className="max-w-[15rem] py-2.5 pl-5 pr-3" title={part.label}>
                    <span className="flex items-center gap-2">
                      <Mark item={markOf?.(part) ?? null} />
                      <span className="truncate">{part.label}</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums" title={som(part.amountTiyin)}>{compact(part.amountTiyin)}</td>
                  <td className="px-3 py-2.5">
                    <ShareBar percent={(Number(part.amountTiyin) / sum) * 100} color={barColor} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[--color-text-muted]">{compact(part.previousTiyin)}</td>
                  <td className={cn('whitespace-nowrap py-2.5 pl-3 pr-5 text-right font-medium tabular-nums', toneOf(d, growthGood))}>
                    {d === null ? (Number(part.amountTiyin) > 0 ? 'yangi' : '—') : pct(d, true)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t-2 border-[--color-line] bg-[--color-surface-muted] font-semibold">
            <tr>
              <td className="py-2.5 pl-5 pr-3">Jami</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums" title={som(total)}>{compact(total)}</td>
              <td className="px-3 py-2.5 text-xs text-[--color-text-muted]">100%</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[--color-text-muted]">{compact(previous)}</td>
              <td className={cn('whitespace-nowrap py-2.5 pl-3 pr-5 text-right tabular-nums', toneOf(totalChange, growthGood))}>{pct(totalChange, true)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// Doimiy / Boshqa matritsasi
// ═══════════════════════════════════════════════════════════

function SplitMatrix({ flow, d }: { flow: FlowResult; d: Derived }) {
  const s = flow.split;
  const rows = [
    { label: 'Doimiy (muntazam)', inc: s.income.doimiyTiyin, exp: s.expense.doimiyTiyin, pInc: s.income.previousDoimiyTiyin, pExp: s.expense.previousDoimiyTiyin },
    { label: 'Boshqa (bir martalik)', inc: s.income.boshqaTiyin, exp: s.expense.boshqaTiyin, pInc: s.income.previousBoshqaTiyin, pExp: s.expense.previousBoshqaTiyin },
  ];
  return (
    <div className="space-y-4">
      <table className="w-full text-sm">
        <thead className="border-b border-[--color-line]">
          <tr>
            <th className={cn(TH, 'pl-0 text-left')}>Bo&apos;lim</th>
            <th className={cn(TH, 'text-right')}>Daromad</th>
            <th className={cn(TH, 'text-right')}>Xarajat</th>
            <th className={cn(TH, 'text-right')}>Natija</th>
            <th className={cn(TH, 'pr-0 text-right')}>Avvalgi natija</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[--color-line]">
          {rows.map((r) => {
            const result = Number(r.inc) - Number(r.exp);
            const prevResult = Number(r.pInc) - Number(r.pExp);
            return (
              <tr key={r.label}>
                <td className="py-2.5 pr-3">{r.label}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{compact(r.inc)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{compact(r.exp)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums" style={{ color: result >= 0 ? TONE.income : TONE.expense }}>
                  {signedCompact(result)}
                </td>
                <td className="whitespace-nowrap py-2.5 pl-3 text-right tabular-nums text-[--color-text-muted]">{signedCompact(prevResult)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="text-[--color-text-muted]">Doimiy daromad doimiy xarajatni qoplashi</span>
          <span className="font-semibold tabular-nums">
            {pct(d.coverage)} <span className="font-normal text-[--color-text-muted]">(avval {pct(d.prevCoverage)})</span>
          </span>
        </div>
        <div className="relative h-3 bg-[--color-surface-sunken]">
          <div className="h-full" style={{ width: `${Math.min(100, ((d.coverage ?? 0) / 150) * 100)}%`, background: (d.coverage ?? 0) >= 100 ? TONE.income : TONE.expense }} />
          <span className="absolute inset-y-[-3px] w-0.5 bg-[--color-text]" style={{ left: `${(100 / 150) * 100}%` }} title="100% — to'liq qoplash" />
        </div>
        <div className="relative mt-1 h-4 text-[11px] text-[--color-text-faint]">
          <span className="absolute left-0">0%</span>
          <span className="absolute -translate-x-1/2 font-medium text-[--color-text-muted]" style={{ left: `${(100 / 150) * 100}%` }}>
            100% — to&apos;liq qoplash
          </span>
          <span className="absolute right-0">150%</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Oylik jadval
// ═══════════════════════════════════════════════════════════

function MonthlyTable({ d, flow }: { d: Derived; flow: FlowResult }) {
  const rows = d.months12.map((period, i) => {
    const inc = d.inc12[i]!;
    const exp = d.exp12[i]!;
    const profit = inc - exp;
    const prevProfit = d.profPrev ? (d.profPrev[i] ?? null) : null;
    return { period, inc, exp, profit, margin: inc > 0 ? (profit / inc) * 100 : null, prevProfit };
  });
  const total = rows.reduce((s, r) => ({ inc: s.inc + r.inc, exp: s.exp + r.exp }), { inc: 0, exp: 0 });
  const prevTotal = d.profPrevSum;

  const exportCsv = () =>
    downloadCsv(
      `oylar-kesimi-${flow.range.to}`,
      ['Oy', "Daromad, so'm", "Xarajat, so'm", "Foyda, so'm", 'Rentabellik, %', "Bir yil oldin foyda, so'm", "Farq, so'm"],
      rows.map((r) => [
        formatPeriod(r.period),
        csvSom(r.inc),
        csvSom(r.exp),
        csvSom(r.profit),
        csvPct(r.margin),
        r.prevProfit === null ? '' : csvSom(r.prevProfit),
        r.prevProfit === null ? '' : csvSom(r.profit - r.prevProfit),
      ]),
    );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div>
          <h3 className="text-sm font-semibold">Oylar kesimi — so&apos;nggi 12 oy</h3>
          <p className="mt-0.5 text-xs text-[--color-text-muted]">Har oy natijasi va bir yil oldingi xuddi shu oy bilan farq</p>
        </div>
        <SmallButton onClick={exportCsv}>Excel (CSV)</SmallButton>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-y border-[--color-line] bg-[--color-surface-muted]">
            <tr>
              <th className={cn(TH, 'pl-5 text-left')}>Oy</th>
              <th className={cn(TH, 'text-right')}>Daromad</th>
              <th className={cn(TH, 'text-right')}>Xarajat</th>
              <th className={cn(TH, 'text-right')}>Foyda</th>
              <th className={cn(TH, 'text-right')}>Rentabellik</th>
              <th className={cn(TH, 'text-right')}>Bir yil oldin</th>
              <th className={cn(TH, 'pr-5 text-right')}>Farq</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[--color-line]">
            {rows.map((r) => (
              <tr key={r.period} className="hover:bg-[--color-surface-muted]">
                <td className="whitespace-nowrap py-2 pl-5 pr-3">{formatPeriod(r.period)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(r.inc)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{num(r.exp)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums" style={{ color: r.profit >= 0 ? undefined : TONE.expense }}>
                  {num(r.profit)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[--color-text-muted]">{pct(r.margin)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[--color-text-muted]">{r.prevProfit === null ? '—' : compact(r.prevProfit)}</td>
                <td className={cn('whitespace-nowrap py-2 pl-3 pr-5 text-right tabular-nums', r.prevProfit === null ? '' : toneOf(r.profit - r.prevProfit === 0 ? null : r.profit > r.prevProfit ? 1 : -1, true))}>
                  {r.prevProfit === null ? '—' : signedCompact(r.profit - r.prevProfit)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-[--color-line] bg-[--color-surface-muted] font-semibold">
            <tr>
              <td className="py-2.5 pl-5">12 oy jami</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{num(total.inc)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{num(total.exp)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums" style={{ color: total.inc - total.exp >= 0 ? undefined : TONE.expense }}>
                {num(total.inc - total.exp)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{pct(total.inc > 0 ? ((total.inc - total.exp) / total.inc) * 100 : null)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{prevTotal === null ? '—' : compact(prevTotal)}</td>
              <td className="whitespace-nowrap py-2.5 pl-3 pr-5 text-right tabular-nums" title="Faqat ikkala yilda ham ma'lumot bor oylar bo'yicha">
                {prevTotal === null || d.profPaired === null ? '—' : signedCompact(d.profPaired - prevTotal)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// Asosiy komponent
// ═══════════════════════════════════════════════════════════

/**
 * Daromad va xarajat tarkibi — umumiy ko'rinish:
 * asosiy raqamlar, pul oqimi, manbalar va yo'nalishlar, yillar solishtirmasi,
 * jamlanma foyda, xarajat koeffitsienti, doimiy qoplash, prognoz va oylik jadval.
 */
export function StructureOverview({ range }: { range: DateRange }) {
  const [section, setSection] = useState<SectionFilter>('ALL');
  const [compare, setCompare] = useState<CompareMode>('prev');
  const flow = useAsync(() => structureApi.flow(range, section, compare).then((r) => r.data), [range.from, range.to, section, compare]);
  const data = flow.data;

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Daromad va xarajat tarkibi"
        description={
          data
            ? `${formatDate(data.range.from)} — ${formatDate(data.range.to)} · solishtirish: ${data.compareLabel} (${formatDate(data.previousRange.from)} — ${formatDate(data.previousRange.to)})`
            : 'Tanlangan davr avvalgi davr bilan solishtiriladi'
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-3">
            <CompareToggle value={compare} onChange={setCompare} />
            <SectionToggle value={section} onChange={setSection} />
          </div>
        }
      />

      {flow.error ? (
        <Card>
          <ErrorState message={flow.error} onRetry={flow.reload} />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingState label="Pul oqimi hisoblanmoqda" />
        </Card>
      ) : (
        <OverviewBody data={data} loading={flow.loading} />
      )}
    </div>
  );
}

function OverviewBody({ data, loading }: { data: FlowResult; loading: boolean }) {
  const d = derive(data);
  const profitDelta = d.profit - Number(data.previousProfitTiyin);
  const marginDelta = data.marginPercent !== null && data.previousMarginPercent !== null ? data.marginPercent - data.previousMarginPercent : null;
  const fi = d.forecast.income;
  const fe = d.forecast.expense;
  const year = Number(data.range.to.slice(0, 4));
  const toMonth = Number(data.range.to.slice(5, 7));
  const cumThis = cumulativeByMonth(d.months, d.profits, year, toMonth);
  const cumPrev = cumulativeByMonth(d.months, d.profits, year - 1);
  const cumThisEnd = [...cumThis].reverse().find((v) => v !== null) ?? null;
  const cumPrevSame = cumPrev[toMonth - 1] ?? null;
  const pp = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')} p.p.`);

  return (
    <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}>
      <KpiStrip
        items={[
          {
            label: 'Daromad',
            mark: <Mark item={{ kind: 'INCOME', label: sectionLabel('Barcha daromadlar', data.section), filter: sectionFilter(data.section), origin: 'Daromad va xarajat tarkibi' }} />,
            value: som(d.income),
            sub: (
              <>
                <b className={cn('font-medium', toneOf(change(d.income, d.prevIncome), true))}>{pct(change(d.income, d.prevIncome), true)}</b> · avval {compact(d.prevIncome)}
              </>
            ),
          },
          {
            label: 'Xarajat',
            mark: <Mark item={{ kind: 'EXPENSE', label: sectionLabel('Barcha xarajatlar', data.section), filter: sectionFilter(data.section), origin: 'Daromad va xarajat tarkibi' }} />,
            value: som(d.expense),
            sub: (
              <>
                <b className={cn('font-medium', toneOf(change(d.expense, d.prevExpense), false))}>{pct(change(d.expense, d.prevExpense), true)}</b> · avval {compact(d.prevExpense)}
              </>
            ),
          },
          {
            label: d.profit >= 0 ? 'Sof foyda' : 'Zarar',
            mark: <Mark item={{ kind: 'RESULT', label: sectionLabel('Korxona natijasi', data.section), filter: sectionFilter(data.section), origin: 'Daromad va xarajat tarkibi' }} />,
            value: som(d.profit),
            valueClass: d.profit < 0 ? 'text-[--color-expense]' : undefined,
            sub: (
              <>
                <b className={cn('font-medium', toneOf(profitDelta === 0 ? null : profitDelta, true))}>{signedCompact(profitDelta)}</b> · avval {compact(data.previousProfitTiyin)}
              </>
            ),
          },
          {
            label: 'Rentabellik (foyda ÷ daromad)',
            value: pct(data.marginPercent),
            sub: (
              <>
                <b className={cn('font-medium', toneOf(marginDelta, true))}>{pp(marginDelta)}</b> · avval {pct(data.previousMarginPercent)}
              </>
            ),
          },
        ]}
      />
      <KpiStrip
        items={[
          {
            label: "100 so'm daromadga xarajat",
            value: d.ratio === null ? '—' : `${Math.round(d.ratio)} so'm`,
            valueClass: d.ratio !== null && d.ratio > 100 ? 'text-[--color-expense]' : undefined,
            sub: `avval ${d.prevRatio === null ? '—' : `${Math.round(d.prevRatio)} so'm`} · 100 dan yuqori — zarar`,
          },
          {
            label: 'Doimiy qoplash',
            value: data.section === 'ALL' ? pct(d.coverage) : '—',
            valueClass: data.section === 'ALL' && d.coverage !== null && d.coverage < 100 ? 'text-[--color-expense]' : undefined,
            sub: data.section === 'ALL' ? `doimiy daromad ÷ doimiy xarajat · avval ${pct(d.prevCoverage)}` : 'faqat «Barchasi» tanlanganda',
          },
          {
            label: "O'rtacha oylik foyda (12 oy)",
            value: som(d.avgProfit12),
            valueClass: d.avgProfit12 < 0 ? 'text-[--color-expense]' : undefined,
            sub: `${12 - d.lossMonths} oy foyda, ${d.lossMonths} oy zarar`,
          },
          {
            label: fi ? `${fi.year}-yil foyda prognozi` : 'Yil prognozi',
            value: fi && fe ? som(fi.forecastTiyin - fe.forecastTiyin) : '—',
            valueClass: fi && fe && fi.forecastTiyin < fe.forecastTiyin ? 'text-[--color-expense]' : undefined,
            sub: fi && fe && fi.lastYearTiyin !== null && fe.lastYearTiyin !== null ? `o'tgan yil ${compact(fi.lastYearTiyin - fe.lastYearTiyin)}` : "so'nggi 3 oy sur'ati bilan",
          },
        ]}
      />

      <Findings notes={notesOf(data, d)} />

      <GroupTitle title="Tahliliy modellar" description={`Solishtirish: ${data.compareLabel}`} />

      <ModelCard
        index={1}
        title="Pul oqimi (Sankey diagrammasi)"
        question="Pul qayerdan keladi va qayerga ketadi?"
        aside={
          <>
            <p className="text-base font-semibold tabular-nums" style={{ color: d.profit >= 0 ? TONE.income : TONE.expense }}>
              {num(d.profit)}
            </p>
            <p className="text-[11px] text-[--color-text-muted]">{d.profit >= 0 ? "sof foyda, so'm" : "zarar, so'm"}</p>
          </>
        }
        howTo="Chapda — daromad manbalari, o'ngda — xarajat yo'nalishlari va qolgan foyda. Oqim qalinligi summaga teng. Foizlar — umumiy oqimga nisbatan: foyda bo'lsa, har 100 so'm daromadning qanchasi qayerga ketgani; zarar bo'lsa, xarajatlarning qancha qismi qoplanmagani."
      >
        {d.income + d.expense === 0 ? <p className="py-10 text-center text-sm text-[--color-text-muted]">Bu davrda ma&apos;lumot yo&apos;q</p> : <Sankey flow={data} />}
      </ModelCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <PartTable
          title="Daromad manbalari"
          description={`Ulush — jami daromad ichida; o'zgarish — ${data.compareLabel}ga nisbatan`}
          parts={data.income.parts}
          total={data.income.totalTiyin}
          previous={data.income.previousTiyin}
          growthGood
          barColor={TONE.income}
          compareLabel={data.compareLabel}
          markOf={(part) => partMark('INCOME', part, data.section)}
        />
        <PartTable
          title="Xarajat yo'nalishlari"
          description={`Ulush — jami xarajat ichida; o'zgarish — ${data.compareLabel}ga nisbatan`}
          parts={data.expense.parts}
          total={data.expense.totalTiyin}
          previous={data.expense.previousTiyin}
          growthGood={false}
          barColor={TONE.slate}
          compareLabel={data.compareLabel}
          markOf={(part) => partMark('EXPENSE', part, data.section)}
        />
      </div>

      <ModelCard
        index={2}
        title="12 oylik dinamika"
        question="Daromad, xarajat va foyda oyma-oy qanday o'zgarmoqda?"
        howTo="Har oyda ikki ustun: yashil — daromad, qizg'ish — xarajat. Qora chiziq — oy foydasi; nuqta qizil bo'lsa, o'sha oy zarar bilan yopilgan. Ustun ustiga olib borsangiz, aniq summalar chiqadi."
      >
        <IncomeExpenseBars monthly={lastN(data.monthly, 12)} />
      </ModelCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <ModelCard
          index={3}
          title="Bu yil va o'tgan yil"
          question="Har oy o'tgan yilning xuddi shu oyiga nisbatan yaxshimi yoki yomonmi?"
          aside={
            d.incPrevSum !== null && d.incPaired !== null ? (
              <>
                <p className={cn('text-base font-semibold tabular-nums', toneOf(change(d.incPaired, d.incPrevSum), true))}>{pct(change(d.incPaired, d.incPrevSum), true)}</p>
                <p className="text-[11px] text-[--color-text-muted]">daromad, {d.pairedMonths} oy · bir yil oldinga</p>
              </>
            ) : undefined
          }
          howTo="Yaxlit chiziq — so'nggi 12 oy, uzuq chiziq — bir yil oldingi xuddi shu oylar. Yashil yaxlit chiziq uzuqdan yuqori bo'lsa — daromad o'tgan yildan ko'p; qizil yaxlit chiziq uzuqdan past bo'lsa — xarajat kamaygan."
        >
          {d.incPrev && d.expPrev ? (
            <>
              <LineChart
                width={600}
                height={280}
                labels={d.months12.map((m) => formatPeriodShort(m).split(' ')[0]!)}
                tooltipLabels={d.months12.map((m) => `${formatPeriod(m)} (bir yil oldin bilan)`)}
                series={[
                  { label: 'Daromad · bir yil oldin', color: TONE.income, values: d.incPrev, dashed: true, width: 1.5 },
                  { label: 'Xarajat · bir yil oldin', color: TONE.expense, values: d.expPrev, dashed: true, width: 1.5 },
                  { label: "Daromad · so'nggi 12 oy", color: TONE.income, values: d.inc12 },
                  { label: "Xarajat · so'nggi 12 oy", color: TONE.expense, values: d.exp12 },
                ]}
              />
              <div className="mt-2">
                <Legend
                  items={[
                    { color: TONE.income, label: 'Daromad', line: true },
                    { color: TONE.expense, label: 'Xarajat', line: true },
                    { color: TONE.axis, label: 'Uzuq chiziq — bir yil oldin', line: true },
                  ]}
                />
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-[--color-text-muted]">O&apos;tgan yil uchun ma&apos;lumot yetarli emas</p>
          )}
        </ModelCard>

        <ModelCard
          index={4}
          title="Jamlanma foyda (yil boshidan)"
          question={`${year}-yil boshidan qancha foyda to'plandi va o'tgan yilga nisbatan qanday?`}
          aside={
            <>
              <p className="text-base font-semibold tabular-nums" style={{ color: (cumThisEnd ?? 0) >= 0 ? TONE.income : TONE.expense }}>
                {cumThisEnd === null ? '—' : compact(cumThisEnd)}
              </p>
              <p className="text-[11px] text-[--color-text-muted]">
                {cumPrevSame === null ? `${MONTH_SHORT[toMonth - 1]} oyigacha` : `o'tgan yil shu vaqtgacha ${compact(cumPrevSame)}`}
              </p>
            </>
          }
          howTo="Har nuqta — yanvardan shu oygacha yig'ilgan foyda. Chiziq tepaga ketsa — oylar foyda bilan, pastga ketsa — zarar bilan yopilmoqda. Uzuq chiziq — o'tgan yilning butun yili (taqqoslash uchun)."
        >
          <LineChart
            width={600}
            height={280}
            labels={MONTH_SHORT}
            series={[
              { label: `${year - 1}-yil`, color: TONE.axis, values: cumPrev, dashed: true, width: 1.5 },
              { label: `${year}-yil`, color: '#23426a', values: cumThis },
            ]}
          />
          <div className="mt-2">
            <Legend
              items={[
                { color: '#23426a', label: `${year}-yil`, line: true },
                { color: TONE.axis, label: `${year - 1}-yil`, line: true },
              ]}
            />
          </div>
        </ModelCard>

        <ModelCard
          index={5}
          title="Xarajat koeffitsienti"
          question="Har oy 100 so'm daromadga qancha xarajat to'g'ri keladi?"
          aside={
            <>
              <p className="text-base font-semibold tabular-nums" style={{ color: (d.ratio ?? 0) > 100 ? TONE.expense : undefined }}>
                {d.ratio === null ? '—' : `${Math.round(d.ratio)} so'm`}
              </p>
              <p className="text-[11px] text-[--color-text-muted]">tanlangan davrda</p>
            </>
          }
          howTo="Koeffitsient = xarajat ÷ daromad × 100. 100 dan past — foyda (masalan 80 — har 100 so'mdan 20 so'm foyda), 100 dan yuqori — zarar. Qizil uzuq chiziq — zarar chegarasi."
        >
          <LineChart
            width={600}
            height={280}
            labels={d.months12.map((m) => formatPeriodShort(m).split(' ')[0]!)}
            tooltipLabels={d.months12.map((m) => formatPeriod(m))}
            format={(v) => `${Math.round(v)}`}
            threshold={{ value: 100, label: 'zarar chegarasi — 100' }}
            series={[
              ...(d.ratioPrev ? [{ label: 'Bir yil oldin', color: TONE.axis, values: d.ratioPrev, dashed: true, width: 1.5 }] : []),
              { label: "So'nggi 12 oy", color: '#23426a', values: d.ratio12 },
            ]}
          />
          <div className="mt-2">
            <Legend
              items={[
                { color: '#23426a', label: "So'nggi 12 oy", line: true },
                ...(d.ratioPrev ? [{ color: TONE.axis, label: 'Bir yil oldin', line: true }] : []),
              ]}
            />
          </div>
        </ModelCard>

        {data.section === 'ALL' ? (
          <ModelCard
            index={6}
            title="Doimiy va bir martalik natija"
            question="Muntazam tushumlar muntazam xarajatlarni qoplaydimi?"
            aside={
              <>
                <p className="text-base font-semibold tabular-nums" style={{ color: (d.coverage ?? 0) >= 100 ? TONE.income : TONE.expense }}>
                  {pct(d.coverage)}
                </p>
                <p className="text-[11px] text-[--color-text-muted]">doimiy qoplash</p>
              </>
            }
            howTo="Natija = daromad − xarajat, har bo'lim uchun alohida. Qoplash 100% dan past bo'lsa, korxona doimiy xarajatlarini faqat bir martalik tushumlar hisobiga yopmoqda — bu barqaror emas."
          >
            <SplitMatrix flow={data} d={d} />
          </ModelCard>
        ) : (
          <ModelCard index={6} title="Doimiy va bir martalik natija" question="Muntazam tushumlar muntazam xarajatlarni qoplaydimi?">
            <p className="py-8 text-center text-sm text-[--color-text-muted]">Bu model uchun yuqorida «Barchasi» ni tanlang.</p>
          </ModelCard>
        )}
      </div>

      {fi && fe && (
        <ModelCard
          index={7}
          title={`${fi.year}-yil yakuni prognozi`}
          question="Shu sur'at davom etsa, yil qanday natija bilan yopiladi?"
          howTo={`Prognoz = yil boshidan to'liq o'tgan oylar fakti + so'nggi 3 to'liq oy o'rtachasi × qolgan ${fi.remainingMonths} oy. Mavsumiylik hisobga olinmaydi — bu yo'nalishni ko'rsatuvchi oddiy baho.`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-[--color-line]">
                <tr>
                  <th className={cn(TH, 'pl-0 text-left')}>Ko&apos;rsatkich</th>
                  <th className={cn(TH, 'text-right')}>Yil boshidan fakt</th>
                  <th className={cn(TH, 'text-right')}>Oylik sur&apos;at</th>
                  <th className={cn(TH, 'text-right')}>Yil yakuni prognozi</th>
                  <th className={cn(TH, 'text-right')}>O&apos;tgan yil</th>
                  <th className={cn(TH, 'pr-0 text-right')}>O&apos;zgarish</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[--color-line]">
                {[
                  { label: 'Daromad', fact: fi.factTiyin, basis: fi.basisTiyin, fc: fi.forecastTiyin, ly: fi.lastYearTiyin, good: true },
                  { label: 'Xarajat', fact: fe.factTiyin, basis: fe.basisTiyin, fc: fe.forecastTiyin, ly: fe.lastYearTiyin, good: false },
                  {
                    label: 'Foyda',
                    fact: fi.factTiyin - fe.factTiyin,
                    basis: fi.basisTiyin - fe.basisTiyin,
                    fc: fi.forecastTiyin - fe.forecastTiyin,
                    ly: fi.lastYearTiyin !== null && fe.lastYearTiyin !== null ? fi.lastYearTiyin - fe.lastYearTiyin : null,
                    good: true,
                  },
                ].map((r) => {
                  const c = r.ly === null ? null : changePct(r.fc, r.ly);
                  return (
                    <tr key={r.label} className={cn(r.label === 'Foyda' && 'font-semibold')}>
                      <td className="py-2.5 pr-3">{r.label}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{compact(r.fact)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[--color-text-muted]">{compact(r.basis)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums" style={{ color: r.label === 'Foyda' && r.fc < 0 ? TONE.expense : undefined }}>
                        {compact(r.fc)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[--color-text-muted]">{r.ly === null ? '—' : compact(r.ly)}</td>
                      <td className={cn('whitespace-nowrap py-2.5 pl-3 text-right tabular-nums', toneOf(c, r.good))}>{pct(c, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ModelCard>
      )}

      <MonthlyTable d={d} flow={data} />
    </div>
  );
}