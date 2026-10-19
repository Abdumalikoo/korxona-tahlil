'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/error-message';
import { todayInput } from '@/lib/format';
import { useSaveShortcut } from '@/lib/use-save-shortcut';
import { useAsync } from '@/lib/use-async';
import { purchasesApi, type PurchaseRequest } from './api';
import { FIELD, Label } from './bits';

interface Row { key: number; name: string; qty: string; unit: string }

/** Xarid › Ariza yozish: bo'lim nima so'ragani (xaridchi yozib qo'yadi) */
export function RequestEntry() {
  const lookups = useAsync(() => purchasesApi.lookups(), []);
  const lk = lookups.data?.data;
  const [date, setDate] = useState(todayInput());
  const [departmentId, setDepartmentId] = useState('');
  const [requester, setRequester] = useState('');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([{ key: 1, name: '', qty: '', unit: 'dona' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<PurchaseRequest | null>(null);

  const setRow = (key: number, p: Partial<Row>) => setRows((s) => s.map((r) => (r.key === key ? { ...r, ...p } : r)));

  async function save() {
    if (saving || saved) return;
    setError(null);
    if (title.trim().length < 3) return setError('Ariza nomini yozing (nima uchun kerak)');
    const lines = rows.filter((r) => r.name.trim() || r.qty.trim());
    if (lines.length === 0) return setError('Kamida bitta tovar yozing');
    const out: { name: string; qty: number; unit: string; itemId: string | null }[] = [];
    for (const r of lines) {
      const q = Number(r.qty.replace(',', '.'));
      if (!r.name.trim()) return setError('Tovar nomi bo‘sh qolgan');
      if (!Number.isFinite(q) || q <= 0) return setError(`«${r.name}»: miqdorni yozing`);
      out.push({ name: r.name.trim(), qty: q, unit: r.unit, itemId: null });
    }
    setSaving(true);
    try {
      const r = await purchasesApi.createRequest({ date, departmentId: departmentId || null, requester: requester.trim() || null, title: title.trim(), note: note.trim() || null, lines: out });
      setSaved(r.data);
    } catch (e) {
      setError(errorMessage(e, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  }
  useSaveShortcut(() => void save());

  if (saved) {
    return (
      <>
        <PageHeader title="Ariza yozish" />
        <div className="mx-auto max-w-xl p-4 md:p-6">
          <Card className="p-6 text-center">
            <p className="text-lg font-bold text-heading">{saved.number} yozildi</p>
            <p className="mt-1 text-sm text-(--color-text-muted)">{saved.title}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link href="/xarid/arizalar" className="inline-flex h-10 items-center rounded-(--radius-control) bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700">Arizalar</Link>
              <Link href={`/xarid/birja?request=${saved.id}`} className="inline-flex h-10 items-center rounded-(--radius-control) border border-(--color-line-strong) bg-white px-4 text-sm hover:bg-brand-50">Birjadan xarid qilish</Link>
              <Link href={`/xarid/oddiy?request=${saved.id}`} className="inline-flex h-10 items-center rounded-(--radius-control) border border-(--color-line-strong) bg-white px-4 text-sm hover:bg-brand-50">Oddiy xarid</Link>
              <a href="/xarid/ariza" className="inline-flex h-10 items-center rounded-(--radius-control) px-4 text-sm text-(--color-text-muted) hover:bg-(--color-surface-muted)">Yana ariza</a>
            </div>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Ariza yozish" description="Bo'lim so'ragan tovarlar — keyin shundan xarid yoziladi" actions={<Button data-save loading={saving} onClick={() => void save()}>Saqlash</Button>} />
      <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
        <Card className="space-y-4 p-4">
          <Input label="Ariza nomi" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Masalan: Buxgalteriya uchun kanselyariya" />
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label>Bo&apos;lim</Label>
              <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={FIELD}>
                <option value="">— ko‘rsatilmagan —</option>
                {(lk?.departments ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <Input label="Kim so'ragan" value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="Ism" />
            <Input label="Sana" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </Card>

        <Card className="p-4">
          <p className="mb-3 text-sm font-semibold text-heading">Nima kerak</p>
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.key} className="grid grid-cols-[1fr_5.5rem_6rem_2.25rem] gap-2">
                <input value={r.name} onChange={(e) => setRow(r.key, { name: e.target.value })} placeholder="Tovar nomi" className={FIELD} />
                <input value={r.qty} inputMode="decimal" onChange={(e) => setRow(r.key, { qty: e.target.value.replace(/[^\d.,]/g, '') })} placeholder="Soni" className={`${FIELD} money text-right`} />
                <select value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value })} className={FIELD}>
                  {(lk?.units ?? ['dona']).map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <button type="button" aria-label="Qatorni o'chirish" disabled={rows.length === 1} onClick={() => setRows((s) => s.filter((x) => x.key !== r.key))} className="rounded-(--radius-control) text-lg text-(--color-text-faint) hover:bg-(--color-expense-soft) hover:text-(--color-expense) disabled:opacity-30">×</button>
              </div>
            ))}
          </div>
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => setRows((s) => [...s, { key: Math.max(...s.map((x) => x.key)) + 1, name: '', qty: '', unit: 'dona' }])}>+ Qator</Button>
        </Card>

        <Card className="p-4">
          <Label hint="ixtiyoriy">Izoh</Label>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={`${FIELD} h-auto py-2`} />
        </Card>
        {error && <p className="rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
      </div>
    </>
  );
}