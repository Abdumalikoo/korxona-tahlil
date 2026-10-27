'use client';

import { usePeriod } from '@/lib/period';
import {
  FUEL_LABELS,
  fuelUnit,
  KIND_COLORS,
  KIND_LABELS,
  KINDS,
  PAYMENT_LABELS,
  vehiclesApi,
  type KindAmounts,
  type VehicleItem,
  type VehicleRecordItem,
  type VehicleRecordKind,
  type VehicleSummaryRow,
} from '@/features/vehicles/api';
import { DiscussMenu } from '@/features/reactions/discuss';
import { Mark } from '@/features/reactions/mark';
import { vehicleMark } from '@/features/reactions/marks';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatPeriod, formatPeriodShort, formatSum, formatTiyin, shiftPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useBrief } from '@/lib/view-mode';
import { useCallback, useMemo, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconEdit, IconPlus, IconTrash } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { Toast } from '@/components/ui/toast';

import { RoleTabs } from '@/features/roles/role-tabs';
import { VehicleDemoPanel } from '@/features/vehicles/demo-panel';
import { RecordForm } from '@/features/vehicles/record-form';
import { VehicleForm } from '@/features/vehicles/vehicle-form';
import { FuelImportDialog } from '@/features/vehicles/fuel-import';

type ToastState = { message: string; tone: 'success' | 'error' } | null;

/** Mashina formasi: null — yopiq, 'new' — yangi, VehicleItem — tahrirlash */
type VehicleTarget = null | 'new' | VehicleItem;
/** Xarajat formasi */
type RecordTarget =
  | null
  | { mode: 'new'; vehicleId?: string; kind?: VehicleRecordKind }
  | { mode: 'edit'; record: VehicleRecordItem };

function sumKinds(amounts: KindAmounts, kinds: VehicleRecordKind[]): bigint {
  return kinds.reduce((sum, kind) => sum + BigInt(amounts[kind]), 0n);
}

// ═══════════════════════════════════════════════════════════
// Tur bo'yicha chiziq (ulushlar)
// ═══════════════════════════════════════════════════════════

function KindBar({ amounts, className }: { amounts: KindAmounts; className?: string }) {
  const total = sumKinds(amounts, KINDS);
  if (total === 0n) {
    return <div className={cn('h-2 rounded-full bg-(--color-surface-sunken)', className)} />;
  }
  return (
    <div className={cn('flex h-2 overflow-hidden rounded-full bg-(--color-surface-sunken)', className)}>
      {KINDS.map((kind) => {
        const value = BigInt(amounts[kind]);
        if (value === 0n) return null;
        const width = Number((value * 10_000n) / total) / 100;
        return (
          <div
            key={kind}
            style={{ width: `${width}%`, background: KIND_COLORS[kind] }}
            title={`${KIND_LABELS[kind]}: ${formatTiyin(value)} so'm`}
          />
        );
      })}
    </div>
  );
}

