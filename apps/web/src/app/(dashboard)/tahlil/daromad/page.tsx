'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAsync } from '@/lib/use-async';
import { incomesApi } from '@/features/incomes/api';
import { regionalIncomeApi } from '@/features/incomes/regional-api';
import { currentPeriod, formatPeriod, formatPercent, formatTiyin } from '@/lib/format';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/shared/period-picker';
import { BarChart } from '@/components/shared/bar-chart';
import { ShareBar } from '@/components/shared/share-bar';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Money, Change } from '@/components/ui/money';
import { Table, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { IconChevronDown } from '@/components/ui/icons';

export default function IncomeAnalysisPage() {
  const [period, setPeriod] = useState(currentPeriod());

  const comparison = useAsync(() => incomesApi.comparison(period), [period]);
  const trend = useAsync(() => incomesApi.trend(12), []);
  const byCategory = useAsync(
    () => incomesApi.summaryByCategory({ period }),
    [period],
  );
  const byDepartment = useAsync(
    () => incomesApi.summaryByDepartment({ period }),
    [period],
  );
  const byRegion = useAsync(() => regionalIncomeApi.summaryByRegion(period), [period]);
  const receivables = useAsync(() => incomesApi.receivables({ period }), [period]);

  const current = comparison.data?.data.current;
  const previous = comparison.data?.data.previous;
  const lastYear = comparison.data?.data.lastYear;

  const categoryData = byCategory.data?.data;
  const total = categoryData ? Number(categoryData.totalTiyin) : 0;
  const paid = categoryData
    ? categoryData.rows.reduce((sum, row) => sum + Number(row.paidTiyin), 0)
    : 0;
  const paidPercent = total > 0 ? (paid / total) * 100 : 0;

  return (
    <>
      <PageHeader
        title="Daromad tahlili"
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
          <MetricCard
            label="Jami daromad"
            tiyin={current?.amountTiyin ?? 0}
            hint={current ? `${current.count} ta yozuv` : undefined}
          />

          <MetricCard
            label="O'tgan oyga nisbatan"
            tiyin={previous?.amountTiyin ?? 0}
            change={previous?.changePercent}
            hint={previous ? formatPeriod(previous.period) : undefined}
          />

          <MetricCard
            label="O'tgan yilning shu oyi"
            tiyin={lastYear?.amountTiyin ?? 0}
            change={lastYear?.changePercent}
            hint={lastYear ? formatPeriod(lastYear.period) : undefined}
          />

          <MetricCard
            label="Debitorlik qarzi"
            tiyin={receivables.data?.data.totalTiyin ?? 0}
            tone="expense"
            hint={
              receivables.data
                ? `${receivables.data.data.count} ta shartnoma`
                : undefined
            }
          />
        </div>

        {/* To'lov holati */}
        {total > 0 && (
          <Card>
            <CardHeader
              title="To'lov holati"
              description="Hisoblangan va haqiqatda tushgan summa"
            />
            <CardBody>
              <div className="space-y-3">
                <div className="flex h-2.5 overflow-hidden rounded-full bg-[--color-surface-sunken]">
                  <div
                    className="bg-[--color-income] transition-all"
                    style={{ width: `${paidPercent}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-[--color-income]" />
                    <span className="text-[--color-text-muted]">Tushgan</span>
                    <Money tiyin={String(paid)} tone="income" className="font-medium" />
                    <span className="money text-xs text-[--color-text-faint]">
                      {formatPercent(paidPercent)}
                    </span>
                  </span>

                  <span className="flex items-center gap-2">
                    <span className="text-[--color-text-muted]">Qarzda</span>
                    <Money
                      tiyin={String(total - paid)}
                      tone="expense"
                      className="font-medium"
                    />
                  </span>
                </div>
              </div>
            </CardBody>
          </Card>
        )}

        {/* Dinamika */}
        <Card>
          <CardHeader title="Oylik dinamika" description="Oxirgi 12 oy" />
          <CardBody>
            {trend.loading ? (
              <LoadingState />
            ) : (
              <BarChart data={trend.data?.data ?? []} color="var(--color-income)" />
            )}
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Hududlar */}
          <Card className="overflow-hidden">
            <CardHeader title="Hududlar bo'yicha" />

            {byRegion.loading ? (
              <LoadingState />
            ) : (byRegion.data?.data.rows.length ?? 0) === 0 ? (
              <EmptyState title="Hududiy daromad yo'q" />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Hudud</Th>
                    <Th className="w-28">Ulush</Th>
                    <Th align="right" className="w-36">
                      Summa
                    </Th>
                  </Tr>
                </THead>

                <TBody>
                  {byRegion.data?.data.rows.slice(0, 10).map((row) => (
                    <Tr key={row.regionCode ?? 'none'}>
                      <Td className="truncate">{row.name}</Td>
                      <Td>
                        <ShareBar
                          percent={row.sharePercent}
                          color="var(--color-income)"
                        />
                      </Td>
                      <Td money>
                        <Money tiyin={row.amountTiyin} tone="income" />
                      </Td>
                    </Tr>
                  ))}
                </TBody>

                <TFoot>
                  <Tr>
                    <Td colSpan={2}>Jami</Td>
                    <Td money>
                      <Money
                        tiyin={byRegion.data?.data.totalTiyin ?? 0}
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
              <EmptyState title="Ma'lumot yo'q" />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Bo&apos;lim</Th>
                    <Th className="w-28">Ulush</Th>
                    <Th align="right" className="w-36">
                      Summa
                    </Th>
                  </Tr>
                </THead>

                <TBody>
                  {byDepartment.data?.data.rows.slice(0, 10).map((row) => (
                    <Tr key={row.departmentId ?? 'none'}>
                      <Td className="truncate">{row.name}</Td>
                      <Td>
                        <ShareBar
                          percent={row.sharePercent}
                          color="var(--color-income)"
                        />
                      </Td>
                      <Td money>
                        <Money tiyin={row.amountTiyin} tone="income" />
                      </Td>
                    </Tr>
                  ))}
                </TBody>

                <TFoot>
                  <Tr>
                    <Td colSpan={2}>Jami</Td>
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
                  <Th className="w-32">Ulush</Th>
                  <Th align="right" className="w-32">
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
                    <Td className="max-w-md truncate" title={row.label}>
                      {row.label}
                    </Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {row.count}
                    </Td>

                    <Td>
                      <ShareBar percent={row.sharePercent} color="var(--color-income)" />
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
      </div>
    </>
  );
}

function MetricCard({
  label,
  tiyin,
  change,
  hint,
  tone = 'income',
}: {
  label: string;
  tiyin: string | number;
  change?: number | null;
  hint?: string;
  tone?: 'income' | 'expense';
}) {
  return (
    <div className="rounded-[--radius-card] border border-[--color-line] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
        {label}
      </p>

      <div className="mt-2">
        <Money tiyin={tiyin} tone={tone} className="text-xl font-semibold" />
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        {change !== undefined && <Change percent={change} positiveIsGood />}
        {hint && <span className="text-xs text-[--color-text-muted]">{hint}</span>}
      </div>
    </div>
  );
}
