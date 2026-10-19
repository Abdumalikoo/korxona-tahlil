'use client';

import { PageHeader } from '@/components/layout/page-header';
import { AlertsView } from '@/features/alerts/alerts-view';

/** Munosabat › Muhokama talab qiladi — tizim o'zi topgan holatlar */
export default function AlertsPage() {
  return (
    <>
      <PageHeader title="Munosabat" description="Muhokama talab qiladi — tizim o'zi topgan holatlar" />
      <div className="p-4 md:p-6">
        <AlertsView />
      </div>
    </>
  );
}