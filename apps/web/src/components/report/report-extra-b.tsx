'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Hisobot uslubi uchun qo'shimcha bo'laklar (Tahlil: tarkib, samaradorlik, xulosa)
// ═══════════════════════════════════════════════════════════

/** Ichma-ich yo'l: Jami › Guruh › Modda (oxirgisi — joriy daraja) */
export function PathCrumbs({ items, onJump, hint }: { items: string[]; onJump: (depth: number) => void; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--color-line) bg-[#f8f9fc] px-5 py-2.5">
      <nav className="flex min-w-0 flex-wrap items-center gap-1 text-sm" aria-label="Yo'l">
        {items.map((label, i) => {
          const last = i === items.length - 1;
          return (
            <span key={`${label}-${i}`} className="inline-flex items-center gap-1">
              {i > 0 && <span className="text-(--color-text-faint)">›</span>}
              <button
                type="button"
                disabled={last}
                onClick={() => onJump(i)}
                title={label}
                className={cn(
                  'max-w-[18rem] truncate rounded-md px-2 py-0.5',
                  last ? 'bg-brand-600 font-semibold text-white' : 'font-medium text-brand-700 hover:bg-brand-50',
                )}
              >
                {label}
              </button>
            </span>
          );
        })}
      </nav>
      {hint && <p className="text-xs text-(--color-text-muted)">{hint}</p>}
    </div>
  );
}

/** Raqamlangan xulosalar (karta ichida) */
export function NotesList({ notes, className, start = 1 }: { notes: string[]; className?: string; start?: number }) {
  if (notes.length === 0) return null;
  return (
    <ol className={cn('space-y-2 px-5 pb-5 text-sm leading-relaxed text-(--color-text)', className)}>
      {notes.map((note, i) => (
        <li key={`${i}-${note}`} className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{start + i}</span>
          <span className="pt-0.5">{note}</span>
        </li>
      ))}
    </ol>
  );
}

/** Kichik holat nishoni (Chegarada, Zararda …) */
export function StatusBadge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'green' | 'red' | 'amber' | 'blue' | 'muted' }) {
  const tones = {
    green: 'bg-[#e3f5ea] text-[#0b7a3b]',
    red: 'bg-[#fdecec] text-[#c22f34]',
    amber: 'bg-[#fff3df] text-[#b45309]',
    blue: 'bg-brand-50 text-brand-700',
    muted: 'bg-(--color-surface-sunken) text-(--color-text-muted)',
  };
  return <span className={cn('inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', tones[tone])}>{children}</span>;
}

/** Kartaning ichki bo'lim sarlavhasi (bir karta ichida bir nechta jadval) */
export function SubTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pb-2 pt-1">
      <h4 className="text-sm font-semibold text-heading">{children}</h4>
      {aside && <span className="text-xs text-(--color-text-muted)">{aside}</span>}
    </div>
  );
}

/** Ichki kichik tugma (Batafsil …) */
export function MiniButton({ children, onClick, title }: { children: ReactNode; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="whitespace-nowrap rounded-md border border-brand-200 bg-white px-2 py-0.5 text-xs font-semibold text-brand-700 hover:bg-brand-50"
    >
      {children}
    </button>
  );
}

/** Bo'sh holat (jadval o'rniga) */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="px-5 pb-6 pt-2 text-center text-sm text-(--color-text-muted)">{children}</p>;
}

/** Foiz matni: 12,3% */
export function pctPlain(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return `${value.toFixed(digits).replace('.', ',')}%`;
}

/** Foiz punkt farqi: +1,2 p.p. */
export function ppText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(1).replace('.', ',')} p.p.`;
}
