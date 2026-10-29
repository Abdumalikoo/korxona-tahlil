'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Umumiy «Davr» — butun dastur uchun bitta sana oralig'i.
// Yuqori paneldagi «Davr» tugmasi (components/layout/period-control.tsx) uni o'zgartiradi,
// davr bilan ishlaydigan hamma sahifa shu yerdan o'qiydi:
//
//   const { range, month } = usePeriod();   // range = {from, to}, month = "2026-10" (oraliqning oxirgi oyi)
//
// Standart — «Bu oy» (oyning 1-kunidan bugungacha).
// Tanlov brauzerda eslab qolinadi; tez tanlovlar (Bu oy, O'tgan oy…) har safar
// bugungi sanaga qarab qayta hisoblanadi — yangi oy kirsa «Bu oy» o'zi yangilanadi.
// Davr manzilga ham yoziladi (?dateFrom=&dateTo=) — havolani ulashsa, o'sha davr ochiladi.
// ═══════════════════════════════════════════════════════════

/** Yuqori paneldagi «Davr» oynasini ochish (masalan, bo'sh holatdagi «Davrni o'zgartirish» tugmasidan) */
export const OPEN_PERIOD_EVENT = 'korxona:period-open';

export function openPeriodPicker() {
  window.dispatchEvent(new Event(OPEN_PERIOD_EVENT));
}

export type PresetKey = 'month' | 'prevMonth' | 'quarter' | 'year' | 'last12' | 'prevYear' | 'custom';

export interface Preset {
  key: Exclude<PresetKey, 'custom'>;
  label: string;
  hint: string;
  range: () => DateRange;
}

