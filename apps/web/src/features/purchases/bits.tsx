'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { ModdaPicker } from '@/components/shared/modda-picker';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/error-message';
import { formatSum, parseSum } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import type { WarehouseItem } from '@/features/warehouse/api';
import { KIND_LABELS, RECEIPT_LABELS, REQUEST_LABELS, STATUS_LABELS, purchasesApi, type Purchase, type PurchaseKind, type PurchaseLookups, type ReceiptStatus, type RequestStatus } from './api';

// Xarid sahifalari uchun umumiy bo'laklar

export function KindBadge({ kind }: { kind: PurchaseKind }) {
  return <Badge tone={kind === 'EXCHANGE' ? 'brand' : 'neutral'} className="whitespace-nowrap">{KIND_LABELS[kind]}</Badge>;
}

export function StatusBadge({ purchase }: { purchase: Pick<Purchase, 'status' | 'deliveryLate' | 'pendingReceipts'> }) {
  if (purchase.status === 'DELIVERED') return <Badge tone="income" className="whitespace-nowrap">{STATUS_LABELS.DELIVERED}</Badge>;
  if (purchase.status === 'CANCELLED') return <Badge tone="neutral" className="whitespace-nowrap">{STATUS_LABELS.CANCELLED}</Badge>;
  if (purchase.pendingReceipts > 0) return <Badge tone="warn" className="whitespace-nowrap">Omborchi qabul qilmoqda</Badge>;
  if (purchase.deliveryLate) return <Badge tone="expense" className="whitespace-nowrap">Kechikdi</Badge>;
  return <Badge tone="brand" className="whitespace-nowrap">{STATUS_LABELS.OPEN}</Badge>;
}

export function RequestBadge({ status }: { status: RequestStatus }) {
  const tone = status === 'DONE' ? 'income' : status === 'REJECTED' ? 'expense' : status === 'IN_PROGRESS' ? 'brand' : 'warn';
  return <Badge tone={tone} className="whitespace-nowrap">{REQUEST_LABELS[status]}</Badge>;
}

export function ReceiptBadge({ status }: { status: ReceiptStatus }) {
  const tone = status === 'ACCEPTED' ? 'income' : status === 'REJECTED' ? 'expense' : 'warn';
  return <Badge tone={tone} className="whitespace-nowrap">{RECEIPT_LABELS[status]}</Badge>;
}

/** To'langan / jami — kichik chiziq bilan */
export function PaidBar({ paid, total }: { paid: string; total: string }) {
  const t = Number(total) || 1;
  const pct = Math.max(0, Math.min(100, (Number(paid) / t) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-(--color-surface-sunken)" title={`${Math.round(pct)}% to'langan`}>
      <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-(--color-income)' : 'bg-brand-500')} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Summa maydoni: 1 250 000 ko'rinishida; qiymat — so'mda (null — bo'sh) */
export function SumInput({ value, onChange, placeholder, invalid, className, ...rest }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; invalid?: boolean; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value === null ? '' : formatSum(value));
  useEffect(() => {
    const parsed = parseSum(text);
    if ((parsed === null ? null : parsed.toNumber()) !== value) setText(value === null ? '' : formatSum(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      {...rest}
      inputMode="numeric"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        const cleaned = e.target.value.replace(/[^\d\s ]/g, '');
        const parsed = parseSum(cleaned);
        setText(parsed === null ? cleaned : formatSum(parsed));
        onChange(parsed === null ? null : parsed.toNumber());
      }}
      className={cn('money h-10 w-full rounded-(--radius-control) border bg-white px-3 text-right text-sm outline-none focus:border-brand-600', invalid ? 'border-(--color-expense)' : 'border-(--color-line-strong)', className)}
    />
  );
}

export const FIELD = 'h-10 w-full rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100';

export function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <label className="mb-1.5 block text-sm font-medium text-(--color-text)">
      {children}
      {hint && <span className="ml-1.5 text-xs font-normal text-(--color-text-faint)">{hint}</span>}
    </label>
  );
}

/** «+ Yangi tovar» oynasi: xaridchi ma'lumotnomaga yangi tovar qo'shadi */
export function NewItemDrawer({ open, initialName, lookups, onClose, onCreated }: { open: boolean; initialName: string; lookups: PurchaseLookups | null; onClose: () => void; onCreated: (item: WarehouseItem) => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'TMZ' | 'ASSET'>('TMZ');
  const [unit, setUnit] = useState('dona');
  const [group, setGroup] = useState('');
  const [category, setCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cats = (lookups?.categories ?? []).filter((c) => c.parentCode === 'WAREHOUSE' && c.code !== 'WH_POSTAL');

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setKind('TMZ');
    setUnit('dona');
    setGroup('');
    setCategory('');
    setError(null);
  }, [open, initialName]);

  useEffect(() => {
    if (!open || category) return;
    const guess = kind === 'ASSET' ? 'WH_COMPUTER' : 'WH_STATIONERY';
    if (cats.some((c) => c.code === guess)) setCategory(guess);
  }, [open, kind, category, cats]);

  async function save() {
    setError(null);
    if (name.trim().length < 2) return setError('Tovar nomini yozing');
    if (!category) return setError('Xarajat moddasini tanlang');
    setSaving(true);
    try {
      const r = await purchasesApi.createItem({ name: name.trim(), unit, kind, group: group.trim() || null, categoryCode: category });
      onCreated(r.data);
    } catch (e) {
      setError(errorMessage(e, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Yangi tovar"
      description="Tovarlar ro'yxatiga qo'shiladi — omborchi ham shuni ko'radi"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button data-save loading={saving} onClick={() => void save()}>Qo&apos;shish</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Nomi" value={name} onChange={(e) => setName(e.target.value)} placeholder="Masalan: Qog'oz A4, 500 varaq" />
        <div className="grid grid-cols-2 gap-3">
          <Select label="Turi" value={kind} onChange={(e) => setKind(e.target.value as 'TMZ' | 'ASSET')} options={[{ value: 'TMZ', label: 'TMZ (sarflanadi)' }, { value: 'ASSET', label: 'Asosiy vosita' }]} />
          <Select label="O'lchov" value={unit} onChange={(e) => setUnit(e.target.value)} options={(lookups?.units ?? ['dona']).map((u) => ({ value: u, label: u }))} />
        </div>
        {/* Yangi modda — «Ombor» guruhiga (shu ro'yxat faqat ombor moddalari) */}
        <ModdaPicker label="Xarajat moddasi" value={category} onChange={setCategory} placeholder="Tanlang" options={cats.map((c) => ({ code: c.code, label: c.label, group: 'Ombor' }))} createGroups={[{ code: 'WAREHOUSE', label: 'Ombor' }]} hint="Tovar omborga kirganda shu moddaga yoziladi" />
        <Input label="Guruh (ixtiyoriy)" value={group} onChange={(e) => setGroup(e.target.value)} list="xr-groups" placeholder="Kanselyariya, Mebel, ..." />
        <datalist id="xr-groups">{(lookups?.groups ?? []).map((g) => <option key={g} value={g} />)}</datalist>
        {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
      </div>
    </Drawer>
  );
}