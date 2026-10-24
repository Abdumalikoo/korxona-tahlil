'use client';

import { SourceActions } from '@/components/shared/source-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconCheck, IconChevronDown, IconEdit, IconPlus, IconSpinner, IconTrash, IconUpload } from '@/components/ui/icons';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatTiyin } from '@/lib/format';
import { MonthRangeCard, monthLabel, useMonthRange } from '@/features/units/month-range';
import type { EntryUnit } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useMemo, useRef, useState } from 'react';
import { analyzeLeaseFile, downloadLeaseTemplate, unitLeaseApi, type LeaseAnalyzeResult, type LeaseBatch, type LeaseBranch, type LeaseCell, type LeaseKindInfo, type LeaseMeta } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › <yo'nalish> › doimiy to'lovlar — filiallar/joylar kesimida.
//   Tax free › Ijara va kommunal (13 filial, ro'yxat qat'iy); Fermer xo'jaligi › Ijara va internet (joylar tahrirlanadi).
//  1) Oylar oralig'ini tanlang (masalan, yanvar–aprel) → «Shablon»: shu oylarning hammasi bitta faylda.
//  2) To'ldirib yuklang → fayldagi hamma oylar o'qiladi; saqlanadigan oylarni belgilang → «Saqlash».
//  Bir oy qayta yuklansa — o'sha oyning oldingi ma'lumoti almashtiriladi.
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone?: 'success' | 'error' } | null;

const STATE: Record<LeaseBatch['state'], { label: string; tone: 'income' | 'neutral' | 'warn' }> = {
  ACTIVE: { label: 'Amalda', tone: 'income' },
  PARTIAL: { label: 'Qisman almashtirilgan', tone: 'warn' },
  REPLACED: { label: 'Almashtirilgan', tone: 'neutral' },
  CANCELLED: { label: 'Bekor qilingan', tone: 'neutral' },
};

const money = (t: string | null | undefined) => (t && t !== '0' ? formatTiyin(t) : '');
const big = (t: string | null | undefined) => {
  try {
    return BigInt(t ?? '0');
  } catch {
    return 0n;
  }
};

/** Ma'lumot kelguncha — bo'limning odatiy turlari */
const FALLBACK: Record<string, LeaseMeta> = {
  TAX_FREE: { title: 'Ijara va kommunal', branchLabel: 'Filial', kinds: [{ key: 'IJARA', label: 'Ijara', field: 'ijaraTiyin' }, { key: 'KOMMUNAL', label: 'Kommunal', field: 'kommunalTiyin' }] },
  FERMER: { title: 'Ijara va internet', branchLabel: 'Joy', kinds: [{ key: 'IJARA', label: 'Ijara', field: 'ijaraTiyin' }, { key: 'INTERNET', label: 'Internet', field: 'internetTiyin' }] },
};

