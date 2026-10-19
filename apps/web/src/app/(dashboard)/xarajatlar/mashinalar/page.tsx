'use client';

import { LoadingState } from '@/components/ui/states';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Eski manzil (Xarajatlar › Mashinalar) — umumiy hududda Mashinalar dashbordi
export default function OldVehiclesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashbord/mashinalar');
  }, [router]);
  return <LoadingState />;
}