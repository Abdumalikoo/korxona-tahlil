import { api, type ApiResponse } from '@/lib/api';

// ═══════════════════════════════════════════════════════════
// Doimiy / Boshqa — backend bilan bir xil turlar
// ═══════════════════════════════════════════════════════════

export type SectionKind = 'expense' | 'income';
export type SectionValue = 'DOIMIY' | 'BOSHQA';

export interface SectionPart {
  key: string;
  label: string;
  sumTiyin: string;
  count: number;
  /** Moduldan avtomatik yoziladi — o'tkazilmaydi */
  locked: boolean;
}

export interface SectionSummary {
  section: SectionValue;
  sumTiyin: string;
  count: number;
  sharePercent: number;
  previousTiyin: string;
  previousChange: number | null;
  lastYearTiyin: string;
  lastYearChange: number | null;
  unpaidTiyin: string;
  unpaidCount: number;
  parts: SectionPart[];
}

export interface SectionOverview {
  kind: SectionKind;
  period: string;
  previousPeriod: string;
  lastYearPeriod: string;
  totalTiyin: string;
  sections: SectionSummary[];
}

export interface SectionTrendPoint {
  period: string;
  doimiyTiyin: string;
  boshqaTiyin: string;
}

export interface MoveResult {
  section: SectionValue;
  moved: number;
  unchanged: number;
  locked: number;
  missing: number;
}

// ═══════════════════════════════════════════════════════════
// Yorliqlar va navigatsiya
// ═══════════════════════════════════════════════════════════

export const SECTION_LABELS: Record<SectionValue, string> = {
  DOIMIY: 'Doimiy',
  BOSHQA: 'Boshqa',
};

export const SECTION_HINTS: Record<SectionKind, Record<SectionValue, string>> = {
  expense: {
    DOIMIY: "Har oy takrorlanadigan xarajatlar: ish haqi, ijara va doimiy to'lovlar",
    BOSHQA: 'Bir martalik va rejadan tashqari xarajatlar',
  },
  income: {
    DOIMIY: 'Har oy keladigan asosiy tushumlar: hududlar xizmatlari va doimiy daromadlar',
    BOSHQA: 'Bir martalik va rejadan tashqari tushumlar',
  },
};

export interface NavTab {
  href: string;
  label: string;
}

interface KindNav {
  title: string;
  root: string;
  /** Yangi yozuv sahifasi (bo'lsa) — ?section= qo'shiladi */
  newHref: string | null;
  sections: Record<SectionValue, { href: string; tabs: NavTab[] }>;
  /** Bo'lim qismi → sahifa */
  parts: Record<string, string>;
}

/**
 * Doimiy — shu paytgacha qilingan hamma narsa (avvalgi yorliqlar to'liq).
 * Boshqa — bir martalik yozuvlar.
 */
export const SECTION_NAV: Record<SectionKind, KindNav> = {
  expense: {
    title: 'Xarajatlar',
    root: '/xarajatlar',
    newHref: '/xarajatlar/yangi',
    sections: {
      DOIMIY: {
        href: '/xarajatlar/doimiy',
        tabs: [
          { href: '/xarajatlar/doimiy', label: "Ro'yxat" },
          { href: '/xarajatlar/tahlil', label: 'Tahlil' },
          { href: '/xarajatlar/ish-haqi', label: 'Ish haqi' },
          { href: '/xarajatlar/tarkib', label: 'Ish haqi tarkibi' },
          { href: '/xarajatlar/ijara', label: 'Ijara' },
        ],
      },
      BOSHQA: {
        href: '/xarajatlar/boshqa',
        tabs: [{ href: '/xarajatlar/boshqa', label: "Ro'yxat" }],
      },
    },
    parts: {
      PAYROLL: '/xarajatlar/ish-haqi',
      LEASE: '/xarajatlar/ijara',
      VEHICLE: '/dashbord/mashinalar',
      WAREHOUSE: '/dashbord/ombor',
      ASSET: '/xarajatlar/asosiy-vositalar',
      TAX: '/xarajatlar/soliqlar',
    },
  },
  income: {
    title: 'Daromadlar',
    root: '/daromadlar',
    newHref: '/daromadlar/doimiy?new=1',
    sections: {
      DOIMIY: {
        href: '/daromadlar/doimiy',
        tabs: [
          { href: '/daromadlar/doimiy', label: "Ro'yxat" },
          { href: '/daromadlar/tahlil', label: 'Tahlil' },
          { href: '/daromadlar/hududlar', label: 'Hududlar' },
          { href: '/daromadlar/natijalar', label: 'Natijalar' },
        ],
      },
      BOSHQA: {
        href: '/daromadlar/boshqa',
        tabs: [{ href: '/daromadlar/boshqa', label: "Ro'yxat" }],
      },
    },
    parts: {
      REGIONAL: '/daromadlar/hududlar',
    },
  },
};

/** Qism sahifasi: modul bo'lsa o'z sahifasi, aks holda bo'lim ro'yxati */
export function partHref(kind: SectionKind, section: SectionValue, partKey: string): string {
  const nav = SECTION_NAV[kind];
  return nav.parts[partKey] ?? nav.sections[section].href;
}

export function otherSection(section: SectionValue): SectionValue {
  return section === 'DOIMIY' ? 'BOSHQA' : 'DOIMIY';
}

/** O'tkazish natijasi — foydalanuvchiga xabar */
export function moveMessage(result: MoveResult): string {
  const target = SECTION_LABELS[result.section];
  const parts = [`${result.moved} ta yozuv «${target}»ga o'tkazildi`];
  if (result.locked > 0) parts.push(`${result.locked} tasi qulflangan (ish haqi, ijara yoki hududlar tushumi)`);
  if (result.unchanged > 0) parts.push(`${result.unchanged} tasi allaqachon shu bo'limda`);
  return parts.join(', ');
}

// ═══════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════

export const sectionsApi = {
  overview: (kind: SectionKind, period: string) =>
    api.get<ApiResponse<SectionOverview>>(`/sections/${kind}/overview`, { params: { period } }),

  trend: (kind: SectionKind, from: string, to: string) =>
    api.get<ApiResponse<SectionTrendPoint[]>>(`/sections/${kind}/trend`, { params: { from, to } }),

  move: (kind: SectionKind, ids: string[], section: SectionValue) =>
    api.post<ApiResponse<MoveResult>>(`/sections/${kind}/move`, { ids, section }),
};