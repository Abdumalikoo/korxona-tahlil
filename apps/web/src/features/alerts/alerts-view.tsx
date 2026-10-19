'use client';

import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { SubTabs } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth-context';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertRow } from './alert-row';
import { ALERTS_CHANGED, alertsApi, notifyAlertsChanged, RULES, type AlertRule } from './api';

// ═══════════════════════════════════════════════════════════
// «Muhokama talab qiladi» — tizim topgan holatlar ro'yxati
// ═══════════════════════════════════════════════════════════

function baseText(periods: string[]): string {
  if (periods.length === 0) return '';
  if (periods.length === 1) return formatPeriod(periods[0]!);
  return `${formatPeriod(periods[0]!)} — ${formatPeriod(periods[periods.length - 1]!)} o'rtachasi`;
}

export function AlertsView() {
  const { isAdmin } = useAuth();
  const [showHidden, setShowHidden] = useState(false);
  const [rule, setRule] = useState<'all' | AlertRule>('all');
  const result = useAsync(() => alertsApi.list(showHidden).then((r) => r.data), [showHidden]);

  // Boshqa joyda o'zgarsa (qo'ng'iroqcha, bosh sahifa) — yangilanadi
  useEffect(() => {
    const reload = () => result.reload();
    window.addEventListener(ALERTS_CHANGED, reload);
    return () => window.removeEventListener(ALERTS_CHANGED, reload);
  }, [result]);

  if (result.error) {
    return (
      <Card>
        <ErrorState message={result.error} onRetry={result.reload} />
      </Card>
    );
  }
  if (!result.data) {
    return (
      <Card>
        <LoadingState label="Ma'lumot tekshirilmoqda" />
      </Card>
    );
  }

  const data = result.data;
  const list = data.alerts.filter((a) => rule === 'all' || a.rule === rule);
  const high = data.alerts.filter((a) => a.severity === 'high').length;

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-heading">Muhokama talab qiladi</h2>
            <p className="mt-0.5 text-sm text-(--color-text-muted)">
              Tekshirilgan oy: <b className="text-heading">{formatPeriod(data.period)}</b> · solishtirish: {baseText(data.basePeriods)}. Tizim har kuni o&apos;zi
              tekshiradi; chegaralar —{' '}
              <Link href="/sozlamalar/ogohlantirish" className="font-medium text-brand-700 hover:underline">
                Sozlamalarda
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-(--radius-control) bg-(--color-expense-soft) px-4 py-2 text-center">
              <p className="text-xl font-bold text-(--color-expense)">{high}</p>
              <p className="text-[11px] text-(--color-expense)">jiddiy</p>
            </div>
            <div className="rounded-(--radius-control) bg-(--color-warn-soft) px-4 py-2 text-center">
              <p className="text-xl font-bold text-(--color-warn)">{data.alerts.length - high}</p>
              <p className="text-[11px] text-(--color-warn)">e&apos;tibor</p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-(--color-line) pt-3">
          <SubTabs
            value={rule}
            onChange={setRule}
            options={[
              { value: 'all', label: `Hammasi (${data.alerts.length})` },
              ...RULES.filter((r) => data.settings.enabled[r.rule]).map((r) => ({ value: r.rule, label: `${r.label} (${data.counts[r.rule] ?? 0})`, hint: r.hint })),
            ]}
          />
          <div className="flex items-center gap-3 text-xs">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-(--color-text-muted)">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} className="size-4" />
              Ko&apos;rilganlarni ham ko&apos;rsatish ({data.dismissedCount})
            </label>
            {isAdmin && data.dismissedCount > 0 && (
              <button
                type="button"
                className="font-medium text-brand-700 hover:underline"
                onClick={async () => {
                  await alertsApi.restore();
                  notifyAlertsChanged();
                }}
              >
                Hammasini qaytarish
              </button>
            )}
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {list.length === 0 ? (
          <EmptyState
            title={data.alerts.length === 0 ? 'Hozircha muhokama talab qiladigan holat yo‘q' : 'Bu turda ogohlantirish yo‘q'}
            description="Ma'lumot sozlamalardagi chegaralar bo'yicha tekshirildi."
          />
        ) : (
          <div className="divide-y divide-(--color-line)">
            {list.map((a) => (
              <AlertRow key={a.key} alert={a} onChanged={result.reload} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/** Bosh sahifa va boshqa joylar uchun: eng jiddiy N tasi */
export function AlertsPreview({ limit = 5, className }: { limit?: number; className?: string }) {
  const result = useAsync(() => alertsApi.list().then((r) => r.data), []);
  useEffect(() => {
    const reload = () => result.reload();
    window.addEventListener(ALERTS_CHANGED, reload);
    return () => window.removeEventListener(ALERTS_CHANGED, reload);
  }, [result]);

  const data = result.data;
  if (!data || data.alerts.length === 0) return null;
  const high = data.alerts.filter((a) => a.severity === 'high').length;

  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--color-line) px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-(--color-expense-soft) text-sm font-bold text-(--color-expense)">!</span>
          <h3 className="text-[15px] font-bold text-heading">Muhokama talab qiladi</h3>
          <span className="text-xs text-(--color-text-muted)">
            {data.alerts.length} ta{high ? ` · ${high} tasi jiddiy` : ''}
          </span>
        </div>
        <Link href="/munosabat/ogohlantirish" className="text-xs font-semibold text-brand-700 hover:underline">
          Hammasi →
        </Link>
      </div>
      <div className="divide-y divide-(--color-line)">
        {data.alerts.slice(0, limit).map((a) => (
          <AlertRow key={a.key} alert={a} onChanged={result.reload} compact />
        ))}
      </div>
    </Card>
  );
}