'use client';

import { PageHeader } from '@/components/layout/page-header';
import { LoadingState } from '@/components/ui/states';
import { KpiDesk } from '@/features/kpi/kpi-desk';
import { Suspense } from 'react';

/** KPI baholash stoli: bo'lim rahbari — o'z bo'limi; administrator — har bo'lim (?b=KALIT) */
export default function KpiDeskPage() {
  return (
    <>
      <PageHeader title="KPI baholash" description="Xodim → rag'batlantiruvchi / kamaytiruvchi mezonlar; ball shablondan, o'zi saqlanadi" />
      {/* ?b= — useSearchParams uchun Suspense kerak */}
      <Suspense fallback={<LoadingState />}>
        <KpiDesk />
      </Suspense>
    </>
  );
}
