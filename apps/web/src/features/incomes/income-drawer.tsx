'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { incomesApi } from './api';
import { todayInput, sumToTiyin, tiyinToSum, formatDateTime, formatTiyin } from '@/lib/format';

import { Drawer } from '@/components/ui/drawer';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { MoneyInput } from '@/components/shared/money-input';
import { PaymentBadge } from '@/components/ui/badge';
import { IconTrash } from '@/components/ui/icons';

import type {
  Income,
  IncomeCategory,
  Department,
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
  categories: IncomeCategory[];
  departments: Department[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface FormState {
  date: string;
  categoryCode: string;
  amount: number | null;
  paid: number | null;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  departmentId: string;
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
    departmentId: '',
    clientName: '',
    contractNo: '',
    description: '',
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
  categories,
  departments,
  onClose,
  onSaved,
}: IncomeDrawerProps) {
  const { isAdmin } = useAuth();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

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
        departmentId: income.departmentId ?? '',
        clientName: income.clientName ?? '',
        contractNo: income.contractNo ?? '',
        description: income.description ?? '',
      });
    } else {
      setForm(emptyForm());
    }
    setErrors({});
    setServerError(null);
  }, [income, creating]);

  if (!isOpen) return null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((state) => {
      const next = { ...state, [key]: value };

      // To'lov holati o'zgarsa - to'langan summani moslashtiramiz
      if (key === 'paymentStatus') {
        if (value === 'PAID') next.paid = next.amount;
        else if (value === 'UNPAID') next.paid = 0;
      }

      // Summa o'zgarsa va to'liq to'langan bo'lsa - tushgan ham o'zgaradi
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

    if (form.paymentStatus === 'PARTIAL') {
      if (form.paid === null || form.paid <= 0) {
        found.paid = 'Tushgan summani kiriting';
      } else if (form.amount !== null && form.paid >= form.amount) {
        found.paid = 'Qisman to\u2019lov shartnoma summasidan kam bo\u2019lishi kerak';
      }
    }

    setErrors(found);
    return Object.keys(found).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;

    setSaving(true);
    setServerError(null);

    const payload = {
      date: form.date,
      amountTiyin: sumToTiyin(form.amount ?? 0),
      paidTiyin: sumToTiyin(form.paid ?? 0),
      categoryCode: form.categoryCode,
      departmentId: form.departmentId || undefined,
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
        onSaved("Daromad qo'shildi");
      }
      onClose();
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Saqlashda xatolik');
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
      setServerError(err instanceof ApiError ? err.message : "O'chirishda xatolik");
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  const categoryOptions = [
    { value: '', label: 'Tanlang' },
    ...categories.map((item) => ({ value: item.code, label: item.label })),
  ];

  const departmentOptions = [
    { value: '', label: 'Umumkorxona' },
    ...departments.map((item) => ({ value: item.id, label: item.name })),
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
            : 'Yulduzcha bilan belgilanganlar majburiy'
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
                  className="mr-auto text-[--color-expense] hover:bg-[--color-expense-soft]"
                >
                  <IconTrash className="size-4" />
                  O&apos;chirish
                </Button>
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
            <div className="rounded-[--radius-control] bg-[--color-expense-soft] px-3 py-2.5 text-sm text-[--color-expense]">
              {serverError}
            </div>
          )}

          {income && (
            <div className="rounded-[--radius-control] bg-[--color-surface-sunken] px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
                  Shartnoma summasi
                </span>
                <span className="money text-lg font-semibold text-[--color-income]">
                  {formatTiyin(income.amountTiyin, { currency: true })}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs text-[--color-text-muted]">
                <span>{income.category.label}</span>
                <PaymentBadge status={income.paymentStatus} />
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Sana"
              type="date"
              value={form.date}
              onChange={(event) => update('date', event.target.value)}
              error={errors.date}
              required
              disabled={saving || readOnly}
            />

            <Select
              label="Xizmat turi"
              options={categoryOptions}
              value={form.categoryCode}
              onChange={(event) => update('categoryCode', event.target.value)}
              error={errors.categoryCode}
              required
              disabled={saving || readOnly}
            />
          </div>

          <MoneyInput
            label="Shartnoma summasi"
            value={form.amount}
            onChange={(value) => update('amount', value)}
            error={errors.amount}
            required
            disabled={saving || readOnly}
          />

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
              placeholder="Tashkilot yoki shaxs nomi"
              disabled={saving || readOnly}
            />

            <Input
              label="Shartnoma raqami"
              value={form.contractNo}
              onChange={(event) => update('contractNo', event.target.value)}
              disabled={saving || readOnly}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Bo&apos;lim"
              options={departmentOptions}
              value={form.departmentId}
              onChange={(event) => update('departmentId', event.target.value)}
              disabled={saving || readOnly}
            />

            <Select
              label="To&apos;lov usuli"
              options={paymentMethods}
              value={form.paymentMethod}
              onChange={(event) =>
                update('paymentMethod', event.target.value as PaymentMethod)
              }
              disabled={saving || readOnly}
            />
          </div>

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
              placeholder="Qo&apos;shimcha izoh"
            />
          </div>
        </div>
      </Drawer>

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
