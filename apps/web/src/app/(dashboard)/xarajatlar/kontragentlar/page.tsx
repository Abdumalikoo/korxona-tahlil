'use client';

import { PageHeader } from '@/components/layout/page-header';
import { CounterpartiesView } from '@/features/counterparties/counterparties-view';
import { SectionTabs } from '@/features/sections/section-tabs';

/** Xarajatlar › Kontragentlar — yetkazib beruvchilar: faktura ↔ bank, nima beradi, farq */
export default function CounterpartiesExpensePage() {
  return (
    <>
      <PageHeader title="Xarajatlar" description="Kontragentlar · schyot-faktura va bank ko'chirmasidan yagona karta" />
      <SectionTabs kind="expense" section="DOIMIY" />
      <div className="space-y-4 p-6">
        <CounterpartiesView defaultRole="SUPPLIER" sourcesHref={{ invoice: '/xarajatlar/fakturalar', bank: '/xarajatlar/bank-kochirma' }} />
      </div>
    </>
  );
}
