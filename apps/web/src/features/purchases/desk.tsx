'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { useAuth } from '@/lib/auth-context';
import { formatDateLong, formatTiyin, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { purchasesApi } from './api';

const ACTIONS = [
  { href: '/xarid/birja', title: 'Birja xaridi', hint: 'Lot, shartnoma, yig‘im', tone: 'from-indigo-500 to-blue-600', ring: 'hover:ring-indigo-200' },
  { href: '/xarid/oddiy', title: 'Oddiy xarid', hint: "Do'kon, to'g'ridan-to'g'ri", tone: 'from-emerald-500 to-emerald-600', ring: 'hover:ring-emerald-200' },
  { href: '/xarid/qabul', title: 'Tovar keldi', hint: 'Omborchiga yuborish', tone: 'from-amber-500 to-orange-500', ring: 'hover:ring-amber-200' },
  { href: '/xarid/ariza', title: 'Ariza yozish', hint: "Bo'lim so'rovi", tone: 'from-slate-500 to-slate-600', ring: 'hover:ring-slate-200' },
];

function hello(): string {
  const h = new Date().getHours();
  return h < 6 ? 'Xayrli tun' : h < 12 ? 'Xayrli tong' : h < 18 ? 'Xayrli kun' : 'Xayrli kech';
}

/** Xarid › Ish stoli: xaridchining bosh sahifasi (tahlil emas, bugungi ishlar) */
export function XaridDesk() {
  const { user } = useAuth();
  const today = todayInput();
  const ov = useAsync(() => purchasesApi.overview(), []);
  const o = ov.data?.data;
  const firstName = (user?.fullName ?? '').split(/\s+/)[1] ?? user?.fullName ?? '';

  const stats = o
    ? [
        { label: 'Kutilayotgan xarid', value: String(o.open.count), sub: `${formatTiyin(o.open.totalTiyin)} so'm`, href: '/xarid/xaridlar', alert: false },
        { label: 'Yetkazish kechikkan', value: String(o.lateDelivery), sub: 'muddat o‘tgan', href: '/xarid/xaridlar?filter=late', alert: o.lateDelivery > 0 },
        { label: "Qarz (to'lanmagan)", value: formatTiyin(o.debtTiyin), sub: o.latePayment ? `${o.latePayment} tasi muddati o‘tgan` : "so'm", href: '/xarid/xaridlar?filter=unpaid', alert: o.latePayment > 0 },
        { label: 'Omborchi kutmoqda', value: String(o.pendingReceipts), sub: 'qabul qilinmagan', href: '/xarid/qabul', alert: false },
        { label: 'Ochiq arizalar', value: String(o.requests), sub: "bo'limlardan", href: '/xarid/arizalar', alert: o.requests > 0 },
      ]
    : [];

  return (
    <>
      <PageHeader title="Ish stoli" description={`${hello()}${firstName ? `, ${firstName}` : ''} · ${formatDateLong(today)}`} />
      <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6">
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {ACTIONS.map((a) => (
            <Link key={a.href} href={a.href} className={cn('group relative overflow-hidden rounded-(--radius-card) bg-gradient-to-br p-4 text-white shadow-card ring-4 ring-transparent transition-all hover:-translate-y-0.5 hover:shadow-lg', a.tone, a.ring)}>
              <p className="text-lg font-bold">{a.title}</p>
              <p className="mt-1 text-xs text-white/85">{a.hint}</p>
            </Link>
          ))}
        </div>

        {ov.loading && !o ? (
          <LoadingState />
        ) : ov.error ? (
          <ErrorState message={ov.error} onRetry={ov.reload} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              {stats.map((s) => (
                <Link key={s.label} href={s.href} className={cn('rounded-(--radius-card) border bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-300', s.alert ? 'border-red-200' : 'border-(--color-line)')}>
                  <p className="text-xs font-medium text-(--color-text-muted)">{s.label}</p>
                  <p className={cn('money mt-1 text-2xl font-bold', s.alert ? 'text-(--color-expense)' : 'text-heading')}>{s.value}</p>
                  <p className="mt-0.5 text-xs text-(--color-text-muted)">{s.sub}</p>
                </Link>
              ))}
            </div>

            <Card className="overflow-hidden">
              <CardHeader title="Diqqat talab qiladi" description="Kechikkan yetkazish, muddati o'tgan to'lov, qaytarilgan qabul" />
              {!o || o.attention.length === 0 ? (
                <EmptyState title="Hammasi joyida" description="Hozircha e'tibor talab qiladigan xarid yo'q" />
              ) : (
                <ul className="divide-y divide-(--color-line)">
                  {o.attention.map((a) => (
                    <li key={a.id}>
                      <Link href={`/xarid/xaridlar?open=${a.id}&filter=all`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 hover:bg-brand-50/50">
                        <span className="font-mono text-xs font-semibold">{a.number}</span>
                        <span className="text-sm font-medium">{a.supplierName}</span>
                        <span className="text-sm text-(--color-expense)">{a.reason}</span>
                        <span className="money ml-auto text-sm font-semibold">{formatTiyin(a.totalTiyin)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}