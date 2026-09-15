'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { expensesApi, type CreateExpensePayload } from '@/features/expenses/api';
import { referencesApi } from '@/features/shared/references';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { formatSum, sumToTiyin, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';

import { PageHeader } from '@/components/layout/page-header';
import { CategoryPicker } from '@/components/shared/category-picker';
import { MoneyInput } from '@/components/shared/money-input';
import { QuickCategoryDialog } from '@/components/shared/quick-category-dialog';
import { DuplicateWarning } from '@/features/expenses/duplicate-warning';
import type { Expense } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter } from '@/components/ui/card';
import { IconChevronDown } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Toast } from '@/components/ui/toast';
import type { PaymentMethod, PaymentStatus } from '@/lib/types';

/** Katta summa - tasdiqlash so'raladi, nol ortiqcha yozilmasligi uchun */
const LARGE_AMOUNT_THRESHOLD = 100_000_000;

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

function emptyForm(): FormState {
  return {
    date: todayInput(),
    categoryCode: '',
    amount: null,
    departmentId: '',
    paymentMethod: 'BANK',
    counterparty: '',
    documentNo: '',
    paymentStatus: 'PAID',
    dueDate: '',
    responsible: '',
    vat: null,
    description: '',
  };
}

export default function NewExpensePage() {
  const router = useRouter();
  const { isAdmin } = useAuth();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(
    null,
  );
  const [extraOpen, setExtraOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickLabel, setQuickLabel] = useState('');
  const [duplicates, setDuplicates] = useState<Expense[]>([]);

  const departments = useAsync(() => referencesApi.departments(), []);
  const categories = useAsync(() => referencesApi.expenseLeaves(), []);
  const tree = useAsync(() => referencesApi.expenseTree(), []);

  // Kuzatuvchi bu sahifaga kira olmaydi
  useEffect(() => {
    if (!isAdmin) router.replace('/xarajatlar');
  }, [isAdmin, router]);

  /**
   * Sana, summa va kategoriya toldirilganda oxshash yozuvni qidiradi.
   * 600 ms kutamiz - foydalanuvchi yozib bolishini kutish uchun.
   */
  useEffect(() => {
    if (!form.date || !form.categoryCode || !form.amount) {
      setDuplicates([]);
      return;
    }

    const timer = setTimeout(() => {
      expensesApi
        .similar({
          date: form.date,
          amountTiyin: sumToTiyin(form.amount ?? 0),
          categoryCode: form.categoryCode,
        })
        .then((response) => setDuplicates(response.data.items))
        .catch(() => setDuplicates([]));
    }, 600);

    return () => clearTimeout(timer);
  }, [form.date, form.categoryCode, form.amount]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((state) => ({ ...state, [key]: value }));
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
    if (!form.categoryCode) found.categoryCode = 'Kategoriyani tanlang';
    if (form.amount === null || form.amount <= 0) found.amount = 'Summani kiriting';

    if (form.vat !== null && form.amount !== null && form.vat > form.amount) {
      found.vat = 'QQS umumiy summadan katta bo\u2018lishi mumkin emas';
    }

    if (form.dueDate && form.dueDate < form.date) {
      found.dueDate = 'To\u2018lov muddati xarajat sanasidan oldin bo\u2018la olmaydi';
    }

    setErrors(found);
    return Object.keys(found).length === 0;
  }

  function buildPayload(): CreateExpensePayload {
    return {
      date: form.date,
      amountTiyin: sumToTiyin(form.amount ?? 0),
      categoryCode: form.categoryCode,
      ...(form.departmentId ? { departmentId: form.departmentId } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      paymentMethod: form.paymentMethod,
      ...(form.documentNo.trim() ? { documentNo: form.documentNo.trim() } : {}),
      ...(form.counterparty.trim() ? { counterparty: form.counterparty.trim() } : {}),
      paymentStatus: form.paymentStatus,
      ...(form.dueDate ? { dueDate: form.dueDate } : {}),
      ...(form.responsible.trim() ? { responsible: form.responsible.trim() } : {}),
      ...(form.vat !== null ? { vatTiyin: sumToTiyin(form.vat) } : {}),
    };
  }

  async function save(keepOpen: boolean) {
    if (!validate()) return;

    if (
      form.amount !== null &&
      form.amount >= LARGE_AMOUNT_THRESHOLD &&
      !window.confirm(
        `Summa ${formatSum(form.amount)} so\u2018m. Bu to\u2018g\u2018rimi?`,
      )
    ) {
      return;
    }

    setSaving(true);

    try {
      await expensesApi.create(buildPayload());

      if (keepOpen) {
        // Sana va bo'lim saqlanadi - ketma-ket kiritishda ular odatda bir xil
        setForm((state) => ({
          ...emptyForm(),
          date: state.date,
          departmentId: state.departmentId,
          paymentMethod: state.paymentMethod,
        }));
        setToast({ message: 'Saqlandi', tone: 'success' });
        setSaving(false);
      } else {
        router.push('/xarajatlar');
      }
    } catch (err) {
      setToast({
        message: err instanceof ApiError ? err.message : 'Saqlashda xatolik',
        tone: 'error',
      });
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void save(false);
  }

  const departmentOptions = [
    { value: '', label: 'Umumkorxona' },
    ...(departments.data?.data ?? []).map((item) => ({
      value: item.id,
      label: item.name,
    })),
  ];

  return (
    <>
      <PageHeader
        title="Yangi xarajat"
        description="Yulduzcha bilan belgilangan maydonlar majburiy"
        actions={
          <Link href="/xarajatlar">
            <Button variant="ghost" size="sm">
              Bekor qilish
            </Button>
          </Link>
        }
      />

      <div className="p-6">
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
          <Card>
            <CardBody className="space-y-5">
              {/* ─────────── Asosiy ─────────── */}
              <div className="grid gap-4 sm:grid-cols-3">
                <Input
                  label="Sana"
                  type="date"
                  value={form.date}
                  onChange={(event) => update('date', event.target.value)}
                  error={errors.date}
                  required
                  disabled={saving}
                />

                <div className="sm:col-span-2">
                  <CategoryPicker
                    label="Kategoriya"
                    categories={categories.data?.data ?? []}
                    value={form.categoryCode}
                    onChange={(code) => update('categoryCode', code)}
                    error={errors.categoryCode}
                    required
                    disabled={saving}
                    onCreateNew={(text) => {
                      setQuickLabel(text);
                      setQuickOpen(true);
                    }}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyInput
                  label="Summa"
                  value={form.amount}
                  onChange={(value) => update('amount', value)}
                  error={errors.amount}
                  required
                  disabled={saving}
                />

                <Select
                  label="Bo&apos;lim"
                  options={departmentOptions}
                  value={form.departmentId}
                  onChange={(event) => update('departmentId', event.target.value)}
                  disabled={saving}
                  hint="Bo&apos;sh qoldirilsa umumkorxona xarajati hisoblanadi"
                />
              </div>

              <DuplicateWarning items={duplicates} />

              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="To&apos;lov usuli"
                  options={paymentMethods}
                  value={form.paymentMethod}
                  onChange={(event) =>
                    update('paymentMethod', event.target.value as PaymentMethod)
                  }
                  disabled={saving}
                />

                <Input
                  label="Kontragent"
                  value={form.counterparty}
                  onChange={(event) => update('counterparty', event.target.value)}
                  placeholder="Kimga to&apos;landi"
                  disabled={saving}
                />
              </div>

              {/* ─────────── Qo'shimcha ─────────── */}
              <div className="border-t border-[--color-line] pt-4">
                <button
                  type="button"
                  onClick={() => setExtraOpen((state) => !state)}
                  className="flex items-center gap-1.5 text-sm font-medium text-brand-700 transition-colors hover:text-brand-900"
                >
                  <IconChevronDown
                    className={`size-4 transition-transform ${extraOpen ? 'rotate-180' : ''}`}
                  />
                  Qo&apos;shimcha ma&apos;lumot
                </button>

                {extraOpen && (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Input
                        label="Hujjat raqami"
                        value={form.documentNo}
                        onChange={(event) => update('documentNo', event.target.value)}
                        disabled={saving}
                      />

                      <Select
                        label="To&apos;lov holati"
                        options={paymentStatuses}
                        value={form.paymentStatus}
                        onChange={(event) =>
                          update('paymentStatus', event.target.value as PaymentStatus)
                        }
                        disabled={saving}
                      />

                      <Input
                        label="To&apos;lov muddati"
                        type="date"
                        value={form.dueDate}
                        onChange={(event) => update('dueDate', event.target.value)}
                        error={errors.dueDate}
                        disabled={saving}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input
                        label="Javobgar"
                        value={form.responsible}
                        onChange={(event) => update('responsible', event.target.value)}
                        placeholder="F.I.Sh."
                        disabled={saving}
                      />

                      <MoneyInput
                        label="QQS summasi"
                        value={form.vat}
                        onChange={(value) => update('vat', value)}
                        error={errors.vat}
                        disabled={saving}
                        hint="Umumiy summa ichidagi soliq"
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
                        disabled={saving}
                        className="w-full rounded-[--radius-control] border border-[--color-line-strong] bg-white px-3 py-2 text-sm placeholder:text-[--color-text-faint] focus:border-brand-600 disabled:bg-[--color-surface-sunken]"
                        placeholder="Qo&apos;shimcha izoh"
                      />
                    </div>
                  </div>
                )}
              </div>
            </CardBody>

            <CardFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void save(true)}
                loading={saving}
              >
                Saqlash va yana
              </Button>

              <Button type="submit" loading={saving}>
                Saqlash
              </Button>
            </CardFooter>
          </Card>
        </form>
      </div>

      <QuickCategoryDialog
        open={quickOpen}
        groups={(tree.data?.data ?? []).map((g) => ({ code: g.code, label: g.label }))}
        initialLabel={quickLabel}
        onClose={() => setQuickOpen(false)}
        onCreated={(created) => {
          categories.reload();
          update('categoryCode', created.code);
          setToast({ message: 'Kategoriya qoshildi', tone: 'success' });
        }}
      />

      {toast && (
        <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
      )}
    </>
  );
}
