'use client';

import { CalcValue } from '@/components/ui/calc';
import type { Calc } from '@/lib/calc';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { sum, Td } from './report';

// ═══════════════════════════════════════════════════════════
// Hisobot jadvali uchun qo'shimcha katakchalar (Tahlil sahifalari):
//  • bosiladigan summa (yozuvlar ochiladi);
//  • ochiladigan daraxt qatori nomi (▸ / ▾, pog'ona bo'yicha surilgan).
// ═══════════════════════════════════════════════════════════

/** Chapda qotib turadigan nom ustuni (№ ustunisiz jadvallar uchun) */
export const STICKY_LEFT = 'sticky left-0 z-[1] shadow-[1px_0_0_var(--color-line)]';

/** Bosiladigan summa: bosilsa — shu summani tashkil qilgan yozuvlar */
export function LinkMoneyCell({
  value,
  onClick,
  strong,
  signedColor,
  calc,
  className,
  title,
}: {
  value: number;
  onClick?: () => void;
  strong?: boolean;
  /** Musbat — yashil, manfiy — qizil */
  signedColor?: boolean;
  calc?: Calc | null;
  className?: string;
  title?: string;
}) {
  const tone = signedColor ? (value < 0 ? 'text-(--color-expense)' : value > 0 ? 'text-(--color-income)' : '') : '';
  if (!value) {
    return <Td className={cn('whitespace-nowrap text-(--color-text-faint)', className)}></Td>;
  }
  return (
    <Td className={cn('whitespace-nowrap', strong && 'font-semibold', tone, className)}>
      {onClick ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          title={title ?? "Yozuvlarni ko'rish"}
          className="-mx-1 rounded px-1 tabular-nums hover:bg-brand-50 hover:text-brand-700 hover:underline"
        >
          {sum(value)}
        </button>
      ) : (
        <CalcValue calc={calc} className="no-underline">
          {sum(value)}
        </CalcValue>
      )}
    </Td>
  );
}

/** Daraxt qatori nomi: pog'onasiga qarab suriladi, bolalari bo'lsa — ochib-yopish tugmasi */
export function TreeNameCell({
  children,
  depth = 0,
  open,
  onToggle,
  sticky = STICKY_LEFT,
  className,
  sub,
}: {
  children: ReactNode;
  depth?: number;
  /** undefined — bolasi yo'q */
  open?: boolean;
  onToggle?: () => void;
  sticky?: string;
  className?: string;
  sub?: ReactNode;
}) {
  return (
    <td className={cn('border-b border-(--color-line) px-2 py-2 text-left text-[13px]', sticky, className)}>
      <span className="flex min-w-0 items-center gap-1" style={{ paddingLeft: depth * 16 }}>
        {onToggle ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-expanded={open}
            className="flex size-5 shrink-0 items-center justify-center rounded text-(--color-text-muted) hover:bg-brand-50 hover:text-brand-700"
          >
            <span className={cn('inline-block text-sm leading-none transition-transform', open && 'rotate-90')}>›</span>
          </button>
        ) : (
          <span className="size-5 shrink-0" />
        )}
        <span className="min-w-0">
          <span className="block truncate" title={typeof children === 'string' ? children : undefined}>
            {children}
          </span>
          {sub && <span className="block truncate text-[11px] font-normal text-(--color-text-faint)">{sub}</span>}
        </span>
      </span>
    </td>
  );
}
