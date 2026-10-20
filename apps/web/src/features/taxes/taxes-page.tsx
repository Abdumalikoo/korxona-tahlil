'use client';

import { PageHeader } from '@/components/layout/page-header';
import { DeleteDataButton } from '@/components/shared/delete-data';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { compact, pct } from '@/features/structure/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatPeriod, formatPeriodShort, formatSum, parseSum } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { taxesApi, type CellInput, type TaxMethod, type TaxType } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › Soliqlar — hamma soliqlar bir joyda:
//   • oy jadvali: Markaz va hududlar × soliq turlari (qo'lda kiritiladi yoki Excel'dan);
//   • ish haqidan foizli soliqlar (ijtimoiy soliq …) — vedomostdan avtomatik, hudud bo'yicha;
//   • soliq turlari — o'zingiz qo'shasiz: nomi, usuli, foizi, «Markaz hisobidan»mi.
// Yozuvlar Xarajatlarga tushadi (Tahlil, Solishtirma, hisobotlar ko'radi), lekin faqat shu sahifada o'zgaradi.
// ═══════════════════════════════════════════════════════════

/** So'm: tiyini bo'lsa — 2 xona */
const som = (n: number) => formatSum(n, { decimals: Math.round(n * 100) % 100 ? 2 : 0 });
const tiyinToText = (t: string | undefined) => (t && t !== '0' ? som(Number(t) / 100) : '');

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{label}</p>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums text-heading', tone)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-(--color-text-muted)">{sub}</p>}
    </Card>
  );
}

