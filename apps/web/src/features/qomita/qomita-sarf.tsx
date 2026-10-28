'use client';

import { StatTiles, sum } from '@/components/report/report';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatPeriod, formatPeriodShort, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { qomitaApi, sarfApi, type SarfUnit } from './api';

// ═══════════════════════════════════════════════════════════
// 3802 › Qoplash va qoldiq — Qo'mita pullarining sarfi (faqat ko'rsatish; umumiy xarajatga ta'sir qilmaydi):
//  • 3802 hovuzi — «3802 Call Markaz» bo'lib kelgan pul va vedomostdagi hamma bo'limlar qoplashi (Oklad + 40% yoki to'liq);
//  • Xizmat shartnomalari — pul kelgan, 3802 qoplashi yo'q bo'lim (Marksheyder): kelgan va bo'limning to'liq sarfi.
// Bo'limni bosing — kelgan pullar (tasdiqlash, o'chirish), moddalar va xodimlar (tarkib bo'yicha hisoblangan, 3802 qismi).
// ═══════════════════════════════════════════════════════════

type ToastFn = (t: { message: string; tone: 'success' | 'error' } | null) => void;
const n = (s: string | null | undefined) => Number(s ?? 0);

function M({ v, signed = false, strong = false }: { v: string; signed?: boolean; strong?: boolean }) {
  const x = n(v);
  return <span className={cn('money whitespace-nowrap', strong && 'font-semibold', signed && x < 0 && 'text-(--color-expense)', signed && x > 0 && 'text-(--color-income)')}>{signed && x > 0 ? '+' : ''}{formatTiyin(v)}</span>;
}

const th = 'px-3 py-2 text-right font-semibold whitespace-nowrap';
const td = 'border-t border-(--color-line) px-3 py-1.5 text-right';

