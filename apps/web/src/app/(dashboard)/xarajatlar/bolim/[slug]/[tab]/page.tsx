'use client';

import { UnitLedger } from '@/features/units/unit-ledger';
import { useParams } from 'next/navigation';
import { Suspense } from 'react';

/** Xarajatlar › bo'lim › tuzilma (masalan, Tax free › Ish haqi) */
export default function ExpenseUnitTabPage() {
  const params = useParams<{ slug: string; tab: string }>();
  return (
    <Suspense>
      <UnitLedger kind="expense" slug={params.slug} tab={params.tab} />
    </Suspense>
  );
}