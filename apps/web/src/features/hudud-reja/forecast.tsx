'use client';

import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonClass } from '@/components/ui/button';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { hpApi, MODEL_SHORT, monthName, pct, periodAdd, short, som, SOURCE_LABEL, type Precheck, type RunMeta, type RunParams, type Source } from './api';
import { ApproveDrawer, ExportMenu } from './actions';
import { Banner, Change, HpBar, hpHref, Panel, runLabel, tdCls, thCls, useHp } from './ui';

// ═══════════════════════════════════════════════════════════
// Prognozlash: parametrlar → ma'lumotlarni tekshirish → hisoblash (fon rejimida, holati kuzatiladi)
// → natijalarni solishtirish → tasdiqlash va Excel.
// ═══════════════════════════════════════════════════════════

const SELECTIONS = [
  { value: 'auto', label: 'Avtomatik (tarixiy test bo‘yicha eng aniq, teng bo‘lsa soddarog‘i)' },
  { value: 'naive', label: 'Naive — o‘tgan oy' },
  { value: 'ma3', label: '3 oylik o‘rtacha' },
  { value: 'snaive', label: 'Mavsumiy naive — o‘tgan yilning shu oyi' },
  { value: 'ses', label: 'Eksponensial tekislash (SES)' },
  { value: 'holt', label: 'Holt (trend)' },
  { value: 'hw', label: 'Mavsumiy ETS (Holt-Winters)' },
  { value: 'croston', label: 'Croston (uzlukli talab)' },
  { value: 'sba', label: 'SBA (uzlukli talab)' },
];

type Form = { historyFrom: string; source: Source; backtestMonths: number; selection: string; roundQuantity: boolean; method: 'perday' | 'share'; window: number; newEmployees: boolean; regions: number[] | null };

const defaults = (target: string): Form => ({ historyFrom: periodAdd(target, -36), source: 'merged', backtestMonths: 6, selection: 'auto', roundQuantity: true, method: 'perday', window: 6, newEmployees: true, regions: null });

function body(target: string, f: Form): Partial<RunParams> & Record<string, unknown> {
  return { targetPeriod: target, historyFrom: f.historyFrom, source: f.source, backtestMonths: f.backtestMonths, selection: f.selection, roundQuantity: f.roundQuantity, regions: f.regions, allocation: { method: f.method, window: f.window, newEmployees: f.newEmployees } };
}

const field = 'h-10 w-full rounded-lg border border-(--color-border) bg-white px-3 text-sm';

