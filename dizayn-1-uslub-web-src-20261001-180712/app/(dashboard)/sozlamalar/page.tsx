'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { LoadingState } from '@/components/ui/states';

/** Sozlamalar ochilganda xarajat yorlig'iga yo'naltiramiz */
export default function SettingsPage() {
  const { isAdmin, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    router.replace(isAdmin ? '/sozlamalar/xarajat' : '/');
  }, [ready, isAdmin, router]);

  return <LoadingState />;
}
