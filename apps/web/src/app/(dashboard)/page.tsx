'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { dashboardApi } from '@/features/dashboard/api';
import { currentPeriod, formatPeriod, formatTiyin, formatPercent } from '@/lib/format';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/shared/period-picker';
import { LineChart } from '@/components/shared/line-chart';
import { ShareBar } from '@/components/shared/share-bar';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Money, Change } from '@/components/ui/money';
import { Table, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { IconAlert, IconTrendUp, IconWallet } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

export default function DashboardPage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState(currentPeriod());

  const overview = useAsync(() => dashboardApi.overview(period), [period]);
  const trend = useAsync(() => dashboardApi.trend(12, period), [period]);
  const departments = useAsync(() => dashboardApi.departments(period), [period]);
  const alerts = useAsync(() => dashboardApi.alerts(period), [period]);
  const structure = useAsync(() => dashboardApi.expenseStructure(period), [period]);

  const data = overview.data?.data;
  const current = data?.current;
  const previous = data?.previous;

  const alertData = alerts.data?.data;
  const hasAlerts =
    (alertData?.spikes.length ?? 0) > 0 ||
    Number(alertData?.payable.totalTiyin ?? 0) > 0 ||
    Number(alertData?.receivable.totalTiyin ?? 0) > 0;

  return (
    <>
      <PageHeader
        title={`Xush kelibsiz, ${user?.fullName ?? ''}`}
        description={formatPeriod(period)}
        actions={<PeriodPicker value={period} onChange={setPeriod} />}
      />

      <div className="space-y-4 p-6">
        {/* Asosiy ko'rsatkichlar */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Daromad"
            tiyin={current?.incomeTiyin ?? 0}
            change={previous?.incomeChange}
            positiveIsGood
            tone="income"
            hint={current ? `${current.incomeCount} ta yozuv` : undefined}
            icon={<IconTrendUp className="size-4" />}
          />

          <MetricCard
            label="Xarajat"
            tiyin={current?.expenseTiyin ?? 0}
            change={previous?.expenseChange}
            positiveIsGood={false}
            tone="expense"
            hint={current ? `${current.expenseCount} ta yozuv` : undefined}
            icon={<IconWallet className="size-4" />}
          />

          <MetricCard
            label="Foyda"
            tiyin={current?.profitTiyin ?? 0}
            change={previous?.profitChange}
            positiveIsGood
            tone="auto"
          />

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
              Foyda / daromad nisbati
            </p>
          </div>
        </div>

        {/* Ogohlantirishlar */}
        {hasAlerts && (
          <div className="rounded-[--radius-card] border border-[--color-warn] bg-[--color-warn-soft] p-4">
            <div className="flex items-start gap-3">
              <IconAlert className="mt-0.5 size-5 shrink-0 text-[--color-warn]" />

              <div className="min-w-0 flex-1 space-y-3">
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
                    <p className="text-xs text-[--color-text-muted]">
                      Keskin o&rsquo;zgargan moddalar
                    </p>
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

        <div className="grid gap-4 lg:grid-cols-2">
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
                        className="w-32 shrink-0 text-right text-sm"
                      />
                    </div>
                    <ShareBar percent={row.sharePercent} />
                  </div>
                ))}
              </CardBody>
            )}
          </Card>

          {/* Bo'limlar */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Bo'limlar bo'yicha foyda"
              description="Daromad va xarajat nisbati"
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
                  </Tr>
                </TFoot>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

// ─────────── Ko'rsatkich kartochkasi ───────────

function MetricCard({
  label,
  tiyin,
  change,
  positiveIsGood,
  tone,
  hint,
  icon,
}: {
  label: string;
  tiyin: string | number;
  change?: number | null;
  positiveIsGood: boolean;
  tone: 'income' | 'expense' | 'auto';
  hint?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-[--radius-card] border border-[--color-line] bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
          {label}
        </p>
        {icon && <div className="text-[--color-text-faint]">{icon}</div>}
      </div>

      <div className="mt-2">
        <Money tiyin={tiyin} tone={tone} className="text-xl font-semibold" />
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <Change percent={change} positiveIsGood={positiveIsGood} />
        {hint && <span className="text-xs text-[--color-text-muted]">{hint}</span>}
      </div>
    </div>
  );
}
