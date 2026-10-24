'use client';

import { DiscussMenu } from '@/features/reactions/discuss';
import { categoryMark, clientMark, recordMark } from '@/features/reactions/marks';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { recallForm, rememberForm } from '@/lib/form-memory';
import {
  formatDateTime,
  formatTiyin,
  sumToTiyin,
  tiyinToSum,
  todayInput,
} from '@/lib/format';
import { useEffect, useRef, useState } from 'react';
import { incomesApi } from './api';
import { EMPTY_PLACE, PlacePicker, placeCreatePayload, placeError, placeForUnit, placeOf, placePayload, restorePlace, type PlaceValue } from '@/components/shared/place-picker';
import { unitCategoriesApi, useUnitCategories } from '@/features/units/api';
import { entryUnitOf, unitByCode, unitOnly } from '@/lib/segments';
import Link from 'next/link';

import { MoneyInput } from '@/components/shared/money-input';
import { QuickServiceDialog } from '@/components/shared/quick-service-dialog';
import { PaymentBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { IconChevronDown, IconPlus, IconTrash } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

import type {
  Department,
  Income,
  IncomeCategory,
  PaymentMethod,
  PaymentStatus,
} from '@/lib/types';

const paymentMethods: { value: PaymentMethod; label: string }[] = [
  { value: 'BANK', label: "Bank o'tkazmasi" },
  { value: 'CASH', label: 'Naqd pul' },
  { value: 'CARD', label: 'Plastik karta' },
  { value: 'OTHER', label: 'Boshqa' },
];

const paymentStatuses: { value: PaymentStatus; label: string }[] = [
  { value: 'PAID', label: "To'langan" },
  { value: 'PARTIAL', label: 'Qisman to\u2019langan' },
  { value: 'UNPAID', label: "To'lanmagan" },
];

interface IncomeDrawerProps {
  income: Income | null;
  creating: boolean;
  /** Qaysi bo'limdan ochildi (Doimiy / Boshqa) — yangi yozuv shu bo'limga tushadi */
  section?: 'DOIMIY' | 'BOSHQA';
  /** Kiritish bo'limi sahifasidan (CENTER, REGION, TAX_FREE …): yangi yozuv joyi shu bo'limga qulflanadi */
  unit?: string | null;
  categories: IncomeCategory[];
  departments: Department[];
  onClose: () => void;
  onSaved: (message: string) => void;
  /** Yangi xizmat turi qo'shilganda ro'yxatni yangilash */
  onCategoriesChanged?: () => void;
}

interface FormState {
  date: string;
  categoryCode: string;
  amount: number | null;
  paid: number | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  /** Qayerga tegishli: Markaz (bo'lim), Hudud (tuman) yoki yo'nalish */
  place: PlaceValue;
  clientName: string;
  contractNo: string;
  description: string;
}

function emptyForm(): FormState {
  return {
    date: todayInput(),
    categoryCode: '',
    amount: null,
    paid: null,
    paymentStatus: 'PAID',
    paymentMethod: 'BANK',
    place: EMPTY_PLACE,
    clientName: '',
    contractNo: '',
    description: '',
  };
}

/** Yangi daromadda oldingi safardagi tanlovlar qoladi */
const MEMORY = 'income';
type Remembered = Pick<FormState, 'categoryCode' | 'paymentMethod' | 'place'> & { departmentId?: string };

/** Joyning kiritish bo'limi (Markaz, Hududlar, yo'nalish) */
function unitOfPlace(p: PlaceValue): string | null {
  return entryUnitOf({ segment: p.segment || null, regionCode: p.kind === 'CENTER' ? 0 : p.kind === 'REGION' ? 1 : null, departmentId: null });
}

function newForm(unit?: string | null): FormState {
  const last = recallForm<Remembered>(MEMORY);
  const remembered = restorePlace(last.place);
  // Bo'lim sahifasidan: eslab qolingan joy shu bo'limniki bo'lsa — o'sha, aks holda bo'limning o'zi
  if (unit) {
    return {
      ...emptyForm(),
      place: remembered && unitOfPlace(remembered) === unit ? remembered : (placeForUnit(unit) ?? EMPTY_PLACE),
      ...(last.paymentMethod ? { paymentMethod: last.paymentMethod } : {}),
    };
  }
  return {
    ...emptyForm(),
    ...(typeof last.categoryCode === 'string' ? { categoryCode: last.categoryCode } : {}),
    ...(restorePlace(last.place)
      ? { place: restorePlace(last.place)! }
      : typeof last.departmentId === 'string' && last.departmentId
        ? { place: { ...EMPTY_PLACE, kind: 'CENTER' as const, departmentId: last.departmentId } }
        : {}),
    ...(last.paymentMethod ? { paymentMethod: last.paymentMethod } : {}),
  };
}

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const shifted = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return shifted.toISOString().slice(0, 10);
}

