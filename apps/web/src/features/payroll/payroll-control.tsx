'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconCheck } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { api, type ApiResponse } from '@/lib/api';
import { errorMessage } from '@/lib/error-message';
import { formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { ErrorState } from '@/components/ui/states';
import { sourceHref, unitPayrollHref } from '@/lib/source-links';
import Link from 'next/link';
import { useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Ish haqi nazorati: XARAJAT = SOLIQ HISOBOTI.
// Ish haqi tarkibi va 23106 — ichki nazorat (xodimning puli to'g'rimi, qaysi komponent bo'yicha qancha), xarajatga
// qo'shilmaydi. Bu karta har ish haqi xarajatini manbasiga bog'laydi va ortiqchasini (bekor qilingan yuklashdan
// qolgan, ikki marta sanalgan, demo …) ko'rsatadi; tozalash — faqat tasdiqlansa (Savatga, qaytarish mumkin).
// ═══════════════════════════════════════════════════════════

export interface PayrollControl {
  period: string;
  monthLabel: string;
  soliq: {
    files: { id: string; kind: 'ALL' | 'REGIONS'; fileName: string; ownTiyin: string; toUnitsTiyin: string; totalTiyin: string }[];
    totalTiyin: string;
    manual: { unit: string; label: string; fileName: string; totalTiyin: string; count: number }[];
    manualTiyin: string;
    stray: { unit: string; label: string; batchId: string; fileName: string; totalTiyin: string }[];
    strayTiyin: string;
  };
  expected: string;
  expenseTotal: string;
  diffTiyin: string;
  explain: { cleanableTiyin: string; duplicateManualTiyin: string; strayTiyin: string; otherTiyin: string };
  byKind: { kind: string; label: string; count: number; tiyin: string; cleanable: boolean }[];
  issues: { id: string; kind: string; label: string; tiyin: string; description: string | null; note: string; cleanable: boolean }[];
  cleanableTiyin: string;
  /** Hammasi (ro'yxat 500 ta bilan cheklangan) */
  cleanableCount?: number;
  duplicates: { pinfl: string; fullName: string; sources: { where: string; tiyin: string; manual: boolean; unit?: string | null }[]; totalTiyin: string; extraTiyin: string; removeFrom: string[] }[];
  duplicateCount: number;
  duplicateTiyin: string;
  ok: boolean;
}

export interface PayrollControlRange {
  months: { period: string; monthLabel: string; soliqTiyin: string; expected: string; expenseTotal: string; diffTiyin: string; duplicateTiyin: string; ok: boolean }[];
  expected: string;
  expenseTotal: string;
  diffTiyin: string;
}

export const payrollControlApi = {
  get: (period: string) => api.get<ApiResponse<PayrollControl>>('/payroll/control', { params: { period } }),
  range: (from: string, to: string) => api.get<ApiResponse<PayrollControlRange>>('/payroll/control/range', { params: { from, to } }),
  clean: (period: string, ids: string[]) => api.post<ApiResponse<{ removed: number; totalTiyin: string }>>(`/payroll/control/clean?period=${period}`, { ids }),
  dedupe: (period: string, pinfls: string[]) => api.post<ApiResponse<{ removed: number; totalTiyin: string }>>(`/payroll/control/dedupe?period=${period}`, { pinfls }),
  stray: (period: string, batchIds: string[]) => api.post<ApiResponse<{ cancelled: number }>>(`/payroll/control/stray?period=${period}`, { batchIds }),
};

const nz = (v: string | null | undefined) => Boolean(v) && v !== '0';

type Action = { kind: 'clean' | 'dedupe' | 'stray'; ids: string[]; title: string; message: string };

export function PayrollControlCard({ period, compact = false, reloadKey, onChanged, onToast }: { period: string; compact?: boolean; /** O'zgarsa — qayta o'qiladi (yuklash bekor qilinganda va h.k.) */ reloadKey?: unknown; onChanged?: () => void; onToast: (t: { message: string; tone: 'success' | 'error' }) => void }) {
  const data = useAsync(() => payrollControlApi.get(period).then((r) => r.data), [period, reloadKey]);
  const [open, setOpen] = useState(!compact);
  const [year, setYear] = useState(false);
  const range = useAsync(() => (year ? payrollControlApi.range(`${period.slice(0, 4)}-01`, period).then((r) => r.data) : Promise.resolve(null)), [period, year, reloadKey]);
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const v = data.data;
  if (data.error)
    return (
      <Card>
        <ErrorState message={`Ish haqi nazorati o‘qilmadi: ${data.error}`} onRetry={data.reload} />
      </Card>
    );
  if (!v) return null;
  const hasSoliq = v.soliq.files.length > 0 || v.soliq.manual.length > 0;
  if (compact && !hasSoliq && v.expenseTotal === '0') return null;
  const diff = BigInt(v.diffTiyin);
  const cleanable = v.issues.filter((i) => i.cleanable);
  const others = v.issues.filter((i) => !i.cleanable);
  const dedupable = v.duplicates.filter((d) => d.removeFrom.length && d.sources.some((s) => !s.manual));

  async function run() {
    if (!action) return;
    setBusy(true);
    try {
      if (action.kind === 'clean') {
        const r = (await payrollControlApi.clean(period, action.ids)).data;
        onToast({ message: `${r.removed} ta ortiqcha xarajat Savatga o‘tkazildi · ${formatTiyin(r.totalTiyin)} so‘m`, tone: 'success' });
      } else if (action.kind === 'dedupe') {
        const r = (await payrollControlApi.dedupe(period, action.ids)).data;
        onToast({ message: `${r.removed} xodimning bo‘limda qo‘lda yuklangan qatori olib tashlandi · ${formatTiyin(r.totalTiyin)} so‘m (umumiy soliq hisobotida qoldi)`, tone: 'success' });
      } else {
        const r = (await payrollControlApi.stray(period, action.ids)).data;
        onToast({ message: `${r.cancelled} ta bog‘lanmagan bo‘lim yuklashi bekor qilindi`, tone: 'success' });
      }
      data.reload();
      range.reload();
      onChanged?.();
    } catch (err) {
      onToast({ message: errorMessage(err, 'Bajarib bo‘lmadi'), tone: 'error' });
    } finally {
      setBusy(false);
      setAction(null);
    }
  }

  return (
    <Card className={cn('overflow-hidden', !v.ok && 'border-(--color-warn)')}>
      <CardHeader
        title={`Ish haqi xarajati = soliq hisoboti · ${formatPeriod(period)}`}
        description="Ish haqi xarajati faqat soliq hisobotidan. Ish haqi tarkibi va 23106 — ichki nazorat (xodimning puli to‘g‘rimi, qaysi komponent bo‘yicha qancha), xarajatga qo‘shilmaydi."
        actions={
          compact ? (
            <Button size="sm" variant="ghost" onClick={() => setOpen((x) => !x)}>
              {open ? 'Yopish' : 'Batafsil'}
            </Button>
          ) : undefined
        }
      />
      <div className="grid gap-px border-t border-(--color-line) bg-(--color-line) sm:grid-cols-4">
        <Tile label="Soliq hisoboti (yuklangan)" value={v.soliq.totalTiyin} hint={`${v.soliq.files.length} ta fayl`} />
        <Tile label="Bo‘lim sahifalarida yuklangan" value={v.soliq.manualTiyin} hint={v.soliq.manual.length ? [...new Set(v.soliq.manual.map((m) => m.label))].join(', ') : 'yo‘q'} />
        <Tile label="Ish haqi xarajati" value={v.expenseTotal} hint="Xarajatlarda ko‘rinadigan" />
        <div className={cn('bg-white px-5 py-3', diff !== 0n ? 'bg-(--color-expense-soft)' : 'bg-(--color-income-soft)')}>
          <p className="text-[11px] uppercase tracking-wide text-(--color-text-muted)">Farq</p>
          <p className={cn('mt-0.5 flex items-center gap-1.5 text-lg font-semibold', diff !== 0n ? 'text-(--color-expense)' : 'text-(--color-income)')}>
            {diff === 0n ? <IconCheck className="size-4" /> : <IconAlert className="size-4" />}
            {diff === 0n ? 'teng' : <Money tiyin={v.diffTiyin} />}
          </p>
          <p className="text-[11px] text-(--color-text-muted)">{diff > 0n ? 'xarajat soliq hisobotidan ko‘p' : diff < 0n ? 'xarajat soliq hisobotidan kam' : 'xarajat = soliq hisoboti'}</p>
        </div>
      </div>
      {diff !== 0n && (
        <p className="border-t border-(--color-line) px-5 py-2 text-xs text-(--color-text-muted)">
          Farq nimadan:{' '}
          {[
            nz(v.explain?.cleanableTiyin) && `ortiqcha xarajatlar ${formatTiyin(v.explain?.cleanableTiyin)}`,
            nz(v.explain?.duplicateManualTiyin) && `ikki marta sanalgan (bo‘limda qo‘lda) ${formatTiyin(v.explain?.duplicateManualTiyin)}`,
            nz(v.explain?.strayTiyin) && `bog‘lanmagan bo‘lim yuklashlari ${formatTiyin(v.explain?.strayTiyin)}`,
            nz(v.explain?.otherTiyin) && `manbasiz yozuvlar ${formatTiyin(v.explain?.otherTiyin)}`,
          ]
            .filter(Boolean)
            .join(' + ') || '—'}{' '}
          so‘m. Pastdagi tugmalar bilan tuzating — har biri tasdiqlanadi.
        </p>
      )}
      {(v.duplicateCount > 0 || v.soliq.stray.length > 0) && (
        <p className="border-t border-(--color-line) bg-(--color-warn-soft) px-5 py-2 text-xs text-(--color-warn)">
          {v.duplicateCount > 0 && <>Ikki marta sanalgan xodimlar: <b>{v.duplicateCount}</b> ta (ortiqcha <b>{formatTiyin(v.duplicateTiyin)}</b> so‘m). </>}
          {v.soliq.stray.length > 0 && <>Umumiy yuklashga bog‘lanmagan bo‘lim yuklashlari: <b>{v.soliq.stray.length}</b> ta ({formatTiyin(v.soliq.strayTiyin)} so‘m).</>}
        </p>
      )}
      {open && (
        <div className="space-y-4 border-t border-(--color-line) px-5 py-4 text-sm">
          {/* Manbalar bo'yicha */}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Ish haqi xarajati — manbasi bo‘yicha</p>
            <table className="w-full text-sm">
              <tbody>
                {v.byKind.map((k) => (
                  <tr key={k.kind} className="border-t border-(--color-line)">
                    <td className="py-1.5">
                      {k.label}
                      {k.cleanable && (
                        <Badge tone="expense" className="ml-2">
                          ortiqcha
                        </Badge>
                      )}
                      {k.kind === 'OTHER' && (
                        <Badge tone="warn" className="ml-2">
                          tekshiring
                        </Badge>
                      )}
                    </td>
                    <td className="w-20 py-1.5 text-right text-xs text-(--color-text-muted)">{k.count} ta</td>
                    <td className="w-44 py-1.5 text-right">
                      <Money tiyin={k.tiyin} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Yuklangan fayllar */}
          {hasSoliq && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Yuklangan soliq hisoboti</p>
              <ul className="space-y-1 text-xs">
                {v.soliq.files.map((f) => (
                  <li key={f.id} className="flex flex-wrap justify-between gap-2">
                    <span>
                      {f.kind === 'REGIONS' ? 'Hududlar vedomosti' : 'Umumiy'}: «{f.fileName}»
                      {nz(f.toUnitsTiyin) && <span className="text-(--color-text-muted)"> · bo‘limlarga (miya bo‘yicha) {formatTiyin(f.toUnitsTiyin)}</span>}
                    </span>
                    <Money tiyin={f.totalTiyin} />
                  </li>
                ))}
                {v.soliq.manual.map((m, i) => (
                  <li key={`m${i}`} className="flex flex-wrap justify-between gap-2">
                    <span>
                      <UnitLink unit={m.unit} period={period} label={m.label} /> sahifasida: «{m.fileName}» · {m.count} xodim
                    </span>
                    <Money tiyin={m.totalTiyin} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Ortiqchalar */}
          {cleanable.length > 0 && (
            <div className="rounded-(--radius-control) border border-(--color-expense)/40 bg-(--color-expense-soft)/40 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="font-semibold text-heading">
                  Ortiqcha xarajatlar: {v.cleanableCount ?? cleanable.length} ta · {formatTiyin(v.cleanableTiyin)} so‘m
                  {(v.cleanableCount ?? cleanable.length) > cleanable.length && <span className="ml-1 text-xs font-normal text-(--color-text-muted)">(bir martada {cleanable.length} tasi tozalanadi)</span>}
                </p>
                <Button
                  size="sm"
                  variant="danger"
                  className="ml-auto"
                  onClick={() =>
                    setAction({
                      kind: 'clean',
                      ids: cleanable.map((i) => i.id),
                      title: 'Ortiqcha xarajatlarni Savatga',
                      message: `${cleanable.length} ta xarajat (${formatTiyin(v.cleanableTiyin)} so‘m) Savatga o‘tadi — soliq hisobotida yo‘q yoki ikki marta yozilgan. Savatdan qaytarish mumkin.`,
                    })
                  }
                >
                  Savatga o‘tkazish
                </Button>
              </div>
              <ul className="space-y-1 text-xs">
                {cleanable.slice(0, 50).map((i) => (
                  <li key={i.id} className="flex flex-wrap justify-between gap-2">
                    <span>
                      <b>{i.label}</b> · {i.description ?? '—'}
                      {i.note && <span className="text-(--color-text-muted)"> · {i.note}</span>}
                    </span>
                    <Money tiyin={i.tiyin} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Ikki marta sanalgan xodimlar */}
          {v.duplicates.length > 0 && (
            <div className="rounded-(--radius-control) border border-(--color-warn)/50 bg-(--color-warn-soft)/40 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="font-semibold text-heading">
                  Ikki marta sanalgan xodimlar: {v.duplicates.length} ta · ortiqcha {formatTiyin(v.duplicateTiyin)} so‘m
                </p>
                {dedupable.length > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="ml-auto"
                    onClick={() =>
                      setAction({
                        kind: 'dedupe',
                        ids: dedupable.map((d) => d.pinfl),
                        title: 'Ikki marta sanalganlarni tuzatish',
                        message: `${dedupable.length} xodim: bo‘lim sahifasida qo‘lda yuklangan qatori olib tashlanadi, umumiy soliq hisobotidagisi qoladi (ish haqi bir marta sanaladi).`,
                      })
                    }
                  >
                    Qo‘lda yuklanganini olib tashlash ({dedupable.length})
                  </Button>
                )}
              </div>
              <ul className="space-y-1 text-xs">
                {v.duplicates.slice(0, 50).map((d) => (
                  <li key={d.pinfl} className="flex flex-wrap justify-between gap-2">
                    <span>
                      <b>{d.fullName}</b> <span className="money text-(--color-text-muted)">{d.pinfl}</span> ·{' '}
                      {d.sources.map((s, i) => (
                        <span key={i}>
                          {i > 0 ? ' + ' : ''}
                          {s.unit && unitPayrollHref(s.unit, period) ? (
                            <Link href={unitPayrollHref(s.unit, period)!} className="text-brand-700 hover:underline">
                              {s.where}
                            </Link>
                          ) : (
                            <Link href={sourceHref.soliq(period)} className="text-brand-700 hover:underline">
                              {s.where}
                            </Link>
                          )}{' '}
                          {formatTiyin(s.tiyin)}
                        </span>
                      ))}
                    </span>
                    <span className="text-(--color-warn)">
                      ortiqcha <Money tiyin={d.extraTiyin} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Bog'lanmagan bo'lim yuklashlari */}
          {v.soliq.stray.length > 0 && (
            <div className="rounded-(--radius-control) border border-(--color-warn)/50 bg-(--color-warn-soft)/40 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="font-semibold text-heading">Umumiy vedomostdan yaratilgan, lekin saqlangan umumiy yuklashga bog‘lanmagan: {v.soliq.stray.length} ta</p>
                <Button
                  size="sm"
                  variant="secondary"
                  className="ml-auto"
                  onClick={() =>
                    setAction({
                      kind: 'stray',
                      ids: v.soliq.stray.map((s) => s.batchId),
                      title: 'Bog‘lanmagan bo‘lim yuklashlarini bekor qilish',
                      message: `${v.soliq.stray.length} ta bo‘lim yuklashi (${formatTiyin(v.soliq.strayTiyin)} so‘m) bekor qilinadi — ular eski (bekor qilingan) umumiy hisobotdan qolgan.`,
                    })
                  }
                >
                  Bekor qilish
                </Button>
              </div>
              <ul className="space-y-1 text-xs">
                {v.soliq.stray.map((s) => (
                  <li key={s.batchId} className="flex justify-between gap-2">
                    <span>
                      <UnitLink unit={s.unit} period={period} label={s.label} />: «{s.fileName}»
                    </span>
                    <Money tiyin={s.totalTiyin} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Manbasiz */}
          {others.length > 0 && (
            <div className="rounded-(--radius-control) border border-(--color-line) p-3">
              <p className="mb-1 font-semibold text-heading">Manbasiz ish haqi yozuvlari: {others.length} ta</p>
              <p className="mb-2 text-xs text-(--color-text-muted)">Soliq hisobotiga bog‘lanmagan (qo‘lda kiritilgan yoki boshqa joydan). To‘g‘ri bo‘lmasa — Xarajatlar ro‘yxatidan o‘chiring.</p>
              <ul className="space-y-1 text-xs">
                {others.slice(0, 30).map((i) => (
                  <li key={i.id} className="flex justify-between gap-2">
                    <span>{i.description ?? '—'}</span>
                    <Money tiyin={i.tiyin} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Yil bo'yicha */}
          <div>
            <button type="button" className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setYear((x) => !x)}>
              {year ? '▾' : '▸'} {period.slice(0, 4)}-yil oylari bo‘yicha
            </button>
            {year && range.data && (
              <table className="mt-2 w-full text-xs">
                <thead className="text-(--color-text-muted)">
                  <tr>
                    <th className="py-1 text-left font-medium">Oy</th>
                    <th className="py-1 text-right font-medium">Soliq hisoboti</th>
                    <th className="py-1 text-right font-medium">Ish haqi xarajati</th>
                    <th className="py-1 text-right font-medium">Farq</th>
                  </tr>
                </thead>
                <tbody>
                  {range.data.months.map((m) => (
                    <tr key={m.period} className="border-t border-(--color-line)">
                      <td className="py-1">{formatPeriod(m.period)}</td>
                      <td className="py-1 text-right">
                        <Money tiyin={m.expected} />
                      </td>
                      <td className="py-1 text-right">
                        <Money tiyin={m.expenseTotal} />
                      </td>
                      <td className={cn('py-1 text-right', m.diffTiyin !== '0' ? 'font-semibold text-(--color-expense)' : 'text-(--color-income)')}>{m.diffTiyin === '0' ? '✓' : <Money tiyin={m.diffTiyin} />}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-(--color-line-strong) font-semibold">
                    <td className="py-1">Jami</td>
                    <td className="py-1 text-right">
                      <Money tiyin={range.data.expected} />
                    </td>
                    <td className="py-1 text-right">
                      <Money tiyin={range.data.expenseTotal} />
                    </td>
                    <td className={cn('py-1 text-right', range.data.diffTiyin !== '0' && 'text-(--color-expense)')}>{range.data.diffTiyin === '0' ? '✓' : <Money tiyin={range.data.diffTiyin} />}</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={action !== null}
        title={action?.title ?? ''}
        message={action?.message ?? ''}
        confirmLabel="Tasdiqlayman"
        danger={action?.kind === 'clean'}
        loading={busy}
        onConfirm={() => void run()}
        onCancel={() => setAction(null)}
      />
    </Card>
  );
}

function UnitLink({ unit, period, label }: { unit: string; period: string; label: string }) {
  const href = unitPayrollHref(unit, period);
  return href ? (
    <Link href={href} className="font-medium text-brand-700 hover:underline">
      {label}
    </Link>
  ) : (
    <>{label}</>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-white px-5 py-3">
      <p className="text-[11px] uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className="money mt-0.5 text-lg font-semibold text-heading">
        <Money tiyin={value} />
      </p>
      <p className="truncate text-[11px] text-(--color-text-muted)">{hint}</p>
    </div>
  );
}
