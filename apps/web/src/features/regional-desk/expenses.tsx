'use client';

import { PageHeader } from '@/components/layout/page-header';
import { DeleteDataButton } from '@/components/shared/delete-data';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { FIELD, Label, SumInput } from '@/features/purchases/bits';
import { errorMessage } from '@/lib/error-message';
import { sumToTiyin, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { dmy, monthLabel, rdApi, type RdExpense, type RdLookups } from './api';
import { MonthPicker, som } from './bits';

// ═══════════════════════════════════════════════════════════
// Hududchi › Xarajatlar: hudud (va tuman) bo'yicha qo'lda kiritiladigan xarajatlar —
// ijara, kommunal, aloqa, transport … Ish haqi bu yerda emas (vedomost bilan).
// ═══════════════════════════════════════════════════════════

interface Form {
  id: string | null;
  date: string;
  regionCode: string;
  districtId: string;
  categoryCode: string;
  amount: number | null;
  description: string;
  counterparty: string;
  documentNo: string;
  paymentMethod: string;
  recurrence: 'RECURRING' | 'ONE_TIME' | null;
}

const METHODS = [
  ['BANK', "Bank o'tkazmasi"],
  ['CASH', 'Naqd'],
  ['CARD', 'Karta'],
  ['OTHER', 'Boshqa'],
] as const;

export function RegionalExpenses() {
  const [period, setPeriod] = useState(todayInput().slice(0, 7));
  const [region, setRegion] = useState<number | null>(null);
  const lk = useAsync(() => rdApi.lookups(), []);
  const list = useAsync(() => rdApi.expenses(period), [period]);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [del, setDel] = useState<RdExpense | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const lookups: RdLookups | null = lk.data?.data ?? null;
  const all = list.data?.data ?? [];
  const rows = region === null ? all : all.filter((e) => e.regionCode === region);
  const total = rows.reduce((s, e) => s + BigInt(e.amountTiyin), 0n);
  const byRegion = useMemo(() => {
    const m = new Map<number, { name: string; total: bigint; count: number }>();
    for (const e of all) {
      const g = m.get(e.regionCode) ?? { name: e.regionName ?? String(e.regionCode), total: 0n, count: 0 };
      g.total += BigInt(e.amountTiyin);
      g.count += 1;
      m.set(e.regionCode, g);
    }
    return [...m.entries()].sort((a, b) => (b[1].total > a[1].total ? 1 : -1));
  }, [all]);
  const groups = useMemo(() => {
    const m = new Map<string, { code: string; label: string }[]>();
    for (const c of lookups?.categories ?? []) {
      const k = c.group ?? 'Boshqa';
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()];
  }, [lookups]);

  const open = (e?: RdExpense) =>
    setForm(
      e
        ? { id: e.id, date: e.date, regionCode: String(e.regionCode), districtId: e.districtId ?? '', categoryCode: e.categoryCode, amount: Number(BigInt(e.amountTiyin) / 100n), description: e.description ?? '', counterparty: e.counterparty ?? '', documentNo: e.documentNo ?? '', paymentMethod: e.paymentMethod, recurrence: e.recurrence }
        : { id: null, date: period === todayInput().slice(0, 7) ? todayInput() : `${period}-01`, regionCode: region !== null ? String(region) : '', districtId: '', categoryCode: '', amount: null, description: '', counterparty: '', documentNo: '', paymentMethod: 'BANK', recurrence: null },
    );

  const submit = async () => {
    if (!form) return;
    setFormError(null);
    if (!form.regionCode) return setFormError('Hududni tanlang');
    if (!form.categoryCode) return setFormError('Xarajat moddasini tanlang');
    if (!form.amount || form.amount <= 0) return setFormError('Summani kiriting');
    if (!form.recurrence) return setFormError('Har oy takrorlanadimi yoki bir martalikmi — belgilang');
    setSaving(true);
    try {
      const input = {
        date: form.date,
        regionCode: Number(form.regionCode),
        districtId: form.districtId || null,
        categoryCode: form.categoryCode,
        amountTiyin: String(sumToTiyin(form.amount)),
        description: form.description.trim() || null,
        counterparty: form.counterparty.trim() || null,
        documentNo: form.documentNo.trim() || null,
        paymentMethod: form.paymentMethod,
        recurrence: form.recurrence,
      };
      if (form.id) await rdApi.updateExpense(form.id, input);
      else await rdApi.createExpense(input);
      setToast({ message: form.id ? "O'zgartirildi" : "Xarajat qo'shildi" });
      if (input.date.slice(0, 7) !== period) setPeriod(input.date.slice(0, 7));
      setForm(null);
      list.reload();
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!del) return;
    try {
      await rdApi.deleteExpense(del.id);
      setToast({ message: "O'chirildi" });
      list.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setDel(null);
    }
  };

  const districts = (lookups?.districts ?? []).filter((d) => form && String(d.regionCode) === form.regionCode);

  return (
    <>
      <PageHeader title="Hudud xarajatlari" description="Viloyat va tuman bo'yicha xarajatlar: ijara, kommunal, aloqa, transport… Ish haqi — «Ish haqi» bo'limida" actions={
          <>
            <Button onClick={() => open()}>+ Xarajat qo&apos;shish</Button>
            <DeleteDataButton
              target="EXPENSE"
              scope={{ regional: true, ...(region !== null ? { regionCode: region } : {}) }}
              month={period}
              place="Hudud xarajatlari"
              onDone={({ count }) => {
                setToast({ message: `${count} ta xarajat savatga tushdi` });
                list.reload();
              }}
            />
          </>
        }
      />
      <div className="space-y-5 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={period} onChange={setPeriod} max={todayInput().slice(0, 7)} />
          <select value={region ?? ''} onChange={(e) => setRegion(e.target.value === '' ? null : Number(e.target.value))} className={cn(FIELD, 'w-60')}>
            <option value="">Hamma hududlar</option>
            {(lookups?.regions ?? []).map((r) => (
              <option key={r.code} value={r.code}>
                {r.name}
              </option>
            ))}
          </select>
          <div className="ml-auto text-sm text-(--color-text-muted)">
            {rows.length} ta yozuv · jami <b className="money text-heading">{som(total.toString())}</b> so&apos;m
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-4">
          <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card xl:col-span-3">
            {list.loading && !list.data ? (
              <TableSkeleton rows={6} cols={6} />
            ) : list.error ? (
              <ErrorState message={list.error} onRetry={list.reload} />
            ) : rows.length === 0 ? (
              <EmptyState title={`${monthLabel(period)}: xarajat yo'q`} description="«+ Xarajat qo'shish» tugmasi bilan kiriting" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                      <th className="px-4 py-2.5">Sana</th>
                      <th className="px-3 py-2.5">Hudud</th>
                      <th className="px-3 py-2.5">Modda · izoh</th>
                      <th className="px-3 py-2.5 text-right">Summa</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {rows.map((e) => (
                      <tr key={e.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 whitespace-nowrap">{dmy(e.date)}</td>
                        <td className="px-3 py-2.5">
                          <p className="font-medium text-heading">{e.regionName}</p>
                          {e.districtName && <p className="text-xs text-(--color-text-muted)">{e.districtName}</p>}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="text-heading">
                            {e.categoryLabel}
                            <span className={cn('ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold', e.recurrence === 'RECURRING' ? 'bg-sky-100 text-sky-700' : e.recurrence === 'ONE_TIME' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700')}>
                              {e.recurrence === 'RECURRING' ? 'har oy' : e.recurrence === 'ONE_TIME' ? 'bir martalik' : 'belgilanmagan'}
                            </span>
                          </p>
                          <p className="text-xs text-(--color-text-muted)">{[e.description, e.counterparty, e.documentNo ? `№${e.documentNo}` : null].filter(Boolean).join(' · ') || '—'}</p>
                        </td>
                        <td className="money px-3 py-2.5 text-right font-bold">{som(e.amountTiyin)}</td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <button type="button" onClick={() => open(e)} className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50">
                            Tahrirlash
                          </button>
                          <button type="button" onClick={() => setDel(e)} className="rounded-lg px-2 py-1 text-xs font-semibold text-(--color-expense) hover:bg-red-50">
                            O&apos;chirish
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="rounded-(--radius-card) bg-white p-4 shadow-card">
            <p className="mb-3 font-semibold text-heading">Hududlar bo&apos;yicha</p>
            {byRegion.length === 0 ? (
              <p className="text-sm text-(--color-text-muted)">—</p>
            ) : (
              <ul className="space-y-2">
                {byRegion.map(([code, g]) => (
                  <li key={code}>
                    <button type="button" onClick={() => setRegion(region === code ? null : code)} className={cn('flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-brand-50', region === code && 'bg-brand-50 font-semibold')}>
                      <span className="truncate">{g.name}</span>
                      <span className="money shrink-0 font-semibold">{som(g.total.toString())}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <Drawer
        open={form !== null}
        onClose={() => setForm(null)}
        title={form?.id ? 'Xarajatni tahrirlash' : 'Yangi hudud xarajati'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setForm(null)}>
              Bekor qilish
            </Button>
            <Button onClick={() => void submit()} loading={saving}>
              Saqlash
            </Button>
          </div>
        }
      >
        {form && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Sana</Label>
                <input type="date" value={form.date} max={todayInput()} onChange={(e) => setForm({ ...form, date: e.target.value })} className={FIELD} />
              </div>
              <div>
                <Label hint="so'm">Summa</Label>
                <SumInput value={form.amount} onChange={(v) => setForm({ ...form, amount: v })} placeholder="0" />
              </div>
            </div>
            <div>
              <Label>Hudud</Label>
              <select value={form.regionCode} onChange={(e) => setForm({ ...form, regionCode: e.target.value, districtId: '' })} className={FIELD}>
                <option value="">— tanlang —</option>
                {(lookups?.regions ?? []).map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            {districts.length > 0 && (
              <div>
                <Label hint="ixtiyoriy">Tuman</Label>
                <select value={form.districtId} onChange={(e) => setForm({ ...form, districtId: e.target.value })} className={FIELD}>
                  <option value="">— viloyat bo&apos;yicha —</option>
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <Label>Xarajat moddasi</Label>
              <select value={form.categoryCode} onChange={(e) => setForm({ ...form, categoryCode: e.target.value })} className={FIELD}>
                <option value="">— tanlang —</option>
                {groups.map(([g, items]) => (
                  <optgroup key={g} label={g}>
                    {items.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label hint="ixtiyoriy">Kimga to&apos;landi</Label>
                <input value={form.counterparty} onChange={(e) => setForm({ ...form, counterparty: e.target.value })} className={FIELD} maxLength={200} />
              </div>
              <div>
                <Label hint="ixtiyoriy">Hujjat №</Label>
                <input value={form.documentNo} onChange={(e) => setForm({ ...form, documentNo: e.target.value })} className={FIELD} maxLength={50} />
              </div>
            </div>
            <div>
              <Label>Xarajat turi</Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['RECURRING', 'Har oy takrorlanadi', 'ijara, kommunal, aloqa'],
                    ['ONE_TIME', 'Bir martalik', "ta'mir, jihoz, tadbir"],
                  ] as const
                ).map(([v, t, h]) => (
                  <button key={v} type="button" onClick={() => setForm({ ...form, recurrence: v })} className={cn('rounded-xl border p-2.5 text-left', form.recurrence === v ? 'border-brand-500 bg-brand-50' : 'border-(--color-line-strong) hover:border-brand-300')}>
                    <span className="block text-sm font-semibold text-heading">{t}</span>
                    <span className="block text-xs text-(--color-text-muted)">{h}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>To&apos;lov usuli</Label>
              <div className="flex flex-wrap gap-2">
                {METHODS.map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setForm({ ...form, paymentMethod: v })} className={cn('rounded-lg border px-3 py-1.5 text-sm', form.paymentMethod === v ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700' : 'border-(--color-line-strong) hover:border-brand-300')}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label hint="ixtiyoriy">Izoh</Label>
              <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} maxLength={500} className={cn(FIELD, 'h-auto py-2')} />
            </div>
            {formError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</p>}
          </div>
        )}
      </Drawer>
      <ConfirmDialog
        open={del !== null}
        title="Xarajatni o'chirish"
        message={del ? `${del.regionName}: ${del.categoryLabel}, ${som(del.amountTiyin)} so'm` : ''}
        confirmLabel="O'chirish"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setDel(null)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}