'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAsync } from '@/lib/use-async';
import { dashboardApi } from '@/features/dashboard/api';
import { currentPeriod, formatPeriod, formatPercent, formatTiyin } from '@/lib/format';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/shared/period-picker';
import { LineChart } from '@/components/shared/line-chart';
import { ShareBar } from '@/components/shared/share-bar';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Money, Change } from '@/components/ui/money';
import { Table, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { IconAlert } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

export default function GeneralAnalysisPage() {
  const [period, setPeriod] = useState(currentPeriod());

  const overview = useAsync(() => dashboardApi.overview(period), [period]);
  const trend = useAsync(() => dashboardApi.trend(12, period), [period]);
  const departments = useAsync(() => dashboardApi.departments(period), [period]);
  const alerts = useAsync(() => dashboardApi.alerts(period), [period]);
  const structure = useAsync(() => dashboardApi.expenseStructure(period), [period]);

  const data = overview.data?.data;
  const current = data?.current;
  const previous = data?.previous;
  const lastYear = data?.lastYear;

  const income = Number(current?.incomeTiyin ?? 0);
  const expense = Number(current?.expenseTiyin ?? 0);
  const profit = income - expense;
  const isProfit = profit >= 0;

  const alertData = alerts.data?.data;
  const hasAlerts =
    (alertData?.spikes.length ?? 0) > 0 ||
    Number(alertData?.payable.totalTiyin ?? 0) > 0 ||
    Number(alertData?.receivable.totalTiyin ?? 0) > 0;

  const deptRows = departments.data?.data.rows ?? [];
  const profitable = deptRows.filter((row) => Number(row.profitTiyin) > 0).length;
  const losing = deptRows.filter((row) => Number(row.profitTiyin) < 0).length;

  return (
    <>
      <PageHeader
        title="Umumiy tahlil"
        description={formatPeriod(period)}
        actions={
          <div className="flex items-center gap-3">
            <PeriodPicker value={period} onChange={setPeriod} />
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
        {/* Asosiy ko'rsatkichlar */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-[--radius-card] border border-[--color-line] bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
              Daromad
            </p>
            <Money
              tiyin={current?.incomeTiyin ?? 0}
              tone="income"
              className="mt-2 block text-xl font-semibold"
            />
            <div className="mt-1.5">
              <Change percent={previous?.incomeChange} positiveIsGood />
            </div>
          </div>

          <div className="rounded-[--radius-card] border border-[--color-line] bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
              Xarajat
            </p>
            <Money
              tiyin={current?.expenseTiyin ?? 0}
              tone="expense"
              className="mt-2 block text-xl font-semibold"
            />
            <div className="mt-1.5">
              <Change percent={previous?.expenseChange} positiveIsGood={false} />
            </div>
          </div>

          <div
            className={cn(
              'rounded-[--radius-card] border-2 bg-white p-4',
              isProfit ? 'border-[--color-income]' : 'border-[--color-expense]',
            )}
          >
            <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
              {isProfit ? 'Foyda' : 'Zarar'}
            </p>
            <Money
              tiyin={current?.profitTiyin ?? 0}
              tone="auto"
              className="mt-2 block text-xl font-semibold"
            />
            <div className="mt-1.5">
              <Change percent={previous?.profitChange} positiveIsGood />
            </div>
          </div>

          <div className="rounded-[--radius-card] border border-[--color-line] bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
              Rentabellik
            </p>
            <p
              className={cn(
                'money mt-2 text-xl font-semibold',
                (current?.marginPercent ?? 0) >= 0
                  ? 'text-[--color-income]'
                  : 'text-[--color-expense]',
              )}
            >
              {formatPercent(current?.marginPercent)}
            </p>
            <p className="mt-1.5 text-xs text-[--color-text-muted]">
              Foyda / daromad
            </p>
          </div>
        </div>

        {/* O'tgan yil bilan solishtirish */}
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
                positiveIsGood
              />
              <CompareBox
                label="Xarajat"
                current={current?.expenseTiyin ?? 0}
                previous={lastYear?.expenseTiyin ?? 0}
                change={lastYear?.expenseChange}
                positiveIsGood={false}
              />
              <CompareBox
                label="Foyda"
                current={current?.profitTiyin ?? 0}
                previous={lastYear?.profitTiyin ?? 0}
                change={lastYear?.profitChange}
                positiveIsGood
              />
            </div>
          </CardBody>
        </Card>

        {/* Ogohlantirishlar */}
        {hasAlerts && (
          <div className="rounded-[--radius-card] border border-[--color-warn] bg-[--color-warn-soft] p-4">
            <div className="flex items-start gap-3">
              <IconAlert className="mt-0.5 size-5 shrink-0 text-[--color-warn]" />

              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-sm font-medium text-[--color-warn]">
                  E&rsquo;tibor talab qiladi
                </p>

                {Number(alertData?.receivable.totalTiyin ?? 0) > 0 && (
                  <div className="flex items-center justify-between gap-3 rounded-[--radius-control] bg-white px-3 py-2">
                    <span className="text-sm">
                      Debitorlik qarzi
                      <span className="ml-2 text-xs text-[--color-text-muted]">
                        {alertData?.receivable.count} ta
                      </span>
                    </span>
                    <Money
                      tiyin={alertData?.receivable.totalTiyin ?? 0}
                      className="text-sm font-semibold"
                    />
                  </div>
                )}

                {Number(alertData?.payable.totalTiyin ?? 0) > 0 && (
                  <div className="flex items-center justify-between gap-3 rounded-[--radius-control] bg-white px-3 py-2">
                    <span className="text-sm">
                      To&rsquo;lanmagan xarajat
                      <span className="ml-2 text-xs text-[--color-text-muted]">
                        {alertData?.payable.count} ta
                      </span>
                    </span>
                    <Money
                      tiyin={alertData?.payable.totalTiyin ?? 0}
                      tone="expense"
                      className="text-sm font-semibold"
                    />
                  </div>
                )}

                {(alertData?.spikes.length ?? 0) > 0 && (
                  <div className="space-y-1.5">
                    {alertData?.spikes.map((spike) => (
                      <div
                        key={spike.categoryCode}
                        className="flex items-center justify-between gap-3 rounded-[--radius-control] bg-white px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {spike.label}
                        </span>
                        <span className="shrink-0 text-xs">
                          {spike.isNew ? (
                            <span className="font-medium text-[--color-warn]">yangi</span>
                          ) : (
                            <Change percent={spike.changePercent} positiveIsGood={false} />
                          )}
                        </span>
                        <Money
                          tiyin={spike.currentTiyin}
                          tone="expense"
                          className="w-28 shrink-0 text-right text-sm"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Dinamika */}
        <Card>
          <CardHeader
            title="Daromad va xarajat dinamikasi"
            description="Oxirgi 12 oy"
          />
          <CardBody>
            {trend.loading ? (
              <LoadingState />
            ) : (
              <LineChart data={trend.data?.data ?? []} />
            )}
          </CardBody>
        </Card>

        {/* Bo'limlar foydasi */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Bo'limlar bo'yicha foyda"
            description={
              deptRows.length > 0
                ? `${profitable} ta foydali, ${losing} ta zararli`
                : undefined
            }
          />

          {departments.loading ? (
            <LoadingState />
          ) : deptRows.length === 0 ? (
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
                {deptRows.map((row) => (
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

        {/* Xarajat strukturasi */}
        <Card className="overflow-hidden">
          <CardHeader title="Xarajat strukturasi" description={formatPeriod(period)} />

          {structure.loading ? (
            <LoadingState />
          ) : (structure.data?.data.rows.length ?? 0) === 0 ? (
            <EmptyState title="Bu davrda xarajat yo'q" />
          ) : (
            <CardBody className="space-y-3">
              {structure.data?.data.rows.map((row) => (
                <div key={row.code}>
                  <div className="mb-1 flex items-baseline justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>
                    <span className="money shrink-0 text-xs text-[--color-text-muted]">
                      {formatPercent(row.sharePercent)}
                    </span>
                    <Money
                      tiyin={row.amountTiyin}
                      tone="expense"
                      className="w-36 shrink-0 text-right text-sm"
                    />
                  </div>
                  <ShareBar percent={row.sharePercent} color="var(--color-expense)" />
                </div>
              ))}
            </CardBody>
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
  positiveIsGood,
}: {
  label: string;
  current: string | number;
  previous: string | number;
  change?: number | null;
  positiveIsGood: boolean;
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