const TASHKENT_OFFSET_MS = 5 * 3600_000;
const STORE_KEY = 'korxona_period';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Toshkent vaqti bo'yicha bugun: {y, m (1–12), d} */
function now() {
  const t = new Date(Date.now() + TASHKENT_OFFSET_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Oyning oxirgi kuni (m: 1–12) */
function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** m oydan n oy oldingi (yoki keyingi) oy: {y, m} */
function shiftMonth(y: number, m: number, n: number) {
  const total = y * 12 + (m - 1) + n;
  return { y: Math.floor(total / 12), m: (total % 12) + 1 };
}

export function todayIso(): string {
  const t = now();
  return iso(t.y, t.m, t.d);
}

export const PRESETS: Preset[] = [
  {
    key: 'month',
    label: 'Bu oy',
    hint: "Oyning 1-kunidan bugungacha",
    range: () => {
      const t = now();
      return { from: iso(t.y, t.m, 1), to: iso(t.y, t.m, t.d) };
    },
  },
  {
    key: 'prevMonth',
    label: "O'tgan oy",
    hint: "O'tgan oyning to'liq kunlari",
    range: () => {
      const t = now();
      const p = shiftMonth(t.y, t.m, -1);
      return { from: iso(p.y, p.m, 1), to: iso(p.y, p.m, lastDay(p.y, p.m)) };
    },
  },
  {
    key: 'quarter',
    label: 'Bu chorak',
    hint: 'Chorak boshidan bugungacha',
    range: () => {
      const t = now();
      const qm = Math.floor((t.m - 1) / 3) * 3 + 1;
      return { from: iso(t.y, qm, 1), to: iso(t.y, t.m, t.d) };
    },
  },
  {
    key: 'year',
    label: 'Yil boshidan',
    hint: '1-yanvardan bugungacha',
    range: () => {
      const t = now();
      return { from: iso(t.y, 1, 1), to: iso(t.y, t.m, t.d) };
    },
  },
  {
    key: 'last12',
    label: 'Oxirgi 12 oy',
    hint: "Joriy oy bilan birga 12 ta to'liq oy",
    range: () => {
      const t = now();
      const s = shiftMonth(t.y, t.m, -11);
      return { from: iso(s.y, s.m, 1), to: iso(t.y, t.m, t.d) };
    },
  },
  {
    key: 'prevYear',
    label: "O'tgan yil",
    hint: "1-yanvardan 31-dekabrgacha",
    range: () => {
      const y = now().y - 1;
      return { from: iso(y, 1, 1), to: iso(y, 12, 31) };
    },
  },
];

export const DEFAULT_PRESET: Exclude<PresetKey, 'custom'> = 'month';

export function presetRange(key: Exclude<PresetKey, 'custom'>): DateRange {
  return (PRESETS.find((p) => p.key === key) ?? PRESETS[0]).range();
}

/** Oraliq qaysi tez tanlovga to'g'ri keladi (aks holda — custom) */
export function matchPreset(range: DateRange): PresetKey {
  const hit = PRESETS.find((p) => {
    const r = p.range();
    return r.from === range.from && r.to === range.to;
  });
  return hit?.key ?? 'custom';
}

export function isValidRange(range: Partial<DateRange> | null | undefined): range is DateRange {
  return !!range && typeof range.from === 'string' && typeof range.to === 'string' && ISO.test(range.from) && ISO.test(range.to) && range.from <= range.to;
}

/**
 * Sahifa davr bilan qanday ishlaydi:
 *   range — sana oralig'i (dan — gacha);
 *   month — oy bo'yicha: tanlangan davrning OXIRGI OYI ko'rsatiladi, tugma «‹ Oktyabr 2026 ›» ko'rinishida;
 *   null  — davr kerak emas (Sozlamalar, yangi yozuv va h.k.) — tugma ko'rinmaydi.
 * Keyingi bosqichda ro'yxat kengayadi.
 */
export type PeriodMode = 'range' | 'month';

const PERIOD_PATHS: { path: string; mode: PeriodMode; exact?: boolean; except?: string[] }[] = [
  { path: '/', mode: 'range', exact: true },
  { path: '/tahlil', mode: 'range' },
  { path: '/solishtirma', mode: 'range' },
  // Modellar: davr oxirigacha bo'lgan ma'lumot ustida (oy ko'rinishi)
  { path: '/modellar', mode: 'month' },
  { path: '/katta-modellar', mode: 'month' },
  // Munosabat ro'yxati — davrda faol bo'lganlar; Nazorat — tanlangan oy oxiridagi holat
  { path: '/munosabat', mode: 'range', exact: true },
  { path: '/nazorat', mode: 'month' },
  // Hisobotlar — hisobot davri; Xodimlar — davr oxiridagi holat va o'tkazmalar
  { path: '/hisobotlar', mode: 'range' },
  { path: '/xodimlar', mode: 'range' },
  // Manba: ro'yxatlar, yuklashlar va oy bo'yicha hisobotlar
  { path: '/daromadlar', mode: 'month' },
  { path: '/xarajatlar', mode: 'month', except: ['/xarajatlar/yangi', '/xarajatlar/internet'] },
  // Ombor: umumiy ko'rinish va hujjatlar — davr bo'yicha; qoldiq va asosiy vositalar — bugungi holat
  { path: '/ombor', mode: 'range', exact: true },
  { path: '/ombor/hujjatlar', mode: 'range' },
  { path: '/ombor/pochta', mode: 'range' },
  // Mashinalar: ro'yxat — oy bo'yicha hisobot; kiritish sahifasi — davrsiz
  { path: '/mashinalar/royxat', mode: 'month' },
  { path: '/mashinalar/avtopark', mode: 'month' },
  { path: '/mashinalar/tahlil', mode: 'month' },
  // Umumiy hudud: rollar dashbordi
  { path: '/rollar', mode: 'range' },
  { path: '/dashbord/ombor', mode: 'range' },
  { path: '/dashbord/mashinalar', mode: 'month' },
];

function under(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export function periodMode(pathname: string): PeriodMode | null {
  const hit = PERIOD_PATHS.find((p) => (p.exact ? pathname === p.path : under(pathname, p.path) && !(p.except ?? []).some((e) => under(pathname, e))));
  return hit?.mode ?? null;
}

export function usesPeriod(pathname: string): boolean {
  return periodMode(pathname) !== null;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Joriy oy: "2026-10" */
export function currentMonth(): string {
  return todayIso().slice(0, 7);
}

/** Oy oralig'i: 1-kundan oxirgi kunigacha (joriy oyda — bugungacha) */
export function monthRange(period: string): DateRange {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const from = iso(y, m, 1);
  const last = iso(y, m, lastDay(y, m));
  const today = todayIso();
  return { from, to: last > today ? today : last };
}

interface Stored {
  preset: PresetKey;
  range: DateRange;
}

function readStored(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Stored>;
    if (v.preset && v.preset !== 'custom' && PRESETS.some((p) => p.key === v.preset)) {
      // Tez tanlov — bugungi kunga qarab qayta hisoblanadi
      const key = v.preset as Exclude<PresetKey, 'custom'>;
      return { preset: key, range: presetRange(key) };
    }
    return isValidRange(v.range) ? { preset: 'custom', range: v.range } : null;
  } catch {
    return null;
  }
}

function store(value: Stored) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(value));
  } catch {
    // eslab qolinmasa ham ishlayveradi
  }
}

