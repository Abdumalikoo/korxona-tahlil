'use client';

import { regionsApi } from '@/features/employees/api';
import { referencesApi } from '@/features/shared/references';
import type { Department, RegionWithDistricts } from '@/lib/types';
import { ENTRY_UNITS, REGION_GENERAL, REGION_GENERAL_LABEL, realRegions } from '@/lib/segments';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Ish haqini boshqa bo'limga o'tkazish — joy tanlash (ichma-ich):
//  • Markaz → uning bo'limlari;
//  • Hududlar → viloyat → tuman (tuman ixtiyoriy);
//  • yo'nalishlar (Tax free, Fermer, Buxgalteriya, Marksheyder) — o'zi.
// Qo'mita pullari — ish haqi emas, ro'yxatda yo'q.
// ═══════════════════════════════════════════════════════════

/** Ish haqi o'tkaziladigan joylar (Qo'mita — yo'q) */
export const MOVE_UNITS = ENTRY_UNITS.filter((u) => u.code !== 'QOMITA');

export interface MovePlace {
  departmentId?: string;
  /** Markaz › Umumiy — hech qaysi bo'limga tegishli emas (bo'limsiz Markaz yozuvi) */
  general?: boolean;
  regionCode?: number;
  districtId?: string;
}

export interface MoveChoice {
  target: string;
  place: MovePlace;
}

export const EMPTY_CHOICE: MoveChoice = { target: '', place: {} };
/** Markaz › Umumiy (bo'limsiz) — xarajat yo'naltirishda sukut bo'yicha */
export const CENTER_GENERAL: MoveChoice = { target: 'CENTER', place: { general: true } };
const GENERAL = '__general';

/** Tanlov to'liqmi: Markaz — bo'limi (yoki Umumiy), Hududlar — viloyati tanlangan bo'lsin */
export function choiceReady(c: MoveChoice): boolean {
  if (!c.target) return false;
  if (c.target === 'CENTER') return Boolean(c.place.departmentId || c.place.general);
  if (c.target === 'REGION') return Boolean(c.place.regionCode);
  return true;
}

// Ma'lumotnomalar sahifa davomida bir marta yuklanadi
let depsCache: Promise<Department[]> | null = null;
let treeCache: Promise<RegionWithDistricts[]> | null = null;
const loadDeps = () => (depsCache ??= referencesApi.departments().then((r) => r.data.filter((d) => d.isActive)).catch((e) => { depsCache = null; throw e; }));
const loadTree = () => (treeCache ??= regionsApi.tree().then((r) => r.data.filter((x) => x.code !== 0 && x.isActive)).catch((e) => { treeCache = null; throw e; }));

/** Tanlov matni: «Markaz › IT bo'limi», «Hududlar › Samarqand › Urgut», «Tax free» */
export function useChoiceLabel(c: MoveChoice): string {
  const [deps, setDeps] = useState<Department[]>([]);
  const [tree, setTree] = useState<RegionWithDistricts[]>([]);
  useEffect(() => {
    if (c.target === 'CENTER') void loadDeps().then(setDeps).catch(() => null);
    if (c.target === 'REGION') void loadTree().then(setTree).catch(() => null);
  }, [c.target]);
  const unit = MOVE_UNITS.find((u) => u.code === c.target)?.label ?? '';
  if (c.target === 'CENTER' && c.place.general) return `${unit} › Umumiy`;
  if (c.target === 'CENTER' && c.place.departmentId) {
    const d = deps.find((x) => x.id === c.place.departmentId);
    return d ? `${unit} › ${d.name}` : unit;
  }
  if (c.target === 'REGION' && c.place.regionCode) {
    if (c.place.regionCode === REGION_GENERAL) return `${unit} › Umumiy`;
    const r = tree.find((x) => x.code === c.place.regionCode);
    const d = r?.districts.find((x) => x.id === c.place.districtId);
    return r ? `${unit} › ${r.name}${d ? ` › ${d.name}` : ''}` : unit;
  }
  return unit;
}

