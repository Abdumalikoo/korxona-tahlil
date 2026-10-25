'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconSearch } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { reconcileApi, type ReconAllocateItem, type ReconAdjustment, type ReconRow, type ReconState, type ReconView } from '@/features/salary-composition/api';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Uchlik nazorat: TARKIB · SOLIQ HISOBOTI · 23106 (bank).
// Har xodim: tarkib jami, soliq hisobotidagi summa, farq va shu oy 23106 dan to'langanlar (bayram, mukofot …).
// Farq bo'lsa — dastur qayerga o'tkazishni tavsiya qiladi (masalan: bankda mukofot bor, tarkibda yo'q → «Mukofot»);
// foydalanuvchi komponentni tanlaydi (yoki tavsiyani qabul qiladi) va «O'tkazish»ni bosadi — farq tarkibga qo'shiladi.
// Har o'tkazish tarixda turadi va bekor qilinadi.
// ═══════════════════════════════════════════════════════════

type Filter = 'PROBLEM' | 'DIFF' | 'NO_TARKIB' | 'NO_SOLIQ' | 'BANK' | 'ALL';
type Choice = { code: string; amount: string };

const STATE: Record<ReconState, { label: string; tone: 'income' | 'expense' | 'warn' | 'neutral' | 'brand'; hint: string }> = {
  OK: { label: 'Mos', tone: 'income', hint: 'Tarkib = soliq hisoboti; 23106 to‘lovlari tarkibda bor' },
  DIFF: { label: 'Farq', tone: 'expense', hint: 'Tarkib jami soliq hisobotidan farq qiladi' },
  NO_TARKIB: { label: 'Tarkibda yo‘q', tone: 'expense', hint: 'Soliq hisobotida bor, tarkibda bu xodim yo‘q' },
  NO_SOLIQ: { label: 'Soliqda yo‘q', tone: 'warn', hint: 'Tarkibda bor, soliq hisobotida yo‘q' },
  BANK: { label: 'Bank', tone: 'warn', hint: 'Summalar mos, lekin 23106 da tarkibda yo‘q yoki undan ko‘p to‘lov bor' },
  NO_PAYROLL: { label: 'Soliq yuklanmagan', tone: 'neutral', hint: 'Shu oy soliq hisoboti yuklanmagan' },
};

const PART_TONE = { OK: 'text-(--color-income)', MISSING: 'text-(--color-expense)', OVER: 'text-(--color-warn)', NA: 'text-(--color-text-muted)' } as const;
const PART_HINT = { OK: 'tarkibda bor', MISSING: 'tarkibda yo‘q', OVER: 'tarkibdagidan ko‘p to‘langan', NA: 'tarkib bilan solishtirilmaydi' } as const;

/** Tiyin → kiritish maydoni (so'm, kerak bo'lsa tiyini bilan) */
function toInput(tiyin: string | null): string {
  if (!tiyin) return '';
  const v = BigInt(tiyin);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = (a / 100n).toString() + (a % 100n ? `.${String(a % 100n).padStart(2, '0')}` : '');
  return (neg ? '-' : '') + s;
}

/** Kiritilgan so'm → tiyin (null — noto'g'ri) */
function parseSum(raw: string): string | null {
  const s = raw.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const v = BigInt(i!) * 100n + BigInt((f + '00').slice(0, 2));
  return v === 0n ? null : (neg ? -v : v).toString();
}

