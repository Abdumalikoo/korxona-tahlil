'use client';

import { LoadingState } from '@/components/ui/states';
import { TelegramSettings } from '@/features/tasks/telegram-settings';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Page() {
  const { isAdmin, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !isAdmin) router.replace('/');
  }, [ready, isAdmin, router]);

  if (!ready || !isAdmin) return <LoadingState />;
  return <TelegramSettings />;
}