export function IncomeDrawer({
  income,
  creating,
  section,
  unit = null,
  categories,
  departments,
  onClose,
  onSaved,
  onCategoriesChanged,
}: IncomeDrawerProps) {
  const { isAdmin } = useAuth();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [extraOpen, setExtraOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const unitLists = useUnitCategories('income');
  /** «Saqlash va yana» bilan shu oynada kiritilganlar */
  const [added, setAdded] = useState<{ count: number; last: string } | null>(null);
  const amountBox = useRef<HTMLDivElement>(null);

  const isOpen = income !== null || creating;
  const isEditing = income !== null;

  useEffect(() => {
    if (income) {
      setForm({
        date: toDateInput(income.date) || todayInput(),
        categoryCode: income.categoryCode,
        amount: tiyinToSum(income.amountTiyin).toNumber(),
        paid: tiyinToSum(income.paidTiyin).toNumber(),
        paymentStatus: income.paymentStatus,
        paymentMethod: income.paymentMethod,
        place: placeOf(income),
        clientName: income.clientName ?? '',
        contractNo: income.contractNo ?? '',
        description: income.description ?? '',
      });

      // Tahrirlashda qo'shimcha maydonlar to'ldirilgan bo'lsa — ochiq
      setExtraOpen(
        Boolean(
          income.clientName ||
            income.contractNo ||
            income.description ||
            income.paymentStatus !== 'PAID',
        ),
      );
    } else {
      setForm(newForm(unit));
      setExtraOpen(false);
    }

    setAdded(null);
    setErrors({});
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [income, creating]);

  if (!isOpen) return null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((state) => {
      const next = { ...state, [key]: value };

      if (key === 'paymentStatus') {
        if (value === 'PAID') next.paid = next.amount;
        else if (value === 'UNPAID') next.paid = 0;
      }

      if (key === 'amount' && next.paymentStatus === 'PAID') {
        next.paid = value as number | null;
      }

      return next;
    });

    setErrors((state) => {
      if (!state[key]) return state;
      const next = { ...state };
      delete next[key];
      return next;
    });
  }

  function validate(): boolean {
    const found: Record<string, string> = {};

    if (!form.date) found.date = 'Sanani tanlang';
    if (!form.categoryCode) found.categoryCode = 'Xizmat turini tanlang';
    if (form.amount === null || form.amount <= 0) found.amount = 'Summani kiriting';
    // Yangi daromadda — majburiy; eski (biriktirilmagan) yozuvda tanlansa tekshiriladi
    if (!isEditing || form.place.kind) {
      const where = placeError(form.place);
      if (where) found.place = where;
    }

    if (form.paymentStatus === 'PARTIAL') {
      if (form.paid === null || form.paid <= 0) {
        found.paid = 'Tushgan summani kiriting';
      } else if (form.amount !== null && form.paid >= form.amount) {
        found.paid = 'Qisman to\u2019lov shartnoma summasidan kam bo\u2019lsin';
      }
    }

    setErrors(found);
    return Object.keys(found).length === 0;
  }

  async function handleSave(next = false) {
    if (!validate()) return;

    setSaving(true);
    setServerError(null);

    const payload = {
      date: form.date,
      amountTiyin: sumToTiyin(form.amount ?? 0),
      paidTiyin: sumToTiyin(form.paid ?? 0),
      categoryCode: form.categoryCode,
      ...(income ? (placePayload(form.place) ?? {}) : placeCreatePayload(form.place)),
      ...(!income && section ? { section } : {}),
      clientName: form.clientName.trim() || undefined,
      contractNo: form.contractNo.trim() || undefined,
      description: form.description.trim() || undefined,
      paymentStatus: form.paymentStatus,
      paymentMethod: form.paymentMethod,
    };

    try {
      if (income) {
        await incomesApi.update(income.id, payload);
        onSaved("O'zgarishlar saqlandi");
      } else {
        await incomesApi.create(payload);
        rememberForm<Remembered>(MEMORY, { categoryCode: form.categoryCode, place: form.place, paymentMethod: form.paymentMethod });
        onSaved("Daromad qo'shildi");
        if (next) {
          // Ketma-ket kiritish: sana, xizmat turi, bo'lim va to'lov usuli qoladi
          setAdded((a) => ({ count: (a?.count ?? 0) + 1, last: formatTiyin(payload.amountTiyin) }));
          setForm((state) => ({ ...emptyForm(), date: state.date, categoryCode: state.categoryCode, place: state.place, paymentMethod: state.paymentMethod }));
          setTimeout(() => amountBox.current?.querySelector('input')?.focus(), 30);
          return;
        }
      }
      onClose();
    } catch (err) {
      setServerError(errorMessage(err, 'Saqlashda xatolik'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!income) return;

    setDeleting(true);

    try {
      await incomesApi.remove(income.id);
      onSaved("Yozuv o'chirildi");
      setConfirmOpen(false);
      onClose();
    } catch (err) {
      setServerError(errorMessage(err, "O'chirishda xatolik"));
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  // Bo'lim xizmat turlari: tanlangan bo'lim ro'yxati (bo'lmasa — umumiy, hammasi); joriy tanlov doim ro'yxatda
  const currentUnit = unit ?? unitOfPlace(form.place);
  // Har bo'lim alohida: faqat shu bo'lim xizmat turlari; tahrirlashda joriy tanlov ham ro'yxatda turadi
  const unitList = currentUnit && unitLists.lists.get(currentUnit)?.length ? unitLists.lists.get(currentUnit) : undefined;
  const unitCategories = unitOnly(categories, unitList);
  const unitInfo = unitByCode(currentUnit);
  const shown = unitCategories.some((c) => c.code === form.categoryCode) ? unitCategories : [...unitCategories, ...categories.filter((c) => c.code === form.categoryCode)];
  const categoryOptions = [
    { value: '', label: 'Tanlang' },
    ...shown.map((item) => ({ value: item.code, label: item.label })),
  ];

  const readOnly = !isAdmin;
  const isPartial = form.paymentStatus === 'PARTIAL';

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={isEditing ? 'Daromadni tahrirlash' : 'Yangi daromad'}
        description={
          income
            ? `${income.createdBy?.fullName ?? ''} \u00B7 ${formatDateTime(income.createdAt)}`
            : undefined
        }
        footer={
          readOnly ? (
            <Button variant="secondary" onClick={onClose}>
              Yopish
            </Button>
          ) : (
            <>
              {isEditing && (
                <Button
                  variant="ghost"
                  onClick={() => setConfirmOpen(true)}
                  disabled={saving}
                  className="mr-auto text-(--color-expense) hover:bg-(--color-expense-soft)"
                >
                  <IconTrash className="size-4" />
                  O&apos;chirish
                </Button>
              )}

              {income && (
                <DiscussMenu
                  label="Muhokama"
                  direction="up"
                  items={[
                    recordMark('INCOME', income, 'Daromadlar › yozuv'),
                    categoryMark('INCOME', income.categoryCode, income.category.label, 'Daromadlar'),
                    clientMark(income.clientName, 'Daromadlar'),
                  ]}
                />
              )}

              <Button variant="secondary" onClick={onClose} disabled={saving}>
                Bekor qilish
              </Button>

              {!isEditing && (
                <Button variant="secondary" data-save-next onClick={() => void handleSave(true)} disabled={saving} title="Ctrl+Enter">
                  Saqlash va yana
                </Button>
              )}

              <Button data-save onClick={() => void handleSave()} loading={saving} title="Ctrl+S">
                Saqlash
              </Button>
            </>
          )
        }
      >
        <div className="space-y-4">
          {added && (
            <div className="rounded-(--radius-control) bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              ✓ Saqlandi: {added.last} so&apos;m · bu oynada {added.count} ta. Keyingisini yozing.
            </div>
          )}
          {serverError && (
            <div className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2.5 text-sm text-(--color-expense)">
              {serverError}
            </div>
          )}

          {income && (
            <div className="rounded-(--radius-control) bg-(--color-surface-sunken) px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">
                  Summa
                </span>
                <span className="money text-lg font-semibold text-(--color-income)">
                  {formatTiyin(income.amountTiyin, { currency: true })}
                </span>
              </div>

              <div className="mt-1 flex items-center gap-2 text-xs text-(--color-text-muted)">
                <span>{income.category.label}</span>
                <PaymentBadge status={income.paymentStatus} />
              </div>
            </div>
          )}

          {/* ─────── Qayerga tegishli ─────── */}

          <PlacePicker
            value={form.place}
            onChange={(place) => update('place', place)}
            departments={departments}
            error={errors.place}
            disabled={saving || readOnly}
            compact
            noun="daromad"
            lockUnit={!income ? unit : null}
          />
          {unitInfo && unitList && (
            unitCategories.length ? (
              <p className="-mt-2 text-xs text-(--color-text-muted)">
                Xizmat turlari — faqat «{unitInfo.label}» bo&apos;limi ro&apos;yxatidan ({unitCategories.length} ta).
              </p>
            ) : (
              <p className="-mt-2 rounded-(--radius-control) border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                «{unitInfo.label}» bo&apos;limida hali daromad turi yo&apos;q — har bo&apos;limning xizmat turlari alohida.{' '}
                <Link href={`/daromadlar/bolim/${unitInfo.slug}?section=MODDALAR`} className="font-semibold text-brand-700 hover:underline">
                  Xizmat turlarini qo&apos;shish →
                </Link>
              </p>
            )
          )}
          {isEditing && !form.place.kind && (
            <p className="-mt-2 text-xs text-(--color-warn)">
              Bu yozuv hech qayerga biriktirilmagan — Solishtirmada «Hududga biriktirilmagan»da turibdi. Markaz, Hudud yoki yo‘nalishni tanlab saqlang.
            </p>
          )}

          {/* ─────── Asosiy maydonlar ─────── */}

          <Input
            label="Sana"
            type="date"
            value={form.date}
            onChange={(event) => update('date', event.target.value)}
            error={errors.date}
            required
            disabled={saving || readOnly}
          />

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-sm font-medium text-(--color-text)">
                Xizmat turi <span className="text-(--color-expense)">*</span>
              </label>

              {!readOnly && (
                <button
                  type="button"
                  onClick={() => setQuickOpen(true)}
                  className="flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
                >
                  <IconPlus className="size-3.5" />
                  Yangi qo&rsquo;shish
                </button>
              )}
            </div>

            <Select
              options={categoryOptions}
              value={form.categoryCode}
              onChange={(event) => update('categoryCode', event.target.value)}
              error={errors.categoryCode}
              disabled={saving || readOnly}
            />
          </div>

          <div ref={amountBox}>
            <MoneyInput
              label="Summa"
              value={form.amount}
              onChange={(value) => update('amount', value)}
              error={errors.amount}
              required
              disabled={saving || readOnly}
            />
          </div>

          {/* ─────── Qo'shimcha ─────── */}

          <div className="rounded-(--radius-control) border border-(--color-line)">
            <button
              type="button"
              onClick={() => setExtraOpen((state) => !state)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium transition-colors hover:bg-(--color-surface-muted)"
            >
              <IconChevronDown
                className={cn(
                  'size-4 text-(--color-text-muted) transition-transform',
                  !extraOpen && '-rotate-90',
                )}
              />
              Qo&rsquo;shimcha ma&rsquo;lumot
            </button>

            {extraOpen && (
              <div className="space-y-4 border-t border-(--color-line) px-3 py-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Select
                    label="To&apos;lov holati"
                    options={paymentStatuses}
                    value={form.paymentStatus}
                    onChange={(event) =>
                      update('paymentStatus', event.target.value as PaymentStatus)
                    }
                    disabled={saving || readOnly}
                  />

                  {isPartial && (
                    <MoneyInput
                      label="Tushgan summa"
                      value={form.paid}
                      onChange={(value) => update('paid', value)}
                      error={errors.paid}
                      required
                      disabled={saving || readOnly}
                    />
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Mijoz"
                    value={form.clientName}
                    onChange={(event) => update('clientName', event.target.value)}
                    placeholder="Tashkilot yoki shaxs"
                    disabled={saving || readOnly}
                  />

                  <Input
                    label="Shartnoma raqami"
                    value={form.contractNo}
                    onChange={(event) => update('contractNo', event.target.value)}
                    disabled={saving || readOnly}
                  />
                </div>

                <Select
                  label="To&apos;lov usuli"
                  options={paymentMethods}
                  value={form.paymentMethod}
                  onChange={(event) =>
                    update('paymentMethod', event.target.value as PaymentMethod)
                  }
                  disabled={saving || readOnly}
                />

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-(--color-text)">
                    Tavsif
                  </label>
                  <textarea
                    value={form.description}
                    onChange={(event) => update('description', event.target.value)}
                    rows={3}
                    maxLength={500}
                    disabled={saving || readOnly}
                    className="w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 py-2 text-sm focus:border-brand-600 disabled:bg-(--color-surface-sunken)"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </Drawer>

      <QuickServiceDialog
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onCreated={(category) => {
          // Bo'lim tanlangan bo'lsa — yangi xizmat turi darhol shu bo'lim ro'yxatiga ham qo'shiladi
          const target = currentUnit;
          const after = () => {
            onCategoriesChanged?.();
            update('categoryCode', category.code);
          };
          if (target && unitList) {
            void unitCategoriesApi
              .set('income', target, [...(unitLists.lists.get(target) ?? []), category.code])
              .then(() => unitLists.reload())
              .catch((e) => setServerError(errorMessage(e, "Bo'lim ro'yxatiga qo'shib bo'lmadi")))
              .finally(after);
          } else after();
        }}
      />

      <ConfirmDialog
        open={confirmOpen}
        title="Yozuvni o&apos;chirish"
        message={`${income ? formatTiyin(income.amountTiyin, { currency: true }) : ''} \u2014 ${income?.category.label ?? ''}. Bu yozuv ro\u2019yxatdan olib tashlanadi.`}
        confirmLabel="O&apos;chirish"
        danger
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}