/** Manzildagi ?dateFrom=&dateTo= yoki ?period=YYYY-MM (oy bilan ishlaydigan sahifalar havolalari) */
function readUrl(): DateRange | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const r = { from: params.get('dateFrom') ?? '', to: params.get('dateTo') ?? '' };
  if (isValidRange(r)) return r;
  const period = params.get('period') ?? '';
  if (MONTH.test(period) && period <= currentMonth()) return monthRange(period);
  return null;
}

function initial(): Stored {
  const fromUrl = readUrl();
  if (fromUrl) return { preset: matchPreset(fromUrl), range: fromUrl };
  if (typeof window !== 'undefined') {
    const s = readStored();
    if (s) return s;
  }
  return { preset: DEFAULT_PRESET, range: presetRange(DEFAULT_PRESET) };
}

interface PeriodApi {
  /** Tanlangan oraliq: {from, to} — YYYY-MM-DD */
  range: DateRange;
  /** Qaysi tez tanlov (yoki custom — qo'lda) */
  preset: PresetKey;
  /** Oraliqning oxirgi oyi — oy bilan ishlaydigan sahifalar uchun: "2026-10" */
  month: string;
  /** Qo'lda oraliq (preset ko'rsatilmasa — o'zi aniqlanadi) */
  setRange: (range: DateRange, preset?: PresetKey) => void;
  /** Bitta oyni tanlash ("2026-09") — oy bilan ishlaydigan sahifalar uchun */
  setMonth: (period: string) => void;
  /** Tez tanlov */
  setPreset: (key: Exclude<PresetKey, 'custom'>) => void;
  /** Sahifada o'z «Dan — Gacha» oralig'i bor (MonthRangeCard) — yuqoridagi davr tugmasi yashiriladi (ikki tanlagich chiqmasin) */
  pageOwnsRange: boolean;
  /** Sahifa o'z oralig'ini e'lon qiladi; qaytgan funksiya — bekor qilish (komponent yo'qolganda) */
  claimRange: () => () => void;
}