/** Soliq turlari: nomi, usuli, foizi, Markaz hisobidanmi, faolmi — qo'shish va olib tashlash */
function TypesEditor({ isAdmin, onSaved }: { isAdmin: boolean; onSaved: (msg: string) => void }) {
  const res = useAsync(() => taxesApi.types().then((r) => r.data), []);
  const [rows, setRows] = useState<Partial<TaxType>[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (res.data) setRows(res.data.map((t) => ({ ...t })));
  }, [res.data]);
  const set = (i: number, patch: Partial<TaxType>) => setRows((r) => (r ? r.map((x, k) => (k === i ? { ...x, ...patch } : x)) : r));
  const dirty = JSON.stringify(rows) !== JSON.stringify(res.data);
  const save = async () => {
    if (!rows) return;
    setBusy(true);
    setErr(null);
    try {
      await taxesApi.saveTypes(rows);
      onSaved("Soliq turlari saqlandi — foizli soliqlar ish haqidan qayta hisoblandi");
      res.reload();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-(--color-line) px-5 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-heading">Soliq turlari</p>
          <p className="text-xs text-(--color-text-muted)">
            Har qanday soliqni qo&apos;shing. «Ish haqidan %» — har oy vedomostdan avtomatik (xodim ishlagan hudud bo&apos;yicha). «Markaz hisobidan» — qaysi hududda yozilsa ham Markaz
            xarajati.
          </p>
        </div>
        {isAdmin && (
          <Button variant="secondary" size="sm" onClick={() => setRows((r) => [...(r ?? []), { name: '', method: 'MANUAL', rate: null, center: false, active: true }])}>
            + Soliq turi qo&apos;shish
          </Button>
        )}
      </div>
      {err && <p className="border-b border-(--color-line) bg-red-50 px-5 py-2 text-sm text-red-700">{err}</p>}
      {!rows ? (
        <p className="px-5 py-6 text-center text-sm text-(--color-text-muted)">{res.error ?? 'Yuklanmoqda…'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-(--color-line) bg-(--color-surface-muted) text-left text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">
              <tr>
                <th className="px-5 py-2">Nomi</th>
                <th className="px-3 py-2">Qanday hisoblanadi</th>
                <th className="px-3 py-2">Foiz</th>
                <th className="px-3 py-2" title="Belgilangan oylarda summa = Markaz va har hudud daromadi × foiz (qo'lda kiritilmaydi)">Daromaddan % (oylar)</th>
                <th className="px-3 py-2">Markaz hisobidan</th>
                <th className="px-3 py-2">Faol</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-line)">
              {rows.map((t, i) => (
                <tr key={t.code ?? `new-${i}`} className={cn(t.active === false && 'opacity-60')}>
                  <td className="px-5 py-1.5">
                    <input
                      className="w-full min-w-56 rounded-md border border-(--color-line) px-2 py-1.5 text-sm disabled:bg-transparent"
                      value={t.name ?? ''}
                      placeholder="Masalan: Transport vositasi solig'i"
                      disabled={!isAdmin}
                      onChange={(e) => set(i, { name: e.target.value })}
                    />
                    {t.code && <span className="ml-1 font-mono text-[10px] text-(--color-text-faint)">{t.code}</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    <select
                      className="rounded-md border border-(--color-line) bg-white px-2 py-1.5 text-sm"
                      value={t.method ?? 'MANUAL'}
                      disabled={!isAdmin}
                      onChange={(e) => set(i, { method: e.target.value as TaxMethod, rate: e.target.value === 'PAYROLL_PERCENT' ? (t.rate ?? 12) : null })}
                    >
                      <option value="MANUAL">Qo&apos;lda / Excel (oyma-oy)</option>
                      <option value="PAYROLL_PERCENT">Ish haqidan % (avtomatik)</option>
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    {t.method === 'PAYROLL_PERCENT' ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          className="w-16 rounded-md border border-(--color-line) px-2 py-1.5 text-right text-sm tabular-nums"
                          value={t.rate ?? ''}
                          disabled={!isAdmin}
                          onChange={(e) => set(i, { rate: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })}
                        />
                        %
                      </span>
                    ) : (
                      <span className="text-(--color-text-faint)">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {t.method !== 'PAYROLL_PERCENT' ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          className="w-14 rounded-md border border-(--color-line) px-2 py-1.5 text-right text-sm tabular-nums"
                          value={t.incomeRate ?? ''}
                          placeholder="—"
                          disabled={!isAdmin}
                          onChange={(e) => set(i, { incomeRate: e.target.value === '' ? null : Number(e.target.value.replace(',', '.')) })}
                        />
                        %
                        <input
                          className="w-36 rounded-md border border-(--color-line) px-2 py-1.5 text-sm tabular-nums"
                          value={(t.incomePeriods ?? []).join(', ')}
                          placeholder="2026-04, 2026-05"
                          title="Qaysi oylar uchun (YYYY-MM, vergul bilan)"
                          disabled={!isAdmin}
                          onChange={(e) => set(i, { incomePeriods: e.target.value.split(/[,\s]+/).filter(Boolean) })}
                        />
                      </span>
                    ) : (
                      <span className="text-(--color-text-faint)">—</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="checkbox" className="size-4 accent-brand-600" checked={!!t.center} disabled={!isAdmin} onChange={(e) => set(i, { center: e.target.checked })} />
                  </td>
                  <td className="px-3 py-1.5">
                    <input type="checkbox" className="size-4 accent-brand-600" checked={t.active !== false} disabled={!isAdmin} onChange={(e) => set(i, { active: e.target.checked })} />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {isAdmin && (
                      <button type="button" className="rounded px-2 py-1 text-xs text-(--color-text-muted) hover:bg-red-50 hover:text-red-700" title="Olib tashlash (yozuvi bo'lsa — nofaol bo'ladi)" onClick={() => setRows((r) => (r ? r.filter((_, k) => k !== i) : r))}>
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isAdmin && (
        <div className="flex items-center gap-3 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3">
          <span className="text-xs text-(--color-text-muted)">Yozuvi bor turni olib tashlasangiz — o&apos;chmaydi, «nofaol» bo&apos;lib qoladi (tarix saqlanadi)</span>
          <Button className="ml-auto" onClick={() => void save()} loading={busy} disabled={!dirty}>
            Turlarni saqlash
          </Button>
        </div>
      )}
    </Card>
  );
}

export function TaxesPage() {
  const { isAdmin } = useAuth();
  const { month: period } = usePeriod();
  const res = useAsync(() => taxesApi.month(period).then((r) => r.data), [period]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone?: 'success' | 'error' } | null>(null);
  const [askCopy, setAskCopy] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft({}), [period, res.data]);
  const m = res.data;

  const types = useMemo(() => (m?.types ?? []).filter((t) => t.active || showInactive || BigInt(t.totalTiyin) > 0n), [m, showInactive]);
  const value = (type: string, unit: string) => (draft[`${type}|${unit}`] !== undefined ? draft[`${type}|${unit}`]! : tiyinToText(m?.cells[type]?.[unit]?.amountTiyin));
  const numberOf = (type: string, unit: string): number => {
    const d = draft[`${type}|${unit}`];
    if (d !== undefined) return Number(parseSum(d) ?? 0) * 100;
    return Number(m?.cells[type]?.[unit]?.amountTiyin ?? 0);
  };
  const changed = Object.keys(draft).filter((k) => {
    const [type, unit] = k.split('|') as [string, string];
    return Math.round(numberOf(type, unit)) !== Number(m?.cells[type]?.[unit]?.amountTiyin ?? 0);
  });
  const invalid = Object.entries(draft).filter(([, v]) => v.trim() !== '' && (parseSum(v) === null || Number(parseSum(v)) < 0)).map(([k]) => k);

  const save = async () => {
    const cells: CellInput[] = changed.map((k) => {
      const [type, unit] = k.split('|') as [string, string];
      return { type, unit, amountTiyin: String(Math.round(numberOf(type, unit))) };
    });
    setBusy(true);
    try {
      await taxesApi.save(period, cells);
      setToast({ message: `${cells.length} ta katak saqlandi` });
      res.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const p = await taxesApi.parse(period, file);
      const next: Record<string, string> = {};
      for (const c of p.cells) next[`${c.type}|${c.unit}`] = tiyinToText(c.amountTiyin);
      setDraft(next);
      const warn = [p.unknownUnits.length ? `tanilmagan hududlar: ${p.unknownUnits.join(', ')}` : '', p.unknownColumns.length ? `tanilmagan ustunlar: ${p.unknownColumns.join(', ')}` : ''].filter(Boolean).join('; ');
      setToast({ message: `Fayl o'qildi — jadvalda tekshirib «Saqlash»ni bosing${warn ? ` (${warn})` : ''}`, tone: warn ? 'error' : 'success' });
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const copyPrev = async () => {
    setBusy(true);
    try {
      await taxesApi.copyPrevious(period);
      setToast({ message: "O'tgan oy summalari bo'sh kataklarga ko'chirildi" });
      res.reload();
    } catch (e) {
      setToast({ message: errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
      setAskCopy(false);
    }
  };

  const t = m?.totals;
  const total = Number(t?.totalTiyin ?? 0);
  const prev = Number(t?.previousTiyin ?? 0);
  const trendTotals = (m?.months ?? []).map((_, i) => Object.values(m?.trend ?? {}).reduce((s, arr) => s + Number(arr[i] ?? 0), 0));
  const maxTrend = Math.max(...trendTotals, 1);

  return (
    <>
      <PageHeader title="Soliqlar" description={`Hamma soliqlar bir joyda · ${formatPeriod(period)}`} />
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
        {res.loading && !m ? (
          <LoadingState label="Soliqlar yuklanmoqda" />
        ) : res.error ? (
          <ErrorState message={res.error} onRetry={res.reload} />
        ) : m ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi
                label="Jami soliqlar"
                value={compact(total)}
                tone="text-(--color-expense)"
                sub={prev ? `o'tgan oy ${compact(prev)} · ${total >= prev ? '+' : ''}${pct(prev ? ((total - prev) / prev) * 100 : null)}` : "o'tgan oy yo'q"}
              />
              <Kpi
                label="Avtomatik"
                value={compact(t!.autoTiyin)}
                sub={[m.hasPayroll ? `ish haqi fondi ${compact(t!.payrollTiyin)}` : 'vedomost yuklanmagan', m.types.some((x) => x.incomeAuto) ? `daromad ${compact(t!.incomeTiyin ?? '0')}` : null].filter(Boolean).join(' · ')}
              />
              <Kpi label="Qo'lda / Excel" value={compact(t!.manualTiyin)} sub={`${m.types.filter((x) => x.method === 'MANUAL' && x.active && !x.incomeAuto).length} ta soliq turi`} />
              <Kpi label="Markaz hisobidan" value={compact(t!.centerTiyin)} sub="Markazda yozilgan va «Markaz hisobidan» turlar" />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="overflow-hidden lg:col-span-2">
                <p className="border-b border-(--color-line) px-5 py-3 text-sm font-semibold text-heading">Oylar bo&apos;yicha (12 oy)</p>
                <div className="flex h-32 items-end gap-1.5 px-5 pb-2 pt-4">
                  {m.months.map((mm, i) => (
                    <div key={mm} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${formatPeriodShort(mm)}: ${compact(trendTotals[i]!)}`}>
                      <div className={cn('w-full max-w-9 rounded-t', mm === period ? 'bg-(--color-expense)' : 'bg-(--color-expense)/45')} style={{ height: `${(trendTotals[i]! / maxTrend) * 100}%`, minHeight: trendTotals[i] ? 2 : 0 }} />
                      <span className="text-[10px] text-(--color-text-muted)">{formatPeriodShort(mm)}</span>
                    </div>
                  ))}
                </div>
              </Card>
              <Card className="overflow-hidden">
                <p className="border-b border-(--color-line) px-5 py-3 text-sm font-semibold text-heading">Turlar bo&apos;yicha</p>
                <ul className="divide-y divide-(--color-line)">
                  {m.types
                    .filter((x) => BigInt(x.totalTiyin) > 0n || BigInt(x.previousTiyin) > 0n)
                    .sort((a, b) => Number(BigInt(b.totalTiyin) - BigInt(a.totalTiyin)))
                    .map((x) => (
                      <li key={x.code} className="flex items-center justify-between gap-3 px-5 py-2 text-sm">
                        <span className="truncate text-heading">
                          {x.name}
                          {x.center && <span className="ml-1 rounded bg-brand-50 px-1 text-[10px] font-semibold text-brand-700">Markaz</span>}
                        </span>
                        <span className="whitespace-nowrap text-right tabular-nums">
                          <b>{compact(x.totalTiyin)}</b>
                          <span className="block text-[11px] text-(--color-text-muted)">o&apos;tgan oy {compact(x.previousTiyin)}</span>
                        </span>
                      </li>
                    ))}
                  {!m.types.some((x) => BigInt(x.totalTiyin) > 0n || BigInt(x.previousTiyin) > 0n) && <li className="px-5 py-6 text-center text-sm text-(--color-text-muted)">Bu oy soliq yozilmagan</li>}
                </ul>
              </Card>
            </div>

            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-(--color-line) px-5 py-3">
                <div className="mr-auto">
                  <p className="text-sm font-semibold text-heading">{formatPeriod(period)}: Markaz va hududlar</p>
                  <p className="text-xs text-(--color-text-muted)">
                    Kataklarga so&apos;mda yozing, keyin «Saqlash». Kulrang — avtomatik (ish haqidan yoki shu oy daromadidan), o&apos;zgartirilmaydi.
                    {m.types
                      .filter((x) => x.incomeAuto)
                      .map((x) => ` ${x.name}: Markaz va har hudud daromadining ${String(x.incomeRate).replace('.', ',')}%.`)
                      .join('')}
                  </p>
                </div>
                <label className="flex items-center gap-1.5 text-xs text-(--color-text-muted)">
                  <input type="checkbox" className="size-3.5" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> nofaol turlar
                </label>
                <Button variant="secondary" size="sm" onClick={() => void taxesApi.template(period).catch((e) => setToast({ message: errorMessage(e), tone: 'error' }))}>
                  Excel shablon
                </Button>
                {isAdmin && (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} loading={busy}>
                      Excel&apos;dan yuklash
                    </Button>
                    <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
                    <Button variant="secondary" size="sm" onClick={() => setAskCopy(true)}>
                      O&apos;tgan oydan ko&apos;chirish
                    </Button>
                    <DeleteDataButton target="TAX" size="sm" month={period} place="Xarajatlar › Soliqlar" onDone={({ count }) => { setToast({ message: `${count} ta soliq yozuvi savatga tushdi` }); res.reload(); }} />
                  </>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 260 + types.length * 150 }}>
                  <thead className="border-b border-(--color-line) bg-(--color-surface-muted) text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">
                    <tr>
                      <th className="sticky left-0 z-10 bg-(--color-surface-muted) px-5 py-2 text-left">Hudud</th>
                      {types.map((x) => (
                        <th key={x.code} className="min-w-32 px-2 py-2 text-right normal-case tracking-normal">
                          <span className="block text-xs font-semibold text-heading">{x.name}</span>
                          <span className="block text-[10px] font-normal">
                            {x.incomeAuto ? `daromaddan ${String(x.incomeRate ?? '').replace('.', ',')}% (shu oy)` : x.method === 'PAYROLL_PERCENT' ? `ish haqidan ${String(x.rate ?? '').replace('.', ',')}%` : "qo'lda"}
                            {x.center ? ' · Markaz hisobidan' : ''}
                            {!x.active ? ' · nofaol' : ''}
                          </span>
                        </th>
                      ))}
                      <th className="px-5 py-2 text-right">Jami</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {m.units.map((u) => {
                      const rowTotal = types.reduce((s, x) => s + numberOf(x.code, u.key), 0);
                      return (
                        <tr key={u.key} className={cn(u.key === 'center' && 'bg-brand-50/30 font-medium')}>
                          <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-5 py-1.5 text-heading">{u.name}</td>
                          {types.map((x) => {
                            const k = `${x.code}|${u.key}`;
                            if (x.method === 'PAYROLL_PERCENT' || x.incomeAuto) {
                              const c = m.cells[x.code]?.[u.key];
                              const tip = x.incomeAuto
                                ? c?.baseTiyin
                                  ? `Daromad ${compact(c.baseTiyin)} × ${x.incomeRate}%`
                                  : "Bu oy daromad yo'q"
                                : c?.baseTiyin
                                  ? `Ish haqi fondi ${compact(c.baseTiyin)} × ${x.rate}%`
                                  : "Ish haqi yo'q";
                              return (
                                <td key={k} className="min-w-28 whitespace-nowrap bg-(--color-surface-muted)/60 px-3 py-1.5 text-right tabular-nums text-(--color-text-muted)" title={tip}>
                                  {c && BigInt(c.amountTiyin) > 0n ? compact(c.amountTiyin) : '—'}
                                </td>
                              );
                            }
                            const bad = invalid.includes(k);
                            const dirty = changed.includes(k);
                            return (
                              <td key={k} className="px-2 py-1">
                                <input
                                  inputMode="decimal"
                                  className={cn('w-full min-w-28 rounded-md border px-2 py-1 text-right text-sm tabular-nums', bad ? 'border-red-400 bg-red-50' : dirty ? 'border-amber-400 bg-amber-50' : 'border-(--color-line)', !isAdmin && 'bg-transparent')}
                                  value={value(x.code, u.key)}
                                  placeholder="0"
                                  disabled={!isAdmin || !x.active}
                                  onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                                  onBlur={(e) => {
                                    const p = parseSum(e.target.value);
                                    if (p !== null && Number(p) >= 0) setDraft((d) => ({ ...d, [k]: som(Number(p)) }));
                                  }}
                                />
                              </td>
                            );
                          })}
                          <td className="whitespace-nowrap px-5 py-1.5 text-right font-semibold tabular-nums">{rowTotal ? compact(rowTotal) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-(--color-line) bg-(--color-surface-muted) font-semibold">
                    <tr>
                      <td className="sticky left-0 z-10 bg-(--color-surface-muted) px-5 py-2 text-heading">Jami</td>
                      {types.map((x) => (
                        <td key={x.code} className="whitespace-nowrap px-2 py-2 text-right tabular-nums">
                          {compact(m.units.reduce((s, u) => s + numberOf(x.code, u.key), 0))}
                        </td>
                      ))}
                      <td className="px-5 py-2 text-right tabular-nums">{compact(m.units.reduce((s, u) => s + types.reduce((a, x) => a + numberOf(x.code, u.key), 0), 0))}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {isAdmin && (
                <div className="flex flex-wrap items-center gap-3 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3">
                  <span className="text-xs text-(--color-text-muted)">
                    {invalid.length ? `${invalid.length} ta katakda summa noto'g'ri` : changed.length ? `${changed.length} ta katak o'zgardi (sariq)` : "O'zgarish yo'q"} · Soliqlar Xarajatlarga tushadi, Tahlil va Solishtirmada
                    ko&apos;rinadi
                  </span>
                  {changed.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={() => setDraft({})}>
                      Bekor qilish
                    </Button>
                  )}
                  <Button className="ml-auto" data-save onClick={() => void save()} loading={busy} disabled={!changed.length || invalid.length > 0}>
                    Saqlash
                  </Button>
                </div>
              )}
            </Card>
            {!m.hasPayroll && m.types.some((x) => x.method === 'PAYROLL_PERCENT' && x.active) && (
              <p className="rounded-lg bg-amber-50 px-4 py-2 text-xs text-amber-900">
                {formatPeriod(period)} uchun ish haqi vedomosti yuklanmagan — foizli soliqlar (ijtimoiy soliq) hisoblanmadi.{' '}
                <Link href="/xarajatlar/ish-haqi" className="font-semibold underline">
                  Ish haqi
                </Link>
              </p>
            )}
          </>
        ) : null}

        <TypesEditor
          isAdmin={isAdmin}
          onSaved={(msg) => {
            setToast({ message: msg });
            res.reload();
          }}
        />
      </div>
      <ConfirmDialog
        open={askCopy}
        title="O'tgan oydan ko'chirish"
        message={`${formatPeriod(period)} — bo'sh kataklarga o'tgan oydagi summalar yoziladi (to'ldirilganlariga tegilmaydi).`}
        confirmLabel="Ko'chirish"
        loading={busy}
        onCancel={() => setAskCopy(false)}
        onConfirm={() => void copyPrev()}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} duration={toast.tone === 'error' ? 7000 : 4000} />}
    </>
  );
}