'use client';

import { IconBuilding } from '@/components/ui/icons';
import { Select } from '@/components/ui/select';
import { regionsApi } from '@/features/employees/api';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import type { Department } from '@/lib/types';
import type { ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Xarajat qayerga tegishli: Markaz (va uning bo'limi) yoki Hudud (va uning tumani).
// Solishtirma shu tanlov bo'yicha xarajatni Markazga, hududga yoki tumanga yozadi.
// ═══════════════════════════════════════════════════════════

export type PlaceKind = 'CENTER' | 'REGION' | '';

export interface PlaceValue {
  /** '' — hali tanlanmagan (eski, hech qayerga biriktirilmagan yozuvlar) */
  kind: PlaceKind;
  /** Markaz bo'limi ('' — Markaz umumiy) */
  departmentId: string;
  /** Hudud kodi (satr ko'rinishida, '' — tanlanmagan) */
  regionCode: string;
  /** Tuman ('' — viloyat bo'yicha, tumansiz) */
  districtId: string;
}

export const EMPTY_PLACE: PlaceValue = { kind: '', departmentId: '', regionCode: '', districtId: '' };

/** Yozuvdagi maydonlardan tanlov holati */
export function placeOf(record: { regionCode: number | null; departmentId: string | null; districtId?: string | null }): PlaceValue {
  if (record.regionCode === 0 || (record.regionCode === null && record.departmentId)) {
    return { kind: 'CENTER', departmentId: record.departmentId ?? '', regionCode: '', districtId: '' };
  }
  if (record.regionCode !== null && record.regionCode !== undefined) {
    return { kind: 'REGION', departmentId: '', regionCode: String(record.regionCode), districtId: record.districtId ?? '' };
  }
  return EMPTY_PLACE;
}

/** Tanlovni tekshirish: xato matni yoki null */
export function placeError(place: PlaceValue): string | null {
  if (!place.kind) return "Markaz yoki Hududni tanlang";
  if (place.kind === 'REGION' && !place.regionCode) return 'Hududni tanlang';
  return null;
}

/** API uchun maydonlar (yaratish va tahrirlash) */
export function placePayload(place: PlaceValue): { regionCode: number; departmentId: string; districtId: string } | null {
  if (place.kind === 'CENTER') return { regionCode: 0, departmentId: place.departmentId, districtId: '' };
  if (place.kind === 'REGION' && place.regionCode) return { regionCode: Number(place.regionCode), departmentId: '', districtId: place.districtId };
  return null;
}

function IconPin(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" />
      <circle cx="12" cy="10" r="2.4" />
    </svg>
  );
}

interface PlacePickerProps {
  value: PlaceValue;
  onChange: (value: PlaceValue) => void;
  departments: Department[];
  error?: string;
  disabled?: boolean;
  /** Sarlavha tashqarida berilgan bo'lsa — o'z yorlig'i ko'rsatilmaydi */
  hideLabel?: boolean;
}

export function PlacePicker({ value, onChange, departments, error, disabled, hideLabel }: PlacePickerProps) {
  const regions = useAsync(() => regionsApi.list(), []);
  const code = value.regionCode ? Number(value.regionCode) : null;
  const districts = useAsync(() => (code ? regionsApi.districts(code) : Promise.resolve(null)), [code]);

  const regionList = (regions.data?.data ?? []).filter((r) => r.code !== 0 && r.isActive);
  const regionName = regionList.find((r) => String(r.code) === value.regionCode)?.name;
  const districtList = districts.data?.data ?? [];
  const districtName = districtList.find((d) => d.id === value.districtId)?.name;
  const departmentName = departments.find((d) => d.id === value.departmentId)?.name;

  const choose = (kind: Exclude<PlaceKind, ''>) => {
    if (kind === value.kind) return;
    onChange({ kind, departmentId: '', regionCode: '', districtId: '' });
  };

  const option = (kind: Exclude<PlaceKind, ''>, title: string, text: string, icon: ReactNode) => {
    const active = value.kind === kind;
    return (
      <button
        type="button"
        role="radio"
        aria-checked={active}
        disabled={disabled}
        onClick={() => choose(kind)}
        className={cn(
          'flex flex-1 items-center gap-3 rounded-(--radius-control) border px-4 py-3 text-left transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-70',
          active ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-(--color-line-strong) bg-white hover:border-brand-400 hover:bg-(--color-surface-muted)',
        )}
      >
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', active ? 'bg-brand-600 text-white' : 'bg-(--color-surface-sunken) text-(--color-text-muted)')}>{icon}</span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-heading">{title}</span>
          <span className="block text-xs text-(--color-text-muted)">{text}</span>
        </span>
      </button>
    );
  };

  const summary =
    value.kind === 'CENTER'
      ? `Markaz${departmentName ? ` › ${departmentName}` : ' (umumiy)'}`
      : value.kind === 'REGION' && regionName
        ? `${regionName}${districtName ? ` › ${districtName}` : ' (viloyat bo‘yicha)'}`
        : null;

  return (
    <div>
      {!hideLabel && (
        <p className="mb-1.5 text-sm font-medium text-(--color-text)">
          Qayerga tegishli<span className="ml-0.5 text-(--color-expense)">*</span>
        </p>
      )}
      <div role="radiogroup" aria-label="Qayerga tegishli" className="flex flex-col gap-2 sm:flex-row">
        {option('CENTER', 'Markaz', "Markaz va uning bo'limlari", <IconBuilding className="size-5" />)}
        {option('REGION', 'Hudud', 'Viloyat va uning tumanlari', <IconPin className="size-5" />)}
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
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
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

      {error && (!value.kind || value.kind === 'CENTER') && <p className="mt-1.5 text-xs text-(--color-expense)">{error}</p>}
      {summary && <p className="mt-2 text-xs text-(--color-text-muted)">Solishtirmada: <span className="font-medium text-heading">{summary}</span> xarajatiga yoziladi.</p>}
    </div>
  );
}