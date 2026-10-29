'use client';

import { Button } from '@/components/ui/button';
import { expensesApi } from '@/features/expenses/api';
import { incomesApi } from '@/features/incomes/api';
import { formatDate } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useEffect, useState } from 'react';

/**
 * Davr ma'lumotga moslashadi.
 * Tanlangan davrda daromad ham, xarajat ham bo'lmasa, lekin bazada boshqa sanalarda yozuv bo'lsa:
 *   — auto (standart): sessiyada bir marta davr avtomatik «ma'lumot bor oraliq»ga o'tkaziladi va bu haqda yozib qo'yiladi;
 *   — keyin foydalanuvchi yana bo'sh davrni tanlasa — avtomatik emas, tugma bilan taklif qilinadi.
 * Manzilda ?dateFrom= berilgan bo'lsa (havola orqali kelingan) — avtomatik o'zgartirilmaydi.
 */
interface Found {
  incomes: number;
  expenses: number;
  first: string;
  last: string;
}

const SESSION_KEY = 'kt.period.autofit';
const day = (s: string) => s.slice(0, 10);
const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
const today = () => new Date().toISOString().slice(0, 10);
function monthEnd(s: string): string {
  const [y, m] = s.slice(0, 7).split('-').map(Number) as [number, number];
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return end > today() ? today() : end;
}

type Lister = (f: { limit: number; page?: number }) => Promise<{ data: { date: string }[]; meta: { total: number } }>;
async function edges(list: Lister) {
  const latest = await list({ limit: 1 });
  const total = latest.meta.total;
  if (!total || !latest.data[0]) return null;
  const oldest = total > 1 ? await list({ limit: 1, page: total }) : latest;
  return { total, last: day(latest.data[0].date), first: day((oldest.data[0] ?? latest.data[0]).date) };
}

function autoUsed(): boolean {
  try {
    return window.sessionStorage.getItem(SESSION_KEY) === '1';
  } catch {
    return false;
  }
}
function markAuto() {
  try {
    window.sessionStorage.setItem(SESSION_KEY, '1');
  } catch {
    // eslab qolinmasa ham ishlayveradi
  }
}
function linkedRange(): boolean {
  if (typeof window === 'undefined') return false;
  const p = new URLSearchParams(window.location.search);
  return p.has('dateFrom') || p.has('period');
}

export function PeriodDataHint({ className, auto = true }: { className?: string; auto?: boolean }) {
  const { range, setRange } = usePeriod();
  const [found, setFound] = useState<Found | null>(null);
  /** Avtomatik o'zgartirilgan bo'lsa — qaysi davrdan */
  const [switched, setSwitched] = useState<{ from: string; to: string } | null>(null);

  useEffect(() => {
    let alive = true;
    setFound(null);
    (async () => {
      try {
        const f = { dateFrom: range.from, dateTo: range.to, limit: 1 };
        const [a, b] = await Promise.all([incomesApi.list(f), expensesApi.list(f)]);
        if (a.meta.total > 0 || b.meta.total > 0) return;
        const [inc, exp] = await Promise.all([edges((q) => incomesApi.list(q)), edges((q) => expensesApi.list(q))]);
        if (!alive || (!inc && !exp)) return;
        const firsts = [inc?.first, exp?.first].filter(Boolean) as string[];
        const lasts = [inc?.last, exp?.last].filter(Boolean) as string[];
        const next: Found = { incomes: inc?.total ?? 0, expenses: exp?.total ?? 0, first: firsts.sort()[0]!, last: lasts.sort().reverse()[0]! };
        if (auto && !autoUsed() && !linkedRange()) {
          markAuto();
          setSwitched({ from: range.from, to: range.to });
          setRange({ from: monthStart(next.first), to: monthEnd(next.last) });
          return;
        }
        setFound(next);
      } catch {
        // yordamchi tekshiruv — xato bo'lsa, shunchaki ko'rsatilmaydi
      }
    })();
    return () => {
      alive = false;
    };
    // setRange barqaror (useCallback) — bog'liqlikda bo'lsa ham qayta ishlamaydi
  }, [range.from, range.to, auto, setRange]);

  if (found) {
    const all = { from: monthStart(found.first), to: monthEnd(found.last) };
    const lastMonth = { from: monthStart(found.last), to: monthEnd(found.last) };
    return (
      <div className={`rounded-(--radius-card) border border-(--color-warn) bg-(--color-warn-soft) px-4 py-3 text-sm ${className ?? ''}`}>
        <p className="text-heading font-semibold">
          Tanlangan davrda ({formatDate(range.from)} — {formatDate(range.to)}) yozuv yo&apos;q, lekin ma&apos;lumotlaringiz bazada bor
        </p>
        <p className="mt-1 text-(--color-text-muted)">
          {found.incomes.toLocaleString('ru-RU')} ta daromad va {found.expenses.toLocaleString('ru-RU')} ta xarajat — sanalari {formatDate(found.first)} dan{' '}
          {formatDate(found.last)} gacha.
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setRange(all)}>
            Hamma ma&apos;lumot ({formatDate(all.from)} — {formatDate(all.to)})
          </Button>
          {lastMonth.from !== all.from && (
            <Button size="sm" variant="secondary" onClick={() => setRange(lastMonth)}>
              Oxirgi yozuv oyi
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (switched) {
    return (
      <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-(--radius-card) border border-brand-200 bg-brand-50 px-4 py-2.5 text-sm ${className ?? ''}`}>
        <span className="text-heading">
          Davr ma&apos;lumotlaringizga moslandi: {formatDate(range.from)} — {formatDate(range.to)}
        </span>
        <span className="text-xs text-(--color-text-muted)">
          ({formatDate(switched.from)} — {formatDate(switched.to)} oralig&apos;ida yozuv yo&apos;q edi. Davrni tepadagi «Davr» tugmasidan o&apos;zgartirish mumkin.)
        </span>
        <button type="button" className="ml-auto text-xs text-(--color-text-faint) hover:text-(--color-text)" onClick={() => setSwitched(null)}>
          Yopish
        </button>
      </div>
    );
  }
  return null;
}