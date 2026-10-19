'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { MonthPicker, Notice } from '@/features/regional-desk/bits';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';
import { rdData, type QualityItem, type QualityResult } from './api';

// ═══════════════════════════════════════════════════════════
// Hududchi › Oyni yopish: tekshiruv ro'yxati (ma'lumot sifati) → izoh → «Oyni yopish».
// Yopilgan oyda daromad, ish haqi va xarajat o'zgarmaydi; administrator sababi bilan qayta ochadi.
// ═══════════════════════════════════════════════════════════

const ICON: Record<QualityItem['level'], { icon: string; cls: string }> = {
  ok: { icon: '✓', cls: 'bg-emerald-100 text-emerald-700' },
  warn: { icon: '!', cls: 'bg-amber-100 text-amber-700' },
  error: { icon: '✕', cls: 'bg-red-100 text-red-700' },
  info: { icon: 'i', cls: 'bg-sky-100 text-sky-700' },
};

const ORDER: Record<QualityItem['level'], number> = { error: 0, warn: 1, info: 2, ok: 3 };

/** Tekshiruv ro'yxati — ish stolida ham ishlatiladi */
export function QualityList({ q, compact = false }: { q: QualityResult; compact?: boolean }) {
  const items = [...q.items].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
  return (
    <ul className="divide-y divide-(--color-line)">
      {(compact ? items.filter((i) => i.level !== 'ok') : items).map((i) => (
        <li key={i.key} className="flex gap-3 px-4 py-3">
          <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold', ICON[i.level].cls)}>{ICON[i.level].icon}</span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-heading">{i.title}</p>
            {i.detail && <p className="text-sm text-(--color-text-muted)">{i.detail}</p>}
            {i.list.length > 0 && !compact && (
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {i.list.map((x) => (
                  <li key={x} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-heading">
                    {x}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {i.href && i.level !== 'ok' && (
            <Link href={i.href} className="shrink-0 self-center rounded-lg px-2.5 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50">
              Tuzatish →
            </Link>
          )}
        </li>
      ))}
      {compact && items.every((i) => i.level === 'ok') && <li className="px-4 py-4 text-sm text-emerald-700">✓ Hammasi joyida</li>}
    </ul>
  );
}

export function PeriodClosePage() {
  const { isAdmin } = useAuth();
  const thisMonth = todayInput().slice(0, 7);
  const [period, setPeriod] = useState(thisMonth);
  const [tick, setTick] = useState(0);
  const q = useAsync(() => rdData.quality(period), [period, tick]);
  const list = useAsync(() => rdData.closes(period.slice(0, 4)), [period.slice(0, 4), tick]);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const r = q.data?.data ?? null;
  const row = (list.data?.data ?? []).find((x) => x.period === period);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await fn();
      setToast({ message });
      setNote('');
      setReason('');
      setTick((t) => t + 1);
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Oyni yopish" description="Oy ma'lumotlari to'liq va to'g'ri ekanini tasdiqlash. Yopilgan oy prognoz va KPI'da «tasdiqlangan» deb olinadi" />
      <div className="mx-auto max-w-5xl space-y-5 p-4 md:p-6">
        <MonthPicker
          value={period}
          onChange={(p) => {
            setPeriod(p);
            setNote('');
          }}
          max={thisMonth}
        />

        {q.loading && !r ? (
          <LoadingState />
        ) : q.error || !r ? (
          <ErrorState message={q.error ?? "Ma'lumot yo'q"} onRetry={q.reload} />
        ) : (
          <>
            {r.closed ? (
              <Notice tone="ok">
                <b>{r.periodLabel} yopilgan</b>
                {row?.closedAt ? ` · ${formatDateTime(row.closedAt)}` : ''}
                {row?.closedBy ? ` · ${row.closedBy}` : ''}
                {row?.note ? ` · izoh: «${row.note}»` : ''}. Ma&apos;lumotlar o&apos;zgarmaydi.
              </Notice>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className={cn('rounded-(--radius-card) p-4 text-center shadow-card', r.errors ? 'bg-red-50' : 'bg-white')}>
                  <p className={cn('text-3xl font-bold', r.errors ? 'text-red-600' : 'text-heading')}>{r.errors}</p>
                  <p className="text-xs text-(--color-text-muted)">xato — yopishga to&apos;sqinlik</p>
                </div>
                <div className={cn('rounded-(--radius-card) p-4 text-center shadow-card', r.warnings ? 'bg-amber-50' : 'bg-white')}>
                  <p className={cn('text-3xl font-bold', r.warnings ? 'text-amber-600' : 'text-heading')}>{r.warnings}</p>
                  <p className="text-xs text-(--color-text-muted)">ogohlantirish — izoh bilan</p>
                </div>
                <div className="rounded-(--radius-card) bg-white p-4 text-center shadow-card">
                  <p className="text-3xl font-bold text-emerald-600">{r.items.filter((i) => i.level === 'ok').length}</p>
                  <p className="text-xs text-(--color-text-muted)">tekshiruvdan o&apos;tdi</p>
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
              <div className="border-b border-(--color-line) px-4 py-3">
                <p className="font-semibold text-heading">{r.periodLabel}: tekshiruv ro&apos;yxati</p>
              </div>
              <QualityList q={r} />
            </div>

            {!r.closed && (
              <div className="rounded-(--radius-card) bg-white p-4 shadow-card">
                <label htmlFor="close-note" className="text-sm font-semibold text-heading">
                  Izoh {r.warnings > 0 ? <span className="text-amber-700">(majburiy — ogohlantirishlarni ko&apos;rib chiqdingizmi?)</span> : <span className="font-normal text-(--color-text-muted)">(ixtiyoriy)</span>}
                </label>
                <textarea
                  id="close-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  maxLength={500}
                  placeholder="Masalan: Buxoro hisoboti keyinroq keladi; Andijondagi o'sish — yangi tarif"
                  className="mt-2 w-full rounded-xl border border-(--color-line-strong) px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="text-sm text-(--color-text-muted)">{r.errors > 0 ? 'Avval xatolarni tuzating' : 'Yopilgach o‘zgartirish faqat administrator ruxsati bilan'}</span>
                  <Button className="ml-auto" size="lg" disabled={r.errors > 0 || (r.warnings > 0 && note.trim().length < 5)} loading={busy} onClick={() => void act(() => rdData.close(period, note.trim() || null), `${r.periodLabel} yopildi`)}>
                    {r.periodLabel}ni yopish
                  </Button>
                </div>
              </div>
            )}

            {r.closed && isAdmin && (
              <div className="rounded-(--radius-card) border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">Administrator: oyni qayta ochish</p>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Sababi (majburiy)" maxLength={500} className="mt-2 h-10 w-full rounded-xl border border-amber-300 bg-white px-3 text-sm" />
                <Button className="mt-2" variant="danger" disabled={reason.trim().length < 5} loading={busy} onClick={() => void act(() => rdData.reopen(period, reason.trim()), `${r.periodLabel} qayta ochildi`)}>
                  Qayta ochish
                </Button>
              </div>
            )}
          </>
        )}

        <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
          <div className="border-b border-(--color-line) px-4 py-3">
            <p className="font-semibold text-heading">{period.slice(0, 4)}-yil oylari</p>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-(--color-line)">
              {[...(list.data?.data ?? [])].reverse().map((m) => (
                <tr key={m.period} onClick={() => setPeriod(m.period)} className={cn('cursor-pointer hover:bg-brand-50/50', m.period === period && 'bg-brand-50')}>
                  <td className="px-4 py-2.5 font-semibold text-heading">{m.label}</td>
                  <td className="px-3 py-2.5">
                    {m.status === 'CLOSED' ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">✓ yopilgan</span> : <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">ochiq</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-(--color-text-muted)">
                    {m.closedAt ? `${formatDateTime(m.closedAt)} · ${m.closedBy ?? ''}` : ''}
                    {m.reopenedAt ? ` · qayta ochilgan: ${m.reopenReason ?? ''}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 3000} />}
    </>
  );
}