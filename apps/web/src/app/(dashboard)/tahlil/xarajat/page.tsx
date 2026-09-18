'use client';

import { expensesApi, type BreakdownNode } from '@/features/expenses/api';
import {
  formatDate,
  formatPercent,
  formatPeriod
} from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { BarChart } from '@/components/shared/bar-chart';
import { BreakdownTree } from '@/components/shared/breakdown-tree';
import {
  DateRangePicker,
  defaultRange,
  type DateRange,
} from '@/components/shared/date-range-picker';
import { DonutChart } from '@/components/shared/donut-chart';
import { ShareBar } from '@/components/shared/share-bar';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconAlert } from '@/components/ui/icons';
import { Change, Money } from '@/components/ui/money';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';

export default function ExpenseAnalysisPage() {
  const searchParams = useSearchParams();

  // URL dan davr olamiz, bolmasa yil boshidan
  const [range, setRange] = useState<DateRange>(() => {
    const from = searchParams.get("dateFrom");
    const to = searchParams.get("dateTo");
    return from && to ? { from, to } : defaultRange();
  });

  const filters = { dateFrom: range.from, dateTo: range.to };

  // Solishtirish va ogohlantirish oxirgi oy boyicha
  const lastPeriod = range.to.slice(0, 7);

  const comparison = useAsync(() => expensesApi.comparison(lastPeriod), [lastPeriod]);
  const trend = useAsync(() => expensesApi.trend(12), []);
  const byGroup = useAsync(() => expensesApi.summaryByGroup(filters), [range.from, range.to]);
  const byCategory = useAsync(() => expensesApi.summaryByCategory(filters), [range.from, range.to]);
  const byDepartment = useAsync(() => expensesApi.summaryByDepartment(filters), [range.from, range.to]);
  const byRegion = useAsync(() => expensesApi.summaryByRegion(filters), [range.from, range.to]);
  const top = useAsync(() => expensesApi.top(filters, 5), [range.from, range.to]);
  const spikes = useAsync(() => expensesApi.spikes(lastPeriod, 30), [lastPeriod]);
  const breakdown = useAsync(() => expensesApi.breakdown(filters), [range.from, range.to]);

  const [selected, setSelected] = useState<BreakdownNode | null>(null);

  const current = comparison.data?.data.current;
  const previous = comparison.data?.data.previous;
  const lastYear = comparison.data?.data.lastYear;

  // O'rtacha yozuv — jami / soni
  const totalTiyin = Number(current?.amountTiyin ?? 0);
  const count = current?.count ?? 0;
  const averageTiyin = count > 0 ? Math.round(totalTiyin / count) : 0;

  const spikeRows = spikes.data?.data.rows ?? [];

  return (
    <>
      <PageHeader
        title="Xarajat tahlili"
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
        {/* Ko'rsatkichlar */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Jami xarajat"
            tiyin={current?.amountTiyin ?? 0}
            hint={count > 0 ? `${count} ta yozuv` : undefined}
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
            label="O'rtacha yozuv"
            tiyin={String(averageTiyin)}
            hint="Bitta yozuvning o'rtacha summasi"
          />
        </div>

        {/* Keskin oshgan moddalar */}
        {spikeRows.length > 0 && (
          <div className="rounded-[--radius-card] border border-[--color-warn] bg-[--color-warn-soft] p-4">
            <div className="flex items-start gap-3">
              <IconAlert className="mt-0.5 size-5 shrink-0 text-[--color-warn]" />

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[--color-warn]">
                  Keskin oshgan moddalar
                </p>
                <p className="mt-0.5 text-xs text-[--color-text-muted]">
                  O&rsquo;tgan oyga nisbatan 30% dan ko&rsquo;p
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

        {/* Tarkib daraxti */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Xarajat tarkibi"
            description="Qatorni bosib ichiga kiring"
          />

          {breakdown.loading ? (
            <LoadingState />
          ) : (breakdown.data?.data.rows.length ?? 0) === 0 ? (
            <EmptyState title="Bu davrda xarajat yoq" />
          ) : (
            <>
              <CardBody className="border-b border-[--color-line]">
                <DonutChart
                  slices={(selected?.children ?? breakdown.data?.data.rows ?? []).map(
                    (node) => ({
                      key: node.key,
                      label: node.label,
                      amountTiyin: node.amountTiyin,
                      sharePercent: node.sharePercent,
                    }),
                  )}
                  totalTiyin={
                    selected?.amountTiyin ?? breakdown.data?.data.totalTiyin ?? "0"
                  }
                />

                {selected && (
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="mt-3 text-xs font-medium text-brand-700 hover:underline"
                  >
                    Umumiy korinishga qaytish
                  </button>
                )}
              </CardBody>

              <BreakdownTree
                nodes={breakdown.data?.data.rows ?? []}
                selectedKey={selected?.key ?? null}
                onSelect={(node) =>
                  setSelected(node && node.children.length > 0 ? node : null)
                }
              />
            </>
          )}
        </Card>

        {/* Guruhlar */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Xarajat guruhlari"
            description="Asosiy yo'nalishlar bo'yicha"
          />

          {byGroup.loading ? (
            <LoadingState />
          ) : (byGroup.data?.data.rows.length ?? 0) === 0 ? (
            <EmptyState title="Bu davrda xarajat yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Guruh</Th>
                  <Th align="center" className="w-20">
                    Soni
                  </Th>
                  <Th className="w-36">Ulush</Th>
                  <Th align="center" className="w-28">
                    O&apos;zgarish
                  </Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {byGroup.data?.data.rows.map((row) => (
                  <Tr key={row.code}>
                    <Td className="font-medium">{row.label}</Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {row.count}
                    </Td>

                    <Td>
                      <div className="flex items-center gap-2">
                        <ShareBar
                          percent={row.sharePercent}
                          color="var(--color-expense)"
                        />
                        <span className="money w-12 shrink-0 text-right text-xs text-[--color-text-muted]">
                          {formatPercent(row.sharePercent)}
                        </span>
                      </div>
                    </Td>

                    <Td align="center">
                      <Change percent={row.changePercent} positiveIsGood={false} />
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
                      tiyin={byGroup.data?.data.totalTiyin ?? 0}
                      tone="expense"
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
            title="Eng katta 5 xarajat"
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
                  <Th>Kategoriya</Th>
                  <Th>Tavsif</Th>
                  <Th className="w-44">Bo&apos;lim / Hudud</Th>
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

                    <Td>{item.category.label}</Td>

                    <Td className="max-w-xs truncate text-[--color-text-muted]">
                      {item.description ?? '\u2014'}
                    </Td>

                    <Td className="text-[--color-text-muted]">
                      {item.department?.name ?? item.region?.name ?? 'Umumkorxona'}
                    </Td>

                    <Td money>
                      <Money tiyin={item.amountTiyin} tone="expense" />
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {/* Kategoriyalar */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Kategoriyalar"
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
                {byCategory.data?.data.rows.map((row) => (
                  <Tr key={row.categoryCode}>
                    <Td className="max-w-md truncate">{row.label}</Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {row.count}
                    </Td>

                    <Td>
                      <div className="flex items-center gap-2">
                        <ShareBar
                          percent={row.sharePercent}
                          color="var(--color-expense)"
                        />
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

        {/* Hududlar va bo'limlar */}
        <div className="grid gap-4 lg:grid-cols-2">
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
                  {byRegion.data?.data.rows.map((row) => (
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
              </Table>
            )}
          </Card>

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
                  {byDepartment.data?.data.rows.map((row) => (
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
              </Table>
            )}
          </Card>
        </div>
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
