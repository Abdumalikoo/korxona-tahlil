'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { IconPlus, IconTrash } from '@/components/ui/icons';
import { LoadingState } from '@/components/ui/states';
import { ItemCombobox } from '@/features/warehouse/entry/item-combobox';
import type { WarehouseItem } from '@/features/warehouse/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatSum, formatTiyin, sumToTiyin, todayInput } from '@/lib/format';
import { useSaveShortcut } from '@/lib/use-save-shortcut';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { KIND_LABELS, purchasesApi, type Purchase, type PurchaseKind, type PurchaseRequest } from './api';
import { FIELD, KindBadge, Label, NewItemDrawer, SumInput } from './bits';

// ═══════════════════════════════════════════════════════════
// Xarid yozish: birja bitimi yoki oddiy xarid.
// Yetkazuvchi (ro'yxatdan yoki yangi nom), hujjat, muddatlar, tovar qatorlari. Birja: lot, birja yig'imi.
// Ariza tanlansa — qatorlar o'zi to'ladi. Saqlangach: «Tovar keldi» sahifasiga o'tish mumkin.
// ═══════════════════════════════════════════════════════════

interface Line {
  key: number;
  itemId: string;
  qty: string;
  price: number | null;
  search?: string;
}

let seq = 0;
const newLine = (p: Partial<Line> = {}): Line => ({ key: ++seq, itemId: '', qty: '', price: null, ...p });

