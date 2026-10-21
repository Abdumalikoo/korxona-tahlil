'use client';

import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { mln, pct, tone, type ExecRow } from './api';

// Ijro jadvali: Ko'rsatkich | 2025 | Yillik reja | Davr rejasi | Fakt | Farq | Bajarilish | Yillikdan

const TONE: Record<string, string> = {
  good: 'bg-(--color-income-soft) text-(--color-income)',
  warn: 'bg-(--color-warn-soft) text-(--color-warn)',
  bad: 'bg-(--color-expense-soft) text-(--color-expense)',
  none: 'text-(--color-text-faint)',
};

export function Pill({ ratio, sign }: { ratio: number | null; sign: 1 | -1 }) {
  const t = tone(ratio, sign);
  return <span className={cn('money inline-flex min-w-[4.5rem] justify-center rounded-full px-2 py-0.5 text-xs font-semibold', TONE[t])}>{pct(ratio)}</span>;
}

export function ExecTable({ rows, title, note, digits = 1, count }: { rows: ExecRow[]; title?: ReactNode; note?: ReactNode; digits?: number; count?: boolean }) {
  return (
    <div className="overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white">
      {title && <div className="border-b border-(--color-line) px-4 py-3 text-sm font-semibold text-heading">{title}</div>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Ko&apos;rsatkich</th>
              <th className="w-24 px-3 py-2 text-right font-semibold">2025</th>
              <th className="w-28 px-3 py-2 text-right font-semibold">Yillik reja</th>
              <th className="w-28 px-3 py-2 text-right font-semibold">Davr rejasi</th>
              <th className="w-28 px-3 py-2 text-right font-semibold">Fakt</th>
              <th className="w-24 px-3 py-2 text-right font-semibold">Farq</th>
              <th className="w-28 px-3 py-2 text-center font-semibold">Bajarilish</th>
              <th className="w-24 px-3 py-2 text-right font-semibold">Yillikdan</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const ratio = r.plan && r.fact !== null ? r.fact / r.plan : null;
              const ofYear = r.annual && r.fact !== null ? r.fact / r.annual : null;
              const diff = r.fact !== null && r.plan !== null ? r.fact - r.plan : null;
              return (
                <tr key={`${r.code}-${i}`} className={cn('border-t border-(--color-line)', r.level === 0 && 'bg-brand-50/40 font-semibold text-heading')}>
                  <td className={cn('px-3 py-1.5', r.level === 1 && 'pl-7', r.level === 2 && 'pl-11 text-(--color-text-muted)')}>{r.name}</td>
                  <td className="money px-3 py-1.5 text-right text-(--color-text-muted)">{mln(r.prior, count ? 0 : digits)}</td>
                  <td className="money px-3 py-1.5 text-right">{mln(r.annual, count ? 0 : digits)}</td>
                  <td className="money px-3 py-1.5 text-right">{mln(r.plan, count ? 0 : digits)}</td>
                  <td className="money px-3 py-1.5 text-right font-semibold text-heading">{mln(r.fact, digits)}</td>
                  <td className={cn('money px-3 py-1.5 text-right', diff !== null && diff * r.sign < 0 ? 'text-(--color-expense)' : 'text-(--color-text-muted)')}>{diff === null ? '—' : `${diff > 0 ? '+' : ''}${mln(diff, digits)}`}</td>
                  <td className="px-3 py-1.5 text-center">
                    <Pill ratio={ratio} sign={r.sign} />
                  </td>
                  <td className="money px-3 py-1.5 text-right text-(--color-text-muted)">{pct(ofYear)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {note && <p className="border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">{note}</p>}
    </div>
  );
}