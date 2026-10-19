import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Yig'indi kartasi: yuqorida nomi, ostida qatorlar —
// har birida kichik rangli belgi, izoh ("Summasi", "Soni") va katta qiymat.
// Bosilsa — tegishli sahifaga o'tadi.
// ═══════════════════════════════════════════════════════════

export type SummaryAccent = 'income' | 'expense' | 'brand' | 'orange' | 'purple' | 'cyan' | 'pink';

/** Belgi foni va rangi, yuqoridagi ingichka chiziq */
const ACCENT: Record<SummaryAccent, { tile: string; bar: string }> = {
  income: { tile: 'bg-(--color-income-soft) text-(--color-income)', bar: 'bg-(--color-income)' },
  expense: { tile: 'bg-(--color-expense-soft) text-(--color-expense)', bar: 'bg-(--color-expense)' },
  brand: { tile: 'bg-brand-50 text-brand-600', bar: 'bg-brand-500' },
  orange: { tile: 'bg-(--color-warn-soft) text-tile-orange', bar: 'bg-tile-orange' },
  purple: { tile: 'bg-violet-50 text-tile-purple', bar: 'bg-tile-purple' },
  cyan: { tile: 'bg-cyan-50 text-tile-cyan', bar: 'bg-tile-cyan' },
  pink: { tile: 'bg-pink-50 text-pink-600', bar: 'bg-pink-500' },
};

export interface SummaryRow {
  label: string;
  value: ReactNode;
  icon: ReactNode;
}

interface SummaryCardProps {
  title: string;
  rows: SummaryRow[];
  accent?: SummaryAccent;
  /** Pastki qator: o'zgarish, ulush va h.k. */
  footer?: ReactNode;
  href?: string;
  /** O'ng yuqori burchakda (masalan, Munosabat belgisi) */
  corner?: ReactNode;
  loading?: boolean;
  className?: string;
}

export function SummaryCard({ title, rows, accent = 'brand', footer, href, corner, loading, className }: SummaryCardProps) {
  const tone = ACCENT[accent];

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-heading">{title}</h3>
        {corner && <span className="relative z-10 shrink-0">{corner}</span>}
      </div>

      <dl className="mt-4 space-y-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3">
            <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl [&_svg]:size-5', tone.tile)}>{row.icon}</span>
            <div className="min-w-0">
              <dt className="text-[11px] text-(--color-text-faint)">{row.label}</dt>
              <dd className="text-lg font-bold leading-tight text-heading">
                {loading ? <span className="inline-block h-5 w-28 animate-pulse rounded bg-(--color-surface-sunken)" /> : row.value}
              </dd>
            </div>
          </div>
        ))}
      </dl>

      {footer && !loading && <div className="mt-4 border-t border-(--color-line) pt-3 text-xs text-(--color-text-muted)">{footer}</div>}
    </>
  );

  const base = cn('relative flex flex-col rounded-(--radius-card) bg-white p-5 shadow-card', className);

  const bar = <span className={cn('absolute inset-x-5 top-0 h-1 rounded-b-full', tone.bar)} aria-hidden="true" />;

  if (!href) {
    return (
      <div className={base}>
        {bar}
        {body}
      </div>
    );
  }

  return (
    <div className={cn(base, 'group transition-all hover:-translate-y-0.5 hover:shadow-lg')}>
      {/* Butun karta — havola */}
      {bar}
      <Link href={href} className="absolute inset-0 z-0 rounded-(--radius-card)" aria-label={title} />
      <div className="pointer-events-none relative flex flex-1 flex-col [&_a]:pointer-events-auto [&_button]:pointer-events-auto">{body}</div>
    </div>
  );
}

/** "Summasi" belgisi — hamyon */
export function SumIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2" />
      <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

/** "Soni" belgisi — yozuvlar taxlami */
export function CountIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </svg>
  );
}