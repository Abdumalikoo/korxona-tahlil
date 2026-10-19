'use client';

import { useAuth } from '@/lib/auth-context';
import { currentPeriod, formatPeriod, formatPeriodShort, formatTiyin, shiftPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/shared/period-picker';
import { Card, CardHeader } from '@/components/ui/card';
import { IconArrowRight, IconPlus } from '@/components/ui/icons';
import { Change, Money } from '@/components/ui/money';
import { ErrorState } from '@/components/ui/states';

import {
    partHref,
    SECTION_HINTS,
    SECTION_LABELS,
    SECTION_NAV,
    sectionsApi,
    type SectionKind,
    type SectionSummary,
    type SectionValue,
} from './api';

function periodFromUrl(value: string | null): string {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : currentPeriod();
}

/** Doimiy — asosiy rang, Boshqa — sariq */
const TONE: Record<SectionValue, { bar: string; text: string; border: string; soft: string }> = {
  DOIMIY: {
    bar: 'bg-brand-700',
    text: 'text-brand-800',
    border: 'hover:border-brand-600',
    soft: 'bg-brand-50',
  },
  BOSHQA: {
    bar: 'bg-[--color-warn]',
    text: 'text-[--color-warn]',
    border: 'hover:border-[--color-warn]',
    soft: 'bg-[--color-warn-soft]',
  },
};

/**
 * Xarajatlar / Daromadlar kirish sahifasi — ikki katta karta:
 * Doimiy va Boshqa. Kartani bosganda bo'lim ochiladi.
 */
export function SectionLanding({ kind }: { kind: SectionKind }) {
  const { isAdmin } = useAuth();
  const nav = SECTION_NAV[kind];
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [period, setPeriodState] = useState(() => periodFromUrl(searchParams.get('period')));
  const setPeriod = (value: string) => {
    setPeriodState(value);
    router.replace(value === currentPeriod() ? pathname : `${pathname}?period=${value}`, { scroll: false });
  };

  const overview = useAsync(() => sectionsApi.overview(kind, period), [kind, period]);
  const trend = useAsync(
    () => sectionsApi.trend(kind, shiftPeriod(period, -11), period),
    [kind, period],
  );

  const data = overview.data?.data;
  const isExpense = kind === 'expense';
  const query = period === currentPeriod() ? '' : `?period=${period}`;

  return (
    <>
      <PageHeader title={nav.title} description={formatPeriod(period)} />

      <div className="space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PeriodPicker value={period} onChange={setPeriod} />
          {data && (
            <p className="text-sm text-[--color-text-muted]">
              Jami {isExpense ? 'xarajat' : 'daromad'}:{' '}
              <Money tiyin={data.totalTiyin} tone={isExpense ? 'expense' : 'income'} className="font-semibold" />
            </p>
          )}
        </div>

        {overview.error ? (
          <Card>
            <ErrorState message={overview.error} onRetry={overview.reload} />
          </Card>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            {(['DOIMIY', 'BOSHQA'] as SectionValue[]).map((section) => (
              <SectionCard
                key={section}
                kind={kind}
                section={section}
                summary={data?.sections.find((s) => s.section === section) ?? null}
                previousPeriod={data?.previousPeriod}
                query={query}
                newHref={isAdmin && nav.newHref ? `${nav.newHref}?section=${section}` : null}
              />
            ))}
          </div>
        )}

        {/* Oxirgi 12 oy */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Oxirgi 12 oy"
            description={`${SECTION_LABELS.DOIMIY} va ${SECTION_LABELS.BOSHQA} — oylar bo'yicha`}
            actions={
              <div className="flex items-center gap-3 text-xs text-[--color-text-muted]">
                <Legend className={TONE.DOIMIY.bar} label={SECTION_LABELS.DOIMIY} />
                <Legend className={TONE.BOSHQA.bar} label={SECTION_LABELS.BOSHQA} />
              </div>
            }
          />
          <TrendBars points={trend.data?.data ?? []} loading={trend.loading} current={period} />
        </Card>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Katta karta
// ═══════════════════════════════════════════════════════════

function SectionCard({
  kind,
  section,
  summary,
  previousPeriod,
  query,
  newHref,
}: {
  kind: SectionKind;
  section: SectionValue;
  summary: SectionSummary | null;
  previousPeriod?: string;
  query: string;
  newHref: string | null;
}) {
  const nav = SECTION_NAV[kind];
  const tone = TONE[section];
  const href = `${nav.sections[section].href}${query}`;
  const isExpense = kind === 'expense';

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-[--radius-card] border border-[--color-line] bg-white transition-all hover:shadow-md',
        tone.border,
      )}
    >
      {/* Butun karta — havola */}
      <Link href={href} className="absolute inset-0 z-0 rounded-[--radius-card]" aria-label={SECTION_LABELS[section]} />

      <div className="pointer-events-none relative z-10 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={cn('text-xs font-semibold uppercase tracking-wider', tone.text)}>
              {SECTION_LABELS[section]}
            </p>
            <p className="mt-1 max-w-sm text-xs text-[--color-text-muted]">{SECTION_HINTS[kind][section]}</p>
          </div>
          <IconArrowRight className="size-5 text-[--color-text-faint] transition-transform group-hover:translate-x-1" />
        </div>

        {summary ? (
          <>
            <div className="mt-5 flex flex-wrap items-end gap-x-4 gap-y-1">
              <Money
                tiyin={summary.sumTiyin}
                tone={isExpense ? 'expense' : 'income'}
                className="text-3xl font-semibold"
              />
              <span className="pb-1 text-sm text-[--color-text-muted]">{summary.count} ta yozuv</span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[--color-text-muted]">
              <span className="inline-flex items-center gap-1.5">
                <Change percent={summary.previousChange} positiveIsGood={!isExpense} />
                {previousPeriod ? `${formatPeriodShort(previousPeriod)} ga nisbatan` : ''}
              </span>
              <span>Ulushi: {summary.sharePercent.toLocaleString('ru-RU')}%</span>
              {summary.unpaidCount > 0 && (
                <span className="text-[--color-expense]">
                  To&rsquo;lanmagan: {formatTiyin(summary.unpaidTiyin)} ({summary.unpaidCount})
                </span>
              )}
            </div>

            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[--color-surface-sunken]">
              <div className={cn('h-full rounded-full', tone.bar)} style={{ width: `${Math.min(100, summary.sharePercent)}%` }} />
            </div>
          </>
        ) : (
          <div className="mt-5 space-y-2">
            <div className="h-9 w-48 animate-pulse rounded bg-[--color-surface-sunken]" />
            <div className="h-4 w-64 animate-pulse rounded bg-[--color-surface-sunken]" />
          </div>
        )}
      </div>

      {/* Qismlar */}
      {summary && summary.parts.length > 0 && (
        <div className="relative z-10 mt-auto divide-y divide-[--color-line] border-t border-[--color-line]">
          {summary.parts.map((part) => (
            <Link
              key={part.key}
              href={`${partHref(kind, section, part.key)}${query}`}
              className="flex items-center gap-3 px-6 py-2.5 text-sm transition-colors hover:bg-[--color-surface-muted]"
            >
              <span className="flex-1">{part.label}</span>
              <span className="text-xs text-[--color-text-faint]">{part.count} ta</span>
              <Money tiyin={part.sumTiyin} className="w-36 text-right font-medium" />
            </Link>
          ))}
          {newHref && (
            <Link
              href={newHref}
              className={cn(
                'flex items-center gap-2 rounded-b-[--radius-card] px-6 py-2.5 text-sm font-medium transition-colors hover:brightness-95',
                tone.soft,
                tone.text,
              )}
            >
              <IconPlus className="size-4" />
              Yangi {isExpense ? 'xarajat' : 'daromad'} &mdash; {SECTION_LABELS[section]}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 12 oylik ustunlar
// ═══════════════════════════════════════════════════════════

function TrendBars({
  points,
  loading,
  current,
}: {
  points: { period: string; doimiyTiyin: string; boshqaTiyin: string }[];
  loading: boolean;
  current: string;
}) {
  if (loading && points.length === 0) {
    return <div className="m-5 h-44 animate-pulse rounded bg-[--color-surface-sunken]" />;
  }

  const totals = points.map((p) => Number(BigInt(p.doimiyTiyin) + BigInt(p.boshqaTiyin)));
  const max = Math.max(1, ...totals);

  return (
    <div className="flex h-56 items-end gap-2 px-5 pb-4 pt-6">
      {points.map((point, index) => {
        const doimiy = Number(BigInt(point.doimiyTiyin));
        const boshqa = Number(BigInt(point.boshqaTiyin));
        const total = totals[index] ?? 0;
        return (
          <div key={point.period} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
            <div
              className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-t"
              style={{ height: `${(total / max) * 100}%` }}
              title={`${formatPeriod(point.period)}\nDoimiy: ${formatTiyin(point.doimiyTiyin)}\nBoshqa: ${formatTiyin(point.boshqaTiyin)}`}
            >
              <div className={TONE.DOIMIY.bar} style={{ height: total ? `${(doimiy / total) * 100}%` : 0 }} />
              <div className={TONE.BOSHQA.bar} style={{ height: total ? `${(boshqa / total) * 100}%` : 0 }} />
            </div>
            <span
              className={cn(
                'text-[10px] text-[--color-text-faint]',
                point.period === current && 'font-semibold text-[--color-text]',
              )}
            >
              {formatPeriodShort(point.period)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2.5 rounded-sm', className)} />
      {label}
    </span>
  );
}
