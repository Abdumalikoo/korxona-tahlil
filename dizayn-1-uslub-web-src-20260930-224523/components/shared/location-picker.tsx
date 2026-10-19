'use client';

import { useMemo } from 'react';
import { Select } from '@/components/ui/select';
import type { RegionWithDistricts } from '@/lib/types';

const CENTRAL_REGION = 0;

interface LocationPickerProps {
  regions: RegionWithDistricts[];
  regionCode: number | null;
  districtId: string | null;
  onRegionChange: (code: number | null) => void;
  onDistrictChange: (id: string | null) => void;
  disabled?: boolean;
  required?: boolean;
  errors?: { region?: string; district?: string };
}

/**
 * Viloyat va tuman tanlagichi.
 *
 * Markaz (0) tanlansa tuman maydoni ko'rinmaydi —
 * markazda tuman bo'linishi yo'q.
 */
export function LocationPicker({
  regions,
  regionCode,
  districtId,
  onRegionChange,
  onDistrictChange,
  disabled,
  required,
  errors,
}: LocationPickerProps) {
  const districts = useMemo(() => {
    if (regionCode === null || regionCode === CENTRAL_REGION) return [];
    return regions.find((r) => r.code === regionCode)?.districts ?? [];
  }, [regions, regionCode]);

  const isCentral = regionCode === CENTRAL_REGION;

  const regionOptions = [
    { value: '', label: 'Tanlang' },
    ...regions.map((region) => ({
      value: String(region.code),
      label: region.code === CENTRAL_REGION ? region.name : `${region.code} — ${region.name}`,
    })),
  ];

  const districtOptions = [
    { value: '', label: 'Tanlang' },
    ...districts.map((district) => ({
      value: district.id,
      label: `${district.code} — ${district.name}`,
    })),
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Select
        label="Hudud"
        options={regionOptions}
        value={regionCode === null ? '' : String(regionCode)}
        onChange={(event) => {
          const value = event.target.value;
          const next = value === '' ? null : Number(value);
          onRegionChange(next);
          // Viloyat o'zgarsa tuman tozalanadi
          onDistrictChange(null);
        }}
        error={errors?.region}
        required={required}
        disabled={disabled}
      />

      {!isCentral && regionCode !== null && (
        <Select
          label="Tuman"
          options={districtOptions}
          value={districtId ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            onDistrictChange(value === '' ? null : value);
          }}
          error={errors?.district}
          required={required}
          disabled={disabled}
        />
      )}
    </div>
  );
}
