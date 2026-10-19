'use client';

import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { compact } from '@/features/structure/api';
import { KpiStrip, Segmented, SmallButton } from '@/features/structure/parts';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';
import { downloadReactionFile, reactionsApi, type ReactionSummary } from './api';
import { useReactionSelect } from './select-context';

type Filter = 'OPEN' | 'CONTROL' | 'CLOSED' | 'ALL';

export function uzDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function signedSom(tiyin: number): string {
  if (tiyin === 0) return '0';
  return `${tiyin > 0 ? '+' : '−'}${compact(Math.abs(tiyin))}`;
}

export const STATUS_TEXT: Record<ReactionSummary['status'], string> = {
  OPEN: 'Kuzatilmoqda',
  CONTROL: 'Nazoratda',
  CLOSED: 'Yopilgan',
};

export function StatusBadge({ reaction }: { reaction: Pick<ReactionSummary, 'status' | 'overdue'> }) {
  const tone =
    reaction.status === 'OPEN'
      ? reaction.overdue
        ? 'bg-(--color-expense-soft) text-(--color-expense)'
        : 'bg-amber-100 text-amber-800'
      : reaction.status === 'CONTROL'
        ? 'bg-slate-800 text-white'
        : 'bg-(--color-surface-sunken) text-(--color-text-muted)';
  return (
    <span className={cn('inline-flex whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-semibold', tone)}>
      {reaction.status === 'OPEN' && reaction.overdue ? 'Muddat tugagan' : STATUS_TEXT[reaction.status]}
    </span>
  );
}

/** Muddat chizig'i: o'tgan kunlar / jami */
export function DueBar({ reaction }: { reaction: ReactionSummary }) {
  const share = reaction.daysTotal > 0 ? Math.min(100, (reaction.daysPassed / reaction.daysTotal) * 100) : 0;
  const color = reaction.status !== 'OPEN' ? 'bg-slate-400' : reaction.overdue ? 'bg-(--color-expense)' : share > 80 ? 'bg-amber-500' : 'bg-slate-700';
  return (
    <div className="min-w-[9rem]">
      <div className="h-1.5 bg-(--color-surface-sunken)">
        <div className={cn('h-full', color)} style={{ width: `${share}%` }} />
      </div>
      <p className="mt-1 text-xs tabular-nums text-(--color-text-muted)">
        {uzDate(reaction.startDate)} — {uzDate(reaction.dueDate)}
        <span className={cn('ml-1.5 font-medium', reaction.status === 'OPEN' && reaction.overdue ? 'text-(--color-expense)' : 'text-(--color-text)')}>
          {reaction.status !== 'OPEN' ? '' : reaction.overdue ? 'tugagan' : reaction.daysPassed === 0 ? 'boshlanmagan' : `${reaction.daysLeft} kun qoldi`}
        </span>
      </p>
    </div>
  );
}

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';

/**
 * Munosabatlar ro'yxati: har bir nomlangan savat — muddat, mas'ullar, natija.
 */
