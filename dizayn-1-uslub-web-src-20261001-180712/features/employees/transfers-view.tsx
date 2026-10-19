'use client';

import { DateRangePicker, defaultRange, type DateRange } from '@/components/shared/date-range-picker';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';

import {
    employmentLabel,
    placeLabel,
    TRANSFER_KIND_LABELS,
    transfersApi,
} from './transfers-api';

interface Props {
  regionOptions: { value: string; label: string }[];
  onOpenEmployee: (pinfl: string) => void;
}

/** O'tkazmalar — kim, qachon, qayerdan qayerga o'tgan */
export function TransfersView({ regionOptions, onOpenEmployee }: Props) {
  const [range, setRange] = useState<DateRange>(defaultRange);
  const [regionCode, setRegionCode] = useState('');

  const list = useAsync(
    () =>
      transfersApi.list({
        from: range.from.slice(0, 7),
        to: range.to.slice(0, 7),
        regionCode: regionCode ? Number(regionCode) : undefined,
      }),
    [range.from, range.to, regionCode],
  );

  const data = list.data?.data;
  const transfers = data?.transfers ?? [];

  const count = (kind: 'region' | 'district' | 'type') =>
    transfers.filter((t) => t.kinds.includes(kind)).length;

  return (
    <div className="space-y-4">
      {/* Filtrlar */}
      <div className="flex flex-wrap items-center gap-3">
        <DateRangePicker value={range} onChange={setRange} />
        <div className="w-52">
          <Select
            options={regionOptions}
            value={regionCode}
            onChange={(event) => setRegionCode(event.target.value)}
            className="h-9"
          />
        </div>
        <p className="text-xs text-(--color-text-muted)">
          O&rsquo;tkazmalar har oylik Natijalar faylidagi hudud va tumandan aniqlanadi
        </p>
      </div>

      {/* Raqamlar */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Jami o'tkazmalar" value={data?.total} />
        <Tile label="Boshqa hududga" value={data ? count('region') : undefined} />
        <Tile label="Tuman ichida" value={data ? count('district') : undefined} />
        <Tile label="Ish turi o'zgargan" value={data ? count('type') : undefined} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Hududlar harakati */}
        <Card className="overflow-hidden xl:col-span-1">
          <CardHeader title="Hududlar bo'yicha" description="Boshqa hududdan kelgan va ketganlar" />
          {list.loading ? (
            <TableSkeleton rows={5} cols={3} />
          ) : (data?.regions.length ?? 0) === 0 ? (
            <EmptyState title="Hududlararo o'tkazma yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Hudud</Th>
                  <Th align="center" className="w-20">
                    Keldi
                  </Th>
                  <Th align="center" className="w-20">
                    Ketdi
                  </Th>
                  <Th align="center" className="w-20">
                    Sof
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {data?.regions.map((region) => (
                  <Tr key={region.regionCode}>
                    <Td className="truncate">{region.regionName}</Td>
                    <Td align="center" className="money text-(--color-income)">
                      {region.arrived > 0 ? `+${region.arrived}` : '—'}
                    </Td>
                    <Td align="center" className="money text-(--color-expense)">
                      {region.left > 0 ? `−${region.left}` : '—'}
                    </Td>
                    <Td
                      align="center"
                      className={cn(
                        'money font-medium',
                        region.net > 0 && 'text-(--color-income)',
                        region.net < 0 && 'text-(--color-expense)',
                      )}
                    >
                      {region.net > 0 ? `+${region.net}` : region.net < 0 ? `−${-region.net}` : '0'}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {/* O'tkazmalar ro'yxati */}
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader
            title="O'tkazmalar"
            description="Qatorni bosing — xodim ma'lumotlari va to'liq tarixi ochiladi"
          />

          {list.loading ? (
            <TableSkeleton rows={8} cols={4} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : transfers.length === 0 ? (
            <EmptyState
              title="Bu davrda o'tkazma yo'q"
              description="Kamida ikki oylik Natijalar fayli yuklangan bo'lishi kerak"
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th className="w-36">Qachondan</Th>
                  <Th>Xodim</Th>
                  <Th>Qayerdan</Th>
                  <Th className="w-6" />
                  <Th>Qayerga</Th>
                  <Th className="w-28">Turi</Th>
                </Tr>
              </THead>
              <TBody>
                {transfers.map((transfer) => (
                  <Tr
                    key={`${transfer.pinfl}-${transfer.period}`}
                    clickable
                    onClick={() => onOpenEmployee(transfer.pinfl)}
                  >
                    <Td>
                      <span className="font-medium">{formatPeriod(transfer.period)}</span>
                      <p className="text-xs text-(--color-text-faint)">
                        oldin: {formatPeriod(transfer.previousPeriod)}
                      </p>
                    </Td>
                    <Td>
                      <span className="block truncate">{transfer.fullName}</span>
                      <span className="money text-xs text-(--color-text-muted)">{transfer.pinfl}</span>
                    </Td>
                    <Td className="text-(--color-text-muted)">
                      <span className="block truncate">{placeLabel(transfer.from)}</span>
                      <span className="text-xs">{employmentLabel(transfer.from.employmentType)}</span>
                    </Td>
                    <Td className="text-(--color-warn)">&rarr;</Td>
                    <Td>
                      <span className="block truncate font-medium">{placeLabel(transfer.to)}</span>
                      <span className="text-xs text-(--color-text-muted)">
                        {employmentLabel(transfer.to.employmentType)}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {transfer.kinds.map((kind) => (
                          <Badge key={kind} tone="warn">
                            {TRANSFER_KIND_LABELS[kind]}
                          </Badge>
                        ))}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>
    </div>
  );
}

function Tile({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className="money mt-2 text-xl font-semibold">{value ?? '—'}</p>
    </div>
  );
}
