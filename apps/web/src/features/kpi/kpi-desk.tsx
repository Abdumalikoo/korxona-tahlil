'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { MonthSelect } from '@/features/units/month-range';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatPeriod } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ACTING_KPI_KEY, kpiApi, type KpiCriterion, type KpiEvaluation, type KpiKind, type KpiPick, type KpiTemplate } from './api';

// ═══════════════════════════════════════════════════════════
// KPI baholash stoli (bo'lim rahbari; administrator — har bo'lim, ?b=KALIT):
//  oy → xodim → tur (rag'batlantiruvchi / kamaytiruvchi) → mezonlar: daraja, bor-yo'q yoki holatlar soni.
//  Ball shablondan (biz belgilagan) — o'zgartirib bo'lmaydi; har o'zgarish o'zi saqlanadi (ball serverda hisoblanadi).
//  Oy yakunida «Bizga yuborish» — baholar Yig'ma KPI'ga tushadi va qulflanadi.
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone: 'success' | 'error' } | null;

const thisMonth = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 7);

/** Ko'rsatish uchun ball (saqlanadigani — serverda, xuddi shu qoida bilan) */
function pointsOf(c: KpiCriterion, p: KpiPick | undefined): number {
  if (!p) return 0;
  const n = (v: unknown) => Math.max(0, Math.min(99, Math.floor(Number(v) || 0)));
  switch (c.type) {
    case 'LEVEL':
      return c.levels.find((l) => l.id === p.level)?.points ?? 0;
    case 'FLAG':
      return p.on ? c.max : 0;
    case 'PER_CASE':
      return c.cap === null ? n(p.count) * c.perCase : Math.min(n(p.count) * c.perCase, c.cap);
    case 'COUNT_LEVELS': {
      let v = 0;
      for (const s of c.steps) if (n(p.count) >= s.min) v = s.points;
      return v;
    }
    case 'COUNT_TIERS':
      return Math.min(c.tiers.reduce((t, x) => t + n(p.counts?.[x.id]) * x.points, 0), c.cap);
  }
}

