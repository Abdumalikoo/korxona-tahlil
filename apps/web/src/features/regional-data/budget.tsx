'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { FIELD, SumInput } from '@/features/purchases/bits';
import { rdApi } from '@/features/regional-desk/api';
import { MonthPicker, Notice, som } from '@/features/regional-desk/bits';
import { errorMessage } from '@/lib/error-message';
import { sumToTiyin, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { download, rdData, uploadFile } from './api';

// ═══════════════════════════════════════════════════════════
// Hududchi › Xarajat rejasi: oy × hudud × modda. Reja yonida — fakt va farq.
// Jadvalda kiritiladi yoki Excel bilan (hamma hududlar bir faylda). «O'tgan oydan nusxa».
// ═══════════════════════════════════════════════════════════

export function BudgetPage() {
  const thisMonth = todayInput().slice(0, 7);
  const [period, setPeriod] = useState(thisMonth);
  const lk = useAsync(() => rdApi.lookups(), []);
  const regions = useMemo(() => lk.data?.data.regions ?? [], [lk.data]);
  const [region, setRegion] = useState<number | null>(null);
  useEffect(() => {
    if (region === null && regions.length) setRegion(regions[0]!.code);
  }, [region, regions]);
  const [tick, setTick] = useState(0);
  const grid = useAsync(() => (region === null ? Promise.resolve(null) : rdData.budget(period, region)), [period, region, tick]);
  const g = grid.data?.data ?? null;
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!g) return;
    const v: Record<string, number | null> = {};
    for (const r of g.rows) v[r.code] = r.planTiyin === null ? null : Number(BigInt(r.planTiyin) / 100n);
    setValues(v);
  }, [g]);

  const initial = useMemo(() => {
    const v: Record<string, number | null> = {};
    for (const r of g?.rows ?? []) v[r.code] = r.planTiyin === null ? null : Number(BigInt(r.planTiyin) / 100n);
    return v;
  }, [g]);
  const changed = Object.keys(values).filter((k) => (values[k] ?? null) !== (initial[k] ?? null));
  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<typeof g>['rows']>();
    for (const r of g?.rows ?? []) m.set(r.group ?? 'Boshqa', [...(m.get(r.group ?? 'Boshqa') ?? []), r]);
    return [...m.entries()];
  }, [g]);
  const totalPlan = Object.values(values).reduce<number>((s, v) => s + (v ?? 0), 0);

  const save = async () => {
    if (region === null) return;
    setSaving(true);
    try {
      await rdData.budgetSave(period, region, changed.map((k) => ({ categoryCode: k, amountTiyin: values[k] === null || values[k] === undefined ? null : String(sumToTiyin(values[k]!)) })));
      setToast({ message: 'Reja saqlandi' });
      setTick((t) => t + 1);
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await uploadFile<{ saved: number; errors: { rowIndex: number; reason: string }[] }>(`/regional-data/budget/import?period=${period}`, f);
      if (r.errors.length) setToast({ message: `Xatolar: ${r.errors.slice(0, 3).map((e) => `${e.rowIndex}-qator: ${e.reason}`).join('; ')}`, tone: 'error' });
      else setToast({ message: `Excel'dan ${r.saved} ta qator saqlandi` });
      setTick((t) => t + 1);
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <PageHeader
        title="Xarajat rejasi"
        description="Hudud va modda bo'yicha oylik reja (byudjet). Yonida — haqiqiy xarajat va farq"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void download(`/regional-data/budget/template?period=${period}`, `Xarajat-rejasi-${period}.xlsx`).catch((e) => setToast({ message: errorMessage(e), tone: 'error' }))}>
              Excel shablon
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xltx" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              Excel&apos;dan yuklash
            </Button>
          </div>
        }
      />
      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={period} onChange={setPeriod} />
          <select value={region ?? ''} onChange={(e) => setRegion(Number(e.target.value))} className={cn(FIELD, 'w-64')}>
            {regions.map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
          {region !== null && (
            <Button variant="ghost" onClick={() => void rdData.budgetCopy(period, region).then(() => { setToast({ message: "O'tgan oy rejasi nusxalandi" }); setTick((t) => t + 1); }).catch((e) => setToast({ message: errorMessage(e), tone: 'error' }))}>
              O&apos;tgan oydan nusxa
            </Button>
          )}
        </div>

        <Notice tone="info">Reja — rejalashtirish ma&apos;lumoti; buxgalteriya fakti bilan aralashtirilmaydi. Fakt — shu oy shu hudud xarajatlari (ish haqi ham). Bo&apos;sh qoldirilgan modda — reja yo&apos;q.</Notice>

        {grid.loading && !g ? (
          <LoadingState />
        ) : grid.error || !g ? (
          <ErrorState message={grid.error ?? 'Hududni tanlang'} onRetry={grid.reload} />
        ) : (
          <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                  <th className="px-4 py-2.5">Modda</th>
                  <th className="w-48 px-3 py-2.5 text-right">Reja (so&apos;m)</th>
                  <th className="px-3 py-2.5 text-right">Fakt</th>
                  <th className="px-3 py-2.5 text-right">Farq</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(([name, rows]) => (
                  <Fragment key={name}>
                    <tr className="bg-brand-50/60">
                      <td colSpan={4} className="px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-brand-700">
                        {name}
                      </td>
                    </tr>
                    {rows.map((r) => {
                      const plan = values[r.code];
                      const fact = Number(BigInt(r.factTiyin) / 100n);
                      const diff = plan === null || plan === undefined ? null : fact - plan;
                      return (
                        <tr key={r.code} className="border-t border-(--color-line)">
                          <td className="px-4 py-1.5 text-heading">{r.label}</td>
                          <td className="px-3 py-1">
                            <SumInput value={plan ?? null} onChange={(v) => setValues((s) => ({ ...s, [r.code]: v }))} placeholder="—" className={cn('h-9', (values[r.code] ?? null) !== (initial[r.code] ?? null) && 'border-amber-300 bg-amber-50')} />
                          </td>
                          <td className="money px-3 py-1.5 text-right">{fact ? som(r.factTiyin) : '—'}</td>
                          <td className={cn('money px-3 py-1.5 text-right font-semibold', diff === null ? 'text-(--color-text-faint)' : diff > 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>
                            {diff === null ? '' : `${diff > 0 ? '+' : ''}${diff.toLocaleString('ru-RU')}`}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-brand-50 font-bold text-heading">
                  <td className="px-4 py-2.5">Jami — {g.regionName}</td>
                  <td className="money px-3 py-2.5 text-right">{totalPlan.toLocaleString('ru-RU')}</td>
                  <td className="money px-3 py-2.5 text-right">{som(g.totalFactTiyin)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            <div className="sticky bottom-0 flex items-center gap-3 border-t border-(--color-line) bg-white/95 px-4 py-3 backdrop-blur">
              <span className="text-sm text-(--color-text-muted)">{changed.length ? `${changed.length} ta o'zgarish saqlanmagan` : 'Saqlangan'}</span>
              <Button className="ml-auto" onClick={() => void save()} loading={saving} disabled={!changed.length}>
                Saqlash
              </Button>
            </div>
          </div>
        )}
      </div>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 3000} />}
    </>
  );
}