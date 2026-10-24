'use client';

import { UnitLedger } from '@/features/units/unit-ledger';
import { useParams } from 'next/navigation';
import { Suspense } from 'react';

/** Daromadlar › bo'lim (Markaz, Hududlar, Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari) */
export default function IncomeUnitPage() {
  const params = useParams<{ slug: string }>();
  return (
    <Suspense>
      <UnitLedger kind="income" slug={params.slug} />
    </Suspense>
  );
}