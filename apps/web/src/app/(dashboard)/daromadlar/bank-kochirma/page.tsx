'use client';

import { PageHeader } from '@/components/layout/page-header';
import { BankAnalysisView } from '@/features/bank-analysis/bank-analysis-view';
import { SectionTabs } from '@/features/sections/section-tabs';

/** Daromadlar › Bank ko'chirmasi — kirimlar tahlili (daromadga faqat tanlab yo'naltirilganda) */
export default function BankStatementIncomePage() {
  return (
    <>
      <PageHeader title="Bank ko'chirmasi" description="Daromadlar · kirimlar oyma-oy va o'sib boruvchi, ajralib turganlar" />
      <SectionTabs kind="income" section="DOIMIY" />
      <div className="space-y-4 p-6">
        <BankAnalysisView source="bank" defaultDir="IN" />
      </div>
    </>
  );
}
