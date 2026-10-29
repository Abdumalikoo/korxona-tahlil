'use client';

import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { formatDate, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { csvSom, downloadCsv, exploreApi, som, spanText, type Filter, type Kind, type RecordRow, type Sort, type Span, type Which } from './api';

// ═══════════════════════════════════════════════════════════
// Istalgan katak / qator bosilganda — aynan o'sha summani tashkil qilgan yozuvlar.
// Panel tepasida: jami summa va yozuvlar soni (jadvaldagi raqam bilan bir xil bo'lishi kerak).
// ═══════════════════════════════════════════════════════════

export interface DrillTarget {
  kind: Kind;
  f: Filter;
  which?: Which;
  /** Sarlavha: «Markaz › Uzum bank xizmatlari» */
  title: string;
  /** Jadvaldagi summa — tekshiruv uchun */
  expected?: number;
}

interface Ctx {
  range: Span;
  open: (t: DrillTarget) => void;
}

const DrillCtx = createContext<Ctx | null>(null);

export function useDrill(): Ctx {
  const c = useContext(DrillCtx);
  if (!c) throw new Error('DrillProvider yo‘q');
  return c;
}

export function DrillProvider({ range, children }: { range: Span; children: ReactNode }) {
  const [target, setTarget] = useState<DrillTarget | null>(null);
  /** Har yangi ochilishda panel holati (sahifa, tartib, davr) boshidan boshlanadi */
  const [seq, setSeq] = useState(0);
  const open = useCallback((t: DrillTarget) => {
    setTarget(t);
    setSeq((n) => n + 1);
  }, []);
  const value = useMemo(() => ({ range, open }), [range, open]);
  return (
    <DrillCtx.Provider value={value}>
      {children}
      <RecordsDrawer key={seq} target={target} range={range} onClose={() => setTarget(null)} />
    </DrillCtx.Provider>
  );
}

const WHICH_LABEL: Record<Which, string> = { cur: 'Joriy davr', prev: "O'tgan davr", ly: "O'tgan yil" };
const STATUS: Record<string, { label: string; cls: string }> = {
  PAID: { label: "To'langan", cls: 'bg-(--color-income-soft) text-(--color-income)' },
  PARTIAL: { label: 'Qisman', cls: 'bg-(--color-warn-soft) text-(--color-warn)' },
  UNPAID: { label: "To'lanmagan", cls: 'bg-(--color-expense-soft) text-(--color-expense)' },
};

function RecordsDrawer({ target, range, onClose }: { target: DrillTarget | null; range: Span; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<Sort>('amount');
  const [which, setWhich] = useState<Which>(target?.which ?? 'cur');
  const [exporting, setExporting] = useState(false);

  const res = useAsync(
    () => (target ? exploreApi.records(target.kind, range.from, range.to, target.f, which, page, sort).then((r) => r.data) : Promise.resolve(null)),
    [target, range.from, range.to, which, page, sort],
  );
  if (!target) return null;
  const d = res.data;
  const income = target.kind === 'income';
  const mismatch = d && target.expected !== undefined && which === (target.which ?? 'cur') && Math.round(d.total) !== Math.round(target.expected);

  const exportAll = async () => {
    if (!d) return;
    setExporting(true);
    try {
      const all: RecordRow[] = [];
      for (let p = 1; p <= Math.min(d.pages, 60); p++) {
        const r = await exploreApi.records(target.kind, range.from, range.to, target.f, which, p, sort);
        all.push(...r.data.rows);
      }
      downloadCsv(`${target.title.replace(/[^\p{L}\p{N} _-]+/gu, ' ').trim()} — yozuvlar`, [
        ['Sana', 'Modda', 'Birlik', "Bo'lim", income ? 'Mijoz' : 'Kontragent', 'Izoh', ...(income ? ['Soni'] : []), "Summa (so'm)", "To'lanmagan (so'm)", 'Holat'],
        ...all.map((x) => [formatDate(x.date), x.category, x.unitLabel, x.department ?? '', x.party ?? '', x.description ?? '', ...(income ? [x.quantity] : []), csvSom(x.amount), csvSom(x.open), STATUS[x.status]?.label ?? x.status]),
      ]);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Drawer open onClose={onClose} width="xl" title={target.title} description={`${income ? 'Daromad' : 'Xarajat'} yozuvlari`}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex gap-0.5 rounded-(--radius-control) bg-(--color-surface-sunken) p-0.5 text-sm font-medium">
            {(['cur', 'prev', 'ly'] as Which[]).map((w) => (
              <button key={w} type="button" onClick={() => (setWhich(w), setPage(1))} className={which === w ? 'rounded-[calc(var(--radius-control)-2px)] bg-white px-3 py-1.5 shadow-sm' : 'px-3 py-1.5 text-(--color-text-muted) hover:text-heading'}>
                {WHICH_LABEL[w]}
              </button>
            ))}
          </div>
          <select data-skip-focus value={sort} onChange={(e) => (setSort(e.target.value as Sort), setPage(1))} className="h-9 rounded-(--radius-control) border border-(--color-line) bg-white px-2 text-sm" aria-label="Tartib">
            <option value="amount">Kattasidan</option>
            <option value="date">Sana: yangisidan</option>
            <option value="date-asc">Sana: eskisidan</option>
          </select>
          <Button size="sm" variant="ghost" className="ml-auto" loading={exporting} disabled={!d?.count} onClick={() => void exportAll()}>
            Excel (CSV)
          </Button>
        </div>

        {res.loading && !d ? (
          <LoadingState />
        ) : res.error ? (
          <ErrorState message={res.error} onRetry={res.reload} />
        ) : d ? (
          <>
            <div className="grid gap-3 rounded-(--radius-card) border border-(--color-line) bg-(--color-surface-muted) p-3 sm:grid-cols-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Jami summa</p>
                <p className="money mt-0.5 text-lg font-semibold text-heading">{som(d.total)} so&apos;m</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Yozuvlar</p>
                <p className="money mt-0.5 text-lg font-semibold text-heading">
                  {d.count.toLocaleString('uz')} ta{d.quantity ? <span className="ml-2 text-sm font-normal text-(--color-text-muted)">· {d.quantity.toLocaleString('uz')} ta xizmat</span> : null}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Davr</p>
                <p className="mt-0.5 text-sm font-medium text-heading">{spanText(d.span)}</p>
                {target.f.month && <p className="text-xs text-(--color-text-muted)">Oy: {formatPeriod(target.f.month)}</p>}
              </div>
            </div>
            {mismatch && (
              <p className="rounded-(--radius-control) bg-(--color-warn-soft) px-3 py-2 text-xs text-(--color-warn)">
                Jadvaldagi summa ({som(target.expected!)}) bilan farq bor — ma&apos;lumot hozirgina o&apos;zgargan bo&apos;lishi mumkin. Sahifani yangilang.
              </p>
            )}
            {d.count === 0 ? (
              <p className="rounded-(--radius-card) border border-dashed border-(--color-line) px-4 py-8 text-center text-sm text-(--color-text-muted)">Bu davrda yozuv yo&apos;q</p>
            ) : (
              <div className={cn('overflow-x-auto rounded-(--radius-card) border border-(--color-line)', res.loading && 'opacity-60')}>
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
                    <tr>
                      <th className="w-10 px-2 py-2 text-right font-semibold">№</th>
                      <th className="w-24 px-2 py-2 text-left font-semibold">Sana</th>
                      <th className="px-2 py-2 text-left font-semibold">Modda</th>
                      <th className="px-2 py-2 text-left font-semibold">Birlik / bo&apos;lim</th>
                      <th className="px-2 py-2 text-left font-semibold">{income ? 'Mijoz' : 'Kontragent'} · izoh</th>
                      {income && <th className="w-16 px-2 py-2 text-right font-semibold">Soni</th>}
                      <th className="w-32 px-2 py-2 text-right font-semibold">Summa</th>
                      <th className="w-24 px-2 py-2 text-center font-semibold">Holat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((x, i) => (
                      <tr key={x.id} className="border-t border-(--color-line) align-top hover:bg-brand-50/40">
                        <td className="px-2 py-1.5 text-right text-xs text-(--color-text-faint)">{(d.page - 1) * d.pageSize + i + 1}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(x.date)}</td>
                        <td className="px-2 py-1.5 text-heading">{x.category}</td>
                        <td className="px-2 py-1.5">
                          {x.unitLabel}
                          {x.placeLabel && <span className="block text-xs text-(--color-warn)" title="Xarajatlar siyosati bo‘yicha shu birlik hisobiga o‘tkazilgan">siyosat: yozilgan — {x.placeLabel}</span>}
                          {x.department && <span className="block text-xs text-(--color-text-muted)">{x.department}</span>}
                        </td>
                        <td className="max-w-[16rem] px-2 py-1.5">
                          {x.party && <span className="block truncate font-medium text-heading" title={x.party}>{x.party}</span>}
                          {x.description && <span className="block truncate text-xs text-(--color-text-muted)" title={x.description}>{x.description}</span>}
                          {x.documentNo && <span className="block text-[11px] text-(--color-text-faint)">№ {x.documentNo}</span>}
                          {!x.party && !x.description && !x.documentNo && <span className="text-(--color-text-faint)"></span>}
                        </td>
                        {income && <td className="money px-2 py-1.5 text-right">{x.quantity ?? ''}</td>}
                        <td className="money px-2 py-1.5 text-right font-semibold text-heading">
                          {som(x.amount)}
                          {x.open > 0 && x.open !== x.amount && <span className="block text-[11px] font-normal text-(--color-expense)">qoldiq {som(x.open)}</span>}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS[x.status]?.cls)}>{STATUS[x.status]?.label ?? x.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-(--color-line-strong) bg-(--color-surface-muted) font-semibold text-heading">
                    <tr>
                      <td colSpan={income ? 6 : 5} className="px-2 py-2 text-right">
                        {d.pages > 1 ? `Sahifada: ${som(d.rows.reduce((a, x) => a + x.amount, 0))} · Hammasi (${d.count} ta):` : `Jami (${d.count} ta):`}
                      </td>
                      <td className="money px-2 py-2 text-right">{som(d.total)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {d.pages > 1 && (
              <div className="flex items-center justify-between gap-2 text-sm">
                <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ← Oldingi
                </Button>
                <span className="text-(--color-text-muted)">
                  {d.page} / {d.pages} sahifa
                </span>
                <Button size="sm" variant="ghost" disabled={page >= d.pages} onClick={() => setPage((p) => p + 1)}>
                  Keyingi →
                </Button>
              </div>
            )}
          </>
        ) : null}
      </div>
    </Drawer>
  );
}