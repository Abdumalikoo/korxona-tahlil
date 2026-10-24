'use client';

import { SourceActions } from '@/components/shared/source-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconCheck, IconSpinner, IconUpload } from '@/components/ui/icons';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatTiyin } from '@/lib/format';
import { usePeriod } from '@/lib/period';
import type { EntryUnit } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useRef, useState } from 'react';
import { analyzeLeaseFile, downloadLeaseTemplate, unitLeaseApi, type LeaseAnalyzeResult, type LeaseBatch, type LeaseCell } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › <yo'nalish> › Ijara va kommunal — filiallar kesimida (Tax free: 13 filial).
//  1) Oylar oralig'ini tanlang (masalan, yanvar–aprel) → «Shablon»: shu oylarning hammasi bitta faylda.
//  2) To'ldirib yuklang → fayldagi hamma oylar o'qiladi; saqlanadigan oylarni belgilang → «Saqlash».
//  Bir oy qayta yuklansa — o'sha oyning oldingi ma'lumoti almashtiriladi.
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone?: 'success' | 'error' } | null;

const MONTHS_UZ = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
const monthLabel = (p: string) => `${MONTHS_UZ[Number(p.slice(5, 7)) - 1] ?? p} ${p.slice(0, 4)}`;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthsCount(from: string, to: string): number {
  if (!PERIOD_RE.test(from) || !PERIOD_RE.test(to)) return 0;
  const a = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7));
  const b = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7));
  return b - a + 1;
}

const STATE: Record<LeaseBatch['state'], { label: string; tone: 'income' | 'neutral' | 'warn' }> = {
  ACTIVE: { label: 'Amalda', tone: 'income' },
  PARTIAL: { label: 'Qisman almashtirilgan', tone: 'warn' },
  REPLACED: { label: 'Almashtirilgan', tone: 'neutral' },
  CANCELLED: { label: 'Bekor qilingan', tone: 'neutral' },
};

const money = (t: string | null | undefined) => (t && t !== '0' ? formatTiyin(t) : '');

