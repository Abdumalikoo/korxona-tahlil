'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { IconAlert, IconSearch } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { choiceReady, EMPTY_CHOICE, PlacePicker, useChoiceLabel, type MoveChoice } from '@/features/unit-payroll/place-picker';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { bankAnalysisApi, type BankAnalysis, type BankCheck, type BankDir, type BankGroup, type BankGroupRow, type BankItem, type BankPostBatch, type BankRow, type BankView } from './api';

// ═══════════════════════════════════════════════════════════
// Bank ko'chirmasi — qismlar:
//  • PreviewGroups — saqlashdan oldin: har guruhni ochib ko'rish (oyma-oy va har to'lov izohi bilan);
//  • GroupDrawer — saqlangan guruh: oyma-oy, har to'lov (bankdagi izoh va sizning izohingiz), tanlab yo'naltirish
//    (chiqim — xarajat, kirim — daromad) va bekor qilish;
//  • PostsHistory — yo'naltirishlar tarixi.
// ═══════════════════════════════════════════════════════════

type ToastFn = (t: { message: string; tone: 'success' | 'error' } | null) => void;
const DIR_LABEL: Record<BankDir, string> = { OUT: 'Chiqim', IN: 'Kirim' };
const ENTRY_LABEL: Record<'EXPENSE' | 'INCOME', string> = { EXPENSE: 'Xarajatga', INCOME: 'Daromadga' };
const rk = (account: string, id: string) => `${account}:${id}`;
const INPUT = 'h-8 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm focus:border-brand-600 focus:outline-none';

// ═══════════ Saqlashdan oldin ═══════════

export function PreviewGroups({ analysis }: { analysis: BankAnalysis }) {
  const [dir, setDir] = useState<BankDir | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(20);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const byId = useMemo(() => new Map(analysis.rows.map((r) => [r.id, r])), [analysis.rows]);
  const periods = analysis.months.map((m) => m.period);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return analysis.groups.filter((g) => (dir === 'ALL' || g.dir === dir) && (!t || g.counterparty.toLowerCase().includes(t) || g.samples.some((x) => x.toLowerCase().includes(t)) || (g.inn ?? '').includes(t)));
  }, [analysis.groups, dir, q]);

  return (
    <Card className="overflow-hidden">
      <CardHeader title={`O'xshash to'lovlar guruhlari (oldindan ko'rish) · ${analysis.groups.length}`} description="Guruhni bosing — oyma-oy summasi va har to'lov to'liq izohi bilan. Izohni o'zgartirish va yo'naltirish — saqlangandan keyin" />
      <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-5 py-2.5">
        {(['ALL', 'OUT', 'IN'] as const).map((d) => (
          <Chip key={d} active={dir === d} onClick={() => setDir(d)}>
            {d === 'ALL' ? 'Hammasi' : DIR_LABEL[d]}
          </Chip>
        ))}
        <Search value={q} onChange={(t) => { setQ(t); setLimit(20); }} />
      </div>
      <ul className="divide-y divide-(--color-line) text-sm">
        {shown.slice(0, limit).map((g) => {
          const isOpen = openKey === g.key;
          const rows = (g.rowIds ?? []).map((id) => byId.get(id)).filter((r): r is BankRow => Boolean(r));
          return (
            <li key={g.key}>
              <button type="button" onClick={() => setOpenKey(isOpen ? null : g.key)} className={cn('flex w-full flex-wrap items-center gap-2 px-5 py-2 text-left hover:bg-(--color-surface-muted)', isOpen && 'bg-brand-50/60')} aria-expanded={isOpen}>
                <span className="text-(--color-text-faint)">{isOpen ? '▾' : '▸'}</span>
                <Badge tone={g.dir === 'OUT' ? 'expense' : 'income'}>{DIR_LABEL[g.dir]}</Badge>
                <Badge tone="brand">{g.kindLabel}</Badge>
                <span className="min-w-0 flex-1 truncate font-medium text-heading" title={`${g.counterparty}\n${g.samples.join('\n')}`}>
                  {g.counterparty} <span className="font-normal text-(--color-text-muted)">· {g.samples[0]}</span>
                </span>
                <span className="text-xs text-(--color-text-muted)">{g.count} ta</span>
                <Money tiyin={g.totalTiyin} tone={g.dir === 'OUT' ? 'expense' : 'income'} />
              </button>
              {isOpen && (
                <div className="space-y-3 border-t border-(--color-line) bg-(--color-surface-muted)/40 px-5 py-3">
                  <MonthsTable periods={periods} byMonth={g.byMonth} countByMonth={g.countByMonth} cumulative={g.cumulative} />
                  <RowsByMonth rows={rows} periods={periods} dir={g.dir} />
                </div>
              )}
            </li>
          );
        })}
        {!shown.length && <li className="px-5 py-4 text-sm text-(--color-text-muted)">Bu tanlovda guruh yo&apos;q</li>}
      </ul>
      {shown.length > limit && (
        <div className="border-t border-(--color-line) px-5 py-2 text-center">
          <Button size="sm" variant="ghost" onClick={() => setLimit((x) => x + 30)}>
            Yana ({shown.length - limit} qoldi)
          </Button>
        </div>
      )}
    </Card>
  );
}