const Context = createContext<PeriodApi | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const [state, setState] = useState<Stored>(initial);
  const [owners, setOwners] = useState(0);
  const claimRange = useCallback(() => {
    setOwners((n) => n + 1);
    return () => setOwners((n) => Math.max(0, n - 1));
  }, []);

  // Boshqa sahifaga o'tilganda manzilda davr bo'lsa — o'sha olinadi (ulashilgan havola)
  useEffect(() => {
    const fromUrl = readUrl();
    if (!fromUrl) return;
    setState((prev) => {
      if (prev.range.from === fromUrl.from && prev.range.to === fromUrl.to) return prev;
      const next = { preset: matchPreset(fromUrl), range: fromUrl };
      store(next);
      return next;
    });
  }, [pathname]);

  // Boshqa oynada o'zgartirilsa — bu yerda ham
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORE_KEY) return;
      const s = readStored();
      if (s) setState(s);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  /**
   * Davrni manzilga yozish (boshqa parametrlar — tab, filtr — saqlanadi):
   * oraliq sahifalarida ?dateFrom=&dateTo=, oy sahifalarida ?period= (joriy oyda — yozilmaydi).
   */
  const writeUrl = useCallback(
    (range: DateRange) => {
      const mode = periodMode(pathname);
      if (!mode) return;
      const params = new URLSearchParams(window.location.search);
      if (mode === 'range') {
        params.delete('period');
        params.set('dateFrom', range.from);
        params.set('dateTo', range.to);
      } else {
        params.delete('dateFrom');
        params.delete('dateTo');
        const month = range.to.slice(0, 7);
        if (month === currentMonth()) params.delete('period');
        else params.set('period', month);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const setRange = useCallback(
    (range: DateRange, preset?: PresetKey) => {
      if (!isValidRange(range)) return;
      const next: Stored = { preset: preset ?? matchPreset(range), range };
      setState(next);
      store(next);
      writeUrl(range);
    },
    [writeUrl],
  );

  const setPreset = useCallback((key: Exclude<PresetKey, 'custom'>) => setRange(presetRange(key), key), [setRange]);

  const setMonth = useCallback(
    (period: string) => {
      if (!MONTH.test(period)) return;
      const safe = period > currentMonth() ? currentMonth() : period;
      setRange(monthRange(safe));
    },
    [setRange],
  );

  const value = useMemo<PeriodApi>(
    () => ({ range: state.range, preset: state.preset, month: state.range.to.slice(0, 7), setRange, setPreset, setMonth, pageOwnsRange: owners > 0, claimRange }),
    [state, setRange, setPreset, setMonth, owners, claimRange],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Umumiy davr. Provider bo'lmasa (masalan, sinov) — «Bu oy» */
export function usePeriod(): PeriodApi {
  const ctx = useContext(Context);
  if (ctx) return ctx;
  const range = presetRange(DEFAULT_PRESET);
  return { range, preset: DEFAULT_PRESET, month: range.to.slice(0, 7), setRange: () => undefined, setPreset: () => undefined, setMonth: () => undefined, pageOwnsRange: false, claimRange: () => () => undefined };
}

/** Tugmadagi nom: "Bu oy" yoki "Tanlangan davr" */
export function presetLabel(key: PresetKey): string {
  return PRESETS.find((p) => p.key === key)?.label ?? 'Tanlangan davr';
}

/**
 * Oy o'zgarganda bajariladigan ish (birinchi ochilishda emas):
 * masalan, yuklash oynasini tozalash yoki ro'yxatni 1-sahifaga qaytarish.
 */
export function useMonthChange(month: string, effect: () => void) {
  const previous = useRef(month);
  const latest = useRef(effect);
  // Eng so'nggi funksiya — render paytida emas, effektda (pastdagi effektdan oldin ishlaydi)
  useLayoutEffect(() => {
    latest.current = effect;
  });
  useEffect(() => {
    if (previous.current === month) return;
    previous.current = month;
    latest.current();
  }, [month]);
}

/**
 * Modellar uchun «qaysi oy oxiridagi holat»: tanlangan davrning oxirgi oyi o'tgan oy bo'lsa — o'sha oy,
 * joriy oy bo'lsa — undefined (bugungi holat, backend keshi umumiy bo'ladi).
 */
export function useAsOf(): string | undefined {
  const { month } = usePeriod();
  return month < currentMonth() ? month : undefined;
}