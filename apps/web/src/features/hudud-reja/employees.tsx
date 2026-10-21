'use client';

import { PageHeader } from '@/components/layout/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { ErrorState, TableSkeleton } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { hpApi, monthName, pct, short, som, type EmployeeRow, type EmployeesView } from './api';
import { ApproveDrawer, ExportMenu } from './actions';
import { BarList, PALETTE } from './charts';
import { Banner, Change, HpBar, Insufficient, Kpi, NoRun, Panel, PlanPill, SortTh, tdCls, thCls, useHp, useSort } from './ui';

// ═══════════════════════════════════════════════════════════
// Xodimlar bo'yicha reja: hudud prognozi xodimlarga xizmatlar kesimida taqsimlanadi.
// Har hududda: xodimlar rejasi + taqsimlanmagan = hudud prognozi (farq 0 bo'lmasa tasdiqlanmaydi).
// Taqsimlanmagan summani administrator xodimga qo'lda biriktirishi mumkin (yig'indi saqlanadi).
// ═══════════════════════════════════════════════════════════

const DAYS_SOURCE: Record<string, string> = {
  jadval: 'yuklangan jadvaldan (kelasi oy qatori)',
};

export function HpEmployees() {
  const hp = useHp();
  const { isAdmin } = useAuth();
  const [tick, setTick] = useState(0);
  const runId = hp.run?.id ?? null;
  const q = useAsync(() => (runId ? hpApi.employees(runId, hp.region).then((r) => r.data) : Promise.resolve(null)), [runId, hp.region, tick]);
  const runQ = useAsync(() => (runId ? hpApi.run(runId).then((r) => r.data) : Promise.resolve(null)), [runId, tick]);
  const [view, setView] = useState<EmployeesView | null>(null);
  useEffect(() => setView(q.data ?? null), [q.data]);
  const [search, setSearch] = useState('');
  const [flag, setFlag] = useState<'all' | 'new' | 'manual' | 'zero'>('all');
  const [open, setOpen] = useState<EmployeeRow | null>(null);
  const [assign, setAssign] = useState<{ region: number; service: string; serviceName: string; amount: number } | null>(null);
  const [approve, setApprove] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const regionsList = hp.run?.summary?.regions.map((r) => ({ code: r.code, name: r.name })).sort((a, b) => a.name.localeCompare(b.name, 'uz'));

  const emps = (view?.employees ?? []).filter((e) => {
    if (search && !`${e.name ?? ''} ${e.pinfl} ${e.position ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (flag === 'new' && !e.isNew) return false;
    if (flag === 'manual' && !e.manualNeeded && !e.manual) return false;
    if (flag === 'zero' && e.plan > 0) return false;
    return true;
  });
  const { sorted, sort, toggle } = useSort(emps, { key: 'plan', dir: 'desc' }, (e, k) => {
    if (k === 'name') return e.name ?? e.pinfl;
    if (k === 'region') return e.regionName;
    return (e as unknown as Record<string, number | null>)[k] ?? null;
  });
  const regs = view?.regions ?? [];
  const tot = regs.reduce((a, r) => ({ fc: a.fc + r.check.regionForecast, emp: a.emp + r.check.employeesTotal, un: a.un + r.check.unallocated }), { fc: 0, emp: 0, un: 0 });
  const edits = runQ.data?.edits ?? [];
  const reload = () => setTick((t) => t + 1);

  const unassign = async (index: number) => {
    if (!runId) return;
    try {
      await hpApi.unassign(runId, index);
      setToast({ message: 'Qo‘lda biriktirish bekor qilindi' });
      reload();
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : 'Xato', tone: 'error' });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Xodimlar bo‘yicha reja"
        description="Hudud prognozi xodimlarga xizmatlar bo‘yicha tarixiy ulush va ish kunlariga qarab taqsimlanadi"
        actions={
          <>
            {isAdmin && hp.run && (
              <Button size="sm" onClick={() => setApprove(true)}>
                Tasdiqlash
              </Button>
            )}
            <ExportMenu run={hp.run} />
          </>
        }
      />
      <HpBar hp={hp} regions={regionsList} />
      {!hp.run ? (
        hp.runsLoading ? <TableSkeleton rows={6} cols={6} /> : <NoRun hp={hp} what="Xodimlar rejasi" />
      ) : q.error ? (
        <ErrorState message={q.error} onRetry={reload} />
      ) : !view ? (
        <TableSkeleton rows={8} cols={8} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi tone="brand" label={`Hudud prognozi — ${monthName(hp.target)}`} value={`${som(tot.fc)} so‘m`} hint={`${regs.length} hudud`} />
            <Kpi label="Xodimlarga taqsimlangan" value={`${som(tot.emp)} so‘m`} hint={`${view.employees.filter((e) => e.plan > 0).length} xodim · ${tot.fc ? pct((tot.emp / tot.fc) * 100, 1) : '—'}`} />
            <Kpi label="Taqsimlanmagan" value={`${som(tot.un)} so‘m`} tone={tot.un > 0 ? 'warn' : 'ok'} hint={tot.un > 0 ? 'Xizmatni tarixda hech kim ko‘rsatmagan yoki xodim ma’lumoti yo‘q' : 'Hammasi taqsimlangan'} />
            <Kpi label="Tekshiruv" value={regs.every((r) => r.check.diff === 0) ? 'Yig‘indi mos' : 'Farq bor'} tone={regs.every((r) => r.check.diff === 0) ? 'ok' : 'bad'} hint="Xodimlar + taqsimlanmagan = hudud prognozi" />
          </div>

          {regs.map((g) => (
            <RegionBlock key={g.code} g={g} canWrite={isAdmin} single={regs.length === 1} onAssign={(u) => setAssign({ region: g.code, ...u })} />
          ))}

          {edits.length > 0 && (
            <Panel title="Qo‘lda biriktirishlar" description="Taqsimlanmagan summadan xodimga o‘tkazilgan qismlar — hisob natijasi o‘zgarmaydi, ustiga yoziladi" flush>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-(--color-border)">
                    <th className={cn(thCls, 'text-left')}>Hudud</th>
                    <th className={cn(thCls, 'text-left')}>Xizmat</th>
                    <th className={cn(thCls, 'text-left')}>Xodim</th>
                    <th className={cn(thCls, 'text-right')}>Summa</th>
                    <th className={thCls} />
                  </tr>
                </thead>
                <tbody>
                  {edits.map((e, i) => (
                    <tr key={i} className="border-b border-(--color-border) last:border-0">
                      <td className={tdCls}>{regionsList?.find((r) => r.code === e.region)?.name ?? e.region}</td>
                      <td className={tdCls}>{e.service}</td>
                      <td className={tdCls}>{view.employees.find((x) => x.pinfl === e.pinfl)?.name ?? e.pinfl}</td>
                      <td className={cn(tdCls, 'money text-right font-semibold')}>{som(e.amount)}</td>
                      <td className={cn(tdCls, 'text-right')}>
                        {isAdmin && (
                          <button type="button" onClick={() => unassign(i)} className="text-xs font-semibold text-(--color-expense) hover:underline">
                            Bekor qilish
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          )}

          <Panel
            title="Xodimlar"
            description="Qatorni bosing — xizmatlar bo‘yicha taqsimot va hisob izohi"
            actions={
              <>
                <select value={flag} onChange={(e) => setFlag(e.target.value as typeof flag)} className="h-9 rounded-lg border border-(--color-border) bg-white px-2 text-sm">
                  <option value="all">Barcha xodimlar</option>
                  <option value="new">Yangi xodimlar</option>
                  <option value="manual">Qo‘lda ko‘rib chiqish kerak</option>
                  <option value="zero">Rejasi nol</option>
                </select>
                <SearchInput value={search} onChange={setSearch} placeholder="F.I.Sh. yoki JShShIR" className="w-56" />
              </>
            }
            flush
          >
            {view.employees.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-(--color-text-muted)">Xodimlar bo‘yicha ma’lumot yo‘q — «Ma’lumotlarni yuklash»da Xodimlar_Tarixi va Xodim_Xizmatlari varaqlarini yuklang. Hozircha reja faqat hudud darajasida.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-(--color-border)">
                      <SortTh label="Xodim" k="name" sort={sort} onSort={toggle} align="left" />
                      {!hp.region && <SortTh label="Hudud" k="region" sort={sort} onSort={toggle} align="left" />}
                      <SortTh label="Ish kunlari" k="plannedDays" sort={sort} onSort={toggle} title="Prognoz oyida rejalashtirilgan ish kunlari" />
                      <SortTh label="Tarixiy daromad" k="histRev" sort={sort} onSort={toggle} title="Ulush oynasidagi jami" />
                      <SortTh label="Oxirgi oy" k="lastRev" sort={sort} onSort={toggle} />
                      <SortTh label="Reja" k="plan" sort={sort} onSort={toggle} />
                      <SortTh label="Ulush" k="share" sort={sort} onSort={toggle} />
                      <SortTh label="O‘zgarish" k="change" sort={sort} onSort={toggle} title="Oldingi tasdiqlangan rejaga yoki oxirgi oy natijasiga nisbatan" />
                      <th className={cn(thCls, 'text-left')}>Holat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((e) => (
                      <tr key={`${e.region}-${e.pinfl}`} onClick={() => setOpen(e)} className="cursor-pointer border-b border-(--color-border) last:border-0 hover:bg-slate-50">
                        <td className={tdCls}>
                          <span className="block font-medium text-heading">{e.name ?? e.pinfl}</span>
                          <span className="flex flex-wrap gap-1 text-[11px] text-(--color-text-muted)">
                            {e.position ?? ''}
                            {e.isNew && <span className="rounded bg-sky-50 px-1 text-sky-700">yangi</span>}
                            {e.manualNeeded && <span className="rounded bg-amber-50 px-1 text-amber-700">qo‘lda ko‘rish kerak</span>}
                            {e.manual && <span className="rounded bg-violet-50 px-1 text-violet-700">qo‘lda biriktirilgan</span>}
                          </span>
                        </td>
                        {!hp.region && <td className={cn(tdCls, 'text-xs')}>{e.regionName}</td>}
                        <td className={cn(tdCls, 'money text-right')}>
                          {e.plannedDays ?? '—'}
                          {e.workedMonths > 0 && <span className="block text-[11px] text-(--color-text-muted)">tarix: {e.workedDays ?? '—'} kun / {e.workedMonths} oy</span>}
                        </td>
                        <td className={cn(tdCls, 'money text-right text-(--color-text-muted)')}>{e.histRev ? short(e.histRev) : '—'}</td>
                        <td className={cn(tdCls, 'money text-right text-(--color-text-muted)')}>{short(e.lastRev)}</td>
                        <td className={cn(tdCls, 'money text-right font-semibold')}>{som(e.plan)}</td>
                        <td className={cn(tdCls, 'money text-right')}>{e.share === null ? '—' : pct(e.share * 100)}</td>
                        <td className={cn(tdCls, 'text-right')}>
                          <Change value={e.change} />
                          {e.changeBase && <span className="block text-[11px] text-(--color-text-muted)">{e.changeBase === 'prevPlan' ? 'oldingi rejaga' : 'oxirgi oyga'}</span>}
                        </td>
                        <td className={tdCls}>
                          <PlanPill plan={e.planStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {view.employees.length > 0 && (
            <Panel title="Eng katta rejalar" description="Kelasi oy rejasi, so‘m">
              <BarList rows={[...view.employees].sort((a, b) => b.plan - a.plan).slice(0, 15).map((e) => ({ key: `${e.region}-${e.pinfl}`, label: e.name ?? e.pinfl, value: e.plan, hint: e.regionName }))} color={PALETTE.green} />
            </Panel>
          )}
        </>
      )}

      <EmployeeDrawer e={open} onClose={() => setOpen(null)} />
      {assign && view && runId && (
        <AssignDrawer
          runId={runId}
          a={assign}
          employees={view.employees.filter((e) => e.region === assign.region)}
          onClose={() => setAssign(null)}
          onDone={(v, msg) => {
            setAssign(null);
            setToast({ message: msg });
            if (hp.region) setView(v);
            reload();
          }}
        />
      )}
      {hp.run && (
        <ApproveDrawer
          open={approve}
          run={hp.run}
          preselect={hp.region ? [hp.region] : undefined}
          regions={regs.map((g) => ({ code: g.code, name: g.name, forecastRev: g.forecastRev, unallocated: g.check.unallocated, plan: g.plan }))}
          onClose={() => setApprove(false)}
          onDone={(m) => {
            setApprove(false);
            setToast({ message: m });
            reload();
            hp.reload();
          }}
        />
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

function RegionBlock({ g, canWrite, onAssign, single }: { g: EmployeesView['regions'][number]; canWrite: boolean; onAssign: (u: { service: string; serviceName: string; amount: number }) => void; single: boolean }) {
  const [open, setOpen] = useState(single);
  const ok = g.check.diff === 0;
  return (
    <section className="rounded-(--radius-card) bg-white shadow-card">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full flex-wrap items-center gap-x-5 gap-y-1 px-5 py-3 text-left">
        <span className="min-w-40 text-[15px] font-bold text-heading">{g.name}</span>
        <span className="text-sm">
          Prognoz <b className="money">{short(g.check.regionForecast)}</b>
        </span>
        <span className="text-sm">
          = xodimlar <b className="money">{short(g.check.employeesTotal)}</b>
        </span>
        <span className={cn('text-sm', g.check.unallocated ? 'text-amber-700' : 'text-(--color-text-muted)')}>
          + taqsimlanmagan <b className="money">{short(g.check.unallocated)}</b>
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', ok ? 'bg-(--color-income-soft) text-(--color-income)' : 'bg-red-50 text-red-700')}>{ok ? '✓ yig‘indi mos' : `farq ${som(g.check.diff)}`}</span>
        <PlanPill plan={g.plan} />
        <span className="ml-auto text-xs text-(--color-text-muted)">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-(--color-border) px-5 py-4">
          <p className="text-xs text-(--color-text-muted)">
            Usul: <b>{g.methodUsed === 'perday' ? 'ish kunlariga mutanosib' : 'tarixiy ulush bo‘yicha'}</b>
            {g.methodUsed !== g.method && ' (ish kunlari ma’lumoti yo‘q — ulushga qaytildi)'} · {g.mode === 'service' ? 'xizmatlar kesimida' : 'jami daromad bo‘yicha (xodim × xizmat ma’lumoti yo‘q)'}
            {g.window.length ? ` · ulush oynasi: ${g.window[0]} — ${g.window[g.window.length - 1]}` : ''}
          </p>
          {g.notes.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-amber-800">
              {g.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
          {g.unallocated.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-amber-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-amber-200 bg-amber-50">
                    <th className={cn(thCls, 'text-left')}>Taqsimlanmagan xizmat</th>
                    <th className={cn(thCls, 'text-left')}>Sabab</th>
                    <th className={cn(thCls, 'text-right')}>Summa</th>
                    <th className={thCls} />
                  </tr>
                </thead>
                <tbody>
                  {g.unallocated.map((u) => (
                    <tr key={u.service} className="border-b border-amber-100 last:border-0">
                      <td className={tdCls}>
                        <span className="mr-1.5 text-[11px] text-(--color-text-muted)">{u.service}</span>
                        {u.serviceName}
                      </td>
                      <td className={cn(tdCls, 'text-xs text-(--color-text-muted)')}>{u.reason}</td>
                      <td className={cn(tdCls, 'money text-right font-semibold')}>{som(u.amount)}</td>
                      <td className={cn(tdCls, 'text-right')}>
                        {canWrite && u.amount > 0 && (
                          <button type="button" onClick={() => onAssign({ service: u.service, serviceName: u.serviceName, amount: u.amount })} className="whitespace-nowrap text-xs font-semibold text-brand-700 hover:underline">
                            Xodimga biriktirish
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function EmployeeDrawer({ e, onClose }: { e: EmployeeRow | null; onClose: () => void }) {
  return (
    <Drawer open={e !== null} onClose={onClose} title={e?.name ?? e?.pinfl ?? ''} description={e ? `${e.position ?? 'Lavozim ko‘rsatilmagan'} · ${e.regionName} · JShShIR ${e.pinfl}` : undefined} width="lg">
      {e && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Mini label="Reja" value={`${som(e.plan)} so‘m`} strong />
            <Mini label="Hududdagi ulush" value={e.share === null ? '—' : pct(e.share * 100)} />
            <Mini label="Ish kunlari (reja)" value={e.plannedDays === null ? '—' : String(e.plannedDays)} hint={DAYS_SOURCE[e.plannedDaysSource] ?? e.plannedDaysSource} />
            <Mini label={e.changeBase === 'prevPlan' ? 'Oldingi reja' : 'Oxirgi oy'} value={e.changeBase === 'prevPlan' ? short(e.prevPlan) : short(e.lastRev)} hint={e.change === null ? undefined : `${e.change > 0 ? '+' : ''}${e.change.toFixed(1).replace('.', ',')}%`} />
          </div>
          {e.isNew && <Banner tone="info">Yangi xodim: tarixi yo‘q, shuning uchun reja o‘xshash xodimlarning (shu lavozimdagi) bir kunlik o‘rtacha natijasi × rejadagi ish kunlari bo‘yicha.</Banner>}
          {e.manualNeeded && <Banner tone="warn">Bu xodim uchun avtomatik reja ishonchsiz (tarix yoki ish kunlari yetarli emas) — rahbar ko‘rib chiqishi tavsiya etiladi.</Banner>}
          <div className="overflow-x-auto rounded-lg border border-(--color-border)">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-(--color-border) bg-slate-50">
                  <th className={cn(thCls, 'text-left')}>Xizmat</th>
                  <th className={cn(thCls, 'text-right')}>Tarixda</th>
                  <th className={cn(thCls, 'text-right')}>Xizmatdagi ulushi</th>
                  <th className={cn(thCls, 'text-right')}>Reja</th>
                </tr>
              </thead>
              <tbody>
                {e.services.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-(--color-text-muted)">
                      <Insufficient text="Xizmatlar kesimida ma’lumot yo‘q" />
                    </td>
                  </tr>
                ) : (
                  [...e.services]
                    .sort((a, b) => b.plan - a.plan)
                    .map((s) => (
                      <tr key={s.service} className="border-b border-(--color-border) last:border-0">
                        <td className={tdCls}>
                          <span className="mr-1.5 text-[11px] text-(--color-text-muted)">{s.service}</span>
                          {s.serviceName}
                          {s.manual ? <span className="ml-1.5 rounded bg-violet-50 px-1 text-[11px] text-violet-700">qo‘lda +{short(s.manual)}</span> : null}
                        </td>
                        <td className={cn(tdCls, 'money text-right text-(--color-text-muted)')}>{s.hist ? short(s.hist) : '—'}</td>
                        <td className={cn(tdCls, 'money text-right')}>{pct(s.share * 100)}</td>
                        <td className={cn(tdCls, 'money text-right font-semibold')}>{som(s.plan)}</td>
                      </tr>
                    ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-(--color-border) font-semibold">
                  <td className={tdCls}>Jami</td>
                  <td className={cn(tdCls, 'money text-right')}>{short(e.histRev)}</td>
                  <td />
                  <td className={cn(tdCls, 'money text-right')}>{som(e.plan)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-(--color-text-muted)">
            Hisob: har xizmat bo‘yicha hudud prognozi × xodimning shu xizmatdagi ulushi (ish kunlariga mutanosib usulda — bir kunlik natija × rejadagi kunlar asosida). Yaxlitlashda hudud yig‘indisi saqlanadi.
          </p>
        </div>
      )}
    </Drawer>
  );
}

function Mini({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={cn('rounded-lg px-3 py-2', strong ? 'bg-brand-50' : 'bg-(--color-surface-sunken)')}>
      <p className="text-[11px] text-(--color-text-muted)">{label}</p>
      <p className={cn('money text-base font-bold', strong ? 'text-brand-800' : 'text-heading')}>{value}</p>
      {hint && <p className="text-[11px] text-(--color-text-muted)">{hint}</p>}
    </div>
  );
}

function AssignDrawer({ runId, a, employees, onClose, onDone }: { runId: string; a: { region: number; service: string; serviceName: string; amount: number }; employees: EmployeeRow[]; onClose: () => void; onDone: (v: EmployeesView, msg: string) => void }) {
  const [pinfl, setPinfl] = useState(employees[0]?.pinfl ?? '');
  const [amount, setAmount] = useState(String(a.amount));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Math.round(Number(amount.replace(/\s/g, '').replace(',', '.')));
  const valid = Number.isFinite(n) && n > 0 && n <= a.amount && pinfl;
  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const r = await hpApi.assign(runId, { region: a.region, service: a.service, pinfl, amount: n });
      onDone(r.data, `${som(n)} so‘m biriktirildi`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Biriktirib bo‘lmadi');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title="Xodimga biriktirish"
      description={`${a.service} · ${a.serviceName} · taqsimlanmagan ${som(a.amount)} so‘m`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Bekor
          </Button>
          <Button loading={busy} disabled={!valid} onClick={submit}>
            Biriktirish
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        {employees.length === 0 ? (
          <Banner tone="warn">Bu hududda rejaga kiritilgan xodim yo‘q.</Banner>
        ) : (
          <label className="block">
            <span className="mb-1 block font-medium text-heading">Xodim</span>
            <select value={pinfl} onChange={(e) => setPinfl(e.target.value)} className="h-10 w-full rounded-lg border border-(--color-border) bg-white px-3">
              {employees.map((e) => (
                <option key={e.pinfl} value={e.pinfl}>
                  {e.name ?? e.pinfl} — hozirgi reja {som(e.plan)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block font-medium text-heading">Summa, so‘m</span>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" className="h-10 w-full rounded-lg border border-(--color-border) px-3" />
          <span className="mt-1 block text-xs text-(--color-text-muted)">1 dan {som(a.amount)} gacha. Hudud yig‘indisi o‘zgarmaydi — summa taqsimlanmagandan xodimga o‘tadi.</span>
        </label>
        {error && <Banner tone="bad">{error}</Banner>}
      </div>
    </Drawer>
  );
}