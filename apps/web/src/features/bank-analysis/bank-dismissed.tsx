'use client';

import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import type { ToastFn } from './bank-analysis-parts';
import { ClarifyDialog } from './clarify-dialog';
import { useSource } from './source';
import type { BankListRow, BankView } from './api';

// ═══════════════════════════════════════════════════════════
// «Bekor qilinganlar»: kiritilmaydigan deb bekor qilingan (va ro'yxatlardan «o'chirilgan») to'lovlar — tanlangan davr,
// chiqim va kirim birga. Belgilab (yoki hammasini) — tahlilga qaytarish, aniqlashtirishga o'tkazish yoki ko'chirmadan
// butunlay o'chirish (tasdiq bilan).
// ═══════════════════════════════════════════════════════════

const rk = (r: BankListRow) => `${r.account}:${r.id}`;

export function DismissedList({ v, isAdmin, onToast, onChanged }: { v: BankView; isAdmin: boolean; onToast: ToastFn; onChanged: () => void }) {
  const { api, dirLabel } = useSource();
  const [rev, setRev] = useState(0);
  const res = useAsync(() => api.rows(v.from, v.to, v.account).then((r) => r.data), [v.from, v.to, v.account, rev]);
  const rows = useMemo(() => (res.data?.rows ?? []).filter((r) => r.dismissed), [res.data]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [deleteAsk, setDeleteAsk] = useState(false);

  // Belgilanganlar — faqat hozir ro'yxatda turganlari (qayta yuklansa, yo'qolganlari hisobga olinmaydi)
  const picked = rows.filter((r) => sel.has(rk(r)));
  const pickedTotal = picked.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
  const total = rows.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
  const allOn = rows.length > 0 && picked.length === rows.length;
  // Aniqlashtirishga o'tkazish oynasi (izoh so'raydi): qaysi to'lovlar
  const [clarifyAsk, setClarifyAsk] = useState<BankListRow[] | null>(null);
  const items = (list: BankListRow[] = picked) => list.map((r) => ({ account: r.account, rowId: r.id }));
  const reload = () => {
    setSel(new Set());
    setRev((x) => x + 1);
    onChanged();
  };

  function toggle(k: string) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }

  /** «Tahlil va saqlash»ning ish ro'yxatiga qaytarish */
  async function restore(list: BankListRow[] = picked) {
    setBusy(true);
    try {
      const r = (await api.undismiss(items(list))).data;
      onToast({ message: `Tahlilga qaytarildi: ${r.count} ta to'lov`, tone: 'success' });
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "Qaytarib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  /** «Aniqlashtirish»ga o'tkazish (server bekor qilish belgisini o'zi oladi) */
  async function toClarify(list: BankListRow[], note: string) {
    setBusy(true);
    try {
      const r = (await api.clarify(items(list), note.trim() || undefined)).data;
      onToast({ message: `Aniqlashtirishga o'tkazildi: ${r.count} ta · ${formatTiyin(r.totalTiyin)} so'm`, tone: 'success' });
      setClarifyAsk(null);
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "O'tkazib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const r = (await api.deleteRows(items())).data;
      onToast({ message: `Butunlay o'chirildi: ${r.count} ta to'lov · ${formatTiyin(r.totalTiyin)} so'm (ko'chirmadan)`, tone: 'success' });
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "O'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
      setDeleteAsk(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Bekor qilinganlar"
        description={`Kiritilmaydigan to'lovlar: ${rows.length} ta · ${formatTiyin(total.toString())} so'm. Xarajat / daromad yozuvi yaratilmagan. Belgilab — tahlilga qaytarish, aniqlashtirishga o'tkazish yoki ko'chirmadan butunlay o'chirish.`}
      />
      {isAdmin && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) bg-(--color-surface-muted) px-5 py-2.5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="size-4 accent-brand-600" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(rows.map(rk)))} />
            Hammasini belgilash
          </label>
          <span className="text-xs text-(--color-text-muted)">
            Belgilangan: <b className="text-heading">{picked.length}</b> ta · <span className="money">{formatTiyin(pickedTotal.toString())}</span> so&apos;m
          </span>
          <span className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={!picked.length || busy} onClick={() => void restore()}>
              Tahlilga qaytarish ({picked.length})
            </Button>
            <Button size="sm" variant="secondary" disabled={!picked.length || busy} onClick={() => setClarifyAsk(picked)}>
              Aniqlashtirishga ({picked.length})
            </Button>
            <Button size="sm" variant="danger" disabled={!picked.length || busy} onClick={() => setDeleteAsk(true)}>
              Butunlay o&apos;chirish ({picked.length})
            </Button>
          </span>
        </div>
      )}
      {res.loading && !res.data ? (
        <LoadingState />
      ) : res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : !rows.length ? (
        <p className="px-5 py-6 text-sm text-(--color-text-muted)">Bu davrda bekor qilingan to&apos;lov yo&apos;q.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-(--color-surface-muted) text-left text-xs text-(--color-text-muted)">
              <tr>
                {isAdmin && <th className="w-8 px-3 py-2" />}
                <th className="px-2 py-2">Sana</th>
                <th className="px-2 py-2">№</th>
                <th className="px-2 py-2">Oluvchi / to&apos;lovchi</th>
                <th className="px-2 py-2">ИНН</th>
                <th className="px-2 py-2 text-right">Summa</th>
                <th className="px-2 py-2">To&apos;lov maqsadi</th>
                <th className="px-2 py-2">Sabab</th>
                {isAdmin && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-line)">
              {rows.map((r) => {
                const k = rk(r);
                return (
                  <tr key={k} className={cn(sel.has(k) && 'bg-brand-50/40')}>
                    {isAdmin && (
                      <td className="px-3 py-1.5">
                        <input type="checkbox" className="size-4 accent-brand-600" checked={sel.has(k)} onChange={() => toggle(k)} aria-label="Belgilash" />
                      </td>
                    )}
                    <td className="money px-2 py-1.5 whitespace-nowrap">{formatDate(r.docDate)}</td>
                    <td className="money px-2 py-1.5 whitespace-nowrap text-(--color-text-muted)">{r.docNo || '—'}</td>
                    <td className="max-w-56 truncate px-2 py-1.5" title={r.accountName}>
                      {r.accountName}
                    </td>
                    <td className="money px-2 py-1.5 whitespace-nowrap">{r.inn || '—'}</td>
                    <td className={cn('money px-2 py-1.5 text-right font-semibold whitespace-nowrap', r.dir === 'OUT' ? 'text-(--color-expense)' : 'text-(--color-income)')} title={dirLabel[r.dir]}>
                      {r.dir === 'OUT' ? '−' : '+'}
                      {formatTiyin(r.amountTiyin)}
                    </td>
                    <td className="max-w-md px-2 py-1.5">
                      <span className="line-clamp-2 whitespace-pre-wrap" title={r.purpose}>
                        {r.purpose || '—'}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {r.dismissed?.reason && <span className="block text-heading">{r.dismissed.reason}</span>}
                      <span className="text-(--color-text-faint)">
                        {r.dismissed ? `${formatDateTime(r.dismissed.at)} · ${r.dismissed.by}` : ''}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="px-2 py-1.5">
                        <span className="flex flex-col items-end gap-1">
                          <button type="button" disabled={busy} onClick={() => void restore([r])} title="«Tahlil va saqlash»ning ish ro'yxatiga qaytadi" className="text-[11px] font-medium whitespace-nowrap text-brand-700 hover:underline disabled:opacity-50">
                            Tahlilga qaytarish
                          </button>
                          <button type="button" disabled={busy} onClick={() => setClarifyAsk([r])} title="«Aniqlashtirish»ga o'tadi — tuzatilgach kiritiladi" className="text-[11px] font-medium whitespace-nowrap text-amber-800 hover:underline disabled:opacity-50">
                            Aniqlashtirishga
                          </button>
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {clarifyAsk && <ClarifyDialog rows={clarifyAsk} busy={busy} onConfirm={(note) => void toClarify(clarifyAsk, note)} onCancel={() => setClarifyAsk(null)} />}
      <ConfirmDialog
        open={deleteAsk}
        title="Butunlay o'chirish"
        message={`${picked.length} ta to'lov (${formatTiyin(pickedTotal.toString())} so'm) saqlangan ko'chirmadan butunlay o'chiriladi — tahlil va jamilardan ham ketadi, qaytarib bo'lmaydi. Xarajat va daromad yozuvlariga tegmaydi. Ko'chirma fayli qayta yuklansa, yana paydo bo'ladi.`}
        confirmLabel="Butunlay o'chirish"
        danger
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleteAsk(false)}
      />
    </Card>
  );
}
