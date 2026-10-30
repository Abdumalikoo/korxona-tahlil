'use client';

import { IconLogout, IconMenu, IconSearch } from '@/components/ui/icons';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AlertsBell } from './alerts-bell';
import { titleFor } from './nav-config';
import { PeriodControl } from './period-control';
import { QuickAddButton } from './quick-add';
import { HomeOnlyToggle, ViewModeToggle } from './view-mode-toggle';
import { useViewMode } from '@/lib/view-mode';

// ═══════════════════════════════════════════════════════════
// Yuqori oq panel:
//  chapda  — «‹» orqaga va sahifa sarlavhasi (PageHeader shu yerga joylanadi);
//  o'ngda  — «+ Kiritish» (N), davr, rejim, global qidiruv (Ctrl+K), foydalanuvchi ismi, roli va avatar, «▴» (panelni yashirish).
// Ko'rsatuv sahifalarida (quiet — Bosh sahifa, Solishtirma) «Kiritish» va foydalanuvchi roli chiqmaydi.
// ═══════════════════════════════════════════════════════════

/** PageHeader o'z sarlavhasini shu elementga joylaydi */
export const PAGE_HEADER_SLOT_ID = 'page-header-slot';

/** Global qidiruvni ochish (GlobalSearch shu hodisani tinglaydi) */
export function openGlobalSearch() {
  window.dispatchEvent(new Event('global-search:open'));
}

function UserMenu({ quiet = false }: { quiet?: boolean }) {
  const { user, logout, isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const name = user?.fullName ?? '';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-3 rounded-xl py-1 pl-2 pr-1 text-right transition-colors hover:bg-(--color-surface-muted)"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="hidden min-w-0 2xl:block">
          <span className="block max-w-[13rem] truncate text-sm font-bold uppercase tracking-wide text-heading">{name}</span>
          {!quiet && <span className="block text-xs italic text-(--color-text-muted)">{isAdmin ? 'Administrator' : 'Kuzatuvchi'}</span>}
        </span>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-md ring-2 ring-white">
          {initials || '?'}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-14 z-50 w-64 overflow-hidden rounded-2xl border border-(--color-line) bg-white shadow-xl" role="menu">
          <div className="border-b border-(--color-line) px-4 py-3">
            <p className="truncate text-sm font-semibold text-heading">{name}</p>
            {!quiet && <p className="text-xs text-(--color-text-muted)">{isAdmin ? 'Administrator' : 'Kuzatuvchi'}</p>}
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            className="flex w-full items-center gap-2.5 px-4 py-3 text-sm text-(--color-text) transition-colors hover:bg-brand-50 hover:text-brand-700"
          >
            <IconLogout className="size-4" />
            Chiqish
          </button>
        </div>
      )}
    </div>
  );
}

