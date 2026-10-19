'use client';

import { PageHeader } from '@/components/layout/page-header';
import { EconPage } from '@/features/econ/econ-page';

/**
 * Katta modellar — prognoz va ekonometrik tahlil.
 * Ma'lumot faqat Daromadlar, Xarajatlar va Xodimlar bo'limlaridan olinadi.
 */
export default function KattaModellarPage() {
  return (
    <>
      <PageHeader title="Katta modellar" description="Prognoz va ekonometrik tahlil — Daromadlar, Xarajatlar va Xodimlar ma'lumotlari asosida" />
      <div className="p-6">
        <EconPage />
      </div>
    </>
  );
}