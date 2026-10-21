'use client';

import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/error-message';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { bplanApi, mln, type Overview } from './api';

// «Hududlar fakti»: tanlangan chorak — 14 hudud × 7 xizmat guruhi (млн.сўм).
// Dasturdagi hududlar daromadidan (belgilangan guruhlar bo'yicha); katakka yozilsa — qo'lda.

export function RegionFacts({ data, quarter, canEdit, onChanged, notify }: { data: Overview; quarter: number; canEdit: boolean; onChanged: () => void; notify: (m: string, tone?: 'success' | 'error') => void }) {
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft({}), [data, quarter]);
  const qi = quarter - 1;
  const fin = data.regionCells.final[qi] ?? [];
  const auto = data.regionCells.auto[qi] ?? [];
  const key = (ri: number, gi: number) => `${quarter}:${ri}:${gi}`;
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(Math.round(v * 1000) / 1000).replace('.', ','));

  const save = async () => {
    setBusy(true);
    try {
      const regions = { ...data.regionCells.manual };
      for (const [k, v] of Object.entries(draft)) {
        const n = v === null ? null : Number(v.replace(/\s/g, '').replace(',', '.'));
        if (n === null || v === '' || !Number.isFinite(n)) delete regions[k];
        else regions[k] = n;
      }
      const lines: Record<string, (number | null)[]> = {};
      for (const [k, c] of Object.entries(data.cells)) lines[k] = c.manual;
      await bplanApi.saveManual(data.year, { lines, regions });
      setDraft({});
      notify('Hududlar fakti saqlandi');
      onChanged();
    } catch (e) {
      notify(errorMessage(e, "Saqlab bo'lmadi"), 'error');
    } finally {
      setBusy(false);
    }
  };

  const colTotals = data.groups.map((_, gi) => fin.reduce((s, r) => s + (r?.[gi] ?? 0), 0));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-(--radius-card) border border-(--color-line) bg-white px-4 py-3">
        <p className="min-w-0 flex-1 text-sm text-(--color-text-muted)">
          <b className="text-heading">{quarter}-chorak</b> · hududlar daromadi xizmat guruhlari bo&apos;yicha (млн.сўм). Guruhlar «Fakt va belgilash» pastida belgilanadi.
        </p>
        {canEdit && (
          <Button size="sm" disabled={!Object.keys(draft).length} loading={busy} onClick={() => void save()}>
            Saqlash
          </Button>
        )}
      </div>
      <div className="overflow-x-auto rounded-(--radius-card) border border-(--color-line) bg-white">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-(--color-surface-muted) text-[11px] text-(--color-text-muted)">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Hudud</th>
              {data.groups.map((g) => (
                <th key={g} className="w-32 px-2 py-2 text-right font-semibold">
                  {g}
                </th>
              ))}
              <th className="w-28 px-3 py-2 text-right font-semibold">Jami</th>
            </tr>
          </thead>
          <tbody>
            {data.regions.map((reg, ri) => {
              const total = data.groups.reduce((s, _, gi) => s + (fin[ri]?.[gi] ?? 0), 0);
              return (
                <tr key={reg} className="border-t border-(--color-line)">
                  <td className="px-3 py-1 text-heading">{reg}</td>
                  {data.groups.map((g, gi) => {
                    const k = key(ri, gi);
                    const manual = k in data.regionCells.manual;
                    const d = k in draft ? draft[k] : undefined;
                    const value = d === undefined ? fmt(fin[ri]?.[gi]) : d === null ? fmt(auto[ri]?.[gi]) : d;
                    const isManual = d === undefined ? manual : d !== null && d.trim() !== '';
                    if (!canEdit)
                      return (
                        <td key={g} className={cn('money px-2 py-1 text-right', manual && 'bg-amber-50')}>
                          {mln(fin[ri]?.[gi] ?? 0)}
                        </td>
                      );
                    return (
                      <td key={g} className="px-1 py-0.5">
                        <div className="relative">
                          <input
                            value={value}
                            inputMode="decimal"
                            title={`Dasturdan: ${mln(auto[ri]?.[gi] ?? 0, 3)}`}
                            onChange={(e) => setDraft((x) => ({ ...x, [k]: e.target.value }))}
                            className={cn('money h-8 w-full rounded-md border px-2 text-right text-sm focus:border-brand-500', isManual ? 'border-amber-300 bg-amber-50' : 'border-transparent bg-transparent hover:border-(--color-line)')}
                          />
                          {isManual && (
                            <button type="button" title="Dasturdagi qiymatga qaytarish" onClick={() => setDraft((x) => ({ ...x, [k]: null }))} className="absolute top-1/2 left-1 -translate-y-1/2 text-[11px] text-amber-700 hover:text-red-600">
                              ×
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="money px-3 py-1 text-right font-semibold text-heading">{mln(total)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-(--color-line) bg-brand-50/50 font-semibold text-heading">
              <td className="px-3 py-1.5">Jami</td>
              {colTotals.map((t, i) => (
                <td key={i} className="money px-2 py-1.5 text-right">
                  {mln(t)}
                </td>
              ))}
              <td className="money px-3 py-1.5 text-right">{mln(colTotals.reduce((a, b) => a + b, 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}