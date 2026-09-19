'use client';

import { Button } from '@/components/ui/button';
import { IconClose } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { categoriesApi } from '@/features/shared/references';
import { errorMessage } from '@/lib/error-message';
import type { IncomeCategory } from '@/lib/types';
import { useEffect, useRef, useState } from 'react';

interface QuickServiceDialogProps {
  open: boolean;
  /** Tanlagichda yozilgan matn — nom sifatida to'ldiriladi */
  initialLabel?: string;
  onClose: () => void;
  onCreated: (category: IncomeCategory) => void;
}

/**
 * Formadan chiqmasdan yangi xizmat turi qo'shish.
 *
 * Yaratilgan tur darhol tanlanadi va reestrga tushadi.
 */
export function QuickServiceDialog({
  open,
  initialLabel = '',
  onClose,
  onCreated,
}: QuickServiceDialogProps) {
  const [label, setLabel] = useState(initialLabel);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setLabel(initialLabel);
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, initialLabel]);

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

    setSaving(true);

    try {
      const response = await categoriesApi.createIncome({ label: label.trim() });
      onCreated(response.data);
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Saqlashda xatolik'));
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
          <h3 className="text-sm font-semibold">Yangi xizmat turi</h3>

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
            placeholder="Masalan: Buxgalteriya konsultatsiyasi"
          />

          <p className="text-xs text-[--color-text-muted]">
            Yaratilgan xizmat turi ro&rsquo;yxatga qo&rsquo;shiladi va keyingi
            safar tanlash mumkin bo&rsquo;ladi.
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
