'use client';

import {
  fuelUnit,
  KIND_HINTS,
  KIND_LABELS,
  KINDS,
  parseNumber,
  PAYMENT_LABELS,
  somToTiyin,
  tiyinToInput,
  vehiclesApi,
  type RecordInput,
  type VehicleItem,
  type VehiclePaymentMethod,
  type VehicleRecordItem,
  type VehicleRecordKind,
} from '@/features/vehicles/api';
import { errorMessage } from '@/lib/error-message';
import { formatSum, todayInput } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMemo, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface Props {
  /** null — yangi yozuv */
  record: VehicleRecordItem | null;
  vehicles: VehicleItem[];
  /** Yangi yozuv uchun oldindan tanlangan mashina va tur */
  defaults?: { vehicleId?: string; kind?: VehicleRecordKind };
  onClose: () => void;
  onSaved: (message: string, record: VehicleRecordItem) => void;
}

interface FormState {
  vehicleId: string;
  kind: VehicleRecordKind;
  date: string;
  amount: string;
  liters: string;
  odometerKm: string;
  counterparty: string;
  documentNo: string;
  paymentMethod: VehiclePaymentMethod;
  description: string;
}

type Errors = Partial<Record<keyof FormState, string>>;

const COUNTERPARTY_LABEL: Record<VehicleRecordKind, string> = {
  FUEL: 'AZS (yoqilg‘i quyilgan joy)',
  WASH: 'Moyka nomi',
  REPAIR: 'Servis / usta',
  SERVICE: 'Servis',
  OTHER: 'Kimga to‘landi',
};

const DESCRIPTION_PLACEHOLDER: Record<VehicleRecordKind, string> = {
  FUEL: "Masalan: to'liq bak",
  WASH: 'Masalan: kuzov + salon',
  REPAIR: "Masalan: tormoz kolodkasi almashtirildi",
  SERVICE: 'Masalan: moy va moy filtri',
  OTHER: "Masalan: OSAGO sug'urta, 1 yil",
};

const PAYMENT_OPTIONS = (Object.keys(PAYMENT_LABELS) as VehiclePaymentMethod[]).map((value) => ({
  value,
  label: PAYMENT_LABELS[value],
}));

