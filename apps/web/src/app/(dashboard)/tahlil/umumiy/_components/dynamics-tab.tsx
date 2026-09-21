'use client';

import { dashboardApi } from '@/features/dashboard/api';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';

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
        <EmptyState title="Oxirgi 12 oyda ma'lumot yo'q" />
      </Card>
    );
  }

  const count = active.length;
  const avgIncome = active.reduce((sum, row) => sum + row.income, 0) / count;
  const avgExpense = active.reduce((sum, row) => sum + row.expense, 0) / count;
  const profitable = active.filter((row) => row.profit > 0).length;

  const best = active.reduce((a, b) => (b.profit > a.profit ? b : a));
  const worst = active.reduce((a, b) => (b.profit < a.profit ? b : a));

  return (
    <div className="space-y-4">
      {/* Qisqa xulosa */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryBox label="O'rtacha oylik daromad">
          <Money tiyin={String(Math.round(avgIncome))} tone="income" />
        </SummaryBox>

        <SummaryBox label="O'rtacha oylik xarajat">
          <Money tiyin={String(Math.round(avgExpense))} tone="expense" />
        </SummaryBox>

        <SummaryBox label="Foydali oylar">
          <span className="money">
            {profitable} / {count}
          </span>
        </SummaryBox>

        <SummaryBox label="Eng yaxshi / eng yomon">
          <span className="text-sm">
            <span className="text-[--color-income]">{formatPeriod(best.period)}</span>
            <span className="text-[--color-text-faint]"> / </span>
            <span className="text-[--color-expense]">{formatPeriod(worst.period)}</span>
          </span>
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
                  <Td className="text-[--color-text-muted]">{formatPeriod(row.period)}</Td>
                  <Td money>
                    <Money tiyin={row.incomeTiyin} tone="income" />
                  </Td>
                  <Td money>
                    <Money tiyin={row.expenseTiyin} tone="expense" />
                  </Td>
                  <Td money>
                    <Money tiyin={row.profitTiyin} tone="auto" />
                  </Td>
                  <Td
                    align="right"
                    className={cn(
                      'money text-xs',
                      ratio === null
                        ? 'text-[--color-text-faint]'
                        : ratio < 1
                          ? 'text-[--color-income]'
                          : 'text-[--color-expense]',
                    )}
                  >
                    {ratio === null ? '\u2014' : ratio.toFixed(2)}
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
    <div className="rounded-[--radius-card] border border-[--color-line] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
        {label}
      </p>
      <div className="mt-2 text-lg font-semibold">{children}</div>
    </div>
  );
}
