'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconPlus } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { Toast } from '@/components/ui/toast';
import { FUEL_LABELS, fuelUnit, KIND_LABELS, KINDS, vehiclesApi, type VehicleItem } from '@/features/vehicles/api';
import { FuelImportDialog } from '@/features/vehicles/fuel-import';
import { VehicleForm } from '@/features/vehicles/vehicle-form';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { useVehicleBase } from '@/features/vehicles/base';
import { formatPeriod, formatTiyin } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Mashinalar › Ro'yxat va hisobot (tanlangan oy):
//   guruhlar bo'yicha jadval — haydovchi, yoqilg'i va me'yor, yurgan km, sarf (100 km ga),
//   me'yordan oshgani, xarajat turlari, jami; mashina qo'shish va tahrirlash.
//   (Omborchi bo'limi; umumiy hudud — Mashinalar dashbordi, demo ham o'sha yerda.)
// ═══════════════════════════════════════════════════════════

export default function VehicleListPage() {
  const { canWrite } = useAuth();
  /** Xarajatlar › Mashinalar yoki Mashinalar (Omborchi) — havolalar shu joyda qoladi */
  const base = useVehicleBase();
  const editable = canWrite(base) || canWrite('/mashinalar');
  const { month } = usePeriod();
  const list = useAsync(() => vehiclesApi.list(month), [month]);
  const summary = useAsync(() => vehiclesApi.summary(month, month), [month]);
  const lookups = useAsync(() => vehiclesApi.lookups(), []);
  const [editing, setEditing] = useState<VehicleItem | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const items = list.data?.data.items ?? [];
  const sumById = useMemo(() => new Map((summary.data?.data.vehicles ?? []).map((v) => [v.vehicleId, v])), [summary.data]);
  const groupDefs = [...(lookups.data?.data.groups ?? []), { value: '', label: 'Guruhsiz' }];
  const active = items.filter((v) => v.isActive);
  const inactive = items.filter((v) => !v.isActive);
  const groups = groupDefs
    .map((g) => ({ ...g, items: active.filter((v) => (v.fleetGroup ?? '') === g.value) }))
    .filter((g) => g.items.length > 0 || g.value !== '');
  const totals = list.data?.data.totals;

  const reload = () => {
    list.reload();
    summary.reload();
  };

  const row = (v: VehicleItem) => {
    const s = sumById.get(v.id);
    const over = s?.consumptionPer100 != null && v.fuelNorm != null && s.consumptionPer100 > v.fuelNorm * 1.05;
    return (
      <Tr key={v.id} clickable={editable} onClick={editable ? () => setEditing(v) : undefined} className={cn(!v.isActive && 'opacity-60')}>
        <Td>
          <span className="rounded border-2 border-slate-800 px-1.5 py-0.5 font-mono text-sm font-bold">{v.plateNumber}</span>
        </Td>
        <Td>
          <span className="font-medium text-heading">{v.model}</span>
          <p className="text-xs text-(--color-text-muted)">
            {v.driverName ?? '—'}
            {v.driverPhone ? ` · ${v.driverPhone}` : ''}
          </p>
        </Td>
        <Td className="text-xs text-(--color-text-muted)">
          {FUEL_LABELS[v.fuelType]}
          {v.fuelNorm ? ` · me'yor ${v.fuelNorm} ${fuelUnit(v.fuelType)}` : ''}
        </Td>
        <Td align="right" money>
          {s?.distanceKm != null ? `${s.distanceKm.toLocaleString('ru-RU')} km` : '—'}
        </Td>
        <Td align="right" money>
          {v.month.liters ? `${v.month.liters} ${fuelUnit(v.fuelType)}` : '—'}
        </Td>
        <Td align="right" money className={cn(over && 'font-bold text-(--color-expense)')}>
          {s?.consumptionPer100 != null ? `${s.consumptionPer100}` : '—'}
          {over && <span className="block text-[10px] font-semibold">me&apos;yordan oshgan</span>}
        </Td>
        <Td className="text-[11px] text-(--color-text-muted)">
          {KINDS.filter((k) => Number(v.month.byKind[k]) > 0)
            .map((k) => `${KIND_LABELS[k]} ${formatTiyin(v.month.byKind[k])}`)
            .join(' · ') || '—'}
        </Td>
        <Td align="right" money className="font-semibold">
          {formatTiyin(v.month.totalTiyin)}
        </Td>
      </Tr>
    );
  };

  const head = (
    <THead>
      <Tr>
        <Th className="w-36">Raqam</Th>
        <Th>Rusumi · haydovchi</Th>
        <Th className="w-40">Yoqilg&apos;i</Th>
        <Th className="w-28" align="right">
          Yurgan
        </Th>
        <Th className="w-24" align="right">
          Hajm
        </Th>
        <Th className="w-28" align="right">
          100 km ga
        </Th>
        <Th>Turlari</Th>
        <Th className="w-36" align="right">
          Jami, so&apos;m
        </Th>
      </Tr>
    </THead>
  );

  return (
    <>
      <PageHeader
        title="Mashinalar"
        description={`${active.length} ta faol mashina · ${formatPeriod(month)}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`${base}/avtopark`} className="inline-flex h-10 items-center rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3.5 text-sm hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
              3D avtopark
            </Link>
            {editable && (
              <Button variant="secondary" onClick={() => setImporting(true)} title="AZS yoqilg'i kartasi hisoboti (.xls / .xlsx)">
                Benzin hisobotini yuklash
              </Button>
            )}
            {editable && (
              <Button onClick={() => setCreating('')}>
                <IconPlus className="size-4" />
                Mashina qo&apos;shish
              </Button>
            )}
          </div>
        }
      />

      <div className="space-y-5 p-4 md:p-6">
        {list.loading && !list.data ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : (
          <>
            {totals && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <Card className="p-4 lg:col-span-2">
                  <p className="text-xs font-semibold text-(--color-text-muted)">Oy jami</p>
                  <p className="money mt-1 text-2xl font-bold text-heading">{formatTiyin(totals.totalTiyin)}</p>
                  <p className="text-xs text-(--color-text-muted)">
                    {totals.count} ta yozuv · {totals.liters} l
                  </p>
                </Card>
                {KINDS.slice(0, 4).map((k) => (
                  <Card key={k} className="p-4">
                    <p className="text-xs font-semibold text-(--color-text-muted)">{KIND_LABELS[k]}</p>
                    <p className="money mt-1 text-lg font-bold text-heading">{formatTiyin(totals.byKind[k])}</p>
                  </Card>
                ))}
              </div>
            )}

            {items.length === 0 && (
              <Card className="flex flex-wrap items-center gap-4 border-2 border-dashed border-brand-300 bg-brand-50/60 p-5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-heading">Hali mashina yo&apos;q</p>
                  <p className="text-sm text-(--color-text-muted)">
                    Eng tezi — AZS benzin hisobotini yuklang: fayldagi har karta (davlat raqami bilan) mashina bo&apos;lib yaratiladi va quyishlari yoziladi. Keyin rusumi va guruhini tahrirlaysiz.
                  </p>
                </div>
                {editable && <Button onClick={() => setImporting(true)}>Benzin hisobotini yuklash</Button>}
              </Card>
            )}

            {groups.map((g) => (
              <Card key={g.value || 'none'} className="overflow-hidden">
                <div className="flex items-center justify-between gap-3 border-b border-(--color-line) px-5 py-3">
                  <p className="text-[15px] font-bold text-heading">
                    {g.label} <span className="font-normal text-(--color-text-muted)">· {g.items.length} ta</span>
                  </p>
                  {editable && g.value && (
                    <Button size="sm" variant="ghost" onClick={() => setCreating(g.value)}>
                      <IconPlus className="size-4" />
                      Qo&apos;shish
                    </Button>
                  )}
                </div>
                {g.items.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-(--color-text-muted)">Bu guruhda mashina yo&apos;q.</p>
                ) : (
                  <Table>
                    {head}
                    <TBody>{g.items.map(row)}</TBody>
                    <TFoot>
                      <Tr>
                        <Td colSpan={7} className="font-semibold">
                          Guruh jami
                        </Td>
                        <Td align="right" money className="font-bold">
                          {formatTiyin(g.items.reduce((s, v) => s + Number(v.month.totalTiyin), 0))}
                        </Td>
                      </Tr>
                    </TFoot>
                  </Table>
                )}
              </Card>
            ))}

            {inactive.length > 0 && (
              <div>
                <button type="button" onClick={() => setShowInactive((v) => !v)} className="text-sm font-semibold text-brand-700 hover:underline">
                  {showInactive ? 'Yashirish' : `Faol emaslar (${inactive.length})`}
                </button>
                {showInactive && (
                  <Card className="mt-3 overflow-hidden">
                    <Table>
                      {head}
                      <TBody>{inactive.map(row)}</TBody>
                    </Table>
                  </Card>
                )}
              </div>
            )}
            <p className="text-xs text-(--color-text-muted)">
              <Badge tone="neutral">100 km ga</Badge> — spidometr va to&apos;ldirilgan yoqilg&apos;i bo&apos;yicha; me&apos;yordan 5% dan ko&apos;p oshsa qizil. Qatorni bosing — tahrirlash.
            </p>
          </>
        )}
      </div>

      {(editing || creating !== null) && (
        <VehicleForm
          vehicle={editing}
          lookups={lookups.data?.data ?? null}
          defaultGroup={creating ?? undefined}
          onClose={() => {
            setEditing(null);
            setCreating(null);
          }}
          onSaved={(message) => {
            setEditing(null);
            setCreating(null);
            setToast(message);
            reload();
          }}
        />
      )}
      {importing && (
        <FuelImportDialog
          onClose={() => setImporting(false)}
          onDone={(msg) => {
            setImporting(false);
            setToast(msg);
            reload();
          }}
        />
      )}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}