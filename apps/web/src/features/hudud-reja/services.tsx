'use client';

import { PageHeader } from '@/components/layout/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { hpApi, MODEL_SHORT, monthName, pct, qty, short, som } from './api';
import { ExportMenu } from './actions';
import { BarList, PALETTE, TrendChart } from './charts';
import { Banner, Change, HpBar, Insufficient, NoRun, Panel, ReliabilityMix, ReliabilityPill, SortTh, tdCls, thCls, useHp, useSort } from './ui';

// ═══════════════════════════════════════════════════════════
// Xizmatlar bo'yicha reja: 39 xizmat — soni, tarif, daromad, model, aniqlik, ishonchlilik.
// Hudud tanlansa — har qatorni bosib model taqqoslash va tarixni ko'rish mumkin.
// ═══════════════════════════════════════════════════════════

const REL_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };

export function HpServices() {
  const hp = useHp();
  const regions = hp.run?.summary?.regions.map((r) => ({ code: r.code, name: r.name })).sort((a, b) => a.name.localeCompare(b.name, 'uz'));
  return (
    <div className="space-y-5">
      <PageHeader title="Xizmatlar bo‘yicha reja" description="Prognoz qilingan xizmatlar soni × tarif = daromad. Hudud tanlang — har xizmatning modeli va tarixi ochiladi" actions={<ExportMenu run={hp.run} />} />
      <HpBar hp={hp} regions={regions} />
      {!hp.run ? hp.runsLoading ? <TableSkeleton rows={8} cols={8} /> : <NoRun hp={hp} what="Xizmatlar bo‘yicha reja" /> : <ServicesTable runId={hp.run.id} region={hp.region} target={hp.target} withChart />}
    </div>
  );
}

