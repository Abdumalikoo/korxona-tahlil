'use client';

import { introFor } from '@/features/help/intros';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Sahifa tepasidagi qisqa tushuntirish (features/help/intros.ts):
// nima ko'rsatadi, ma'lumot qayerdan, qanday ishlatiladi.
// «Yashirish» bosilsa — shu sahifa uchun kichik «ⓘ Bu sahifa haqida» havolasiga aylanadi (brauzerda eslab qolinadi).
// ═══════════════════════════════════════════════════════════

const KEY = 'korxona_intro_hidden';

function readHidden(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeHidden(list: string[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // eslab qolinmasa ham ishlayveradi
  }
}


export function PageIntro({ placement = 'top' }: { placement?: 'top' | 'bottom' }) {
  const pathname = usePathname() ?? '/';
  const { canView } = useAuth();
  // Izoh hamma sahifada pastda turadi — asosiy raqamlar birinchi ko'rinsin (tepadagi joy bo'sh qoladi)
  const wrong = placement !== 'bottom';
  const intro = wrong ? null : introFor(pathname);
  const [hidden, setHidden] = useState<string[] | null>(null);

  useEffect(() => setHidden(readHidden()), []);

  // Birinchi chizishda (eslab qolingan holat o'qilmaguncha) — hech narsa, «sakrash» bo'lmasin
  if (!intro || hidden === null) return null;
  const isHidden = hidden.includes(pathname);

  const toggle = (hide: boolean) => {
    const next = hide ? [...new Set([...hidden, pathname])] : hidden.filter((p) => p !== pathname);
    setHidden(next);
    writeHidden(next);
  };

  if (isHidden) {
    return (
      <div className={cn('no-print flex justify-end px-4 md:px-6', placement === 'bottom' ? 'pt-1' : 'pt-3')}>
        <button type="button" onClick={() => toggle(false)} className="text-xs font-medium text-(--color-text-muted) hover:text-brand-700 hover:underline">
          ⓘ Bu sahifa haqida
        </button>
      </div>
    );
  }

  return (
    <div className={cn('no-print px-4 md:px-6', placement === 'bottom' ? 'pt-2' : 'pt-4')}>
      <div className="flex gap-3 rounded-(--radius-card) border border-sky-200 bg-sky-50/70 px-4 py-3">
        <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[11px] font-bold text-white">i</span>
        <div className="min-w-0 flex-1 space-y-0.5 text-sm">
          <p className="text-heading">{intro.what}</p>
          <p className="text-xs text-(--color-text-muted)">
            <span className="font-semibold">Ma&apos;lumot:</span> {intro.from}
            {intro.how && (
              <>
                {' · '}
                <span className="font-semibold">Qanday:</span> {intro.how}
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-start sm:gap-3">
          {canView('/formulalar') && (
            <Link href="/formulalar" className="whitespace-nowrap text-xs font-medium text-sky-700 hover:underline">
              Formulalar
            </Link>
          )}
          <button type="button" onClick={() => toggle(true)} className="whitespace-nowrap text-xs font-medium text-(--color-text-muted) hover:text-heading" title="Bu sahifa uchun yashirish">
            Yashirish ✕
          </button>
        </div>
      </div>
    </div>
  );
}