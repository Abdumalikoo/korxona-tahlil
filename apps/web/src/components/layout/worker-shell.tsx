'use client';

import { IconMenu } from '@/components/ui/icons';
import { Toast } from '@/components/ui/toast';
import { PinChangeDialog } from '@/features/auth/pin';
import { receiptsApi } from '@/features/purchases/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { titleFor, workerMenu, type SideGroup, type WorkerNavGroup, type WorkerTone } from './nav-config';
import { NavList, NavLogo } from './nav-icons';
import { GroupEntry } from './sidebar';
import { PageIntro } from './page-intro';
import { PeriodControl } from './period-control';
import { SideAccount } from './side-account';
import { PAGE_HEADER_SLOT_ID } from './top-bar';

// ═══════════════════════════════════════════════════════════
// Ishchi rollar (Omborchi …) uchun qobiq: faqat o'z bo'limi.
// Chap menyu umumiy hudud menyusi bilan bir xil ko'rinishda:
//   Ish stoli · ▾ Kiritish · ▾ Ko'rish · ▾ Nazorat — ochilib-yopiladigan guruhlar (umumiy hududdagi
//   «Umumiy manba», «Boshqaruv» kabi), amallar yonida rangli nuqta,
//   «‹» bilan ixchamlashadi, pastda — «Chiqish» hududi (kim kirgan, PIN kodni o'zgartirish, Chiqish).
//  tepada — sahifa sarlavhasi va «Davr».
// Bildirishnomalar, qidiruv, Munosabat, ko'rinish rejimi bu yerda yo'q:
// ular boshqa bo'limlar ma'lumotiga tayanadi (server ham ularni yopadi).
// ═══════════════════════════════════════════════════════════

const STORAGE_KEY = 'worker-sidebar-collapsed';
const OPEN_KEY = 'worker-sidebar-open';

function under(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Amal rangi — guruh ichidagi kichik nuqta (ish stolidagi katta tugmalar bilan bir xil) */
const DOT: Record<WorkerTone, string> = {
  green: 'bg-emerald-300',
  blue: 'bg-sky-300',
  amber: 'bg-amber-300',
  slate: 'bg-slate-300',
  red: 'bg-rose-300',
  violet: 'bg-violet-300',
};

/** Rol menyusi guruhi → chap panel guruhi (umumiy hududdagi bilan bir xil komponent) */
function toSideGroup(group: WorkerNavGroup, allHrefs: string[], badges: Record<string, number>): SideGroup {
  return {
    kind: 'group',
    key: `w-${group.title}`,
    label: group.title,
    href: null,
    icon: group.icon ?? NavList,
    children: group.items.map((i) => ({
      label: i.label,
      href: i.href,
      description: i.hint,
      dot: i.tone ? DOT[i.tone] : undefined,
      badge: i.badgeKey ? badges[i.badgeKey] : undefined,
      // Ichki sahifalari ham shu bandga tegishli — agar undan aniqroq band bo'lmasa
      match: allHrefs.some((h) => h !== i.href && h.startsWith(`${i.href}/`)) ? undefined : [i.href],
    })),
  };
}

/** Menyudagi sonlar (kutilayotgan qabullar): har 45 soniyada yangilanadi */
function useBadges(receipts: boolean): Record<string, number> {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!receipts) return;
    let alive = true;
    const load = () => receiptsApi.summary().then((r) => alive && setN(r.data.pending)).catch(() => undefined);
    void load();
    const t = window.setInterval(load, 45_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [receipts]);
  return { receipts: n };
}

