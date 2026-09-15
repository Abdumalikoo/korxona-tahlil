'use client';

import {
    IconBuilding,
    IconChart,
    IconDashboard,
    IconLogout,
    IconSettings,
    IconTrendUp,
    IconWallet,
} from '@/components/ui/icons';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface NavItem {
  href: string;
  label: string;
  icon: typeof IconDashboard;
  adminOnly?: boolean;
}

interface NavGroup {
  title?: string;
  items: NavItem[];
}

const navigation: NavGroup[] = [
  {
    items: [{ href: '/', label: 'Bosh sahifa', icon: IconDashboard }],
  },
  {
    title: "Ma'lumot",
    items: [
      { href: '/xarajatlar', label: 'Xarajatlar', icon: IconWallet },
      { href: '/daromadlar', label: 'Daromadlar', icon: IconTrendUp },
    ],
  },
  {
    title: 'Tahlil',
    items: [{ href: '/bolimlar', label: "Bo'limlar", icon: IconBuilding }],
  },
  {
    items: [
      { href: '/sozlamalar', label: 'Sozlamalar', icon: IconSettings, adminOnly: true },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, logout, isAdmin } = useAuth();

  /** Joriy sahifani aniqlaydi - ichki sahifalar ham ota bo'limni yoqadi */
  function isActive(href: string): boolean {
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-[--color-line] bg-white">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2.5 border-b border-[--color-line] px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-brand-800">
          <IconChart className="size-4 text-white" />
        </div>
        <span className="text-sm font-semibold text-[--color-text]">Korxona tahlil</span>
      </div>

      {/* Navigatsiya */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {navigation.map((group, groupIndex) => {
          const visible = group.items.filter((item) => !item.adminOnly || isAdmin);
          if (visible.length === 0) return null;

          return (
            <div key={groupIndex} className={groupIndex > 0 ? 'mt-6' : undefined}>
              {group.title && (
                <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-[--color-text-faint]">
                  {group.title}
                </p>
              )}

              <ul className="space-y-0.5">
                {visible.map((item) => {
                  const Icon = item.icon;
                  const active = isActive(item.href);

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          'flex items-center gap-2.5 rounded-[--radius-control] px-3 py-2 text-sm transition-colors',
                          active
                            ? 'bg-brand-50 font-medium text-brand-800'
                            : 'text-[--color-text-muted] hover:bg-[--color-surface-sunken] hover:text-[--color-text]',
                        )}
                      >
                        <Icon className="size-4 shrink-0" strokeWidth={active ? 2.2 : 1.8} />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {/* Foydalanuvchi */}
      <div className="border-t border-[--color-line] p-3">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[--color-surface-sunken] text-xs font-semibold text-[--color-text-muted]">
            {user?.fullName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[--color-text]">
              {user?.fullName}
            </p>
            <p className="text-xs text-[--color-text-muted]">
              {user?.role === 'ADMIN' ? 'Administrator' : 'Kuzatuvchi'}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={logout}
          className="mt-1 flex w-full items-center gap-2.5 rounded-[--radius-control] px-3 py-2 text-sm text-[--color-text-muted] transition-colors hover:bg-[--color-surface-sunken] hover:text-[--color-text]"
        >
          <IconLogout className="size-4" strokeWidth={1.8} />
          Chiqish
        </button>
      </div>
    </aside>
  );
}
