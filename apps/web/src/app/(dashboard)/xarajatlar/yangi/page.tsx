'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { expensesApi, type CreateExpensePayload } from '@/features/expenses/api';
import { EMPTY_PLACE, PlacePicker, placeCreatePayload, placeError, placeForUnit, restorePlace, type PlaceValue } from '@/components/shared/place-picker';
import { unitCategoriesApi, useUnitCategories } from '@/features/units/api';
import { entryUnitOf, unitByCode, unitOnly } from '@/lib/segments';
import { referencesApi } from '@/features/shared/references';
import { errorMessage } from '@/lib/error-message';
import { recallForm, rememberForm } from '@/lib/form-memory';
import { useSaveShortcut } from '@/lib/use-save-shortcut';
import { useAuth } from '@/lib/auth-context';
import { formatSum, sumToTiyin, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';

import { PageHeader } from '@/components/layout/page-header';
import { CategoryPicker } from '@/components/shared/category-picker';
import { MoneyInput } from '@/components/shared/money-input';
import { QuickCategoryDialog } from '@/components/shared/quick-category-dialog';
import { DuplicateWarning } from '@/features/expenses/duplicate-warning';
import type { Expense } from '@/lib/types';
import { Button, buttonClass } from '@/components/ui/button';
import { Card, CardBody, CardFooter } from '@/components/ui/card';
import { IconChevronDown } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Toast } from '@/components/ui/toast';
import type { PaymentMethod, PaymentStatus } from '@/lib/types';

/** Katta summa - tasdiqlash so'raladi, nol ortiqcha yozilmasligi uchun */
const LARGE_AMOUNT_THRESHOLD = 100_000_000;

const paymentMethods: { value: PaymentMethod; label: string }[] = [
  { value: 'BANK', label: 'Bank o‘tkazmasi' },
  { value: 'CASH', label: 'Naqd pul' },
  { value: 'CARD', label: 'Plastik karta' },
  { value: 'OTHER', label: 'Boshqa' },
];

const paymentStatuses: { value: PaymentStatus; label: string }[] = [
  { value: 'PAID', label: 'To‘langan' },
  { value: 'UNPAID', label: 'To‘lanmagan' },
  { value: 'PARTIAL', label: 'Qisman to‘langan' },
];

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

/** Brauzerda eslab qolinadigan tanlovlar */
interface Remembered {
  place: PlaceValue;
  paymentMethod: PaymentMethod;
  /** Eski xotira (faqat bo'lim saqlangan) — Markaz bo'limi sifatida o'qiladi */
  departmentId: string;
}

