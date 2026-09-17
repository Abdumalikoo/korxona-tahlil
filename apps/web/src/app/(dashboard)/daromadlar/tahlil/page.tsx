'use client';

import { useState } from 'react';
import { useAsync } from '@/lib/use-async';
import { incomesApi, type IncomeFilters } from '@/features/incomes/api';
import { referencesApi } from '@/features/shared/references';
import { currentPeriod, formatPeriod, formatPercent, formatTiyin } from '@/lib/format';

import { PageHeader } from '@/components/layout/page-header';
import { Tabs } from '@/components/ui/tabs';
import { PeriodPicker } from '@/components/shared/period-picker';
import { BarChart } from '@/components/shared/bar-chart';
import { ShareBar } from '@/components/shared/share-bar';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { Table, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState, LoadingState, ErrorState } from '@/components/ui/states';

const tabs = [
  { href: '/daromadlar', label: "Ro'yxat" },
  { href: '/daromadlar/tahlil', label: 'Tahlil' },
  { href: '/daromadlar/mijozlar', label: 'Mijozlar' },
];

export default function IncomeAnalysisPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [departmentId, setDepartmentId] = useState('');

  const filters: IncomeFilters = {
    period,
    departmentId: departmentId || undefined,
  };

  const departments = useAsync(() => referencesApi.departments(), []);

  const byCategory = useAsync(
    () => incomesApi.summaryByCategory(filters),
    [period, departmentId],
  );

  const byDepartment = useAsync(
    () => incomesApi.summaryByDepartment({ period }),
    [period],
  );

  const receivables = useAsync(
    () => incomesApi.receivables(filters),
    [period, departmentId],
  );

  const trend = useAsync(
    () => incomesApi.trend(12, departmentId || undefined),
    [departmentId],
  );

  const departmentOptions = [
    { value: '', label: "Barcha bo'limlar" },
    ...(departments.data?.data ?? []).map((item) => ({
      value: item.id,
      label: item.name,
    })),
  ];

  const categoryData = byCategory.data?.data;
  const total = categoryData ? Number(categoryData.totalTiyin) : 0;
  const paid = categoryData
    ? categoryData.rows.reduce((sum, row) => sum + Number(row.paidTiyin), 0)
    : 0;
  const paidPercent = total > 0 ? (paid / total) * 100 : 0;

  return (
    <>
      <PageHeader title="Daromadlar" description={formatPeriod(period)} />

      <Tabs items={tabs} className="bg-white px-6" />

      <div className="space-y-4 p-6">
        {/* Filtrlar */}
        <div className="flex flex-wrap items-center gap-3">
          <PeriodPicker value={period} onChange={setPeriod} />

          <div className="w-52">
            <Select
              options={departmentOptions}
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
              className="h-9"
            />
          </div>
        </div>

        {/* To'lov holati */}
        <Card>
          <CardHeader
            title="To'lov holati"
            description="Hisoblangan va haqiqatda tushgan summa nisbati"
          />
          <CardBody>
            {byCategory.loading ? (
              <LoadingState />
            ) : total === 0 ? (
              <EmptyState title="Bu davrda daromad yo'q" />
            ) : (
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
                      Hisoblangan
                    </p>
                    <Money
                      tiyin={categoryData?.totalTiyin ?? 0}
                      className="mt-1 block text-lg font-semibold"
                    />
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
                      Tushgan
                    </p>
                    <Money
                      tiyin={String(paid)}
                      tone="income"
                      className="mt-1 block text-lg font-semibold"
                    />
                    <p className="mt-0.5 text-xs text-[--color-text-muted]">
                      {formatPercent(paidPercent)}
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
                      Qarzda
                    </p>
                    <Money
                      tiyin={String(total - paid)}
                      tone="expense"
                      className="mt-1 block text-lg font-semibold"
                    />
                    <p className="mt-0.5 text-xs text-[--color-text-muted]">
                      {receivables.data?.data.count ?? 0} ta shartnoma
                    </p>
                  </div>
                </div>

                <div className="flex h-2 overflow-hidden rounded-full bg-[--color-surface-sunken]">
                  <div
                    className="bg-[--color-income]"
                    style={{ width: `${paidPercent}%` }}
                    title="Tushgan"
                  />
                  <div
                    className="bg-[--color-expense]"
                    style={{ width: `${100 - paidPercent}%` }}
                    title="Qarzda"
                  />
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Dinamika */}
        <Card>
          <CardHeader title="Oylik dinamika" description="Oxirgi 12 oy" />
          <CardBody>
            {trend.loading ? (
              <LoadingState />
            ) : trend.error ? (
              <ErrorState message={trend.error} onRetry={trend.reload} />
            ) : (
              <BarChart
                data={trend.data?.data ?? []}
                color="var(--color-income)"
              />
            )}
          </CardBody>
        </Card>

        {/* Xizmat turlari */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Xizmat turlari bo'yicha"
            description="Eng katta daromaddan boshlab"
          />

          {byCategory.loading ? (
            <LoadingState />
          ) : (categoryData?.rows.length ?? 0) === 0 ? (
            <EmptyState title="Bu davrda daromad yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Xizmat turi</Th>
                  <Th align="center" className="w-20">
                    Soni
                  </Th>
                  <Th className="w-40">Ulush</Th>
                  <Th align="right" className="w-36">
                    Tushgan
                  </Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {categoryData?.rows.map((row) => (
                  <Tr key={row.categoryCode}>
                    <Td>{row.label}</Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {row.count}
                    </Td>

                    <Td>
                      <div className="flex items-center gap-2">
                        <ShareBar
                          percent={row.sharePercent}
                          color="var(--color-income)"
                        />
                        <span className="money w-12 shrink-0 text-right text-xs text-[--color-text-muted]">
                          {formatPercent(row.sharePercent)}
                        </span>
                      </div>
                    </Td>

                    <Td money className="text-[--color-text-muted]">
                      {formatTiyin(row.paidTiyin)}
                    </Td>

                    <Td money>
                      <Money tiyin={row.amountTiyin} tone="income" />
                    </Td>
                  </Tr>
                ))}
              </TBody>

              <TFoot>
                <Tr>
                  <Td colSpan={4}>Jami</Td>
                  <Td money>
                    <Money
                      tiyin={categoryData?.totalTiyin ?? 0}
                      tone="income"
                      className="font-semibold"
                    />
                  </Td>
                </Tr>
              </TFoot>
            </Table>
          )}
        </Card>

        {/* Bo'limlar */}
        <Card className="overflow-hidden">
          <CardHeader title="Bo'limlar bo'yicha" />

          {byDepartment.loading ? (
            <LoadingState />
          ) : (byDepartment.data?.data.rows.length ?? 0) === 0 ? (
            <EmptyState title="Bu davrda daromad yo'q" />
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
                        <ShareBar
                          percent={row.sharePercent}
                          color="var(--color-income)"
                        />
                        <span className="money w-12 shrink-0 text-right text-xs text-[--color-text-muted]">
                          {formatPercent(row.sharePercent)}
                        </span>
                      </div>
                    </Td>

                    <Td money>
                      <Money tiyin={row.amountTiyin} tone="income" />
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
                      tone="income"
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
