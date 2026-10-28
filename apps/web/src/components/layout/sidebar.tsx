'use client';

import { useRoles, type RoleItem } from '@/features/roles/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { isChildActive, isGroupActive, isMenuActive, SIDEBAR, type SideGroup } from './nav-config';
import { NavLogo } from './nav-icons';
import { SideAccount } from './side-account';

// ═══════════════════════════════════════════════════════════
// Chap menyu — ko'k fon, oq yozuvlar, faol band oq "tabletka".
// Guruhlar (Bosh sahifa, Umumiy manba, Boshqaruv) ichidagi bandlar shu panelning o'zida, pastida ochiladi.
// «‹» tugmasi bilan ixchamlashadi (faqat ikonkalar) — tanlov brauzerda eslab qolinadi.
// Pastda — «Chiqish» hududi (kim kirgan, rol, chiqish tugmasi); Omborchi menyusida ham xuddi shunday.
// Kichik ekranda — chapdan chiqadigan panel (yuqori paneldagi ☰ tugmasi bilan).
// ═══════════════════════════════════════════════════════════

const STORAGE_KEY = 'sidebar-collapsed';
const OPEN_KEY = 'sidebar-open-groups';

function readOpen(): string[] {
  try {
    const raw = window.localStorage.getItem(OPEN_KEY);
    // Birinchi marta — «Umumiy manba» ochiq turadi
    if (raw === null) return ['source'];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveOpen(value: string[]) {
  try {
    window.localStorage.setItem(OPEN_KEY, JSON.stringify(value));
  } catch {
    // eslab qolinmasa ham ishlayveradi
  }
}

function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180', className)} aria-hidden="true">
      <path d="m5 8 5 5 5-5" />
    </svg>
  );
}

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
  const { isAdmin, isWorker } = useAuth();
  /** Rollar — o'z nomlari bilan (administrator qo'ygan) */
  const roles = useRoles(!isWorker);
  const [collapsed, setCollapsed] = useState(false);
  /** Qo'lda ochilgan guruhlar (faol guruh har doim ochiq) */
  const [openGroups, setOpenGroups] = useState<string[]>([]);

  useEffect(() => {
    setCollapsed(readCollapsed());
    setOpenGroups(readOpen());
  }, []);

  const toggleGroup = (key: string) => {
    setOpenGroups((list) => {
      const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
      saveOpen(next);
      return next;
    });
  };

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
            {SIDEBAR.map((entry, index) => {
              if (entry.kind === 'heading') {
                return (
                  <li key={`h-${entry.label}`} className={cn('px-3 pb-1', index > 0 ? 'pt-3' : 'pt-1', collapsed && 'md:px-0 md:pt-3')} title={entry.hint}>
                    <span className={cn('block text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/55', collapsed && 'md:hidden')}>{entry.label}</span>
                    <span className={cn('hidden h-px bg-white/25', collapsed && 'md:mx-3 md:block')} aria-hidden="true" />
                  </li>
                );
              }
              if (entry.kind === 'item') {
                const item = entry.item;
                if (item.adminOnly && !isAdmin) return null;
                const Icon = item.icon;
                const active = isMenuActive(item, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] transition-all',
                        collapsed && 'md:justify-center md:px-0',
                        active ? 'bg-white font-semibold text-brand-700 shadow-md shadow-black/10' : 'font-medium text-white/90 hover:bg-white/10 hover:text-white',
                      )}
                    >
                      <Icon className={cn('size-5 shrink-0', active ? 'text-brand-600' : 'text-white')} />
                      <span className={cn('truncate', collapsed && 'md:hidden')}>{item.label}</span>
                    </Link>
                  </li>
                );
              }
              return (
                <GroupEntry
                  key={entry.key}
                  group={withRoles(entry, roles)}
                  pathname={pathname}
                  isAdmin={isAdmin}
                  collapsed={collapsed}
                  open={openGroups.includes(entry.key)}
                  onToggle={() => toggleGroup(entry.key)}
                />
              );
            })}
          </ul>
        </nav>

        {/* Chiqish hududi: kim kirgan va «Chiqish» */}
        <SideAccount collapsed={collapsed} />
      </aside>
    </>
  );
}

/** «Rollar» bandi ortidan har bir rol — administrator qo'ygan nomi bilan (ichkariroq) */
function withRoles(group: SideGroup, roles: RoleItem[]): SideGroup {
  if (!group.children.some((c) => c.rolesSlot)) return group;
  return {
    ...group,
    children: group.children.flatMap((c) =>
      c.rolesSlot
        ? [
            c,
            ...roles.flatMap((r) => {
              // Rol ichidagi bo'limlar (KPI: Marksheyder …) — o'z rol sahifasi bilan, alohida band
              const subs = r.dashboards.filter((d) => d.href.startsWith('/rollar/'));
              return [
                {
                  label: r.label,
                  href: `/rollar/${r.slug}`,
                  match: [`/rollar/${r.slug}`, ...r.dashboards.filter((d) => !d.href.startsWith('/rollar/')).map((d) => d.href)],
                  indent: true,
                },
                ...subs.map((d) => ({ label: d.label, href: d.href, match: [d.href], indent: true })),
              ];
            }),
          ]
        : [c],
    ),
  };
}

