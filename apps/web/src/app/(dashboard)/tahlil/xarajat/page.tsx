'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { BriefAnalysis } from '@/features/brief/brief-analysis';
import { ExpenseExplorer } from '@/features/explore/expense-explorer';
import { usePeriod } from '@/lib/period';
import { BriefNote, useBrief } from '@/lib/view-mode';

/**
 * Bosh sahifa › Xarajat.
 * Qisqa rejimda — rahbar uchun qisqa ko'rinish (features/brief/brief-analysis.tsx),
 * to'liq rejimda — ichiga kirib boriladigan jadvallar (features/explore), grafiklar eng pastda.
 */
export default function ExpenseAnalysisPage() {
  const brief = useBrief();
  const { range } = usePeriod();
  if (brief)
    return (
      <>
        <PageHeader title="Xarajat" />
        <div className="space-y-4 p-6">
          <BriefNote shows="Xarajat: jami, asosiy xarajatlar (bosilsa ichi ochiladi) va eng ko'p o'zgarganlar" hidden="moddalar daraxti, kesimlar, oylar jadvali, ish haqi tarkibi, eng katta yozuvlar va grafiklar" />
          <BriefAnalysis kind="expense" />
        </div>
      </>
    );
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