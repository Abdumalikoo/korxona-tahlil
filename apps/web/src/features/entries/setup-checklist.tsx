'use client';

import { Card } from '@/components/ui/card';
import { entriesApi } from '@/features/entries/api';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa › «Boshlash»: dasturni qaysi tartibda to'ldirish kerak va nimasi bajarilgan.
// Faqat administratorga; hammasi bajarilganda yoki «Yashirish» bosilganda ko'rinmaydi.
// ═══════════════════════════════════════════════════════════

const HIDE_KEY = 'korxona_setup_hidden';

export function SetupChecklist({ className }: { className?: string }) {
  const { isAdmin } = useAuth();
  const [hidden, setHidden] = useState(true);
  const status = useAsync(() => (isAdmin ? entriesApi.setup() : Promise.resolve(null)), [isAdmin]);

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDE_KEY) === '1');
    } catch {
      setHidden(false);
    }
  }, []);

  const data = status.data?.data;
  if (!isAdmin || hidden || !data || data.done === data.total) return null;

  const hide = () => {
    setHidden(true);
    try {
      window.localStorage.setItem(HIDE_KEY, '1');
    } catch {
      // eslab qolinmasa ham bo'ladi
    }
  };

  const next = data.steps.find((s) => !s.done);
  const percent = Math.round((data.done / data.total) * 100);

  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--color-line) px-5 py-3">
        <div>
          <p className="text-[15px] font-bold text-heading">Boshlash: dasturni to&apos;ldirish tartibi</p>
          <p className="text-xs text-(--color-text-muted)">
            {data.done} / {data.total} bajarildi{next ? ` · keyingisi: ${next.label}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-2 w-40 overflow-hidden rounded-full bg-(--color-surface-sunken)" aria-label={`${percent}%`}>
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} />
          </div>
          <button type="button" onClick={hide} className="text-xs text-(--color-text-muted) hover:text-heading">
            Yashirish ×
          </button>
        </div>
      </div>
      <ol className="grid gap-px bg-(--color-line) sm:grid-cols-2 xl:grid-cols-4">
        {data.steps.map((step, i) => {
          const isNext = step === next;
          return (
            <li key={step.key} className={cn('bg-white', isNext && 'bg-brand-50/70')}>
              <Link href={step.href} className="flex h-full items-start gap-3 px-4 py-3 hover:bg-brand-50">
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    step.done ? 'bg-emerald-500 text-white' : isNext ? 'bg-brand-600 text-white' : 'bg-(--color-surface-sunken) text-(--color-text-muted)',
                  )}
                >
                  {step.done ? '✓' : i + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn('block text-sm font-semibold', step.done ? 'text-(--color-text-muted)' : 'text-heading')}>
                    {step.label}
                    {step.done && <span className="ml-1.5 text-xs font-normal">({step.count})</span>}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-(--color-text-muted)">{step.done ? 'Bajarildi' : step.hint}</span>
                  {isNext && <span className="mt-1 inline-block text-xs font-semibold text-brand-700">Boshlash →</span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}