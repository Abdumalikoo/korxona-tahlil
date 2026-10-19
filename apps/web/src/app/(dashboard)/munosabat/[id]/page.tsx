'use client';

import { PageHeader } from '@/components/layout/page-header';
import { ReactionDetailView } from '@/features/reactions/reaction-detail';
import Link from 'next/link';
import { useParams } from 'next/navigation';

/** Bitta munosabat: moddalar, grafiklar, mas'ullar, Excel va slaydlar */
export default function MunosabatDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <>
      <PageHeader
        title="Munosabat"
        description="Kuzatuv natijasi — har kuni avtomatik yangilanadi"
        actions={
          <Link href="/munosabat" className="text-sm text-(--color-text-muted) hover:text-(--color-text)">
            ← Barcha munosabatlar
          </Link>
        }
      />
      <div className="p-6">{params?.id ? <ReactionDetailView id={params.id} /> : null}</div>
    </>
  );
}