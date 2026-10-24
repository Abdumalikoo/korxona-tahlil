'use client';

import { PageHeader } from '@/components/layout/page-header';
import { SectionTabs } from '@/features/sections/section-tabs';
import { formatPeriod } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { CompositionWorkspace } from './_components/composition-workspace';

/** Xarajatlar › Ish haqi tarkibi (umumiy — Markaz) */
export default function SalaryCompositionPage() {
  const { month: period } = usePeriod();
  return (
    <>
      <PageHeader title="Xarajatlar" description={`Ish haqi tarkibi · ${formatPeriod(period)}`} />
      <SectionTabs kind="expense" section="DOIMIY" />
      <div className="p-6">
        <CompositionWorkspace />
      </div>
    </>
  );
}