/**
 * Guruh: sarlavha (sahifasi bo'lsa — havola) va ichidagi bandlar pastida.
 * Faol guruh har doim ochiq; boshqalari ▾ tugmasi bilan ochiladi.
 * Menyu ikkala rejimda (qisqa / to'liq) bir xil ishlaydi — rejim faqat sahifa mazmuniga ta'sir qiladi.
 */
export function GroupEntry({
  group,
  pathname,
  isAdmin,
  collapsed,
  open,
  onToggle,
}: {
  group: SideGroup;
  pathname: string;
  isAdmin: boolean;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const children = group.children.filter((c) => !c.adminOnly || isAdmin);
  const active = isGroupActive(group, pathname);
  const selfActive = group.href !== null && pathname === group.href;
  const showChildren = !collapsed && (active || open);
  const Icon = group.icon;
  // Ixcham menyuda (faqat ikonkalar) guruh birinchi bandiga olib boradi
  const target = group.href ?? children[0]?.href ?? '/';

  const headClass = cn(
    'group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[14px] transition-all',
    collapsed && 'md:justify-center md:px-0',
    selfActive || (active && (collapsed || !showChildren))
      ? 'bg-white font-semibold text-brand-700 shadow-md shadow-black/10'
      : active
        ? 'bg-white/15 font-semibold text-white'
        : 'font-medium text-white/90 hover:bg-white/10 hover:text-white',
  );
  const iconClass = cn('size-5 shrink-0', selfActive || (active && (collapsed || !showChildren)) ? 'text-brand-600' : 'text-white');

  return (
    <li>
      <div className="flex items-center gap-1">
        {group.href || collapsed ? (
          <Link href={target} title={collapsed ? group.label : undefined} aria-current={selfActive ? 'page' : undefined} className={cn(headClass, 'min-w-0 flex-1')}>
            <Icon className={iconClass} />
            <span className={cn('truncate', collapsed && 'md:hidden')}>{group.label}</span>
          </Link>
        ) : (
          <button type="button" onClick={onToggle} aria-expanded={showChildren} className={cn(headClass, 'min-w-0 flex-1 text-left')}>
            <Icon className={iconClass} />
            <span className="min-w-0 flex-1 truncate">{group.label}</span>
            <Chevron open={showChildren} className="text-white/80" />
          </button>
        )}
        {group.href && !collapsed && (
          <button
            type="button"
            onClick={onToggle}
            disabled={active}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white disabled:opacity-40"
            aria-label={showChildren ? `${group.label}: yopish` : `${group.label}: ochish`}
            aria-expanded={showChildren}
          >
            <Chevron open={showChildren} />
          </button>
        )}
      </div>

      {showChildren && children.length > 0 && (
        <ul className="mb-1 ml-[1.35rem] mt-1 space-y-0.5 border-l border-white/25 pl-3">
          {children.map((child) => {
            const on = isChildActive(child, pathname);
            const subs = (child.children ?? []).filter((c) => !c.adminOnly || isAdmin);
            return (
              <li key={child.href}>
                <Link
                  href={child.href}
                  aria-current={on ? 'page' : undefined}
                  title={child.description}
                  className={cn(
                    'block truncate rounded-lg px-3 py-2 text-[13.5px] transition-colors',
                    child.indent && 'ml-3 flex items-center gap-2 py-1.5 text-[13px] before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:opacity-60',
                    on ? 'bg-white font-semibold text-brand-700 shadow-sm' : 'text-white/85 hover:bg-white/10 hover:text-white',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {child.dot && <span className={cn('size-2 shrink-0 rounded-full', child.dot)} />}
                    <span className="truncate">{child.label}</span>
                    {child.badge ? <span className="ml-auto shrink-0 rounded-full bg-amber-400 px-1.5 text-[11px] font-bold leading-5 text-amber-950">{child.badge}</span> : null}
                  </span>
                </Link>
                {/* Ichki bandlar (Daromadlar/Xarajatlar › 6 bo'lim) — shu band ochilganda pastida */}
                {on && subs.length > 0 && (
                  <ul className="mb-1 ml-3 mt-0.5 space-y-0.5 border-l border-white/20 pl-2">
                    {subs.map((sub) => {
                      const subOn = isChildActive(sub, pathname);
                      return (
                        <li key={sub.href}>
                          <Link
                            href={sub.href}
                            aria-current={subOn ? 'page' : undefined}
                            title={sub.description}
                            className={cn(
                              'flex items-center gap-2 truncate rounded-lg px-2.5 py-1.5 text-[13px] transition-colors before:size-1.5 before:shrink-0 before:rounded-full before:bg-current before:opacity-60',
                              subOn ? 'bg-white font-semibold text-brand-700 shadow-sm' : 'text-white/80 hover:bg-white/10 hover:text-white',
                            )}
                          >
                            <span className="truncate">{sub.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}