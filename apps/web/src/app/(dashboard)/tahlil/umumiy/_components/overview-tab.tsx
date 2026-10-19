'use client';

import { expensesApi } from '@/features/expenses/api';
import { incomesApi } from '@/features/incomes/api';
import { formatDate, formatPercent } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { CalcValue } from '@/components/ui/calc';
import { calcChange, calcDiff, calcDivide, calcMargin, calcPp, calcRecords, calcResult, calcShare, decimalText, Q, type Calc } from '@/lib/calc';

import type { DateRange } from '@/components/shared/date-range-picker';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Change, Money } from '@/components/ui/money';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { percentChange, previousRange } from './range-utils';

interface Totals {
  income: number;
  paid: number;
  expense: number;
  profit: number;
  margin: number | null;
}

/** Ikki so'rov javobidan yig'indilarni chiqaradi */
function buildTotals(
  data:
    | [
        { meta: { sumTiyin: string; paidTiyin: string } },
        { meta: { sumTiyin: string } },
      ]
    | null
    | undefined,
): Totals {
  const income = Number(data?.[0].meta.sumTiyin ?? 0);
  const paid = Number(data?.[0].meta.paidTiyin ?? 0);
  const expense = Number(data?.[1].meta.sumTiyin ?? 0);
  const profit = income - expense;

  return {
    income,
    paid,
    expense,
    profit,
    margin: income > 0 ? (profit / income) * 100 : null,
  };
}

/**
 * Umumiy holat — korxona foydada ishlayaptimi.
 *
 * Tanlangan oraliq unga teng oldingi davr bilan solishtiriladi.
 */
