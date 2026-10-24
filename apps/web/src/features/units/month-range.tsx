'use client';

import { Card, CardBody } from '@/components/ui/card';
import { usePeriod } from '@/lib/period';
import { cn } from '@/lib/utils';
import { useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Oylar oralig'i (Dan — Gacha): bo'lim sahifalarida (Ijara va kommunal, Bank xarajatlari …).
// ═══════════════════════════════════════════════════════════

const MONTHS_UZ = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
export const monthLabel = (p: string) => `${MONTHS_UZ[Number(p.slice(5, 7)) - 1] ?? p} ${p.slice(0, 4)}`;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MAX_RANGE_MONTHS = 24;

export function monthsCount(from: string, to: string): number {
  if (!PERIOD_RE.test(from) || !PERIOD_RE.test(to)) return 0;
  const a = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7));
  const b = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  return b - a + 1;
}

export interface MonthRange {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  count: number;
  /** Xato bo'lsa — matn, aks holda null */
  error: string | null;
  /** «Yanvar 2026 – Aprel 2026» */
  text: string;
  /** Saqlangan oylar ko'rinsin: oraliqni kengaytiradi */
  include: (months: string[]) => void;
  preset: (kind: 'month' | 'quarter' | 'year') => void;
}

/** Standart: yil boshidan joriy (yuqori paneldagi) oygacha */
export function useMonthRange(): MonthRange {
  const { month } = usePeriod();
  const [from, setFrom] = useState(`${month.slice(0, 4)}-01`);
  const [to, setTo] = useState(month);
  const count = monthsCount(from, to);
  const error = !PERIOD_RE.test(from) || !PERIOD_RE.test(to) ? 'Oylarni tanlang' : count < 1 ? "«Dan» oyi «Gacha»dan keyin bo'lmasin" : count > MAX_RANGE_MONTHS ? `Ko'pi bilan ${MAX_RANGE_MONTHS} oy` : null;
  const text = error ? '' : from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`;
  return {
    from,
    to,
    setFrom,
    setTo,
    count,
    error,
    text,
    include: (months) => {
      const sorted = [...months].sort();
      if (!sorted.length) return;
      if (sorted[0]! < from) setFrom(sorted[0]!);
      if (sorted[sorted.length - 1]! > to) setTo(sorted[sorted.length - 1]!);
    },
    preset: (kind) => {
      const y = month.slice(0, 4);
      const m = Number(month.slice(5, 7));
      if (kind === 'month') {
        setFrom(month);
        setTo(month);
      } else if (kind === 'year') {
        setFrom(`${y}-01`);
        setTo(month);
      } else {
        const q0 = Math.floor((m - 1) / 3) * 3 + 1;
        setFrom(`${y}-${String(q0).padStart(2, '0')}`);
        setTo(`${y}-${String(q0 + 2).padStart(2, '0')}`);
      }
    },
  };
}

export function MonthRangeCard({ range }: { range: MonthRange }) {
  const input = 'mt-1 block h-9 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm text-heading';
  return (
    <Card>
      <CardBody className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-(--color-text-muted)">
          Dan
          <input type="month" value={range.from} onChange={(e) => range.setFrom(e.target.value)} className={input} />
        </label>
        <label className="text-xs font-medium text-(--color-text-muted)">
          Gacha
          <input type="month" value={range.to} onChange={(e) => range.setTo(e.target.value)} className={input} />
        </label>
        <div className="flex flex-wrap gap-1.5 pb-0.5">
          {(
            [
              ['month', 'Shu oy'],
              ['quarter', 'Shu chorak'],
              ['year', 'Yil boshidan'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" onClick={() => range.preset(k)} className="rounded-full border border-(--color-line) bg-white px-3 py-1.5 text-xs font-medium text-heading hover:border-brand-300 hover:bg-brand-50">
              {l}
            </button>
          ))}
        </div>
        <p className={cn('ml-auto pb-1.5 text-sm', range.error ? 'text-(--color-expense)' : 'text-(--color-text-muted)')}>
          {range.error ?? (
            <>
              <b className="text-heading">{range.count}</b> oy · {range.text}
            </>
          )}
        </p>
      </CardBody>
    </Card>
  );
}