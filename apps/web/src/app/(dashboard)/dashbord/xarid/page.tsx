'use client';

import { LoadingState } from '@/components/ui/states';
import { XaridDashboard } from '@/features/purchases/dashboard';
import { Suspense } from 'react';

// Umumiy hudud › Xarid dashbordi: Xaridchi kiritgan ma'lumot — ko'rish va xatoni tuzatish
export default function XaridDashboardPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <XaridDashboard />
    </Suspense>
  );
}