function KindDot({ kind }: { kind: VehicleRecordKind }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="size-2 shrink-0 rounded-full" style={{ background: KIND_COLORS[kind] }} />
      {KIND_LABELS[kind]}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════
// Mashina kartasi
// ═══════════════════════════════════════════════════════════

function VehicleCard({
  vehicle,
  isAdmin,
  canAdd,
  onAdd,
  onEdit,
  onDelete,
}: {
  vehicle: VehicleItem;
  isAdmin: boolean;
  /** Kartadan yangi xarajat qo'shish (faqat Omborchi bo'limida; dashbordda yo'q) */
  canAdd: boolean;
  onAdd: (kind: VehicleRecordKind) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { month } = vehicle;
  const unit = fuelUnit(vehicle.fuelType);

  return (
    <Card className={cn('flex flex-col', !vehicle.isActive && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3 border-b border-(--color-line) px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Mark item={vehicleMark(vehicle)} />
            <span className="rounded border-2 border-(--color-text) px-1.5 py-0.5 font-mono text-sm font-bold tracking-wider text-(--color-text)">
              {vehicle.plateNumber}
            </span>
            {!vehicle.isActive && <Badge>Faol emas</Badge>}
          </div>
          <p className="mt-1.5 truncate text-sm font-medium text-(--color-text)">
            {vehicle.model}
            {vehicle.year ? `, ${vehicle.year}` : ''}
            {vehicle.color ? ` · ${vehicle.color}` : ''}
          </p>
          <p className="truncate text-xs text-(--color-text-muted)">
            {FUEL_LABELS[vehicle.fuelType]}
            {vehicle.fuelNorm ? ` · me'yor ${String(vehicle.fuelNorm).replace('.', ',')} ${unit}/100 km` : ''}
            {' · '}
            {vehicle.departmentName ?? vehicle.regionName}
          </p>
          {vehicle.driverName && (
            <p className="truncate text-xs text-(--color-text-muted)">
              Haydovchi: {vehicle.driverName}
              {vehicle.driverPhone ? ` · ${vehicle.driverPhone}` : ''}
            </p>
          )}
        </div>
        {isAdmin && (
          <div className="flex shrink-0 items-center gap-1">
            <DiscussMenu items={[vehicleMark(vehicle)]} label="Muhokama" size="xs" />
            <button
              type="button"
              onClick={onEdit}
              className="rounded p-1.5 text-(--color-text-muted) hover:bg-(--color-surface-sunken) hover:text-(--color-text)"
              aria-label="Tahrirlash"
            >
              <IconEdit className="size-4" />
            </button>
            {vehicle.recordCount === 0 && (
              <button
                type="button"
                onClick={onDelete}
                className="rounded p-1.5 text-(--color-text-muted) hover:bg-(--color-expense-soft) hover:text-(--color-expense)"
                aria-label="O'chirish"
              >
                <IconTrash className="size-4" />
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 space-y-3 px-4 py-3">
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-xs text-(--color-text-muted)">Shu oy</p>
            <Money tiyin={month.totalTiyin} className="text-xl font-semibold" />
            <span className="ml-1 text-xs text-(--color-text-muted)">so'm</span>
          </div>
          <div className="text-right text-xs text-(--color-text-muted)">
            <p>{month.count} ta yozuv</p>
            {month.liters > 0 && (
              <p>
                {formatSum(month.liters, { decimals: month.liters % 1 ? 1 : 0 })} {unit}
              </p>
            )}
          </div>
        </div>

        <KindBar amounts={month.byKind} />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {KINDS.filter((kind) => kind !== 'OTHER' || BigInt(month.byKind.OTHER) > 0n).map((kind) => (
            <div key={kind} className="flex justify-between gap-2">
              <dt className="text-(--color-text-muted)">
                <KindDot kind={kind} />
              </dt>
              <dd className="money text-(--color-text)">{formatTiyin(month.byKind[kind])}</dd>
            </div>
          ))}
        </dl>

        {vehicle.lastOdometerKm != null && (
          <p className="text-xs text-(--color-text-muted)">
            Spidometr: <span className="money text-(--color-text)">{formatSum(vehicle.lastOdometerKm)} km</span>
          </p>
        )}
      </div>

      {canAdd && vehicle.isActive && (
        <div className="grid grid-cols-3 gap-1 border-t border-(--color-line) p-2">
          {(['FUEL', 'WASH', 'REPAIR'] as VehicleRecordKind[]).map((kind) => (
            <Button key={kind} size="sm" variant="ghost" onClick={() => onAdd(kind)}>
              <IconPlus className="size-3.5" />
              {KIND_LABELS[kind]}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// Yillik tahlil
// ═══════════════════════════════════════════════════════════

function MonthlyBars({ months }: { months: { period: string; totalTiyin: string; byKind: KindAmounts }[] }) {
  const max = months.reduce((m, row) => (BigInt(row.totalTiyin) > m ? BigInt(row.totalTiyin) : m), 0n);
  if (max === 0n) {
    return <p className="py-6 text-center text-sm text-(--color-text-muted)">Bu davrda xarajat yo'q</p>;
  }

  return (
    <div>
      <div className="flex h-44 items-end gap-1.5">
        {months.map((row) => {
          const total = BigInt(row.totalTiyin);
          const height = Number((total * 10_000n) / max) / 100;
          return (
            <div key={row.period} className="group relative flex h-full flex-1 flex-col justify-end">
              <div
                className="flex w-full flex-col-reverse overflow-hidden rounded-t"
                style={{ height: `${Math.max(height, total > 0n ? 1.5 : 0)}%` }}
              >
                {KINDS.map((kind) => {
                  const value = BigInt(row.byKind[kind]);
                  if (value === 0n || total === 0n) return null;
                  return (
                    <div
                      key={kind}
                      style={{ height: `${Number((value * 10_000n) / total) / 100}%`, background: KIND_COLORS[kind] }}
                    />
                  );
                })}
              </div>
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-44 -translate-x-1/2 rounded-md border border-(--color-line) bg-white p-2 text-xs shadow-md group-hover:block">
                <p className="mb-1 font-semibold">{formatPeriod(row.period)}</p>
                {KINDS.filter((kind) => BigInt(row.byKind[kind]) > 0n).map((kind) => (
                  <p key={kind} className="flex justify-between gap-2">
                    <KindDot kind={kind} />
                    <span className="money">{formatTiyin(row.byKind[kind])}</span>
                  </p>
                ))}
                <p className="mt-1 flex justify-between gap-2 border-t border-(--color-line) pt-1 font-semibold">
                  <span>Jami</span>
                  <span className="money">{formatTiyin(row.totalTiyin)}</span>
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {months.map((row) => (
          <span key={row.period} className="flex-1 text-center text-[10px] text-(--color-text-muted)">
            {formatPeriodShort(row.period)}
          </span>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--color-text-muted)">
        {KINDS.map((kind) => (
          <KindDot key={kind} kind={kind} />
        ))}
      </div>
    </div>
  );
}

function ConsumptionCell({ row }: { row: VehicleSummaryRow }) {
  if (row.consumptionPer100 === null) return <span className="text-(--color-text-faint)">—</span>;
  const over = row.fuelNorm ? row.consumptionPer100 > row.fuelNorm * 1.1 : false;
  return (
    <span className={cn('money', over && 'font-semibold text-(--color-expense)')} title={over ? "Me'yordan 10% dan ortiq" : undefined}>
      {formatSum(row.consumptionPer100, { decimals: 1 })}
      {row.fuelNorm ? (
        <span className="ml-1 text-xs font-normal text-(--color-text-muted)">/ {String(row.fuelNorm).replace('.', ',')}</span>
      ) : null}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════
// Sahifa
// ═══════════════════════════════════════════════════════════

/**
 * Guruhlar bo'yicha oy holati (dashbord): mashinalar soni, oy xarajati, me'yordan oshganlar.
 */
function GroupSummary({
  vehicles,
  rows,
  order,
}: {
  vehicles: VehicleItem[];
  rows: VehicleSummaryRow[];
  order: { value: string; label: string }[];
}) {
  const byId = new Map(rows.map((r) => [r.vehicleId, r]));
  const over = (v: VehicleItem) => {
    const r = byId.get(v.id);
    return r?.consumptionPer100 != null && v.fuelNorm != null && r.consumptionPer100 > v.fuelNorm * 1.05;
  };
  const groups = [...order, { value: '', label: 'Guruhsiz' }]
    .map((g) => {
      const list = vehicles.filter((v) => v.isActive && (v.fleetGroup ?? '') === g.value);
      return {
        ...g,
        count: list.length,
        total: list.reduce((s, v) => s + BigInt(v.month.totalTiyin), 0n),
        km: list.reduce((s, v) => s + (byId.get(v.id)?.distanceKm ?? 0), 0),
        over: list.filter(over),
      };
    })
    .filter((g) => g.count > 0 || g.value !== '');
  const overAll = groups.flatMap((g) => g.over);

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Guruhlar bo'yicha" description="Tanlangan oy: xarajat, yurgan masofa va me'yordan 5% dan ko'p oshganlar" />
      <div className="grid gap-px bg-(--color-line) sm:grid-cols-2 xl:grid-cols-4">
        {groups.map((g) => (
          <div key={g.value || 'none'} className="bg-white px-4 py-3">
            <p className="text-sm font-semibold text-heading">
              {g.label} <span className="font-normal text-(--color-text-muted)">· {g.count} ta</span>
            </p>
            <Money tiyin={g.total.toString()} className="mt-1 block text-lg font-bold" />
            <p className="text-xs text-(--color-text-muted)">
              {g.km > 0 ? `${formatSum(g.km)} km yurgan` : 'Masofa yo‘q'}
              {g.over.length > 0 && <span className="ml-1 font-semibold text-(--color-expense)">· {g.over.length} ta me&apos;yordan oshgan</span>}
            </p>
          </div>
        ))}
      </div>
      {overAll.length > 0 && (
        <div className="border-t border-(--color-line) bg-(--color-expense-soft)/40 px-4 py-2.5 text-xs">
          <span className="font-semibold text-(--color-expense)">Me&apos;yordan oshgan: </span>
          {overAll.map((v, i) => {
            const r = byId.get(v.id);
            return (
              <span key={v.id}>
                {i > 0 && ' · '}
                <b className="font-mono">{v.plateNumber}</b> {r?.consumptionPer100} / me&apos;yor {v.fuelNorm}
              </span>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/**
 * Mashinalar › Yozuvlar va tahlil: oy yozuvlari (tahrirlash, o'chirish), mashina kartalari, 12 oylik tahlil.
 * Omborchi bo'limida — kiritish ham; umumiy hudud dashbordida (dashboard) — faqat ko'rish va xatoni tuzatish:
 * yangi mashina va xarajat qo'shish tugmalari yo'q, yozuvni ochib tuzatish yoki o'chirish mumkin.
 */
export default function VehiclesPage() {
  return <VehiclesBoard />;
}

export function VehiclesBoard({ dashboard = false }: { dashboard?: boolean }) {
  /** Qisqa rejim (Dashbord): grafik ko'rsatilmaydi */
  const brief = useBrief();
  const { canWrite } = useAuth();
  /** Tuzatish (tahrirlash, o'chirish) huquqi */
  const isAdmin = canWrite('/mashinalar') || canWrite('/xarajatlar/mashinalar');
  /** Yangi mashina / xarajat qo'shish — faqat rol bo'limida */
  const canAdd = isAdmin && !dashboard;

  /** Oy — yuqori paneldagi umumiy «Davr» tugmasidan (oy ko'rinishi) */
  const { month: period, setMonth: setPeriod } = usePeriod();
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [kindFilter, setKindFilter] = useState('');

  const [vehicleTarget, setVehicleTarget] = useState<VehicleTarget>(null);
  const [recordTarget, setRecordTarget] = useState<RecordTarget>(null);
  const [deleteRecord, setDeleteRecord] = useState<VehicleRecordItem | null>(null);
  const [deleteVehicle, setDeleteVehicle] = useState<VehicleItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Benzin (AZS) hisobotini yuklash oynasi — avvalgi shakl («ОТЧЕТ ПО ПРОДАЖАМ», .xls / .xlsx) */
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const lookups = useAsync(() => vehiclesApi.lookups().then((r) => r.data), []);
  const list = useAsync(() => vehiclesApi.list(period).then((r) => r.data), [period]);
  const records = useAsync(
    () =>
      vehiclesApi
        .records({ period, vehicleId: vehicleFilter || undefined, kind: kindFilter || undefined })
        .then((r) => r.data),
    [period, vehicleFilter, kindFilter],
  );
  const monthSummary = useAsync(
    () => (dashboard ? vehiclesApi.summary(period, period).then((r) => r.data) : Promise.resolve(null)),
    [dashboard, period],
  );
  const summaryFrom = shiftPeriod(period, -11);
  const summary = useAsync(() => vehiclesApi.summary(summaryFrom, period).then((r) => r.data), [summaryFrom, period]);

  const reloadAll = useCallback(() => {
    list.reload();
    records.reload();
    summary.reload();
    monthSummary.reload();
  }, [list, records, summary, monthSummary]);

  const vehicles = useMemo(() => list.data?.items ?? [], [list.data]);
  const totals = list.data?.totals;

  const recordTotal = useMemo(
    () => (records.data ?? []).reduce((sum, r) => sum + BigInt(r.amountTiyin), 0n),
    [records.data],
  );

  const vehicleOptions = [
    { value: '', label: 'Barcha mashinalar' },
    ...vehicles.map((v) => ({ value: v.id, label: `${v.plateNumber} · ${v.model}` })),
  ];
  const kindOptions = [{ value: '', label: 'Barcha turlar' }, ...KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }))];

  const fuelUnitOf = (vehicleId: string) => {
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    return vehicle ? fuelUnit(vehicle.fuelType) : 'l';
  };

  async function confirmDeleteRecord() {
    if (!deleteRecord) return;
    setDeleting(true);
    try {
      await vehiclesApi.removeRecord(deleteRecord.id);
      setToast({ message: 'Xarajat o‘chirildi', tone: 'success' });
      setDeleteRecord(null);
      reloadAll();
    } catch (err) {
      setToast({ message: errorMessage(err, 'O‘chirib bo‘lmadi'), tone: 'error' });
    } finally {
      setDeleting(false);
    }
  }

  async function confirmDeleteVehicle() {
    if (!deleteVehicle) return;
    setDeleting(true);
    try {
      await vehiclesApi.remove(deleteVehicle.id);
      setToast({ message: `${deleteVehicle.plateNumber} o‘chirildi`, tone: 'success' });
      setDeleteVehicle(null);
      reloadAll();
    } catch (err) {
      setToast({ message: errorMessage(err, 'O‘chirib bo‘lmadi'), tone: 'error' });
    } finally {
      setDeleting(false);
    }
  }

  const activeCount = vehicles.filter((v) => v.isActive).length;

  return (
    <>
      <PageHeader
        title="Mashinalar"
        description={
          dashboard
            ? `Dashbord · Omborchi kiritgan ma'lumot · ${formatPeriod(period)}`
            : `Yozuvlar va 12 oylik tahlil · ${formatPeriod(period)}`
        }
        actions={
          <>
            {isAdmin && (
              <Button variant="secondary" onClick={() => setImporting(true)} title="AZS yoqilg'i kartasi hisoboti (.xls / .xlsx) — avvalgi shakl">
                Hisobotni yuklash
              </Button>
            )}
            {canAdd && (
              <>
                <Button variant="secondary" onClick={() => setVehicleTarget('new')}>
                  <IconPlus className="size-4" />
                  Mashina
                </Button>
                <Button onClick={() => setRecordTarget({ mode: 'new' })} disabled={activeCount === 0}>
                  <IconPlus className="size-4" />
                  Xarajat
                </Button>
              </>
            )}
          </>
        }
      />

      <div className="space-y-4 p-6">
        {dashboard && <RoleTabs />}
        {dashboard && <VehicleDemoPanel onChanged={reloadAll} />}
        {list.error ? (
          <Card>
            <ErrorState message={list.error} onRetry={list.reload} />
          </Card>
        ) : (
          <>
            {/* ── Oy yig'indisi ── */}
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
              <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">Jami</p>
                <Money tiyin={totals?.totalTiyin ?? '0'} className="mt-2 block text-xl font-semibold" />
                <p className="mt-1 text-xs text-(--color-text-muted)">
                  {totals?.count ?? 0} ta yozuv · {activeCount} ta mashina
                </p>
              </div>
              {KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setKindFilter(kindFilter === kind ? '' : kind)}
                  className={cn(
                    'rounded-(--radius-card) border bg-white p-4 text-left transition-colors hover:border-brand-600',
                    kindFilter === kind ? 'border-brand-600 ring-1 ring-brand-600' : 'border-(--color-line)',
                  )}
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">
                    <KindDot kind={kind} />
                  </p>
                  <Money tiyin={totals?.byKind[kind] ?? '0'} className="mt-2 block text-lg font-semibold" />
                  {kind === 'FUEL' && (totals?.liters ?? 0) > 0 && (
                    <p className="mt-1 text-xs text-(--color-text-muted)">
                      {formatSum(totals!.liters, { decimals: 1 })} l / m³
                    </p>
                  )}
                </button>
              ))}
            </div>

            {dashboard && vehicles.length > 0 && (
              <GroupSummary vehicles={vehicles} rows={monthSummary.data?.vehicles ?? []} order={lookups.data?.groups ?? []} />
            )}

            {/* ── Mashinalar ── */}
            {list.loading && !list.data ? (
              <Card>
                <TableSkeleton rows={3} cols={4} />
              </Card>
            ) : vehicles.length === 0 ? (
              <Card>
                <EmptyState
                  title="Mashinalar hali kiritilmagan"
                  description={
                    dashboard
                      ? "Mashinalarni va ularning xarajatini Omborchi o'z bo'limida kiritadi — shu yerda dashbord bo'lib ko'rinadi."
                      : "Avval mashinalarni qo'shing: davlat raqami, rusumi, yoqilg'i turi. Keyin har bir yoqilg'i, moyka va ta'mirlash xarajati yoziladi."
                  }
                  action={
                    canAdd ? (
                      <Button onClick={() => setVehicleTarget('new')}>
                        <IconPlus className="size-4" />
                        Mashina qo'shish
                      </Button>
                    ) : undefined
                  }
                />
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {vehicles.map((vehicle) => (
                  <VehicleCard
                    key={vehicle.id}
                    vehicle={vehicle}
                    isAdmin={isAdmin}
                    canAdd={canAdd}
                    onAdd={(kind) => setRecordTarget({ mode: 'new', vehicleId: vehicle.id, kind })}
                    onEdit={() => setVehicleTarget(vehicle)}
                    onDelete={() => setDeleteVehicle(vehicle)}
                  />
                ))}
              </div>
            )}

            {/* ── Oy yozuvlari ── */}
            {vehicles.length > 0 && (
              <Card>
                <CardHeader
                  title={`${formatPeriod(period)} — xarajatlar`}
                  description="Har bir yozuv «Xarajatlar › Doimiy» ro'yxatida ham ko'rinadi"
                  actions={
                    <div className="flex gap-2">
                      <div className="w-52">
                        <Select
                          options={vehicleOptions}
                          value={vehicleFilter}
                          onChange={(event) => setVehicleFilter(event.target.value)}
                          className="h-9"
                        />
                      </div>
                      <div className="w-40">
                        <Select
                          options={kindOptions}
                          value={kindFilter}
                          onChange={(event) => setKindFilter(event.target.value)}
                          className="h-9"
                        />
                      </div>
                    </div>
                  }
                />
                {records.error ? (
                  <ErrorState message={records.error} onRetry={records.reload} />
                ) : records.loading && !records.data ? (
                  <TableSkeleton rows={5} cols={7} />
                ) : (records.data ?? []).length === 0 ? (
                  <EmptyState
                    title="Bu oyda yozuv yo'q"
                    description={
                      canAdd ? "Mashina kartasidagi «+ Yoqilg'i», «+ Moyka» yoki «+ Ta'mirlash» tugmasini bosing" : undefined
                    }
                  />
                ) : (
                  <Table>
                    <THead>
                      <tr>
                        <Th>Sana</Th>
                        <Th>Mashina</Th>
                        <Th>Tur</Th>
                        <Th>Tafsilot</Th>
                        <Th align="right">Miqdor</Th>
                        <Th align="right">Spidometr</Th>
                        <Th align="right">Summa</Th>
                        {isAdmin && <Th className="w-20" />}
                      </tr>
                    </THead>
                    <TBody>
                      {(records.data ?? []).map((record) => (
                        <Tr
                          key={record.id}
                          clickable={isAdmin}
                          onClick={isAdmin ? () => setRecordTarget({ mode: 'edit', record }) : undefined}
                        >
                          <Td className="whitespace-nowrap">{formatDate(record.date)}</Td>
                          <Td className="whitespace-nowrap">
                            <span className="font-mono text-xs font-semibold">{record.plateNumber}</span>
                            <span className="block text-xs text-(--color-text-muted)">{record.model}</span>
                          </Td>
                          <Td>
                            <KindDot kind={record.kind} />
                          </Td>
                          <Td className="max-w-xs">
                            <span className="line-clamp-1">
                              {[record.counterparty, record.description].filter(Boolean).join(' · ') || '—'}
                            </span>
                            <span className="block text-xs text-(--color-text-muted)">
                              {PAYMENT_LABELS[record.paymentMethod]}
                              {record.documentNo ? ` · № ${record.documentNo}` : ''}
                            </span>
                          </Td>
                          <Td align="right" className="money whitespace-nowrap">
                            {record.liters != null
                              ? `${formatSum(record.liters, { decimals: record.liters % 1 ? 1 : 0 })} ${fuelUnitOf(record.vehicleId)}`
                              : '—'}
                          </Td>
                          <Td align="right" className="money whitespace-nowrap">
                            {record.odometerKm != null ? `${formatSum(record.odometerKm)} km` : '—'}
                          </Td>
                          <Td money>
                            <Money tiyin={record.amountTiyin} />
                          </Td>
                          {isAdmin && (
                            <Td align="right" onClick={(event) => event.stopPropagation()}>
                              <div className="flex justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => setRecordTarget({ mode: 'edit', record })}
                                  className="rounded p-1.5 text-(--color-text-muted) hover:bg-(--color-surface-sunken) hover:text-(--color-text)"
                                  aria-label="Tahrirlash"
                                >
                                  <IconEdit className="size-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeleteRecord(record)}
                                  className="rounded p-1.5 text-(--color-text-muted) hover:bg-(--color-expense-soft) hover:text-(--color-expense)"
                                  aria-label="O'chirish"
                                >
                                  <IconTrash className="size-4" />
                                </button>
                              </div>
                            </Td>
                          )}
                        </Tr>
                      ))}
                    </TBody>
                    <TFoot>
                      <tr>
                        <Td colSpan={6} className="font-semibold">
                          Jami: {(records.data ?? []).length} ta yozuv
                        </Td>
                        <Td money className="font-semibold">
                          <Money tiyin={recordTotal} />
                        </Td>
                        {isAdmin && <Td />}
                      </tr>
                    </TFoot>
                  </Table>
                )}
              </Card>
            )}

            {/* ── 12 oylik tahlil (grafik) — To'liq rejimda ── */}
            {!brief && vehicles.length > 0 && (
              <Card>
                <CardHeader
                  title="12 oylik tahlil"
                  description={`${formatPeriod(summaryFrom)} — ${formatPeriod(period)} · 100 km ga sarf «to'liq bak» usulida, spidometr kiritilgan quyishlar bo'yicha`}
                />
                {summary.error ? (
                  <ErrorState message={summary.error} onRetry={summary.reload} />
                ) : !summary.data ? (
                  <TableSkeleton rows={4} cols={6} />
                ) : (
                  <>
                    <CardBody>
                      <MonthlyBars months={summary.data.months} />
                    </CardBody>
                    <Table>
                      <THead>
                        <tr>
                          <Th>Mashina</Th>
                          <Th align="right">Jami</Th>
                          <Th align="right">Yoqilg'i</Th>
                          <Th align="right">Moyka</Th>
                          <Th align="right">Ta'mir + xizmat</Th>
                          <Th align="right">Boshqa</Th>
                          <Th align="right">Miqdor</Th>
                          <Th align="right">Yurgan</Th>
                          <Th align="right">100 km ga</Th>
                          <Th align="right">1 km narxi</Th>
                        </tr>
                      </THead>
                      <TBody>
                        {summary.data.vehicles.map((row) => (
                          <Tr key={row.vehicleId} className={cn(!row.isActive && 'opacity-60')}>
                            <Td className="whitespace-nowrap">
                              <span className="inline-flex items-center gap-1.5">
                                <Mark item={vehicleMark({ id: row.vehicleId, plateNumber: row.plateNumber, model: row.model })} />
                                <span className="font-mono text-xs font-semibold">{row.plateNumber}</span>
                              </span>
                              <span className="block text-xs text-(--color-text-muted)">{row.model}</span>
                            </Td>
                            <Td money className="font-semibold">
                              <Money tiyin={row.totalTiyin} />
                            </Td>
                            <Td money>{formatTiyin(row.byKind.FUEL)}</Td>
                            <Td money>{formatTiyin(row.byKind.WASH)}</Td>
                            <Td money>{formatTiyin(sumKinds(row.byKind, ['REPAIR', 'SERVICE']))}</Td>
                            <Td money>{formatTiyin(row.byKind.OTHER)}</Td>
                            <Td money>{row.liters > 0 ? formatSum(row.liters, { decimals: 0 }) : '—'}</Td>
                            <Td money>{row.distanceKm ? `${formatSum(row.distanceKm)} km` : '—'}</Td>
                            <Td align="right">
                              <ConsumptionCell row={row} />
                            </Td>
                            <Td money>{row.costPerKmSom ? `${formatSum(row.costPerKmSom)} so'm` : '—'}</Td>
                          </Tr>
                        ))}
                      </TBody>
                      <TFoot>
                        <tr>
                          <Td className="font-semibold">Jami</Td>
                          <Td money className="font-semibold">
                            <Money tiyin={summary.data.totals.totalTiyin} />
                          </Td>
                          <Td money>{formatTiyin(summary.data.totals.byKind.FUEL)}</Td>
                          <Td money>{formatTiyin(summary.data.totals.byKind.WASH)}</Td>
                          <Td money>{formatTiyin(sumKinds(summary.data.totals.byKind, ['REPAIR', 'SERVICE']))}</Td>
                          <Td money>{formatTiyin(summary.data.totals.byKind.OTHER)}</Td>
                          <Td money>
                            {summary.data.totals.liters > 0 ? formatSum(summary.data.totals.liters, { decimals: 0 }) : '—'}
                          </Td>
                          <Td colSpan={3} />
                        </tr>
                      </TFoot>
                    </Table>
                  </>
                )}
              </Card>
            )}
          </>
        )}
      </div>

      {vehicleTarget !== null && (
        <VehicleForm
          vehicle={vehicleTarget === 'new' ? null : vehicleTarget}
          lookups={lookups.data}
          onClose={() => setVehicleTarget(null)}
          onSaved={(message) => {
            setVehicleTarget(null);
            setToast({ message, tone: 'success' });
            reloadAll();
          }}
        />
      )}

      {recordTarget !== null && (
        <RecordForm
          record={recordTarget.mode === 'edit' ? recordTarget.record : null}
          vehicles={vehicles}
          defaults={
            recordTarget.mode === 'new' ? { vehicleId: recordTarget.vehicleId, kind: recordTarget.kind } : undefined
          }
          onClose={() => setRecordTarget(null)}
          onSaved={(message, saved) => {
            setRecordTarget(null);
            setToast({ message, tone: 'success' });
            if (saved.period !== period) setPeriod(saved.period);
            reloadAll();
          }}
        />
      )}

      <ConfirmDialog
        open={deleteRecord !== null}
        title="Xarajatni o‘chirish"
        message={
          deleteRecord
            ? `${deleteRecord.plateNumber} · ${KIND_LABELS[deleteRecord.kind]} · ${formatTiyin(deleteRecord.amountTiyin)} so'm. «Xarajatlar» ro'yxatidan ham o'chiriladi.`
            : ''
        }
        confirmLabel="O‘chirish"
        danger
        loading={deleting}
        onConfirm={confirmDeleteRecord}
        onCancel={() => setDeleteRecord(null)}
      />

      <ConfirmDialog
        open={deleteVehicle !== null}
        title="Mashinani o‘chirish"
        message={deleteVehicle ? `${deleteVehicle.plateNumber} (${deleteVehicle.model}) ro'yxatdan o'chiriladi.` : ''}
        confirmLabel="O‘chirish"
        danger
        loading={deleting}
        onConfirm={confirmDeleteVehicle}
        onCancel={() => setDeleteVehicle(null)}
      />

      {importing && (
        <FuelImportDialog
          onClose={() => setImporting(false)}
          onDone={(message) => {
            setImporting(false);
            setToast({ message, tone: 'success' });
            reloadAll();
          }}
        />
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}