'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { BriefAnalysis } from '@/features/brief/brief-analysis';
import { IncomeExplorer } from '@/features/explore/income-explorer';
import { usePeriod } from '@/lib/period';
import { BriefNote, useBrief } from '@/lib/view-mode';

/**
 * Bosh sahifa › Daromad.
 * Qisqa rejimda — rahbar uchun qisqa ko'rinish (features/brief/brief-analysis.tsx),
 * to'liq rejimda — ichiga kirib boriladigan jadvallar (features/explore), grafiklar eng pastda.
 */
export default function IncomeAnalysisPage() {
  const brief = useBrief();
  const { range } = usePeriod();
  if (brief)
    return (
      <>
        <PageHeader title="Daromad" />
        <div className="space-y-4 p-6">
          <BriefNote shows="Daromad: jami, asosiy daromadlar (bosilsa ichi ochiladi) va eng ko'p o'zgarganlar" hidden="daromad tarkibi jadvali, kesimlar, oylar jadvali, eng katta yozuvlar va grafiklar" />
          <BriefAnalysis kind="income" />
        </div>
      </>
    );
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