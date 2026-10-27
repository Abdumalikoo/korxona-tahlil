'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { ExpenseExplorer } from '@/features/explore/expense-explorer';
import { usePeriod } from '@/lib/period';

/**
 * Bosh sahifa › Xarajat.
 * Kartalar va ichiga kirib boriladigan jadvallar (features/explore) — grafiklarsiz, bitta ko'rinish.
 */
export default function ExpenseAnalysisPage() {
  const { range } = usePeriod();
  return (
    <>
      <PageHeader title="Xarajat" description="Pul nimaga va qayerda sarflandi: moddalar, Markaz va hududlar, bo'limlar, kontragentlar — har bir summa ichiga kirib ko'riladi" />
      <div className="p-4 md:p-6">
        <PeriodDataHint className="mb-4" />
        <ExpenseExplorer range={range} />
      </div>
    </>
  );
}