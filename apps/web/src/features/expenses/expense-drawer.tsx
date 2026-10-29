'use client';

import { errorMessage } from '@/lib/error-message';
import { DiscussMenu } from '@/features/reactions/discuss';
import { categoryMark, counterpartyMark, recordMark } from '@/features/reactions/marks';
import { useAuth } from '@/lib/auth-context';
import {
    formatDateTime,
    formatTiyin,
    sumToTiyin,
    tiyinToSum,
    todayInput,
} from '@/lib/format';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { expensesApi, type UpdateExpensePayload } from './api';
import { PlacePicker, placeError, placeOf, placePayload, type PlaceValue } from '@/components/shared/place-picker';

import { CategoryPicker } from '@/components/shared/category-picker';
import { MoneyInput } from '@/components/shared/money-input';
import { BehaviorBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { IconTrash } from '@/components/ui/icons';
import { ExpensePayrollDetail } from '@/features/payroll/expense-payroll-detail';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

import type {
    Category,
    Department,
    Expense,
    PaymentMethod,
    PaymentStatus,
} from '@/lib/types';

const paymentMethods: { value: PaymentMethod; label: string }[] = [
  { value: 'BANK', label: 'Bank o\u2018tkazmasi' },
  { value: 'CASH', label: 'Naqd pul' },
  { value: 'CARD', label: 'Plastik karta' },
  { value: 'OTHER', label: 'Boshqa' },
];

const paymentStatuses: { value: PaymentStatus; label: string }[] = [
  { value: 'PAID', label: 'To\u2018langan' },
  { value: 'UNPAID', label: 'To\u2018lanmagan' },
  { value: 'PARTIAL', label: 'Qisman to\u2018langan' },
];

interface ExpenseDrawerProps {
  expense: Expense | null;
  categories: Category[];
  departments: Department[];
  onClose: () => void;
  /** Saqlash yoki o'chirishdan keyin ro'yxatni yangilash uchun */
  onSaved: (message: string) => void;
  /** «+» bilan yangi modda qo'shilgach — moddalar ro'yxatini qayta yuklash */
  onCategoryCreated?: () => void;
}

interface FormState {
  date: string;
  categoryCode: string;
  amount: number | null;
  /** Qayerga tegishli: Markaz (bo'lim) yoki Hudud (tuman) */
  place: PlaceValue;
  paymentMethod: PaymentMethod;
  counterparty: string;
  documentNo: string;
  paymentStatus: PaymentStatus;
  dueDate: string;
  responsible: string;
  vat: number | null;
  description: string;
}

/** Sanani input[type=date] formatiga keltiradi */
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const shifted = new Date(new Date(iso).getTime() + 5 * 3600_000);
  return shifted.toISOString().slice(0, 10);
}

function fromExpense(expense: Expense): FormState {
  return {
    date: toDateInput(expense.date) || todayInput(),
    categoryCode: expense.categoryCode,
    amount: tiyinToSum(expense.amountTiyin).toNumber(),
    place: placeOf(expense),
    paymentMethod: expense.paymentMethod,
    counterparty: expense.counterparty ?? '',
    documentNo: expense.documentNo ?? '',
    paymentStatus: expense.paymentStatus ?? 'PAID',
    dueDate: toDateInput(expense.dueDate ?? null),
    responsible: expense.responsible ?? '',
    vat: expense.vatTiyin ? tiyinToSum(expense.vatTiyin).toNumber() : null,
    description: expense.description ?? '',
  };
}

