'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonClass } from '@/components/ui/button';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { SearchInput } from '@/components/shared/search-input';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';
import { hpApi, MODEL_SHORT, monthName, pct, short, som, type PlanVersion, type RegionRow } from './api';
import { ApproveDrawer, ExportMenu } from './actions';
import { BacktestChart, BarList, PALETTE, TrendChart } from './charts';
import { ServicesTable } from './services';
import { Banner, Change, HpBar, hpHref, Insufficient, Kpi, NoRun, Panel, PlanPill, SortTh, tdCls, thCls, useHp, useSort } from './ui';

// ═══════════════════════════════════════════════════════════
// Hududlar bo'yicha reja: jadval (saralash, qidiruv), tasdiqlash, versiyalar; hudud sahifasi.
// ═══════════════════════════════════════════════════════════

const QUALITY_CLS: Record<RegionRow['quality']['key'], string> = {
  good: 'text-(--color-income)',
  partial: 'text-amber-700',
  low: 'text-(--color-expense)',
};

export function HpRegions() {
  const hp = useHp();
  const { isAdmin } = useAuth();
  const [tick, setTick] = useState(0);
  const q = useAsync(() => (hp.run ? hpApi.regions(hp.run.id).then((r) => r.data) : Promise.resolve(null)), [hp.run?.id, tick]);
  const plans = useAsync(() => hpApi.plans(hp.target).then((r) => r.data), [hp.target, tick]);
  const [search, setSearch] = useState('');
  const [approve, setApprove] = useState<number[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const rows = (q.data ?? []).filter((r) => !search || r.name.toLowerCase().includes(search.toLowerCase()));
  const { sorted, sort, toggle } = useSort(rows, { key: 'forecastRev', dir: 'desc' }, (r, k) => {
    if (k === 'name') return r.name;
    if (k === 'plan') return r.plan.status;
    return (r as unknown as Record<string, number | null>)[k] ?? null;
  });
  const data = q.data ?? [];
  const total = data.reduce((a, r) => a + r.forecastRev, 0);
  const last = data.reduce((a, r) => a + (r.lastRev ?? 0), 0);
  const approved = data.filter((r) => r.plan.status === 'APPROVED').length;
  const low = data.filter((r) => r.quality.key === 'low').length;
  const reload = () => {
    setTick((t) => t + 1);
    hp.reload();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Hududlar bo‘yicha reja"
        description="Hudud prognozi = uning xizmatlari prognozlari yig‘indisi (soni × tarif)"
        actions={
          <>
            {isAdmin && hp.run && (
              <Button size="sm" onClick={() => setApprove([])}>
                Tasdiqlash
              </Button>
            )}
            <ExportMenu run={hp.run} />
          </>
        }
      />
      <HpBar hp={hp} />
      {!hp.run ? (
        hp.runsLoading ? <TableSkeleton rows={6} cols={6} /> : <NoRun hp={hp} what="Hududlar bo‘yicha reja" />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={() => setTick((t) => t + 1)} />
      ) : !q.data ? (
        <TableSkeleton rows={8} cols={8} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi tone="brand" label={`Prognoz — ${monthName(hp.target)}`} value={`${som(total)} so‘m`} hint={`${data.length} hudud`} />
            <Kpi label="Oxirgi oy (haqiqiy)" value={`${som(last)} so‘m`} hint={<Change value={last ? ((total - last) / last) * 100 : null} />} />
            <Kpi label="Tasdiqlangan" value={`${approved} / ${data.length}`} tone={approved === data.length ? 'ok' : 'plain'} hint={approved === data.length ? 'Barcha hududlar tasdiqlangan' : 'Qolganlari «Hisoblangan» holatida'} />
            <Kpi label="Ma’lumoti yetarli emas" value={low} tone={low ? 'warn' : 'ok'} hint={low ? 'Bu hududlarda prognoz ishonchliligi past' : 'Hamma hududda tarix yetarli'} />
          </div>

          <Panel title="Hududlar" actions={<SearchInput value={search} onChange={setSearch} placeholder="Hudud qidirish" className="w-56" />} flush>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--color-border)">
                    <SortTh label="Hudud" k="name" sort={sort} onSort={toggle} align="left" />
                    <SortTh label="Oxirgi oy" k="lastRev" sort={sort} onSort={toggle} />
                    <SortTh label="Prognoz" k="forecastRev" sort={sort} onSort={toggle} />
                    <SortTh label="O‘zgarish" k="changePct" sort={sort} onSort={toggle} />
                    <th className={cn(thCls, 'text-left')}>Asosiy model</th>
                    <SortTh label="Xato (WAPE)" k="wape" sort={sort} onSort={toggle} title="Tarixiy testdagi o‘rtacha nisbiy xato — kichigi yaxshi" />
                    <th className={cn(thCls, 'text-left')}>Ma’lumot</th>
                    <SortTh label="Xodimlarga" k="employeesTotal" sort={sort} onSort={toggle} />
                    <SortTh label="Taqsimlanmagan" k="unallocated" sort={sort} onSort={toggle} />
                    <SortTh label="Holat" k="plan" sort={sort} onSort={toggle} align="left" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.code} className="border-b border-(--color-border) last:border-0 hover:bg-slate-50">
                      <td className={cn(tdCls, 'whitespace-nowrap')}>
                        <Link href={hpHref(`/hudud-reja/hududlar/${r.code}`, hp.target)} className="font-medium text-heading hover:text-brand-700 hover:underline">
                          {r.name}
                        </Link>
                      </td>
                      <td className={cn(tdCls, 'money text-right text-(--color-text-muted)')}>{r.lastRev === null ? <Insufficient text="yo‘q" /> : short(r.lastRev)}</td>
                      <td className={cn(tdCls, 'money text-right font-semibold')}>{r.servicesForecast === 0 ? <Insufficient /> : short(r.forecastRev)}</td>
                      <td className={cn(tdCls, 'text-right')}>
                        <Change value={r.changePct} />
                        {r.diff !== null && <span className="money block text-[11px] text-(--color-text-muted)">{r.diff > 0 ? '+' : ''}{short(r.diff)}</span>}
                      </td>
                      <td className={cn(tdCls, 'whitespace-nowrap text-xs')}>{r.mainModel ? `${MODEL_SHORT[r.mainModel.key] ?? r.mainModel.label} (${r.mainModel.count})` : '—'}</td>
                      <td className={cn(tdCls, 'money text-right')}>{r.wape === null ? <Insufficient text="aniqlanmagan" /> : pct(r.wape)}</td>
                      <td className={cn(tdCls, 'whitespace-nowrap text-xs')}>
                        <span className={cn('block font-semibold', QUALITY_CLS[r.quality.key])}>{r.quality.label}</span>
                        <span className="text-(--color-text-muted)">
                          {r.monthsReported}/{r.months} oy
                        </span>
                      </td>
                      <td className={cn(tdCls, 'money text-right')}>{r.employeesTotal === null ? '—' : short(r.employeesTotal)}</td>
                      <td className={cn(tdCls, 'money text-right', r.unallocated ? 'text-amber-700' : 'text-(--color-text-muted)')}>{r.unallocated ? short(r.unallocated) : '—'}</td>
                      <td className={tdCls}>
                        <PlanPill plan={r.plan} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-(--color-border) bg-slate-50 font-semibold">
                    <td className={tdCls}>Jami</td>
                    <td className={cn(tdCls, 'money text-right')}>{short(last)}</td>
                    <td className={cn(tdCls, 'money text-right')}>{short(total)}</td>
                    <td className={cn(tdCls, 'text-right')}>
                      <Change value={last ? ((total - last) / last) * 100 : null} />
                      <span className="money block text-[11px] font-normal text-(--color-text-muted)">{short(total - last)}</span>
                    </td>
                    <td colSpan={3} />
                    <td className={cn(tdCls, 'money text-right')}>{short(data.reduce((a, r) => a + (r.employeesTotal ?? 0), 0))}</td>
                    <td className={cn(tdCls, 'money text-right')}>{short(data.reduce((a, r) => a + (r.unallocated ?? 0), 0))}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Panel>

          <Versions plans={plans.data ?? []} canWrite={isAdmin} onRestored={(m) => (setToast(m), reload())} />

          <Panel title="Prognoz va oxirgi oy" description="Har hudud: kelasi oy prognozi (ko‘k) — kulrang yozuvda oxirgi oy haqiqiy">
            <BarList rows={[...data].sort((a, b) => b.forecastRev - a.forecastRev).map((r) => ({ key: String(r.code), label: r.name, value: r.servicesForecast ? r.forecastRev : null, hint: r.lastRev === null ? 'oxirgi oy: yo‘q' : `oxirgi oy: ${short(r.lastRev)}` }))} />
          </Panel>
        </>
      )}

      {hp.run && (
        <ApproveDrawer
          open={approve !== null}
          run={hp.run}
          preselect={approve && approve.length ? approve : undefined}
          regions={data.map((r) => ({ code: r.code, name: r.name, forecastRev: r.forecastRev, unallocated: r.unallocated, plan: r.plan }))}
          onClose={() => setApprove(null)}
          onDone={(m) => {
            setApprove(null);
            setToast(m);
            reload();
          }}
        />
      )}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function dt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Tasdiqlangan rejalar tarixi: versiyalar, kim/qachon, tiklash */
export function Versions({ plans, canWrite, onRestored, region }: { plans: PlanVersion[]; canWrite: boolean; onRestored: (m: string) => void; region?: number }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = region ? plans.filter((p) => p.regionCode === region) : plans;
  const restore = async (v: PlanVersion) => {
    setBusy(v.id);
    setError(null);
    try {
      const r = await hpApi.restore(v.id, `v${v.version} tiklandi`);
      onRestored(`${v.regionName}: v${v.version} tiklandi → v${r.data.version}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tiklab bo‘lmadi');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Panel title="Tasdiqlangan rejalar va versiyalar" description="Har tasdiqlash — yangi versiya. Eskisi o‘chirilmaydi, kerak bo‘lsa tiklanadi (yangi versiya sifatida)" flush>
      {error && (
        <div className="px-5 pt-4">
          <Banner tone="bad">{error}</Banner>
        </div>
      )}
      {list.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-(--color-text-muted)">Bu oy uchun hali tasdiqlangan reja yo‘q — barcha natijalar «Hisoblangan» holatida</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-(--color-border)">
                {!region && <th className={cn(thCls, 'text-left')}>Hudud</th>}
                <th className={cn(thCls, 'text-left')}>Versiya</th>
                <th className={cn(thCls, 'text-left')}>Holat</th>
                <th className={cn(thCls, 'text-right')}>Prognoz</th>
                <th className={cn(thCls, 'text-right')}>Xodimlarga</th>
                <th className={cn(thCls, 'text-right')}>Taqsimlanmagan</th>
                <th className={cn(thCls, 'text-left')}>Kim, qachon</th>
                <th className={cn(thCls, 'text-left')}>Izoh</th>
                <th className={thCls} />
              </tr>
            </thead>
            <tbody>
              {list.map((v) => (
                <tr key={v.id} className={cn('border-b border-(--color-border) last:border-0', v.status === 'SUPERSEDED' && 'text-(--color-text-muted)')}>
                  {!region && <td className={cn(tdCls, 'font-medium')}>{v.regionName}</td>}
                  <td className={cn(tdCls, 'font-semibold')}>
                    v{v.version}
                    {v.restoredFrom && <span className="ml-1 text-[11px] font-normal text-(--color-text-muted)">(tiklangan)</span>}
                  </td>
                  <td className={tdCls}>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', v.status === 'APPROVED' ? 'bg-(--color-income-soft) text-(--color-income)' : 'bg-(--color-surface-sunken) text-(--color-text-muted)')}>{v.status === 'APPROVED' ? 'Amalda' : 'Almashtirilgan'}</span>
                  </td>
                  <td className={cn(tdCls, 'money text-right')}>{short(v.forecast)}</td>
                  <td className={cn(tdCls, 'money text-right')}>{short(v.employees)}</td>
                  <td className={cn(tdCls, 'money text-right')}>{v.unallocated ? short(v.unallocated) : '—'}</td>
                  <td className={cn(tdCls, 'whitespace-nowrap text-xs')}>
                    {v.approvedBy ?? '—'} · {dt(v.approvedAt)}
                  </td>
                  <td className={cn(tdCls, 'max-w-56 truncate text-xs')} title={v.note ?? ''}>
                    {v.note ?? ''}
                  </td>
                  <td className={cn(tdCls, 'text-right')}>
                    {canWrite && v.status === 'SUPERSEDED' && (
                      <button type="button" disabled={busy !== null} onClick={() => restore(v)} className="whitespace-nowrap text-xs font-semibold text-brand-700 hover:underline disabled:opacity-50">
                        {busy === v.id ? '…' : 'Tiklash'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ───────────────────────── Bitta hudud ─────────────────────────

export function HpRegion({ code }: { code: number }) {
  const hp = useHp();
  const { isAdmin } = useAuth();
  const [tick, setTick] = useState(0);
  const regs = useAsync(() => (hp.run ? hpApi.regions(hp.run.id).then((r) => r.data) : Promise.resolve(null)), [hp.run?.id, tick]);
  const ov = useAsync(() => hpApi.overview({ target: hp.target, source: hp.run?.params.source ?? 'merged', region: code, runId: hp.run?.id ?? null }).then((r) => r.data), [hp.target, code, hp.run?.id, tick]);
  const plans = useAsync(() => hpApi.plans(hp.target).then((r) => r.data), [hp.target, tick]);
  const [approve, setApprove] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const r = regs.data?.find((x) => x.code === code) ?? null;
  const name = r?.name ?? hp.run?.summary?.regions.find((x) => x.code === code)?.name ?? `Hudud ${code}`;
  const fc = ov.data?.forecast;
  const reload = () => {
    setTick((t) => t + 1);
    hp.reload();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={name}
        description="Hudud uchun reja: xizmatlar prognozi, aniqlik, xodimlar va versiyalar"
        actions={
          <>
            <Link href={hpHref('/hudud-reja/hududlar', hp.target)} className={buttonClass('ghost', 'sm')}>
              ← Hududlar
            </Link>
            <Link href={hpHref('/hudud-reja/xodimlar', hp.target, { hudud: code })} className={buttonClass('secondary', 'sm')}>
              Xodimlar rejasi
            </Link>
            {isAdmin && r && (
              <Button size="sm" onClick={() => setApprove(true)}>
                Tasdiqlash
              </Button>
            )}
          </>
        }
      />
      <HpBar hp={hp} />
      {!hp.run ? (
        hp.runsLoading ? <TableSkeleton rows={6} cols={6} /> : <NoRun hp={hp} what="Hudud rejasi" />
      ) : !r ? (
        regs.data ? <Banner tone="warn">Bu hisobda «{name}» hududi yo‘q (ma’lumoti bo‘lmagan yoki hisobga tanlanmagan).</Banner> : <TableSkeleton rows={6} cols={6} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi tone="brand" label={`Prognoz — ${monthName(hp.target)}`} value={r.servicesForecast ? `${som(r.forecastRev)} so‘m` : <Insufficient />} hint={`${r.servicesForecast} xizmat bo‘yicha`} />
            <Kpi label="Oxirgi oy (haqiqiy)" value={r.lastRev === null ? <Insufficient text="Ma’lumot yo‘q" /> : `${som(r.lastRev)} so‘m`} hint={<Change value={r.changePct} />} />
            <Kpi label="Xato (WAPE)" value={r.wape === null ? <Insufficient text="aniqlanmagan" /> : `±${pct(r.wape)}`} tone={r.wape === null ? 'plain' : r.wape > 30 ? 'bad' : r.wape > 15 ? 'warn' : 'ok'} hint={`${r.accuracyPoints} oylik tarixiy test`} />
            <Kpi label="Ma’lumot" value={r.quality.label} tone={r.quality.key === 'good' ? 'ok' : r.quality.key === 'partial' ? 'warn' : 'bad'} hint={`${r.monthsReported} / ${r.months} oyda hisobot bor`} />
            <Kpi label="Holat" value={<PlanPill plan={r.plan} />} hint={r.unallocated ? `Taqsimlanmagan: ${som(r.unallocated)} so‘m` : r.employeesTotal ? 'Xodimlarga to‘liq taqsimlangan' : 'Xodimlar ma’lumoti yo‘q'} />
          </div>
          {r.servicesNoData.length > 0 && <Banner tone="warn">Tarixi yetarli bo‘lmagan xizmatlar: {r.servicesNoData.join(', ')} — ular uchun prognoz «Ma’lumot yetarli emas».</Banner>}

          <ServicesTable runId={hp.run.id} region={code} target={hp.target} />

          <Versions plans={plans.data ?? []} region={code} canWrite={isAdmin} onRestored={(m) => (setToast(m), reload())} />

          <div className="grid gap-5 xl:grid-cols-3">
            <Panel title="Daromad dinamikasi" description="Oxirgi 24 oy va prognoz. Bo‘sh oy — ma’lumot yo‘q" className="xl:col-span-2">
              {ov.data ? (
                <TrendChart months={ov.data.history.map((h) => h.period)} series={[{ label: 'Haqiqiy daromad', color: PALETTE.blue, values: ov.data.history.map((h) => h.rev) }]} forecast={fc ? { period: hp.target, value: fc.total, label: 'Prognoz' } : null} />
              ) : (
                <TableSkeleton rows={4} cols={3} />
              )}
            </Panel>
            <Panel title="Tarixiy test" description={fc?.selectionNote}>
              {fc?.accuracy ? <BacktestChart months={fc.accuracy.months} actual={fc.accuracy.actual} forecast={fc.accuracy.forecast} /> : <p className="py-10 text-center text-sm text-(--color-text-muted)">Ma’lumot yetarli emas</p>}
            </Panel>
          </div>
        </>
      )}
      {hp.run && r && (
        <ApproveDrawer
          open={approve}
          run={hp.run}
          preselect={[code]}
          regions={[{ code: r.code, name: r.name, forecastRev: r.forecastRev, unallocated: r.unallocated, plan: r.plan }]}
          onClose={() => setApprove(false)}
          onDone={(m) => {
            setApprove(false);
            setToast(m);
            reload();
          }}
        />
      )}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}