export function UnitLeaseView({ unit }: { unit: EntryUnit }) {
  const { isAdmin } = useAuth();
  const { month } = usePeriod();
  const [from, setFrom] = useState(`${month.slice(0, 4)}-01`);
  const [to, setTo] = useState(month);
  const count = monthsCount(from, to);
  const rangeError = !PERIOD_RE.test(from) || !PERIOD_RE.test(to) ? 'Oylarni tanlang' : count < 1 ? "«Dan» oyi «Gacha»dan keyin bo'lmasin" : count > 24 ? "Ko'pi bilan 24 oy" : null;

  const [analysis, setAnalysis] = useState<LeaseAnalyzeResult | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<LeaseBatch | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const data = useAsync(() => (rangeError ? Promise.resolve(null) : unitLeaseApi.data(unit.code, from, to)), [unit.code, from, to, rangeError]);
  const batches = useAsync(() => unitLeaseApi.batches(unit.code), [unit.code]);

  function reset() {
    setAnalysis(null);
    setPicked(new Set());
    if (inputRef.current) inputRef.current.value = '';
  }

  function preset(kind: 'month' | 'year' | 'quarter') {
    const y = month.slice(0, 4);
    const m = Number(month.slice(5, 7));
    if (kind === 'month') {
      setFrom(month);
      setTo(month);
    } else if (kind === 'year') {
      setFrom(`${y}-01`);
      setTo(month);
    } else {
      const q0 = Math.floor((m - 1) / 3) * 3 + 1;
      setFrom(`${y}-${String(q0).padStart(2, '0')}`);
      setTo(`${y}-${String(q0 + 2).padStart(2, '0')}`);
    }
  }

  async function handleTemplate() {
    if (rangeError) {
      setToast({ message: rangeError, tone: 'error' });
      return;
    }
    setDownloading(true);
    try {
      await downloadLeaseTemplate(unit.code, from, to);
    } catch (err) {
      setToast({ message: errorMessage(err, "Shablonni yuklab bo'lmadi"), tone: 'error' });
    } finally {
      setDownloading(false);
    }
  }

  async function handleFile(file: File) {
    if (!/\.xlsx$/i.test(file.name)) {
      setToast({ message: 'Faqat Excel (.xlsx) fayl yuklang', tone: 'error' });
      return;
    }
    setUploading(true);
    setAnalysis(null);
    try {
      const res = await analyzeLeaseFile(unit.code, file);
      setAnalysis(res);
      setPicked(new Set(res.months.filter((m) => !m.empty).map((m) => m.period)));
    } catch (err) {
      setToast({ message: errorMessage(err, "Faylni o'qib bo'lmadi"), tone: 'error' });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleSave() {
    if (!analysis || !picked.size) return;
    setSaving(true);
    try {
      const months = [...picked].sort();
      const rows = analysis.branches.flatMap((b) => months.map((period) => ({ branch: b.code, period, ...(b.cells[period] ?? { ijaraTiyin: '0', kommunalTiyin: '0' }) })));
      const res = (await unitLeaseApi.commit(unit.code, { fileName: analysis.fileName, months, rows })).data;
      setToast({
        tone: 'success',
        message: `${res.months.map(monthLabel).join(', ')} saqlandi · ${formatTiyin(res.totalTiyin)} so'm · ${res.expensesCreated} ta xarajat` + (res.replacedMonths ? ` · ${res.replacedMonths} oy almashtirildi` : ''),
      });
      // Saqlangan oylar ko'rinsin
      if (months[0]! < from) setFrom(months[0]!);
      if (months[months.length - 1]! > to) setTo(months[months.length - 1]!);
      reset();
      data.reload();
      batches.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Saqlashda xatolik'), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const res = (await unitLeaseApi.cancel(unit.code, cancelTarget.id)).data;
      setToast({ tone: 'success', message: res.clearedMonths.length ? `Bekor qilindi: ${res.clearedMonths.map(monthLabel).join(', ')} — xarajatlar savatga tushdi` : 'Bekor qilindi' });
      data.reload();
      batches.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Bekor qilishda xatolik'), tone: 'error' });
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  }

  const rangeText = rangeError ? '' : from === to ? monthLabel(from) : `${monthLabel(from)} – ${monthLabel(to)}`;

  return (
    <div className="space-y-4">
      {/* Oylar oralig'i */}
      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-(--color-text-muted)">
            Dan
            <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 block h-9 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm text-heading" />
          </label>
          <label className="text-xs font-medium text-(--color-text-muted)">
            Gacha
            <input type="month" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 block h-9 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm text-heading" />
          </label>
          <div className="flex flex-wrap gap-1.5 pb-0.5">
            {(
              [
                ['month', 'Shu oy'],
                ['quarter', 'Shu chorak'],
                ['year', 'Yil boshidan'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => preset(k)} className="rounded-full border border-(--color-line) bg-white px-3 py-1.5 text-xs font-medium text-heading hover:border-brand-300 hover:bg-brand-50">
                {l}
              </button>
            ))}
          </div>
          <p className={cn('ml-auto pb-1.5 text-sm', rangeError ? 'text-(--color-expense)' : 'text-(--color-text-muted)')}>
            {rangeError ?? (
              <>
                <b className="text-heading">{count}</b> oy · {rangeText}
              </>
            )}
          </p>
        </CardBody>
      </Card>

      <SourceActions
        upload={
          isAdmin
            ? {
                label: 'Faylni yuklash',
                onClick: () => inputRef.current?.click(),
                loading: uploading,
                disabled: Boolean(analysis),
                hint: analysis ? 'Avval joriy tahlilni saqlang yoki bekor qiling' : "To'ldirilgan shablon — undagi hamma oylar o'qiladi",
              }
            : undefined
        }
        template={{ label: rangeError ? 'Shablon' : `Shablon · ${rangeText}`, onClick: () => void handleTemplate(), loading: downloading, disabled: Boolean(rangeError) }}
        note={
          <>
            Shablonda {unit.label} filiallari va tanlangan oylarning hammasi (har oyda «Ijara» va «Kommunal»). Oldin saqlangan summalar shablonga yozilgan bo&apos;ladi.
            Bir oy qayta yuklansa — o&apos;sha oyning oldingi ma&apos;lumoti almashtiriladi.
          </>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {isAdmin && !analysis && (
        <Card>
          <CardBody>
            <div
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const file = e.dataTransfer.files[0];
                if (file) void handleFile(file);
              }}
              onClick={() => inputRef.current?.click()}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-(--radius-card) border-2 border-dashed px-6 py-10 transition-colors',
                dragging ? 'border-brand-600 bg-brand-50' : 'border-(--color-line-strong) hover:border-brand-400 hover:bg-(--color-surface-muted)',
              )}
            >
              {uploading ? (
                <>
                  <IconSpinner className="size-8 animate-spin text-brand-700" />
                  <p className="text-sm text-(--color-text-muted)">O&apos;qilmoqda…</p>
                </>
              ) : (
                <>
                  <IconUpload className="size-8 text-(--color-text-faint)" strokeWidth={1.5} />
                  <p className="text-sm font-medium">To&apos;ldirilgan shablonni shu yerga tashlang</p>
                  <p className="text-xs text-(--color-text-muted)">yoki bosib tanlang · fayldagi hamma oylar o&apos;qiladi, saqlanadiganlarini keyin belgilaysiz</p>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {analysis && (
        <Card className="overflow-hidden">
          <CardHeader title={`Tahlil: ${analysis.fileName}`} description={`${analysis.label} · ${analysis.months.length} oy — hali saqlanmagan`} />
          <CardBody className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-(--color-text-muted)">Saqlanadigan oylar</p>
              <div className="flex flex-wrap gap-2">
                {analysis.months.map((m) => {
                  const on = picked.has(m.period);
                  return (
                    <label
                      key={m.period}
                      className={cn('flex cursor-pointer items-start gap-2 rounded-(--radius-control) border bg-white px-3 py-2', on ? 'border-brand-600 shadow-sm' : 'border-(--color-line)')}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 accent-brand-600"
                        checked={on}
                        onChange={() =>
                          setPicked((s) => {
                            const x = new Set(s);
                            if (x.has(m.period)) x.delete(m.period);
                            else x.add(m.period);
                            return x;
                          })
                        }
                      />
                      <span>
                        <span className="block text-sm font-semibold text-heading">{m.label}</span>
                        <span className="money block text-xs text-(--color-text-muted)">{m.empty ? "bo'sh" : `${formatTiyin(m.totalTiyin)} so'm`}</span>
                        {m.saved ? (
                          <span className="block text-[11px] text-amber-700">almashtiriladi (oldingi: {formatTiyin(m.saved.totalTiyin)})</span>
                        ) : (
                          <span className="block text-[11px] text-emerald-700">yangi</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            {(analysis.invalid.length > 0 || analysis.unknownRows.length > 0) && (
              <p className="rounded-(--radius-control) border border-(--color-expense)/30 bg-(--color-expense-soft) px-3 py-2 text-xs text-(--color-expense)">
                {analysis.invalid.length > 0 && <>O&apos;qilmagan kataklar (0 deb olinadi): {analysis.invalid.slice(0, 8).map((x) => `${x.column}${x.row} — ${x.reason}`).join('; ')}{analysis.invalid.length > 8 ? ' …' : ''}. </>}
                {analysis.unknownRows.length > 0 && <>Filiali aniqlanmagan qatorlar (saqlanmaydi): {analysis.unknownRows.map((x) => `${x.row}-qator «${x.text}»`).join(', ')}.</>}
              </p>
            )}
            {analysis.missingBranches.length > 0 && (
              <p className="rounded-(--radius-control) border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Faylda yo&apos;q filiallar (0 deb olinadi): {analysis.missingBranches.map((b) => b.no).join(', ')}
              </p>
            )}

            <LeaseMatrix
              months={analysis.months.map((m) => ({ period: m.period, label: m.label, dim: !picked.has(m.period) }))}
              branches={analysis.branches}
            />

            <div className="flex flex-wrap items-center justify-end gap-2">
              {!picked.size && (
                <span className="mr-auto flex items-center gap-1.5 text-xs text-amber-800">
                  <IconAlert className="size-4" />
                  Saqlash uchun kamida bitta oyni belgilang
                </span>
              )}
              <Button variant="ghost" onClick={reset} disabled={saving}>
                Bekor qilish
              </Button>
              <Button onClick={() => void handleSave()} loading={saving} disabled={!picked.size}>
                <IconCheck className="size-4" />
                Saqlash ({picked.size} oy)
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Saqlangan ma'lumotlar */}
      <Card className="overflow-hidden">
        <CardHeader title="Saqlangan to'lovlar" description={rangeText || "Oylar oralig'ini tanlang"} />
        {rangeError ? (
          <p className="px-5 py-6 text-sm text-(--color-text-muted)">{rangeError}</p>
        ) : data.loading ? (
          <LoadingState />
        ) : data.error ? (
          <p className="px-5 py-6 text-sm text-(--color-expense)">{data.error}</p>
        ) : data.data?.data ? (
          data.data.data.months.some((m) => m.saved) ? (
            <LeaseMatrix
              months={data.data.data.months.map((m) => ({ period: m.period, label: m.label, dim: !m.saved, note: m.saved ? undefined : 'yuklanmagan' }))}
              branches={data.data.data.branches}
            />
          ) : (
            <EmptyState title="Bu oylar uchun ma'lumot yuklanmagan" description="Shablonni yuklab oling, to'ldiring va shu yerga yuklang" />
          )
        ) : null}
      </Card>

      {/* Tarix */}
      <Card className="overflow-hidden">
        <CardHeader title="Yuklashlar tarixi" description={unit.label} />
        {batches.loading ? (
          <LoadingState />
        ) : (batches.data?.data.length ?? 0) === 0 ? (
          <EmptyState title="Hali yuklash yo'q" />
        ) : (
          <ul>
            {batches.data?.data.map((b) => (
              <li key={b.id} className={cn('flex flex-wrap items-center gap-3 border-t border-(--color-line) px-5 py-2.5', (b.state === 'CANCELLED' || b.state === 'REPLACED') && 'opacity-55')}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-heading">{b.fileName}</p>
                  <p className="text-xs text-(--color-text-muted)">
                    {formatDateTime(b.createdAt)}
                    {b.uploadedBy ? ` · ${b.uploadedBy}` : ''} · {b.monthLabels.join(', ')}
                  </p>
                </div>
                <Badge tone={STATE[b.state].tone} className="whitespace-nowrap">
                  {STATE[b.state].label}
                </Badge>
                <span className="money w-36 text-right text-sm text-(--color-expense)">{formatTiyin(b.totalTiyin)}</span>
                {isAdmin && b.state !== 'CANCELLED' && b.state !== 'REPLACED' ? (
                  <Button variant="ghost" size="sm" onClick={() => setCancelTarget(b)} className="text-(--color-text-muted) hover:text-(--color-expense)">
                    Bekor qilish
                  </Button>
                ) : (
                  <span className="w-[6.5rem]" />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Yuklashni bekor qilish"
        message={`${cancelTarget?.fileName ?? ''} bekor qilinadi. Shu yuklash bilan turgan oylar (${(cancelTarget?.liveMonths ?? []).map(monthLabel).join(', ') || '—'}) ma'lumoti o'chadi, xarajatlari savatga tushadi. Oldingi yuklashlar qaytmaydi.`}
        confirmLabel="Bekor qilish"
        danger
        loading={cancelling}
        onConfirm={() => void handleCancel()}
        onCancel={() => setCancelTarget(null)}
      />

      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

// ─────────── Filial × oy jadvali ───────────

function LeaseMatrix({
  months,
  branches,
}: {
  months: { period: string; label: string; dim?: boolean; note?: string }[];
  branches: { code: string; no: number; name: string; cells: Record<string, LeaseCell | null> }[];
}) {
  const totals = useMemo(() => {
    const per = new Map<string, { i: bigint; k: bigint }>();
    let all = { i: 0n, k: 0n };
    const rows = new Map<string, { i: bigint; k: bigint }>();
    for (const b of branches) {
      let r = { i: 0n, k: 0n };
      for (const m of months) {
        if (m.dim) continue;
        const c = b.cells[m.period];
        const i = BigInt(c?.ijaraTiyin ?? '0');
        const k = BigInt(c?.kommunalTiyin ?? '0');
        const t = per.get(m.period) ?? { i: 0n, k: 0n };
        per.set(m.period, { i: t.i + i, k: t.k + k });
        r = { i: r.i + i, k: r.k + k };
      }
      rows.set(b.code, r);
      all = { i: all.i + r.i, k: all.k + r.k };
    }
    return { per, rows, all };
  }, [months, branches]);

  const th = 'border-b border-(--color-line) px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)';
  const td = 'money border-b border-(--color-line) px-2 py-1.5 text-right text-xs whitespace-nowrap';

  return (
    <div className="max-h-[560px] overflow-auto">
      <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-[2] bg-(--color-surface-muted)">
          <tr>
            <th rowSpan={2} className={cn(th, 'sticky left-0 z-[3] w-10 bg-(--color-surface-muted) text-center')}>
              №
            </th>
            <th rowSpan={2} className={cn(th, 'sticky left-10 z-[3] min-w-[18rem] bg-(--color-surface-muted) text-left')}>
              Filial
            </th>
            {months.map((m) => (
              <th key={m.period} colSpan={2} className={cn(th, 'border-l text-center normal-case', m.dim && 'opacity-50')}>
                <span className="text-xs text-heading">{m.label}</span>
                {m.note && <span className="ml-1 font-normal">· {m.note}</span>}
              </th>
            ))}
            <th colSpan={2} className={cn(th, 'border-l bg-amber-50 text-center')}>
              Jami
            </th>
          </tr>
          <tr>
            {months.map((m) => (
              <Sub key={m.period} cls={cn(th, m.dim && 'opacity-50')} />
            ))}
            <Sub cls={cn(th, 'bg-amber-50')} />
          </tr>
        </thead>
        <tbody>
          {branches.map((b) => (
            <tr key={b.code} className="hover:bg-brand-50/40">
              <td className="sticky left-0 z-[1] border-b border-(--color-line) bg-white px-2 py-1.5 text-center text-xs text-(--color-text-faint)">{b.no}</td>
              <td className="sticky left-10 z-[1] max-w-[22rem] border-b border-(--color-line) bg-white px-2 py-1.5 text-xs text-heading" title={b.name}>
                <span className="line-clamp-2">{b.name}</span>
              </td>
              {months.map((m) => {
                const c = b.cells[m.period];
                return [
                  <td key={`${m.period}i`} className={cn(td, 'border-l', m.dim && 'opacity-40')}>
                    {money(c?.ijaraTiyin)}
                  </td>,
                  <td key={`${m.period}k`} className={cn(td, m.dim && 'opacity-40')}>
                    {money(c?.kommunalTiyin)}
                  </td>,
                ];
              })}
              <td className={cn(td, 'border-l bg-amber-50/50 font-semibold')}>{money(totals.rows.get(b.code)?.i.toString())}</td>
              <td className={cn(td, 'bg-amber-50/50 font-semibold')}>{money(totals.rows.get(b.code)?.k.toString())}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 z-[2] bg-(--color-surface-muted) font-semibold">
          <tr>
            <td className="sticky left-0 z-[3] bg-(--color-surface-muted)" />
            <td className="sticky left-10 z-[3] bg-(--color-surface-muted) px-2 py-2 text-xs text-heading">JAMI</td>
            {months.map((m) => [
              <td key={`${m.period}i`} className={cn(td, 'border-l', m.dim && 'opacity-40')}>
                {m.dim ? '' : money(totals.per.get(m.period)?.i.toString()) || '0'}
              </td>,
              <td key={`${m.period}k`} className={cn(td, m.dim && 'opacity-40')}>
                {m.dim ? '' : money(totals.per.get(m.period)?.k.toString()) || '0'}
              </td>,
            ])}
            <td className={cn(td, 'border-l bg-amber-50 text-(--color-expense)')}>{money(totals.all.i.toString()) || '0'}</td>
            <td className={cn(td, 'bg-amber-50 text-(--color-expense)')}>{money(totals.all.k.toString()) || '0'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Sub({ cls }: { cls: string }) {
  return (
    <>
      <th className={cn(cls, 'border-l text-right')}>Ijara</th>
      <th className={cn(cls, 'text-right')}>Kommunal</th>
    </>
  );
}