'use client';

import {
    DOCUMENT_ACCEPT,
    FREQUENCY_LABELS,
    KIND_LABELS,
    leasesApi,
    somToTiyin,
    uploadLeaseDocument,
    type LeaseDetail,
    type LeaseFrequency,
    type LeaseInput,
    type LeaseKind,
    type LeaseLookups,
} from '@/features/leases/api';
import { errorMessage } from '@/lib/error-message';
import { currentPeriod, formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { IconClose, IconUpload } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface Props {
  /** null — yangi shartnoma */
  lease: LeaseDetail | null;
  lookups: LeaseLookups | null;
  onClose: () => void;
  onSaved: (lease: LeaseDetail, message: string) => void;
}

interface FormState {
  kind: LeaseKind;
  regionCode: string;
  districtId: string;
  departmentId: string;
  airportName: string;
  title: string;
  number: string;
  contractDate: string;
  startPeriod: string;
  monthlySom: string;
  vatIncluded: boolean;
  paymentFrequency: LeaseFrequency;
  paymentDay: string;
  areaM2: string;
  address: string;
  purpose: string;
  lessorName: string;
  lessorTin: string;
  lessorPhone: string;
  lessorBank: string;
  note: string;
}

type Errors = Partial<Record<keyof FormState, string>>;

function initialState(lease: LeaseDetail | null): FormState {
  return {
    kind: lease?.kind ?? 'ODDIY',
    regionCode: lease ? String(lease.place.regionCode) : '',
    districtId: lease?.place.districtId ?? '',
    departmentId: lease?.place.departmentId ?? '',
    airportName: lease?.place.airportName ?? '',
    title: lease?.title ?? '',
    number: lease?.number ?? '',
    contractDate: lease?.contractDate ?? '',
    startPeriod: lease?.startPeriod ?? currentPeriod(),
    monthlySom: '',
    vatIncluded: lease?.vatIncluded ?? true,
    paymentFrequency: lease?.paymentFrequency ?? 'MONTHLY',
    paymentDay: lease?.paymentDay ? String(lease.paymentDay) : '',
    areaM2: lease?.areaM2 !== null && lease?.areaM2 !== undefined ? String(lease.areaM2) : '',
    address: lease?.address ?? '',
    purpose: lease?.purpose ?? '',
    lessorName: lease?.lessorName ?? '',
    lessorTin: lease?.lessorTin ?? '',
    lessorPhone: lease?.lessorPhone ?? '',
    lessorBank: lease?.lessorBank ?? '',
    note: lease?.note ?? '',
  };
}

/** Shartnoma qo'shish / tahrirlash */
export function LeaseForm({ lease, lookups, onClose, onSaved }: Props) {
  const isEditing = lease !== null;
  const [form, setForm] = useState<FormState>(() => initialState(lease));
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [contractFile, setContractFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const region = lookups?.regions.find((r) => String(r.code) === form.regionCode);
  const isCentral = form.regionCode === '0';

  const regionOptions = useMemo(
    () => [
      { value: '', label: 'Hududni tanlang' },
      ...(lookups?.regions ?? []).map((r) => ({ value: String(r.code), label: r.name })),
    ],
    [lookups],
  );

  const districtOptions = [
    { value: '', label: 'Viloyat boshqarmasi (tumansiz)' },
    ...(region?.districts ?? []).map((d) => ({ value: d.id, label: d.name })),
  ];

  const departmentOptions = [
    { value: '', label: 'Markaz (umumiy)' },
    ...(lookups?.departments ?? []).map((d) => ({ value: d.id, label: `${d.index} — ${d.name}` })),
  ];

  const monthlyPreview = form.monthlySom ? somToTiyin(form.monthlySom) : null;

  function validate(): Errors {
    const next: Errors = {};
    if (!form.regionCode) next.regionCode = 'Hududni tanlang';
    if (form.kind === 'AEROPORT' && !form.airportName.trim()) next.airportName = 'Aeroport nomini kiriting';
    if (!form.title.trim()) next.title = 'Obyekt nomini kiriting';
    if (!form.number.trim()) next.number = 'Shartnoma raqamini kiriting';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(form.startPeriod)) next.startPeriod = 'Oyni tanlang';
    if (!form.lessorName.trim()) next.lessorName = 'Ijaraga beruvchini kiriting';
    if (!isEditing) {
      const tiyin = somToTiyin(form.monthlySom);
      if (!tiyin || tiyin === '0') next.monthlySom = 'Oylik summani kiriting';
    }
    if (form.lessorTin && !/^\d{9}$|^\d{14}$/.test(form.lessorTin.trim())) {
      next.lessorTin = '9 xonali STIR yoki 14 xonali JShShIR';
    }
    if (form.paymentDay) {
      const day = Number(form.paymentDay);
      if (!Number.isInteger(day) || day < 1 || day > 31) next.paymentDay = '1–31';
    }
    if (form.areaM2 && !(Number(form.areaM2.replace(',', '.')) >= 0)) next.areaM2 = "Noto'g'ri";
    return next;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const input: LeaseInput = {
      kind: form.kind,
      regionCode: Number(form.regionCode),
      districtId: form.kind === 'ODDIY' && !isCentral ? form.districtId || null : null,
      departmentId: form.kind === 'ODDIY' && isCentral ? form.departmentId || null : null,
      airportName: form.kind === 'AEROPORT' ? form.airportName.trim() : null,
      title: form.title.trim(),
      number: form.number.trim(),
      contractDate: form.contractDate || null,
      startPeriod: form.startPeriod,
      vatIncluded: form.vatIncluded,
      paymentFrequency: form.paymentFrequency,
      paymentDay: form.paymentDay ? Number(form.paymentDay) : null,
      areaM2: form.areaM2 ? Number(form.areaM2.replace(',', '.')) : null,
      address: form.address.trim() || null,
      purpose: form.purpose.trim() || null,
      lessorName: form.lessorName.trim(),
      lessorTin: form.lessorTin.trim() || null,
      lessorPhone: form.lessorPhone.trim() || null,
      lessorBank: form.lessorBank.trim() || null,
      note: form.note.trim() || null,
    };

    setSaving(true);
    setServerError(null);
    try {
      if (isEditing) {
        const result = await leasesApi.update(lease.id, input);
        onSaved(result.data, "O'zgarishlar saqlandi");
      } else {
        input.monthlyTiyin = somToTiyin(form.monthlySom) ?? '0';
        const result = await leasesApi.create(input);
        let message = "Shartnoma qo'shildi";
        if (contractFile) {
          try {
            await uploadLeaseDocument(result.data.id, contractFile, 'SHARTNOMA');
            message = "Shartnoma va hujjat qo'shildi";
          } catch (err) {
            message = `Shartnoma qo'shildi, lekin hujjat yuklanmadi: ${errorMessage(err, 'xato')}`;
          }
        }
        const fresh = await leasesApi.getOne(result.data.id);
        onSaved(fresh.data, message);
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
      title={isEditing ? 'Shartnomani tahrirlash' : 'Yangi ijara shartnomasi'}
      description={
        isEditing
          ? `№ ${lease.number} · narx o'zgarishi shartnoma kartasida kiritiladi`
          : "Bir marta kiritiladi — keyingi oylarga o'zi davom etadi"
      }
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Bekor qilish
          </Button>
          <Button type="submit" form="lease-form" loading={saving}>
            {isEditing ? 'Saqlash' : "Qo'shish"}
          </Button>
        </div>
      }
    >
      <form id="lease-form" onSubmit={handleSubmit} className="space-y-6" noValidate>
        {serverError && (
          <div className="rounded-(--radius-control) border border-(--color-expense) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">
            {serverError}
          </div>
        )}

        {/* ── Joy ── */}
        <Section title="Joylashuvi">
          <div className="grid grid-cols-2 gap-1 rounded-(--radius-control) bg-(--color-surface-sunken) p-1">
            {(Object.keys(KIND_LABELS) as LeaseKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => set('kind', kind)}
                className={cn(
                  'rounded-(--radius-control) px-3 py-1.5 text-sm transition-colors',
                  form.kind === kind
                    ? 'bg-white font-medium text-brand-800 shadow-sm'
                    : 'text-(--color-text-muted) hover:text-(--color-text)',
                )}
              >
                {KIND_LABELS[kind]}
              </button>
            ))}
          </div>

          <Select
            label={form.kind === 'AEROPORT' ? 'Aeroport joylashgan hudud' : 'Hudud'}
            required
            options={regionOptions}
            value={form.regionCode}
            onChange={(event) => {
              set('regionCode', event.target.value);
              set('districtId', '');
              set('departmentId', '');
            }}
            error={errors.regionCode}
          />

          {form.kind === 'AEROPORT' ? (
            <>
              <Input
                label="Aeroport"
                required
                list="lease-airports"
                placeholder="Masalan: Toshkent xalqaro aeroporti"
                value={form.airportName}
                onChange={(event) => set('airportName', event.target.value)}
                error={errors.airportName}
              />
              <datalist id="lease-airports">
                {(lookups?.airports ?? []).map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </>
          ) : isCentral ? (
            <Select
              label="Bo'lim"
              options={departmentOptions}
              value={form.departmentId}
              onChange={(event) => set('departmentId', event.target.value)}
              hint="Ixtiyoriy — ijara qaysi bo'limga tegishli"
            />
          ) : form.regionCode ? (
            <Select
              label="Tuman"
              options={districtOptions}
              value={form.districtId}
              onChange={(event) => set('districtId', event.target.value)}
            />
          ) : null}

          <Input
            label="Obyekt nomi"
            required
            placeholder="Masalan: Asaka tuman bo'limi binosi"
            value={form.title}
            onChange={(event) => set('title', event.target.value)}
            error={errors.title}
          />
          <Input
            label="Manzil"
            value={form.address}
            onChange={(event) => set('address', event.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Maydon"
              suffix="m²"
              inputMode="decimal"
              value={form.areaM2}
              onChange={(event) => set('areaM2', event.target.value)}
              error={errors.areaM2}
            />
            <Input
              label="Maqsadi"
              placeholder="Ofis, kassa, ombor…"
              value={form.purpose}
              onChange={(event) => set('purpose', event.target.value)}
            />
          </div>
        </Section>

        {/* ── Shartnoma ── */}
        <Section title="Shartnoma">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Shartnoma raqami"
              required
              value={form.number}
              onChange={(event) => set('number', event.target.value)}
              error={errors.number}
            />
            <Input
              label="Shartnoma sanasi"
              type="date"
              value={form.contractDate}
              onChange={(event) => set('contractDate', event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Qaysi oydan"
              required
              type="month"
              value={form.startPeriod}
              onChange={(event) => set('startPeriod', event.target.value)}
              error={errors.startPeriod}
              hint="Xarajat shu oydan yoziladi"
            />
            {!isEditing ? (
              <Input
                label="Oylik summa"
                required
                money
                suffix="so'm"
                inputMode="decimal"
                placeholder="0"
                value={form.monthlySom}
                onChange={(event) => set('monthlySom', event.target.value)}
                error={errors.monthlySom}
                hint={monthlyPreview ? formatTiyin(monthlyPreview, { currency: true }) : undefined}
              />
            ) : (
              <div />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="To'lov davriyligi"
              options={(Object.keys(FREQUENCY_LABELS) as LeaseFrequency[]).map((value) => ({
                value,
                label: FREQUENCY_LABELS[value],
              }))}
              value={form.paymentFrequency}
              onChange={(event) => set('paymentFrequency', event.target.value as LeaseFrequency)}
              hint="Xarajat baribir har oyga yoziladi"
            />
            <Input
              label="To'lov kuni"
              inputMode="numeric"
              placeholder="1–31"
              value={form.paymentDay}
              onChange={(event) => set('paymentDay', event.target.value.replace(/\D/g, ''))}
              error={errors.paymentDay}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-brand-800"
              checked={form.vatIncluded}
              onChange={(event) => set('vatIncluded', event.target.checked)}
            />
            Summa QQS bilan (12%)
          </label>

          {!isEditing && (
            <div>
              <p className="mb-1.5 text-sm font-medium">Shartnoma fayli</p>
              <input
                ref={fileRef}
                type="file"
                accept={DOCUMENT_ACCEPT}
                className="hidden"
                onChange={(event) => setContractFile(event.target.files?.[0] ?? null)}
              />
              {contractFile ? (
                <div className="flex items-center justify-between gap-2 rounded-(--radius-control) border border-(--color-line) px-3 py-2 text-sm">
                  <span className="truncate">{contractFile.name}</span>
                  <button
                    type="button"
                    className="text-(--color-text-muted) hover:text-(--color-expense)"
                    onClick={() => {
                      setContractFile(null);
                      if (fileRef.current) fileRef.current.value = '';
                    }}
                    aria-label="Olib tashlash"
                  >
                    <IconClose className="size-4" />
                  </button>
                </div>
              ) : (
                <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                  <IconUpload className="size-4" />
                  Fayl tanlash (PDF, rasm, Word)
                </Button>
              )}
              <p className="mt-1 text-xs text-(--color-text-muted)">
                Ixtiyoriy — keyin ham shartnoma kartasidan yuklash mumkin
              </p>
            </div>
          )}
        </Section>

        {/* ── Ijaraga beruvchi ── */}
        <Section title="Ijaraga beruvchi">
          <Input
            label="Nomi"
            required
            placeholder="Tashkilot yoki jismoniy shaxs"
            value={form.lessorName}
            onChange={(event) => set('lessorName', event.target.value)}
            error={errors.lessorName}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="STIR / JShShIR"
              inputMode="numeric"
              value={form.lessorTin}
              onChange={(event) => set('lessorTin', event.target.value.replace(/\D/g, ''))}
              error={errors.lessorTin}
            />
            <Input
              label="Telefon"
              value={form.lessorPhone}
              onChange={(event) => set('lessorPhone', event.target.value)}
            />
          </div>
          <Input
            label="Bank rekvizitlari"
            placeholder="H/r, bank, MFO"
            value={form.lessorBank}
            onChange={(event) => set('lessorBank', event.target.value)}
          />
          <div>
            <label className="mb-1.5 block text-sm font-medium">Izoh</label>
            <textarea
              rows={3}
              value={form.note}
              onChange={(event) => set('note', event.target.value)}
              className="w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 py-2 text-sm focus:border-brand-600"
            />
          </div>
        </Section>
      </form>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">{title}</p>
      {children}
    </section>
  );
}
