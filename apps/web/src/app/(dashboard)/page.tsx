'use client';

import {
  changeOf,
  DiffCell,
  GroupTh,
  MoneyCell,
  NameCell,
  PctCell,
  PillTabs,
  ReportCard,
  RTable,
  StatTiles,
  STICKY_NAME,
  STICKY_NO,
  TableNote,
  Td,
  Th,
  Tr,
} from '@/components/report/report';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { regionsApi, statsOf, type UnitStats } from '@/features/regions/api';
import { useAuth } from '@/lib/auth-context';
import { calcResult, calcSum, Q } from '@/lib/calc';
import { formatDate, formatPeriod } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { unitByCode } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Bosh sahifa — korxona bir qarashda:
 *  • tepada — daromad, xarajat, natija, rentabellik (o'tgan teng davr bilan);
 *  • «Korxona tarkibi» — hududlar, Markaz va yo'nalishlar bitta jadvalda (bosib ichiga kiriladi);
 *  • «Oylar kesimida» — so'nggi 12 oy: daromad, xarajat, natija.
 * Ma'lumot Solishtirma bilan bir manbadan (bir xil raqamlar).
 */

type View = 'units' | 'months';

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

/** base — solishtirish yo'q bo'lsa: ulush hisoblanadigan jami (korxona bo'yicha) */
function Cells({ t, base }: { t: Totals; base: Totals | null }) {
  const profit = t.income - t.expense;
  if (base) {
    return (
      <>
        <MoneyCell value={t.income} />
        <PctCell value={base.income > 0 ? (t.income / base.income) * 100 : null} plain className="font-normal text-(--color-text-muted)" />
        <MoneyCell value={t.expense} />
        <PctCell value={base.expense > 0 ? (t.expense / base.expense) * 100 : null} plain className="font-normal text-(--color-text-muted)" />
        <MoneyCell value={profit} strong signedColor calc={calcResult(t.income, t.expense)} />
        <PctCell value={t.income > 0 ? (profit / t.income) * 100 : null} plain />
      </>
    );
  }
  return (
    <>
      <MoneyCell value={t.previousIncome} />
      <MoneyCell value={t.income} />
      <DiffCell value={t.income - t.previousIncome} pct={changeOf(t.income, t.previousIncome)} />
      <MoneyCell value={t.previousExpense} />
      <MoneyCell value={t.expense} />
      <DiffCell value={t.expense - t.previousExpense} pct={changeOf(t.expense, t.previousExpense)} growthGood={false} />
      <MoneyCell value={profit} strong signedColor calc={calcResult(t.income, t.expense)} />
      <PctCell value={t.income > 0 ? (profit / t.income) * 100 : null} plain />
    </>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  /** Davr — yuqori paneldagi «Davr» tugmasidan (hamma bo'lim uchun bitta) */
  const { range } = usePeriod();
  const router = useRouter();
  const [view, setView] = useState<View>('units');
  const result = useAsync(() => regionsApi.compare(range, 'ALL', 'prev').then((r) => r.data), [range.from, range.to]);
  const data = result.data;

  const period = `${formatDate(range.from)} — ${formatDate(range.to)}`;
  const query = `?dateFrom=${range.from}&dateTo=${range.to}`;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-heading">Korxona bir qarashda</h1>
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
          const regions = all.filter((s) => s.unit.kind === 'region');
          const center = all.find((s) => s.unit.kind === 'center') ?? null;
          const segments = all.filter((s) => s.unit.kind === 'segment');
          const unassigned = all.find((s) => s.unit.kind === 'unassigned') ?? null;
          const t = totalsOf(all);
          const r = totalsOf(regions);
          const profit = t.income - t.expense;
          const previousProfit = t.previousIncome - t.previousExpense;
          /** Oldingi davrda ma'lumot bormi (yo'q bo'lsa — solishtirish o'rniga ulush) */
          const cmpOn = t.previousIncome !== 0 || t.previousExpense !== 0;
          const margin = t.income > 0 ? (profit / t.income) * 100 : null;
          const previousMargin = t.previousIncome > 0 ? (previousProfit / t.previousIncome) * 100 : null;

          // So'nggi 12 oy — barcha birliklar yig'indisi
          const months = data.months.slice(-12);
          const offset = data.months.length - months.length;
          const monthRows = months.map((m, i) => {
            const income = all.reduce((a, s) => a + Number(s.unit.incomeTrend[offset + i] ?? 0), 0);
            const expense = all.reduce((a, s) => a + Number(s.unit.expenseTrend[offset + i] ?? 0), 0);
            return { month: m, income, expense };
          });
          const monthTotal = monthRows.reduce((a, x) => ({ income: a.income + x.income, expense: a.expense + x.expense }), { income: 0, expense: 0 });

          const unitRows: { key: string; label: string; sub: string; t: Totals; href: string | null }[] = [
            { key: 'regions', label: `Hududlar · ${regions.length} ta`, sub: 'viloyatlar → tumanlar → xodimlar', t: r, href: '/solishtirma' },
            ...(center ? [{ key: 'center', label: 'Markaz', sub: "bo'limlar va xodimlar", t: center, href: '/solishtirma/markaz' }] : []),
            ...segments.map((s) => {
              const u = s.unit.segment ? unitByCode(s.unit.segment) : null;
              return { key: s.unit.key, label: s.unit.name, sub: "yo'nalish", t: s as Totals, href: u ? `/solishtirma/${u.slug}` : null };
            }),
            ...(unassigned ? [{ key: 'unassigned', label: unassigned.unit.name, sub: 'hudud belgilanmagan yozuvlar', t: unassigned as Totals, href: '/solishtirma' }] : []),
          ];

          return (
            <div className={cn('space-y-4 transition-opacity', result.loading && 'opacity-60')}>
              <StatTiles
                compareLabel="Avval"
                items={[
                  {
                    label: 'Daromad',
                    value: t.income,
                    previous: t.previousIncome,
                    tone: 'green',
                    icon: <IconUp />,
                    calc: calcSum('Daromad', all.map((s) => Q.money(s.unit.name, s.income))),
                    onClick: () => router.push(`/tahlil/daromad${query}`),
                  },
                  {
                    label: 'Xarajat',
                    value: t.expense,
                    previous: t.previousExpense,
                    growthGood: false,
                    tone: 'red',
                    icon: <IconDown />,
                    calc: calcSum('Xarajat', all.map((s) => Q.money(s.unit.name, s.expense))),
                    onClick: () => router.push(`/tahlil/xarajat${query}`),
                  },
                  {
                    label: profit >= 0 ? 'Foyda' : 'Zarar',
                    value: profit,
                    previous: previousProfit,
                    signed: true,
                    tone: 'blue',
                    calc: calcResult(t.income, t.expense, { title: 'Korxona natijasi' }),
                    onClick: () => router.push(`/tahlil/umumiy${query}`),
                  },
                  {
                    label: 'Rentabellik',
                    value: 0,
                    text: margin === null ? '' : `${margin.toFixed(1).replace('.', ',')}%`,
                    note: previousMargin === null ? 'Foyda ÷ daromad' : `Avval ${previousMargin.toFixed(1).replace('.', ',')}%`,
                    tone: 'purple',
                  },
                ]}
              />

              <PillTabs
                value={view}
                onChange={setView}
                options={[
                  { value: 'units', label: 'Korxona tarkibi', hint: 'Hududlar, Markaz va yo‘nalishlar' },
                  { value: 'months', label: 'Oylar kesimida', hint: "So'nggi 12 oy" },
                ]}
              />

              {view === 'units' ? (
                <ReportCard title="Korxona tarkibi: daromad, xarajat va natija" badge={cmpOn ? `Joriy: ${period} · o'tgan teng davr: ${formatDate(data.previousRange.from)} — ${formatDate(data.previousRange.to)}` : period}>
                  <RTable minWidth={cmpOn ? 980 : 820}>
                    <thead>
                      <tr>
                        <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>№</Th>
                        <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>Birlik</Th>
                        <GroupTh span={cmpOn ? 3 : 2}>Daromad</GroupTh>
                        <GroupTh span={cmpOn ? 3 : 2}>Xarajat</GroupTh>
                        <GroupTh span={2}>Natija</GroupTh>
                      </tr>
                      {cmpOn ? (
                        <tr>
                          <Th className="first:border-l">O&apos;tgan davr</Th>
                          <Th>Joriy davr</Th>
                          <Th>Farqi, foizda</Th>
                          <Th>O&apos;tgan davr</Th>
                          <Th>Joriy davr</Th>
                          <Th>Farqi, foizda</Th>
                          <Th>Foyda</Th>
                          <Th>Rentabellik</Th>
                        </tr>
                      ) : (
                        <tr>
                          <Th className="first:border-l">Summa</Th>
                          <Th>Ulushi</Th>
                          <Th>Summa</Th>
                          <Th>Ulushi</Th>
                          <Th>Foyda</Th>
                          <Th>Rentabellik</Th>
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      <Tr total>
                        <Td className={STICKY_NO} />
                        <NameCell>Korxona bo&apos;yicha</NameCell>
                        <Cells t={t} base={cmpOn ? null : t} />
                      </Tr>
                      {unitRows.map((row, i) => (
                        <Tr key={row.key} onClick={row.href ? () => router.push(row.href!) : undefined}>
                          <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                          <NameCell drill={Boolean(row.href)} sub={row.sub}>
                            {row.label}
                          </NameCell>
                          <Cells t={row.t} base={cmpOn ? null : t} />
                        </Tr>
                      ))}
                    </tbody>
                  </RTable>
                  <TableNote>
                    {!cmpOn && "O'tgan teng davr uchun ma'lumot yo'q — solishtirish o'rniga ulush ko'rsatildi (korxona jamiga nisbatan). "}
                    Qatorni bosing — Solishtirmada ichiga kirasiz. Yuqoridagi kartalarni bosing — daromad, xarajat yoki natija tahlili ochiladi.</TableNote>
                </ReportCard>
              ) : (
                <ReportCard title="Oylar kesimida" badge={`${formatPeriod(months[0]!)} — ${formatPeriod(months[months.length - 1]!)}`}>
                  <RTable minWidth={900}>
                    <thead>
                      <tr>
                        <Th className="text-left">Oy</Th>
                        <Th>Daromad</Th>
                        <Th>O&apos;zgarish</Th>
                        <Th>Xarajat</Th>
                        <Th>O&apos;zgarish</Th>
                        <Th>Natija</Th>
                        <Th>Rentabellik</Th>
                      </tr>
                    </thead>
                    <tbody>
                      <Tr total>
                        <NameCell sticky={false}>12 oy jami</NameCell>
                        <MoneyCell value={monthTotal.income} />
                        <Td />
                        <MoneyCell value={monthTotal.expense} />
                        <Td />
                        <MoneyCell value={monthTotal.income - monthTotal.expense} strong signedColor />
                        <PctCell value={monthTotal.income > 0 ? ((monthTotal.income - monthTotal.expense) / monthTotal.income) * 100 : null} plain />
                      </Tr>
                      {[...monthRows].reverse().map((m) => {
                        const index = monthRows.indexOf(m);
                        const prev = index > 0 ? monthRows[index - 1]! : null;
                        return (
                          <Tr key={m.month}>
                            <NameCell sticky={false}>{formatPeriod(m.month)}</NameCell>
                            <MoneyCell value={m.income} />
                            {prev ? <DiffCell value={m.income - prev.income} pct={changeOf(m.income, prev.income)} /> : <Td />}
                            <MoneyCell value={m.expense} />
                            {prev ? <DiffCell value={m.expense - prev.expense} pct={changeOf(m.expense, prev.expense)} growthGood={false} /> : <Td />}
                            <MoneyCell value={m.income - m.expense} strong signedColor />
                            <PctCell value={m.income > 0 ? ((m.income - m.expense) / m.income) * 100 : null} plain />
                          </Tr>
                        );
                      })}
                    </tbody>
                  </RTable>
                  <TableNote>O&apos;zgarish — oldingi oyga nisbatan. Oxirgi oy tanlangan davr oxirigacha hisoblanadi.</TableNote>
                </ReportCard>
              )}
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
