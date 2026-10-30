'use client';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodDataHint } from '@/components/shared/period-data-hint';
import { Card } from '@/components/ui/card';
import { SegmentSolishtirma } from '@/features/regions/segment-view';
import { usePeriod } from '@/lib/period';
import { unitBySlug } from '@/lib/segments';
import Link from 'next/link';
import { useParams } from 'next/navigation';

/**
 * Solishtirma › Tax free | Marksheyder | Fermer xo'jaligi | Buxgalteriya xizmatlari —
 * har biri alohida: daromad manbalari, xarajat tarkibi, natija, siyosat oqimlari, 12 oy.
 */
export default function SolishtirmaSegmentPage() {
  const params = useParams<{ slug: string }>();
  const { range } = usePeriod();
  const unit = unitBySlug(params.slug);
  const ok = unit && unit.code !== 'CENTER' && unit.code !== 'REGION';
  return (
    <>
      <PageHeader title={ok ? unit.label : 'Solishtirma'} description={ok ? `${unit.hint}: daromad manbalari, xarajat tarkibi va natija` : undefined} />
      <div className="p-4 md:p-6">
        {ok ? (
          <>
            <PeriodDataHint className="mb-4" />
            <SegmentSolishtirma unit={unit} range={range} />
          </>
        ) : (
          <Card className="p-6 text-sm text-(--color-text-muted)">
            Bunday bo&apos;lim yo&apos;q.{' '}
            <Link href="/" className="font-semibold text-brand-700 hover:underline">
              Solishtirmaga qaytish
            </Link>
          </Card>
        )}
      </div>
    </>
  );
}