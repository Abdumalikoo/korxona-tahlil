'use client';

import { LoadingState } from '@/components/ui/states';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Eski manzil: «Bosh sahifa › Daromad manbalari» olib tashlandi — kunlik hisobot manbalari Daromadlar › Markaz tushumi sahifasida
export default function Page() {
  const router = useRouter();
  useEffect(() => router.replace('/daromadlar/markaz'), [router]);
  return <LoadingState />;
}