export function HpForecast() {
  const hp = useHp();
  const { isAdmin } = useAuth();
  const [form, setForm] = useState<Form>(() => defaults(hp.target));
  const [pre, setPre] = useState<Precheck | null>(null);
  const [busy, setBusy] = useState<'check' | 'run' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cmp, setCmp] = useState<string[]>([]);
  const [approve, setApprove] = useState(false);

  useEffect(() => {
    setForm(defaults(hp.target));
    setPre(null);
    setCmp([]);
  }, [hp.target]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setPre(null);
  };

  const check = async () => {
    setBusy('check');
    setError(null);
    try {
      setPre((await hpApi.precheck(body(hp.target, form))).data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tekshirib bo‘lmadi');
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    setBusy('run');
    setError(null);
    try {
      const r = (await hpApi.start(body(hp.target, form))).data;
      if (r.reused) {
        setToast(r.status === 'RUNNING' ? 'Xuddi shu hisob allaqachon ketmoqda' : 'Ma’lumot va parametrlar o‘zgarmagan — mavjud natija ochildi');
      } else setToast('Hisoblash boshlandi');
      hp.pick(r.id);
      hp.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hisoblab bo‘lmadi');
    } finally {
      setBusy(null);
    }
  };

  const done = hp.runs.filter((r) => r.status === 'DONE');
  const run = hp.run;
  const allRegions = pre?.regions ?? run?.summary?.regions.map((r) => ({ code: r.code, name: r.name })) ?? [];
  const sum = run?.summary;
  const regionsQ = useAsync(() => (run ? hpApi.regions(run.id).then((r) => r.data) : Promise.resolve(null)), [run?.id, hp.tick]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Prognozlash"
        description="Har bir hudud × xizmat qatori uchun modellar tarixiy testda solishtiriladi va eng aniq (teng bo‘lsa soddarog‘i) tanlanadi"
        actions={<ExportMenu run={run} />}
      />
      <HpBar hp={hp} />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,26rem)_1fr]">
        <Panel title="Hisoblash parametrlari" description={`Prognoz oyi: ${monthName(hp.target)} · tarix oxiri: ${periodAdd(hp.target, -1)}`}>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block font-medium text-heading">Tarix boshlanishi</span>
                <input type="month" value={form.historyFrom} max={periodAdd(hp.target, -3)} onChange={(e) => e.target.value && set('historyFrom', e.target.value)} className={field} />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-heading">Tarixiy test</span>
                <select value={form.backtestMonths} onChange={(e) => set('backtestMonths', Number(e.target.value))} className={field}>
                  {[3, 4, 5, 6, 9, 12].map((n) => (
                    <option key={n} value={n}>
                      oxirgi {n} oy
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block font-medium text-heading">Ma’lumot manbasi</span>
              <select value={form.source} onChange={(e) => set('source', e.target.value as Source)} className={field}>
                {(Object.keys(SOURCE_LABEL) as Source[]).map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABEL[s]}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-(--color-text-muted)">Birlashtirilganda bir xil oy × hudud × xizmat uchun yuklangan qiymat ustun turadi</span>
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-heading">Model tanlash</span>
              <select value={form.selection} onChange={(e) => set('selection', e.target.value)} className={field}>
                {SELECTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              {form.selection !== 'auto' && <span className="mt-1 block text-xs text-amber-700">Majburiy model qo‘llanmaydigan qatorlarda (tarix qisqa) avtomatik tanlovga qaytiladi</span>}
            </label>
            <div>
              <span className="mb-1 block font-medium text-heading">Hududlar</span>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => set('regions', null)} className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', form.regions === null ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-border)')}>
                  Barchasi
                </button>
                {allRegions.map((r) => {
                  const on = form.regions?.includes(r.code) ?? false;
                  return (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => {
                        const cur = form.regions ?? [];
                        const next = on ? cur.filter((c) => c !== r.code) : [...cur, r.code];
                        set('regions', next.length ? next : null);
                      }}
                      className={cn('rounded-full border px-2.5 py-1 text-xs font-medium', on ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-(--color-border) text-heading')}
                    >
                      {r.name}
                    </button>
                  );
                })}
              </div>
              {allRegions.length === 0 && <span className="text-xs text-(--color-text-muted)">Ro‘yxat «Ma’lumotlarni tekshirish»dan keyin chiqadi</span>}
            </div>
            <fieldset className="space-y-2 rounded-lg border border-(--color-border) p-3">
              <legend className="px-1 font-medium text-heading">Xodimlarga taqsimlash</legend>
              <label className="flex items-start gap-2">
                <input type="radio" className="mt-1" checked={form.method === 'perday'} onChange={() => set('method', 'perday')} />
                <span>
                  Ish kunlariga mutanosib
                  <span className="block text-xs text-(--color-text-muted)">Tarixiy ulush × rejadagi ish kunlari (kunlar bo‘lmasa — ulush bo‘yicha)</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" className="mt-1" checked={form.method === 'share'} onChange={() => set('method', 'share')} />
                <span>
                  Faqat tarixiy ulush bo‘yicha
                  <span className="block text-xs text-(--color-text-muted)">Har xizmatda xodimning oxirgi oylardagi ulushi</span>
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <label className="flex items-center gap-2">
                  Ulush oynasi
                  <select value={form.window} onChange={(e) => set('window', Number(e.target.value))} className="h-8 rounded-lg border border-(--color-border) px-2">
                    {[3, 6, 12].map((n) => (
                      <option key={n} value={n}>
                        {n} oy
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={form.newEmployees} onChange={(e) => set('newEmployees', e.target.checked)} />
                  Yangi xodimlarga ham ulush
                </label>
              </div>
            </fieldset>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.roundQuantity} onChange={(e) => set('roundQuantity', e.target.checked)} />
              Xizmatlar sonini butun songa yaxlitlash
            </label>
            {error && <Banner tone="bad">{error}</Banner>}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="secondary" loading={busy === 'check'} disabled={busy !== null} onClick={check}>
                Ma’lumotlarni tekshirish
              </Button>
              {isAdmin ? (
                <Button loading={busy === 'run'} disabled={busy !== null || Boolean(hp.running)} onClick={start}>
                  {hp.running ? 'Hisoblanmoqda…' : 'Prognozni hisoblash'}
                </Button>
              ) : (
                <span className="self-center text-xs text-(--color-text-muted)">Hisoblash — faqat administrator</span>
              )}
            </div>
          </div>
        </Panel>

        <div className="space-y-5">
          {pre && <PrecheckView pre={pre} />}
          {run && sum ? (
            <Panel
              title="Tanlangan hisob natijasi"
              description={`${runLabel(run)} · ${run.tookMs ?? sum.tookMs} ms · ma’lumot versiyasi ${run.dataVersion}`}
              actions={
                <>
                  <Link href={hpHref('/hudud-reja/hududlar', hp.target)} className={buttonClass('secondary', 'sm')}>
                    Hududlar
                  </Link>
                  <Link href={hpHref('/hudud-reja/xizmatlar', hp.target)} className={buttonClass('secondary', 'sm')}>
                    Xizmatlar
                  </Link>
                  {isAdmin && (
                    <Button size="sm" onClick={() => setApprove(true)}>
                      Tasdiqlash
                    </Button>
                  )}
                </>
              }
            >
              <div className="grid gap-3 sm:grid-cols-4">
                <Mini label="Prognoz jami" value={`${som(sum.total.forecastRev)} so‘m`} />
                <Mini label="Oxirgi oy (haqiqiy)" value={sum.total.lastRev === null ? '—' : `${som(sum.total.lastRev)} so‘m`} hint={<Change value={sum.total.lastRev ? ((sum.total.forecastRev - sum.total.lastRev) / sum.total.lastRev) * 100 : null} />} />
                <Mini label="Tarixiy test xatosi (WAPE)" value={sum.total.wape === null ? 'aniqlanmagan' : `±${pct(sum.total.wape)}`} hint={`${sum.total.points} oy`} />
                <Mini label="Tanlangan modellar" value={<ModelMix models={sum.models} />} />
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-(--color-border)">
                      <th className={cn(thCls, 'text-left')}>Hudud</th>
                      <th className={cn(thCls, 'text-right')}>Prognoz</th>
                      <th className={cn(thCls, 'text-right')}>Oxirgi oy</th>
                      <th className={cn(thCls, 'text-right')}>O‘zgarish</th>
                      <th className={cn(thCls, 'text-right')}>WAPE</th>
                      <th className={cn(thCls, 'text-right')}>Xodimlar</th>
                      <th className={cn(thCls, 'text-right')}>Taqsimlanmagan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sum.regions.map((r) => (
                      <tr key={r.code} className="border-b border-(--color-border) last:border-0">
                        <td className={tdCls}>
                          <Link href={hpHref(`/hudud-reja/hududlar/${r.code}`, hp.target)} className="font-medium text-heading hover:text-brand-700 hover:underline">
                            {r.name}
                          </Link>
                        </td>
                        <td className={cn(tdCls, 'money text-right font-semibold')}>{short(r.forecastRev)}</td>
                        <td className={cn(tdCls, 'money text-right text-(--color-text-muted)')}>{short(r.lastRev)}</td>
                        <td className={cn(tdCls, 'text-right')}>
                          <Change value={r.lastRev ? ((r.forecastRev - r.lastRev) / r.lastRev) * 100 : null} />
                        </td>
                        <td className={cn(tdCls, 'money text-right')}>{r.wape === null ? '—' : pct(r.wape)}</td>
                        <td className={cn(tdCls, 'money text-right')}>{r.employees}</td>
                        <td className={cn(tdCls, 'money text-right', r.unallocated ? 'text-amber-700' : 'text-(--color-text-muted)')}>{r.unallocated ? short(r.unallocated) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : (
            !pre && (
              <Panel title="Qanday ishlaydi">
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-heading">
                  <li>«Ma’lumotlarni tekshirish» — har hudud uchun nechta oy hisoboti borligi, xodimlar ma’lumoti, tarifsiz xizmatlar.</li>
                  <li>«Prognozni hisoblash» — Python xizmati har hudud × xizmat qatori uchun 8 tagacha modelni oxirgi oylarda sinab ko‘radi (kelajak ma’lumoti ishlatilmaydi).</li>
                  <li>Eng kichik xatoli model tanlanadi; daromad = xizmatlar soni × tarif; hudud = xizmatlar yig‘indisi; so‘ng xodimlarga taqsimlanadi.</li>
                  <li>Natijani ko‘rib, hudud bo‘yicha tasdiqlang. Bir xil ma’lumot va parametr bilan qayta bosish yangi hisob yaratmaydi.</li>
                </ol>
              </Panel>
            )
          )}
        </div>
      </div>

      <RunsCompare runs={done} selected={cmp} onSelect={setCmp} current={run?.id ?? null} onOpen={(id) => hp.pick(id)} />

      {run && sum && (
        <ApproveDrawer
          open={approve}
          run={run}
          regions={(regionsQ.data ?? []).map((r) => ({ code: r.code, name: r.name, forecastRev: r.forecastRev, unallocated: r.unallocated, plan: r.plan }))}
          onClose={() => setApprove(false)}
          onDone={(m) => {
            setApprove(false);
            setToast(m);
            hp.reload();
          }}
        />
      )}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function Mini({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-(--color-surface-sunken) px-3 py-2">
      <p className="text-[11px] text-(--color-text-muted)">{label}</p>
      <div className="money text-[15px] font-bold text-heading">{value}</div>
      {hint && <div className="text-xs text-(--color-text-muted)">{hint}</div>}
    </div>
  );
}

export function ModelMix({ models }: { models: Record<string, number> }) {
  const list = Object.entries(models).sort((a, b) => b[1] - a[1]);
  if (!list.length) return <span className="text-xs font-normal text-(--color-text-muted)">—</span>;
  return (
    <span className="flex flex-wrap gap-1 text-xs font-medium">
      {list.map(([k, n]) => (
        <span key={k} className="rounded bg-white px-1.5 py-0.5 text-heading">
          {MODEL_SHORT[k] ?? k} · {n}
        </span>
      ))}
    </span>
  );
}

function PrecheckView({ pre }: { pre: Precheck }) {
  const weak = pre.regions.filter((r) => r.monthsReported < 12);
  return (
    <Panel title="Ma’lumotlar tekshiruvi" description={`${pre.months[0]} — ${pre.months[pre.months.length - 1]} (${pre.months.length} oy) · ${pre.seriesCount} ta hudud × xizmat qatori · versiya ${pre.dataHash.slice(0, 12)}`} flush>
      <div className="space-y-2 px-5 pt-4">
        {pre.tariffMissing.length > 0 && <Banner tone="warn">Katalogda tarifi yo‘q xizmatlar: {pre.tariffMissing.join(', ')} — tarif tarixdagi daromad / soni nisbatidan olinadi.</Banner>}
        {weak.length > 0 && <Banner tone="warn">{weak.length} ta hududda 12 oydan kam hisobot bor — bu hududlarda faqat oddiy modellar qo‘llanadi va aniqlik past bo‘lishi mumkin.</Banner>}
      </div>
      <div className="overflow-x-auto p-5 pt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--color-border)">
              <th className={cn(thCls, 'text-left')}>Hudud</th>
              <th className={cn(thCls, 'text-right')}>Hisobot oylari</th>
              <th className={cn(thCls, 'text-right')}>Faol xizmatlar</th>
              <th className={cn(thCls, 'text-right')}>Xodimlar</th>
              <th className={cn(thCls, 'text-right')}>Xodim × xizmat yozuvlari</th>
              <th className={cn(thCls, 'text-left')}>Baho</th>
            </tr>
          </thead>
          <tbody>
            {pre.regions.map((r) => {
              const q = r.monthsReported >= 24 ? ['Yaxshi', 'text-(--color-income)'] : r.monthsReported >= 12 ? ['Qisman', 'text-amber-700'] : ['Yetarli emas', 'text-(--color-expense)'];
              return (
                <tr key={r.code} className="border-b border-(--color-border) last:border-0">
                  <td className={cn(tdCls, 'font-medium text-heading')}>{r.name}</td>
                  <td className={cn(tdCls, 'money text-right')}>
                    {r.monthsReported} / {r.months}
                  </td>
                  <td className={cn(tdCls, 'money text-right')}>{r.activeServices}</td>
                  <td className={cn(tdCls, 'money text-right')}>{r.employees}</td>
                  <td className={cn(tdCls, 'money text-right', !r.employeeServiceRows && 'text-(--color-text-muted)')}>{r.employeeServiceRows || 'yo‘q'}</td>
                  <td className={cn(tdCls, 'text-xs font-semibold', q[1])}>{q[0]}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function RunsCompare({ runs, selected, onSelect, current, onOpen }: { runs: RunMeta[]; selected: string[]; onSelect: (ids: string[]) => void; current: string | null; onOpen: (id: string) => void }) {
  const pair = selected.map((id) => runs.find((r) => r.id === id)).filter((r): r is RunMeta => Boolean(r?.summary));
  const rows = useMemo(() => {
    if (pair.length !== 2) return [];
    const [a, b] = pair as [RunMeta, RunMeta];
    const codes = [...new Set([...a.summary!.regions, ...b.summary!.regions].map((r) => r.code))];
    return codes.map((code) => {
      const x = a.summary!.regions.find((r) => r.code === code);
      const y = b.summary!.regions.find((r) => r.code === code);
      return { code, name: x?.name ?? y?.name ?? String(code), a: x?.forecastRev ?? null, b: y?.forecastRev ?? null, wa: x?.wape ?? null, wb: y?.wape ?? null };
    });
  }, [pair]);
  if (runs.length === 0) return null;
  const toggle = (id: string) => onSelect(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected.slice(-1), id]);
  return (
    <Panel title="Natijalarni solishtirish" description="Shu oy uchun barcha hisoblar. Ikkitasini belgilang — hududlar bo‘yicha farq chiqadi" flush>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-(--color-border)">
              <th className={cn(thCls, 'w-10')} />
              <th className={cn(thCls, 'text-left')}>Hisob</th>
              <th className={cn(thCls, 'text-left')}>Tarix</th>
              <th className={cn(thCls, 'text-left')}>Model</th>
              <th className={cn(thCls, 'text-right')}>Prognoz jami</th>
              <th className={cn(thCls, 'text-right')}>WAPE</th>
              <th className={cn(thCls, 'text-left')}>Kim</th>
              <th className={thCls} />
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={r.id} className={cn('border-b border-(--color-border) last:border-0', r.id === current && 'bg-brand-50/50')}>
                <td className={cn(tdCls, 'text-center')}>
                  <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} aria-label="Solishtirish" />
                </td>
                <td className={cn(tdCls, 'whitespace-nowrap')}>{runLabel(r, runs.length - i)}</td>
                <td className={cn(tdCls, 'whitespace-nowrap text-xs text-(--color-text-muted)')}>
                  {r.params.historyFrom} — {r.params.historyTo}
                </td>
                <td className={cn(tdCls, 'text-xs')}>{r.params.selection === 'auto' ? 'avtomatik' : (MODEL_SHORT[r.params.selection] ?? r.params.selection)}</td>
                <td className={cn(tdCls, 'money text-right font-semibold')}>{r.summary ? som(r.summary.total.forecastRev) : '—'}</td>
                <td className={cn(tdCls, 'money text-right')}>{r.summary?.total.wape === null || r.summary?.total.wape === undefined ? '—' : pct(r.summary.total.wape)}</td>
                <td className={cn(tdCls, 'text-xs text-(--color-text-muted)')}>{r.createdBy ?? '—'}</td>
                <td className={cn(tdCls, 'text-right')}>
                  {r.id === current ? (
                    <span className="text-xs font-semibold text-brand-700">tanlangan</span>
                  ) : (
                    <button type="button" onClick={() => onOpen(r.id)} className="text-xs font-semibold text-brand-700 hover:underline">
                      Ochish
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 0 && (
        <div className="border-t border-(--color-border) p-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-(--color-border)">
                <th className={cn(thCls, 'text-left')}>Hudud</th>
                <th className={cn(thCls, 'text-right')}>A (eskiroq)</th>
                <th className={cn(thCls, 'text-right')}>B (yangiroq)</th>
                <th className={cn(thCls, 'text-right')}>Farq</th>
                <th className={cn(thCls, 'text-right')}>WAPE A → B</th>
              </tr>
            </thead>
            <tbody>
              {(pair[0]!.createdAt > pair[1]!.createdAt ? rows.map((r) => ({ ...r, a: r.b, b: r.a, wa: r.wb, wb: r.wa })) : rows).map((r) => (
                <tr key={r.code} className="border-b border-(--color-border) last:border-0">
                  <td className={cn(tdCls, 'font-medium')}>{r.name}</td>
                  <td className={cn(tdCls, 'money text-right')}>{short(r.a)}</td>
                  <td className={cn(tdCls, 'money text-right')}>{short(r.b)}</td>
                  <td className={cn(tdCls, 'text-right')}>
                    {r.a !== null && r.b !== null ? (
                      <>
                        <span className="money mr-2">{short(r.b - r.a)}</span>
                        <Change value={r.a ? ((r.b - r.a) / r.a) * 100 : null} />
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={cn(tdCls, 'money text-right text-xs')}>
                    {r.wa === null ? '—' : pct(r.wa)} → {r.wb === null ? '—' : pct(r.wb)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {runs.length > 0 && pair.length < 2 && selected.length > 0 && <p className="px-5 pb-4 text-xs text-(--color-text-muted)">Yana bitta hisobni belgilang</p>}
    </Panel>
  );
}