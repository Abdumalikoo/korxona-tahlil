'use client';

import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';

import { Badge } from '@/components/ui/badge';
import { IconSpinner } from '@/components/ui/icons';

import {
    employmentLabel,
    placeLabel,
    TRANSFER_KIND_LABELS,
    transfersApi,
    type TransferPlace,
} from './transfers-api';

interface Run {
  from: string;
  to: string;
  months: number;
  place: TransferPlace;
}

/** Ketma-ket bir xil joydagi oylarni bitta oraliqqa birlashtiradi */
function toRuns(months: (TransferPlace & { period: string })[]): Run[] {
  const runs: Run[] = [];
  for (const month of months) {
    const last = runs[runs.length - 1];
    const same =
      last &&
      last.place.regionCode === month.regionCode &&
      (last.place.districtId ?? '') === (month.districtId ?? '') &&
      last.place.employmentType === month.employmentType;

    if (last && same) {
      last.to = month.period;
      last.months += 1;
    } else {
      const { period, ...place } = month;
      runs.push({ from: period, to: period, months: 1, place });
    }
  }
  return runs.reverse();
}

/**
 * Xodimning joylashuv tarixi — Natijalar fayllaridan.
 * Qachon va qayerga o'tgani, oraliqlar bo'yicha.
 */
export function TransferHistory({ pinfl }: { pinfl: string }) {
  const timeline = useAsync(() => transfersApi.employee(pinfl), [pinfl]);
  const data = timeline.data?.data;

  return (
    <div className="mt-6 border-t border-(--color-line) pt-5">
      <p className="text-sm font-semibold">Joylashuv tarixi</p>
      <p className="mt-0.5 text-xs text-(--color-text-muted)">
        Har oylik Natijalar faylidagi hudud va tuman bo&rsquo;yicha
      </p>

      {timeline.loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-(--color-text-muted)">
          <IconSpinner className="size-4 animate-spin" />
          Yuklanmoqda&hellip;
        </div>
      ) : timeline.error ? (
        <p className="py-4 text-sm text-(--color-expense)">{timeline.error}</p>
      ) : !data || data.months.length === 0 ? (
        <p className="py-4 text-sm text-(--color-text-muted)">
          Natijalar fayllarida bu xodim hali uchramagan
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          {/* O'tkazmalar */}
          {data.transfers.length === 0 ? (
            <div className="rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-2.5 text-sm text-(--color-text-muted)">
              O&rsquo;tkazma yo&rsquo;q &mdash; {data.months.length} oy davomida bir joyda
            </div>
          ) : (
            <div className="space-y-2">
              {data.transfers.map((transfer) => (
                <div
                  key={`${transfer.period}-${transfer.previousPeriod}`}
                  className="rounded-(--radius-control) border border-(--color-warn) bg-(--color-warn-soft) px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-(--color-warn)">
                      {formatPeriod(transfer.period)} dan
                    </span>
                    {transfer.kinds.map((kind) => (
                      <Badge key={kind} tone="warn">
                        {TRANSFER_KIND_LABELS[kind]}
                      </Badge>
                    ))}
                  </div>

                  <div className="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-(--color-text-muted)">
                        {placeLabel(transfer.from)}
                      </span>
                      <span className="text-xs text-(--color-text-faint)">
                        {employmentLabel(transfer.from.employmentType)} &middot; oxirgi:{' '}
                        {formatPeriod(transfer.previousPeriod)}
                      </span>
                    </span>
                    <span className="text-(--color-warn)">&rarr;</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{placeLabel(transfer.to)}</span>
                      <span className="text-xs text-(--color-text-faint)">
                        {employmentLabel(transfer.to.employmentType)}
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Oraliqlar */}
          <div className="divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line)">
            {toRuns(data.months).map((run, index) => (
              <div
                key={run.from}
                className={cn('flex items-center gap-3 px-3 py-2', index === 0 && 'bg-brand-50')}
              >
                <span className="w-40 shrink-0 text-xs text-(--color-text-muted)">
                  {run.from === run.to
                    ? formatPeriod(run.from)
                    : `${formatPeriod(run.from)} — ${formatPeriod(run.to)}`}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{placeLabel(run.place)}</span>
                <Badge tone={run.place.employmentType === 'SHARTNOMA' ? 'warn' : 'brand'}>
                  {employmentLabel(run.place.employmentType)}
                </Badge>
                <span className="w-12 shrink-0 text-right text-xs text-(--color-text-faint)">
                  {run.months} oy
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
