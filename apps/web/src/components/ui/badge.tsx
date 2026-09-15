import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

type BadgeTone = 'neutral' | 'income' | 'expense' | 'warn' | 'brand';

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-[--color-surface-sunken] text-[--color-text-muted]',
  income: 'bg-[--color-income-soft] text-[--color-income]',
  expense: 'bg-[--color-expense-soft] text-[--color-expense]',
  warn: 'bg-[--color-warn-soft] text-[--color-warn]',
  brand: 'bg-brand-50 text-brand-800',
};

export function Badge({ children, tone = 'neutral', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Xarajat turi belgisi - doimiy / o'zgaruvchan / aralash */
export function BehaviorBadge({ behavior }: { behavior: string }) {
  const map: Record<string, { label: string; tone: BadgeTone }> = {
    FIXED: { label: 'Doimiy', tone: 'brand' },
    VARIABLE: { label: "O'zgaruvchan", tone: 'warn' },
    MIXED: { label: 'Aralash', tone: 'neutral' },
  };

  const config = map[behavior] ?? { label: behavior, tone: 'neutral' as BadgeTone };

  return <Badge tone={config.tone}>{config.label}</Badge>;
}

/** To'lov holati belgisi */
export function PaymentBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: BadgeTone }> = {
    PAID: { label: "To'langan", tone: 'income' },
    PARTIAL: { label: 'Qisman', tone: 'warn' },
    UNPAID: { label: "To'lanmagan", tone: 'expense' },
  };

  const config = map[status] ?? { label: status, tone: 'neutral' as BadgeTone };

  return <Badge tone={config.tone}>{config.label}</Badge>;
}
