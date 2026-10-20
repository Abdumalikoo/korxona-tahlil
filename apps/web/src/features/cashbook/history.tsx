'use client';

import { PageHeader } from '@/components/layout/page-header';
import { buttonClass } from '@/components/ui/button';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';
import { cashApi, dmy, downloadCashDay, weekday } from './api';
import { th } from './desk';

// ═══════════════════════════════════════════════════════════
// Buxgalteriya › Tarix: saqlangan kunlar (oy bo'yicha), ochish va Excel.
// `base` — kun sahifasi manzili (buxgalter: /buxgalteriya/kunlik, admin: /dashbord/buxgalteriya/kun).
// ═══════════════════════════════════════════════════════════

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

export function CashHistory({ base = '/buxgalteriya/kunlik', embedded = false }: { base?: string; embedded?: boolean }) {
  const thisMonth = todayInput().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const range = monthRange(month);
  const list = useAsync(() => cashApi.reports(range.from, range.to), [month]);
  const rows = list.data?.data ?? [];
  const [toast, setToast] = useState<string | null>(null);
  const sum = rows.reduce((s, r) => s + BigInt(r.daily ?? '0'), 0n);
  const regions = rows.reduce((s, r) => s + BigInt(r.regions ?? '0'), 0n);
  const label = `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

  const body = (
    <div className={cn('space-y-4', !embedded && 'p-4 md:p-6')}>
      <div className="flex flex-wrap items-center gap-3 rounded-(--radius-card) bg-white p-3 shadow-card">
        <button type="button" onClick={() => setMonth(shiftMonth(month, -1))} className="flex size-10 items-center justify-center rounded-xl text-xl hover:bg-brand-50" aria-label="Oldingi oy">
          ‹
        </button>
        <p className="min-w-36 text-center text-lg font-bold text-heading">{label}</p>
        <button type="button" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth} className="flex size-10 items-center justify-center rounded-xl text-xl hover:bg-brand-50 disabled:opacity-30" aria-label="Keyingi oy">
          ›
        </button>
        <div className="ml-auto flex flex-wrap gap-5 text-sm">
          <span>
            Kun: <b className="text-heading">{rows.length}</b>
          </span>
          <span>
            Oy bo&apos;yicha tushum: <b className="money text-heading">{rows.length ? th(sum.toString()) : '—'}</b>
          </span>
          <span>
            Hududlardan: <b className="money text-heading">{rows.length ? th(regions.toString()) : '—'}</b>
          </span>
        </div>
      </div>

      <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
        {list.loading && !list.data ? (
          <TableSkeleton rows={6} cols={7} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : rows.length === 0 ? (
          <EmptyState title={`${label}: saqlangan kun yo'q`} description="Kunlik tushum kiritilgach shu yerda ko'rinadi" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                  <th className="px-4 py-2.5">Sana</th>
                  <th className="px-3 py-2.5 text-right">Kunlik tushum</th>
                  <th className="px-3 py-2.5 text-right">Hududlardan</th>
                  <th className="px-3 py-2.5 text-right">Qaytarilgan</th>
                  <th className="px-3 py-2.5 text-right">Oy boshidan*</th>
                  <th className="px-3 py-2.5 text-right">Qoldiq*</th>
                  <th className="px-3 py-2.5">Kim saqladi</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {rows.map((r) => (
                  <tr key={r.date} className="hover:bg-brand-50/40">
                    <td className="px-4 py-2.5">
                      <Link href={`${base}?sana=${r.date}`} className="font-semibold text-brand-700 hover:underline">
                        {dmy(r.date)}
                      </Link>
                      <span className="ml-2 text-xs text-(--color-text-muted)">{weekday(r.date)}</span>
                    </td>
                    <td className="money px-3 py-2.5 text-right font-bold text-heading">{th(r.daily)}</td>
                    <td className="money px-3 py-2.5 text-right">{th(r.regions)}</td>
                    <td className="money px-3 py-2.5 text-right text-(--color-text-muted)">{th(r.refund)}</td>
                    <td className="money px-3 py-2.5 text-right">{th(r.mtdAfter)}</td>
                    <td className="money px-3 py-2.5 text-right">{th(r.balance)}</td>
                    <td className="px-3 py-2.5 text-xs text-(--color-text-muted)">
                      {r.savedBy ?? '—'}
                      <br />
                      {formatDateTime(r.updatedAt)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        <Link href={`${base}?sana=${r.date}`} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50">
                          Ochish
                        </Link>
                        <button type="button" onClick={() => void downloadCashDay(r.date).catch((e) => setToast(errorMessage(e)))} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50">
                          Excel
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">* bugungi kunlik tushum bilan birga · hamma summa ming so&apos;mda</p>
          </div>
        )}
      </div>
      {toast && <Toast message={toast} tone="error" onClose={() => setToast(null)} />}
    </div>
  );

  if (embedded) return body;
  return (
    <>
      <PageHeader
        title="Tarix"
        description="Saqlangan kunlik ma'lumotnomalar · ming so'mda"
        actions={
          <Link href={`${base}?sana=${todayInput()}`} className={buttonClass()}>
            Bugungi kun
          </Link>
        }
      />
      {body}
    </>
  );
}