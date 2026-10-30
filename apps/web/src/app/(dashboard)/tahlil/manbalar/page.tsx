'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { IncomeSources } from '@/features/cashbook/income-sources';
import { usePeriod } from '@/lib/period';

/**
 * Bosh sahifa › Daromad manbalari — «Kunlik tushum va qoldiq» hisobotidagi har bir tushum qatori oyma-oy.
 * Davr — yuqoridagi «Davr» paneli.
 */
export default function IncomeSourcesPage() {
  const { range } = usePeriod();
  return (
    <>
      <PageHeader title="Daromad manbalari" description="Kunlik hisobotdagi har bir tushum qatori oyma-oy: Markaz daromadi, boshqa daromad, Qo'mita, hududlar" />
      <div className="p-4 md:p-6">
        <PeriodDataHint className="mb-4" />
        <IncomeSources range={range} />
      </div>
    </>
  );
}
