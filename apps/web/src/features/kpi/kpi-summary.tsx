'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { MonthRangeCard, useMonthRange } from '@/features/units/month-range';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { downloadKpi, kpiApi, type KpiSummary } from './api';

// ═══════════════════════════════════════════════════════════
// Yig'ma KPI (umumiy hudud): bo'lim rahbarlaridan kelgan baholar — bo'lim → xodim × oy (yakuniy ball, yuborilganmi),
// xodimni bosing — mezonlar bo'yicha ballar. Rahbarlarni bo'limga biriktirish (administrator). Excel / PDF.
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone: 'success' | 'error' } | null;

export function KpiSummaryPage() {
  const { isAdmin } = useAuth();
  const range = useMonthRange('year');
  const res = useAsync(() => (range.error ? Promise.resolve(null) : kpiApi.summary(range.from, range.to).then((r) => r.data)), [range.from, range.to, range.error]);
  const [toast, setToast] = useState<ToastState>(null);
  const [busy, setBusy] = useState<'xlsx' | 'pdf' | null>(null);

  async function download(f: 'xlsx' | 'pdf') {
    setBusy(f);
    try {
      await downloadKpi(range.from, range.to, f);
    } catch (err) {
      setToast({ message: errorMessage(err, "Yuklab bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <MonthRangeCard range={range} />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={() => void download('xlsx')} loading={busy === 'xlsx'} disabled={Boolean(range.error) || busy !== null}>
          Excel
        </Button>
        <Button variant="secondary" onClick={() => void download('pdf')} loading={busy === 'pdf'} disabled={Boolean(range.error) || busy !== null}>
          PDF
        </Button>
        <span className="text-xs text-(--color-text-muted)">Hisobot: bo&apos;limlar bo&apos;yicha xulosa, xodimlar × oylar, mezonlar bo&apos;yicha ballar.</span>
      </div>
      {res.error ? <ErrorState message={res.error} onRetry={res.reload} /> : !res.data ? <LoadingState label="Baholar yig'ilmoqda" /> : res.data.departments.map((d) => <DepartmentCard key={d.key} d={d} months={res.data!.months} />)}
      {isAdmin && <HeadsCard onToast={setToast} />}
      {isAdmin && <DemoClearCard onToast={setToast} onDone={res.reload} />}
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

function DepartmentCard({ d, months }: { d: KpiSummary['departments'][number]; months: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const sent = d.months.filter((m) => m.submittedAt).length;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title={d.department}
        description={`${d.employees.length} xodim baholangan · yuborilgan ${sent}/${d.months.length} oy`}
        actions={
          <Link href={`/kpi/ish-stoli?b=${d.key}`} className="text-sm font-medium text-brand-700 hover:underline">
            Baholash stoli →
          </Link>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-(--color-surface-muted) text-[10.5px] tracking-wide text-(--color-text-muted) uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Xodim</th>
              {d.months.map((m) => (
                <th key={m.period} className="px-2 py-2 text-center font-semibold whitespace-nowrap" title={m.submittedAt ? `Yuborilgan: ${formatDateTime(m.submittedAt)}${m.submittedBy ? ` · ${m.submittedBy}` : ''}` : 'Yuborilmagan'}>
                  {formatPeriodShort(m.period)}
                  <span className={cn('ml-1', m.submittedAt ? 'text-(--color-income)' : 'text-(--color-text-faint)')}>{m.submittedAt ? '✓' : m.count ? '…' : ''}</span>
                </th>
              ))}
              <th className="px-3 py-2 text-right font-semibold">O&apos;rtacha</th>
            </tr>
          </thead>
          <tbody>
            {d.employees.map((e) => (
              <Fragment key={e.pinfl}>
                <tr className={cn('cursor-pointer border-t border-(--color-line) hover:bg-(--color-surface-muted)', open === e.pinfl && 'bg-brand-50/50')} onClick={() => setOpen(open === e.pinfl ? null : e.pinfl)}>
                  <td className="px-3 py-1.5">
                    <span className="font-medium text-heading">{e.fullName}</span>
                    <span className="block text-[11px] text-(--color-text-muted)">{e.position ?? ''}</span>
                  </td>
                  {months.map((p) => {
                    const m = e.months[p];
                    return (
                      <td key={p} className="px-2 py-1.5 text-center tabular-nums">
                        {m ? <span className={cn('font-semibold', !m.submitted && 'text-(--color-text-muted)')} title={`+${m.bonus} / −${m.penalty}${m.submitted ? '' : ' · yuborilmagan'}`}>{m.total}</span> : <span className="text-(--color-text-faint)">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-right font-bold text-heading tabular-nums">{e.average ?? '—'}</td>
                </tr>
                {open === e.pinfl && (
                  <tr>
                    <td colSpan={months.length + 2} className="border-t border-(--color-line) bg-(--color-surface-muted)/40 px-3 py-2">
                      <table className="w-full text-xs">
                        <thead className="text-[10.5px] text-(--color-text-muted)">
                          <tr>
                            <th className="px-2 py-1 text-left font-semibold">Mezon</th>
                            {months.map((p) => (
                              <th key={p} className="px-2 py-1 text-center font-semibold">
                                {formatPeriodShort(p)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {d.criteria
                            .filter((c) => months.some((p) => e.months[p]?.points[c.id]))
                            .map((c) => (
                              <tr key={c.id} className="border-t border-(--color-line)">
                                <td className="px-2 py-1">
                                  <Badge tone={c.kind === 'BONUS' ? 'income' : 'expense'} className="mr-1 px-1.5 py-0 text-[10px]">
                                    {c.kind === 'BONUS' ? '+' : '−'}
                                    {c.no}
                                  </Badge>
                                  {c.title}
                                </td>
                                {months.map((p) => (
                                  <td key={p} className={cn('px-2 py-1 text-center tabular-nums', c.kind === 'BONUS' ? 'text-(--color-income)' : 'text-(--color-expense)')}>
                                    {e.months[p]?.points[c.id] ? `${c.kind === 'BONUS' ? '+' : '−'}${e.months[p]!.points[c.id]}` : ''}
                                  </td>
                                ))}
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!d.employees.length && (
              <tr>
                <td colSpan={months.length + 2} className="px-3 py-4 text-sm text-(--color-text-muted)">
                  Bu davrda baholash kiritilmagan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** KPI demosini o'chirish: barcha baholar, rahbar biriktirishlari va «Bo'lim rahbari (KPI)» foydalanuvchilari (qaytarib bo'lmaydi) */
function DemoClearCard({ onToast, onDone }: { onToast: (t: ToastState) => void; onDone: () => void }) {
  const info = useAsync(() => kpiApi.demoInfo().then((r) => r.data), []);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const d = info.data;
  const empty = d ? d.months + d.users + d.heads === 0 : true;

  async function clear() {
    setBusy(true);
    try {
      const r = (await kpiApi.clearDemo(text)).data;
      onToast({ message: `KPI demosi o'chirildi: ${r.months} oylik baho, ${r.deleted} ta rahbar${r.blocked ? ` (${r.blocked} tasi bloklandi)` : ''}`, tone: 'success' });
      setOpen(false);
      setText('');
      info.reload();
      onDone();
    } catch (err) {
      onToast({ message: errorMessage(err, "O'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-(--color-expense)/30">
      <CardHeader
        title="KPI demosini o'chirish"
        description="Sinov uchun kiritilgan hamma narsa: barcha oylar baholari, rahbar biriktirishlari va «Bo'lim rahbari (KPI)» foydalanuvchilari. Shablonlar (mezonlar) va xodimlar ro'yxati qoladi."
        actions={
          !open ? (
            <Button variant="danger" onClick={() => setOpen(true)} disabled={empty}>
              KPI demosini o&apos;chirish
            </Button>
          ) : undefined
        }
      />
      <CardBody className="space-y-3 text-sm">
        {info.error ? (
          <p className="text-(--color-expense)">{info.error}</p>
        ) : !d ? (
          <p className="text-(--color-text-muted)">Yuklanmoqda…</p>
        ) : empty ? (
          <p className="text-(--color-text-muted)">O&apos;chiradigan narsa yo&apos;q — KPI toza.</p>
        ) : (
          <p className="text-heading">
            O&apos;chadi: <b>{d.months}</b> oylik baho ({d.scored} ta xodim bahosi), <b>{d.heads}</b> ta rahbar biriktirishi, <b>{d.users}</b> ta foydalanuvchi
            {d.codes.length ? ` (${d.codes.join(', ')})` : ''}.
          </p>
        )}
        {open && !empty && (
          <div className="rounded-(--radius-control) border border-(--color-expense)/30 bg-(--color-expense-soft) p-3">
            <p className="font-medium text-(--color-expense)">Bu qaytarib bo&apos;lmaydi. Tasdiqlash uchun pastga O&apos;CHIRISH deb yozing.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="O'CHIRISH" aria-label="Tasdiqlash so'zi" className="h-9 w-44 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm" />
              <Button variant="danger" onClick={() => void clear()} loading={busy} disabled={text !== "O'CHIRISH" || busy}>
                Hammasini o&apos;chirish
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setOpen(false);
                  setText('');
                }}
                disabled={busy}
              >
                Bekor
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** Rahbarlar: «Bo'lim rahbari (KPI)» rolidagi foydalanuvchini bo'limga biriktirish */
function HeadsCard({ onToast }: { onToast: (t: ToastState) => void }) {
  const res = useAsync(() => kpiApi.heads().then((r) => r.data), []);
  async function set(userId: string, b: string) {
    try {
      await kpiApi.setHead(userId, b || null);
      onToast({ message: 'Saqlandi', tone: 'success' });
      res.reload();
    } catch (err) {
      onToast({ message: errorMessage(err, "Saqlab bo'lmadi"), tone: 'error' });
    }
  }
  return (
    <Card>
      <CardHeader title="Bo'lim rahbarlari" description="«Bo'lim rahbari (KPI)» rolidagi foydalanuvchi qaysi bo'limni baholaydi. Yangi rahbar — Sozlamalar › Foydalanuvchilar." />
      <CardBody>
        {res.error ? (
          <p className="text-sm text-(--color-expense)">{res.error}</p>
        ) : !res.data ? (
          <p className="text-sm text-(--color-text-muted)">Yuklanmoqda…</p>
        ) : !res.data.users.length ? (
          <p className="text-sm text-(--color-text-muted)">
            Hali bo&apos;lim rahbari yo&apos;q —{' '}
            <Link href="/sozlamalar/foydalanuvchilar" className="text-brand-700 hover:underline">
              Sozlamalar › Foydalanuvchilar
            </Link>
            da «Bo&apos;lim rahbari (KPI)» rolini tanlab qo&apos;shing.
          </p>
        ) : (
          <ul className="divide-y divide-(--color-line)">
            {res.data.users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-heading">{u.fullName}</span>
                  <span className="ml-2 text-xs text-(--color-text-muted)">{u.loginCode}</span>
                  {!u.isActive && <Badge tone="neutral" className="ml-2">bloklangan</Badge>}
                </span>
                <select value={u.template ?? ''} onChange={(e) => void set(u.id, e.target.value)} className="h-8 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm">
                  <option value="">— bo&apos;lim biriktirilmagan —</option>
                  {res.data!.templates.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.department}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
