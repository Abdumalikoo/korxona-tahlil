'use client';

import { PillTabs, ReportCard, StatTiles, sum, TableNote } from '@/components/report/report';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { regionsApi, statsOf, type UnitStats } from '@/features/regions/api';
import { useAuth } from '@/lib/auth-context';
import { calcResult, calcSum, Q } from '@/lib/calc';
import { formatDate } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { StructureDrill } from '@/features/dashboard/structure-drill';
import { hisobApi } from '@/features/qomita/api';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Solishtirma — korxona bir qarashda (avvalgi Bosh sahifa):
 *  • tepada — daromad, xarajat, natija, rentabellik (o'tgan teng davr bilan);
 *  • «Daromad tarkibi» / «Xarajat tarkibi» — Markaz, Hudud (viloyatlar yoki xizmat turlari), 4 yo'nalish — shu sahifada ichma-ich;
 *  • birliklar natijasi — Bosh sahifada, oyma-oy natija — Tahlil › Dinamikada (kartalarni bosib o'tiladi).
 * Ma'lumot Bosh sahifa bilan bir manbadan (bir xil raqamlar).
 */

type View = 'income' | 'expense';

interface Totals {
  income: number;
  expense: number;
  previousIncome: number;
  previousExpense: number;
}

function totalsOf(rows: UnitStats[]): Totals {
  return rows.reduce(
    (a, s) => ({ income: a.income + s.income, expense: a.expense + s.expense, previousIncome: a.previousIncome + s.previousIncome, previousExpense: a.previousExpense + s.previousExpense }),
    { income: 0, expense: 0, previousIncome: 0, previousExpense: 0 },
  );
}


export default function SolishtirmaPage() {
  const { user } = useAuth();
  /** Davr — yuqori paneldagi «Davr» tugmasidan (hamma bo'lim uchun bitta) */
  const { range } = usePeriod();
  const router = useRouter();
  const [view, setView] = useState<View>('income');
  const result = useAsync(() => regionsApi.compare(range, 'ALL', 'prev').then((r) => r.data), [range.from, range.to]);
  // Qo'mita pullari sarfi (3802 + Marksheyder, shablon bo'yicha) — xarajat tarkibida ma'lumot qatori; o'tgan davr bilan
  const prevFrom = result.data?.previousRange.from.slice(0, 7) ?? null;
  const qomita = useAsync(() => (prevFrom ? hisobApi.ledger(prevFrom < range.from.slice(0, 7) ? prevFrom : range.from.slice(0, 7), range.to.slice(0, 7)).then((r) => r.data) : Promise.resolve(null)), [prevFrom, range.from, range.to]);
  const data = result.data;

  const period = `${formatDate(range.from)} — ${formatDate(range.to)}`;
  const query = `?dateFrom=${range.from}&dateTo=${range.to}`;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-heading">Solishtirma · korxona bir qarashda</h1>
          <p className="text-sm text-(--color-text-muted)">
            {user?.fullName ? `${user.fullName} · ` : ''}
            {period}
          </p>
        </div>
      </div>

      <PeriodDataHint />

      {result.error ? (
        <Card>
          <ErrorState message={result.error} onRetry={result.reload} />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingState label="Hisoblanmoqda" />
        </Card>
      ) : (
        (() => {
          const all = data.units.map(statsOf);
          const t = totalsOf(all);
          const profit = t.income - t.expense;
          const previousProfit = t.previousIncome - t.previousExpense;
          /** Oldingi davrda ma'lumot bormi (yo'q bo'lsa — solishtirish o'rniga ulush) */
          const cmpOn = t.previousIncome !== 0 || t.previousExpense !== 0;
          const margin = t.income > 0 ? (profit / t.income) * 100 : null;
          const previousMargin = t.previousIncome > 0 ? (previousProfit / t.previousIncome) * 100 : null;
          // Ma'lumot yuklanmagan: o'tgan davrda bor, joriy davrda umuman yo'q — «0» va «100%» o'rniga «yuklanmagan»,
          // natija va rentabellik hisoblanmaydi (noto'g'ri xulosa chiqmasin)
          const incomeMissing = t.income === 0 && t.previousIncome > 0;
          const expenseMissing = t.expense === 0 && t.previousExpense > 0;
          const partial = incomeMissing || expenseMissing;


          return (
            <div className={cn('space-y-4 transition-opacity', result.loading && 'opacity-60')}>
              {partial && (
                <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                  <b>{[incomeMissing && 'Daromadlar', expenseMissing && 'Xarajatlar'].filter(Boolean).join(' va ')}</b> tanlangan davr uchun hali yuklanmagan — foyda va rentabellik
                  hisoblanmadi. O&apos;tgan teng davrda {expenseMissing ? `xarajat ${sum(t.previousExpense)} so'm` : `daromad ${sum(t.previousIncome)} so'm`} edi.
                </p>
              )}
              <StatTiles
                compareLabel="Avval"
                items={[
                  {
                    label: 'Daromad',
                    value: t.income,
                    previous: t.previousIncome,
                    missing: incomeMissing,
                    note: incomeMissing ? `Avval ${sum(t.previousIncome)} so'm` : undefined,
                    tone: 'green',
                    icon: <IconUp />,
                    calc: calcSum('Daromad', all.map((s) => Q.money(s.unit.name, s.income))),
                    onClick: () => router.push(`/tahlil/daromad${query}`),
                  },
                  {
                    label: 'Xarajat',
                    value: t.expense,
                    previous: t.previousExpense,
                    missing: expenseMissing,
                    note: expenseMissing ? `Avval ${sum(t.previousExpense)} so'm` : undefined,
                    growthGood: false,
                    tone: 'red',
                    icon: <IconDown />,
                    calc: calcSum('Xarajat', all.map((s) => Q.money(s.unit.name, s.expense))),
                    onClick: () => router.push(`/tahlil/xarajat${query}`),
                  },
                  {
                    label: partial ? 'Natija' : profit >= 0 ? 'Foyda' : 'Zarar',
                    value: profit,
                    previous: partial ? null : previousProfit,
                    text: partial ? '—' : undefined,
                    note: partial ? 'hisoblanmadi — ma’lumot to‘liq emas' : undefined,
                    signed: true,
                    tone: 'blue',
                    calc: calcResult(t.income, t.expense, { title: 'Korxona natijasi' }),
                    onClick: () => router.push(`/tahlil/umumiy${query}`),
                  },
                  {
                    label: 'Rentabellik',
                    value: 0,
                    text: partial || margin === null ? '—' : `${margin.toFixed(1).replace('.', ',')}%`,
                    note: partial ? 'hisoblanmadi — ma’lumot to‘liq emas' : previousMargin === null ? 'Foyda ÷ daromad' : `Avval ${previousMargin.toFixed(1).replace('.', ',')}%`,
                    tone: 'purple',
                  },
                ]}
              />

              <PillTabs
                value={view}
                onChange={setView}
                options={[
                  { value: 'income', label: 'Daromad tarkibi', hint: 'Markaz, Hudud (viloyatlar / xizmat turlari), yo‘nalishlar — ichma-ich' },
                  { value: 'expense', label: 'Xarajat tarkibi', hint: 'Markaz, Hudud (viloyatlar / moddalar), yo‘nalishlar — ichma-ich' },
                ]}
              />

              <ReportCard
                title={view === 'income' ? 'Daromad tarkibi' : 'Xarajat tarkibi'}
                badge={cmpOn ? `Joriy: ${period} · o'tgan teng davr: ${formatDate(data.previousRange.from)} — ${formatDate(data.previousRange.to)}` : period}
              >
                <StructureDrill
                  key={`${view}|${range.from}|${range.to}`}
                  units={data.units}
                  range={range}
                  kind={view}
                  cmpOn={cmpOn}
                  info={
                    view === 'expense' && qomita.data
                      ? (() => {
                          const q = qomita.data;
                          const spend = (a: string, b: string) => q.months.reduce((t, p, i) => (p >= a && p <= b ? t + Number(q.pool.months[i]!.spendTiyin) + Number(q.marksheyder.months[i]!.spendTiyin) : t), 0);
                          const cur = spend(range.from.slice(0, 7), range.to.slice(0, 7));
                          const prev = spend(data.previousRange.from.slice(0, 7), data.previousRange.to.slice(0, 7));
                          return { label: "Qo'mita pullarining sarfi", sub: "3802 + Marksheyder · ish haqida bor, jamiga qo'shilmagan", cur, prev, onClick: () => router.push('/tahlil/qomita') };
                        })()
                      : null
                  }
                />
                <TableNote>
                  Qatorni bosing — ichma-ich oxirigacha ochiladi: Markaz → bo&apos;limlar → tarkib va xodimlar → oylar; Hudud → viloyatlar → tumanlar →
                  {view === 'income' ? ' xizmatlar' : ' moddalar va xodimlar → oylar'}; modda → kontragent → yozuvlar; yo&apos;nalishlar → tuzilmalar → oylar. «yozuvlar» — shu summani tashkil
                  qilgan hujjatlar. Hudud ostidagi tugma — «{view === 'income' ? 'Xizmat turlari' : 'Moddalar'} bo&apos;yicha» (har biri — viloyatlar kesimida).
                </TableNote>
              </ReportCard>
            </div>
          );
        })()
      )}
    </div>
  );
}

function IconUp() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
    </svg>
  );
}

function IconDown() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7l6 6 4-4 8 8M15 17h6v-6" />
    </svg>
  );
}
