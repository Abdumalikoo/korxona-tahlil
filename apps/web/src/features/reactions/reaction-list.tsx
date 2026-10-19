'use client';

import { calcSum, Q } from '@/lib/calc';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { compact } from '@/features/structure/api';
import { KpiStrip, Segmented, SmallButton } from '@/features/structure/parts';
import { useAuth } from '@/lib/auth-context';
import { formatDate } from '@/lib/format';
import { todayIso, usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useState } from 'react';
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
 * Munosabat tanlangan davrda faol bo'lganmi: boshlangan kunidan yopilgan kunigacha
 * (ochiq va nazoratdagilar — bugungacha) oraliq umumiy «Davr» bilan kesishadi.
 */
/** Munosabatlar o'zgardi (yaratildi / modda qo'shildi) — ro'yxat qayta yuklanadi */
export const REACTIONS_CHANGED = 'reactions:changed';

/**
 * Ro'yxatda ko'rinadimi: ochiq va nazoratdagilar — doim (ular hozir ishlayapti, davrga bog'liq emas);
 * yopilganlar — umumiy «Davr» bilan kesishsa.
 */
export function visibleInRange(r: Pick<ReactionSummary, 'startDate' | 'closedAt' | 'status'>, range: { from: string; to: string }): boolean {
  return r.status !== 'CLOSED' || activeInRange(r, range);
}

export function activeInRange(r: Pick<ReactionSummary, 'startDate' | 'closedAt' | 'status'>, range: { from: string; to: string }): boolean {
  const start = r.startDate.slice(0, 10);
  const end = r.status === 'CLOSED' && r.closedAt ? r.closedAt.slice(0, 10) : todayIso();
  return start <= range.to && end >= range.from;
}

/**
 * Munosabatlar ro'yxati: har bir nomlangan savat — muddat, mas'ullar, natija.
 * Ro'yxat umumiy «Davr» bo'yicha: shu davrda faol bo'lgan munosabatlar (xohlasa — hammasi).
 */
