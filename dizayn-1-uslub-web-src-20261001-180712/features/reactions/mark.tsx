'use client';

import { cn } from '@/lib/utils';
import type { MarkItem } from './api';
import { useReactionSelect } from './select-context';

/**
 * Munosabat belgisi — faqat belgilash rejimi yoqilganda ko'rinadi.
 * Bosilganda modda joriy savatga qo'shiladi yoki olib tashlanadi.
 */
export function Mark({ item, className, label }: { item: MarkItem | null; className?: string; label?: string }) {
  const select = useReactionSelect();
  if (!select?.active || !item) return null;
  const marked = select.isMarked(item);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        select.toggle(item);
      }}
      title={marked ? `Savatdan olib tashlash: ${item.label}` : `Munosabatga belgilash: ${item.label}`}
      aria-pressed={marked}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-[4px] border text-[11px] font-semibold transition-colors',
        label ? 'px-2 py-0.5' : 'size-[18px] justify-center',
        marked ? 'border-amber-600 bg-amber-500 text-white' : 'border-amber-500 bg-amber-50 text-amber-700 hover:bg-amber-100',
        className,
      )}
    >
      <svg viewBox="0 0 16 16" className="size-3" aria-hidden>
        {marked ? (
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
        )}
      </svg>
      {label}
    </button>
  );
}

/** Belgilash rejimi yoqilganmi (qator rangini o'zgartirish va h.k. uchun) */
export function useMarkMode(): boolean {
  return Boolean(useReactionSelect()?.active);
}