const qtyNum = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export function PurchaseEntry({ kind }: { kind: PurchaseKind }) {
  const { ready, canWrite } = useAuth();
  const params = useSearchParams();
  const lookups = useAsync(() => purchasesApi.lookups(), []);
  const itemsQ = useAsync(() => purchasesApi.items(), []);
  const requestsQ = useAsync(() => purchasesApi.requests('active'), []);
  const [extraItems, setExtraItems] = useState<WarehouseItem[]>([]);

  const [supplier, setSupplier] = useState('');
  const [date, setDate] = useState(todayInput());
  const [lotNo, setLotNo] = useState('');
  const [exchange, setExchange] = useState('');
  const [documentNo, setDocumentNo] = useState('');
  const [deliveryDue, setDeliveryDue] = useState('');
  const [paymentDue, setPaymentDue] = useState('');
  const [fee, setFee] = useState<number | null>(null);
  const [requestId, setRequestId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Purchase | null>(null);
  const [newItem, setNewItem] = useState<{ lineKey: number; name: string } | null>(null);
  const [touched, setTouched] = useState(false);

  const lk = lookups.data?.data ?? null;
  const items = useMemo(() => {
    const base = itemsQ.data?.data ?? [];
    return [...base, ...extraItems.filter((e) => !base.some((b) => b.id === e.id))].filter((i) => i.isActive);
  }, [itemsQ.data, extraItems]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const requests = requestsQ.data?.data ?? [];
  const exchangeKind = kind === 'EXCHANGE';

  // Ariza tanlanganda qatorlar o'zi to'ladi
  const applyRequest = (r: PurchaseRequest) => {
    const rows = r.lines.map((l) => {
      const found = (l.itemId && byId.get(l.itemId)) || items.find((i) => i.name.toLowerCase() === l.name.toLowerCase());
      return newLine({ itemId: found?.id ?? '', qty: String(l.qty), search: found ? undefined : l.name, price: found?.lastPriceTiyin ? Number(found.lastPriceTiyin) / 100 : null });
    });
    setLines(rows.length ? rows : [newLine()]);
    setNote((n) => n || `Ariza ${r.number}: ${r.title}`);
    setTouched(true);
  };

  useEffect(() => {
    const id = params.get('request');
    if (!id || requestId || requests.length === 0 || items.length === 0) return;
    const r = requests.find((x) => x.id === id);
    if (r) {
      setRequestId(r.id);
      applyRequest(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, requests, items]);

  const setLine = (key: number, patch: Partial<Line>) => {
    setTouched(true);
    setLines((list) => list.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const pickItem = (key: number, item: WarehouseItem | null) =>
    setLine(key, { itemId: item?.id ?? '', search: undefined, ...(item && item.lastPriceTiyin ? { price: Number(item.lastPriceTiyin) / 100 } : {}) });

  const lineTotal = (l: Line) => (l.price !== null && qtyNum(l.qty) > 0 ? Math.round(qtyNum(l.qty) * l.price * 100) : 0);
  const sum = lines.reduce((a, l) => a + lineTotal(l), 0);
  const feeTiyin = exchangeKind && fee ? sumToTiyin(fee) : 0;

  const errors = useMemo(() => {
    const out: Record<number, string> = {};
    for (const l of lines) {
      const item = byId.get(l.itemId);
      if (!l.itemId && !l.qty && l.price === null) continue;
      if (!item) out[l.key] = 'Tovarni tanlang';
      else if (qtyNum(l.qty) <= 0) out[l.key] = 'Miqdorni yozing';
      else if (item.kind === 'ASSET' && !Number.isInteger(qtyNum(l.qty))) out[l.key] = 'Asosiy vosita soni butun bo\'lsin';
      else if (l.price === null) out[l.key] = 'Narxni yozing';
    }
    return out;
  }, [lines, byId]);

  const filled = lines.filter((l) => l.itemId || l.qty || l.price !== null);

  async function save() {
    setError(null);
    if (!supplier.trim()) return setError('Yetkazuvchini tanlang yoki nomini yozing');
    if (exchangeKind && !lotNo.trim()) return setError('Birja bitimi uchun lot raqamini yozing');
    if (filled.length === 0) return setError("Kamida bitta tovar qatorini to'ldiring");
    if (Object.keys(errors).length) return setError(Object.values(errors)[0]!);
    const match = lk?.suppliers.find((s) => s.name.toLowerCase() === supplier.trim().toLowerCase());
    setSaving(true);
    try {
      const r = await purchasesApi.create({
        kind,
        date,
        supplierId: match?.id ?? null,
        supplierName: match ? null : supplier.trim(),
        lotNo: exchangeKind ? lotNo.trim() : null,
        exchange: exchangeKind ? exchange.trim() || null : null,
        documentNo: documentNo.trim() || null,
        deliveryDue: deliveryDue || null,
        paymentDue: paymentDue || null,
        requestId: requestId || null,
        feeTiyin,
        note: note.trim() || null,
        lines: filled.map((l) => ({ itemId: l.itemId, qty: qtyNum(l.qty), priceTiyin: Math.round((l.price ?? 0) * 100) })),
      });
      setSaved(r.data);
      setTouched(false);
    } catch (e) {
      setError(errorMessage(e, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  }

  useSaveShortcut(() => void save(), undefined, !saved);

  useEffect(() => {
    if (!touched) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [touched]);

  const reset = () => {
    setSaved(null);
    setSupplier('');
    setLotNo('');
    setExchange('');
    setDocumentNo('');
    setDeliveryDue('');
    setPaymentDue('');
    setFee(null);
    setRequestId('');
    setNote('');
    setLines([newLine()]);
    setError(null);
    setTouched(false);
  };

  const title = exchangeKind ? 'Birja xaridi' : 'Oddiy xarid';
  if (!ready) return <LoadingState />;
  if (!canWrite('/xarid')) {
    return (
      <div className="p-6">
        <Card className="p-6 text-sm text-(--color-text-muted)">Xarid yozish — faqat administrator va xaridchi uchun.</Card>
      </div>
    );
  }

  if (saved) {
    return (
      <>
        <PageHeader title={title} description="Xarid saqlandi" />
        <div className="mx-auto max-w-3xl p-4 md:p-6">
          <Card className="overflow-hidden">
            <div className="bg-(--color-income-soft) px-6 py-6 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-(--color-income) text-2xl text-white">✓</div>
              <p className="mt-3 text-lg font-bold text-heading">
                {KIND_LABELS[saved.kind]} <span className="font-mono">{saved.number}</span> saqlandi
              </p>
              <p className="mt-1 text-sm text-(--color-text-muted)">
                {saved.supplierName} · {saved.lines.length} qator · <b className="money text-heading">{formatTiyin(saved.totalTiyin)} so&apos;m</b>
              </p>
              {BigInt(saved.feeTiyin) > 0n && <p className="mt-1 text-xs text-(--color-text-muted)">Birja yig&apos;imi {formatTiyin(saved.feeTiyin)} so&apos;m Xarajatlarga yozildi.</p>}
              <p className="mt-1 text-xs text-(--color-text-muted)">Tovar omborga kelganda «Tovar keldi» orqali omborchiga yuborasiz — qoldiq va xarajat o&apos;shanda yangilanadi.</p>
            </div>
            <div className="grid gap-3 p-6 sm:grid-cols-2">
              <Link href="/xarid/xaridlar" className="inline-flex h-11 items-center justify-center rounded-(--radius-control) bg-brand-600 px-5 text-base font-medium text-white shadow-sm hover:bg-brand-700">
                Xaridlar ro&apos;yxati (to&apos;lov yozish)
              </Link>
              <Link href={`/xarid/qabul?purchase=${saved.id}`} className="inline-flex h-11 items-center justify-center rounded-(--radius-control) border border-(--color-line-strong) bg-white px-5 text-base text-(--color-text) hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
                Tovar keldi
              </Link>
              <Button size="lg" variant="secondary" onClick={reset}>
                <IconPlus className="size-4" />
                Yana xarid yozish
              </Button>
              <Link href="/xarid/ish-stoli" className="inline-flex h-11 items-center justify-center rounded-(--radius-control) border border-(--color-line-strong) bg-white px-5 text-base text-(--color-text) hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
                Ish stoliga
              </Link>
            </div>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={title}
        description={exchangeKind ? 'Birja bitimi: lot, sotuvchi, tovar, narx, birja yig\'imi' : "Do'kon yoki to'g'ridan-to'g'ri xarid: shartnoma yoki faktura bilan"}
        actions={
          <Button size="sm" data-save loading={saving} onClick={() => void save()}>
            Saqlash <kbd className="ml-1 rounded bg-white/20 px-1.5 text-[11px]">Ctrl+S</kbd>
          </Button>
        }
      />

      <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
        {requests.length > 0 && (
          <Card className="p-4">
            <Label hint="(ixtiyoriy)">Ariza bo&apos;yicha xarid</Label>
            <select
              value={requestId}
              onChange={(e) => {
                setRequestId(e.target.value);
                const r = requests.find((x) => x.id === e.target.value);
                if (r) applyRequest(r);
              }}
              className={FIELD}
            >
              <option value="">— arizasiz —</option>
              {requests.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.number} · {r.title}
                  {r.departmentName ? ` · ${r.departmentName}` : ''}
                </option>
              ))}
            </select>
          </Card>
        )}

        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <KindBadge kind={kind} />
            <h2 className="text-sm font-semibold text-heading">Yetkazuvchi va hujjat</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label hint="(ro'yxatdan tanlang yoki yangi nom yozing — o'zi qo'shiladi)">Yetkazuvchi (sotuvchi)</Label>
              <input list="xr-suppliers" value={supplier} onChange={(e) => { setSupplier(e.target.value); setTouched(true); }} placeholder={'"Ofis Market" MChJ'} className={FIELD} autoComplete="off" />
              <datalist id="xr-suppliers">{(lk?.suppliers ?? []).map((s) => <option key={s.id} value={s.name} />)}</datalist>
            </div>
            <div>
              <Label>Sana</Label>
              <input type="date" value={date} max={todayInput()} onChange={(e) => setDate(e.target.value)} className={FIELD} />
            </div>
            <div>
              <Label>{exchangeKind ? 'Shartnoma raqami' : 'Shartnoma yoki faktura raqami'}</Label>
              <input value={documentNo} onChange={(e) => setDocumentNo(e.target.value)} placeholder="SH-15" className={FIELD} />
            </div>
            {exchangeKind && (
              <>
                <div>
                  <Label>Lot raqami</Label>
                  <input value={lotNo} onChange={(e) => setLotNo(e.target.value)} placeholder="L-7788" className={cn(FIELD, 'money')} />
                </div>
                <div>
                  <Label hint="(ixtiyoriy)">Birja</Label>
                  <input value={exchange} onChange={(e) => setExchange(e.target.value)} placeholder="Uzex" className={FIELD} />
                </div>
              </>
            )}
            <div>
              <Label hint="(ixtiyoriy)">Tovar qachongacha keladi</Label>
              <input type="date" value={deliveryDue} min={date} onChange={(e) => setDeliveryDue(e.target.value)} className={FIELD} />
            </div>
            <div>
              <Label hint="(ixtiyoriy)">To&apos;lov muddati</Label>
              <input type="date" value={paymentDue} onChange={(e) => setPaymentDue(e.target.value)} className={FIELD} />
            </div>
            {exchangeKind && (
              <div>
                <Label hint="(so'm, alohida xarajat bo'ladi)">Birja yig&apos;imi</Label>
                <SumInput value={fee} onChange={setFee} placeholder="0" />
              </div>
            )}
          </div>
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-heading">Tovarlar</h2>
            <Button size="sm" variant="ghost" onClick={() => setLines((l) => [...l, newLine()])}>
              <IconPlus className="size-4" />
              Qator
            </Button>
          </div>
          <div className="hidden grid-cols-[1.5rem_minmax(0,1fr)_8rem_9rem_9rem_2rem] gap-2 px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted) md:grid">
            <span>№</span>
            <span>Tovar</span>
            <span className="text-right">Miqdor</span>
            <span className="text-right">Narx, so&apos;m</span>
            <span className="text-right">Summa</span>
            <span />
          </div>
          <div className="space-y-2">
            {lines.map((l, index) => {
              const item = byId.get(l.itemId);
              const err = errors[l.key];
              return (
                <div key={l.key} className={cn('rounded-(--radius-control) p-1', err && 'bg-(--color-expense-soft)/50')}>
                  <div className="grid grid-cols-[1.5rem_minmax(0,1fr)_2rem] gap-2 md:grid-cols-[1.5rem_minmax(0,1fr)_8rem_9rem_9rem_2rem] md:items-start">
                    <span className="pt-2.5 text-xs text-(--color-text-faint)">{index + 1}.</span>
                    <ItemCombobox items={items} value={l.itemId} initialSearch={l.search} onPick={(it) => pickItem(l.key, it)} onCreate={(name) => setNewItem({ lineKey: l.key, name })} lineKey={l.key} invalid={Boolean(err) && !item} />
                    <div className="col-start-2 grid grid-cols-3 gap-2 md:col-start-auto md:contents">
                      <div className="relative">
                        <input
                          data-line={l.key}
                          data-field="qty"
                          inputMode="decimal"
                          value={l.qty}
                          onChange={(e) => setLine(l.key, { qty: e.target.value.replace(/[^\d.,]/g, '') })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              document.querySelector<HTMLInputElement>(`[data-line="${l.key}"][data-field="price"]`)?.focus();
                            }
                          }}
                          placeholder="Miqdor"
                          className={cn('h-10 w-full rounded-(--radius-control) border bg-white px-3 pr-14 text-right text-sm outline-none focus:border-brand-600', err && item ? 'border-(--color-expense)' : 'border-(--color-line-strong)')}
                        />
                        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-(--color-text-muted)">{item?.unit}</span>
                      </div>
                      <SumInput
                        data-line={l.key}
                        data-field="price"
                        value={l.price}
                        onChange={(v) => setLine(l.key, { price: v })}
                        placeholder="Narx"
                        invalid={Boolean(err) && Boolean(item) && l.price === null}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (index === lines.length - 1) {
                              const k = newLine();
                              setLines((list) => [...list, k]);
                              setTimeout(() => document.querySelector<HTMLInputElement>(`[data-line="${k.key}"][data-field="item"]`)?.focus(), 0);
                            }
                          }
                        }}
                      />
                      <div className="money flex h-10 items-center justify-end text-sm font-semibold text-heading">{lineTotal(l) ? formatTiyin(lineTotal(l)) : ''}</div>
                    </div>
                    <button type="button" onClick={() => setLines((list) => (list.length > 1 ? list.filter((x) => x.key !== l.key) : [newLine()]))} className="flex h-10 items-center justify-center rounded text-(--color-text-faint) hover:bg-(--color-surface-sunken) hover:text-(--color-expense)" aria-label="Qatorni o'chirish">
                      <IconTrash className="size-4" />
                    </button>
                  </div>
                  {(err || (item && item.lastPriceTiyin)) && (
                    <p className={cn('ml-8 mt-1 text-xs', err ? 'text-(--color-expense)' : 'text-(--color-text-muted)')}>
                      {err ?? `Oxirgi narx ${formatTiyin(item!.lastPriceTiyin!)} so'm`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex flex-col items-end gap-1 border-t border-(--color-line) pt-3 text-sm">
            <p className="text-(--color-text-muted)">
              Tovarlar: <b className="money text-heading">{formatTiyin(sum)}</b> so&apos;m
            </p>
            {feeTiyin > 0 && (
              <p className="text-(--color-text-muted)">
                Birja yig&apos;imi: <b className="money text-heading">{formatSum(fee ?? 0)}</b> so&apos;m
              </p>
            )}
            <p>
              Jami: <b className="money text-lg text-heading">{formatTiyin(sum + feeTiyin)}</b> so&apos;m
            </p>
          </div>
        </Card>

        <Card className="p-4">
          <Label hint="(ixtiyoriy)">Izoh</Label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} className="w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 py-2 text-sm outline-none focus:border-brand-600" />
        </Card>

        {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-4 py-3 text-sm text-(--color-expense)">{error}</p>}
        <div className="flex justify-end">
          <Button size="lg" data-save loading={saving} onClick={() => void save()}>
            Saqlash
          </Button>
        </div>
      </div>

      <NewItemDrawer
        open={Boolean(newItem)}
        initialName={newItem?.name ?? ''}
        lookups={lk}
        onClose={() => setNewItem(null)}
        onCreated={(item) => {
          setExtraItems((l) => [...l, item]);
          if (newItem) pickItem(newItem.lineKey, item);
          setNewItem(null);
        }}
      />
    </>
  );
}