'use client';

import { SubTabs } from '@/components/ui/tabs';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { usePeriod } from '@/lib/period';
import { BriefOverview } from '@/features/brief/brief-overview';
import { BriefNote, useBrief } from '@/lib/view-mode';

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

  /** Davr — yuqori paneldagi «Davr» tugmasidan (u manzilga ham yozadi) */
  const { range } = usePeriod();

  /** Qisqa (rahbar) rejimi: faqat «Umumiy holat», boshqa yorliqlar yashiriladi */
  const brief = useBrief();

  const [tab, setTab] = useState<AnalysisTab>(() => {
    const value = searchParams.get('tab') as AnalysisTab | null;
    return value && VALID_TABS.includes(value) ? value : 'overview';
  });

  /** Holatni manzilga yozamiz — sahifa yangilansa ham saqlanadi */
  /** Tanlangan yorliq manzilga yoziladi — sahifa yangilansa ham saqlanadi */
  function openTab(next: AnalysisTab) {
    setTab(next);
    const params = new URLSearchParams({ dateFrom: range.from, dateTo: range.to });
    if (next !== 'overview') params.set('tab', next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-5 p-4 md:p-6">
      {/* Tahlil bo'limlari (davr — yuqori panelda) */}
      <div className="rounded-(--radius-card) bg-white p-2 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {brief ? (
            <p className="px-2 text-sm font-semibold text-heading">Umumiy holat</p>
          ) : (
            <SubTabs
              value={tab}
              onChange={openTab}
              options={ANALYSIS_TABS.map((t) => ({ value: t.key, label: t.label, hint: t.question }))}
            />
          )}
        </div>
      </div>

      <BriefNote shows="Daromad, xarajat, foyda; foyda nima uchun o'zgardi (5 ta asosiy modda) va eng jiddiy 3 ta holat" hidden="oylik grafik, dinamika, samaradorlik, tarkib, daromad va xarajat tahlili yorliqlari, oldingi davr jadvali" />

      <p className="text-sm text-(--color-text-muted)">
        <span className="font-semibold text-heading">Savol: </span>
        {tabQuestion(brief ? 'overview' : tab)}
      </p>

      {brief && <BriefOverview range={range} />}
      {!brief && tab === 'overview' && <OverviewTab range={range} />}
      {!brief && tab === 'dynamics' && <DynamicsTab range={range} />}
      {!brief && tab === 'efficiency' && <EfficiencyTab range={range} />}
      {!brief && tab === 'structure' && <StructureOverview range={range} />}
      {!brief && tab === 'revenue' && (
        <div className="space-y-6">
          <StructureExplorer kind="income" range={range} />
          <RevenueTab range={range} />
        </div>
      )}
      {!brief && tab === 'expenses' && (
        <div className="space-y-6">
          <StructureExplorer kind="expense" range={range} />
          <ExpensesTab range={range} />
        </div>
      )}
      {!brief && tab === 'insights' && <InsightsTab range={range} />}
    </div>
  );
}