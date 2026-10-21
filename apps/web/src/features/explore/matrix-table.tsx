'use client';

import { IconChevronRight } from '@/components/ui/icons';
import { formatPeriod } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import { csvSom, downloadCsv, monthLabel, pct, share, short, som, type MatrixRow, type Months } from './api';
import { useDrill } from './drill';

// ═══════════════════════════════════════════════════════════
// Oylar kesimi: qatorlar (moddalar) × oylar. Har bir katak bosilsa — o'sha oy yozuvlari.
// Pastda: Jami va Markaz / Hududlar qatorlari.
// ═══════════════════════════════════════════════════════════

export function MatrixTable({ data, months, title, description, root, csv, note }: { data: Months; months: string[]; title: ReactNode; description?: ReactNode; root: string; csv: string; note?: ReactNode }) {
  const { open } = useDrill();
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'full' | 'short' | 'share'>('full');
  const grand = data.total.total;
  const monthTotals = data.total.values;

  const cell = (row: MatrixRow, i: number, path: string[]) => {
    const v = row.values[i] ?? 0;
    const text = mode === 'full' ? som(v) : mode === 'short' ? short(v) : pct(share(v, monthTotals[i] ?? 0));
    return (
      <td key={i} className="px-2 py-1.5 text-right">
        {v ? (
          <button
            type="button"
            title={`${formatPeriod(months[i]!)}: ${som(v)} so'm — yozuvlarni ko'rish`}
            onClick={() => open({ kind: row.kind, f: { ...row.f, month: months[i] }, title: [root, ...path, row.label, formatPeriod(months[i]!)].join(' › '), expected: v })}
            className="money rounded px-1 -mx-1 whitespace-nowrap text-heading hover:bg-brand-50 hover:text-brand-700 hover:underline"
          >
            {text}
          </button>
        ) : (
          <span className="money text-(--color-text-faint)">—</span>
        )}
      </td>
    );
  };

  const line = (row: MatrixRow, depth: number, path: string[], cls?: string): ReactNode[] => {
    const has = Boolean(row.children?.length);
    const isOpen = opened.has(row.key);
    const out: ReactNode[] = [
      <tr key={`${path.join('/')}/${row.key}`} className={cn('border-t border-(--color-line)', depth > 0 && 'bg-(--color-surface-muted)/50', cls)}>
        <td className="sticky left-0 z-10 bg-inherit py-1.5 pr-2" style={{ paddingLeft: 10 + depth * 18 }}>
          <div className="flex min-w-0 items-center gap-1">
            {has ? (
              <button type="button" onClick={() => setOpened((s) => { const n = new Set(s); if (n.has(row.key)) n.delete(row.key); else n.add(row.key); return n; })} className="flex size-5 shrink-0 items-center justify-center rounded text-(--color-text-muted) hover:bg-brand-50">
                <IconChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
              </button>
            ) : (
              <span className="size-5 shrink-0" />
            )}
            <span className={cn('truncate', depth === 0 ? 'font-medium text-heading' : 'text-heading')} title={row.label}>
              {row.label}
            </span>
          </div>
        </td>
        {months.map((_, i) => cell(row, i, path))}
        <td className="bg-(--color-surface-muted)/60 px-2 py-1.5 text-right">
          <button type="button" onClick={() => open({ kind: row.kind, f: row.f, title: [root, ...path, row.label].join(' › '), expected: row.total })} className="money font-semibold text-heading hover:text-brand-700 hover:underline" title={`${som(row.total)} so'm`}>
            {mode === 'short' ? short(row.total) : som(row.total)}
          </button>
        </td>
        <td className="px-2 py-1.5 text-right text-xs text-(--color-text-muted)">{pct(share(row.total, grand))}</td>
      </tr>,
    ];
    if (has && isOpen) for (const c of row.children!) out.push(...line(c, depth + 1, [...path, row.label]));
    return out;
  };

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [['Nomi', ...months.map(formatPeriod), "Jami (so'm)", 'Ulushi, %']];
    const add = (r: MatrixRow, depth: number) => {
      rows.push([`${'   '.repeat(depth)}${r.label}`, ...r.values.map(csvSom), csvSom(r.total), grand ? Math.round((r.total / grand) * 1000) / 10 : null]);
      r.children?.forEach((c) => add(c, depth + 1));
    };
    data.rows.forEach((r) => add(r, 0));
    add(data.total, 0);
    data.units.forEach((r) => add(r, 0));
    downloadCsv(csv, rows);
  };

  return (
    <section className="overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white shadow-card">
      <header className="flex flex-wrap items-start gap-3 border-b border-(--color-line) px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-heading">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-(--color-text-muted)">{description}</p>}
        </div>
        <div className="inline-flex gap-0.5 rounded-(--radius-control) bg-(--color-surface-sunken) p-0.5 text-xs font-medium">
          {(
            [
              ['full', "To'liq"],
              ['short', 'mln'],
              ['share', 'Oy ichidagi ulush'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setMode(k)} className={mode === k ? 'rounded-[calc(var(--radius-control)-2px)] bg-white px-2.5 py-1 shadow-sm' : 'px-2.5 py-1 text-(--color-text-muted)'}>
              {l}
            </button>
          ))}
        </div>
        <button type="button" onClick={exportCsv} className="h-7 rounded-(--radius-control) border border-(--color-line) px-2.5 text-xs font-medium text-heading hover:bg-brand-50">
          Excel
        </button>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 260 + months.length * (mode === 'full' ? 118 : 84) + 200 }}>
          <thead className="bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
            <tr>
              <th className="sticky left-0 z-10 min-w-56 bg-(--color-surface-muted) px-3 py-2 text-left font-semibold">Nomi</th>
              {months.map((m) => (
                <th key={m} className="px-2 py-2 text-right font-semibold whitespace-nowrap">
                  {monthLabel(m)}
                </th>
              ))}
              <th className="w-32 px-2 py-2 text-right font-semibold">Jami</th>
              <th className="w-16 px-2 py-2 text-right font-semibold">Ulushi</th>
            </tr>
          </thead>
          <tbody className="[&>tr]:bg-white">{data.rows.flatMap((r) => line(r, 0, []))}</tbody>
          <tfoot className="[&>tr]:bg-(--color-surface-muted)">
            {line(data.total, 0, [], 'border-t-2 border-(--color-line-strong) font-semibold')}
            {data.units.filter((u) => u.total).flatMap((u) => line(u, 0, [], 'text-(--color-text-muted)'))}
          </tfoot>
        </table>
      </div>
      {note && <p className="border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">{note}</p>}
    </section>
  );
}