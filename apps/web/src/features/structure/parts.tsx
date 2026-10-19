'use client';

import { CalcButton, CalcValue } from '@/components/ui/calc';
import { Card } from '@/components/ui/card';
import type { Calc } from '@/lib/calc';
import { cn } from '@/lib/utils';
import type React from 'react';
import type { ReactNode } from 'react';
import { COMPARE_OPTIONS, SECTION_OPTIONS, type CompareMode, type SectionFilter } from './api';

// ═══════════════════════════════════════════════════════════
// Tarkib sahifalari uchun umumiy, sokin ko'rinishdagi bo'laklar
// ═══════════════════════════════════════════════════════════

/** Tugmalar guruhi (bittasi tanlanadi) */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-(--radius-control) bg-(--color-surface-sunken) p-0.5" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          title={option.hint}
          onClick={() => onChange(option.value)}
          className={cn(
            'whitespace-nowrap rounded-[calc(var(--radius-control)-2px)] transition-all',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm',
            value === option.value
              ? 'bg-brand-500 font-semibold text-white shadow-sm'
              : 'font-medium text-(--color-text-muted) hover:bg-white hover:text-heading',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Barchasi / Doimiy / Boshqa */
export function SectionToggle({ value, onChange }: { value: SectionFilter; onChange: (value: SectionFilter) => void }) {
  return <Segmented value={value} options={SECTION_OPTIONS} onChange={onChange} />;
}

/** Nima bilan solishtiriladi */
export function CompareToggle({ value, onChange }: { value: CompareMode; onChange: (value: CompareMode) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-(--color-text-muted)">Solishtirish:</span>
      <Segmented value={value} options={COMPARE_OPTIONS} onChange={onChange} />
    </div>
  );
}

/**
 * Ko'rinish yorliqlari (kartochka ichida) — "tabletka" tugmalar qatori.
 * Hammasi doim ko'rinadi, istalganiga to'g'ridan-to'g'ri o'tiladi.
 */
export function ViewTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-(--color-line) px-5 py-3" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          title={option.hint}
          onClick={() => onChange(option.value)}
          className={cn(
            'whitespace-nowrap rounded-(--radius-control) px-4 py-2 text-sm transition-all',
            value === option.value
              ? 'bg-brand-500 font-semibold text-white shadow-pill'
              : 'bg-(--color-surface-muted) font-medium text-heading hover:bg-brand-50 hover:text-brand-700',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Kichik ikkinchi darajali tugma */
export function SmallButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 py-1 text-xs font-medium text-(--color-text) transition-colors hover:bg-(--color-surface-muted) disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

/** Qidiruv maydoni */
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? 'Qidirish…'}
      className="h-8 w-56 rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 text-sm outline-none placeholder:text-(--color-text-faint) focus:border-brand-400"
    />
  );
}

/** Kichik ko'rsatkich (label + qiymat + izoh) */
export function Stat({ label, value, sub, valueClass, calc }: { label: string; value: ReactNode; sub?: ReactNode; valueClass?: string; calc?: Calc | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-(--color-text-muted)">{label}</dt>
      <dd className={cn('mt-0.5 text-base font-semibold tabular-nums text-(--color-text)', valueClass)}>
        <CalcValue calc={calc}>{value}</CalcValue>
      </dd>
      {sub && <dd className="mt-0.5 truncate text-xs text-(--color-text-faint)">{sub}</dd>}
    </div>
  );
}

/** Bo'lim sarlavhasi: nom, izoh, o'ng tomonda boshqaruv */
export function PanelHeader({ title, description, actions, children }: { title: string; description?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-heading">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-(--color-text-muted)">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-2.5">{children}</div>}
    </Card>
  );
}

/** Asosiy ko'rsatkichlar — bitta qatorda, ajratuvchi chiziqlar bilan */
export interface KpiItem {
  label: string;
  value: string;
  valueClass?: string;
  sub?: ReactNode;
  /** O'ng yuqori burchakda: masalan, Munosabat belgisi */
  mark?: ReactNode;
  /** «Qanday hisoblandi?» — qiymat bosilganda bosqichma-bosqich hisob */
  calc?: Calc | null;
}

export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <Card className="grid divide-y divide-(--color-line) sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
      {items.map((item, i) => (
        <div key={item.label} className={cn('px-5 py-4', i % 2 === 1 && 'sm:border-l sm:border-(--color-line) xl:border-l-0', i >= 2 && 'sm:border-t sm:border-(--color-line) xl:border-t-0')}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-(--color-text-muted)">{item.label}</p>
            <span className="flex items-center gap-1.5">
              <CalcButton calc={item.calc} />
              {item.mark}
            </span>
          </div>
          <p className={cn('mt-1.5 text-xl font-bold tabular-nums tracking-tight text-heading', item.valueClass)}>
            <CalcValue calc={item.calc}>{item.value}</CalcValue>
          </p>
          {item.sub && <div className="mt-1 text-xs text-(--color-text-muted)">{item.sub}</div>}
        </div>
      ))}
    </Card>
  );
}

/** Asosiy xulosalar — raqamlangan ro'yxat */
export function Findings({ title = 'Asosiy xulosalar', notes }: { title?: string; notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <Card className="border-l-4 border-l-brand-500">
      <div className="px-5 py-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{title}</h3>
        <ol className="mt-2.5 space-y-2 text-sm leading-relaxed text-(--color-text)">
          {notes.map((note, i) => (
            <li key={note} className="flex gap-3">
              <span className="w-4 shrink-0 text-right font-semibold tabular-nums text-(--color-text-faint)">{i + 1}.</span>
              <span>{note}</span>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

/** Tahliliy model kartasi: raqam, nom, savol, grafik va "qanday o'qiladi" */
export function ModelCard({
  index,
  title,
  question,
  howTo,
  aside,
  className,
  children,
}: {
  index: number;
  title: string;
  question: string;
  howTo?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex items-start justify-between gap-3 border-b border-(--color-line) px-5 py-3.5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-faint)">Model {index}</p>
          <h3 className="mt-0.5 text-sm font-semibold text-(--color-text)">{title}</h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">{question}</p>
        </div>
        {aside && <div className="shrink-0 text-right">{aside}</div>}
      </div>
      <div className="flex-1 px-5 py-4">{children}</div>
      {howTo && (
        <div className="border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-2.5 text-xs leading-relaxed text-(--color-text-muted)">
          <span className="font-semibold text-(--color-text)">Qanday o&apos;qiladi: </span>
          {howTo}
        </div>
      )}
    </Card>
  );
}

/** Kichik bo'lim sarlavhasi (kartalar guruhi ustida) */
export function GroupTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-(--color-line) pb-2 pt-2">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-(--color-text)">{title}</h3>
      {description && <p className="text-xs text-(--color-text-muted)">{description}</p>}
    </div>
  );
}

/** Ulush chizig'i (jadvallar uchun) */
export function ShareBar({ percent, color = '#4a78dd' }: { percent: number; color?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--color-surface-sunken)">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: color }} />
      </div>
      <span className="w-12 text-right text-xs tabular-nums text-(--color-text-muted)">{percent.toFixed(1).replace('.', ',')}%</span>
    </div>
  );
}