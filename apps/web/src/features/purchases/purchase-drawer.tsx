'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { LoadingState } from '@/components/ui/states';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatTiyin, sumToTiyin, todayInput } from '@/lib/format';
import { cn } from '@/lib/utils';
import { METHOD_LABELS, purchasesApi, type Purchase } from './api';
import { FIELD, KindBadge, Label, PaidBar, ReceiptBadge, StatusBadge, SumInput } from './bits';

// ═══════════════════════════════════════════════════════════
// Xarid kartochkasi: tafsilot, to'lovlar (qarz), qabul holati, muddatlarni tuzatish, bekor qilish.
// ═══════════════════════════════════════════════════════════

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-(--color-text-muted)">{label}</p>
      <div className="mt-0.5 break-words text-sm font-medium text-heading">{children || '—'}</div>
    </div>
  );
}

export function PurchaseDrawer({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const { canWrite, isAdmin } = useAuth();
  const editable = canWrite('/xarid');
  const [p, setP] = useState<Purchase | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [askCancel, setAskCancel] = useState(false);
  // To'lov
  const [amount, setAmount] = useState<number | null>(null);
  const [payDate, setPayDate] = useState(todayInput());
  const [method, setMethod] = useState('BANK');
  const [payNote, setPayNote] = useState('');
  // Tuzatish
  const [editing, setEditing] = useState(false);
  const [deliveryDue, setDeliveryDue] = useState('');
  const [paymentDue, setPaymentDue] = useState('');
  const [documentNo, setDocumentNo] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!id) return;
    setP(null);
    setError(null);
    setEditing(false);
    setAmount(null);
    setLoading(true);
    purchasesApi
      .get(id)
      .then((r) => setP(r.data))
      .catch((e: unknown) => setError(errorMessage(e, "Xaridni ochib bo'lmadi")))
      .finally(() => setLoading(false));
  }, [id]);

  const apply = (next: Purchase) => {
    setP(next);
    onChanged();
  };

  async function run<T>(fn: () => Promise<T>, then: (v: T) => void) {
    setBusy(true);
    setError(null);
    try {
      then(await fn());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const debt = p ? BigInt(p.debtTiyin) : 0n;
  const open = p?.status === 'OPEN';

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      width="lg"
      title={p ? `Xarid ${p.number}` : 'Xarid'}
      description={p ? `${p.supplierName} · ${formatDate(p.date)}` : undefined}
      footer={
        p && editable && p.status !== 'CANCELLED' ? (
          <>
            {p.status === 'OPEN' && (
              <Button variant="ghost" onClick={() => setAskCancel(true)}>
                Bekor qilish
              </Button>
            )}
            {open && !isAdmin && (
              <Link href={`/xarid/qabul?purchase=${p.id}`} className="inline-flex h-10 items-center rounded-(--radius-control) bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">
                Tovar keldi
              </Link>
            )}
          </>
        ) : undefined
      }
    >
      {loading && <LoadingState />}
      {error && <p className="mb-3 rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
      {p && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={p.kind} />
            <StatusBadge purchase={p} />
            {p.paymentLate && <span className="rounded-full bg-(--color-expense-soft) px-2.5 py-0.5 text-xs font-semibold text-(--color-expense)">To&apos;lov muddati o&apos;tgan</span>}
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Row label="Yetkazuvchi">{p.supplierName}</Row>
            <Row label="Sana">{formatDate(p.date)}</Row>
            {p.kind === 'EXCHANGE' && <Row label="Lot">{p.lotNo}</Row>}
            {p.kind === 'EXCHANGE' && <Row label="Birja">{p.exchange}</Row>}
            <Row label="Shartnoma / faktura">{p.documentNo}</Row>
            <Row label="Tovar muddati">
              <span className={cn(p.deliveryLate && 'text-(--color-expense)')}>{p.deliveryDue ? formatDate(p.deliveryDue) : null}</span>
            </Row>
            <Row label="To'lov muddati">
              <span className={cn(p.paymentLate && 'text-(--color-expense)')}>{p.paymentDue ? formatDate(p.paymentDue) : null}</span>
            </Row>
            {p.requestNumber && <Row label="Ariza">{p.requestNumber}</Row>}
            <Row label="Yozgan">{p.createdByName}</Row>
            {p.deliveredAt && <Row label="Yetkazilgan">{formatDate(p.deliveredAt)}</Row>}
          </div>
          {p.note && <p className="rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-2 text-sm text-(--color-text-muted)">{p.note}</p>}

          {/* Tovarlar */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-heading">Tovarlar</h3>
            <div className="overflow-x-auto rounded-(--radius-control) border border-(--color-line)">
              <table className="w-full text-sm">
                <thead className="bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
                  <tr>
                    <th className="px-3 py-2 text-left">Tovar</th>
                    <th className="px-3 py-2 text-right">Miqdor</th>
                    <th className="px-3 py-2 text-right">Kelgan</th>
                    <th className="px-3 py-2 text-right">Narx</th>
                    <th className="px-3 py-2 text-right">Summa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--color-line)">
                  {p.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 font-medium">{l.itemName}</td>
                      <td className="money px-3 py-2 text-right">{l.qty} {l.unit}</td>
                      <td className={cn('money px-3 py-2 text-right', l.receivedQty >= l.qty ? 'text-(--color-income)' : 'text-(--color-text-muted)')}>{l.receivedQty}</td>
                      <td className="money px-3 py-2 text-right">{formatTiyin(l.priceTiyin)}</td>
                      <td className="money px-3 py-2 text-right font-semibold">{formatTiyin(l.amountTiyin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 flex flex-col items-end text-sm">
              {BigInt(p.feeTiyin) > 0n && <p className="text-(--color-text-muted)">Birja yig&apos;imi (alohida xarajat): <b className="money text-heading">{formatTiyin(p.feeTiyin)}</b> so&apos;m</p>}
              <p>Tovarlar jami: <b className="money text-base text-heading">{formatTiyin(p.totalTiyin)}</b> so&apos;m</p>
            </div>
          </section>

          {/* To'lovlar */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-heading">To&apos;lovlar</h3>
            <div className="rounded-(--radius-control) border border-(--color-line) p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span>To&apos;langan: <b className="money text-(--color-income)">{formatTiyin(p.paidTiyin)}</b></span>
                <span>Qarz: <b className={cn('money', debt > 0n ? 'text-(--color-expense)' : 'text-(--color-text-muted)')}>{formatTiyin(p.debtTiyin)}</b> so&apos;m</span>
              </div>
              <PaidBar paid={p.paidTiyin} total={p.totalTiyin} />
              {p.payments.length > 0 && (
                <ul className="mt-3 divide-y divide-(--color-line) text-sm">
                  {p.payments.map((x) => (
                    <li key={x.id} className="flex items-center gap-3 py-1.5">
                      <span className="w-24 shrink-0 text-(--color-text-muted)">{formatDate(x.date)}</span>
                      <span className="money flex-1 font-medium">{formatTiyin(x.amountTiyin)} so&apos;m</span>
                      <span className="text-xs text-(--color-text-muted)">{METHOD_LABELS[x.method] ?? x.method}{x.note ? ` · ${x.note}` : ''}</span>
                      {editable && p.status !== 'CANCELLED' && (
                        <button type="button" disabled={busy} onClick={() => void run(() => purchasesApi.removePayment(p.id, x.id), (r) => apply(r.data))} className="rounded px-1.5 text-xs text-(--color-text-faint) hover:bg-(--color-surface-sunken) hover:text-(--color-expense)" title="To'lovni bekor qilish">
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {editable && p.status !== 'CANCELLED' && debt > 0n && (
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-(--color-line) pt-3">
                  <div className="col-span-2 min-w-0">
                    <SumInput value={amount} onChange={setAmount} placeholder="To'lov summasi, so'm" />
                  </div>
                  <input type="date" value={payDate} max={todayInput()} onChange={(e) => setPayDate(e.target.value)} className={FIELD} />
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className={FIELD}>
                    {Object.entries(METHOD_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <input value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="Izoh (ixtiyoriy)" className={cn(FIELD, 'col-span-2 min-w-0')} />
                  <div className="col-span-2 flex justify-end gap-2">
                    <Button size="sm" variant="secondary" disabled={amount === null || amount <= 0} onClick={() => setAmount(Number(debt) / 100)}>
                      Hammasi
                    </Button>
                    <Button
                      size="sm"
                      loading={busy}
                      disabled={amount === null || amount <= 0}
                      onClick={() =>
                        void run(
                          () => purchasesApi.addPayment(p.id, { date: payDate, amountTiyin: sumToTiyin(amount ?? 0), method, note: payNote.trim() || null }),
                          (r) => {
                            apply(r.data);
                            setAmount(null);
                            setPayNote('');
                          },
                        )
                      }
                    >
                      To&apos;lov yozish
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Qabul */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-heading">Omborga qabul</h3>
            {p.receipts.length === 0 ? (
              <p className="text-sm text-(--color-text-muted)">Tovar hali omborga yuborilmagan.</p>
            ) : (
              <ul className="space-y-1.5">
                {p.receipts.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 text-sm">
                    <span className="font-mono text-xs">{r.number}</span>
                    <span className="text-(--color-text-muted)">{formatDate(r.date)}</span>
                    <ReceiptBadge status={r.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Tuzatish */}
          {editable && open && (
            <section>
              {!editing ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setDeliveryDue(p.deliveryDue ?? '');
                    setPaymentDue(p.paymentDue ?? '');
                    setDocumentNo(p.documentNo ?? '');
                    setNote(p.note ?? '');
                    setEditing(true);
                  }}
                >
                  Muddat va izohni tuzatish
                </Button>
              ) : (
                <div className="space-y-3 rounded-(--radius-control) border border-(--color-line) p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div><Label>Tovar muddati</Label><input type="date" value={deliveryDue} min={p.date} onChange={(e) => setDeliveryDue(e.target.value)} className={FIELD} /></div>
                    <div><Label>To&apos;lov muddati</Label><input type="date" value={paymentDue} onChange={(e) => setPaymentDue(e.target.value)} className={FIELD} /></div>
                    <div className="sm:col-span-2"><Label>Shartnoma / faktura</Label><input value={documentNo} onChange={(e) => setDocumentNo(e.target.value)} className={FIELD} /></div>
                    <div className="sm:col-span-2"><Label>Izoh</Label><input value={note} onChange={(e) => setNote(e.target.value)} className={FIELD} /></div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Bekor</Button>
                    <Button size="sm" loading={busy} onClick={() => void run(() => purchasesApi.update(p.id, { deliveryDue: deliveryDue || null, paymentDue: paymentDue || null, documentNo: documentNo.trim() || null, note: note.trim() || null }), (r) => { apply(r.data); setEditing(false); })}>
                      Saqlash
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      <ConfirmDialog
        open={askCancel}
        title="Xaridni bekor qilish"
        message={p ? `${p.number} bekor qilinadi${BigInt(p.feeTiyin) > 0n ? " (birja yig'imi xarajati ham bekor bo'ladi)" : ''}. Kutilayotgan qabul yozuvlari qaytariladi.` : ''}
        confirmLabel="Bekor qilish"
        cancelLabel="Ortga"
        danger
        loading={busy}
        onConfirm={() => p && void run(() => purchasesApi.cancel(p.id), (r) => { apply(r.data); setAskCancel(false); })}
        onCancel={() => setAskCancel(false)}
      />
    </Drawer>
  );
}