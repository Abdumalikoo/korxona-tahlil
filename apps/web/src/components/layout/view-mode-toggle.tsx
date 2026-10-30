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
/**
 * «Faqat Bosh sahifa» — administrator tugmasi: yoqilsa, Bosh sahifadan (Solishtirma bo'limi) boshqa hamma bo'lim hamma
 * foydalanuvchi uchun yashiriladi (menyu, qidiruv, tez kiritish; to'g'ridan-to'g'ri manzil — Bosh sahifaga). Boshqalar
 * uchun tugma yo'q.
 */
export function HomeOnlyToggle() {
  const { isAdmin } = useAuth();
  const { homeOnly, setHomeOnly } = useViewMode();
  const [busy, setBusy] = useState(false);
  if (!isAdmin) return null;

  const change = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setHomeOnly(!homeOnly);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void change()}
      disabled={busy}
      aria-pressed={homeOnly}
      title={homeOnly ? "Hozir hamma uchun faqat Bosh sahifa ko'rinadi — bosing: hamma bo'limlarni qaytarish" : "Bosh sahifadan boshqa hamma bo'limni hamma uchun yashirish"}
      className={cn(
        'hidden h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors sm:flex',
        homeOnly ? 'border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100' : 'border-(--color-line) bg-(--color-surface-muted) text-(--color-text-muted) hover:text-heading',
        busy && 'opacity-60',
      )}
    >
      <span aria-hidden>{homeOnly ? '🔒' : '👁'}</span>
      {homeOnly ? 'Faqat Bosh sahifa' : "Hammasi ko'rinadi"}
    </button>
  );
}
