'use client';

import { LoadingState } from '@/components/ui/states';
import { SuppliersPage } from '@/features/purchases/suppliers';
import { Suspense } from 'react';

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <SuppliersPage />
    </Suspense>
  );
}