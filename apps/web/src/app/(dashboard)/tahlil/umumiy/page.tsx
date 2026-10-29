'use client';

import { PillTabs } from '@/components/report/report';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { usePeriod } from '@/lib/period';

import { ANALYSIS_TABS, LEGACY_TABS, tabQuestion, type AnalysisTab } from './_components/analysis-nav';
import { InsightsTab } from './_components/insights-tab';
import { ProductivityTab } from '@/features/analysis/productivity-tab';
import { StructureExplorer } from '@/features/structure/structure-explorer';
import { ResultExplorer } from '@/features/explore/result-explorer';
import { StructureOverview } from '@/features/structure/structure-overview';

const VALID_TABS = ANALYSIS_TABS.map((item) => item.key);

function tabOf(value: string | null): AnalysisTab {
  if (!value) return 'dynamics';
  if (VALID_TABS.includes(value as AnalysisTab)) return value as AnalysisTab;
  return LEGACY_TABS[value] ?? 'dynamics';
}

/**
 * Chuqur tahlil.
 *
 * Har yorliq bitta savolga javob beradi: Dinamika, O'zgarish sabablari, Barqarorlik, Xodim samaradorligi, Xulosalar.
 * Tarkib (daromad / xarajat jadvallari) — Daromad va Xarajat sahifalarida, birliklar natijasi — Solishtirmada,
 * DEA va prognoz — «Prognoz va modellar»da; bu yerda takrorlanmaydi.
 * Tanlangan yorliq va sana oralig'i manzilga yoziladi — havolani ulashsa, o'sha holat ochiladi.
 */
export default function GeneralAnalysisPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  /** Davr — yuqori paneldagi «Davr» tugmasidan (u manzilga ham yozadi) */
  const { range } = usePeriod();

  const [tab, setTab] = useState<AnalysisTab>(() => tabOf(searchParams.get('tab')));
  const [side, setSide] = useState<'income' | 'expense'>(() => (searchParams.get('tab') === 'expenses' ? 'expense' : 'income'));

  /** Tanlangan yorliq manzilga yoziladi — sahifa yangilansa ham saqlanadi */
  function openTab(next: AnalysisTab) {
    setTab(next);
    const params = new URLSearchParams({ dateFrom: range.from, dateTo: range.to });
    if (next !== 'dynamics') params.set('tab', next);
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

      {tab === 'dynamics' && <ResultExplorer range={range} only="pnl" />}
      {tab === 'drivers' && (
        <div className="space-y-4">
          <PillTabs
            value={side}
            onChange={setSide}
            options={[
              { value: 'income', label: 'Daromad', hint: "Daromad o'zgarishining omillari" },
              { value: 'expense', label: 'Xarajat', hint: "Xarajat o'zgarishining omillari" },
            ]}
          />
          <StructureExplorer key={side} kind={side} range={range} fixedView="analysis" />
        </div>
      )}
      {tab === 'stability' && <StructureOverview range={range} fixedView="split" />}
      {tab === 'productivity' && <ProductivityTab range={range} />}
      {tab === 'insights' && <InsightsTab range={range} />}
    </div>
  );
}
