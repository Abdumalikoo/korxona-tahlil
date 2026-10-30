'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, useMemo, useState } from 'react';
import { bayramApi, type BayramEmployee, type BayramMonth } from './api';

// ═══════════════════════════════════════════════════════════
// 23106 › Hudud xodimlari bayram pullari — Markaz hisobiga.
// Hududda asosiy shtatda ishlovchilarning bayram pullarini Markaz to'laydi. Hudud xodimlari ish haqi tarkibida yo'q —
// yagona manba 23106 ko'chirmasi. Avval KO'RIB CHIQILADI (hech narsa o'zgarmaydi): hisoblangan oy → viloyat → tuman →
// xodim → to'lovlar. Oy TASDIQLANGANDAN keyingina shu oy ish haqi qayta guruhlanadi: bayram puli hudud ish haqidan
// ayiriladi va Markaz hisobiga «Bayram pullari» bo'lib yoziladi (viloyat saqlanadi). Bekor qilish — hududga qaytadi.
// ═══════════════════════════════════════════════════════════

type Ask = { kind: 'confirm'; months: BayramMonth[] } | { kind: 'delete'; months: BayramMonth[]; all: boolean } | null;

const sumT = (list: { movableTiyin?: string; totalTiyin?: string; amountTiyin?: string }[], f: 'movableTiyin' | 'totalTiyin' | 'amountTiyin') => list.reduce((s, x) => s + BigInt(x[f] ?? '0'), 0n).toString();

