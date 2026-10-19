'use client';

import { LoadingState } from '@/components/ui/states';
import { PurchaseJournal } from '@/features/purchases/journal';
import { Suspense } from 'react';

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <PurchaseJournal />
    </Suspense>
  );
}