export function RecordForm({ record, vehicles, defaults, onClose, onSaved }: Props) {
  const isEditing = record !== null;

  const selectable = useMemo(
    () => vehicles.filter((v) => v.isActive || v.id === record?.vehicleId),
    [vehicles, record],
  );

  const [form, setForm] = useState<FormState>(() => ({
    vehicleId: record?.vehicleId ?? defaults?.vehicleId ?? selectable[0]?.id ?? '',
    kind: record?.kind ?? defaults?.kind ?? 'FUEL',
    date: record?.date ?? todayInput(),
    amount: record ? tiyinToInput(record.amountTiyin) : '',
    liters: record?.liters != null ? String(record.liters).replace('.', ',') : '',
    odometerKm: record?.odometerKm != null ? String(record.odometerKm) : '',
    counterparty: record?.counterparty ?? '',
    documentNo: record?.documentNo ?? '',
    paymentMethod: record?.paymentMethod ?? 'CASH',
    description: record?.description ?? '',
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const vehicle = vehicles.find((v) => v.id === form.vehicleId) ?? null;
  const unit = vehicle ? fuelUnit(vehicle.fuelType) : 'l';

  // Bir litr narxi — tekshirish uchun ko'rsatiladi
  const amountTiyin = somToTiyin(form.amount);
  const liters = parseNumber(form.liters);
  const pricePerUnit =
    form.kind === 'FUEL' && amountTiyin && liters && liters > 0
      ? formatSum(Number(amountTiyin) / 100 / liters, { decimals: 0 })
      : null;

  function validate(): Errors {
    const next: Errors = {};
    if (!form.vehicleId) next.vehicleId = 'Mashinani tanlang';
    if (!form.date) next.date = 'Sanani kiriting';
    else if (form.date > todayInput()) next.date = 'Kelajakdagi sana';
    if (!amountTiyin) next.amount = "Summani kiriting";
    if (form.kind === 'FUEL' && liters !== null && (Number.isNaN(liters) || liters <= 0 || liters > 2000)) {
      next.liters = "Noto'g'ri";
    }
    const odometer = parseNumber(form.odometerKm);
    if (odometer !== null && (!Number.isInteger(odometer) || odometer < 0)) next.odometerKm = 'Butun son, km';
    return next;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const input: RecordInput = {
      vehicleId: form.vehicleId,
      kind: form.kind,
      date: form.date,
      amountTiyin: amountTiyin!,
      liters: form.kind === 'FUEL' ? liters : null,
      odometerKm: parseNumber(form.odometerKm),
      counterparty: form.counterparty.trim() || null,
      documentNo: form.documentNo.trim() || null,
      paymentMethod: form.paymentMethod,
      description: form.description.trim() || null,
    };

    setSaving(true);
    setServerError(null);
    try {
      const result = isEditing
        ? await vehiclesApi.updateRecord(record.id, input)
        : await vehiclesApi.createRecord(input);
      onSaved(isEditing ? "O'zgarishlar saqlandi" : `${KIND_LABELS[form.kind]} xarajati qo'shildi`, result.data);
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
      title={isEditing ? 'Xarajatni tahrirlash' : 'Mashina xarajati'}
      description="Saqlanganda «Xarajatlar › Doimiy» ro'yxatiga ham yoziladi"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Bekor qilish
          </Button>
          <Button type="submit" form="vehicle-record-form" loading={saving}>
            {isEditing ? 'Saqlash' : "Qo'shish"}
          </Button>
        </div>
      }
    >
      <form id="vehicle-record-form" onSubmit={handleSubmit} className="space-y-5" noValidate>
        {serverError && (
          <div className="rounded-(--radius-control) border border-(--color-expense) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">
            {serverError}
          </div>
        )}

        {/* Tur */}
        <div>
          <p className="mb-1.5 text-sm font-medium text-(--color-text)">Xarajat turi</p>
          <div className="grid grid-cols-5 gap-1 rounded-(--radius-control) bg-(--color-surface-sunken) p-1">
            {KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => set('kind', kind)}
                className={cn(
                  'rounded-(--radius-control) px-2 py-1.5 text-xs transition-colors sm:text-sm',
                  form.kind === kind
                    ? 'bg-white font-medium text-brand-800 shadow-sm'
                    : 'text-(--color-text-muted) hover:text-(--color-text)',
                )}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs text-(--color-text-muted)">{KIND_HINTS[form.kind]}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Mashina"
            required
            options={selectable.map((v) => ({ value: v.id, label: `${v.plateNumber} · ${v.model}` }))}
            placeholder="Tanlang"
            value={form.vehicleId}
            onChange={(event) => set('vehicleId', event.target.value)}
            error={errors.vehicleId}
          />
          <Input
            label="Sana"
            type="date"
            required
            max={todayInput()}
            value={form.date}
            onChange={(event) => set('date', event.target.value)}
            error={errors.date}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Summa"
            required
            money
            inputMode="decimal"
            placeholder="0"
            suffix="so'm"
            value={form.amount}
            onChange={(event) => set('amount', event.target.value)}
            error={errors.amount}
          />
          {form.kind === 'FUEL' ? (
            <Input
              label="Miqdori"
              inputMode="decimal"
              placeholder="40"
              suffix={unit}
              value={form.liters}
              onChange={(event) => set('liters', event.target.value)}
              error={errors.liters}
              hint={pricePerUnit ? `1 ${unit} = ${pricePerUnit} so'm` : 'Sarfni hisoblash uchun'}
            />
          ) : (
            <Select
              label="To'lov usuli"
              options={PAYMENT_OPTIONS}
              value={form.paymentMethod}
              onChange={(event) => set('paymentMethod', event.target.value as VehiclePaymentMethod)}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Spidometr"
            inputMode="numeric"
            placeholder={vehicle?.lastOdometerKm != null ? String(vehicle.lastOdometerKm) : '85000'}
            suffix="km"
            value={form.odometerKm}
            onChange={(event) => set('odometerKm', event.target.value)}
            error={errors.odometerKm}
            hint={
              vehicle?.lastOdometerKm != null
                ? `Oxirgi: ${formatSum(vehicle.lastOdometerKm)} km`
                : form.kind === 'FUEL'
                  ? '100 km ga sarfni hisoblash uchun'
                  : 'Ixtiyoriy'
            }
          />
          {form.kind === 'FUEL' ? (
            <Select
              label="To'lov usuli"
              options={PAYMENT_OPTIONS}
              value={form.paymentMethod}
              onChange={(event) => set('paymentMethod', event.target.value as VehiclePaymentMethod)}
            />
          ) : (
            <Input
              label="Chek / hujjat №"
              value={form.documentNo}
              onChange={(event) => set('documentNo', event.target.value)}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input
            label={COUNTERPARTY_LABEL[form.kind]}
            value={form.counterparty}
            onChange={(event) => set('counterparty', event.target.value)}
          />
          {form.kind === 'FUEL' ? (
            <Input
              label="Chek №"
              value={form.documentNo}
              onChange={(event) => set('documentNo', event.target.value)}
            />
          ) : (
            <div />
          )}
        </div>

        <Input
          label="Izoh"
          placeholder={DESCRIPTION_PLACEHOLDER[form.kind]}
          value={form.description}
          onChange={(event) => set('description', event.target.value)}
        />
      </form>
    </Drawer>
  );
}