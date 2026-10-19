'use client';

import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { warehouseApi, type EmployeeOption, type WarehouseLookups } from './api';

// ═══════════════════════════════════════════════════════════
// Kimga / qayerga: bo'lim yoki hudud va odam (Xodimlar ro'yxatidan yoki qo'lda yozilgan ism).
// Xodim tanlansa — bo'lim/hudud bo'sh bo'lsa uning joyi avtomatik olinadi (backend ham shunday qiladi).
// ═══════════════════════════════════════════════════════════

export interface TargetValue {
  departmentId: string;
  /** "" | "0" (Markaz) | "26" */
  regionCode: string;
  holderPinfl: string;
  holderName: string;
}

export const EMPTY_TARGET: TargetValue = { departmentId: '', regionCode: '', holderPinfl: '', holderName: '' };

export function TargetPicker({
  value,
  onChange,
  lookups,
  label,
  hint,
}: {
  value: TargetValue;
  onChange: (next: TargetValue) => void;
  lookups: WarehouseLookups | null;
  label: string;
  hint?: string;
}) {
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<EmployeeOption[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      warehouseApi
        .employees(search)
        .then((r) => setFound(r.data))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [search, open]);

  const pick = (e: EmployeeOption) => {
    onChange({
      departmentId: value.departmentId || e.departmentId || '',
      regionCode: value.regionCode || (value.departmentId || e.departmentId ? '0' : String(e.regionCode)),
      holderPinfl: e.pinfl,
      holderName: e.fullName,
    });
    setSearch('');
    setOpen(false);
  };

  return (
    <fieldset className="space-y-3 rounded-(--radius-control) border border-(--color-line) p-3">
      <legend className="px-1 text-sm font-semibold text-heading">{label}</legend>
      {hint && <p className="-mt-1 text-xs text-(--color-text-muted)">{hint}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Bo'lim"
          value={value.departmentId}
          onChange={(e) => onChange({ ...value, departmentId: e.target.value, regionCode: e.target.value ? '0' : value.regionCode })}
          options={[{ value: '', label: '— tanlanmagan —' }, ...(lookups?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))]}
        />
        <Select
          label="Hudud"
          value={value.regionCode}
          disabled={Boolean(value.departmentId)}
          onChange={(e) => onChange({ ...value, regionCode: e.target.value })}
          options={[{ value: '', label: '— tanlanmagan —' }, ...(lookups?.regions ?? []).map((r) => ({ value: String(r.code), label: r.name }))]}
        />
      </div>

      <div className="relative">
        <span className="mb-1.5 block text-sm font-medium text-(--color-text)">Odam (oluvchi / egasi)</span>
        {value.holderName ? (
          <div className="flex items-center justify-between gap-2 rounded-(--radius-control) border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">
              <b>{value.holderName}</b>
              {value.holderPinfl && <span className="ml-1 text-xs text-(--color-text-muted)">PINFL {value.holderPinfl}</span>}
            </span>
            <button type="button" className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => onChange({ ...value, holderPinfl: '', holderName: '' })}>
              Boshqasini tanlash
            </button>
          </div>
        ) : (
          <>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              placeholder="Xodim ismi yoki PINFL — qidiring"
              className="h-10 w-full rounded-(--radius-control) border border-(--color-line-strong) px-3 text-sm focus:border-brand-600"
            />
            {open && (
              <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-(--radius-control) border border-(--color-line) bg-white shadow-lg">
                {found.map((e) => (
                  <button key={e.pinfl} type="button" onClick={() => pick(e)} className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-50">
                    <span className="font-medium text-heading">{e.fullName}</span>
                    <span className="ml-2 text-xs text-(--color-text-muted)">{[e.position, e.place].filter(Boolean).join(' · ')}</span>
                  </button>
                ))}
                {search.trim().length >= 3 && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange({ ...value, holderPinfl: '', holderName: search.trim() });
                      setSearch('');
                      setOpen(false);
                    }}
                    className={cn('block w-full border-t border-(--color-line) px-3 py-2 text-left text-sm text-brand-700 hover:bg-brand-50')}
                  >
                    «{search.trim()}» — ro&apos;yxatda yo&apos;q, shu ism bilan yozish
                  </button>
                )}
                {found.length === 0 && search.trim().length < 3 && <p className="px-3 py-2 text-xs text-(--color-text-muted)">Kamida 3 harf yozing</p>}
              </div>
            )}
          </>
        )}
      </div>
    </fieldset>
  );
}

/** Forma qiymati → API maydonlari */
export function targetPayload(t: TargetValue) {
  return {
    departmentId: t.departmentId || null,
    regionCode: t.regionCode === '' ? null : Number(t.regionCode),
    holderPinfl: t.holderPinfl || null,
    holderName: t.holderName || null,
  };
}

export function targetEmpty(t: TargetValue): boolean {
  return !t.departmentId && t.regionCode === '' && !t.holderName;
}