'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { qtyText } from '@/features/warehouse/api';
import { receiptsApi, type Receipt } from './api';
import { FIELD, Label, ReceiptBadge } from './bits';

const TABS = [
  { key: 'pending', label: 'Kutilmoqda' },
  { key: 'accepted', label: 'Qabul qilingan' },
  { key: 'rejected', label: 'Qaytarilgan' },
];

/** Ombor › Qabul qilish: xaridchi «tovar keldi» deb yuborgan hujjatlar — omborchi sanab ko'rib qabul qiladi yoki qaytaradi */
export function AcceptPage() {
  const [tab, setTab] = useState('pending');
  const list = useAsync(() => receiptsApi.list(tab), [tab]);
  const rows = list.data?.data ?? [];
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Receipt | null>(null);
  const [reason, setReason] = useState('');
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  // Yangi yuborilganlar o'zi ko'rinishi uchun
  useEffect(() => {
    if (tab !== 'pending') return;
    const t = window.setInterval(() => list.reload(), 30_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function accept(r: Receipt) {
    setBusy(r.id);
    try {
      await receiptsApi.accept(r.id);
      setToast({ text: `${r.number} qabul qilindi — omborga kirim yozildi`, tone: 'success' });
      list.reload();
    } catch (e) {
      setToast({ text: errorMessage(e, 'Qabul qilib bo‘lmadi'), tone: 'error' });
      list.reload();
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    if (!rejecting) return;
    setBusy(rejecting.id);
    try {
      await receiptsApi.reject(rejecting.id, reason.trim());
      setToast({ text: `${rejecting.number} xaridchiga qaytarildi`, tone: 'success' });
      setRejecting(null);
      setReason('');
      list.reload();
    } catch (e) {
      setToast({ text: errorMessage(e, 'Qaytarib bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Qabul qilish" description="Xaridchi yuborgan tovarni sanab ko'ring: to'g'ri bo'lsa qabul qiling, bo'lmasa sababini yozib qaytaring" />
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)} className={cn('rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors', tab === t.key ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-line-strong) bg-white hover:border-brand-300 hover:bg-brand-50')}>
              {t.label}
            </button>
          ))}
        </div>

        {list.loading && !list.data ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : rows.length === 0 ? (
          <Card className="p-6">
            <EmptyState title={tab === 'pending' ? 'Kutilayotgan tovar yo‘q' : 'Yozuv yo‘q'} description={tab === 'pending' ? "Xaridchi «Tovar keldi» bosganda shu yerda paydo bo'ladi" : undefined} />
          </Card>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {rows.map((r) => (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold">{r.number}</span>
                  <ReceiptBadge status={r.status} />
                  <span className="ml-auto text-xs text-(--color-text-muted)">{formatDate(r.date)}</span>
                </div>
                <p className="mt-2 text-base font-semibold text-heading">{r.supplierName}</p>
                <p className="text-xs text-(--color-text-muted)">
                  Xarid {r.purchaseNumber}
                  {r.documentNo ? ` · hujjat ${r.documentNo}` : ''}
                  {r.createdByName ? ` · yubordi: ${r.createdByName}` : ''}
                </p>
                <div className="mt-3 overflow-x-auto rounded-(--radius-control) border border-(--color-line)">
                  <table className="w-full min-w-[22rem] text-sm">
                    <thead className="bg-(--color-surface-muted) text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                      <tr>
                        <th className="px-3 py-2 text-left">Tovar</th>
                        <th className="px-3 py-2 text-right">Soni</th>
                        <th className="px-3 py-2 text-right">Narx</th>
                        <th className="px-3 py-2 text-right">Summa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-(--color-line)">
                      {r.lines.map((l) => (
                        <tr key={l.itemId}>
                          <td className="px-3 py-2 font-medium">{l.itemName}</td>
                          <td className="money whitespace-nowrap px-3 py-2 text-right font-semibold">{qtyText(l.qty)} {l.unit}</td>
                          <td className="money px-3 py-2 text-right text-(--color-text-muted)">{formatTiyin(l.priceTiyin)}</td>
                          <td className="money px-3 py-2 text-right">{formatTiyin(l.amountTiyin)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-(--color-surface-muted)">
                        <td colSpan={3} className="px-3 py-2 text-right text-xs text-(--color-text-muted)">Jami</td>
                        <td className="money px-3 py-2 text-right font-bold">{formatTiyin(r.totalTiyin)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {r.note && <p className="mt-2 text-xs italic text-(--color-text-muted)">{r.note}</p>}
                {r.status === 'REJECTED' && r.rejectReason && (
                  <p className="mt-2 rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-1.5 text-sm text-(--color-expense)">Sabab: {r.rejectReason}</p>
                )}
                {r.status === 'ACCEPTED' && (
                  <p className="mt-2 text-xs text-(--color-text-muted)">
                    {r.decidedByName ? `${r.decidedByName} qabul qildi` : 'Qabul qilindi'}
                    {r.decidedAt ? ` · ${formatDate(r.decidedAt)}` : ''} ·{' '}
                    <Link href="/ombor/hujjatlar" className="font-semibold text-brand-700 hover:underline">Ombor jurnalida kirim</Link>
                  </p>
                )}
                {r.status === 'PENDING' && (
                  <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-(--color-line) pt-3">
                    <Button variant="secondary" disabled={busy === r.id} onClick={() => { setRejecting(r); setReason(''); }}>Qaytarish</Button>
                    <Button loading={busy === r.id} onClick={() => void accept(r)}>Qabul qildim</Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      <Drawer
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Tovarni qaytarish"
        description={rejecting ? `${rejecting.number} · ${rejecting.supplierName}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>Ortga</Button>
            <Button data-save variant="danger" loading={busy === rejecting?.id} disabled={reason.trim().length < 3} onClick={() => void reject()}>Qaytarish</Button>
          </>
        }
      >
        <p className="mb-3 text-sm text-(--color-text-muted)">Omborga kirim yozilmaydi. Xaridchi sababni ko&apos;radi va to&apos;g&apos;ri miqdor bilan qaytadan yuboradi.</p>
        <Label>Sababi</Label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} className={cn(FIELD, 'h-auto py-2')} placeholder="Masalan: 40 o‘rniga 36 pachka keldi, 2 ta qutisi ochilgan" />
      </Drawer>
      {toast && <Toast message={toast.text} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}