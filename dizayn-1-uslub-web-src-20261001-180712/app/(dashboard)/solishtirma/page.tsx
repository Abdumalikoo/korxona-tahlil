'use client';

import { PageHeader } from '@/components/layout/page-header';
import { DateRangePicker, defaultRange, type DateRange } from '@/components/shared/date-range-picker';
import { Card } from '@/components/ui/card';
import { LoadingState } from '@/components/ui/states';
import { RegionsCompare } from '@/features/regions/regions-compare';
import { Suspense, useState } from 'react';

/**
 * Solishtirma — hududlar va Markaz:
 * har bir hudud qancha daromad keltirgani va qancha xarajat qilgani, xulosalar bilan.
 * Viloyat bosilsa — tumanlari, tuman bosilsa — xizmatlar, xarajat va xodimlari, xodim bosilsa — uning oylari.
 */
export default function SolishtirmaPage() {
  const [range, setRange] = useState<DateRange>(defaultRange);
  return (
    <>
      <PageHeader
        title="Solishtirma"
        description="Hududlar → tumanlar → xodimlar: daromad, xarajat va natija"
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />
      <div className="p-4 md:p-6">
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