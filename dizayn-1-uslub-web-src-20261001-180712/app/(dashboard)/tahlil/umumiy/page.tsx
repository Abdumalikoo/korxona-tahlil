'use client';

import {
  DateRangePicker,
  defaultRange,
  type DateRange,
} from '@/components/shared/date-range-picker';
import { SubTabs } from '@/components/ui/tabs';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { ANALYSIS_TABS, tabQuestion, type AnalysisTab } from './_components/analysis-nav';
import { DynamicsTab } from './_components/dynamics-tab';
import { EfficiencyTab } from './_components/efficiency-tab';
import { ExpensesTab } from './_components/expenses-tab';
import { InsightsTab } from './_components/insights-tab';
import { OverviewTab } from './_components/overview-tab';
import { RevenueTab } from './_components/revenue-tab';
import { StructureExplorer } from '@/features/structure/structure-explorer';
import { StructureOverview } from '@/features/structure/structure-overview';

const VALID_TABS = ANALYSIS_TABS.map((item) => item.key);

/**
 * Umumiy tahlil.
 *
 * Tepada tahlil bo'limlari doim ko'rinib turadi (Umumiy holat, Dinamika, Samaradorlik…) —
 * bittasidan ikkinchisiga to'g'ridan-to'g'ri o'tiladi, "orqaga qaytish" kerak emas.
 * Tanlangan bo'lim va sana oralig'i manzilga yoziladi — havolani ulashsa, o'sha holat ochiladi.
 */
export default function GeneralAnalysisPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [range, setRange] = useState<DateRange>(() => {
    const from = searchParams.get('dateFrom');
    const to = searchParams.get('dateTo');
    return from && to ? { from, to } : defaultRange();
  });

  const [tab, setTab] = useState<AnalysisTab>(() => {
    const value = searchParams.get('tab') as AnalysisTab | null;
    return value && VALID_TABS.includes(value) ? value : 'overview';
  });

  /** Holatni manzilga yozamiz — sahifa yangilansa ham saqlanadi */
  function syncUrl(nextRange: DateRange, nextTab: AnalysisTab) {
    const params = new URLSearchParams({ dateFrom: nextRange.from, dateTo: nextRange.to });
    if (nextTab !== 'overview') params.set('tab', nextTab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function changeRange(next: DateRange) {
    setRange(next);
    syncUrl(next, tab);
  }

  function openTab(next: AnalysisTab) {
    setTab(next);
    syncUrl(range, next);
  }

  return (
    <div className="space-y-5 p-4 md:p-6">
      {/* Tahlil bo'limlari + sana */}
      <div className="rounded-(--radius-card) bg-white p-2 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SubTabs
            value={tab}
            onChange={openTab}
            options={ANALYSIS_TABS.map((t) => ({ value: t.key, label: t.label, hint: t.question }))}
          />
          <div className="pr-1">
            <DateRangePicker value={range} onChange={changeRange} />
          </div>
        </div>
      </div>

      <p className="text-sm text-(--color-text-muted)">
        <span className="font-semibold text-heading">Savol: </span>
        {tabQuestion(tab)}
      </p>

      {tab === 'overview' && <OverviewTab range={range} />}
      {tab === 'dynamics' && <DynamicsTab range={range} />}
      {tab === 'efficiency' && <EfficiencyTab range={range} />}
      {tab === 'structure' && <StructureOverview range={range} />}
      {tab === 'revenue' && (
        <div className="space-y-6">
          <StructureExplorer kind="income" range={range} />
          <RevenueTab range={range} />
        </div>
      )}
      {tab === 'expenses' && (
        <div className="space-y-6">
          <StructureExplorer kind="expense" range={range} />
          <ExpensesTab range={range} />
        </div>
      )}
      {tab === 'insights' && <InsightsTab range={range} />}
    </div>
  );
}