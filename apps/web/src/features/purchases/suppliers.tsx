'use client';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { IconSearch } from '@/components/ui/icons';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { purchasesApi, type Supplier } from './api';

/** Xarid › Yetkazuvchilar: kim bilan ishlaymiz, nechta xarid, qancha qarz */
export function SuppliersPage() {
  const { canWrite } = useAuth();
  const writable = canWrite('/xarid');
  const list = useAsync(() => purchasesApi.suppliers(), []);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [showOff, setShowOff] = useState(false);

  const rows = (list.data?.data ?? []).filter((s) => (showOff || s.isActive) && s.name.toLowerCase().includes(search.trim().toLowerCase()));
  const debt = rows.reduce((a, s) => a + BigInt(s.debtTiyin), 0n);

  return (
    <>
      <PageHeader title="Yetkazuvchilar" description="Tovar oladigan korxonalar va ular oldidagi qarz" actions={writable && <Button size="sm" onClick={() => setEditing('new')}>+ Yetkazuvchi</Button>} />
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-(--color-text-faint)" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nomi bo'yicha" className="h-9 w-64 rounded-(--radius-control) border border-(--color-line-strong) bg-white pl-8 pr-3 text-sm outline-none focus:border-brand-600" />
          </div>
          <label className="flex items-center gap-2 text-sm text-(--color-text-muted)"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} /> O&apos;chirilganlar ham</label>
        </div>
        <Card className="overflow-hidden">
          {list.loading && !list.data ? (
            <TableSkeleton rows={5} cols={5} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : rows.length === 0 ? (
            <EmptyState title="Yetkazuvchi yo'q" description="Xarid yozganda yangi nom o'zi qo'shiladi, yoki shu yerda qo'shing" />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[46rem] text-sm">
                  <thead className="bg-(--color-surface-muted) text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Yetkazuvchi</th>
                      <th className="px-4 py-2.5 text-left">Aloqa</th>
                      <th className="px-4 py-2.5 text-right">Xaridlar</th>
                      <th className="px-4 py-2.5 text-right">Jami</th>
                      <th className="px-4 py-2.5 text-right">Qarz</th>
                      <th className="px-4 py-2.5 text-left">Oxirgi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {rows.map((s) => (
                      <tr key={s.id} onClick={() => writable && setEditing(s)} className={cn(writable && 'cursor-pointer hover:bg-brand-50/50', !s.isActive && 'opacity-60')}>
                        <td className="px-4 py-3 font-medium">{s.name} {!s.isActive && <Badge tone="neutral">o‘chirilgan</Badge>}</td>
                        <td className="px-4 py-3 text-xs text-(--color-text-muted)">{[s.phone, s.inn && `STIR ${s.inn}`].filter(Boolean).join(' · ') || '—'}</td>
                        <td className="money px-4 py-3 text-right">{s.purchases}</td>
                        <td className="money px-4 py-3 text-right">{formatTiyin(s.totalTiyin)}</td>
                        <td className={cn('money px-4 py-3 text-right font-semibold', BigInt(s.debtTiyin) > 0n && 'text-(--color-expense)')}>{BigInt(s.debtTiyin) > 0n ? formatTiyin(s.debtTiyin) : '—'}</td>
                        <td className="px-4 py-3 text-xs text-(--color-text-muted)">{s.lastDate ? formatDate(s.lastDate) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-6 border-t border-(--color-line) bg-(--color-surface-muted) px-4 py-2.5 text-sm">
                <span className="text-(--color-text-muted)">{rows.length} ta</span>
                {debt > 0n && <span>Jami qarz: <b className="money text-(--color-expense)">{formatTiyin(debt)}</b> so&apos;m</span>}
              </div>
            </>
          )}
        </Card>
      </div>
      <SupplierDrawer value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />
    </>
  );
}

function SupplierDrawer({ value, onClose, onSaved }: { value: Supplier | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const open = value !== null;
  const cur = value && value !== 'new' ? value : null;
  const [name, setName] = useState('');
  const [inn, setInn] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(cur?.name ?? '');
    setInn(cur?.inn ?? '');
    setPhone(cur?.phone ?? '');
    setNote(cur?.note ?? '');
    setActive(cur?.isActive ?? true);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cur?.id]);

  async function save() {
    setError(null);
    if (name.trim().length < 2) return setError('Nomini yozing');
    setSaving(true);
    try {
      const body = { name: name.trim(), inn: inn.trim() || null, phone: phone.trim() || null, note: note.trim() || null };
      if (cur) await purchasesApi.updateSupplier(cur.id, { ...body, isActive: active });
      else await purchasesApi.createSupplier(body);
      onSaved();
    } catch (e) {
      setError(errorMessage(e, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  }

  /** Butunlay o'chirish — faqat bitta ham xaridi bo'lmasa (aks holda server rad etadi: nofaol qiling) */
  async function remove() {
    if (!cur || !window.confirm(`«${cur.name}» butunlay o'chirilsinmi? Xaridi bo'lsa, o'chirilmaydi — «Faol» belgisini olib tashlang.`)) return;
    setError(null);
    setRemoving(true);
    try {
      await purchasesApi.removeSupplier(cur.id);
      onSaved();
    } catch (e) {
      setError(errorMessage(e, "O'chirib bo'lmadi"));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={cur ? 'Yetkazuvchini tahrirlash' : 'Yangi yetkazuvchi'}
      footer={
        <>
          {cur && (
            <Button variant="ghost" className="mr-auto text-(--color-expense) hover:bg-red-50" loading={removing} onClick={() => void remove()}>
              O&apos;chirish
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>Bekor</Button>
          <Button data-save loading={saving} onClick={() => void save()}>Saqlash</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Nomi" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="STIR (INN)" value={inn} onChange={(e) => setInn(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          <Input label="Telefon" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+998 ..." />
        </div>
        <Input label="Izoh" value={note} onChange={(e) => setNote(e.target.value)} />
        {cur && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Faol (xarid yozishda ko&apos;rinadi)</label>}
        {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
      </div>
    </Drawer>
  );
}