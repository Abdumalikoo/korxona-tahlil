'use client';

import { PageHeader } from '@/components/layout/page-header';
import { ReportsCenter } from '@/features/reports/reports-center';

/** Hisobotlar markazi: Excel, PowerPoint va PDF hisobotlar, tarix bilan */
export default function HisobotlarPage() {
  return (
    <>
      <PageHeader title="Hisobotlar" description="Tayyor hisobotlar — Excel, PowerPoint va PDF" />
      <div className="p-6">
        <ReportsCenter />
      </div>
    </>
  );
}