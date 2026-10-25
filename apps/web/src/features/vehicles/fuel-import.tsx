'use client';

import { Button } from '@/components/ui/button';
import { IconAlert, IconClose, IconUpload } from '@/components/ui/icons';
import { errorMessage } from '@/lib/error-message';
import { currentPeriod, formatDate, formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  analyzeFuelReport,
  PAYMENT_LABELS,
  vehiclesApi,
  type FuelAnalysis,
  type FuelCard,
  type FuelCommitResult,
  type VehicleItem,
  type VehiclePaymentMethod,
} from './api';

// ═══════════════════════════════════════════════════════════
// Benzin: AZS yoqilg'i kartasi hisobotini yuklash («ОТЧЕТ ПО ПРОДАЖАМ», .xls yoki .xlsx).
// 1) Fayl tekshiriladi: davr, kartalar (karta № + davlat raqami), har quyish, «Всего» bilan solishtirish.
// 2) Har karta — mashinaga: karta yoki davlat raqami bo'yicha o'zi topiladi; topilmasa — yangi mashina
//    yoki ro'yxatdan tanlash yoki o'tkazib yuborish.
// 3) Yozish: har quyish — mashina xarajati (Benzin) va Xarajatlarda yozuv. Qayta yuklansa takrorlanmaydi.
// ═══════════════════════════════════════════════════════════

type Choice = { action: 'vehicle' | 'new' | 'skip'; vehicleId: string; model: string; fleetGroup: string };

function initialChoice(c: FuelCard): Choice {
  if (c.match && c.match.isActive) return { action: 'vehicle', vehicleId: c.match.vehicleId, model: '', fleetGroup: '' };
  if (c.plate) return { action: 'new', vehicleId: '', model: '', fleetGroup: '' };
  return { action: 'skip', vehicleId: '', model: '', fleetGroup: '' };
}

const liters = (n: number) => `${n.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} l`;

