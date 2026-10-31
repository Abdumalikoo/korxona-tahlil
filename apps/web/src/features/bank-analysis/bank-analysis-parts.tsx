'use client';

import { ExpandBox } from '@/components/report/nested';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Drawer } from '@/components/ui/drawer';
import { IconAlert, IconSearch } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { ModdaPicker } from '@/components/shared/modda-picker';
import { CENTER_GENERAL, choiceReady, PlacePicker, useChoiceLabel, type MoveChoice } from '@/features/unit-payroll/place-picker';
import { unitCategoriesApi, useUnitCategories } from '@/features/units/api';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { ClarifyDialog } from './clarify-dialog';
import { useSource } from './source';
import { KIND_OPTIONS, KIND_SOURCE_LABEL, PATTERN_LABEL, type BankKind, type BankAnalysis, type BankCheck, type BankDir, type BankEntryType, type BankGroup, type BankGroupRow, type BankItem, type BankPostBatch, type BankRow, type BankView, type RouteSuggestion } from './api';

// ═══════════════════════════════════════════════════════════
// Bank ko'chirmasi — qismlar:
//  • PreviewGroups — saqlashdan oldin: har guruhni ochib ko'rish (oyma-oy va har to'lov izohi bilan);
//  • GroupDrawer — saqlangan guruh: oyma-oy, har to'lov (bankdagi izoh va sizning izohingiz), tanlab yo'naltirish
//    (chiqim — xarajat, kirim — daromad) va bekor qilish;
//  • PostsHistory — yo'naltirishlar tarixi;
//  • KindBadge — guruh turi (qayerdan va nega), KindRulesCard — «izohda X bo'lsa → Y» qoidalari.
// ═══════════════════════════════════════════════════════════

export type ToastFn = (t: { message: string; tone: 'success' | 'error' } | null) => void;
export const ENTRY_LABEL: Record<BankEntryType, string> = { EXPENSE: 'Xarajatga', INCOME: 'Daromadga', EXCLUDED: 'Hisobga olinmaydiganga' };
const rk = (account: string, id: string) => `${account}:${id}`;
/** Qator oyi: faktura — xizmat oyi, bank — hujjat sanasi oyi */
const periodOf = (r: BankRow) => r.period ?? r.docDate.slice(0, 7);
const INPUT = 'h-8 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm focus:border-brand-600 focus:outline-none';

// ═══════════ Saqlashdan oldin ═══════════

