'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { OverallView } from '@/features/regions/overall-view';
import { usePeriod } from '@/lib/period';

/**
 * Bosh sahifa — butun korxona bitta ekranda (avvalgi Solishtirma › Umumiy):
 * Markaz, Hudud (bosilsa — viloyatlar) va yo'nalishlar bir jadvalda, bir xil ustunlar (daromad, xarajat tarkibi, natija,
 * rentabellik). Korxona tarkibi ichma-ich (daromad / xarajat) — Solishtirma › Umumiy.
 */
export default function DashboardPage() {
  /** Davr — yuqori paneldagi «Davr» tugmasidan */
  const { range } = usePeriod();
  return (
    <>
      <PageHeader title="Bosh sahifa" description="Markaz, Hudud va yo‘nalishlar birga: korxona daromadi, xarajati va natijasi kimdan shakllanadi" />
      <div className="p-4 md:p-6">
        <PeriodDataHint className="mb-4" />
        <OverallView range={range} />
      </div>
    </>
  );
}