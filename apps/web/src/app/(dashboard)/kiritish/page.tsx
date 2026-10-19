'use client';

import { PageHeader } from '@/components/layout/page-header';
import { QUICK_TONES, quickGroups } from '@/components/layout/quick-actions';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { entriesApi, type EntryItem } from '@/features/entries/api';
import { useAuth } from '@/lib/auth-context';
import { formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Tez kiritish (umumiy hudud): umumiy hudud kiritadigan turlar bitta sahifada va
// «Bugun kiritilganlar» — kim, qachon, nima kiritdi; bosilsa — yozuv turgan joyga.
// Har sahifada N tugmasi yoki yuqoridagi «+ Kiritish» ham shu ro'yxatni ochadi.
// ═══════════════════════════════════════════════════════════

const TYPE_DOT: Record<EntryItem['type'], string> = {
  EXPENSE: 'bg-red-500',
  INCOME: 'bg-emerald-500',
  STOCK: 'bg-blue-500',
  IMPORT: 'bg-violet-500',
};
const TYPE_LABEL: Record<EntryItem['type'], string> = {
  EXPENSE: 'Xarajat',
  INCOME: 'Daromad',
  STOCK: 'Ombor',
  IMPORT: 'Yuklash',
};

function dayIso(offset: number): string {
  return new Date(Date.now() + 5 * 3600_000 - offset * 86_400_000).toISOString().slice(0, 10);
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });
}

export default function QuickEntryPage() {
  const { canWrite, isAdmin, ready } = useAuth();
  const groups = useMemo(() => (ready ? quickGroups(canWrite) : []), [ready, canWrite]);
  const [offset, setOffset] = useState(0);
  const date = dayIso(offset);
  const today = useAsync(() => (isAdmin ? entriesApi.today(date) : Promise.resolve(null)), [isAdmin, date]);
  const data = today.data?.data ?? null;

  return (
    <>
      <PageHeader title="Tez kiritish" description="Umumiy hudud kiritadiganlari. Istalgan sahifada N tugmasi ham shu ro'yxatni ochadi" />

      <div className="grid gap-5 p-4 md:p-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        {/* ── Kiritish turlari ── */}
        <div className="space-y-5">
          {groups.length === 0 && ready && (
            <Card className="p-6 text-sm text-(--color-text-muted)">Sizda ma&apos;lumot kiritish huquqi yo&apos;q — faqat ko&apos;rish mumkin.</Card>
          )}
          {groups.map((g) => (
            <section key={g.title}>
              <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                <h2 className="text-[15px] font-bold text-heading">{g.title}</h2>
                <p className="text-xs text-(--color-text-muted)">{g.note}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {g.actions.map((a) => {
                  const tone = QUICK_TONES[a.tone];
                  return (
                    <Link
                      key={a.key}
                      href={a.href}
                      className="group flex items-start gap-3 rounded-(--radius-card) border border-(--color-line) bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md"
                    >
                      <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold', tone.soft, tone.text)}>+</span>
                      <span className="min-w-0">
                        <span className="block font-semibold text-heading group-hover:text-brand-700">{a.label}</span>
                        <span className="mt-0.5 block text-xs leading-snug text-(--color-text-muted)">{a.hint}</span>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}

          <Card className="p-4 text-xs leading-relaxed text-(--color-text-muted)">
            <p className="mb-1 font-semibold text-heading">Qaysi birini tanlash kerak?</p>
            <ul className="list-disc space-y-0.5 pl-4">
              <li>
                Har oy takrorlanadigan to&apos;lov — «Xarajat»; takrorlanmasa — «Bir martalik xarajat».
              </li>
              <li>
                Ko&apos;p yozuv bir yo&apos;la (hududlar tushumi, oylik qaydnoma) — «Excel yuklash».
              </li>
              <li>
                <b>Ombor, mashina va pochta</b> bu yerda kiritilmaydi — ularni <b>Omborchi</b> o&apos;z bo&apos;limida kiritadi, Xarajatlarga o&apos;zi tushadi.
                Siz ularni{' '}
                <Link href="/dashbord/ombor" className="font-semibold text-brand-700 hover:underline">
                  Ombor
                </Link>{' '}
                va{' '}
                <Link href="/dashbord/mashinalar" className="font-semibold text-brand-700 hover:underline">
                  Mashinalar
                </Link>{' '}
                dashbordida ko&apos;rasiz.
              </li>
            </ul>
          </Card>
        </div>

        {/* ── Bugun kiritilganlar ── */}
        {isAdmin && (
          <Card className="h-fit overflow-hidden xl:sticky xl:top-28">
            <CardHeader
              title={offset === 0 ? 'Bugun kiritilganlar' : 'Kecha kiritilganlar'}
              description="Kim, qachon, nima — bosilsa yozuv turgan joy ochiladi"
              actions={
                <div className="flex rounded-lg border border-(--color-line) p-0.5 text-xs">
                  {['Bugun', 'Kecha'].map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setOffset(i)}
                      className={cn('rounded-md px-2.5 py-1 font-medium', offset === i ? 'bg-brand-600 text-white' : 'text-(--color-text-muted) hover:text-heading')}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              }
            />
            {data && data.items.length > 0 && (
              <div className="grid grid-cols-3 border-b border-(--color-line) text-center">
                <div className="px-2 py-2.5">
                  <p className="text-[11px] text-(--color-text-muted)">Xarajat</p>
                  <p className="money text-sm font-bold text-(--color-expense)">{formatTiyin(data.totals.expenseTiyin)}</p>
                </div>
                <div className="border-x border-(--color-line) px-2 py-2.5">
                  <p className="text-[11px] text-(--color-text-muted)">Daromad</p>
                  <p className="money text-sm font-bold text-emerald-700">{formatTiyin(data.totals.incomeTiyin)}</p>
                </div>
                <div className="px-2 py-2.5">
                  <p className="text-[11px] text-(--color-text-muted)">Ombor hujjati</p>
                  <p className="text-sm font-bold text-heading">{data.totals.stockDocs}</p>
                </div>
              </div>
            )}
            {today.loading && !today.data ? (
              <TableSkeleton rows={5} cols={2} />
            ) : today.error ? (
              <ErrorState message={today.error} onRetry={today.reload} />
            ) : !data || data.items.length === 0 ? (
              <EmptyState title={offset === 0 ? "Bugun hali hech narsa kiritilmagan" : 'Kecha hech narsa kiritilmagan'} />
            ) : (
              <ul className="max-h-[60vh] divide-y divide-(--color-line) overflow-y-auto">
                {data.items.map((e) => (
                  <li key={`${e.type}-${e.id}`}>
                    <Link href={e.href} className="flex items-start gap-3 px-4 py-2.5 hover:bg-brand-50/60">
                      <span className="w-10 shrink-0 pt-0.5 text-[11px] tabular-nums text-(--color-text-faint)">{timeOf(e.at)}</span>
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', TYPE_DOT[e.type])} title={TYPE_LABEL[e.type]} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-heading">{e.title}</span>
                        <span className="block truncate text-[11px] text-(--color-text-muted)">{[e.subtitle, e.by].filter(Boolean).join(' · ') || TYPE_LABEL[e.type]}</span>
                      </span>
                      {e.amountTiyin !== null && <span className="money shrink-0 pt-0.5 text-sm font-semibold text-heading">{formatTiyin(e.amountTiyin)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}