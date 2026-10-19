'use client';

import {
  vehiclesApi,
  parseNumber,
  type VehicleFuelType,
  type VehicleInput,
  type VehicleItem,
  type VehicleLookups,
} from '@/features/vehicles/api';
import { errorMessage } from '@/lib/error-message';
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface Props {
  /** null — yangi mashina */
  vehicle: VehicleItem | null;
  lookups: VehicleLookups | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface FormState {
  plateNumber: string;
  model: string;
  year: string;
  color: string;
  fuelType: VehicleFuelType;
  fuelNorm: string;
  regionCode: string;
  departmentId: string;
  driverName: string;
  driverPhone: string;
  initialOdometerKm: string;
  isActive: boolean;
  note: string;
}

type Errors = Partial<Record<keyof FormState, string>>;

function initialState(vehicle: VehicleItem | null): FormState {
  return {
    plateNumber: vehicle?.plateNumber ?? '',
    model: vehicle?.model ?? '',
    year: vehicle?.year ? String(vehicle.year) : '',
    color: vehicle?.color ?? '',
    fuelType: vehicle?.fuelType ?? 'AI92',
    fuelNorm: vehicle?.fuelNorm ? String(vehicle.fuelNorm).replace('.', ',') : '',
    regionCode: String(vehicle?.regionCode ?? 0),
    departmentId: vehicle?.departmentId ?? '',
    driverName: vehicle?.driverName ?? '',
    driverPhone: vehicle?.driverPhone ?? '',
    initialOdometerKm: vehicle?.initialOdometerKm != null ? String(vehicle.initialOdometerKm) : '',
    isActive: vehicle?.isActive ?? true,
    note: vehicle?.note ?? '',
  };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

export function VehicleForm({ vehicle, lookups, onClose, onSaved }: Props) {
  const isEditing = vehicle !== null;
  const [form, setForm] = useState<FormState>(() => initialState(vehicle));
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const regionOptions = useMemo(
    () => (lookups?.regions ?? [{ code: 0, name: 'Markaz' }]).map((r) => ({ value: String(r.code), label: r.name })),
    [lookups],
  );
  const departmentOptions = useMemo(
    () => [{ value: '', label: 'Tanlanmagan' }, ...(lookups?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))],
    [lookups],
  );
  const fuelOptions = useMemo(
    () => (lookups?.fuelTypes ?? []).map((f) => ({ value: f.value, label: f.label })),
    [lookups],
  );

  const isCentral = form.regionCode === '0';

  function validate(): Errors {
    const next: Errors = {};
    if (!form.plateNumber.trim()) next.plateNumber = 'Davlat raqamini kiriting';
    else if (!/^[0-9A-Za-z\s-]+$/.test(form.plateNumber.trim())) next.plateNumber = 'Faqat lotin harflari va raqamlar';
    if (!form.model.trim()) next.model = 'Rusumini kiriting';

    const year = parseNumber(form.year);
    const maxYear = new Date().getFullYear() + 1;
    if (year !== null && (!Number.isInteger(year) || year < 1970 || year > maxYear)) next.year = `1970–${maxYear}`;

    const norm = parseNumber(form.fuelNorm);
    if (norm !== null && (Number.isNaN(norm) || norm <= 0 || norm > 100)) next.fuelNorm = '0 dan 100 gacha';

    const odometer = parseNumber(form.initialOdometerKm);
    if (odometer !== null && (!Number.isInteger(odometer) || odometer < 0)) next.initialOdometerKm = 'Butun son, km';
    return next;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const input: VehicleInput = {
      plateNumber: form.plateNumber.trim().toUpperCase(),
      model: form.model.trim(),
      year: parseNumber(form.year),
      color: form.color.trim() || null,
      fuelType: form.fuelType,
      fuelNorm: parseNumber(form.fuelNorm),
      regionCode: Number(form.regionCode),
      departmentId: isCentral ? form.departmentId || null : null,
      driverName: form.driverName.trim() || null,
      driverPhone: form.driverPhone.trim() || null,
      initialOdometerKm: parseNumber(form.initialOdometerKm),
      isActive: form.isActive,
      note: form.note.trim() || null,
    };

    setSaving(true);
    setServerError(null);
    try {
      if (isEditing) {
        await vehiclesApi.update(vehicle.id, input);
        onSaved(`${input.plateNumber} saqlandi`);
      } else {
        await vehiclesApi.create(input);
        onSaved(`${input.plateNumber} qo'shildi`);
      }
    } catch (err) {
      setServerError(errorMessage(err, 'Saqlab bo‘lmadi'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={saving ? () => undefined : onClose}
      title={isEditing ? `${vehicle.plateNumber} — tahrirlash` : 'Yangi mashina'}
      description="Bir marta kiritiladi — keyin har oy yoqilg'i, moyka va ta'mirlash xarajatlari yoziladi"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Bekor qilish
          </Button>
          <Button type="submit" form="vehicle-form" loading={saving}>
            {isEditing ? 'Saqlash' : "Qo'shish"}
          </Button>
        </div>
      }
    >
      <form id="vehicle-form" onSubmit={handleSubmit} className="space-y-6" noValidate>
        {serverError && (
          <div className="rounded-(--radius-control) border border-(--color-expense) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">
            {serverError}
          </div>
        )}

        <Section title="Mashina">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Davlat raqami"
              required
              placeholder="01 A 123 BC"
              value={form.plateNumber}
              onChange={(event) => set('plateNumber', event.target.value.toUpperCase())}
              error={errors.plateNumber}
            />
            <Input
              label="Rusumi"
              required
              placeholder="Chevrolet Cobalt"
              value={form.model}
              onChange={(event) => set('model', event.target.value)}
              error={errors.model}
            />
            <Input
              label="Yili"
              inputMode="numeric"
              placeholder="2021"
              value={form.year}
              onChange={(event) => set('year', event.target.value)}
              error={errors.year}
            />
            <Input
              label="Rangi"
              placeholder="Oq"
              value={form.color}
              onChange={(event) => set('color', event.target.value)}
            />
          </div>
        </Section>

        <Section title="Yoqilg'i">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Yoqilg'i turi"
              options={fuelOptions}
              value={form.fuelType}
              onChange={(event) => set('fuelType', event.target.value as VehicleFuelType)}
            />
            <Input
              label="Me'yor (100 km ga)"
              inputMode="decimal"
              placeholder="8,5"
              suffix={form.fuelType === 'METAN' ? 'm³' : form.fuelType === 'ELEKTR' ? 'kVt·s' : 'l'}
              value={form.fuelNorm}
              onChange={(event) => set('fuelNorm', event.target.value)}
              error={errors.fuelNorm}
              hint="Ixtiyoriy — haqiqiy sarf bilan solishtirish uchun"
            />
          </div>
          <Input
            label="Boshlang'ich probeg"
            inputMode="numeric"
            placeholder="85000"
            suffix="km"
            value={form.initialOdometerKm}
            onChange={(event) => set('initialOdometerKm', event.target.value)}
            error={errors.initialOdometerKm}
            hint="Ixtiyoriy — hisobga olingan kundagi spidometr"
          />
        </Section>

        <Section title="Kimga biriktirilgan">
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Hudud"
              options={regionOptions}
              value={form.regionCode}
              onChange={(event) => {
                set('regionCode', event.target.value);
                set('departmentId', '');
              }}
            />
            {isCentral ? (
              <Select
                label="Bo'lim"
                options={departmentOptions}
                value={form.departmentId}
                onChange={(event) => set('departmentId', event.target.value)}
              />
            ) : (
              <div />
            )}
            <Input
              label="Haydovchi"
              placeholder="F.I.Sh."
              value={form.driverName}
              onChange={(event) => set('driverName', event.target.value)}
            />
            <Input
              label="Telefon"
              placeholder="+998 90 123 45 67"
              value={form.driverPhone}
              onChange={(event) => set('driverPhone', event.target.value)}
            />
          </div>
        </Section>

        <Section title="Qo'shimcha">
          <Input label="Izoh" value={form.note} onChange={(event) => set('note', event.target.value)} />
          {isEditing && (
            <label className="flex items-start gap-2.5 text-sm text-(--color-text)">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={form.isActive}
                onChange={(event) => set('isActive', event.target.checked)}
              />
              <span>
                Faol
                <span className="block text-xs text-(--color-text-muted)">
                  Sotilgan yoki hisobdan chiqarilgan mashina uchun belgini olib tashlang — tarix saqlanadi
                </span>
              </span>
            </label>
          )}
        </Section>
      </form>
    </Drawer>
  );
}