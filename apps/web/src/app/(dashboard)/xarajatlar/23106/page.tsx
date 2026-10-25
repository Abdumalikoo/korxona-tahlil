'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Acc23106View } from '@/features/acc-23106/acc23106-view';
import { SectionTabs } from '@/features/sections/section-tabs';

/** Xarajatlar › 23106 — xodimlarga to'lovlar (bayram puli, mukofot, xizmat safari …) ko'chirmasi va nazorati */
export default function Acc23106Page() {
  return (
    <>
      <PageHeader title="Xarajatlar" description="23106 · xodimlarga to'lovlar ko'chirmasi" />
      <SectionTabs kind="expense" section="DOIMIY" />
      <div className="space-y-4 p-6">
        <Acc23106View />
      </div>
    </>
  );
}