export function TopBar({ onMenu, onHide, quiet = false }: { onMenu: () => void; onHide?: () => void; quiet?: boolean }) {
  /** «Faqat Bosh sahifa» — boshqa bo'limlarga olib boradigan tugmalar yashiriladi */
  const { homeOnly } = useViewMode();
  const pathname = usePathname();
  const router = useRouter();
  const fallback = titleFor(pathname);
  const isHome = pathname === '/';

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push('/');
  };

  return (
    <header className="topbar border-b border-(--color-line) bg-white/95 backdrop-blur">
      <div className="flex min-h-[72px] flex-wrap items-center gap-3 px-4 py-2 sm:flex-nowrap md:px-6">
        {/* Kichik ekranda menyu */}
        <button
          type="button"
          onClick={onMenu}
          className="flex size-10 shrink-0 items-center justify-center rounded-xl text-brand-700 hover:bg-brand-50 md:hidden"
          aria-label="Menyuni ochish"
        >
          <IconMenu className="size-5" />
        </button>

        {!isHome && (
          <button
            type="button"
            onClick={goBack}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-2xl leading-none text-heading transition-colors hover:bg-brand-50 hover:text-brand-700"
            title="Orqaga"
            aria-label="Orqaga"
          >
            ‹
          </button>
        )}

        {/* Sahifa sarlavhasi: PageHeader bo'lsa — u, bo'lmasa menyudan. Telefonda — alohida (pastki) qatorda, «B» bo'lib qisqarmasin */}
        <div className="order-last flex w-full min-w-0 items-center sm:order-none sm:w-auto sm:flex-1">
          <div className="topbar-fallback min-w-0">
            {fallback.parent && <p className="truncate text-xs font-medium text-(--color-text-muted)">{fallback.parent}</p>}
            <h1 className="truncate text-2xl font-bold tracking-tight text-heading">{isHome ? 'Bosh sahifa' : fallback.title}</h1>
          </div>
          <div id={PAGE_HEADER_SLOT_ID} className="flex min-w-0 flex-1 items-center" />
        </div>
        {/* Telefonda: tugmalar o'ngga (sarlavha pastki qatorda) */}
        <span className="flex-1 sm:hidden" />

        {/* Yangi yozuv — istalgan sahifadan (N tugmasi); ko'rsatuv sahifalarida — yo'q */}
        {!quiet && !homeOnly && <QuickAddButton />}

        {/* Davr — hamma bo'lim uchun bitta (davr bilan ishlaydigan sahifalarda) */}
        <PeriodControl />

        {/* Ko'rinish rejimi: Qisqa / To'liq */}
        <ViewModeToggle />

        {/* «Faqat Bosh sahifa» — administrator: boshqa bo'limlarni hamma uchun yashirish */}
        <HomeOnlyToggle />

        {/* Faqat Bosh sahifa rejimida — boshqa bo'limlarga olib boradigan tugmalar yo'q */}
        {!homeOnly && (
          <>

        {/* Formulalar va atamalar — har bir raqam qanday hisoblanadi */}
        <Link
          href="/formulalar"
          title="Formulalar va atamalar: har bir raqam qanday hisoblanadi"
          aria-label="Formulalar va atamalar"
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-xl border text-base font-bold transition-colors',
            pathname === '/formulalar' ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-(--color-line) bg-(--color-surface-muted) text-(--color-text-muted) hover:border-brand-300 hover:bg-white hover:text-brand-700',
          )}
        >
          ?
        </Link>

        {/* Muhokama talab qiladi */}
        <AlertsBell />

        {/* Global qidiruv */}
        <button
          type="button"
          onClick={openGlobalSearch}
          className={cn(
            // Telefonda yashiriladi (joy yetmaydi; kompyuterda — Ctrl+K)
            'hidden h-10 shrink-0 items-center gap-2 rounded-xl border border-(--color-line) bg-(--color-surface-muted) px-3 text-sm text-(--color-text-muted) transition-colors sm:flex',
            'hover:border-brand-300 hover:bg-white hover:text-brand-700',
          )}
          title="Qidirish (Ctrl+K)"
        >
          <IconSearch className="size-4" />
          <span className="hidden 2xl:inline">Qidirish…</span>
          <kbd className="hidden rounded-md bg-white px-1.5 py-0.5 font-sans text-[11px] text-(--color-text-faint) shadow-sm 2xl:inline">Ctrl K</kbd>
        </button>
          </>
        )}

        <span className="hidden h-8 w-px bg-(--color-line) md:block" />
        <UserMenu quiet={quiet} />

        {/* Yuqori panelni yashirish (yon menyudek) — qaytarish: o'ng yuqoridagi «▾ Panel» */}
        {onHide && (
          <button
            type="button"
            onClick={onHide}
            className="hidden size-8 shrink-0 items-center justify-center rounded-lg text-sm text-(--color-text-faint) transition-colors hover:bg-brand-50 hover:text-brand-700 md:flex"
            title="Yuqori panelni yashirish"
            aria-label="Yuqori panelni yashirish"
          >
            ▴
          </button>
        )}
      </div>
    </header>
  );
}