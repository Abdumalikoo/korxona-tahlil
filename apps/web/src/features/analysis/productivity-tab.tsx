'use client';

import { changeOf, DiffCell, MoneyCell, NameCell, PctCell, ReportCard, RTable, STICKY_NAME, STICKY_NO, StatTiles, TableNote, Td, Th, Tr } from '@/components/report/report';
import type { DateRange } from '@/components/shared/date-range-picker';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { regionsApi, type RegionUnit } from '@/features/regions/api';
import { SEGMENTS } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Chuqur tahlil › Xodim samaradorligi: har birlik (Markaz, viloyatlar, yo'nalishlar) — bir xodimga daromad, xarajat,
// ish haqi va natija; ish haqining xarajatdagi ulushi; o'tgan davr bilan. Manba — Solishtirma / bosh sahifa bilan bitta
// (xarajatlar siyosati hisobga olingan), shuning uchun raqamlar mos keladi. Boshqa joyda takrorlanmaydi.
// ═══════════════════════════════════════════════════════════

type Sort = 'income' | 'profit' | 'expense' | 'payroll';

interface Row {
  key: string;
  name: string;
  kind: string;
  head: number;
  prevHead: number;
  income: number | null;
  prevIncome: number | null;
  expense: number | null;
  payroll: number | null;
  profit: number | null;
  prevProfit: number | null;
  payrollShare: number | null;
}

const per = (v: number, n: number) => (n > 0 ? v / n : null);

function rowOf(u: RegionUnit): Row {
  const income = Number(u.incomeTiyin);
  const expense = Number(u.expenseTiyin);
  const prevIncome = Number(u.previousIncomeTiyin);
  const prevExpense = Number(u.previousExpenseTiyin);
  const payroll = Number(u.payrollTiyin);
  return {
    key: u.key,
    name: u.name,
    kind: u.kind,
    head: u.headcount,
    prevHead: u.previousHeadcount,
    income: per(income, u.headcount),
    prevIncome: per(prevIncome, u.previousHeadcount),
    expense: per(expense, u.headcount),
    payroll: per(payroll, u.headcount),
    profit: per(income - expense, u.headcount),
    prevProfit: per(prevIncome - prevExpense, u.previousHeadcount),
    payrollShare: expense > 0 ? (payroll / expense) * 100 : null,
  };
}

export function ProductivityTab({ range }: { range: DateRange }) {
  const res = useAsync(() => regionsApi.compare(range, 'ALL', 'prev').then((r) => r.data), [range.from, range.to]);
  const [sort, setSort] = useState<Sort>('income');

  const data = useMemo(() => {
    const units = res.data?.units ?? [];
    const order = SEGMENTS.map((s) => s.code as string);
    const withStaff = units.filter((u) => u.headcount > 0 && u.kind !== 'unassigned');
    const total = withStaff.reduce(
      (a, u) => ({ head: a.head + u.headcount, income: a.income + Number(u.incomeTiyin), expense: a.expense + Number(u.expenseTiyin), payroll: a.payroll + Number(u.payrollTiyin), prevHead: a.prevHead + u.previousHeadcount, prevIncome: a.prevIncome + Number(u.previousIncomeTiyin) }),
      { head: 0, income: 0, expense: 0, payroll: 0, prevHead: 0, prevIncome: 0 },
    );
    const center = withStaff.filter((u) => u.kind === 'center').map(rowOf);
    const regions = withStaff.filter((u) => u.kind === 'region').map(rowOf);
    const segments = withStaff.filter((u) => u.kind === 'segment').sort((a, b) => order.indexOf(a.segment ?? '') - order.indexOf(b.segment ?? '')).map(rowOf);
    return { total, center, regions, segments };
  }, [res.data]);

  if (res.error) return <Card><ErrorState message={res.error} onRetry={res.reload} /></Card>;
  if (!res.data) return <Card><LoadingState label="Hisoblanmoqda" /></Card>;

  const { total, center, regions, segments } = data;
  const value = (r: Row) => (sort === 'income' ? r.income : sort === 'profit' ? r.profit : sort === 'expense' ? r.expense : r.payroll) ?? -Infinity;
  const sortedRegions = [...regions].sort((a, b) => value(b) - value(a));
  // Viloyatlar orasida eng yaxshi / eng sust (bir xodimga daromad bo'yicha)
  const byIncome = [...regions].filter((r) => r.income !== null).sort((a, b) => b.income! - a.income!);
  const best = byIncome[0] ?? null;
  const worst = byIncome.length > 1 ? byIncome[byIncome.length - 1]! : null;
  const avgIncome = per(total.income, total.head);

  const line = (r: Row, i: number | null, indent = false) => (
    <Tr key={r.key} className={cn(best && r.key === best.key && 'bg-(--color-income-soft)/40', worst && r.key === worst.key && 'bg-(--color-expense-soft)/40')}>
      <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i ?? ''}</Td>
      <NameCell className={cn(indent && 'pl-6')} sub={r.prevHead && r.prevHead !== r.head ? `xodim: avval ${r.prevHead} → ${r.head}` : `${r.head} xodim`}>
        {r.name}
      </NameCell>
      <Td className="money text-right">{r.head}</Td>
      {r.income !== null ? <MoneyCell value={r.income} /> : <Td />}
      {r.income !== null && r.prevIncome !== null ? <DiffCell value={r.income - r.prevIncome} pct={changeOf(r.income, r.prevIncome)} /> : <Td />}
      {r.expense !== null ? <MoneyCell value={r.expense} /> : <Td />}
      {r.payroll !== null ? <MoneyCell value={r.payroll} /> : <Td />}
      <PctCell value={r.payrollShare} plain className="font-normal text-(--color-text-muted)" />
      {r.profit !== null ? <MoneyCell value={r.profit} strong signedColor /> : <Td />}
      {r.profit !== null && r.prevProfit !== null ? <DiffCell value={r.profit - r.prevProfit} pct={changeOf(r.profit, r.prevProfit)} /> : <Td />}
    </Tr>
  );

  const sortBtn = (k: Sort, label: string) => (
    <button key={k} type="button" onClick={() => setSort(k)} className={cn('rounded-md px-2.5 py-1 text-xs font-medium', sort === k ? 'bg-brand-600 text-white' : 'text-(--color-text-muted) hover:text-heading')}>
      {label}
    </button>
  );

  let n = 0;
  return (
    <div className="space-y-4">
      <StatTiles
        compareLabel="Avval"
        items={[
          { label: 'Xodimlar', value: 0, text: String(total.head), note: total.prevHead ? `avval ${total.prevHead}` : 'davrda ishlagan', tone: 'blue' },
          { label: 'Bir xodimga daromad', value: avgIncome ?? 0, previous: per(total.prevIncome, total.prevHead), tone: 'green' },
          { label: 'Bir xodimga ish haqi', value: per(total.payroll, total.head) ?? 0, tone: 'red', growthGood: false },
          { label: 'Ish haqi — xarajatning', value: 0, text: total.expense > 0 ? `${((total.payroll / total.expense) * 100).toFixed(1).replace('.', ',')}%` : '—', note: 'ish haqi ÷ jami xarajat', tone: 'purple' },
        ]}
      />
      <ReportCard
        title="Bir xodimga: daromad, xarajat, ish haqi va natija"
        badge="Birliklar kesimida · o'tgan davr bilan"
        actions={
          <span className="inline-flex items-center gap-1 rounded-lg border border-(--color-line-strong) bg-white p-0.5">
            <span className="px-1.5 text-xs text-(--color-text-muted)">Viloyatlar tartibi:</span>
            {sortBtn('income', 'daromad')}
            {sortBtn('profit', 'natija')}
            {sortBtn('expense', 'xarajat')}
            {sortBtn('payroll', 'ish haqi')}
          </span>
        }
      >
        <RTable minWidth={1040}>
          <thead>
            <tr>
              <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
              <Th className={cn(STICKY_NAME, 'z-[2] min-w-44 text-left')}>Birlik</Th>
              <Th>Xodim</Th>
              <Th>Daromad / xodim</Th>
              <Th>Farqi</Th>
              <Th>Xarajat / xodim</Th>
              <Th>Ish haqi / xodim</Th>
              <Th>Ish haqi ulushi</Th>
              <Th>Natija / xodim</Th>
              <Th>Farqi</Th>
            </tr>
          </thead>
          <tbody>
            {center.map((r) => line(r, ++n))}
            {regions.length > 0 && (
              <Tr total>
                <Td className={STICKY_NO} />
                <NameCell>Hududlar · {regions.length} viloyat</NameCell>
                <Td colSpan={8} className="text-left text-xs font-normal text-(--color-text-muted)">
                  Yashil — bir xodimga eng ko&apos;p daromad, qizil — eng kam (viloyatlar orasida)
                </Td>
              </Tr>
            )}
            {sortedRegions.map((r) => line(r, ++n, true))}
            {segments.map((r) => line(r, ++n))}
          </tbody>
        </RTable>
        <TableNote>
          Xodim — davrda ishlagan (Xodimlar bazasi va joylashuv davrlari bo&apos;yicha). Ish haqi ulushi — birlik xarajatida ish haqining hissasi: yuqori bo&apos;lsa, natija asosan xodimlar mehnatiga bog&apos;liq.
          {best && worst ? ` Bir xodimga daromad: eng yuqori — ${best.name}, eng past — ${worst.name}.` : ''}
        </TableNote>
      </ReportCard>
    </div>
  );
}
