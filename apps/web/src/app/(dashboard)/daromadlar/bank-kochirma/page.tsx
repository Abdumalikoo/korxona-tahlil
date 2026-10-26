'use client';

import { PageHeader } from '@/components/layout/page-header';
import { BankAnalysisView } from '@/features/bank-analysis/bank-analysis-view';
import { SectionTabs } from '@/features/sections/section-tabs';

/** Daromadlar › Bank ko'chirmasi — kirimlar tahlili (daromadga faqat tanlab yo'naltirilganda) */
export default function BankStatementIncomePage() {
  return (
    <>
      <PageHeader title="Daromadlar" description="Bank ko'chirmasi · kirimlar oyma-oy va o'sib boruvchi" />
      <SectionTabs kind="income" section="DOIMIY" />
      <div className="space-y-4 p-6">
        <BankAnalysisView source="bank" defaultDir="IN" />
      </div>
    </>
  );
}
