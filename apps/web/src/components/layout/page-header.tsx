'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PAGE_HEADER_SLOT_ID } from './top-bar';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** O'ng tomondagi amal tugmalari */
  actions?: ReactNode;
}

/**
 * Sahifa sarlavhasi.
 *
 * Sahifaning o'zida chizilmaydi — yuqori oq panelga (TopBar) joylanadi:
 * «‹ Sarlavha» katta qalin yozuvda, tagida qisqa izoh, o'ngda amal tugmalari.
 * Panel hali tayyor bo'lmasa (masalan, kirish sahifasida) — joyida chiziladi.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    setSlot(document.getElementById(PAGE_HEADER_SLOT_ID));
    setChecked(true);
  }, []);

  const content = (
    // Keng ekranda bir qatorda: sarlavha joyni egallaydi (uzun izoh qisqartiriladi), tugmalar sarlavha ostiga tushmaydi
    <div data-page-header className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-2 lg:flex-nowrap">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-2xl font-bold tracking-tight text-heading" title={title}>
          {title}
        </h1>
        {description && (
          <p className="truncate text-xs text-(--color-text-muted)" title={description}>
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );

  if (slot) return createPortal(content, slot);
  if (!checked) return null;

  // Yuqori panel yo'q joyda — oddiy oq chiziq sifatida
  return <div className="flex min-h-16 items-center border-b border-(--color-line) bg-white px-6 py-3">{content}</div>;
}