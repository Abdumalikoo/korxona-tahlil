'use client';

import { IconBuilding } from '@/components/ui/icons';
import { Select } from '@/components/ui/select';
import { regionsApi } from '@/features/employees/api';
import { SEGMENTS, isSegment, segmentLabel, type SegmentCode } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import type { Department } from '@/lib/types';
import type { ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Yozuv qayerga tegishli (daromad va xarajat uchun bir xil):
//   • Markaz — va uning bo'limi (ixtiyoriy);
//   • Hudud — viloyat (majburiy) va tumani (ixtiyoriy);
//   • Yo'nalishlar — Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari (ichki bo'linishsiz).
// Solishtirma shu tanlov bo'yicha yozuvni Markazga, hududga (tumanga) yoki yo'nalishga yozadi.
// ═══════════════════════════════════════════════════════════

export type PlaceKind = 'CENTER' | 'REGION' | 'SEGMENT' | '';

export interface PlaceValue {
  /** '' — hali tanlanmagan (eski, hech qayerga biriktirilmagan yozuvlar) */
  kind: PlaceKind;
  /** Markaz bo'limi ('' — Markaz umumiy) */
  departmentId: string;
  /** Hudud kodi (satr ko'rinishida, '' — tanlanmagan) */
  regionCode: string;
  /** Tuman ('' — viloyat bo'yicha, tumansiz) */
  districtId: string;
  /** Yo'nalish kodi (kind = SEGMENT) */
  segment: string;
}

export const EMPTY_PLACE: PlaceValue = { kind: '', departmentId: '', regionCode: '', districtId: '', segment: '' };

/** Yozuvdagi maydonlardan tanlov holati */
export function placeOf(record: { regionCode?: number | null; departmentId: string | null; districtId?: string | null; segment?: string | null }): PlaceValue {
  if (record.segment && isSegment(record.segment)) return { ...EMPTY_PLACE, kind: 'SEGMENT', segment: record.segment };
  const region = record.regionCode ?? null;
  if (region === 0 || (region === null && record.departmentId)) return { ...EMPTY_PLACE, kind: 'CENTER', departmentId: record.departmentId ?? '' };
  if (region !== null) return { ...EMPTY_PLACE, kind: 'REGION', regionCode: String(region), districtId: record.districtId ?? '' };
  return EMPTY_PLACE;
}

/** Eslab qolingan qiymatni tekshirib tiklash (eski formatlar ham) */
export function restorePlace(raw: unknown): PlaceValue | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = { ...EMPTY_PLACE, ...(raw as Partial<PlaceValue>) };
  if (v.kind === 'CENTER' || (v.kind === 'REGION' && v.regionCode) || (v.kind === 'SEGMENT' && isSegment(v.segment))) return v;
  return null;
}

/** Tanlovni tekshirish: xato matni yoki null */
export function placeError(place: PlaceValue): string | null {
  if (!place.kind) return "Qayerga tegishli ekanini tanlang: Markaz, Hudud yoki yo'nalish";
  if (place.kind === 'REGION' && !place.regionCode) return 'Hududni tanlang';
  if (place.kind === 'SEGMENT' && !isSegment(place.segment)) return "Yo'nalishni tanlang";
  return null;
}

/**
 * API uchun maydonlar. Bo'sh qatorlar ('') — «yo'q» degani: tahrirlashda eski qiymat tozalanadi
 * (masalan, Markazdan yo'nalishga o'tganda bo'lim olib tashlanadi). Tanlanmagan bo'lsa — null (hech narsa yuborilmaydi).
 */
export function placePayload(place: PlaceValue): { regionCode?: number; departmentId: string; districtId: string; segment: string } | null {
  if (place.kind === 'CENTER') return { regionCode: 0, departmentId: place.departmentId, districtId: '', segment: '' };
  if (place.kind === 'REGION' && place.regionCode) return { regionCode: Number(place.regionCode), departmentId: '', districtId: place.districtId, segment: '' };
  if (place.kind === 'SEGMENT' && isSegment(place.segment)) return { departmentId: '', districtId: '', segment: place.segment };
  return null;
}

