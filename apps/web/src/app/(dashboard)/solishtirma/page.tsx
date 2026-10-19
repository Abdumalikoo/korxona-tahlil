'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { LoadingState } from '@/components/ui/states';
import { RegionsCompare } from '@/features/regions/regions-compare';
import { SolishtirmaModelsCard } from '@/features/regional-econ/solishtirma-card';
import { usePeriod } from '@/lib/period';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { Suspense } from 'react';
import { BriefNote, useBrief } from '@/lib/view-mode';

/**
 * Solishtirma — hududlar va Markaz:
 * har bir hudud qancha daromad keltirgani va qancha xarajat qilgani, xulosalar bilan.
 * Viloyat bosilsa — tumanlari, tuman bosilsa — xizmatlar, xarajat va xodimlari, xodim bosilsa — uning oylari.
 */
export default function SolishtirmaPage() {
  /** Davr — yuqori paneldagi «Davr» tugmasidan */
  const { range } = usePeriod();
  /** Qisqa rejim: asosiy raqamlar va hududlar jadvali; modellar, grafiklar — To'liq rejimda */
  const brief = useBrief();
  return (
    <>
      <PageHeader
        title="Solishtirma"
        description="Hududlar → tumanlar → xodimlar: daromad, xarajat va natija"
      />
      <div className="p-4 md:p-6">
        <PeriodDataHint className="mb-4" />
        {/* Hudud modellari xulosasi (Katta modellar › Hududlar paneli) — To'liq rejimda */}
        {!brief && <SolishtirmaModelsCard />}
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
        <BriefNote className="mt-4" shows="Hududlar daromadi, xarajati, foydasi, Markazni qoplash va hududlar jadvali" hidden="grafiklar, xarita, oylar kesimi, Markazni qoplash taqsimoti, tahliliy modellar, hudud modellari" />
      </div>
    </>
  );
}