export function SarfSection({ from, to, isAdmin, onToast }: { from: string; to: string; isAdmin: boolean; onToast: ToastFn }) {
  const [rev, setRev] = useState(0);
  const res = useAsync(() => sarfApi.sarf(from, to).then((r) => r.data), [from, to, rev]);
  const [open, setOpen] = useState<string | null>(null);
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!res.data) return <LoadingState label="Qo'mita pullarining sarfi hisoblanmoqda" />;
  const s = res.data;
  const reload = () => setRev((x) => x + 1);
  const noVed = s.months.filter((p) => !s.vedMonths.includes(p));
  return (
    <div className="space-y-4">
      <StatTiles
        items={[
          { label: '3802: Qo‘mitadan kelgan', value: n(s.pool.incomeTiyin), tone: 'green', note: s.pool.units.filter((u) => n(u.incomeTiyin)).map((u) => u.label).join(', ') || '—' },
          { label: '3802: qoplanishi kerak', value: n(s.pool.coveredTiyin), tone: 'red', note: `vedomost bo'yicha · ${s.pool.units.length} bo'lim` },
          { label: n(s.pool.balanceTiyin) < 0 ? '3802: kamomad' : '3802: qoldiq', value: n(s.pool.balanceTiyin), tone: n(s.pool.balanceTiyin) < 0 ? 'orange' : 'blue', signed: true },
          { label: 'Xizmat shartnomalari: qoldiq', value: n(s.contracts.balanceTiyin), tone: 'purple', signed: true, note: `kelgan ${sum(n(s.contracts.incomeTiyin))} · sarf ${sum(n(s.contracts.spendTiyin))}` },
        ]}
      />
      {noVed.length > 0 && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          3802 vedomosti yo&apos;q oylar: {noVed.map(formatPeriodShort).join(', ')} — bu oylar uchun «qoplanishi kerak» 0 (3802 › Har oylik real bajarilgan ishlar).
        </p>
      )}

      {/* 3802 hovuzi */}
      <Card className="overflow-hidden">
        <CardHeader title="3802 hovuzi" description="Kelgan 3802 puli va vedomostdagi hamma bo'limlar qoplashi — oyma-oy, yig'ma qoldiq bilan. Bo'limni bosing — xodimlar." />
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-(--color-surface-muted) text-[10.5px] tracking-wide text-(--color-text-muted) uppercase">
              <tr>
                <th className="sticky left-0 bg-(--color-surface-muted) px-3 py-2 text-left font-semibold">Bo&apos;lim</th>
                {s.months.map((p) => (
                  <th key={p} className={th}>
                    {formatPeriodShort(p)}
                  </th>
                ))}
                <th className={th}>Jami</th>
              </tr>
            </thead>
            <tbody>
              <tr className="font-semibold">
                <td className="sticky left-0 border-t border-(--color-line) bg-white px-3 py-1.5 text-left text-(--color-income)">Kelgan</td>
                {s.pool.months.map((m) => (
                  <td key={m.period} className={td}>
                    {n(m.incomeTiyin) ? <M v={m.incomeTiyin} /> : '—'}
                  </td>
                ))}
                <td className={td}>
                  <M v={s.pool.incomeTiyin} strong />
                </td>
              </tr>
              <tr className="font-semibold">
                <td className="sticky left-0 border-t border-(--color-line) bg-white px-3 py-1.5 text-left text-(--color-expense)">Qoplanishi kerak</td>
                {s.pool.months.map((m) => (
                  <td key={m.period} className={td}>
                    {n(m.coveredTiyin) ? <M v={m.coveredTiyin} /> : '—'}
                  </td>
                ))}
                <td className={td}>
                  <M v={s.pool.coveredTiyin} strong />
                </td>
              </tr>
              <tr className="bg-brand-50/40 font-semibold">
                <td className="sticky left-0 border-t border-(--color-line) bg-brand-50 px-3 py-1.5 text-left">Yig&apos;ma qoldiq</td>
                {s.pool.months.map((m) => (
                  <td key={m.period} className={td}>
                    <M v={m.balanceTiyin} signed />
                  </td>
                ))}
                <td className={td}>
                  <M v={s.pool.balanceTiyin} signed strong />
                </td>
              </tr>
              {s.pool.units.map((u) => (
                <UnitRows key={u.key} u={u} months={s.months} mode="POOL" open={open === u.key} onToggle={() => setOpen(open === u.key ? null : u.key)} from={from} to={to} isAdmin={isAdmin} onToast={onToast} onChanged={reload} />
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Xizmat shartnomalari */}
      {(s.contracts.units.length > 0 || s.unassigned) && (
        <Card className="overflow-hidden">
          <CardHeader title="Xizmat shartnomalari" description="Qo'mitadan xizmat haqi olgan bo'limlar: kelgan pul va bo'limning to'liq sarfi (moddalar bo'yicha). Bo'limni bosing — kelgan pullar, moddalar, xodimlar." />
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-(--color-surface-muted) text-[10.5px] tracking-wide text-(--color-text-muted) uppercase">
                <tr>
                  <th className="sticky left-0 bg-(--color-surface-muted) px-3 py-2 text-left font-semibold">Bo&apos;lim</th>
                  {s.months.map((p) => (
                    <th key={p} className={th}>
                      {formatPeriodShort(p)}
                    </th>
                  ))}
                  <th className={th}>Jami</th>
                </tr>
              </thead>
              <tbody>
                {[...s.contracts.units, ...(s.unassigned ? [s.unassigned] : [])].map((u) => (
                  <UnitRows key={u.key} u={u} months={s.months} mode="CONTRACT" open={open === u.key} onToggle={() => setOpen(open === u.key ? null : u.key)} from={from} to={to} isAdmin={isAdmin} onToast={onToast} onChanged={reload} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="text-xs text-(--color-text-muted)">
        Bu — faqat ko&apos;rsatish: xarajatlar jadvaliga hech narsa yozilmaydi, umumiy xarajat o&apos;zgarmaydi. Qoplash qoidasi — Nazorat zanjiri bilan bir xil (shtat: Oklad + 40% yoki to&apos;liq; shtatda topilmagan bo&apos;lim — Oklad + 40%).
      </p>
    </div>
  );
}

/** Bo'lim qatori (hovuzda — qoplanishi kerak, shartnomada — kelgan / sarf / qoldiq) va ochilganda — tafsilot */
function UnitRows({ u, months, mode, open, onToggle, from, to, isAdmin, onToast, onChanged }: { u: SarfUnit; months: string[]; mode: 'POOL' | 'CONTRACT'; open: boolean; onToggle: () => void; from: string; to: string; isAdmin: boolean; onToast: ToastFn; onChanged: () => void }) {
  const head = (
    <td className="sticky left-0 border-t border-(--color-line) bg-white px-3 py-1.5 text-left">
      <button type="button" onClick={onToggle} className="flex max-w-60 items-center text-left font-medium text-heading hover:text-brand-700" aria-expanded={open} title={u.label}>
        <span className="mr-1 shrink-0 text-(--color-text-faint)">{open ? '▾' : '▸'}</span>
        <span className="truncate">{u.label}</span>
      </button>
      {mode === 'POOL' && n(u.incomeTiyin) > 0 && <span className="ml-1 text-[10.5px] text-(--color-income)">kelgan: {formatTiyin(u.incomeTiyin)}</span>}
    </td>
  );
  return (
    <>
      {mode === 'POOL' ? (
        <tr>
          {head}
          {months.map((p) => (
            <td key={p} className={td}>
              {n(u.byMonth[p]?.covered) ? <M v={u.byMonth[p]!.covered} /> : <span className="text-(--color-text-faint)">—</span>}
            </td>
          ))}
          <td className={td}>
            <M v={u.coveredTiyin} strong />
          </td>
        </tr>
      ) : (
        <>
          <tr>
            {head}
            {months.map((p) => (
              <td key={p} className={td}>
                {n(u.byMonth[p]?.income) ? <span className="text-(--color-income)"><M v={u.byMonth[p]!.income} /></span> : <span className="text-(--color-text-faint)">—</span>}
                {n(u.byMonth[p]?.spend) > 0 && (
                  <span className="block text-(--color-expense)">
                    −<M v={u.byMonth[p]!.spend} />
                  </span>
                )}
              </td>
            ))}
            <td className={td}>
              <span className="block text-(--color-income)">
                <M v={u.incomeTiyin} strong />
              </span>
              <span className="block text-(--color-expense)">
                −<M v={u.spendTiyin} />
              </span>
              <M v={u.fullBalanceTiyin} signed strong />
            </td>
          </tr>
        </>
      )}
      {open && (
        <tr>
          <td colSpan={months.length + 2} className="border-t border-(--color-line) bg-(--color-surface-muted)/40 px-3 py-3">
            <UnitDetail u={u} months={months} mode={mode} from={from} to={to} isAdmin={isAdmin} onToast={onToast} onChanged={onChanged} />
          </td>
        </tr>
      )}
    </>
  );
}

function UnitDetail({ u, months, mode, from, to, isAdmin, onToast, onChanged }: { u: SarfUnit; months: string[]; mode: 'POOL' | 'CONTRACT'; from: string; to: string; isAdmin: boolean; onToast: ToastFn; onChanged: () => void }) {
  const [rev, setRev] = useState(0);
  const det = useAsync(() => (u.departmentId ? sarfApi.unit(u.key, from, to).then((r) => r.data) : Promise.resolve(null)), [u.key, from, to, rev]);
  const inc = useAsync(() => qomitaApi.detail(u.departmentId ?? '-', from, to).then((r) => r.data), [u.key, from, to, rev]);
  const [removing, setRemoving] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = () => {
    setRev((x) => x + 1);
    onChanged();
  };
  async function approve(id: string, ok: boolean) {
    try {
      await sarfApi.approveIncome(id, ok);
      onToast({ message: ok ? 'Tasdiqlandi' : 'Tasdiq olib tashlandi', tone: 'success' });
      changed();
    } catch (err) {
      onToast({ message: errorMessage(err, "Saqlab bo'lmadi"), tone: 'error' });
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await qomitaApi.removeIncome(removing.id);
      onToast({ message: "O'chirildi", tone: 'success' });
      setRemoving(null);
      changed();
    } catch (err) {
      onToast({ message: errorMessage(err, "O'chirib bo'lmadi"), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  const ORIGIN: Record<string, string> = { BANK: 'bank tahlilidan', MANUAL: "qo'lda", FILE: "ko'chirma faylidan", OTHER: 'boshqa manba' };
  return (
    <div className="space-y-3">
      {/* Kelgan pullar */}
      <div>
        <p className="mb-1 text-xs font-semibold text-heading">Qo&apos;mitadan kelgan pullar</p>
        {inc.error ? (
          <p className="text-xs text-(--color-expense)">{inc.error}</p>
        ) : !inc.data ? (
          <p className="text-xs text-(--color-text-muted)">Yuklanmoqda…</p>
        ) : !inc.data.incomes.length ? (
          <p className="text-xs text-(--color-text-muted)">Bu davrda shu bo&apos;limga Qo&apos;mita puli yozilmagan.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-(--color-line) bg-white">
            <table className="w-full text-xs">
              <tbody>
                {inc.data.incomes.map((x) => {
                  const canDelete = x.origin === 'MANUAL' || x.origin === 'FILE';
                  return (
                    <tr key={x.id} className="border-t border-(--color-line) first:border-t-0">
                      <td className="px-2 py-1.5 whitespace-nowrap">{x.date.split('-').reverse().join('.')}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{formatPeriod(x.period)} uchun</td>
                      <td className="money px-2 py-1.5 text-right font-semibold text-(--color-income)">{formatTiyin(x.amountTiyin)}</td>
                      <td className="max-w-md px-2 py-1.5 text-(--color-text-muted)">
                        <span className="line-clamp-1" title={x.description ?? ''}>
                          {ORIGIN[x.origin]} · {x.description}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {x.approved ? (
                          <span className="text-(--color-income)" title={`${x.approved.by} · ${formatDateTime(x.approved.at)}`}>
                            ✓ tasdiqlangan
                            {isAdmin && (
                              <button type="button" className="ml-1 text-(--color-text-faint) underline" onClick={() => void approve(x.id, false)}>
                                bekor
                              </button>
                            )}
                          </span>
                        ) : isAdmin ? (
                          <button type="button" className="rounded border border-brand-300 bg-white px-2 py-0.5 font-semibold text-brand-700 hover:bg-brand-50" onClick={() => void approve(x.id, true)}>
                            Tasdiqlash
                          </button>
                        ) : (
                          <Badge tone="warn">tasdiqlanmagan</Badge>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {isAdmin &&
                          (canDelete ? (
                            <button type="button" className="rounded px-1.5 text-(--color-text-faint) hover:bg-red-50 hover:text-(--color-expense)" onClick={() => setRemoving({ id: x.id, text: `${formatTiyin(x.amountTiyin)} so'm · ${formatPeriod(x.period)}` })} title="O'chirish">
                              O&apos;chirish
                            </button>
                          ) : (
                            <span className="text-[10.5px] text-(--color-text-faint)" title="Bank ko'chirmasi sahifasida yo'naltirishni bekor qiling">
                              bank sahifasida
                            </span>
                          ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Moddalar (shartnoma — to'liq sarf) */}
      {mode === 'CONTRACT' && u.categories.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold text-heading">Sarf moddalar bo&apos;yicha{u.segment ? ` (bo'lim va «${u.label}» yo'nalishi xarajatlari)` : ''}</p>
          <div className="overflow-x-auto rounded-lg border border-(--color-line) bg-white">
            <table className="w-full text-xs">
              <thead className="text-[10.5px] text-(--color-text-muted)">
                <tr>
                  <th className="px-2 py-1 text-left font-semibold">Modda</th>
                  {months.map((p) => (
                    <th key={p} className="px-2 py-1 text-right font-semibold">
                      {formatPeriodShort(p)}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-right font-semibold">Jami</th>
                </tr>
              </thead>
              <tbody>
                {u.categories.map((c) => (
                  <tr key={c.code} className="border-t border-(--color-line)">
                    <td className="px-2 py-1 text-heading">{c.label}</td>
                    {months.map((p) => (
                      <td key={p} className="money px-2 py-1 text-right">
                        {n(c.byMonth[p]) ? formatTiyin(c.byMonth[p]!) : <span className="text-(--color-text-faint)">—</span>}
                      </td>
                    ))}
                    <td className="money px-2 py-1 text-right font-semibold">{formatTiyin(c.totalTiyin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Xodimlar */}
      {u.departmentId && (
        <div>
          <p className="mb-1 text-xs font-semibold text-heading">Xodimlar: hisoblangan ish haqi (tarkib){mode === 'POOL' ? " va shundan 3802 qoplaydigan qismi (vedomost)" : ''}</p>
          {det.error ? (
            <p className="text-xs text-(--color-expense)">{det.error}</p>
          ) : !det.data ? (
            <p className="text-xs text-(--color-text-muted)">Yuklanmoqda…</p>
          ) : !det.data.employees.length ? (
            <p className="text-xs text-(--color-text-muted)">Xodim topilmadi.</p>
          ) : (
            <div className="max-h-[480px] overflow-auto rounded-lg border border-(--color-line) bg-white">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-(--color-surface-muted) text-[10.5px] text-(--color-text-muted)">
                  <tr>
                    <th className="sticky left-0 bg-(--color-surface-muted) px-2 py-1 text-left font-semibold">Xodim</th>
                    {months.map((p) => (
                      <th key={p} className="px-2 py-1 text-right font-semibold">
                        {formatPeriodShort(p)}
                      </th>
                    ))}
                    <th className="px-2 py-1 text-right font-semibold">Jami</th>
                  </tr>
                </thead>
                <tbody>
                  {det.data.employees.map((e) => (
                    <tr key={e.pinfl ?? e.fullName} className="border-t border-(--color-line) align-top">
                      <td className="sticky left-0 bg-white px-2 py-1">
                        <span className="font-medium text-heading">{e.fullName}</span>
                        <span className="block text-[10px] text-(--color-text-faint)">{[!e.inTarkib && "tarkibda yo'q", mode === 'POOL' && !e.inVedomost && "vedomostda yo'q"].filter(Boolean).join(' · ')}</span>
                      </td>
                      {months.map((p) => {
                        const m = e.months[p];
                        return (
                          <td key={p} className="money px-2 py-1 text-right whitespace-nowrap">
                            {m && n(m.paid) ? formatTiyin(m.paid) : <span className="text-(--color-text-faint)">—</span>}
                            {mode === 'POOL' && m && n(m.covered) > 0 && <span className="block text-[10.5px] text-brand-700">3802: {formatTiyin(m.covered)}</span>}
                          </td>
                        );
                      })}
                      <td className="money px-2 py-1 text-right font-semibold whitespace-nowrap">
                        {formatTiyin(e.paidTiyin)}
                        {mode === 'POOL' && n(e.coveredTiyin) > 0 && <span className="block text-[10.5px] text-brand-700">3802: {formatTiyin(e.coveredTiyin)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <ConfirmDialog open={Boolean(removing)} danger title="Qo'mita yozuvini o'chirish" message={removing ? `${removing.text} — o'chiriladi.` : ''} confirmLabel="O'chirish" loading={busy} onConfirm={() => void remove()} onCancel={() => setRemoving(null)} />
    </div>
  );
}

