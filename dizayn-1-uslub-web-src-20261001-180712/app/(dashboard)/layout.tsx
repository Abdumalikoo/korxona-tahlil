'use client';

import { GlobalSearch } from '@/components/layout/global-search';
import { SectionBar } from '@/components/layout/section-bar';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { LoadingState } from '@/components/ui/states';
import { ReactionBar } from '@/features/reactions/reaction-bar';
import { ReactionSelectProvider } from '@/features/reactions/select-context';
import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

/**
 * Himoyalangan zona.
 * Kirmagan foydalanuvchi avtomatik kirish sahifasiga yuboriladi.
 *
 * Ko'rinish: chapda ko'k menyu, o'ngda — yuqorida oq panel (sarlavha, qidiruv,
 * foydalanuvchi), uning tagida bo'lim yorliqlari, pastida sahifa (och ko'k fonda oq kartalar).
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

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
    <div className="flex h-screen overflow-hidden bg-(--color-surface-muted)">
      <Sidebar mobileOpen={menuOpen} onMobileClose={closeMenu} />

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <ReactionSelectProvider>
          {/* Yuqori panel va Munosabat qatori birga yopishib turadi */}
          <div className="no-print sticky top-0 z-30">
            <TopBar onMenu={() => setMenuOpen(true)} />
            <ReactionBar />
          </div>
          <div className="flex-1 pb-8">
            {/* Bo'lim yorliqlari: Umumiy · Doimiy · Boshqa · … — har bir ichki sahifada */}
            <Suspense fallback={null}>
              <SectionBar />
            </Suspense>
            {children}
          </div>
        </ReactionSelectProvider>
      </main>

      <GlobalSearch />
    </div>
  );
}