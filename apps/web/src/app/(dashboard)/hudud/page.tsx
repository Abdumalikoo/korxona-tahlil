'use client';

import { LoadingState } from '@/components/ui/states';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Hududlar › bosh sahifa: hududchi ish stoliga o'tadi
export default function Page() {
  const router = useRouter();
  useEffect(() => router.replace('/hudud/ish-stoli'), [router]);
  return <LoadingState />;
}