function emptyForm(): FormState {
  return {
    date: todayInput(),
    categoryCode: '',
    amount: null,
    place: EMPTY_PLACE,
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

/** Bosqich sarlavhasi: raqam + nom */
function StepTitle({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{n}</span>
      <h3 className="text-sm font-bold text-heading">{title}</h3>
      {hint && <span className="text-xs text-(--color-text-muted)">{hint}</span>}
    </div>
  );
}

export default function NewExpensePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  /** Qaysi bo'limdan kelindi - yozuv shu bo'limga tushadi */
  const section = searchParams.get('section') === 'BOSHQA' ? 'BOSHQA' : 'DOIMIY';
  /** Bo'lim sahifasidan kelindi (?unit=TAX_FREE …) — joy shu bo'limga qulflanadi, moddalar — shu bo'limniki */
  const lockedUnit = unitByCode(searchParams.get('unit'));
  const backHref = lockedUnit
    ? `/xarajatlar/bolim/${lockedUnit.slug}?section=${section}`
    : section === 'BOSHQA'
      ? '/xarajatlar/boshqa'
      : '/xarajatlar/doimiy';
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
  const unitLists = useUnitCategories('expense');

  // Oldingi safardagi joy (Markaz/hudud) va to'lov usuli o'zi turadi
  useEffect(() => {
    const last = recallForm<Remembered>('expense');
    const remembered = restorePlace(last.place);
    const place: PlaceValue | null = lockedUnit
      ? remembered && entryUnitOf({ segment: remembered.segment, regionCode: remembered.kind === 'CENTER' ? 0 : remembered.regionCode ? Number(remembered.regionCode) : null, departmentId: remembered.departmentId || null }) === lockedUnit.code
        ? remembered
        : placeForUnit(lockedUnit.code)
      : remembered ??
      (typeof last.departmentId === 'string' && last.departmentId ? { ...EMPTY_PLACE, kind: 'CENTER', departmentId: last.departmentId } : null);
    setForm((state) => ({
      ...state,
      ...(place ? { place } : {}),
      ...(last.paymentMethod ? { paymentMethod: last.paymentMethod } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+S — saqlash, Ctrl+Enter — saqlash va yana
  useSaveShortcut(
    () => void save(false),
    () => void save(true),
    !saving,
  );

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

  /** Tanlangan bo'lim (Markaz, Hududlar, yo'nalish) moddalari — bo'lim ro'yxati bo'lmasa, umumiy (hammasi) */
  const currentUnit = lockedUnit?.code ?? entryUnitOf({ segment: form.place.segment || null, regionCode: form.place.kind === 'CENTER' ? 0 : form.place.kind === 'REGION' ? 1 : null, departmentId: null });
  // Har bo'lim alohida: faqat shu bo'lim moddalari (joy tanlanmaguncha — bo'sh)
  const unitList = currentUnit && unitLists.lists.get(currentUnit)?.length ? unitLists.lists.get(currentUnit) : undefined;
  const unitCategories = unitOnly(categories.data?.data ?? [], unitList);
  const unitInfo = unitByCode(currentUnit);

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

    const where = placeError(form.place);
    if (where) found.place = where;
    if (!form.date) found.date = 'Sanani tanlang';
    if (!form.categoryCode) found.categoryCode = 'Kategoriyani tanlang';
    if (form.amount === null || form.amount <= 0) found.amount = 'Summani kiriting';

    if (form.vat !== null && form.amount !== null && form.vat > form.amount) {
      found.vat = 'QQS umumiy summadan katta bo‘lishi mumkin emas';
    }

    if (form.dueDate && form.dueDate < form.date) {
      found.dueDate = 'To‘lov muddati xarajat sanasidan oldin bo‘la olmaydi';
    }

    setErrors(found);
    // Xato qo'shimcha qismda bo'lsa — uni ochib qo'yamiz
    if (found.vat || found.dueDate) setExtraOpen(true);
    return Object.keys(found).length === 0;
  }

  function buildPayload(): CreateExpensePayload {
    return {
      date: form.date,
      amountTiyin: sumToTiyin(form.amount ?? 0),
      categoryCode: form.categoryCode,
      ...placeCreatePayload(form.place),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      paymentMethod: form.paymentMethod,
      ...(form.documentNo.trim() ? { documentNo: form.documentNo.trim() } : {}),
      ...(form.counterparty.trim() ? { counterparty: form.counterparty.trim() } : {}),
      paymentStatus: form.paymentStatus,
      ...(form.dueDate ? { dueDate: form.dueDate } : {}),
      ...(form.responsible.trim() ? { responsible: form.responsible.trim() } : {}),
      ...(form.vat !== null ? { vatTiyin: sumToTiyin(form.vat) } : {}),
      section,
    };
  }

  async function save(keepOpen: boolean) {
    if (!validate()) return;

    if (
      form.amount !== null &&
      form.amount >= LARGE_AMOUNT_THRESHOLD &&
      !window.confirm(
        `Summa ${formatSum(form.amount)} so‘m. Bu to‘g‘rimi?`,
      )
    ) {
      return;
    }

    setSaving(true);

    try {
      await expensesApi.create(buildPayload());
      rememberForm<Remembered>('expense', { place: form.place, paymentMethod: form.paymentMethod });

      if (keepOpen) {
        // Sana va joy saqlanadi - ketma-ket kiritishda ular odatda bir xil
        setForm((state) => ({
          ...emptyForm(),
          date: state.date,
          place: state.place,
          paymentMethod: state.paymentMethod,
        }));
        setToast({ message: 'Saqlandi', tone: 'success' });
        setSaving(false);
      } else {
        router.push(backHref);
      }
    } catch (err) {
      setToast({
        message: errorMessage(err, 'Saqlashda xatolik'),
        tone: 'error',
      });
      setSaving(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void save(false);
  }

  /** Qo'shimcha qismda to'ldirilgan maydonlar — yopiq turganda ham ko'rinsin */
  const extraFilled = [
    form.counterparty.trim() && `Kimga: ${form.counterparty.trim()}`,
    form.documentNo.trim() && `Hujjat: ${form.documentNo.trim()}`,
    form.paymentStatus !== 'PAID' && paymentStatuses.find((s) => s.value === form.paymentStatus)?.label,
    form.dueDate && `Muddat: ${form.dueDate}`,
    form.responsible.trim() && `Javobgar: ${form.responsible.trim()}`,
    form.vat !== null && 'QQS',
    form.description.trim() && 'Izoh',
  ].filter(Boolean) as string[];

  return (
    <>
      <PageHeader
        title={`Yangi xarajat · ${lockedUnit ? `${lockedUnit.label} · ` : ''}${section === 'BOSHQA' ? 'Boshqa' : 'Doimiy'}`}
        description="Avval qayerga tegishli ekanini tanlang (Markaz, Hudud yoki yo‘nalish), keyin xarajatni kiriting"
        actions={
          <Link href={backHref} className={buttonClass('ghost', 'sm')}>
            Bekor qilish
          </Link>
        }
      />

      <div className="p-4 md:p-6">
        <form onSubmit={handleSubmit} className="mx-auto max-w-3xl">
          <Card>
            <CardBody className="space-y-6">
              {/* ─────────── 1. Qayerga tegishli ─────────── */}
              <section className="space-y-3">
                <StepTitle n={1} title="Qayerga tegishli" hint="Markaz, Hudud yoki yo‘nalish — majburiy" />
                <PlacePicker
                  value={form.place}
                  onChange={(place) => update('place', place)}
                  departments={departments.data?.data ?? []}
                  error={errors.place}
                  disabled={saving}
                  hideLabel
                  lockUnit={lockedUnit?.code}
                />
                {unitInfo && unitList && (
                  unitCategories.length ? (
                    <p className="text-xs text-(--color-text-muted)">
                      Kategoriyalar — faqat «{unitInfo.label}» bo&apos;limi moddalari ({unitCategories.length} ta).{' '}
                      <Link href={`/xarajatlar/bolim/${unitInfo.slug}?section=MODDALAR`} className="font-medium text-brand-700 hover:underline">
                        Modda qo&apos;shish
                      </Link>
                    </p>
                  ) : (
                    <p className="rounded-(--radius-control) border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      «{unitInfo.label}» bo&apos;limida hali xarajat moddasi yo&apos;q — har bo&apos;limning moddalari alohida.{' '}
                      <Link href={`/xarajatlar/bolim/${unitInfo.slug}?section=MODDALAR`} className="font-semibold text-brand-700 hover:underline">
                        Moddalarni qo&apos;shish →
                      </Link>
                    </p>
                  )
                )}
              </section>

              {/* ─────────── 2. Xarajat ─────────── */}
              <section className="space-y-4 border-t border-(--color-line) pt-5">
                <StepTitle n={2} title="Xarajat" hint="nima, qachon, qancha" />
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
                      label="Kategoriya (nima uchun)"
                      categories={unitCategories}
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
                    label="To&apos;lov usuli"
                    options={paymentMethods}
                    value={form.paymentMethod}
                    onChange={(event) =>
                      update('paymentMethod', event.target.value as PaymentMethod)
                    }
                    disabled={saving}
                  />
                </div>

                <DuplicateWarning items={duplicates} />
              </section>

              {/* ─────────── 3. Qo'shimcha ─────────── */}
              <section className="border-t border-(--color-line) pt-4">
                <button
                  type="button"
                  onClick={() => setExtraOpen((state) => !state)}
                  aria-expanded={extraOpen}
                  className="flex w-full items-center gap-1.5 text-left text-sm font-medium text-brand-700 transition-colors hover:text-brand-900"
                >
                  <IconChevronDown
                    className={`size-4 shrink-0 transition-transform ${extraOpen ? 'rotate-180' : ''}`}
                  />
                  Qo&apos;shimcha ma&apos;lumot
                  <span className="ml-1 truncate text-xs font-normal text-(--color-text-muted)">
                    {extraFilled.length ? extraFilled.join(' · ') : "kimga to'langan, hujjat, to'lov holati, QQS, izoh"}
                  </span>
                </button>

                {extraOpen && (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input
                        label="Kimga to&apos;langan (kontragent)"
                        value={form.counterparty}
                        onChange={(event) => update('counterparty', event.target.value)}
                        placeholder="Tashkilot yoki shaxs nomi"
                        disabled={saving}
                      />

                      <Input
                        label="Hujjat raqami"
                        value={form.documentNo}
                        onChange={(event) => update('documentNo', event.target.value)}
                        placeholder="Shartnoma, hisob-faktura №"
                        disabled={saving}
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
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

                      <MoneyInput
                        label="QQS summasi"
                        value={form.vat}
                        onChange={(value) => update('vat', value)}
                        error={errors.vat}
                        disabled={saving}
                        hint="Umumiy summa ichidagi soliq"
                      />
                    </div>

                    <Input
                      label="Javobgar"
                      value={form.responsible}
                      onChange={(event) => update('responsible', event.target.value)}
                      placeholder="F.I.Sh."
                      disabled={saving}
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
                        disabled={saving}
                        className="w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 py-2 text-sm placeholder:text-(--color-text-faint) focus:border-brand-600 disabled:bg-(--color-surface-sunken)"
                        placeholder="Qo&apos;shimcha izoh"
                      />
                    </div>
                  </div>
                )}
              </section>
            </CardBody>

            <CardFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void save(true)}
                loading={saving}
                title="Ctrl+Enter"
              >
                Saqlash va yana
              </Button>

              <Button type="submit" loading={saving} title="Ctrl+S">
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
          // Bo'lim tanlangan bo'lsa — yangi modda darhol shu bo'lim ro'yxatiga ham qo'shiladi (har bo'lim alohida)
          const done = () => {
            categories.reload();
            update('categoryCode', created.code);
            setToast({ message: unitInfo ? `Modda qo'shildi — «${unitInfo.label}» bo'limiga` : 'Kategoriya qoshildi', tone: 'success' });
          };
          // Bo'limda ro'yxat bo'lsagina (cheklangan bo'lsa) — yangi modda shu ro'yxatga ham qo'shiladi
          if (currentUnit && unitList) {
            void unitCategoriesApi
              .set('expense', currentUnit, [...(unitLists.lists.get(currentUnit) ?? []), created.code])
              .then(() => unitLists.reload())
              .then(done)
              .catch((e) => setToast({ message: errorMessage(e, "Bo'lim ro'yxatiga qo'shib bo'lmadi"), tone: 'error' }));
          } else done();
        }}
      />

      {toast && (
        <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
      )}
    </>
  );
}