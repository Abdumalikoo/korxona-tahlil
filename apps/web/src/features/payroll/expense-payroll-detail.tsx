'use client';

import { useState } from 'react';
import { useAsync } from '@/lib/use-async';
import { payrollApi } from './api';
import { formatTiyin } from '@/lib/format';
import { Money } from '@/components/ui/money';
import { LoadingState, ErrorState } from '@/components/ui/states';
import { IconChevronDown, IconUsers } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

interface ExpensePayrollDetailProps {
  expenseId: string;
}

/**
 * Ish haqi xarajati ortidagi xodimlar ro'yxati.
 *
 * Markaz xarajatida — bo'lim xodimlari tekis ro'yxatda.
 * Viloyat xarajatida — tumanlar kesimi bitta blokda ochiladi,
 * har tuman sarlavhasi ostida o'z xodimlari turadi.
 */
export function ExpensePayrollDetail({ expenseId }: ExpensePayrollDetailProps) {
  const [open, setOpen] = useState(false);

  const detail = useAsync(() => payrollApi.expenseDetail(expenseId), [expenseId]);

  if (detail.loading) return <LoadingState label="Xodimlar yuklanmoqda" />;
  if (detail.error) {
    return <ErrorState message={detail.error} onRetry={detail.reload} />;
  }

  const data = detail.data?.data;
  if (!data?.isPayroll) return null;

  const { entries, groups, isCentral, count, totalTiyin, centerPart } = data;
  const centerMoved = entries.reduce((s, e) => s + Number(e.centerTiyin ?? 0), 0);

  return (
    <div className="space-y-3">
      {centerPart ? (
        <p className="rounded-(--radius-control) border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-heading">
          Bu yozuv — hudud xodimlari ish haqi tarkibidagi <b>bayram / choraklik pullar</b>. Xarajatlar siyosati bo&apos;yicha <b>Markaz hisobidan</b>: hudud xarajatiga kirmaydi, Solishtirmada
          Markazning «Hududlar uchun» guruhida (shu hudud uchun) ko&apos;rinadi.
        </p>
      ) : (
        !isCentral &&
        centerMoved > 0 && (
          <p className="rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted) px-3 py-2 text-xs text-(--color-text-muted)">
            Hududga <b>sof oylik</b> yozilgan: bayram va choraklik pullar ({formatTiyin(String(centerMoved), { currency: true })}) Markaz hisobiga alohida o&apos;tkazilgan.
          </p>
        )
      )}
      {/* Yig'indi */}
      <div className="flex items-center justify-between gap-3 rounded-(--radius-control) bg-(--color-surface-sunken) px-4 py-3">
        <div className="flex items-center gap-2">
          <IconUsers className="size-4 text-(--color-text-muted)" />
          <span className="text-sm font-medium">{count} xodim</span>
        </div>
        <span className="money text-sm font-semibold text-(--color-expense)">
          {formatTiyin(totalTiyin ?? 0, { currency: true })}
        </span>
      </div>

      {isCentral ? (
        // Markaz — tekis ro'yxat
        <div className="divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line)">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{entry.employee.fullName}</p>
                {entry.employee.position && (
                  <p className="truncate text-xs text-(--color-text-muted)">
                    {entry.employee.position}
                  </p>
                )}
              </div>
              <Money tiyin={entry.totalTiyin} className="shrink-0 text-sm" />
            </div>
          ))}
        </div>
      ) : (
        // Viloyat — bitta ochiluvchi blok, ichida tumanlar ketma-ket
        <div className="overflow-hidden rounded-(--radius-control) border border-(--color-line)">
          <button
            type="button"
            onClick={() => setOpen((state) => !state)}
            className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-(--color-surface-muted)"
          >
            <IconChevronDown
              className={cn(
                'size-4 shrink-0 text-(--color-text-muted) transition-transform',
                !open && '-rotate-90',
              )}
            />

            <span className="min-w-0 flex-1 text-sm font-medium">
              Tumanlar kesimida
            </span>

            <span className="shrink-0 text-xs text-(--color-text-muted)">
              {groups.length} ta tuman
            </span>
          </button>

          {open && (
            <div className="border-t border-(--color-line)">
              {groups.map((group) => {
                const groupEntries = entries.filter(
                  (entry) => (entry.employee.districtId ?? 'none') === group.key,
                );

                return (
                  <div key={group.key}>
                    {/* Tuman sarlavhasi */}
                    <div className="flex items-center justify-between gap-3 bg-(--color-surface-sunken) px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">
                        {group.label}
                      </span>
                      <span className="shrink-0 text-xs text-(--color-text-muted)">
                        {group.count} ta
                      </span>
                      <Money
                        tiyin={group.totalTiyin}
                        className="shrink-0 text-xs font-semibold"
                      />
                    </div>

                    {/* Xodimlar */}
                    <div className="divide-y divide-(--color-line)">
                      {groupEntries.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-center justify-between gap-3 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">
                              {entry.employee.fullName}
                            </p>
                            {entry.employee.position && (
                              <p className="truncate text-xs text-(--color-text-muted)">
                                {entry.employee.position}
                              </p>
                            )}
                          </div>
                          <Money
                            tiyin={entry.totalTiyin}
                            className="shrink-0 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}