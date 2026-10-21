'use client';

import { SourceActions } from '@/components/shared/source-actions';

import { usePeriod } from '@/lib/period';
import {
    KIND_LABELS,
    leasesApi,
    STATUS_LABELS,
    type LeaseDetail,
    type LeaseListItem,
} from '@/features/leases/api';
import { Mark } from '@/features/reactions/mark';
import { districtMark, leaseMark } from '@/features/reactions/marks';
import { useAuth } from '@/lib/auth-context';
import { formatPeriod, formatPeriodShort, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState, type ReactNode } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { IconAlert, IconPlus, IconUpload } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { Toast } from '@/components/ui/toast';

import { ImportDialog } from './_components/import-dialog';
import { LeaseDrawer } from './_components/lease-drawer';
import { LeaseForm } from './_components/lease-form';
import { MonthPanel } from './_components/month-panel';

const tabs = [
  { href: '/xarajatlar/doimiy', label: "Ro'yxat" },
  { href: '/xarajatlar/tahlil', label: 'Tahlil' },
  { href: '/xarajatlar/ish-haqi', label: 'Ish haqi' },
  { href: '/xarajatlar/tarkib', label: 'Ish haqi tarkibi' },
  { href: '/xarajatlar/ijara', label: 'Ijara' },
];

const STATUS_OPTIONS = [
  { value: 'active', label: 'Shu oyda amalda' },
  { value: 'upcoming', label: 'Hali boshlanmagan' },
  { value: 'ended', label: 'Tugagan' },
  { value: 'all', label: 'Hammasi' },
];

const KIND_OPTIONS = [
  { value: '', label: 'Barcha turlar' },
  { value: 'ODDIY', label: KIND_LABELS.ODDIY },
  { value: 'AEROPORT', label: KIND_LABELS.AEROPORT },
];

type ToastState = { message: string; tone: 'success' | 'error' } | null;

/** Formani qaysi holatda ochish: null — yopiq, 'new' — yangi, LeaseDetail — tahrirlash */
type FormTarget = null | 'new' | LeaseDetail;

interface Group {
  key: string;
  title: string;
  items: LeaseListItem[];
  totalTiyin: bigint;
}

/** Aeroportlar alohida, qolganlari — hudud bo'yicha (Markaz birinchi) */
function groupLeases(items: LeaseListItem[]): Group[] {
  const map = new Map<string, Group>();
  for (const item of items) {
    const key = item.kind === 'AEROPORT' ? 'airport' : `r${item.place.regionCode}`;
    const title = item.kind === 'AEROPORT' ? 'Aeroportlar' : item.place.regionName;
    const group = map.get(key) ?? { key, title, items: [], totalTiyin: 0n };
    group.items.push(item);
    group.totalTiyin += BigInt(item.monthlyTiyin);
    map.set(key, group);
  }
  const order = (group: Group) =>
    group.key === 'airport' ? 10_000 : Number(group.key.slice(1));
  return [...map.values()].sort((a, b) => order(a) - order(b));
}

