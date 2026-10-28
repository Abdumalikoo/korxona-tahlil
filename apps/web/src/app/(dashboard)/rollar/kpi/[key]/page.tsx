'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { ACTING_KPI_KEY, kpiOverviewApi } from '@/features/kpi/api';
import { useAuth } from '@/lib/auth-context';
import { formatDateTime, formatPeriod, formatPeriodShort } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Rollar › KPI: <bo'lim> — bo'lim rahbari rolining dashbordi (umumiy hudud), Omborchi / Buxgalter rol sahifalaridek:
//   • «Ish stoliga kirish» — rahbar ko'rinishida (shu bo'lim bilan) baholash stoliga;
//   • joriy oy: xodimlar, baholangan, o'rtacha ball, yuborilganmi; rahbar(lar) va ularning holati;
//   • «Diqqat» — nimaga e'tibor berish kerak; yil oylari; eng yuqori / eng past ball; harakatlar lentasi; mezonlar.
// Baholash bu yerda yo'q — rahbar o'z ish stolida baholaydi.
// ═══════════════════════════════════════════════════════════

function Tile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'ok' | 'warn' | 'brand' | 'bad' }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold text-(--color-text-muted)">{label}</p>
      <p className={cn('mt-1.5 text-[26px] leading-tight font-bold tabular-nums', tone === 'ok' ? 'text-(--color-income)' : tone === 'warn' ? 'text-amber-600' : tone === 'bad' ? 'text-(--color-expense)' : tone === 'brand' ? 'text-brand-700' : 'text-heading')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-(--color-text-muted)">{hint}</p>}
    </Card>
  );
}