export function ServicesTable({ runId, region, target, withChart }: { runId: string; region: number | null; target: string; withChart?: boolean }) {
  const q = useAsync(() => hpApi.services(runId, region).then((r) => r.data), [runId, region]);
  const [search, setSearch] = useState('');
  const [rel, setRel] = useState<string>('all');
  const [hideZero, setHideZero] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const detail = region !== null;
  const all = q.data?.rows ?? [];
  const rows = all.filter((r) => {
    if (search && !`${r.service} ${r.serviceName}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (hideZero && !r.forecastRev && !r.lastRev) return false;
    if (rel !== 'all' && rel !== 'insufficient' && detail && r.reliability !== rel) return false;
    if (rel === 'insufficient' && r.forecastRev !== null) return false;
    return true;
  });
  const { sorted, sort, toggle } = useSort(rows, { key: 'forecastRev', dir: 'desc' }, (r, k) => {
    if (k === 'reliability') return typeof r.reliability === 'string' ? (REL_ORDER[r.reliability] ?? 9) : null;
    if (k === 'model') return r.model ?? null;
    return (r as unknown as Record<string, number | string | null>)[k] ?? null;
  });
  const tot = rows.reduce((a, r) => ({ last: a.last + (r.lastRev ?? 0), fc: a.fc + (r.forecastRev ?? 0) }), { last: 0, fc: 0 });
  const hidden = all.length - rows.length;

  if (q.error) return <ErrorState message={q.error} />;
  if (!q.data) return <TableSkeleton rows={10} cols={9} />;

  return (
    <>
      <Panel
        title={`Xizmatlar${detail ? '' : ' — barcha hududlar jami'}`}
        description={detail ? 'Qatorni bosing — modellar taqqoslanishi, tanlov sababi va tarix' : 'Model va ishonchlilik har hudud uchun alohida tanlanadi — batafsil uchun yuqorida hududni tanlang'}
        actions={
          <>
            <select value={rel} onChange={(e) => setRel(e.target.value)} className="h-9 rounded-lg border border-(--color-border) bg-white px-2 text-sm">
              <option value="all">Barcha ishonchlilik</option>
              {detail && (
                <>
                  <option value="high">Yuqori</option>
                  <option value="medium">O‘rta</option>
                  <option value="low">Past</option>
                  <option value="none">Aniqlanmagan</option>
                </>
              )}
              <option value="insufficient">Ma’lumot yetarli emas</option>
            </select>
            <label className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} />
              Bo‘shlarini yashirish
            </label>
            <SearchInput value={search} onChange={setSearch} placeholder="Xizmat qidirish" className="w-52" />
          </>
        }
        flush
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--color-border)">
                <SortTh label="Xizmat" k="serviceName" sort={sort} onSort={toggle} align="left" />
                <SortTh label="Oxirgi soni" k="lastQty" sort={sort} onSort={toggle} />
                <SortTh label="Prognoz soni" k="forecastQtyFinal" sort={sort} onSort={toggle} />
                <SortTh label="Tarif" k="tariff" sort={sort} onSort={toggle} />
                <SortTh label="Oxirgi daromad" k="lastRev" sort={sort} onSort={toggle} />
                <SortTh label="Prognoz daromad" k="forecastRev" sort={sort} onSort={toggle} />
                <SortTh label="Farq" k="diff" sort={sort} onSort={toggle} />
                <SortTh label="Model" k="model" sort={sort} onSort={toggle} align="left" />
                <SortTh label="WAPE" k="revWape" sort={sort} onSort={toggle} title="Tarixiy testdagi daromad xatosi" />
                <SortTh label="Ishonchlilik" k="reliability" sort={sort} onSort={toggle} align="left" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.service} onClick={detail ? () => setOpen(r.service) : undefined} className={cn('border-b border-(--color-border) last:border-0', detail && 'cursor-pointer hover:bg-slate-50')}>
                  <td className={cn(tdCls, 'max-w-80')}>
                    <span className="block truncate font-medium text-heading" title={r.serviceName}>
                      {r.serviceName}
                    </span>
                    <span className="flex flex-wrap gap-1 text-[11px] text-(--color-text-muted)">
                      {r.service}
                      {r.intermittent && <span className="rounded bg-violet-50 px-1 text-violet-700">uzlukli</span>}
                      {r.tariffSource === 'implied' && <span className="rounded bg-amber-50 px-1 text-amber-700">tarif tarixdan</span>}
                      {r.formulaGap && Math.abs(r.formulaGap.pct ?? 0) >= 5 && <span className="rounded bg-amber-50 px-1 text-amber-700">soni×tarif farqi</span>}
                      {(r.outliers?.length ?? 0) > 0 && <span className="rounded bg-red-50 px-1 text-red-700">keskin qiymat</span>}
                      {!detail && r.regions !== undefined && <span>· {r.regions} hudud</span>}
                    </span>
                  </td>
                  <td className={cn(tdCls, 'money text-right text-(--color-text-muted)')}>{qty(r.lastQty)}</td>
                  <td className={cn(tdCls, 'money text-right font-semibold')}>{r.forecastQtyFinal === null ? <Insufficient /> : qty(r.forecastQtyFinal)}</td>
                  <td className={cn(tdCls, 'money text-right')}>{som(r.tariff)}</td>
                  <td className={cn(tdCls, 'money text-right text-(--color-text-muted)')}>{short(r.lastRev)}</td>
                  <td className={cn(tdCls, 'money text-right font-semibold')}>
                    {r.forecastRev === null ? <Insufficient /> : short(r.forecastRev)}
                    {detail && r.interval && r.tariff ? (
                      <span className="block text-[11px] font-normal text-(--color-text-muted)">
                        {short(r.interval.lo)} — {short(r.interval.hi)}
                      </span>
                    ) : null}
                  </td>
                  <td className={cn(tdCls, 'text-right')}>
                    {r.diff === null ? '—' : <span className="money">{short(r.diff)}</span>}
                    {r.lastRev ? (
                      <span className="block text-[11px]">
                        <Change value={r.forecastRev === null ? null : ((r.forecastRev - r.lastRev) / r.lastRev) * 100} />
                      </span>
                    ) : null}
                  </td>
                  <td className={cn(tdCls, 'whitespace-nowrap text-xs')}>
                    {detail ? (r.model ? (MODEL_SHORT[r.model] ?? r.modelLabel) : '—') : <ModelsCompact models={r.models ?? {}} />}
                  </td>
                  <td className={cn(tdCls, 'money text-right')}>{r.revWape === null || r.revWape === undefined ? '—' : pct(r.revWape)}</td>
                  <td className={tdCls}>{typeof r.reliability === 'string' ? <ReliabilityPill value={r.reliability} /> : <ReliabilityMix mix={r.reliability} />}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-(--color-border) bg-slate-50 font-semibold">
                <td className={tdCls}>
                  Jami ({rows.length} xizmat{hidden ? `, ${hidden} yashirin` : ''})
                </td>
                <td colSpan={3} />
                <td className={cn(tdCls, 'money text-right')}>{short(tot.last)}</td>
                <td className={cn(tdCls, 'money text-right')}>{short(tot.fc)}</td>
                <td className={cn(tdCls, 'text-right')}>
                  <Change value={tot.last ? ((tot.fc - tot.last) / tot.last) * 100 : null} />
                </td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      </Panel>
      {withChart && (
        <Panel title="Eng katta 15 xizmat" description={`${monthName(target)} prognozi, so‘m`}>
          <BarList rows={[...all].filter((r) => r.forecastRev).sort((a, b) => (b.forecastRev ?? 0) - (a.forecastRev ?? 0)).slice(0, 15).map((r) => ({ key: r.service, label: r.serviceName, value: r.forecastRev, hint: r.lastRev === null ? undefined : `oxirgi oy: ${short(r.lastRev)}` }))} color={PALETTE.blue} />
        </Panel>
      )}
      {detail && <SeriesDrawer runId={runId} region={region} service={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function ModelsCompact({ models }: { models: Record<string, number> }) {
  const list = Object.entries(models).sort((a, b) => b[1] - a[1]);
  if (!list.length) return <span className="text-(--color-text-muted)">—</span>;
  return <span title={list.map(([k, n]) => `${MODEL_SHORT[k] ?? k}: ${n}`).join(', ')}>{list.map(([k, n]) => `${MODEL_SHORT[k] ?? k}${list.length > 1 ? ` ${n}` : ''}`).join(' · ')}</span>;
}

/** Bitta hudud × xizmat qatori: tanlangan model, sababi, barcha modellar taqqoslanishi, tarix */
export function SeriesDrawer({ runId, region, service, onClose }: { runId: string; region: number; service: string | null; onClose: () => void }) {
  const q = useAsync(() => (service ? hpApi.series(runId, region, service).then((r) => r.data) : Promise.resolve(null)), [runId, region, service]);
  const s = q.data;
  return (
    <Drawer open={service !== null} onClose={onClose} title={s ? s.serviceName : (service ?? '')} description={s ? `${s.service} · ${s.regionName} · prognoz oyi ${monthName(s.targetPeriod)}` : undefined} width="xl">
      {q.error ? (
        <ErrorState message={q.error} />
      ) : !s ? (
        <TableSkeleton rows={6} cols={4} />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-4">
            <Box label="Prognoz soni" value={s.forecastQtyFinal === null ? 'yetarli emas' : qty(s.forecastQtyFinal)} hint={s.interval ? `80% oraliq: ${qty(Math.round(s.interval.lo))} — ${qty(Math.round(s.interval.hi))}` : 'Oraliq: test xatolari yetarli emas'} />
            <Box label="Tarif" value={s.tariff === null ? '—' : `${som(s.tariff)} so‘m`} hint={s.tariffSource === 'implied' ? 'Katalogda yo‘q — tarixdagi daromad / soni' : (s.tariffNote ?? 'Katalogdan (prognoz oyi uchun amalda)')} />
            <Box label="Prognoz daromad" value={s.forecastRev === null ? 'yetarli emas' : `${som(s.forecastRev)} so‘m`} hint={s.revInterval ? `${short(s.revInterval.lo)} — ${short(s.revInterval.hi)}` : 'soni × tarif'} strong />
            <Box label="Oxirgi oy" value={s.lastQty === null ? '—' : `${qty(s.lastQty)} ta`} hint={s.lastRev === null ? '' : `${som(s.lastRev)} so‘m${s.lyRev !== null ? ` · o‘tgan yil: ${short(s.lyRev)}` : ''}`} />
          </div>

          <div className="rounded-lg border border-(--color-border) p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-heading">Tanlangan model: {s.modelLabel ?? '—'}</span>
              <ReliabilityPill value={s.reliability} />
            </div>
            {s.reason && <p className="mt-1 text-sm text-heading">{s.reason}</p>}
            <p className="mt-1 text-xs text-(--color-text-muted)">
              {s.observations ?? 0} oy kuzatuv{s.gaps ? ` · ${s.gaps} oy bo‘sh (ma’lumot yo‘q)` : ''}
              {s.intermittent ? ` · uzlukli talab (nol oylar ${Math.round(s.zeroShare * 100)}%)` : ''}
              {Object.keys(s.params ?? {}).length ? ` · parametrlar: ${Object.entries(s.params).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}
            </p>
            {(s.notes?.length ?? 0) > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-amber-800">
                {s.notes!.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
          </div>

          {s.formulaGap && Math.abs(s.formulaGap.pct ?? 0) >= 1 && (
            <Banner tone="warn">
              Tarixda yozilgan daromad ({som(s.formulaGap.recorded)} so‘m) va «soni × tarif» ({som(s.formulaGap.formula)} so‘m) farq qiladi: {pct(s.formulaGap.pct)}. Prognoz formula bo‘yicha hisoblanadi — tarixdagi haqiqiy daromad o‘zgartirilmaydi.
            </Banner>
          )}
          {(s.outliers?.length ?? 0) > 0 && <Banner tone="warn">Keskin farq qiluvchi oylar (o‘chirilmagan, faqat belgilangan): {s.outliers!.map((o) => `${o.month} (${qty(o.value)})`).join(', ')}</Banner>}

          <div>
            <p className="mb-2 text-sm font-semibold text-heading">Modellar taqqoslanishi — tarixiy test ({s.testPoints} oy, kelajak ma’lumoti ishlatilmagan)</p>
            {s.models.length === 0 ? (
              <p className="text-sm text-(--color-text-muted)">Tarix qisqa — tarixiy test o‘tkazilmadi</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-(--color-border)">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-(--color-border) bg-slate-50">
                      <th className={cn(thCls, 'text-left')}>Model</th>
                      <th className={cn(thCls, 'text-right')}>Test oylari</th>
                      <th className={cn(thCls, 'text-right')}>MAE (soni)</th>
                      <th className={cn(thCls, 'text-right')}>RMSE</th>
                      <th className={cn(thCls, 'text-right')}>WAPE</th>
                      <th className={cn(thCls, 'text-right')}>Siljish</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...s.models]
                      .sort((a, b) => (a.wape ?? 1e9) - (b.wape ?? 1e9))
                      .map((m) => (
                        <tr key={m.model} className={cn('border-b border-(--color-border) last:border-0', m.model === s.model && 'bg-brand-50/60 font-semibold', !m.candidate && 'text-(--color-text-muted)')}>
                          <td className={tdCls}>
                            {m.label}
                            {m.model === s.model && <span className="ml-1.5 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] text-white">tanlangan</span>}
                            {!m.candidate && <span className="ml-1.5 text-[11px]">(solishtirishda qatnashmadi)</span>}
                          </td>
                          <td className={cn(tdCls, 'money text-right')}>{m.points}</td>
                          <td className={cn(tdCls, 'money text-right')}>{m.mae === null ? '—' : m.mae.toFixed(1).replace('.', ',')}</td>
                          <td className={cn(tdCls, 'money text-right')}>{m.rmse === null ? '—' : m.rmse.toFixed(1).replace('.', ',')}</td>
                          <td className={cn(tdCls, 'money text-right')}>{m.wape === null ? 'aniqlanmagan' : pct(m.wape)}</td>
                          <td className={cn(tdCls, 'money text-right')}>{m.bias === null ? '—' : pct(m.bias, 1, true)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-1.5 text-xs text-(--color-text-muted)">WAPE — o‘rtacha nisbiy xato (Σ|xato| / Σ haqiqiy). Siljish musbat — model ortiqcha, manfiy — kam baholaydi. Natijalar 2% ichida bo‘lsa, soddaroq model tanlanadi.</p>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-heading">Xizmatlar soni: tarix va prognoz</p>
            <TrendChart
              months={s.months}
              series={[{ label: 'Haqiqiy soni', color: PALETTE.blue, values: s.history.qty }]}
              forecast={s.forecastQtyFinal === null ? null : { period: s.targetPeriod, value: s.forecastQtyFinal, lo: s.interval?.lo ?? null, hi: s.interval?.hi ?? null, label: 'Prognoz' }}
              format={(v) => qty(Math.round(v))}
              height={220}
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold text-heading">Oxirgi 12 oy</p>
            <div className="overflow-x-auto rounded-lg border border-(--color-border)">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--color-border) bg-slate-50">
                    <th className={cn(thCls, 'text-left')}>Oy</th>
                    <th className={cn(thCls, 'text-right')}>Soni</th>
                    <th className={cn(thCls, 'text-right')}>Daromad</th>
                    <th className={cn(thCls, 'text-right')}>Bitta xizmat narxi</th>
                  </tr>
                </thead>
                <tbody>
                  {s.months
                    .map((m, i) => ({ m, q: s.history.qty[i] ?? null, r: s.history.rev[i] ?? null }))
                    .slice(-12)
                    .reverse()
                    .map((x) => (
                      <tr key={x.m} className="border-b border-(--color-border) last:border-0">
                        <td className={tdCls}>{monthName(x.m)}</td>
                        <td className={cn(tdCls, 'money text-right')}>{x.q === null ? <Insufficient text="ma’lumot yo‘q" /> : qty(x.q)}</td>
                        <td className={cn(tdCls, 'money text-right')}>{x.r === null ? '—' : som(x.r)}</td>
                        <td className={cn(tdCls, 'money text-right text-(--color-text-muted)')}>{x.q && x.r !== null ? som(x.r / x.q) : '—'}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}

function Box({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={cn('rounded-lg px-3 py-2', strong ? 'bg-brand-50' : 'bg-(--color-surface-sunken)')}>
      <p className="text-[11px] text-(--color-text-muted)">{label}</p>
      <p className={cn('money text-base font-bold', strong ? 'text-brand-800' : 'text-heading')}>{value}</p>
      {hint && <p className="text-[11px] text-(--color-text-muted)">{hint}</p>}
    </div>
  );
}