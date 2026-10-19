'use client';

import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isMenuActive, MENU } from './nav-config';
import { NavLogo } from './nav-icons';

// ═══════════════════════════════════════════════════════════
// Chap menyu — ko'k fon, oq yozuvlar, faol band oq "tabletka".
// «‹» tugmasi bilan ixchamlashadi (faqat ikonkalar) — tanlov brauzerda eslab qolinadi.
// Kichik ekranda — chapdan chiqadigan panel (yuqori paneldagi ☰ tugmasi bilan).
// ═══════════════════════════════════════════════════════════

const STORAGE_KEY = 'sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    // brauzer saqlashga ruxsat bermasa — shunchaki eslab qolinmaydi
  }
}

interface SidebarProps {
  /** Kichik ekranda panel ochiqmi */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const { isAdmin } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(readCollapsed());
  }, []);

  // Sahifa almashganda kichik ekrandagi panel yopiladi
  useEffect(() => {
    onMobileClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const toggle = () => {
    setCollapsed((value) => {
      saveCollapsed(!value);
      return !value;
    });
  };

  const items = MENU.filter((item) => !item.adminOnly || isAdmin);
  const year = new Date().getFullYear();

  return (
    <>
      {/* Kichik ekranda orqa fon */}
      <div
        className={cn('fixed inset-0 z-40 bg-slate-900/40 transition-opacity md:hidden', mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0')}
        onClick={onMobileClose}
        aria-hidden="true"
      />

      <aside
        className={cn(
          'no-print fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col bg-gradient-to-b from-side-from to-side-to text-white transition-[width,transform] duration-200 md:static md:translate-x-0',
          collapsed ? 'md:w-[76px]' : 'md:w-64',
          'w-64',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
        aria-label="Asosiy menyu"
      >
        {/* Logo */}
        <div className={cn('flex h-[72px] shrink-0 items-center gap-3', collapsed ? 'md:justify-center md:px-0' : '', 'px-5')}>
          <Link href="/" className="flex min-w-0 items-center gap-3" title="Bosh sahifa">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/15 ring-2 ring-white/40">
              <NavLogo className="size-6" />
            </span>
            <span className={cn('truncate text-lg font-bold tracking-tight', collapsed && 'md:hidden')}>Korxona tahlil</span>
          </Link>
        </div>

        {/* Ixchamlash tugmasi */}
        <div className={cn('hidden justify-end px-3 md:flex', collapsed && 'md:justify-center')}>
          <button
            type="button"
            onClick={toggle}
            className="flex size-7 items-center justify-center rounded-md text-lg leading-none text-white/80 transition-colors hover:bg-white/15 hover:text-white"
            title={collapsed ? 'Menyuni kengaytirish' : 'Menyuni ixchamlash'}
            aria-label={collapsed ? 'Menyuni kengaytirish' : 'Menyuni ixchamlash'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        {/* Bandlar */}
        <nav className="side-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2">
          <ul className="space-y-1">
            {items.map((item) => {
              const Icon = item.icon;
              const active = isMenuActive(item, pathname);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition-all',
                      collapsed && 'md:justify-center md:px-0',
                      active
                        ? 'bg-white font-semibold text-brand-700 shadow-md shadow-black/10'
                        : 'font-medium text-white/90 hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <Icon className={cn('size-5 shrink-0', active ? 'text-brand-600' : 'text-white')} />
                    <span className={cn('truncate', collapsed && 'md:hidden')}>{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Pastki yozuv */}
        <p className={cn('mx-5 shrink-0 border-t border-white/20 pb-5 pt-4 text-[11px] leading-relaxed text-white/70 [@media(max-height:720px)]:hidden', collapsed && 'md:hidden')}>
          Korxona tahlil — daromad, xarajat va xodimlar ma&apos;lumotlari asosidagi ichki tahliliy tizim © {year}
        </p>
      </aside>
    </>
  );
}