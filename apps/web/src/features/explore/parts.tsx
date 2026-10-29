'use client';

import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';
import { ReportCard, RTable, Td, Th, Tr } from '@/components/report/report';
import { change, goodUp, pctSigned, short, som, spanText, type Filter, type Kind, type RecordRow, type Span } from './api';
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
      <span className={cn('money font-semibold', good === null ? 'text-(--color-text-faint)' : good ? 'text-(--color-income)' : 'text-(--color-expense)')}>{c === null ? '' : pctSigned(c)}</span>
    </div>
  );
}

/** Qaysi davrlar solishtirilayotgani */
export function SpansNote({ cur, prev, ly }: { cur: Span; prev: Span; ly: Span }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-(--color-text-muted)">
      <span className="rounded-full border border-(--color-line) bg-white px-3 py-1">
        <b className="text-heading">Joriy davr:</b> {spanText(cur)}
      </span>
      <span className="rounded-full border border-(--color-line) bg-white px-3 py-1">
        <b className="text-heading">O&apos;tgan davr:</b> {spanText(prev)}
      </span>
      <span className="rounded-full border border-(--color-line) bg-white px-3 py-1">
        <b className="text-heading">O&apos;tgan yil:</b> {spanText(ly)}
      </span>
      <span className="ml-auto text-(--color-text-faint)">Istalgan summani bosing — uni tashkil qilgan yozuvlar ochiladi</span>
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 pt-2">
      <h2 className="text-base font-bold text-heading">{children}</h2>
      {hint && <p className="text-xs text-(--color-text-muted)">{hint}</p>}
    </div>
  );
}

/** Kesim tanlash (jadval ustida) — tabletka tugmalar */
export function Switch<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; count?: number }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-10 whitespace-nowrap rounded-lg border px-3 text-sm font-semibold transition-colors',
            value === o.value ? 'border-brand-600 bg-brand-600 text-white shadow-pill' : 'border-brand-300 bg-white text-brand-700 hover:bg-brand-50',
          )}
        >
          {o.label}
          {o.count !== undefined && <span className={cn('ml-1.5 text-xs font-medium', value === o.value ? 'text-white/80' : 'text-(--color-text-faint)')}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Davrdagi eng katta yozuvlar */
export function TopRecords({ rows, kind, title }: { rows: RecordRow[]; kind: Kind; title: string }) {
  const income = kind === 'income';
  return (
    <ReportCard title={title} badge={`Joriy davrdagi eng katta ${rows.length} ta yozuv`}>
      <RTable minWidth={900}>
        <thead>
          <tr>
            <Th className="w-12">№</Th>
            <Th className="w-28">Sana</Th>
            <Th className="text-left">Modda</Th>
            <Th className="text-left">Birlik / bo&apos;lim</Th>
            <Th className="text-left">{income ? 'Mijoz' : 'Kontragent'} · izoh</Th>
            <Th className="w-40">Summa</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x, i) => (
            <Tr key={x.id}>
              <Td className="text-(--color-text-faint)">{i + 1}</Td>
              <Td className="whitespace-nowrap">{formatDate(x.date)}</Td>
              <Td className="text-left text-heading">{x.category}</Td>
              <Td className="text-left">
                {x.unitLabel}
                {x.placeLabel && <span className="block text-[11px] text-(--color-warn)" title="Xarajatlar siyosati bo‘yicha shu birlik hisobiga o‘tkazilgan">siyosat: yozilgan — {x.placeLabel}</span>}
                {x.department && <span className="block text-[11px] text-(--color-text-muted)">{x.department}</span>}
              </Td>
              <Td className="max-w-[18rem] text-left">
                {x.party && <span className="block truncate text-heading">{x.party}</span>}
                {x.description && <span className="block truncate text-[11px] text-(--color-text-muted)">{x.description}</span>}
                {!x.party && !x.description && <span className="text-(--color-text-faint)"></span>}
              </Td>
              <Td className="whitespace-nowrap font-semibold text-heading">{som(x.amount)}</Td>
            </Tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-sm text-(--color-text-muted)">
                Bu davrda yozuv yo&apos;q
              </td>
            </tr>
          )}
        </tbody>
      </RTable>
    </ReportCard>
  );
}
