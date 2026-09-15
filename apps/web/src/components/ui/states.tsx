import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { IconAlert, IconInbox, IconSpinner } from './icons';

/** Ma'lumot yo'q holati */
export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 text-[--color-text-faint]">
        {icon ?? <IconInbox className="size-10" strokeWidth={1.5} />}
      </div>
      <p className="text-sm font-medium text-[--color-text]">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-[--color-text-muted]">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Yuklanmoqda */
export function LoadingState({ label = 'Yuklanmoqda' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-14 text-sm text-[--color-text-muted]">
      <IconSpinner className="size-4 animate-spin" />
      <span>{label}…</span>
    </div>
  );
}

/** Xato holati */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <IconAlert className="mb-3 size-10 text-[--color-expense]" strokeWidth={1.5} />
      <p className="text-sm font-medium text-[--color-text]">Xatolik yuz berdi</p>
      <p className="mt-1 max-w-sm text-sm text-[--color-text-muted]">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 text-sm font-medium text-brand-700 hover:underline"
        >
          Qayta urinish
        </button>
      )}
    </div>
  );
}

/** Skelet - jadval yuklanayotganda */
export function TableSkeleton({ rows = 5, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="divide-y divide-[--color-line]">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((_, colIndex) => (
            <div
              key={colIndex}
              className={cn(
                'h-4 animate-pulse rounded bg-[--color-surface-sunken]',
                colIndex === 0 ? 'w-1/4' : 'flex-1',
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
