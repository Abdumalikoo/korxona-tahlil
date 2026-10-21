'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { OverallView } from '@/features/regions/overall-view';
import { usePeriod } from '@/lib/period';
import { BriefNote } from '@/lib/view-mode';

/**
 * Solishtirma › Umumiy — butun korxona bitta ekranda:
 * Markaz va barcha hududlar bir jadvalda, bir xil ustunlar (daromad, xarajat tarkibi, natija, rentabellik).
 */
export default function SolishtirmaUmumiyPage() {
  /** Davr — yuqori paneldagi «Davr» tugmasidan */
  const { range } = usePeriod();
  return (
    <>
      <PageHeader title="Umumiy" description="Markaz va hududlar birga: korxona daromadi, xarajati va natijasi kimdan shakllanadi" />
      <div className="p-4 md:p-6">
        <PeriodDataHint className="mb-4" />
        <OverallView range={range} />
        <BriefNote
          className="mt-4"
          shows="korxona jami (Hududlar | Markaz bo'yicha), natija ko'prigi, Markazni qoplash va umumiy jadval"
          hidden="taqqoslash va oylar jadvallari, ulush lentalari va 12 oylik dinamika"
        />
      </div>
    </>
  );
}