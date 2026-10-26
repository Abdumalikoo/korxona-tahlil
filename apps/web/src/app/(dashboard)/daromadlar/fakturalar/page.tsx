'use client';

import { PageHeader } from '@/components/layout/page-header';
import { BankAnalysisView } from '@/features/bank-analysis/bank-analysis-view';
import { SectionTabs } from '@/features/sections/section-tabs';

/** Daromadlar › Schyot-fakturalar — chiquvchi fakturalar nazorati (daromadga faqat tanlab yo'naltirilganda) */
export default function InvoicesIncomePage() {
  return (
    <>
      <PageHeader title="Daromadlar" description="Schyot-fakturalar · biz yozgan fakturalar mijoz va xizmat bo'yicha" />
      <SectionTabs kind="income" section="DOIMIY" />
      <div className="space-y-4 p-6">
        <BankAnalysisView source="invoice" defaultDir="IN" />
      </div>
    </>
  );
}
