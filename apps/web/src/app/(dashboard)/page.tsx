'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { IconTrendUp, IconWallet, IconDashboard } from '@/components/ui/icons';

const sections = [
  {
    href: '/tahlil/daromad',
    label: 'Daromad',
    icon: IconTrendUp,
    accent: 'text-[--color-income]',
    hover: 'hover:border-[--color-income]',
  },
  {
    href: '/tahlil/xarajat',
    label: 'Xarajat',
    icon: IconWallet,
    accent: 'text-[--color-expense]',
    hover: 'hover:border-[--color-expense]',
  },
  {
    href: '/tahlil/umumiy',
    label: 'Tahlil',
    icon: IconDashboard,
    accent: 'text-brand-700',
    hover: 'hover:border-brand-600',
  },
];

export default function DashboardPage() {
  const { user } = useAuth();


  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col justify-center p-6">
      <div className="mx-auto w-full max-w-5xl">
        <p className="mb-8 text-center text-sm text-[--color-text-muted]">
          {user?.fullName}
        </p>

        <div className="grid gap-5 sm:grid-cols-3">
          {sections.map((section) => {
            const Icon = section.icon;

            return (
              <Link
                key={section.href}
                href={section.href}
                className={`group flex flex-col items-center justify-center gap-4 rounded-[--radius-card] border border-[--color-line] bg-white py-16 transition-all hover:shadow-md ${section.hover}`}
              >
                <Icon
                  className={`size-10 transition-transform group-hover:scale-110 ${section.accent}`}
                  strokeWidth={1.5}
                />

                <span className="text-xl font-semibold text-[--color-text]">
                  {section.label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>

  );
}