/** Yangi yozuv uchun — faqat to'ldirilgan maydonlar */
export function placeCreatePayload(place: PlaceValue): { regionCode?: number; departmentId?: string; districtId?: string; segment?: string } {
  const p = placePayload(place);
  if (!p) return {};
  return {
    ...(p.regionCode !== undefined ? { regionCode: p.regionCode } : {}),
    ...(p.departmentId ? { departmentId: p.departmentId } : {}),
    ...(p.districtId ? { districtId: p.districtId } : {}),
    ...(p.segment ? { segment: p.segment } : {}),
  };
}

// ─────────── Belgilar ───────────

const svg = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-5">
    {path}
  </svg>
);

const ICONS: Record<'REGION' | SegmentCode, ReactNode> = {
  REGION: svg(
    <>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10" r="2.4" />
    </>,
  ),
  TAX_FREE: svg(
    <>
      <path d="M19 5 5 19" />
      <circle cx="7" cy="7" r="2.2" />
      <circle cx="17" cy="17" r="2.2" />
    </>,
  ),
  MARKSHEYDER: svg(
    <>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" />
    </>,
  ),
  FERMER: svg(
    <>
      <path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z" />
      <path d="M5 19 13 11" />
    </>,
  ),
  QOMITA: svg(
    <>
      <path d="M4 10h16M6 10v8M10 10v8M14 10v8M18 10v8M3 21h18M12 3 3 8h18z" />
    </>,
  ),
  BUXGALTERIYA: svg(
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 7h8M8 11h2M12 11h2M16 11h0M8 15h2M12 15h2M8 18h2M12 18h4" />
    </>,
  ),
};

interface PlacePickerProps {
  value: PlaceValue;
  onChange: (value: PlaceValue) => void;
  departments: Department[];
  error?: string;
  disabled?: boolean;
  /** Sarlavha tashqarida berilgan bo'lsa — o'z yorlig'i ko'rsatilmaydi */
  hideLabel?: boolean;
  /** Ixcham ko'rinish (tor oynalar: tahrirlash paneli) */
  compact?: boolean;
  /** «daromad» yoki «xarajat» — izoh matni uchun */
  noun?: string;
  /**
   * Bo'lim sahifasidan ochilganda (CENTER, REGION yoki yo'nalish kodi): faqat shu bo'lim ko'rinadi,
   * boshqasiga o'tib bo'lmaydi (Markazda — bo'lim, Hududlarda — viloyat va tuman tanlanadi)
   */
  lockUnit?: string | null;
}

/** Bo'lim kodi → tanlovning boshlang'ich holati */
export function placeForUnit(unit: string | null | undefined): PlaceValue | null {
  if (unit === 'CENTER') return { ...EMPTY_PLACE, kind: 'CENTER' };
  if (unit === 'REGION') return { ...EMPTY_PLACE, kind: 'REGION' };
  if (isSegment(unit)) return { ...EMPTY_PLACE, kind: 'SEGMENT', segment: unit };
  return null;
}

