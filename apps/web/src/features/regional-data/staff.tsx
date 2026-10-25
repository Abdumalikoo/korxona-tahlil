'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { FIELD, Label, SumInput } from '@/features/purchases/bits';
import { dmy } from '@/features/regional-desk/api';
import { Notice, Stat, som } from '@/features/regional-desk/bits';
import { errorMessage } from '@/lib/error-message';
import { sumToTiyin, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useRef, useState } from 'react';
import { download, rdData, uploadFile, type SalaryHistory, type StaffImport, type StaffRow } from './api';

// ═══════════════════════════════════════════════════════════
// Hududchi › Shtat va maosh: hudud xodimlarining stavkasi va lavozim maoshi (amal qilish sanasi bilan).
// Ish haqi prognozi shu tarixga tayanadi. Qo'lda (xodim kartasida) yoki Excel bilan.
// ═══════════════════════════════════════════════════════════

export function StaffPage() {
  const [tick, setTick] = useState(0);
  const list = useAsync(() => rdData.staff(), [tick]);
  const data = list.data?.data ?? null;
  const [search, setSearch] = useState('');
  const [region, setRegion] = useState<number | null>(null);
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const [open, setOpen] = useState<StaffRow | null>(null);
  const [hist, setHist] = useState<SalaryHistory | null>(null);
  const [form, setForm] = useState({ effectiveFrom: todayInput(), rate: '1', salary: null as number | null, position: '', note: '' });
  const [saving, setSaving] = useState(false);
  const [imp, setImp] = useState<StaffImport | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const regions = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of data?.employees ?? []) m.set(e.regionCode, e.regionName);
    return [...m.entries()];
  }, [data]);
  const rows = (data?.employees ?? []).filter(
    (e) => (region === null || e.regionCode === region) && (!onlyEmpty || e.rate === null) && (!search || `${e.fullName} ${e.pinfl}`.toLowerCase().includes(search.toLowerCase())),
  );

  const openCard = async (e: StaffRow) => {
    setOpen(e);
    setHist(null);
    setForm({ effectiveFrom: todayInput(), rate: String(e.rate ?? 1), salary: e.baseSalaryTiyin ? Number(BigInt(e.baseSalaryTiyin) / 100n) : null, position: e.position ?? '', note: '' });
    try {
      setHist((await rdData.staffHistory(e.pinfl)).data);
    } catch (err) {
      setToast({ message: errorMessage(err), tone: 'error' });
    }
  };

  const add = async () => {
    if (!open || !form.salary) return;
    setSaving(true);
    try {
      const h = await rdData.staffAdd(open.pinfl, { effectiveFrom: form.effectiveFrom, rate: Number(form.rate.replace(',', '.')), baseSalaryTiyin: String(sumToTiyin(form.salary)), position: form.position.trim() || null, note: form.note.trim() || null });
      setHist(h.data);
      setToast({ message: 'Saqlandi' });
      setTick((t) => t + 1);
    } catch (err) {
      setToast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setImp(await uploadFile<StaffImport>('/regional-data/staff/import/analyze', f));
    } catch (err) {
      setToast({ message: errorMessage(err), tone: 'error' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <PageHeader
        title="Shtat va maosh"
        description="Hudud xodimlarining stavkasi va lavozim maoshi — amal qilish sanasi bilan. Ish haqi prognozi shunga tayanadi"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void download('/regional-data/staff/template', 'Shtat-va-maosh.xlsx').catch((e) => setToast({ message: errorMessage(e), tone: 'error' }))}>
              Excel shablon
            </Button>
            <input ref={fileRef} type="file" accept=".xlsx,.xltx" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            <Button onClick={() => fileRef.current?.click()}>Excel&apos;dan yuklash</Button>
          </div>
        }
      />
      <div className="space-y-4 p-4 md:p-6">
        {data && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Hudud xodimlari" value={data.total} hint="shu oyda ishlayotganlar" />
            <Stat label="Stavka kiritilgan" value={`${data.filled} / ${data.total}`} tone={data.filled < data.total ? 'warn' : 'plain'} hint={data.filled < data.total ? `${data.total - data.filled} tasi qolgan` : 'hammasi'} />
            <Stat label="Shtat birligi (FTE)" value={data.fte.toLocaleString('ru-RU')} hint="stavkalar yig'indisi" />
            <Stat label="Maosh fondi (oyiga)" value={som(String((data.employees ?? []).reduce((s, e) => s + (e.baseSalaryTiyin ? BigInt(Math.round(Number(e.baseSalaryTiyin) * (e.rate ?? 0))) : 0n), 0n)))} hint="maosh × stavka, so'm" />
          </div>
        )}

        {imp && (
          <div className="rounded-(--radius-card) border border-brand-200 bg-white p-4 shadow-card">
            <p className="font-semibold text-heading">
              {imp.fileName}: {imp.changed} ta o&apos;zgarish, {imp.rows.length - imp.changed} tasi o&apos;zgarmagan
            </p>
            {imp.errors.length > 0 && <Notice tone="warn">Xato qatorlar: {imp.errors.slice(0, 8).map((e) => `${e.rowIndex} (${e.reason})`).join('; ')}</Notice>}
            {imp.notRegional.length > 0 && <p className="mt-2 text-sm text-amber-700">Hudud xodimi emas (o&apos;tkazildi): {imp.notRegional.map((n) => n.pinfl).join(', ')}</p>}
            <div className="mt-2 max-h-60 overflow-auto">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-(--color-line)">
                  {imp.rows
                    .filter((r) => r.change !== 'SAME')
                    .map((r) => (
                      <tr key={`${r.pinfl}-${r.effectiveFrom}`}>
                        <td className="py-1.5">{r.fullName}</td>
                        <td className="py-1.5 text-xs text-(--color-text-muted)">{dmy(r.effectiveFrom)} dan</td>
                        <td className="py-1.5 text-right">stavka {r.rate}</td>
                        <td className="money py-1.5 text-right font-semibold">{som(r.baseSalaryTiyin)}</td>
                        <td className="py-1.5 pl-3 text-xs">{r.change === 'NEW' ? 'yangi' : 'yangilanadi'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex gap-2">
              <Button
                disabled={!imp.changed}
                onClick={() =>
                  void rdData
                    .staffCommit(imp.rows)
                    .then((r) => {
                      setToast({ message: `${r.data.saved} ta yozuv saqlandi` });
                      setImp(null);
                      setTick((t) => t + 1);
                    })
                    .catch((e) => setToast({ message: errorMessage(e), tone: 'error' }))
                }
              >
                Saqlash ({imp.changed})
              </Button>
              <Button variant="ghost" onClick={() => setImp(null)}>
                Bekor qilish
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="F.I.Sh. yoki PINFL" className={cn(FIELD, 'w-64')} />
          <select value={region ?? ''} onChange={(e) => setRegion(e.target.value === '' ? null : Number(e.target.value))} className={cn(FIELD, 'w-56')}>
            <option value="">Hamma hududlar</option>
            {regions.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-(--color-text-muted)">
            <input type="checkbox" checked={onlyEmpty} onChange={(e) => setOnlyEmpty(e.target.checked)} className="size-4 accent-brand-600" />
            Faqat kiritilmaganlar
          </label>
        </div>

        <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
          {list.loading && !data ? (
            <TableSkeleton rows={8} cols={6} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : rows.length === 0 ? (
            <EmptyState title="Xodim topilmadi" description="Filtrni o'zgartiring" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                    <th className="px-4 py-2.5">Xodim</th>
                    <th className="px-3 py-2.5">Hudud</th>
                    <th className="px-3 py-2.5">Lavozim</th>
                    <th className="px-3 py-2.5 text-right">Stavka</th>
                    <th className="px-3 py-2.5 text-right">Maosh</th>
                    <th className="px-3 py-2.5">Sanadan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--color-line)">
                  {rows.map((e) => (
                    <tr key={e.pinfl} onClick={() => void openCard(e)} className="cursor-pointer hover:bg-brand-50/50">
                      <td className="px-4 py-2">
                        <p className="font-medium text-heading">{e.fullName}</p>
                        <p className="font-mono text-[11px] text-(--color-text-faint)">{e.pinfl}</p>
                      </td>
                      <td className="px-3 py-2">{e.regionName}</td>
                      <td className="px-3 py-2 text-(--color-text-muted)">{e.position ?? '—'}</td>
                      <td className="px-3 py-2 text-right">{e.rate ?? <span className="text-xs font-semibold text-amber-600">kiritilmagan</span>}</td>
                      <td className="money px-3 py-2 text-right font-semibold">{e.baseSalaryTiyin ? som(e.baseSalaryTiyin) : '—'}</td>
                      <td className="px-3 py-2 text-xs text-(--color-text-muted)">
                        {e.effectiveFrom ? dmy(e.effectiveFrom) : '—'}
                        {e.upcoming && <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-sky-700">{dmy(e.upcoming.effectiveFrom)} dan o&apos;zgaradi</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Drawer open={open !== null} onClose={() => setOpen(null)} title={open?.fullName ?? ''} description={open ? `${open.regionName} · PINFL ${open.pinfl}` : ''}>
        {open && (
          <div className="space-y-5">
            <div className="rounded-xl border border-(--color-line) p-3">
              <p className="mb-3 text-sm font-semibold text-heading">Yangi stavka / maosh</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Amal qilish sanasi</Label>
                  <input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} className={FIELD} />
                </div>
                <div>
                  <Label hint="1 yoki 0,5">Stavka</Label>
                  <input value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} inputMode="decimal" className={FIELD} />
                </div>
                <div className="col-span-2">
                  <Label hint="to'liq stavka uchun, oyiga">Lavozim maoshi (so&apos;m)</Label>
                  <SumInput value={form.salary} onChange={(v) => setForm({ ...form, salary: v })} placeholder="0" />
                </div>
                <div className="col-span-2">
                  <Label hint="ixtiyoriy">Lavozim</Label>
                  <input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className={FIELD} maxLength={200} />
                </div>
                <div className="col-span-2">
                  <Label hint="ixtiyoriy">Izoh (buyruq raqami)</Label>
                  <input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} className={FIELD} maxLength={300} />
                </div>
              </div>
              <Button className="mt-3" onClick={() => void add()} loading={saving} disabled={!form.salary}>
                Saqlash
              </Button>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold text-heading">Tarix</p>
              {!hist ? (
                <p className="text-sm text-(--color-text-muted)">Yuklanmoqda…</p>
              ) : hist.items.length === 0 ? (
                <p className="text-sm text-(--color-text-muted)">Hali yozuv yo&apos;q</p>
              ) : (
                <ul className="divide-y divide-(--color-line) rounded-xl border border-(--color-line)">
                  {hist.items.map((h) => (
                    <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="w-24 font-semibold">{dmy(h.effectiveFrom)}</span>
                      <span className="w-14">× {h.rate}</span>
                      <span className="money flex-1 font-semibold">{som(h.baseSalaryTiyin)}</span>
                      <span className="text-xs text-(--color-text-muted)">{h.source === 'IMPORT' ? 'Excel' : "qo'lda"}</span>
                      <button
                        type="button"
                        className="text-xs font-semibold text-(--color-expense) hover:underline"
                        onClick={() =>
                          void rdData
                            .staffRemove(h.id)
                            .then((r) => {
                              setHist(r.data);
                              setTick((t) => t + 1);
                            })
                            .catch((e) => setToast({ message: errorMessage(e), tone: 'error' }))
                        }
                      >
                        o&apos;chirish
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Drawer>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 3000} />}
    </>
  );
}