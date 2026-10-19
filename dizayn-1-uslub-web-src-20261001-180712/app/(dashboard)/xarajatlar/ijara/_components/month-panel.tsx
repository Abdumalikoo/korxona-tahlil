'use client';

import { leasesApi, type MonthList, type MonthView } from '@/features/leases/api';
import { errorMessage } from '@/lib/error-message';
import { currentPeriod, formatDateTime, formatPeriod, formatPeriodShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconCheck, IconChevronDown, IconSpinner } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';

interface Props {
  period: string;
  month: MonthView | null;
  months: MonthList | null;
  loading: boolean;
  isAdmin: boolean;
  onPeriodChange: (period: string) => void;
  onOpenLease: (id: string) => void;
  /** Yopish / bekor qilishdan keyin */
  onDone: (message: string, tone?: 'success' | 'error') => void;
}

type Action = 'close' | 'reclose' | 'cancel' | null;

/**
 * Oyni yopish — tanlangan oydagi amaldagi ijaralar

 * "Ijara" kategoriyasida xarajatga yoziladi.
 */
export function MonthPanel({
  period,
  month,
  months,
  loading,
  isAdmin,
  onPeriodChange,
  onOpenLease,
  onDone,
}: Props) {
  const [action, setAction] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const close = month?.close ?? null;
  const isFuture = period > currentPeriod();
  const staleCloses = (months?.closes ?? []).filter((c) => c.stale);
  const openPeriods = months?.openPeriods ?? [];

  async function run() {
    if (!action) return;
    setBusy(true);
    try {
      if (action === 'cancel') {
        const result = await leasesApi.cancelMonth(period);
        onDone(`${formatPeriod(period)} yopilishi bekor qilindi (${result.data.removed} ta xarajat o'chirildi)`);
      } else {
        const result = await leasesApi.closeMonth(period, action === 'reclose');
        onDone(
          `${formatPeriod(period)} yopildi: ${result.data.leaseCount} ta ijara xarajatga yozildi`,

        );
      }
    } catch (err) {
      onDone(errorMessage(err, 'Amalni bajarib bo‘lmadi'), 'error');
    } finally {
      setBusy(false);
      setAction(null);
    }
  }

  const changedRows = month?.rows.filter((r) => r.changed) ?? [];

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={`Oyni yopish · ${formatPeriod(period)}`}
        description="Yopilganda har bir amaldagi ijara «Ijara» kategoriyasida xarajat bo'lib yoziladi"
        actions={
          isAdmin && month ? (
            close ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setAction('cancel')}>
                  Bekor qilish
                </Button>
                <Button
                  variant={month.stale ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setAction('reclose')}
                >
                  Qayta yopish
                </Button>
              </>

            ) : (
              <Button
                size="sm"
                onClick={() => setAction('close')}
                disabled={isFuture || month.rows.length === 0}
              >
                <IconCheck className="size-4" />
                Oyni yopish
              </Button>
            )
          ) : null
        }
      />

      <div className="space-y-3 px-5 py-4">
        {loading && !month ? (
          <div className="flex items-center gap-2 text-sm text-(--color-text-muted)">
            <IconSpinner className="size-4 animate-spin" />
            Yuklanmoqda&hellip;
          </div>
        ) : month ? (
          <>
            {/* Holat */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {close ? (
                <Badge tone={month.stale ? 'warn' : 'income'}>
                  {month.stale ? 'Yopilgan · shartlar o‘zgargan' : 'Yopilgan'}
                </Badge>
              ) : (
                <Badge tone={isFuture ? 'neutral' : 'warn'}>
                  {isFuture ? 'Kelajak oy' : 'Yopilmagan'}
                </Badge>

              )}

              <Metric label={close ? 'Xarajatga yozilgan' : 'Yoziladigan summa'}>
                <Money tiyin={close ? close.totalTiyin : month.expectedTotalTiyin} />
              </Metric>
              <Metric label="Ijaralar">{close ? close.leaseCount : month.rows.length}</Metric>
              {close && month.stale && (
                <Metric label="Hozirgi shartlar bo'yicha">
                  <Money tiyin={month.expectedTotalTiyin} tone="expense" />
                </Metric>
              )}
              {close && (
                <span className="text-xs text-(--color-text-muted)">
                  {formatDateTime(close.closedAt)}
                  {close.closedBy ? ` · ${close.closedBy}` : ''}
                </span>
              )}
            </div>

            {close && month.stale && (
              <div className="flex gap-2 rounded-(--radius-control) bg-(--color-warn-soft) px-3 py-2 text-sm text-(--color-warn)">
                <IconAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  Oy yopilgandan keyin {changedRows.length} ta ijarada summa o&rsquo;zgargan. Xarajat
                  hozircha eski summada turibdi &mdash; to&rsquo;g&rsquo;rilash uchun
                  &laquo;Qayta yopish&raquo;ni bosing.
                </span>
              </div>
            )}

            {/* Diqqat talab qiladigan oylar */}
            {(openPeriods.length > 0 || staleCloses.length > 0) && (

              <div className="space-y-1.5 text-xs">
                {openPeriods.length > 0 && (
                  <PeriodChips
                    label="Yopilmagan oylar:"
                    periods={openPeriods}
                    current={period}
                    tone="warn"
                    onPick={onPeriodChange}
                  />
                )}
                {staleCloses.length > 0 && (
                  <PeriodChips
                    label="Qayta yopish kerak:"
                    periods={staleCloses.map((c) => c.period)}
                    current={period}
                    tone="expense"
                    onPick={onPeriodChange}
                  />
                )}
              </div>
            )}

            {month.rows.length > 0 && (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
              >
                {expanded ? 'Yashirish' : 'Oy tafsiloti'}
                <IconChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
              </button>
            )}

          </>
        ) : null}
      </div>

      {expanded && month && month.rows.length > 0 && (
        <Table>
          <THead>
            <Tr>
              <Th>Ijara</Th>
              <Th>Joyi</Th>
              <Th align="right">Hisob</Th>
              {close && <Th align="right">Yozilgan</Th>}
            </Tr>
          </THead>
          <TBody>
            {month.rows.map((row) => (
              <Tr
                key={row.leaseId}
                clickable
                onClick={() => onOpenLease(row.leaseId)}
                className={cn(row.changed && 'bg-(--color-warn-soft)')}
              >
                <Td>
                  <span className="block truncate">{row.title}</span>
                  <span className="text-xs text-(--color-text-muted)">№ {row.number}</span>
                </Td>
                <Td className="text-(--color-text-muted)">{row.place.label}</Td>
                <Td align="right" money>
                  <Money tiyin={row.expectedTiyin} />
                </Td>
                {close && (
                  <Td align="right" money>

                    <Money tiyin={row.accruedTiyin ?? '0'} tone={row.changed ? 'expense' : 'neutral'} />
                  </Td>
                )}
              </Tr>
            ))}
          </TBody>
          <TFoot>
            <Tr>
              <Td className="font-semibold">Jami</Td>
              <Td />
              <Td align="right" money className="font-semibold">
                <Money tiyin={month.expectedTotalTiyin} />
              </Td>
              {close && (
                <Td align="right" money className="font-semibold">
                  <Money tiyin={close.totalTiyin} />
                </Td>
              )}
            </Tr>
          </TFoot>
        </Table>
      )}

      <ConfirmDialog
        open={action !== null}
        danger={action === 'cancel'}
        loading={busy}
        title={
          action === 'cancel'
            ? 'Oy yopilishini bekor qilish'
            : action === 'reclose'
              ? 'Oyni qayta yopish'

              : 'Oyni yopish'
        }
        message={
          action === 'cancel'
            ? `${formatPeriod(period)} uchun yozilgan barcha ijara xarajatlari o'chiriladi.`
            : action === 'reclose'
              ? `${formatPeriod(period)} dagi eski ijara xarajatlari o'chirilib, hozirgi shartlar bo'yicha qayta yoziladi.`
              : `${formatPeriod(period)} uchun ${month?.rows.length ?? 0} ta ijara xarajatga yoziladi.`
        }
        confirmLabel={action === 'cancel' ? "Bekor qilish" : action === 'reclose' ? 'Qayta yopish' : 'Yopish'}
        cancelLabel="Orqaga"
        onConfirm={run}
        onCancel={() => setAction(null)}
      />
    </Card>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-(--color-text-muted)">{label}</p>
      <p className="money text-base font-semibold">{children}</p>
    </div>
  );
}

function PeriodChips({
  label,
  periods,
  current,
  tone,

  onPick,
}: {
  label: string;
  periods: string[];
  current: string;
  tone: 'warn' | 'expense';
  onPick: (period: string) => void;
}) {
  const shown = periods.slice(0, 12);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-(--color-text-muted)">{label}</span>
      {shown.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          className={cn(
            'rounded px-2 py-0.5 font-medium transition-colors',
            p === current && 'ring-2 ring-brand-600',
            tone === 'warn'
              ? 'bg-(--color-warn-soft) text-(--color-warn) hover:brightness-95'
              : 'bg-(--color-expense-soft) text-(--color-expense) hover:brightness-95',
          )}
        >
          {formatPeriodShort(p)}
        </button>
      ))}
      {periods.length > shown.length && (
        <span className="text-(--color-text-faint)">va yana {periods.length - shown.length}</span>
      )}
    </div>

  );
}
