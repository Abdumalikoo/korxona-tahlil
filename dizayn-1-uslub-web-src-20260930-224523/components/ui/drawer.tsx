'use client';

import { cn } from '@/lib/utils';
import { useEffect, type ReactNode } from 'react';
import { IconClose } from './icons';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Pastdagi amal tugmalari */
  footer?: ReactNode;
  width?: 'md' | 'lg';
}

/**
 * O'ng tomondan chiqadigan panel.
 *
 * Ro'yxatdan chiqmasdan yozuvni ko'rish va tahrirlash uchun.
 * Esc bilan yopiladi, ochiq turganda sahifa aylanmaydi.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'md',
}: DrawerProps) {
  useEffect(() => {
    if (!open) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleEscape);
    // Panel ochiq turganda orqa fon aylanmasin
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      {/* Orqa fon */}
      <div
        className="absolute inset-0 bg-slate-900/20"
        onClick={onClose}
        aria-hidden
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'absolute right-0 top-0 flex h-full flex-col bg-white shadow-xl',
          width === 'lg' ? 'w-full max-w-2xl' : 'w-full max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[--color-line] px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[--color-text]">{title}</h2>
            {description && (
              <p className="mt-0.5 text-xs text-[--color-text-muted]">{description}</p>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-[--radius-control] text-[--color-text-muted] transition-colors hover:bg-[--color-surface-sunken] hover:text-[--color-text]"
            aria-label="Yopish"
          >
            <IconClose className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-[--color-line] bg-[--color-surface-muted] px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
