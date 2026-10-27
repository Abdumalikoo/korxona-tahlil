'use client';

import { expensesApi } from '@/features/expenses/api';
import { incomesApi } from '@/features/incomes/api';
import { formatDate } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { calcChange, calcDiff, calcDivide, calcMargin, calcPp, calcRecords, calcResult, calcShare, decimalText, Q, type Calc } from '@/lib/calc';

import type { DateRange } from '@/components/shared/date-range-picker';
import { DiffCell, GroupTh, MoneyCell, NameCell, PctCell, ReportCard, RTable, StatTiles, TableNote, Td, Th, Tr } from '@/components/report/report';
import { CalcValue } from '@/components/ui/calc';
import { ErrorState, LoadingState } from '@/components/ui/states';
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

const pctText = (v: number | null) => (v === null ? '' : `${v.toFixed(1).replace('.', ',')}%`);
const ppText = (v: number | null) => (v === null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} punkt`);

/**
 * Umumiy holat — korxona foydada ishlayaptimi.
 * Tanlangan oraliq unga teng oldingi davr bilan solishtiriladi: kartalar va bitta jadval.
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

  const costRatio = now.income > 0 ? now.expense / now.income : null;
  const costRatioBefore = before.income > 0 ? before.expense / before.income : null;
  const paidPercent = now.income > 0 ? (now.paid / now.income) * 100 : null;
  const paidPercentBefore = before.income > 0 ? (before.paid / before.income) * 100 : null;

  const incomeChange = percentChange(now.income, before.income);
  const expenseChange = percentChange(now.expense, before.expense);
  const marginDiff = now.margin !== null && before.margin !== null ? now.margin - before.margin : null;
  const growthGap = incomeChange !== null && expenseChange !== null ? incomeChange - expenseChange : null;

  // ─────── «Qanday hisoblandi?» ───────
  const periodText = `${formatDate(range.from)} — ${formatDate(range.to)}`;
  const prevText = `${formatDate(prev.from)} — ${formatDate(prev.to)}`;
  const prevLabel = `Oldingi teng davr (${prevText})`;
  const incomeCalc = calcRecords('Daromad', now.income, current.data?.[0].meta.total, periodText, "Daromadlar ro'yxati");
  const expenseCalc = calcRecords('Xarajat', now.expense, current.data?.[1].meta.total, periodText, "Xarajatlar ro'yxati");
  const profitCalc = calcResult(now.income, now.expense, { title: 'Foyda', note: periodText });
  const marginCalc = calcMargin(now.income, now.expense, { note: periodText });
  const costCalc: Calc | null = (() => {
    if (now.income <= 0) return null;
    const c = calcDivide("Har 1 so'm daromadga xarajat", Q.money('Xarajat', now.expense), Q.money('Daromad', now.income), 'ratio', {
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
          note: "Musbat — daromad xarajatdan tezroq o'smoqda.",
        })
      : null;
  const paidCalc = calcShare('Tushgan ulushi', Q.money('Tushgan', now.paid, "Daromad yozuvlaridagi «to'langan» summa"), Q.money('Hisoblangan daromad', now.income));
  const debtCalc = calcDiff('Qarzda', Q.money('Hisoblangan daromad', now.income), Q.money('Tushgan', now.paid));

  const loadingPrev = previous.loading;
  const row = (label: string, a: number, b: number, good: boolean, opts: { calc?: Calc | null; total?: boolean; signed?: boolean; sub?: string } = {}) => (
    <Tr total={opts.total}>
      <NameCell sticky={false} sub={opts.sub}>
        {label}
      </NameCell>
      <MoneyCell value={b} className="text-(--color-text-muted)" signedColor={opts.signed} />
      <MoneyCell value={a} strong calc={opts.calc} signedColor={opts.signed} />
      <DiffCell value={a - b} growthGood={good} calc={changeCalc(label, a, b, good)} />
      <PctCell value={percentChange(a, b)} growthGood={good} />
    </Tr>
  );
  const ratioRow = (label: string, a: number | null, b: number | null, text: (v: number | null) => string, goodUp: boolean, calc?: Calc | null, diffCalc?: Calc | null, sub?: string) => {
    const diff = a !== null && b !== null ? a - b : null;
    const good = diff === null || Math.abs(diff) < 0.005 ? null : diff > 0 === goodUp;
    return (
      <Tr muted>
        <NameCell sticky={false} sub={sub}>
          {label}
        </NameCell>
        <Td className="text-(--color-text-muted)">{text(b)}</Td>
        <Td className="font-semibold text-heading">
          <CalcValue calc={calc} className="no-underline">
            {text(a)}
          </CalcValue>
        </Td>
        <Td className={cn('font-semibold', good === null ? 'text-(--color-text-faint)' : good ? 'text-(--color-income)' : 'text-(--color-expense)')}>
          <CalcValue calc={diffCalc} className="no-underline">
            {diff === null ? '' : label.startsWith('Har 1') ? `${diff > 0 ? '+' : ''}${diff.toFixed(2).replace('.', ',')}` : ppText(diff)}
          </CalcValue>
        </Td>
        <Td className="text-(--color-text-faint)"></Td>
      </Tr>
    );
  };

  return (
    <div className="space-y-4">
      <StatTiles
        compareLabel="Avval"
        items={[
          { label: 'Daromad', value: now.income, previous: before.income, tone: 'green', calc: incomeCalc },
          { label: 'Xarajat', value: now.expense, previous: before.expense, growthGood: false, tone: 'red', calc: expenseCalc },
          { label: now.profit >= 0 ? 'Foyda' : 'Zarar', value: now.profit, previous: before.profit, signed: true, tone: 'blue', calc: profitCalc },
          {
            label: 'Rentabellik',
            value: 0,
            text: pctText(now.margin),
            note: marginDiff === null ? 'Foyda / daromad' : `Oldingi davrga ${ppText(marginDiff)}`,
            tone: 'purple',
            calc: marginCalc,
          },
          {
            label: 'Xarajat / daromad',
            value: 0,
            text: costRatio === null ? '' : `${costRatio.toFixed(2).replace('.', ',')} so'm`,
            note: costRatio === null ? "Daromad yo'q" : costRatio < 1 ? "1 dan kichik — foydada" : "1 dan katta — zararda",
            tone: costRatio !== null && costRatio >= 1 ? 'red' : 'cyan',
            calc: costCalc,
          },
        ]}
      />

      {growthGap !== null && (
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-2 rounded-2xl px-5 py-3 text-sm shadow-card',
            growthGap >= 0 ? 'bg-[#e3f5ea] text-[#0b7a3b]' : 'bg-[#fdecec] text-[#c22f34]',
          )}
        >
          <span className="font-semibold">{growthGap >= 0 ? "Daromad xarajatdan tezroq o'smoqda" : "Xarajat daromaddan tezroq o'smoqda"}</span>
          <span className="text-xs">
            Daromad {pctText(incomeChange)}, xarajat {pctText(expenseChange)} · farq{' '}
            <CalcValue calc={gapCalc} className="font-semibold">
              {ppText(growthGap)}
            </CalcValue>
          </span>
        </div>
      )}

      <ReportCard title="Korxona holati: oldingi teng davr bilan" badge={`Joriy: ${periodText} · oldingi: ${prevText}`}>
        {loadingPrev ? (
          <LoadingState />
        ) : (
          <RTable minWidth={760}>
            <thead>
              <tr>
                <Th rowSpan={2} className="min-w-60 text-left">
                  Ko&apos;rsatkich
                </Th>
                <GroupTh span={2}>Summa</GroupTh>
                <GroupTh span={2}>O&apos;zgarish</GroupTh>
              </tr>
              <tr>
                <Th className="first:border-l">Oldingi davr</Th>
                <Th>Joriy davr</Th>
                <Th>Farqi</Th>
                <Th>Foizda</Th>
              </tr>
            </thead>
            <tbody>
              {row(now.profit >= 0 ? 'Foyda' : 'Zarar', now.profit, before.profit, true, { calc: profitCalc, total: true, signed: true })}
              {row('Daromad (hisoblangan)', now.income, before.income, true, { calc: incomeCalc })}
              {row('Xarajat', now.expense, before.expense, false, { calc: expenseCalc })}
              {row('Tushgan daromad', now.paid, before.paid, true, { sub: "Daromad yozuvlaridagi «to'langan» summa" })}
              {row('Qarzda (tushmagan)', now.income - now.paid, before.income - before.paid, false, { calc: debtCalc })}
              {ratioRow('Rentabellik', now.margin, before.margin, pctText, true, marginCalc, marginDiffCalc, 'Foyda / daromad')}
              {ratioRow('Tushgan ulushi', paidPercent, paidPercentBefore, pctText, true, paidCalc, null, 'Tushgan / hisoblangan daromad')}
              {ratioRow(
                "Har 1 so'm daromadga xarajat",
                costRatio,
                costRatioBefore,
                (v) => (v === null ? '' : `${v.toFixed(2).replace('.', ',')} so'm`),
                false,
                costCalc,
                null,
                '1 dan kichik — foyda',
              )}
            </tbody>
          </RTable>
        )}
        <TableNote>Oldingi davr — tanlangan oraliqqa teng uzunlikdagi undan oldingi davr. Raqamni bosing — qanday hisoblangani ko&apos;rinadi.</TableNote>
      </ReportCard>
    </div>
  );
}
