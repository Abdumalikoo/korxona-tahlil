'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { IncomeExplorer } from '@/features/explore/income-explorer';
import { usePeriod } from '@/lib/period';

/**
 * Bosh sahifa › Daromad.
 * Kartalar va ichiga kirib boriladigan jadvallar (features/explore) — grafiklarsiz, bitta ko'rinish.
 */
export default function IncomeAnalysisPage() {
  const { range } = usePeriod();
  return (
    <>
      <PageHeader title="Daromad" description="Daromad qayerdan keldi: Markaz va hududlar, moddalar, bo'limlar, mijozlar — har bir summa ichiga kirib ko'riladi" />
      <div className="p-4 md:p-6">
        <PeriodDataHint className="mb-4" />
        <IncomeExplorer range={range} />
      </div>
    </>
  );
}