'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAsync } from '@/lib/use-async';
import { expensesApi } from '@/features/expenses/api';
import { currentPeriod, formatPeriod, formatPercent } from '@/lib/format';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/shared/period-picker';
import { BarChart } from '@/components/shared/bar-chart';
import { ShareBar } from '@/components/shared/share-bar';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Money, Change } from '@/components/ui/money';
import { BehaviorBadge } from '@/components/ui/badge';
import { Table, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { IconAlert } from '@/components/ui/icons';

export default function ExpenseAnalysisPage() {
  const [period, setPeriod] = useState(currentPeriod());

  const filters = { period };

  const comparison = useAsync(() => expensesApi.comparison(period), [period]);
  const trend = useAsync(() => expensesApi.trend(12), []);
  const byCategory = useAsync(() => expensesApi.summaryByCategory(filters), [period]);
  const byDepartment = useAsync(() => expensesApi.summaryByDepartment(filters), [period]);
  const byRegion = useAsync(() => expensesApi.summaryByRegion(filters), [period]);
  const byBehavior = useAsync(() => expensesApi.summaryByBehavior(filters), [period]);
  const spikes = useAsync(() => expensesApi.spikes(period, 30), [period]);

  const current = comparison.data?.data.current;
  const previous = comparison.data?.data.previous;
  const lastYear = comparison.data?.data.lastYear;

  const behavior = byBehavior.data?.data;
  const fixedTiyin = Number(behavior?.fixedTiyin ?? 0);
  const variableTiyin = Number(behavior?.variableTiyin ?? 0);
  const behaviorTotal = fixedTiyin + variableTiyin;
  const fixedPercent = behaviorTotal > 0 ? (fixedTiyin / behaviorTotal) * 100 : 0;

  const spikeRows = spikes.data?.data.rows ?? [];

  return (
    <>
      <PageHeader
        title="Xarajat tahlili"
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
            label="Jami xarajat"
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
              Doimiy xarajat ulushi
            </p>
            <p className="money mt-2 text-xl font-semibold">
              {formatPercent(fixedPercent)}
            </p>
            <p className="mt-1.5 text-xs text-[--color-text-muted]">
              Hajmdan qat&rsquo;i nazar to&rsquo;lanadi
            </p>
          </div>
        </div>

        {/* Ogohlantirish */}
        {spikeRows.length > 0 && (
          <div className="rounded-[--radius-card] border border-[--color-warn] bg-[--color-warn-soft] p-4">
            <div className="flex items-start gap-3">
              <IconAlert className="mt-0.5 size-5 shrink-0 text-[--color-warn]" />

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[--color-warn]">
                  Keskin o&rsquo;zgargan moddalar
                </p>
                <p className="mt-0.5 text-xs text-[--color-text-muted]">
                  O&rsquo;tgan oyga nisbatan 30% dan ko&rsquo;p oshgan
                </p>

                <div className="mt-3 space-y-1.5">
                  {spikeRows.map((row) => (
                    <div
                      key={row.categoryCode}
                      className="flex items-center justify-between gap-3 rounded-[--radius-control] bg-white px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm">{row.label}</span>

                      <span className="shrink-0 text-xs">
                        {row.isNew ? (
                          <span className="font-medium text-[--color-warn]">yangi</span>
                        ) : (
                          <Change percent={row.changePercent} positiveIsGood={false} />
                        )}
                      </span>

                      <Money
                        tiyin={row.currentTiyin}
                        tone="expense"
                        className="w-32 shrink-0 text-right text-sm"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Doimiy / o'zgaruvchan */}
        {behaviorTotal > 0 && (
          <Card>
            <CardHeader
              title="Xarajat tuzilishi"
              description="Doimiy va o'zgaruvchan nisbati"
            />
            <CardBody>
              <div className="space-y-3">
                <div className="flex h-2.5 overflow-hidden rounded-full bg-[--color-surface-sunken]">
                  <div
                    className="bg-brand-700 transition-all"
                    style={{ width: `${fixedPercent}%` }}
                  />
                  <div
                    className="bg-[--color-warn] transition-all"
                    style={{ width: `${100 - fixedPercent}%` }}
                  />
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-brand-700" />
                    <span className="text-[--color-text-muted]">Doimiy</span>
                    <Money tiyin={String(fixedTiyin)} className="font-medium" />
                    <span className="money text-xs text-[--color-text-faint]">
                      {formatPercent(fixedPercent)}
                    </span>
                  </span>

                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-[--color-warn]" />
                    <span className="text-[--color-text-muted]">O&rsquo;zgaruvchan</span>
                    <Money tiyin={String(variableTiyin)} className="font-medium" />
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
              <BarChart data={trend.data?.data ?? []} color="var(--color-expense)" />
            )}
          </CardBody>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
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
                  {byDepartment.data?.data.rows.slice(0, 12).map((row) => (
                    <Tr key={row.departmentId ?? 'none'}>
                      <Td className="truncate">{row.name}</Td>
                      <Td>
                        <ShareBar
                          percent={row.sharePercent}
                          color="var(--color-expense)"
                        />
                      </Td>
                      <Td money>
                        <Money tiyin={row.amountTiyin} tone="expense" />
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
                        tone="expense"
                        className="font-semibold"
                      />
                    </Td>
                  </Tr>
                </TFoot>
              </Table>
            )}
          </Card>

          {/* Hududlar */}
          <Card className="overflow-hidden">
            <CardHeader title="Hududlar bo'yicha" />

            {byRegion.loading ? (
              <LoadingState />
            ) : (byRegion.data?.data.rows.length ?? 0) === 0 ? (
              <EmptyState title="Ma'lumot yo'q" />
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
                  {byRegion.data?.data.rows.slice(0, 12).map((row) => (
                    <Tr key={row.regionCode ?? 'none'}>
                      <Td className="truncate">{row.name}</Td>
                      <Td>
                        <ShareBar
                          percent={row.sharePercent}
                          color="var(--color-expense)"
                        />
                      </Td>
                      <Td money>
                        <Money tiyin={row.amountTiyin} tone="expense" />
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

        {/* Kategoriyalar */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Kategoriyalar bo'yicha"
            description="Eng katta xarajatdan boshlab"
          />

          {byCategory.loading ? (
            <LoadingState />
          ) : (byCategory.data?.data.rows.length ?? 0) === 0 ? (
            <EmptyState title="Bu davrda xarajat yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Kategoriya</Th>
                  <Th className="w-28">Turi</Th>
                  <Th align="center" className="w-20">
                    Soni
                  </Th>
                  <Th className="w-32">Ulush</Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {byCategory.data?.data.rows.map((row) => (
                  <Tr key={row.categoryCode}>
                    <Td className="max-w-md truncate">{row.label}</Td>

                    <Td>
                      {row.behavior && <BehaviorBadge behavior={row.behavior} />}
                    </Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {row.count}
                    </Td>

                    <Td>
                      <ShareBar percent={row.sharePercent} color="var(--color-expense)" />
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
        <Money tiyin={tiyin} tone="expense" className="text-xl font-semibold" />
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        {change !== undefined && <Change percent={change} positiveIsGood={false} />}
        {hint && <span className="text-xs text-[--color-text-muted]">{hint}</span>}
      </div>
    </div>
  );
}
