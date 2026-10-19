'use client';

import { FullOnly } from '@/components/layout/full-only';
import { PageHeader } from '@/components/layout/page-header';
import { EconPage } from '@/features/econ/econ-page';

/**
 * Katta modellar — prognoz va ekonometrik tahlil.
 * Ma'lumot faqat Daromadlar, Xarajatlar va Xodimlar bo'limlaridan olinadi.
 */
function KattaModellarPageFull() {
  return (
    <>
      <PageHeader title="Katta modellar" description="Prognoz va ekonometrik tahlil — Daromadlar, Xarajatlar va Xodimlar ma'lumotlari asosida" />
      <div className="p-6">
        <EconPage />
      </div>
    </>
  );
}

/** Qisqa rejimda — bu bo'lim ochilmaydi (faqat To'liq rejimda) */
export default function KattaModellarPage() {
  return (
    <FullOnly title="Katta modellar" what="Prognoz, ekonometrik modellar, samaradorlik va ssenariylar.">
      <KattaModellarPageFull />
    </FullOnly>
  );
}