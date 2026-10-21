'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonClass } from '@/components/ui/button';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';
import { download, exportUrl, hpApi, monthName, pct, short, som, type QualityItem } from './api';
import { BacktestChart, BarList, PALETTE, TrendChart } from './charts';
import { Banner, Change, HpBar, hpHref, Insufficient, Kpi, NoRun, Panel, PlanPill, tdCls, thCls, useHp } from './ui';

// ═══════════════════════════════════════════════════════════
// Hudud uchun reja — Dashboard: kelasi oy prognozi, aniqlik, ma'lumot to'liqligi,
// hududlar / xizmatlar / xodimlar qisqacha, ma'lumotlar sifati; grafiklar pastda.
// ═══════════════════════════════════════════════════════════

export function HpDashboard() {
  const hp = useHp();
  const source = hp.run?.params.source ?? 'merged';
  const ov = useAsync(() => hpApi.overview({ target: hp.target, source, region: hp.region, runId: hp.run?.id ?? null }).then((r) => r.data), [hp.target, source, hp.region, hp.run?.id]);
  const quality = useAsync(() => hpApi.quality(hp.target, source).then((r) => r.data), [hp.target, source, hp.tick]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const regions = hp.run?.summary?.regions.map((r) => ({ code: r.code, name: r.name })).sort((a, b) => a.name.localeCompare(b.name, 'uz'));

  const exportFull = async () => {
    if (!hp.run) return;
    setBusy(true);
    setErr(null);
    try {
      await download(exportUrl(hp.run.id, 'full'), `hudud-reja-${hp.target}.xlsx`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Eksport xatosi');
    } finally {
      setBusy(false);
    }
  };

  const d = ov.data;
  const fc = d?.forecast ?? null;
  const change = fc && d?.lastActual ? ((fc.total - d.lastActual) / d.lastActual) * 100 : null;
  const regionName = hp.region ? (regions?.find((r) => r.code === hp.region)?.name ?? `Hudud ${hp.region}`) : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Hudud uchun reja"
        description="Kelasi oy uchun statistik prognoz: hududlar, 39 xizmat va xodimlar kesimida"
        actions={
          <>
            <Link href={hpHref('/hudud-reja/prognoz', hp.target)} className={buttonClass('primary', 'sm')}>
              Prognozlash
            </Link>
            {hp.run && (
              <Button variant="secondary" size="sm" loading={busy} onClick={exportFull}>
                Excel (to‘liq hisobot)
              </Button>
            )}
          </>
        }
      />
      <HpBar hp={hp} regions={regions} />
      {err && <Banner tone="bad">{err}</Banner>}

      {ov.error ? (
        <ErrorState message={ov.error} />
      ) : !d ? (
        <TableSkeleton rows={6} cols={5} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi
              tone="brand"
              label={`Prognoz — ${monthName(hp.target)}${regionName ? ` · ${regionName}` : ''}`}
              value={fc ? `${som(fc.total)} so‘m` : '—'}
              hint={fc ? `Model: statistik, ${fc.params.backtestMonths} oylik tarixiy test bilan tanlangan` : 'Hali hisoblanmagan'}
            />
            <Kpi label={`Haqiqiy — ${monthName(d.lastMonth)}`} value={d.lastActual === null ? <Insufficient text="Ma’lumot yo‘q" /> : `${som(d.lastActual)} so‘m`} hint={fc ? <>Prognoz farqi: <Change value={change} /></> : d.sourceLabel} />
            <Kpi
              label="Prognoz aniqligi (tarixiy test)"
              tone={fc?.accuracy?.wape === null || fc?.accuracy?.wape === undefined ? 'plain' : fc.accuracy.wape > 30 ? 'bad' : fc.accuracy.wape > 15 ? 'warn' : 'ok'}
              value={fc?.accuracy?.wape !== null && fc?.accuracy?.wape !== undefined ? `±${pct(fc.accuracy.wape)}` : <Insufficient />}
              hint={fc?.accuracy ? `O‘rtacha nisbiy xato (WAPE), ${fc.accuracy.points} oy bo‘yicha` : 'Tarixiy test uchun ma’lumot yetarli emas'}
            />
            <Kpi
              label="Ma’lumot to‘liqligi"
              tone={!d.completeness ? 'plain' : d.completeness.pct < 70 ? 'bad' : d.completeness.pct < 95 ? 'warn' : 'ok'}
              value={d.completeness ? pct(d.completeness.pct, 0) : <Insufficient />}
              hint={d.completeness ? `Oxirgi ${d.completeness.months} oy × ${d.completeness.regions} hudud: ${d.completeness.have} / ${d.completeness.expected} hisobot` : 'Tarixiy ma’lumot yo‘q'}
            />
            <Kpi
              label="Xodimlar rejasi"
              value={fc ? `${fc.employeesCount} xodim` : '—'}
              tone={fc && fc.unallocated > 0 ? 'warn' : 'plain'}
              hint={fc ? (fc.unallocated > 0 ? `Taqsimlanmagan: ${som(fc.unallocated)} so‘m` : 'Hudud prognozi to‘liq taqsimlangan') : '—'}
            />
          </div>

          {!fc ? (
            <NoRun hp={hp} what="Hududlar, xizmatlar va xodimlar rejasi" />
          ) : (
            <>
              <div className="grid gap-5 xl:grid-cols-2">
                <Panel
                  title="Hududlar bo‘yicha prognoz"
                  description="Hudud = uning xizmatlari prognozlari yig‘indisi"
                  actions={
                    <Link href={hpHref('/hudud-reja/hududlar', hp.target)} className="text-sm font-semibold text-brand-700 hover:underline">
                      Batafsil →
                    </Link>
                  }
                  flush
                >
                  <div className="max-h-[26rem] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-(--color-border)">
                          <th className={cn(thCls, 'text-left')}>Hudud</th>
                          <th className={cn(thCls, 'text-right')}>Prognoz</th>
                          <th className={cn(thCls, 'text-right')}>{monthName(d.lastMonth).replace('-yil', '')}</th>
                          <th className={cn(thCls, 'text-right')}>O‘zgarish</th>
                          <th className={cn(thCls, 'text-left')}>Holat</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fc.regions.map((r) => (
                          <tr key={r.code} className="border-b border-(--color-border) last:border-0 hover:bg-slate-50">
                            <td className={tdCls}>
                              <Link href={hpHref(`/hudud-reja/hududlar/${r.code}`, hp.target)} className="font-medium text-heading hover:text-brand-700 hover:underline">
                                {r.name}
                              </Link>
                            </td>
                            <td className={cn(tdCls, 'money text-right font-semibold')}>{r.insufficient ? <Insufficient /> : short(r.forecastRev)}</td>
                            <td className={cn(tdCls, 'money text-right text-(--color-text-muted)')}>{short(r.lastRev)}</td>
                            <td className={cn(tdCls, 'text-right')}>
                              <Change value={r.lastRev ? ((r.forecastRev - r.lastRev) / r.lastRev) * 100 : null} />
                            </td>
                            <td className={tdCls}>
                              <PlanPill plan={r.plan} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>

                <Panel
                  title="Xizmatlar bo‘yicha prognoz"
                  description="Daromad = prognoz qilingan xizmatlar soni × tarif"
                  actions={
                    <Link href={hpHref('/hudud-reja/xizmatlar', hp.target, { hudud: hp.region })} className="text-sm font-semibold text-brand-700 hover:underline">
                      Barcha {fc.services.length} xizmat →
                    </Link>
                  }
                  flush
                >
                  <div className="max-h-[26rem] overflow-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-white">
                        <tr className="border-b border-(--color-border)">
                          <th className={cn(thCls, 'text-left')}>Xizmat</th>
                          <th className={cn(thCls, 'text-right')}>Prognoz</th>
                          <th className={cn(thCls, 'text-right')}>Oxirgi oy</th>
                          <th className={cn(thCls, 'text-right')}>O‘zgarish</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fc.services.slice(0, 12).map((s) => (
                          <tr key={s.service} className="border-b border-(--color-border) last:border-0">
                            <td className={tdCls}>
                              <span className="mr-1.5 text-[11px] text-(--color-text-muted)">{s.service}</span>
                              <span className="text-heading">{s.name}</span>
                            </td>
                            <td className={cn(tdCls, 'money text-right font-semibold')}>{s.insufficient ? <Insufficient /> : short(s.forecastRev)}</td>
                            <td className={cn(tdCls, 'money text-right text-(--color-text-muted)')}>{short(s.lastRev)}</td>
                            <td className={cn(tdCls, 'text-right')}>
                              <Change value={s.lastRev ? ((s.forecastRev - s.lastRev) / s.lastRev) * 100 : null} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              </div>

              <div className="grid gap-5 xl:grid-cols-2">
                <Panel
                  title="Xodimlar rejasi"
                  description={fc.unallocated > 0 ? `Taqsimlanmagan qism: ${som(fc.unallocated)} so‘m — «Xodimlar» sahifasida qo‘lda biriktiriladi` : 'Hudud prognozi xodimlarga to‘liq taqsimlangan'}
                  actions={
                    <Link href={hpHref('/hudud-reja/xodimlar', hp.target, { hudud: hp.region })} className="text-sm font-semibold text-brand-700 hover:underline">
                      Batafsil →
                    </Link>
                  }
                >
                  <BarList
                    rows={fc.employees.slice(0, 10).map((e) => ({ key: e.pinfl, label: e.name ?? e.pinfl, value: e.plan, hint: e.region }))}
                    color={PALETTE.green}
                    empty="Xodimlar bo‘yicha ma’lumot yuklanmagan — reja faqat hudud darajasida"
                  />
                </Panel>
                <QualityPanel items={quality.data?.items ?? null} loading={quality.loading} target={hp.target} />
              </div>
            </>
          )}

          <div className="grid gap-5 xl:grid-cols-3">
            <Panel title="Daromad dinamikasi" description={`Oxirgi 24 oy (${d.sourceLabel.toLowerCase()})${fc ? ' va kelasi oy prognozi' : ''}. Bo‘sh oy — ma’lumot yo‘q (nol emas)`} className="xl:col-span-2">
              <TrendChart
                months={d.history.map((h) => h.period)}
                series={[{ label: 'Haqiqiy daromad', color: PALETTE.blue, values: d.history.map((h) => h.rev) }]}
                forecast={fc ? { period: hp.target, value: fc.total, label: 'Prognoz' } : null}
              />
            </Panel>
            <Panel title="Tarixiy test: prognoz va haqiqat" description={fc?.accuracy ? fc.selectionNote : 'Hisob bo‘lmasa yoki tarix qisqa bo‘lsa — ko‘rsatilmaydi'}>
              {fc?.accuracy ? <BacktestChart months={fc.accuracy.months} actual={fc.accuracy.actual} forecast={fc.accuracy.forecast} /> : <p className="py-10 text-center text-sm text-(--color-text-muted)">Ma’lumot yetarli emas</p>}
            </Panel>
          </div>
          {fc && !hp.region && (
            <Panel title="Hududlar ulushi" description="Kelasi oy prognozi, so‘m">
              <BarList rows={[...fc.regions].sort((a, b) => b.forecastRev - a.forecastRev).map((r) => ({ key: String(r.code), label: r.name, value: r.insufficient ? null : r.forecastRev, muted: r.plan.status !== 'APPROVED' }))} />
              <p className="mt-3 text-xs text-(--color-text-muted)">Ko‘k — shu hisob bo‘yicha tasdiqlangan reja, kulrang — hali tasdiqlanmagan yoki boshqa hisob tasdiqlangan.</p>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

const LEVEL: Record<QualityItem['level'], { icon: string; cls: string }> = {
  error: { icon: '✕', cls: 'bg-red-100 text-red-700' },
  warning: { icon: '!', cls: 'bg-amber-100 text-amber-700' },
  info: { icon: 'i', cls: 'bg-sky-100 text-sky-700' },
};

export function QualityPanel({ items, loading, target }: { items: QualityItem[] | null; loading: boolean; target: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <Panel
      title="Ma’lumotlar sifati"
      description="Prognozdan oldin e’tibor berish kerak bo‘lgan holatlar (oxirgi 24 oy)"
      actions={
        <Link href={hpHref('/hudud-reja/yuklash', target)} className="text-sm font-semibold text-brand-700 hover:underline">
          Yuklash →
        </Link>
      }
      flush
    >
      {loading && !items ? (
        <div className="p-5">
          <TableSkeleton rows={3} cols={2} />
        </div>
      ) : !items || items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-(--color-income)">✓ Muammo topilmadi</p>
      ) : (
        <ul className="divide-y divide-(--color-border)">
          {items.map((q) => (
            <li key={q.code} className="px-5 py-3">
              <button type="button" onClick={() => setOpen(open === q.code ? null : q.code)} className="flex w-full items-start gap-3 text-left">
                <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', LEVEL[q.level].cls)}>{LEVEL[q.level].icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-heading">{q.title}</span>
                  {q.hint && <span className="block text-xs text-(--color-text-muted)">{q.hint}</span>}
                </span>
                <span className="rounded-full bg-(--color-surface-sunken) px-2 py-0.5 text-xs font-semibold text-heading">{q.count}</span>
                <span className="text-xs text-(--color-text-muted)">{open === q.code ? '▲' : '▼'}</span>
              </button>
              {open === q.code && (
                <ul className="mt-2 max-h-56 space-y-1 overflow-auto pl-8 text-xs text-(--color-text-muted)">
                  {q.items.map((t, i) => (
                    <li key={i}>• {t}</li>
                  ))}
                  {q.count > q.items.length && <li>… yana {q.count - q.items.length} ta</li>}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}