export function BayramPanel({ from, to, rangeText, disabled, isAdmin, reloadKey, onToast }: { from: string; to: string; rangeText: string; disabled: boolean; isAdmin: boolean; reloadKey: number; onToast: (t: { message: string; tone: 'success' | 'error' }) => void }) {
  const data = useAsync(() => (disabled ? Promise.resolve(null) : bayramApi.view(from, to).then((r) => r.data)), [from, to, disabled, reloadKey]);
  const [month, setMonth] = useState<string>('ALL');
  const [openReg, setOpenReg] = useState<Set<number>>(new Set());
  const [openDis, setOpenDis] = useState<Set<string>>(new Set());
  const [showExcluded, setShowExcluded] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const v = data.data;

  // Tanlangan oy bo'yicha: viloyat → tuman → xodim (jamlar qayta hisoblanadi)
  const tree = useMemo(() => {
    if (!v) return [];
    return v.regions
      .map((r) => {
        const districts = r.districts
          .map((d) => {
            const employees = month === 'ALL' ? d.employees : d.employees.filter((e) => e.period === month);
            return { ...d, employees, count: employees.reduce((s, e) => s + e.payments.length, 0), totalTiyin: sumT(employees, 'amountTiyin'), movableTiyin: sumT(employees, 'movableTiyin') };
          })
          .filter((d) => d.employees.length);
        return { ...r, districts, people: new Set(districts.flatMap((d) => d.employees.map((e) => e.pinfl))).size, count: districts.reduce((s, d) => s + d.count, 0), totalTiyin: sumT(districts, 'totalTiyin'), movableTiyin: sumT(districts, 'movableTiyin') };
      })
      .filter((r) => r.districts.length);
  }, [v, month]);

  async function run() {
    if (!ask) return;
    setBusy(true);
    try {
      if (ask.kind === 'confirm') {
        const r = (await bayramApi.confirm(ask.months.map((m) => m.period))).data;
        onToast({ message: `Tasdiqlandi: ${r.count} ta to'lov · Markaz hisobiga o'tdi ${formatTiyin(r.movedTiyin)} so'm${r.routed ? '' : ' (siyosat bo\'yicha bayram hududda qoladi — ajratilmadi)'}`, tone: 'success' });
      } else {
        const r = (await bayramApi.remove(ask.all ? { all: true } : { ids: ask.months.map((m) => m.posted!.id) })).data;
        onToast({ message: `O'chirildi: ${r.periods.length ? r.periods.map(formatPeriod).join(', ') : `${r.removed} ta tasdiq`} — bayram pullari hudud ish haqiga qaytdi`, tone: 'success' });
      }
      data.reload();
    } catch (err) {
      onToast({ message: errorMessage(err, ask.kind === 'confirm' ? 'Tasdiqlashda xatolik' : "O'chirishda xatolik"), tone: 'error' });
    } finally {
      setBusy(false);
      setAsk(null);
    }
  }

  if (disabled) return null;
  if (data.loading && !v) return <LoadingState />;
  if (data.error) return <ErrorState message={data.error} onRetry={data.reload} />;
  if (!v || !v.months.length) {
    return (
      <Card>
        <CardHeader title="Hudud xodimlari bayram pullari — Markaz hisobiga" description={`${rangeText || 'Tanlangan davr'}: saqlangan ko'chirmada bayram puli to'lovi yo'q`} />
      </Card>
    );
  }
  const s = v.summary;
  const pending = v.months.filter((m) => m.count > 0 && (!m.posted || m.changed));
  const postedMonths = v.months.filter((m) => m.posted);
  const askTotal = ask?.kind === 'confirm' ? sumT(ask.months, 'movableTiyin') : '0';

  return (
    <>
      <Card className="overflow-hidden" id="acc23106-bayram">
        <CardHeader
          title="Hudud xodimlari bayram pullari — Markaz hisobiga"
          description="Hududda asosiy shtatda ishlovchilarning bayram pullarini Markaz to'laydi. Hudud xodimlari ish haqi tarkibida yo'q — yagona manba shu ko'chirma. Quyida ko'rib chiqing (hech narsa o'zgarmaydi). Oyni tasdiqlaganingizdan keyingina bayram puli shu oy hudud ish haqidan ayirilib, Markaz hisobiga «Bayram pullari» bo'lib yoziladi; viloyat saqlanadi, korxona jami o'zgarmaydi."
        />
        <CardBody className="space-y-4">
          <p className={cn('flex items-start gap-2 rounded-(--radius-control) border px-3 py-2 text-sm', v.policy.routed ? 'border-(--color-line) bg-(--color-surface-muted) text-(--color-text-muted)' : 'border-(--color-warn) bg-(--color-warn-soft) text-heading')}>
            {!v.policy.routed && <IconAlert className="mt-0.5 size-4 shrink-0 text-(--color-warn)" />}
            <span>
              <b className="text-heading">Qayerga yoziladi:</b> {v.policy.text}. Summa — 23106 dagi (bank o&apos;tkazgan) summa; xodimning shu oy ish haqidan oshmaydi. Oy — hisoblangan oy (izohdagi oy, bo&apos;lmasa buyruq oyi).
            </span>
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Box label="Hudud xodimlari bayrami" value={`${formatTiyin(s.totalTiyin)}`} sub={`${s.count} ta to'lov · ${s.people} xodim`} />
            <Box label="Ish haqidan ajratiladi" value={formatTiyin(s.movableTiyin)} sub={s.notInPayroll ? `${s.notInPayroll} xodim shu oy ish haqida yo'q — ajratilmaydi` : "hammasi shu oy ish haqida bor"} tone={s.notInPayroll ? 'warn' : 'neutral'} />
            <Box label="Tasdiqlangan" value={formatTiyin(s.postedTiyin)} sub="Markaz hisobida" tone={s.postedTiyin !== '0' ? 'income' : 'neutral'} />
            <Box label="Markaz xodimlari bayrami" value={formatTiyin(s.centerTiyin)} sub={`${s.centerCount} ta to'lov — o'z bo'limida, ajratilmaydi`} />
          </div>

          {/* Oylar: holat va tasdiqlash */}
          <div className="overflow-x-auto rounded-(--radius-control) border border-(--color-line)">
            <table className="w-full text-sm">
              <thead className="bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Hisoblangan oy</th>
                  <th className="px-2 py-2 text-right font-semibold">Hudud xodimlari</th>
                  <th className="px-2 py-2 text-right font-semibold">23106 summa</th>
                  <th className="px-2 py-2 text-right font-semibold">Ajratiladi</th>
                  <th className="px-3 py-2 text-left font-semibold">Holat</th>
                  {isAdmin && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {v.months.map((m) => (
                  <tr key={m.period} className={cn('border-t border-(--color-line)', month === m.period && 'bg-brand-50')}>
                    <td className="px-3 py-2">
                      <button type="button" className="font-medium text-heading hover:text-brand-700 hover:underline" onClick={() => setMonth(month === m.period ? 'ALL' : m.period)}>
                        {formatPeriod(m.period)}
                      </button>
                      {m.centerCount + m.otherCount > 0 && (
                        <span className="block text-[11px] text-(--color-text-muted)">
                          {m.centerCount > 0 && `Markaz: ${m.centerCount} ta · ${formatTiyin(m.centerTiyin)}`}
                          {m.otherCount > 0 && `${m.centerCount ? ' · ' : ''}olinmagan: ${m.otherCount} ta`}
                        </span>
                      )}
                    </td>
                    <td className="money px-2 py-2 text-right">
                      {m.people} <span className="text-[11px] text-(--color-text-muted)">({m.count} to&apos;lov)</span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Money tiyin={m.totalTiyin} />
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Money tiyin={m.movableTiyin} tone="expense" />
                      {m.notInPayroll > 0 && <span className="block text-[11px] text-(--color-warn)">{m.notInPayroll} xodim ish haqida yo&apos;q</span>}
                    </td>
                    <td className="px-3 py-2">
                      {m.count === 0 ? (
                        <span className="text-xs text-(--color-text-muted)">hudud xodimi yo&apos;q</span>
                      ) : m.posted ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone="income">tasdiqlangan</Badge>
                          {m.changed && <Badge tone="warn">ko&apos;chirma o&apos;zgargan — qayta tasdiqlang</Badge>}
                          <span className="text-[11px] text-(--color-text-muted)">
                            {formatDateTime(m.posted.createdAt)}
                            {m.posted.createdBy ? ` · ${m.posted.createdBy}` : ''}
                          </span>
                        </span>
                      ) : (
                        <Badge tone="warn">ko&apos;rib chiqilmoqda — tasdiqlanmagan</Badge>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {m.count > 0 && (!m.posted || m.changed) && (
                          <Button size="sm" onClick={() => setAsk({ kind: 'confirm', months: [m] })}>
                            {m.posted ? 'Qayta tasdiqlash' : 'Tasdiqlash'}
                          </Button>
                        )}
                        {m.posted && (
                          <Button size="sm" variant="ghost" className="text-(--color-expense) hover:bg-(--color-expense-soft)" onClick={() => setAsk({ kind: 'delete', months: [m], all: false })}>
                            O&apos;chirish
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {isAdmin && (pending.length > 1 || postedMonths.length > 0) && (
              <div className="flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-(--color-surface-muted) px-3 py-2.5">
                {postedMonths.length > 0 && (
                  <Button variant="ghost" className="text-(--color-expense) hover:bg-(--color-expense-soft)" onClick={() => setAsk({ kind: 'delete', months: postedMonths, all: true })}>
                    Tasdiqlanganlarning hammasini o&apos;chirish ({postedMonths.length} oy)
                  </Button>
                )}
                {pending.length > 1 && (
                  <>
                    <span className="ml-auto text-sm text-(--color-text-muted)">
                      Tasdiqlanmagan: <b className="text-heading">{pending.length}</b> oy · <span className="money font-semibold text-heading">{formatTiyin(sumT(pending, 'movableTiyin'))}</span> so&apos;m
                    </span>
                    <Button onClick={() => setAsk({ kind: 'confirm', months: pending })}>Hammasini tasdiqlash</Button>
                  </>
                )}
              </div>
            )}
          </div>
        </CardBody>

        {/* Viloyat → tuman → xodim → to'lovlar */}
        <div className="flex flex-wrap items-center gap-2 border-y border-(--color-line) px-5 py-2.5">
          <span className="mr-1 text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">Viloyatlar kesimida</span>
          <Chip active={month === 'ALL'} onClick={() => setMonth('ALL')}>
            Hamma oylar
          </Chip>
          {v.months
            .filter((m) => m.count > 0)
            .map((m) => (
              <Chip key={m.period} active={month === m.period} onClick={() => setMonth(m.period)}>
                {formatPeriod(m.period)}
              </Chip>
            ))}
          <button
            type="button"
            className="ml-auto text-xs font-medium text-brand-700 hover:underline"
            onClick={() => {
              const all = openReg.size === 0;
              setOpenReg(all ? new Set(tree.map((r) => r.regionCode)) : new Set());
              setOpenDis(all ? new Set(tree.flatMap((r) => r.districts.map((d) => `${r.regionCode}|${d.districtId ?? ''}`))) : new Set());
            }}
          >
            {openReg.size ? 'Hammasini yopish' : 'Hammasini ochish'}
          </button>
        </div>
        <div className="max-h-[680px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
              <tr>
                <th className="px-4 py-2 text-left font-semibold">Viloyat › tuman › xodim</th>
                <th className="w-28 px-2 py-2 text-right font-semibold">To&apos;lovlar</th>
                <th className="w-40 px-2 py-2 text-right font-semibold">23106 summa</th>
                <th className="w-40 px-2 py-2 text-right font-semibold">Ajratiladi</th>
                <th className="w-44 px-3 py-2 text-left font-semibold">Holat</th>
              </tr>
            </thead>
            <tbody>
              {tree.map((r) => {
                const ro = openReg.has(r.regionCode);
                return (
                  <Fragment key={r.regionCode}>
                    <tr className={cn('cursor-pointer border-t border-(--color-line) bg-[#f6f8fd] font-semibold hover:bg-brand-50', ro && 'bg-brand-50')} onClick={() => setOpenReg((o) => toggled(o, r.regionCode))}>
                      <td className="px-4 py-2 text-heading">
                        <Caret open={ro} />
                        {r.name} <span className="text-xs font-normal text-(--color-text-muted)">· {r.people} xodim</span>
                      </td>
                      <td className="money px-2 py-2 text-right">{r.count}</td>
                      <td className="px-2 py-2 text-right">
                        <Money tiyin={r.totalTiyin} />
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Money tiyin={r.movableTiyin} tone="expense" />
                      </td>
                      <td className="px-3 py-2" />
                    </tr>
                    {ro &&
                      r.districts.map((d) => {
                        const dk = `${r.regionCode}|${d.districtId ?? ''}`;
                        const dop = openDis.has(dk);
                        return (
                          <Fragment key={dk}>
                            <tr className="cursor-pointer border-t border-(--color-line) hover:bg-(--color-surface-muted)" onClick={() => setOpenDis((o) => toggled(o, dk))}>
                              <td className={cn('py-2 pr-2 pl-9 font-medium', d.districtId ? 'text-heading' : 'text-(--color-warn)')}>
                                <Caret open={dop} />
                                {d.name} <span className="text-xs font-normal text-(--color-text-muted)">· {d.employees.length} xodim</span>
                              </td>
                              <td className="money px-2 py-2 text-right">{d.count}</td>
                              <td className="px-2 py-2 text-right">
                                <Money tiyin={d.totalTiyin} />
                              </td>
                              <td className="px-2 py-2 text-right">
                                <Money tiyin={d.movableTiyin} tone="expense" />
                              </td>
                              <td className="px-3 py-2" />
                            </tr>
                            {dop && d.employees.map((e) => <EmpRow key={`${e.period}|${e.pinfl}`} e={e} showMonth={month === 'ALL'} />)}
                          </Fragment>
                        );
                      })}
                  </Fragment>
                );
              })}
              {!tree.length && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-(--color-text-muted)">
                    Bu oyda hudud xodimlarining bayram to&apos;lovi yo&apos;q
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {v.excluded.length > 0 && (
          <div className="border-t border-(--color-line) px-5 py-3">
            <button type="button" className="text-sm font-medium text-(--color-text-muted) hover:text-heading" onClick={() => setShowExcluded((x) => !x)}>
              <Caret open={showExcluded} />
              Olinmagan to&apos;lovlar: {v.excluded.length} ta · <span className="money">{formatTiyin(s.otherTiyin)}</span> so&apos;m (hudud × asosiy shtat emas yoki xodim aniqlanmagan)
            </button>
            {showExcluded && (
              <ul className="mt-2 divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line) text-sm">
                {v.excluded.map((x, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                    <span className="min-w-0 flex-1 font-medium text-heading">{x.fullName}</span>
                    <span className="text-xs text-(--color-text-muted)">
                      {formatPeriod(x.period)} · {formatDate(x.docDate)}
                    </span>
                    <span className="text-xs text-(--color-warn)">{x.reason}</span>
                    <Money tiyin={x.amountTiyin} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={ask !== null}
        title={ask?.kind === 'delete' ? (ask.all ? "Hamma tasdiqlarni o'chirish" : "Tasdiqni o'chirish") : 'Hudud bayram pullarini tasdiqlash'}
        message={
          ask?.kind === 'delete'
            ? `${ask.months.map((m) => formatPeriod(m.period)).join(', ')}: tasdiq butunlay o'chiriladi — ${ask.months.reduce((n, m) => n + (m.posted?.count ?? 0), 0)} ta bayram to'lovi Markaz hisobidan olinadi va hudud ish haqiga qaytadi (o'sha oylar ish haqi qayta guruhlanadi). 23106 ko'chirmasi o'zgarmaydi — keyin qayta tasdiqlash mumkin.`
            : ask?.kind === 'confirm'
              ? `${ask.months.map((m) => formatPeriod(m.period)).join(', ')}: ${ask.months.reduce((n, m) => n + m.count, 0)} ta to'lov — ${formatTiyin(askTotal)} so'm hudud ish haqidan ayiriladi va Markaz hisobiga «Bayram pullari» bo'lib yoziladi (viloyat saqlanadi, korxona jami o'zgarmaydi). Keyin «O'chirish» bilan qaytarish mumkin.`
              : ''
        }
        confirmLabel={ask?.kind === 'delete' ? "O'chirish" : 'Tasdiqlash'}
        danger={ask?.kind === 'delete'}
        loading={busy}
        onConfirm={() => void run()}
        onCancel={() => setAsk(null)}
      />
    </>
  );
}

function EmpRow({ e, showMonth }: { e: BayramEmployee; showMonth: boolean }) {
  const capped = e.fullTiyin !== null && BigInt(e.movableTiyin) < BigInt(e.amountTiyin);
  return (
    <tr className={cn('border-t border-(--color-line) align-top', e.fullTiyin === null && 'bg-(--color-expense-soft)/20')}>
      <td className="py-2 pr-2 pl-16">
        <span className="block font-medium text-heading">{e.fullName}</span>
        <span className="flex flex-wrap gap-x-2 text-[11px] text-(--color-text-muted)">
          <span className="money">{e.pinfl}</span>
          {showMonth && <span>· {formatPeriod(e.period)}</span>}
          {e.payments.map((p, i) => (
            <span key={i} className="money">
              · {formatDate(p.docDate)} № {p.docNo} — {formatTiyin(p.amountTiyin)}
            </span>
          ))}
        </span>
      </td>
      <td className="money px-2 py-2 text-right">{e.payments.length}</td>
      <td className="px-2 py-2 text-right">
        <Money tiyin={e.amountTiyin} />
      </td>
      <td className="px-2 py-2 text-right">
        <Money tiyin={e.movableTiyin} tone="expense" />
        {capped && <span className="block text-[11px] text-(--color-warn)">ish haqidan oshmaydi</span>}
      </td>
      <td className="px-3 py-2 text-xs">
        {e.fullTiyin === null ? <span className="text-(--color-expense)">shu oy ish haqida yo&apos;q — ajratilmaydi</span> : e.posted ? <Badge tone="income">tasdiqlangan</Badge> : <span className="text-(--color-text-muted)">kutmoqda</span>}
      </td>
    </tr>
  );
}

function toggled<T>(s: Set<T>, k: T): Set<T> {
  const n = new Set(s);
  if (n.has(k)) n.delete(k);
  else n.add(k);
  return n;
}

function Caret({ open }: { open: boolean }) {
  return <span className={cn('mr-1.5 inline-block w-3 text-xs text-(--color-text-faint) transition-transform', open && 'rotate-90')}>▸</span>;
}

function Box({ label, value, sub, tone = 'neutral' }: { label: string; value: string; sub: string; tone?: 'neutral' | 'income' | 'expense' | 'warn' }) {
  const c = { neutral: 'text-(--color-text)', income: 'text-(--color-income)', expense: 'text-(--color-expense)', warn: 'text-(--color-warn)' }[tone];
  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-1.5 text-xl font-semibold', c)}>{value}</p>
      <p className="mt-0.5 text-xs text-(--color-text-muted)">{sub}</p>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn('rounded-full border px-3 py-1 text-xs font-medium', active ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-(--color-line) bg-white text-(--color-text-muted) hover:text-heading')}>
      {children}
    </button>
  );
}
