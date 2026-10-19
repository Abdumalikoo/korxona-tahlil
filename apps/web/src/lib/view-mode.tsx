'use client';

import { isSourcePath, ROLE_DASHBOARDS } from '@/components/layout/nav-config';
import { api, type ApiResponse } from '@/lib/api';
import { usePathname } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// ═══════════════════════════════════════════════════════════
// Ko'rinish rejimi — butun dastur uchun bitta (administrator tanlaydi):
//   brief — qisqa: rahbar uchun eng muhim raqamlar va xulosalar
//   full  — to'liq: hamma tafsilot, maydalab ko'rish
// Manba (Daromadlar, Xarajatlar, Xodimlar, Sozlamalar) va rollarning ish joylari
// (Ombor, Mashinalar, Xarid, Buxgalteriya, Hududlar) — har doim to'liq.
// Qisqa rejimda: faqat asosiy raqamlar va xulosalar; grafik, diagramma, katta jadval va
// modellar — To'liq rejimda.
//
// Ishlatish:
//   const brief = useBrief();            // shu sahifada qisqa ko'rinish kerakmi
//   <Detail>…tafsilot…</Detail>          // qisqa rejimda yashiriladi
//   <BriefOnly>…qisqa xulosa…</BriefOnly> // faqat qisqa rejimda
// ═══════════════════════════════════════════════════════════

export type ViewMode = 'brief' | 'full';

interface ViewModeApi {
  mode: ViewMode;
  ready: boolean;
  /** Faqat administrator (backend ham tekshiradi) */
  setMode: (mode: ViewMode) => Promise<void>;
}

const Context = createContext<ViewModeApi | null>(null);

/** Rejim o'zgarganda (boshqa tabda ham) — brauzer hodisasi */
export const VIEW_MODE_CHANGED = 'korxona:view-mode';
/** Sahifa yangilanganda «sakrash» bo'lmasligi uchun oxirgi rejim eslab qolinadi */
const CACHE_KEY = 'korxona_view_mode';

function cached(): ViewMode {
  try {
    return window.localStorage.getItem(CACHE_KEY) === 'brief' ? 'brief' : 'full';
  } catch {
    return 'full';
  }
}

function remember(mode: ViewMode) {
  try {
    window.localStorage.setItem(CACHE_KEY, mode);
  } catch {
    // eslab qolinmasa ham ishlayveradi
  }
}

export const viewModeApi = {
  get: () => api.get<ApiResponse<{ mode: ViewMode; updatedAt: string | null }>>('/view-mode'),
  set: (mode: ViewMode) => api.patch<ApiResponse<{ mode: ViewMode; updatedAt: string | null }>>('/view-mode', { mode }),
};

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ViewMode>('full');
  const [ready, setReady] = useState(false);

  const load = useCallback(() => {
    viewModeApi
      .get()
      .then((r) => {
        setModeState(r.data.mode);
        remember(r.data.mode);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    setModeState(cached());
    load();
    // Boshqa oynada o'zgarsa yoki 5 daqiqada bir — serverdan qayta o'qiladi
    const timer = setInterval(load, 5 * 60_000);
    const onStorage = (e: StorageEvent) => {
      if (e.key === CACHE_KEY && (e.newValue === 'brief' || e.newValue === 'full')) setModeState(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(VIEW_MODE_CHANGED, load);
    return () => {
      clearInterval(timer);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(VIEW_MODE_CHANGED, load);
    };
  }, [load]);

  const setMode = useCallback(async (next: ViewMode) => {
    const r = await viewModeApi.set(next);
    setModeState(r.data.mode);
    remember(r.data.mode);
    window.dispatchEvent(new Event(VIEW_MODE_CHANGED));
  }, []);

  return <Context.Provider value={{ mode, ready, setMode }}>{children}</Context.Provider>;
}

/** Rejim va uni almashtirish (Provider bo'lmasa — to'liq rejim) */
export function useViewMode(): ViewModeApi {
  return useContext(Context) ?? { mode: 'full', ready: true, setMode: async () => undefined };
}

/** Joriy sahifada qisqa ko'rinish kerakmi (Manba sahifalarida — har doim yo'q) */
export function useBrief(): boolean {
  const { mode } = useViewMode();
  const pathname = usePathname();
  const path = pathname ?? '/';
  return mode === 'brief' && !isSourcePath(path) && !isWorkZone(path);
}

/** Rol ish joylari (Omborchi, Buxgalter …) — u yerda hamma narsa ish uchun kerak */
function isWorkZone(path: string): boolean {
  return ROLE_DASHBOARDS.some(({ prefix }) => path === prefix || path.startsWith(`${prefix}/`));
}

/** Tafsilot — qisqa rejimda yashiriladi */
export function Detail({ children }: { children: ReactNode }) {
  return useBrief() ? null : <>{children}</>;
}

/** Faqat qisqa rejimda ko'rinadi */
export function BriefOnly({ children }: { children: ReactNode }) {
  return useBrief() ? <>{children}</> : null;
}

/**
 * Qisqa rejimda sahifa tepasidagi izoh: nima ko'rsatilayotgani va nima yashirilgani.
 * To'liq rejimda hech narsa chizilmaydi.
 */
export function BriefNote({ shows, hidden, className }: { shows: string; hidden?: string; className?: string }) {
  const brief = useBrief();
  // Izoh sahifa pastiga (layout'dagi «page-bottom-slot») ko'chiriladi — asosiy raqamlar birinchi ko'rinsin
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(BOTTOM_SLOT_ID)), []);
  if (!brief) return null;
  const note = (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-(--radius-card) border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm ${slot ? '' : (className ?? '')}`}>
      <span className="rounded-md bg-brand-600 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">Qisqa</span>
      <span className="text-heading">{shows}</span>
      {hidden && <span className="text-xs text-(--color-text-muted)">To&apos;liq rejimda yana: {hidden}.</span>}
    </div>
  );
  return slot ? createPortal(note, slot) : note;
}

/** Sahifa pastidagi joy (layout): BriefNote shu yerga chiziladi */
export const BOTTOM_SLOT_ID = 'page-bottom-slot';