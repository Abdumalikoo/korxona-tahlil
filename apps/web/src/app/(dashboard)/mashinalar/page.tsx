'use client';

import { PageHeader } from '@/components/layout/page-header';
import { MoneyInput } from '@/components/shared/money-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconSearch, IconTrash } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import {
  fuelUnit,
  KIND_HINTS,
  KIND_LABELS,
  KINDS,
  PAYMENT_LABELS,
  vehiclesApi,
  type VehicleItem,
  type VehicleLookups,
  type VehiclePaymentMethod,
  type VehicleRecordItem,
  type VehicleRecordKind,
} from '@/features/vehicles/api';
import { FuelImportDialog } from '@/features/vehicles/fuel-import';
import { Car3DViewer } from '@/features/vehicles/car3d/viewer';
import { useAuth } from '@/lib/auth-context';
import { useVehicleBase } from '@/features/vehicles/base';
import { errorMessage } from '@/lib/error-message';
import { currentPeriod, formatDate, formatTiyin, todayInput } from '@/lib/format';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

// ═══════════════════════════════════════════════════════════
// Mashinalar › Xarajat kiritish — omborchi uchun tez forma:
//   chapda — mashinalar guruhlar bo'yicha kartochkalar (Toshkent shahri, Marksheyder, Rahbariyat, Qo'shimcha),
//   o'ngda — tanlangan mashinaga xarajat: tur (benzin, moyka, ta'mir, texnik xizmat, boshqa), summa,
//            litr, spidometr, AZS / servis (oldingilaridan), to'lov usuli.
//   Saqlangach mashina va tur qoladi — keyingisini darrov yozish mumkin; bugun kiritilganlar pastda.
// Har yozuv Xarajatlarga tushadi (Xarajatlar › Mashinalar bilan bir xil ma'lumot).
// ═══════════════════════════════════════════════════════════

const PREFS = 'korxona_vehicle_entry';
const KIND_TONE: Record<VehicleRecordKind, string> = {
  FUEL: 'border-sky-400 bg-sky-50 text-sky-800',
  WASH: 'border-cyan-400 bg-cyan-50 text-cyan-800',
  REPAIR: 'border-rose-400 bg-rose-50 text-rose-800',
  SERVICE: 'border-amber-400 bg-amber-50 text-amber-800',
  OTHER: 'border-slate-400 bg-slate-50 text-slate-800',
};
const KIND_SHORT: Record<VehicleRecordKind, string> = { FUEL: "Benzin / gaz", WASH: 'Moyka', REPAIR: "Ta'mir", SERVICE: 'Texnik xizmat', OTHER: 'Boshqa' };

interface Prefs {
  kind?: VehicleRecordKind;
  methods?: Partial<Record<VehicleRecordKind, VehiclePaymentMethod>>;
}

function readPrefs(): Prefs {
  try {
    return JSON.parse(window.localStorage.getItem(PREFS) ?? '{}') as Prefs;
  } catch {
    return {};
  }
}

function writePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(PREFS, JSON.stringify(p));
  } catch {
    // eslab qolinmasa ham ishlaydi
  }
}

function num(v: string): number | null {
  const t = v.replace(/[\s ]/g, '').replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : Number.NaN;
}

