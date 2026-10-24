'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { Card } from '@/components/ui/card';
import { IconArrowRight, IconChevronRight } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { SubTabs } from '@/components/ui/tabs';
import { change, monthLabel, pct, pctSigned, short, som } from '@/features/explore/api';
import { DrillProvider, useDrill } from '@/features/explore/drill';
import { Kpi } from '@/features/explore/parts';
import type { CompareMode, SectionFilter } from '@/features/structure/api';
import { unitByCode, type EntryUnit } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { segmentApi, type DrillNode, type SegFlow, type SegmentView } from './segment-api';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Tax free / Marksheyder / Fermer xo'jaligi / Buxgalteriya xizmatlari — Markaz sahifasidagidek:
//  ko'rsatkichlar (daromad, xarajat, natija, rentabellik) → daromad manbalari → xarajat tarkibi (guruh → modda)
//  → siyosat oqimlari (kelgan / boshqa bo'limga o'tgan) → 12 oy.
//  Istalgan summa bosilsa — o'sha summani tashkil qilgan yozuvlar ochiladi (Bosh sahifadagidek).
// ═══════════════════════════════════════════════════════════

const n = (s: string) => Number(s);

export function SegmentSolishtirma({ unit, range }: { unit: EntryUnit; range: DateRange }) {
  const [section, setSection] = useState<SectionFilter>('ALL');
  const [compare, setCompare] = useState<CompareMode>('prev');
  const res = useAsync(() => segmentApi.view(unit.code, range, section, compare).then((r) => r.data), [unit.code, range.from, range.to, section, compare]);

  return (
    <DrillProvider range={{ from: range.from, to: range.to }}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <SubTabs
            value={section}
            onChange={setSection}
            options={[
              { value: 'ALL', label: 'Hammasi' },
              { value: 'DOIMIY', label: 'Doimiy' },
              { value: 'BOSHQA', label: 'Boshqa' },
            ]}
          />
          <SubTabs
            value={compare}
            onChange={setCompare}
            className="ml-auto"
            options={[
              { value: 'prev', label: "O'tgan davr bilan" },
              { value: 'yoy', label: "O'tgan yil bilan" },
            ]}
          />
        </div>
        {res.error ? (
          <Card>
            <ErrorState message={res.error} onRetry={res.reload} />
          </Card>
        ) : !res.data ? (
          <Card>
            <LoadingState />
          </Card>
        ) : (
          <Body d={res.data} unit={unit} />
        )}
      </div>
    </DrillProvider>
  );
}

