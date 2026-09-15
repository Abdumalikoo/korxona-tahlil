'use client';

import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface TabItem {
  href: string;
  label: string;
}

interface TabsProps {
  items: TabItem[];
  className?: string;
}

/**
 * Sahifa ichidagi yorliqlar.
 *
 * Marshrutga bog'langan - har bir yorliq alohida URL,
 * shunda havolani nusxalab yuborish mumkin.
 */
export function Tabs({ items, className }: TabsProps) {
  const pathname = usePathname();

  return (
    <div className={cn('flex items-center gap-1 border-b border-[--color-line]', className)}>
      {items.map((item) => {
        const active = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'relative px-4 py-2.5 text-sm transition-colors',
              active
                ? 'font-medium text-brand-800'
                : 'text-[--color-text-muted] hover:text-[--color-text]',
            )}
          >
            {item.label}
            {active && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 bg-brand-800" />
            )}
          </Link>
        );
      })}
    </div>
  );
}
