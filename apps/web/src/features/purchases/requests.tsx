'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { qtyText } from '@/features/warehouse/api';
import { purchasesApi, type PurchaseRequest, type RequestStatus } from './api';
import { FIELD, Label, RequestBadge } from './bits';

const FILTERS = [
  { key: 'active', label: 'Ochiq' },
  { key: 'DONE', label: 'Bajarilgan' },
  { key: 'REJECTED', label: 'Rad etilgan' },
  { key: 'all', label: 'Hammasi' },
];

/** Xarid › Arizalar: bo'limlardan kelgan «shu kerak» so'rovlari */
export function RequestsPage() {
  const { canWrite } = useAuth();
  const writable = canWrite('/xarid');
  const [filter, setFilter] = useState('active');
  const list = useAsync(() => purchasesApi.requests(filter), [filter]);
  const rows = list.data?.data ?? [];
  const [rejecting, setRejecting] = useState<PurchaseRequest | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);

  async function setStatus(r: PurchaseRequest, status: RequestStatus, why?: string) {
    setBusy(r.id);
    try {
      await purchasesApi.requestStatus(r.id, status, why);
      setRejecting(null);
      setReason('');
      list.reload();
    } catch (e) {
      setToast({ text: errorMessage(e, 'Bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  /** Arizani o'chirish — faqat unga xarid bog'lanmagan bo'lsa */
  async function remove(r: PurchaseRequest) {
    if (!window.confirm(`Ariza ${r.number} («${r.title}») butunlay o'chirilsinmi?`)) return;
    setBusy(r.id);
    try {
      await purchasesApi.removeRequest(r.id);
      setToast({ text: "Ariza o'chirildi", tone: 'success' });
      list.reload();
    } catch (e) {
      setToast({ text: errorMessage(e, 'Bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Arizalar"
        description="Bo'limlardan kelgan xarid so'rovlari"
        actions={writable && <Link href="/xarid/ariza" className="inline-flex h-9 items-center rounded-(--radius-control) bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-700">Ariza yozish</Link>}
      />
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={cn('rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors', filter === f.key ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-line-strong) bg-white hover:border-brand-300 hover:bg-brand-50')}>
              {f.label}
            </button>
          ))}
        </div>

        {list.loading && !list.data ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : rows.length === 0 ? (
          <Card className="p-6"><EmptyState title="Ariza yo'q" description={filter === 'active' ? "Bo'limdan so'rov kelganda «Ariza yozish» bilan kiriting" : undefined} /></Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {rows.map((r) => {
              const active = r.status === 'NEW' || r.status === 'IN_PROGRESS';
              return (
                <Card key={r.id} className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold">{r.number}</span>
                    <RequestBadge status={r.status} />
                    <span className="ml-auto text-xs text-(--color-text-muted)">{formatDate(r.date)}</span>
                  </div>
                  <p className="mt-2 text-base font-semibold text-heading">{r.title}</p>
                  <p className="text-xs text-(--color-text-muted)">{[r.departmentName, r.requester].filter(Boolean).join(' · ') || 'Bo‘lim ko‘rsatilmagan'}</p>
                  <ul className="mt-2 space-y-0.5 text-sm">
                    {r.lines.map((l) => (
                      <li key={l.id} className="flex justify-between gap-3"><span className="truncate">{l.name}</span><span className="money shrink-0 text-(--color-text-muted)">{qtyText(l.qty)} {l.unit}</span></li>
                    ))}
                  </ul>
                  {r.note && <p className="mt-2 text-xs italic text-(--color-text-muted)">{r.note}</p>}
                  {r.status === 'REJECTED' && r.rejectReason && <p className="mt-2 rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-1.5 text-sm text-(--color-expense)">Sabab: {r.rejectReason}</p>}
                  {r.purchases.length > 0 && (
                    <p className="mt-2 text-xs text-(--color-text-muted)">
                      Xaridlar: {r.purchases.map((p) => <Link key={p.id} href={`/xarid/xaridlar?open=${p.id}&filter=all`} className="mr-2 font-mono font-semibold text-brand-700 hover:underline">{p.number}</Link>)}
                    </p>
                  )}
                  {writable && active && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-(--color-line) pt-3">
                      <Link href={`/xarid/birja?request=${r.id}`} className="inline-flex h-9 items-center rounded-(--radius-control) bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700">Birjadan xarid</Link>
                      <Link href={`/xarid/oddiy?request=${r.id}`} className="inline-flex h-9 items-center rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 text-sm hover:bg-brand-50">Oddiy xarid</Link>
                      {r.status === 'NEW' && <Button size="sm" variant="secondary" loading={busy === r.id} onClick={() => void setStatus(r, 'IN_PROGRESS')}>Ishga olish</Button>}
                      <Button size="sm" variant="secondary" loading={busy === r.id} onClick={() => void setStatus(r, 'DONE')}>Bajarildi</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setRejecting(r); setReason(''); }}>Rad etish</Button>
                    </div>
                  )}
                  {writable && r.purchases.length === 0 && (
                    <div className={cn('flex justify-end', !active && 'mt-3 border-t border-(--color-line) pt-3')}>
                      <Button size="sm" variant="ghost" className="text-(--color-expense) hover:bg-red-50" loading={busy === r.id} onClick={() => void remove(r)}>
                        O&apos;chirish
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Drawer
        open={!!rejecting}
        onClose={() => setRejecting(null)}
        title="Arizani rad etish"
        description={rejecting ? `${rejecting.number} · ${rejecting.title}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>Ortga</Button>
            <Button data-save variant="danger" loading={busy === rejecting?.id} disabled={reason.trim().length < 3} onClick={() => rejecting && void setStatus(rejecting, 'REJECTED', reason.trim())}>Rad etish</Button>
          </>
        }
      >
        <Label>Sababi</Label>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} className={cn(FIELD, 'h-auto py-2')} placeholder="Masalan: byudjetda yo‘q, omborda bor" />
      </Drawer>
      {toast && <Toast message={toast.text} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}