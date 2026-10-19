'use client';

import { coveredBySection } from '@/components/layout/nav-config';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export interface TabItem {
  href: string;
  label: string;
}

interface TabsProps {
  items: TabItem[];
  /**
   * Eski sahifalardan qolgan joylashuv klasslari.
   * Yangi ko'rinishda yorliqlar o'zi joylashadi, shuning uchun hisobga olinmaydi.
   */
  className?: string;
  /** O'ng tomonda (masalan, sana yoki qo'shimcha tugma) */
  aside?: ReactNode;
}

/**
 * Sahifa ichidagi yorliqlar — "tabletka" tugmalar qatori.
 *
 * Agar shu yorliqlar yuqoridagi bo'lim qatorida allaqachon bo'lsa
 * (masalan, Sozlamalar yoki Xarajatlar ichidagi eski qatorlar) — takror chizilmaydi.
 * Marshrutga bog'langan — har bir yorliq alohida URL, havolani ulashish mumkin.
 */
export function Tabs({ items, aside }: TabsProps) {
  const pathname = usePathname();
  const { isAdmin } = useAuth();

  if (coveredBySection(items.map((i) => i.href), pathname, isAdmin)) {
    return aside ? <div className="flex justify-end px-4 pt-4 md:px-6">{aside}</div> : null;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-5 md:px-6">
      <TabPills items={items} active={(item) => pathname === item.href} />
      {aside && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
    </div>
  );
}

/**
 * Faqat tugmalar qatori — faol yorliq to'q ko'k, qolganlari oq, chegarali.
 * Hammasi doim ko'rinib turadi; bosganda faqat pastdagi qism almashadi.
 */
export function TabPills({ items, active }: { items: TabItem[]; active: (item: TabItem) => boolean }) {
  return (
    <nav
      className="-mx-1 flex min-w-0 items-center gap-2.5 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible md:pb-0"
      aria-label="Bo'lim yorliqlari"
    >
      {items.map((item) => {
        const on = active(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'shrink-0 whitespace-nowrap rounded-(--radius-control) px-4 py-2.5 text-sm transition-all',
              on
                ? 'bg-brand-500 font-semibold text-white shadow-pill'
                : 'bg-white font-medium text-heading shadow-card hover:-translate-y-px hover:text-brand-700 hover:shadow-md',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Ikkinchi daraja yorliqlar (sahifa ichidagi bo'limlar) — tugmalar, URL o'zgarmaydi.
 * Birinchi darajadan (to'q ko'k) farqlanadi: tanlangani och ko'k fonda, ko'k yozuv.
 * Hammasi doim ko'rinib turadi — istalganiga to'g'ridan-to'g'ri o'tiladi.
 */
export function SubTabs<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} role="tablist">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={on}
            title={option.hint}
            onClick={() => onChange(option.value)}
            className={cn(
              'whitespace-nowrap rounded-lg px-3.5 py-2 text-sm transition-colors',
              on
                ? 'bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-200'
                : 'font-medium text-(--color-text-muted) hover:bg-(--color-surface-muted) hover:text-heading',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}