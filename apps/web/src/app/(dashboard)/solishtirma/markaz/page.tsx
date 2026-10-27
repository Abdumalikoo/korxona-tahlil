'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { Card } from '@/components/ui/card';
import { LoadingState } from '@/components/ui/states';
import { RegionsCompare } from '@/features/regions/regions-compare';
import { usePeriod } from '@/lib/period';
import { Suspense } from 'react';

/**
 * Solishtirma › Markaz — Markaz: daromad manbalari, o'z xarajati, hududlar uchun to'langan;
 * bo'lim bosilsa — xodimlari, xodim bosilsa — uning oylari (reja/tushum yo'q).
 */
export default function SolishtirmaMarkazPage() {
  /** Davr — yuqori paneldagi «Davr» tugmasidan */
  const { range } = usePeriod();
  return (
    <>
      <PageHeader title="Markaz" description="Markaz → bo'limlar → xodimlar: daromad, xarajat va natija" />
      <div className="p-4 md:p-6">
        <PeriodDataHint className="mb-4" />
        <Suspense
          fallback={
            <Card>
              <LoadingState label="Yuklanmoqda" />
            </Card>
          }
        >
          <RegionsCompare range={range} center />
        </Suspense>
      </div>
    </>
  );
}