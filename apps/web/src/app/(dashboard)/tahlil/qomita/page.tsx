'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PillTabs } from '@/components/report/report';
import { Toast } from '@/components/ui/toast';
import { HisobPanel } from '@/features/qomita/qomita-hisob';
import { ComparePanel } from '@/features/qomita/qomita-compare';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { useAuth } from '@/lib/auth-context';
import Link from 'next/link';
import { useState } from 'react';

/**
 * Bosh sahifa › Qo'mita pullari sarfi — 3802 › «Qoplash va qoldiq» bilan bitta ko'rinish (ikkala joyda ham):
 * 3802 va Marksheyder — kelgan → sarflangan → qoldiq, ichma-ich (oy → kelgan pullar / sarf → bo'lim → xodim → nimaga qancha).
 */
export default function QomitaSarfPage() {
  const { isAdmin } = useAuth();
  const range = useMonthRange('year');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  /** Umumiy — kelgan → sarf → qoldiq; Solishtirma — xodimning to'liq oyligi: Qo'mita qoplagani va korxona to'lagani */
  const [tab, setTab] = useState<'umumiy' | 'solishtirma'>('umumiy');
  return (
    <>
      <PageHeader title="Qo'mita pullari sarfi" description="3802 va Marksheyder: kelgan pul, sarf va qoldiq — oy, bo'lim va xodim kesimida" />
      <div className="space-y-4 p-4 md:p-6">
        <MonthRangeCard range={range} />
        <PillTabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'umumiy', label: 'Umumiy', hint: "Kelgan pul → sarf → qoldiq (3802 va Marksheyder), ichma-ich" },
            { value: 'solishtirma', label: 'Solishtirma', hint: "Qo'mitadan pul oladigan xodimlar: to'liq oylik, Qo'mita qoplagani, korxona to'lagani" },
          ]}
        />
        {range.error ? null : tab === 'umumiy' ? <HisobPanel from={range.from} to={range.to} isAdmin={isAdmin} onToast={setToast} /> : <ComparePanel from={range.from} to={range.to} />}
        <p className="text-xs text-(--color-text-muted)">
          Shablon va shtatlarni yuklash, nazorat zanjiri —{' '}
          <Link href="/3802" className="font-medium text-brand-700 hover:underline">
            3802 — Qo&apos;mita qoplashi
          </Link>
          ; kelgan pullar — Daromadlar › Qo&apos;mita mablag&apos;lari.
        </p>
      </div>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </>
  );
}
