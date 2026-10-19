'use client';

import { dashboardApi } from '@/features/dashboard/api';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { CalcValue } from '@/components/ui/calc';
import { calcDivide, calcMean, calcResult, decimalText, moneyText, Q, type Calc } from '@/lib/calc';

import type { DateRange } from '@/components/shared/date-range-picker';
import { LineChart } from '@/components/shared/line-chart';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { periodOf } from './range-utils';

/**
 * Vaqt davomidagi o'zgarish — oxirgi 12 oy.
 *
 * Oraliq oxirgi oyi bo'yicha hisoblanadi: sentabr tanlansa,
 * oktabr 2025 — sentabr 2026 ko'rsatiladi.
 */
export function DynamicsTab({ range }: { range: DateRange }) {
  const period = periodOf(range.to);
  const trend = useAsync(() => dashboardApi.trend(12, period), [period]);

  if (trend.loading) return <LoadingState />;
  if (trend.error) return <ErrorState message={trend.error} onRetry={trend.reload} />;

  const rows = trend.data?.data ?? [];

  // Faqat harakat bo'lgan oylar statistikaga kiradi
  const active = rows
    .map((row) => ({
      period: row.period,
      income: Number(row.incomeTiyin),
      expense: Number(row.expenseTiyin),
      profit: Number(row.profitTiyin),
    }))
    .filter((row) => row.income > 0 || row.expense > 0);

  if (active.length === 0) {
    return (
      <Card>
        <EmptyState title="Oxirgi 12 oyda ma'lumot yo'q" hint="period" />
      </Card>
    );
  }

  const count = active.length;
  const avgIncome = active.reduce((sum, row) => sum + row.income, 0) / count;
  const avgExpense = active.reduce((sum, row) => sum + row.expense, 0) / count;
  const profitable = active.filter((row) => row.profit > 0).length;

  const best = active.reduce((a, b) => (b.profit > a.profit ? b : a));
  const worst = active.reduce((a, b) => (b.profit < a.profit ? b : a));

  // ─────── «Qanday hisoblandi?» ───────
  const meanNote = "Faqat daromadi yoki xarajati bor oylar olinadi (bo'sh oylar o'rtachani buzmasligi uchun).";
  const avgIncomeCalc = calcMean("O'rtacha oylik daromad", active.map((r) => Q.money(formatPeriod(r.period), r.income)), { note: meanNote });
  const avgExpenseCalc = calcMean("O'rtacha oylik xarajat", active.map((r) => Q.money(formatPeriod(r.period), r.expense)), { note: meanNote });
  const profitableCalc: Calc = {
    title: 'Foydali oylar',
    formula: "Oy foydali, agar Daromad − Xarajat > 0. Hisob: foydali oylar / ma'lumoti bor oylar",
    inputs: active.map((r) => Q.money(`${formatPeriod(r.period)} foydasi`, r.profit)),
    steps: [
      `Ma'lumoti bor oylar: ${count} ta`,
      `Foydali: ${active.filter((r) => r.profit > 0).map((r) => formatPeriod(r.period)).join(', ') || "yo'q"}`,
      `= ${profitable} / ${count}`,
    ],
    result: `${profitable} / ${count}`,
  };
  const bestWorstCalc: Calc = {
    title: 'Eng yaxshi va eng yomon oy',
    formula: 'Har oy foydasi = Daromad − Xarajat; eng kattasi — eng yaxshi, eng kichigi — eng yomon',
    inputs: active.map((r) => Q.money(`${formatPeriod(r.period)} foydasi`, r.profit)),
    steps: [
      `Eng yaxshi: ${formatPeriod(best.period)} = ${moneyText(best.income)} − ${moneyText(best.expense)} = ${moneyText(best.profit)}`,
      `Eng yomon: ${formatPeriod(worst.period)} = ${moneyText(worst.income)} − ${moneyText(worst.expense)} = ${moneyText(worst.profit)}`,
    ],
    result: `${formatPeriod(best.period)} / ${formatPeriod(worst.period)}`,
  };
  const ratioCalc = (period: string, income: number, expense: number): Calc => {
    const c = calcDivide(`${formatPeriod(period)}: xarajat / daromad`, Q.money('Xarajat', expense), Q.money('Daromad', income), 'ratio', {
      note: "Har 1 so'm daromadga necha so'm xarajat. 1 dan kichik — foyda.",
    });
    if (income <= 0) return c;
    const value = decimalText(expense / income, 2);
    return { ...c, steps: [...c.steps.slice(0, -1), `= ${value}`], result: value };
  };

  return (
    <div className="space-y-4">
      {/* Qisqa xulosa */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryBox label="O'rtacha oylik daromad">
          <CalcValue calc={avgIncomeCalc}>
            <Money tiyin={String(Math.round(avgIncome))} tone="income" />
          </CalcValue>
        </SummaryBox>

        <SummaryBox label="O'rtacha oylik xarajat">
          <CalcValue calc={avgExpenseCalc}>
            <Money tiyin={String(Math.round(avgExpense))} tone="expense" />
          </CalcValue>
        </SummaryBox>

        <SummaryBox label="Foydali oylar">
          <CalcValue calc={profitableCalc} className="money">
            {profitable} / {count}
          </CalcValue>
        </SummaryBox>

        <SummaryBox label="Eng yaxshi / eng yomon">
          <CalcValue calc={bestWorstCalc} className="text-sm">
            <span className="text-(--color-income)">{formatPeriod(best.period)}</span>
            <span className="text-(--color-text-faint)"> / </span>
            <span className="text-(--color-expense)">{formatPeriod(worst.period)}</span>
          </CalcValue>
        </SummaryBox>
      </div>

      {/* Grafik */}
      <Card>
        <CardHeader
          title="Daromad va xarajat"
          description="Chiziqlar kesishgan joy — zarar oyi"
        />
        <CardBody>
          <LineChart data={rows} />
        </CardBody>
      </Card>

      {/* Oylik jadval */}
      <Card className="overflow-hidden">
        <CardHeader title="Oyma-oy" description="Yangi oydan boshlab" />

        <Table>
          <THead>
            <Tr>
              <Th className="w-32">Oy</Th>
              <Th align="right">Daromad</Th>
              <Th align="right">Xarajat</Th>
              <Th align="right">Foyda</Th>
              <Th align="right" className="w-24">
                Nisbat
              </Th>
            </Tr>
          </THead>

          <TBody>
            {[...rows].reverse().map((row) => {
              const income = Number(row.incomeTiyin);
              const expense = Number(row.expenseTiyin);
              const ratio = income > 0 ? expense / income : null;
              const isEmpty = income === 0 && expense === 0;

              return (
                <Tr key={row.period} className={cn(isEmpty && 'opacity-40')}>
                  <Td className="text-(--color-text-muted)">{formatPeriod(row.period)}</Td>
                  <Td money>
                    <Money tiyin={row.incomeTiyin} tone="income" />
                  </Td>
                  <Td money>
                    <Money tiyin={row.expenseTiyin} tone="expense" />
                  </Td>
                  <Td money>
                    <CalcValue calc={isEmpty ? null : calcResult(income, expense, { title: `${formatPeriod(row.period)}: foyda` })}>
                      <Money tiyin={row.profitTiyin} tone="auto" />
                    </CalcValue>
                  </Td>
                  <Td
                    align="right"
                    className={cn(
                      'money text-xs',
                      ratio === null
                        ? 'text-(--color-text-faint)'
                        : ratio < 1
                          ? 'text-(--color-income)'
                          : 'text-(--color-expense)',
                    )}
                  >
                    {ratio === null ? '\u2014' : <CalcValue calc={ratioCalc(row.period, income, expense)}>{ratio.toFixed(2).replace('.', ',')}</CalcValue>}
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}

function SummaryBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">
        {label}
      </p>
      <div className="mt-2 text-lg font-semibold">{children}</div>
    </div>
  );
}