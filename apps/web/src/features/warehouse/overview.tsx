'use client';

import { PageHeader } from '@/components/layout/page-header';
import { SourceActions } from '@/components/shared/source-actions';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { DOC_KIND_HINTS, qtyText, warehouseApi } from '@/features/warehouse/api';
import { RoleTabs } from '@/features/roles/role-tabs';
import { DocKindBadge } from '@/features/warehouse/bits';
import { WarehouseDemoPanel } from '@/features/warehouse/demo-panel';
import { DocButtons } from '@/features/warehouse/doc-buttons';
import { useWarehouseDialogs } from '@/features/warehouse/use-dialogs';
import { formatDate, formatTiyin } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Ombor bir qarashda: qoldiq qiymati, asosiy vositalar, davr kirimi (= Xarajatlarga yozilgan) va chiqimi,
// kam qolgan buyumlar, «Kimda nima bor» (bo'lim / hudud), oxirgi hujjatlar.
//
// Ikki joyda ishlatiladi:
//   • Omborchi bo'limi (/ombor) — kiritish tugmalari va batafsil sahifalarga havolalar bilan;
//   • umumiy hudud dashbordi (/dashbord/ombor, dashboard) — kiritish yo'q; qo'shimcha: pochta va
//     inventarizatsiya; hujjatni ochib xatoni tuzatish (bekor qilish) mumkin; demo shu yerda.
// ═══════════════════════════════════════════════════════════

function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'income' | 'expense' | 'brand' }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-semibold text-(--color-text-muted)">{label}</p>
      <p
        className={cn(
          'money mt-1 text-2xl font-bold',
          tone === 'income' ? 'text-(--color-income)' : tone === 'expense' ? 'text-(--color-expense)' : tone === 'brand' ? 'text-brand-700' : 'text-heading',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-(--color-text-muted)">{hint}</p>}
    </Card>
  );
}

/** «Kimda nima bor» sahifasi — shu bo'lim / hudud tanlangan holda */
function placeHref(key: string): string {
  if (key.startsWith('d:')) return `/ombor/kimda?departmentId=${encodeURIComponent(key.slice(2))}`;
  if (key.startsWith('r:')) return `/ombor/kimda?regionCode=${encodeURIComponent(key.slice(2))}`;
  if (key === 'center') return '/ombor/kimda?regionCode=0';
  return '/ombor/asosiy-vositalar?status=IN_USE';
}