export function ReactionList() {
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const all = useAsync(() => reactionsApi.list().then((r) => r.data), []);
  const select = useReactionSelect();

  const rows = (all.data ?? []).filter((r) => filter === 'ALL' || r.status === filter);
  const open = (all.data ?? []).filter((r) => r.status === 'OPEN');
  const overdue = open.filter((r) => r.overdue).length;
  const better = open.reduce((s, r) => s + r.better, 0);
  const worse = open.reduce((s, r) => s + r.worse, 0);
  const gain = open.reduce((s, r) => s + Number(r.gainTiyin), 0);
  const count = (status: Filter) => (all.data ?? []).filter((r) => status === 'ALL' || r.status === status).length;

  const download = async (id: string, kind: 'report' | 'slides') => {
    setBusy(`${id}-${kind}`);
    setError(null);
    try {
      await downloadReactionFile(id, kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Yuklab bo\'lmadi');
    } finally {
      setBusy(null);
    }
  };

  if (all.error) {
    return (
      <Card>
        <ErrorState message={all.error} onRetry={all.reload} />
      </Card>
    );
  }
  if (!all.data) {
    return (
      <Card>
        <LoadingState label="Munosabatlar hisoblanmoqda" />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <KpiStrip
        items={[
          { label: 'Ochiq munosabatlar', value: String(open.length), sub: `jami ${all.data.length} ta` },
          { label: 'Muddati tugagan', value: String(overdue), valueClass: overdue > 0 ? 'text-(--color-expense)' : undefined, sub: overdue > 0 ? 'qaror qabul qilish kerak' : 'hammasi muddatida' },
          { label: 'Moddalar holati', value: `${better} / ${worse}`, sub: 'yaxshilangan / yomonlashgan (ochiqlarda)' },
          {
            label: "Umumiy ta'sir",
            value: signedSom(gain),
            valueClass: gain > 0 ? 'text-(--color-income)' : gain < 0 ? 'text-(--color-expense)' : undefined,
            sub: "tejalgan xarajat + qo'shimcha daromad",
          },
        ]}
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold">Munosabatlar</h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">Qatorni bosing — to&apos;liq hisobot, moddalar va grafiklar ochiladi.</p>
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'OPEN', label: `Ochiq (${count('OPEN')})` },
              { value: 'CONTROL', label: `Nazoratda (${count('CONTROL')})` },
              { value: 'CLOSED', label: `Yopilgan (${count('CLOSED')})` },
              { value: 'ALL', label: `Barchasi (${count('ALL')})` },
            ]}
          />
        </div>
        {error && <p className="px-5 pb-2 text-sm text-(--color-expense)">{error}</p>}

        {rows.length === 0 ? (
          <EmptyState
            title={filter === 'OPEN' ? "Ochiq munosabat yo'q" : "Bu ro'yxat bo'sh"}
            description="Yuqoridagi sariq «+ Munosabat» tugmasini bosing, sahifalardan kerakli moddalarni belgilang va «Munosabat yaratish»ni bosing."
            action={
              select && !select.active ? (
                <button
                  type="button"
                  onClick={() => select.setActive(true)}
                  className="inline-flex items-center gap-1.5 rounded-(--radius-control) border border-amber-500 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                >
                  + Belgilashni boshlash
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-(--color-line) bg-(--color-surface-muted)">
                <tr>
                  <th className={cn(TH, 'pl-5 text-left')}>Munosabat</th>
                  <th className={cn(TH, 'text-left')}>Muddat</th>
                  <th className={cn(TH, 'text-left')}>Mas&apos;ullar</th>
                  <th className={cn(TH, 'text-center')}>Moddalar</th>
                  <th className={cn(TH, 'text-right')}>Ta&apos;sir</th>
                  <th className={cn(TH, 'pr-5 text-right')}>Fayllar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {rows.map((r) => {
                  const g = Number(r.gainTiyin);
                  return (
                    <tr key={r.id} className="group hover:bg-(--color-surface-muted)">
                      <td className="py-3 pl-5 pr-3">
                        <Link href={`/munosabat/${r.id}`} className="block">
                          <span className="flex items-center gap-2">
                            <span className="font-medium text-(--color-text) group-hover:underline">{r.title}</span>
                            <StatusBadge reaction={r} />
                          </span>
                          {r.note && <span className="mt-0.5 line-clamp-1 block text-xs text-(--color-text-muted)">{r.note}</span>}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <DueBar reaction={r} />
                      </td>
                      <td className="px-3 py-3 text-xs">
                        {r.assignees.length === 0 ? (
                          <span className="text-(--color-expense)">biriktirilmagan</span>
                        ) : (
                          <span className="block max-w-[14rem] truncate" title={r.assignees.map((a) => a.fullName).join(', ')}>
                            {r.assignees[0]!.fullName}
                            {r.assignees.length > 1 ? ` +${r.assignees.length - 1}` : ''}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className="inline-flex items-center gap-1.5 text-xs tabular-nums">
                          <span className="rounded bg-(--color-income-soft) px-1.5 py-0.5 font-semibold text-(--color-income)" title="Yaxshilangan">
                            ▲ {r.better}
                          </span>
                          <span className="rounded bg-(--color-expense-soft) px-1.5 py-0.5 font-semibold text-(--color-expense)" title="Yomonlashgan">
                            ▼ {r.worse}
                          </span>
                          <span className="text-(--color-text-faint)">/ {r.itemCount}</span>
                        </span>
                      </td>
                      <td
                        className={cn('whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums', g > 0 ? 'text-(--color-income)' : g < 0 ? 'text-(--color-expense)' : 'text-(--color-text-muted)')}
                      >
                        {signedSom(g)}
                      </td>
                      <td className="whitespace-nowrap py-3 pl-3 pr-5 text-right">
                        <span className="inline-flex gap-1.5">
                          <SmallButton disabled={busy !== null} onClick={() => download(r.id, 'report')}>
                            {busy === `${r.id}-report` ? '…' : 'Excel'}
                          </SmallButton>
                          <SmallButton disabled={busy !== null} onClick={() => download(r.id, 'slides')}>
                            {busy === `${r.id}-slides` ? '…' : 'Slaydlar'}
                          </SmallButton>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}