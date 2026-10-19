'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/states';
import { useRoles } from '@/features/roles/api';
import Link from 'next/link';

// Rollar — har biri o'z nomi bilan; bosilsa rolning katta dashbordi ochiladi
export default function RolesPage() {
  const roles = useRoles();
  return (
    <>
      <PageHeader title="Rollar" description="Har bir rol o'z bo'limida kiritadi — bu yerda uning dashbordi" />
      <div className="grid gap-4 p-4 sm:grid-cols-2 md:p-6 xl:grid-cols-3">
        {roles.length === 0 && (
          <Card className="sm:col-span-2 xl:col-span-3">
            <EmptyState title="Rol yo'q" />
          </Card>
        )}
        {roles.map((r) => (
          <Link key={r.value} href={`/rollar/${r.slug}`} className="block rounded-(--radius-card) bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-lg font-bold text-heading">{r.label}</p>
            <p className="mt-1 text-xs text-(--color-text-muted)">{r.description}</p>
            <p className="mt-3 text-sm text-heading">
              {r.activeUsers} ta faol xodim · {r.sections.join(', ')}
            </p>
            <p className="mt-2 text-sm font-semibold text-brand-700">Dashbordni ochish →</p>
          </Link>
        ))}
      </div>
    </>
  );
}