export default function LeasesPage() {
  const { isAdmin } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  /** Oy — yuqori paneldagi umumiy «Davr» tugmasidan (oy ko'rinishi) */
  const { month: period, setMonth: setPeriod } = usePeriod();
  const [kind, setKind] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');

  const [selected, setSelected] = useState<string | null>(() => searchParams.get('lease'));
  const [formTarget, setFormTarget] = useState<FormTarget>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [importOpen, setImportOpen] = useState(false);
  /** O'chirish uchun belgilangan shartnomalar */
  const [checked, setChecked] = useState<Set<string>>(new Set());

  /** Ochiq shartnoma URL'da — havolani yuborish mumkin (oyni umumiy «Davr» o'zi yozadi) */
  const syncLease = useCallback(
    (leaseId: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (leaseId) params.set('lease', leaseId);
      else params.delete('lease');
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const openLease = (id: string | null) => {
    setSelected(id);
    syncLease(id);
  };

  const lookups = useAsync(() => leasesApi.lookups(), []);
  const list = useAsync(
    () =>
      leasesApi.list({
        period,
        kind: kind || undefined,
        regionCode: regionCode ? Number(regionCode) : undefined,
        status,
        search: search.trim() || undefined,
      }),
    [period, kind, regionCode, status, search],
  );
  const month = useAsync(() => leasesApi.month(period), [period]);
  const months = useAsync(() => leasesApi.months(), []);

  const reloadAll = () => {
    list.reload();
    month.reload();
    months.reload();
    lookups.reload();
  };

  const notify = (message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
    if (tone === 'success') reloadAll();
  };

  const data = list.data?.data;
  const items = data?.items ?? [];
  const groups = useMemo(() => groupLeases(items), [items]);
  const listTotal = items.reduce((sum, item) => sum + BigInt(item.monthlyTiyin), 0n);

  const regionOptions = useMemo(
    () => [
      { value: '', label: 'Barcha hududlar' },
      ...(lookups.data?.data.regions ?? []).map((r) => ({ value: String(r.code), label: r.name })),
    ],
    [lookups.data],
  );

  const byKind = (value: 'ODDIY' | 'AEROPORT') => data?.summary.byKind.find((k) => k.kind === value);

  return (
    <>
      <PageHeader
        title="Xarajatlar"
        description={`Ijara · ${formatPeriod(period)}`}
      />

      <Tabs items={tabs} className="bg-white px-6" />

      <div className="space-y-4 p-6">
        {/* Amallar — hamma Manba sahifasida bir xil joyda */}
        <SourceActions
          add={{ label: 'Yangi shartnoma', onClick: () => setFormTarget('new') }}
          upload={{ label: "Excel'dan yuklash", onClick: () => setImportOpen(true) }}
          deleteData={{
            target: 'LEASE',
            selectedIds: [...checked],
            month: period,
            place: 'Xarajatlar › Ijara',
            label: checked.size ? "Belgilanganlarni o'chirish" : "O'chirish",
            onDone: ({ count }) => {
              setChecked(new Set());
              notify(`${count} ta o'chirildi (shartnoma yoki oy hisobi)`);
            },
          }}
        />

        {/* ── Filtrlar ── */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-44">
            <Select options={KIND_OPTIONS} value={kind} onChange={(e) => setKind(e.target.value)} className="h-9" />
          </div>
          <div className="w-48">
            <Select
              options={regionOptions}
              value={regionCode}
              onChange={(e) => setRegionCode(e.target.value)}
              className="h-9"
            />
          </div>
          <div className="w-48">
            <Select options={STATUS_OPTIONS} value={status} onChange={(e) => setStatus(e.target.value)} className="h-9" />
          </div>
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder="Raqam, obyekt, ijaraga beruvchi…"
            className="w-72"
          />
        </div>

        {/* ── Raqamlar ── */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label={`Ijara · ${formatPeriodShort(period)}`} hint={`${data?.summary.active ?? '—'} ta amaldagi shartnoma`}>
            {data ? <Money tiyin={data.summary.monthlyTiyin} /> : '—'}
          </Tile>
          <Tile label="Hududlar va Markaz" hint={`${byKind('ODDIY')?.count ?? 0} ta shartnoma`}>
            {data ? <Money tiyin={byKind('ODDIY')?.monthlyTiyin ?? '0'} /> : '—'}
          </Tile>
          <Tile label="Aeroportlar" hint={`${byKind('AEROPORT')?.count ?? 0} ta shartnoma`}>
            {data ? <Money tiyin={byKind('AEROPORT')?.monthlyTiyin ?? '0'} /> : '—'}
          </Tile>
          <Tile
            label="Hujjatsiz shartnomalar"
            hint="Shartnoma fayli yuklanmagan"
            warn={(data?.summary.withoutContract ?? 0) > 0}
          >
            {data?.summary.withoutContract ?? '—'}
          </Tile>
        </div>

        {/* ── Oyni yopish ── */}
        <MonthPanel
          period={period}
          month={month.data?.data ?? null}
          months={months.data?.data ?? null}
          loading={month.loading}
          isAdmin={isAdmin}
          onPeriodChange={setPeriod}
          onOpenLease={(id) => openLease(id)}
          onDone={notify}
        />

        {/* ── Shartnomalar ── */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Ijara shartnomalari"
            description={`Summalar ${formatPeriod(period)} holatiga · qatorni bosing — shartnoma kartasi ochiladi`}
          />

          {list.loading && !data ? (
            <TableSkeleton rows={8} cols={6} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : items.length === 0 ? (
            <EmptyState
              title={data?.summary.total === 0 ? "Hali ijara shartnomasi yo'q" : 'Filtr bo‘yicha topilmadi'}
              description={
                data?.summary.total === 0
                  ? 'Birinchi shartnomani qo‘shing yoki Excel’dan import qiling — keyingi oylarga o‘zi davom etadi'
                  : 'Holat yoki hudud filtrini o‘zgartirib ko‘ring'
              }
              action={
                isAdmin && data?.summary.total === 0 ? (
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
                      <IconUpload className="size-4" />
                      Excel&rsquo;dan import
                    </Button>
                    <Button size="sm" onClick={() => setFormTarget('new')}>
                      <IconPlus className="size-4" />
                      Yangi shartnoma
                    </Button>
                  </div>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <Tr>
                  {isAdmin && (
                    <Th className="w-10">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-600"
                        title="Hammasini belgilash"
                        checked={items.length > 0 && items.every((i) => checked.has(i.id))}
                        onChange={(e) => setChecked(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                      />
                    </Th>
                  )}
                  <Th>Obyekt</Th>
                  <Th>Joyi</Th>
                  <Th>Ijaraga beruvchi</Th>
                  <Th className="w-40">Muddati</Th>
                  <Th className="w-28">Holat</Th>
                  <Th align="right" className="w-40">
                    Oylik summa
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {groups.map((group) => (
                  <GroupRows
                    key={group.key}
                    group={group}
                    onOpen={openLease}
                    showHeader={groups.length > 1}
                    checked={isAdmin ? checked : null}
                    onCheck={(id) =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      })
                    }
                  />
                ))}
              </TBody>
              <TFoot>
                <Tr>
                  <Td colSpan={isAdmin ? 6 : 5} className="font-semibold">
                    Jami: {items.length} ta shartnoma{checked.size ? ` · belgilangan: ${checked.size}` : ''}
                  </Td>
                  <Td align="right" money className="font-semibold">
                    <Money tiyin={listTotal} />
                  </Td>
                </Tr>
              </TFoot>
            </Table>
          )}
        </Card>
      </div>

      {selected && (
        <LeaseDrawer
          key={selected}
          leaseId={selected}
          period={period}
          isAdmin={isAdmin}
          onClose={() => openLease(null)}
          onEdit={(lease) => setFormTarget(lease)}
          onChanged={(message) => {
            setToast({ message, tone: 'success' });
            list.reload();
            month.reload();
            months.reload();
          }}
          onDeleted={(message) => {
            openLease(null);
            notify(message);
          }}
        />
      )}

      {formTarget && (
        <LeaseForm
          lease={formTarget === 'new' ? null : formTarget}
          lookups={lookups.data?.data ?? null}
          onClose={() => setFormTarget(null)}
          onSaved={(lease, message) => {
            setFormTarget(null);
            const stale = lease.stalePeriods ?? [];
            notify(
              stale.length > 0
                ? `${message}. Qayta yopish kerak: ${stale.map(formatPeriodShort).join(', ')}`
                : message,
            );
            // Kartani yangidan ochamiz — yangi ma'lumotlar bilan
            setSelected(null);
            setTimeout(() => openLease(lease.id), 0);
          }}
        />
      )}

      {importOpen && (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImported={(message) => {
            setImportOpen(false);
            notify(message);
          }}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={5000} />}
    </>
  );
}

function GroupRows({
  group,
  onOpen,
  showHeader,
  checked,
  onCheck,
}: {
  group: Group;
  onOpen: (id: string) => void;
  showHeader: boolean;
  /** Administrator: o'chirish uchun belgilash (null — ustun yo'q) */
  checked: Set<string> | null;
  onCheck: (id: string) => void;
}) {
  return (
    <>
      {showHeader && (
        <tr className="bg-(--color-surface-muted)">
          <td colSpan={checked ? 6 : 5} className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">
            {group.title} · {group.items.length}
          </td>
          <td className="px-4 py-2 text-right">
            <Money tiyin={group.totalTiyin} className="text-xs font-semibold" />
          </td>
        </tr>
      )}
      {group.items.map((item) => {
        const status = STATUS_LABELS[item.status];
        return (
          <Tr key={item.id} clickable onClick={() => onOpen(item.id)}>
            {checked && (
              <Td className="w-10" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="size-4 accent-brand-600" checked={checked.has(item.id)} onChange={() => onCheck(item.id)} />
              </Td>
            )}
            <Td>
              <span className="flex max-w-[18rem] items-center gap-1.5">
                <Mark item={leaseMark(item)} />
                <span className="truncate font-medium">{item.title}</span>
              </span>
              <span className="flex items-center gap-1.5 text-xs text-(--color-text-muted)">
                № {item.number}
                {!item.hasContract && (
                  <span className="inline-flex items-center gap-0.5 text-(--color-warn)" title="Shartnoma fayli yuklanmagan">
                    <IconAlert className="size-3" />
                    hujjatsiz
                  </span>
                )}
              </span>
            </Td>
            <Td className="text-(--color-text-muted)">
              <span className="flex max-w-[14rem] items-center gap-1.5">
                {item.kind !== 'AEROPORT' && item.place.districtId && item.place.districtName && (
                  <Mark item={districtMark(item.place.districtId, item.place.districtName, 'EXPENSE', null, 'Ijara › tuman')} />
                )}
                <span className="truncate">
                {item.kind === 'AEROPORT'
                  ? (item.place.airportName ?? item.place.label)
                  : (item.place.districtName ?? item.place.departmentName ?? item.place.regionName)}
                </span>
              </span>
            </Td>
            <Td>
              <span className="block max-w-[14rem] truncate">{item.lessorName}</span>
            </Td>
            <Td className="text-xs text-(--color-text-muted)">
              {formatPeriodShort(item.startPeriod)} — {item.endPeriod ? formatPeriodShort(item.endPeriod) : 'muddatsiz'}
            </Td>
            <Td>
              <Badge tone={status.tone}>{status.label}</Badge>
            </Td>
            <Td align="right" money>
              <Money tiyin={item.monthlyTiyin} />
              {item.nextChange && (
                <p
                  className="text-xs text-(--color-warn)"
                  title={`${formatPeriod(item.nextChange.validFrom)} dan`}
                >
                  → {formatTiyin(item.nextChange.monthlyTiyin)} ({formatPeriodShort(item.nextChange.validFrom)})
                </p>
              )}
            </Td>
          </Tr>
        );
      })}
    </>
  );
}

function Tile({
  label,
  hint,
  warn,
  children,
}: {
  label: string;
  hint?: string;
  warn?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-(--radius-card) border bg-white p-4',
        warn ? 'border-(--color-warn)' : 'border-(--color-line)',
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-2 text-xl font-semibold', warn && 'text-(--color-warn)')}>{children}</p>
      {hint && <p className="mt-1 text-xs text-(--color-text-muted)">{hint}</p>}
    </div>
  );
}