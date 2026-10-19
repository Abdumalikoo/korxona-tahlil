'use client';

import { PageHeader } from '@/components/layout/page-header';
import { ReactionList } from '@/features/reactions/reaction-list';

/** Munosabat — belgilangan moddalar bo'yicha kuzatuv, hisobot va slaydlar */
export default function MunosabatPage() {
  return (
    <>
      <PageHeader title="Munosabat" description="Belgilangan daromad va xarajatlar: muddat, mas'ullar, avtomatik hisobot va slaydlar" />
      <div className="p-6">
        <ReactionList />
      </div>
    </>
  );
}