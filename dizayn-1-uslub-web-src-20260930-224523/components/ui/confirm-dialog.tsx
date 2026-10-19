'use client';

import { useEffect } from 'react';
import { Button } from './button';
import { IconAlert } from './icons';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Tasdiqlash',
  cancelLabel = 'Bekor qilish',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !loading) onCancel();
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/30" onClick={loading ? undefined : onCancel} aria-hidden />

      <div
        role="alertdialog"
        aria-modal="true"
        className="relative w-full max-w-sm rounded-[--radius-card] bg-white p-5 shadow-xl"
      >
        <div className="flex gap-3">
          {danger && (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[--color-expense-soft]">
              <IconAlert className="size-5 text-[--color-expense]" />
            </div>
          )}

          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[--color-text]">{title}</h3>
            <p className="mt-1 text-sm text-[--color-text-muted]">{message}</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            size="sm"
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
