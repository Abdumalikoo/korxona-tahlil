'use client';

import { ALERTS_CHANGED, alertsApi, type AlertsResult } from '@/features/alerts/api';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Yuqori paneldagi qo'ng'iroqcha: «Muhokama talab qiladi» soni.
// Bosilganda — eng jiddiylari; «Hammasi» — Munosabat › Muhokama talab qiladi.
// ═══════════════════════════════════════════════════════════

const REFRESH_MS = 10 * 60_000;

function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

export function AlertsBell() {
  const pathname = usePathname();
  const [data, setData] = useState<AlertsResult | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    alertsApi
      .list()
      .then((r) => setData(r.data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener(ALERTS_CHANGED, load);
    return () => {
      clearInterval(timer);
      window.removeEventListener(ALERTS_CHANGED, load);
    };
  }, [load]);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const count = data?.alerts.length ?? 0;
  const high = data?.alerts.filter((a) => a.severity === 'high').length ?? 0;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-10 items-center justify-center rounded-xl border border-(--color-line) bg-(--color-surface-muted) text-brand-700 transition-colors hover:border-brand-300 hover:bg-white"
        title="Muhokama talab qiladi"
        aria-label={`Muhokama talab qiladi: ${count}`}
      >
        <BellIcon className="size-5" />
        {count > 0 && (
          <span
            className={cn(
              'absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold text-white ring-2 ring-white',
              high > 0 ? 'bg-(--color-expense)' : 'bg-tile-orange',
            )}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-12 z-50 w-[22rem] overflow-hidden rounded-2xl border border-(--color-line) bg-white shadow-xl">
          <div className="border-b border-(--color-line) px-4 py-3">
            <p className="text-sm font-bold text-heading">Muhokama talab qiladi</p>
            <p className="text-xs text-(--color-text-muted)">{count === 0 ? "Hozircha yo'q" : `${count} ta${high ? ` · ${high} tasi jiddiy` : ''}`}</p>
          </div>
          <ul className="max-h-80 divide-y divide-(--color-line) overflow-y-auto">
            {(data?.alerts ?? []).slice(0, 6).map((a) => (
              <li key={a.key}>
                <Link href={a.href ?? '/munosabat/ogohlantirish'} className="flex gap-2.5 px-4 py-2.5 hover:bg-brand-50">
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', a.severity === 'high' ? 'bg-(--color-expense)' : 'bg-tile-orange')} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-heading">{a.title}</span>
                    <span className="block truncate text-[11px] text-(--color-text-muted)">{a.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/munosabat/ogohlantirish" className="block border-t border-(--color-line) bg-(--color-surface-muted) px-4 py-2.5 text-center text-sm font-semibold text-brand-700 hover:bg-brand-50">
            Hammasi va muhokamaga qo&apos;yish →
          </Link>
        </div>
      )}
    </div>
  );
}