'use client';

import { PageHeader } from '@/components/layout/page-header';
import { RegionalRentPage } from '@/features/leases/regional-rent';
import { usePeriod } from '@/lib/period';

/**
 * Xarajatlar › Hudud ijaralari — shablon (hududlar va tumanlar bilan), yuklash, tekshiruv va tasdiqlash (tanlangan oygacha).
 * Yil — yuqoridagi «Davr» paneli oxiridan.
 */
export default function RegionalRentRoute() {
  const { range } = usePeriod();
  return (
    <>
      <PageHeader title="Hudud ijaralari" description="Hududlar va tumanlar bo'yicha oylik hisoblangan ijara: shablon, yuklash, tekshiruv va tasdiqlash" />
      <div className="p-4 md:p-6">
        <RegionalRentPage year={Number(range.to.slice(0, 4))} />
      </div>
    </>
  );
}
