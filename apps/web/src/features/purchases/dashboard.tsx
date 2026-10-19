'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { RoleTabs } from '@/features/roles/role-tabs';
import { formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useBrief } from '@/lib/view-mode';
import { REQUEST_LABELS, purchasesApi, type RequestStatus } from './api';
import { PurchaseJournal } from './journal';

function Tile({ label, value, hint, tone, href }: { label: string; value: string; hint?: string; tone?: 'expense' | 'warn' | 'ok'; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-semibold text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-1.5 text-[26px] font-bold leading-tight', tone === 'expense' ? 'text-(--color-expense)' : tone === 'warn' ? 'text-amber-600' : tone === 'ok' ? 'text-(--color-income)' : 'text-heading')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-(--color-text-muted)">{hint}</p>}
    </>
  );
  const cls = 'block rounded-(--radius-card) border border-transparent bg-white p-4 shadow-card';
  return href ? <Link href={href} className={cn(cls, 'transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md')}>{body}</Link> : <div className={cls}>{body}</div>;
}

const mln = (tiyin: string) => `${(Number(tiyin) / 100 / 1_000_000).toFixed(1).replace('.0', '')} mln`;

/** Umumiy hudud › Xarid dashbordi: xaridchi kiritganlarining umumiy tahlili; xatoni shu yerda tuzatish mumkin (kiritish — xaridchida) */
export function XaridDashboard() {
  /** Qisqa rejim (Dashbord): grafik ko'rsatilmaydi */
  const brief = useBrief();
  const ov = useAsync(() => purchasesApi.overview(), []);
  const o = ov.data?.data;

  if (ov.loading && !o) return <LoadingState />;
  if (ov.error || !o) return <ErrorState message={ov.error ?? 'Ma‘lumot yo‘q'} onRetry={ov.reload} />;

  const cur = BigInt(o.month.totalTiyin);
  const prev = BigInt(o.month.previousTiyin);
  const change = prev > 0n ? Number(((cur - prev) * 1000n) / prev) / 10 : null;
  const max = Math.max(1, ...o.trend.map((t) => Number(t.totalTiyin)));
  const topMax = Math.max(1, ...o.topSuppliers.map((s) => Number(s.totalTiyin)));
  const feePct = cur > 0n ? Number((BigInt(o.month.exchangeTiyin) * 1000n) / cur) / 10 : 0;

  return (
    <>
      <PageHeader title="Xarid" description="Xaridchi kiritganlari: birja va oddiy xaridlar, qarz, yetkazish. Xatoni quyidagi jadvaldan tuzatasiz" />
      <div className="space-y-6 p-4 md:p-6">
        <RoleTabs />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label={`Xarid — ${formatPeriod(o.trend[5]?.month ?? '')}`} value={formatTiyin(o.month.totalTiyin)} hint={`${o.month.count} ta xarid${change !== null ? ` · o'tgan oyga nisbatan ${change > 0 ? '+' : ''}${change}%` : ''}`} />
          <Tile label="Qarz (to'lanmagan)" tone={o.latePayment > 0 ? 'expense' : undefined} value={formatTiyin(o.debtTiyin)} hint={o.latePayment > 0 ? `${o.latePayment} tasining to'lov muddati o'tgan` : "Yetkazuvchilar oldidagi jami"} />
          <Tile label="Tovar kutilmoqda" tone={o.lateDelivery > 0 ? 'warn' : undefined} value={`${o.open.count} ta`} hint={`${formatTiyin(o.open.totalTiyin)} so'm${o.lateDelivery ? ` · ${o.lateDelivery} tasi kechikkan` : ''}`} />
          <Tile label="Omborchi qabuli kutilmoqda" tone={o.pendingReceipts > 0 ? 'warn' : 'ok'} value={`${o.pendingReceipts} ta`} hint={o.pendingReceipts > 0 ? 'Omborchi hali tasdiqlamagan' : 'Hammasi tasdiqlangan'} />
        </div>

        <div className={cn('grid gap-5', !brief && 'xl:grid-cols-3')}>
          {!brief && (
          <Card className="xl:col-span-2">
            <CardHeader title="Oxirgi 6 oy" description="Xarid summasi: birja va oddiy (mln so'm)" />
            <div className="p-5">
              <div className="flex h-44 items-end gap-3">
                {o.trend.map((t) => {
                  const ex = (Number(t.exchangeTiyin) / max) * 100;
                  const di = (Number(t.directTiyin) / max) * 100;
                  return (
                    <div key={t.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                      <span className="money text-[11px] font-semibold text-heading">{Number(t.totalTiyin) > 0 ? mln(t.totalTiyin) : '—'}</span>
                      <div className="flex w-full max-w-14 flex-1 flex-col justify-end overflow-hidden rounded-t-md" title={`${formatPeriod(t.month)}: ${t.count} ta xarid`}>
                        <div className="bg-slate-400" style={{ height: `${di}%` }} />
                        <div className="bg-brand-600" style={{ height: `${ex}%` }} />
                      </div>
                      <span className="text-[11px] text-(--color-text-muted)">{t.month.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-(--color-text-muted)">
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-brand-600" />Birja — shu oy {formatTiyin(o.month.exchangeTiyin)} ({feePct}%)</span>
                <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-slate-400" />Oddiy xarid — shu oy {formatTiyin(o.month.directTiyin)}</span>
                {BigInt(o.month.feeTiyin) > 0n && <span>Birja yig&apos;imi: <b className="money text-heading">{formatTiyin(o.month.feeTiyin)}</b></span>}
              </div>
            </div>
          </Card>
          )}

          <Card className="overflow-hidden">
            <CardHeader title="Yetkazuvchilar" description="Eng ko'p xarid qilinganlar" />
            {o.topSuppliers.length === 0 ? (
              <EmptyState title="Hali xarid yo'q" />
            ) : (
              <ul className="space-y-3 p-5">
                {o.topSuppliers.map((s) => (
                  <li key={s.name}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium text-heading">{s.name}</span>
                      <span className="money shrink-0 font-semibold">{formatTiyin(s.totalTiyin)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-(--color-surface-sunken)"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(Number(s.totalTiyin) / topMax) * 100}%` }} /></div>
                    <p className="mt-0.5 text-[11px] text-(--color-text-muted)">{s.count} ta xarid</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader title="Diqqat" description="Kechikkan yetkazish, muddati o'tgan to'lov, qabul kutayotganlar" />
            {o.attention.length === 0 ? (
              <div className="flex items-center gap-3 px-5 py-6 text-sm">
                <span className="flex size-9 items-center justify-center rounded-full bg-(--color-income-soft) text-lg text-(--color-income)">✓</span>
                <span className="font-medium text-heading">Hammasi joyida</span>
              </div>
            ) : (
              <ul className="divide-y divide-(--color-line)">
                {o.attention.map((a) => (
                  <li key={a.id}>
                    <Link href={`/dashbord/xarid?open=${a.id}&filter=all`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-5 py-2.5 hover:bg-brand-50/60">
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

          <Card className="overflow-hidden">
            <CardHeader title="Arizalar" description="Bo'limlardan kelgan so'rovlar holati" />
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
              {(['NEW', 'IN_PROGRESS', 'DONE', 'REJECTED'] as RequestStatus[]).map((k) => (
                <div key={k} className="rounded-xl bg-(--color-surface-muted) px-3 py-3 text-center">
                  <p className={cn('money text-2xl font-bold', k === 'NEW' && o.requestStatus[k] > 0 ? 'text-amber-600' : 'text-heading')}>{o.requestStatus[k] ?? 0}</p>
                  <p className="text-[11px] text-(--color-text-muted)">{REQUEST_LABELS[k]}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <section>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-lg font-bold text-heading">Xaridlar</h2>
            <p className="text-xs text-(--color-text-muted)">Qatorni bosing: to&apos;lov qo&apos;shish, muddatni tuzatish yoki bekor qilish</p>
          </div>
          <PurchaseJournal embedded />
        </section>
      </div>
    </>
  );
}