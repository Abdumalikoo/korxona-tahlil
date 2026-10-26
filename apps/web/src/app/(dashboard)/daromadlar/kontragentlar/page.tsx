'use client';

import { PageHeader } from '@/components/layout/page-header';
import { CounterpartiesView } from '@/features/counterparties/counterparties-view';
import { SectionTabs } from '@/features/sections/section-tabs';

/** Daromadlar › Kontragentlar — mijozlar: biz yozgan faktura ↔ bankka tushgan, farq */
export default function CounterpartiesIncomePage() {
  return (
    <>
      <PageHeader title="Daromadlar" description="Kontragentlar · mijozlar: faktura ↔ bank tushumi" />
      <SectionTabs kind="income" section="DOIMIY" />
      <div className="space-y-4 p-6">
        <CounterpartiesView defaultRole="CLIENT" sourcesHref={{ invoice: '/daromadlar/fakturalar', bank: '/daromadlar/bank-kochirma' }} />
      </div>
    </>
  );
}
