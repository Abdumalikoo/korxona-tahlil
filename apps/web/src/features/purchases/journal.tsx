'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Card } from '@/components/ui/card';
import { IconSearch } from '@/components/ui/icons';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { useAuth } from '@/lib/auth-context';
import { formatDate, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { purchasesApi, type PurchaseFilter } from './api';
import { KindBadge, PaidBar, StatusBadge } from './bits';
import { PurchaseDrawer } from './purchase-drawer';

const FILTERS: { key: PurchaseFilter; label: string }[] = [
  { key: 'active', label: 'Kutilmoqda' },
  { key: 'late', label: 'Kechikkan' },
  { key: 'unpaid', label: "To'lanmagan" },
  { key: 'delivered', label: 'Yetkazilgan' },
  { key: 'cancelled', label: 'Bekor' },
  { key: 'all', label: 'Hammasi' },
];

/** Xarid › Xaridlar: barcha birja va oddiy xaridlar, to'lov va yetkazish holati */
export function PurchaseJournal({ embedded = false }: { embedded?: boolean }) {
  const { canWrite, isAdmin } = useAuth();
  const params = useSearchParams();
  const [filter, setFilter] = useState<PurchaseFilter>((params.get('filter') as PurchaseFilter) || 'active');
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [openId, setOpenId] = useState<string | null>(params.get('open'));

  useEffect(() => {
    const o = params.get('open');
    if (o) setOpenId(o);
    const f = params.get('filter');
    if (f) setFilter(f as PurchaseFilter);
  }, [params]);

  useEffect(() => {
    const t = window.setTimeout(() => setTerm(search.trim()), 250);
    return () => window.clearTimeout(t);
  }, [search]);

  const list = useAsync(() => purchasesApi.list(filter, term, kind), [filter, term, kind]);
  const rows = list.data?.data ?? [];
  const total = rows.reduce((a, p) => a + BigInt(p.totalTiyin), 0n);
  const debt = rows.reduce((a, p) => a + BigInt(p.debtTiyin), 0n);

  return (
    <>
      {!embedded && <PageHeader
        title="Xaridlar"
        description="Birja va oddiy xaridlar: to'lov va yetkazish holati"
        actions={
          !isAdmin && canWrite('/xarid') && (
            <div className="flex gap-2">
              <Link href="/xarid/birja" className="inline-flex h-9 items-center rounded-(--radius-control) bg-brand-600 px-3.5 text-sm font-medium text-white hover:bg-brand-700">Birja xaridi</Link>
              <Link href="/xarid/oddiy" className="inline-flex h-9 items-center rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3.5 text-sm hover:border-brand-300 hover:bg-brand-50">Oddiy xarid</Link>
            </div>
          )
        }
      />}

      <div className={embedded ? 'space-y-4' : 'space-y-4 p-4 md:p-6'}>
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)} className={cn('rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors', filter === f.key ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-line-strong) bg-white hover:border-brand-300 hover:bg-brand-50')}>
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2.5 text-sm">
              <option value="">Birja va oddiy</option>
              <option value="EXCHANGE">Faqat birja</option>
              <option value="DIRECT">Faqat oddiy</option>
            </select>
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-(--color-text-faint)" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Yetkazuvchi, lot, raqam" className="h-9 w-56 rounded-(--radius-control) border border-(--color-line-strong) bg-white pl-8 pr-3 text-sm outline-none focus:border-brand-600" />
            </div>
          </div>
        </div>

        <Card className="overflow-hidden">
          {list.loading && !list.data ? (
            <TableSkeleton rows={6} cols={6} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.reload} />
          ) : rows.length === 0 ? (
            <EmptyState title="Xarid topilmadi" description={filter === 'active' ? "«Birja xaridi» yoki «Oddiy xarid» bilan yangisini yozing" : undefined} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[56rem] text-sm">
                  <thead className="bg-(--color-surface-muted) text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Xarid</th>
                      <th className="px-4 py-2.5 text-left">Yetkazuvchi</th>
                      <th className="px-4 py-2.5 text-right">Summa</th>
                      <th className="w-40 px-4 py-2.5 text-left">To&apos;lov</th>
                      <th className="px-4 py-2.5 text-left">Tovar muddati</th>
                      <th className="px-4 py-2.5 text-left">Holat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {rows.map((p) => (
                      <tr key={p.id} onClick={() => setOpenId(p.id)} className="cursor-pointer hover:bg-brand-50/50">
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs font-semibold">{p.number}</p>
                          <p className="text-xs text-(--color-text-muted)">{formatDate(p.date)}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium">{p.supplierName}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-(--color-text-muted)"><KindBadge kind={p.kind} />{p.kind === 'EXCHANGE' && p.lotNo ? `lot ${p.lotNo}` : p.documentNo}</p>
                        </td>
                        <td className="money px-4 py-3 text-right font-semibold">{formatTiyin(p.totalTiyin)}</td>
                        <td className="px-4 py-3">
                          <PaidBar paid={p.paidTiyin} total={p.totalTiyin} />
                          <p className={cn('mt-1 text-xs', p.paymentLate ? 'font-semibold text-(--color-expense)' : 'text-(--color-text-muted)')}>
                            {BigInt(p.debtTiyin) > 0n ? `qarz ${formatTiyin(p.debtTiyin)}` : "to'langan"}
                          </p>
                        </td>
                        <td className={cn('px-4 py-3 text-sm', p.deliveryLate ? 'font-semibold text-(--color-expense)' : 'text-(--color-text-muted)')}>{p.deliveryDue ? formatDate(p.deliveryDue) : '—'}</td>
                        <td className="px-4 py-3"><StatusBadge purchase={p} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-(--color-line) bg-(--color-surface-muted) px-4 py-2.5 text-sm">
                <span className="text-(--color-text-muted)">{rows.length} ta xarid</span>
                <span>Jami: <b className="money">{formatTiyin(total)}</b> so&apos;m</span>
                {debt > 0n && <span>Qarz: <b className="money text-(--color-expense)">{formatTiyin(debt)}</b> so&apos;m</span>}
              </div>
            </>
          )}
        </Card>
      </div>

      <PurchaseDrawer id={openId} onClose={() => setOpenId(null)} onChanged={list.reload} />
    </>
  );
}