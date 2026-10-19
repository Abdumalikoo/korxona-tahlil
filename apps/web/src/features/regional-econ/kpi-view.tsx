'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { FIELD } from '@/features/purchases/bits';
import { MonthPicker } from '@/features/regional-desk/bits';
import { compact } from '@/features/structure/api';
import { KpiStrip, PanelHeader, SmallButton } from '@/features/structure/parts';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { currentMonth } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, useState } from 'react';
import { type KpiCell, type KpiList, kpiApi, share } from './api';

// ═══════════════════════════════════════════════════════════
// Katta modellar › KPI (H): hudud × oy × ko'rsatkich (daromad, xarajat, natija).
// Model taklifi → taklif etilgan → tasdiqlangan → fakt va bajarilish; har qadam tarixda.
// Yozish — faqat administrator; kuzatuvchi ko'radi.
// ═══════════════════════════════════════════════════════════

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';
const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Qoralama', cls: 'bg-slate-100 text-slate-700' },
  PROPOSED: { label: 'Taklif etilgan', cls: 'bg-sky-100 text-sky-800' },
  APPROVED: { label: 'Tasdiqlangan', cls: 'bg-emerald-100 text-emerald-800' },
};
const STATE: Record<string, { label: string; cls: string }> = {
  met: { label: 'Bajarildi', cls: 'text-(--color-income)' },
  near: { label: 'Yaqin', cls: 'text-amber-700' },
  missed: { label: 'Bajarilmadi', cls: 'text-(--color-expense)' },
  none: { label: '', cls: 'text-(--color-text-muted)' },
};
const n = (t: string | null | undefined) => (t ? Number(t) : 0);
/** "1 250 000,5" yoki "-300000" → tiyin satri */
function somToTiyin(raw: string): string | null {
  const s = raw.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{0,2})?$/.test(s)) return null;
  return String(Math.round(Number(s) * 100));
}
const tiyinToSom = (t: string | null) => (t === null ? '' : (Number(t) / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }));

