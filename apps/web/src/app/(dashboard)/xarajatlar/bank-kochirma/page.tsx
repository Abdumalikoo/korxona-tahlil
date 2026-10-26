'use client';

import { PageHeader } from '@/components/layout/page-header';
import { BankAnalysisView } from '@/features/bank-analysis/bank-analysis-view';
import { SectionTabs } from '@/features/sections/section-tabs';

/** Xarajatlar › Bank ko'chirmasi — tahlil maydoni (xarajat va daromadga yozilmaydi) */
export default function BankStatementPage() {
  return (
    <>
      <PageHeader title="Xarajatlar" description="Bank ko'chirmasi · o'xshash to'lovlar oyma-oy va o'sib boruvchi tahlili" />
      <SectionTabs kind="expense" section="DOIMIY" />
      <div className="space-y-4 p-6">
        <BankAnalysisView />
      </div>
    </>
  );
}
