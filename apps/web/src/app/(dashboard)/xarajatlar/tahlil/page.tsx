'use client';

import { LoadingState } from '@/components/ui/states';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Eski manzil: «Xarajatlar › Tahlil» Bosh sahifa › Xarajat ga birlashtirildi (doimiy / o'zgaruvchan — «Xarajat xulqi» jadvalida)
export default function Page() {
  const router = useRouter();
  useEffect(() => router.replace('/tahlil/xarajat'), [router]);
  return <LoadingState />;
}
