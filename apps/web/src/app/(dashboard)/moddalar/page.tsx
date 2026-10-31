'use client';

import { PageHeader } from '@/components/layout/page-header';
import { ManageView } from '@/features/categories-manage/manage-view';

/** Umumiy manba › Moddalar boshqaruvi — xarajat moddalari guruhlari: yaratish, nomini o'zgartirish, ko'chirish */
export default function ModdalarPage() {
  return (
    <>
      <PageHeader title="Moddalar boshqaruvi" description="Xarajat moddalari guruhlari: yangi guruh / modda, nomini o'zgartirish, boshqa guruhga ko'chirish" />
      <div className="p-4 md:p-6">
        <ManageView />
      </div>
    </>
  );
}
