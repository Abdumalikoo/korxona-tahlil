'use client';

import { SourceActions } from '@/components/shared/source-actions';
import { usePeriod } from '@/lib/period';
import { currentPeriod, formatCompact, formatPercent, formatPeriod, formatPeriodShort, formatTiyin, shiftPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';

import { PageHeader } from '@/components/layout/page-header';
import { CountIcon, SumIcon, SummaryCard, type SummaryAccent } from '@/components/shared/summary-card';
import { Card, CardHeader } from '@/components/ui/card';
import { Change } from '@/components/ui/money';
import { ErrorState } from '@/components/ui/states';

import { partHref, SECTION_HINTS, SECTION_LABELS, SECTION_NAV, sectionsApi, type SectionKind, type SectionSummary, type SectionTrendPoint, type SectionValue } from './api';

/** Doimiy — ko'k, Boshqa — to'q sariq (grafiklarda ham shu ranglar) */
const SECTION_COLOR: Record<SectionValue, { hex: string; accent: SummaryAccent; dot: string }> = {
  DOIMIY: { hex: '#4a78dd', accent: 'brand', dot: 'bg-brand-500' },
  BOSHQA: { hex: '#f59e0b', accent: 'orange', dot: 'bg-tile-orange' },
};

/** Qismlar (Ish haqi, Ijara, Mashinalar, Hududlar tushumi…) uchun navbatdagi ranglar */
const PART_ACCENTS: SummaryAccent[] = ['purple', 'cyan', 'pink', 'brand'];

function som(tiyin: string | bigint): string {
  return `${formatTiyin(tiyin.toString())} so’m`;
}

function changePercent(current: bigint, previous: bigint): number | null {
  if (previous === 0n) return null;
  return (Number(current - previous) / Number(previous < 0n ? -previous : previous)) * 100;
}

/**
 * Xarajatlar / Daromadlar — "Umumiy" yorlig'i.
 *
 * Yuqorida yig'indi kartalari (rasmdagidek: nomi, Summasi, Soni):
 * Jami · Doimiy · Boshqa · Doimiy ichidagi qismlar (Ish haqi, Ijara, Mashinalar / Hududlar tushumi).
 * Pastda — Doimiy/Boshqa ulushi va oxirgi 12 oy yonma-yon ustunlarda.
 * Har bir karta bosilsa — o'sha bo'limga o'tadi; yuqoridagi yorliqlar doim turadi.
 */
export function SectionLanding({ kind }: { kind: SectionKind }) {
  const nav = SECTION_NAV[kind];

  /** Oy — yuqori paneldagi umumiy «Davr» tugmasidan (oy ko'rinishi) */
  const { month: period } = usePeriod();

  const overview = useAsync(() => sectionsApi.overview(kind, period), [kind, period]);
  const trend = useAsync(() => sectionsApi.trend(kind, shiftPeriod(period, -11), period), [kind, period]);

  const data = overview.data?.data;
  const isExpense = kind === 'expense';
  const word = isExpense ? 'xarajat' : 'daromad';
  const query = period === currentPeriod() ? '' : `?period=${period}`;
  const loading = !data;

  const doimiy = data?.sections.find((s) => s.section === 'DOIMIY') ?? null;
  const boshqa = data?.sections.find((s) => s.section === 'BOSHQA') ?? null;

  const totalCount = (doimiy?.count ?? 0) + (boshqa?.count ?? 0);
  const totalPrev = BigInt(doimiy?.previousTiyin ?? '0') + BigInt(boshqa?.previousTiyin ?? '0');
  const totalChange = data ? changePercent(BigInt(data.totalTiyin), totalPrev) : null;
  const unpaidTiyin = BigInt(doimiy?.unpaidTiyin ?? '0') + BigInt(boshqa?.unpaidTiyin ?? '0');
  const unpaidCount = (doimiy?.unpaidCount ?? 0) + (boshqa?.unpaidCount ?? 0);

  const kindAccent: SummaryAccent = isExpense ? 'expense' : 'income';
  const previousLabel = data ? `${formatPeriod(data.previousPeriod)} ga nisbatan` : '';

  return (
    <>
      <PageHeader
        title={nav.title}
        description={`Umumiy · ${formatPeriod(period)}`}
      />

      <div className="space-y-5 p-4 md:p-6">
        {/* Amallar — hamma Manba sahifasida bir xil joyda */}
        <SourceActions
          add={nav.newHref ? { label: `Yangi ${word}`, href: `${nav.newHref}${nav.newHref.includes('?') ? '&' : '?'}section=DOIMIY` } : undefined}
          note="Yozuvlarni ko'rish va tahrirlash — «Doimiy» yoki «Boshqa» yorlig'ida."
          deleteData={{
            target: isExpense ? 'EXPENSE' : 'INCOME',
            month: period,
            place: `${nav.title} › Umumiy`,
            onDone: () => {
              overview.reload();
              trend.reload();
            },
          }}
        />

        {/* To'lanmaganlar (oy — yuqori panelda) */}
        {unpaidCount > 0 && (
          <div className="flex justify-end">
            <p className="rounded-(--radius-control) bg-(--color-warn-soft) px-3 py-2 text-xs font-medium text-(--color-warn)">
              To&apos;lanmagan: {som(unpaidTiyin)} · {unpaidCount} ta yozuv
            </p>
          </div>
        )}

        {overview.error ? (
          <Card>
            <ErrorState message={overview.error} onRetry={overview.reload} />
          </Card>
        ) : (
          <>
            {/* Yig'indi kartalari */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
              <SummaryCard
                title={`Jami ${word}`}
                accent={kindAccent}
                loading={loading}
                rows={[
                  { label: 'Summasi', icon: <SumIcon />, value: <span className={isExpense ? 'text-(--color-expense)' : 'text-(--color-income)'}>{som(data?.totalTiyin ?? '0')}</span> },
                  { label: 'Soni', icon: <CountIcon />, value: `${totalCount.toLocaleString('ru-RU')} ta` },
                ]}
                footer={
                  <span className="inline-flex items-center gap-1.5">
                    <Change percent={totalChange} positiveIsGood={!isExpense} />
                    {previousLabel}
                  </span>
                }
              />

              {(['DOIMIY', 'BOSHQA'] as SectionValue[]).map((section) => (
                <SectionSummaryCard
                  key={section}
                  section={section}
                  summary={section === 'DOIMIY' ? doimiy : boshqa}
                  href={`${nav.sections[section].href}${query}`}
                  hint={SECTION_HINTS[kind][section]}
                  isExpense={isExpense}
                  loading={loading}
                  previousLabel={previousLabel}
                />
              ))}

              {(doimiy?.parts ?? []).map((part, index) => (
                <SummaryCard
                  key={part.key}
                  title={part.label}
                  accent={PART_ACCENTS[index % PART_ACCENTS.length]}
                  href={`${partHref(kind, 'DOIMIY', part.key)}${query}`}
                  rows={[
                    { label: 'Summasi', icon: <SumIcon />, value: som(part.sumTiyin) },
                    { label: 'Soni', icon: <CountIcon />, value: `${part.count.toLocaleString('ru-RU')} ta` },
                  ]}
                  footer={
                    data && BigInt(data.totalTiyin) > 0n
                      ? `Jami ${word}ning ${formatPercent((Number(BigInt(part.sumTiyin)) / Number(BigInt(data.totalTiyin))) * 100)}i`
                      : undefined
                  }
                />
              ))}
            </div>

            {/* Ulush va dinamika */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <Card>
                <CardHeader title="Ulushi" description={`${SECTION_LABELS.DOIMIY} va ${SECTION_LABELS.BOSHQA} — ${formatPeriod(period)}`} />
                <ShareDonut doimiy={doimiy} boshqa={boshqa} loading={loading} />
              </Card>

              <Card className="overflow-hidden">
                <CardHeader
                  title="Oxirgi 12 oy"
                  description={`${SECTION_LABELS.DOIMIY} va ${SECTION_LABELS.BOSHQA} yonma-yon, so'm`}
                  actions={
                    <div className="flex items-center gap-3 text-xs text-(--color-text-muted)">
                      <Legend className={SECTION_COLOR.DOIMIY.dot} label={SECTION_LABELS.DOIMIY} />
                      <Legend className={SECTION_COLOR.BOSHQA.dot} label={SECTION_LABELS.BOSHQA} />
                    </div>
                  }
                />
                <TrendBars points={trend.data?.data ?? []} loading={trend.loading} current={period} />
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Doimiy / Boshqa kartasi
// ═══════════════════════════════════════════════════════════

function SectionSummaryCard({
  section,
  summary,
  href,
  hint,
  isExpense,
  loading,
  previousLabel,
}: {
  section: SectionValue;
  summary: SectionSummary | null;
  href: string;
  hint: string;
  isExpense: boolean;
  loading: boolean;
  previousLabel: string;
}) {
  return (
    <SummaryCard
      title={SECTION_LABELS[section]}
      accent={SECTION_COLOR[section].accent}
      href={href}
      loading={loading}
      rows={[
        { label: 'Summasi', icon: <SumIcon />, value: som(summary?.sumTiyin ?? '0') },
        { label: 'Soni', icon: <CountIcon />, value: `${(summary?.count ?? 0).toLocaleString('ru-RU')} ta` },
      ]}
      footer={
        summary ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5">
                <Change percent={summary.previousChange} positiveIsGood={!isExpense} />
                {previousLabel}
              </span>
              <span className="font-semibold text-heading">{formatPercent(summary.sharePercent)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-(--color-surface-sunken)">
              <div className={cn('h-full rounded-full', SECTION_COLOR[section].dot)} style={{ width: `${Math.min(100, Math.max(0, summary.sharePercent))}%` }} />
            </div>
            <p className="line-clamp-2 text-[11px] text-(--color-text-faint)">{hint}</p>
          </div>
        ) : undefined
      }
    />
  );
}

// ═══════════════════════════════════════════════════════════
// Doimiy / Boshqa ulushi — halqa
// ═══════════════════════════════════════════════════════════

function ShareDonut({ doimiy, boshqa, loading }: { doimiy: SectionSummary | null; boshqa: SectionSummary | null; loading: boolean }) {
  if (loading) return <div className="m-5 h-52 animate-pulse rounded-xl bg-(--color-surface-sunken)" />;

  const a = Number(BigInt(doimiy?.sumTiyin ?? '0'));
  const b = Number(BigInt(boshqa?.sumTiyin ?? '0'));
  const total = a + b;
  const count = (doimiy?.count ?? 0) + (boshqa?.count ?? 0);

  const size = 190;
  const stroke = 30;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const shareA = total > 0 ? a / total : 0;

  const rows: { section: SectionValue; value: number; summary: SectionSummary | null }[] = [
    { section: 'DOIMIY', value: a, summary: doimiy },
    { section: 'BOSHQA', value: b, summary: boshqa },
  ];

  return (
    <div className="flex flex-col items-center gap-5 p-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" role="img" aria-label="Doimiy va Boshqa ulushi">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e4ebf7" strokeWidth={stroke} />
          {total > 0 && (
            <>
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={SECTION_COLOR.DOIMIY.hex} strokeWidth={stroke} strokeDasharray={`${c * shareA} ${c}`} />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={SECTION_COLOR.BOSHQA.hex}
                strokeWidth={stroke}
                strokeDasharray={`${c * (1 - shareA)} ${c}`}
                strokeDashoffset={-c * shareA}
              />
            </>
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-heading">{count.toLocaleString('ru-RU')}</span>
          <span className="text-xs text-(--color-text-muted)">ta yozuv</span>
        </div>
      </div>

      <ul className="w-full max-w-xs min-w-0 space-y-3">
        {rows.map((row) => (
          <li key={row.section} className="flex items-center gap-3">
            <span className={cn('size-3 shrink-0 rounded-full', SECTION_COLOR[row.section].dot)} />
            <span className="flex-1 text-sm text-(--color-text)">{SECTION_LABELS[row.section]}</span>
            <span className="text-sm font-bold text-heading">{total > 0 ? formatPercent((row.value / total) * 100) : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 12 oylik ustunlar — Doimiy va Boshqa yonma-yon (bir-birining orqasida emas)
// ═══════════════════════════════════════════════════════════

function TrendBars({ points, loading, current }: { points: SectionTrendPoint[]; loading: boolean; current: string }) {
  if (loading && points.length === 0) {
    return <div className="m-5 h-56 animate-pulse rounded-xl bg-(--color-surface-sunken)" />;
  }
  if (points.length === 0) {
    return <p className="p-10 text-center text-sm text-(--color-text-muted)">Ma&apos;lumot yo&apos;q</p>;
  }

  const values = points.map((p) => ({ a: Number(BigInt(p.doimiyTiyin)), b: Number(BigInt(p.boshqaTiyin)) }));
  const max = Math.max(1, ...values.flatMap((v) => [v.a, v.b]));
  const ticks = [1, 0.75, 0.5, 0.25, 0];

  return (
    <div className="flex gap-3 px-5 pb-4 pt-5">
      {/* Qiymatlar o'qi (mln so'm) */}
      <div className="flex h-56 shrink-0 flex-col justify-between pb-5 text-right text-[10px] text-(--color-text-faint)">
        {ticks.map((t) => (
          <span key={t}>{t === 0 ? '0' : formatCompact(Math.round(max * t))}</span>
        ))}
      </div>

      <div className="relative flex h-56 min-w-0 flex-1 items-end gap-1.5 pb-5">
        {/* Yordamchi chiziqlar */}
        <div className="pointer-events-none absolute inset-x-0 bottom-5 top-0 flex flex-col justify-between" aria-hidden="true">
          {ticks.map((t) => (
            <div key={t} className="border-t border-dashed border-(--color-line)" />
          ))}
        </div>

        {points.map((point, index) => {
          const v = values[index] ?? { a: 0, b: 0 };
          const isCurrent = point.period === current;
          return (
            <div key={point.period} className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              <div
                className="flex h-full w-full items-end justify-center gap-0.5"
                title={`${formatPeriod(point.period)}\nDoimiy: ${som(point.doimiyTiyin)}\nBoshqa: ${som(point.boshqaTiyin)}`}
              >
                <div className="w-full max-w-4 rounded-t-md" style={{ height: `${(v.a / max) * 100}%`, background: SECTION_COLOR.DOIMIY.hex, minHeight: v.a > 0 ? 2 : 0 }} />
                <div className="w-full max-w-4 rounded-t-md" style={{ height: `${(v.b / max) * 100}%`, background: SECTION_COLOR.BOSHQA.hex, minHeight: v.b > 0 ? 2 : 0 }} />
              </div>
              <span
                className={cn(
                  'absolute -bottom-5 whitespace-nowrap text-[10px] text-(--color-text-faint)',
                  isCurrent && 'font-bold text-brand-700',
                )}
              >
                {formatPeriodShort(point.period)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2.5 rounded-full', className)} />
      {label}
    </span>
  );
}