'use client';

import { ActionButton, PillTabs } from '@/components/report/report';
import { cn } from '@/lib/utils';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Qo'shimchalar oynasi: yon paneldan tashqari hamma joyni egallaydi (sahifa sarlavhasi va kartalar ko'rinmaydi) —
// o'z yorliqlari va «Chiqish» tugmasi bilan. Esc ham yopadi (ichida ochilgan oyna bo'lsa — avval o'sha).
// ═══════════════════════════════════════════════════════════

export function ExtrasOverlay<T extends string>({
  title,
  badge,
  value,
  options,
  onChange,
  onClose,
  children,
}: {
  title: string;
  badge?: ReactNode;
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  // Yon paneldan tashqari hamma joy: asosiy maydon (<main>) o'lchami — yon panel yig'ilsa/kengaysa ham kuzatiladi
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const main = panel.current?.closest('main');
    if (!main) return;
    const measure = () => {
      const r = main.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(main);
    window.addEventListener('resize', measure);
    const prev = main.style.overflow;
    main.style.overflow = 'hidden';
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      main.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== panel.current) return;
      event.preventDefault();
      close.current();
    };
    document.addEventListener('keydown', onKey);
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div
      ref={panel}
      tabIndex={-1}
      className={cn('fixed inset-0 z-40 overflow-y-auto bg-(--color-surface-muted) outline-none', !box && 'invisible')}
      style={box ? { top: box.top, left: box.left, width: box.width, height: box.height, right: 'auto', bottom: 'auto' } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <header className="sticky top-0 z-10 border-b border-(--color-line) bg-white/95 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 md:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-heading">{title}</h2>
            {badge && <p className="text-xs text-(--color-text-muted)">{badge}</p>}
          </div>
          <ActionButton onClick={onClose} title="Asosiy sahifaga qaytish (Esc)">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
            Chiqish
          </ActionButton>
        </div>
        <PillTabs value={value} onChange={onChange} options={options} className="px-4 py-3 md:px-6" />
      </header>
      <div className="space-y-4 p-4 md:p-6">{children}</div>
    </div>
  );
}
