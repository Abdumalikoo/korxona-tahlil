'use client';

import {
    CATEGORY_COLORS,
    CATEGORY_LABELS,
    CATEGORY_ORDER,
    compositionApi,
    GROUP_LABELS,
    type ComponentCategory,
    type ComponentGroup,
    type SalaryComponent,
} from '@/features/salary-composition/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconClose, IconEdit, IconPlus, IconTrash } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Tabs } from '@/components/ui/tabs';
import { Toast } from '@/components/ui/toast';

const tabs = [
  { href: '/sozlamalar/xarajat', label: 'Xarajat' },
  { href: '/sozlamalar/komponentlar', label: 'Ish haqi komponentlari' },
  { href: '/sozlamalar/savat', label: 'Savat' },
  { href: '/sozlamalar/tarix', label: 'Tarix' },
  { href: '/sozlamalar/tekshiruv', label: 'Tekshiruv' },
  { href: '/sozlamalar/zaxira', label: 'Zaxira' },
];

const GROUPS: ComponentGroup[] = ['BUDGET', 'HOJALIK'];

type ToastState = { message: string; tone: 'success' | 'error' } | null;

/** Tahrirlash oynasi holati: null — yopiq, 'new' — yangi, komponent — tahrirlash */
type EditorState = null | 'new' | SalaryComponent;