export function WorkerShell({ children }: { children: ReactNode }) {
  const { user, actingRole, leaveRole } = useAuth();
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  /** Ochiq guruhlar (birinchi marta — hammasi ochiq) */
  const [openGroups, setOpenGroups] = useState<string[] | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => setMobileOpen(false), [pathname]);
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === '1');
      const raw = window.localStorage.getItem(OPEN_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      setOpenGroups(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : null);
    } catch {
      // eslab qolinmagan
    }
  }, []);

  const toggle = () => {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, value ? '0' : '1');
      } catch {
        // eslab qolinmasa ham ishlayveradi
      }
      return !value;
    });
  };

  const pages = user?.access?.pages ?? [];
  const home = user?.access?.home ?? '/';
  /** Rolga ochiq bo'lim menyusi: Ish stoli · Kiritish · Ko'rish · Nazorat */
  const groups = workerMenu(pages);
  const badges = useBadges(groups.some((g) => g.items.some((i) => i.badgeKey === 'receipts')));
  const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const sideGroups = groups.filter((g) => g.title).map((g) => toSideGroup(g, allHrefs, badges));
  const openKeys = openGroups ?? sideGroups.map((g) => g.key);
  const toggleGroup = (key: string) => {
    const next = openKeys.includes(key) ? openKeys.filter((k) => k !== key) : [...openKeys, key];
    setOpenGroups(next);
    try {
      window.localStorage.setItem(OPEN_KEY, JSON.stringify(next));
    } catch {
      // eslab qolinmasa ham ishlayveradi
    }
  };
  const fallback = titleFor(pathname);
  const isHome = pathname === home;

  return (
    <div className="flex h-screen overflow-hidden bg-(--color-surface-muted)">
      {/* Kichik ekranda orqa fon */}
      <div
        className={cn('fixed inset-0 z-40 bg-slate-900/40 transition-opacity md:hidden', mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0')}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={cn(
          'no-print fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col bg-gradient-to-b from-side-from to-side-to text-white transition-[width,transform] duration-200 md:static md:translate-x-0',
          collapsed ? 'md:w-[76px]' : 'md:w-64',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
        aria-label="Menyu"
      >
        {/* Logo */}
        <div className={cn('flex h-[72px] shrink-0 items-center gap-3 px-5', collapsed && 'md:justify-center md:px-0')}>
          <Link href={home} className="flex min-w-0 items-center gap-3" title="Ish stoli">
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

        {/* Bandlar: Ish stoli, keyin ochiladigan guruhlar */}
        <nav className="side-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2">
          <ul className="space-y-1">
            {groups.map((group, gi) => {
              if (group.title) {
                const side = toSideGroup(group, allHrefs, badges);
                return (
                  <GroupEntry
                    key={side.key}
                    group={side}
                    pathname={pathname}
                    isAdmin
                    collapsed={collapsed}
                    open={openKeys.includes(side.key)}
                    onToggle={() => toggleGroup(side.key)}
                  />
                );
              }
              return group.items.map((item) => {
                const on = under(pathname, item.href) && !allHrefs.some((h) => h.length > item.href.length && under(pathname, h));
                const Icon = item.icon;
                return (
                  <li key={`${gi}-${item.href}`}>
                    <Link
                      href={item.href}
                      aria-current={on ? 'page' : undefined}
                      title={collapsed ? item.label : item.hint}
                      className={cn(
                        'group flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] transition-all',
                        collapsed && 'md:justify-center md:px-0',
                        on ? 'bg-white font-semibold text-brand-700 shadow-md shadow-black/10' : 'font-medium text-white/90 hover:bg-white/10 hover:text-white',
                      )}
                    >
                      <Icon className={cn('size-5 shrink-0', on ? 'text-brand-600' : 'text-white')} />
                      <span className={cn('truncate', collapsed && 'md:hidden')}>{item.label}</span>
                    </Link>
                  </li>
                );
              });
            })}
          </ul>
        </nav>

        {/* Chiqish hududi: kim kirgan, PIN, Chiqish */}
        <SideAccount
          collapsed={collapsed}
          extra={
            actingRole ? (
              <button
                type="button"
                onClick={() => {
                  leaveRole();
                  router.push(`/rollar/${actingRole.toLowerCase()}`);
                }}
                className="flex w-full items-center gap-3 rounded-xl bg-white/15 px-3 py-2 text-left text-[14px] font-semibold text-white transition-colors hover:bg-white/25"
              >
                <span className="flex size-5 shrink-0 items-center justify-center text-base">‹</span>
                Administrator hududiga qaytish
              </button>
            ) : (
            <button
              type="button"
              onClick={() => setPinOpen(true)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] font-medium text-white/90 transition-colors hover:bg-white/10 hover:text-white"
            >
              <span className="flex size-5 shrink-0 items-center justify-center font-mono text-xs">***</span>
              PIN kodni o&apos;zgartirish
            </button>
            )
          }
        />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="no-print topbar sticky top-0 z-30 border-b border-(--color-line) bg-white/95 backdrop-blur">
          <div className="flex min-h-[72px] items-center gap-3 px-4 py-2 md:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="flex size-10 shrink-0 items-center justify-center rounded-xl text-brand-700 hover:bg-brand-50 md:hidden"
              aria-label="Menyuni ochish"
            >
              <IconMenu className="size-5" />
            </button>
            {!isHome && (
              <button
                type="button"
                onClick={() => router.push(home)}
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-2xl leading-none text-heading transition-colors hover:bg-brand-50 hover:text-brand-700"
                title="Ish stoliga"
                aria-label="Ish stoliga"
              >
                ‹
              </button>
            )}
            <div className="flex min-w-0 flex-1 items-center">
              <div className="topbar-fallback min-w-0">
                {fallback.parent && <p className="truncate text-xs font-medium text-(--color-text-muted)">{fallback.parent}</p>}
                <h1 className="truncate text-2xl font-bold tracking-tight text-heading">{fallback.title}</h1>
              </div>
              <div id={PAGE_HEADER_SLOT_ID} className="flex min-w-0 flex-1 items-center" />
            </div>
            <PeriodControl />
          </div>
        </header>

        <div className="flex-1 pb-8">
          {actingRole && (
            <div className="no-print flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 md:px-6">
              <span className="font-semibold">Administrator rejimi:</span>
              <span>siz bu rolning ish ekranidasiz. Kiritgan ma&apos;lumotlaringiz administrator nomidan yoziladi.</span>
            </div>
          )}
          <PageIntro />
          {children}
        </div>
      </main>

      <PinChangeDialog open={pinOpen} onClose={() => setPinOpen(false)} onChanged={() => setToast("PIN o'zgartirildi")} />
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}