'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorMessage } from '@/lib/error-message';
import { formatPeriodShort, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { RoutePanel } from './bank-analysis-parts';
import { useSource } from './source';
import type { BankDir, BankOutlier, OutlierCode } from './api';

// ═══════════════════════════════════════════════════════════
// Bank ko'chirmasi › Tahlil va saqlash › Ajralib turganlar.
// Saqlangan ko'chirmadan: bir martalik (kontragentga davrda bitta to'lov), odatdan tashqari summa (guruh odatidan
// 3 baravar — kirimda 5), izohi butunlay boshqacha (shu turdagi boshqa to'lovlarning hech biriga o'xshamaydi).
// Oyma-oy; tanlanganlarni — haqiqiy xarajat (daromad) sifatida bo'lim va modda bilan yuborish yoki «oddiy» deb belgilash.
// ═══════════════════════════════════════════════════════════

type ToastFn = (t: { message: string; tone: 'success' | 'error' } | null) => void;
type Status = 'OPEN' | 'POSTED' | 'OK' | 'ALL';

const REASON: Record<OutlierCode, { label: string; tone: 'warn' | 'expense' | 'brand' }> = {
  ONCE: { label: 'bir martalik', tone: 'warn' },
  AMOUNT: { label: 'summa odatdan tashqari', tone: 'expense' },
  TEXT: { label: 'izohi boshqacha', tone: 'brand' },
};
const key = (x: BankOutlier) => `${x.account}:${x.rowId}`;

export function OutliersPanel({ from, to, account, defaultDir, isAdmin, onToast, onChanged }: { from: string; to: string; account: string | null; defaultDir: BankDir; isAdmin: boolean; onToast: ToastFn; onChanged: () => void }) {
  const { api, dirLabel } = useSource();
  const [rev, setRev] = useState(0);
  const res = useAsync(() => api.outliers(from, to, account).then((r) => r.data), [from, to, account, rev]);
  const [dir, setDir] = useState<BankDir>(defaultDir);
  const [reason, setReason] = useState<OutlierCode | null>(null);
  const [status, setStatus] = useState<Status>('OPEN');
  const [month, setMonth] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const all = useMemo(() => res.data?.items ?? [], [res.data]);
  const statusOf = (x: BankOutlier): Exclude<Status, 'ALL'> => (x.post ? 'POSTED' : x.ok ? 'OK' : 'OPEN');
  const base = all.filter((x) => x.dir === dir && (!month || x.period === month));
  const shown = base.filter((x) => (status === 'ALL' || statusOf(x) === status) && (!reason || x.reasons.some((r) => r.code === reason)));
  const chosen = shown.filter((x) => picked.has(key(x)) && !x.post);
  const chosenSum = chosen.reduce((s, x) => s + BigInt(x.amountTiyin), 0n).toString();
  const reload = () => {
    setPicked(new Set());
    setRev((v) => v + 1);
    onChanged();
  };
  const toggle = (k: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  async function markOk(ok: boolean, list: BankOutlier[]) {
    if (!list.length) return;
    setBusy(true);
    try {
      const r = (await api.outliersOk(list.map((x) => ({ account: x.account, rowId: x.rowId })), ok)).data;
      onToast({ message: ok ? `${r.count} ta to'lov «oddiy» deb belgilandi` : `${r.count} ta to'lov qayta ko'rib chiqishga qaytarildi`, tone: 'success' });
      reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "Saqlab bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!res.data) return <LoadingState label="Ajralib turgan to'lovlar qidirilmoqda" />;
  const months = res.data.byMonth;
  const maxN = Math.max(1, ...months.map((m) => (dir === 'OUT' ? m.out : m.in)));
  const cnt = (s: Status) => base.filter((x) => s === 'ALL' || statusOf(x) === s).length;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Ajralib turgan to'lovlar"
          description="Bir martalik · summasi odatdan tashqari · izohi shu turdagi boshqa to'lovlarga o'xshamaydi. Oyni bosing — faqat shu oy."
          actions={
            <span className="flex gap-1">
              {(['OUT', 'IN'] as const).map((d) => (
                <button key={d} type="button" onClick={() => { setDir(d); setPicked(new Set()); }} className={cn('rounded-full border px-3 py-1 text-xs font-medium', dir === d ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-(--color-line) text-(--color-text-muted)')}>
                  {dirLabel[d]}
                </button>
              ))}
            </span>
          }
        />
        <CardBody className="space-y-3">
          {/* Oyma-oy: ko'rib chiqilmaganlar soni */}
          <div className="flex items-end gap-1 overflow-x-auto pb-1">
            {months.map((m) => {
              const n = dir === 'OUT' ? m.out : m.in;
              const t = dir === 'OUT' ? m.outTiyin : m.inTiyin;
              return (
                <button key={m.period} type="button" onClick={() => setMonth(month === m.period ? null : m.period)} title={`${n} ta · ${formatTiyin(t)} so'm`} className={cn('flex min-w-14 flex-col items-center gap-1 rounded-md px-1.5 py-1 text-[11px]', month === m.period ? 'bg-brand-50 ring-1 ring-brand-300' : 'hover:bg-(--color-surface-muted)')}>
                  <span className="font-semibold text-heading">{n || '—'}</span>
                  <span className="flex h-12 w-5 items-end rounded bg-(--color-surface-sunken)">
                    <span className={cn('w-full rounded', dir === 'OUT' ? 'bg-(--color-expense)' : 'bg-(--color-income)')} style={{ height: `${(n / maxN) * 100}%` }} />
                  </span>
                  <span className="text-(--color-text-muted)">{formatPeriodShort(m.period)}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {(
              [
                ['OPEN', `Ko'rib chiqilmagan (${cnt('OPEN')})`],
                ['POSTED', `Yuborilgan (${cnt('POSTED')})`],
                ['OK', `Oddiy (${cnt('OK')})`],
                ['ALL', `Hammasi (${cnt('ALL')})`],
              ] as const
            ).map(([s, label]) => (
              <button key={s} type="button" onClick={() => setStatus(s)} className={cn('rounded-full border px-2.5 py-1', status === s ? 'border-brand-300 bg-brand-50 font-semibold text-brand-700' : 'border-(--color-line) bg-white text-(--color-text-muted)')}>
                {label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-(--color-line)" />
            {(Object.keys(REASON) as OutlierCode[]).map((c) => (
              <button key={c} type="button" onClick={() => setReason(reason === c ? null : c)} className={cn('rounded-full border px-2.5 py-1', reason === c ? 'border-brand-300 bg-brand-50 font-semibold text-brand-700' : 'border-(--color-line) bg-white text-(--color-text-muted)')}>
                {REASON[c].label} ({base.filter((x) => x.reasons.some((r) => r.code === c)).length})
              </button>
            ))}
            {month && (
              <button type="button" onClick={() => setMonth(null)} className="rounded-full border border-brand-300 bg-brand-50 px-2.5 py-1 font-semibold text-brand-700">
                {formatPeriodShort(month)} ✕
              </button>
            )}
          </div>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <div className="max-h-[640px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-(--color-surface-muted) text-[10px] tracking-wide text-(--color-text-muted) uppercase">
              <tr>
                <th className="w-8 px-2 py-2">
                  {isAdmin && (
                    <input
                      type="checkbox"
                      className="size-3.5"
                      checked={shown.some((x) => !x.post) && shown.filter((x) => !x.post).every((x) => picked.has(key(x)))}
                      onChange={(e) => setPicked(e.target.checked ? new Set(shown.filter((x) => !x.post).map(key)) : new Set())}
                      aria-label="Hammasini tanlash"
                    />
                  )}
                </th>
                <th className="px-2 py-2 text-left font-semibold">Sana</th>
                <th className="px-2 py-2 text-left font-semibold">Kontragent · izoh</th>
                <th className="px-2 py-2 text-right font-semibold">Summa</th>
                <th className="px-2 py-2 text-left font-semibold">Nega ajraldi</th>
                <th className="px-2 py-2 text-left font-semibold">Holat</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((x) => (
                <tr key={key(x)} className={cn('border-t border-(--color-line) align-top', picked.has(key(x)) && 'bg-brand-50/50')}>
                  <td className="px-2 py-2">{isAdmin && !x.post && <input type="checkbox" className="size-3.5" checked={picked.has(key(x))} onChange={() => toggle(key(x))} aria-label="Tanlash" />}</td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap">
                    {x.docDate.split('-').reverse().join('.')}
                    <span className="block text-[10.5px] text-(--color-text-faint)">{x.accountLabel}</span>
                  </td>
                  <td className="max-w-xl px-2 py-2 text-xs">
                    <span className="block font-medium text-heading">{x.groupName ?? x.counterparty}</span>
                    <span className="line-clamp-2 text-(--color-text-muted)" title={x.purpose}>
                      {x.purpose}
                    </span>
                    <span className="text-[10.5px] text-(--color-text-faint)">tur: {x.kindLabel}</span>
                  </td>
                  <td className={cn('money px-2 py-2 text-right font-semibold whitespace-nowrap', x.dir === 'OUT' ? 'text-(--color-expense)' : 'text-(--color-income)')}>{formatTiyin(x.amountTiyin)}</td>
                  <td className="px-2 py-2 text-xs">
                    {x.reasons.map((r) => (
                      <span key={r.code} className="mb-1 block">
                        <Badge tone={REASON[r.code].tone}>{REASON[r.code].label}</Badge>
                        <span className="mt-0.5 block text-[10.5px] text-(--color-text-muted)">{r.text}</span>
                      </span>
                    ))}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    {x.post ? (
                      <span className="text-(--color-income)">
                        yuborilgan
                        <span className="block text-[10.5px] text-(--color-text-muted)">
                          {x.post.place} · {x.post.categoryLabel}
                        </span>
                      </span>
                    ) : x.ok ? (
                      <span className="text-(--color-text-muted)">
                        oddiy ({x.ok.by})
                        {isAdmin && (
                          <button type="button" className="ml-1 underline" disabled={busy} onClick={() => void markOk(false, [x])}>
                            qaytarish
                          </button>
                        )}
                      </span>
                    ) : isAdmin ? (
                      <button type="button" className="rounded px-1.5 py-0.5 text-(--color-text-faint) hover:bg-(--color-surface-muted) hover:text-heading" disabled={busy} onClick={() => void markOk(true, [x])} title="Bu to'lov odatiy — ro'yxatdan chiqarish">
                        oddiy
                      </button>
                    ) : (
                      <span className="text-(--color-text-faint)">ko&apos;rib chiqilmagan</span>
                    )}
                  </td>
                </tr>
              ))}
              {!shown.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-sm text-(--color-text-muted)">
                    {status === 'OPEN' ? "Ko'rib chiqilmagan ajralgan to'lov yo'q." : 'Topilmadi.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {isAdmin && chosen.length > 0 && (
          <div className="space-y-2 border-t border-(--color-line) bg-(--color-surface-muted)/50 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-heading">
                Tanlandi: <b>{chosen.length}</b> ta · <b className="money">{formatTiyin(chosenSum)}</b> so&apos;m
              </span>
              <Button size="sm" variant="secondary" className="ml-auto" disabled={busy} onClick={() => void markOk(true, chosen)}>
                Oddiy deb belgilash
              </Button>
            </div>
            {/* Haqiqiy xarajat (daromad) sifatida — bo'lim va modda bilan; keyin bekor qilish mumkin */}
            <RoutePanel
              key={[...picked].sort().join('|')}
              group={{ dir, pattern: 'ONCE', name: null }}
              suggestion={null}
              items={chosen.map((x) => ({ account: x.account, rowId: x.rowId }))}
              totalTiyin={chosenSum}
              beforeRoute={async () => true}
              onToast={onToast}
              onDone={reload}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
