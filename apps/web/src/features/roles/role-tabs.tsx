'use client';

import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRoles } from './api';

// ═══════════════════════════════════════════════════════════
// Rol ichidagi yorliqlar: «Omborchi — umumiy» · Ombor · Mashinalar.
// Rol dashbordi va uning batafsil dashbordlari tepasida — bir-biriga bir bosishda o'tiladi.
// ═══════════════════════════════════════════════════════════

export function RoleTabs({ className }: { className?: string }) {
  const pathname = usePathname() ?? '';
  const roles = useRoles();
  const role = roles.find((r) => pathname === `/rollar/${r.slug}` || r.dashboards.some((d) => pathname === d.href || pathname.startsWith(`${d.href}/`)));
  if (!role) return null;
  const tabs = [{ label: `${role.label} — umumiy`, href: `/rollar/${role.slug}` }, ...role.dashboards];
  return (
    <nav className={cn('flex flex-wrap gap-2', className)} aria-label={role.label}>
      {tabs.map((t) => {
        const on = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
              on ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/25' : 'bg-white text-heading shadow-card hover:text-brand-700',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}