export function PlacePicker({ value, onChange, departments, error, disabled, hideLabel, compact, noun = 'xarajat', lockUnit }: PlacePickerProps) {
  const regions = useAsync(() => regionsApi.list(), []);
  const code = value.kind === 'REGION' && value.regionCode ? Number(value.regionCode) : null;
  const districts = useAsync(() => (code ? regionsApi.districts(code) : Promise.resolve(null)), [code]);

  const regionList = (regions.data?.data ?? []).filter((r) => r.code !== 0 && r.isActive);
  const regionName = regionList.find((r) => String(r.code) === value.regionCode)?.name;
  const districtList = districts.data?.data ?? [];
  const districtName = districtList.find((d) => d.id === value.districtId)?.name;
  const departmentName = departments.find((d) => d.id === value.departmentId)?.name;

  const choose = (next: PlaceValue) => {
    if (next.kind === value.kind && next.segment === value.segment) return;
    onChange(next);
  };

  const option = (key: string, active: boolean, title: string, text: string, icon: ReactNode, next: PlaceValue) => (
    <button
      key={key}
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={() => choose(next)}
      className={cn(
        'flex min-w-0 items-center gap-2.5 rounded-(--radius-control) border text-left transition-colors',
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5',
        'disabled:cursor-not-allowed disabled:opacity-70',
        active ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-(--color-line-strong) bg-white hover:border-brand-400 hover:bg-(--color-surface-muted)',
      )}
    >
      <span className={cn('flex shrink-0 items-center justify-center rounded-lg', compact ? 'size-8' : 'size-9', active ? 'bg-brand-600 text-white' : 'bg-(--color-surface-sunken) text-(--color-text-muted)')}>{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-heading">{title}</span>
        {!compact && <span className="block truncate text-xs text-(--color-text-muted)">{text}</span>}
      </span>
    </button>
  );

  const summary =
    value.kind === 'CENTER'
      ? `Markaz${departmentName ? ` › ${departmentName}` : ' (umumiy)'}`
      : value.kind === 'REGION' && regionName
        ? `${regionName}${districtName ? ` › ${districtName}` : ' (viloyat bo‘yicha)'}`
        : value.kind === 'SEGMENT' && isSegment(value.segment)
          ? segmentLabel(value.segment)
          : null;

  return (
    <div>
      {!hideLabel && (
        <p className="mb-1.5 text-sm font-medium text-(--color-text)">
          Qayerga tegishli<span className="ml-0.5 text-(--color-expense)">*</span>
        </p>
      )}
      <div role="radiogroup" aria-label="Qayerga tegishli" className={cn('grid gap-2', lockUnit ? 'grid-cols-1' : compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
        {(!lockUnit || lockUnit === 'CENTER') && option('CENTER', value.kind === 'CENTER', 'Markaz', "Markaz va bo'limlari", <IconBuilding className="size-5" />, { ...EMPTY_PLACE, kind: 'CENTER' })}
        {(!lockUnit || lockUnit === 'REGION') && option('REGION', value.kind === 'REGION', 'Hudud', 'Viloyat va tumanlari', ICONS.REGION, { ...EMPTY_PLACE, kind: 'REGION' })}
        {SEGMENTS.filter((s) => !lockUnit || lockUnit === s.code).map((s) => option(s.code, value.kind === 'SEGMENT' && value.segment === s.code, s.label, s.hint, ICONS[s.code], { ...EMPTY_PLACE, kind: 'SEGMENT', segment: s.code }))}
      </div>

      {value.kind === 'CENTER' && (
        <div className="mt-3">
          <Select
            label="Bo'lim"
            options={[{ value: '', label: "Markaz — umumiy (bo'limsiz)" }, ...departments.filter((d) => d.isActive !== false || d.id === value.departmentId).map((d) => ({ value: d.id, label: d.name }))]}
            value={value.departmentId}
            onChange={(e) => onChange({ ...value, departmentId: e.target.value })}
            disabled={disabled}
          />
        </div>
      )}

      {value.kind === 'REGION' && (
        <div className={cn('mt-3 grid gap-4', !compact && 'sm:grid-cols-2')}>
          <Select
            label="Hudud"
            required
            placeholder={regions.loading ? 'Yuklanmoqda…' : 'Hududni tanlang'}
            options={regionList.map((r) => ({ value: String(r.code), label: r.name }))}
            value={value.regionCode}
            onChange={(e) => onChange({ ...value, regionCode: e.target.value, districtId: '' })}
            error={error && !value.regionCode ? error : undefined}
            disabled={disabled}
          />
          <Select
            label="Tuman"
            options={[{ value: '', label: value.regionCode ? 'Viloyat bo‘yicha (tumansiz)' : 'Avval hududni tanlang' }, ...districtList.filter((d) => d.isActive || d.id === value.districtId).map((d) => ({ value: d.id, label: d.name }))]}
            value={value.districtId}
            onChange={(e) => onChange({ ...value, districtId: e.target.value })}
            disabled={disabled || !value.regionCode}
          />
        </div>
      )}

      {error && !(value.kind === 'REGION' && !value.regionCode) && <p className="mt-1.5 text-xs text-(--color-expense)">{error}</p>}
      {summary && (
        <p className="mt-2 text-xs text-(--color-text-muted)">
          Solishtirmada: <span className="font-medium text-heading">{summary}</span> {noun}iga yoziladi.
        </p>
      )}
    </div>
  );
}