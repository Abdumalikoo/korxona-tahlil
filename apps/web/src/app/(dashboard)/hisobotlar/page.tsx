'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { LoadingState } from '@/components/ui/states';
import { SubTabs } from '@/components/ui/tabs';
import { ReportsCenter } from '@/features/reports/reports-center';
import { UnitsReportPanel } from '@/features/reports/units-report';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

type Area = 'UNITS' | 'CENTER';

/**
 * Hisobotlar:
 *  • «Bo'limlar bo'yicha» — bitta bo'lim (Markaz bo'limi, hudud / tuman, yo'nalish): aniq raqamlar, Excel va PDF;
 *  • «Umumiy hisobotlar» — tepada hisobot nomlari, bittasi bosilsa pastda o'sha hisobot (ekranda, hisob-kitoblari bilan)
 *    va Excel · PowerPoint · PDF tugmalari.
 */
export default function HisobotlarPage() {
  // useSearchParams uchun Suspense kerak
  return (
    <Suspense
      fallback={
        <Card>
          <LoadingState label="Yuklanmoqda" />
        </Card>
      }
    >
      <Reports />
    </Suspense>
  );
}

function Reports() {
  // Umumiy hisobot havolasi (?r=) bilan kelinganda — o'sha bo'lim
  const [area, setArea] = useState<Area>(useSearchParams().has('r') ? 'CENTER' : 'UNITS');
  return (
    <>
      <PageHeader title="Hisobotlar" description="Bo'limlar bo'yicha yoki umumiy hisobot — ekranda ko'ring, Excel yoki PDF yuklab oling" />
      <div className="space-y-4 p-4 md:p-6">
        <SubTabs
          value={area}
          onChange={setArea}
          options={[
            { value: 'UNITS', label: "Bo'limlar bo'yicha", hint: "Markaz bo'limi, hudud (tuman) yoki yo'nalish — aniq raqamlar" },
            { value: 'CENTER', label: 'Umumiy hisobotlar', hint: 'Davr moliyaviy hisoboti, hududlar, solishtirma va boshqalar' },
          ]}
        />
        {area === 'UNITS' ? (
          <UnitsReportPanel />
        ) : (
          <ReportsCenter />
        )}
      </div>
    </>
  );
}
