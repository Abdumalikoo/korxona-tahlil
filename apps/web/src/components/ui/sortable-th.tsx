'use client';

import { Th } from './table';
import { cn } from '@/lib/utils';

interface SortableThProps {
  children: React.ReactNode;
  /** Shu ustunning saralash kaliti */
  field: string;
  /** Joriy saralanayotgan ustun */
  activeField?: string;
  activeOrder?: 'asc' | 'desc';
  onSort: (field: string) => void;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

/**
 * Bosilganda saralaydigan ustun sarlavhasi.
 *
 * Birinchi bosishda kamayish, ikkinchisida o'sish tartibi.
 * Faol ustun strelka bilan belgilanadi.
 */
export function SortableTh({
  children,
  field,
  activeField,
  activeOrder,
  onSort,
  align = 'left',
  className,
}: SortableThProps) {
  const active = activeField === field;

  return (
    <Th align={align} className={cn('p-0', className)}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'flex w-full items-center gap-1 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide transition-colors',
          'hover:text-[--color-text]',
          active ? 'text-[--color-text]' : 'text-[--color-text-muted]',
          align === 'right' && 'justify-end',
          align === 'center' && 'justify-center',
        )}
      >
        {children}
        <span
          className={cn(
            'text-[10px] transition-opacity',
            active ? 'opacity-100' : 'opacity-0',
          )}
          aria-hidden
        >
          {activeOrder === 'asc' ? '\u25B2' : '\u25BC'}
        </span>
      </button>
    </Th>
  );
}
