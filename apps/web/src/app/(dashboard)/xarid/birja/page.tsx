'use client';

import { LoadingState } from '@/components/ui/states';
import { PurchaseEntry } from '@/features/purchases/purchase-entry';
import { Suspense } from 'react';

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <PurchaseEntry kind="EXCHANGE" />
    </Suspense>
  );
}