export default function VehicleEntryPage() {
  const { canWrite } = useAuth();
  /** Xarajatlar › Mashinalar yoki Mashinalar (Omborchi) — havolalar shu joyda qoladi */
  const base = useVehicleBase();
  const editable = canWrite(base) || canWrite('/mashinalar');
  const month = currentPeriod();
  const today = todayInput();

  const [vehicles, setVehicles] = useState<VehicleItem[] | null>(null);
  const [lookups, setLookups] = useState<VehicleLookups | null>(null);
  const [records, setRecords] = useState<VehicleRecordItem[]>([]);
  const [places, setPlaces] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [vehicleId, setVehicleId] = useState<string | null>(null);

  const [kind, setKind] = useState<VehicleRecordKind>('FUEL');
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState<number | null>(null);
  const [liters, setLiters] = useState('');
  const [odometer, setOdometer] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [method, setMethod] = useState<VehiclePaymentMethod>('CASH');
  const [documentNo, setDocumentNo] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [removing, setRemoving] = useState<VehicleRecordItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const load = useCallback(() => {
    Promise.all([vehiclesApi.list(month), vehiclesApi.records({ period: month })])
      .then(([v, r]) => {
        setVehicles(v.data.items.filter((x) => x.isActive));
        setRecords(r.data);
      })
      .catch((err) => setLoadError(errorMessage(err, "Mashinalarni olib bo'lmadi")));
  }, [month]);

  useEffect(() => {
    load();
    vehiclesApi
      .lookups()
      .then((r) => setLookups(r.data))
      .catch(() => undefined);
    const p = readPrefs();
    if (p.kind) setKind(p.kind);
  }, [load]);

  // To'lov usuli — tur bo'yicha eslab qolinadi; AZS / servis ro'yxati — tur bo'yicha
  useEffect(() => {
    const p = readPrefs();
    setMethod(p.methods?.[kind] ?? (kind === 'FUEL' ? 'CARD' : 'CASH'));
    vehiclesApi
      .counterparties(kind)
      .then((r) => setPlaces(r.data))
      .catch(() => setPlaces([]));
  }, [kind]);

  // 3D avtoparkdan «Xarajat yozish»: ?v=<mashina>
  useEffect(() => {
    if (!vehicles || vehicleId) return;
    const v = new URLSearchParams(window.location.search).get('v');
    if (v && vehicles.some((x) => x.id === v)) setVehicleId(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles]);

  const selected = vehicles?.find((v) => v.id === vehicleId) ?? null;
  const groups = useMemo(() => {
    const list = (vehicles ?? []).filter((v) => {
      const t = search.trim().toLowerCase().replace(/\s+/g, '');
      return !t || `${v.plateNumber}${v.model}${v.driverName ?? ''}`.toLowerCase().replace(/\s+/g, '').includes(t);
    });
    const defs = [...(lookups?.groups ?? []), { value: '', label: 'Guruhsiz' }];
    return defs.map((g) => ({ ...g, items: list.filter((v) => (v.fleetGroup ?? '') === g.value) })).filter((g) => g.items.length > 0);
  }, [vehicles, lookups, search]);

  const todayRecords = records.filter((r) => r.date === today);
  const unit = selected ? fuelUnit(selected.fuelType) : 'l';
  const km = num(odometer);
  const kmWarn = selected && km !== null && !Number.isNaN(km) && selected.lastOdometerKm !== null && km < selected.lastOdometerKm;

  const pick = (id: string) => {
    setVehicleId(id);
    setError(null);
    setTimeout(() => formRef.current?.querySelector<HTMLInputElement>('[data-field="amount"] input')?.focus(), 30);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!selected) return setError('Avval mashinani tanlang');
    if (!amount || amount <= 0) return setError('Summani kiriting');
    const l = num(liters);
    if (l !== null && (Number.isNaN(l) || l <= 0)) return setError("Litr noto'g'ri");
    if (km !== null && (Number.isNaN(km) || !Number.isInteger(km) || km < 0)) return setError("Spidometr — butun son, km");
    setSaving(true);
    try {
      const r = await vehiclesApi.createRecord({
        vehicleId: selected.id,
        kind,
        date,
        amountTiyin: String(Math.round(amount * 100)),
        liters: kind === 'FUEL' ? l : null,
        odometerKm: km,
        description: description.trim() || null,
        counterparty: counterparty.trim() || null,
        documentNo: documentNo.trim() || null,
        paymentMethod: method,
      });
      const p = readPrefs();
      writePrefs({ ...p, kind, methods: { ...(p.methods ?? {}), [kind]: method } });
      setToast(`${selected.plateNumber}: ${KIND_LABELS[kind]} — ${formatTiyin(r.data.amountTiyin)} so'm saqlandi`);
      setAmount(null);
      setLiters('');
      setOdometer('');
      setDocumentNo('');
      setDescription('');
      load();
      setTimeout(() => formRef.current?.querySelector<HTMLInputElement>('[data-field="amount"] input')?.focus(), 50);
    } catch (err) {
      setError(errorMessage(err, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void submitRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await vehiclesApi.removeRecord(removing.id);
      setToast("Yozuv o'chirildi");
      setRemoving(null);
      load();
    } catch (err) {
      setError(errorMessage(err, "O'chirib bo'lmadi"));
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <div className="p-6 text-sm text-(--color-expense)">{loadError}</div>;
  if (!vehicles) return <LoadingState />;

  return (
    <>
      <PageHeader
        title="Mashina xarajati"
        description="Benzin, moyka, ta'mir, texnik xizmat — mashinani tanlang va yozing"
        actions={
          <div className="flex items-center gap-2">
            <Link href={`${base}/avtopark`} className="inline-flex h-9 items-center rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3.5 text-sm hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
              3D avtopark
            </Link>
            <Link href={`${base}/bolimlar`} title="Har mashina qaysi bo'limniki — xarajati o'sha joyga yoziladi" className="inline-flex h-9 items-center rounded-(--radius-control) border border-brand-300 bg-white px-3.5 text-sm font-semibold text-brand-700 hover:bg-brand-50">
              Bo&apos;limlarga biriktirish
            </Link>
            {editable && (
              <Button size="sm" onClick={() => setImporting(true)} title="AZS yoqilg'i kartasi hisoboti (.xls / .xlsx)">
                Benzin hisobotini yuklash
              </Button>
            )}
          </div>
        }
      />
      {importing && (
        <FuelImportDialog
          onClose={() => setImporting(false)}
          onDone={(msg) => {
            setImporting(false);
            setToast(msg);
            load();
          }}
        />
      )}

      <div className="mx-auto max-w-7xl p-4 md:p-6">
        {vehicles.length === 0 ? (
          <Card className="flex flex-wrap items-center justify-between gap-3 border-2 border-dashed border-brand-300 bg-brand-50/60 p-6">
            <div>
              <p className="font-semibold text-heading">Hali mashina kiritilmagan</p>
              <p className="text-sm text-(--color-text-muted)">Avval mashinalarni guruhlari bilan qo&apos;shing: Toshkent shahri, Marksheyder, Rahbariyat, Qo&apos;shimcha.</p>
            </div>
            <Link href={`${base}/royxat`} className="inline-flex h-10 items-center rounded-(--radius-control) bg-brand-600 px-4 text-sm font-semibold text-white hover:bg-brand-700">
              Mashinalar ro&apos;yxati →
            </Link>
          </Card>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
            {/* Mashinalar */}
            <div className="space-y-4">
              <div className="relative">
                <IconSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-(--color-text-faint)" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const first = groups[0]?.items[0];
                      if (first) pick(first.id);
                    }
                  }}
                  placeholder="Davlat raqami, rusumi yoki haydovchi — Enter"
                  className="h-11 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white pl-9 pr-3 text-sm focus:border-brand-600"
                />
              </div>
              {groups.map((g) => (
                <div key={g.value || 'none'}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">
                    {g.label} · {g.items.length}
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {g.items.map((v) => {
                      const on = v.id === vehicleId;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => pick(v.id)}
                          className={cn(
                            'rounded-(--radius-card) border-2 bg-white p-3 text-left shadow-card transition-all hover:-translate-y-0.5',
                            on ? 'border-brand-500 ring-4 ring-brand-100' : 'border-transparent hover:border-brand-200',
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="rounded-md border-2 border-slate-800 bg-white px-2 py-0.5 font-mono text-base font-bold tracking-wider text-slate-900">{v.plateNumber}</span>
                            <span className="money text-xs font-semibold text-(--color-text-muted)">{Number(v.month.totalTiyin) ? formatTiyin(v.month.totalTiyin) : ''}</span>
                          </div>
                          <p className="mt-2 truncate text-sm font-semibold text-heading">{v.model}</p>
                          <p className="truncate text-xs text-(--color-text-muted)">
                            {v.driverName ?? 'Haydovchi ko‘rsatilmagan'}
                            {v.lastOdometerKm !== null ? ` · ${v.lastOdometerKm.toLocaleString('ru-RU')} km` : ''}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {groups.length === 0 && <p className="text-sm text-(--color-text-muted)">Topilmadi.</p>}
            </div>

            {/* Forma */}
            <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              <Card className="p-5">
                {!selected ? (
                  <p className="py-10 text-center text-sm text-(--color-text-muted)">← Mashinani tanlang</p>
                ) : (
                  <form ref={formRef} onSubmit={(e) => void submit(e)} className="space-y-4">
                    <Car3DViewer vehicle={selected} highlight={kind} className="-mx-5 -mt-5 h-48 rounded-t-(--radius-card)" />
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-xl font-bold tracking-wider text-heading">{selected.plateNumber}</p>
                        <p className="truncate text-xs text-(--color-text-muted)">
                          {selected.model}
                          {selected.fleetGroupLabel ? ` · ${selected.fleetGroupLabel}` : ''}
                          {selected.driverName ? ` · ${selected.driverName}` : ''}
                        </p>
                      </div>
                      <button type="button" onClick={() => setVehicleId(null)} className="text-xs text-(--color-text-muted) hover:text-heading">
                        almashtirish
                      </button>
                    </div>

                    {/* Tur */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {KINDS.map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setKind(k)}
                          title={KIND_HINTS[k]}
                          className={cn('rounded-(--radius-control) border-2 px-3 py-2 text-sm font-semibold transition-colors', kind === k ? KIND_TONE[k] : 'border-(--color-line) text-(--color-text-muted) hover:border-(--color-line-strong)')}
                        >
                          {KIND_SHORT[k]}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div data-field="amount" className="col-span-2 sm:col-span-1">
                        <MoneyInput label="Summa, so'm" value={amount} onChange={setAmount} required />
                      </div>
                      <Input label="Sana" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
                      {kind === 'FUEL' && <Input label={`Hajmi`} value={liters} onChange={(e) => setLiters(e.target.value)} inputMode="decimal" suffix={unit} placeholder="40" />}
                      <Input
                        label="Spidometr"
                        value={odometer}
                        onChange={(e) => setOdometer(e.target.value.replace(/[^\d]/g, ''))}
                        inputMode="numeric"
                        suffix="km"
                        placeholder={selected.lastOdometerKm !== null ? String(selected.lastOdometerKm) : ''}
                        hint={selected.lastOdometerKm !== null ? `Oxirgi: ${selected.lastOdometerKm.toLocaleString('ru-RU')} km` : 'Ixtiyoriy'}
                        error={kmWarn ? 'Oxirgisidan kam' : undefined}
                      />
                      <div className="col-span-2">
                        <Input
                          label={kind === 'FUEL' ? 'AZS' : kind === 'WASH' ? 'Moyka' : kind === 'OTHER' ? 'Kimga to‘landi' : 'Servis'}
                          value={counterparty}
                          onChange={(e) => setCounterparty(e.target.value)}
                          list="vehicle-places"
                          placeholder={places[0] ?? ''}
                          hint={places.length ? 'Oldingilaridan tanlash mumkin' : undefined}
                        />
                        <datalist id="vehicle-places">
                          {places.map((p) => (
                            <option key={p} value={p} />
                          ))}
                        </datalist>
                      </div>
                      <Select
                        label="To'lov usuli"
                        value={method}
                        onChange={(e) => setMethod(e.target.value as VehiclePaymentMethod)}
                        options={(Object.keys(PAYMENT_LABELS) as VehiclePaymentMethod[]).map((m) => ({ value: m, label: PAYMENT_LABELS[m] }))}
                      />
                      <Input label="Chek / hujjat №" value={documentNo} onChange={(e) => setDocumentNo(e.target.value)} />
                      <div className="col-span-2">
                        <Input label="Izoh" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={kind === 'REPAIR' ? "Nima ta'mirlandi" : kind === 'SERVICE' ? 'Moy, filtr, shina…' : ''} />
                      </div>
                    </div>

                    {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
                    {editable && (
                      <Button type="submit" size="lg" fullWidth loading={saving}>
                        Saqlash <span className="text-xs font-normal opacity-80">(Enter / Ctrl+S)</span>
                      </Button>
                    )}
                  </form>
                )}
              </Card>

              {/* Bugun */}
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-(--color-line) px-5 py-3">
                  <p className="text-sm font-bold text-heading">Bugun kiritilganlar · {todayRecords.length}</p>
                  <span className="money text-sm font-semibold">{formatTiyin(todayRecords.reduce((s, r) => s + Number(r.amountTiyin), 0))}</span>
                </div>
                {todayRecords.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-(--color-text-muted)">Hali yo&apos;q.</p>
                ) : (
                  <ul className="divide-y divide-(--color-line)">
                    {todayRecords.map((r) => (
                      <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                        <span className="w-28 shrink-0 font-mono text-xs font-bold">{r.plateNumber}</span>
                        <span className="min-w-0 flex-1 truncate">
                          {KIND_LABELS[r.kind]}
                          {r.liters ? ` · ${r.liters} ${unit}` : ''}
                          {r.counterparty ? <span className="text-(--color-text-muted)"> · {r.counterparty}</span> : null}
                        </span>
                        <span className="money shrink-0 font-semibold">{formatTiyin(r.amountTiyin)}</span>
                        {editable && (
                          <button type="button" onClick={() => setRemoving(r)} className="shrink-0 rounded p-1 text-(--color-text-muted) hover:bg-red-50 hover:text-red-600" aria-label="O'chirish">
                            <IconTrash className="size-4" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(removing)}
        danger
        loading={busy}
        title="Yozuvni o'chirish"
        message={removing ? `${removing.plateNumber}: ${KIND_LABELS[removing.kind]} — ${formatTiyin(removing.amountTiyin)} so'm (${formatDate(removing.date)}). Xarajatlardagi yozuvi ham o'chadi.` : ''}
        confirmLabel="O'chirish"
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}