'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconSearch } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { ENTRY_LABEL, RoutePanel, type ToastFn } from './bank-analysis-parts';
import { ClarifyDialog } from './clarify-dialog';
import { useSource } from './source';
import type { BankDir, BankListRow, BankView } from './api';

// ═══════════════════════════════════════════════════════════
// Nomma-nom (vipiska kabi): davrdagi har bir to'lov alohida qator — sana, ishlov sanasi, № hujjat, nomi, INN, MFO, summa,
// to'lov maqsadi. Sukut bo'yicha faqat qolganlar (yo'naltirilgan va bekor qilinganlar yashirin). Belgilab — yo'naltirish;
// har qatorda «Bekor qilish» (kiritmayman, qaytarish mumkin) va «O'chirish» (ko'chirmadan butunlay, tasdiq bilan).
// ═══════════════════════════════════════════════════════════

const PAGE = 200;
const rk = (r: BankListRow) => `${r.account}:${r.id}`;

/** Ro'yxat: qolganlar (ish ro'yxati), aniqlashtirishda, hammasi */
export type RowsMode = 'OPEN' | 'CLARIFY' | 'ALL';
const isOpen = (r: BankListRow) => !r.post && !r.dismissed && !r.clarify;

export function RowsList({ v, dir, isAdmin, reloadKey, mode, onMode, onToast, onChanged }: { v: BankView; dir: BankDir; isAdmin: boolean; reloadKey: number; mode: RowsMode; onMode: (m: RowsMode) => void; onToast: ToastFn; onChanged: () => void }) {
  const { api } = useSource();
  const [rev, setRev] = useState(0);
  const res = useAsync(() => api.rows(v.from, v.to, v.account, dir).then((r) => r.data), [v.from, v.to, v.account, dir, reloadKey, rev]);
  // Aniqlashtirishga o'tkazish oynasi: qaysi to'lovlar
  const [clarifyAsk, setClarifyAsk] = useState<BankListRow[] | null>(null);
  const [month, setMonth] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [deleteAsk, setDeleteAsk] = useState<BankListRow[] | null>(null);

  const all = useMemo(() => res.data?.rows ?? [], [res.data]);
  const inMonth = useMemo(() => (month ? all.filter((r) => (r.period ?? r.docDate.slice(0, 7)) === month) : all), [all, month]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return inMonth.filter((r) => {
      if (mode === 'OPEN' && !isOpen(r)) return false;
      if (mode === 'CLARIFY' && !r.clarify) return false;
      if (!t) return true;
      return r.accountName.toLowerCase().includes(t) || (r.inn ?? '').includes(t) || r.purpose.toLowerCase().includes(t) || r.docNo.includes(t) || (r.groupName ?? '').toLowerCase().includes(t);
    });
  }, [inMonth, mode, q]);
  const months = useMemo(() => {
    const m = new Map<string, { n: number; open: number }>();
    for (const r of all) {
      const p = r.period ?? r.docDate.slice(0, 7);
      const x = m.get(p) ?? { n: 0, open: 0 };
      x.n += 1;
      if (isOpen(r)) x.open += 1;
      m.set(p, x);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [all]);
  // Tanlash mumkin: yo'naltirilmagan va bekor qilinmagan (aniqlashtirishdagilar ham — tuzatib yo'naltirish uchun)
  const free = shown.filter((r) => !r.post && !r.dismissed);
  const picked = free.filter((r) => sel.has(rk(r)));
  const pickedTotal = picked.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
  const shownTotal = shown.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
  const counts = { OPEN: inMonth.filter(isOpen).length, CLARIFY: inMonth.filter((r) => r.clarify).length, ALL: inMonth.length };
  const doneCount = inMonth.filter((r) => r.post || r.dismissed).length;
  const tone = dir === 'OUT' ? 'text-(--color-expense)' : 'text-(--color-income)';

  const reload = () => {
    setSel(new Set());
    setRev((x) => x + 1);
    onChanged();
  };
  function toggle(r: BankListRow) {
    setSel((s) => {
      const n = new Set(s);
      if (n.has(rk(r))) n.delete(rk(r));
      else n.add(rk(r));
      return n;
    });
  }
  const allOn = free.length > 0 && free.slice(0, limit).every((r) => sel.has(rk(r)));

  async function skip(list: BankListRow[]) {
    setBusy(true);
    try {
      const r = (await api.dismiss(list.map((x) => ({ account: x.account, rowId: x.id })), 'Kiritilmaydi (nomma-nom ro‘yxatda bekor qilindi)')).data;
      onToast({ message: `Bekor qilindi: ${r.count} ta · ${formatTiyin(r.totalTiyin)} so'm — ro'yxatdan chiqdi (hech narsa yozilmadi)`, tone: 'success' });
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "Bekor qilib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function toClarify(list: BankListRow[], note: string) {
    setBusy(true);
    try {
      const r = (await api.clarify(list.map((x) => ({ account: x.account, rowId: x.id })), note.trim() || undefined)).data;
      onToast({ message: `Aniqlashtirishga o'tkazildi: ${r.count} ta · ${formatTiyin(r.totalTiyin)} so'm — «Aniqlashtirishda» ro'yxatida`, tone: 'success' });
      setClarifyAsk(null);
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "O'tkazib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function unclarify(r: BankListRow) {
    setBusy(true);
    try {
      await api.unclarify([{ account: r.account, rowId: r.id }]);
      onToast({ message: "Ish ro'yxatiga qaytarildi", tone: 'success' });
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "Qaytarib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function unskip(r: BankListRow) {
    setBusy(true);
    try {
      await api.undismiss([{ account: r.account, rowId: r.id }]);
      onToast({ message: "Ro'yxatga qaytarildi", tone: 'success' });
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "Qaytarib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!deleteAsk?.length) return;
    setBusy(true);
    try {
      const r = (await api.deleteRows(deleteAsk.map((x) => ({ account: x.account, rowId: x.id })))).data;
      onToast({ message: `O'chirildi: ${r.count} ta to'lov · ${formatTiyin(r.totalTiyin)} so'm (ko'chirmadan)`, tone: 'success' });
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "O'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
      setDeleteAsk(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`Nomma-nom · ${dir === 'OUT' ? 'chiqim' : 'kirim'}`}
        description={`Vipiskadagidek har to'lov alohida: ${shown.length} ta · ${formatTiyin(shownTotal.toString())} so'm${mode === 'OPEN' && doneCount ? ` · ${doneCount} tasi ko'rib chiqilgan (yashirin)` : ''}`}
        actions={
          <div className="inline-flex rounded-(--radius-control) border border-(--color-line-strong) bg-white p-0.5 text-xs">
            {(
              [
                ['OPEN', 'Qolganlar'],
                ['CLARIFY', 'Aniqlashtirishda'],
                ['ALL', 'Hammasi'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  onMode(k);
                  setSel(new Set());
                  setLimit(PAGE);
                }}
                className={cn('rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1 font-medium whitespace-nowrap', mode === k ? (k === 'CLARIFY' ? 'bg-amber-500 text-white' : 'bg-brand-600 text-white') : 'text-(--color-text-muted) hover:text-heading')}
              >
                {label} <span className="money opacity-80">{counts[k]}</span>
              </button>
            ))}
          </div>
        }
      />
      <div className="flex flex-wrap items-center gap-1.5 border-b border-(--color-line) px-5 py-2.5 text-xs">
        <MonthChip active={!month} onClick={() => setMonth(null)}>
          Hamma oylar <span className="money opacity-70">{all.length}</span>
        </MonthChip>
        {months.map(([p, x]) => (
          <MonthChip key={p} active={month === p} onClick={() => setMonth(month === p ? null : p)}>
            {formatPeriod(p)}{' '}
            <span className="money opacity-70" title={`Jami ${x.n} ta to'lov, qolgan ${x.open} ta`}>
              {x.n}
              {x.open !== x.n ? ` · qolgan ${x.open}` : ''}
            </span>
          </MonthChip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-5 py-2 text-xs">
        {mode === 'CLARIFY' && <span className="text-amber-800">Aniq tahlil talab qiladiganlar: tekshirib, izoh yozing va yo&apos;naltiring (belgi o&apos;zi olinadi) yoki «Qaytarish» / «Bekor qilish».</span>}
        <label className="relative ml-auto">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-(--color-text-faint)" />
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setLimit(PAGE);
            }}
            placeholder="Nom, ИНН, № hujjat, maqsad"
            className="h-8 w-64 rounded-(--radius-control) border border-(--color-line-strong) bg-white pr-3 pl-8 text-sm focus:border-brand-600 focus:outline-none"
          />
        </label>
      </div>
      {res.error ? (
        <ErrorState message={res.error} onRetry={res.reload} />
      ) : !res.data ? (
        <LoadingState label="To'lovlar yuklanmoqda" />
      ) : (
        <div className="max-h-[720px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-[2] bg-(--color-surface-muted) text-[10px] tracking-wide text-(--color-text-muted) uppercase">
              <tr>
                {isAdmin && (
                  <th className="px-2 py-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-brand-600"
                      checked={allOn}
                      onChange={() => setSel(allOn ? new Set() : new Set(free.slice(0, limit).map(rk)))}
                      aria-label="Ko'rinayotgan qolganlarni tanlash"
                    />
                  </th>
                )}
                <th className="px-2 py-2 text-right font-semibold">№</th>
                <th className="px-2 py-2 text-left font-semibold">Sana</th>
                <th className="px-2 py-2 text-left font-semibold">Ishlov</th>
                <th className="px-2 py-2 text-left font-semibold">№ hujjat</th>
                <th className="min-w-48 px-2 py-2 text-left font-semibold">Nomi</th>
                <th className="px-2 py-2 text-left font-semibold">ИНН</th>
                <th className="px-2 py-2 text-left font-semibold">МФО</th>
                <th className="px-2 py-2 text-right font-semibold">Summa</th>
                <th className="min-w-72 px-2 py-2 text-left font-semibold">To&apos;lov maqsadi</th>
                <th className="px-2 py-2 text-left font-semibold">Holat</th>
                {isAdmin && <th className="px-2 py-2" />}
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, limit).map((r, i) => {
                const done = Boolean(r.post || r.dismissed);
                return (
                  <tr key={rk(r)} className={cn('border-t border-(--color-line) align-top', sel.has(rk(r)) && !done && 'bg-brand-50/40', done && 'opacity-70', r.clarify && !sel.has(rk(r)) && 'bg-amber-50/60')}>
                    {isAdmin && <td className="px-2 py-1.5">{!done && <input type="checkbox" className="size-4 accent-brand-600" checked={sel.has(rk(r))} onChange={() => toggle(r)} aria-label="Tanlash" />}</td>}
                    <td className="money px-2 py-1.5 text-right text-(--color-text-faint)">{i + 1}</td>
                    <td className="money px-2 py-1.5 whitespace-nowrap">{formatDate(r.docDate)}</td>
                    <td className="money px-2 py-1.5 whitespace-nowrap text-(--color-text-muted)">{r.procDate ? formatDate(r.procDate) : '—'}</td>
                    <td className="money px-2 py-1.5 whitespace-nowrap">{r.docNo || '—'}</td>
                    <td className="max-w-64 px-2 py-1.5">
                      <span className="line-clamp-2 text-heading" title={r.accountName}>
                        {r.accountName}
                      </span>
                      {r.groupName && <span className="block truncate text-[10px] text-(--color-text-faint)">guruh: {r.groupName}</span>}
                    </td>
                    <td className="money px-2 py-1.5 whitespace-nowrap">{r.inn || '—'}</td>
                    <td className="money px-2 py-1.5 whitespace-nowrap text-(--color-text-muted)">{r.mfo || '—'}</td>
                    <td className={cn('money px-2 py-1.5 text-right font-semibold whitespace-nowrap', tone)}>{formatTiyin(r.amountTiyin)}</td>
                    <td className="max-w-md px-2 py-1.5">
                      <span className="line-clamp-3 whitespace-pre-wrap" title={r.purpose}>
                        {r.purpose || '—'}
                      </span>
                      {r.note && <span className="mt-0.5 block text-[11px] text-heading">Izoh: {r.note}</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {r.post ? (
                        <span title={`${r.post.place} · «${r.post.categoryLabel}» · ${r.post.createdBy}`}>
                          <Badge tone={r.post.entryType === 'EXPENSE' ? 'expense' : r.post.entryType === 'EXCLUDED' ? 'neutral' : 'income'} className="px-1.5 py-0 text-[10px] whitespace-nowrap">
                            {ENTRY_LABEL[r.post.entryType]}
                          </Badge>
                          <span className="mt-0.5 block max-w-40 truncate text-[10px] text-(--color-text-muted)">{r.post.categoryLabel}</span>
                        </span>
                      ) : r.dismissed ? (
                        <span title={`${r.dismissed.reason ?? ''} · ${r.dismissed.by}`}>
                          <Badge tone="neutral" className="px-1.5 py-0 text-[10px] whitespace-nowrap">
                            Bekor qilingan
                          </Badge>
                        </span>
                      ) : r.clarify ? (
                        <span title={`${r.clarify.by} · ${formatDate(r.clarify.at)}`}>
                          <Badge tone="warn" className="px-1.5 py-0 text-[10px] whitespace-nowrap">
                            Aniqlashtirishda
                          </Badge>
                          {r.clarify.reason && <span className="mt-0.5 block max-w-44 text-[10px] text-amber-800">{r.clarify.reason}</span>}
                        </span>
                      ) : (
                        <span className="text-[10px] text-amber-700">qolgan</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-2 py-1.5">
                        <span className="flex flex-col items-end gap-1">
                          {isOpen(r) && (
                            <button type="button" disabled={busy} onClick={() => setClarifyAsk([r])} title="Aniq tahlil talab qiladi — «Aniqlashtirishda» ro'yxatiga o'tadi, tuzatilgach kiritiladi" className="rounded-(--radius-control) border border-amber-400 bg-white px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-amber-800 hover:bg-amber-50 disabled:opacity-50">
                              Aniqlashtirish
                            </button>
                          )}
                          {r.clarify && (
                            <button type="button" disabled={busy} onClick={() => void unclarify(r)} title="Ish ro'yxatiga qaytarish" className="text-[11px] font-medium whitespace-nowrap text-brand-700 hover:underline disabled:opacity-50">
                              Qaytarish
                            </button>
                          )}
                          {!done && (
                            <button type="button" disabled={busy} onClick={() => void skip([r])} title="Kiritmayman — ro'yxatdan chiqadi (hech narsa yozilmaydi, keyin qaytarish mumkin)" className="rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-(--color-text-muted) hover:border-(--color-expense) hover:text-(--color-expense) disabled:opacity-50">
                              Bekor qilish
                            </button>
                          )}
                          {r.dismissed && (
                            <button type="button" disabled={busy} onClick={() => void unskip(r)} className="text-[11px] font-medium whitespace-nowrap text-brand-700 hover:underline disabled:opacity-50">
                              Qaytarish
                            </button>
                          )}
                          {!r.post && (
                            <button type="button" disabled={busy} onClick={() => setDeleteAsk([r])} title="Ko'chirmadan butunlay o'chirish (tasdiq so'raladi)" className="rounded-(--radius-control) border border-(--color-expense)/40 bg-white px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-(--color-expense) hover:bg-(--color-expense-soft) disabled:opacity-50">
                              O&apos;chirish
                            </button>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!shown.length && (
                <tr>
                  <td colSpan={isAdmin ? 12 : 10} className="py-6 text-center text-sm text-(--color-text-muted)">
                    {mode === 'CLARIFY' ? "Aniqlashtirishda to'lov yo'q" : mode === 'OPEN' && doneCount ? "✓ Hammasi ko'rib chiqilgan — qolgan to'lov yo'q" : "Bu tanlovda to'lov yo'q"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {shown.length > limit && (
        <div className="border-t border-(--color-line) px-5 py-2 text-center">
          <Button size="sm" variant="ghost" onClick={() => setLimit((x) => x + PAGE)}>
            Yana {Math.min(PAGE, shown.length - limit)} ta ({shown.length - limit} qoldi)
          </Button>
        </div>
      )}
      {isAdmin && picked.length > 0 && (
        <div className="space-y-2 border-t border-(--color-line) bg-(--color-surface-muted)/50 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {picked.some((r) => !r.clarify) && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setClarifyAsk(picked.filter((r) => !r.clarify))}>
                Aniqlashtirishga ({picked.filter((r) => !r.clarify).length})
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void skip(picked)}>
              Tanlanganlarni bekor qilish ({picked.length})
            </Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => setDeleteAsk(picked)}>
              Tanlanganlarni o&apos;chirish ({picked.length})
            </Button>
          </div>
          <RoutePanel key={dir} group={{ dir, pattern: 'ONCE', name: null }} suggestion={null} items={picked.map((r) => ({ account: r.account, rowId: r.id }))} totalTiyin={pickedTotal.toString()} beforeRoute={async () => true} onToast={onToast} onDone={reload} />
        </div>
      )}
      {clarifyAsk && <ClarifyDialog rows={clarifyAsk} busy={busy} onConfirm={(note) => void toClarify(clarifyAsk, note)} onCancel={() => setClarifyAsk(null)} />}
      <ConfirmDialog
        open={deleteAsk !== null}
        title="To'lovni o'chirish"
        message={
          deleteAsk
            ? `${deleteAsk.length === 1 ? `${formatDate(deleteAsk[0]!.docDate)} № ${deleteAsk[0]!.docNo || '—'}` : `${deleteAsk.length} ta to'lov`} (${formatTiyin(deleteAsk.reduce((s, x) => s + BigInt(x.amountTiyin), 0n).toString())} so'm) saqlangan ko'chirmadan butunlay o'chiriladi — tahlil va jamilardan ham ketadi. Xarajat va daromad yozuvlariga tegmaydi. Ko'chirma fayli qayta yuklansa, yana paydo bo'ladi.`
            : ''
        }
        confirmLabel="O'chirish"
        danger
        loading={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleteAsk(null)}
      />
    </Card>
  );
}

function MonthChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full border px-2.5 py-1 font-medium', active ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-line-strong) bg-white text-heading hover:border-brand-300')}>
      {children}
    </button>
  );
}
