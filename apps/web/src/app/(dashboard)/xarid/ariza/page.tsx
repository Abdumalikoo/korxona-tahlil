'use client';

import { LoadingState } from '@/components/ui/states';
import { RequestEntry } from '@/features/purchases/request-entry';
import { Suspense } from 'react';

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RequestEntry />
    </Suspense>
  );
}