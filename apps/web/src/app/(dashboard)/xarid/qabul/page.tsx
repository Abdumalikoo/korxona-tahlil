'use client';

import { LoadingState } from '@/components/ui/states';
import { ReceiptPage } from '@/features/purchases/receipt-page';
import { Suspense } from 'react';

export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ReceiptPage />
    </Suspense>
  );
}