export function OverviewTab({ range }: { range: DateRange }) {
  const prev = previousRange(range);

  const current = useAsync(
    () =>
      Promise.all([
        incomesApi.list({ dateFrom: range.from, dateTo: range.to, limit: 1 }),
        expensesApi.list({ dateFrom: range.from, dateTo: range.to, limit: 1 }),
      ]),
    [range.from, range.to],
  );

  const previous = useAsync(
    () =>
      Promise.all([
        incomesApi.list({ dateFrom: prev.from, dateTo: prev.to, limit: 1 }),
        expensesApi.list({ dateFrom: prev.from, dateTo: prev.to, limit: 1 }),
      ]),
    [prev.from, prev.to],
  );

  if (current.loading) return <LoadingState />;
  if (current.error) {
    return <ErrorState message={current.error} onRetry={current.reload} />;
  }

  const now = buildTotals(current.data);
  const before = buildTotals(previous.data);

  const isProfit = now.profit >= 0;
  const costRatio = now.income > 0 ? now.expense / now.income : null;

  const maxValue = Math.max(now.income, now.expense, 1);
  const paidPercent = now.income > 0 ? (now.paid / now.income) * 100 : null;

  const incomeChange = percentChange(now.income, before.income);
  const expenseChange = percentChange(now.expense, before.expense);
  const profitChange = percentChange(now.profit, before.profit);

  const marginDiff =
    now.margin !== null && before.margin !== null ? now.margin - before.margin : null;

  const growthGap =
    incomeChange !== null && expenseChange !== null ? incomeChange - expenseChange : null;

  // ─────── «Qanday hisoblandi?» ───────
  const periodText = `${formatDate(range.from)} — ${formatDate(range.to)}`;
  const prevText = `${formatDate(prev.from)} — ${formatDate(prev.to)}`;
  const prevLabel = `Oldingi teng davr (${prevText})`;
  const incomeCalc = calcRecords('Daromad', now.income, current.data?.[0].meta.total, periodText, 'Daromadlar ro\'yxati');
  const expenseCalc = calcRecords('Xarajat', now.expense, current.data?.[1].meta.total, periodText, 'Xarajatlar ro\'yxati');
  const profitCalc = calcResult(now.income, now.expense, { title: 'Foyda', note: periodText });
  const marginCalc = calcMargin(now.income, now.expense, { note: periodText });
  const costCalc: Calc | null = (() => {
    if (now.income <= 0) return null;
    const c = calcDivide('Har 1 so\'m daromadga xarajat', Q.money('Xarajat', now.expense), Q.money('Daromad', now.income), 'ratio', {
      note: "1 dan kichik — har so'm daromaddan foyda qoladi; 1 dan katta — zarar.",
    });
    const value = `${decimalText(now.expense / now.income, 2)} so'm`;
    return { ...c, steps: [...c.steps.slice(0, -1), `= ${value}`], result: value };
  })();
  const changeCalc = (title: string, a: number, b: number, good: boolean) =>
    calcChange(`${title}: o'zgarish`, Q.money(`Joriy davr (${periodText})`, a), Q.money(prevLabel, b), { growthGood: good });
  const marginDiffCalc =
    now.margin !== null && before.margin !== null
      ? calcPp('Rentabellik farqi', { label: 'Joriy rentabellik', value: now.margin }, { label: 'Oldingi rentabellik', value: before.margin })
      : null;
  const gapCalc =
    incomeChange !== null && expenseChange !== null
      ? calcPp("O'sish sur'ati farqi", { label: "Daromad o'sishi", value: incomeChange }, { label: "Xarajat o'sishi", value: expenseChange }, {
          note: 'Musbat — daromad xarajatdan tezroq o\'smoqda.',
        })
      : null;
  const paidCalc = calcShare('Tushgan ulushi', Q.money('Tushgan', now.paid, "Daromad yozuvlaridagi «to'langan» summa"), Q.money('Hisoblangan daromad', now.income));
  const debtCalc = calcDiff('Qarzda', Q.money('Hisoblangan daromad', now.income), Q.money('Tushgan', now.paid));

  return (
    <div className="space-y-4">
      {/* Asosiy javob */}
      <Card>
        <CardBody className="space-y-5">
          <div className="text-center">
            <p className="text-sm text-(--color-text-muted)">
              Har 1 so&rsquo;m daromadga
            </p>
            <p
              className={cn(
                'money mt-1 text-4xl font-bold',
                costRatio === null
                  ? 'text-(--color-text-faint)'
                  : costRatio < 1
                    ? 'text-(--color-income)'
                    : 'text-(--color-expense)',
              )}
            >
              {costRatio === null ? '\u2014' : <CalcValue calc={costCalc}>{costRatio.toFixed(2).replace('.', ',')}</CalcValue>}
            </p>
            <p className="text-sm text-(--color-text-muted)">so&rsquo;m xarajat</p>
          </div>

          <div className="space-y-3">
            <CompareBar
              label="Daromad"
              calc={incomeCalc}
              value={now.income}
              width={(now.income / maxValue) * 100}
              tone="income"
            />
            <CompareBar
              label="Xarajat"
              calc={expenseCalc}
              value={now.expense}
              width={(now.expense / maxValue) * 100}
              tone="expense"
            />
          </div>

          <div
            className={cn(
              'flex items-center justify-between rounded-(--radius-control) px-4 py-3',
              isProfit ? 'bg-(--color-income-soft)' : 'bg-(--color-expense-soft)',
            )}
          >
            <span className="text-sm font-medium">{isProfit ? 'Foyda' : 'Zarar'}</span>

            <div className="flex items-center gap-3">
              <span
                className={cn(
                  'money text-xs',
                  isProfit ? 'text-(--color-income)' : 'text-(--color-expense)',
                )}
              >
                <CalcValue calc={marginCalc}>{formatPercent(now.margin)}</CalcValue>
              </span>
              <CalcValue calc={profitCalc}>
                <Money
                  tiyin={String(now.profit)}
                  tone="auto"
                  className="text-lg font-semibold"
                />
              </CalcValue>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Ko'rsatkichlar */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Daromad"
          tiyin={now.income}
          tone="income"
          change={incomeChange}
          good
          calc={incomeCalc}
          changeCalc={changeCalc('Daromad', now.income, before.income, true)}
        />
        <KpiCard
          label="Xarajat"
          tiyin={now.expense}
          tone="expense"
          change={expenseChange}
          good={false}
          calc={expenseCalc}
          changeCalc={changeCalc('Xarajat', now.expense, before.expense, false)}
        />
        <KpiCard
          label="Foyda"
          tiyin={now.profit}
          tone="auto"
          change={profitChange}
          good
          calc={profitCalc}
          changeCalc={changeCalc('Foyda', now.profit, before.profit, true)}
        />

        <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">
            Rentabellik
          </p>
          <p
            className={cn(
              'money mt-2 text-xl font-semibold',
              (now.margin ?? 0) >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)',
            )}
          >
            <CalcValue calc={marginCalc}>{formatPercent(now.margin)}</CalcValue>
          </p>
          <p className="mt-1.5 text-xs text-(--color-text-muted)">
            {marginDiff === null ? (
              'Foyda / daromad'
            ) : (
              <CalcValue calc={marginDiffCalc}>{`${marginDiff >= 0 ? '+' : ''}${marginDiff.toFixed(1).replace('.', ',')} punkt`}</CalcValue>
            )}
          </p>
        </div>
      </div>

      {/* O'sish sur'ati */}
      {growthGap !== null && (
        <div
          className={cn(
            'rounded-(--radius-card) border px-4 py-3',
            growthGap >= 0
              ? 'border-(--color-income) bg-(--color-income-soft)'
              : 'border-(--color-expense) bg-(--color-expense-soft)',
          )}
        >
          <p
            className={cn(
              'text-sm font-medium',
              growthGap >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)',
            )}
          >
            {growthGap >= 0
              ? "Daromad xarajatdan tezroq o'smoqda"
              : "Xarajat daromaddan tezroq o'smoqda"}
          </p>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            Daromad {formatPercent(incomeChange)}, xarajat {formatPercent(expenseChange)}{' '}
            &middot; farq{' '}
            <CalcValue calc={gapCalc}>{`${growthGap >= 0 ? '+' : ''}${growthGap.toFixed(1).replace('.', ',')} punkt`}</CalcValue>
          </p>
        </div>
      )}

      {/* Solishtirish jadvali */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Oldingi teng davr bilan"
          description={`${formatDate(prev.from)} \u2014 ${formatDate(prev.to)}`}
        />

        {previous.loading ? (
          <LoadingState />
        ) : (
          <Table>
            <THead>
              <Tr>
                <Th>Ko&apos;rsatkich</Th>
                <Th align="right" className="w-40">
                  Hozir
                </Th>
                <Th align="right" className="w-40">
                  Oldin
                </Th>
                <Th align="right" className="w-28">
                  O&apos;zgarish
                </Th>
              </Tr>
            </THead>

            <TBody>
              <CompareRow
                label="Daromad"
                now={now.income}
                before={before.income}
                change={incomeChange}
                good
                calc={changeCalc('Daromad', now.income, before.income, true)}
              />
              <CompareRow
                label="Xarajat"
                now={now.expense}
                before={before.expense}
                change={expenseChange}
                good={false}
                calc={changeCalc('Xarajat', now.expense, before.expense, false)}
              />
              <CompareRow
                label="Foyda"
                now={now.profit}
                before={before.profit}
                change={profitChange}
                good
                calc={changeCalc('Foyda', now.profit, before.profit, true)}
              />
            </TBody>
          </Table>
        )}
      </Card>

      {/* Tushum intizomi */}
      {paidPercent !== null && (
        <Card>
          <CardHeader
            title="Tushum"
            description="Hisoblangan daromadning qancha qismi haqiqatda tushgan"
          />
          <CardBody className="space-y-3">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-(--color-surface-sunken)">
              <div
                className="bg-(--color-income) transition-all"
                style={{ width: `${paidPercent}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                <span className="text-(--color-text-muted)">Tushgan </span>
                <Money tiyin={String(now.paid)} tone="income" className="font-medium" />
                <span className="money ml-2 text-xs text-(--color-text-faint)">
                  <CalcValue calc={paidCalc}>{formatPercent(paidPercent)}</CalcValue>
                </span>
              </span>

              <span>
                <span className="text-(--color-text-muted)">Qarzda </span>
                <CalcValue calc={debtCalc}>
                  <Money
                    tiyin={String(now.income - now.paid)}
                    tone="expense"
                    className="font-medium"
                  />
                </CalcValue>
              </span>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

// ─────── Yordamchi komponentlar ───────

function CompareBar({
  label,
  value,
  width,
  tone,
  calc,
}: {
  label: string;
  value: number;
  width: number;
  tone: 'income' | 'expense';
  calc?: Calc | null;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm text-(--color-text-muted)">{label}</span>
        <CalcValue calc={calc}>
          <Money tiyin={String(value)} tone={tone} className="text-sm font-semibold" />
        </CalcValue>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-(--color-surface-sunken)">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            tone === 'income' ? 'bg-(--color-income)' : 'bg-(--color-expense)',
          )}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function KpiCard({
  label,
  tiyin,
  tone,
  change,
  good,
  calc,
  changeCalc,
}: {
  label: string;
  tiyin: number;
  tone: 'income' | 'expense' | 'auto';
  change: number | null;
  good: boolean;
  calc?: Calc | null;
  changeCalc?: Calc | null;
}) {
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">
        {label}
      </p>
      <div className="mt-2">
        <CalcValue calc={calc}>
          <Money tiyin={String(tiyin)} tone={tone} className="block text-xl font-semibold" />
        </CalcValue>
      </div>
      <div className="mt-1.5">
        <Change percent={change} positiveIsGood={good} calc={changeCalc} />
      </div>
    </div>
  );
}

function CompareRow({
  label,
  now,
  before,
  change,
  good,
  calc,
}: {
  label: string;
  now: number;
  before: number;
  change: number | null;
  good: boolean;
  calc?: Calc | null;
}) {
  return (
    <Tr>
      <Td className="font-medium">{label}</Td>
      <Td money>
        <Money tiyin={String(now)} tone="auto" />
      </Td>
      <Td money className="text-(--color-text-muted)">
        <Money tiyin={String(before)} />
      </Td>
      <Td align="right">
        <Change percent={change} positiveIsGood={good} calc={calc} />
      </Td>
    </Tr>
  );
}