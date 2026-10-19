'use client';

import { LoadingState } from '@/components/ui/states';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Buxgalteriya › bosh sahifa: buxgalter ish stoliga o'tadi
export default function Page() {
  const router = useRouter();
  useEffect(() => router.replace('/buxgalteriya/ish-stoli'), [router]);
  return <LoadingState />;
}