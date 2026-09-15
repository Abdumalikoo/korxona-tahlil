'use client';

import { IconChevronLeft, IconChevronRight } from '@/components/ui/icons';
import { currentPeriod, formatPeriod, shiftPeriod } from '@/lib/format';

interface PeriodPickerProps {
  value: string;
  onChange: (period: string) => void;
}

/**
 * Davr tanlagich: ‹ Sentabr 2026 ›
 *
 * Strelkalar bilan oyma-oy siljiydi. Kelajakdagi oylarga
 * o'tishga ruxsat berilmaydi - u yerda ma'lumot bo'lmaydi.
 */
export function PeriodPicker({ value, onChange }: PeriodPickerProps) {
  const isCurrentOrFuture = value >= currentPeriod();

  return (
    <div className="inline-flex items-center rounded-[--radius-control] border border-[--color-line-strong] bg-white">
      <button
        type="button"
        onClick={() => onChange(shiftPeriod(value, -1))}
        className="flex size-9 items-center justify-center rounded-l-[--radius-control] text-[--color-text-muted] transition-colors hover:bg-[--color-surface-sunken] hover:text-[--color-text]"
        aria-label="Oldingi oy"
      >
        <IconChevronLeft className="size-4" />
      </button>

      <span className="min-w-[7.5rem] px-2 text-center text-sm font-medium text-[--color-text]">
        {formatPeriod(value)}
      </span>

      <button
        type="button"
        onClick={() => onChange(shiftPeriod(value, 1))}
        disabled={isCurrentOrFuture}
        className="flex size-9 items-center justify-center rounded-r-[--radius-control] text-[--color-text-muted] transition-colors hover:bg-[--color-surface-sunken] hover:text-[--color-text] disabled:cursor-not-allowed disabled:text-[--color-text-faint] disabled:hover:bg-transparent"
        aria-label="Keyingi oy"
      >
        <IconChevronRight className="size-4" />
      </button>
    </div>
  );
}
