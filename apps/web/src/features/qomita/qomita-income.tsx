'use client';

import { ReportCard, RTable, TableNote, Td, Th, sum } from '@/components/report/report';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { errorMessage } from '@/lib/error-message';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { qomitaApi, type QomitaConfigView } from './api';

// Qo'mita ajratmasi (daromad): qo'lda kiritish va bank ko'chirmasidagi kirimdan yozish.

type ToastState = { message: string; tone: 'success' | 'error' } | null;

/** Bo'limlar: avval qoplanadiganlar (3802 sozlamasidagi), keyin qolganlari */
function depOptions(config: QomitaConfigView) {
  const set = new Set(config.items.map((i) => i.departmentId));
  return [...config.departments.filter((d) => set.has(d.id)), ...config.departments.filter((d) => !set.has(d.id))].map((d) => ({ value: d.id, label: d.name }));
}

/** Qo'lda ajratma: qaysi bo'lim uchun, qaysi oy uchun, summa (so'm) */
export function QomitaIncomeDrawer({
  config,
  departmentId,
  defaultPeriod,
  onClose,
  onSaved,
}: {
  config: QomitaConfigView;
  departmentId: string;
  defaultPeriod: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [dep, setDep] = useState(departmentId || config.items[0]?.departmentId || config.departments[0]?.id || '');
  const [period, setPeriod] = useState(defaultPeriod);
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const depName = config.departments.find((d) => d.id === dep)?.name ?? '';

  async function save() {
    setError(null);
    if (!dep) return setError("Bo'limni tanlang");
    if (!/^\d{4}-\d{2}$/.test(period)) return setError('Oyni tanlang');
    if (!amount.trim()) return setError('Summani kiriting');
    setSaving(true);
    try {
      const r = (await qomitaApi.addIncome({ departmentId: dep, period, date: date || undefined, amount: amount.replace(/\s+/g, ''), description: description.trim() || undefined })).data;
      onSaved(`Ajratma yozildi: ${depName} — ${sum(Number(r.amountTiyin))} so'm`);
    } catch (err) {
      setError(errorMessage(err, "Saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Qo'mita ajratmasi"
      description="Qo'mita shu bo'lim xarajatini qoplash uchun ajratgan pul — Qo'mita daromadi bo'lib yoziladi"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Bekor
          </Button>
          <Button data-save onClick={() => void save()} loading={saving}>
            Saqlash
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Select label="Qaysi bo'lim uchun" required value={dep} onChange={(e) => setDep(e.target.value)} options={depOptions(config)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Qaysi oy uchun" required type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
          <Input label="Sana" type="date" value={date} onChange={(e) => setDate(e.target.value)} hint="Bo'sh — oy oxiri" />
        </div>
        <Input label="Summa" required money inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} suffix="so'm" placeholder="0" />
        <Input label="Izoh" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Masalan: sentabr oyi ish haqi uchun ajratma" maxLength={500} />
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-(--color-expense)">{error}</p>}
        <p className="text-xs text-(--color-text-muted)">
          Bankka tushgan pul bo&apos;lsa — sahifadagi «Bank ko&apos;chirmasidan yuklash» kartasi orqali yozing (ikki marta kiritmang). Daromad turi: «Qo&apos;mita ajratmasi: {depName}».
        </p>
      </div>
    </Drawer>
  );
}

/** Bank ko'chirmasidagi Qo'mitadan kelgan (yo'naltirilmagan) kirimlar → bo'lim ajratmasi */
export function QomitaBankCard({ config, isAdmin, onRouted, setToast }: { config: QomitaConfigView; isAdmin: boolean; onRouted: () => void; setToast: (t: ToastState) => void }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const res = useAsync(() => qomitaApi.bank(query || undefined).then((r) => r.data), [query]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [dep, setDep] = useState(config.items[0]?.departmentId ?? config.departments[0]?.id ?? '');
  const [skipDup, setSkipDup] = useState(false);
  const [busy, setBusy] = useState(false);
  const items = res.data?.items ?? [];
  const key = (a: string, r: string) => `${a}|${r}`;
  const chosen = items.filter((x) => picked.has(key(x.account, x.rowId)));
  const chosenSum = chosen.reduce((s, x) => s + Number(x.amountTiyin), 0);
  const toggle = (k: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  async function route() {
    if (!chosen.length || !dep) return;
    setBusy(true);
    try {
      const r = (await qomitaApi.bankRoute({ items: chosen.map((x) => ({ account: x.account, rowId: x.rowId })), departmentId: dep, skipDuplicates: skipDup || undefined })).data;
      const name = config.departments.find((d) => d.id === dep)?.name ?? '';
      setToast({ message: `${r.count} ta kirim ${name} ajratmasi bo'lib yozildi: ${sum(Number(r.totalTiyin))} so'm${r.skipped ? ` (${r.skipped} tasi o'tkazib yuborildi)` : ''}`, tone: 'success' });
      setPicked(new Set());
      res.reload();
      onRouted();
    } catch (err) {
      setToast({ message: errorMessage(err, "Yozib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ReportCard
      title="Bankdan: Qo'mitadan kelgan kirimlar"
      badge={res.data ? `${res.data.total} ta yo'naltirilmagan${query ? ` · «${query}»` : ''}` : undefined}
      actions={
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPicked(new Set());
            setQuery(q.trim());
          }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Boshqa kirimni qidirish: to'lovchi, izoh…"
            className="h-8 w-60 rounded-md border border-(--color-line-strong) bg-white px-2 text-xs"
          />
          <Button size="sm" variant="secondary" type="submit">
            Qidirish
          </Button>
          {query && (
            <Button
              size="sm"
              variant="ghost"
              type="button"
              onClick={() => {
                setQ('');
                setQuery('');
                setPicked(new Set());
              }}
            >
              Qo&apos;mitaniki
            </Button>
          )}
        </form>
      }
    >
      <div className="p-4">
        {res.error ? (
          <p className="text-sm text-(--color-expense)">{res.error}</p>
        ) : !res.data ? (
          <p className="text-sm text-(--color-text-muted)">Yuklanmoqda…</p>
        ) : !items.length ? (
          <p className="text-sm text-(--color-text-muted)">
            {query ? 'Topilmadi.' : "Bank ko'chirmasida Qo'mitadan kelgan yo'naltirilmagan kirim yo'q (to'lovchi yoki izohida «qo'mita» / «комитет» so'zi bo'lsa — shu yerda chiqadi)."}
          </p>
        ) : (
          <>
            <RTable minWidth={880}>
              <thead>
                <tr>
                  <Th className="w-8" />
                  <Th>Sana</Th>
                  <Th className="text-left">To&apos;lovchi</Th>
                  <Th className="min-w-72 text-left">Izoh (bankdagi)</Th>
                  <Th>Summa</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => {
                  const k = key(x.account, x.rowId);
                  const on = picked.has(k);
                  return (
                    <tr key={k} onClick={isAdmin ? () => toggle(k) : undefined} className={cn(isAdmin && 'cursor-pointer', on ? 'bg-brand-50' : 'hover:bg-[#f7f9fc]')}>
                      <Td>{isAdmin && <input type="checkbox" checked={on} onChange={() => toggle(k)} onClick={(e) => e.stopPropagation()} className="size-3.5" />}</Td>
                      <Td className="whitespace-nowrap text-xs">
                        {x.docDate.split('-').reverse().join('.')}
                        {x.docNo && <span className="block text-[10.5px] text-(--color-text-faint)">№ {x.docNo}</span>}
                      </Td>
                      <Td className="text-left text-xs">
                        <span className="font-medium text-heading">{x.payer || '—'}</span>
                        <span className="block text-[10.5px] text-(--color-text-faint)">{x.accountLabel}</span>
                      </Td>
                      <Td className="text-left text-xs text-(--color-text-muted)">{x.purpose}</Td>
                      <Td className="whitespace-nowrap font-semibold text-(--color-income)">{sum(Number(x.amountTiyin))}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </RTable>
            {isAdmin && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl bg-[#f7f9fc] px-3 py-2.5">
                <span className="text-sm text-heading">
                  Tanlandi: <b>{chosen.length}</b> ta · <b>{sum(chosenSum)}</b> so&apos;m →
                </span>
                <select value={dep} onChange={(e) => setDep(e.target.value)} className="h-8 rounded-md border border-(--color-line-strong) bg-white px-2 text-sm">
                  {depOptions(config).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label} ajratmasi
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-xs text-(--color-text-muted)">
                  <input type="checkbox" checked={skipDup} onChange={(e) => setSkipDup(e.target.checked)} className="size-3.5" />
                  shu sana va summada yozuvi borini o&apos;tkazib yuborish
                </label>
                <Button size="sm" className="ml-auto" disabled={!chosen.length || !dep} loading={busy} onClick={() => void route()}>
                  Daromadga yozish
                </Button>
              </div>
            )}
          </>
        )}
        <TableNote>
          Bank ko&apos;chirmasi «Daromadlar › Bank ko&apos;chirmasi»da yuklanadi. Yozilgan kirim Qo&apos;mita daromadi bo&apos;ladi (bo&apos;lim ajratmasi); bekor qilish — bank
          ko&apos;chirmasi sahifasida («yo&apos;naltirishni bekor qilish»).
        </TableNote>
      </div>
    </ReportCard>
  );
}
