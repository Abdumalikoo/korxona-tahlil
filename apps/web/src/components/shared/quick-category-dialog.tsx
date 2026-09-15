'use client';

import { useState, useEffect, useRef } from 'react';
import { ApiError } from '@/lib/api';
import { categoriesApi } from '@/features/shared/references';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { IconClose } from '@/components/ui/icons';
import type { Category, CostBehavior } from '@/lib/types';

const behaviors: { value: CostBehavior; label: string }[] = [
  { value: 'FIXED', label: 'Doimiy' },
  { value: 'VARIABLE', label: "O'zgaruvchan" },
  { value: 'MIXED', label: 'Aralash' },
];

interface QuickCategoryDialogProps {
  open: boolean;
  /** Guruhlar ro'yxati — ota-kategoriyani tanlash uchun */
  groups: { code: string; label: string }[];
  /** Foydalanuvchi qidiruvda yozgan matn — nom sifatida oldindan to'ldiriladi */
  initialLabel?: string;
  onClose: () => void;
  /** Yaratilgan kategoriya darhol tanlanadi */
  onCreated: (category: Category) => void;
}

/**
 * Formadan chiqmasdan yangi kategoriya qo'shish.
 *
 * Buxgalter yozuv kiritayotganda mos modda topilmasa,
 * sozlamalarga o'tishi shart emas.
 */
export function QuickCategoryDialog({
  open,
  groups,
  initialLabel = '',
  onClose,
  onCreated,
}: QuickCategoryDialogProps) {
  const [label, setLabel] = useState(initialLabel);
  const [parentCode, setParentCode] = useState('');
  const [behavior, setBehavior] = useState<CostBehavior>('VARIABLE');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setLabel(initialLabel);
      setParentCode(groups[0]?.code ?? '');
      setBehavior('VARIABLE');
      setError(null);
      // Fokus qo'yish uchun kichik kechikish kerak
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialLabel, groups]);

  useEffect(() => {
    if (!open) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose();
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, saving, onClose]);

  if (!open) return null;

  async function handleSave() {
    if (!label.trim()) {
      setError('Nomni kiriting');
      return;
    }
    if (!parentCode) {
      setError('Guruhni tanlang');
      return;
    }

    setSaving(true);

    try {
      const response = await categoriesApi.create({
        label: label.trim(),
        parentCode,
        behavior,
        scope: 'GENERAL',
      });

      onCreated(response.data);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Saqlashda xatolik');
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

      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-[--radius-card] bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[--color-line] px-5 py-3.5">
          <h3 className="text-sm font-semibold">Yangi kategoriya</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex size-7 items-center justify-center rounded text-[--color-text-muted] transition-colors hover:bg-[--color-surface-sunken] hover:text-[--color-text]"
            aria-label="Yopish"
          >
            <IconClose className="size-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error && (
            <div className="rounded-[--radius-control] bg-[--color-expense-soft] px-3 py-2 text-sm text-[--color-expense]">
              {error}
            </div>
          )}

          <Input
            ref={inputRef}
            label="Nomi"
            value={label}
            onChange={(event) => {
              setLabel(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void handleSave();
              }
            }}
            required
            disabled={saving}
            placeholder="Masalan: Ofis mebeli"
          />

          <Select
            label="Guruh"
            options={groups.map((group) => ({ value: group.code, label: group.label }))}
            value={parentCode}
            onChange={(event) => {
              setParentCode(event.target.value);
              setError(null);
            }}
            required
            disabled={saving}
          />

          <Select
            label="Xarajat turi"
            options={behaviors}
            value={behavior}
            onChange={(event) => setBehavior(event.target.value as CostBehavior)}
            disabled={saving}
          />

          <p className="text-xs text-[--color-text-muted]">
            Qolgan sozlamalarni keyinroq Sozlamalar bo&rsquo;limida o&rsquo;zgartirasiz.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-[--color-line] bg-[--color-surface-muted] px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            Bekor qilish
          </Button>
          <Button size="sm" onClick={() => void handleSave()} loading={saving}>
            Qo&rsquo;shish
          </Button>
        </div>
      </div>
    </div>
  );
}
