'use client';

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

function GroupRow({ g, open, onToggle, residual }: { g: ReportGroup; open: boolean; onToggle: () => void; residual: boolean }) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-brand-50/50" onClick={onToggle}>
        <td className="py-2 pl-4 pr-3">
          <span className="mr-1.5 inline-block w-3 text-(--color-text-faint)">{open ? '▾' : '▸'}</span>
          <span className="font-medium text-heading">{g.label}</span>
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{g.count}</td>
        <td className="px-3 py-2 text-right tabular-nums">{g.quantity}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{compact(g.costTiyin)}</td>
        {residual && <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">{compact(g.residualTiyin)}</td>}
        <td className="py-2 pl-3 pr-4 text-xs text-(--color-text-muted)">
          <span className="line-clamp-1">{g.holders.map((h) => `${h.name} (${h.count})`).join(', ')}</span>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={residual ? 6 : 5} className="bg-(--color-surface-muted) px-4 py-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {g.holders.map((h) => (
                <span key={h.name} className="rounded-full bg-white px-2.5 py-0.5 text-xs shadow-card">
                  {h.name}: <b>{h.count}</b> ta · {compact(h.costTiyin)}
                </span>
              ))}
            </div>
            <div className="max-h-96 overflow-auto rounded-(--radius-control) border border-(--color-line) bg-white">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-(--color-text-muted)">
                    <th className="px-3 py-1.5">Sana</th>
                    <th className="px-3 py-1.5">Nomi</th>
                    <th className="px-3 py-1.5">Inventar</th>
                    <th className="px-3 py-1.5 text-right">Soni</th>
                    <th className="px-3 py-1.5 text-right">Qiymat</th>
                    <th className="px-3 py-1.5">Qabul qiluvchi</th>
                    <th className="px-3 py-1.5">Fayldagi bo&apos;lim</th>
                    <th className="px-3 py-1.5">Rejim</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--color-line)">
                  {g.items.map((it) => (
                    <tr key={it.id}>
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
          </td>
        </tr>
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
                  <th className={cn(TH, 'pl-4 text-left')}>Joy — balansda ({formatDate(r.at)})</th>
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
                    <td colSpan={6} className="px-4 py-6 text-center text-(--color-text-muted)">
                      Bu sanada balansda vosita yo&apos;q
                    </td>
                  </tr>
                ) : (
                  r.balance.groups.map((g) => <GroupRow key={g.key} g={g} open={open.has(`b|${g.key}`)} onToggle={() => toggle(`b|${g.key}`)} residual />)
                )}
              </tbody>
              <tfoot className="border-t-2 border-(--color-line) bg-(--color-surface-muted) font-semibold">
                <tr>
                  <td className="py-2 pl-4">Jami balansda</td>
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
                  {r.expensed.groups.map((g) => (
                    <GroupRow key={g.key} g={g} open={open.has(`x|${g.key}`)} onToggle={() => toggle(`x|${g.key}`)} residual={false} />
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