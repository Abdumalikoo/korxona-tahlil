'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconDownload } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { SubTabs } from '@/components/ui/tabs';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState } from 'react';
import { bplanApi, downloadExcel, mln, pct, tone, uploadPlan, type Execution, type Mode, type Overview } from './api';
import { ExecTable, Pill } from './exec-table';
import { FactEditor } from './fact-editor';
import { RegionFacts } from './region-facts';

// ═══════════════════════════════════════════════════════════
// Hisobotlar › Choraklik ijro (biznes-reja).
// Yil, chorak (1–4) va tartib («Chorak» yoki «Yil boshidan»: 1-chorak, 1-yarim yil, 9 oy, yil).
// Yorliqlar: Hisobot · Fakt va belgilash · Hududlar fakti · Tekshiruv.
// Excel — to'liq formulali: asl reja varaqlari + Fakt + Ijro varaqlari (chorak o'zgartirilsa — o'zi qayta hisoblanadi).
// ═══════════════════════════════════════════════════════════

type View = 'report' | 'facts' | 'regions' | 'checks';

const TONE_TEXT: Record<string, string> = {
  good: 'text-(--color-income)',
  warn: 'text-(--color-warn)',
  bad: 'text-(--color-expense)',
  none: 'text-(--color-text-muted)',
};