export function ReconcileCard({ period, unit, isAdmin, stamp, onChanged, onSelect, onToast }: { period: string; unit?: string; isAdmin: boolean; stamp: unknown; onChanged: () => void; onSelect: (pinfl: string) => void; onToast: (t: { message: string; tone: 'success' | 'error' }) => void }) {
  const data = useAsync(() => reconcileApi.view(period, unit).then((r) => r.data), [period, unit, stamp]);
  const v = data.data;
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>('PROBLEM');
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [undoTarget, setUndoTarget] = useState<ReconAdjustment | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Yangi ma'lumot: har farqli xodimga boshlang'ich tanlov — tavsiya (bo'lsa) va farq summasi
  const [seen, setSeen] = useState<ReconView | null>(null);
  if (v && v !== seen) {
    setSeen(v);
    const c: Record<string, Choice> = {};
    for (const r of v.rows) if (r.diffTiyin && r.state !== 'OK' && r.state !== 'BANK') c[r.pinfl] = { code: r.suggestion?.componentCode ?? '', amount: toInput(r.diffTiyin) };
    setChoices(c);
    setPicked(new Set());
  }

  const ready = (r: ReconRow) => {
    const c = choices[r.pinfl];
    return Boolean(c?.code && parseSum(c.amount));
  };
  const shown = useMemo(() => {
    if (!v) return [];
    const t = q.trim().toLowerCase();
    return v.rows.filter((r) => {
      if (filter === 'PROBLEM' && r.state === 'OK') return false;
      if (filter !== 'PROBLEM' && filter !== 'ALL' && r.state !== filter) return false;
      return !t || r.fullName.toLowerCase().includes(t) || r.pinfl.includes(t);
    });
  }, [v, filter, q]);

  if (data.loading && !v) return <Card><LoadingState /></Card>;
  if (data.error) return <Card><ErrorState message={data.error} onRetry={data.reload} /></Card>;
  if (!v) return null;

  const s = v.summary;
  const problems = s.diff + s.noTarkib + s.noSoliq + s.bank;
  const counts: Record<Filter, number> = { PROBLEM: problems, DIFF: s.diff, NO_TARKIB: s.noTarkib, NO_SOLIQ: s.noSoliq, BANK: s.bank, ALL: v.rows.length };
  const chosen = v.rows.filter((r) => picked.has(r.pinfl) && ready(r));
  const chosenTotal = chosen.reduce((sum, r) => sum + BigInt(parseSum(choices[r.pinfl]!.amount)!), 0n);
  const strongRows = v.rows.filter((r) => r.suggestion?.confidence === 'STRONG');
  const canAct = isAdmin && v.compositionUploaded;
  const compName = (code: string) => v.components.find((c) => c.code === code)?.name ?? code;
  const byCategory = [...new Map(v.components.map((c) => [c.categoryLabel, v.components.filter((x) => x.categoryLabel === c.categoryLabel)])).entries()];

  function setChoice(pinfl: string, patch: Partial<Choice>) {
    setChoices((c) => ({ ...c, [pinfl]: { code: c[pinfl]?.code ?? '', amount: c[pinfl]?.amount ?? '', ...patch } }));
  }

  function toItem(r: ReconRow): ReconAllocateItem {
    const c = choices[r.pinfl]!;
    const amountTiyin = parseSum(c.amount)!;
    const fromSuggestion = r.suggestion && r.suggestion.componentCode === c.code && r.suggestion.amountTiyin === amountTiyin;
    return { pinfl: r.pinfl, componentCode: c.code, amountTiyin, source: fromSuggestion ? 'SUGGESTION' : 'MANUAL' };
  }

  async function send(items: ReconAllocateItem[], one?: string) {
    if (one) setBusyRow(one);
    else setSaving(true);
    try {
      const res = (await reconcileApi.allocate(period, items, unit)).data;
      onToast({ message: `O'tkazildi: ${res.count} xodim · ${formatTiyin(res.totalTiyin)} so'm — tarkib yangilandi`, tone: 'success' });
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, "O'tkazishda xatolik"), tone: 'error' });
    } finally {
      setBusyRow(null);
      setSaving(false);
      setAsking(false);
    }
  }

  async function handleUndo() {
    if (!undoTarget) return;
    setUndoing(true);
    try {
      await reconcileApi.undo(undoTarget.id);
      onToast({ message: "O'tkazish bekor qilindi — tarkib avvalgi holatiga qaytdi", tone: 'success' });
      onChanged();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Bekor qilishda xatolik'), tone: 'error' });
      data.reload();
    } finally {
      setUndoing(false);
      setUndoTarget(null);
    }
  }

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader
          title="Uchlik nazorat: tarkib · soliq hisoboti · 23106"
          description="Har xodim: tarkibdagi jami, soliq hisobotidagi summa va shu oy uchun 23106 dan to‘langanlar (bayram, mukofot, moddiy yordam …). Farq bo‘lsa — qayerga o‘tkazishni tanlang: farq tarkibning shu komponentiga qo‘shiladi."
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <Source ok={v.compositionUploaded} label="Ish haqi tarkibi" value={v.compositionUploaded ? `${formatTiyin(s.tarkibTiyin)} so'm` : 'yuklanmagan'} />
            <Source ok={v.payrollUploaded} label={unit ? `${v.unitLabel} ish haqi` : 'Soliq hisoboti'} value={v.payrollUploaded ? `${formatTiyin(s.soliqTiyin)} so'm` : 'yuklanmagan'} />
            <Source ok={v.bankUploaded} label="23106 (bank)" value={v.bankUploaded ? `${formatTiyin(s.bankNetTiyin)} so'm qo'lga` : "shu oy uchun ko'chirma yo'q"} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Box label="Farqli xodimlar" value={String(s.diff + s.noTarkib + s.noSoliq)} sub={`jami farq ${formatTiyin(s.diffTiyin)} so'm (soliq − tarkib)`} tone={s.diff + s.noTarkib + s.noSoliq ? 'expense' : 'income'} />
            <Box label="Tavsiya bor" value={String(s.suggested)} sub={s.strong ? `${s.strong} tasi ishonchli — bank to'lovi farqqa mos` : 'bank to‘lovlari bo‘yicha'} tone={s.suggested ? 'warn' : 'neutral'} />
            <Box label="Bank nazorati" value={String(s.bank)} sub="summa mos, lekin 23106 dagi to‘lov tarkibda yo‘q yoki ko‘p" tone={s.bank ? 'warn' : 'income'} />
            <Box label="Mos" value={String(s.ok)} sub={`${s.employees} xodimdan`} tone="income" />
          </div>
        </CardBody>

        <div className="flex flex-wrap items-center gap-2 border-y border-(--color-line) px-5 py-2.5">
          {(
            [
              ['PROBLEM', 'Muammoli'],
              ['DIFF', 'Farq'],
              ['NO_TARKIB', 'Tarkibda yo‘q'],
              ['NO_SOLIQ', 'Soliqda yo‘q'],
              ['BANK', 'Bank'],
              ['ALL', 'Hammasi'],
            ] as [Filter, string][]
          ).map(([k, label]) => (
            <Chip key={k} active={filter === k} onClick={() => setFilter(k)}>
              {label} <span className="money opacity-70">{counts[k]}</span>
            </Chip>
          ))}
          {canAct && strongRows.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setPicked(new Set(strongRows.filter((r) => ready(r)).map((r) => r.pinfl)))}>
              Ishonchli tavsiyalarni belgilash ({strongRows.length})
            </Button>
          )}
          <label className="relative ml-auto">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-(--color-text-faint)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="F.I.Sh. yoki PINFL" className="h-8 w-56 rounded-(--radius-control) border border-(--color-line-strong) bg-white pr-3 pl-8 text-sm focus:border-brand-600 focus:outline-none" />
          </label>
        </div>

        <div className="max-h-[680px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
              <tr>
                {canAct && <th className="w-10 px-3 py-2" />}
                <th className="px-2 py-2 text-left font-semibold">Xodim</th>
                <th className="w-32 px-2 py-2 text-right font-semibold">Tarkib</th>
                <th className="w-32 px-2 py-2 text-right font-semibold">{unit ? 'Ish haqi' : 'Soliq hisoboti'}</th>
                <th className="w-32 px-2 py-2 text-right font-semibold">Farq</th>
                <th className="w-56 px-2 py-2 text-left font-semibold">23106 (bank)</th>
                <th className="px-3 py-2 text-left font-semibold">Qayerga o‘tkazish</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const st = STATE[r.state];
                const c = choices[r.pinfl];
                const actionable = canAct && r.state !== 'OK' && r.state !== 'NO_PAYROLL' && r.state !== 'BANK';
                const amountOk = c ? Boolean(parseSum(c.amount)) : false;
                return (
                  <tr key={r.pinfl} className={cn('border-t border-(--color-line) align-top', (r.state === 'DIFF' || r.state === 'NO_TARKIB') && 'bg-(--color-expense-soft)/20')}>
                    {canAct && (
                      <td className="px-3 py-2.5">
                        {actionable && (
                          <input
                            type="checkbox"
                            aria-label="O'tkazishga belgilash"
                            className="size-4 accent-brand-600"
                            disabled={!ready(r)}
                            checked={picked.has(r.pinfl) && ready(r)}
                            onChange={() =>
                              setPicked((p) => {
                                const n = new Set(p);
                                if (n.has(r.pinfl)) n.delete(r.pinfl);
                                else n.add(r.pinfl);
                                return n;
                              })
                            }
                          />
                        )}
                      </td>
                    )}
                    <td className="px-2 py-2">
                      <button type="button" className="block text-left font-medium text-heading hover:text-brand-700 hover:underline" onClick={() => onSelect(r.pinfl)}>
                        {r.fullName}
                      </button>
                      <span className="flex flex-wrap items-center gap-1 text-[11px] text-(--color-text-muted)">
                        <span className="money">{r.pinfl}</span>
                        <span title={st.hint}>
                          <Badge tone={st.tone} className="px-1.5 py-0 text-[10px]">{st.label}</Badge>
                        </span>
                      </span>
                      {r.adjustments.length > 0 && (
                        <span className="mt-0.5 block text-[11px] text-(--color-income)">
                          o‘tkazilgan: {r.adjustments.map((a) => `${a.componentName} ${formatTiyin(a.amountTiyin)}`).join(', ')}
                        </span>
                      )}
                    </td>
                    <td className="money px-2 py-2 text-right">{r.tarkibTiyin === null ? <span className="text-(--color-text-faint)">—</span> : formatTiyin(r.tarkibTiyin)}</td>
                    <td className="money px-2 py-2 text-right">{r.soliqTiyin === null ? <span className="text-(--color-text-faint)">—</span> : formatTiyin(r.soliqTiyin)}</td>
                    <td className={cn('money px-2 py-2 text-right font-semibold', r.state === 'OK' || r.state === 'BANK' ? 'text-(--color-text-muted)' : BigInt(r.diffTiyin ?? '0') > 0n ? 'text-(--color-expense)' : 'text-(--color-warn)')}>
                      {r.diffTiyin === null || r.state === 'OK' || r.state === 'BANK' ? '—' : `${BigInt(r.diffTiyin) > 0n ? '+' : ''}${formatTiyin(r.diffTiyin)}`}
                    </td>
                    <td className="px-2 py-2">
                      {r.bank.length ? (
                        <ul className="space-y-0.5 text-[11px]">
                          {r.bank.map((b) => (
                            <li key={b.kind} title={`${PART_HINT[b.state]} · to'langan: ${b.dates.map(formatDate).join(', ')}${b.orders.length ? ` · buyruq ${b.orders.join(', ')}` : ''}${b.tarkibTiyin !== null ? ` · tarkibda ${formatTiyin(b.tarkibTiyin)}` : ''}`}>
                              <span className={cn('font-medium', PART_TONE[b.state])}>{b.label}</span>{' '}
                              <span className="money">{formatTiyin(b.netTiyin)}</span>
                              <span className="text-(--color-text-faint)"> · soliqdan oldin ≈ <span className="money">{formatTiyin(b.grossTiyin)}</span></span>
                              {b.state === 'MISSING' && <span className="text-(--color-expense)"> · tarkibda yo‘q</span>}
                              {b.state === 'OVER' && <span className="text-(--color-warn)"> · tarkibdan ko‘p</span>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-[11px] text-(--color-text-faint)">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {actionable ? (
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <select
                              aria-label="Komponent"
                              value={c?.code ?? ''}
                              onChange={(e) => setChoice(r.pinfl, { code: e.target.value })}
                              className={cn('h-8 max-w-[13rem] rounded-(--radius-control) border bg-white px-2 text-xs focus:border-brand-600 focus:outline-none', c?.code ? 'border-(--color-line-strong)' : 'border-brand-600')}
                            >
                              <option value="">Komponentni tanlang…</option>
                              {byCategory.map(([label, list]) => (
                                <optgroup key={label} label={label}>
                                  {list.map((x) => (
                                    <option key={x.code} value={x.code}>
                                      {x.name}
                                      {r.suggestion?.componentCode === x.code ? ' — tavsiya' : ''}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                            <input
                              aria-label="Summa (so'm)"
                              value={c?.amount ?? ''}
                              onChange={(e) => setChoice(r.pinfl, { amount: e.target.value })}
                              inputMode="decimal"
                              className={cn('money h-8 w-32 rounded-(--radius-control) border bg-white px-2 text-right text-xs focus:border-brand-600 focus:outline-none', amountOk ? 'border-(--color-line-strong)' : 'border-(--color-expense)')}
                            />
                            <Button size="sm" disabled={!ready(r) || saving} loading={busyRow === r.pinfl} onClick={() => void send([toItem(r)], r.pinfl)}>
                              O‘tkazish
                            </Button>
                          </div>
                          {r.suggestion ? (
                            <p className={cn('text-[11px]', r.suggestion.confidence === 'STRONG' ? 'text-(--color-income)' : 'text-(--color-warn)')}>
                              {r.suggestion.confidence === 'STRONG' ? 'Ishonchli tavsiya' : 'Taxminiy tavsiya'}: «{r.suggestion.componentName}» — {r.suggestion.reason}
                            </p>
                          ) : (
                            <p className="text-[11px] text-(--color-text-muted)">
                              {r.state === 'NO_SOLIQ' ? "Soliq hisobotida yo'q — tarkibdagi ortiqcha summani qaysi komponentdan ayirishni tanlang (manfiy summa)" : '23106 da mos to‘lov topilmadi — komponentni o‘zingiz tanlang'}
                            </p>
                          )}
                          {c?.code && !amountOk && <p className="text-[11px] text-(--color-expense)">Summani so‘mda kiriting (masalan, 1250000 yoki -500000)</p>}
                        </div>
                      ) : r.state === 'BANK' ? (
                        <p className="flex items-start gap-1 text-[11px] text-(--color-warn)">
                          <IconAlert className="mt-0.5 size-3.5 shrink-0" />
                          Jami mos — 23106 dagi to‘lov tarkibda boshqa komponentga yozilgan bo‘lishi mumkin. Tarkib faylini tekshiring.
                        </p>
                      ) : r.state === 'NO_PAYROLL' ? (
                        <span className="text-[11px] text-(--color-text-muted)">Soliq hisoboti yuklanmagan</span>
                      ) : (
                        <span className="text-[11px] text-(--color-text-faint)">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!shown.length && (
                <tr>
                  <td colSpan={canAct ? 7 : 6} className="py-6 text-center text-sm text-(--color-text-muted)">
                    {filter === 'PROBLEM' ? 'Muammo yo‘q — hamma xodimda tarkib, soliq hisoboti va bank mos' : 'Bu tanlovda xodim yo‘q'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canAct && counts.DIFF + counts.NO_TARKIB + counts.NO_SOLIQ > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3">
            <span className="text-sm text-(--color-text-muted)">
              Belgilangan: <b className="text-heading">{chosen.length}</b> xodim · <span className="money font-semibold text-heading">{formatTiyin(chosenTotal.toString())}</span> so‘m
            </span>
            <Button className="ml-auto" onClick={() => setAsking(true)} disabled={!chosen.length} loading={saving}>
              Belgilanganlarni o‘tkazish
            </Button>
          </div>
        )}
        {!v.compositionUploaded && (
          <p className="border-t border-(--color-line) px-5 py-3 text-xs text-(--color-text-muted)">Farqni o‘tkazish uchun avval shu oy ish haqi tarkibini yuklang.</p>
        )}

        {v.history.length > 0 && (
          <div className="border-t border-(--color-line)">
            <button type="button" className="w-full px-5 py-2.5 text-left text-sm font-medium text-heading hover:bg-(--color-surface-muted)" onClick={() => setShowHistory((x) => !x)}>
              O‘tkazishlar tarixi ({v.history.length}) {showHistory ? '▴' : '▾'}
            </button>
            {showHistory && (
              <ul className="divide-y divide-(--color-line) text-sm">
                {v.history.map((a) => (
                  <li key={a.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-2', !a.current && 'opacity-55')}>
                    <span className="min-w-0 flex-1">
                      <b className="text-heading">{a.fullName}</b> → «{a.componentName}»{a.note ? <span className="text-(--color-text-muted)"> · {a.note}</span> : null}
                    </span>
                    <span className={cn('money', BigInt(a.amountTiyin) < 0n ? 'text-(--color-warn)' : 'text-heading')}>{BigInt(a.amountTiyin) > 0n ? '+' : ''}{formatTiyin(a.amountTiyin)}</span>
                    <span className="text-xs text-(--color-text-muted)">
                      {formatDateTime(a.createdAt)} · {a.createdBy}
                      {a.source === 'SUGGESTION' ? ' · tavsiya' : ''}
                    </span>
                    {a.status === 'UNDONE' ? (
                      <Badge tone="neutral">bekor qilingan</Badge>
                    ) : a.status === 'STALE' || !a.current ? (
                      <Badge tone="neutral">tarkib qayta yuklangan</Badge>
                    ) : isAdmin ? (
                      <Button size="sm" variant="ghost" className="text-(--color-text-muted) hover:text-(--color-expense)" onClick={() => setUndoTarget(a)}>
                        Bekor qilish
                      </Button>
                    ) : (
                      <Badge tone="income">amalda</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={asking}
        title="Farqlarni tarkibga o‘tkazish"
        message={`${chosen.length} xodim farqi (${formatTiyin(chosenTotal.toString())} so'm) tanlangan komponentlarga qo'shiladi: ${[...new Set(chosen.map((r) => compName(choices[r.pinfl]!.code)))].join(', ')}. Tarkib jami soliq hisobotiga tenglashadi. Har birini keyin bekor qilish mumkin.`}
        confirmLabel="O‘tkazish"
        loading={saving}
        onConfirm={() => void send(chosen.map(toItem))}
        onCancel={() => setAsking(false)}
      />
      <ConfirmDialog
        open={undoTarget !== null}
        title="O‘tkazishni bekor qilish"
        message={`${undoTarget?.fullName ?? ''}: «${undoTarget?.componentName ?? ''}»ga o'tkazilgan ${undoTarget ? formatTiyin(undoTarget.amountTiyin) : ''} so'm tarkibdan olib tashlanadi.`}
        confirmLabel="Bekor qilish"
        danger
        loading={undoing}
        onConfirm={() => void handleUndo()}
        onCancel={() => setUndoTarget(null)}
      />
    </>
  );
}

function Source({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1', ok ? 'border-(--color-line) bg-white' : 'border-(--color-warn) bg-(--color-warn-soft)')}>
      <span className={cn('size-2 rounded-full', ok ? 'bg-(--color-income)' : 'bg-(--color-warn)')} />
      <span className="font-medium text-heading">{label}</span>
      <span className="money text-(--color-text-muted)">{value}</span>
    </span>
  );
}

function Box({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub: string; tone?: 'neutral' | 'income' | 'expense' | 'warn' }) {
  const c = { neutral: 'text-(--color-text)', income: 'text-(--color-income)', expense: 'text-(--color-expense)', warn: 'text-(--color-warn)' }[tone];
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-1.5 text-xl font-semibold', c)}>{value}</p>
      <p className="mt-0.5 text-xs text-(--color-text-muted)">{sub}</p>
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
