'use client';

import { Card } from '@/components/ui/card';
import { compact } from '@/features/structure/api';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { dashApi, share } from './api';
import { LightDot } from './dashboard-view';

/**
 * Solishtirma sahifasining yuqorisida: hudud modellari xulosasi (holat, keyingi oy, eng muhim izoh)
 * va «Hududlar paneli»ga havola. Ma'lumot yuklanmasa — hech narsa ko'rsatilmaydi (asosiy jadvalga xalaqit bermaydi).
 */
export function SolishtirmaModelsCard() {
  const { month } = usePeriod();
  const res = useAsync(() => dashApi.dashboard(month).then((r) => r.data), [month]);
  const d = res.data;
  if (!d) return null;
  const reds = d.rows.filter((r) => r.light === 'red');
  const top = d.story.find((s) => s.tone === 'bad') ?? d.story[0];
  return (
    <Card className="mb-4 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Hudud modellari · {d.lastLabel}</p>
          <div className="mt-1 flex items-center gap-3 text-sm font-semibold text-heading">
            <span className="flex items-center gap-1.5"><LightDot l="red" /> {d.lights.red}</span>
            <span className="flex items-center gap-1.5"><LightDot l="amber" /> {d.lights.amber}</span>
            <span className="flex items-center gap-1.5"><LightDot l="green" /> {d.lights.green}</span>
          </div>
        </div>
        <div className="text-sm">
          <p className="text-[11px] text-(--color-text-muted)">Natija (Markaz ulushi bilan)</p>
          <p className={cn('money font-semibold', Number(d.totals.adjustedTiyin) < 0 ? 'text-(--color-expense)' : 'text-heading')}>{compact(d.totals.adjustedTiyin)} so&apos;m</p>
        </div>
        <div className="text-sm">
          <p className="text-[11px] text-(--color-text-muted)">{d.nextLabel} prognozi</p>
          <p className="money font-semibold text-heading">
            {compact(d.totals.forecastResultTiyin)} <span className="text-xs font-normal text-(--color-text-muted)">· salohiyatdan foydalanish {share(d.totals.utilization)}</span>
          </p>
        </div>
        <Link href="/katta-modellar?tab=panel" className="ml-auto whitespace-nowrap rounded-(--radius-control) bg-brand-500 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-600">
          Hududlar paneli →
        </Link>
      </div>
      {(top || reds.length > 0) && (
        <div className="border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-2 text-xs text-(--color-text)">
          {reds.length > 0 ? (
            <>
              <b className="text-red-700">E&apos;tibor:</b> {reds.slice(0, 4).map((r) => `${r.name} (${r.reasons[0]})`).join('; ')}
              {reds.length > 4 ? ' …' : ''}
            </>
          ) : (
            top?.text
          )}
        </div>
      )}
    </Card>
  );
}