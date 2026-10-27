'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { LoadingState } from '@/components/ui/states';
import { RegionsCompare } from '@/features/regions/regions-compare';
import { usePeriod } from '@/lib/period';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { Suspense } from 'react';

/**
 * Solishtirma — hududlar va Markaz:
 * har bir hudud qancha daromad keltirgani va qancha xarajat qilgani — bitta jadvalda, o'tgan davr bilan.
 * Viloyat bosilsa — tumanlari, tuman bosilsa — xizmatlar, xarajat va xodimlari, xodim bosilsa — uning oylari.
 */
export default function SolishtirmaPage() {
  /** Davr — yuqori paneldagi «Davr» tugmasidan */
  const { range } = usePeriod();
  return (
    <>
      <PageHeader title="Solishtirma" description="Hududlar → tumanlar → xodimlar: daromad, xarajat va natija" />
      <div className="p-4 md:p-6">
        <PeriodDataHint className="mb-4" />
        {/* Ichma-ich kirish holati manzilda (?r=&d=&e=) — useSearchParams uchun Suspense kerak */}
        <Suspense
          fallback={
            <Card>
              <LoadingState label="Yuklanmoqda" />
            </Card>
          }
        >
          <RegionsCompare range={range} />
        </Suspense>
      </div>
    </>
  );
}
