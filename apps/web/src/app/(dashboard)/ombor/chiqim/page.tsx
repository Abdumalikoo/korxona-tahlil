'use client';

import { LoadingState } from '@/components/ui/states';
import { DocEntry } from '@/features/warehouse/entry/doc-entry';
import { Suspense } from 'react';

/** Ombor › Chiqim (berish) — alohida kiritish sahifasi (features/warehouse/entry/doc-entry.tsx) */
export default function Page() {
  return (
    <Suspense fallback={<LoadingState />}>
      <DocEntry kind="ISSUE" />
    </Suspense>
  );
}