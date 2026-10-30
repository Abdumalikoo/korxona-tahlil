'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Toast } from '@/components/ui/toast';
import { BayramPanel } from '@/features/acc-23106/bayram-panel';
import { SectionTabs } from '@/features/sections/section-tabs';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { useAuth } from '@/lib/auth-context';
import { useState } from 'react';

/**
 * Xarajatlar › Test ish haqi — sinov bo'limi: hudud xodimlari bayram pullari (23106 ko'chirmasidan) ko'rib chiqiladi;
 * oy tasdiqlangandan keyingina hudud ish haqidan Markaz hisobiga o'tadi. Ma'qul bo'lsa — doimiy joyiga ko'chiriladi,
 * bo'lmasa bo'lim olib tashlanadi.
 */
export default function TestPayrollPage() {
  const { isAdmin } = useAuth();
  const range = useMonthRange('year');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  return (
    <>
      <PageHeader title="Xarajatlar" description="Test ish haqi · hudud xodimlari bayram pullari — Markaz hisobiga (sinov)" />
      <SectionTabs kind="expense" section="DOIMIY" />
      <div className="space-y-4 p-6">
        <MonthRangeCard range={range} />
        <BayramPanel from={range.from} to={range.to} rangeText={range.text} disabled={Boolean(range.error)} isAdmin={isAdmin} reloadKey={0} onToast={setToast} />
      </div>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}