export default function KpiRolePage() {
  const params = useParams<{ key: string }>();
  const key = String(params?.key ?? '').toUpperCase();
  const { isAdmin, enterRole } = useAuth();
  const router = useRouter();
  const res = useAsync(() => kpiOverviewApi.get(key).then((r) => r.data), [key]);
  // Davr tanlagich bu yerda kerak emas (yil oylari o'zi) — yuqori panelda yashirinadi
  const { claimRange } = usePeriod();
  useEffect(() => claimRange(), [claimRange]);

  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!res.data) return <LoadingState label="KPI dashbordi yuklanmoqda" />;
  const o = res.data;

  /** Rahbar ko'rinishida shu bo'lim baholash stoliga (ID kod va PIN'siz — administrator) */
  function enter() {
    try {
      window.sessionStorage.setItem(ACTING_KPI_KEY, o.key);
    } catch {
      // sessiya xotirasi yopiq — manzildagi ?b= yetarli
    }
    const home = enterRole('BOLIM_RAHBARI');
    if (home) router.push(`${home}?b=${o.key}`);
  }

  const cur = o.current;
  const sent = o.months.filter((m) => m.submittedAt).length;
  return (
    <>
      <PageHeader title={`KPI: ${o.department}`} description={o.title} />
      <div className="space-y-4 p-4 md:p-6">
        {/* Tugmalar sahifa tanasida — yuqori panel tor bo'lganda sarlavhani siqmasin */}
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <Button onClick={enter} title="ID kod va PIN'siz shu bo'lim rahbari ish stoliga kirish">
              Ish stoliga kirish →
            </Button>
          )}
          <Link href="/yigma-kpi" className="inline-flex h-10 items-center rounded-(--radius-control) border border-(--color-line) bg-white px-4 text-sm font-medium text-heading hover:border-brand-300">
            Yig&apos;ma KPI
          </Link>
          <span className="text-xs text-(--color-text-muted)">{o.source}</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Tile label="Bo'lim xodimlari" value={o.employees} hint={`${formatPeriod(cur.period)} holatiga`} />
          <Tile label={`Baholangan (${formatPeriodShort(cur.period)})`} value={`${cur.count} / ${o.employees}`} tone={cur.count >= o.employees && o.employees ? 'ok' : cur.count ? 'warn' : 'bad'} hint={cur.submittedAt ? `yuborilgan ${formatDateTime(cur.submittedAt)}` : 'hali yuborilmagan'} />
          <Tile label="O'rtacha ball" value={cur.average ?? '—'} tone="brand" hint="joriy oy, 0–100" />
          <Tile label={`Yuborilgan oylar (${o.year})`} value={`${sent} / ${o.months.length}`} tone={sent === o.months.length ? 'ok' : 'warn'} />
          <Tile label="Rahbar" value={o.heads.length || '—'} tone={o.heads.length ? undefined : 'bad'} hint={o.heads.map((h) => h.fullName).join(', ') || 'biriktirilmagan'} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Diqqat" description="Nimaga e'tibor berish kerak" />
            <CardBody>
              {o.alerts.length ? (
                <ul className="space-y-1.5 text-sm">
                  {o.alerts.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', a.tone === 'red' ? 'bg-(--color-expense)' : 'bg-amber-500')} />
                      {a.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-(--color-income)">Hammasi joyida: rahbar bor, oylar yuborilgan, hamma baholangan.</p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Rahbar" description="Bo'lim rahbari (ID kod + PIN bilan kiradi)" actions={isAdmin ? <Link href="/yigma-kpi" className="text-sm font-medium text-brand-700 hover:underline">Biriktirish →</Link> : undefined} />
            <CardBody>
              {o.heads.length ? (
                <ul className="divide-y divide-(--color-line) text-sm">
                  {o.heads.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center gap-2 py-2">
                      <span className="min-w-0 flex-1 font-medium text-heading">{h.fullName}</span>
                      <span className="text-xs text-(--color-text-muted)">{h.loginCode}</span>
                      {!h.isActive ? <Badge tone="neutral">bloklangan</Badge> : h.locked ? <Badge tone="expense">PIN yopilgan</Badge> : h.mustChangePin ? <Badge tone="warn">hali kirmagan</Badge> : <Badge tone="income">faol</Badge>}
                      <span className="text-xs text-(--color-text-faint)">{h.lastLoginAt ? `oxirgi kirish ${formatDateTime(h.lastLoginAt)}` : ''}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-(--color-text-muted)">Rahbar biriktirilmagan — Sozlamalar › Foydalanuvchilar («Bo&apos;lim rahbari (KPI)» roli), keyin Yig&apos;ma KPI › Bo&apos;lim rahbarlari.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader title={`${o.year}-yil oylari`} description="Har oy: nechta xodim baholangan, o'rtacha ball, yuborilganmi" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-(--color-surface-muted) text-[10.5px] tracking-wide text-(--color-text-muted) uppercase">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Oy</th>
                  <th className="px-3 py-2 text-right font-semibold">Baholangan</th>
                  <th className="px-3 py-2 text-right font-semibold">O&apos;rtacha ball</th>
                  <th className="px-3 py-2 text-left font-semibold">Holat</th>
                </tr>
              </thead>
              <tbody>
                {[...o.months].reverse().map((m) => (
                  <tr key={m.period} className="border-t border-(--color-line)">
                    <td className="px-3 py-1.5 font-medium text-heading">{formatPeriod(m.period)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m.count || '—'}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{m.average ?? '—'}</td>
                    <td className="px-3 py-1.5 text-xs">
                      {m.submittedAt ? (
                        <span className="text-(--color-income)">
                          ✓ yuborilgan {formatDateTime(m.submittedAt)}
                          {m.submittedBy ? ` · ${m.submittedBy}` : ''}
                        </span>
                      ) : m.count ? (
                        <span className="text-amber-700">kiritilmoqda — yuborilmagan</span>
                      ) : (
                        <span className="text-(--color-text-faint)">kiritilmagan</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {o.last && (
          <div className="grid gap-4 lg:grid-cols-2">
            {(
              [
                ['Eng yuqori ball', o.last.top],
                ['Eng past ball', o.last.bottom],
              ] as const
            ).map(([title, list]) =>
              list.length ? (
                <Card key={title}>
                  <CardHeader title={title} description={formatPeriod(o.last!.period)} />
                  <CardBody>
                    <ul className="divide-y divide-(--color-line) text-sm">
                      {list.map((x) => (
                        <li key={x.pinfl} className="flex items-center gap-3 py-1.5">
                          <span className="min-w-0 flex-1 truncate text-heading">{x.fullName}</span>
                          <span className="text-xs text-(--color-text-faint)">
                            +{x.bonus} / −{x.penalty}
                          </span>
                          <span className="w-10 text-right text-base font-bold tabular-nums">{x.total}</span>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              ) : null,
            )}
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card className="overflow-hidden">
            <CardHeader title="Harakatlar" description="Kim, qachon, kimni baholadi (so'nggi 30 ta)" />
            {o.activity.length ? (
              <ul className="divide-y divide-(--color-line) text-sm">
                {o.activity.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 py-2">
                    <span className="w-32 text-xs text-(--color-text-muted)">{formatDateTime(a.savedAt)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <b className="text-heading">{a.fullName}</b> · {formatPeriodShort(a.period)}
                    </span>
                    <span className="text-xs text-(--color-text-muted)">{a.savedBy}</span>
                    <span className="w-10 text-right font-bold tabular-nums">{a.total}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody className="text-sm text-(--color-text-muted)">Hali baholash kiritilmagan.</CardBody>
            )}
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Baholash mezonlari" description={`Manba: ${o.source}`} />
            <ul className="divide-y divide-(--color-line) text-xs">
              {o.criteria.map((c) => (
                <li key={c.id} className="flex items-start gap-2 px-4 py-1.5">
                  <Badge tone={c.kind === 'BONUS' ? 'income' : 'expense'} className="px-1.5 py-0 text-[10px]">
                    {c.kind === 'BONUS' ? '+' : '−'}
                    {c.no}
                  </Badge>
                  <span className="min-w-0 flex-1 text-heading">{c.title}</span>
                  <span className="font-semibold tabular-nums">{c.max}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