function MonthsTable({ periods, byMonth, countByMonth, cumulative }: { periods: string[]; byMonth: Record<string, string>; countByMonth?: Record<string, number>; cumulative: string[] }) {
  return (
    <div className="overflow-x-auto rounded-(--radius-control) border border-(--color-line) bg-white">
      <table className="w-full text-xs">
        <thead className="bg-(--color-surface-muted) text-[10px] uppercase tracking-wide text-(--color-text-muted)">
          <tr>
            <th className="px-2 py-1.5 text-left font-semibold">Oy</th>
            <th className="px-2 py-1.5 text-right font-semibold">Soni</th>
            <th className="px-2 py-1.5 text-right font-semibold">Shu oy</th>
            <th className="px-2 py-1.5 text-right font-semibold">O‘sib boruvchi</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p, i) => (
            <tr key={p} className="border-t border-(--color-line)">
              <td className="px-2 py-1">{formatPeriod(p)}</td>
              <td className="money px-2 py-1 text-right text-(--color-text-muted)">{countByMonth?.[p] || '—'}</td>
              <td className="money px-2 py-1 text-right">{byMonth[p] && byMonth[p] !== '0' ? formatTiyin(byMonth[p]!) : '—'}</td>
              <td className="money px-2 py-1 text-right text-(--color-text-muted)">{formatTiyin(cumulative[i] ?? '0')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** To'lovlar oyma-oy (faqat ko'rish) */
function RowsByMonth({ rows, periods, dir }: { rows: BankRow[]; periods: string[]; dir: BankDir }) {
  const tone = dir === 'OUT' ? 'expense' : 'income';
  return (
    <div className="space-y-2">
      {periods.map((p) => {
        const list = rows.filter((r) => r.docDate.startsWith(p)).sort((a, b) => a.docDate.localeCompare(b.docDate));
        if (!list.length) return null;
        return (
          <div key={p} className="overflow-hidden rounded-(--radius-control) border border-(--color-line) bg-white">
            <p className="flex justify-between bg-(--color-surface-muted) px-3 py-1 text-xs font-semibold text-heading">
              <span>
                {formatPeriod(p)} · {list.length} ta
              </span>
              <span className="money">{formatTiyin(list.reduce((s, r) => s + BigInt(r.amountTiyin), 0n).toString())}</span>
            </p>
            <ul className="divide-y divide-(--color-line)">
              {list.map((r) => (
                <li key={r.id} className="px-3 py-1.5 text-xs">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="money font-medium">{formatDate(r.docDate)}</span>
                    <span className="money text-(--color-text-muted)">№ {r.docNo || '—'}</span>
                    <span className="min-w-0 flex-1 truncate text-(--color-text-muted)">{r.accountName}</span>
                    <Money tiyin={r.amountTiyin} tone={tone} />
                  </span>
                  <p className="mt-0.5 leading-snug whitespace-pre-wrap text-(--color-text)">{r.purpose || '—'}</p>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════ Saqlangan guruh: izoh va yo'naltirish ═══════════

export function GroupDrawer({ group, v, isAdmin, onToast, onChanged, onClose }: { group: BankGroup | null; v: BankView; isAdmin: boolean; onToast: ToastFn; onChanged: () => void; onClose: () => void }) {
  const [reloadKey, setReloadKey] = useState(0);
  const data = useAsync(() => (group ? bankAnalysisApi.group(group.key, v.from, v.to, v.account).then((r) => r.data) : Promise.resolve(null)), [group?.key, v.from, v.to, v.account, reloadKey]);
  // null — sukut bo'yicha: yo'naltirilmagan hamma to'lov tanlangan
  const [sel, setSel] = useState<Set<string> | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [unrouteId, setUnrouteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => data.data?.rows ?? [], [data.data]);
  const tone = group?.dir === 'OUT' ? 'expense' : 'income';

  const free = rows.filter((r) => !r.post);
  const selected = sel ?? new Set(free.map((r) => rk(r.account, r.id)));
  const setSelected = (fn: (s: Set<string>) => Set<string>) => setSel(fn(selected));
  const picked = free.filter((r) => selected.has(rk(r.account, r.id)));
  const pickedTotal = picked.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
  const dirty = rows.filter((r) => drafts[rk(r.account, r.id)] !== undefined && (drafts[rk(r.account, r.id)] ?? '') !== (r.note ?? ''));
  const reload = () => {
    setReloadKey((k) => k + 1);
    onChanged();
  };

  function toggle(k: string) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  }
  function toggleMonth(list: BankGroupRow[]) {
    const keys = list.filter((r) => !r.post).map((r) => rk(r.account, r.id));
    const all = keys.every((k) => selected.has(k));
    setSelected((s) => {
      const n = new Set(s);
      for (const k of keys) {
        if (all) n.delete(k);
        else n.add(k);
      }
      return n;
    });
  }

  async function saveNotes(silent = false): Promise<boolean> {
    if (!dirty.length) return true;
    setSavingNotes(true);
    try {
      const r = (await bankAnalysisApi.notes(dirty.map((x) => ({ account: x.account, rowId: x.id, comment: drafts[rk(x.account, x.id)] ?? '' })))).data;
      if (!silent) onToast({ message: `Izohlar saqlandi: ${r.saved}${r.cleared ? ` · ${r.cleared} tasi o'chirildi` : ''}${r.entries ? ` · ${r.entries} ta yozuv izohi ham yangilandi` : ''}`, tone: 'success' });
      setDrafts({});
      setReloadKey((k) => k + 1);
      return true;
    } catch (err) {
      onToast({ message: errorMessage(err, 'Izohni saqlab bo‘lmadi'), tone: 'error' });
      return false;
    } finally {
      setSavingNotes(false);
    }
  }

  function applyBulk() {
    const t = bulk.trim();
    if (!t) return;
    setDrafts((d) => {
      const n = { ...d };
      for (const r of rows) if (selected.has(rk(r.account, r.id))) n[rk(r.account, r.id)] = t;
      return n;
    });
  }

  async function unroute() {
    if (!unrouteId) return;
    setBusy(true);
    try {
      const r = (await bankAnalysisApi.unroute({ ids: [unrouteId] })).data;
      onToast({ message: `Yo'naltirish bekor qilindi: ${r.count} ta yozuv o'chirildi`, tone: 'success' });
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Bekor qilib bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(false);
      setUnrouteId(null);
    }
  }

  const months = v.months.filter((p) => rows.some((r) => r.docDate.startsWith(p)));

  return (
    <Drawer
      open={group !== null}
      onClose={onClose}
      title={group?.counterparty ?? ''}
      description={group ? `${DIR_LABEL[group.dir]} · ${group.kindLabel} · ${group.count} ta · ${formatTiyin(group.totalTiyin)} so'm · ${formatDate(group.firstDate)} – ${formatDate(group.lastDate)}` : undefined}
      width="xl"
      footer={group && isAdmin ? <RoutePanel group={group} items={picked.map((r) => ({ account: r.account, rowId: r.id }))} totalTiyin={pickedTotal.toString()} beforeRoute={() => saveNotes(true)} onToast={onToast} onDone={() => { setSel(null); reload(); }} /> : undefined}
    >
      {group && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <MiniStat label="O'rtacha (faol oyda)" value={formatTiyin(group.avgTiyin)} />
            <MiniStat label="Faol oylar" value={`${group.activeMonths} / ${v.months.length}`} />
            <MiniStat label="Ulushi" value={`${group.sharePct.toFixed(1)}%`} />
            <MiniStat label="Yo'naltirilgan" value={`${group.postedCount} / ${group.count}`} />
          </div>
          <MonthsTable periods={v.months} byMonth={group.byMonth} countByMonth={group.countByMonth} cumulative={group.cumulative} />

          {isAdmin && (
            <div className="space-y-2 rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted)/50 p-3 text-xs">
              <p className="text-(--color-text-muted)">
                Har to&apos;lovga <b className="text-heading">o&apos;z izohingizni</b> yozing — yo&apos;naltirilsa, xarajat / daromad izohi shu bo&apos;ladi (yozilmasa — pastdagi umumiy izoh, u ham bo&apos;lmasa — bankdagi izoh).
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input value={bulk} onChange={(e) => setBulk(e.target.value)} maxLength={500} placeholder="Tanlanganlarga bitta izoh (masalan: AUP binosi elektr energiyasi)" className={cn(INPUT, 'min-w-64 flex-1')} />
                <Button size="sm" variant="secondary" disabled={!bulk.trim() || !selected.size} onClick={applyBulk}>
                  Tanlanganlarga ({selected.size})
                </Button>
                <Button size="sm" loading={savingNotes} disabled={!dirty.length} onClick={() => void saveNotes()}>
                  Izohlarni saqlash{dirty.length ? ` (${dirty.length})` : ''}
                </Button>
              </div>
            </div>
          )}

          {data.loading && !data.data ? (
            <LoadingState />
          ) : data.error ? (
            <ErrorState message={data.error} onRetry={data.reload} />
          ) : (
            <div className="space-y-3">
              {months.map((p) => {
                const list = rows.filter((r) => r.docDate.startsWith(p));
                const freeKeys = list.filter((r) => !r.post).map((r) => rk(r.account, r.id));
                const allOn = freeKeys.length > 0 && freeKeys.every((k) => selected.has(k));
                return (
                  <div key={p} className="overflow-hidden rounded-(--radius-control) border border-(--color-line)">
                    <div className="flex items-center gap-2 bg-(--color-surface-muted) px-3 py-1.5 text-xs font-semibold text-heading">
                      {isAdmin && freeKeys.length > 0 && <input type="checkbox" className="size-4 accent-brand-600" checked={allOn} onChange={() => toggleMonth(list)} aria-label={`${formatPeriod(p)} — hammasini tanlash`} />}
                      <span className="flex-1">
                        {formatPeriod(p)} · {list.length} ta
                      </span>
                      <span className="money">{formatTiyin(list.reduce((s, r) => s + BigInt(r.amountTiyin), 0n).toString())}</span>
                    </div>
                    <ul className="divide-y divide-(--color-line)">
                      {list.map((r) => {
                        const k = rk(r.account, r.id);
                        const draft = drafts[k];
                        return (
                          <li key={k} className={cn('px-3 py-2', selected.has(k) && !r.post && 'bg-brand-50/40')}>
                            <span className="flex flex-wrap items-center gap-2 text-sm">
                              {isAdmin && !r.post && <input type="checkbox" className="size-4 accent-brand-600" checked={selected.has(k)} onChange={() => toggle(k)} aria-label="Tanlash" />}
                              <span className="money font-medium">{formatDate(r.docDate)}</span>
                              <span className="money text-[11px] text-(--color-text-muted)">№ {r.docNo || '—'}</span>
                              {v.accounts.length > 1 && (
                                <Badge tone="neutral" className="px-1.5 py-0 text-[10px]">
                                  {r.accountLabel}
                                </Badge>
                              )}
                              <span className="min-w-0 flex-1 truncate text-xs text-(--color-text-muted)" title={r.accountName}>
                                {r.accountName}
                              </span>
                              <Money tiyin={r.amountTiyin} tone={tone} />
                            </span>
                            <p className="mt-1 text-xs leading-snug whitespace-pre-wrap text-(--color-text)">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-(--color-text-faint)">Bankda: </span>
                              {r.purpose || '—'}
                            </p>
                            {isAdmin ? (
                              <input
                                value={draft ?? r.note ?? ''}
                                onChange={(e) => setDrafts((d) => ({ ...d, [k]: e.target.value }))}
                                maxLength={500}
                                placeholder="O'z izohingiz (xarajat / daromad izohi bo'ladi)"
                                className={cn(INPUT, 'mt-1.5 w-full text-xs', draft !== undefined && draft !== (r.note ?? '') && 'border-(--color-warn)')}
                              />
                            ) : (
                              r.note && <p className="mt-1 text-xs text-heading">Izoh: {r.note}</p>
                            )}
                            {r.post && (
                              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                                <Badge tone="income" className="px-1.5 py-0 text-[10px]">
                                  {ENTRY_LABEL[r.post.entryType]} yo‘naltirilgan
                                </Badge>
                                <span className="text-heading">
                                  {r.post.place} · «{r.post.categoryLabel}» · {r.post.section === 'DOIMIY' ? 'Doimiy' : 'Boshqa'}
                                </span>
                                <span className="text-(--color-text-faint)">
                                  {formatDateTime(r.post.createdAt)} · {r.post.createdBy}
                                </span>
                                {isAdmin && (
                                  <button type="button" className="font-medium text-(--color-expense) hover:underline" onClick={() => setUnrouteId(r.post!.id)}>
                                    Bekor qilish
                                  </button>
                                )}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <ConfirmDialog
        open={unrouteId !== null}
        title="Yo'naltirishni bekor qilish"
        message="Shu to'lovdan yaratilgan xarajat / daromad yozuvi o'chiriladi. To'lov tahlilda qoladi — keyin qayta yo'naltirish mumkin."
        confirmLabel="Bekor qilish"
        danger
        loading={busy}
        onConfirm={() => void unroute()}
        onCancel={() => setUnrouteId(null)}
      />
    </Drawer>
  );
}

/** Tanlanganlarni yo'naltirish: joy, modda, bo'lim (Doimiy / Boshqa), umumiy izoh → tekshiruv (takror) → yozish */
function RoutePanel({ group, items, totalTiyin, beforeRoute, onToast, onDone }: { group: BankGroup; items: BankItem[]; totalTiyin: string; beforeRoute: () => Promise<boolean>; onToast: ToastFn; onDone: () => void }) {
  const [choice, setChoice] = useState<MoveChoice>(EMPTY_CHOICE);
  const [category, setCategory] = useState('');
  const [section, setSection] = useState<'DOIMIY' | 'BOSHQA'>(group.regular ? 'DOIMIY' : 'BOSHQA');
  const [description, setDescription] = useState('');
  const [check, setCheck] = useState<BankCheck | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const placeLabel = useChoiceLabel(choice);
  const ready = choiceReady(choice);
  const opts = useAsync(() => (ready ? bankAnalysisApi.options(group.dir, choice.target).then((r) => r.data) : Promise.resolve(null)), [group.dir, choice.target, ready]);
  const cats = useMemo(() => opts.data?.categories ?? [], [opts.data]);
  const groups = useMemo(() => {
    const m = new Map<string, typeof cats>();
    for (const c of cats) {
      const g = c.group ?? '';
      m.set(g, [...(m.get(g) ?? []), c]);
    }
    return [...m.entries()];
  }, [cats]);
  // Joy o'zgarib, modda ro'yxatda qolmasa — tanlanmagan hisoblanadi
  const cat = cats.some((c) => c.code === category) ? category : '';

  const what = group.dir === 'OUT' ? 'xarajat' : 'daromad';
  const can = items.length > 0 && ready && Boolean(cat);

  async function start() {
    if (!can) return;
    setBusy(true);
    try {
      if (!(await beforeRoute())) return;
      const c = (await bankAnalysisApi.check(items)).data;
      setCheck(c);
      setConfirm(true);
    } catch (err) {
      onToast({ message: errorMessage(err, 'Tekshirib bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function run(mode: 'normal' | 'skip' | 'force') {
    setBusy(true);
    try {
      const r = (
        await bankAnalysisApi.route({
          items,
          place: { unit: choice.target, ...choice.place },
          categoryCode: cat,
          section,
          description: description.trim() || undefined,
          skipDuplicates: mode === 'skip',
          force: mode === 'force',
        })
      ).data;
      onToast({ message: r.count ? `${ENTRY_LABEL[r.entryType]} yozildi: ${r.count} ta · ${formatTiyin(r.totalTiyin)} so'm → ${r.place}${r.skipped ? ` · ${r.skipped} tasi o'tkazib yuborildi (yozuvi bor edi)` : ''}` : 'Hech narsa yozilmadi — hammasining yozuvi bor ekan', tone: 'success' });
      setConfirm(false);
      setCheck(null);
      setDescription('');
      onDone();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Yo‘naltirib bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const dups = check?.duplicates ?? [];
  return (
    <div className="w-full space-y-2 text-xs">
      <p className="font-semibold text-heading">
        Tanlangan: {items.length} ta · <span className="money">{formatTiyin(totalTiyin)}</span> so&apos;m → {what} sifatida yo&apos;naltirish
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <PlacePicker value={choice} onChange={setChoice} />
        <select value={cat} onChange={(e) => setCategory(e.target.value)} disabled={!ready || opts.loading} className={cn(INPUT, 'max-w-72')} aria-label={group.dir === 'OUT' ? 'Xarajat moddasi' : 'Daromad turi'}>
          <option value="">{!ready ? 'Avval joyni tanlang' : opts.loading ? 'Yuklanmoqda…' : group.dir === 'OUT' ? 'Xarajat moddasi…' : 'Daromad turi…'}</option>
          {groups.map(([g, list]) =>
            g ? (
              <optgroup key={g} label={g}>
                {list.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              list.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.label}
                </option>
              ))
            ),
          )}
        </select>
        <select value={section} onChange={(e) => setSection(e.target.value === 'BOSHQA' ? 'BOSHQA' : 'DOIMIY')} className={INPUT} aria-label="Bo'lim">
          <option value="DOIMIY">Doimiy</option>
          <option value="BOSHQA">Boshqa (bir martalik)</option>
        </select>
      </div>
      {ready && opts.data?.limited && <p className="text-(--color-text-faint)">Faqat «{placeLabel}» bo&apos;limi ro&apos;yxatidagi moddalar ko&apos;rsatilmoqda.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="Umumiy izoh (o'z izohi yozilmagan to'lovlar uchun, ixtiyoriy)" className={cn(INPUT, 'min-w-64 flex-1')} />
        <Button loading={busy} disabled={!can} onClick={() => void start()}>
          Yo&apos;naltirish ({items.length})
        </Button>
      </div>
      {confirm && dups.length > 0 && (
        <div className="space-y-2 rounded-(--radius-control) border border-(--color-warn) bg-(--color-warn-soft) p-3">
          <p className="flex items-center gap-1.5 font-semibold text-(--color-warn)">
            <IconAlert className="size-4" />
            Takror bo&apos;lishi mumkin: {dups.length} ta to&apos;lov uchun shu sana va summada {what} yozuvi allaqachon bor
          </p>
          <ul className="max-h-48 space-y-1.5 overflow-auto">
            {dups.map((d) => (
              <li key={d.rowId} className="rounded border border-(--color-line) bg-white px-2 py-1">
                <span className="money font-medium">
                  {formatDate(d.docDate)} · {formatTiyin(d.amountTiyin)}
                </span>{' '}
                <span className="text-(--color-text-muted)">{d.purpose.slice(0, 90)}</span>
                {d.matches.map((m) => (
                  <span key={m.id} className="mt-0.5 block text-(--color-warn)">
                    ↳ bor: «{m.categoryLabel}» — {m.description?.slice(0, 80) ?? '—'}
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className="text-(--color-text-muted)">«O&apos;tkazib yuborish» — faqat yozuvi yo&apos;qlari ({(check?.count ?? 0) - dups.length} ta) yoziladi. «Baribir yozish» — hammasi.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>
              Bekor
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run('force')}>
              Baribir yozish
            </Button>
            <Button size="sm" loading={busy} onClick={() => void run('skip')}>
              O&apos;tkazib yuborish
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirm && check !== null && !dups.length}
        title={`${what[0]!.toUpperCase()}${what.slice(1)} sifatida yozish`}
        message={`${check?.count ?? 0} ta to'lov (${formatTiyin(check?.totalTiyin ?? '0')} so'm) «${placeLabel}» ga «${cats.find((c) => c.code === cat)?.label ?? ''}» bo'yicha ${what} bo'lib yoziladi (${section === 'DOIMIY' ? 'Doimiy' : 'Boshqa'}). Sana va oy — to'lov sanasi. Keyin bekor qilish mumkin.`}
        confirmLabel="Yozish"
        loading={busy}
        onConfirm={() => void run('normal')}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}

// ═══════════ Yo'naltirishlar tarixi ═══════════

export function PostsHistory({ list, isAdmin, onToast, onChanged }: { list: BankPostBatch[]; isAdmin: boolean; onToast: ToastFn; onChanged: () => void }) {
  const [target, setTarget] = useState<BankPostBatch | null>(null);
  const [busy, setBusy] = useState(false);
  if (!list.length) return null;

  async function cancel() {
    if (!target) return;
    setBusy(true);
    try {
      const r = (await bankAnalysisApi.unroute({ batch: target.batch })).data;
      onToast({ message: `Bekor qilindi: ${r.count} ta yozuv o'chirildi`, tone: 'success' });
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Bekor qilib bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(false);
      setTarget(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader title="Yo'naltirishlar tarixi" description="Bank ko'chirmasidan xarajat / daromadga yozilganlar" />
      <ul className="divide-y divide-(--color-line) text-sm">
        {list.slice(0, 50).map((b) => (
          <li key={b.batch} className={cn('flex flex-wrap items-center gap-3 px-5 py-2.5', !b.live && 'opacity-50')}>
            <Badge tone={b.entryType === 'EXPENSE' ? 'expense' : 'income'}>{ENTRY_LABEL[b.entryType]}</Badge>
            <span className="min-w-0 flex-1 truncate font-medium text-heading">
              {b.place} · «{b.categoryLabel}» <span className="font-normal text-(--color-text-muted)">· {b.section === 'DOIMIY' ? 'Doimiy' : 'Boshqa'}</span>
            </span>
            <span className="text-xs text-(--color-text-muted)">{b.months.map(formatPeriod).join(', ')}</span>
            <span className="text-xs text-(--color-text-muted)">
              {b.live === b.count ? `${b.count} ta` : `${b.live} / ${b.count} ta`}
            </span>
            <Money tiyin={b.live ? b.liveTiyin : b.totalTiyin} tone={b.entryType === 'EXPENSE' ? 'expense' : 'income'} />
            <span className="text-xs text-(--color-text-muted)">
              {formatDateTime(b.createdAt)} · {b.createdBy}
            </span>
            {b.live ? (
              isAdmin && (
                <Button size="sm" variant="ghost" className="text-(--color-text-muted) hover:text-(--color-expense)" onClick={() => setTarget(b)}>
                  Bekor qilish
                </Button>
              )
            ) : (
              <span title={b.cancelReason ?? ''}>
                <Badge tone="neutral">bekor qilingan</Badge>
              </span>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={target !== null}
        title="Yo'naltirishni bekor qilish"
        message={`${target?.live ?? 0} ta ${target?.entryType === 'INCOME' ? 'daromad' : 'xarajat'} yozuvi (${formatTiyin(target?.liveTiyin ?? '0')} so'm, ${target?.place ?? ''}) o'chiriladi. To'lovlar tahlilda qoladi.`}
        confirmLabel="Bekor qilish"
        danger
        loading={busy}
        onConfirm={() => void cancel()}
        onCancel={() => setTarget(null)}
      />
    </Card>
  );
}

// ═══════════ Mayda ═══════════

function Search({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="relative ml-auto">
      <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-(--color-text-faint)" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Oluvchi, ИНН, izoh" className="h-8 w-60 rounded-(--radius-control) border border-(--color-line-strong) bg-white pr-3 pl-8 text-sm focus:border-brand-600 focus:outline-none" />
    </label>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-(--radius-control) border border-(--color-line) px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className="money mt-0.5 font-semibold text-heading">{value}</p>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full border px-3 py-1 text-xs font-medium', active ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:text-heading')}>
      {children}
    </button>
  );
}

