'use client';

import { IconLogout } from '@/components/ui/icons';
import { usePathname } from 'next/navigation';
import { isPresentationPath } from './nav-config';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Chap menyu pastidagi «Chiqish» hududi — umumiy hudud va rollarda bir xil:
//   kim kirgan (ism, rol, ID kod) va «Chiqish» tugmasi; rolda — «PIN kodni o'zgartirish» ham (extra).
// Ixcham menyuda — faqat avatar va chiqish belgisi. Ko'rsatuv sahifalarida (Bosh sahifa, Solishtirma) — rol yozilmaydi.
// ═══════════════════════════════════════════════════════════

export function SideAccount({ collapsed = false, extra }: { collapsed?: boolean; extra?: ReactNode }) {
  const { user, logout, isAdmin } = useAuth();
  const name = user?.fullName ?? '';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  const quiet = isPresentationPath(usePathname() ?? '/');
  const role = quiet ? '' : (user?.roleLabel ?? (isAdmin ? 'Administrator' : 'Kuzatuvchi'));

  return (
    <div className={cn('shrink-0 border-t border-white/20 px-3 pb-3 pt-3', collapsed && 'md:px-2')}>
      <div className={cn('flex items-center gap-3 rounded-xl bg-white/10 px-3 py-2.5', collapsed && 'md:justify-center md:bg-transparent md:px-0')} title={collapsed ? [name, role].filter(Boolean).join(' · ') : undefined}>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-brand-700">{initials || '?'}</span>
        <div className={cn('min-w-0', collapsed && 'md:hidden')}>
          <p className="truncate text-sm font-semibold">{name}</p>
          {!quiet && (
            <p className="truncate text-[11px] text-white/75">
              {role}
              {user?.loginCode && (
                <>
                  {' · '}
                  <span className="font-mono">{user.loginCode}</span>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="mt-1.5 space-y-0.5">
        {!collapsed && extra}
        <button
          type="button"
          onClick={logout}
          title="Dasturdan chiqish"
          className={cn(
            'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] font-medium text-white/90 transition-colors hover:bg-rose-500/25 hover:text-white',
            collapsed && 'md:justify-center md:px-0',
          )}
        >
          <IconLogout className="size-5 shrink-0" />
          <span className={cn(collapsed && 'md:hidden')}>Chiqish</span>
        </button>
      </div>
    </div>
  );
}