export function FuelImportDialog({ onClose, onDone, initialAnalysis }: { onClose: () => void; onDone: (msg: string) => void; initialAnalysis?: FuelAnalysis }) {
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<FuelAnalysis | null>(initialAnalysis ?? null);
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries((initialAnalysis?.cards ?? []).map((c) => [c.key, initialChoice(c)])));
  const [vehicles, setVehicles] = useState<VehicleItem[]>([]);
  const [groups, setGroups] = useState<{ value: string; label: string }[]>([]);
  const [method, setMethod] = useState<VehiclePaymentMethod>('BANK');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [result, setResult] = useState<FuelCommitResult | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    vehiclesApi
      .list(currentPeriod())
      .then((r) => setVehicles(r.data.items.filter((v) => v.isActive)))
      .catch(() => undefined);
    vehiclesApi
      .lookups()
      .then((r) => setGroups(r.data.groups ?? []))
      .catch(() => undefined);
  }, []);

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setErr(null);
    setBusy(true);
    try {
      const a = await analyzeFuelReport(f);
      setAnalysis(a);
      setChoices(Object.fromEntries(a.cards.map((c) => [c.key, initialChoice(c)])));
    } catch (e) {
      setErr(errorMessage(e));
      setAnalysis(null);
    } finally {
      setBusy(false);
    }
  };

  const plan = useMemo(() => {
    if (!analysis) return { count: 0, amount: 0, liters: 0, newVehicles: 0, skipped: 0, problems: 0 };
    let count = 0;
    let amount = 0;
    let l = 0;
    let newVehicles = 0;
    let skipped = 0;
    let problems = 0;
    for (const c of analysis.cards) {
      const ch = choices[c.key];
      if (!ch || ch.action === 'skip') {
        skipped += c.newCount;
        continue;
      }
      if (ch.action === 'vehicle' && !ch.vehicleId) problems += 1;
      if (ch.action === 'new') newVehicles += 1;
      for (const r of c.rows) {
        if (r.exists || r.error) continue;
        count += 1;
        amount += Number(r.amountTiyin);
        l += r.liters;
      }
    }
    return { count, amount, liters: l, newVehicles, skipped, problems };
  }, [analysis, choices]);

  const set = (key: string, patch: Partial<Choice>) => setChoices((s) => ({ ...s, [key]: { ...s[key]!, ...patch } }));

  const commit = async () => {
    if (!analysis) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await vehiclesApi.fuelCommit({
        fileName: analysis.fileName,
        paymentMethod: method,
        cards: analysis.cards.map((c) => {
          const ch = choices[c.key]!;
          return {
            key: c.key,
            cardNo: c.cardNo,
            plate: c.plate,
            action: ch.action,
            vehicleId: ch.action === 'vehicle' ? ch.vehicleId : null,
            newVehicle: ch.action === 'new' ? { model: ch.model.trim() || undefined, fleetGroup: ch.fleetGroup || null } : null,
            rows: c.rows.filter((x) => !x.exists && !x.error),
          };
        }),
      });
      setResult(r.data);
    } catch (e) {
      setErr(errorMessage(e, "Yozib bo'lmadi"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40" onClick={busy ? undefined : onClose} />
      <div className="relative flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-(--color-line) px-5 py-4">
          <div className="min-w-0">
            <p className="text-base font-bold text-heading">Benzin: AZS hisobotini yuklash</p>
            <p className="text-xs text-(--color-text-muted)">
              Yoqilg&apos;i kartasi bo&apos;yicha «ОТЧЕТ ПО ПРОДАЖАМ» (.xls yoki .xlsx). Har quyish mashina xarajatiga va Xarajatlarga yoziladi; qayta yuklansa takrorlanmaydi.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="ml-auto rounded p-1 text-(--color-text-muted) hover:bg-(--color-surface-muted)" aria-label="Yopish">
            <IconClose className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {result ? (
            <div className="space-y-4 py-4 text-sm">
              <div className="rounded-xl bg-emerald-50 px-4 py-4 ring-1 ring-emerald-200">
                <p className="text-base font-bold text-emerald-800">Yozildi: {result.created} ta quyish</p>
                <p className="mt-1 text-emerald-800">
                  {liters(result.liters)} · {formatTiyin(result.amountTiyin)} so&apos;m
                  {result.vehiclesCreated ? ` · yangi mashina: ${result.vehiclesCreated}` : ''}
                  {result.cardsLinked ? ` · kartasi bog'langan mashina: ${result.cardsLinked}` : ''}
                  {result.skipped ? ` · o'tkazib yuborildi (bor yoki tanlanmagan): ${result.skipped}` : ''}
                </p>
              </div>
              {result.vehiclesCreated > 0 && (
                <p className="text-(--color-text-muted)">
                  Yangi mashinalarning rusumi, haydovchisi va guruhini «Ro&apos;yxat va hisobot» sahifasida to&apos;ldiring — karta raqami ularga yozib qo&apos;yildi, keyingi oy o&apos;zi topiladi.
                </p>
              )}
              {result.errors.length > 0 && (
                <div className="rounded-xl bg-red-50 px-4 py-3 text-red-800 ring-1 ring-red-200">
                  <p className="font-semibold">Yozilmaganlar ({result.errors.length}):</p>
                  <ul className="mt-1 list-disc pl-5">
                    {result.errors.slice(0, 20).map((e, i) => (
                      <li key={i}>
                        {e.card}: {e.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : !analysis ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => input.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDrag(true);
                }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDrag(false);
                  void pickFile(e.dataTransfer.files[0]);
                }}
                className={cn(
                  'flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
                  drag ? 'border-brand-500 bg-brand-50' : 'border-(--color-line-strong) hover:border-brand-300 hover:bg-brand-50/50',
                )}
              >
                <IconUpload className="size-8 text-brand-600" />
                <span className="text-sm font-semibold text-heading">{busy ? 'Tekshirilmoqda…' : file ? file.name : 'Faylni shu yerga tashlang yoki tanlang'}</span>
                <span className="text-xs text-(--color-text-muted)">.xls yoki .xlsx · 10 MB gacha</span>
              </button>
              <input ref={input} type="file" accept=".xls,.xlsx,.xltx" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
              <div className="rounded-xl bg-(--color-surface-muted) px-4 py-3 text-xs text-(--color-text-muted)">
                <p className="mb-1 font-semibold text-heading">Fayl shakli (doim shunday)</p>
                <p>«Период с … по …» · «Продажи по датам»: Дата | АЗС | ГСМ | Количество | Цена | Сумма | В т.ч. НДС | В т.ч. Акциз</p>
                <p>Har karta qatori: «003668 (01 054 OEA)» — karta raqami va mashina davlat raqami, ostida quyishlar.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Umumiy */}
              <div className="grid gap-2 sm:grid-cols-4">
                {(
                  [
                    ['Davr', analysis.periodFrom ? `${formatDate(analysis.periodFrom)} – ${formatDate(analysis.periodTo ?? analysis.periodFrom)}` : '—', analysis.organization ?? ''],
                    ['Quyishlar', `${analysis.totals.count} ta`, `yangi: ${analysis.totals.newCount} · bor: ${analysis.totals.existsCount}`],
                    ['Hajm', liters(analysis.totals.liters), analysis.byFuel.map((f) => `${f.fuel}: ${liters(f.liters)}`).join(' · ')],
                    ['Summa', `${formatTiyin(analysis.totals.amountTiyin)}`, `QQS: ${formatTiyin(analysis.totals.vatTiyin)}`],
                  ] as const
                ).map(([k, v, sub]) => (
                  <div key={k} className="rounded-xl bg-(--color-surface-muted) px-3 py-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{k}</p>
                    <p className={cn('font-bold tabular-nums text-heading', k === 'Davr' ? 'text-sm leading-7' : 'text-lg')}>{v}</p>
                    <p className="truncate text-[11px] text-(--color-text-muted)" title={sub}>
                      {sub}
                    </p>
                  </div>
                ))}
              </div>
              <div className={cn('flex items-center gap-2 rounded-(--radius-control) px-3 py-2 text-xs', analysis.check.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800')}>
                {analysis.check.ok ? '✓' : <IconAlert className="size-4" />}
                {analysis.check.fileTotalTiyin === null
                  ? "Fayldagi «Всего» topilmadi — quyishlar yig'indisi olindi"
                  : analysis.check.ok
                    ? `Fayldagi «Всего» (${formatTiyin(analysis.check.fileTotalTiyin)} so'm) bilan quyishlar yig'indisi bir xil; har karta jami ham to'g'ri`
                    : `Fayldagi «Всего» ${formatTiyin(analysis.check.fileTotalTiyin)} so'm — quyishlar yig'indisidan farq qiladi`}
              </div>
              {analysis.warnings.length > 0 && (
                <ul className="space-y-1 rounded-(--radius-control) bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {analysis.warnings.map((w, i) => (
                    <li key={i}>• {w}</li>
                  ))}
                </ul>
              )}

              {/* Kartalar */}
              <div className="overflow-x-auto rounded-xl border border-(--color-line)">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-(--color-surface-muted) text-left text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">
                    <tr>
                      <th className="px-3 py-2">Karta · fayldagi raqam</th>
                      <th className="px-3 py-2 text-right">Quyish</th>
                      <th className="px-3 py-2 text-right">Hajm</th>
                      <th className="px-3 py-2 text-right">Summa</th>
                      <th className="px-3 py-2">Qaysi mashinaga</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-line)">
                    {analysis.cards.map((c) => {
                      const ch = choices[c.key]!;
                      const isOpen = open === c.key;
                      return (
                        <Fragment key={c.key}>
                          <tr className={cn(ch.action === 'skip' && 'opacity-60')}>
                            <td className="px-3 py-2 align-top">
                              <button type="button" onClick={() => setOpen(isOpen ? null : c.key)} className="text-left">
                                <span className="mr-1 inline-block w-3 text-(--color-text-faint)">{isOpen ? '▾' : '▸'}</span>
                                <span className="font-mono text-xs text-(--color-text-muted)">{c.cardNo ?? '—'}</span>{' '}
                                <span className="rounded border-2 border-slate-800 px-1.5 py-0.5 font-mono text-xs font-bold tracking-wider text-slate-900">{c.plate ?? '?'}</span>
                              </button>
                              {!c.totalOk && <p className="mt-1 text-[11px] text-amber-700">jami fayldagidan farq qiladi</p>}
                            </td>
                            <td className="px-3 py-2 text-right align-top tabular-nums">
                              {c.count}
                              {c.existsCount > 0 && <p className="text-[11px] text-(--color-text-muted)">bor: {c.existsCount}</p>}
                            </td>
                            <td className="px-3 py-2 text-right align-top tabular-nums">{liters(c.liters)}</td>
                            <td className="money px-3 py-2 text-right align-top">{formatTiyin(c.amountTiyin)}</td>
                            <td className="px-3 py-2 align-top">
                              <select
                                value={ch.action === 'vehicle' ? ch.vehicleId : ch.action}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === 'new' || v === 'skip') set(c.key, { action: v, vehicleId: '' });
                                  else set(c.key, { action: 'vehicle', vehicleId: v });
                                }}
                                className="h-8 w-full max-w-[26rem] rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm"
                              >
                                {c.plate && <option value="new">+ Yangi mashina: {c.plate}</option>}
                                <option value="skip">O&apos;tkazib yuborish</option>
                                <optgroup label="Ro'yxatdagi mashinalar">
                                  {vehicles.map((v) => (
                                    <option key={v.id} value={v.id}>
                                      {v.plateNumber} — {v.model}
                                      {c.match?.vehicleId === v.id ? (c.match.by === 'card' ? ' (karta bo‘yicha)' : ' (raqam bo‘yicha)') : ''}
                                    </option>
                                  ))}
                                </optgroup>
                              </select>
                              {ch.action === 'new' && (
                                <div className="mt-1.5 flex max-w-[26rem] gap-1.5">
                                  <input value={ch.model} onChange={(e) => set(c.key, { model: e.target.value })} placeholder="Rusumi (ixtiyoriy)" className="h-8 min-w-0 flex-1 rounded-(--radius-control) border border-(--color-line) px-2 text-xs" />
                                  <select value={ch.fleetGroup} onChange={(e) => set(c.key, { fleetGroup: e.target.value })} className="h-8 rounded-(--radius-control) border border-(--color-line) bg-white px-1.5 text-xs">
                                    <option value="">Guruhsiz</option>
                                    {groups.map((g) => (
                                      <option key={g.value} value={g.value}>
                                        {g.label}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              {c.match && !c.match.isActive && <p className="mt-1 text-[11px] text-amber-700">{c.match.plateNumber} faol emas</p>}
                            </td>
                          </tr>
                          {isOpen && (
                            <tr>
                              <td colSpan={5} className="bg-(--color-surface-muted) px-3 py-2">
                                <table className="w-full text-xs">
                                  <tbody className="divide-y divide-(--color-line)">
                                    {c.rows.map((r) => (
                                      <tr key={r.key} className={cn((r.exists || r.error) && 'text-(--color-text-faint)')}>
                                        <td className="whitespace-nowrap py-1 pr-3 tabular-nums">
                                          {formatDate(r.date)} {r.time.slice(0, 5)}
                                        </td>
                                        <td className="py-1 pr-3">{r.station}</td>
                                        <td className="py-1 pr-3">{r.fuel}</td>
                                        <td className="py-1 pr-3 text-right tabular-nums">{liters(r.liters)}</td>
                                        <td className="py-1 pr-3 text-right tabular-nums">× {formatTiyin(r.priceTiyin)}</td>
                                        <td className="money py-1 pr-3 text-right">{formatTiyin(r.amountTiyin)}</td>
                                        <td className="py-1 text-right">{r.exists ? 'bor' : r.error ? r.error : 'yangi'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {err && <p className="mt-3 rounded-(--radius-control) bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-(--color-line) px-5 py-3">
          {result ? (
            <Button className="ml-auto" onClick={() => onDone(`Benzin: ${result.created} ta quyish yozildi`)}>
              Tayyor
            </Button>
          ) : analysis ? (
            <>
              <button type="button" disabled={busy} onClick={() => input.current?.click()} className="text-xs text-brand-700 hover:underline">
                Boshqa fayl
              </button>
              <input ref={input} type="file" accept=".xls,.xlsx,.xltx" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
              <label className="ml-auto flex items-center gap-2 text-xs text-(--color-text-muted)">
                To&apos;lov usuli
                <select value={method} onChange={(e) => setMethod(e.target.value as VehiclePaymentMethod)} className="h-8 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm">
                  {(Object.keys(PAYMENT_LABELS) as VehiclePaymentMethod[]).map((m) => (
                    <option key={m} value={m}>
                      {PAYMENT_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              <Button loading={busy} disabled={plan.count === 0 || plan.problems > 0} onClick={() => void commit()}>
                {plan.count === 0 ? 'Yangi quyish yo‘q' : `Yozish: ${plan.count} ta · ${formatTiyin(plan.amount)} so'm`}
              </Button>
            </>
          ) : (
            <Button variant="secondary" className="ml-auto" onClick={onClose}>
              Yopish
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}