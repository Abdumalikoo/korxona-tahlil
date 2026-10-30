'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Eski manzil: Solishtirma › Umumiy endi Bosh sahifada («/») */
export default function SolishtirmaUmumiyRedirect() {
  const router = useRouter();
  useEffect(() => router.replace('/'), [router]);
  return null;
}
