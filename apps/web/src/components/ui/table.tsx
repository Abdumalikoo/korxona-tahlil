import { cn } from '@/lib/utils';
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from 'react';

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...props} />
    </div>
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn('border-b border-[--color-line] bg-[--color-surface-muted]', className)}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-[--color-line]', className)} {...props} />;
}

interface TrProps extends HTMLAttributes<HTMLTableRowElement> {
  clickable?: boolean;
}

export function Tr({ clickable, className, ...props }: TrProps) {
  return (
    <tr
      className={cn(
        'transition-colors',
        clickable && 'cursor-pointer hover:bg-[--color-surface-muted]',
        className,
      )}
      {...props}
    />
  );
}

interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right' | 'center';
}

export function Th({ align = 'left', className, ...props }: ThProps) {
  return (
    <th
      className={cn(
        'px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-[--color-text-muted]',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
      {...props}
    />
  );
}

interface TdProps extends TdHTMLAttributes<HTMLTableCellElement> {
  align?: 'left' | 'right' | 'center';
  /** Pul ustuni - monoshrift va o'ngga tekislash */
  money?: boolean;
}

export function Td({ align = 'left', money, className, ...props }: TdProps) {
  return (
    <td
      className={cn(
        'px-4 py-2.5 text-[--color-text]',
        money && 'money text-right',
        !money && align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...props}
    />
  );
}

/** Jadval oxiridagi yig'indi qatori */
export function TFoot({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      className={cn(
        'border-t-2 border-[--color-line-strong] bg-[--color-surface-muted] font-semibold',
        className,
      )}
      {...props}
    />
  );
}
