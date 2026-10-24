'use client';

import { UnitLedger } from '@/features/units/unit-ledger';
import { useParams } from 'next/navigation';
import { Suspense } from 'react';

/** Xarajatlar › bo'lim (Markaz, Hududlar, Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari) */
export default function ExpenseUnitPage() {
  const params = useParams<{ slug: string }>();
  return (
    <Suspense>
      <UnitLedger kind="expense" slug={params.slug} />
    </Suspense>
  );
}