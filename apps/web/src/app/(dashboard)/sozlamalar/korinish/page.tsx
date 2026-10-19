'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { useViewMode, type ViewMode } from '@/lib/view-mode';
import { useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Sozlamalar › Ko'rinish: dastur qaysi rejimda ishlaydi — qisqa (rahbar) yoki to'liq.
// Butun dastur uchun bitta; Manba bo'limlari har doim to'liq.
// ═══════════════════════════════════════════════════════════

const MODES: { value: ViewMode; title: string; who: string; points: string[] }[] = [
  {
    value: 'brief',
    title: 'Qisqa',
    who: 'Rahbar uchun',
    points: [
      'Har bo\'limda faqat eng muhim raqamlar va xulosalar',
      'Grafiklar, uzun jadvallar va tafsilot yorliqlari yashiriladi',
      'Menyu va hamma bo\'lim avvalgidek ishlaydi — faqat mazmun qisqaradi',
      "«Qanday hisoblandi?» va muhokamaga qo'yish ishlayveradi",
    ],
  },
  {
    value: 'full',
    title: "To'liq",
    who: 'Mutaxassis uchun',
    points: [
      'Hamma bo\'lim to\'liq: jadvallar, grafiklar, modellar',
      "Maydalab ko'rish: viloyat → tuman → xodim, yozuvgacha",
      'Hozirgi ko\'rinish',
    ],
  },
];

export default function ViewModeSettingsPage() {
  const { isAdmin } = useAuth();
  const { mode, setMode } = useViewMode();
  const [busy, setBusy] = useState<ViewMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (next: ViewMode) => {
    if (!isAdmin || next === mode) return;
    setBusy(next);
    setError(null);
    try {
      await setMode(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Saqlanmadi');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader title="Sozlamalar" description="Ko'rinish rejimi — butun dastur uchun" />
      <div className="space-y-4 p-4 md:p-6">
        {!isAdmin && (
          <p className="rounded-(--radius-control) bg-(--color-warn-soft) px-4 py-2.5 text-sm text-(--color-warn)">Rejimni faqat administrator o&apos;zgartira oladi.</p>
        )}
        {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-4 py-2.5 text-sm text-(--color-expense)">{error}</p>}

        <div className="grid gap-4 md:grid-cols-2">
          {MODES.map((m) => {
            const on = mode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => void choose(m.value)}
                disabled={!isAdmin || busy !== null}
                aria-pressed={on}
                className={cn(
                  'rounded-(--radius-card) border-2 bg-white p-5 text-left transition-all disabled:cursor-default',
                  on ? 'border-brand-600 shadow-md' : 'border-(--color-line)',
                  !on && isAdmin && 'hover:border-brand-300',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-(--color-text-muted)">{m.who}</p>
                    <p className="mt-1 text-xl font-bold text-heading">{m.title} rejim</p>
                  </div>
                  <span
                    className={cn(
                      'flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold',
                      on ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-line-strong) text-transparent',
                    )}
                  >
                    ✓
                  </span>
                </div>
                <ul className="mt-4 space-y-1.5 text-sm text-(--color-text)">
                  {m.points.map((p) => (
                    <li key={p} className="flex gap-2">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-500" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
                {busy === m.value && <p className="mt-3 text-xs text-(--color-text-muted)">Saqlanmoqda…</p>}
              </button>
            );
          })}
        </div>

        <Card className="px-5 py-4 text-sm leading-relaxed text-(--color-text-muted)">
          <p>
            <b className="text-heading">Manba</b> bo&apos;limlari (Daromadlar, Xarajatlar, Xodimlar, Sozlamalar) rejimdan qat&apos;i nazar har doim to&apos;liq ko&apos;rinadi — ma&apos;lumot kiritish
            o&apos;zgarmaydi.
          </p>
          <p className="mt-1.5">Rejimni yuqori paneldagi «Qisqa | To&apos;liq» tugmasi bilan ham bir bosishda almashtirish mumkin. Tanlov hamma foydalanuvchilarga birdaniga qo&apos;llanadi.</p>
        </Card>
      </div>
    </>
  );
}