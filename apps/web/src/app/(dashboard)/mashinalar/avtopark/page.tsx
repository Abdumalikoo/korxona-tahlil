'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { BODY_LABELS, bodyTypeOf, FUEL_LABELS, fuelUnit, KIND_COLORS, KIND_LABELS, KINDS, vehiclesApi, type VehicleItem } from '@/features/vehicles/api';
import { Garage3D } from '@/features/vehicles/car3d/garage';
import { Car3DViewer } from '@/features/vehicles/car3d/viewer';
import { FuelImportDialog } from '@/features/vehicles/fuel-import';
import { useAuth } from '@/lib/auth-context';
import { formatPeriod, formatTiyin } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Mashinalar › 3D avtopark: hamma mashinalar bitta sahnada (guruhlar bo'yicha qatorlar),
// ustida — davlat raqami va shu oydagi xarajati. Mashina bosilsa — o'ngda 3D modeli, oy xarajatlari turlar bo'yicha,
// litr, spidometr; «Xarajat yozish» — o'sha mashina bilan kiritish sahifasi.
// ═══════════════════════════════════════════════════════════

export default function AvtoparkPage() {
  const { canWrite } = useAuth();
  const editable = canWrite('/mashinalar');
  const { month } = usePeriod();
  const [tick, setTick] = useState(0);
  const list = useAsync(() => vehiclesApi.list(month).then((r) => r.data), [month, tick]);
  const lookups = useAsync(() => vehiclesApi.lookups().then((r) => r.data), []);
  const [sel, setSel] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const all = list.data?.items ?? [];
  const items = useMemo(() => all.filter((v) => showInactive || v.isActive), [all, showInactive]);
  const groups = lookups.data?.groups ?? [];
  useEffect(() => {
    if (!sel && items.length) {
      const top = [...items].sort((a, b) => Number(b.month.totalTiyin) - Number(a.month.totalTiyin))[0];
      if (top) setSel(top.id);
    }
  }, [items, sel]);
  const v: VehicleItem | null = items.find((x) => x.id === sel) ?? null;

  if (list.error) return <ErrorState message={list.error} onRetry={list.reload} />;
  if (!list.data) return <LoadingState />;
  const totals = list.data.totals;
  const max = Math.max(1, ...KINDS.map((k) => Number(v?.month.byKind[k] ?? 0)));

  return (
    <>
      <PageHeader
        title="3D avtopark"
        description={`Hamma mashinalar — ${formatPeriod(month)}: ustida davlat raqami va oy xarajati; bosing — tafsilot`}
        actions={
          editable && (
            <Button size="sm" onClick={() => setImporting(true)}>
              Benzin hisobotini yuklash
            </Button>
          )
        }
      />
      <div className="mx-auto max-w-[1500px] space-y-4 p-4 md:p-6">
        <div className="grid gap-3 sm:grid-cols-4">
          {(
            [
              ['Mashinalar', `${items.filter((x) => x.isActive).length} ta`, `shu oyda xarajati bor: ${items.filter((x) => Number(x.month.totalTiyin) > 0).length}`],
              ['Oy xarajati', formatTiyin(totals.totalTiyin), `${totals.count} ta yozuv`],
              ["Yoqilg'i", formatTiyin(totals.byKind.FUEL), `${totals.liters.toLocaleString('ru-RU')} l`],
              ["Ta'mir va xizmat", formatTiyin(Number(totals.byKind.REPAIR) + Number(totals.byKind.SERVICE) + Number(totals.byKind.WASH) + Number(totals.byKind.OTHER)), 'moyka, ta’mir, texnik xizmat, boshqa'],
            ] as const
          ).map(([k, val, sub]) => (
            <Card key={k} className="px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{k}</p>
              <p className="money mt-0.5 text-xl font-bold text-heading">{val}</p>
              <p className="text-xs text-(--color-text-muted)">{sub}</p>
            </Card>
          ))}
        </div>

        {items.length === 0 ? (
          <Card className="p-8 text-center text-sm text-(--color-text-muted)">
            Hali mashina yo&apos;q.{' '}
            <Link href="/mashinalar/royxat" className="font-semibold text-brand-700 hover:underline">
              Ro&apos;yxatga qo&apos;shing
            </Link>{' '}
            yoki benzin hisobotini yuklang — mashinalar undan yaratiladi.
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card className="overflow-hidden">
              <Garage3D vehicles={items} groups={groups} selectedId={sel} onSelect={setSel} className="h-[62vh] min-h-[420px]" />
              <div className="flex flex-wrap items-center gap-3 border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">
                <span>Sichqoncha bilan buring, g&apos;ildirak bilan yaqinlashtiring. Faralari yongan — shu oyda xarajati bor.</span>
                <label className="ml-auto flex items-center gap-1.5">
                  <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> faol emaslarni ham
                </label>
              </div>
            </Card>

            <Card className="overflow-hidden xl:sticky xl:top-24 xl:self-start">
              {!v ? (
                <p className="p-8 text-center text-sm text-(--color-text-muted)">Mashinani tanlang</p>
              ) : (
                <>
                  <Car3DViewer vehicle={v} className="h-52" />
                  <div className="space-y-4 p-4">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <span className="rounded-md border-2 border-slate-800 bg-white px-2 py-0.5 font-mono text-base font-bold tracking-wider text-slate-900">{v.plateNumber}</span>
                        <p className="mt-1.5 truncate text-sm font-semibold text-heading">
                          {v.model}
                          {v.year ? `, ${v.year}` : ''}
                        </p>
                        <p className="truncate text-xs text-(--color-text-muted)">
                          {[v.fleetGroupLabel, v.driverName, FUEL_LABELS[v.fuelType], BODY_LABELS[bodyTypeOf(v)].split(' (')[0]].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {!v.isActive && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">faol emas</span>}
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-(--color-surface-muted) px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-(--color-text-muted)">Oy jami</p>
                        <p className="money text-sm font-bold text-heading">{formatTiyin(v.month.totalTiyin)}</p>
                      </div>
                      <div className="rounded-lg bg-(--color-surface-muted) px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-(--color-text-muted)">Hajm</p>
                        <p className="text-sm font-bold tabular-nums text-heading">
                          {v.month.liters.toLocaleString('ru-RU')} {fuelUnit(v.fuelType)}
                        </p>
                      </div>
                      <div className="rounded-lg bg-(--color-surface-muted) px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-(--color-text-muted)">Spidometr</p>
                        <p className="text-sm font-bold tabular-nums text-heading">{v.lastOdometerKm !== null ? `${v.lastOdometerKm.toLocaleString('ru-RU')} km` : '—'}</p>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {KINDS.map((k) => {
                        const val = Number(v.month.byKind[k]);
                        return (
                          <div key={k} className="flex items-center gap-2 text-xs">
                            <span className="w-24 shrink-0 text-(--color-text-muted)">{KIND_LABELS[k]}</span>
                            <span className="h-2 flex-1 overflow-hidden rounded-full bg-(--color-surface-muted)">
                              <span className="block h-full rounded-full" style={{ width: `${(val / max) * 100}%`, background: KIND_COLORS[k] }} />
                            </span>
                            <span className={cn('money w-24 shrink-0 text-right', val ? 'font-semibold text-heading' : 'text-(--color-text-faint)')}>{val ? formatTiyin(val) : '—'}</span>
                          </div>
                        );
                      })}
                    </div>

                    {v.fuelCardNo && <p className="text-xs text-(--color-text-muted)">Yoqilg&apos;i kartasi: {v.fuelCardNo}</p>}
                    <div className="flex gap-2">
                      {editable && v.isActive && (
                        <Link href={`/mashinalar?v=${v.id}`} title="Benzin, moyka, ta'mir, texnik xizmat — qo'lda" className="inline-flex h-9 flex-1 items-center justify-center rounded-(--radius-control) bg-brand-600 px-3 text-sm font-semibold text-white hover:bg-brand-700">
                          Xarajat yozish
                        </Link>
                      )}
                      <Link href="/mashinalar/tahlil" className="inline-flex h-9 items-center justify-center rounded-(--radius-control) border border-(--color-line-strong) px-3 text-sm hover:bg-brand-50">
                        Yozuvlari
                      </Link>
                    </div>
                  </div>
                </>
              )}
            </Card>
          </div>
        )}
      </div>
      {importing && (
        <FuelImportDialog
          onClose={() => setImporting(false)}
          onDone={(msg) => {
            setImporting(false);
            setToast(msg);
            setTick((t) => t + 1);
          }}
        />
      )}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}