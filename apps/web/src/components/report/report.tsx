'use client';

import { CalcValue } from '@/components/ui/calc';
import type { Calc } from '@/lib/calc';
import { cn } from '@/lib/utils';
import type React from 'react';
import type { ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Hisobot ko'rinishi — yagona uslub (bosh sahifa bo'limlari va Solishtirma):
//  • tepada — ko'rsatkich kartalari (belgi, summa, o'tgan davrga nisbatan o'zgarish);
//  • filtrlar qatori (oq karta);
//  • bitta katta jadval: guruhlangan sarlavhalar (masalan, DAROMAD / XARAJAT / NATIJA),
//    jami qatori och ko'k fonda tepada, farq — yashil/qizil, foiz — rangli nishonda,
//    nomi yonida «›» — bosib ichiga kiriladi.
// Grafiklar yo'q: hamma narsa bir qarashda, raqamlar bilan.
// ═══════════════════════════════════════════════════════════

/** To'liq summa, so'msiz: tiyin → "1 234 567" */
export function sum(tiyin: string | number): string {
  const v = Math.round(Number(tiyin) / 100);
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${v < 0 ? '-' : ''}${s}`;
}

/** O'zgarish foizi; oldingi 0 bo'lsa — null */
export function changeOf(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function pctText(value: number, sign = true): string {
  const prefix = sign && value > 0 ? '+' : value < 0 ? '-' : '';
  return `${prefix}${Math.abs(value).toFixed(2).replace('.', ',')}%`;
}

// ─────────── Ko'rsatkich kartalari ───────────

export type TileTone = 'blue' | 'green' | 'red' | 'purple' | 'orange' | 'cyan';

const TILE_BG: Record<TileTone, string> = {
  blue: 'bg-[#e8eefc] text-[#3a66d2]',
  green: 'bg-[#e3f5ea] text-[#12a150]',
  red: 'bg-[#fdecec] text-[#e5484d]',
  purple: 'bg-[#efeafd] text-[#7c5ce0]',
  orange: 'bg-[#fff3df] text-[#d97706]',
  cyan: 'bg-[#e0f6fb] text-[#0e97b6]',
};

export interface StatTile {
  label: string;
  /** Tiyin */
  value: number;
  /** O'tgan davr qiymati (tiyin); berilmasa — o'zgarish ko'rsatilmaydi */
  previous?: number | null;
  /** O'sish yaxshimi (daromad — ha, xarajat — yo'q) */
  growthGood?: boolean;
  tone?: TileTone;
  icon?: ReactNode;
  /** Qiymat o'rniga matn (masalan, foiz) */
  text?: string;
  /** Pastki izoh (o'zgarish o'rniga) */
  note?: string;
  calc?: Calc | null;
  /** Qiymat manfiy bo'lsa qizil */
  signed?: boolean;
  /** Ma'lumot yuklanmagan — «0» va o'zgarish o'rniga «yuklanmagan» (noto'g'ri xulosa chiqmasin) */
  missing?: boolean;
  onClick?: () => void;
}

/** Kartadagi summa: 1 mlrd so'mdan katta — qisqa («139,43 mlrd»), to'liq summa — ustiga borganda */
const COMPACT_FROM = 1_000_000_000 * 100;
function tileAmount(tiyin: number): { text: string; full: string | null } {
  if (Math.abs(tiyin) < COMPACT_FROM) return { text: sum(tiyin), full: null };
  const v = tiyin / 100 / 1_000_000_000;
  return { text: `${v < 0 ? '-' : ''}${Math.abs(v).toFixed(2).replace('.', ',')} mlrd`, full: `${sum(tiyin)} so'm` };
}

