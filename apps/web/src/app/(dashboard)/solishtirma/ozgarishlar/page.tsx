'use client';

import { PageHeader } from '@/components/layout/page-header';
import { ChangesView } from '@/features/regions/changes-view';
import { usePeriod } from '@/lib/period';

/**
 * Solishtirma › O'zgarishlar — oy bo'yicha xodimlar: nechta xodimga oylik hisoblandi (hududlar / Markaz),
 * o'tgan oyga nisbatan ishga olingan, qaytgan, bo'shagan, ishlamagan, ko'chgan.
 */
export default function SolishtirmaChangesPage() {
  /** Oy — yuqori paneldagi «Davr» oxiri (o'sha oy yoki undan oldingi oxirgi ish haqi oyi) */
  const { range } = usePeriod();
  return (
    <>
      <PageHeader title="O'zgarishlar" description="Bu oy kimga oylik hisoblandi, kim ishga olindi, bo'shadi, ishlamadi yoki ko'chdi" />
      <div className="p-4 md:p-6">
        <ChangesView to={range.to} />
      </div>
    </>
  );
}