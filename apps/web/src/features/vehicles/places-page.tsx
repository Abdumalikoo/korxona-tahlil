'use client';

import { PageHeader } from '@/components/layout/page-header';
import { ExcelButton, Field, FilterBar, GroupTh, MoneyCell, ReportCard, RTable, SearchInput, SelectBox, StatTiles, TableNote, Td, Th, Tr } from '@/components/report/report';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { currentPeriod, formatPeriod, formatPeriodShort } from '@/lib/format';
import { SEGMENTS } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { vehiclesApi, type VehiclePlaceRow, type VehicleUnit } from './api';
import { useVehicleBase } from './base';
import { FuelImportDialog } from './fuel-import';

// ═══════════════════════════════════════════════════════════
// Mashinalar › Bo'limlarga biriktirish.
//  • Benzin hisobotlari (masalan, 9 oylik) yuklangach — har mashina qaysi bo'limniki ekanini belgilash:
//    Markaz bo'limi, hudud yoki yo'nalish (Tax free, Marksheyder …), izoh bilan.
//  • Saqlanganda mashinaning xarajatlari (hammasi yoki tanlangan oydan boshlab) o'sha joyga ko'chadi;
//    keyingi safar yuklangan hisobot ham avtomatik shu joyga yoziladi.
// ═══════════════════════════════════════════════════════════

const UNIT_OPTIONS: { value: VehicleUnit; label: string }[] = [
  { value: 'CENTER', label: "Markaz (bo'lim bilan)" },
  { value: 'REGION', label: 'Hudud' },
  ...SEGMENTS.map((s) => ({ value: s.code as VehicleUnit, label: s.label })),
];

type PlaceFilter = 'ALL' | 'CENTER' | 'NODEPT' | 'REGION' | 'SEGMENT';
const FILTERS: { value: PlaceFilter; label: string }[] = [
  { value: 'ALL', label: 'Hammasi' },
  { value: 'NODEPT', label: "Bo'lim belgilanmagan (Markaz)" },
  { value: 'CENTER', label: "Markaz bo'limlari" },
  { value: 'REGION', label: 'Hududlar' },
  { value: 'SEGMENT', label: "Yo'nalishlar" },
];

const INPUT = 'h-10 rounded-lg border border-(--color-line-strong) bg-white px-3 text-sm outline-none focus:border-brand-500';