export default function SalaryComponentsPage() {
  const { isAdmin, ready } = useAuth();
  const router = useRouter();

  const [showInactive, setShowInactive] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<SalaryComponent | null>(null);
  const [removing, setRemoving] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  const list = useAsync(() => compositionApi.components(), []);

  useEffect(() => {
    if (ready && !isAdmin) router.replace('/');
  }, [ready, isAdmin, router]);

  async function handleToggle(component: SalaryComponent) {
    setToggling(component.code);
    try {
      await compositionApi.updateComponent(component.code, { isActive: !component.isActive });
      setToast({
        message: component.isActive
          ? `"${component.name}" nofaol qilindi — shablonda chiqmaydi`
          : `"${component.name}" qayta faollashtirildi`,
        tone: 'success',
      });
      list.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Xatolik'), tone: 'error' });
    } finally {
      setToggling(null);
    }
  }

  async function handleRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await compositionApi.removeComponent(removeTarget.code);
      setToast({ message: `"${removeTarget.name}" o‘chirildi`, tone: 'success' });
      list.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'O‘chirishda xatolik'), tone: 'error' });
    } finally {
      setRemoving(false);
      setRemoveTarget(null);
    }
  }

  if (!ready || !isAdmin) return <LoadingState />;

  const all = list.data?.data ?? [];
  const visible = showInactive ? all : all.filter((component) => component.isActive);
  const activeCount = all.filter((component) => component.isActive).length;

  return (
    <>
      <PageHeader
        title="Sozlamalar"
        description="Ish haqi komponentlari"
        actions={
          <Button size="sm" onClick={() => setEditor('new')}>
            <IconPlus className="size-4" />
            Yangi komponent
          </Button>
        }
      />

      <Tabs items={tabs} className="bg-white px-6" />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-3xl text-sm text-[--color-text-muted]">
            Ish haqi tarkibi shabloni shu ro&rsquo;yxatdan yasaladi: har bir faol komponent &mdash;
            alohida ustun. Kod o&rsquo;zgarmaydi, chunki unga yozuvlar bog&rsquo;langan. Ishlatilgan
            komponentni o&rsquo;chirib bo&rsquo;lmaydi &mdash; uni nofaol qiling.
          </p>

          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm text-[--color-text-muted]">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
              className="size-4 rounded border-[--color-line-strong]"
            />
            Nofaollarni ko&rsquo;rsatish
          </label>
        </div>

        {list.loading ? (
          <Card>
            <LoadingState />
          </Card>
        ) : list.error ? (
          <Card>
            <ErrorState message={list.error} onRetry={list.reload} />
          </Card>
        ) : all.length === 0 ? (
          <Card>
            <EmptyState
              title="Komponentlar yo'q"
              description="Backend birinchi ishga tushganda 17 ta standart komponent yaratiladi"
            />
          </Card>
        ) : (
          <>
            <p className="text-xs text-[--color-text-faint]">
              {activeCount} ta faol komponent &middot; shablonda {activeCount} ta summa ustuni
            </p>

            {GROUPS.map((group) => {
              const items = visible.filter((component) => component.group === group);

              return (
                <Card key={group} className="overflow-hidden">
                  <CardHeader
                    title={GROUP_LABELS[group]}
                    description={`${items.length} ta komponent`}
                  />

                  {items.length === 0 ? (
                    <p className="px-5 py-6 text-center text-sm text-[--color-text-muted]">
                      Bu manbada komponent yo&rsquo;q
                    </p>
                  ) : (
                    <div className="divide-y divide-[--color-line]">
                      {items.map((component) => (
                        <div
                          key={component.code}
                          className={cn(
                            'group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-[--color-surface-muted]',
                            !component.isActive && 'opacity-60',
                          )}
                        >
                          <span className="money w-10 shrink-0 text-xs text-[--color-text-faint]">
                            {component.sortOrder}
                          </span>

                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">
                              {component.name}
                              {component.sign < 0 && (
                                <span className="ml-1.5 text-[--color-expense]">(&minus;)</span>
                              )}
                            </p>
                            <p className="money text-xs text-[--color-text-muted]">
                              {component.code}
                            </p>
                          </div>

                          <span className="inline-flex w-44 shrink-0 items-center gap-1.5 text-xs text-[--color-text-muted]">
                            <span
                              className="size-2 rounded-full"
                              style={{ backgroundColor: CATEGORY_COLORS[component.category] }}
                            />
                            {CATEGORY_LABELS[component.category]}
                          </span>

                          <span className="w-28 shrink-0 text-right text-xs text-[--color-text-muted]">
                            {component.usedCount > 0
                              ? `${component.usedCount} ta yozuv`
                              : 'Ishlatilmagan'}
                          </span>

                          <span className="w-20 shrink-0">
                            {component.isActive ? (
                              <Badge tone="income">Faol</Badge>
                            ) : (
                              <Badge>Nofaol</Badge>
                            )}
                          </span>

                          <div className="flex w-44 shrink-0 justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditor(component)}
                              title="Tahrirlash"
                            >
                              <IconEdit className="size-4" />
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              loading={toggling === component.code}
                              onClick={() => void handleToggle(component)}
                            >
                              {component.isActive ? 'Nofaol' : 'Faollash'}
                            </Button>

                            {component.usedCount === 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setRemoveTarget(component)}
                                className="text-[--color-text-muted] hover:text-[--color-expense]"
                                title="O'chirish"
                              >
                                <IconTrash className="size-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </>
        )}
      </div>

      {editor !== null && (
        <ComponentDialog
          component={editor === 'new' ? null : editor}
          onClose={() => setEditor(null)}
          onSaved={(message) => {
            setEditor(null);
            setToast({ message, tone: 'success' });
            list.reload();
          }}
        />
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title="Komponentni o'chirish"
        message={`"${removeTarget?.name ?? ''}" butunlay o'chiriladi. U hech qayerda ishlatilmagan.`}
        confirmLabel="O'chirish"
        danger
        loading={removing}
        onConfirm={() => void handleRemove()}
        onCancel={() => setRemoveTarget(null)}
      />

      {toast && (
        <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Qo'shish / tahrirlash oynasi
// ═══════════════════════════════════════════════════════════

function ComponentDialog({
  component,
  onClose,
  onSaved,
}: {
  component: SalaryComponent | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const isNew = component === null;

  const [code, setCode] = useState(component?.code ?? '');
  const [name, setName] = useState(component?.name ?? '');
  const [group, setGroup] = useState<ComponentGroup>(component?.group ?? 'HOJALIK');
  const [category, setCategory] = useState<ComponentCategory>(component?.category ?? 'BOSHQA');
  const [sortOrder, setSortOrder] = useState(component ? String(component.sortOrder) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose, saving]);

  const isMinus = category === 'JARIMA';
  const signLocked = !isNew && (component?.usedCount ?? 0) > 0 && (component?.sign ?? 1) < 0 !== isMinus;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const trimmedCode = code.trim().toUpperCase();
    const trimmedName = name.trim();

    if (isNew && !/^[A-Z][A-Z0-9_]{1,29}$/.test(trimmedCode)) {
      setError('Kod: lotin katta harf, raqam va "_", 2–30 belgi. Masalan: TUNGI_ISH');
      return;
    }
    if (trimmedName.length < 2) {
      setError('Nomini kiriting');
      return;
    }
    if (sortOrder.trim() !== '' && !/^-?\d+$/.test(sortOrder.trim())) {
      setError('Tartib raqami butun son bo‘lsin');
      return;
    }
    if (signLocked) {
      setError('Bu komponent ishlatilgan — uni jarima guruhiga o‘tkazib yoki undan chiqarib bo‘lmaydi');
      return;
    }

    setSaving(true);

    try {
      const order = sortOrder.trim() === '' ? undefined : Number(sortOrder.trim());

      if (isNew) {
        await compositionApi.createComponent({
          code: trimmedCode,
          name: trimmedName,
          group,
          category,
          sign: isMinus ? -1 : 1,
          sortOrder: order,
        });
        onSaved(`"${trimmedName}" qo‘shildi — shablonni qayta yuklab oling`);
      } else {
        await compositionApi.updateComponent(component.code, {
          name: trimmedName,
          group,
          category,
          sign: isMinus ? -1 : 1,
          sortOrder: order,
        });
        onSaved(`"${trimmedName}" saqlandi`);
      }
    } catch (err) {
      setError(errorMessage(err, 'Saqlashda xatolik'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/30"
        onClick={saving ? undefined : onClose}
        aria-hidden
      />

      <form
        role="dialog"
        aria-modal="true"
        onSubmit={(event) => void handleSubmit(event)}
        className="relative w-full max-w-md rounded-[--radius-card] bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[--color-line] px-5 py-4">
          <h2 className="text-base font-semibold">
            {isNew ? 'Yangi komponent' : 'Komponentni tahrirlash'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded p-1 text-[--color-text-muted] hover:bg-[--color-surface-sunken] hover:text-[--color-text]"
            aria-label="Yopish"
          >
            <IconClose className="size-5" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <Input
            label="Kod"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            disabled={!isNew}
            placeholder="TUNGI_ISH"
            hint={
              isNew
                ? 'Shablondagi yashirin kod. Keyin o‘zgartirib bo‘lmaydi'
                : 'Kod o‘zgarmaydi'
            }
            className="money"
            required
          />

          <Input
            label="Nomi"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Tungi ish uchun qo'shimcha"
            maxLength={100}
            required
          />

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Manba"
              value={group}
              onChange={(event) => setGroup(event.target.value as ComponentGroup)}
              options={GROUPS.map((value) => ({ value, label: GROUP_LABELS[value] }))}
            />
            <Select
              label="Guruh"
              value={category}
              onChange={(event) => setCategory(event.target.value as ComponentCategory)}
              options={CATEGORY_ORDER.map((value) => ({ value, label: CATEGORY_LABELS[value] }))}
            />
          </div>

          <Input
            label="Tartib raqami"
            value={sortOrder}
            onChange={(event) => setSortOrder(event.target.value)}
            placeholder="Bo'sh qolsa — oxiriga qo'yiladi"
            hint="Shablonda ustunlar manba ichida shu raqam bo'yicha tartiblanadi"
            inputMode="numeric"
          />

          <div
            className={cn(
              'rounded-[--radius-control] px-3 py-2 text-xs',
              isMinus
                ? 'bg-[--color-expense-soft] text-[--color-expense]'
                : 'bg-[--color-surface-muted] text-[--color-text-muted]',
            )}
          >
            {isMinus
              ? 'Jarima guruhi: summa musbat yoziladi, jamidan AYIRILADI'
              : 'Summa jamiga QO‘SHILADI'}
          </div>

          {error && (
            <p className="rounded-[--radius-control] bg-[--color-expense-soft] px-3 py-2 text-sm text-[--color-expense]">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[--color-line] bg-[--color-surface-muted] px-5 py-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Bekor qilish
          </Button>
          <Button type="submit" loading={saving}>
            Saqlash
          </Button>
        </div>
      </form>
    </div>
  );
}
