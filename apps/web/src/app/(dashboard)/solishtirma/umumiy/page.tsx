'use client';

import { LoadingState } from '@/components/ui/states';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Eski manzil: «Umumiy manba» Bosh sahifa › Umumiy ga ko'chirildi
export default function Page() {
  const router = useRouter();
  useEffect(() => router.replace('/tahlil/korxona'), [router]);
  return <LoadingState />;
}