import { cn } from '@/lib/utils';
import type { HTMLAttributes, ReactNode } from 'react';

/** Oq karta — yumaloq burchak, yengil soya, chegarasiz */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-(--radius-card) border border-transparent bg-white shadow-card',
        className,
      )}
      {...props}
    />
  );
}

interface CardHeaderProps {
  title: string;
  description?: string;
  /** O'ng tomondagi amal tugmalari */
  actions?: ReactNode;
  className?: string;
}

export function CardHeader({ title, description, actions, className }: CardHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b border-(--color-line) px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold text-heading">{title}</h2>
        {description && (
          <p className="mt-0.5 text-xs text-(--color-text-muted)">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-end gap-2 rounded-b-(--radius-card) border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3',
        className,
      )}
      {...props}
    />
  );
}