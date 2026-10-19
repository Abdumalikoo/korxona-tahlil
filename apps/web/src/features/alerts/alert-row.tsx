'use client';

import { CalcButton, CalcValue } from '@/components/ui/calc';
import { DiscussDrawer } from '@/features/reactions/discuss';
import { useReactionSelect } from '@/features/reactions/select-context';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';
import { alertsApi, notifyAlertsChanged, type Alert } from './api';

// ═══════════════════════════════════════════════════════════
// Bitta ogohlantirish: nima, raqamlar bilan izoh va amallar —
// «Muhokamaga qo'yish» (darhol munosabat ochiladi), «Savatga» (bir nechtasini bitta munosabatga),
// «Batafsil» (tegishli sahifa), «Ko'rildi» (ro'yxatdan yashirish).
// ═══════════════════════════════════════════════════════════

const SEVERITY: Record<Alert['severity'], { dot: string; chip: string; label: string }> = {
  high: { dot: 'bg-(--color-expense)', chip: 'bg-(--color-expense-soft) text-(--color-expense)', label: 'Jiddiy' },
  medium: { dot: 'bg-tile-orange', chip: 'bg-(--color-warn-soft) text-(--color-warn)', label: "E'tibor" },
};

export function AlertRow({ alert, onChanged, compact = false }: { alert: Alert; onChanged: () => void; compact?: boolean }) {
  const { isAdmin } = useAuth();
  const select = useReactionSelect();
  const [discuss, setDiscuss] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const sev = SEVERITY[alert.severity];
  const inBasket = alert.item && select ? select.isMarked(alert.item) : false;

  const dismiss = async () => {
    setBusy(true);
    try {
      await alertsApi.dismiss(alert.key);
      notifyAlertsChanged();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn('flex gap-3', compact ? 'px-4 py-3' : 'px-5 py-4')}>
      <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', sev.dot)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', sev.chip)}>{sev.label}</span>
          <span className="text-[11px] font-medium uppercase tracking-wide text-(--color-text-faint)">{alert.ruleLabel}</span>
          <CalcButton calc={alert.calc} />
        </div>
        <p className={cn('mt-1 font-semibold text-heading', compact ? 'text-sm' : 'text-[15px]')}>{alert.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-(--color-text-muted)">
          <CalcValue calc={alert.calc}>{alert.detail}</CalcValue>
        </p>

        {created ? (
          <p className="mt-2 text-xs text-(--color-income)">
            Munosabat ochildi —{' '}
            <Link href={`/munosabat/${created}`} className="font-semibold underline">
              ko&apos;rish
            </Link>
          </p>
        ) : (
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {alert.item && isAdmin ? (
              <button
                type="button"
                onClick={() => setDiscuss(true)}
                className="inline-flex h-8 items-center rounded-(--radius-control) bg-brand-600 px-3 text-xs font-semibold text-white shadow-sm hover:bg-brand-700"
              >
                Muhokamaga qo&apos;yish
              </button>
            ) : !alert.item ? (
              <span className="text-xs text-(--color-text-faint)">Allaqachon Nazoratda</span>
            ) : null}
            {alert.item && select && !compact && (
              <button
                type="button"
                onClick={() => {
                  if (!alert.item) return;
                  select.toggle(alert.item);
                  if (!select.active) select.setActive(true);
                }}
                className={cn(
                  'inline-flex h-8 items-center rounded-(--radius-control) border px-3 text-xs font-medium',
                  inBasket ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-(--color-line) bg-white text-heading hover:border-brand-300 hover:text-brand-700',
                )}
                title="Bir nechta moddani bitta munosabatga yig'ish"
              >
                {inBasket ? 'Savatda ✓' : 'Savatga'}
              </button>
            )}
            {alert.href && (
              <Link href={alert.href} className="inline-flex h-8 items-center rounded-(--radius-control) border border-(--color-line) bg-white px-3 text-xs font-medium text-heading hover:border-brand-300 hover:text-brand-700">
                Batafsil
              </Link>
            )}
            <button type="button" onClick={dismiss} disabled={busy} className="inline-flex h-8 items-center px-2 text-xs text-(--color-text-faint) hover:text-heading disabled:opacity-50">
              Ko&apos;rildi
            </button>
          </div>
        )}
      </div>

      {alert.item && discuss && (
        <DiscussDrawer
          items={[alert.item]}
          defaultTitle={alert.title}
          defaultNote={alert.detail}
          open={discuss}
          onClose={() => {
            setDiscuss(false);
            // Oyna yopilgandan keyin ro'yxat yangilanadi (muhokamaga qo'yilgani chiqib ketadi)
            if (created) notifyAlertsChanged();
          }}
          onCreated={async (id) => {
            await alertsApi.dismiss(alert.key).catch(() => undefined);
            setCreated(id);
          }}
        />
      )}
    </div>
  );
}