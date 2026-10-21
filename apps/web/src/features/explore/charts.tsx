'use client';

import { formatPeriod } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import { monthLabel, OTHER, pct, SERIES, share, short, som, type Filter, type Kind } from './api';
import { useDrill } from './drill';

// ═══════════════════════════════════════════════════════════
// Grafiklar (sahifaning eng pastida). Jadvallar bilan bir xil ma'lumotdan:
// ustun / bo'lak bosilsa — o'sha yozuvlar ochiladi.
// ═══════════════════════════════════════════════════════════

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  kind: Kind;
  f: Filter;
}

/** Ko'p qatorni eng kattalari + «Boshqalar» ga yig'adi (ranglar tartibi doim bir xil) */
export function foldSeries<T extends { key: string; label: string; values: number[]; total: number; kind: Kind; f: Filter }>(rows: T[], max = 5): Series[] {
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const top = sorted.slice(0, max);
  const rest = sorted.slice(max);
  const out: Series[] = top.map((r, i) => ({ key: r.key, label: r.label, color: SERIES[i]!, values: r.values, kind: r.kind, f: r.f }));
  if (rest.length) {
    const cats = rest.flatMap((r) => r.f.cats ?? []);
    out.push({ key: 'other', label: `Boshqalar (${rest.length})`, color: OTHER, values: rest[0]!.values.map((_, i) => rest.reduce((a, r) => a + (r.values[i] ?? 0), 0)), kind: rest[0]!.kind, f: { ...rest[0]!.f, cats } });
  }
  return out;
}

export function ChartCard({ title, description, children, legend }: { title: string; description?: string; children: ReactNode; legend?: { label: string; color: string }[] }) {
  return (
    <section className="rounded-(--radius-card) border border-(--color-line) bg-white p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-heading">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-(--color-text-muted)">{description}</p>}
        </div>
        {legend && legend.length > 1 && (
          <div className="flex max-w-xl flex-wrap justify-end gap-x-3 gap-y-1">
            {legend.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1.5 text-xs text-(--color-text-muted)">
                <span className="size-2.5 rounded-sm" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

/** Oylar bo'yicha yig'ma ustunlar */
export function StackedMonths({ months, series, root, height = 220 }: { months: string[]; series: Series[]; root: string; height?: number }) {
  const { open } = useDrill();
  const [hover, setHover] = useState<number | null>(null);
  const totals = months.map((_, i) => series.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0));
  const max = Math.max(...totals, 0);
  if (!max) return <p className="py-10 text-center text-sm text-(--color-text-muted)">Bu davrda ma&apos;lumot yo&apos;q</p>;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative w-14 shrink-0" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="money absolute right-0 -translate-y-1/2 text-[10px] text-(--color-text-faint)" style={{ top: height - (t / max) * height }}>
              {short(t)}
            </span>
          ))}
        </div>
        <div className="relative flex-1">
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-(--color-line)/70" style={{ top: height - (t / max) * height }} />
          ))}
          <div className="relative flex items-end gap-[2px]" style={{ height }} onMouseLeave={() => setHover(null)}>
            {months.map((m, i) => (
              <div key={m} className="group relative flex h-full flex-1 flex-col justify-end" onMouseEnter={() => setHover(i)}>
                <div className={cn('absolute inset-0 rounded-sm', hover === i && 'bg-brand-50/60')} />
                <div className="relative mx-auto flex w-full max-w-12 flex-col-reverse gap-[2px]">
                  {series.map((s) => {
                    const v = Math.max(0, s.values[i] ?? 0);
                    if (!v) return null;
                    return (
                      <button
                        key={s.key}
                        type="button"
                        aria-label={`${s.label}, ${formatPeriod(m)}: ${som(v)}`}
                        onClick={() => open({ kind: s.kind, f: { ...s.f, month: m }, title: [root, s.label, formatPeriod(m)].join(' › '), expected: s.key === 'other' ? undefined : v })}
                        className="w-full first:rounded-b-[2px] last:rounded-t-[4px] hover:opacity-80"
                        style={{ height: Math.max(2, (v / max) * height - 2), background: s.color }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-[2px]">
            {months.map((m) => (
              <span key={m} className="flex-1 truncate text-center text-[10px] text-(--color-text-muted)">
                {monthLabel(m)}
              </span>
            ))}
          </div>
          {hover !== null && (
            <div className="pointer-events-none absolute top-0 z-20 w-56 rounded-(--radius-control) border border-(--color-line) bg-white p-2.5 text-xs shadow-lg" style={{ left: `clamp(0px, calc(${((hover + 0.5) / months.length) * 100}% - 7rem), calc(100% - 14rem))` }}>
              <p className="mb-1.5 font-semibold text-heading">{formatPeriod(months[hover]!)}</p>
              {series
                .filter((s) => s.values[hover])
                .map((s) => (
                  <p key={s.key} className="flex items-center gap-1.5 py-0.5">
                    <span className="size-2 shrink-0 rounded-sm" style={{ background: s.color }} />
                    <span className="min-w-0 flex-1 truncate text-(--color-text-muted)">{s.label}</span>
                    <span className="money font-medium text-heading">{short(s.values[hover]!)}</span>
                  </p>
                ))}
              <p className="mt-1 flex justify-between border-t border-(--color-line) pt-1 font-semibold text-heading">
                <span>Jami</span>
                <span className="money">{som(totals[hover]!)}</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Gorizontal ulush chiziqlari (eng kattalari) */
export function ShareBars({ items, total, root, max = 10 }: { items: { key: string; label: string; cur: number; prev: number; kind: Kind; f: Filter }[]; total: number; root: string; max?: number }) {
  const { open } = useDrill();
  const list = [...items].sort((a, b) => b.cur - a.cur).slice(0, max);
  const top = Math.max(...list.map((x) => Math.max(x.cur, x.prev)), 0);
  if (!top) return <p className="py-10 text-center text-sm text-(--color-text-muted)">Bu davrda ma&apos;lumot yo&apos;q</p>;
  return (
    <div className="space-y-2">
      {list.map((x) => (
        <button key={x.key} type="button" onClick={() => open({ kind: x.kind, f: x.f, title: [root, x.label].join(' › '), expected: x.cur })} className="group block w-full text-left" title={`${som(x.cur)} so'm — yozuvlarni ko'rish`}>
          <div className="mb-0.5 flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-heading group-hover:text-brand-700 group-hover:underline">{x.label}</span>
            <span className="money shrink-0 text-(--color-text-muted)">
              <b className="font-semibold text-heading">{short(x.cur)}</b> · {pct(share(x.cur, total))}
            </span>
          </div>
          <div className="relative h-3 rounded-sm bg-(--color-surface-sunken)">
            <div className="absolute inset-y-0 left-0 rounded-r-[4px] rounded-l-sm" style={{ width: `${(x.cur / top) * 100}%`, background: SERIES[0] }} />
            {x.prev > 0 && <div className="absolute inset-y-[-2px] w-[2px] bg-heading/70" style={{ left: `calc(${(x.prev / top) * 100}% - 1px)` }} title={`O'tgan davr: ${som(x.prev)}`} />}
          </div>
        </button>
      ))}
      <p className="pt-1 text-[11px] text-(--color-text-faint)">Qora chiziq — o&apos;tgan davr darajasi</p>
    </div>
  );
}