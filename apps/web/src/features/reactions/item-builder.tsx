'use client';

import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { KIND_LABEL, reactionsApi, type ItemFilter, type ItemKind, type MarkItem, type ReactionLookups } from './api';

const FIELD = 'h-9 w-full rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 text-sm outline-none focus:border-slate-500';
const LABEL = 'mb-1 block text-xs font-medium text-(--color-text-muted)';

// Ma'lumotnomalar bir marta yuklanadi va keshlanadi
let cache: Promise<ReactionLookups> | null = null;
function loadLookups(): Promise<ReactionLookups> {
  if (!cache) {
    cache = reactionsApi.lookups().then((r) => r.data);
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}

export interface ItemBuilderState {
  item: MarkItem | null;
  fields: ReactNode;
  error: string | null;
  loading: boolean;
}

/**
 * Moddani qo'lda tanlash: tur (xarajat / daromad / natija), hudud, bo'lim,
 * xarajat guruhi va turi, mashina, daromad turi, Doimiy/Boshqa.
 * Munosabat savatiga qo'shishda ham, Nazorat qoidasini yaratishda ham ishlatiladi.
 */
export function useItemBuilder(origin: string): ItemBuilderState {
  const [lookups, setLookups] = useState<ReactionLookups | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<ItemKind>('EXPENSE');
  const [unit, setUnit] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [group, setGroup] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [section, setSection] = useState('');

  useEffect(() => {
    loadLookups()
      .then(setLookups)
      .catch((e: Error) => setError(e.message));
  }, []);

  const name = (list: { value: string; label: string }[] | undefined, value: string) => list?.find((o) => o.value === value)?.label ?? '';

  const item = useMemo<MarkItem | null>(() => {
    if (!lookups) return null;
    const filter: ItemFilter = {};
    const parts: string[] = [];
    if (unit) {
      filter.unit = unit;
      parts.push(name(lookups.units, unit));
    }
    if (departmentId) {
      filter.departmentId = departmentId;
      parts.push(name(lookups.departments, departmentId));
    }
    if (kind === 'EXPENSE') {
      if (vehicleId) {
        filter.vehicleId = vehicleId;
        parts.push(name(lookups.vehicles, vehicleId));
      } else if (categoryCode) {
        filter.categoryCode = categoryCode;
        parts.push(name(lookups.expenseCategories, categoryCode));
      } else if (group.startsWith('src:')) {
        filter.source = group.slice(4) as ItemFilter['source'];
        parts.push(name(lookups.expenseGroups, group));
      } else if (group.startsWith('root:')) {
        filter.rootCategoryCode = group.slice(5);
        parts.push(name(lookups.expenseGroups, group));
      }
    }
    if (kind === 'INCOME' && categoryCode) {
      filter.categoryCode = categoryCode;
      parts.push(name(lookups.incomeCategories, categoryCode));
    }
    if (section === 'DOIMIY' || section === 'BOSHQA') {
      filter.section = section;
      parts.push(section === 'DOIMIY' ? 'Doimiy' : 'Boshqa');
    }
    const title = parts.length ? parts.join(' · ') : kind === 'INCOME' ? 'Barcha daromadlar' : kind === 'EXPENSE' ? 'Barcha xarajatlar' : 'Korxona natijasi';
    return { kind, label: `${title}${parts.length && kind === 'RESULT' ? ' · natija' : ''}`, filter, origin };
  }, [kind, unit, departmentId, group, categoryCode, vehicleId, section, lookups, origin]);

  const categories =
    kind === 'EXPENSE' ? (lookups?.expenseCategories ?? []).filter((c) => group.startsWith('root:') && c.parent === group.slice(5)) : (lookups?.incomeCategories ?? []);
  const vehicles = (lookups?.vehicles ?? []).filter((v) => !unit || v.unit === unit);

  const fields = !lookups ? null : (
    <div className="space-y-4">
      <div>
        <span className={LABEL}>Nimani kuzatamiz</span>
        <div className="grid grid-cols-3 gap-1.5">
          {(['EXPENSE', 'INCOME', 'RESULT'] as ItemKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                setGroup('');
                setCategoryCode('');
                setVehicleId('');
              }}
              className={cn(
                'rounded-(--radius-control) border px-2 py-2 text-sm',
                kind === k ? 'border-slate-800 bg-slate-800 font-medium text-white' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:bg-(--color-surface-muted)',
              )}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        {kind === 'RESULT' && <p className="mt-1 text-xs text-(--color-text-muted)">Natija = shu joy daromadi − xarajati.</p>}
      </div>

      <label className="block">
        <span className={LABEL}>Hudud</span>
        <select
          value={unit}
          onChange={(e) => {
            setUnit(e.target.value);
            setVehicleId('');
            if (e.target.value !== 'center') setDepartmentId('');
          }}
          className={FIELD}
        >
          <option value="">Barcha hududlar va Markaz</option>
          {lookups.units.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {unit === 'center' && (
        <label className="block">
          <span className={LABEL}>Markaz bo&apos;limi (ixtiyoriy)</span>
          <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={FIELD}>
            <option value="">Butun Markaz</option>
            {lookups.departments.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {kind === 'EXPENSE' && (
        <>
          <label className="block">
            <span className={LABEL}>Xarajat guruhi</span>
            <select
              value={group}
              onChange={(e) => {
                setGroup(e.target.value);
                setCategoryCode('');
                setVehicleId('');
              }}
              className={FIELD}
            >
              <option value="">Barcha xarajatlar</option>
              {lookups.expenseGroups.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          {group.startsWith('root:') && categories.length > 0 && (
            <label className="block">
              <span className={LABEL}>Xarajat turi (ixtiyoriy)</span>
              <select value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)} className={FIELD}>
                <option value="">Guruhdagi hammasi</option>
                {categories.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {group === 'src:VEHICLE' && vehicles.length > 0 && (
            <label className="block">
              <span className={LABEL}>Mashina (ixtiyoriy)</span>
              <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={FIELD}>
                <option value="">Barcha mashinalar</option>
                {vehicles.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      {kind === 'INCOME' && (
        <label className="block">
          <span className={LABEL}>Xizmat turi</span>
          <select value={categoryCode} onChange={(e) => setCategoryCode(e.target.value)} className={FIELD}>
            <option value="">Barcha daromadlar</option>
            {lookups.incomeCategories.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="block">
        <span className={LABEL}>Bo&apos;lim</span>
        <select value={section} onChange={(e) => setSection(e.target.value)} className={FIELD}>
          <option value="">Doimiy va Boshqa</option>
          <option value="DOIMIY">Faqat Doimiy</option>
          <option value="BOSHQA">Faqat Boshqa (bir martalik)</option>
        </select>
      </label>
    </div>
  );

  return { item, fields, error, loading: !lookups && !error };
}