'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconSpinner, IconTrash } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/error-message';
import { formatPeriod } from '@/lib/format';
import type { Department, RegionWithDistricts } from '@/lib/types';
import { useAsync } from '@/lib/use-async';
import { placementsApi, type EmployeePlacement } from './api';

const CENTRAL_REGION = 0;
const EMPTY = { from: '', to: '', unit: 'CENTER' as 'CENTER' | 'REGION', departmentId: '', regionCode: '', districtId: '', position: '', note: '' };

/**
 * Joylashuv davrlari: «shu oydan shu oygacha shu joyda (Markaz bo'limi yoki hudud), shu lavozimda».
 * Ish haqi, solishtirma va Markaz bo'limlari shu oylarda xodimni shu joyda hisoblaydi (yuqoridagi doimiy joydan ustun).
 */
export function PlacementsCard({ pinfl, regions, departments, readOnly }: { pinfl: string; regions: RegionWithDistricts[]; departments: Department[]; readOnly: boolean }) {
  const [rev, setRev] = useState(0);
  const res = useAsync(() => placementsApi.list(pinfl).then((r) => r.data.items), [pinfl, rev]);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeAsk, setRemoveAsk] = useState<EmployeePlacement | null>(null);
  const update = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => {
    setForm((f) => ({ ...f, [k]: v, ...(k === 'regionCode' ? { districtId: '' } : {}) }));
    setError(null);
  };
  const region = regions.find((r) => String(r.code) === form.regionCode);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await placementsApi.add(pinfl, {
        from: form.from,
        to: form.to || null,
        unit: form.unit,
        ...(form.unit === 'CENTER' ? { departmentId: form.departmentId || null } : { regionCode: form.regionCode ? Number(form.regionCode) : null, districtId: form.districtId || null }),
        position: form.position.trim() || null,
        note: form.note.trim() || null,
      });
      setForm(EMPTY);
      setAdding(false);
      setRev((x) => x + 1);
    } catch (err) {
      setError(errorMessage(err, "Davrni saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!removeAsk) return;
    setSaving(true);
    try {
      await placementsApi.remove(pinfl, removeAsk.id);
      setRev((x) => x + 1);
    } catch (err) {
      setError(errorMessage(err, "O'chirib bo'lmadi"));
    } finally {
      setSaving(false);
      setRemoveAsk(null);
    }
  }

  const items = res.data ?? [];
  return (
    <div className="mt-6 space-y-3 border-t border-(--color-line) pt-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-heading">Joylashuv davrlari</h3>
        {!readOnly && !adding && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            + Davr qo&apos;shish
          </Button>
        )}
      </div>
      <p className="text-xs text-(--color-text-muted)">
        Xodim shu oylarda shu joyda, shu lavozimda hisoblanadi: ish haqi, solishtirma va Markaz bo&apos;limlari. Bu yuqoridagi doimiy joydan ustun. Davrlar bir-birini kesmasin. «Gacha» bo&apos;sh bo&apos;lsa, davr hozirgacha davom etadi.
      </p>

      {res.loading && !res.data ? (
        <IconSpinner className="size-4 animate-spin text-(--color-text-muted)" />
      ) : res.error ? (
        <p className="text-xs text-(--color-expense)">{res.error}</p>
      ) : !items.length ? (
        <p className="text-xs text-(--color-text-faint)">Davr kiritilmagan — xodim yuqoridagi joyda hisoblanadi.</p>
      ) : (
        <ul className="divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line) text-sm">
          {items.map((p) => (
            <li key={p.id} className="flex items-start gap-2 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-heading">
                  {formatPeriod(p.from)} — {p.to ? formatPeriod(p.to) : 'hozirgacha'}
                </span>
                <span className="block text-xs text-(--color-text-muted)">
                  {p.placeLabel}
                  {p.position ? ` · ${p.position}` : ''}
                  {p.note ? ` · ${p.note}` : ''}
                </span>
              </span>
              {!readOnly && (
                <button type="button" onClick={() => setRemoveAsk(p)} disabled={saving} className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-expense-soft) hover:text-(--color-expense) disabled:opacity-50" aria-label="Davrni o'chirish">
                  <IconTrash className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="space-y-3 rounded-(--radius-control) border border-brand-200 bg-brand-50/40 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Qaysi oydan" type="month" value={form.from} onChange={(e) => update('from', e.target.value)} required disabled={saving} />
            <Input label="Qaysi oygacha (bo'sh — hozirgacha)" type="month" value={form.to} onChange={(e) => update('to', e.target.value)} disabled={saving} />
          </div>
          <Select
            label="Joy"
            value={form.unit}
            onChange={(e) => update('unit', e.target.value === 'REGION' ? 'REGION' : 'CENTER')}
            options={[
              { value: 'CENTER', label: 'Markaz' },
              { value: 'REGION', label: 'Hudud' },
            ]}
            disabled={saving}
          />
          {form.unit === 'CENTER' ? (
            <Select label="Markaz bo'limi" value={form.departmentId} onChange={(e) => update('departmentId', e.target.value)} placeholder="Bo'limni tanlang" options={departments.filter((d) => d.isActive).map((d) => ({ value: d.id, label: d.name }))} required disabled={saving} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Viloyat" value={form.regionCode} onChange={(e) => update('regionCode', e.target.value)} placeholder="Viloyatni tanlang" options={regions.filter((r) => r.code !== CENTRAL_REGION).map((r) => ({ value: String(r.code), label: r.name }))} required disabled={saving} />
              <Select label="Tuman (ixtiyoriy)" value={form.districtId} onChange={(e) => update('districtId', e.target.value)} placeholder="Viloyat bo'yicha" options={(region?.districts ?? []).map((d) => ({ value: d.id, label: d.name }))} disabled={saving || !region} />
            </div>
          )}
          <Input label="Lavozim (shu davrda)" value={form.position} onChange={(e) => update('position', e.target.value)} maxLength={120} placeholder="Masalan: bo'lim boshlig'i" disabled={saving} />
          <Input label="Izoh (ixtiyoriy)" value={form.note} onChange={(e) => update('note', e.target.value)} maxLength={300} disabled={saving} />
          {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setAdding(false); setForm(EMPTY); setError(null); }}>
              Bekor
            </Button>
            <Button size="sm" loading={saving} disabled={!form.from || (form.unit === 'CENTER' ? !form.departmentId : !form.regionCode)} onClick={() => void save()}>
              Davrni saqlash
            </Button>
          </div>
        </div>
      )}
      {!adding && error && <p className="text-xs text-(--color-expense)">{error}</p>}

      <ConfirmDialog
        open={removeAsk !== null}
        title="Davrni o'chirish"
        message={removeAsk ? `${formatPeriod(removeAsk.from)} — ${removeAsk.to ? formatPeriod(removeAsk.to) : 'hozirgacha'} · ${removeAsk.placeLabel} davri o'chiriladi. Shu oylarda xodim yana yuqoridagi doimiy joyda hisoblanadi.` : ''}
        confirmLabel="O'chirish"
        danger
        loading={saving}
        onConfirm={() => void remove()}
        onCancel={() => setRemoveAsk(null)}
      />
    </div>
  );
}
