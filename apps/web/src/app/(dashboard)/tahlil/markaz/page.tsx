'use client';

import { LoadingState } from '@/components/ui/states';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

// Eski manzil: «Tahlil › Markaz tushumi» — xuddi shu ma'lumot Daromadlar › Markaz sahifasida
export default function Page() {
  const router = useRouter();
  useEffect(() => router.replace('/daromadlar/markaz'), [router]);
  return <LoadingState />;
}
