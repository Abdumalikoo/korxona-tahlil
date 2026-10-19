'use client';

import { LoadingState } from '@/components/ui/states';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Xarid › bosh sahifa: xaridchi ish stoliga o'tadi
export default function Page() {
  const router = useRouter();
  useEffect(() => router.replace('/xarid/ish-stoli'), [router]);
  return <LoadingState />;
}