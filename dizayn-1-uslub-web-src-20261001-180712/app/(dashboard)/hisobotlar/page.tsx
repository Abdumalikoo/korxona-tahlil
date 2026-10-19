'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { LoadingState } from '@/components/ui/states';
import { ReportsCenter } from '@/features/reports/reports-center';
import { Suspense } from 'react';

/**
 * Hisobotlar: tepada hisobot nomlari — bittasi bosilsa, pastda o'sha hisobot
 * (ekranda, hisob-kitoblari bilan) va Excel · PowerPoint · PDF tugmalari.
 */
export default function HisobotlarPage() {
  return (
    <>
      <PageHeader title="Hisobotlar" description="Hisobotni tanlang — ekranda ko'ring yoki Excel, PowerPoint, PDF yuklab oling" />
      <div className="p-4 md:p-6">
        {/* Tanlangan hisobot manzilda (?r=) — useSearchParams uchun Suspense kerak */}
        <Suspense
          fallback={
            <Card>
              <LoadingState label="Yuklanmoqda" />
            </Card>
          }
        >
          <ReportsCenter />
        </Suspense>
      </div>
    </>
  );
}