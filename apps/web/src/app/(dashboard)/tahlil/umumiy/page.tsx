'use client';

import {
  DateRangePicker,
  defaultRange,
  type DateRange,
} from '@/components/shared/date-range-picker';
import { IconArrowRight } from '@/components/ui/icons';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import {
  ANALYSIS_TABS,
  AnalysisCards,
  tabLabel,
  tabQuestion,
  type AnalysisTab,
} from './_components/analysis-nav';
import { DynamicsTab } from './_components/dynamics-tab';
import { EfficiencyTab } from './_components/efficiency-tab';
import { ExpensesTab } from './_components/expenses-tab';
import { InsightsTab } from './_components/insights-tab';
import { OverviewTab } from './_components/overview-tab';
import { RevenueTab } from './_components/revenue-tab';

const VALID_TABS = ANALYSIS_TABS.map((item) => item.key);

export default function GeneralAnalysisPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [range, setRange] = useState<DateRange>(() => {
    const from = searchParams.get('dateFrom');
    const to = searchParams.get('dateTo');
    return from && to ? { from, to } : defaultRange();
  });

  // null — bo'limlar tanlash ekrani
  const [tab, setTab] = useState<AnalysisTab | null>(() => {
    const value = searchParams.get('tab') as AnalysisTab | null;
    return value && VALID_TABS.includes(value) ? value : null;
  });

  /** Holatni manzilga yozamiz — sahifa yangilansa ham saqlanadi */
  function syncUrl(nextRange: DateRange, nextTab: AnalysisTab | null) {
    const params = new URLSearchParams({
      dateFrom: nextRange.from,
      dateTo: nextRange.to,
    });
    if (nextTab) params.set('tab', nextTab);

    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function changeRange(next: DateRange) {
    setRange(next);
    syncUrl(next, tab);
  }

  function openTab(next: AnalysisTab | null) {
    setTab(next);
    syncUrl(range, next);
    window.scrollTo({ top: 0 });
  }

  // ─────── Bo'limlar tanlash ekrani ───────
  if (!tab) {
    return (
      <div className="flex min-h-[calc(100vh-4rem)] flex-col justify-center p-6">
        <div className="mx-auto w-full max-w-5xl">
          <div className="mb-8 flex flex-col items-center gap-3">
            <h1 className="text-2xl font-semibold">Tahlil</h1>
            <DateRangePicker value={range} onChange={changeRange} />
          </div>

          <AnalysisCards onSelect={openTab} />

          <div className="mt-8 text-center">
            <Link
              href="/"
              className="text-sm text-[--color-text-muted] hover:text-[--color-text]"
            >
              Bosh sahifaga qaytish
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ─────── Tanlangan bo'lim ───────
  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => openTab(null)}
          className="flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
        >
          <IconArrowRight className="size-4 rotate-180" />
          Bo&rsquo;limlarga qaytish
        </button>

        <DateRangePicker value={range} onChange={changeRange} />
      </div>

      <div>
        <h1 className="text-xl font-semibold">{tabLabel(tab)}</h1>
        <p className="text-sm text-[--color-text-muted]">{tabQuestion(tab)}</p>
      </div>

      {tab === 'overview' && <OverviewTab range={range} />}
      {tab === 'dynamics' && <DynamicsTab range={range} />}
      {tab === 'efficiency' && <EfficiencyTab range={range} />}
      {tab === 'revenue' && <RevenueTab range={range} />}
      {tab === 'expenses' && <ExpensesTab range={range} />}
      {tab === 'insights' && <InsightsTab range={range} />}
    </div>
  );
}
