'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Qomita3802Page } from '@/features/qomita/qomita-page';

/** 3802 — Qo'mita qoplashi (alohida bo'lim): qoplash va qoldiq, shtatlar, oylik real bajarilgan ishlar, nazorat zanjiri */
export default function Page() {
  return (
    <>
      <PageHeader title="3802 — Qo'mita qoplashi" description="Qo'mita qoplaydigan xarajatlar: shtat bo'yicha kim oladi, qaysi qismlar, har oy haqiqatda qancha — va kelgan pul bilan solishtirish" />
      <Qomita3802Page />
    </>
  );
}
