'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { IconEdit } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { rolesApi, type RoleActivity } from '@/features/roles/api';
import { RenameRoleDialog } from '@/features/roles/rename-dialog';
import { RoleTabs } from '@/features/roles/role-tabs';
import { KIND_LABELS, KINDS, vehiclesApi } from '@/features/vehicles/api';
import { purchasesApi } from '@/features/purchases/api';
import { cashApi, dmy } from '@/features/cashbook/api';
import { th } from '@/features/cashbook/desk';
import { rdApi } from '@/features/regional-desk/api';
import { qtyText, warehouseApi } from '@/features/warehouse/api';
import { ROLE_ENTRY, useAuth } from '@/lib/auth-context';
import { formatDate, formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Rollar › [rol] — rolning katta umumiy dashbordi (umumiy hudud):
//   • nomi (administrator qo'ygan, shu yerda o'zgartiriladi), bo'limlari, xodimlari;
//   • bugun va 7 kunda nima kiritildi, Xarajatlarga ta'siri; «Diqqat» — nimaga e'tibor berish kerak;
//   • Ombor, Mashinalar, Pochta, Inventarizatsiya — asosiy raqamlar va batafsil dashbordga havola;
//   • harakatlar lentasi: kim, qachon, nima kiritdi.
// Kiritish bu yerda yo'q — rol o'z bo'limida kiritadi.
// ═══════════════════════════════════════════════════════════

const TYPE: Record<RoleActivity['type'], { label: string; dot: string; chip: string }> = {
  STOCK: { label: 'Ombor', dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-700' },
  VEHICLE: { label: 'Mashina', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700' },
  POSTAL: { label: 'Pochta', dot: 'bg-violet-500', chip: 'bg-violet-50 text-violet-700' },
  PURCHASE: { label: 'Xarid', dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700' },
  CASH: { label: 'Kunlik tushum', dot: 'bg-sky-500', chip: 'bg-sky-50 text-sky-700' },
};

function Tile({ label, value, hint, tone, href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'expense' | 'brand' | 'warn' | 'ok'; href?: string }) {
  const body = (
    <>
      <p className="text-xs font-semibold text-(--color-text-muted)">{label}</p>
      <p
        className={cn(
          'money mt-1.5 text-[26px] font-bold leading-tight',
          tone === 'expense' ? 'text-(--color-expense)' : tone === 'brand' ? 'text-brand-700' : tone === 'warn' ? 'text-amber-600' : tone === 'ok' ? 'text-(--color-income)' : 'text-heading',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-(--color-text-muted)">{hint}</p>}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-(--radius-card) border border-transparent bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md">
      {body}
    </Link>
  ) : (
    <Card className="p-4">{body}</Card>
  );
}

function SectionTitle({ title, hint, href, link }: { title: string; hint?: string; href?: string; link?: string }) {
  return (
    <div className="mb-2 mt-1 flex flex-wrap items-baseline justify-between gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-lg font-bold text-heading">{title}</h2>
        {hint && <p className="text-xs text-(--color-text-muted)">{hint}</p>}
      </div>
      {href && (
        <Link href={href} className="text-sm font-semibold text-brand-700 hover:underline">
          {link ?? 'Batafsil'} →
        </Link>
      )}
    </div>
  );
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
  const day = new Date(d.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
  return day === today ? time : `${formatDate(day)} ${time}`;
}

export default function RoleDashboardPage() {
  const params = useParams<{ role: string }>();
  const slug = String(params?.role ?? '');
  const { isAdmin, enterRole } = useAuth();
  const router = useRouter();
  const { range } = usePeriod();
  const month = range.to.slice(0, 7);
  const [renaming, setRenaming] = useState(false);

  const overview = useAsync(() => rolesApi.overview(slug), [slug]);
  const data = overview.data?.data ?? null;
  const sections = data?.role.sections ?? [];
  const hasWarehouse = sections.includes('Ombor');
  const hasVehicles = sections.includes('Mashinalar');
  const hasPurchases = sections.includes('Xarid');
  const pur = useAsync(() => (hasPurchases ? purchasesApi.overview() : Promise.resolve(null)), [hasPurchases]);
  const hasCash = sections.includes('Buxgalteriya');
  const cash = useAsync(() => (hasCash ? cashApi.overview() : Promise.resolve(null)), [hasCash]);
  const hasRegions = sections.includes('Hududlar');
  const rd = useAsync(() => (hasRegions ? rdApi.overview(new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 7)) : Promise.resolve(null)), [hasRegions]);

  const wh = useAsync(() => (hasWarehouse ? warehouseApi.overview(range.from, range.to) : Promise.resolve(null)), [hasWarehouse, range.from, range.to]);
  const postal = useAsync(() => (hasWarehouse ? warehouseApi.postal(range.from, range.to) : Promise.resolve(null)), [hasWarehouse, range.from, range.to]);
  const counts = useAsync(() => (hasWarehouse ? warehouseApi.counts() : Promise.resolve(null)), [hasWarehouse]);
  const cars = useAsync(() => (hasVehicles ? vehiclesApi.list(month) : Promise.resolve(null)), [hasVehicles, month]);
  const carSum = useAsync(() => (hasVehicles ? vehiclesApi.summary(month, month) : Promise.resolve(null)), [hasVehicles, month]);

  if (overview.loading && !data) return <LoadingState />;
  if (overview.error || !data) return <ErrorState message={overview.error ?? 'Rol topilmadi'} onRetry={overview.reload} />;

  const role = data.role;
  const o = wh.data?.data ?? null;
  const post = postal.data?.data ?? null;
  const lastCount = (counts.data?.data ?? [])[0] ?? null;
  const po = pur.data?.data ?? null;
  const carList = cars.data?.data ?? null;
  const sumRows = new Map((carSum.data?.data.vehicles ?? []).map((r) => [r.vehicleId, r]));
  const activeCars = (carList?.items ?? []).filter((v) => v.isActive);
  const overNorm = activeCars.filter((v) => {
    const r = sumRows.get(v.id);
    return r?.consumptionPer100 != null && v.fuelNorm != null && r.consumptionPer100 > v.fuelNorm * 1.05;
  });

  // ── Diqqat: nimaga e'tibor berish kerak ──
  const alerts: { tone: 'red' | 'amber' | 'blue'; text: ReactNode; href?: string }[] = [];
  if (data.users.length === 0) alerts.push({ tone: 'red', text: `Bu rolda xodim yo'q — ${role.label} qo'shing (ID kod va PIN)`, href: '/sozlamalar/foydalanuvchilar' });
  for (const u of data.users.filter((x) => x.locked)) alerts.push({ tone: 'red', text: `${u.fullName}: xato PIN tufayli vaqtincha yopilgan`, href: '/sozlamalar/foydalanuvchilar' });
  for (const u of data.users.filter((x) => x.isActive && !x.lastLoginAt)) alerts.push({ tone: 'amber', text: `${u.fullName} hali bir marta ham kirmagan`, href: '/sozlamalar/foydalanuvchilar' });
  if (o && o.lowItems.length > 0)
    alerts.push({ tone: 'amber', text: `Omborda ${o.lowItems.length} ta buyum kam qolgan: ${o.lowItems.slice(0, 3).map((i) => i.name).join(', ')}${o.lowItems.length > 3 ? '…' : ''}`, href: '/dashbord/ombor' });
  if (overNorm.length > 0)
    alerts.push({ tone: 'red', text: `${overNorm.length} ta mashina yoqilg'i me'yoridan oshgan: ${overNorm.slice(0, 3).map((v) => v.plateNumber).join(', ')}`, href: '/dashbord/mashinalar' });
  if (lastCount && lastCount.status === 'DRAFT') alerts.push({ tone: 'amber', text: `Inventarizatsiya ${lastCount.number} tugallanmagan (${lastCount.counted} / ${lastCount.lines})`, href: '/dashbord/ombor' });
  if (lastCount && lastCount.status === 'DONE' && (lastCount.shortages ?? 0) > 0)
    alerts.push({ tone: 'red', text: `Oxirgi inventarizatsiyada ${lastCount.shortages} ta kamomad (${lastCount.number})`, href: '/dashbord/ombor' });
  if (po && po.lateDelivery > 0) alerts.push({ tone: 'red', text: `${po.lateDelivery} ta xaridning yetkazish muddati o'tgan`, href: '/dashbord/xarid' });
  if (po && po.latePayment > 0) alerts.push({ tone: 'red', text: `${po.latePayment} ta xaridning to'lov muddati o'tgan`, href: '/dashbord/xarid' });
  if (po && po.pendingReceipts > 0) alerts.push({ tone: 'amber', text: `${po.pendingReceipts} ta qabul omborchi tasdig'ini kutmoqda`, href: '/dashbord/xarid' });
  const co = cash.data?.data ?? null;
  if (co && !co.todaySaved) alerts.push({ tone: 'amber', text: 'Bugungi kunlik tushum hali kiritilmagan', href: '/dashbord/buxgalteriya' });
  if (co && co.missing.filter((m) => m !== co.today).length > 0) alerts.push({ tone: 'red', text: `Shu oyda ${co.missing.filter((m) => m !== co.today).length} ta ish kuni kiritilmagan: ${co.missing.filter((m) => m !== co.today).slice(0, 4).map((m) => dmy(m).slice(0, 5)).join(', ')}`, href: '/dashbord/buxgalteriya' });
  const ro = rd.data?.data ?? null;
  if (ro && ro.current.incomeRows === 0) alerts.push({ tone: 'amber', text: `${ro.periodLabel}: hududlar daromadi hali yuklanmagan`, href: '/dashbord/hudud' });
  if (ro && !ro.current.payrollUploaded) alerts.push({ tone: 'amber', text: `${ro.periodLabel}: hudud xodimlari ish haqi vedomosti yuklanmagan`, href: '/dashbord/hudud' });
  if (po && po.requests > 0) alerts.push({ tone: 'blue', text: `${po.requests} ta ochiq ariza bor`, href: '/dashbord/xarid' });
  if (data.users.length > 0 && data.today.stockDocs + data.today.vehicleRecords + data.today.postal + data.today.purchases === 0)
    alerts.push({ tone: 'blue', text: 'Bugun hali hech narsa kiritilmagan' });

  const activeUsers = data.users.filter((u) => u.isActive).length;

  return (
    <>
      <PageHeader
        title={role.label}
        description={`Rol dashbordi · ${role.sections.join(', ')} · ${activeUsers} ta xodim`}
        actions={
          isAdmin ? (
            <div className="flex flex-wrap gap-2">
              {Boolean(ROLE_ENTRY[role.value]) && (
                <Button
                  onClick={() => {
                    const home = enterRole(role.value);
                    if (home) router.push(home);
                  }}
                  title="ID kod va PIN'siz shu rolning ish ekraniga kirish"
                >
                  {role.label} sifatida kirish
                </Button>
              )}
              <Button variant="secondary" onClick={() => setRenaming(true)}>
                <IconEdit className="size-4" />
                Nomini o&apos;zgartirish
              </Button>
            </div>
          ) : undefined
        }
      />

      <div className="space-y-6 p-4 md:p-6">
        <RoleTabs />
        {/* ── Bugun · Xodimlar · Diqqat ── */}
        <div className="grid gap-5 xl:grid-cols-3">
          {hasRegions ? (
            <Card className="overflow-hidden bg-gradient-to-br from-emerald-600 to-brand-800 text-white">
              <div className="p-5">
                <p className="text-sm font-semibold text-white/80">Hududlar daromadi{ro ? ` · ${ro.periodLabel}` : ''}</p>
                <p className="money mt-1 text-[34px] font-bold leading-tight">{ro ? formatTiyin(ro.current.incomeTiyin) : '—'}</p>
                <p className="text-xs text-white/75">so&apos;m — xizmatlar hisobotidan</p>
                <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-white/12 px-2 py-2 ring-1 ring-white/20">
                    <p className="money text-lg font-bold">{ro ? formatTiyin(ro.current.payrollTiyin) : '—'}</p>
                    <p className="text-[11px] text-white/80">Ish haqi</p>
                  </div>
                  <div className="rounded-xl bg-white/12 px-2 py-2 ring-1 ring-white/20">
                    <p className="money text-lg font-bold">{ro ? formatTiyin(ro.current.otherTiyin) : '—'}</p>
                    <p className="text-[11px] text-white/80">Boshqa xarajat</p>
                  </div>
                </div>
                <Link href="/dashbord/hudud" className="mt-3 inline-block text-xs font-semibold text-white underline">
                  Hududlar dashbordi →
                </Link>
              </div>
            </Card>
          ) : hasCash ? (
            <Card className="overflow-hidden bg-gradient-to-br from-sky-600 to-brand-800 text-white">
              <div className="p-5">
                <p className="text-sm font-semibold text-white/80">Kunlik tushum{co?.latest ? ` · ${dmy(co.latest.date)}` : ''}</p>
                <p className="money mt-1 text-[34px] font-bold leading-tight">{th(co?.latest?.daily)}</p>
                <p className="text-xs text-white/75">ming so&apos;m — jami hisobraqamlar bo&apos;yicha</p>
                <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-xl bg-white/12 px-2 py-2 ring-1 ring-white/20">
                    <p className="text-2xl font-bold">{co ? (co.todaySaved ? '✓' : '—') : '…'}</p>
                    <p className="text-[11px] text-white/80">Bugun saqlandi</p>
                  </div>
                  <div className="rounded-xl bg-white/12 px-2 py-2 ring-1 ring-white/20">
                    <p className="text-2xl font-bold">{data.week.cashReports ?? 0}</p>
                    <p className="text-[11px] text-white/80">7 kunda saqlangan</p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-white/80">
                  Oy boshidan: <b className="money text-white">{th(co?.latest?.mtdAfter)}</b> · yil boshidan: <b className="money text-white">{th(co?.latest?.ytdAfter)}</b> ming so&apos;m
                </p>
              </div>
            </Card>
          ) : (
          <Card className="overflow-hidden bg-gradient-to-br from-brand-600 to-brand-800 text-white">
            <div className="p-5">
              <p className="text-sm font-semibold text-white/80">Bugun kiritildi</p>
              <p className="money mt-1 text-[34px] font-bold leading-tight">{formatTiyin(hasPurchases ? data.today.purchaseTiyin : data.today.amountTiyin)}</p>
              <p className="text-xs text-white/75">{hasPurchases ? "so'm — yozilgan xaridlar (omborchi qabul qilgach Xarajatlarga tushadi)" : "so'm — Xarajatlarga tushgan (kirim, mashina, pochta)"}</p>
              <div className={cn('mt-4 grid gap-2 text-center', hasPurchases ? 'grid-cols-1' : 'grid-cols-3')}>
                {(hasPurchases
                  ? [['Xarid', data.today.purchases]]
                  : [
                      ['Ombor hujjati', data.today.stockDocs],
                      ['Mashina', data.today.vehicleRecords],
                      ['Pochta', data.today.postal],
                    ]
                ).map(([label, n]) => (
                  <div key={label as string} className="rounded-xl bg-white/12 px-2 py-2 ring-1 ring-white/20">
                    <p className="text-2xl font-bold">{n}</p>
                    <p className="text-[11px] text-white/80">{label}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-white/80">
                {hasPurchases ? (
                  <>Oxirgi 7 kun: <b className="money text-white">{formatTiyin(data.week.purchaseTiyin)}</b> so&apos;m · {data.week.purchases} ta xarid</>
                ) : (
                  <>
                    Oxirgi 7 kun: <b className="money text-white">{formatTiyin(data.week.amountTiyin)}</b> so&apos;m · {data.week.stockDocs} hujjat · {data.week.vehicleRecords} mashina yozuvi · {data.week.postal} pochta
                  </>
                )}
              </p>
            </div>
          </Card>
          )}

          <Card className="overflow-hidden">
            <CardHeader
              title="Xodimlar"
              description={`${role.label} — ID kod va PIN bilan kiradi`}
              actions={
                isAdmin ? (
                  <Link href="/sozlamalar/foydalanuvchilar" className="text-xs font-semibold text-brand-700 hover:underline">
                    Boshqarish →
                  </Link>
                ) : undefined
              }
            />
            {data.users.length === 0 ? (
              <EmptyState title="Xodim yo'q" description="Sozlamalar › Foydalanuvchilar — «Yangi foydalanuvchi»" />
            ) : (
              <ul className="divide-y divide-(--color-line)">
                {data.users.map((u) => (
                  <li key={u.id} className={cn('flex items-center gap-3 px-5 py-2.5', !u.isActive && 'opacity-50')}>
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                      {u.fullName
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((x) => x.charAt(0))
                        .join('')}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-heading">{u.fullName}</span>
                      <span className="block text-xs text-(--color-text-muted)">
                        <span className="font-mono">{u.loginCode}</span> · {u.lastLoginAt ? `kirgan: ${formatDateTime(u.lastLoginAt)}` : 'hali kirmagan'}
                      </span>
                    </span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        !u.isActive ? 'bg-(--color-surface-sunken) text-(--color-text-muted)' : u.locked ? 'bg-(--color-expense-soft) text-(--color-expense)' : 'bg-(--color-income-soft) text-(--color-income)',
                      )}
                    >
                      {!u.isActive ? 'Bloklangan' : u.locked ? 'Yopilgan' : 'Faol'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="overflow-hidden">
            <CardHeader title="Diqqat" description="Nimaga e'tibor berish kerak" />
            {alerts.length === 0 ? (
              <div className="flex items-center gap-3 px-5 py-6 text-sm">
                <span className="flex size-9 items-center justify-center rounded-full bg-(--color-income-soft) text-lg text-(--color-income)">✓</span>
                <span className="font-medium text-heading">Hammasi joyida — muammo topilmadi</span>
              </div>
            ) : (
              <ul className="divide-y divide-(--color-line)">
                {alerts.map((a, i) => {
                  const dot = a.tone === 'red' ? 'bg-(--color-expense)' : a.tone === 'amber' ? 'bg-amber-500' : 'bg-blue-500';
                  const inner = (
                    <>
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', dot)} />
                      <span className="min-w-0 flex-1 text-sm text-heading">{a.text}</span>
                      {a.href && <span className="shrink-0 text-xs text-brand-700">→</span>}
                    </>
                  );
                  return (
                    <li key={i}>
                      {a.href ? (
                        <Link href={a.href} className="flex items-start gap-3 px-5 py-2.5 hover:bg-brand-50/60">
                          {inner}
                        </Link>
                      ) : (
                        <div className="flex items-start gap-3 px-5 py-2.5">{inner}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* ── Xarid ── */}
        {hasPurchases && (
          <section>
            <SectionTitle title="Xarid" hint="Shu oy" href="/dashbord/xarid" link="Xarid dashbordi" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Tile label="Oy xaridi" tone="brand" value={po ? formatTiyin(po.month.totalTiyin) : '…'} hint={po ? `${po.month.count} ta · birja ${formatTiyin(po.month.exchangeTiyin)}` : undefined} href="/dashbord/xarid" />
              <Tile label="Qarz" tone={po && po.latePayment > 0 ? 'expense' : undefined} value={po ? formatTiyin(po.debtTiyin) : '…'} hint="Yetkazuvchilar oldida" href="/dashbord/xarid" />
              <Tile label="Tovar kutilmoqda" tone={po && po.lateDelivery > 0 ? 'warn' : undefined} value={po ? `${po.open.count} ta` : '…'} hint={po ? `${po.lateDelivery} tasi kechikkan` : undefined} href="/dashbord/xarid" />
              <Tile label="Ochiq arizalar" value={po ? `${po.requests} ta` : '…'} hint={po ? `Omborchi kutmoqda: ${po.pendingReceipts}` : undefined} href="/dashbord/xarid" />
            </div>
          </section>
        )}

        {/* ── Ombor ── */}
        {hasWarehouse && (
          <section>
            <SectionTitle title="Ombor" hint={`Davr: ${formatDate(range.from)} — ${formatDate(range.to)}`} href="/dashbord/ombor" link="Ombor dashbordi" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Tile label="Davr kirimi" tone="expense" value={o ? formatTiyin(o.period.receiptsTiyin) : '…'} hint={o ? `${o.period.receipts} ta hujjat · Xarajatlarga yozilgan` : undefined} href="/dashbord/ombor" />
              <Tile label="Berilgan (chiqim)" tone="brand" value={o ? formatTiyin(o.period.issuesTiyin) : '…'} hint={o ? `${o.period.issues} ta hujjat` : undefined} href="/dashbord/ombor" />
              <Tile label="Ombordagi TMZ qiymati" value={o ? formatTiyin(o.tmzValueTiyin) : '…'} hint={o ? `${o.items} ta buyum · ${o.lowItems.length} tasi kam qolgan` : undefined} href="/dashbord/ombor" />
              <Tile
                label="Asosiy vositalar"
                value={o ? `${o.assetsTotal} ta` : '…'}
                hint={o ? `${o.assetsInUse} ta odamlarda, ${o.assetsInStock} ta omborda · ${formatTiyin(o.assetsValueTiyin)} so'm` : undefined}
                href="/dashbord/ombor"
              />
            </div>
            {o && o.lowItems.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {o.lowItems.slice(0, 8).map((i) => (
                  <span key={i.id} className="rounded-full border border-(--color-expense)/30 bg-(--color-expense-soft) px-3 py-1 text-xs text-(--color-expense)">
                    {i.name}: <b>{qtyText(i.inStock)}</b> / min {qtyText(i.minQty)} {i.unit}
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Mashinalar ── */}
        {hasVehicles && (
          <section>
            <SectionTitle title="Mashinalar" hint={formatPeriod(month)} href="/dashbord/mashinalar" link="Mashinalar dashbordi" />
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Tile label="Oy xarajati" tone="expense" value={carList ? formatTiyin(carList.totals.totalTiyin) : '…'} hint={carList ? `${carList.totals.count} ta yozuv` : undefined} href="/dashbord/mashinalar" />
              <Tile
                label="Yoqilg'i"
                value={carList ? formatTiyin(carList.totals.byKind.FUEL) : '…'}
                hint={carList ? `${carList.totals.liters} l / m³` : undefined}
                href="/dashbord/mashinalar"
              />
              <Tile label="Faol mashinalar" value={carList ? `${activeCars.length} ta` : '…'} hint={carList ? `${carList.items.length - activeCars.length} tasi faol emas` : undefined} href="/dashbord/mashinalar" />
              <Tile
                label="Me'yordan oshgan"
                tone={overNorm.length > 0 ? 'expense' : 'ok'}
                value={carList ? `${overNorm.length} ta` : '…'}
                hint={overNorm.length > 0 ? overNorm.map((v) => v.plateNumber).slice(0, 3).join(', ') : "Hammasi me'yorda"}
                href="/dashbord/mashinalar"
              />
            </div>
            {carList && (
              <div className="mt-3 flex flex-wrap gap-2">
                {KINDS.filter((k) => Number(carList.totals.byKind[k]) > 0).map((k) => (
                  <span key={k} className="rounded-full bg-white px-3 py-1 text-xs shadow-card">
                    {KIND_LABELS[k]}: <b className="money">{formatTiyin(carList.totals.byKind[k])}</b>
                  </span>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── Pochta va inventarizatsiya ── */}
        {hasWarehouse && (
          <section className="grid gap-4 sm:grid-cols-2">
            <Tile
              label="Pochta to'lovlari (davr)"
              tone="expense"
              value={post ? formatTiyin(post.totalTiyin) : '…'}
              hint={post ? (post.byCompany.length ? post.byCompany.map((c) => `${c.company}: ${formatTiyin(c.totalTiyin)}`).join(' · ') : "To'lov yo'q") : undefined}
              href="/dashbord/ombor"
            />
            <Tile
              label="Inventarizatsiya"
              tone={!lastCount ? undefined : lastCount.status === 'DRAFT' ? 'warn' : (lastCount.shortages ?? 0) > 0 ? 'expense' : 'ok'}
              value={!lastCount ? "O'tkazilmagan" : lastCount.status === 'DRAFT' ? 'Sanalmoqda' : (lastCount.shortages ?? 0) > 0 ? `${lastCount.shortages} ta kamomad` : 'Kamomad yo‘q'}
              hint={lastCount ? `${lastCount.number} · ${formatDate(lastCount.date)}` : 'Sanoqni rol o‘tkazadi'}
              href="/dashbord/ombor"
            />
          </section>
        )}

        {/* ── Harakatlar lentasi ── */}
        <Card className="overflow-hidden">
          <CardHeader title="Oxirgi harakatlar" description="7 kun: kim, qachon, nima kiritdi. Bekor qilinganlari chizilgan." />
          {data.activity.length === 0 ? (
            <EmptyState title="Oxirgi 7 kunda harakat yo'q" />
          ) : (
            <ul className="divide-y divide-(--color-line)">
              {data.activity.map((a) => (
                <li key={`${a.type}-${a.id}`} className={cn('flex items-center gap-3 px-5 py-2.5', a.cancelled && 'opacity-50')}>
                  <span className="w-24 shrink-0 text-xs tabular-nums text-(--color-text-faint)">{timeOf(a.at)}</span>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', TYPE[a.type].chip)}>{TYPE[a.type].label}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm font-medium text-heading', a.cancelled && 'line-through')}>{a.title}</span>
                    <span className="block truncate text-xs text-(--color-text-muted)">{[a.subtitle, a.by].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className={cn('money shrink-0 text-sm font-semibold text-heading', a.cancelled && 'line-through')}>{formatTiyin(a.amountTiyin)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <RenameRoleDialog role={renaming ? role : null} onClose={() => setRenaming(false)} onDone={() => overview.reload()} />
    </>
  );
}