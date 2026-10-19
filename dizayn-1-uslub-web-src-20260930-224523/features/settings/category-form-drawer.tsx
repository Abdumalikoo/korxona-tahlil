'use client';

import { useState, useEffect } from 'react';
import { ApiError } from '@/lib/api';
import { errorMessage } from '@/lib/error-message';
import { categoriesApi } from '@/features/shared/references';

import { Drawer } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { Category, CategoryTree, CostBehavior, CostScope } from '@/lib/types';

const behaviors: { value: CostBehavior; label: string }[] = [
  { value: 'FIXED', label: 'Doimiy' },
  { value: 'VARIABLE', label: "O'zgaruvchan" },
  { value: 'MIXED', label: 'Aralash' },
];

const scopes: { value: CostScope; label: string }[] = [
  { value: 'GENERAL', label: 'Umumkorxona' },
  { value: 'DEPARTMENT', label: "Bo'limga tegishli" },
];

interface CategoryFormDrawerProps {
  /** Tahrirlanayotgan kategoriya; null bo'lsa yangi yaratiladi */
  category: Category | null;
  /**
   * Yangi yaratishda ota-kategoriya kodi.
   * null — yangi guruh, string — guruh ichidagi modda,
   * undefined — panel yopiq.
   */
  parentCode: string | null | undefined;
  groups: CategoryTree[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

interface FormState {
  label: string;
  parentCode: string;
  behavior: CostBehavior;
  scope: CostScope;
  keywords: string;
}

export function CategoryFormDrawer({
  category,
  parentCode,
  groups,
  onClose,
  onSaved,
}: CategoryFormDrawerProps) {
  const isEditing = category !== null;
  const isOpen = isEditing || parentCode !== undefined;

  const [form, setForm] = useState<FormState>({
    label: '',
    parentCode: '',
    behavior: 'VARIABLE',
    scope: 'GENERAL',
    keywords: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (category) {
      setForm({
        label: category.label,
        parentCode: category.parentCode ?? '',
        behavior: category.behavior,
        scope: category.scope,
        keywords: category.keywords.join(', '),
      });
    } else {
      setForm({
        label: '',
        parentCode: parentCode ?? '',
        behavior: 'VARIABLE',
        scope: 'GENERAL',
        keywords: '',
      });
    }
    setError(null);
  }, [category, parentCode]);

  if (!isOpen) return null;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((state) => ({ ...state, [key]: value }));
    setError(null);
  }

  async function handleSave() {
    if (!form.label.trim()) {
      setError('Nomni kiriting');
      return;
    }

    setSaving(true);

    const keywords = form.keywords
      .split(',')
      .map((word) => word.trim())
      .filter(Boolean);

    try {
      if (category) {
        await categoriesApi.update(category.code, {
          label: form.label.trim(),
          behavior: form.behavior,
          scope: form.scope,
          keywords,
        });
        onSaved("O'zgarishlar saqlandi");
      } else {
        await categoriesApi.create({
          label: form.label.trim(),
          parentCode: form.parentCode || null,
          behavior: form.behavior,
          scope: form.scope,
          keywords,
        });
        onSaved(form.parentCode ? "Modda qo'shildi" : "Guruh qo'shildi");
      }
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Saqlashda xatolik'));
    } finally {
      setSaving(false);
    }
  }

  const isGroup = !form.parentCode;

  const groupOptions = [
    { value: '', label: 'Guruh sifatida (ildiz)' },
    ...groups.map((group) => ({ value: group.code, label: group.label })),
  ];

  const title = isEditing
    ? 'Kategoriyani tahrirlash'
    : parentCode === null
      ? 'Yangi guruh'
      : 'Yangi modda';

  return (
    <Drawer
      open
      onClose={onClose}
      title={title}
      description={category ? `Kod: ${category.code}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Bekor qilish
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            Saqlash
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="rounded-[--radius-control] bg-[--color-expense-soft] px-3 py-2.5 text-sm text-[--color-expense]">
            {error}
          </div>
        )}

        <Input
          label="Nomi"
          value={form.label}
          onChange={(event) => update('label', event.target.value)}
          required
          disabled={saving}
          autoFocus
          placeholder="Masalan: Ofis mebeli"
        />

        {!isEditing && (
          <Select
            label="Qaysi guruhga"
            options={groupOptions}
            value={form.parentCode}
            onChange={(event) => update('parentCode', event.target.value)}
            disabled={saving}
            hint="Bo'sh qoldirilsa yangi guruh yaratiladi"
          />
        )}

        {!isGroup && (
          <>
            <Select
              label="Xarajat turi"
              options={behaviors}
              value={form.behavior}
              onChange={(event) => update('behavior', event.target.value as CostBehavior)}
              disabled={saving}
              hint="Doimiy — hajmdan qat'i nazar to'lanadi"
            />

            <Select
              label="Qamrovi"
              options={scopes}
              value={form.scope}
              onChange={(event) => update('scope', event.target.value as CostScope)}
              disabled={saving}
              hint="Umumkorxona xarajatlari bo'limlarga taqsimlanishi mumkin"
            />

            <div>
              <label className="mb-1.5 block text-sm font-medium text-[--color-text]">
                Kalit so&rsquo;zlar
              </label>
              <textarea
                value={form.keywords}
                onChange={(event) => update('keywords', event.target.value)}
                rows={2}
                disabled={saving}
                className="w-full rounded-[--radius-control] border border-[--color-line-strong] bg-white px-3 py-2 text-sm placeholder:text-[--color-text-faint] focus:border-brand-600 disabled:bg-[--color-surface-sunken]"
                placeholder="mebel, stol, stul, мебель"
              />
              <p className="mt-1 text-xs text-[--color-text-muted]">
                Vergul bilan ajrating. Qidiruvda va Excel importda avtomatik tanish uchun
                ishlatiladi.
              </p>
            </div>
          </>
        )}

        {isEditing && (
          <p className="rounded-[--radius-control] bg-[--color-surface-sunken] px-3 py-2.5 text-xs text-[--color-text-muted]">
            Kod o&rsquo;zgartirilmaydi &mdash; unga mavjud yozuvlar bog&rsquo;langan.
            Guruhni ham o&rsquo;zgartirib bo&rsquo;lmaydi.
          </p>
        )}
      </div>
    </Drawer>
  );
}
