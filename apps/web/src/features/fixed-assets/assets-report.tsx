'use client';

import { ExpandBox, NestedRow, nestHead } from '@/components/report/nested';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { compact } from '@/features/structure/api';
import { errorMessage } from '@/lib/error-message';
import { formatDate, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { assetsApi, downloadBalanceReport, type ReportGroup } from './api';

// ═══════════════════════════════════════════════════════════
// Balans hisoboti: sanaga — qaysi joyda (hudud / Markaz bo'limi), kimda, qancha asosiy vosita.
// Xarajatga o'tkazilganlar alohida (balansda emas). Excel'ga yuklab olish.
// ═══════════════════════════════════════════════════════════

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';

function GroupRow({ g, no, open, onToggle, residual }: { g: ReportGroup; no: number; open: boolean; onToggle: () => void; residual: boolean }) {
  const h = nestHead(1);
  return (
    <>
      <tr className={cn('cursor-pointer hover:bg-brand-50/50', open && 'bg-brand-50/60')} onClick={onToggle}>
        <td className="w-12 py-2 pl-4 pr-1 text-center text-(--color-text-faint)">{no}</td>
        <td className="px-3 py-2">
          <span className="flex items-center gap-1.5">
            <ExpandBox open={open} onClick={onToggle} />
            <span className="font-medium text-heading">{g.label}</span>
          </span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{g.count}</td>
        <td className="px-3 py-2 text-right tabular-nums">{g.quantity}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{compact(g.costTiyin)}</td>
        {residual && <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{compact(g.residualTiyin)}</td>}
        <td className="py-2 pl-3 pr-4 text-xs text-(--color-text-muted)">
          <span className="line-clamp-1">{g.holders.map((x) => `${x.name} (${x.count})`).join(', ')}</span>
        </td>
      </tr>
      {open && (
        <NestedRow colSpan={residual ? 7 : 6}>
          <div className="flex flex-wrap gap-1.5 border-b border-(--color-line) px-3 py-2">
            {g.holders.map((x) => (
              <span key={x.name} className="rounded-full bg-(--color-surface-muted) px-2.5 py-0.5 text-xs">
                {x.name}: <b>{x.count}</b> ta · {compact(x.costTiyin)}
              </span>
            ))}
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0">
                <tr>
                  <th className={cn(h, 'w-10 text-center')}>№</th>
                  <th className={cn(h, 'text-left')}>Sana</th>
                  <th className={cn(h, 'text-left')}>Nomi</th>
                  <th className={cn(h, 'text-left')}>Inventar</th>
                  <th className={cn(h, 'text-right')}>Soni</th>
                  <th className={cn(h, 'text-right')}>Qiymat</th>
                  <th className={cn(h, 'text-left')}>Qabul qiluvchi</th>
                  <th className={cn(h, 'text-left')}>Fayldagi bo&apos;lim</th>
                  <th className={cn(h, 'text-left')}>Rejim</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {g.items.map((it, i) => (
                  <tr key={it.id}>
                    <td className="px-2 py-1 text-center text-(--color-text-faint)">{i + 1}</td>
                    <td className="whitespace-nowrap px-3 py-1 tabular-nums">{formatDate(it.date)}</td>
                    <td className="px-3 py-1">{it.name}</td>
                    <td className="px-3 py-1 tabular-nums">{it.inventoryNo ?? '—'}</td>
                    <td className="px-3 py-1 text-right tabular-nums">{it.quantity}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-right tabular-nums">{compact(it.costTiyin)}</td>
                    <td className="px-3 py-1">{it.holderName ?? '—'}</td>
                    <td className="px-3 py-1 text-(--color-text-muted)">{it.placeText ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-(--color-text-muted)">{it.modeLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </NestedRow>
      )}
    </>
  );
}

export function BalanceReportView({ batches }: { batches: { batch: string; count: number }[] }) {
  const [at, setAt] = useState(todayInput());
  const [batch, setBatch] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const res = useAsync(() => assetsApi.report(at, batch || undefined).then((r) => r.data), [at, batch]);
  const r = res.data;
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 border-b border-(--color-line) px-5 py-3">
        <div>
          <p className="text-sm font-semibold text-heading">Balans hisoboti</p>
          <p className="text-xs text-(--color-text-muted)">Sanaga: qayerda, kimda, qancha asosiy vosita turibdi. Qatorni bosing — vositalar ro&apos;yxati.</p>
        </div>
        <label className="ml-auto text-xs text-(--color-text-muted)">
          Sana
          <input type="date" value={at} max={todayInput()} onChange={(e) => e.target.value && setAt(e.target.value)} className="ml-2 h-8 rounded-(--radius-control) border border-(--color-line) px-2 text-sm" />
        </label>
        {batches.length > 0 && (
          <label className="text-xs text-(--color-text-muted)">
            Partiya
            <select value={batch} onChange={(e) => setBatch(e.target.value)} className="ml-2 h-8 max-w-[16rem] rounded-(--radius-control) border border-(--color-line) bg-white px-2 text-sm">
              <option value="">Hammasi</option>
              {batches.map((b) => (
                <option key={b.batch} value={b.batch}>
                  {b.batch} ({b.count})
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              await downloadBalanceReport(at, batch || undefined);
            } catch (e) {
              setErr(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Excel&apos;ga yuklab olish
        </Button>
      </div>
      {err && <p className="px-5 pt-3 text-sm text-red-700">{err}</p>}
      {!r ? (
        <p className="px-5 py-8 text-center text-sm text-(--color-text-muted)">{res.error ? `Yuklab bo'lmadi: ${res.error}` : 'Yuklanmoqda…'}</p>
      ) : (
        <div className="space-y-5 p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ['Balansda', `${r.balance.count} ta`, `${r.balance.quantity} dona`],
                ["Boshlang'ich qiymat", compact(r.balance.costTiyin), "so'm"],
                ['Qoldiq qiymat', compact(r.balance.residualTiyin), `shundan xarajatsiz: ${r.balance.holdCount} ta · ${compact(r.balance.holdTiyin)}`],
                ["Xarajatga o'tkazilgan", `${r.expensed.count} ta`, `${compact(r.expensed.costTiyin)} — Markaz xarajatida`],
              ] as const
            ).map(([k, v, sub]) => (
              <div key={k} className="rounded-xl bg-(--color-surface-muted) px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{k}</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-heading">{v}</p>
                <p className="text-xs text-(--color-text-muted)">{sub}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-(--color-line)">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b border-(--color-line) bg-(--color-surface-muted)">
                <tr>
                  <th className={cn(TH, 'w-12 pl-4 pr-1 text-center')}>№</th>
                  <th className={cn(TH, 'text-left')}>Joy — balansda ({formatDate(r.at)})</th>
                  <th className={cn(TH, 'text-right')}>Vositalar</th>
                  <th className={cn(TH, 'text-right')}>Dona</th>
                  <th className={cn(TH, 'text-right')}>Qiymat</th>
                  <th className={cn(TH, 'text-right')}>Qoldiq</th>
                  <th className={cn(TH, 'pr-4 text-left')}>Kimda</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {r.balance.groups.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-(--color-text-muted)">
                      Bu sanada balansda vosita yo&apos;q
                    </td>
                  </tr>
                ) : (
                  r.balance.groups.map((g, i) => <GroupRow key={g.key} g={g} no={i + 1} open={open.has(`b|${g.key}`)} onToggle={() => toggle(`b|${g.key}`)} residual />)
                )}
              </tbody>
              <tfoot className="border-t-2 border-(--color-line) bg-(--color-surface-muted) font-semibold">
                <tr>
                  <td />
                  <td className="px-3 py-2">Jami balansda</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.balance.count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.balance.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{compact(r.balance.costTiyin)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{compact(r.balance.residualTiyin)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {r.expensed.count > 0 && (
            <div className="overflow-x-auto rounded-xl border border-dashed border-(--color-line-strong)">
              <p className="border-b border-(--color-line) px-4 py-2 text-sm font-semibold text-heading">
                Xarajatga o&apos;tkazilgan — balansda emas, Markaz xarajatida («Asosiy vositalar» guruhi)
              </p>
              <table className="w-full min-w-[720px] text-sm">
                <tbody className="divide-y divide-(--color-line)">
                  {r.expensed.groups.map((g, i) => (
                    <GroupRow key={g.key} g={g} no={i + 1} open={open.has(`x|${g.key}`)} onToggle={() => toggle(`x|${g.key}`)} residual={false} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}