export function KpiView() {
  const { isAdmin } = useAuth();
  const [period, setPeriod] = useState(currentMonth());
  const [tick, setTick] = useState(0);
  const res = useAsync(() => kpiApi.list(period).then((r) => r.data), [period, tick]);
  const [busy, setBusy] = useState<'gen' | 'all' | null>(null);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const [edit, setEdit] = useState<{ cell: KpiCell; region: string } | null>(null);
  const d = res.data;
  const reload = () => setTick((t) => t + 1);
  const run = async (kind: 'gen' | 'all') => {
    setBusy(kind);
    try {
      if (kind === 'gen') {
        const r = await kpiApi.generate(period);
        setToast({ message: `Takliflar: ${r.data.created} yangi, ${r.data.updated} yangilandi${r.data.skipped ? `, ${r.data.skipped} ta (taklif etilgan/tasdiqlangan) o'zgarmadi` : ''}` });
      } else {
        const r = await kpiApi.approveAll(period);
        setToast({ message: `${r.data.approved} ta KPI tasdiqlandi` });
      }
      reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const header = (
    <PanelHeader
      title="KPI"
      description="Hududlar uchun oylik maqsadlar: model taklifi → taklif → tasdiq → fakt"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <MonthPicker value={period} onChange={setPeriod} />
          {isAdmin && (
            <>
              <Button variant="secondary" loading={busy === 'gen'} onClick={() => void run('gen')}>
                Takliflarni hisoblash
              </Button>
              {d && d.counts.PROPOSED > 0 && (
                <Button loading={busy === 'all'} onClick={() => void run('all')}>
                  Taklif etilganlarni tasdiqlash ({d.counts.PROPOSED})
                </Button>
              )}
            </>
          )}
        </div>
      }
    >
      {d && (
        <p className="text-xs text-(--color-text-muted)">
          {d.label}: {d.timing === 'past' ? `o'tgan oy${d.closed ? ', yopilgan' : ', hali yopilmagan'} — fakt bilan bajarilish` : d.timing === 'running' ? 'joriy oy — fakt hali to\'liq emas' : 'kelgusi oy'}
        </p>
      )}
    </PanelHeader>
  );
  if (res.error) return <div className="space-y-4">{header}<Card><ErrorState message={res.error} onRetry={res.reload} /></Card></div>;
  if (!d) return <div className="space-y-4">{header}<Card><LoadingState /></Card></div>;
  const empty = d.counts.missing === d.regions.length * d.metrics.length;
  const tot = (m: string) => d.totals.find((t) => t.metric === m)!;

  return (
    <div className="space-y-4">
      {header}
      <KpiStrip
        items={[
          { label: 'Holat', value: `${d.counts.APPROVED} / ${d.regions.length * d.metrics.length}`, sub: `tasdiqlangan · taklif ${d.counts.PROPOSED} · qoralama ${d.counts.DRAFT}${d.counts.missing ? ` · yo'q ${d.counts.missing}` : ''}` },
          ...(['REVENUE', 'EXPENSE', 'RESULT'] as const).map((m) => {
            const t = tot(m);
            return {
              label: t.label,
              value: t.regions ? `${compact(t.actualTiyin)} / ${compact(t.approvedTiyin)}` : '—',
              // joriy oyda fakt — hozircha yozilgani
              valueClass: t.achievement !== null && d.timing === 'past' ? (t.achievement >= 1 ? 'text-(--color-income)' : t.achievement >= 0.95 ? 'text-amber-700' : 'text-(--color-expense)') : 'text-heading',
              sub: !t.regions ? "tasdiqlangan maqsad yo'q" : d.timing === 'past' ? `fakt / maqsad · bajarilish ${share(t.achievement)} (${t.regions} hudud)` : `hozircha yozilgan / maqsad (${t.regions} hudud) — oy tugagach baholanadi`,
            };
          }),
        ]}
      />
      {empty ? (
        <Card>
          <div className="px-5 py-8 text-center text-sm text-(--color-text-muted)">
            {d.label} uchun KPI hali yo&apos;q.{isAdmin ? ' «Takliflarni hisoblash» tugmasini bosing — model salohiyat, prognoz va reja asosida taklif beradi.' : ''}
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-(--color-line) px-5 py-2.5">
            <p className="text-xs text-(--color-text-muted)">
              {d.timing === 'past' ? `Bajarilish: daromad va natija — fakt ÷ maqsad; xarajat — maqsad ÷ fakt.` : 'Qatorni bosing — qiymat kiritish, tasdiqlash va tarix'}
            </p>
            <SmallButton
              onClick={() =>
                downloadCsv(
                  `KPI-${d.period}.csv`,
                  ['Hudud', "Ko'rsatkich", 'Model taklifi', 'Taklif etilgan', 'Tasdiqlangan', 'Holat', 'Fakt', 'Bajarilish %'],
                  d.regions.flatMap((r) =>
                    r.metrics.map((c) => [r.name, c.label, c.suggestedTiyin ? csvSom(c.suggestedTiyin) : '', c.proposedTiyin ? csvSom(c.proposedTiyin) : '', c.approvedTiyin ? csvSom(c.approvedTiyin) : '', c.status ? STATUS[c.status]!.label : '', c.actualTiyin ? csvSom(c.actualTiyin) : '', c.achievement === null ? '' : (c.achievement * 100).toFixed(1).replace('.', ',')]),
                  ),
                  [],
                )
              }
            >
              CSV
            </SmallButton>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-(--color-surface-muted) text-left">
                <tr>
                  <th className={TH}>Ko&apos;rsatkich</th>
                  <th className={cn(TH, 'text-right')}>Model taklifi</th>
                  <th className={cn(TH, 'text-right')}>Taklif etilgan</th>
                  <th className={cn(TH, 'text-right')}>Tasdiqlangan</th>
                  <th className={TH}>Holat</th>
                  <th className={cn(TH, 'text-right')}>Fakt</th>
                  <th className={cn(TH, 'text-right')}>Bajarilish</th>
                </tr>
              </thead>
              <tbody>
                {d.regions.map((r) => (
                  <Fragment key={r.code}>
                    <tr className="bg-brand-50/60">
                      <td colSpan={7} className="px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-brand-700">
                        {r.name}
                      </td>
                    </tr>
                    {r.metrics.map((c) => (
                      <tr key={c.metric} onClick={() => c.id && setEdit({ cell: c, region: r.name })} className={cn('border-t border-(--color-line)', c.id && 'cursor-pointer hover:bg-brand-50/40')}>
                        <td className="px-3 py-1.5 pl-6">
                          {c.label}
                          <span className="ml-1 text-[10px] text-(--color-text-faint)">{c.up ? '≥' : '≤'}</span>
                        </td>
                        <td className="money px-3 py-1.5 text-right text-(--color-text-muted)">{c.suggestedTiyin ? compact(c.suggestedTiyin) : '—'}</td>
                        <td className="money px-3 py-1.5 text-right">{c.proposedTiyin ? compact(c.proposedTiyin) : '—'}</td>
                        <td className="money px-3 py-1.5 text-right font-semibold">{c.approvedTiyin ? compact(c.approvedTiyin) : '—'}</td>
                        <td className="px-3 py-1.5">
                          {c.status ? <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', STATUS[c.status]!.cls)}>{STATUS[c.status]!.label}</span> : <span className="text-xs text-(--color-text-faint)">yo&apos;q</span>}
                          {c.history > 1 && <span className="ml-1.5 text-[10px] text-(--color-text-muted)">{c.history} qadam</span>}
                        </td>
                        <td className={cn('money px-3 py-1.5 text-right', n(c.actualTiyin) < 0 && 'text-(--color-expense)', d.timing === 'running' && 'text-(--color-text-muted)')} title={d.timing === 'running' ? 'Hozircha yozilgan (oy tugamagan)' : undefined}>
                          {c.actualTiyin === null ? '—' : compact(c.actualTiyin)}
                        </td>
                        <td className={cn('money px-3 py-1.5 text-right font-semibold', STATE[c.state]!.cls)}>
                          {c.achievement !== null ? share(c.achievement) : c.state !== 'none' ? '' : '—'}
                          {c.state !== 'none' && <div className="text-[10px] font-normal">{STATE[c.state]!.label}</div>}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Card>
        <div className="px-5 py-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Qanday hisoblanadi</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {d.method.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      </Card>
      {edit && <KpiDrawer d={d} cell={edit.cell} region={edit.region} canEdit={isAdmin} onClose={() => setEdit(null)} onDone={(m) => { setToast({ message: m }); setEdit(null); reload(); }} onError={(m) => setToast({ message: m, tone: 'error' })} />}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 6000 : 3000} />}
    </div>
  );
}

function KpiDrawer({ d, cell, region, canEdit, onClose, onDone, onError }: { d: KpiList; cell: KpiCell; region: string; canEdit: boolean; onClose: () => void; onDone: (m: string) => void; onError: (m: string) => void }) {
  const hist = useAsync(() => kpiApi.history(cell.id!).then((r) => r.data), [cell.id]);
  const start = cell.status === 'APPROVED' ? cell.approvedTiyin : (cell.proposedTiyin ?? cell.suggestedTiyin);
  const [value, setValue] = useState(tiyinToSom(start));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const tiyin = somToTiyin(value);
  const base = cell.suggestedTiyin ? n(cell.suggestedTiyin) : 0;
  const dev = tiyin !== null && base ? Number(tiyin) / base - 1 : null;
  const b = cell.basis ?? {};
  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      onDone(msg);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title={`${region}: ${cell.label}`}
      description={`${d.label} · ${cell.status ? STATUS[cell.status]!.label : ''}`}
      footer={
        canEdit ? (
          <div className="flex flex-wrap justify-end gap-2">
            {cell.status === 'APPROVED' ? (
              <Button variant="secondary" loading={busy} onClick={() => void act(() => kpiApi.reopen(cell.id!, note), 'KPI qayta ochildi')}>
                Qayta ochish
              </Button>
            ) : (
              <>
                {cell.status === 'PROPOSED' && (
                  <Button variant="secondary" loading={busy} onClick={() => void act(() => kpiApi.reject(cell.id!, note), 'Rad etildi')}>
                    Rad etish
                  </Button>
                )}
                <Button variant="secondary" loading={busy} disabled={tiyin === null} onClick={() => void act(() => kpiApi.propose(cell.id!, tiyin!, note.trim() || null), 'Taklif etildi')}>
                  Taklif etish
                </Button>
                <Button data-save loading={busy} disabled={tiyin === null} onClick={() => void act(() => kpiApi.approve(cell.id!, tiyin, note.trim() || null), 'Tasdiqlandi')}>
                  Tasdiqlash
                </Button>
              </>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-(--color-line) bg-(--color-surface-muted) px-3 py-2.5">
          <p className="text-xs font-semibold text-heading">Model taklifi: {cell.suggestedTiyin ? `${compact(cell.suggestedTiyin)} so'm` : '—'}</p>
          <ul className="mt-1 space-y-0.5 text-xs text-(--color-text-muted)">
            {b.baseLabel && <li>Asos: {b.baseLabel} gacha ma&apos;lumot ({b.step} oy oldinga)</li>}
            {b.potentialTiyin && <li>Daromad salohiyati: {compact(b.potentialTiyin)}{b.revenueSource === 'POTENTIAL' && cell.metric !== 'EXPENSE' ? ' ← olingan' : ''}</li>}
            {b.forecastRevenueTiyin && <li>Daromad prognozi: {compact(b.forecastRevenueTiyin)}{b.revenueSource === 'FORECAST' && cell.metric !== 'EXPENSE' ? ' ← olingan' : ''}</li>}
            {b.budgetTiyin && <li>Xarajat rejasi: {compact(b.budgetTiyin)}{cell.metric !== 'REVENUE' ? (b.expenseSource === 'MIXED' ? ' ← olingan (rejadagi moddalar)' : ' ← olingan') : ''}</li>}
            {b.forecastExpenseTiyin && <li>Xarajat prognozi: {compact(b.forecastExpenseTiyin)}{cell.metric !== 'REVENUE' ? (b.expenseSource === 'FORECAST' ? ' ← olingan' : b.expenseSource === 'MIXED' ? ' ← rejada yo\'q qism olingan' : '') : ''}</li>}
          </ul>
        </div>
        {cell.actualTiyin !== null && (
          <p>
            Fakt: <b>{compact(cell.actualTiyin)}</b>
            {cell.achievement !== null && <span className={cn('ml-2', STATE[cell.state]!.cls)}>bajarilish {share(cell.achievement)}</span>}
          </p>
        )}
        {canEdit && (
          <>
            <div>
              <p className="mb-1.5 font-medium text-heading">Qiymat (so&apos;m){cell.metric === 'RESULT' ? ' — manfiy bo\'lishi mumkin' : ''}</p>
              <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" disabled={cell.status === 'APPROVED'} className={cn(FIELD, 'text-right', tiyin === null && 'border-red-300')} />
              {dev !== null && Math.abs(dev) > 0.0005 && <p className={cn('mt-1 text-xs', Math.abs(dev) > 0.05 ? 'text-amber-700' : 'text-(--color-text-muted)')}>Model taklifidan {share(dev, true)}{Math.abs(dev) > 0.05 ? ' — izoh majburiy' : ''}</p>}
            </div>
            <div>
              <p className="mb-1.5 font-medium text-heading">Izoh</p>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={cn(FIELD, 'h-auto py-2')} placeholder={cell.status === 'APPROVED' ? 'Qayta ochish sababi (majburiy)' : 'Nega shu qiymat (taklifdan farq qilsa — majburiy)'} />
            </div>
          </>
        )}
        <div>
          <p className="mb-1.5 font-medium text-heading">Tarix</p>
          {hist.data ? (
            <ul className="divide-y divide-(--color-line) rounded-lg border border-(--color-line)">
              {hist.data.map((l) => (
                <li key={l.id} className="px-3 py-2 text-xs">
                  <div className="flex justify-between gap-2">
                    <b className="text-heading">{l.actionLabel}</b>
                    <span className="text-(--color-text-muted)">{new Date(l.at).toLocaleString('ru-RU')}</span>
                  </div>
                  <div className="text-(--color-text-muted)">
                    {l.valueTiyin !== null && `${compact(l.valueTiyin)} so'm`}
                    {l.by && ` · ${l.by}`}
                  </div>
                  {l.note && <div className="mt-0.5 text-(--color-text)">«{l.note}»</div>}
                </li>
              ))}
            </ul>
          ) : (
            <LoadingState />
          )}
        </div>
      </div>
    </Drawer>
  );
}