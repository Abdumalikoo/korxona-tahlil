'use client';

import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { RoleTabs } from '@/features/roles/role-tabs';
import { useAuth } from '@/lib/auth-context';
import { formatDateLong, formatDateTime, todayInput } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';
import { monthLabel, rdApi, type RdOverview } from './api';
import { MonthPicker, som } from './bits';
import { rdData } from '@/features/regional-data/api';
import { QualityList } from '@/features/regional-data/close';

// ═══════════════════════════════════════════════════════════
// Hududchi › Ish stoli (va administrator uchun «Hududlar» dashbordi):
//   shu oy nima yuklandi (daromad, ish haqi, xarajat), yil bo'yicha oylar holati,
//   viloyatlar kesimi: daromad − ish haqi − boshqa xarajat = sof natija.
// ═══════════════════════════════════════════════════════════

function hello(): string {
  const h = new Date().getHours();
  return h < 6 ? 'Xayrli tun' : h < 12 ? 'Xayrli tong' : h < 18 ? 'Xayrli kun' : 'Xayrli kech';
}

function StatusCard({ title, done, value, hint, href, action, tone }: { title: string; done: boolean; value: string; hint: string; href: string; action: string; tone: string }) {
  return (
    <div className={cn('flex flex-col rounded-(--radius-card) border-2 bg-white p-4 shadow-card', done ? 'border-emerald-200' : 'border-amber-200')}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-heading">{title}</p>
        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', done ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>{done ? '✓ yuklangan' : 'kutilmoqda'}</span>
      </div>
      <p className="money mt-2 truncate text-[24px] font-bold leading-tight text-heading">{value}</p>
      <p className="text-xs text-(--color-text-muted)">{hint}</p>
      <Link href={href} className={cn('mt-3 rounded-xl bg-gradient-to-r px-3 py-2 text-center text-sm font-bold text-white shadow-sm transition-transform hover:scale-[1.02]', tone)}>
        {action}
      </Link>
    </div>
  );
}

