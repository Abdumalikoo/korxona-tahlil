'use client';

import { useState } from 'react';
import { useAsync } from '@/lib/use-async';
import { incomesApi, type IncomeFilters } from '@/features/incomes/api';
import { referencesApi } from '@/features/shared/references';
import { currentPeriod, formatPeriod, formatPercent } from '@/lib/format';

import { PageHeader } from '@/components/layout/page-header';
import { Tabs } from '@/components/ui/tabs';
import { PeriodPicker } from '@/components/shared/period-picker';
import { ShareBar } from '@/components/shared/share-bar';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState, LoadingState, ErrorState } from '@/components/ui/states';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/daromadlar', label: "Ro'yxat" },
  { href: '/daromadlar/tahlil', label: 'Tahlil' },
  { href: '/daromadlar/mijozlar', label: 'Mijozlar' },
];

const groupTones = {
  A: 'income',
  B: 'warn',
  C: 'neutral',
} as const;

export default function ClientsPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [departmentId, setDepartmentId] = useState('');

  const filters: IncomeFilters = {
    period,
    departmentId: departmentId || undefined,
  };

  const departments = useAsync(() => referencesApi.departments(), []);
  const abc = useAsync(() => incomesApi.abc(filters), [period, departmentId]);

  const departmentOptions = [
    { value: '', label: "Barcha bo'limlar" },
    ...(departments.data?.data ?? []).map((item) => ({
      value: item.id,
      label: item.name,
    })),
  ];

  const data = abc.data?.data;
  const rows = data?.rows ?? [];
  const summary = data?.summary;
  const totalClients = rows.length;

  /** Har guruhning summasi */
  function groupTotal(group: 'A' | 'B' | 'C'): bigint {
    return rows
      .filter((row) => row.group === group)
      .reduce((sum, row) => sum + BigInt(row.amountTiyin), 0n);
  }

  return (
    <>
      <PageHeader title="Daromadlar" description={`Mijozlar \u00B7 ${formatPeriod(period)}`} />

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

        {/* ABC guruhlari */}
        <Card>
          <CardHeader
            title="ABC-tahlil"
            description="Mijozlar daromad ulushi bo'yicha guruhlangan"
          />
          <CardBody>
            {abc.loading ? (
              <LoadingState />
            ) : totalClients === 0 ? (
              <EmptyState title="Bu davrda mijoz yo'q" />
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <GroupCard
                  letter="A"
                  description="Daromadning 80% ini beruvchilar"
                  count={summary?.A ?? 0}
                  totalClients={totalClients}
                  totalTiyin={groupTotal('A')}
                />
                <GroupCard
                  letter="B"
                  description="Keyingi 15%"
                  count={summary?.B ?? 0}
                  totalClients={totalClients}
                  totalTiyin={groupTotal('B')}
                />
                <GroupCard
                  letter="C"
                  description="Qolgan 5%"
                  count={summary?.C ?? 0}
                  totalClients={totalClients}
                  totalTiyin={groupTotal('C')}
                />
              </div>
            )}
          </CardBody>
        </Card>

        {/* Mijozlar jadvali */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Mijozlar ro'yxati"
            description="Eng katta daromaddan boshlab"
          />

          {abc.loading ? (
            <LoadingState />
          ) : abc.error ? (
            <ErrorState message={abc.error} onRetry={abc.reload} />
          ) : totalClients === 0 ? (
            <EmptyState
              title="Mijozlar topilmadi"
              description="Daromad yozuvlarida mijoz nomi ko'rsatilmagan bo'lishi mumkin"
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th className="w-12">Guruh</Th>
                  <Th>Mijoz</Th>
                  <Th align="center" className="w-24">
                    Shartnoma
                  </Th>
                  <Th className="w-40">Ulush</Th>
                  <Th align="right" className="w-24">
                    Jamlangan
                  </Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {rows.map((row) => (
                  <Tr key={row.clientName}>
                    <Td>
                      <Badge tone={groupTones[row.group]}>{row.group}</Badge>
                    </Td>

                    <Td className="truncate">{row.clientName}</Td>

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

                    <Td align="right" className="money text-xs text-[--color-text-muted]">
                      {formatPercent(row.cumulativePercent)}
                    </Td>

                    <Td money>
                      <Money tiyin={row.amountTiyin} tone="income" />
                    </Td>
                  </Tr>
                ))}
              </TBody>

              <TFoot>
                <Tr>
                  <Td colSpan={5}>Jami &middot; {totalClients} ta mijoz</Td>
                  <Td money>
                    <Money
                      tiyin={data?.totalTiyin ?? 0}
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

// ─────────── Guruh kartochkasi ───────────

function GroupCard({
  letter,
  description,
  count,
  totalClients,
  totalTiyin,
}: {
  letter: 'A' | 'B' | 'C';
  description: string;
  count: number;
  totalClients: number;
  totalTiyin: bigint;
}) {
  const clientShare = totalClients > 0 ? (count / totalClients) * 100 : 0;

  const colors = {
    A: 'border-[--color-income] bg-[--color-income-soft]',
    B: 'border-[--color-warn] bg-[--color-warn-soft]',
    C: 'border-[--color-line] bg-[--color-surface-muted]',
  };

  return (
    <div className={cn('rounded-[--radius-card] border p-4', colors[letter])}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-lg font-bold">{letter}</p>
          <p className="text-xs text-[--color-text-muted]">{description}</p>
        </div>
      </div>

      <p className="money mt-3 text-xl font-semibold">{count}</p>
      <p className="text-xs text-[--color-text-muted]">
        mijoz &middot; {formatPercent(clientShare)} ulush
      </p>

      <div className="mt-2 border-t border-[--color-line] pt-2">
        <Money tiyin={String(totalTiyin)} tone="income" className="text-sm font-medium" />
      </div>
    </div>
  );
}
