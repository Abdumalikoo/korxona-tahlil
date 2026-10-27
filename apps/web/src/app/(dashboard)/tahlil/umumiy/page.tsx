'use client';

import { PillTabs } from '@/components/report/report';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { usePeriod } from '@/lib/period';

import { ANALYSIS_TABS, tabQuestion, type AnalysisTab } from './_components/analysis-nav';
import { DynamicsTab } from './_components/dynamics-tab';
import { EfficiencyTab } from './_components/efficiency-tab';
import { ExpensesTab } from './_components/expenses-tab';
import { InsightsTab } from './_components/insights-tab';
import { OverviewTab } from './_components/overview-tab';
import { RevenueTab } from './_components/revenue-tab';
import { StructureExplorer } from '@/features/structure/structure-explorer';
import { ResultExplorer } from '@/features/explore/result-explorer';
import { StructureOverview } from '@/features/structure/structure-overview';

const VALID_TABS = ANALYSIS_TABS.map((item) => item.key);

/**
 * Umumiy tahlil.
 *
 * Tepada tahlil bo'limlari doim ko'rinib turadi (Natija jadvali, Umumiy holat, Dinamika…) —
 * bittasidan ikkinchisiga to'g'ridan-to'g'ri o'tiladi. Har bo'lim — kartalar va jadvallar, grafiklarsiz.
 * Tanlangan bo'lim va sana oralig'i manzilga yoziladi — havolani ulashsa, o'sha holat ochiladi.
 */
export default function GeneralAnalysisPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  /** Davr — yuqori paneldagi «Davr» tugmasidan (u manzilga ham yozadi) */
  const { range } = usePeriod();

  const [tab, setTab] = useState<AnalysisTab>(() => {
    const value = searchParams.get('tab') as AnalysisTab | null;
    return value && VALID_TABS.includes(value) ? value : 'result';
  });

  /** Tanlangan yorliq manzilga yoziladi — sahifa yangilansa ham saqlanadi */
  function openTab(next: AnalysisTab) {
    setTab(next);
    const params = new URLSearchParams({ dateFrom: range.from, dateTo: range.to });
    if (next !== 'result') params.set('tab', next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="rounded-2xl bg-white p-3 shadow-card">
        <PillTabs value={tab} onChange={openTab} options={ANALYSIS_TABS.map((t) => ({ value: t.key, label: t.label, hint: t.question }))} />
        <p className="mt-2.5 px-1 text-sm text-(--color-text-muted)">
          <span className="font-semibold text-heading">Savol: </span>
          {tabQuestion(tab)}
        </p>
      </div>

      {tab === 'result' && <ResultExplorer range={range} />}
      {tab === 'overview' && <OverviewTab range={range} />}
      {tab === 'dynamics' && <DynamicsTab range={range} />}
      {tab === 'efficiency' && <EfficiencyTab range={range} />}
      {tab === 'structure' && <StructureOverview range={range} />}
      {tab === 'revenue' && (
        <div className="space-y-4">
          <StructureExplorer kind="income" range={range} />
          <RevenueTab range={range} />
        </div>
      )}
      {tab === 'expenses' && (
        <div className="space-y-4">
          <StructureExplorer kind="expense" range={range} />
          <ExpensesTab range={range} />
        </div>
      )}
      {tab === 'insights' && <InsightsTab range={range} />}
    </div>
  );
}
