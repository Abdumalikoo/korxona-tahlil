'use client';

import { Card, CardBody } from '@/components/ui/card';
import { useMonthChange, usePeriod } from '@/lib/period';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';

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

/** Standart: yil boshidan joriy (yuqori paneldagi) oygacha; 'month' — faqat joriy oy */
export function useMonthRange(initial: 'year' | 'month' = 'year'): MonthRange {
  const { month } = usePeriod();
  const [from, setFromRaw] = useState(initial === 'month' ? month : `${month.slice(0, 4)}-01`);
  const [to, setToRaw] = useState(month);
  // Foydalanuvchi oraliqni o'zi tanlamagan bo'lsa — yuqoridagi «Davr» o'zgarganda oraliq ham unga ergashadi
  const edited = useRef(false);
  const setFrom = (v: string) => {
    edited.current = true;
    setFromRaw(v);
  };
  const setTo = (v: string) => {
    edited.current = true;
    setToRaw(v);
  };
  useMonthChange(month, () => {
    if (edited.current) return;
    setFromRaw(initial === 'month' ? month : `${month.slice(0, 4)}-01`);
    setToRaw(month);
  });
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
      if (sorted[0]! < from) setFromRaw(sorted[0]!);
      if (sorted[sorted.length - 1]! > to) setToRaw(sorted[sorted.length - 1]!);
    },
    preset: (kind) => {
      edited.current = false;
      const y = month.slice(0, 4);
      const m = Number(month.slice(5, 7));
      if (kind === 'month') {
        setFromRaw(month);
        setToRaw(month);
      } else if (kind === 'year') {
        setFromRaw(`${y}-01`);
        setToRaw(month);
      } else {
        const q0 = Math.floor((m - 1) / 3) * 3 + 1;
        setFromRaw(`${y}-${String(q0).padStart(2, '0')}`);
        setToRaw(`${y}-${String(q0 + 2).padStart(2, '0')}`);
      }
    },
  };
}

/** Oy tanlash — o'zbekcha (brauzerning oy maydoni tizim tilida — ruscha — chiqardi): oy va yil ro'yxatlari */
export function MonthSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const cls = 'h-9 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm text-heading focus:border-brand-600 focus:outline-none';
  const y = PERIOD_RE.test(value) ? Number(value.slice(0, 4)) : new Date().getFullYear();
  const m = PERIOD_RE.test(value) ? Number(value.slice(5, 7)) : new Date().getMonth() + 1;
  const now = new Date().getFullYear();
  const years = Array.from({ length: Math.max(now, y) - Math.min(2020, y) + 2 }, (_, i) => Math.min(2020, y) + i);
  const set = (yy: number, mm: number) => onChange(`${yy}-${String(mm).padStart(2, '0')}`);
  return (
    <span className="mt-1 flex gap-1">
      <select aria-label={`${label}: oy`} value={m} onChange={(e) => set(y, Number(e.target.value))} className={cls}>
        {MONTHS_UZ.map((name, i) => (
          <option key={name} value={i + 1}>
            {name}
          </option>
        ))}
      </select>
      <select aria-label={`${label}: yil`} value={y} onChange={(e) => set(Number(e.target.value), m)} className={cls}>
        {years.map((yy) => (
          <option key={yy} value={yy}>
            {yy}
          </option>
        ))}
      </select>
    </span>
  );
}

export function MonthRangeCard({ range }: { range: MonthRange }) {
  // Sahifa o'z oralig'ini boshqaradi — yuqoridagi davr tugmasi yashiriladi
  const { claimRange } = usePeriod();
  useEffect(() => claimRange(), [claimRange]);
  return (
    <Card>
      <CardBody className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-(--color-text-muted)">
          Dan
          <MonthSelect label="Dan" value={range.from} onChange={range.setFrom} />
        </label>
        <label className="text-xs font-medium text-(--color-text-muted)">
          Gacha
          <MonthSelect label="Gacha" value={range.to} onChange={range.setTo} />
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