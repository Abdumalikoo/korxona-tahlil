'use client';

import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import { IconAlert, IconClose } from './icons';

interface ToastProps {
  message: string;
  tone?: 'success' | 'error';
  onClose: () => void;
  /** Necha millisekunddan keyin o'zi yopiladi; 0 - yopilmaydi */
  duration?: number;
}

export function Toast({ message, tone = 'success', onClose, duration = 3000 }: ToastProps) {
  useEffect(() => {
    if (duration <= 0) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose, message]);

  return (
    <div
      role="status"
      className={cn(
        'fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-[--radius-card]',
        'border px-4 py-3 shadow-lg',
        tone === 'success'
          ? 'border-[--color-income] bg-[--color-income-soft] text-[--color-income]'
          : 'border-[--color-expense] bg-[--color-expense-soft] text-[--color-expense]',
      )}
    >
      {tone === 'error' && <IconAlert className="size-4 shrink-0" />}
      <span className="text-sm font-medium">{message}</span>
      <button
        type="button"
        onClick={onClose}
        className="ml-1 opacity-60 transition-opacity hover:opacity-100"
        aria-label="Yopish"
      >
        <IconClose className="size-3.5" />
      </button>
    </div>
  );
}
