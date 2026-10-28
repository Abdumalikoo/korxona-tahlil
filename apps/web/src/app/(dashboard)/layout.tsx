'use client';

import { GlobalSearch } from '@/components/layout/global-search';
import { QuickAddDialog } from '@/components/layout/quick-add';
import { PageIntro } from '@/components/layout/page-intro';
import { SectionBar } from '@/components/layout/section-bar';
import { Sidebar } from '@/components/layout/sidebar';
import { TopBar } from '@/components/layout/top-bar';
import { WorkerShell } from '@/components/layout/worker-shell';
import { isPresentationPath, roleDashboardFor, workerAllowed } from '@/components/layout/nav-config';
import { PinSetupScreen } from '@/features/auth/pin';
import { LoadingState } from '@/components/ui/states';
import { ReactionBar } from '@/features/reactions/reaction-bar';
import { ReactionSelectProvider } from '@/features/reactions/select-context';
import { SecurityBanner } from '@/features/security/security-banner';
import { useAuth } from '@/lib/auth-context';
import { PeriodProvider } from '@/lib/period';
import { cn } from '@/lib/utils';
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

const TOP_HIDDEN_KEY = 'topbar-hidden';

function readTopHidden(): boolean {
  try {
    return window.localStorage.getItem(TOP_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function writeTopHidden(value: boolean) {
  try {
    window.localStorage.setItem(TOP_HIDDEN_KEY, value ? '1' : '0');
  } catch {
    // Saqlab bo'lmasa — faqat shu ochilishda
  }
}

/** Qobiq: menyu, yuqori panel va sahifa (menyu ikkala rejimda bir xil) */
function Shell({ menuOpen, onMenu, closeMenu, children }: { menuOpen: boolean; onMenu: () => void; closeMenu: () => void; children: React.ReactNode }) {
  const pathname = usePathname() ?? '/';
  // Ko'rsatuv sahifalari (Bosh sahifa, Solishtirma) — boshqaruv elementlarisiz: ularni boshqalar ko'radi
  const quiet = isPresentationPath(pathname);
  // Yuqori panel — yon menyudek yashiriladi va qaytariladi (tanlov eslab qolinadi). Panel DOM'da qoladi (CSS bilan
  // yashiriladi) — sahifa sarlavhasi va tugmalari unga joylangan, yo'qolib qolmasin.
  // Shell faqat kirish tekshiruvidan keyin (brauzerda) chiziladi — localStorage boshidanoq o'qiladi.
  const [topHidden, setTopHidden] = useState(readTopHidden);
  const toggleTop = () =>
    setTopHidden((value) => {
      writeTopHidden(!value);
      return !value;
    });
  return (
    <div className="flex h-screen overflow-hidden bg-(--color-surface-muted)">
      <Sidebar mobileOpen={menuOpen} onMobileClose={closeMenu} />

      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <ReactionSelectProvider>
          {/* Yuqori panel va Munosabat qatori birga yopishib turadi */}
          <div className={cn('no-print sticky top-0 z-30', topHidden && 'hidden')}>
            <TopBar onMenu={onMenu} onHide={toggleTop} quiet={quiet} />
            {!quiet && <ReactionBar />}
          </div>
          {topHidden && (
            <button
              type="button"
              onClick={toggleTop}
              className="no-print fixed right-4 top-2 z-40 flex items-center gap-1 rounded-b-xl rounded-t-md border border-(--color-line) bg-white/95 px-3 py-1 text-xs font-medium text-(--color-text-muted) shadow-md backdrop-blur hover:text-brand-700"
              title="Yuqori panelni ko'rsatish"
              aria-label="Yuqori panelni ko'rsatish"
            >
              ▾ Panel
            </button>
          )}
          <div className="flex-1 pb-8">
            {/* Bo'lim yorliqlari: Umumiy · Doimiy · Boshqa · … — har bir ichki sahifada */}
            <Suspense fallback={null}>
              <SectionBar />
            </Suspense>
            {/* Administrator: standart parol/kod almashtirilmagan bo'lsa — ogohlantirish (ko'rsatuv sahifalarida — yo'q) */}
            {!quiet && <SecurityBanner />}
            {/* Sahifa haqida qisqa tushuntirish: nima ko'rsatadi, ma'lumot qayerdan */}
            <PageIntro />
            <Suspense fallback={<LoadingState />}>{children}</Suspense>
            {/* Sahifa pastida: «Qisqa» rejim izohi va sahifa haqida tushuntirish — asosiy raqamlar tepada */}
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