export function StatTiles({ items, compareLabel = "O'tgan davrga nisbatan" }: { items: StatTile[]; compareLabel?: string }) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2', items.length >= 5 ? 'lg:grid-cols-5' : items.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
      {items.map((item) => {
        /** O'tgan davr qiymati bor (0 — ma'lumot yo'q deb olinadi) */
        const hasPrev = item.previous !== undefined && item.previous !== null && item.previous !== 0;
        const change = hasPrev && !item.missing ? changeOf(item.value, item.previous!) : null;
        const amount = tileAmount(item.value);
        const good = change === null ? null : change === 0 ? null : change > 0 === (item.growthGood ?? true);
        const Tag = item.onClick ? 'button' : 'div';
        return (
          <Tag
            key={item.label}
            type={item.onClick ? 'button' : undefined}
            onClick={item.onClick}
            className={cn(
              'flex min-w-0 flex-col gap-3 rounded-2xl bg-white p-4 text-left shadow-card',
              item.onClick && 'transition-shadow hover:shadow-md',
            )}
          >
            <div className="flex items-center gap-2.5">
              <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg', TILE_BG[item.tone ?? 'blue'])}>{item.icon ?? <DefaultIcon />}</span>
              <p className="min-w-0 truncate text-[13px] font-medium text-(--color-text-muted)">{item.label}</p>
            </div>
            <p className={cn('-mt-1 flex flex-wrap items-baseline gap-x-2 text-lg font-bold leading-tight tabular-nums text-heading', item.signed && item.value < 0 && !item.missing && 'text-(--color-expense)')}>
              {item.missing ? (
                <span className="text-base font-semibold text-(--color-warn)">yuklanmagan</span>
              ) : (
                <CalcValue calc={item.calc} className="whitespace-nowrap no-underline">
                  <span title={item.text === undefined ? (amount.full ?? undefined) : undefined}>
                    {item.text ?? amount.text}
                    {item.text === undefined && <span className="ml-1 text-sm font-semibold">so&apos;m</span>}
                  </span>
                </CalcValue>
              )}
              {change !== null && Math.abs(change) < 1000 && (
                <span className={cn('whitespace-nowrap text-xs font-semibold', good === null ? 'text-(--color-text-muted)' : good ? 'text-(--color-income)' : 'text-(--color-expense)')}>
                  {change > 0 ? '▲' : change < 0 ? '▼' : ''} {pctText(Math.abs(change), false)}
                </span>
              )}
            </p>
            <div className="mt-auto flex items-center justify-between gap-2 border-t border-(--color-line) pt-2 text-xs text-(--color-text-faint)">
              <span className="truncate">{item.note ?? (hasPrev ? compareLabel : item.previous === 0 ? "O'tgan davrda ma'lumot yo'q" : '')}</span>
              {hasPrev && !item.note && (
                <span className="whitespace-nowrap tabular-nums text-(--color-text-muted)" title={tileAmount(item.previous!).full ?? undefined}>
                  {tileAmount(item.previous!).text} so&apos;m
                </span>
              )}
            </div>
          </Tag>
        );
      })}
    </div>
  );
}

function DefaultIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

// ─────────── Yorliqlar (tabletka tugmalar) ───────────

/**
 * Yorliqlar (ko'rinish tanlovi) — hamma bo'limda bir xil: balandligi 40 px (qidiruv, Excel va amal tugmalari bilan bir qatorda).
 * count — yorliq yonida son (bo'lsa).
 */
export function PillTabs<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: string; hint?: string; count?: number }[]; onChange: (value: T) => void; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-2', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cn(
            'inline-flex h-10 items-center whitespace-nowrap rounded-lg border px-4 text-sm font-semibold transition-colors',
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

/** Karta sarlavhasidagi amal tugmasi — hamma bo'limda bir xil (40 px, qidiruv va Excel bilan bir qatorda) */
export const ACTION_BTN = 'inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-(--color-line-strong) bg-white px-3.5 text-sm font-semibold text-heading transition-colors hover:border-brand-300 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60';

export function ActionButton({ children, onClick, disabled, title, className }: { children: ReactNode; onClick: () => void; disabled?: boolean; title?: string; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} className={cn(ACTION_BTN, className)}>
      {children}
    </button>
  );
}

/**
 * «Hammasini ochish / yopish» — hamma ichma-ich jadvalda bitta tugma, bir xil ko'rinish.
 * open — hozir biror narsa ochiqmi (ochiq bo'lsa — «yopish»); busy — ochilmoqda (yuklanayotgan bo'lsa).
 */
export function ToggleAllButton({ open, onClick, busy }: { open: boolean; onClick: () => void; busy?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className={ACTION_BTN} aria-expanded={open}>
      <svg viewBox="0 0 24 24" className={cn('size-4 transition-transform', open && 'rotate-180')} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="m6 9 6 6 6-6" />
      </svg>
      {busy ? 'Ochilmoqda…' : open ? 'Hammasini yopish' : 'Hammasini ochish'}
    </button>
  );
}

// ─────────── Filtrlar qatori ───────────

export function FilterBar({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-card">
      <div className="flex flex-wrap items-end gap-3">{children}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-(--color-text-muted)">{label}</span>
      {children}
    </label>
  );
}

