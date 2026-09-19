'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAsync } from '@/lib/use-async';
import { dashboardApi } from '@/features/dashboard/api';
import { formatPeriod, formatPercent, formatTiyin, formatDate } from '@/lib/format';

import { PageHeader } from '@/components/layout/page-header';
import {
  DateRangePicker,
  defaultRange,
  type DateRange,
} from '@/components/shared/date-range-picker';
import { LineChart } from '@/components/shared/line-chart';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Money, Change } from '@/components/ui/money';
import { Table, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { cn } from '@/lib/utils';

export default function GeneralAnalysisPage() {
  const searchParams = useSearchParams();

  const [range, setRange] = useState<DateRange>(() => {
    const from = searchParams.get("dateFrom");
    const to = searchParams.get("dateTo");
    return from && to ? { from, to } : defaultRange();
  });

  // Solishtirish uchun oxirgi oy
  const period = range.to.slice(0, 7);

  const overview = useAsync(() => dashboardApi.overview(period), [period]);
  const trend = useAsync(() => dashboardApi.trend(12, period), [period]);
  const departments = useAsync(() => dashboardApi.departments(period), [period]);
  const regions = useAsync(() => dashboardApi.regions(period), [period]);

  const data = overview.data?.data;
  const current = data?.current;
  const previous = data?.previous;
  const lastYear = data?.lastYear;

  const income = Number(current?.incomeTiyin ?? 0);
  const expense = Number(current?.expenseTiyin ?? 0);
  const profit = income - expense;
  const isProfit = profit >= 0;

  /** Har 1 so'm daromadga qancha xarajat */
  const costRatio = income > 0 ? expense / income : null;

  /** Grafikda nisbatni ko'rsatish uchun */
  const maxValue = Math.max(income, expense, 1);
  const incomeWidth = (income / maxValue) * 100;
  const expenseWidth = (expense / maxValue) * 100;

  // O'sish sur'ati solishtiruvi
  const incomeGrowth = previous?.incomeChange ?? null;
  const expenseGrowth = previous?.expenseChange ?? null;
  const growthGap =
    incomeGrowth !== null && expenseGrowth !== null
      ? incomeGrowth - expenseGrowth
      : null;

  const trendRows = trend.data?.data ?? [];

  return (
    <>
      <PageHeader
        title="Umumiy tahlil"
        description={`${formatDate(range.from)} — ${formatDate(range.to)}`}
        actions={
          <div className="flex items-center gap-3">
            <DateRangePicker value={range} onChange={setRange} />
            <Link
              href="/"
              className="text-sm text-[--color-text-muted] hover:text-[--color-text]"
            >
              Bosh sahifa
            </Link>
          </div>
        }
      />

      <div className="space-y-4 p-6">
        {/* Asosiy javob */}
        <Card>
          <CardBody className="space-y-5">
            <div className="text-center">
              <p className="text-sm text-[--color-text-muted]">
                Har 1 so&rsquo;m daromadga
              </p>
              <p
                className={cn(
                  'money mt-1 text-4xl font-bold',
                  costRatio === null
                    ? 'text-[--color-text-faint]'
                    : costRatio < 1
                      ? 'text-[--color-income]'
                      : 'text-[--color-expense]',
                )}
              >
                {costRatio === null ? '\u2014' : costRatio.toFixed(2)}
              </p>
              <p className="text-sm text-[--color-text-muted]">so&rsquo;m xarajat</p>
            </div>

            {/* Solishtirma chiziqlar */}
            <div className="space-y-3">
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-sm text-[--color-text-muted]">Daromad</span>
                  <Money
                    tiyin={current?.incomeTiyin ?? 0}
                    tone="income"
                    className="text-sm font-semibold"
                  />
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-[--color-surface-sunken]">
                  <div
                    className="h-full rounded-full bg-[--color-income] transition-all"
                    style={{ width: `${incomeWidth}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="text-sm text-[--color-text-muted]">Xarajat</span>
                  <Money
                    tiyin={current?.expenseTiyin ?? 0}
                    tone="expense"
                    className="text-sm font-semibold"
                  />
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-[--color-surface-sunken]">
                  <div
                    className="h-full rounded-full bg-[--color-expense] transition-all"
                    style={{ width: `${expenseWidth}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Natija */}
            <div
              className={cn(
                'flex items-center justify-between rounded-[--radius-control] px-4 py-3',
                isProfit ? 'bg-[--color-income-soft]' : 'bg-[--color-expense-soft]',
              )}
            >
              <span className="text-sm font-medium">
                {isProfit ? 'Foyda' : 'Zarar'}
              </span>

              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'money text-xs',
                    isProfit ? 'text-[--color-income]' : 'text-[--color-expense]',
                  )}
                >
                  {formatPercent(current?.marginPercent)}
                </span>
                <Money
                  tiyin={current?.profitTiyin ?? 0}
                  tone="auto"
                  className="text-lg font-semibold"
                />
              </div>
            </div>
          </CardBody>
        </Card>

        {/* O'sish sur'ati */}
        {growthGap !== null && (
          <Card>
            <CardHeader
              title="O'sish sur'ati"
              description="O'tgan oyga nisbatan"
            />
            <CardBody>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-[--radius-control] bg-[--color-surface-muted] p-3 text-center">
                  <p className="text-xs uppercase tracking-wide text-[--color-text-muted]">
                    Daromad
                  </p>
                  <p
                    className={cn(
                      'money mt-1 text-lg font-semibold',
                      (incomeGrowth ?? 0) >= 0
                        ? 'text-[--color-income]'
                        : 'text-[--color-expense]',
                    )}
                  >
                    {formatPercent(incomeGrowth)}
                  </p>
                </div>

                <div className="rounded-[--radius-control] bg-[--color-surface-muted] p-3 text-center">
                  <p className="text-xs uppercase tracking-wide text-[--color-text-muted]">
                    Xarajat
                  </p>
                  <p
                    className={cn(
                      'money mt-1 text-lg font-semibold',
                      (expenseGrowth ?? 0) <= 0
                        ? 'text-[--color-income]'
                        : 'text-[--color-expense]',
                    )}
                  >
                    {formatPercent(expenseGrowth)}
                  </p>
                </div>

                <div
                  className={cn(
                    'rounded-[--radius-control] p-3 text-center',
                    growthGap >= 0
                      ? 'bg-[--color-income-soft]'
                      : 'bg-[--color-expense-soft]',
                  )}
                >
                  <p className="text-xs uppercase tracking-wide text-[--color-text-muted]">
                    Farq
                  </p>
                  <p
                    className={cn(
                      'money mt-1 text-lg font-semibold',
                      growthGap >= 0
                        ? 'text-[--color-income]'
                        : 'text-[--color-expense]',
                    )}
                  >
                    {growthGap > 0 ? '+' : ''}
                    {growthGap.toFixed(1)}%
                  </p>
                </div>
              </div>

              <p className="mt-3 text-sm text-[--color-text-muted]">
                {growthGap >= 0
                  ? "Daromad xarajatdan tezroq o'smoqda"
                  : "Xarajat daromaddan tezroq o'smoqda"}
              </p>
            </CardBody>
          </Card>
        )}

        {/* Dinamika */}
        <Card>
          <CardHeader
            title="Daromad va xarajat dinamikasi"
            description="Oxirgi 12 oy"
          />
          <CardBody>
            {trend.loading ? <LoadingState /> : <LineChart data={trendRows} />}
          </CardBody>
        </Card>

        {/* Oylik jadval */}
        <Card className="overflow-hidden">
          <CardHeader title="Oylik solishtirma" description="Oxirgi 12 oy" />

          {trend.loading ? (
            <LoadingState />
          ) : trendRows.length === 0 ? (
            <EmptyState title="Ma'lumot yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th className="w-28">Davr</Th>
                  <Th align="right" className="w-36">
                    Daromad
                  </Th>
                  <Th align="right" className="w-36">
                    Xarajat
                  </Th>
                  <Th align="right" className="w-36">
                    Foyda
                  </Th>
                  <Th align="right" className="w-24">
                    Nisbat
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {[...trendRows].reverse().map((row) => {
                  const rowIncome = Number(row.incomeTiyin);
                  const rowExpense = Number(row.expenseTiyin);
                  const ratio = rowIncome > 0 ? rowExpense / rowIncome : null;

                  return (
                    <Tr key={row.period}>
                      <Td className="money text-[--color-text-muted]">
                        {formatPeriod(row.period)}
                      </Td>

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
          )}
        </Card>

        {/* O'tgan yil bilan */}
        <Card>
          <CardHeader
            title="O'tgan yilning shu oyi bilan"
            description={lastYear ? formatPeriod(lastYear.period) : undefined}
          />
          <CardBody>
            <div className="grid gap-4 sm:grid-cols-3">
              <CompareBox
                label="Daromad"
                current={current?.incomeTiyin ?? 0}
                previous={lastYear?.incomeTiyin ?? 0}
                change={lastYear?.incomeChange}
              />
              <CompareBox
                label="Xarajat"
                current={current?.expenseTiyin ?? 0}
                previous={lastYear?.expenseTiyin ?? 0}
                change={lastYear?.expenseChange}
              />
              <CompareBox
                label="Foyda"
                current={current?.profitTiyin ?? 0}
                previous={lastYear?.profitTiyin ?? 0}
                change={lastYear?.profitChange}
              />
            </div>
          </CardBody>
        </Card>

        {/* Hududlar */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Hududlar bo'yicha"
            description="Daromad va xarajat solishtiruvi"
          />

          {regions.loading ? (
            <LoadingState />
          ) : (regions.data?.data.rows.length ?? 0) === 0 ? (
            <EmptyState title="Ma'lumot yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Hudud</Th>
                  <Th align="right" className="w-32">
                    Daromad
                  </Th>
                  <Th align="right" className="w-32">
                    Xarajat
                  </Th>
                  <Th align="right" className="w-32">
                    Foyda
                  </Th>
                  <Th align="right" className="w-24">
                    Nisbat
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {regions.data?.data.rows.map((row) => (
                  <Tr key={row.regionCode}>
                    <Td className="truncate">{row.name}</Td>

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
                        row.costRatio === null
                          ? 'text-[--color-text-faint]'
                          : row.costRatio < 1
                            ? 'text-[--color-income]'
                            : 'text-[--color-expense]',
                      )}
                    >
                      {row.costRatio === null ? '\u2014' : row.costRatio.toFixed(2)}
                    </Td>
                  </Tr>
                ))}
              </TBody>

              <TFoot>
                <Tr>
                  <Td>Jami</Td>
                  <Td money>
                    <Money
                      tiyin={regions.data?.data.totals.incomeTiyin ?? 0}
                      tone="income"
                      className="font-semibold"
                    />
                  </Td>
                  <Td money>
                    <Money
                      tiyin={regions.data?.data.totals.expenseTiyin ?? 0}
                      tone="expense"
                      className="font-semibold"
                    />
                  </Td>
                  <Td money>
                    <Money
                      tiyin={regions.data?.data.totals.profitTiyin ?? 0}
                      tone="auto"
                      className="font-semibold"
                    />
                  </Td>
                  <Td />
                </Tr>
              </TFoot>
            </Table>
          )}
        </Card>

        {/* Bo'limlar */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Bo'limlar bo'yicha"
            description="Daromad va xarajat solishtiruvi"
          />

          {departments.loading ? (
            <LoadingState />
          ) : (departments.data?.data.rows.length ?? 0) === 0 ? (
            <EmptyState title="Ma'lumot yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Bo&apos;lim</Th>
                  <Th align="right" className="w-32">
                    Daromad
                  </Th>
                  <Th align="right" className="w-32">
                    Xarajat
                  </Th>
                  <Th align="right" className="w-32">
                    Foyda
                  </Th>
                  <Th align="right" className="w-24">
                    Rentab.
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {departments.data?.data.rows.map((row) => (
                  <Tr key={row.departmentId ?? 'general'}>
                    <Td className="truncate">{row.name}</Td>

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
                        (row.marginPercent ?? 0) >= 0
                          ? 'text-[--color-income]'
                          : 'text-[--color-expense]',
                      )}
                    >
                      {formatPercent(row.marginPercent)}
                    </Td>
                  </Tr>
                ))}
              </TBody>

              <TFoot>
                <Tr>
                  <Td>Jami</Td>
                  <Td money>
                    <Money
                      tiyin={departments.data?.data.totals.incomeTiyin ?? 0}
                      tone="income"
                      className="font-semibold"
                    />
                  </Td>
                  <Td money>
                    <Money
                      tiyin={departments.data?.data.totals.expenseTiyin ?? 0}
                      tone="expense"
                      className="font-semibold"
                    />
                  </Td>
                  <Td money>
                    <Money
                      tiyin={departments.data?.data.totals.profitTiyin ?? 0}
                      tone="auto"
                      className="font-semibold"
                    />
                  </Td>
                  <Td align="right" className="money text-xs font-semibold">
                    {formatPercent(departments.data?.data.totals.marginPercent)}
                  </Td>
                </Tr>
              </TFoot>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

function CompareBox({
  label,
  current,
  previous,
  change,
}: {
  label: string;
  current: string | number;
  previous: string | number;
  change?: number | null;
}) {
  return (
    <div className="rounded-[--radius-control] bg-[--color-surface-muted] p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
        {label}
      </p>

      <div className="mt-2 flex items-baseline gap-2">
        <span className="money text-sm font-semibold">{formatTiyin(current)}</span>
        <Change percent={change} positiveIsGood />
      </div>

      <p className="money mt-1 text-xs text-[--color-text-faint]">
        edi: {formatTiyin(previous)}
      </p>
    </div>
  );
}