export function KpiDesk() {
  const { isWorker } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const b = search.get('b');
  const me = useAsync(() => kpiApi.me(b).then((r) => r.data), [b]);
  const [period, setPeriod] = useState(thisMonth());
  const isHead = me.data?.isHead;
  // Oy shu yerda tanlanadi — yuqori paneldagi davr tanlagich yashirinadi
  const { claimRange } = usePeriod();
  useEffect(() => claimRange(), [claimRange]);

  // Administrator Rollar › KPI orqali kirgan bo'lsa — ?b= yo'qolganda (menyudan qaytish) sessiyadagi bo'lim tiklanadi
  useEffect(() => {
    if (isHead !== false) return;
    try {
      if (b) window.sessionStorage.setItem(ACTING_KPI_KEY, b);
      else {
        const saved = window.sessionStorage.getItem(ACTING_KPI_KEY);
        if (saved) router.replace(`/kpi/ish-stoli?b=${saved}`);
      }
    } catch {
      // sessiya xotirasi yopiq — bo'lim qo'lda tanlanadi
    }
  }, [b, isHead, router]);

  if (me.error) return <ErrorState message={me.error} onRetry={me.reload} />;
  if (!me.data) return <LoadingState label="KPI shabloni yuklanmoqda" />;
  const m = me.data;
  return (
    <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardBody className="flex flex-wrap items-end gap-4">
          {!m.isHead && (
            <label className="text-xs font-medium text-(--color-text-muted)">
              Bo&apos;lim
              <select value={b ?? ''} onChange={(e) => {
                  if (!e.target.value) {
                    try {
                      window.sessionStorage.removeItem(ACTING_KPI_KEY);
                    } catch {
                      // sessiya xotirasi yopiq
                    }
                  }
                  router.replace(e.target.value ? `/kpi/ish-stoli?b=${e.target.value}` : '/kpi/ish-stoli');
                }} className="mt-1 block h-9 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm text-heading">
                <option value="">Tanlang…</option>
                {m.templates.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.department}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="text-xs font-medium text-(--color-text-muted)">
            Baholash oyi
            <MonthSelect label="Oy" value={period} onChange={setPeriod} />
          </label>
          {m.template && (
            <p className="ml-auto max-w-xl text-xs text-(--color-text-muted)">
              <b className="text-heading">{m.template.title}</b>
              <span className="block">Ballar shablondan — o&apos;zgartirib bo&apos;lmaydi. Har tanlov o&apos;zi saqlanadi.{isWorker ? '' : ' (Administrator ko‘rinishi)'}</span>
            </p>
          )}
        </CardBody>
      </Card>
      {!m.template ? (
        <Card>
          <CardBody className="text-sm text-(--color-text-muted)">Baholash uchun bo&apos;limni tanlang.</CardBody>
        </Card>
      ) : (
        <Sheet key={`${m.template.key}|${period}`} template={m.template} period={period} b={m.isHead ? null : m.template.key} />
      )}
    </div>
  );
}

function Sheet({ template, period, b }: { template: KpiTemplate; period: string; b: string | null }) {
  const { isAdmin } = useAuth();
  const sheet = useAsync(() => kpiApi.sheet(period, b).then((r) => r.data), [period, b]);
  const [picked, setPicked] = useState<string | null>(null);
  const [kind, setKind] = useState<KpiKind>('BONUS');
  const [toast, setToast] = useState<ToastState>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  // Saqlangan baholar (server javobi) — ro'yxatdagi ballar shu bilan yangilanadi
  const [evals, setEvals] = useState<Record<string, KpiEvaluation | null>>({});

  if (sheet.error) return <ErrorState message={sheet.error} onRetry={sheet.reload} />;
  if (!sheet.data) return <LoadingState label="Xodimlar yuklanmoqda" />;
  const s = sheet.data;
  const evalOf = (pinfl: string) => (pinfl in evals ? evals[pinfl]! : (s.employees.find((e) => e.pinfl === pinfl)?.evaluation ?? null));
  const done = s.employees.filter((e) => evalOf(e.pinfl)).length;
  const current = s.employees.find((e) => e.pinfl === picked) ?? null;

  async function submit() {
    setBusy(true);
    try {
      const r = (await kpiApi.submit(period, b)).data;
      setToast({ message: `${r.submitted} ta xodim bahosi yuborildi`, tone: 'success' });
      setConfirm(false);
      setEvals({});
      sheet.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, "Yuborib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  async function reopen() {
    try {
      await kpiApi.reopen(period, template.key);
      setToast({ message: 'Tahrirga qaytarildi', tone: 'success' });
      sheet.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, "Qaytarib bo'lmadi"), tone: 'error' });
    }
  }

  return (
    <div className="space-y-4">
      {s.submittedAt ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-(--color-income)/30 bg-(--color-income-soft) px-4 py-2.5 text-sm text-(--color-income)">
          <span>
            ✓ {formatPeriod(period)} baholari yuborilgan — {formatDateTime(s.submittedAt)}
            {s.submittedBy ? ` · ${s.submittedBy}` : ''}. O&apos;zgartirib bo&apos;lmaydi.
          </span>
          {isAdmin && (
            <Button size="sm" variant="secondary" className="ml-auto" onClick={() => void reopen()}>
              Tahrirga qaytarish
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-(--color-line) bg-white px-4 py-2.5 text-sm">
          <span>
            {s.department} · {formatPeriod(period)}: baholangan <b>{done}</b> / {s.employees.length} xodim
          </span>
          {s.canEdit && (
            <Button size="sm" className="ml-auto" disabled={!done} onClick={() => setConfirm(true)}>
              Bizga yuborish
            </Button>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card className="overflow-hidden">
          <CardHeader title="Xodimlar" description={`${s.department} — ${s.employees.length} kishi`} />
          <ul className="divide-y divide-(--color-line)">
            {s.employees.map((e) => {
              const ev = evalOf(e.pinfl);
              return (
                <li key={e.pinfl}>
                  <button type="button" onClick={() => setPicked(e.pinfl)} className={cn('flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-(--color-surface-muted)', picked === e.pinfl && 'bg-brand-50')}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-heading">{e.fullName}</span>
                      <span className="block truncate text-[11px] text-(--color-text-muted)">{e.position ?? '—'}</span>
                    </span>
                    {ev ? (
                      <span className="text-right">
                        <span className="block text-base font-bold text-heading tabular-nums">{ev.total}</span>
                        <span className="block text-[10.5px] text-(--color-text-faint)">
                          +{ev.bonus} / −{ev.penalty}
                        </span>
                      </span>
                    ) : (
                      <Badge tone="neutral">baholanmagan</Badge>
                    )}
                  </button>
                </li>
              );
            })}
            {!s.employees.length && <li className="px-4 py-6 text-sm text-(--color-text-muted)">Bu oyda bo&apos;limda xodim yo&apos;q.</li>}
          </ul>
        </Card>

        {current ? (
          <EmployeeForm
            key={current.pinfl}
            template={template}
            period={period}
            b={b}
            pinfl={current.pinfl}
            fullName={current.fullName}
            initial={evalOf(current.pinfl)}
            kind={kind}
            onKind={setKind}
            editable={s.canEdit}
            onSaved={(ev) => setEvals((x) => ({ ...x, [current.pinfl]: ev }))}
            onError={(m) => setToast({ message: m, tone: 'error' })}
          />
        ) : (
          <Card>
            <CardBody className="text-sm text-(--color-text-muted)">Chapdan xodimni tanlang — keyin rag&apos;batlantiruvchi yoki kamaytiruvchi mezonlarni belgilaysiz.</CardBody>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={confirm}
        title="Baholarni yuborish"
        message={`${formatPeriod(period)}: ${done} ta xodim bahosi Yig'ma KPI'ga yuboriladi va qulflanadi (o'zgartirish — faqat administrator qaytarsa).${done < s.employees.length ? ` Baholanmagan: ${s.employees.length - done} ta.` : ''}`}
        confirmLabel="Yuborish"
        loading={busy}
        onConfirm={() => void submit()}
        onCancel={() => setConfirm(false)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

function EmployeeForm({ template, period, b, pinfl, fullName, initial, kind, onKind, editable, onSaved, onError }: {
  template: KpiTemplate;
  period: string;
  b: string | null;
  pinfl: string;
  fullName: string;
  initial: KpiEvaluation | null;
  kind: KpiKind;
  onKind: (k: KpiKind) => void;
  editable: boolean;
  onSaved: (ev: KpiEvaluation | null) => void;
  onError: (m: string) => void;
}) {
  const [picks, setPicks] = useState<Record<string, KpiPick>>(initial?.picks ?? {});
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(initial?.savedAt ?? null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(picks);

  // Avtomatik saqlash: oxirgi o'zgarishdan 0,5 soniya keyin
  function change(next: Record<string, KpiPick>) {
    setPicks(next);
    latest.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setState('saving');
      kpiApi
        .save({ b, period, pinfl, picks: latest.current })
        .then((r) => {
          onSaved(r.data.evaluation);
          setSavedAt(r.data.evaluation?.savedAt ?? new Date().toISOString());
          setState('saved');
        })
        .catch((err) => {
          setState('idle');
          onError(errorMessage(err, "Saqlab bo'lmadi"));
        });
    }, 500);
  }
  // Boshqa xodimga o'tilsa — kutayotgan saqlash yo'qolmasin: darhol yuboriladi
  const ctx = useRef({ b, period, pinfl, onSaved, onError });
  useEffect(() => {
    ctx.current = { b, period, pinfl, onSaved, onError };
  });
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      const x = ctx.current;
      kpiApi
        .save({ b: x.b, period: x.period, pinfl: x.pinfl, picks: latest.current })
        .then((r) => x.onSaved(r.data.evaluation))
        .catch((err) => x.onError(errorMessage(err, "Saqlab bo'lmadi")));
    },
    [],
  );

  const set = (id: string, p: KpiPick | null) => {
    const next = { ...picks };
    if (p) next[id] = p;
    else delete next[id];
    change(next);
  };
  const list = template.criteria.filter((c) => c.kind === kind);
  const bonus = template.criteria.filter((c) => c.kind === 'BONUS').reduce((t, c) => t + pointsOf(c, picks[c.id]), 0);
  const penalty = template.criteria.filter((c) => c.kind === 'PENALTY').reduce((t, c) => t + pointsOf(c, picks[c.id]), 0);
  const total = Math.max(0, Math.min(100, bonus - penalty));

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={fullName}
        description={`${formatPeriod(period)} · ${state === 'saving' ? 'saqlanmoqda…' : savedAt ? `saqlangan ${formatDateTime(savedAt)}` : 'hali saqlanmagan'}`}
        actions={
          <span className="flex items-center gap-3 text-sm">
            <span className="text-(--color-income)">+{bonus}</span>
            <span className="text-(--color-expense)">−{penalty}</span>
            <span className="rounded-lg bg-brand-50 px-2.5 py-1 text-lg font-bold text-brand-800 tabular-nums">{total}</span>
          </span>
        }
      />
      <CardBody className="space-y-3 border-t border-(--color-line)">
        <div className="flex gap-1.5" role="tablist" aria-label="Mezon turi">
          {(
            [
              ['BONUS', "Rag'batlantiruvchi", bonus],
              ['PENALTY', 'Kamaytiruvchi', penalty],
            ] as const
          ).map(([k, label, v]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => onKind(k)} className={cn('rounded-full border px-3.5 py-1.5 text-sm font-medium', kind === k ? (k === 'BONUS' ? 'border-(--color-income) bg-(--color-income) text-white' : 'border-(--color-expense) bg-(--color-expense) text-white') : 'border-(--color-line) bg-white text-heading')}>
              {label} {v ? `(${k === 'BONUS' ? '+' : '−'}${v})` : ''}
            </button>
          ))}
        </div>
        <ul className="space-y-2.5">
          {list.map((c) => (
            <CriterionRow key={c.id} c={c} pick={picks[c.id]} editable={editable} onChange={(p) => set(c.id, p)} />
          ))}
        </ul>
        <p className="text-[11px] text-(--color-text-faint)">Yakuniy ball = rag&apos;batlantiruvchi jami − kamaytiruvchi jami (0 … 100). Manba: {template.source}</p>
      </CardBody>
    </Card>
  );
}

function CriterionRow({ c, pick, editable, onChange }: { c: KpiCriterion; pick: KpiPick | undefined; editable: boolean; onChange: (p: KpiPick | null) => void }) {
  const pts = pointsOf(c, pick);
  const sign = c.kind === 'BONUS' ? '+' : '−';
  const num = 'h-8 w-16 rounded border border-(--color-line-strong) bg-white px-2 text-sm tabular-nums disabled:bg-(--color-surface-muted)';
  return (
    <li className={cn('rounded-xl border px-3 py-2.5', pts ? (c.kind === 'BONUS' ? 'border-(--color-income)/40 bg-(--color-income-soft)/40' : 'border-(--color-expense)/40 bg-(--color-expense-soft)/40') : 'border-(--color-line) bg-white')}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-xs font-semibold text-(--color-text-faint)">{c.no}.</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-heading">{c.title}</span>
          <span className="block text-[11px] text-(--color-text-muted)">{c.method}</span>
        </span>
        <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-sm font-bold tabular-nums', pts ? (c.kind === 'BONUS' ? 'text-(--color-income)' : 'text-(--color-expense)') : 'text-(--color-text-faint)')} title={`Eng ko'pi: ${c.max} ball`}>
          {pts ? `${sign}${pts}` : 0} <span className="text-[10px] font-normal">/ {c.max}</span>
        </span>
      </div>
      <div className="mt-2 pl-5">
        {c.type === 'LEVEL' && (
          <div className="flex flex-wrap gap-1.5">
            {c.levels.map((l) => (
              <button key={l.id} type="button" disabled={!editable} onClick={() => onChange(pick?.level === l.id ? null : { level: l.id })} className={cn('rounded-full border px-2.5 py-1 text-xs', pick?.level === l.id ? 'border-brand-600 bg-brand-600 text-white' : 'border-(--color-line) bg-white text-heading hover:border-brand-300 disabled:hover:border-(--color-line)')}>
                {l.label} <b className="ml-0.5">{sign}{l.points}</b>
              </button>
            ))}
          </div>
        )}
        {c.type === 'FLAG' && (
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" disabled={!editable} checked={Boolean(pick?.on)} onChange={(e) => onChange(e.target.checked ? { on: true } : null)} />
            {c.label} ({sign}
            {c.max} ball)
          </label>
        )}
        {(c.type === 'PER_CASE' || c.type === 'COUNT_LEVELS') && (
          <label className="inline-flex items-center gap-2 text-sm">
            Holatlar soni:
            <input type="number" min={0} max={99} className={num} disabled={!editable} value={pick?.count ?? 0} onChange={(e) => onChange(Number(e.target.value) > 0 ? { count: Number(e.target.value) } : null)} />
          </label>
        )}
        {c.type === 'COUNT_TIERS' && (
          <div className="flex flex-wrap gap-3">
            {c.tiers.map((t) => (
              <label key={t.id} className="inline-flex items-center gap-2 text-xs">
                {t.label} ({sign}
                {t.points}):
                <input
                  type="number"
                  min={0}
                  max={99}
                  className={num}
                  disabled={!editable}
                  value={pick?.counts?.[t.id] ?? 0}
                  onChange={(e) => {
                    const counts = { ...(pick?.counts ?? {}), [t.id]: Math.max(0, Number(e.target.value) || 0) };
                    const clean = Object.fromEntries(Object.entries(counts).filter(([, v]) => v > 0));
                    onChange(Object.keys(clean).length ? { counts: clean } : null);
                  }}
                />
              </label>
            ))}
          </div>
        )}
      </div>
    </li>
  );
}