const SEL = 'h-8 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-xs focus:border-brand-600 focus:outline-none';

/** allowGeneral — Markazda «Umumiy» (bo'limsiz) ham tanlansin (xarajat / daromad yo'naltirishda; ish haqi o'tkazishda — yo'q) */
export function PlacePicker({ value, onChange, exclude, allowGeneral }: { value: MoveChoice; onChange: (c: MoveChoice) => void; exclude?: string; allowGeneral?: boolean }) {
  const [deps, setDeps] = useState<Department[] | null>(null);
  const [tree, setTree] = useState<RegionWithDistricts[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    if (value.target === 'CENTER' && !deps) void loadDeps().then(setDeps).catch(() => setError("Bo'limlar ro'yxati yuklanmadi"));
    if (value.target === 'REGION' && !tree) void loadTree().then(setTree).catch(() => setError("Viloyatlar ro'yxati yuklanmadi"));
  }, [value.target, deps, tree]);

  const region = tree?.find((r) => r.code === value.place.regionCode) ?? null;
  // Hududlar › Umumiy — faqat pul yozuvida (xarajat / daromad yo'naltirish); xodim o'tkazishda — haqiqiy viloyat
  const regionList = tree ? (allowGeneral ? tree : realRegions(tree)) : null;
  const districts = (region?.districts ?? []).filter((d) => d.isActive);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select aria-label="Bo'lim" value={value.target} onChange={(e) => onChange({ target: e.target.value, place: {} })} className={SEL}>
        <option value="">Tanlang…</option>
        {MOVE_UNITS.filter((u) => u.code !== exclude).map((u) => (
          <option key={u.code} value={u.code}>
            {u.label}
            {u.code === 'CENTER' || u.code === 'REGION' ? ' ›' : ''}
          </option>
        ))}
      </select>

      {value.target === 'CENTER' && (
        <>
          <span className="text-(--color-text-faint)">›</span>
          <select
            aria-label="Markaz bo'limi"
            value={value.place.general ? GENERAL : (value.place.departmentId ?? '')}
            onChange={(e) => onChange({ target: 'CENTER', place: e.target.value === GENERAL ? { general: true } : e.target.value ? { departmentId: e.target.value } : {} })}
            disabled={!deps}
            className={cn(SEL, 'min-w-[11rem]', !value.place.departmentId && !value.place.general && 'border-brand-600')}
          >
            <option value="">{deps ? "Markaz bo'limini tanlang…" : 'Yuklanmoqda…'}</option>
            {allowGeneral && <option value={GENERAL}>Umumiy (hech qaysi bo&apos;limga tegishli emas)</option>}
            {(deps ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </>
      )}

      {value.target === 'REGION' && (
        <>
          <span className="text-(--color-text-faint)">›</span>
          <select
            aria-label="Viloyat"
            value={value.place.regionCode ?? ''}
            onChange={(e) => onChange({ target: 'REGION', place: e.target.value ? { regionCode: Number(e.target.value) } : {} })}
            disabled={!tree}
            className={cn(SEL, 'min-w-[10rem]', !value.place.regionCode && 'border-brand-600')}
          >
            <option value="">{tree ? 'Viloyatni tanlang…' : 'Yuklanmoqda…'}</option>
            {(regionList ?? []).map((r) => (
              <option key={r.code} value={r.code}>
                {r.code === REGION_GENERAL ? REGION_GENERAL_LABEL : r.name}
              </option>
            ))}
          </select>
          {region && region.districts.length > 0 && (
            <>
              <span className="text-(--color-text-faint)">›</span>
              <select
                aria-label="Tuman"
                value={value.place.districtId ?? ''}
                onChange={(e) => onChange({ target: 'REGION', place: { regionCode: region.code, ...(e.target.value ? { districtId: e.target.value } : {}) } })}
                className={cn(SEL, 'min-w-[10rem]')}
              >
                <option value="">Tuman tanlanmagan (viloyat)</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </>
      )}
      {error && <span className="text-(--color-expense)">{error}</span>}
    </div>
  );
}