export function RegionalBoard({ admin = false }: { admin?: boolean }) {
  const { user } = useAuth();
  const thisMonth = todayInput().slice(0, 7);
  const [period, setPeriod] = useState(thisMonth);
  const ov = useAsync(() => rdApi.overview(period), [period]);
  const o: RdOverview | null = ov.data?.data ?? null;
  const qa = useAsync(() => (admin ? Promise.resolve(null) : rdData.quality(period)), [period, admin]);
  const q = qa.data?.data ?? null;
  const firstName = (user?.fullName ?? '').split(/\s+/)[1] ?? user?.fullName ?? '';
  const cur = o?.current;
  const maxInc = o ? Math.max(1, ...o.months.map((m) => Number(m.incomeTiyin))) : 1;
  const totals = o
    ? o.regions.reduce(
        (s, r) => ({ inc: s.inc + BigInt(r.incomeTiyin), pay: s.pay + BigInt(r.payrollTiyin), oth: s.oth + BigInt(r.otherTiyin), net: s.net + BigInt(r.netTiyin) }),
        { inc: 0n, pay: 0n, oth: 0n, net: 0n },
      )
    : null;

  return (
    <>
      <PageHeader
        title={admin ? 'Hududlar' : 'Ish stoli'}
        description={admin ? "Hududchi yuklagan daromad, ish haqi va xarajatlar — viloyatlar kesimida" : `${hello()}${firstName ? `, ${firstName}` : ''} · ${formatDateLong(todayInput())}`}
      />
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        {admin && <RoleTabs />}
        <div className="flex flex-wrap items-center gap-3">
          <MonthPicker value={period} onChange={setPeriod} max={thisMonth} />
          {period !== thisMonth && (
            <button type="button" onClick={() => setPeriod(thisMonth)} className="text-sm font-semibold text-brand-700 hover:underline">
              Joriy oy
            </button>
          )}
        </div>

        {ov.loading && !o ? (
          <LoadingState />
        ) : ov.error || !o || !cur || !totals ? (
          <ErrorState message={ov.error ?? "Ma'lumot yo'q"} onRetry={ov.reload} />
        ) : (
          <>
            {!admin && (
              <div className="grid gap-4 md:grid-cols-3">
                <StatusCard
                  title={`Daromad — ${o.periodLabel}`}
                  done={cur.incomeRows > 0}
                  value={`${som(cur.incomeTiyin)} so'm`}
                  hint={cur.incomeAt ? `Oxirgi yuklash: ${formatDateTime(cur.incomeAt)}` : 'Xizmatlar hisoboti hali yuklanmagan'}
                  href="/hudud/daromad"
                  action={cur.incomeRows > 0 ? 'Yangilash (qayta yuklash)' : 'Hisobotni yuklash'}
                  tone="from-brand-600 to-indigo-700"
                />
                <StatusCard
                  title={`Ish haqi — ${o.periodLabel}`}
                  done={cur.payrollUploaded}
                  value={`${som(cur.payrollTiyin)} so'm`}
                  hint={cur.payrollUploaded ? `${cur.payrollEmployees} xodim` : 'Hudud vedomosti yuklanmagan'}
                  href="/hudud/ish-haqi"
                  action={cur.payrollUploaded ? 'Vedomostni yangilash' : 'Vedomostni yuklash'}
                  tone="from-emerald-600 to-emerald-700"
                />
                <StatusCard
                  title={`Xarajatlar — ${o.periodLabel}`}
                  done={cur.otherCount > 0}
                  value={`${som(cur.otherTiyin)} so'm`}
                  hint={`${cur.otherCount} ta yozuv (ish haqisiz)`}
                  href="/hudud/xarajatlar"
                  action="Xarajat kiritish"
                  tone="from-amber-500 to-orange-600"
                />
              </div>
            )}

            {q && (
              <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
                <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-heading">Oy holati — {q.periodLabel}</p>
                    <p className="text-xs text-(--color-text-muted)">
                      {q.closed ? '✓ Oy yopilgan — ma‘lumotlar tasdiqlangan' : `${q.errors} xato · ${q.warnings} ogohlantirish — tuzatib, oyni yoping`}
                    </p>
                  </div>
                  <Link href="/hudud/yopish" className={cn('rounded-xl px-4 py-2 text-sm font-bold', q.closed ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-600 text-white shadow-sm hover:bg-brand-700')}>
                    {q.closed ? 'Yopilgan' : 'Oyni yopish →'}
                  </Link>
                </div>
                {!q.closed && <QualityList q={q} compact />}
              </div>
            )}

            {admin && (
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {[
                  { label: `Daromad — ${o.periodLabel}`, v: totals.inc },
                  { label: 'Ish haqi', v: totals.pay },
                  { label: 'Boshqa xarajatlar', v: totals.oth },
                  { label: 'Sof natija', v: totals.net },
                ].map((t) => (
                  <div key={t.label} className="rounded-(--radius-card) bg-white p-4 shadow-card">
                    <p className="text-xs font-semibold text-(--color-text-muted)">{t.label}</p>
                    <p className={cn('money mt-1 truncate text-[24px] font-bold', t.v < 0n ? 'text-(--color-expense)' : 'text-heading')}>{som(t.v.toString())}</p>
                    <p className="text-xs text-(--color-text-muted)">so&apos;m</p>
                  </div>
                ))}
              </div>
            )}

            {/* ── Oylar holati ── */}
            <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
              <div className="border-b border-(--color-line) px-4 py-3">
                <p className="font-semibold text-heading">{period.slice(0, 4)}-yil oylari</p>
                <p className="text-xs text-(--color-text-muted)">Qaysi oy yuklangan, qaysi biri qolgan — oyni bosing</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                      <th className="px-4 py-2">Oy</th>
                      <th className="px-3 py-2 text-right">Daromad</th>
                      <th className="w-40 px-3 py-2" />
                      <th className="px-3 py-2 text-right">Ish haqi</th>
                      <th className="px-3 py-2 text-right">Boshqa xarajat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {[...o.months].reverse().map((m) => (
                      <tr key={m.period} onClick={() => setPeriod(m.period)} className={cn('cursor-pointer hover:bg-brand-50/50', m.period === period && 'bg-brand-50')}>
                        <td className="px-4 py-2 font-semibold text-heading">{monthLabel(m.period)}</td>
                        <td className="money px-3 py-2 text-right">{m.incomeRows > 0 ? som(m.incomeTiyin) : <span className="text-xs font-semibold text-amber-600">yuklanmagan</span>}</td>
                        <td className="px-3 py-2">
                          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(Number(m.incomeTiyin) / maxInc) * 100}%` }} />
                          </div>
                        </td>
                        <td className="money px-3 py-2 text-right">{m.payrollUploaded ? som(m.payrollTiyin) : <span className="text-xs font-semibold text-amber-600">yuklanmagan</span>}</td>
                        <td className="money px-3 py-2 text-right">{m.otherCount > 0 || BigInt(m.otherTiyin) > 0n ? som(m.otherTiyin) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* ── Viloyatlar ── */}
            <div className="overflow-hidden rounded-(--radius-card) bg-white shadow-card">
              <div className="border-b border-(--color-line) px-4 py-3">
                <p className="font-semibold text-heading">Viloyatlar — {o.periodLabel}</p>
                <p className="text-xs text-(--color-text-muted)">Daromad − ish haqi − boshqa xarajat = sof natija · so&apos;m</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
                      <th className="px-4 py-2">Viloyat</th>
                      <th className="px-3 py-2 text-right">Daromad</th>
                      <th className="px-3 py-2 text-right">Xizmatlar</th>
                      <th className="px-3 py-2 text-right">Ish haqi</th>
                      <th className="px-3 py-2 text-right">Boshqa xarajat</th>
                      <th className="px-3 py-2 text-right">Sof natija</th>
                      <th className="px-3 py-2 text-right">Yil boshidan daromad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {o.regions.map((r) => {
                      const net = BigInt(r.netTiyin);
                      return (
                        <tr key={r.regionCode} className="hover:bg-slate-50">
                          <td className="px-4 py-2 font-medium text-heading">{r.name}</td>
                          <td className="money px-3 py-2 text-right font-semibold">{som(r.incomeTiyin)}</td>
                          <td className="money px-3 py-2 text-right text-(--color-text-muted)">{r.quantity ? r.quantity.toLocaleString('ru-RU') : '—'}</td>
                          <td className="money px-3 py-2 text-right">{som(r.payrollTiyin)}</td>
                          <td className="money px-3 py-2 text-right">{som(r.otherTiyin)}</td>
                          <td className={cn('money px-3 py-2 text-right font-bold', net < 0n ? 'text-(--color-expense)' : 'text-(--color-income)')}>{som(r.netTiyin)}</td>
                          <td className="money px-3 py-2 text-right text-(--color-text-muted)">{som(r.ytdIncomeTiyin)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-brand-50 font-bold text-heading">
                      <td className="px-4 py-2.5">Jami</td>
                      <td className="money px-3 py-2.5 text-right">{som(totals.inc.toString())}</td>
                      <td className="money px-3 py-2.5 text-right">{o.regions.reduce((s, r) => s + r.quantity, 0).toLocaleString('ru-RU')}</td>
                      <td className="money px-3 py-2.5 text-right">{som(totals.pay.toString())}</td>
                      <td className="money px-3 py-2.5 text-right">{som(totals.oth.toString())}</td>
                      <td className={cn('money px-3 py-2.5 text-right', totals.net < 0n && 'text-(--color-expense)')}>{som(totals.net.toString())}</td>
                      <td className="money px-3 py-2.5 text-right">{som(o.regions.reduce((s, r) => s + BigInt(r.ytdIncomeTiyin), 0n).toString())}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}