'use client';

import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { change, goodUp, pctSigned, short, som, spanText, type Filter, type Kind, type RecordRow, type Span, type XNode } from './api';
import { useDrill } from './drill';

// ═══════════════════════════════════════════════════════════
// Umumiy bo'laklar: ko'rsatkich kartasi, davrlar izohi, bo'lim sarlavhasi, eng katta yozuvlar.
// ═══════════════════════════════════════════════════════════

export function Kpi({
  label,
  cur,
  prev,
  ly,
  kind,
  sub,
  drill,
  tone,
  good = 'auto',
}: {
  label: string;
  cur: number;
  prev?: number;
  ly?: number;
  kind: Kind | 'result';
  sub?: ReactNode;
  /** Bosilganda ochiladigan yozuvlar */
  drill?: { kind: Kind; f: Filter; title: string };
  tone?: 'income' | 'expense' | 'auto';
  good?: 'auto' | 'up' | 'down';
}) {
  const { open } = useDrill();
  const up = good === 'auto' ? goodUp(kind) : good === 'up';
  const toneCls = tone === 'income' ? 'text-(--color-income)' : tone === 'expense' ? 'text-(--color-expense)' : tone === 'auto' ? (cur < 0 ? 'text-(--color-expense)' : 'text-(--color-income)') : 'text-heading';
  const body = (
    <>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-1.5 text-xl font-semibold', toneCls)} title={`${som(cur)} so'm`}>
        {som(cur)}
      </p>
      <div className="mt-1.5 space-y-0.5 text-xs">
        {prev !== undefined && <Delta label="O'tgan davrga" cur={cur} base={prev} up={up} />}
        {ly !== undefined && <Delta label="O'tgan yilga" cur={cur} base={ly} up={up} />}
        {sub && <div className="text-(--color-text-muted)">{sub}</div>}
      </div>
    </>
  );
  const cls = 'block w-full rounded-(--radius-card) border border-(--color-line) bg-white p-4 text-left shadow-card';
  if (!drill) return <div className={cls}>{body}</div>;
  return (
    <button type="button" onClick={() => open({ ...drill, expected: cur })} className={cn(cls, 'transition-colors hover:border-brand-300 hover:bg-brand-50/30')} title="Yozuvlarni ko'rish">
      {body}
    </button>
  );
}

function Delta({ label, cur, base, up }: { label: string; cur: number; base: number; up: boolean }) {
  const c = change(cur, base);
  const good = c === null || c === 0 ? null : c > 0 === up;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-(--color-text-muted)">
        {label} <span className="money text-(--color-text-faint)">({short(base)})</span>
      </span>
      <span className={cn('money font-semibold', good === null ? 'text-(--color-text-faint)' : good ? 'text-(--color-income)' : 'text-(--color-expense)')}>{c === null ? (cur ? 'yangi' : '—') : pctSigned(c)}</span>
    </div>
  );
}

/** Qaysi davrlar solishtirilayotgani */
export function SpansNote({ cur, prev, ly }: { cur: Span; prev: Span; ly: Span }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-(--radius-card) border border-(--color-line) bg-white px-4 py-2.5 text-xs text-(--color-text-muted)">
      <span>
        <b className="text-heading">Joriy davr:</b> {spanText(cur)}
      </span>
      <span>
        <b className="text-heading">O&apos;tgan davr:</b> {spanText(prev)}
      </span>
      <span>
        <b className="text-heading">O&apos;tgan yil:</b> {spanText(ly)}
      </span>
      <span className="ml-auto text-(--color-text-faint)">Istalgan summani bosing — uni tashkil qilgan yozuvlar ochiladi</span>
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 pt-2">
      <h2 className="text-base font-semibold text-heading">{children}</h2>
      {hint && <p className="text-xs text-(--color-text-muted)">{hint}</p>}
    </div>
  );
}

/** Kesim tanlash (jadval ustida) */
export function Switch<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-(--radius-control) bg-(--color-surface-sunken) p-0.5 text-sm font-medium" role="tablist">
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)} className={value === o.value ? 'rounded-[calc(var(--radius-control)-2px)] bg-white px-3 py-1.5 text-heading shadow-sm' : 'px-3 py-1.5 text-(--color-text-muted) hover:text-heading'}>
          {o.label}
          {o.count !== undefined && <span className="ml-1.5 text-xs text-(--color-text-faint)">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Davrdagi eng katta yozuvlar */
export function TopRecords({ rows, kind, title }: { rows: RecordRow[]; kind: Kind; title: string }) {
  const income = kind === 'income';
  return (
    <section className="overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white shadow-card">
      <header className="border-b border-(--color-line) px-4 py-3">
        <h2 className="text-sm font-semibold text-heading">{title}</h2>
        <p className="mt-0.5 text-xs text-(--color-text-muted)">Joriy davrdagi eng katta {rows.length} ta yozuv</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
            <tr>
              <th className="w-10 px-3 py-2 text-right font-semibold">№</th>
              <th className="w-24 px-2 py-2 text-left font-semibold">Sana</th>
              <th className="px-2 py-2 text-left font-semibold">Modda</th>
              <th className="px-2 py-2 text-left font-semibold">Birlik / bo&apos;lim</th>
              <th className="px-2 py-2 text-left font-semibold">{income ? 'Mijoz' : 'Kontragent'} · izoh</th>
              <th className="w-36 px-3 py-2 text-right font-semibold">Summa</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x, i) => (
              <tr key={x.id} className="border-t border-(--color-line) align-top">
                <td className="px-3 py-1.5 text-right text-xs text-(--color-text-faint)">{i + 1}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(x.date)}</td>
                <td className="px-2 py-1.5 text-heading">{x.category}</td>
                <td className="px-2 py-1.5">
                  {x.unitLabel}
                  {x.department && <span className="block text-xs text-(--color-text-muted)">{x.department}</span>}
                </td>
                <td className="max-w-[18rem] px-2 py-1.5">
                  {x.party && <span className="block truncate text-heading">{x.party}</span>}
                  {x.description && <span className="block truncate text-xs text-(--color-text-muted)">{x.description}</span>}
                  {!x.party && !x.description && <span className="text-(--color-text-faint)">—</span>}
                </td>
                <td className="money px-3 py-1.5 text-right font-semibold text-heading">{som(x.amount)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-(--color-text-muted)">
                  Bu davrda yozuv yo&apos;q
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Eng ko'p o'sgan va kamaygan moddalar (o'tgan davrga nisbatan, summa farqi bo'yicha) */
export function ChangesTable({ nodes, kind, root, title }: { nodes: XNode[]; kind: Kind; root: string; title: string }) {
  const { open } = useDrill();
  const up = goodUp(kind);
  const list = nodes.filter((n) => n.cur !== n.prev);
  const grow = [...list].filter((n) => n.cur > n.prev).sort((a, b) => b.cur - b.prev - (a.cur - a.prev)).slice(0, 8);
  const fall = [...list].filter((n) => n.cur < n.prev).sort((a, b) => a.cur - a.prev - (b.cur - b.prev)).slice(0, 8);
  const side = (label: string, items: XNode[], positive: boolean) => {
    const good = positive === up;
    return (
      <div className="min-w-0 flex-1">
        <p className={cn('mb-1 text-xs font-semibold', good ? 'text-(--color-income)' : 'text-(--color-expense)')}>{label}</p>
        {items.length ? (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wide text-(--color-text-faint)">
              <tr>
                <th className="py-1 text-left font-semibold">Modda</th>
                <th className="w-28 py-1 text-right font-semibold">O&apos;tgan</th>
                <th className="w-28 py-1 text-right font-semibold">Joriy</th>
                <th className="w-24 py-1 text-right font-semibold">Farq</th>
              </tr>
            </thead>
            <tbody>
              {items.map((n) => {
                const c = change(n.cur, n.prev);
                return (
                  <tr key={n.key + JSON.stringify(n.f)} className="border-t border-(--color-line)">
                    <td className="py-1.5 pr-2">
                      <button type="button" onClick={() => open({ kind: n.kind, f: n.f, title: `${root} › ${n.label}`, expected: n.cur })} className="text-left text-heading hover:text-brand-700 hover:underline">
                        {n.label}
                      </button>
                    </td>
                    <td className="money py-1.5 pl-3 text-right text-(--color-text-muted)">{som(n.prev)}</td>
                    <td className="money py-1.5 pl-3 text-right text-heading">{som(n.cur)}</td>
                    <td className={cn('money py-1.5 pl-3 text-right font-semibold whitespace-nowrap', good ? 'text-(--color-income)' : 'text-(--color-expense)')}>
                      {n.cur > n.prev ? '+' : '−'}
                      {short(Math.abs(n.cur - n.prev))}
                      <span className="block text-[10px] font-normal text-(--color-text-faint)">{c === null ? 'yangi' : pctSigned(c)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="py-3 text-xs text-(--color-text-faint)">Yo&apos;q</p>
        )}
      </div>
    );
  };
  return (
    <section className="rounded-(--radius-card) border border-(--color-line) bg-white p-4 shadow-card">
      <h2 className="text-sm font-semibold text-heading">{title}</h2>
      <p className="mb-3 mt-0.5 text-xs text-(--color-text-muted)">O&apos;tgan davrga nisbatan, so&apos;mdagi farq bo&apos;yicha</p>
      <div className="flex flex-col gap-6 lg:flex-row">
        {side("Ko'paygan", grow, true)}
        {side('Kamaygan', fall, false)}
      </div>
    </section>
  );
}

/** Daraxtning eng pastki moddalari (birlik qatorlarisiz) */
export function leafCategories(nodes: XNode[]): XNode[] {
  const out: XNode[] = [];
  const walk = (list: XNode[]) =>
    list.forEach((n) => {
      if (n.f.unit) return;
      const sub = (n.children ?? []).filter((c) => !c.f.unit);
      if (sub.length) walk(sub);
      else out.push(n);
    });
  walk(nodes);
  return out;
}