export function ReactionList() {
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** true — davrdan qat'i nazar hammasi */
  const [anyTime, setAnyTime] = useState(false);
  const { range } = usePeriod();
  const all = useAsync(() => reactionsApi.list().then((r) => r.data), []);
  const select = useReactionSelect();
  const { isAdmin } = useAuth();
  /** O'chirish uchun belgilanganlar */
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Yangi munosabat yaratilsa yoki moddalar qo'shilsa — ro'yxat darhol yangilanadi
  const reload = all.reload;
  useEffect(() => {
    const handler = () => reload();
    window.addEventListener(REACTIONS_CHANGED, handler);
    return () => window.removeEventListener(REACTIONS_CHANGED, handler);
  }, [reload]);

  const inPeriod = (all.data ?? []).filter((r) => anyTime || visibleInRange(r, range));
  const outside = (all.data?.length ?? 0) - (all.data ?? []).filter((r) => visibleInRange(r, range)).length;
  const rows = inPeriod.filter((r) => filter === 'ALL' || r.status === filter);
  const open = inPeriod.filter((r) => r.status === 'OPEN');
  const overdue = open.filter((r) => r.overdue).length;
  const better = open.reduce((s, r) => s + r.better, 0);
  const worse = open.reduce((s, r) => s + r.worse, 0);
  const gain = open.reduce((s, r) => s + Number(r.gainTiyin), 0);
  const count = (status: Filter) => inPeriod.filter((r) => status === 'ALL' || r.status === status).length;
  const periodText = `${formatDate(range.from)} — ${formatDate(range.to)}`;

  /** Munosabat(lar)ni butunlay o'chirish — moddalari va mas'ullari bilan; nazoratdagi chegaralar munosabatsiz qoladi */
  const removeMany = async (ids: string[]) => {
    if (ids.length === 0) return;
    const titles = (all.data ?? []).filter((r) => ids.includes(r.id)).map((r) => `«${r.title}»`);
    const question =
      ids.length === 1
        ? `${titles[0] ?? 'Munosabat'} butunlay o'chirilsinmi?\n\nModdalar, mas'ullar va hisob-kitob o'chadi. Nazoratga o'tkazilgan chegaralar saqlanib qoladi.`
        : `${ids.length} ta munosabat butunlay o'chirilsinmi?\n\n${titles.slice(0, 8).join('\n')}${titles.length > 8 ? `\n… va yana ${titles.length - 8} ta` : ''}`;
    if (!window.confirm(question)) return;
    setBusy('remove');
    setError(null);
    let failed = 0;
    for (const id of ids) {
      try {
        await reactionsApi.remove(id);
      } catch {
        failed += 1;
      }
    }
    setChecked(new Set());
    setBusy(null);
    if (failed > 0) setError(`${failed} ta munosabatni o'chirib bo'lmadi`);
    all.reload();
  };

  const toggleCheck = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
          { label: 'Ochiq munosabatlar', value: String(open.length), sub: `jami ${all.data.length} ta munosabat` },
          { label: 'Muddati tugagan', value: String(overdue), valueClass: overdue > 0 ? 'text-(--color-expense)' : undefined, sub: overdue > 0 ? 'qaror qabul qilish kerak' : 'hammasi muddatida' },
          {
            label: 'Moddalar holati',
            value: `${better} / ${worse}`,
            sub: 'yaxshilangan / yomonlashgan (ochiqlarda)',
            calc: {
              title: 'Moddalar holati',
              formula: "Yaxshilangan = Σ har munosabatdagi yaxshilangan moddalar; yomonlashgan — xuddi shunday",
              inputs: open.flatMap((r) => [Q.count(`${r.title}: yaxshilangan`, r.better), Q.count(`${r.title}: yomonlashgan`, r.worse)]),
              steps: [`Yaxshilangan = ${open.map((r) => r.better).join(' + ') || '0'} = ${better}`, `Yomonlashgan = ${open.map((r) => r.worse).join(' + ') || '0'} = ${worse}`],
              result: `${better} / ${worse}`,
            },
          },
          {
            label: "Umumiy ta'sir",
            value: signedSom(gain),
            valueClass: gain > 0 ? 'text-(--color-income)' : gain < 0 ? 'text-(--color-expense)' : undefined,
            sub: "tejalgan xarajat + qo'shimcha daromad",
            calc: calcSum("Umumiy ta'sir (ochiq munosabatlar)", open.map((r) => Q.money(r.title, r.gainTiyin)), {
              note: "Har munosabat ta'siri = tejalgan xarajat + qo'shimcha daromad (munosabat sahifasida modda bo'yicha ishlanishi bor).",
            }),
          },
        ]}
      />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold">Munosabatlar</h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              {anyTime
                ? 'Hammasi, davrdan qat’i nazar'
                : `Ochiq va nazoratdagilar — hammasi; yopilganlar — ${periodText} davridagilari`}{' '}
              · qatorni bosing — to&apos;liq hisobot, moddalar va grafiklar ochiladi.
            </p>
            {(outside > 0 || anyTime) && (
              <button type="button" onClick={() => setAnyTime((v) => !v)} className="mt-1 text-xs font-semibold text-brand-700 hover:underline">
                {anyTime ? 'Yopilganlarni faqat tanlangan davr bo‘yicha' : `Davrdan tashqari yopilgan yana ${outside} ta — hammasini ko‘rsatish`}
              </button>
            )}
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
        {isAdmin && checked.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-(--color-expense-soft) px-5 py-2 text-sm">
            <span className="font-medium">{checked.size} ta belgilandi</span>
            <SmallButton
              disabled={busy !== null}
              onClick={() => void removeMany([...checked])}
              className="border-(--color-expense) text-(--color-expense) hover:bg-white"
            >
              {busy === 'remove' ? "O'chirilmoqda…" : "Belgilanganlarni o'chirish"}
            </SmallButton>
            <button type="button" onClick={() => setChecked(new Set())} className="text-xs text-(--color-text-muted) hover:underline">
              bekor qilish
            </button>
          </div>
        )}

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
                  {isAdmin && (
                    <th className="w-10 pl-5">
                      <input
                        type="checkbox"
                        aria-label="Hammasini belgilash"
                        className="size-4 accent-brand-600 align-middle"
                        checked={rows.length > 0 && rows.every((r) => checked.has(r.id))}
                        onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                      />
                    </th>
                  )}
                  <th className={cn(TH, isAdmin ? 'text-left' : 'pl-5 text-left')}>Munosabat</th>
                  <th className={cn(TH, 'text-left')}>Muddat</th>
                  <th className={cn(TH, 'text-left')}>Mas&apos;ullar</th>
                  <th className={cn(TH, 'text-center')}>Moddalar</th>
                  <th className={cn(TH, 'text-right')}>Ta&apos;sir</th>
                  <th className={cn(TH, 'pr-5 text-right')}>Amallar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {rows.map((r) => {
                  const g = Number(r.gainTiyin);
                  return (
                    <tr key={r.id} className={cn('group hover:bg-(--color-surface-muted)', checked.has(r.id) && 'bg-(--color-expense-soft)/40')}>
                      {isAdmin && (
                        <td className="w-10 py-3 pl-5">
                          <input
                            type="checkbox"
                            aria-label={`Belgilash: ${r.title}`}
                            className="size-4 accent-brand-600 align-middle"
                            checked={checked.has(r.id)}
                            onChange={() => toggleCheck(r.id)}
                          />
                        </td>
                      )}
                      <td className={cn('py-3 pr-3', isAdmin ? 'pl-3' : 'pl-5')}>
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
                          {isAdmin && (
                            <SmallButton
                              disabled={busy !== null}
                              onClick={() => void removeMany([r.id])}
                              title="Munosabatni o'chirish"
                              aria-label={`O'chirish: ${r.title}`}
                              className="text-(--color-expense) hover:border-(--color-expense) hover:bg-(--color-expense-soft)"
                            >
                              O&apos;chirish
                            </SmallButton>
                          )}
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