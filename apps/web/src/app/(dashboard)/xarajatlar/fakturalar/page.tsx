'use client';

import { PageHeader } from '@/components/layout/page-header';
import { BankAnalysisView } from '@/features/bank-analysis/bank-analysis-view';
import { SectionTabs } from '@/features/sections/section-tabs';

/** Xarajatlar › Schyot-fakturalar — kiruvchi fakturalar nazorati (xarajatga faqat tanlab yo'naltirilganda) */
export default function InvoicesExpensePage() {
  return (
    <>
      <PageHeader title="Xarajatlar" description="Schyot-fakturalar · kontragent va xizmat bo'yicha oyma-oy nazorat" />
      <SectionTabs kind="expense" section="DOIMIY" />
      <div className="space-y-4 p-6">
        <BankAnalysisView source="invoice" defaultDir="OUT" />
      </div>
    </>
  );
}