function readStored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function QuarterlyReport() {
  const { isAdmin } = useAuth();
  const canEdit = isAdmin;
  const now = new Date();
  const [year, setYear] = useState(() => readStored('bplan.year', now.getFullYear()));
  const [quarter, setQuarter] = useState(() => readStored('bplan.quarter', Math.max(1, Math.ceil((now.getMonth() + 1) / 3) - 1) || 1));
  const [mode, setMode] = useState<Mode>(() => readStored<Mode>('bplan.mode', 'ytd'));
  const [view, setView] = useState<View>('report');
  const [tick, setTick] = useState(0);
  const [toast, setToast] = useState<{ m: string; tone: 'success' | 'error' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem('bplan.year', JSON.stringify(year));
      localStorage.setItem('bplan.quarter', JSON.stringify(quarter));
      localStorage.setItem('bplan.mode', JSON.stringify(mode));
    } catch {
      /* brauzer xotirasi yopiq */
    }
  }, [year, quarter, mode]);

  const ov = useAsync(() => bplanApi.overview(year).then((r) => r.data), [year, tick]);
  const hasPlan = Boolean(ov.data?.plan);
  const rep = useAsync(() => (hasPlan ? bplanApi.report(year, quarter, mode).then((r) => r.data) : Promise.resolve(null)), [year, quarter, mode, tick, hasPlan]);
  const notify = (m: string, t: 'success' | 'error' = 'success') => setToast({ m, tone: t });
  const reload = () => setTick((t) => t + 1);

  const years = Array.from(new Set([...(ov.data?.years ?? []), now.getFullYear(), now.getFullYear() - 1, year])).sort();

  const upload = async (file: File) => {
    setBusy('upload');
    try {
      await uploadPlan(year, file);
      notify(`${year} yil biznes-rejasi yuklandi`);
      reload();
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const excel = async () => {
    setBusy('excel');
    try {
      await downloadExcel(year, quarter, mode);
    } catch (e) {
      notify(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Boshqaruv paneli */}
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-(--color-text-muted)">Yil</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="h-9 rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 text-sm">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="mb-1 block text-xs font-medium text-(--color-text-muted)">Chorak</span>
            <div className="inline-flex gap-0.5 rounded-(--radius-control) bg-(--color-surface-sunken) p-0.5 text-sm font-semibold">
              {[1, 2, 3, 4].map((q) => (
                <button key={q} type="button" onClick={() => setQuarter(q)} className={quarter === q ? 'rounded-[calc(var(--radius-control)-2px)] bg-white px-3.5 py-1.5 text-brand-700 shadow-sm' : 'px-3.5 py-1.5 text-(--color-text-muted)'}>
                  {q}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1 block text-xs font-medium text-(--color-text-muted)">Tartib</span>
            <div className="inline-flex gap-0.5 rounded-(--radius-control) bg-(--color-surface-sunken) p-0.5 text-sm font-medium">
              {(
                [
                  ['quarter', 'Faqat chorak'],
                  ['ytd', 'Yil boshidan'],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setMode(v)} className={mode === v ? 'rounded-[calc(var(--radius-control)-2px)] bg-white px-3 py-1.5 shadow-sm' : 'px-3 py-1.5 text-(--color-text-muted)'}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-heading">{rep.data?.periodLabel ?? (mode === 'quarter' ? `${quarter}-чорак ${year}` : `${['1-чорак', '1-ярим йил', '9 ой', 'Йил'][quarter - 1]} ${year}`)}</p>
            <p className="truncate text-xs text-(--color-text-muted)">
              {ov.data?.plan ? (
                <>
                  Reja: <b className="text-heading">{ov.data.plan.fileName}</b> · {formatDateTime(ov.data.plan.uploadedAt)}
                </>
              ) : (
                'Reja fayli yuklanmagan'
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <>
                <input ref={fileRef} type="file" accept=".xlsx,.xltx" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
                <Button variant="secondary" loading={busy === 'upload'} onClick={() => fileRef.current?.click()}>
                  {hasPlan ? 'Rejani almashtirish' : 'Reja faylini yuklash'}
                </Button>
              </>
            )}
            <Button disabled={!hasPlan} loading={busy === 'excel'} onClick={() => void excel()} className="bg-tile-green hover:brightness-95">
              <IconDownload className="size-4" />
              Excel (formulali)
            </Button>
          </div>
        </div>
      </Card>

      {ov.error ? (
        <ErrorState message={ov.error} onRetry={reload} />
      ) : !ov.data ? (
        <Card>
          <LoadingState label="Yuklanmoqda" />
        </Card>
      ) : !hasPlan ? (
        <Card>
          <EmptyState
            title={`${year} yil biznes-rejasi yuklanmagan`}
            description="«Солиқ-сервис» AJ yillik rejasi (1–6-иловалар: Умумий объем, Расшифровка Ф-2, Ҳудудлар, Иш ҳақи, КПЭ, Солиқлар, Ф-2) Excel faylini yuklang — choraklik ijro shu reja bo'yicha hisoblanadi."
            action={
              canEdit ? (
                <Button onClick={() => fileRef.current?.click()} loading={busy === 'upload'}>
                  Reja faylini yuklash
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SubTabs<View>
              value={view}
              onChange={setView}
              options={[
                { value: 'report', label: 'Hisobot' },
                { value: 'facts', label: 'Fakt va belgilash' },
                { value: 'regions', label: 'Hududlar fakti' },
                { value: 'checks', label: `Tekshiruv · ${ov.data.checks.filter((c) => Math.abs(c.a - c.b) >= 0.05).length}` },
              ]}
            />
            {canEdit && view === 'report' && (
              <button type="button" onClick={() => setConfirmDelete(true)} className="text-xs text-(--color-text-muted) hover:text-(--color-expense)">
                Rejani o&apos;chirish
              </button>
            )}
          </div>

          {view === 'report' ? (
            rep.error ? (
              <ErrorState message={rep.error} onRetry={reload} />
            ) : !rep.data ? (
              <Card>
                <LoadingState label="Hisoblanmoqda" />
              </Card>
            ) : (
              <ReportBody ex={rep.data} data={ov.data} />
            )
          ) : view === 'facts' ? (
            <FactEditor data={ov.data} canEdit={canEdit} onChanged={reload} notify={notify} />
          ) : view === 'regions' ? (
            <RegionFacts data={ov.data} quarter={quarter} canEdit={canEdit} onChanged={reload} notify={notify} />
          ) : (
            <Checks data={ov.data} />
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmDelete}
        danger
        title={`${year} yil rejasini o'chirish`}
        message="Yuklangan reja fayli o'chadi (belgilash va qo'lda kiritilgan fakt saqlanib qoladi). Davom etasizmi?"
        confirmLabel="O'chirish"
        loading={busy === 'delete'}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          setBusy('delete');
          try {
            await bplanApi.removePlan(year);
            setConfirmDelete(false);
            reload();
          } catch (e) {
            notify(errorMessage(e), 'error');
          } finally {
            setBusy(null);
          }
        }}
      />
      {toast && <Toast message={toast.m} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

// ═══════════ Hisobot (ekranda) ═══════════

function Kpi({ label, plan, fact, sign, unit = 'млн.сўм' }: { label: string; plan: number; fact: number; sign: 1 | -1; unit?: string }) {
  const ratio = plan ? fact / plan : null;
  const t = tone(ratio, sign);
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium text-(--color-text-muted)">{label}</p>
      <p className="money mt-1 text-2xl font-bold text-heading">{mln(fact)}</p>
      <p className="mt-0.5 text-xs text-(--color-text-muted)">
        reja {mln(plan)} {unit} · <b className={TONE_TEXT[t]}>{pct(ratio)}</b>
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-(--color-surface-sunken)">
        <div className={cn('h-full rounded-full', t === 'good' ? 'bg-(--color-income)' : t === 'warn' ? 'bg-(--color-warn)' : 'bg-(--color-expense)')} style={{ width: `${Math.min(100, Math.max(0, (ratio ?? 0) * 100))}%` }} />
      </div>
    </Card>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="space-y-2">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-2 text-base font-semibold text-heading">
        <span className={cn('inline-block text-xs text-(--color-text-muted) transition-transform', open && 'rotate-90')}>▶</span>
        {title}
      </button>
      {open && children}
    </section>
  );
}

function ReportBody({ ex, data }: { ex: Execution; data: Overview }) {
  const s = ex.summary;
  const rt = ex.regionTotal;
  const best = [...ex.regions].filter((r) => r.plan).sort((a, b) => b.fact / b.plan - a.fact / a.plan);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Sof tushum" plan={s.revenuePlan} fact={s.revenueFact} sign={1} />
        <Kpi label="Sof foyda" plan={s.profitPlan} fact={s.profitFact} sign={1} />
        <Kpi label="Xarajatlar (tannarx + davr)" plan={s.costPlan} fact={s.costFact} sign={-1} />
        <Kpi label="Hududlar tushumi" plan={rt.plan} fact={rt.fact} sign={1} />
      </div>
      {best.length > 0 && (
        <p className="text-sm text-(--color-text-muted)">
          Hududlar orasida eng yuqori bajarilish: <b className="text-heading">{best[0]!.name}</b> ({pct(best[0]!.fact / best[0]!.plan)}), eng past:{' '}
          <b className="text-heading">{best[best.length - 1]!.name}</b> ({pct(best[best.length - 1]!.fact / best[best.length - 1]!.plan)}).
        </p>
      )}

      <Section title="Moliyaviy natijalar (Ф-2)">
        <ExecTable rows={ex.f2.filter((r) => r.level === 0 || r.plan || r.fact)} note="Bo'sh (0) qatorlar yashirilgan · млн.сўм" />
      </Section>
      <Section title="Xizmat ko'rsatish (1-илова)">
        <ExecTable rows={ex.services} />
      </Section>
      <Section title="Hududiy bo'linmalar (4-илова)">
        <RegionsTable ex={ex} groups={data.groups} />
      </Section>
      <Section title="Xarajatlar tafsiloti (2-илова)" defaultOpen={false}>
        <ExecTable rows={ex.detail} />
      </Section>
      <Section title="Ish haqi fondi va xodimlar soni">
        <div className="space-y-3">
          <ExecTable rows={ex.payroll} note="Davr rejasi = yillik fond ÷ 4 × choraklar soni (asl rejadagi tartib)" />
          <ExecTable rows={ex.headcount} count note="Xodimlar soni — o'rtacha (kishi)" />
        </div>
      </Section>
      <Section title="Byudjetga to'lovlar (5-илова)">
        <ExecTable rows={ex.taxes} />
      </Section>
      <Section title="Sof foydani taqsimlash (3-илова)">
        <ExecTable rows={ex.profit} note="Fakt taqsimoti rejadagi ulushlar bo'yicha; zarar bo'lsa — taqsimlanmaydi" />
      </Section>
      <Section title="Homiylik (2а-илова)" defaultOpen={false}>
        <ExecTable rows={ex.sponsorship} />
      </Section>
      <Section title="Asosiy samaradorlik ko'rsatkichlari (КПЭ)">
        <KpiTable ex={ex} />
      </Section>
    </div>
  );
}

function RegionsTable({ ex, groups }: { ex: Execution; groups: string[] }) {
  const rows = [...ex.regions, ex.regionTotal];
  return (
    <div className="overflow-x-auto rounded-(--radius-card) border border-(--color-line) bg-white">
      <table className="w-full min-w-[1200px] text-sm">
        <thead className="bg-(--color-surface-muted) text-[11px] text-(--color-text-muted)">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Hudud</th>
            <th className="w-24 px-2 py-2 text-right font-semibold">Yillik reja</th>
            <th className="w-24 px-2 py-2 text-right font-semibold">Davr rejasi</th>
            <th className="w-24 px-2 py-2 text-right font-semibold">Fakt</th>
            <th className="w-24 px-2 py-2 text-center font-semibold">Bajarilish</th>
            {groups.map((g) => (
              <th key={g} className="w-24 px-1.5 py-2 text-center font-semibold leading-tight">
                {g}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const total = i === rows.length - 1;
            return (
              <tr key={r.name} className={cn('border-t border-(--color-line)', total && 'bg-brand-50/50 font-semibold text-heading')}>
                <td className="px-3 py-1.5">{r.name}</td>
                <td className="money px-2 py-1.5 text-right">{mln(r.annual)}</td>
                <td className="money px-2 py-1.5 text-right">{mln(r.plan)}</td>
                <td className="money px-2 py-1.5 text-right font-semibold text-heading">{mln(r.fact)}</td>
                <td className="px-2 py-1.5 text-center">
                  <Pill ratio={r.plan ? r.fact / r.plan : null} sign={1} />
                </td>
                {r.groups.map((g, gi) => {
                  const t = tone(g, 1);
                  return (
                    <td key={gi} className="px-1 py-1">
                      <span className={cn('money block rounded px-1 py-0.5 text-center text-xs', t === 'good' ? 'bg-(--color-income-soft)' : t === 'warn' ? 'bg-(--color-warn-soft)' : t === 'bad' ? 'bg-(--color-expense-soft)' : 'text-(--color-text-faint)')}>
                        {pct(g)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">Davr rejasi = yillik reja ÷ 4 × choraklar soni · guruh ustunlarida — bajarilish foizi</p>
    </div>
  );
}

function KpiTable({ ex }: { ex: Execution }) {
  const labels = ['1-chorak', '1-yarim yil', '9 oy', 'Yil'];
  const fmt = (v: number | null, unit: string) => (v === null ? '—' : unit === 'минг сўм' ? mln(v / 1000) : v.toFixed(3).replace('.', ','));
  return (
    <div className="overflow-x-auto rounded-(--radius-card) border border-(--color-line) bg-white">
      <table className="w-full min-w-[980px] text-sm">
        <thead className="bg-(--color-surface-muted) text-[11px] text-(--color-text-muted)">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Ko&apos;rsatkich</th>
            <th className="w-14 px-2 py-2 text-center font-semibold">Ulushi</th>
            {labels.map((l) => (
              <th key={l} className="w-44 px-2 py-2 text-center font-semibold">
                {l}
                <br />
                <span className="font-normal">maqsad / fakt</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ex.kpi.map((k) => (
            <tr key={k.name} className="border-t border-(--color-line)">
              <td className="px-3 py-1.5 text-heading">
                {k.name} <span className="text-xs text-(--color-text-faint)">({k.unit === 'минг сўм' ? 'млн.сўм' : k.unit})</span>
              </td>
              <td className="px-2 py-1.5 text-center text-(--color-text-muted)">{k.weight}</td>
              {k.periods.map((p, i) => {
                const ratio = p.fact !== null && p.target ? p.fact / p.target : null;
                return (
                  <td key={i} className="px-2 py-1.5 text-center">
                    <span className="money text-(--color-text-muted)">{fmt(p.target, k.unit)}</span>
                    <span className="mx-1 text-(--color-text-faint)">/</span>
                    <span className="money font-semibold text-heading">{fmt(p.fact, k.unit)}</span>
                    {ratio !== null && (
                      <span className="ml-1.5">
                        <Pill ratio={ratio} sign={1} />
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">
        Rentabellik, qoplash va moliyaviy mustaqillik — «Fakt va belgilash» 11-bo&apos;limdagi balans ko&apos;rsatkichlaridan. Fakt — tanlangan chorakkacha.
      </p>
    </div>
  );
}

function Checks({ data }: { data: Overview }) {
  return (
    <div className="overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white">
      <div className="border-b border-(--color-line) px-4 py-3">
        <p className="text-sm font-semibold text-heading">Reja faylidagi tafovutlar</p>
        <p className="text-xs text-(--color-text-muted)">Asl rejadagi jamilar va bog&apos;lanishlar tekshiruvi. Excel faylda ham «Текширув» varag&apos;ida jonli formula bilan turadi.</p>
      </div>
      {data.checks.map((c, i) => {
        const diff = c.a - c.b;
        const ok = Math.abs(diff) < 0.05;
        return (
          <div key={i} className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-4 py-2.5 text-sm last:border-b-0">
            <span className={cn('grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold', ok ? 'bg-(--color-income-soft) text-(--color-income)' : 'bg-(--color-expense-soft) text-(--color-expense)')}>{ok ? '✓' : '!'}</span>
            <span className="min-w-0 flex-1">{c.text}</span>
            <span className="money w-28 text-right text-(--color-text-muted)">{mln(c.a)}</span>
            <span className="money w-28 text-right text-(--color-text-muted)">{mln(c.b)}</span>
            <span className={cn('money w-24 text-right font-semibold', ok ? 'text-(--color-income)' : 'text-(--color-expense)')}>{ok ? 'mos' : mln(diff)}</span>
          </div>
        );
      })}
    </div>
  );
}