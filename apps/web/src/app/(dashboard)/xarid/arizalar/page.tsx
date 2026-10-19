'use client';

import { LoadingState } from '@/components/ui/states';
import { RequestsPage } from '@/features/purchases/requests';
import { Suspense } from 'react';

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <RequestsPage />
    </Suspense>
  );
}