'use client';

import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { useBrief, useViewMode, type ViewMode } from '@/lib/view-mode';
import { useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Yuqori paneldagi «Qisqa | To'liq» almashtirgich.
// Butun dastur uchun bitta rejim — faqat administrator o'zgartiradi, boshqalar ko'radi.
// ═══════════════════════════════════════════════════════════

const OPTIONS: { value: ViewMode; label: string; hint: string }[] = [
  { value: 'brief', label: 'Qisqa', hint: "Rahbar uchun: faqat asosiy raqamlar va xulosalar (grafik, diagramma va modellar — To'liq rejimda)" },
  { value: 'full', label: "To'liq", hint: "Hamma tafsilot: jadvallar, grafiklar, maydalab ko'rish" },
];

export function ViewModeToggle() {
  const { isAdmin } = useAuth();
  const { mode, setMode } = useViewMode();
  const brief = useBrief();
  const [busy, setBusy] = useState(false);

  const change = async (next: ViewMode) => {
    if (!isAdmin || next === mode || busy) return;
    setBusy(true);
    try {
      await setMode(next);
    } finally {
      setBusy(false);
    }
  };

  // Manba sahifasida qisqa rejim yoqilgan bo'lsa ham to'liq ko'rinadi — buni bildiramiz
  const sourceNote = mode === 'brief' && !brief ? " · Manba bo'limlari har doim to'liq" : '';

  return (
    <div
      className={cn('hidden h-10 shrink-0 items-center rounded-xl border border-(--color-line) bg-(--color-surface-muted) p-1 sm:flex', busy && 'opacity-60')}
      role="radiogroup"
      aria-label="Ko'rinish rejimi"
      title={isAdmin ? `Ko'rinish rejimi (butun dastur uchun)${sourceNote}` : `Ko'rinish rejimini administrator tanlaydi${sourceNote}`}
    >
      {OPTIONS.map((o) => {
        const on = mode === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={!isAdmin || busy}
            onClick={() => void change(o.value)}
            title={o.hint}
            className={cn(
              'h-8 rounded-lg px-3 text-xs font-semibold transition-colors disabled:cursor-default',
              on ? 'bg-white text-brand-700 shadow-sm' : 'text-(--color-text-muted)',
              !on && isAdmin && 'hover:text-heading',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}