export function ExpenseDrawer({
  expense,
  categories,
  departments,
  onClose,
  onSaved,
  onCategoryCreated,
}: ExpenseDrawerProps) {
  const { isAdmin } = useAuth();

  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Yozuv o'zgarganda formani qayta to'ldiramiz
  useEffect(() => {
    setForm(expense ? fromExpense(expense) : null);
    setErrors({});
    setServerError(null);
  }, [expense]);

  if (!expense || !form) return null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((state) => (state ? { ...state, [key]: value } : state));
    setErrors((state) => {
      if (!state[key]) return state;
      const next = { ...state };
      delete next[key];
      return next;
    });
  }

  function validate(state: FormState): boolean {
    const found: Record<string, string> = {};

    if (!state.date) found.date = 'Sanani tanlang';
    if (!state.categoryCode) found.categoryCode = 'Kategoriyani tanlang';
    if (state.amount === null || state.amount <= 0) found.amount = 'Summani kiriting';
    // Eski (hech qayerga biriktirilmagan) yozuvda tanlov majburiy emas — tanlansa tekshiriladi
    if (state.place.kind) {
      const where = placeError(state.place);
      if (where) found.place = where;
    }

    if (state.vat !== null && state.amount !== null && state.vat > state.amount) {
      found.vat = 'QQS umumiy summadan katta bo\u2018lishi mumkin emas';
    }

    if (state.dueDate && state.dueDate < state.date) {
      found.dueDate = 'To\u2018lov muddati xarajat sanasidan oldin bo\u2018la olmaydi';
    }

    setErrors(found);
    return Object.keys(found).length === 0;
  }

  async function handleSave() {
    if (!form || !expense) return;
    if (!validate(form)) return;

    setSaving(true);
    setServerError(null);

    const place = placePayload(form.place);
    const payload: UpdateExpensePayload = {
      date: form.date,
      amountTiyin: sumToTiyin(form.amount ?? 0),
      categoryCode: form.categoryCode,
      ...(place ?? {}),
      description: form.description.trim(),
      paymentMethod: form.paymentMethod,
      documentNo: form.documentNo.trim(),
      counterparty: form.counterparty.trim(),
      paymentStatus: form.paymentStatus,
      responsible: form.responsible.trim(),
      ...(form.dueDate ? { dueDate: form.dueDate } : {}),
      ...(form.vat !== null ? { vatTiyin: sumToTiyin(form.vat) } : {}),
    };

    try {
      await expensesApi.update(expense.id, payload);
      onSaved('O\u2018zgarishlar saqlandi');
      onClose();
    } catch (err) {
      setServerError(errorMessage(err, 'Saqlashda xatolik'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!expense) return;

    setDeleting(true);

    try {
      await expensesApi.remove(expense.id);
      onSaved('Yozuv o\u2018chirildi');
      setConfirmOpen(false);
      onClose();
    } catch (err) {
      setServerError(errorMessage(err, 'O\u2018chirishda xatolik'));
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  /** Ombor kirimidan yozilgan — o'zgartirish va o'chirish faqat Ombor › Hujjatlar orqali */
  const fromWarehouse = expense.source === 'WAREHOUSE';
  /** Asosiy vositalar sarfi — reestrdan avtomatik hisoblanadi */
  const fromAssets = (expense.source as string) === 'ASSET';
  /** Soliqlar — Xarajatlar › Soliqlar sahifasida yuritiladi */
  const fromTaxes = (expense.source as string) === 'TAX';
  const readOnly = !isAdmin || fromWarehouse || fromAssets || fromTaxes;
  /** Ish haqi xarajati - tahrirlanmaydi, faqat tafsilot korsatiladi */
  const isPayroll = expense.source === 'PAYROLL';

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={isPayroll ? 'Ish haqi tafsiloti' : readOnly ? 'Xarajat yozuvi' : 'Xarajatni tahrirlash'}
        description={
          expense.createdBy
            ? `${expense.createdBy.fullName} \u00B7 ${formatDateTime(expense.createdAt)}`
            : formatDateTime(expense.createdAt)
        }
        footer={
          isPayroll || readOnly ? (
            <>
              <DiscussMenu
                label="Muhokama"
                direction="up"
                className="mr-auto"
                items={[
                  recordMark('EXPENSE', expense, 'Xarajatlar › yozuv'),
                  categoryMark('EXPENSE', expense.categoryCode, expense.category.label, 'Xarajatlar'),
                  counterpartyMark(expense.counterparty, 'Xarajatlar'),
                ]}
              />
              <Button variant="secondary" onClick={onClose}>
                Yopish
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => setConfirmOpen(true)}
                disabled={saving}
                className="mr-auto text-(--color-expense) hover:bg-(--color-expense-soft)"
              >
                <IconTrash className="size-4" />
                O&apos;chirish
              </Button>

              {expense && (
                <DiscussMenu
                  label="Muhokama"
                  direction="up"
                  items={[
                    recordMark('EXPENSE', expense, 'Xarajatlar › yozuv'),
                    categoryMark('EXPENSE', expense.categoryCode, expense.category.label, 'Xarajatlar'),
                    counterpartyMark(expense.counterparty, 'Xarajatlar'),
                  ]}
                />
              )}

              <Button variant="secondary" onClick={onClose} disabled={saving}>
                Bekor qilish
              </Button>

              <Button onClick={() => void handleSave()} loading={saving}>
                Saqlash
              </Button>
            </>
          )
        }
      >
        <div className="space-y-4">
          {serverError && (
            <div className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2.5 text-sm text-(--color-expense)">
              {serverError}
            </div>
          )}

          {/* Joriy holat - tez ko'rish uchun */}
          <div className="rounded-(--radius-control) bg-(--color-surface-sunken) px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">
                Joriy summa
              </span>
              <span className="money text-lg font-semibold text-(--color-expense)">
                {formatTiyin(expense.amountTiyin, { currency: true })}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-(--color-text-muted)">
              <span>{expense.category.label}</span>
              {expense.category.behavior && (
                <BehaviorBadge behavior={expense.category.behavior} />
              )}
            </div>
          </div>

          {fromWarehouse && (
            <div className="rounded-(--radius-control) border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
              Bu xarajat <b>Ombor kirimidan</b> yozilgan{expense.documentNo ? ` (${expense.documentNo})` : ''}. O&apos;zgartirish yoki o&apos;chirish — Ombor › Hujjatlar orqali.{' '}
              <Link href="/dashbord/ombor" className="font-semibold text-brand-700 hover:underline">
                Ombor hujjatlari →
              </Link>
            </div>
          )}

          {fromAssets && (
            <div className="rounded-(--radius-control) border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
              Bu <b>asosiy vositalar sarfi (eskirish)</b> — balansdagi vositalardan har oy avtomatik hisoblanadi. Muddat yoki hisobdan chiqarish — Asosiy vositalar sahifasida.{' '}
              <Link href="/xarajatlar/asosiy-vositalar" className="font-semibold text-brand-700 hover:underline">
                Asosiy vositalar →
              </Link>
            </div>
          )}

          {fromTaxes && (
            <div className="rounded-(--radius-control) border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
              Bu <b>soliq</b> yozuvi — Xarajatlar › Soliqlar sahifasida yuritiladi (ish haqidan foizli soliqlar avtomatik hisoblanadi).{' '}
              <Link href="/xarajatlar/soliqlar" className="font-semibold text-brand-700 hover:underline">
                Soliqlar →
              </Link>
            </div>
          )}

          {isPayroll ? (
            <ExpensePayrollDetail expenseId={expense.id} />
          ) : (
          <>
          <Input
            label="Sana"
            type="date"
            value={form.date}
            onChange={(event) => update('date', event.target.value)}
            error={errors.date}
            required
            disabled={saving || readOnly}
          />

          <CategoryPicker
            label="Kategoriya"
            categories={categories}
            value={form.categoryCode}
            onChange={(code) => update('categoryCode', code)}
            error={errors.categoryCode}
            required
            disabled={saving || readOnly}
            onCreated={() => onCategoryCreated?.()}
          />

          <MoneyInput
            label="Summa"
            value={form.amount}
            onChange={(value) => update('amount', value)}
            error={errors.amount}
            required
            disabled={saving || readOnly}
          />

          <PlacePicker
            value={form.place}
            onChange={(place) => update('place', place)}
            departments={departments}
            error={errors.place}
            disabled={saving || readOnly || fromWarehouse}
            compact
          />
          {!form.place.kind && (
            <p className="-mt-2 text-xs text-(--color-warn)">
              Bu yozuv hech qayerga biriktirilmagan — Solishtirmada «Hududga biriktirilmagan»da turibdi. Markaz, Hudud yoki yo‘nalishni tanlab saqlang.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="To&apos;lov usuli"
              options={paymentMethods}
              value={form.paymentMethod}
              onChange={(event) =>
                update('paymentMethod', event.target.value as PaymentMethod)
              }
              disabled={saving || readOnly}
            />

            <Select
              label="To&apos;lov holati"
              options={paymentStatuses}
              value={form.paymentStatus}
              onChange={(event) =>
                update('paymentStatus', event.target.value as PaymentStatus)
              }
              disabled={saving || readOnly}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Kimga to&apos;langan (kontragent)"
              value={form.counterparty}
              onChange={(event) => update('counterparty', event.target.value)}
              disabled={saving || readOnly}
            />

            <Input
              label="Hujjat raqami"
              value={form.documentNo}
              onChange={(event) => update('documentNo', event.target.value)}
              disabled={saving || readOnly}
            />
          </div>

          {/* Bank ko'chirmasidan yo'naltirilgan bo'lsa — bankdagi kontragent ma'lumoti (faqat ko'rish) */}
          {expense && (expense.counterpartyInn || expense.bankPurpose) && (
            <div className="rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted)/50 px-3 py-2 text-xs">
              <p className="font-semibold text-heading">Bank ko&apos;chirmasidan</p>
              <p className="mt-1 text-(--color-text-muted)">
                {expense.counterpartyInn && (
                  <>
                    ИНН <b className="money text-heading">{expense.counterpartyInn}</b>
                  </>
                )}
                {expense.counterpartyMfo && (
                  <>
                    {' '}· МФО <b className="money text-heading">{expense.counterpartyMfo}</b>
                  </>
                )}
              </p>
              {expense.bankPurpose && <p className="mt-1 whitespace-pre-wrap text-(--color-text)">To&apos;lov maqsadi: {expense.bankPurpose}</p>}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="To&apos;lov muddati"
              type="date"
              value={form.dueDate}
              onChange={(event) => update('dueDate', event.target.value)}
              error={errors.dueDate}
              disabled={saving || readOnly}
            />

            <Input
              label="Javobgar"
              value={form.responsible}
              onChange={(event) => update('responsible', event.target.value)}
              disabled={saving || readOnly}
            />
          </div>

          <MoneyInput
            label="QQS summasi"
            value={form.vat}
            onChange={(value) => update('vat', value)}
            error={errors.vat}
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
          </>
          )}
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmOpen}
        title="Yozuvni o&apos;chirish"
        message={`${formatTiyin(expense.amountTiyin, { currency: true })} - ${expense.category.label}. Bu yozuv ro\u2018yxatdan olib tashlanadi.`}
        confirmLabel="O&apos;chirish"
        danger
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}