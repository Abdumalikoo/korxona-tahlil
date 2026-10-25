'use client';

import { PageHeader } from '@/components/layout/page-header';
import { SolishtirmaView } from '@/features/payroll-solishtirma/solishtirma-view';
import { SectionTabs } from '@/features/sections/section-tabs';
import { formatPeriod } from '@/lib/format';
import { usePeriod } from '@/lib/period';

/** Xarajatlar › Ish haqi solishtirma: FOT − soliq (− kasaba uyushmasi) = 23106 */
export default function PayrollSolishtirmaPage() {
  const { month: period } = usePeriod();
  return (
    <>
      <PageHeader title="Xarajatlar" description={`Ish haqi solishtirma · ${formatPeriod(period)}`} />
      <SectionTabs kind="expense" section="DOIMIY" />
      <div className="space-y-4 p-6">
        <SolishtirmaView />
      </div>
    </>
  );
}
