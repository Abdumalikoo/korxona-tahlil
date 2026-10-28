'use client';

import { PageHeader } from '@/components/layout/page-header';
import { KpiSummaryPage } from '@/features/kpi/kpi-summary';

/** Yig'ma KPI: bo'lim rahbarlaridan kelgan baholar, rahbarlarni biriktirish, Excel / PDF */
export default function YigmaKpiPage() {
  return (
    <>
      <PageHeader title="Yig'ma KPI" description="Bo'lim rahbarlaridan kelgan baholar: xodimlar × oylar, mezonlar; hisobot" />
      <KpiSummaryPage />
    </>
  );
}
