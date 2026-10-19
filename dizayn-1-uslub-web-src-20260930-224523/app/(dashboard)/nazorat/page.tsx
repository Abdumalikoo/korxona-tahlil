'use client';

import { PageHeader } from '@/components/layout/page-header';
import { ControlList } from '@/features/reactions/control-view';

/** Nazorat — moddalar har oy avtomatik hisoblanadi va oylik chegara bilan solishtiriladi */
export default function NazoratPage() {
  return (
    <>
      <PageHeader title="Nazorat" description="Daromad va xarajatlar oylik chegara bo'yicha avtomatik kuzatiladi" />
      <div className="p-6">
        <ControlList />
      </div>
    </>
  );
}