'use client';

import {
    CATEGORY_COLORS,
    CATEGORY_LABELS,
    CATEGORY_ORDER,
    compositionApi,
} from '@/features/salary-composition/api';
import { formatPercent, formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useEffect, type ReactNode } from 'react';

import { IconClose } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { RowStateBadge } from './shared';

/** Bitta xodimning oylar bo'yicha ish haqi tarkibi */
export function EmployeeModal({ pinfl, onClose }: { pinfl: string; onClose: () => void }) {
  const history = useAsync(() => compositionApi.employee(pinfl), [pinfl]);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  const data = history.data?.data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-[--radius-card] bg-white shadow-xl"
      >
        {/* Sarlavha */}
        <div className="flex items-start justify-between gap-4 border-b border-[--color-line] px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">
              {data?.employee.fullName ?? 'Xodim'}
            </h2>
            <p className="text-xs text-[--color-text-muted]">
              {data?.employee.unitName ? `${data.employee.unitName} · ` : ''}
              <span className="money">{pinfl}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[--color-text-muted] hover:bg-[--color-surface-sunken] hover:text-[--color-text]"
            aria-label="Yopish"
          >
            <IconClose className="size-5" />
          </button>
        </div>

        <div className="overflow-auto">
          {history.loading ? (
            <LoadingState />
          ) : history.error ? (
            <ErrorState message={history.error} onRetry={history.reload} />
          ) : !data || data.periods.length === 0 ? (
            <EmptyState title="Bu xodim uchun tarkib yuklanmagan" />
          ) : (
            <div className="space-y-5 p-5">
              {/* Umumiy tuzilma */}
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
                  {data.periods.length} oy bo&rsquo;yicha tuzilma
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.byCategory.map((category) => (
                    <div
                      key={category.category}
                      className="flex items-center gap-2 rounded-[--radius-control] border border-[--color-line] px-3 py-1.5 text-sm"
                    >
                      <span
                        className="size-2.5 rounded-full"
                        style={{ backgroundColor: CATEGORY_COLORS[category.category] }}
                      />
                      <span className="text-[--color-text-muted]">{category.label}</span>
                      <Money
                        tiyin={category.totalTiyin}
                        tone={BigInt(category.totalTiyin) < 0n ? 'expense' : 'neutral'}
                        className="font-medium"
                      />
                      <span className="text-xs text-[--color-text-faint]">
                        {formatPercent(category.sharePercent)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Oylar jadvali: qatorlar — komponentlar, ustunlar — oylar */}
              <div className="overflow-x-auto rounded-[--radius-control] border border-[--color-line]">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-[--color-surface-muted]">
                    <tr className="border-b border-[--color-line]">
                      <th className="sticky left-0 z-10 min-w-[15rem] bg-[--color-surface-muted] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[--color-text-muted]">
                        Komponent
                      </th>
                      {data.periods.map((period) => (
                        <th
                          key={period.period}
                          className="min-w-[8.5rem] px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[--color-text-muted]"
                        >
                          {formatPeriodShort(period.period)}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-[--color-line]">
                    {CATEGORY_ORDER.map((category) => {
                      const components = data.components.filter((c) => c.category === category);
                      if (components.length === 0) return null;

                      return [
                        <tr key={`h-${category}`} className="bg-white">
                          <td
                            colSpan={data.periods.length + 1}
                            className="sticky left-0 px-3 pb-1 pt-3 text-xs font-semibold text-[--color-text]"
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="size-2 rounded-full"
                                style={{ backgroundColor: CATEGORY_COLORS[category] }}
                              />
                              {CATEGORY_LABELS[category]}
                            </span>
                          </td>
                        </tr>,
                        ...components.map((component) => (
                          <tr key={component.code}>
                            <td className="sticky left-0 bg-white px-3 py-1.5 pl-7 text-[--color-text-muted]">
                              {component.name}
                            </td>
                            {data.periods.map((period) => {
                              const raw = period.items[component.code];
                              return (
                                <td key={period.period} className="money px-3 py-1.5 text-right">
                                  {raw ? (
                                    <Money
                                      tiyin={component.sign < 0 ? -BigInt(raw) : BigInt(raw)}
                                      tone={component.sign < 0 ? 'expense' : 'neutral'}
                                    />
                                  ) : (
                                    <span className="text-[--color-text-faint]">&mdash;</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        )),
                      ];
                    })}
                  </tbody>

                  <tfoot className="border-t-2 border-[--color-line-strong] bg-[--color-surface-muted]">
                    <FooterRow label="Jami (tarkib)" bold>
                      {data.periods.map((period) => (
                        <td key={period.period} className="money px-3 py-2 text-right font-semibold">
                          <Money tiyin={period.totalTiyin} />
                        </td>
                      ))}
                    </FooterRow>
                    <FooterRow label="Soliq hisoboti">
                      {data.periods.map((period) => (
                        <td key={period.period} className="money px-3 py-2 text-right text-[--color-text-muted]">
                          {period.payrollTiyin === null ? '—' : <Money tiyin={period.payrollTiyin} />}
                        </td>
                      ))}
                    </FooterRow>
                    <FooterRow label="Holat">
                      {data.periods.map((period) => (
                        <td key={period.period} className="px-3 py-2 text-right">
                          <div className="flex flex-col items-end gap-1">
                            <RowStateBadge state={period.state} />
                            {(period.state === 'diff' || period.state === 'not_in_payroll') &&
                              period.diffTiyin !== null && (
                                <Money tiyin={period.diffTiyin} tone="expense" className="text-xs" />
                              )}
                          </div>
                        </td>
                      ))}
                    </FooterRow>
                    <FooterRow label="Ishlagan kun">
                      {data.periods.map((period) => (
                        <td key={period.period} className="money px-3 py-2 text-right text-[--color-text-muted]">
                          {period.workedDays ?? '—'}
                        </td>
                      ))}
                    </FooterRow>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FooterRow({
  label,
  bold = false,
  children,
}: {
  label: string;
  bold?: boolean;
  children: ReactNode;
}) {
  return (
    <tr className="border-t border-[--color-line]">
      <td
        className={cn(
          'sticky left-0 bg-[--color-surface-muted] px-3 py-2 text-sm',
          bold ? 'font-semibold' : 'text-[--color-text-muted]',
        )}
      >
        {label}
      </td>
      {children}
    </tr>
  );
}