function Body({ d, unit }: { d: SegmentView; unit: EntryUnit }) {
  const t = d.totals;
  const ROOT = d.label;
  const income = n(t.incomeTiyin);
  const expense = n(t.expenseTiyin);
  const result = n(t.resultTiyin);
  const empty = !income && !expense && !n(t.previousIncomeTiyin) && !n(t.previousExpenseTiyin);
  const policyHref = `/xarajatlar/bolim/${unit.slug}/siyosat`;

  return (
    <>
      <p className="text-xs text-(--color-text-muted)">
        Davr: <b className="text-heading">{fmtRange(d.range)}</b> · taqqoslash ({d.compareLabel}): {fmtRange(d.previousRange)} · summa bosilsa — yozuvlar ochiladi
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Daromad" cur={income} prev={n(t.previousIncomeTiyin)} kind="income" drill={{ kind: 'income', f: { unit: d.unitKey }, title: `${ROOT} › Daromad` }} sub={`${t.incomeCount} ta yozuv · korxonadagi ulushi ${pct(t.incomeShare)}`} />
        <Kpi
          label="Xarajat"
          cur={expense}
          prev={n(t.previousExpenseTiyin)}
          kind="expense"
          sub={
            <>
              {t.expenseCount} ta yozuv · ish haqi {short(n(t.payrollTiyin))}
              {n(t.incomingTiyin) || n(t.outgoingTiyin) ? (
                <span className="block">
                  siyosat: +{short(n(t.incomingTiyin))} kelgan, −{short(n(t.outgoingTiyin))} o&apos;tgan
                </span>
              ) : null}
            </>
          }
        />
        <Kpi label="Natija (foyda / zarar)" cur={result} prev={n(t.previousResultTiyin)} kind="result" tone="auto" />
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Rentabellik</p>
          <p className={cn('mt-1.5 text-xl font-semibold tabular-nums', t.margin === null ? 'text-(--color-text-faint)' : t.margin < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{t.margin === null ? '—' : pct(t.margin)}</p>
          <p className="mt-1.5 text-xs text-(--color-text-muted)">
            {d.compareLabel}: {t.previousMargin === null ? '—' : pct(t.previousMargin)} · natija / daromad
          </p>
        </Card>
      </div>

      {empty ? (
        <Card className="px-6 py-12 text-center">
          <p className="text-sm font-semibold text-heading">Bu davrda «{d.label}» bo&apos;yicha yozuv yo&apos;q</p>
          <p className="mt-1 text-xs text-(--color-text-muted)">
            Daromad va xarajat «{d.label}» bo&apos;limida kiritilgach shu yerda chiqadi:{' '}
            <Link href={`/xarajatlar/bolim/${unit.slug}`} className="font-semibold text-brand-700 hover:underline">
              Xarajatlar › {d.label}
            </Link>
          </p>
        </Card>
      ) : (
        <>
          <TreeCard
            title="Xarajat — ichma-ich"
            hint="Tuzilma (Ish haqi, Ijara va kommunal, Bank …) → xodim / filial / to'lov oluvchi / modda → oylar → yozuvlar"
            nodes={d.tree.expense}
            months={d.tree.months}
            total={expense}
            kind="expense"
            root={`${ROOT} › Xarajat`}
            compareLabel={d.compareLabel}
          />
          <TreeCard
            title="Daromad — ichma-ich"
            hint="Xizmat turi → mijoz → oylar → yozuvlar"
            nodes={d.tree.income}
            months={d.tree.months}
            total={income}
            kind="income"
            root={`${ROOT} › Daromad`}
            compareLabel={d.compareLabel}
          />

          {(d.incoming.length > 0 || d.outgoing.length > 0) && (
            <div className="grid gap-4 xl:grid-cols-2">
              <FlowCard title={`Boshqa bo'limlardan «${d.label}» hisobiga`} hint="Xarajatlar siyosati bo'yicha — xarajatga qo'shilgan" flows={d.incoming} dir="in" root={ROOT} />
              <FlowCard title={`«${d.label}»dan boshqa bo'lim hisobiga`} hint="Shu yerda yozilgan, lekin xarajatga kirmaydi" flows={d.outgoing} dir="out" root={ROOT} />
            </div>
          )}
          <p className="text-xs text-(--color-text-muted)">
            Qaysi modda kim hisobida —{' '}
            <Link href={policyHref} className="font-semibold text-brand-700 hover:underline">
              Xarajatlar › {d.label} › Xarajatlar siyosati
            </Link>
          </p>

          <TrendCard d={d} />
        </>
      )}
    </>
  );
}

function fmtRange(r: { from: string; to: string }) {
  const f = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
  return `${f(r.from)} — ${f(r.to)}`;
}

function FlowCard({ title, hint, flows, dir, root }: { title: string; hint: string; flows: SegFlow[]; dir: 'in' | 'out'; root: string }) {
  const { open } = useDrill();
  const total = flows.reduce((s, f) => s + n(f.amountTiyin), 0);
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-(--color-line) px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-heading">{title}</p>
          <p className="text-xs text-(--color-text-muted)">{hint}</p>
        </div>
        <p className={cn('money text-sm font-semibold', dir === 'in' ? 'text-(--color-expense)' : 'text-(--color-income)')}>
          {dir === 'in' ? '+' : '−'} {som(total)}
        </p>
      </div>
      {flows.length ? (
        <table className="w-full text-sm">
          <tbody>
            {flows.map((f) => (
              <tr key={`${f.unit}-${f.code}`} className="border-t border-(--color-line) first:border-t-0">
                <td className="px-4 py-2 text-(--color-text-muted)">
                  <span className="inline-flex items-center gap-1">
                    {dir === 'in' ? f.unitLabel : root}
                    <IconArrowRight className="size-3 text-brand-600" />
                    {dir === 'in' ? root : f.unitLabel}
                  </span>
                </td>
                <td className="px-2 py-2 text-heading">{f.label}</td>
                <td className="px-4 py-2 text-right">
                  <button type="button" disabled={!n(f.amountTiyin)} onClick={() => open({ kind: 'expense', f: f.f, title: `${f.unitLabel} › ${f.label}`, expected: n(f.amountTiyin) })} className="money text-heading hover:text-brand-700 hover:underline disabled:text-(--color-text-faint)">
                    {n(f.amountTiyin) ? som(n(f.amountTiyin)) : '—'}
                  </button>
                  <span className="block text-[11px] text-(--color-text-faint)">{f.count} ta</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="px-4 py-6 text-sm text-(--color-text-muted)">Yo&apos;q</p>
      )}
    </Card>
  );
}

function TrendCard({ d }: { d: SegmentView }) {
  const inc = d.trend.income.map(n);
  const exp = d.trend.expense.map(n);
  const res = d.trend.result.map(n);
  const max = Math.max(1, ...inc, ...exp);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold text-heading">So&apos;nggi 12 oy</p>
        <span className="flex items-center gap-1.5 text-xs text-(--color-text-muted)">
          <span className="size-2.5 rounded-sm bg-(--color-income)" /> Daromad
        </span>
        <span className="flex items-center gap-1.5 text-xs text-(--color-text-muted)">
          <span className="size-2.5 rounded-sm bg-brand-500" /> Xarajat
        </span>
        <p className="ml-auto text-xs text-(--color-text-muted)">
          {hover !== null ? (
            <>
              <b className="text-heading">{monthLabel(d.months[hover]!)}</b>: daromad {som(inc[hover]!)} · xarajat {som(exp[hover]!)} · natija{' '}
              <b className={res[hover]! < 0 ? 'text-(--color-expense)' : 'text-(--color-income)'}>{som(res[hover]!)}</b>
            </>
          ) : (
            'Ustun ustiga olib boring'
          )}
        </p>
      </div>
      <div className="mt-4 flex h-40 items-end gap-1.5">
        {d.months.map((m, i) => (
          <div key={m} className="flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <div className={cn('flex h-full items-end gap-0.5 rounded px-0.5', hover === i && 'bg-brand-50')}>
              <div className="flex-1 rounded-t bg-(--color-income)" style={{ height: `${(inc[i]! / max) * 100}%` }} />
              <div className="flex-1 rounded-t bg-brand-500" style={{ height: `${(exp[i]! / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {d.months.map((m, i) => (
          <div key={m} className="flex-1 text-center">
            <p className="truncate text-[10px] text-(--color-text-muted)">{monthLabel(m).split(' ')[0]?.slice(0, 3)}</p>
            <p className={cn('money truncate text-[10px] font-semibold', res[i]! < 0 ? 'text-(--color-expense)' : res[i] ? 'text-(--color-income)' : 'text-(--color-text-faint)')}>{res[i] ? short(res[i]!) : '—'}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Slug bo'yicha yo'nalish (faqat 4 ta yo'nalish: Markaz va Hududlar — o'z sahifalarida) */
export function segmentUnit(code: string | null | undefined): EntryUnit | null {
  const u = unitByCode(code);
  return u && u.code !== 'CENTER' && u.code !== 'REGION' ? u : null;
}

/** Ichma-ich jadval: ▸ — ichiga; summa — yozuvlar; «Oylar kesimida» — har oy ustuni (katak bosilsa — o'sha oy yozuvlari) */
function TreeCard({ title, hint, nodes, months, total, kind, root, compareLabel }: { title: string; hint: string; nodes: DrillNode[]; months: string[]; total: number; kind: 'income' | 'expense'; root: string; compareLabel: string }) {
  const { open } = useDrill();
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [byMonth, setByMonth] = useState(false);
  const toggle = (id: string) => setOpened((s) => { const x = new Set(s); if (x.has(id)) x.delete(id); else x.add(id); return x; });
  const drill = (node: DrillNode, path: string[], month?: string, value?: number) =>
    node.f && open({ kind, f: { ...node.f, ...(month ? { month } : {}) }, title: [root, ...path, ...(month ? [monthLabel(month)] : [])].join(' › '), expected: value });
  const many = months.length > 1;

  const rows: ReactNode[] = [];
  const walk = (list: DrillNode[], depth: number, parentId: string, path: string[]) => {
    for (const nd of list) {
      const id = `${parentId}/${nd.key}`;
      const cur = n(nd.amountTiyin);
      const prev = n(nd.previousTiyin);
      const c = change(cur, prev);
      const good = c === null || c === 0 ? null : c > 0 === (kind === 'income');
      const kids = nd.children ?? [];
      // Eng pastki tugun — ichida oylar (bir nechta oy bo'lsa)
      const monthKids = !kids.length && many ? months.map((m, i) => ({ m, v: n(nd.values[i] ?? '0') })).filter((x) => x.v !== 0) : [];
      const expandable = kids.length > 0 || monthKids.length > 1;
      const isOpen = opened.has(id);
      const p = [...path, nd.label];
      rows.push(
        <tr key={id} className={cn('border-t border-(--color-line)', depth === 0 ? 'bg-white font-medium' : depth === 1 ? 'bg-(--color-surface-sunken)/30' : 'bg-(--color-surface-sunken)/60')}>
          <td className="py-1.5 pr-2" style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}>
            <div className="flex items-center gap-1.5">
              {expandable ? (
                <button type="button" onClick={() => toggle(id)} className="flex size-5 shrink-0 items-center justify-center rounded text-(--color-text-muted) hover:bg-brand-50" aria-expanded={isOpen}>
                  <IconChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
                </button>
              ) : (
                <span className="size-5 shrink-0" />
              )}
              <span className={cn('text-heading', depth === 0 && 'font-semibold')} title={nd.hint}>
                {nd.label}
              </span>
              {kids.length > 0 && <span className="text-xs text-(--color-text-faint)">{kids.length}</span>}
            </div>
            {depth === 0 && total > 0 && (
              <div className="ml-6 mt-1 h-1 max-w-56 rounded bg-(--color-surface-sunken)">
                <div className={cn('h-1 rounded', kind === 'income' ? 'bg-(--color-income)' : 'bg-brand-500')} style={{ width: `${Math.max(0, Math.min(100, (cur / total) * 100))}%` }} />
              </div>
            )}
          </td>
          <td className="px-2 py-1.5 text-right whitespace-nowrap">
            {nd.f && cur ? (
              <button type="button" onClick={() => drill(nd, p, undefined, cur)} className="money text-heading hover:text-brand-700 hover:underline">
                {som(cur)}
              </button>
            ) : (
              <span className={cn('money', cur < 0 ? 'text-(--color-expense)' : cur ? 'text-heading' : 'text-(--color-text-faint)')}>{cur ? som(cur) : '—'}</span>
            )}
            <span className="block text-[10.5px] text-(--color-text-faint)">
              {total ? pct(cur / total) : ''}
              {nd.count ? ` · ${nd.count} ta` : ''}
            </span>
          </td>
          {!byMonth && (
            <td className="px-2 py-1.5 text-right text-xs whitespace-nowrap">
              <span className="money text-(--color-text-muted)">{prev ? short(prev) : '—'}</span>
              <span className={cn('money block font-semibold', good === null ? 'text-(--color-text-faint)' : good ? 'text-(--color-income)' : 'text-(--color-expense)')}>{c === null ? (cur ? 'yangi' : '—') : pctSigned(c)}</span>
            </td>
          )}
          {byMonth &&
            months.map((m, i) => {
              const v = n(nd.values[i] ?? '0');
              return (
                <td key={m} className="px-1.5 py-1.5 text-right text-xs whitespace-nowrap">
                  {v && nd.f ? (
                    <button type="button" onClick={() => drill(nd, p, m, v)} className="money text-heading hover:text-brand-700 hover:underline">
                      {short(v)}
                    </button>
                  ) : (
                    <span className={cn('money', v < 0 ? 'text-(--color-expense)' : v ? 'text-heading' : 'text-(--color-text-faint)')}>{v ? short(v) : '·'}</span>
                  )}
                </td>
              );
            })}
        </tr>,
      );
      if (!isOpen) continue;
      if (kids.length) walk(kids, depth + 1, id, p);
      else
        for (const { m, v } of monthKids)
          rows.push(
            <tr key={`${id}@${m}`} className="border-t border-(--color-line) bg-brand-50/30 text-xs">
              <td className="py-1 pr-2 text-(--color-text-muted)" style={{ paddingLeft: `${0.5 + (depth + 1) * 1.25 + 1.6}rem` }}>
                {monthLabel(m)}
              </td>
              <td className="px-2 py-1 text-right">
                {nd.f ? (
                  <button type="button" onClick={() => drill(nd, p, m, v)} className="money text-heading hover:text-brand-700 hover:underline">
                    {som(v)}
                  </button>
                ) : (
                  <span className="money text-heading">{som(v)}</span>
                )}
              </td>
              {!byMonth && <td />}
              {byMonth && months.map((x) => <td key={x} />)}
            </tr>,
          );
    }
  };
  walk(nodes, 0, '', []);
  const allIds = (list: DrillNode[], parentId: string): string[] => list.flatMap((nd) => [`${parentId}/${nd.key}`, ...allIds(nd.children ?? [], `${parentId}/${nd.key}`)]);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-heading">{title}</p>
          <p className="text-xs text-(--color-text-muted)">{hint}</p>
        </div>
        <button type="button" onClick={() => setOpened(opened.size ? new Set() : new Set(allIds(nodes, '')))} className="h-8 rounded-(--radius-control) border border-(--color-line) px-2.5 text-xs font-medium text-heading hover:bg-brand-50">
          {opened.size ? 'Hammasini yopish' : 'Hammasini ochish'}
        </button>
        {many && (
          <label className="flex items-center gap-2 text-xs font-medium text-(--color-text-muted)">
            <input type="checkbox" checked={byMonth} onChange={(e) => setByMonth(e.target.checked)} />
            Oylar kesimida
          </label>
        )}
      </div>
      {nodes.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Nomi</th>
                <th className="w-40 px-2 py-2 text-right font-semibold">Joriy davr</th>
                {!byMonth && <th className="w-28 px-2 py-2 text-right font-semibold">{compareLabel}</th>}
                {byMonth &&
                  months.map((m) => (
                    <th key={m} className="px-1.5 py-2 text-right font-semibold whitespace-nowrap">
                      {monthLabel(m).split(' ')[0]?.slice(0, 3)} {m.slice(2, 4)}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>{rows}</tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-8 text-center text-sm text-(--color-text-muted)">Bu davrda yo&apos;q</p>
      )}
    </Card>
  );
}