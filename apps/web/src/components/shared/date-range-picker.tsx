'use client';

import { IconCalendar, IconChevronDown } from '@/components/ui/icons';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';

export interface DateRange {
  from: string;
  to: string;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  className?: string;
}

const TASHKENT_OFFSET_HOURS = 5;

/** Bugungi sanani YYYY-MM-DD ko'rinishida qaytaradi */
function today(): string {
  const now = new Date(Date.now() + TASHKENT_OFFSET_HOURS * 3600_000);
  return now.toISOString().slice(0, 10);
}

/** Yil boshi */
function yearStart(): string {
  const now = new Date(Date.now() + TASHKENT_OFFSET_HOURS * 3600_000);
  return `${now.getUTCFullYear()}-01-01`;
}

/** N oy oldingi sana */
function monthsAgo(count: number): string {
  const now = new Date(Date.now() + TASHKENT_OFFSET_HOURS * 3600_000);
  now.setUTCMonth(now.getUTCMonth() - count);
  return now.toISOString().slice(0, 10);
}

/** Standart oraliq — yil boshidan bugungacha */
export function defaultRange(): DateRange {
  return { from: yearStart(), to: today() };
}

const presets = [
  { label: 'Yil boshidan', range: () => ({ from: yearStart(), to: today() }) },
  { label: 'Oxirgi 3 oy', range: () => ({ from: monthsAgo(3), to: today() }) },
  { label: 'Oxirgi 6 oy', range: () => ({ from: monthsAgo(6), to: today() }) },
  { label: 'Oxirgi 12 oy', range: () => ({ from: monthsAgo(12), to: today() }) },
  {
    label: "O'tgan yil",
    range: () => {
      const year = new Date().getFullYear() - 1;
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    },
  },
];

/**
 * Sana oralig'i tanlagichi.
 *
 * Standart holat — yil boshidan bugungacha. Tez tanlash
 * tugmalari va kalendar maydonlari bor.
 */
export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateRange>(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // Tashqariga bosilsa yopiladi
  useEffect(() => {
    if (!open) return;

    function handleClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function apply(range: DateRange) {
    onChange(range);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((state) => !state)}
        className="flex h-9 items-center gap-2 rounded-[--radius-control] border border-[--color-line-strong] bg-white px-3 text-sm transition-colors hover:bg-[--color-surface-sunken]"
      >
        <IconCalendar className="size-4 text-[--color-text-muted]" />

        <span className="money whitespace-nowrap">
          {formatDate(value.from)} &mdash; {formatDate(value.to)}
        </span>

        <IconChevronDown
          className={cn(
            'size-4 text-[--color-text-muted] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-80 rounded-[--radius-card] border border-[--color-line] bg-white p-3 shadow-lg">
          {/* Tez tanlash */}
          <div className="space-y-1">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => apply(preset.range())}
                className="w-full rounded-[--radius-control] px-3 py-2 text-left text-sm transition-colors hover:bg-[--color-surface-sunken]"
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="my-3 border-t border-[--color-line]" />

          {/* Qo'lda tanlash */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-[--color-text-muted]">
                  Dan
                </label>
                <input
                  type="date"
                  value={draft.from}
                  max={draft.to}
                  onChange={(event) =>
                    setDraft((state) => ({ ...state, from: event.target.value }))
                  }
                  className="w-full rounded-[--radius-control] border border-[--color-line-strong] px-2 py-1.5 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-[--color-text-muted]">
                  Gacha
                </label>
                <input
                  type="date"
                  value={draft.to}
                  min={draft.from}
                  onChange={(event) =>
                    setDraft((state) => ({ ...state, to: event.target.value }))
                  }
                  className="w-full rounded-[--radius-control] border border-[--color-line-strong] px-2 py-1.5 text-sm"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => apply(draft)}
              disabled={!draft.from || !draft.to}
              className="w-full rounded-[--radius-control] bg-brand-800 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-900 disabled:bg-brand-300"
            >
              Qo&rsquo;llash
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
