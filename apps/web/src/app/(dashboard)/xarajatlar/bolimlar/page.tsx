'use client';

import { DepartmentsView } from '@/features/dep-policy/departments-view';
import { Suspense } from 'react';

/** Xarajatlar › Foyda keltirmaydigan bo'limlar (Markaz bo'limlari) */
export default function DepartmentsPage() {
  return (
    <Suspense>
      <DepartmentsView />
    </Suspense>
  );
}
