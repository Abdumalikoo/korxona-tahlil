'use client';

import { Card } from '@/components/ui/card';
import { compact } from '@/features/structure/api';
import { KpiStrip } from '@/features/structure/parts';
import { formatPeriod } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { EconOverview } from './api';

/**
 * Ma'lumot va modellar holati: qancha ma'lumot bor, qaysi model tayyor,
 * g'ayrioddiy oylar haqida ogohlantirishlar. Hech narsa o'zgartirilmaydi — faqat ko'rsatiladi.
 */
export function DataStatus({ overview }: { overview: EconOverview }) {
  const full = overview.fullMonths;
  const incomeTotal = overview.total.incomeTiyin.slice(0, full).reduce((s, v) => s + Number(v), 0);
  const expenseTotal = overview.total.expenseTiyin.slice(0, full).reduce((s, v) => s + Number(v), 0);
  const heads = overview.total.headcount[full - 1] ?? 0;
  const regions = overview.units.filter((u) => u.kind === 'region' && u.fullMonths > 0).length;
  const ready = overview.readiness.filter((r) => r.ready).length;
  const warns = overview.warnings.filter((w) => w.level === 'warn');
  const infos = overview.warnings.filter((w) => w.level === 'info');

  return (
    <div className="space-y-4">
      <KpiStrip
        items={[
          { label: 'Tugagan oylar', value: String(full), sub: `${formatPeriod(overview.firstPeriod)} – ${formatPeriod(overview.lastFullPeriod)}` },
          { label: 'Daromad (jami)', value: compact(incomeTotal), sub: `xarajat ${compact(expenseTotal)} · shu oylar jami` },
          { label: 'Hududlar', value: String(regions), sub: `${heads} xodim (${formatPeriod(overview.lastFullPeriod)})` },
          { label: "Ma'lumoti yetarli modellar", value: `${ready} / ${overview.readiness.length}`, valueClass: ready === overview.readiness.length ? 'text-[--color-income]' : undefined, sub: warns.length ? `${warns.length} ta ogohlantirish` : "ma'lumotda jiddiy muammo yo'q" },
        ]}
      />

      {overview.warnings.length > 0 && (
        <Card className="border-l-2 border-l-amber-500">
          <div className="px-5 py-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">Ma&apos;lumot sifati</h3>
            <ul className="mt-2.5 space-y-2 text-sm leading-relaxed">
              {[...warns, ...infos].map((w) => (
                <li key={w.text} className="flex gap-2.5">
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', w.level === 'warn' ? 'bg-amber-500' : 'bg-slate-400')} />
                  <span>{w.text}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-[--color-text-muted]">
              Modellar ma&apos;lumotni o&apos;zgartirmaydi: xato yozuv bo&apos;lsa, uni tegishli bo&apos;limda (Daromadlar, Xarajatlar, Xodimlar) tuzating — modellar keyingi hisobda o&apos;zi yangilanadi.
            </p>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="px-5 py-3.5">
          <h3 className="text-sm font-semibold">Modellar va ularga kerakli ma&apos;lumot</h3>
          <p className="mt-0.5 text-xs text-[--color-text-muted]">Har bir model uchun qancha ma&apos;lumot kerakligi va hozir qancha borligi. ✓ — ma&apos;lumot yetarli.</p>
        </div>
        <ul className="divide-y divide-[--color-line] border-t border-[--color-line]">
          {overview.readiness.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-5 py-3">
              <span
                className={cn(
                  'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                  r.ready ? 'bg-[--color-income-soft] text-[--color-income]' : 'bg-[--color-surface-sunken] text-[--color-text-muted]',
                )}
              >
                {r.ready ? '✓' : '–'}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">{r.title}</p>
                <p className="text-xs text-[--color-text-muted]">{r.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <div className="px-5 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">Manbalar</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[--color-text]">
            {overview.sources.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[--color-text-muted]">
            Hududlar Solishtirma bo&apos;limidagidek aniqlanadi: yozuvdagi hudud (0 — Markaz); hududsiz lekin Markaz bo&apos;limi ko&apos;rsatilgan yozuv — Markaz; qolgani — «hududga biriktirilmagan».
          </p>
        </div>
      </Card>
    </div>
  );
}