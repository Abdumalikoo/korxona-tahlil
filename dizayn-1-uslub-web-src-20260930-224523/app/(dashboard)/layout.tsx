'use client';

import { GlobalSearch } from '@/components/layout/global-search';
import { TopNav } from '@/components/layout/top-nav';
import { LoadingState } from '@/components/ui/states';
import { ReactionBar } from '@/features/reactions/reaction-bar';
import { ReactionSelectProvider } from '@/features/reactions/select-context';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Himoyalangan zona.
 * Kirmagan foydalanuvchi avtomatik kirish sahifasiga yuboriladi.
 * Tepada — doim ko'rinib turadigan yorliqlar (TopNav), Ctrl+K — global qidiruv.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !user) {
      router.replace('/kirish');
    }
  }, [ready, user, router]);

  if (!ready || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav />
      <main className="flex-1">
        <ReactionSelectProvider>
          <ReactionBar />
          {children}
        </ReactionSelectProvider>
      </main>
      <GlobalSearch />
    </div>
  );
}