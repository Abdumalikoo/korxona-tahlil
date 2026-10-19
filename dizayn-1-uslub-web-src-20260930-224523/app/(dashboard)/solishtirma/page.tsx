'use client';

import { PageHeader } from '@/components/layout/page-header';
import { DateRangePicker, defaultRange, type DateRange } from '@/components/shared/date-range-picker';
import { RegionsCompare } from '@/features/regions/regions-compare';
import { useState } from 'react';

/**
 * Solishtirma — hududlar va Markaz:
 * har bir hudud qancha daromad keltirgani va qancha xarajat qilgani, xulosalar bilan.
 */
export default function SolishtirmaPage() {
  const [range, setRange] = useState<DateRange>(defaultRange);
  return (
    <>
      <PageHeader
        title="Solishtirma"
        description="Hududlar va Markaz: daromad, xarajat va natija"
        actions={<DateRangePicker value={range} onChange={setRange} />}
      />
      <div className="p-6">
        <RegionsCompare range={range} />
      </div>
    </>
  );
}