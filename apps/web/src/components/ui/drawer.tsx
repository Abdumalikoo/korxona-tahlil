'use client';

import { cn } from '@/lib/utils';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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

/** data-skip-focus — ochilganda kursor qo'yilmaydi (masalan, ro'yxat ichidagi qidiruv: panel yuqoridan ko'rinsin) */
const FIELD = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([disabled]):not([readonly]):not([data-skip-focus]), select:not([disabled]):not([data-skip-focus]), textarea:not([disabled]):not([readonly]):not([data-skip-focus])';

/** Pastki paneldagi asosiy tugma: data-save → type=submit → oxirgi asosiy (ko'k) tugma */
function primaryButton(footer: HTMLElement | null, next: boolean): HTMLButtonElement | null {
  if (!footer) return null;
  if (next) {
    const n = footer.querySelector<HTMLButtonElement>('button[data-save-next]:not(:disabled)');
    if (n) return n;
  }
  return (
    footer.querySelector<HTMLButtonElement>('button[data-save]:not(:disabled)') ??
    footer.querySelector<HTMLButtonElement>('button[type="submit"]:not(:disabled)') ??
    [...footer.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter((b) => b.className.includes('bg-brand-600')).pop() ??
    null
  );
}

/**
 * O'ng tomondan chiqadigan panel.
 *
 * Ro'yxatdan chiqmasdan yozuvni ko'rish va tahrirlash uchun. Hamma formalarda bir xil:
 *  • ochilganda birinchi maydon tayyor turadi (kursor shu yerda);
 *  • Ctrl+S — saqlash, Ctrl+Enter — «Saqlash va yana» (bo'lsa);
 *  • Esc, fonni bosish yoki × — yopish; kiritilgan narsa saqlanmagan bo'lsa, avval so'raladi;
 *  • ochiq turganda sahifa aylanmaydi.
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
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  /** Foydalanuvchi biror maydonni o'zgartirdimi */
  const dirty = useRef(false);
  const [asking, setAsking] = useState(false);
  const [hasSave, setHasSave] = useState(false);

  // Yopishga urinish: o'zgartirilgan bo'lsa — avval so'raymiz
  const requestClose = useCallback(() => {
    if (dirty.current && primaryButton(foot.current, false)) setAsking(true);
    else onClose();
  }, [onClose]);

  const topmost = () => {
    const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
    return dialogs[dialogs.length - 1] === panel.current;
  };

  // Har ochilishda — toza holat
  useEffect(() => {
    if (!open) return;
    dirty.current = false;
    setAsking(false);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleKey(event: KeyboardEvent) {
      if (!topmost()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (asking) setAsking(false);
        else requestClose();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const isS = event.key === 's' || event.key === 'S' || event.code === 'KeyS';
      if (!isS && event.key !== 'Enter') return;
      const button = primaryButton(foot.current, event.key === 'Enter');
      if (!button) return;
      event.preventDefault();
      button.click();
    }

    document.addEventListener('keydown', handleKey);
    // Panel ochiq turganda orqa fon aylanmasin
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previous;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, requestClose, asking]);

  // Ochilganda: birinchi maydonga kursor (agar forma o'zi tanlamagan bo'lsa); saqlash tugmasi bormi
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setHasSave(Boolean(primaryButton(foot.current, false)));
      if (panel.current && !panel.current.contains(document.activeElement)) {
        body.current?.querySelector<HTMLElement>(FIELD)?.focus();
      }
    }, 40);
    return () => window.clearTimeout(timer);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40">
      {/* Orqa fon */}
      <div
        className="absolute inset-0 bg-slate-900/20"
        onClick={requestClose}
        aria-hidden
      />

      {/* Panel */}
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onInput={() => {
          dirty.current = true;
        }}
        // Saqlashga yuborilgan forma — endi «saqlanmagan» emas
        onSubmitCapture={() => {
          dirty.current = false;
        }}
        className={cn(
          'absolute right-0 top-0 flex h-full flex-col bg-white shadow-xl',
          width === 'lg' ? 'w-full max-w-2xl' : 'w-full max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-(--color-line) px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-(--color-text)">{title}</h2>
            {description && (
              <p className="mt-0.5 text-xs text-(--color-text-muted)">{description}</p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {hasSave && (
              <span className="hidden text-[11px] text-(--color-text-faint) sm:inline" title="Ctrl+S — saqlash, Esc — yopish">
                <kbd className="rounded bg-(--color-surface-sunken) px-1.5 py-0.5 font-sans">Ctrl+S</kbd> saqlash
              </span>
            )}
            <button
              type="button"
              onClick={requestClose}
              className="flex size-8 shrink-0 items-center justify-center rounded-(--radius-control) text-(--color-text-muted) transition-colors hover:bg-(--color-surface-sunken) hover:text-(--color-text)"
              aria-label="Yopish"
            >
              <IconClose className="size-4" />
            </button>
          </div>
        </div>

        <div ref={body} className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {asking && (
          <div className="flex items-center gap-3 border-t border-amber-200 bg-amber-50 px-5 py-2.5 text-sm text-amber-900" role="alert">
            <span className="min-w-0 flex-1 font-medium">Kiritilgan ma&apos;lumot saqlanmagan. Yopilsinmi?</span>
            <span className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setAsking(false)}
              className="whitespace-nowrap rounded-(--radius-control) border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-amber-100"
            >
              Yo&apos;q, qolaman
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(false);
                dirty.current = false;
                onClose();
              }}
              className="whitespace-nowrap rounded-(--radius-control) bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
            >
              Ha, yopish
            </button>
            </span>
          </div>
        )}

        {footer && (
          <div
            ref={foot}
            onClickCapture={(event) => {
              const button = (event.target as HTMLElement).closest('button');
              if (button && (button.hasAttribute('data-save') || button.hasAttribute('data-save-next') || button.type === 'submit' || button === primaryButton(foot.current, false))) {
                dirty.current = false;
              }
            }}
            className="flex items-center justify-end gap-2 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3"
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}