'use client';

import { LoadingState } from '@/components/ui/states';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Eski manzil: «Daromadlar › Tahlil» Bosh sahifa › Daromad ga birlashtirildi (to'lov holati — «To'lanmagan (debitor)» kartasida)
export default function Page() {
  const router = useRouter();
  useEffect(() => router.replace('/tahlil/daromad'), [router]);
  return <LoadingState />;
}
