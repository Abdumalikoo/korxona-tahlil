'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { qtyText } from '@/features/warehouse/api';
import { purchasesApi, receiptsApi, type Purchase, type Receipt } from './api';
import { FIELD, KindBadge, Label, ReceiptBadge } from './bits';

/** Xarid › Tovar keldi: kelgan miqdorni yozish — omborchi qabul qiladi yoki qaytaradi */
export function ReceiptPage() {
  const params = useSearchParams();
  const [selected, setSelected] = useState<string | null>(params.get('purchase'));
  const open = useAsync(() => purchasesApi.list('active'), []);
  const recent = useAsync(() => receiptsApi.list('all'), []);
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [withdrawId, setWithdrawId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const purchases = open.data?.data ?? [];
  const receipts = recent.data?.data ?? [];
  const current = purchases.find((p) => p.id === selected) ?? null;

  async function withdraw() {
    if (!withdrawId) return;
    setBusy(true);
    try {
      await receiptsApi.withdraw(withdrawId);
      setToast({ text: 'Qabul yozuvi qaytarib olindi', tone: 'success' });
      setWithdrawId(null);
      recent.reload();
      open.reload();
    } catch (e) {
      setToast({ text: errorMessage(e, 'Bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Tovar keldi" description="Tovar yetib kelganini yozing — omborchi qabul qilgach omborga kiradi" />
      <div className="grid gap-5 p-4 md:p-6 xl:grid-cols-[22rem_1fr]">
        <Card className="self-start overflow-hidden">
          <CardHeader title="Kutilayotgan xaridlar" description="Qaysi biri keldi?" />
          {open.loading && !open.data ? (
            <LoadingState />
          ) : open.error ? (
            <ErrorState message={open.error} onRetry={open.reload} />
          ) : purchases.length === 0 ? (
            <EmptyState title="Kutilayotgan xarid yo'q" description="Avval birja yoki oddiy xarid yozing" />
          ) : (
            <ul className="max-h-[28rem] divide-y divide-(--color-line) overflow-y-auto">
              {purchases.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setSelected(p.id)} className={cn('w-full px-4 py-3 text-left transition-colors hover:bg-brand-50/60', selected === p.id && 'bg-brand-50')}>
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <span className="font-mono text-xs">{p.number}</span>
                      <KindBadge kind={p.kind} />
                    </p>
                    <p className="mt-0.5 truncate text-sm">{p.supplierName}</p>
                    <p className={cn('mt-0.5 text-xs', p.deliveryLate ? 'font-semibold text-(--color-expense)' : 'text-(--color-text-muted)')}>
                      {p.deliveryDue ? `Muddat: ${formatDate(p.deliveryDue)}` : 'Muddat yo‘q'}
                      {p.pendingReceipts > 0 ? ' · omborchi kutilmoqda' : ''}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          {current ? (
            <ReceiptForm
              key={current.id}
              purchase={current}
              onSent={() => {
                setToast({ text: 'Omborchiga yuborildi', tone: 'success' });
                recent.reload();
                open.reload();
              }}
              onError={(text) => setToast({ text, tone: 'error' })}
            />
          ) : (
            <Card className="p-8">
              <EmptyState title="Xaridni tanlang" description="Chapdan kelgan tovarning xaridini bosing" />
            </Card>
          )}

          <Card className="overflow-hidden">
            <CardHeader title="Qabul yozuvlari" description="Omborchi qarori shu yerda ko'rinadi" />
            {recent.loading && !recent.data ? (
              <LoadingState />
            ) : receipts.length === 0 ? (
              <EmptyState title="Hali yozuv yo'q" />
            ) : (
              <ul className="divide-y divide-(--color-line)">
                {receipts.slice(0, 30).map((r) => (
                  <ReceiptRow key={r.id} r={r} onWithdraw={() => setWithdrawId(r.id)} />
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={!!withdrawId}
        title="Yozuvni qaytarib olish"
        message="Omborchi hali qabul qilmagan yozuv bekor qilinadi. Keyin qaytadan yozishingiz mumkin."
        confirmLabel="Qaytarib olish"
        cancelLabel="Ortga"
        danger
        loading={busy}
        onConfirm={() => void withdraw()}
        onCancel={() => setWithdrawId(null)}
      />
      {toast && <Toast message={toast.text} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}

function ReceiptRow({ r, onWithdraw }: { r: Receipt; onWithdraw: () => void }) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono text-xs font-semibold">{r.number}</span>
        <ReceiptBadge status={r.status} />
        <span className="text-sm text-(--color-text-muted)">{r.purchaseNumber} · {r.supplierName}</span>
        <span className="ml-auto text-xs text-(--color-text-muted)">{formatDate(r.date)}</span>
        {r.status === 'PENDING' && <Button size="sm" variant="secondary" onClick={onWithdraw}>Qaytarib olish</Button>}
      </div>
      <p className="mt-1 text-xs text-(--color-text-muted)">
        {r.lines.map((l) => `${l.itemName} — ${qtyText(l.qty)} ${l.unit}`).join(' · ')} · <b className="money">{formatTiyin(r.totalTiyin)}</b> so&apos;m
      </p>
      {r.status === 'REJECTED' && r.rejectReason && (
        <p className="mt-1.5 rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-1.5 text-sm text-(--color-expense)">
          Omborchi qaytardi{r.decidedByName ? ` (${r.decidedByName})` : ''}: {r.rejectReason}
        </p>
      )}
    </li>
  );
}

function ReceiptForm({ purchase, onSent, onError }: { purchase: Purchase; onSent: () => void; onError: (t: string) => void }) {
  const pending = useAsync(() => receiptsApi.list('pending', purchase.id), [purchase.id]);
  const waiting = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of pending.data?.data ?? []) for (const l of r.lines) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty);
    return m;
  }, [pending.data]);
  const remaining = (itemId: string, qty: number, received: number) => Math.max(0, Math.round((qty - received - (waiting.get(itemId) ?? 0)) * 1000) / 1000);

  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pending.data) return;
    const next: Record<string, string> = {};
    for (const l of purchase.lines) {
      const rem = remaining(l.itemId, l.qty, l.receivedQty);
      next[l.itemId] = rem > 0 ? String(rem) : '';
    }
    setQty(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.data, purchase.id]);

  const rows = purchase.lines.map((l) => ({ l, rem: remaining(l.itemId, l.qty, l.receivedQty) }));
  const nothing = rows.every((r) => r.rem <= 0);

  async function send() {
    setError(null);
    const lines: { itemId: string; qty: number }[] = [];
    for (const { l, rem } of rows) {
      const raw = (qty[l.itemId] ?? '').replace(',', '.').trim();
      if (!raw) continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return setError(`«${l.itemName}»: miqdor noto‘g‘ri`);
      if (n === 0) continue;
      if (n > rem + 1e-9) return setError(`«${l.itemName}»: kutilayotgan miqdordan (${qtyText(rem)}) ko‘p`);
      lines.push({ itemId: l.itemId, qty: n });
    }
    if (lines.length === 0) return setError('Kamida bitta tovar miqdorini yozing');
    setSaving(true);
    try {
      await receiptsApi.create({ purchaseId: purchase.id, lines, note: note.trim() || null });
      setNote('');
      onSent();
      pending.reload();
    } catch (e) {
      const msg = errorMessage(e, 'Yuborib bo‘lmadi');
      setError(msg);
      onError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title={`${purchase.number} · ${purchase.supplierName}`} description={purchase.kind === 'EXCHANGE' && purchase.lotNo ? `Birja, lot ${purchase.lotNo}` : 'Oddiy xarid'} />
      <div className="space-y-4 p-4">
        {nothing ? (
          <p className="rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-3 text-sm text-(--color-text-muted)">Bu xaridning hamma tovari uchun qabul yozuvi bor — omborchi javobini kuting.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                <tr>
                  <th className="py-2 text-left">Tovar</th>
                  <th className="py-2 text-right">Buyurtma</th>
                  <th className="py-2 text-right">Qabul qilingan</th>
                  <th className="w-32 py-2 text-right">Hozir keldi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {rows.map(({ l, rem }) => (
                  <tr key={l.id}>
                    <td className="py-2.5 pr-2 font-medium">{l.itemName}</td>
                    <td className="money py-2.5 text-right">{qtyText(l.qty)} {l.unit}</td>
                    <td className="money py-2.5 text-right text-(--color-text-muted)">{qtyText(l.receivedQty)}</td>
                    <td className="py-2.5 pl-2">
                      <input
                        disabled={rem <= 0}
                        inputMode="decimal"
                        value={qty[l.itemId] ?? ''}
                        onChange={(e) => setQty((s) => ({ ...s, [l.itemId]: e.target.value.replace(/[^\d.,]/g, '') }))}
                        placeholder={rem <= 0 ? '—' : '0'}
                        className="money h-9 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2.5 text-right text-sm outline-none focus:border-brand-600 disabled:bg-(--color-surface-muted)"
                      />
                      {rem > 0 && <p className="mt-0.5 text-right text-[11px] text-(--color-text-faint)">ko‘pi bilan {qtyText(rem)}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div>
          <Label hint="ixtiyoriy">Izoh</Label>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={FIELD} placeholder="Masalan: yuk mashinasi 12-darvozada" />
        </div>
        {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
        <div className="flex justify-end">
          <Button disabled={nothing} loading={saving} onClick={() => void send()}>Omborchiga yuborish</Button>
        </div>
      </div>
    </Card>
  );
}