export function SelectBox<T extends string>({ value, options, onChange, className }: { value: T; options: { value: T; label: string }[]; onChange: (value: T) => void; className?: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={cn('h-10 min-w-40 rounded-lg border border-(--color-line-strong) bg-white px-3 text-sm text-(--color-text) outline-none focus:border-brand-500', className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? 'Qidirish…'}
      className="h-10 w-60 rounded-lg border border-(--color-line-strong) bg-white px-3 text-sm outline-none placeholder:text-(--color-text-faint) focus:border-brand-500"
    />
  );
}

export function ExcelButton({ onClick, label = 'Excelga eksport' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#1e9e55] px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[#178a49]">
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18M3 15h18M9 3v18" />
      </svg>
      {label}
    </button>
  );
}

// ─────────── Hisobot kartasi ───────────

export function ReportCard({ title, badge, actions, children, className }: { title: ReactNode; badge?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('overflow-hidden rounded-2xl bg-white shadow-card', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h3 className="flex items-center gap-2.5 text-base font-bold text-heading">
          <span className="h-5 w-1 rounded-full bg-brand-600" aria-hidden />
          {title}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {badge && <span className="rounded-full border border-(--color-line) bg-(--color-surface-muted) px-3 py-1 text-xs text-(--color-text-muted)">{badge}</span>}
          {actions}
        </div>
      </div>
      {children}
    </section>
  );
}

// ─────────── Jadval ───────────

export function RTable({ children, minWidth = 1100 }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto px-4 pb-4">
      <table className="w-full border-separate border-spacing-0 rounded-xl border border-(--color-line) text-sm [&_thead_tr:first-child>th:first-child]:rounded-tl-xl [&_thead_tr:first-child>th:last-child]:rounded-tr-xl" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

const HEAD = 'border-b border-l border-(--color-line) bg-[#f3f6fd] px-1.5 py-2.5 text-center text-xs font-bold text-heading first:border-l-0';

/** Chapda qotib turadigan ustunlar (jadval o'ngga suriladi, № va nom ko'rinib turadi) */
export const STICKY_NO = 'sticky left-0 z-[1] w-12 min-w-12';
export const STICKY_NAME = 'sticky left-12 z-[1] shadow-[1px_0_0_var(--color-line)]';

export function Th({ children, className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn(HEAD, className)} {...props}>
      {children}
    </th>
  );
}

/** Guruh sarlavhasi (KUNLIK / OYLIK, DAROMAD / XARAJAT …) */
export function GroupTh({ children, span, className }: { children: ReactNode; span: number; className?: string }) {
  return (
    <th colSpan={span} className={cn(HEAD, 'tracking-wider uppercase', className)}>
      {children}
    </th>
  );
}

const CELL = 'border-b border-l border-(--color-line) px-1.5 py-2 text-center text-[12.5px] tabular-nums first:border-l-0';

export function Td({ children, className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn(CELL, className)} {...props}>
      {children}
    </td>
  );
}

/** Qator: bosilsa — ichiga kirish */
export function Tr({ children, onClick, onDoubleClick, total, muted, className, title }: { children: ReactNode; onClick?: () => void; onDoubleClick?: () => void; total?: boolean; muted?: boolean; className?: string; title?: string }) {
  return (
    <tr
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={title}
      className={cn(
        onClick && 'cursor-pointer',
        '[&>td]:bg-inherit',
        total ? 'bg-[#eaf0fd] font-bold text-heading' : muted ? 'bg-[#f8f9fc]' : 'odd:bg-white even:bg-[#fafbfe]',
        onClick && !total && 'hover:bg-brand-50',
        className,
      )}
    >
      {children}
    </tr>
  );
}

/** Nom katakchasi: chapga tekislangan, «›» bilan (ichiga kiriladi) */
export function NameCell({ children, sub, drill, className, before, sticky = true }: { children: ReactNode; sub?: ReactNode; drill?: boolean; className?: string; before?: ReactNode; sticky?: boolean }) {
  return (
    <td className={cn(CELL, 'text-left', sticky && STICKY_NAME, className)}>
      <span className="flex items-center gap-1.5">
        {before}
        <span className={cn('min-w-0 max-w-52', drill && 'font-medium text-heading')}>
          <span className="block leading-snug">{children}</span>
          {sub && <span className="block truncate text-[11px] font-normal text-(--color-text-faint)">{sub}</span>}
        </span>
        {drill && <span className="shrink-0 text-(--color-text-faint)">›</span>}
      </span>
    </td>
  );
}

/** Summa katakchasi (tiyin) — «Qanday hisoblandi?» bilan */
export function MoneyCell({ value, calc, className, strong, signedColor }: { value: number; calc?: Calc | null; className?: string; strong?: boolean; signedColor?: boolean }) {
  return (
    <Td className={cn('whitespace-nowrap', strong && 'font-semibold', signedColor && (value < 0 ? 'text-(--color-expense)' : value > 0 ? 'text-(--color-income)' : ''), className)}>
      <CalcValue calc={calc} className="no-underline">
        {sum(value)}
      </CalcValue>
    </Td>
  );
}

/** Farq katakchasi: +1 093 500 (yashil) / -334 000 (qizil); growthGood=false — xarajatda o'sish qizil */
export function DiffCell({ value, growthGood = true, calc, className, pct }: { value: number; growthGood?: boolean; calc?: Calc | null; className?: string; /** Berilsa — farq yonida foiz (qavsda) */ pct?: number | null }) {
  const rounded = Math.round(value / 100);
  const good = rounded === 0 ? null : rounded > 0 === growthGood;
  return (
    <Td className={cn('whitespace-nowrap font-semibold', good === null ? 'text-(--color-text-faint)' : good ? 'text-(--color-income)' : 'text-(--color-expense)', className)}>
      <CalcValue calc={calc} className="no-underline">
        {rounded > 0 ? '+' : ''}
        {sum(value)}
      </CalcValue>
      <PctInline value={pct ?? null} growthGood={growthGood} />
    </Td>
  );
}

/** Foiz nishoni (alohida ishlatish uchun) */
export function PctBadge({ value, growthGood = true, plain, className }: { value: number | null; growthGood?: boolean; plain?: boolean; className?: string }) {
  // Foiz yo'q (oldingi davr 0) — hech narsa ko'rsatilmaydi
  if (value === null || !Number.isFinite(value) || (!plain && Math.abs(value) >= 1000)) return null;
  const near = Math.abs(value) < 0.005;
  const good = near ? null : value > 0 === growthGood;
  return (
    <span
      className={cn(
        'whitespace-nowrap text-xs font-semibold',
        plain ? (value < 0 ? 'text-(--color-expense)' : 'text-heading') : good === null ? 'text-(--color-text-muted)' : good ? 'text-(--color-income)' : 'text-(--color-expense)',
        className,
      )}
    >
      {plain ? `${value < 0 ? '-' : ''}${Math.abs(value).toFixed(1).replace('.', ',')}%` : pctText(value)}
    </span>
  );
}

/** Foiz — summa yonida, bir qatorda, oddiy rangli matn: «(+9,1%)» */
export function PctInline({ value, growthGood = true, className }: { value: number | null; growthGood?: boolean; className?: string }) {
  // Juda katta o'zgarish (oldingi davr deyarli 0) — foiz ma'nosiz, ko'rsatilmaydi
  if (value === null || !Number.isFinite(value) || Math.abs(value) >= 1000) return null;
  const near = Math.abs(value) < 0.05;
  const good = near ? null : value > 0 === growthGood;
  const text = `${value > 0 ? '+' : value < 0 ? '-' : ''}${Math.abs(value).toFixed(1).replace('.', ',')}%`;
  return (
    <span className={cn('ml-1 whitespace-nowrap text-[11px] font-semibold', good === null ? 'text-(--color-text-muted)' : good ? 'text-(--color-income)' : 'text-(--color-expense)', className)}>
      ({text})
    </span>
  );
}

/** Foiz nishoni: +2,84% (yashil fon) / -5,28% (qizil fon) */
export function PctCell({ value, growthGood = true, plain, className }: { value: number | null; growthGood?: boolean; plain?: boolean; className?: string }) {
  if (value === null || !Number.isFinite(value) || (!plain && Math.abs(value) >= 1000)) {
    return <Td className={className} />;
  }
  const near = Math.abs(value) < 0.005;
  const good = near ? null : value > 0 === growthGood;
  return (
    <Td
      className={cn(
        'whitespace-nowrap font-semibold',
        plain ? (value < 0 ? 'text-(--color-expense)' : 'text-heading') : good === null ? 'text-(--color-text-muted)' : good ? 'text-(--color-income)' : 'text-(--color-expense)',
        className,
      )}
    >
      {plain ? `${value < 0 ? '-' : ''}${Math.abs(value).toFixed(1).replace('.', ',')}%` : pctText(value)}
    </Td>
  );
}

/** Jadval ostidagi izoh */
export function TableNote({ children }: { children: ReactNode }) {
  return <p className="px-5 pb-4 text-xs leading-relaxed text-(--color-text-muted)">{children}</p>;
}
