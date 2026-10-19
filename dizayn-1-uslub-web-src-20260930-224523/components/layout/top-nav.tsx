'use client';

import { IconChart, IconLogout, IconSearch, IconSettings } from '@/components/ui/icons';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { activePath, NAV, type NavNode } from './nav-config';

// ═══════════════════════════════════════════════════════════
// Yuqoridagi navigatsiya — doim ko'rinib turadi:
//  1-qator: asosiy bo'limlar (ko'k), qidiruv, foydalanuvchi;
//  2-qator: tanlangan bo'lim ichidagilar;
//  3-qator: ichkarisining ichkarisi (bo'lsa).
// Bittasini bosganda qolganlari yopilmaydi — faqat pastdagi sahifa almashadi.
// ═══════════════════════════════════════════════════════════

/** Global qidiruvni ochish (GlobalSearch shu hodisani tinglaydi) */
export function openGlobalSearch() {
  window.dispatchEvent(new Event('global-search:open'));
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex size-9 items-center justify-center rounded-full bg-white text-sm font-bold text-brand-800 shadow-sm ring-2 ring-white/30 hover:ring-white/60"
        aria-label="Foydalanuvchi"
      >
        {user?.fullName.charAt(0).toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-60 overflow-hidden rounded-xl border border-[--color-line] bg-white text-[--color-text] shadow-xl">
          <div className="border-b border-[--color-line] px-4 py-3">
            <p className="truncate text-sm font-semibold">{user?.fullName}</p>
            <p className="text-xs text-[--color-text-muted]">{user?.role === 'ADMIN' ? 'Administrator' : 'Kuzatuvchi'}</p>
          </div>
          <button type="button" onClick={logout} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm hover:bg-brand-50">
            <IconLogout className="size-4" />
            Chiqish
          </button>
        </div>
      )}
    </div>
  );
}

function SubRow({ nodes, active, level }: { nodes: NavNode[]; active: NavNode | undefined; level: 2 | 3 }) {
  return (
    <div className={cn(level === 2 ? 'border-b border-brand-100 bg-brand-50' : 'border-b border-[--color-line] bg-white')}>
      <nav className="flex items-center gap-1 overflow-x-auto px-4 py-1.5 text-sm md:px-6" aria-label={level === 2 ? "Bo'lim ichidagilar" : 'Ichki yorliqlar'}>
        {nodes.map((n) => {
          const on = n === active;
          return (
            <Link
              key={n.href + n.label}
              href={n.href}
              className={cn(
                'whitespace-nowrap transition-colors',
                level === 2
                  ? cn('rounded-lg border px-3 py-1.5', on ? 'border-brand-600 bg-white font-semibold text-brand-700 shadow-sm' : 'border-transparent text-[--color-text-muted] hover:bg-white hover:text-[--color-text]')
                  : cn('rounded-full px-3 py-1', on ? 'bg-brand-600 font-semibold text-white' : 'text-[--color-text-muted] hover:bg-brand-50 hover:text-brand-700'),
              )}
              aria-current={on ? 'page' : undefined}
            >
              {n.label}
              {n.children?.length ? <span className="ml-1 text-[--color-text-faint]">›</span> : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const { isAdmin } = useAuth();
  const path = activePath(pathname, isAdmin);
  const [l1, l2, l3] = path;
  // Sozlamalar — o'ngda tishli g'ildirak belgisi sifatida
  const top = NAV.filter((n) => !n.adminOnly);
  const settings = NAV.find((n) => n.adminOnly);

  return (
    <header className="no-print sticky top-0 z-40 shadow-sm">
      <div className="bg-gradient-to-r from-brand-900 via-brand-800 to-brand-600 text-white">
        <div className="flex h-14 items-center gap-2 px-4 md:px-6">
          <Link href="/" className="mr-2 flex shrink-0 items-center gap-2 font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-white/15">
              <IconChart className="size-4" />
            </span>
            <span className="hidden text-sm lg:block">Korxona tahlil</span>
          </Link>

          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-sm" aria-label="Asosiy bo'limlar">
            {top.map((n) => {
              const on = n === l1;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={cn('whitespace-nowrap rounded-lg px-3 py-1.5 transition-colors', on ? 'bg-white/20 font-semibold text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white')}
                  aria-current={on ? 'page' : undefined}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <button
            type="button"
            onClick={openGlobalSearch}
            className="flex shrink-0 items-center gap-2 rounded-lg bg-white/15 px-3 py-1.5 text-sm text-blue-50 transition-colors hover:bg-white/25"
          >
            <IconSearch className="size-4" />
            <span className="hidden md:inline">Qidirish…</span>
            <kbd className="hidden rounded bg-white/20 px-1.5 font-sans text-[11px] md:inline">Ctrl K</kbd>
          </button>

          {settings && isAdmin && (
            <Link
              href={settings.href}
              className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors', l1 === settings ? 'bg-white/20 text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white')}
              title="Sozlamalar"
              aria-label="Sozlamalar"
            >
              <IconSettings className="size-[18px]" />
            </Link>
          )}
          <UserMenu />
        </div>
      </div>

      {l1?.children && <SubRow nodes={l1.children} active={l2} level={2} />}
      {l2?.children && <SubRow nodes={l2.children} active={l3} level={3} />}
    </header>
  );
}