export function UnitLeaseView({ unit }: { unit: EntryUnit }) {
  const { isAdmin } = useAuth();
  const range = useMonthRange();
  const { from, to, error: rangeError, text: rangeText } = range;

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
  const saved = data.data?.data ?? null;
  const meta: LeaseMeta = analysis ?? saved ?? FALLBACK[unit.code] ?? FALLBACK.TAX_FREE!;
  const kindsText = meta.kinds.map((k) => `«${k.label}»`).join(' va ');
  const branchWord = meta.branchLabel === 'Joy' ? 'joylari' : 'filiallari';

  function reset() {
    setAnalysis(null);
    setPicked(new Set());
    if (inputRef.current) inputRef.current.value = '';
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
      const rows = analysis.branches.flatMap((b) => months.map((period) => ({ ...(b.cells[period] ?? {}), branch: b.code, period })));
      const res = (await unitLeaseApi.commit(unit.code, { fileName: analysis.fileName, months, rows })).data;
      setToast({
        tone: 'success',
        message: `${res.months.map(monthLabel).join(', ')} saqlandi · ${formatTiyin(res.totalTiyin)} so'm · ${res.expensesCreated} ta xarajat` + (res.replacedMonths ? ` · ${res.replacedMonths} oy almashtirildi` : ''),
      });
      range.include(months); // saqlangan oylar ko'rinsin
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

  return (
    <div className="space-y-4">
      <MonthRangeCard range={range} />

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
            Shablonda {unit.label} {branchWord} va tanlangan oylarning hammasi (har oyda {kindsText}). Oldin saqlangan summalar shablonga yozilgan bo&apos;ladi.
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

      {saved?.editable && (
        <BranchesCard
          unit={unit.code}
          branches={saved.branches}
          canEdit={isAdmin && !analysis}
          onSaved={(msg) => {
            setToast({ tone: 'success', message: msg });
            data.reload();
          }}
          onError={(msg) => setToast({ tone: 'error', message: msg })}
        />
      )}

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
                {analysis.unknownRows.length > 0 && <>{meta.branchLabel}i aniqlanmagan qatorlar (saqlanmaydi): {analysis.unknownRows.map((x) => `${x.row}-qator «${x.text}»`).join(', ')}.</>}
              </p>
            )}
            {analysis.missingBranches.length > 0 && (
              <p className="rounded-(--radius-control) border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Faylda yo&apos;q {branchWord.replace('lari', 'lar')} (0 deb olinadi): {analysis.missingBranches.map((b) => b.no).join(', ')}
              </p>
            )}

            <LeaseMatrix
              kinds={analysis.kinds}
              branchLabel={analysis.branchLabel}
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
              kinds={data.data.data.kinds}
              branchLabel={data.data.data.branchLabel}
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
  kinds,
  branchLabel,
  months,
  branches,
}: {
  kinds: LeaseKindInfo[];
  branchLabel: string;
  months: { period: string; label: string; dim?: boolean; note?: string }[];
  branches: { code: string; no: number; name: string; cells: Record<string, LeaseCell | null> }[];
}) {
  const totals = useMemo(() => {
    const zero = () => kinds.map(() => 0n);
    const per = new Map<string, bigint[]>();
    const rows = new Map<string, bigint[]>();
    const all = zero();
    for (const b of branches) {
      const r = zero();
      for (const m of months) {
        if (m.dim) continue;
        const c = b.cells[m.period];
        const t = per.get(m.period) ?? zero();
        kinds.forEach((k, ki) => {
          const v = big(c?.[k.field]);
          t[ki] = t[ki]! + v;
          r[ki] = r[ki]! + v;
        });
        per.set(m.period, t);
      }
      rows.set(b.code, r);
      r.forEach((v, ki) => (all[ki] = all[ki]! + v));
    }
    return { per, rows, all };
  }, [months, branches, kinds]);

  const th = 'border-b border-(--color-line) px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)';
  const td = 'money border-b border-(--color-line) px-2 py-1.5 text-right text-xs whitespace-nowrap';
  const span = kinds.length;

  return (
    <div className="max-h-[560px] overflow-auto">
      <table className="w-full min-w-max border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-[2] bg-(--color-surface-muted)">
          <tr>
            <th rowSpan={2} className={cn(th, 'sticky left-0 z-[3] w-10 bg-(--color-surface-muted) text-center')}>
              №
            </th>
            <th rowSpan={2} className={cn(th, 'sticky left-10 z-[3] min-w-[18rem] bg-(--color-surface-muted) text-left')}>
              {branchLabel}
            </th>
            {months.map((m) => (
              <th key={m.period} colSpan={span} className={cn(th, 'border-l text-center normal-case', m.dim && 'opacity-50')}>
                <span className="text-xs text-heading">{m.label}</span>
                {m.note && <span className="ml-1 font-normal">· {m.note}</span>}
              </th>
            ))}
            <th colSpan={span} className={cn(th, 'border-l bg-amber-50 text-center')}>
              Jami
            </th>
          </tr>
          <tr>
            {months.map((m) => (
              <Sub key={m.period} kinds={kinds} cls={cn(th, m.dim && 'opacity-50')} />
            ))}
            <Sub kinds={kinds} cls={cn(th, 'bg-amber-50')} />
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
                return kinds.map((k, ki) => (
                  <td key={`${m.period}${k.key}`} className={cn(td, ki === 0 && 'border-l', m.dim && 'opacity-40')}>
                    {money(c?.[k.field])}
                  </td>
                ));
              })}
              {kinds.map((k, ki) => (
                <td key={k.key} className={cn(td, ki === 0 && 'border-l', 'bg-amber-50/50 font-semibold')}>
                  {money(totals.rows.get(b.code)?.[ki]?.toString())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 z-[2] bg-(--color-surface-muted) font-semibold">
          <tr>
            <td className="sticky left-0 z-[3] bg-(--color-surface-muted)" />
            <td className="sticky left-10 z-[3] bg-(--color-surface-muted) px-2 py-2 text-xs text-heading">JAMI</td>
            {months.map((m) =>
              kinds.map((k, ki) => (
                <td key={`${m.period}${k.key}`} className={cn(td, ki === 0 && 'border-l', m.dim && 'opacity-40')}>
                  {m.dim ? '' : money(totals.per.get(m.period)?.[ki]?.toString()) || '0'}
                </td>
              )),
            )}
            {kinds.map((k, ki) => (
              <td key={k.key} className={cn(td, ki === 0 && 'border-l', 'bg-amber-50 text-(--color-expense)')}>
                {money(totals.all[ki]?.toString()) || '0'}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Sub({ cls, kinds }: { cls: string; kinds: LeaseKindInfo[] }) {
  return (
    <>
      {kinds.map((k, ki) => (
        <th key={k.key} className={cn(cls, ki === 0 && 'border-l', 'text-right')}>
          {k.label}
        </th>
      ))}
    </>
  );
}

// ─────────── Joylar ro'yxati (tahrirlanadigan bo'limlar: Fermer xo'jaligi …) ───────────

type DraftBranch = { key: string; code?: string; name: string };

function BranchesCard({
  unit,
  branches,
  canEdit,
  onSaved,
  onError,
}: {
  unit: string;
  branches: LeaseBranch[];
  canEdit: boolean;
  onSaved: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<DraftBranch[]>([]);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);

  function start() {
    setDraft(branches.map((b) => ({ key: b.code, code: b.code, name: b.name })));
    setEditing(true);
  }

  function move(i: number, d: -1 | 1) {
    setDraft((x) => {
      const j = i + d;
      if (j < 0 || j >= x.length) return x;
      const y = [...x];
      [y[i], y[j]] = [y[j]!, y[i]!];
      return y;
    });
  }

  const names = draft.map((b) => b.name.trim().toLowerCase());
  const dup = names.findIndex((n, i) => n && names.indexOf(n) !== i);
  const blank = draft.findIndex((b) => !b.name.trim());
  const problem = !draft.length ? 'Kamida bitta joy qolsin' : blank >= 0 ? `${blank + 1}-qator: nomi bo'sh` : dup >= 0 ? `Takrorlangan nom: «${draft[dup]!.name.trim()}»` : null;

  async function save() {
    if (problem) return;
    setSaving(true);
    try {
      const res = (await unitLeaseApi.saveBranches(unit, draft.map((b) => ({ code: b.code, name: b.name.trim() })))).data;
      setEditing(false);
      onSaved(`Joylar saqlandi · ${res.branches.length} ta`);
    } catch (err) {
      onError(errorMessage(err, "Joylarni saqlab bo'lmadi"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Joylar"
        description={editing ? "Nomini o'zgartirish, qo'shish, tartibini almashtirish. Summasi saqlangan joyni o'chirib bo'lmaydi." : `${branches.length} ta — shablon qatorlari shu tartibda`}
        actions={
          canEdit && !editing ? (
            <Button variant="secondary" size="sm" onClick={start}>
              <IconEdit className="size-4" />
              Tahrirlash
            </Button>
          ) : undefined
        }
      />
      {!editing ? (
        <div className="flex flex-wrap gap-2 px-5 pt-3 pb-4">
          {branches.map((b) => (
            <span key={b.code} className="rounded-full border border-(--color-line) bg-(--color-surface-muted) px-3 py-1 text-xs text-heading">
              <span className="mr-1 text-(--color-text-faint)">{b.no}.</span>
              {b.name}
            </span>
          ))}
        </div>
      ) : (
        <CardBody className="space-y-2">
          {draft.map((b, i) => (
            <div key={b.key} className="flex items-center gap-2">
              <span className="w-6 text-right text-xs text-(--color-text-faint)">{i + 1}</span>
              <input
                value={b.name}
                maxLength={200}
                autoFocus={!b.code && i === draft.length - 1}
                placeholder="Masalan: Issiqxona (Qibray)"
                onChange={(e) => setDraft((x) => x.map((y) => (y.key === b.key ? { ...y, name: e.target.value } : y)))}
                className="h-9 min-w-0 flex-1 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-3 text-sm focus:border-brand-500 focus:outline-none"
              />
              {!b.code && <Badge tone="income">yangi</Badge>}
              <Button variant="ghost" size="sm" aria-label="Yuqoriga" disabled={i === 0} onClick={() => move(i, -1)}>
                <IconChevronDown className="size-4 rotate-180" />
              </Button>
              <Button variant="ghost" size="sm" aria-label="Pastga" disabled={i === draft.length - 1} onClick={() => move(i, 1)}>
                <IconChevronDown className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label="O'chirish"
                className="text-(--color-text-muted) hover:text-(--color-expense)"
                onClick={() => setDraft((x) => x.filter((y) => y.key !== b.key))}
              >
                <IconTrash className="size-4" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                seq.current += 1;
                setDraft((x) => [...x, { key: `new-${seq.current}`, name: '' }]);
              }}
            >
              <IconPlus className="size-4" />
              Joy qo&apos;shish
            </Button>
            {problem && <span className="text-xs text-(--color-expense)">{problem}</span>}
            <span className="ml-auto" />
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
              Bekor qilish
            </Button>
            <Button size="sm" onClick={() => void save()} loading={saving} disabled={Boolean(problem)}>
              <IconCheck className="size-4" />
              Saqlash
            </Button>
          </div>
        </CardBody>
      )}
    </Card>
  );
}