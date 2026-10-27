'use client';

import { DepartmentsView } from '@/features/dep-policy/departments-view';
import { useParams } from 'next/navigation';
import { Suspense } from 'react';

/** Xarajatlar › Foyda keltirmaydigan bo'limlar › bitta bo'lim */
export default function DepartmentPage() {
  const params = useParams<{ id: string }>();
  return (
    <Suspense>
      <DepartmentsView id={params.id} />
    </Suspense>
  );
}
