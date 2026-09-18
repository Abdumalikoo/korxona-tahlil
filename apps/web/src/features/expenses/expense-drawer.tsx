'use client';

import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/error-message';
import { useAuth } from '@/lib/auth-context';
import {
    formatDateTime,
    formatTiyin,
    sumToTiyin,
    tiyinToSum,
    todayInput,
} from '@/lib/format';
import { useEffect, useState } from 'react';
import { expensesApi, type UpdateExpensePayload } from './api';

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
}

interface FormState {
  date: string;
  categoryCode: string;
  amount: number | null;
  departmentId: string;
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
    departmentId: expense.departmentId ?? '',
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

    const payload: UpdateExpensePayload = {
      date: form.date,
      amountTiyin: sumToTiyin(form.amount ?? 0),
      categoryCode: form.categoryCode,
      departmentId: form.departmentId || undefined,
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

  const departmentOptions = [
    { value: '', label: 'Umumkorxona' },
    ...departments.map((item) => ({ value: item.id, label: item.name })),
  ];

  const readOnly = !isAdmin;
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
            <Button variant="secondary" onClick={onClose}>
              Yopish
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => setConfirmOpen(true)}
                disabled={saving}
                className="mr-auto text-[--color-expense] hover:bg-[--color-expense-soft]"
              >
                <IconTrash className="size-4" />
                O&apos;chirish
              </Button>

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
            <div className="rounded-[--radius-control] bg-[--color-expense-soft] px-3 py-2.5 text-sm text-[--color-expense]">
              {serverError}
            </div>
          )}

          {/* Joriy holat - tez ko'rish uchun */}
          <div className="rounded-[--radius-control] bg-[--color-surface-sunken] px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
                Joriy summa
              </span>
              <span className="money text-lg font-semibold text-[--color-expense]">
                {formatTiyin(expense.amountTiyin, { currency: true })}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 text-xs text-[--color-text-muted]">
              <span>{expense.category.label}</span>
              {expense.category.behavior && (
                <BehaviorBadge behavior={expense.category.behavior} />
              )}
            </div>
          </div>

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
          />

          <MoneyInput
            label="Summa"
            value={form.amount}
            onChange={(value) => update('amount', value)}
            error={errors.amount}
            required
            disabled={saving || readOnly}
          />

          <Select
            label="Bo&apos;lim"
            options={departmentOptions}
            value={form.departmentId}
            onChange={(event) => update('departmentId', event.target.value)}
            disabled={saving || readOnly}
          />

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
              label="Kontragent"
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
            <label className="mb-1.5 block text-sm font-medium text-[--color-text]">
              Tavsif
            </label>
            <textarea
              value={form.description}
              onChange={(event) => update('description', event.target.value)}
              rows={3}
              maxLength={500}
              disabled={saving || readOnly}
              className="w-full rounded-[--radius-control] border border-[--color-line-strong] bg-white px-3 py-2 text-sm focus:border-brand-600 disabled:bg-[--color-surface-sunken]"
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
