'use client';

import { GlobalSearch } from '@/components/layout/global-search';
import { QuickAddDialog } from '@/components/layout/quick-add';
import { PageIntro } from '@/components/layout/page-intro';
import { SectionBar } from '@/components/layout/section-bar';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { WorkerShell } from '@/components/layout/worker-shell';
import { roleDashboardFor, workerAllowed } from '@/components/layout/nav-config';
import { PinSetupScreen } from '@/features/auth/pin';
import { LoadingState } from '@/components/ui/states';
import { ReactionBar } from '@/features/reactions/reaction-bar';
import { ReactionSelectProvider } from '@/features/reactions/select-context';
import { useAuth } from '@/lib/auth-context';
import { PeriodProvider } from '@/lib/period';
import { ViewModeProvider } from '@/lib/view-mode';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';

/**
 * Himoyalangan zona.
 * Kirmagan foydalanuvchi avtomatik kirish sahifasiga yuboriladi.
 * Ishchi rollar (Omborchi …) — alohida qobiq: faqat o'z bo'limi (WorkerShell).
 * Umumiy hudud (administrator, kuzatuvchi) rol sahifasini ochsa (/ombor, /mashinalar) —
 * o'sha bo'limning dashbordiga o'tkaziladi: kiritish faqat rolda.
 *
 * Ko'rinish: chapda ko'k menyu, o'ngda — yuqorida oq panel (sarlavha, qidiruv,
 * foydalanuvchi), uning tagida bo'lim yorliqlari, pastida sahifa (och ko'k fonda oq kartalar).
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, isWorker, home } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? '/';
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  /** Ishchi rol o'ziga tegishli bo'lmagan sahifaga kirsa — o'z bo'limiga qaytariladi */
  const outside = Boolean(user) && isWorker && !workerAllowed(user?.access?.pages ?? [], pathname);
  /** Umumiy hudud — rol sahifasi o'rniga dashbord */
  const dashboard = Boolean(user) && !isWorker ? roleDashboardFor(pathname) : null;

  useEffect(() => {
    if (ready && !user) {
      router.replace('/kirish');
    } else if (ready && outside) {
      router.replace(home);
    } else if (ready && dashboard) {
      router.replace(dashboard);
    }
  }, [ready, user, outside, home, dashboard, router]);

  if (!ready || !user || outside || dashboard) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  // Ishchi rollar (Omborchi …): avval o'z PIN'i, keyin faqat o'z bo'limi
  if (isWorker) {
    if (user.mustChangePin) return <PinSetupScreen />;
    return (
      <PeriodProvider>
        <WorkerShell>
          <Suspense fallback={<LoadingState />}>{children}</Suspense>
        </WorkerShell>
      </PeriodProvider>
    );
  }

  return (
    <ViewModeProvider>
      <PeriodProvider>
        <Shell menuOpen={menuOpen} onMenu={() => setMenuOpen(true)} closeMenu={closeMenu}>
          {children}
        </Shell>
      </PeriodProvider>
    </ViewModeProvider>
  );
}

/** Qobiq: menyu, yuqori panel va sahifa (menyu ikkala rejimda bir xil) */
function Shell({ menuOpen, onMenu, closeMenu, children }: { menuOpen: boolean; onMenu: () => void; closeMenu: () => void; children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-(--color-surface-muted)">
      <Sidebar mobileOpen={menuOpen} onMobileClose={closeMenu} />

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <ReactionSelectProvider>
          {/* Yuqori panel va Munosabat qatori birga yopishib turadi */}
          <div className="no-print sticky top-0 z-30">
            <TopBar onMenu={onMenu} />
            <ReactionBar />
          </div>
          <div className="flex-1 pb-8">
            {/* Bo'lim yorliqlari: Umumiy · Doimiy · Boshqa · … — har bir ichki sahifada */}
            <Suspense fallback={null}>
              <SectionBar />
            </Suspense>
            {/* Sahifa haqida qisqa tushuntirish: nima ko'rsatadi, ma'lumot qayerdan */}
            <PageIntro />
            <Suspense fallback={<LoadingState />}>{children}</Suspense>
            <div id="page-bottom-slot" className="no-print px-4 pt-2 empty:hidden md:px-6" />
            <PageIntro placement="bottom" />
          </div>
        </ReactionSelectProvider>
      </main>

      <GlobalSearch />
      <QuickAddDialog />
    </div>
  );
}