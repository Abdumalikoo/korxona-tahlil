'use client';

import { dashboardApi } from '@/features/dashboard/api';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { calcDivide, calcMean, calcResult, calcSum, decimalText, moneyText, Q, type Calc } from '@/lib/calc';

import type { DateRange } from '@/components/shared/date-range-picker';
import { changeOf, DiffCell, ExcelButton, GroupTh, MoneyCell, NameCell, PctCell, ReportCard, RTable, StatTiles, TableNote, Td, Th, Tr } from '@/components/report/report';
import { CalcValue } from '@/components/ui/calc';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { downloadCsv, csvSom } from '@/features/structure/stats';
import { cn } from '@/lib/utils';
import { periodOf } from './range-utils';

/**
 * Vaqt davomidagi o'zgarish — oxirgi 12 oy, bitta jadvalda (grafiksiz).
 * Oraliq oxirgi oyi bo'yicha hisoblanadi: sentabr tanlansa, oktabr 2025 — sentabr 2026 ko'rsatiladi.
 * Har oy o'zidan oldingi oy bilan solishtiriladi.
 */
export function DynamicsTab({ range }: { range: DateRange }) {
  const period = periodOf(range.to);
  const trend = useAsync(() => dashboardApi.trend(12, period), [period]);

  if (trend.loading) return <LoadingState />;
  if (trend.error) return <ErrorState message={trend.error} onRetry={trend.reload} />;

  const rows = (trend.data?.data ?? []).map((row) => ({
    period: row.period,
    income: Number(row.incomeTiyin),
    expense: Number(row.expenseTiyin),
    profit: Number(row.profitTiyin),
  }));

  // Faqat harakat bo'lgan oylar statistikaga kiradi
  const active = rows.filter((row) => row.income > 0 || row.expense > 0);

  if (active.length === 0) {
    return (
      <Card>
        <EmptyState title="Oxirgi 12 oyda ma'lumot yo'q" hint="period" />
      </Card>
    );
  }

  const count = active.length;
  const totalIncome = active.reduce((sum, row) => sum + row.income, 0);
  const totalExpense = active.reduce((sum, row) => sum + row.expense, 0);
  const avgIncome = totalIncome / count;
  const avgExpense = totalExpense / count;
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
  const bestCalc = calcResult(best.income, best.expense, { title: `Eng yaxshi oy: ${formatPeriod(best.period)}` });
  const worstCalc = calcResult(worst.income, worst.expense, { title: `Eng yomon oy: ${formatPeriod(worst.period)}` });
  const ratioCalc = (p: string, income: number, expense: number): Calc => {
    const c = calcDivide(`${formatPeriod(p)}: xarajat / daromad`, Q.money('Xarajat', expense), Q.money('Daromad', income), 'ratio', {
      note: "Har 1 so'm daromadga necha so'm xarajat. 1 dan kichik — foyda.",
    });
    if (income <= 0) return c;
    const value = decimalText(expense / income, 2);
    return { ...c, steps: [...c.steps.slice(0, -1), `= ${value}`], result: value };
  };

  // Yangi oydan boshlab; har oy — o'zidan oldingi oy bilan
  const list = rows.map((row, i) => ({ ...row, prev: i > 0 ? rows[i - 1]! : null })).reverse();

  const exportCsv = () =>
    downloadCsv(
      `dinamika-12-oy-${period}`,
      ['Oy', "Daromad, so'm", "Daromad: oldingi oyga farq, so'm", 'Daromad: farq, %', "Xarajat, so'm", "Xarajat: oldingi oyga farq, so'm", 'Xarajat: farq, %', "Foyda, so'm", 'Xarajat / daromad'],
      [
        ...list.map((r) => {
          const pi = r.prev?.income ?? 0;
          const pe = r.prev?.expense ?? 0;
          const ci = changeOf(r.income, pi);
          const ce = changeOf(r.expense, pe);
          return [
            formatPeriod(r.period),
            csvSom(r.income),
            r.prev ? csvSom(r.income - pi) : '',
            ci === null ? '' : ci.toFixed(1).replace('.', ','),
            csvSom(r.expense),
            r.prev ? csvSom(r.expense - pe) : '',
            ce === null ? '' : ce.toFixed(1).replace('.', ','),
            csvSom(r.profit),
            r.income > 0 ? (r.expense / r.income).toFixed(2).replace('.', ',') : '',
          ];
        }),
        ['Jami (12 oy)', csvSom(totalIncome), '', '', csvSom(totalExpense), '', '', csvSom(totalIncome - totalExpense), totalIncome > 0 ? (totalExpense / totalIncome).toFixed(2).replace('.', ',') : ''],
      ],
    );

  const first = rows[0]!.period;
  const last = rows[rows.length - 1]!.period;

  return (
    <div className="space-y-4">
      <StatTiles
        items={[
          { label: "O'rtacha oylik daromad", value: Math.round(avgIncome), tone: 'green', note: `${count} oy bo'yicha`, calc: avgIncomeCalc },
          { label: "O'rtacha oylik xarajat", value: Math.round(avgExpense), tone: 'red', note: `${count} oy bo'yicha`, calc: avgExpenseCalc },
          { label: 'Foydali oylar', value: 0, text: `${profitable} / ${count}`, note: profitable === count ? 'Hamma oy foydada' : `${count - profitable} oy zararda`, tone: 'blue', calc: profitableCalc },
          { label: 'Eng yaxshi oy', value: 0, text: formatPeriod(best.period), note: `Foyda ${moneyText(best.profit)}`, tone: 'cyan', calc: bestCalc },
          { label: 'Eng yomon oy', value: 0, text: formatPeriod(worst.period), note: `${worst.profit < 0 ? 'Zarar' : 'Foyda'} ${moneyText(worst.profit)}`, tone: 'orange', calc: worstCalc },
        ]}
      />

      <ReportCard title="Oyma-oy: daromad, xarajat va natija" badge={`${formatPeriod(first)} — ${formatPeriod(last)} · har oy oldingi oy bilan`} actions={<ExcelButton onClick={exportCsv} />}>
        <RTable minWidth={1040}>
          <thead>
            <tr>
              <Th rowSpan={2} className="min-w-36 text-left">
                Oy
              </Th>
              <GroupTh span={3}>Daromad</GroupTh>
              <GroupTh span={3}>Xarajat</GroupTh>
              <GroupTh span={2}>Natija</GroupTh>
            </tr>
            <tr>
              <Th className="first:border-l">Summa</Th>
              <Th>Oldingi oyga farq</Th>
              <Th>Foizda</Th>
              <Th>Summa</Th>
              <Th>Oldingi oyga farq</Th>
              <Th>Foizda</Th>
              <Th>Foyda</Th>
              <Th>Xarajat / daromad</Th>
            </tr>
          </thead>
          <tbody>
            <Tr total>
              <NameCell sticky={false} sub={`${count} oy`}>
                Jami
              </NameCell>
              <MoneyCell value={totalIncome} calc={calcSum('Jami daromad', active.map((r) => Q.money(formatPeriod(r.period), r.income)))} />
              <Td />
              <Td />
              <MoneyCell value={totalExpense} calc={calcSum('Jami xarajat', active.map((r) => Q.money(formatPeriod(r.period), r.expense)))} />
              <Td />
              <Td />
              <MoneyCell value={totalIncome - totalExpense} signedColor calc={calcResult(totalIncome, totalExpense, { title: 'Jami natija (12 oy)' })} />
              <RatioCell income={totalIncome} expense={totalExpense} />
            </Tr>
            {list.map((r) => {
              const empty = r.income === 0 && r.expense === 0;
              return (
                <Tr key={r.period} className={cn(empty && 'opacity-45')}>
                  <NameCell sticky={false}>{formatPeriod(r.period)}</NameCell>
                  <MoneyCell value={r.income} />
                  {r.prev ? <DiffCell value={r.income - r.prev.income} /> : <Td className="text-(--color-text-faint)"></Td>}
                  <PctCell value={r.prev ? changeOf(r.income, r.prev.income) : null} />
                  <MoneyCell value={r.expense} />
                  {r.prev ? <DiffCell value={r.expense - r.prev.expense} growthGood={false} /> : <Td className="text-(--color-text-faint)"></Td>}
                  <PctCell value={r.prev ? changeOf(r.expense, r.prev.expense) : null} growthGood={false} />
                  <MoneyCell value={r.profit} strong signedColor calc={empty ? null : calcResult(r.income, r.expense, { title: `${formatPeriod(r.period)}: foyda` })} />
                  <RatioCell income={r.income} expense={r.expense} calc={r.income > 0 ? ratioCalc(r.period, r.income, r.expense) : null} />
                </Tr>
              );
            })}
          </tbody>
        </RTable>
        <TableNote>Yangi oydan boshlab. Xarajat / daromad — har 1 so&apos;m daromadga necha so&apos;m xarajat: 1 dan kichik — foyda (yashil), katta — zarar (qizil).</TableNote>
      </ReportCard>
    </div>
  );
}

function RatioCell({ income, expense, calc }: { income: number; expense: number; calc?: Calc | null }) {
  const ratio = income > 0 ? expense / income : null;
  return (
    <Td>
      {ratio === null ? (
        <span className="text-(--color-text-faint)"></span>
      ) : (
        <span className={cn('inline-block min-w-12 rounded-full px-2 py-0.5 text-xs font-semibold', ratio < 1 ? 'bg-[#e3f5ea] text-[#0b7a3b]' : 'bg-[#fdecec] text-[#c22f34]')}>
          <CalcValue calc={calc} className="no-underline">
            {ratio.toFixed(2).replace('.', ',')}
          </CalcValue>
        </span>
      )}
    </Td>
  );
}
