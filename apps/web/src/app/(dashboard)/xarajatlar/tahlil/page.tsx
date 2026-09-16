'use client';

import { expensesApi, type ExpenseFilters } from '@/features/expenses/api';
import { referencesApi } from '@/features/shared/references';
import { currentPeriod, formatPercent, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { BarChart } from '@/components/shared/bar-chart';
import { PeriodPicker } from '@/components/shared/period-picker';
import { ShareBar } from '@/components/shared/share-bar';
import { BehaviorBadge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconAlert } from '@/components/ui/icons';
import { Money, Change } from '@/components/ui/money';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';

const tabs = [
  { href: '/xarajatlar', label: "Ro'yxat" },
  { href: '/xarajatlar/tahlil', label: 'Tahlil' },
          { href: '/xarajatlar/ish-haqi', label: 'Ish haqi' },
];

export default function ExpenseAnalysisPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [departmentId, setDepartmentId] = useState('');

  const filters: ExpenseFilters = {
    period,
    departmentId: departmentId || undefined,
  };

  const departments = useAsync(() => referencesApi.departments(), []);

  const byCategory = useAsync(
    () => expensesApi.summaryByCategory(filters),
    [period, departmentId],
  );

  const byDepartment = useAsync(
    () => expensesApi.summaryByDepartment({ period }),
    [period],
  );

  const byBehavior = useAsync(
    () => expensesApi.summaryByBehavior(filters),
    [period, departmentId],
  );

  const spikes = useAsync(
    () => expensesApi.spikes(period, 30, departmentId || undefined),
    [period, departmentId],
  );

  const trend = useAsync(
    () => expensesApi.trend(12, departmentId || undefined),
    [departmentId],
  );

  const departmentOptions = [
    { value: '', label: "Barcha bo'limlar" },
    ...(departments.data?.data ?? []).map((item) => ({
      value: item.id,
      label: item.name,
    })),
  ];

  const behavior = byBehavior.data?.data;
  const behaviorTotal = behavior ? Number(behavior.totalTiyin) : 0;

  /** Doimiy va o'zgaruvchan ulushi - aralash yarmiga bo'linadi */
  function behaviorShare(value: string | undefined): number {
    if (!value || behaviorTotal === 0) return 0;
    return (Number(value) / behaviorTotal) * 100;
  }

  return (
    <>
      <PageHeader title="Xarajatlar" description={formatPeriod(period)} />

      <Tabs items={tabs} className="bg-white px-6" />

      <div className="space-y-4 p-6">
        {/* ─────────── Filtrlar ─────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <PeriodPicker value={period} onChange={setPeriod} />

          <Select
            options={departmentOptions}
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            className="h-9 w-48"
          />
        </div>

        {(spikes.data?.data.rows.length ?? 0) > 0 && (
          <div className="rounded-[--radius-card] border border-[--color-warn] bg-[--color-warn-soft] p-4">
            <div className="flex items-start gap-3">
              <IconAlert className="mt-0.5 size-5 shrink-0 text-[--color-warn]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[--color-warn]">
                  Keskin o&rsquo;zgargan moddalar
                </p>
                <p className="mt-0.5 text-xs text-[--color-text-muted]">
                  O&rsquo;tgan oyga nisbatan 30% dan ko&rsquo;p oshgan yoki yangi paydo bo&rsquo;lgan
                </p>

                <div className="mt-3 space-y-2">
                  {spikes.data?.data.rows.map((row) => (
                    <div
                      key={row.categoryCode}
                      className="flex items-center justify-between gap-3 rounded-[--radius-control] bg-white px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>

                      <span className="shrink-0 text-xs text-[--color-text-muted]">
                        {row.isNew ? (
                          <span className="font-medium text-[--color-warn]">yangi</span>
                        ) : (
                          <Change percent={row.changePercent} positiveIsGood={false} />
                        )}
                      </span>

                      <span className="w-32 shrink-0 text-right">
                        <Money tiyin={row.currentTiyin} tone="expense" />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─────────── Doimiy / o'zgaruvchan ─────────── */}
        <Card>
          <CardHeader
            title="Xarajat tuzilmasi"
            description="Doimiy xarajatlar hajmdan qat'i nazar to'lanadi, o'zgaruvchanlar faoliyatga bog'liq"
          />
          <CardBody>
            {byBehavior.loading ? (
              <LoadingState />
            ) : behavior && behaviorTotal > 0 ? (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
                      Doimiy
                    </p>
                    <Money
                      tiyin={behavior.fixedTiyin}
                      className="mt-1 block text-lg font-semibold"
                    />
                    <p className="mt-0.5 text-xs text-[--color-text-muted]">
                      {formatPercent(behaviorShare(behavior.fixedTiyin))}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
                      O&apos;zgaruvchan
                    </p>
                    <Money
                      tiyin={behavior.variableTiyin}
                      className="mt-1 block text-lg font-semibold"
                    />
                    <p className="mt-0.5 text-xs text-[--color-text-muted]">
                      {formatPercent(behaviorShare(behavior.variableTiyin))}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
                      Aralash
                    </p>
                    <Money
                      tiyin={behavior.mixedTiyin}
                      className="mt-1 block text-lg font-semibold"
                    />
                    <p className="mt-0.5 text-xs text-[--color-text-muted]">
                      {formatPercent(behaviorShare(behavior.mixedTiyin))}
                    </p>
                  </div>
                </div>

                {/* Nisbat chizig'i */}
                <div className="flex h-2 overflow-hidden rounded-full bg-[--color-surface-sunken]">
                  <div
                    className="bg-brand-700"
                    style={{ width: `${behaviorShare(behavior.fixedTiyin)}%` }}
                    title="Doimiy"
                  />
                  <div
                    className="bg-[--color-warn]"
                    style={{ width: `${behaviorShare(behavior.variableTiyin)}%` }}
                    title="O'zgaruvchan"
                  />
                  <div
                    className="bg-[--color-text-faint]"
                    style={{ width: `${behaviorShare(behavior.mixedTiyin)}%` }}
                    title="Aralash"
                  />
                </div>
              </div>
            ) : (
              <EmptyState title="Bu davrda xarajat yo'q" />
            )}
          </CardBody>
        </Card>

        {/* ─────────── Dinamika ─────────── */}
        <Card>
          <CardHeader
            title="Oylik dinamika"
            description="Oxirgi 12 oy"
          />
          <CardBody>
            {trend.loading ? (
              <LoadingState />
            ) : trend.error ? (
              <ErrorState message={trend.error} onRetry={trend.reload} />
            ) : (
              <BarChart data={trend.data?.data ?? []} />
            )}
          </CardBody>
        </Card>

        {/* ─────────── Kategoriya kesimi ─────────── */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Kategoriyalar bo'yicha"
            description="Eng katta xarajatdan boshlab"
          />

          {byCategory.loading ? (
            <LoadingState />
          ) : byCategory.error ? (
            <ErrorState message={byCategory.error} onRetry={byCategory.reload} />
          ) : (byCategory.data?.data.rows.length ?? 0) === 0 ? (
            <EmptyState title="Bu davrda xarajat yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Kategoriya</Th>
                  <Th className="w-32">Turi</Th>
                  <Th align="center" className="w-20">
                    Soni
                  </Th>
                  <Th className="w-40">Ulush</Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {byCategory.data?.data.rows.map((row) => (
                  <Tr key={row.categoryCode}>
                    <Td>{row.label}</Td>

                    <Td>
                      {row.behavior && <BehaviorBadge behavior={row.behavior} />}
                    </Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {row.count}
                    </Td>

                    <Td>
                      <div className="flex items-center gap-2">
                        <ShareBar percent={row.sharePercent} />
                        <span className="money w-12 shrink-0 text-right text-xs text-[--color-text-muted]">
                          {formatPercent(row.sharePercent)}
                        </span>
                      </div>
                    </Td>

                    <Td money>
                      <Money tiyin={row.amountTiyin} tone="expense" />
                    </Td>
                  </Tr>
                ))}
              </TBody>

              <TFoot>
                <Tr>
                  <Td colSpan={4}>Jami</Td>
                  <Td money>
                    <Money
                      tiyin={byCategory.data?.data.totalTiyin ?? 0}
                      tone="expense"
                      className="font-semibold"
                    />
                  </Td>
                </Tr>
              </TFoot>
            </Table>
          )}
        </Card>

        {/* ─────────── Bo'lim kesimi ─────────── */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Bo'limlar bo'yicha"
            description="Umumkorxona xarajatlari alohida ko'rsatilgan"
          />

          {byDepartment.loading ? (
            <LoadingState />
          ) : (byDepartment.data?.data.rows.length ?? 0) === 0 ? (
            <EmptyState title="Bu davrda xarajat yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Bo&apos;lim</Th>
                  <Th align="center" className="w-20">
                    Soni
                  </Th>
                  <Th className="w-40">Ulush</Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {byDepartment.data?.data.rows.map((row) => (
                  <Tr key={row.departmentId ?? 'none'}>
                    <Td>{row.name}</Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {row.count}
                    </Td>

                    <Td>
                      <div className="flex items-center gap-2">
                        <ShareBar percent={row.sharePercent} />
                        <span className="money w-12 shrink-0 text-right text-xs text-[--color-text-muted]">
                          {formatPercent(row.sharePercent)}
                        </span>
                      </div>
                    </Td>

                    <Td money>
                      <Money tiyin={row.amountTiyin} tone="expense" />
                    </Td>
                  </Tr>
                ))}
              </TBody>

              <TFoot>
                <Tr>
                  <Td colSpan={3}>Jami</Td>
                  <Td money>
                    <Money
                      tiyin={byDepartment.data?.data.totalTiyin ?? 0}
                      tone="expense"
                      className="font-semibold"
                    />
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
