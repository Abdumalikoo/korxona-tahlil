import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { IconAlert, IconInbox, IconSpinner } from './icons';

/**
 * Bo'sh holat uchun tayyor yo'l-yo'riq:
 *  period — bu davrda ma'lumot yo'q: davrni o'zgartirish yoki Manba'da kiritish;
 *  upload — bu oyga hali yuklanmagan: shablon → to'ldirish → yuklash;
 *  search — qidiruv/filtr bo'yicha topilmadi.
 */
export type EmptyHint = 'period' | 'upload' | 'search';

const HINTS: Record<EmptyHint, { text: string; button?: string }> = {
  period: {
    text: "Yuqoridagi «Davr»ni o'zgartirib ko'ring. Ma'lumot hali kiritilmagan bo'lsa — Manba › Daromadlar yoki Xarajatlar bo'limida qo'shing.",
    button: "Davrni o'zgartirish",
  },
  upload: {
    text: "Shablonni yuklab oling, to'ldiring va «Yuklash» tugmasi bilan yuklang. Boshqa oy kerak bo'lsa — yuqoridagi oyni o'zgartiring.",
    button: "Oyni o'zgartirish",
  },
  search: { text: "Qidiruv so'zini yoki filtrlarni o'zgartirib ko'ring." },
};

/** Ma'lumot yo'q holati */
export function EmptyState({
  title,
  description,
  action,
  icon,
  hint,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  /** Tayyor yo'l-yo'riq (description berilmagan bo'lsa ko'rsatiladi) */
  hint?: EmptyHint;
}) {
  const h = hint ? HINTS[hint] : null;
  const text = description ?? h?.text;
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 text-(--color-text-faint)">
        {icon ?? <IconInbox className="size-10" strokeWidth={1.5} />}
      </div>
      <p className="text-sm font-medium text-(--color-text)">{title}</p>
      {text && (
        <p className="mt-1 max-w-sm text-sm text-(--color-text-muted)">{text}</p>
      )}
      {action ? (
        <div className="mt-4">{action}</div>
      ) : h?.button ? (
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event('korxona:period-open'))}
          className="mt-4 rounded-(--radius-control) border border-brand-300 bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-100"
        >
          {h.button}
        </button>
      ) : null}
    </div>
  );
}

/** Yuklanmoqda */
export function LoadingState({ label = 'Yuklanmoqda' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-14 text-sm text-(--color-text-muted)">
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
      <IconAlert className="mb-3 size-10 text-(--color-expense)" strokeWidth={1.5} />
      <p className="text-sm font-medium text-(--color-text)">Xatolik yuz berdi</p>
      <p className="mt-1 max-w-sm text-sm text-(--color-text-muted)">{message}</p>
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
    <div className="divide-y divide-(--color-line)">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 px-4 py-3">
          {Array.from({ length: cols }).map((_, colIndex) => (
            <div
              key={colIndex}
              className={cn(
                'h-4 animate-pulse rounded bg-(--color-surface-sunken)',
                colIndex === 0 ? 'w-1/4' : 'flex-1',
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}