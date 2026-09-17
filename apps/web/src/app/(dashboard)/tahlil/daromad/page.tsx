'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAsync } from '@/lib/use-async';
import { incomesApi } from '@/features/incomes/api';
import { regionalIncomeApi } from '@/features/incomes/regional-api';
import {
  currentPeriod,
  formatPeriod,
  formatPercent,
  formatDate,
  formatTiyin,
} from '@/lib/format';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/shared/period-picker';
import { BarChart } from '@/components/shared/bar-chart';
import { ShareBar } from '@/components/shared/share-bar';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Money, Change } from '@/components/ui/money';
import { Table, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState, LoadingState } from '@/components/ui/states';

export default function IncomeAnalysisPage() {
  const [period, setPeriod] = useState(currentPeriod());

  const filters = { period };

  const comparison = useAsync(() => incomesApi.comparison(period), [period]);
  const trend = useAsync(() => incomesApi.trend(12), []);
  const byCategory = useAsync(() => incomesApi.summaryByCategory(filters), [period]);
  const byDepartment = useAsync(() => incomesApi.summaryByDepartment(filters), [period]);
  const byRegion = useAsync(() => regionalIncomeApi.summaryByRegion(period), [period]);
  const byService = useAsync(() => regionalIncomeApi.summaryByService(period), [period]);
  const top = useAsync(() => incomesApi.top(filters, 5), [period]);

  const current = comparison.data?.data.current;
  const previous = comparison.data?.data.previous;
  const lastYear = comparison.data?.data.lastYear;

  const categoryData = byCategory.data?.data;
  const total = categoryData ? Number(categoryData.totalTiyin) : 0;
  const paid = categoryData
    ? categoryData.rows.reduce((sum, row) => sum + Number(row.paidTiyin), 0)
    : 0;
  const paidPercent = total > 0 ? (paid / total) * 100 : 0;

  // Xizmatlar bo'yicha jami soni
  const serviceRows = byService.data?.data.rows ?? [];
  const totalQuantity = serviceRows.reduce((sum, row) => sum + row.quantity, 0);

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
        {/* Ko'rsatkichlar */}
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

          <div className="rounded-[--radius-card] border border-[--color-line] bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
              Ko&rsquo;rsatilgan xizmat
            </p>
            <p className="money mt-2 text-xl font-semibold">
              {totalQuantity > 0 ? totalQuantity.toLocaleString('uz') : '\u2014'}
            </p>
            <p className="mt-1.5 text-xs text-[--color-text-muted]">
              {totalQuantity > 0 && total > 0
                ? `O'rtacha ${formatTiyin(String(Math.round(total / totalQuantity)))}`
                : 'Hududiy hisobotdan'}
            </p>
          </div>
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

        {/* Hududlar */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Hududlar bo'yicha"
            description="Daromadning asosiy manbai"
          />

          {byRegion.loading ? (
            <LoadingState />
          ) : (byRegion.data?.data.rows.length ?? 0) === 0 ? (
            <EmptyState title="Hududiy daromad yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Hudud</Th>
                  <Th align="center" className="w-24">
                    Xizmat
                  </Th>
                  <Th align="center" className="w-24">
                    Soni
                  </Th>
                  <Th className="w-36">Ulush</Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {byRegion.data?.data.rows.map((row) => (
                  <Tr key={row.regionCode ?? 'none'}>
                    <Td className="font-medium">{row.name}</Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {row.count}
                    </Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {row.quantity || '\u2014'}
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
                  <Td colSpan={4}>Jami</Td>
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

        {/* Eng katta yozuvlar */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Eng katta 5 daromad"
            description="Alohida yozuvlar bo'yicha"
          />

          {top.loading ? (
            <LoadingState />
          ) : (top.data?.data.length ?? 0) === 0 ? (
            <EmptyState title="Yozuv yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th className="w-10" />
                  <Th className="w-28">Sana</Th>
                  <Th>Xizmat turi</Th>
                  <Th className="w-44">Mijoz / Hudud</Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {top.data?.data.map((item, index) => (
                  <Tr key={item.id}>
                    <Td className="money text-center text-[--color-text-faint]">
                      {index + 1}
                    </Td>

                    <Td className="money text-[--color-text-muted]">
                      {formatDate(item.date)}
                    </Td>

                    <Td className="max-w-md truncate">{item.category.label}</Td>

                    <Td className="text-[--color-text-muted]">
                      {item.clientName ?? item.region?.name ?? '\u2014'}
                    </Td>

                    <Td money>
                      <Money tiyin={item.amountTiyin} tone="income" />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {/* Xizmat turlari */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Xizmat turlari"
            description="Eng katta daromaddan boshlab"
          />

          {byService.loading ? (
            <LoadingState />
          ) : serviceRows.length === 0 ? (
            <EmptyState title="Ma'lumot yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Xizmat turi</Th>
                  <Th align="center" className="w-20">
                    Soni
                  </Th>
                  <Th align="right" className="w-32">
                    O&apos;rtacha
                  </Th>
                  <Th className="w-32">Ulush</Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {serviceRows.map((row) => (
                  <Tr key={row.categoryCode}>
                    <Td className="max-w-md truncate" title={row.label}>
                      {row.label}
                    </Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {row.quantity || '\u2014'}
                    </Td>

                    <Td money className="text-[--color-text-muted]">
                      {row.averageTiyin ? formatTiyin(row.averageTiyin) : '\u2014'}
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
                  <Td colSpan={4}>Jami</Td>
                  <Td money>
                    <Money
                      tiyin={byService.data?.data.totalTiyin ?? 0}
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
                  <Th align="center" className="w-20">
                    Soni
                  </Th>
                  <Th className="w-36">Ulush</Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {byDepartment.data?.data.rows.map((row) => (
                  <Tr key={row.departmentId ?? 'none'}>
                    <Td className="truncate">{row.name}</Td>

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

function MetricCard({
  label,
  tiyin,
  change,
  hint,
}: {
  label: string;
  tiyin: string | number;
  change?: number | null;
  hint?: string;
}) {
  return (
    <div className="rounded-[--radius-card] border border-[--color-line] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
        {label}
      </p>

      <div className="mt-2">
        <Money tiyin={tiyin} tone="income" className="text-xl font-semibold" />
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        {change !== undefined && <Change percent={change} positiveIsGood />}
        {hint && <span className="text-xs text-[--color-text-muted]">{hint}</span>}
      </div>
    </div>
  );
}