export function PreviewGroups({ analysis }: { analysis: BankAnalysis }) {
  const { dirLabel: DIR_LABEL } = useSource();
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
              <div className={cn('flex w-full items-center gap-2 pl-5 hover:bg-(--color-surface-muted)', isOpen && 'bg-brand-50/60')}>
                <ExpandBox open={isOpen} onClick={() => setOpenKey(isOpen ? null : g.key)} />
                <button type="button" onClick={() => setOpenKey(isOpen ? null : g.key)} className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-2 pr-5 text-left" aria-expanded={isOpen}>
                  <Badge tone={g.dir === 'OUT' ? 'expense' : 'income'}>{DIR_LABEL[g.dir]}</Badge>
                  <KindBadge g={g} />
                  <span className="min-w-0 flex-1 truncate font-medium text-heading" title={`${g.counterparty}\n${g.samples.join('\n')}`}>
                    {g.name ?? g.counterparty} <span className="font-normal text-(--color-text-muted)">· {g.name ? `${g.counterparty} · ` : ''}{g.samples[0]}</span>
                  </span>
                  <Badge tone={g.pattern === 'ONCE' ? 'warn' : 'neutral'}>{PATTERN_LABEL[g.pattern].toLowerCase()}</Badge>
                  <span className="text-xs text-(--color-text-muted)">{g.count} ta</span>
                  <Money tiyin={g.totalTiyin} tone={g.dir === 'OUT' ? 'expense' : 'income'} />
                </button>
              </div>
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
        const list = rows.filter((r) => periodOf(r) === p).sort((a, b) => a.docDate.localeCompare(b.docDate));
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
                  {r.invoiceId && <InvoiceDetails r={r} />}
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

/** clarifyMode — «Aniqlashtirish» sahifasidan: faqat aniqlashtirishdagi to'lovlar, ular qolgan ish sifatida */
export function GroupDrawer({ group, month, v, isAdmin, clarifyMode = false, onToast, onChanged, onClose }: { group: BankGroup | null; month?: string | null; v: BankView; isAdmin: boolean; clarifyMode?: boolean; onToast: ToastFn; onChanged: () => void; onClose: () => void }) {
  const { api, dirLabel: DIR_LABEL } = useSource();
  // Tanlangan oy (oy katagi bosilgan bo'lsa) — faqat shu oy to'lovlari; null — hamma oylar
  const [focus, setFocus] = useState<string | null>(month ?? null);
  const [reloadKey, setReloadKey] = useState(0);
  const only = clarifyMode ? 'clarify' : null;
  const data = useAsync(() => (group ? api.group(group.key, v.from, v.to, v.account, only).then((r) => r.data) : Promise.resolve(null)), [group?.key, v.from, v.to, v.account, only, reloadKey]);
  // null — sukut bo'yicha: yo'naltirilmagan hamma to'lov tanlangan
  const [sel, setSel] = useState<Set<string> | null>(null);
  const [unrouteId, setUnrouteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ko'rib chiqilganlar (yo'naltirilgan yoki ro'yxatdan chiqarilgan) — sukut bo'yicha yashirin: ro'yxatda faqat qolgan ish
  const [showDone, setShowDone] = useState(false);
  const [dismissReason, setDismissReason] = useState('');
  const [dismissAsk, setDismissAsk] = useState(false);
  const allRows = useMemo(() => data.data?.rows ?? [], [data.data]);
  const scoped = useMemo(() => (focus ? allRows.filter((r) => periodOf(r) === focus) : allRows), [allRows, focus]);
  // Aniqlashtirishdagi to'lov — oddiy tahlilda ko'rib chiqilgan, «Aniqlashtirish» sahifasida — qolgan ish
  const isDone = (r: BankGroupRow) => Boolean(r.post || r.dismissed || (!clarifyMode && r.clarify));
  const doneCount = scoped.filter(isDone).length;
  const rows = useMemo(() => (showDone ? scoped : scoped.filter((r) => !r.post && !r.dismissed && (clarifyMode || !r.clarify))), [scoped, showDone, clarifyMode]);
  const tone = group?.dir === 'OUT' ? 'expense' : 'income';
  const [clarifyAsk, setClarifyAsk] = useState<BankGroupRow[] | null>(null);

  const free = rows.filter((r) => !r.post && !r.dismissed);
  const selected = sel ?? new Set(free.map((r) => rk(r.account, r.id)));
  const setSelected = (fn: (s: Set<string>) => Set<string>) => setSel(fn(selected));
  const picked = free.filter((r) => selected.has(rk(r.account, r.id)));
  const pickedTotal = picked.reduce((s, r) => s + BigInt(r.amountTiyin), 0n);
  // Belgilanganlarning oldingi tanlovi: hammasiniki bir xil — panelga qo'yiladi; har xil — ogohlantiriladi
  const pickedSug = commonOf(picked.map((r) => r.suggestion));
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
    const keys = list.filter((r) => !r.post && !r.dismissed).map((r) => rk(r.account, r.id));
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

  /** Yo'naltirmasdan ro'yxatdan chiqarish (masalan, avval qo'lda kiritilgan) — hech qanday yozuv yaratilmaydi / o'chirilmaydi */
  async function dismiss() {
    setBusy(true);
    try {
      const r = (await api.dismiss(picked.map((x) => ({ account: x.account, rowId: x.id })), dismissReason.trim() || undefined)).data;
      onToast({ message: `Ro'yxatdan chiqarildi: ${r.count} ta · ${formatTiyin(r.totalTiyin)} so'm (yozuv yaratilmadi)`, tone: 'success' });
      setDismissReason('');
      setSel(null);
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "Chiqarib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
      setDismissAsk(false);
    }
  }

  /** Bitta to'lovni bekor qilish (kiritmayman) — darhol, qaytarish mumkin */
  async function skipOne(r: BankGroupRow) {
    setBusy(true);
    try {
      await api.dismiss([{ account: r.account, rowId: r.id }], dismissReason.trim() || 'Kiritilmaydi (tahlilda bekor qilindi)');
      onToast({ message: `Bekor qilindi: ${formatDate(r.docDate)} · ${formatTiyin(r.amountTiyin)} so'm — ro'yxatdan chiqdi (hech narsa yozilmadi)`, tone: 'success' });
      setSel(null);
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "Bekor qilib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }


  async function toClarify(list: BankGroupRow[], note: string) {
    setBusy(true);
    try {
      const r = (await api.clarify(list.map((x) => ({ account: x.account, rowId: x.id })), note.trim() || undefined)).data;
      onToast({ message: `Aniqlashtirishga o'tkazildi: ${r.count} ta · ${formatTiyin(r.totalTiyin)} so'm`, tone: 'success' });
      setClarifyAsk(null);
      setSel(null);
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "O'tkazib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function unclarify(r: BankGroupRow) {
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

  async function undismiss(r: BankGroupRow) {
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

  async function unroute() {
    if (!unrouteId) return;
    setBusy(true);
    try {
      const r = (await api.unroute({ ids: [unrouteId] })).data;
      onToast({ message: `Yo'naltirish bekor qilindi: ${r.count} ta yozuv o'chirildi`, tone: 'success' });
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Bekor qilib bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(false);
      setUnrouteId(null);
    }
  }

  const months = v.months.filter((p) => rows.some((r) => periodOf(r) === p));
  const allMonths = v.months.filter((p) => allRows.some((r) => periodOf(r) === p));

  return (
    <Drawer
      open={group !== null}
      onClose={onClose}
      title={group ? `${group.name ?? group.counterparty}${focus ? ` · ${formatPeriod(focus)}` : ''}` : ''}
      description={group ? `${group.name ? `${group.counterparty} · ` : ''}${DIR_LABEL[group.dir]} · ${group.kindLabel} · ${PATTERN_LABEL[group.pattern].toLowerCase()} · ${group.count} ta · ${formatTiyin(group.totalTiyin)} so'm · ${formatDate(group.firstDate)} – ${formatDate(group.lastDate)}` : undefined}
      width="xl"
    >
      {group && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <MiniStat label="O'rtacha (faol oyda)" value={formatTiyin(group.avgTiyin)} />
            <MiniStat label="Faol oylar" value={`${group.activeMonths} / ${v.months.length}`} />
            <MiniStat label="Ulushi" value={`${group.sharePct.toFixed(1)}%`} />
            <MiniStat label="Ko'rib chiqilgan" value={`${group.postedCount + group.dismissedCount} / ${group.count}`} />
          </div>
          {/* Belgilab kiritish: pastda belgilangan to'lovlar → joy, modda, tur → yo'naltirish */}
          {isAdmin && (
            <div className="rounded-(--radius-control) border border-brand-200 bg-brand-50/40 p-3">
              <RoutePanel key={`${data.data ? 'ready' : 'wait'}|${pickedSug.suggestion?.combo ?? ''}`} suggestion={pickedSug.suggestion} mixed={pickedSug.mixed} group={group} items={picked.map((r) => ({ account: r.account, rowId: r.id }))} totalTiyin={pickedTotal.toString()} beforeRoute={async () => true} onToast={onToast} onDone={() => { setSel(null); reload(); }} />
            </div>
          )}

          {/* Oylar: bosib — faqat shu oy to'lovlari */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Chip active={!focus} onClick={() => setFocus(null)}>
              Hamma oylar <span className="money opacity-70">{allRows.length}</span>
            </Chip>
            {allMonths.map((p) => (
              <Chip key={p} active={focus === p} onClick={() => setFocus(focus === p ? null : p)}>
                {formatPeriod(p)} <span className="money opacity-70">{group.countByMonth[p] ?? 0}</span>
              </Chip>
            ))}
          </div>
          {!focus && <MonthsTable periods={v.months} byMonth={group.byMonth} countByMonth={group.countByMonth} cumulative={group.cumulative} />}

          {isAdmin && (
            <div className="space-y-2 rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted)/50 p-3 text-xs">
              <p className="text-(--color-text-muted)">
                Kiritmoqchi bo&apos;lmasangiz (masalan, avval qo&apos;lda kiritgansiz) — <b className="text-heading">«Bekor qilish»</b>: hech qanday yozuv yaratilmaydi, to&apos;lov <b className="text-heading">«Bekor qilinganlar»</b> yorlig&apos;iga o&apos;tadi — u yerdan qaytarish yoki butunlay o&apos;chirish mumkin. Har to&apos;lov yonida ham shu tugma bor.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input value={dismissReason} onChange={(e) => setDismissReason(e.target.value)} maxLength={300} placeholder="Sabab (ixtiyoriy): masalan, avval qo'lda kiritilgan" className={cn(INPUT, 'min-w-64 flex-1')} />
                <Button size="sm" variant="secondary" disabled={!picked.length || busy} onClick={() => setDismissAsk(true)}>
                  Tanlanganlarni bekor qilish ({picked.length})
                </Button>
              </div>
            </div>
          )}

          {/* Ko'rib chiqilganlar — yo'naltirilgan va ro'yxatdan chiqarilganlar (sukut bo'yicha yashirin) */}
          {doneCount > 0 && (
            <label className="flex items-center gap-2 text-xs text-(--color-text-muted)">
              <input type="checkbox" className="size-4 accent-brand-600" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
              Ko&apos;rib chiqilganlarni ham ko&apos;rsatish ({doneCount} ta: yo&apos;naltirilgan yoki ro&apos;yxatdan chiqarilgan)
            </label>
          )}
          {data.data && !rows.length && (
            <p className="rounded-(--radius-control) bg-(--color-income-soft) px-3 py-3 text-sm font-medium text-(--color-income)">
              ✓ {focus ? `${formatPeriod(focus)}: ` : ''}hammasi ko&apos;rib chiqildi — ro&apos;yxatda qolgan to&apos;lov yo&apos;q.
            </p>
          )}

          {data.loading && !data.data ? (
            <LoadingState />
          ) : data.error ? (
            <ErrorState message={data.error} onRetry={data.reload} />
          ) : (
            <div className="space-y-3">
              {months.map((p) => {
                const list = rows.filter((r) => periodOf(r) === p);
                const freeKeys = list.filter((r) => !r.post && !r.dismissed).map((r) => rk(r.account, r.id));
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
                        return (
                          <li key={k} className={cn('px-3 py-2', selected.has(k) && !r.post && !r.dismissed && 'bg-brand-50/40', r.dismissed && 'opacity-70')}>
                            <span className="flex flex-wrap items-center gap-2 text-sm">
                              {isAdmin && !r.post && !r.dismissed && <input type="checkbox" className="size-4 accent-brand-600" checked={selected.has(k)} onChange={() => toggle(k)} aria-label="Tanlash" />}
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
                              {r.inn && <span className="money text-[11px] whitespace-nowrap text-heading">ИНН {r.inn}</span>}
                              <Money tiyin={r.amountTiyin} tone={tone} />
                              {isAdmin && !r.post && !r.dismissed && !r.clarify && !clarifyMode && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => setClarifyAsk([r])}
                                  title="Aniq tahlil talab qiladi — «Aniqlashtirishda» ro'yxatiga o'tadi, tuzatilgach kiritiladi"
                                  className="rounded-(--radius-control) border border-amber-400 bg-white px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                                >
                                  Aniqlashtirish
                                </button>
                              )}
                              {isAdmin && !r.post && !r.dismissed && (
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => void skipOne(r)}
                                  title="Kiritmayman — «Bekor qilinganlar»ga o'tadi (hech narsa yozilmaydi; u yerdan qaytarish yoki butunlay o'chirish mumkin)"
                                  className="rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 py-0.5 text-xs font-medium text-(--color-text-muted) hover:border-(--color-expense) hover:text-(--color-expense) disabled:opacity-50"
                                >
                                  Bekor qilish
                                </button>
                              )}
                            </span>
                            <p className="mt-1 text-xs leading-snug whitespace-pre-wrap text-(--color-text)">
                              <span className="text-[10px] font-semibold uppercase tracking-wide text-(--color-text-faint)">{r.invoiceId ? 'Fakturada: ' : 'Bankda: '}</span>
                              {r.purpose || '—'}
                            </p>
                            {r.invoiceId && <InvoiceDetails r={r} />}
                            {!r.post && !r.dismissed && r.suggestion && (
                              <div className="mt-1">
                                <SuggestBadge s={r.suggestion} />
                              </div>
                            )}
                            {/* Avval saqlangan izoh — faqat ko'rish uchun (yo'naltirilsa, yozuv izohi shu bo'ladi) */}
                            {r.note && <p className="mt-1 text-xs text-heading">Izoh: {r.note}</p>}
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
                                    Yo&apos;naltirishni bekor qilish
                                  </button>
                                )}
                              </p>
                            )}
                            {r.clarify && (
                              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                                <Badge tone="warn" className="px-1.5 py-0 text-[10px]">
                                  Aniqlashtirishda
                                </Badge>
                                {r.clarify.reason && <span className="text-amber-800">{r.clarify.reason}</span>}
                                <span className="text-(--color-text-faint)">
                                  {formatDateTime(r.clarify.at)} · {r.clarify.by}
                                </span>
                                {isAdmin && (
                                  <button type="button" disabled={busy} className="font-medium text-brand-700 hover:underline disabled:opacity-50" onClick={() => void unclarify(r)}>
                                    Ish ro&apos;yxatiga qaytarish
                                  </button>
                                )}
                              </p>
                            )}
                            {r.dismissed && (
                              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                                <Badge tone="neutral" className="px-1.5 py-0 text-[10px]">
                                  Ro&apos;yxatdan chiqarilgan
                                </Badge>
                                {r.dismissed.reason && <span className="text-heading">{r.dismissed.reason}</span>}
                                <span className="text-(--color-text-faint)">
                                  {formatDateTime(r.dismissed.at)} · {r.dismissed.by}
                                </span>
                                {isAdmin && (
                                  <button type="button" disabled={busy} className="font-medium text-brand-700 hover:underline disabled:opacity-50" onClick={() => void undismiss(r)}>
                                    Ro&apos;yxatga qaytarish
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
      {clarifyAsk && <ClarifyDialog rows={clarifyAsk} busy={busy} onConfirm={(note) => void toClarify(clarifyAsk, note)} onCancel={() => setClarifyAsk(null)} />}
      <ConfirmDialog
        open={dismissAsk}
        title="Bekor qilish — kiritmayman"
        message={`${picked.length} ta to'lov (${formatTiyin(pickedTotal.toString())} so'm) yo'naltirilmaydi va ro'yxatdan chiqariladi. Xarajat / daromad yozuvi yaratilmaydi. To'lovlar «Bekor qilinganlar» yorlig'iga o'tadi — u yerdan qaytarish yoki butunlay o'chirish mumkin.`}
        confirmLabel="Chiqarish"
        loading={busy}
        onConfirm={() => void dismiss()}
        onCancel={() => setDismissAsk(false)}
      />
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

const BASIS_LABEL: Record<RouteSuggestion['basis'], string> = { CONTRACT: 'shu shartnomani', GROUP: "shu guruhni (bir xil izoh)", SIMILAR: "izohi o'xshash to'lovni", COUNTERPARTY: 'shu kontragentni (doim bir xil)' };
const suggestionText = (s: RouteSuggestion) => `${s.place.label} · ${s.categoryLabel} · ${s.section === 'DOIMIY' ? 'Doimiy' : 'Boshqa'}`;
/** Izoh mazmuni bo'yicha bo'lsa — o'xshashlik foizi va o'xshagan oldingi izoh (tekshirish uchun) */
const similarText = (s: RouteSuggestion) => (s.basis === 'SIMILAR' && s.score !== undefined ? `izoh o'xshashligi ${s.score}%${s.matched ? ` — avvalgi izoh: «${s.matched}»` : ''}` : '');

/** Bir nechta to'lovning umumiy oldingi tanlovi: hammasiniki bir xil bo'lsa — o'sha; har xil yoki bir qismida yo'q — mixed (taklif qo'yilmaydi) */
export function commonOf(list: (RouteSuggestion | null | undefined)[]): { suggestion: RouteSuggestion | null; mixed: boolean } {
  const has = list.filter((s): s is RouteSuggestion => Boolean(s));
  if (!has.length) return { suggestion: null, mixed: false };
  const mixed = has.length < list.length || has.some((s) => s.combo !== has[0]!.combo);
  return { suggestion: mixed ? null : has[0]!, mixed };
}

/** Ogohlantirish belgisi: oldingi tanlov qo'yilgan — ko'rib tasdiqlash kerak (ro'yxatlarda) */
export function SuggestBadge({ s, mixed = false }: { s: RouteSuggestion | null; mixed?: boolean }) {
  if (mixed)
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900" title="To'lovlarda oldingi tanlovlar har xil (masalan, turli shartnomalar) — alohida belgilab yo'naltiring">
        <IconAlert className="size-3" />
        Har xil oldingi tanlov — alohida belgilang
      </span>
    );
  if (!s) return null;
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900" title={`Avval ${BASIS_LABEL[s.basis]} ${formatDate(s.at)} da shunday yo'naltirgansiz${s.count > 1 ? `, ${s.count} marta` : ''}${similarText(s) ? `; ${similarText(s)}` : ''} — tekshirib tasdiqlang`}>
      <IconAlert className="size-3 shrink-0" />
      <span className="truncate">
        Avvalgidek: {suggestionText(s)}
        {s.basis === 'SIMILAR' && s.score !== undefined ? ` · ${s.score}% o'xshash` : ''}
      </span>
    </span>
  );
}

/** Tanlanganlarni yo'naltirish: joy, modda, bo'lim (Doimiy / Boshqa), umumiy izoh → tekshiruv (takror) → yozish */
/** Taklifdagi joy → joy tanlovi (Markaz — bo'limi, Hududlar — viloyati va tumani, yo'nalish — o'zi) */
function choiceOf(s: RouteSuggestion | null): MoveChoice {
  // Taklif bo'lmasa — Markaz › Umumiy (hech qaysi bo'limga tegishli emas)
  if (!s) return CENTER_GENERAL;
  const p = s.place;
  if (p.unit === 'CENTER') return { target: p.unit, place: p.departmentId ? { departmentId: p.departmentId } : { general: true } };
  if (p.unit === 'REGION') return { target: p.unit, place: { ...(p.regionCode ? { regionCode: p.regionCode } : {}), ...(p.districtId ? { districtId: p.districtId } : {}) } };
  return { target: p.unit, place: {} };
}

/** Yo'naltirish paneli: guruh tafsilotida va «Ajralib turganlar»da (group — faqat yo'nalish, takrorlanish va nom kerak) */
export function RoutePanel({ group, suggestion, mixed = false, items, totalTiyin, beforeRoute, onToast, onDone }: { group: Pick<BankGroup, 'dir' | 'pattern' | 'name'>; suggestion: RouteSuggestion | null; mixed?: boolean; items: BankItem[]; totalTiyin: string; beforeRoute: () => Promise<boolean>; onToast: ToastFn; onDone: () => void }) {
  const { api } = useSource();
  // Boshlang'ich qiymat — oldingi yo'naltirishdan taklif, bo'lmasa Markaz › Umumiy; o'zgartirish yoki tozalash mumkin
  const [choice, setChoice] = useState<MoveChoice>(() => choiceOf(suggestion));
  const [category, setCategory] = useState(suggestion?.categoryCode ?? '');
  // Muntazam — Doimiy; bir martalik va vaqti-vaqti bilan — Boshqa (o'zgartirish mumkin)
  const [section, setSection] = useState<'DOIMIY' | 'BOSHQA'>(suggestion?.section ?? (group.pattern === 'REGULAR' ? 'DOIMIY' : 'BOSHQA'));
  const [usedSuggestion, setUsedSuggestion] = useState(Boolean(suggestion));
  const clearSuggestion = () => {
    setChoice(CENTER_GENERAL);
    setCategory('');
    setSection(group.pattern === 'REGULAR' ? 'DOIMIY' : 'BOSHQA');
    setUsedSuggestion(false);
  };
  const [description, setDescription] = useState('');
  const unitLists = useUnitCategories('expense');
  const [check, setCheck] = useState<BankCheck | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const placeLabel = useChoiceLabel(choice);
  const ready = choiceReady(choice);
  const opts = useAsync(() => (ready ? api.options(group.dir, choice.target).then((r) => r.data) : Promise.resolve(null)), [group.dir, choice.target, ready]);
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
  // Depozit, ustav fondi — daromad emas, «Hisobga olinmaydigan tushumlar»ga yoziladi
  const excluded = cat.startsWith('EXCL:');
  const can = items.length > 0 && ready && Boolean(cat);

  async function start() {
    if (!can) return;
    setBusy(true);
    try {
      if (!(await beforeRoute())) return;
      const c = (await api.check(items)).data;
      // Takror tekshiruvi daromad yozuvlariga qarab — hisobga olinmaydiganda kerak emas
      setCheck(excluded ? { ...c, duplicates: [] } : c);
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
        await api.route({
          items,
          place: { unit: choice.target, ...choice.place },
          categoryCode: cat,
          section,
          description: description.trim() || undefined,
          skipDuplicates: mode === 'skip',
          // Taklif ko'rsatilgan bo'lsa — server yakuniy tanlov bilan solishtiradi (o'zgarishsiz qabul qilindimi)
          ...(suggestion ? { suggested: { combo: suggestion.combo, basis: suggestion.basis, ...(suggestion.score !== undefined ? { score: suggestion.score } : {}) } } : {}),
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
      {/* Oldingi tanlov qo'yildi — ogohlantirish: ko'rib, kerak bo'lsa o'zgartirib, tasdiqlanadi */}
      {suggestion && usedSuggestion && (
        <p className="flex flex-wrap items-center gap-1.5 rounded-(--radius-control) border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900">
          <IconAlert className="size-4 shrink-0" />
          <span>
            <b>Avvalgidek qo&apos;yildi — tekshirib tasdiqlang:</b> <b className="text-heading">{suggestionText(suggestion)}</b> ({BASIS_LABEL[suggestion.basis]} oxirgi marta {formatDate(suggestion.at)} da shunday yo&apos;naltirgansiz
            {suggestion.count > 1 ? `, ${suggestion.count} marta` : ''}
            {similarText(suggestion) ? `; ${similarText(suggestion)}` : ''})
          </span>
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={clearSuggestion}>
            Tozalash
          </button>
        </p>
      )}
      {mixed && (
        <p className="flex items-center gap-1.5 rounded-(--radius-control) border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-900">
          <IconAlert className="size-4 shrink-0" />
          Belgilangan to&apos;lovlarning oldingi tanlovlari har xil (masalan, turli shartnomalar) — bir xil «Avvalgidek» belgisi borlarini alohida belgilang.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {/* Avval joy: Markaz (bo'limi yoki Umumiy), Hududlar, yo'nalishlar */}
        <PlacePicker value={choice} onChange={setChoice} allowGeneral />
        {group.dir === 'OUT' ? (
          // Xarajat moddasi: yozilganda avtomatik qidiradi; «+» — yangi modda (doimiy ro'yxatga, manbada qoladi)
          <ModdaPicker
            size="sm"
            className="max-w-80 min-w-56 flex-1"
            options={cats}
            value={cat}
            onChange={setCategory}
            disabled={!ready || opts.loading}
            placeholder={!ready ? 'Avval joyni tanlang' : opts.loading ? 'Yuklanmoqda…' : 'Xarajat moddasi…'}
            onCreated={async (created) => {
              try {
                // Joyning ro'yxati cheklangan bo'lsa — yangi modda unga ham qo'shiladi (aks holda yo'naltirib bo'lmaydi)
                if (opts.data?.limited) await unitCategoriesApi.set('expense', choice.target, [...(unitLists.lists.get(choice.target) ?? []), created.code]);
                unitLists.reload();
                opts.reload();
                onToast({ message: `Modda qo'shildi: «${created.label}» — tanlandi`, tone: 'success' });
              } catch (err) {
                onToast({ message: errorMessage(err, "Moddani bo'lim ro'yxatiga qo'shib bo'lmadi"), tone: 'error' });
              }
            }}
          />
        ) : (
        <select value={cat} onChange={(e) => setCategory(e.target.value)} disabled={!ready || opts.loading} className={cn(INPUT, 'max-w-72')} aria-label="Daromad turi">
          <option value="">{!ready ? 'Avval joyni tanlang' : opts.loading ? 'Yuklanmoqda…' : 'Daromad turi…'}</option>
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
        )}
        {!excluded && (
          <select value={section} onChange={(e) => setSection(e.target.value === 'BOSHQA' ? 'BOSHQA' : 'DOIMIY')} className={INPUT} aria-label="Tur">
            <option value="DOIMIY">Doimiy</option>
            <option value="BOSHQA">Boshqa (bir martalik)</option>
          </select>
        )}
      </div>
      {excluded && <p className="text-amber-700">Daromad emas: «Daromadlar › Hisobga olinmaydi»ga yoziladi — jami daromad, natija va hisobotlarga qo&apos;shilmaydi.</p>}
      {ready && opts.data?.limited && <p className="text-(--color-text-faint)">Faqat «{placeLabel}» ro&apos;yxatidagi moddalar ko&apos;rsatilmoqda («+» bilan qo&apos;shilgan modda shu ro&apos;yxatga ham yoziladi).</p>}
      <div className="flex flex-wrap items-center gap-2">
        <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder={group.name ? `Umumiy izoh (bo'sh bo'lsa — «${group.name}»)` : "Umumiy izoh (o'z izohi yozilmagan to'lovlar uchun, ixtiyoriy)"} className={cn(INPUT, 'min-w-64 flex-1')} />
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
        title={excluded ? 'Hisobga olinmaydigan tushum sifatida yozish' : `${what[0]!.toUpperCase()}${what.slice(1)} sifatida yozish`}
        message={
          excluded
            ? `${check?.count ?? 0} ta to'lov (${formatTiyin(check?.totalTiyin ?? '0')} so'm) «${cats.find((c) => c.code === cat)?.label ?? ''}» bo'lib «Daromadlar › Hisobga olinmaydi»ga yoziladi — daromadga QO'SHILMAYDI. Sana — to'lov sanasi. Keyin bekor qilish mumkin.`
            : `${check?.count ?? 0} ta to'lov (${formatTiyin(check?.totalTiyin ?? '0')} so'm) «${placeLabel}» ga «${cats.find((c) => c.code === cat)?.label ?? ''}» bo'yicha ${what} bo'lib yoziladi (${section === 'DOIMIY' ? 'Doimiy' : 'Boshqa'}). Sana va oy — to'lov sanasi. Keyin bekor qilish mumkin.`
        }
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
  const { api } = useSource();
  const [target, setTarget] = useState<BankPostBatch | null>(null);
  const [busy, setBusy] = useState(false);
  if (!list.length) return null;

  async function cancel() {
    if (!target) return;
    setBusy(true);
    try {
      const r = (await api.unroute({ batch: target.batch })).data;
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
            <Badge tone={b.entryType === 'EXPENSE' ? 'expense' : b.entryType === 'EXCLUDED' ? 'neutral' : 'income'}>{ENTRY_LABEL[b.entryType]}</Badge>
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

/** Faktura qatori tafsiloti: holat, shartnoma, IKPU, miqdor, QQS */
function InvoiceDetails({ r }: { r: BankRow }) {
  const ikpu = (r.ikpu ?? '').replace(/^\s*(\d{5,17})\s*-\s*/, '');
  const code = /^\s*(\d{5,17})/.exec(r.ikpu ?? '')?.[1];
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-(--color-text-muted)">
      {r.status && <Badge tone={r.status === 'Подписан' ? 'income' : 'warn'} className="px-1.5 py-0 text-[10px]">{r.status}</Badge>}
      {r.docType && r.docType !== 'Стандартный' && <span>{r.docType}</span>}
      {r.contract && <span>Shartnoma: <b className="text-heading">{r.contract}</b>{r.contractDate ? ` (${formatDate(r.contractDate)})` : ''}</span>}
      {ikpu && <span title={r.ikpu}>IKPU: {code ? <span className="money">{code}</span> : null} {ikpu.slice(0, 80)}</span>}
      {r.qty !== null && r.qty !== undefined && <span>{r.qty} {r.unit ?? ''}</span>}
      {r.vatTiyin && r.vatTiyin !== '0' && <span>QQS{r.vatRate !== null && r.vatRate !== undefined ? ` ${r.vatRate}%` : ''}: <span className="money">{formatTiyin(r.vatTiyin)}</span></span>}
      {r.period && r.period !== r.docDate.slice(0, 7) && <span className="text-(--color-warn)">xizmat oyi: {formatPeriod(r.period)}</span>}
      {r.ourBranch && <span>bizda: {r.ourBranch}</span>}
    </p>
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

/** Guruh turi: qayerdan va nega (sichqoncha bilan); aniqlanmagan — ogohlantirish rangida; aralash guruh — belgi */
export function KindBadge({ g, small = false }: { g: BankGroup; small?: boolean }) {
  const unsure = g.kindSource === 'NONE';
  const size = small ? 'px-1.5 py-0 text-[10px]' : undefined;
  const title = [g.kindReason, g.kindSource ? `Manba: ${KIND_SOURCE_LABEL[g.kindSource]}` : '', g.kindMixed ? 'Guruhda boshqa turdagi to‘lovlar ham bor' : ''].filter(Boolean).join('\n');
  return (
    <span className="inline-flex items-center gap-1" title={title || undefined}>
      <Badge tone={unsure ? 'warn' : 'brand'} className={size}>
        {g.kindLabel}
        {unsure ? ' · aniqlanmadi' : g.kindSource === 'MANUAL' ? ' ✎' : ''}
      </Badge>
      {g.kindMixed && (
        <Badge tone="neutral" className={size}>
          aralash
        </Badge>
      )}
    </span>
  );
}

/** Tur qoidalari: «izohda X bo'lsa → Y» — bank va faktura uchun bitta ro'yxat; siz bergan guruh turi ulardan ustun */
export function KindRulesCard({ isAdmin, onToast, onChanged }: { isAdmin: boolean; onToast: ToastFn; onChanged: () => void }) {
  const { api, dirLabel } = useSource();
  const list = useAsync(() => api.kindRules().then((r) => r.data), [api]);
  const [ruleText, setRuleText] = useState('');
  const [kind, setKind] = useState<BankKind | ''>('');
  const [dir, setDir] = useState<BankDir | ''>('OUT');
  const [busy, setBusy] = useState(false);
  const [delId, setDelId] = useState<string | null>(null);

  async function add() {
    if (!kind) return;
    setBusy(true);
    try {
      const r = (await api.addKindRule({ text: ruleText.trim(), kind, dir: dir || null })).data;
      onToast({ message: r.updated ? 'Qoida turi almashtirildi' : 'Qoida qo‘shildi — hamma guruhlarga qo‘llanadi', tone: 'success' });
      setRuleText('');
      list.reload();
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Qoidani saqlab bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api.deleteKindRule(id);
      onToast({ message: 'Qoida o‘chirildi', tone: 'success' });
      list.reload();
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, 'O‘chirib bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(false);
      setDelId(null);
    }
  }

  const rules = list.data ?? [];
  return (
    <Card>
      <CardHeader title="Tur qoidalari" description="Izohda shu matn bo'lsa — shu tur (bank ko'chirmasi va schyot-fakturalar uchun bitta ro'yxat). Guruhga o'zingiz bergan tur qoidadan ustun." />
      <div className="space-y-3 px-5 pb-4 text-sm">
        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2">
            <input value={ruleText} onChange={(e) => setRuleText(e.target.value)} maxLength={200} placeholder="Izohdagi matn (masalan: аренда склада)" className={cn(INPUT, 'min-w-56 flex-1')} aria-label="Qoida matni" />
            <select value={kind} onChange={(e) => setKind(e.target.value as BankKind | '')} className={INPUT} aria-label="Tur">
              <option value="">Turni tanlang</option>
              {KIND_OPTIONS.map((k) => (
                <option key={k.code} value={k.code}>
                  {k.label}
                </option>
              ))}
            </select>
            <select value={dir} onChange={(e) => setDir(e.target.value as BankDir | '')} className={INPUT} aria-label="Yo'nalish">
              <option value="OUT">Faqat: {dirLabel.OUT.toLowerCase()}</option>
              <option value="IN">Faqat: {dirLabel.IN.toLowerCase()}</option>
              <option value="">Ikkalasi</option>
            </select>
            <Button size="sm" loading={busy} disabled={!kind || ruleText.trim().length < 3} onClick={() => void add()}>
              Qo&apos;shish
            </Button>
          </div>
        )}
        {list.loading && !list.data ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : rules.length ? (
          <ul className="divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line)">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                <span className="font-medium text-heading">«{r.text}»</span>
                <span className="text-(--color-text-faint)">→</span>
                <Badge tone="brand">{r.kindLabel}</Badge>
                <span className="text-xs text-(--color-text-muted)">
                  {r.dir ? dirLabel[r.dir].toLowerCase() : 'ikkalasi'} · {r.createdBy || '—'} · {formatDateTime(r.createdAt)}
                </span>
                {isAdmin && (
                  <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => setDelId(r.id)}>
                    O&apos;chirish
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-(--color-text-muted)">Qoida yo&apos;q — tur izohdagi so&apos;zlar, IKPU va kontragent xotirasi bo&apos;yicha aniqlanadi.</p>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(delId)}
        title="Qoidani o'chirish"
        message="Shu qoida bo'yicha aniqlangan guruhlar avtomatik turga qaytadi."
        confirmLabel="O'chirish"
        danger
        loading={busy}
        onConfirm={() => {
          if (delId) void remove(delId);
        }}
        onCancel={() => setDelId(null)}
      />
    </Card>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full border px-3 py-1 text-xs font-medium', active ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:text-heading')}>
      {children}
    </button>
  );
}

