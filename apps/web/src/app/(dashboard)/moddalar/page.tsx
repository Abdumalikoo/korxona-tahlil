'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PillTabs } from '@/components/report/report';
import { ManageView } from '@/features/categories-manage/manage-view';
import { StructureView } from '@/features/cost-structure/structure-view';
import { useState } from 'react';

type Tab = 'structure' | 'items';

/**
 * Umumiy manba › Moddalar boshqaruvi:
 *  • Xarajatlar tarkibiy tuzilishi — birlik (Markaz bo'limi, hudud, yo'nalish) bo'yicha haqiqiy tuzilma: daromad va
 *    xarajat tomoni, yozuvlarni ko'chirish, yangi modda;
 *  • Moddalar — umumiy guruhlar daraxti: yangi guruh / modda, nomini o'zgartirish, boshqa guruhga ko'chirish.
 */
export default function ModdalarPage() {
  const [tab, setTab] = useState<Tab>('structure');
  return (
    <>
      <PageHeader title="Moddalar boshqaruvi" description="Birliklar bo'yicha haqiqiy tuzilma va moddalar guruhlari" />
      <div className="space-y-4 p-4 md:p-6">
        <PillTabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'structure', label: 'Xarajatlar tarkibiy tuzilishi', hint: "Birlik (Call markaz, hudud, yo'nalish) bo'yicha: daromad va xarajat tomoni, yozuvlarni ko'chirish" },
            { value: 'items', label: 'Moddalar (umumiy guruhlar)', hint: "Guruhlar daraxti: yangi guruh / modda, nomini o'zgartirish, ko'chirish" },
          ]}
        />
        {tab === 'structure' ? <StructureView /> : <ManageView />}
      </div>
    </>
  );
}
