'use client';

import { formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRef, useState, type ReactNode } from 'react';
import { monthLabel, shiftMonth } from './api';

// Hududchi sahifalari uchun umumiy bo'laklar

/** ‹ Oktabr 2026 › — oy tanlash */
export function MonthPicker({ value, onChange, max }: { value: string; onChange: (v: string) => void; max?: string }) {
  return (
    <div className="flex items-center gap-1 rounded-xl bg-white p-1 shadow-card">
      <button type="button" onClick={() => onChange(shiftMonth(value, -1))} className="flex size-9 items-center justify-center rounded-lg text-xl hover:bg-brand-50" aria-label="Oldingi oy">
        ‹
      </button>
      <span className="min-w-36 text-center text-[15px] font-bold text-heading">{monthLabel(value)}</span>
      <button
        type="button"
        onClick={() => onChange(shiftMonth(value, 1))}
        disabled={Boolean(max && value >= max)}
        className="flex size-9 items-center justify-center rounded-lg text-xl hover:bg-brand-50 disabled:opacity-30"
        aria-label="Keyingi oy"
      >
        ›
      </button>
    </div>
  );
}

/** Fayl tashlash maydoni (.xlsx) */
export function Dropzone({ onFile, busy, title, hint, tone = 'brand' }: { onFile: (f: File) => void; busy?: boolean; title: string; hint: ReactNode; tone?: 'brand' | 'emerald' }) {
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (f: File | undefined) => {
    if (f) onFile(f);
    if (ref.current) ref.current.value = '';
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && ref.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && ref.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!busy) pick(e.dataTransfer.files?.[0]);
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-(--radius-card) border-2 border-dashed px-6 py-10 text-center transition-colors',
        tone === 'emerald' ? 'border-emerald-300 bg-emerald-50/50 hover:bg-emerald-50' : 'border-brand-300 bg-brand-50/40 hover:bg-brand-50',
        over && (tone === 'emerald' ? 'bg-emerald-100' : 'bg-brand-100'),
        busy && 'cursor-wait opacity-70',
      )}
    >
      <input ref={ref} type="file" accept=".xlsx" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <span className={cn('flex size-14 items-center justify-center rounded-full text-2xl text-white shadow-md', tone === 'emerald' ? 'bg-emerald-500' : 'bg-brand-600')}>{busy ? '…' : '⇪'}</span>
      <p className="text-lg font-bold text-heading">{busy ? "Fayl o'qilmoqda…" : title}</p>
      <p className="max-w-xl text-sm text-(--color-text-muted)">{hint}</p>
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'brand' | 'ok' | 'warn' | 'bad' | 'plain' }) {
  return (
    <div
      className={cn(
        'rounded-(--radius-card) p-4 shadow-card',
        tone === 'brand' ? 'bg-gradient-to-br from-brand-600 to-brand-800 text-white' : tone === 'ok' ? 'bg-gradient-to-br from-emerald-600 to-emerald-700 text-white' : 'bg-white',
      )}
    >
      <p className={cn('text-xs font-semibold', tone === 'brand' || tone === 'ok' ? 'text-white/80' : 'text-(--color-text-muted)')}>{label}</p>
      <p className={cn('money mt-1 truncate text-[22px] font-bold leading-tight', tone === 'warn' ? 'text-amber-600' : tone === 'bad' ? 'text-(--color-expense)' : tone === 'brand' || tone === 'ok' ? 'text-white' : 'text-heading')}>{value}</p>
      {hint && <p className={cn('mt-0.5 text-xs', tone === 'brand' || tone === 'ok' ? 'text-white/75' : 'text-(--color-text-muted)')}>{hint}</p>}
    </div>
  );
}

export const som = (t: string | null | undefined) => (t === null || t === undefined ? '—' : formatTiyin(t));

export function Notice({ tone, children }: { tone: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode }) {
  const cls = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    bad: 'border-red-200 bg-red-50 text-red-900',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }[tone];
  return <div className={cn('rounded-(--radius-card) border px-4 py-3 text-sm', cls)}>{children}</div>;
}