export function WarehouseOverview({ dashboard = false }: { dashboard?: boolean }) {
  const { range } = usePeriod();
  const overview = useAsync(() => warehouseApi.overview(range.from, range.to), [range.from, range.to]);
  const recent = useAsync(() => warehouseApi.docs({ from: range.from, to: range.to }), [range.from, range.to]);
  const postal = useAsync(
    () => (dashboard ? warehouseApi.postal(range.from, range.to) : Promise.resolve(null)),
    [dashboard, range.from, range.to],
  );
  const counts = useAsync(() => (dashboard ? warehouseApi.counts() : Promise.resolve(null)), [dashboard]);
  /** Elektron imzolar (QR): imzolangan va kutilayotganlar */
  const signs = useAsync(() => warehouseApi.signs(), []);
  const reload = () => {
    overview.reload();
    recent.reload();
    postal.reload();
    counts.reload();
  };
  const w = useWarehouseDialogs(reload);

  const o = overview.data?.data;
  const docs = (recent.data?.data ?? []).slice(0, dashboard ? 12 : 8);
  const post = postal.data?.data ?? null;
  const lastCount = (counts.data?.data ?? [])[0] ?? null;

  return (
    <>
      <PageHeader
        title="Ombor"
        description={dashboard ? "Dashbord · Omborchi kiritgan ma'lumot: qoldiq, harakat, kimda nima bor, pochta" : 'TMZ va asosiy vositalar: kirim, chiqim, kimda nima bor'}
      />

      <div className="space-y-5 p-6">
        {dashboard && <RoleTabs />}
        {dashboard ? (
          <WarehouseDemoPanel onChanged={reload} />
        ) : (
          <SourceActions add={{ label: w.keeper ? 'Qabul qilish' : 'Kirim', onClick: () => w.newDoc('RECEIPT'), hint: DOC_KIND_HINTS.RECEIPT }} extra={<DocButtons onNew={(k) => w.newDoc(k)} />} />
        )}

        <SignsStrip items={signs.data?.data ?? null} href={dashboard ? '/dashbord/ombor/imzolar' : '/ombor/imzolar'} />

        {overview.error ? (
          <ErrorState message={overview.error} onRetry={overview.reload} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Davr kirimi"
              tone="expense"
              value={o ? `${formatTiyin(o.period.receiptsTiyin)}` : '…'}
              hint={o ? <>{o.period.receipts} ta hujjat · Xarajatlarga yozilgan</> : undefined}
            />
            <Kpi label="Davr chiqimi (berilgan)" tone="brand" value={o ? formatTiyin(o.period.issuesTiyin) : '…'} hint={o ? `${o.period.issues} ta hujjat` : undefined} />
            <Kpi label="Ombordagi TMZ qiymati" value={o ? formatTiyin(o.tmzValueTiyin) : '…'} hint={o ? `${o.items} ta buyum ma'lumotnomada · bugungi holat` : undefined} />
            <Kpi
              label="Asosiy vositalar"
              value={o ? `${o.assetsTotal} ta` : '…'}
              hint={o ? `${o.assetsInUse} ta foydalanishda, ${o.assetsInStock} ta omborda · ${formatTiyin(o.assetsValueTiyin)} so'm` : undefined}
            />
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          {/* Kimda nima bor */}
          <Card className="overflow-hidden">
            <CardHeader title="Kimda nima bor" description="Bo'lim va hududlar bo'yicha: foydalanishdagi asosiy vositalar va berilgan TMZ (bugungi holat)" />
            {overview.loading && !o ? (
              <TableSkeleton rows={5} cols={4} />
            ) : !o || o.byPlace.length === 0 ? (
              <EmptyState title="Hali hech kimga hech narsa berilmagan" description="«Chiqim (berish)» hujjati bilan bo'lim yoki odamga bering — shu yerda ko'rinadi." />
            ) : (
              <Table>
                <THead>
                  <Tr>
                    <Th>Bo&apos;lim / hudud</Th>
                    <Th align="right">Asosiy vositalar</Th>
                    <Th align="right">Qiymati</Th>
                    <Th align="right">Berilgan TMZ</Th>
                  </Tr>
                </THead>
                <TBody>
                  {o.byPlace.map((p) => (
                    <Tr key={p.key}>
                      <Td>
                        {dashboard ? (
                          <span className="font-medium text-heading">{p.name}</span>
                        ) : (
                          <Link href={placeHref(p.key)} className="font-medium text-heading hover:text-brand-700 hover:underline">
                            {p.name}
                          </Link>
                        )}
                      </Td>
                      <Td align="right" money>
                        {p.assets}
                      </Td>
                      <Td align="right" money>
                        {formatTiyin(p.assetsValueTiyin)}
                      </Td>
                      <Td align="right" money>
                        {formatTiyin(p.tmzIssuedTiyin)}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>

          {/* Kam qolganlar */}
          <Card className="overflow-hidden">
            <CardHeader
              title="Kam qolgan buyumlar"
              description="Qoldiq minimaldan kam yoki teng"
              actions={
                dashboard ? undefined : (
                  <Link href="/ombor/qoldiq" className="text-xs font-semibold text-brand-700 hover:underline">
                    Qoldiq →
                  </Link>
                )
              }
            />
            {overview.loading && !o ? (
              <TableSkeleton rows={4} cols={2} />
            ) : !o || o.lowItems.length === 0 ? (
              <EmptyState title="Kam qolgan buyum yo'q" description="Buyumga «Minimal qoldiq» belgilansa, kamayganda shu yerda chiqadi." />
            ) : (
              <ul className="divide-y divide-(--color-line)">
                {o.lowItems.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="min-w-0 truncate font-medium text-heading">{i.name}</span>
                    <span className="money shrink-0">
                      <b className="text-(--color-expense)">{qtyText(i.inStock)}</b>
                      <span className="text-(--color-text-muted)">
                        {' '}
                        / min {qtyText(i.minQty)} {i.unit}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Dashbord: pochta va inventarizatsiya */}
        {dashboard && (
          <div className="grid gap-5 xl:grid-cols-2">
            <Card className="overflow-hidden">
              <CardHeader title="Pochta to'lovlari" description="Davr bo'yicha — Xarajatlarga «Ombor: pochta xizmatlari» bo'lib tushgan" />
              {postal.loading && !postal.data ? (
                <TableSkeleton rows={3} cols={2} />
              ) : !post || post.items.length === 0 ? (
                <EmptyState title="Bu davrda pochta to'lovi yo'q" hint="period" />
              ) : (
                <div className="px-5 py-4">
                  <p className="money text-2xl font-bold text-(--color-expense)">{formatTiyin(post.totalTiyin)}</p>
                  <p className="text-xs text-(--color-text-muted)">{post.items.length} ta to&apos;lov</p>
                  <ul className="mt-3 divide-y divide-(--color-line) text-sm">
                    {post.byCompany.map((c) => (
                      <li key={c.company} className="flex items-center justify-between gap-3 py-1.5">
                        <span className="min-w-0 truncate text-heading">{c.company}</span>
                        <span className="money shrink-0 text-(--color-text-muted)">
                          {c.count} ta · <b className="text-heading">{formatTiyin(c.totalTiyin)}</b>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            <Card className="overflow-hidden">
              <CardHeader title="Inventarizatsiya" description="Oxirgi sanoq natijasi" />
              {counts.loading && !counts.data ? (
                <TableSkeleton rows={3} cols={2} />
              ) : !lastCount ? (
                <EmptyState title="Inventarizatsiya hali o'tkazilmagan" description="Sanoqni Omborchi o'tkazadi — natija shu yerda chiqadi." />
              ) : (
                <div className="space-y-2 px-5 py-4 text-sm">
                  <p>
                    <span className="money font-semibold text-heading">{lastCount.number}</span>
                    <span className="text-(--color-text-muted)"> · {formatDate(lastCount.date)} · </span>
                    {lastCount.status === 'DONE' ? (
                      <span className="font-semibold text-(--color-income)">yakunlangan</span>
                    ) : (
                      <span className="font-semibold text-amber-700">
                        sanalmoqda ({lastCount.counted} / {lastCount.lines})
                      </span>
                    )}
                  </p>
                  {lastCount.status === 'DONE' && (
                    <div className="grid grid-cols-2 gap-3">
                      <div className={cn('rounded-(--radius-control) px-3 py-2', (lastCount.shortages ?? 0) > 0 ? 'bg-(--color-expense-soft)' : 'bg-(--color-surface-sunken)')}>
                        <p className="text-xs text-(--color-text-muted)">Kamomad</p>
                        <p className={cn('text-lg font-bold', (lastCount.shortages ?? 0) > 0 ? 'text-(--color-expense)' : 'text-heading')}>{lastCount.shortages ?? 0} ta</p>
                      </div>
                      <div className="rounded-(--radius-control) bg-(--color-surface-sunken) px-3 py-2">
                        <p className="text-xs text-(--color-text-muted)">Ortiqcha</p>
                        <p className="text-lg font-bold text-heading">{lastCount.surpluses ?? 0} ta</p>
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-(--color-text-muted)">Kamomad hisobdan chiqarildi, ortiqcha kirim qilindi — hujjatlari quyidagi ro&apos;yxatda.</p>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* Oxirgi hujjatlar */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Davrdagi oxirgi hujjatlar"
            description={dashboard ? "Bosing — hujjat ochiladi: dalolatnoma, xato bo'lsa bekor qilish" : undefined}
            actions={
              dashboard ? undefined : (
                <Link href="/ombor/hujjatlar" className="text-xs font-semibold text-brand-700 hover:underline">
                  Barcha hujjatlar →
                </Link>
              )
            }
          />
          {recent.loading && !recent.data ? (
            <TableSkeleton rows={5} cols={5} />
          ) : recent.error ? (
            <ErrorState message={recent.error} onRetry={recent.reload} />
          ) : docs.length === 0 ? (
            <EmptyState title="Bu davrda hujjat yo'q" hint="period" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th className="w-36">Raqam</Th>
                  <Th className="w-28">Sana</Th>
                  <Th className="w-40">Turi</Th>
                  <Th>Kimga / kimdan</Th>
                  <Th align="right">Summa</Th>
                </Tr>
              </THead>
              <TBody>
                {docs.map((d) => (
                  <Tr key={d.id} clickable onClick={() => w.openDoc(d.id)} className={d.cancelled ? 'opacity-50' : undefined}>
                    <Td className="money font-semibold text-brand-700">{d.number}</Td>
                    <Td>{formatDate(d.date)}</Td>
                    <Td>
                      <DocKindBadge kind={d.kind} />
                    </Td>
                    <Td className="text-(--color-text-muted)">
                      {d.kind === 'RECEIPT' ? (d.counterparty ?? '—') : d.kind === 'WRITE_OFF' ? d.reason : d.kind === 'RETURN' ? (d.from?.text ?? d.to.text) : d.to.text}
                    </Td>
                    <Td align="right" money className={cn(d.cancelled && 'line-through')}>
                      {formatTiyin(d.totalTiyin)}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      {w.element}
    </>
  );
}

/** Elektron imzolar qisqacha: nechta imzolangan, nechtasi xodim imzosini kutmoqda */
function SignsStrip({ items, href }: { items: { status: string; telegram: { employee?: string; archive?: string } | null }[] | null; href: string }) {
  if (!items) return null;
  const signed = items.filter((i) => i.status === 'SIGNED').length;
  const pending = items.length - signed;
  const tg = items.filter((i) => i.status === 'SIGNED' && i.telegram?.archive === 'yuborildi').length;
  return (
    <Link
      href={href}
      className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-(--color-line) bg-white px-4 py-2.5 text-sm shadow-card transition-colors hover:border-brand-200 hover:bg-brand-50/40"
    >
      <span className="font-semibold text-heading">Elektron imzolar (QR)</span>
      <span className="text-emerald-700">
        <b className="money">{signed}</b> ta imzolangan
      </span>
      <span className={cn(pending ? 'text-amber-700' : 'text-(--color-text-muted)')}>
        <b className="money">{pending}</b> ta imzo kutilmoqda
      </span>
      <span className="text-(--color-text-muted)">Telegram arxivida: {tg}</span>
      <span className="ml-auto text-xs font-semibold text-brand-700">Imzolangan dalolatnomalar →</span>
    </Link>
  );
}