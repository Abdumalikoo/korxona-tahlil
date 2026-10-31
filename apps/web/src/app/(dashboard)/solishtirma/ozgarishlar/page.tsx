'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PillTabs } from '@/components/report/report';
import { ChangesView } from '@/features/regions/changes-view';
import { MovementsView } from '@/features/regions/movements-view';
import { usePeriod } from '@/lib/period';
import { useState } from 'react';

type Tab = 'month' | 'moves';

/**
 * Solishtirma › O'zgarishlar:
 *  • Oylik o'zgarishlar — oy bo'yicha xodimlar: nechta xodimga oylik hisoblandi (hududlar / Markaz), o'tgan oyga
 *    nisbatan ishga olingan, qaytgan, bo'shagan, ishlamagan, ko'chgan;
 *  • Xodimlar harakati — tanlangan muddatda har xodim har oy qayerda ishlagani va joy o'zgarishlari.
 */
export default function SolishtirmaChangesPage() {
  /** Oy — yuqori paneldagi «Davr» oxiri (o'sha oy yoki undan oldingi oxirgi ish haqi oyi) */
  const { range } = usePeriod();
  const [tab, setTab] = useState<Tab>('month');
  return (
    <>
      <PageHeader title="O'zgarishlar" description="Bu oy kimga oylik hisoblandi, kim ishga olindi, bo'shadi, ishlamadi yoki ko'chdi; muddat bo'yicha xodimlar harakati" />
      <div className="space-y-4 p-4 md:p-6">
        <PillTabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'month', label: "Oylik o'zgarishlar", hint: "Tanlangan oy o'tgan oyga nisbatan: kelgan, ketgan, oyligi oshgan / kamaygan" },
            { value: 'moves', label: 'Xodimlar harakati', hint: "Muddat tanlang — har xodim har oy qayerda ishlagani va qachon ko'chgani" },
          ]}
        />
        {tab === 'month' ? <ChangesView to={range.to} /> : <MovementsView />}
      </div>
    </>
  );
}