export function VehiclePlacesPage() {
  const base = useVehicleBase();
  const { canWrite } = useAuth();
  const editable = canWrite(base) || canWrite('/mashinalar');
  const [to, setTo] = useState(currentPeriod());
  // Odatiy davr — yil boshidan joriy oygacha (masalan, 9 oylik hisobot)
  const [from, setFrom] = useState(`${currentPeriod().slice(0, 4)}-01`);
  const [filter, setFilter] = useState<PlaceFilter>('ALL');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Biriktirish paneli
  const [unit, setUnit] = useState<VehicleUnit>('CENTER');
  const [departmentId, setDepartmentId] = useState('');
  const [regionCode, setRegionCode] = useState('');
  const [comment, setComment] = useState('');
  const [fromAll, setFromAll] = useState(true);
  const [fromPeriod, setFromPeriod] = useState(from);
  const [ask, setAsk] = useState(false);
  /** Benzin hisobotini yuklash (avvalgi shakl) — yuklangach mashinalar shu yerda bo'limga biriktiriladi */
  const [importing, setImporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);

  const lookups = useAsync(() => vehiclesApi.lookups().then((r) => r.data), []);
  const result = useAsync(() => vehiclesApi.places(from, to).then((r) => r.data), [from, to]);
  const data = result.data;

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.items ?? []).filter((r) => {
      if (term && !`${r.plateNumber} ${r.model} ${r.driverName ?? ''} ${r.placeLabel} ${r.comment ?? ''}`.toLowerCase().includes(term)) return false;
      if (filter === 'NODEPT') return r.unit === 'CENTER' && !r.departmentId;
      if (filter === 'CENTER') return r.unit === 'CENTER' && Boolean(r.departmentId);
      if (filter === 'REGION') return r.unit === 'REGION';
      if (filter === 'SEGMENT') return Boolean(r.segment);
      return true;
    });
  }, [data, q, filter]);

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allShown = rows.length > 0 && rows.every((r) => picked.has(r.id));

  /** Bitta mashinani tanlab, panelni uning hozirgi joyi bilan to'ldirish */
  const editOne = (r: VehiclePlaceRow) => {
    setPicked(new Set([r.id]));
    setUnit(r.unit);
    setDepartmentId(r.departmentId ?? '');
    setRegionCode(r.unit === 'REGION' ? String(r.regionCode) : '');
    setComment(r.comment ?? '');
  };

  const targetLabel =
    unit === 'CENTER'
      ? `Markaz${departmentId ? ` › ${lookups.data?.departments.find((d) => d.id === departmentId)?.name ?? ''}` : ''}`
      : unit === 'REGION'
        ? (lookups.data?.regions.find((r) => String(r.code) === regionCode)?.name ?? 'Hudud')
        : (UNIT_OPTIONS.find((o) => o.value === unit)?.label ?? unit);
  const canSave = picked.size > 0 && (unit !== 'REGION' || regionCode !== '');

  const save = async () => {
    setSaving(true);
    try {
      const items = [...picked].map((id) => ({
        id,
        unit,
        departmentId: unit === 'CENTER' ? departmentId || null : null,
        regionCode: unit === 'REGION' ? Number(regionCode) : null,
        comment: comment.trim() || null,
      }));
      const r = (await vehiclesApi.setPlaces(items, fromAll ? null : fromPeriod)).data;
      setToast({ message: `${r.vehicles} ta mashina → ${targetLabel}: ${r.expenses} ta xarajat ko'chirildi. Keyingi yuklashlar ham shu joyga yoziladi.` });
      setPicked(new Set());
      result.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setSaving(false);
      setAsk(false);
    }
  };

  const exportCsv = () => {
    if (!data) return;
    const head = ['Raqam', 'Rusumi', 'Haydovchi', 'Joyi', 'Izoh', ...data.months.map(formatPeriod), "Jami, so'm"];
    const lines = rows.map((r) => [r.plateNumber, r.model, r.driverName ?? '', r.placeLabel, r.comment ?? '', ...data.months.map((m) => String(Math.round(Number(r.months[m] ?? 0) / 100))), String(Math.round(Number(r.totalTiyin) / 100))]);
    const csv = [head, ...lines].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mashinalar-bolimlar-${data.from}_${data.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const total = (data?.items ?? []).reduce((a, r) => a + Number(r.totalTiyin), 0);
  const noDept = (data?.items ?? []).filter((r) => r.unit === 'CENTER' && !r.departmentId);
  const seg = (data?.items ?? []).filter((r) => r.segment);

  return (
    <>
      <PageHeader
        title="Mashinalar — bo'limlarga biriktirish"
        description="Har mashina qaysi bo'limniki: xarajati o'sha joyga yoziladi, keyingi benzin hisobotlari ham avtomatik shu joyga tortiladi"
      />
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href={base} className="rounded-lg border border-brand-300 bg-white px-3 py-1.5 font-semibold text-brand-700 hover:bg-brand-50">
            ← Xarajat kiritish va benzin hisobotini yuklash
          </Link>
          <Link href={`${base}/royxat`} className="rounded-lg border border-brand-300 bg-white px-3 py-1.5 font-semibold text-brand-700 hover:bg-brand-50">
            Mashinalar hisoboti
          </Link>
          {editable && (
            <button type="button" onClick={() => setImporting(true)} title="AZS yoqilg'i kartasi hisoboti (.xls / .xlsx) — avvalgi shakl" className="rounded-lg bg-brand-600 px-3 py-1.5 font-semibold text-white shadow-pill hover:bg-brand-700">
              Hisobotni yuklash
            </button>
          )}
        </div>

        {result.error ? (
          <Card>
            <ErrorState message={result.error} onRetry={result.reload} />
          </Card>
        ) : !data ? (
          <Card>
            <LoadingState label="Yuklanmoqda" />
          </Card>
        ) : (
          <>
            <StatTiles
              items={[
                { label: 'Mashinalar', value: 0, text: `${data.items.length} ta`, note: `${data.items.filter((r) => r.isActive).length} ta faol`, tone: 'blue' },
                { label: `Xarajat · ${formatPeriodShort(data.from)} — ${formatPeriodShort(data.to)}`, value: total, tone: 'red', note: `${data.items.reduce((a, r) => a + r.count, 0)} ta yozuv` },
                { label: "Bo'lim belgilanmagan", value: noDept.reduce((a, r) => a + Number(r.totalTiyin), 0), tone: 'orange', note: `${noDept.length} ta mashina — Markaz umumiy`, onClick: () => setFilter('NODEPT') },
                { label: "Yo'nalishlarga", value: seg.reduce((a, r) => a + Number(r.totalTiyin), 0), tone: 'purple', note: `${seg.length} ta mashina`, onClick: () => setFilter('SEGMENT') },
              ]}
            />

            <FilterBar actions={<ExcelButton onClick={exportCsv} />}>
              <Field label="Davr boshi">
                <input type="month" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={INPUT} />
              </Field>
              <Field label="Davr oxiri">
                <input type="month" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={INPUT} />
              </Field>
              <Field label="Joyi">
                <SelectBox value={filter} options={FILTERS} onChange={setFilter} className="min-w-56" />
              </Field>
              <Field label="Qidirish">
                <SearchInput value={q} onChange={setQ} placeholder="Raqam, rusum, haydovchi, izoh…" />
              </Field>
            </FilterBar>

            {editable && (
              <div className={cn('rounded-2xl border-2 bg-white p-4 shadow-card', picked.size ? 'border-brand-400' : 'border-transparent')}>
                <p className="mb-3 text-sm font-semibold text-heading">
                  {picked.size ? `Tanlangan: ${picked.size} ta mashina → qayerga biriktiriladi` : "Mashinani tanlang (qatorni bosing yoki belgilang) — so'ng bo'limni ko'rsating"}
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Birlik">
                    <SelectBox value={unit} options={UNIT_OPTIONS} onChange={setUnit} className="min-w-52" />
                  </Field>
                  {unit === 'CENTER' && (
                    <Field label="Markaz bo'limi">
                      <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={cn(INPUT, 'min-w-64')}>
                        <option value="">— bo&apos;limsiz (Markaz umumiy) —</option>
                        {(lookups.data?.departments ?? []).map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  {unit === 'REGION' && (
                    <Field label="Hudud">
                      <select value={regionCode} onChange={(e) => setRegionCode(e.target.value)} className={cn(INPUT, 'min-w-56')}>
                        <option value="">— tanlang —</option>
                        {(lookups.data?.regions ?? [])
                          .filter((r) => r.code !== 0)
                          .map((r) => (
                            <option key={r.code} value={r.code}>
                              {r.name}
                            </option>
                          ))}
                      </select>
                    </Field>
                  )}
                  <Field label="Izoh">
                    <input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={300} placeholder="Masalan: Marksheyderlar dala ishida" className={cn(INPUT, 'w-72')} />
                  </Field>
                  <Field label="Qaysi xarajatlar ko'chadi">
                    <div className="flex items-center gap-2">
                      <select value={fromAll ? 'all' : 'from'} onChange={(e) => setFromAll(e.target.value === 'all')} className={INPUT}>
                        <option value="all">Hammasi (barcha oylar)</option>
                        <option value="from">Tanlangan oydan boshlab</option>
                      </select>
                      {!fromAll && <input type="month" value={fromPeriod} onChange={(e) => e.target.value && setFromPeriod(e.target.value)} className={INPUT} />}
                    </div>
                  </Field>
                  <button
                    type="button"
                    disabled={!canSave || saving}
                    onClick={() => setAsk(true)}
                    className="inline-flex h-10 items-center rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white shadow-pill hover:bg-brand-700 disabled:opacity-40"
                  >
                    Biriktirish
                  </button>
                  {picked.size > 0 && (
                    <button type="button" onClick={() => setPicked(new Set())} className="h-10 rounded-lg border border-(--color-line-strong) bg-white px-3 text-sm hover:bg-brand-50">
                      Tanlovni bekor qilish
                    </button>
                  )}
                </div>
              </div>
            )}

            <ReportCard title="Mashinalar va ularning bo'limi" badge={`${formatPeriod(data.from)} — ${formatPeriod(data.to)} · ${rows.length} ta`}>
              <RTable minWidth={900 + data.months.length * 105}>
                <thead>
                  <tr>
                    <Th rowSpan={2} className="sticky left-0 z-[3] min-w-40 text-left shadow-[1px_0_0_var(--color-line)]">
                      <span className="flex items-center gap-2">
                        {editable && (
                          <input type="checkbox" checked={allShown} onChange={() => setPicked(allShown ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Hammasini tanlash" />
                        )}
                        Raqam
                      </span>
                    </Th>
                    <Th rowSpan={2} className="min-w-44 text-left">Rusumi · haydovchi</Th>
                    <Th rowSpan={2} className="min-w-56 text-left">Bo&apos;limi va izoh</Th>
                    <GroupTh span={data.months.length}>Oylar bo&apos;yicha xarajat, so&apos;m</GroupTh>
                    <Th rowSpan={2}>Jami</Th>
                    {editable && <Th rowSpan={2} />}
                  </tr>
                  <tr>
                    {data.months.map((m, i) => (
                      <Th key={m} className={cn('whitespace-nowrap', i === 0 && 'first:border-l')}>
                        {formatPeriodShort(m)}
                      </Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <Tr total>
                    <Td className="sticky left-0 z-[1] text-left shadow-[1px_0_0_var(--color-line)]">Jami</Td>
                    <Td className="text-left" colSpan={2}>
                      Jami · {rows.length} ta mashina
                    </Td>
                    {data.months.map((m) => (
                      <MoneyCell key={m} value={rows.reduce((a, r) => a + Number(r.months[m] ?? 0), 0)} />
                    ))}
                    <MoneyCell value={rows.reduce((a, r) => a + Number(r.totalTiyin), 0)} strong />
                    {editable && <Td />}
                  </Tr>
                  {rows.map((r) => {
                    const on = picked.has(r.id);
                    return (
                      <Tr key={r.id} onClick={editable ? () => toggle(r.id) : undefined} className={cn(on && '!bg-brand-100', !r.isActive && 'opacity-60')}>
                        <Td className="sticky left-0 z-[1] whitespace-nowrap text-left shadow-[1px_0_0_var(--color-line)]">
                          <span className="flex items-center gap-2">
                            {editable && (
                              <input type="checkbox" checked={on} onChange={() => toggle(r.id)} onClick={(e) => e.stopPropagation()} aria-label={`${r.plateNumber} tanlash`} />
                            )}
                            <span className="rounded border border-(--color-line-strong) bg-white px-1.5 py-0.5 font-mono text-xs font-semibold">{r.plateNumber}</span>
                          </span>
                        </Td>
                        <Td className="text-left">
                          <span className="block font-medium text-heading">{r.model}</span>
                          <span className="block text-[11px] text-(--color-text-faint)">{[r.driverName, r.fleetGroupLabel, r.isActive ? '' : 'faol emas'].filter(Boolean).join(' · ')}</span>
                        </Td>
                        <Td className="text-left">
                          <span
                            className={cn(
                              'inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold',
                              r.segment ? 'bg-amber-50 text-amber-800' : r.unit === 'REGION' ? 'bg-violet-50 text-violet-700' : r.departmentId ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600',
                            )}
                          >
                            {r.unit === 'CENTER' && !r.departmentId ? "Markaz · bo'lim belgilanmagan" : r.placeLabel}
                          </span>
                          {r.comment && <span className="mt-0.5 block text-[11px] text-(--color-text-muted)">💬 {r.comment}</span>}
                        </Td>
                        {data.months.map((m) =>
                          Number(r.months[m] ?? 0) ? <MoneyCell key={m} value={Number(r.months[m])} className="text-(--color-text-muted)" /> : <Td key={m} />,
                        )}
                        <MoneyCell value={Number(r.totalTiyin)} strong />
                        {editable && (
                          <Td>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                editOne(r);
                              }}
                              className="rounded-lg border border-brand-300 px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50"
                            >
                              O&apos;zgartirish
                            </button>
                          </Td>
                        )}
                      </Tr>
                    );
                  })}
                </tbody>
              </RTable>
              <TableNote>
                Qatorni bosing — mashina tanlanadi (bir nechtasini birdan tanlash mumkin), tepadagi panelda bo&apos;limni ko&apos;rsating va «Biriktirish»ni bosing. Mashinaning
                xarajatlari Xarajatlarda o&apos;sha joyga ko&apos;chadi (Solishtirmada ham), keyingi benzin hisoboti va qo&apos;lda kiritilganlar ham avtomatik shu joyga yoziladi.
                Izoh xarajat yozuvining tavsifiga ham qo&apos;shiladi.
              </TableNote>
            </ReportCard>
          </>
        )}
      </div>
      <ConfirmDialog
        open={ask}
        title="Bo'limga biriktirish"
        message={`${picked.size} ta mashina → ${targetLabel}. ${fromAll ? 'Barcha oylardagi' : `${formatPeriod(fromPeriod)} dan boshlab`} xarajatlari ko'chiriladi, keyingi yuklashlar ham shu joyga yoziladi.${comment.trim() ? ` Izoh: «${comment.trim()}».` : ''} Davom etilsinmi?`}
        confirmLabel="Ha, biriktirish"
        loading={saving}
        onConfirm={() => void save()}
        onCancel={() => setAsk(false)}
      />
      {importing && (
        <FuelImportDialog
          onClose={() => setImporting(false)}
          onDone={(message) => {
            setImporting(false);
            setToast({ message });
            result.reload();
          }}
        />
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 6000} />}
    </>
  );
}

export default VehiclePlacesPage;
