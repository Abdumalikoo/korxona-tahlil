'use client';

import { SourceActions } from '@/components/shared/source-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconCheck, IconChevronRight, IconSpinner, IconUpload } from '@/components/ui/icons';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { MonthRangeCard, monthLabel, useMonthRange } from '@/features/units/month-range';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatTiyin } from '@/lib/format';
import type { EntryUnit } from '@/lib/segments';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, useRef, useState } from 'react';
import { analyzeBankFile, downloadBankTemplate, unitBankApi, type BankAnalyzeResult, type BankBatch, type BankRow } from './api';

// ═══════════════════════════════════════════════════════════
// Xarajatlar › <yo'nalish> › Bank xarajatlari — bank ko'chirmasi (выписка) shaklidagi fayldan.
//  • Fayldagi ma'lumot aynan o'zidek olinadi; xarajat — «Обороты по дебету» bor qatorlar.
//  • Izoh: «За выд.ин.вал. по курсу ЦБ.» → «Naqd pul konvertatsiya to'lovi».
//  • Ko'rinishi ichma-ich: oy → to'lovlar (izoh va summa) → to'lovni ochsa — ko'chirmadagi hamma maydonlar.
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone?: 'success' | 'error' } | null;

const STATE: Record<BankBatch['state'], { label: string; tone: 'income' | 'neutral' | 'warn' }> = {
  ACTIVE: { label: 'Amalda', tone: 'income' },
  PARTIAL: { label: 'Qisman almashtirilgan', tone: 'warn' },
  REPLACED: { label: 'Almashtirilgan', tone: 'neutral' },
  CANCELLED: { label: 'Bekor qilingan', tone: 'neutral' },
};

const fmtDate = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—');

export function UnitBankView({ unit }: { unit: EntryUnit }) {
  const { isAdmin } = useAuth();
  const range = useMonthRange();
  const { from, to, error: rangeError, text: rangeText } = range;

  const [analysis, setAnalysis] = useState<BankAnalyzeResult | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<BankBatch | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const data = useAsync(() => (rangeError ? Promise.resolve(null) : unitBankApi.data(unit.code, from, to)), [unit.code, from, to, rangeError]);
  const batches = useAsync(() => unitBankApi.batches(unit.code), [unit.code]);

  function reset() {
    setAnalysis(null);
    setPicked(new Set());
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleTemplate() {
    setDownloading(true);
    try {
      await downloadBankTemplate(unit.code);
    } catch (err) {
      setToast({ message: errorMessage(err, "Shablonni yuklab bo'lmadi"), tone: 'error' });
    } finally {
      setDownloading(false);
    }
  }

  async function handleFile(file: File) {
    if (!/\.(xlsx|xltx)$/i.test(file.name)) {
      setToast({ message: "Faqat Excel (.xlsx yoki .xltx) fayl yuklang — bank dasturidan «Excel» qilib oling", tone: 'error' });
      return;
    }
    setUploading(true);
    setAnalysis(null);
    try {
      const res = await analyzeBankFile(unit.code, file);
      setAnalysis(res);
      setPicked(new Set(res.months.map((m) => m.period)));
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
      const rows = analysis.rows.filter((r) => picked.has(r.period)).map(({ rowIndex: _i, period: _p, ...r }) => r);
      const res = (await unitBankApi.commit(unit.code, { fileName: analysis.fileName, months, rows })).data;
      setToast({
        tone: 'success',
        message: `${res.months.map(monthLabel).join(', ')} saqlandi · ${res.expensesCreated} ta to'lov · ${formatTiyin(res.totalTiyin)} so'm` + (res.replacedMonths ? ` · ${res.replacedMonths} oy almashtirildi` : ''),
      });
      range.include(months);
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
      const res = (await unitBankApi.cancel(unit.code, cancelTarget.id)).data;
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

  const months = data.data?.data.months ?? [];
  const savedMonths = months.filter((m) => m.saved);
  const savedTotal = savedMonths.reduce((s, m) => s + BigInt(m.totalTiyin), 0n);

  return (
    <div className="space-y-4">
      <MonthRangeCard range={range} />

      <SourceActions
        upload={
          isAdmin
            ? {
                label: "Ko'chirmani yuklash",
                onClick: () => inputRef.current?.click(),
                loading: uploading,
                disabled: Boolean(analysis),
                hint: analysis ? 'Avval joriy tahlilni saqlang yoki bekor qiling' : "Bank ko'chirmasi (выписка), .xlsx — undagi hamma oylar o'qiladi",
              }
            : undefined
        }
        template={{ label: "Shablon (ko'chirma shakli)", onClick: () => void handleTemplate(), loading: downloading }}
        note={
          <>
            Fayl aynan bank ko&apos;chirmasidek o&apos;qiladi. Xarajat — «Обороты по дебету» bor qatorlar; kirim (kredit) qatorlari olinmaydi. «За выд.ин.вал. по курсу ЦБ.» —
            xarajatda «Naqd pul konvertatsiya to&apos;lovi». Bir oy qayta yuklansa — o&apos;sha oyning oldingisi almashtiriladi.
          </>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xltx"
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
                  <p className="text-sm font-medium">Bank ko&apos;chirmasini shu yerga tashlang</p>
                  <p className="text-xs text-(--color-text-muted)">yoki bosib tanlang · .xlsx · fayldagi hamma oylar o&apos;qiladi, saqlanadiganlarini keyin belgilaysiz</p>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {analysis && (
        <Card className="overflow-hidden">
          <CardHeader title={`Tahlil: ${analysis.fileName}`} description={`${analysis.label} · «${analysis.sheetName}» varag'i — hali saqlanmagan`} />
          <CardBody className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-(--color-text-muted)">Saqlanadigan oylar</p>
              <div className="flex flex-wrap gap-2">
                {analysis.months.map((m) => {
                  const on = picked.has(m.period);
                  return (
                    <label key={m.period} className={cn('flex cursor-pointer items-start gap-2 rounded-(--radius-control) border bg-white px-3 py-2', on ? 'border-brand-600 shadow-sm' : 'border-(--color-line)')}>
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
                        <span className="money block text-xs text-(--color-text-muted)">
                          {m.count} ta · {formatTiyin(m.totalTiyin)} so&apos;m
                        </span>
                        {m.saved ? (
                          <span className="block text-[11px] text-amber-700">
                            almashtiriladi (oldingi: {m.saved.count} ta, {formatTiyin(m.saved.totalTiyin)})
                          </span>
                        ) : (
                          <span className="block text-[11px] text-emerald-700">yangi</span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-2 text-xs md:grid-cols-2">
              <p className="rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted) px-3 py-2 text-(--color-text-muted)">
                Xarajat qatorlari: <b className="text-heading">{analysis.rows.length}</b> ta · <b className="money text-(--color-expense)">{formatTiyin(analysis.totalTiyin)}</b> so&apos;m
                {analysis.renamedRows > 0 && <> · {analysis.renamedRows} tasida izoh «Naqd pul konvertatsiya to&apos;lovi»</>}
              </p>
              {analysis.inflow.count > 0 && (
                <p className="rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted) px-3 py-2 text-(--color-text-muted)">
                  Kirim (kredit) qatorlari olinmadi: {analysis.inflow.count} ta · <span className="money">{formatTiyin(analysis.inflow.totalTiyin)}</span> so&apos;m — xarajat emas
                </p>
              )}
            </div>
            {analysis.invalid.length > 0 && (
              <p className="rounded-(--radius-control) border border-(--color-expense)/30 bg-(--color-expense-soft) px-3 py-2 text-xs text-(--color-expense)">
                O&apos;qilmagan qatorlar (saqlanmaydi): {analysis.invalid.slice(0, 10).map((x) => `${x.rowIndex}-qator — ${x.reason}`).join('; ')}
                {analysis.invalid.length > 10 ? ` va yana ${analysis.invalid.length - 10} ta` : ''}
              </p>
            )}

            <BankTree
              months={analysis.months.map((m) => ({
                period: m.period,
                label: m.label,
                dim: !picked.has(m.period),
                count: m.count,
                totalTiyin: m.totalTiyin,
                rows: analysis.rows.filter((r) => r.period === m.period),
              }))}
              defaultOpen={analysis.months.length === 1}
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

      <Card className="overflow-hidden">
        <CardHeader
          title="Bank xarajatlari"
          description={rangeError ? "Oylar oralig'ini tanlang" : `${rangeText}${savedMonths.length ? ` · jami ${formatTiyin(savedTotal.toString())} so'm` : ''}`}
        />
        {rangeError ? (
          <p className="px-5 py-6 text-sm text-(--color-text-muted)">{rangeError}</p>
        ) : data.loading ? (
          <LoadingState />
        ) : data.error ? (
          <p className="px-5 py-6 text-sm text-(--color-expense)">{data.error}</p>
        ) : savedMonths.length ? (
          <BankTree months={months.map((m) => ({ period: m.period, label: m.label, count: m.count, totalTiyin: m.totalTiyin, rows: m.rows, note: m.saved ? undefined : 'yuklanmagan' }))} />
        ) : (
          <EmptyState title="Bu oylar uchun ko'chirma yuklanmagan" description="Bank ko'chirmasini yuklang — fayldagi hamma oylar o'qiladi" />
        )}
      </Card>

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
                    {b.uploadedBy ? ` · ${b.uploadedBy}` : ''} · {b.rows} ta to&apos;lov · {b.monthLabels.join(', ')}
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
        message={`${cancelTarget?.fileName ?? ''} bekor qilinadi. Shu yuklash bilan turgan oylar (${(cancelTarget?.liveMonths ?? []).map(monthLabel).join(', ') || '—'}) to'lovlari o'chadi, xarajatlari savatga tushadi. Oldingi yuklashlar qaytmaydi.`}
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

// ─────────── Ichma-ich ro'yxat: oy → to'lov → ko'chirmadagi maydonlar ───────────

function BankTree({
  months,
  defaultOpen = false,
}: {
  months: { period: string; label: string; count: number; totalTiyin: string; rows: BankRow[]; dim?: boolean; note?: string }[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(defaultOpen ? months.map((m) => m.period) : []));
  const [row, setRow] = useState<string | null>(null);
  const toggle = (p: string) =>
    setOpen((s) => {
      const x = new Set(s);
      if (x.has(p)) x.delete(p);
      else x.add(p);
      return x;
    });
  const total = months.filter((m) => !m.dim).reduce((s, m) => s + BigInt(m.totalTiyin), 0n);
  const count = months.filter((m) => !m.dim).reduce((s, m) => s + m.count, 0);

  return (
    <div className="max-h-[640px] overflow-auto">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-[1] bg-(--color-surface-muted)">
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">
            <th className="border-b border-(--color-line) px-3 py-2 text-left">Oy / to&apos;lov</th>
            <th className="w-28 border-b border-(--color-line) px-3 py-2 text-left">Sana</th>
            <th className="hidden w-64 border-b border-(--color-line) px-3 py-2 text-left lg:table-cell">Kimga</th>
            <th className="w-40 border-b border-(--color-line) px-3 py-2 text-right">Summa</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => {
            const isOpen = open.has(m.period) && m.rows.length > 0;
            return (
              <Fragment key={m.period}>
                <tr className={cn('cursor-pointer bg-white hover:bg-brand-50/50', m.dim && 'opacity-45')} onClick={() => m.rows.length && toggle(m.period)}>
                  <td className="border-b border-(--color-line) px-3 py-2">
                    <span className="flex items-center gap-2">
                      <IconChevronRight className={cn('size-3.5 shrink-0 text-(--color-text-muted) transition-transform', isOpen && 'rotate-90', !m.rows.length && 'invisible')} />
                      <span className="font-semibold text-heading">{m.label}</span>
                      <span className="text-xs text-(--color-text-muted)">{m.note ?? `${m.count} ta to'lov`}</span>
                    </span>
                  </td>
                  <td className="border-b border-(--color-line)" />
                  <td className="hidden border-b border-(--color-line) lg:table-cell" />
                  <td className="money border-b border-(--color-line) px-3 py-2 text-right font-semibold text-(--color-expense)">{m.rows.length ? formatTiyin(m.totalTiyin) : ''}</td>
                </tr>
                {isOpen &&
                  m.rows.map((r, i) => {
                    const id = `${m.period}:${i}`;
                    const rowOpen = row === id;
                    return (
                      <Fragment key={id}>
                        <tr className={cn('cursor-pointer hover:bg-brand-50/40', rowOpen && 'bg-brand-50/40', m.dim && 'opacity-45')} onClick={() => setRow(rowOpen ? null : id)}>
                          <td className="border-b border-(--color-line) py-1.5 pr-3 pl-9">
                            <span className="flex items-center gap-2">
                              <IconChevronRight className={cn('size-3 shrink-0 text-(--color-text-faint) transition-transform', rowOpen && 'rotate-90')} />
                              <span className="line-clamp-1 text-heading">{r.description}</span>
                            </span>
                          </td>
                          <td className="money border-b border-(--color-line) px-3 py-1.5 text-xs text-(--color-text-muted)">{fmtDate(r.docDate)}</td>
                          <td className="hidden border-b border-(--color-line) px-3 py-1.5 text-xs text-(--color-text-muted) lg:table-cell">
                            <span className="line-clamp-1">{r.accountName}</span>
                          </td>
                          <td className="money border-b border-(--color-line) px-3 py-1.5 text-right">{formatTiyin(r.debitTiyin)}</td>
                        </tr>
                        {rowOpen && (
                          <tr>
                            <td colSpan={4} className="border-b border-(--color-line) bg-(--color-surface-muted) px-9 py-3">
                              <dl className="grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2 xl:grid-cols-4">
                                <Item k="№ пп" v={r.no} />
                                <Item k="Дата документа" v={fmtDate(r.docDate)} />
                                <Item k="Дата обработки" v={fmtDate(r.procDate)} />
                                <Item k="№ док" v={r.docNo} />
                                <Item k="Наименование счёта" v={r.accountName} wide />
                                <Item k="ИНН" v={r.inn} />
                                <Item k="№ счёта" v={r.account} />
                                <Item k="МФО" v={r.mfo} />
                                <Item k="Обороты по дебету" v={formatTiyin(r.debitTiyin, { decimals: 2 })} />
                                <Item k="Обороты по кредиту" v={formatTiyin(r.creditTiyin, { decimals: 2 })} />
                                <Item k="Назначение платежа (faylda)" v={r.purpose} wide />
                                <Item k="Xarajatda yozilgan izoh" v={r.description} wide />
                              </dl>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot className="sticky bottom-0 bg-(--color-surface-muted)">
          <tr>
            <td className="px-3 py-2 text-xs font-semibold text-heading">JAMI · {count} ta to&apos;lov</td>
            <td />
            <td className="hidden lg:table-cell" />
            <td className="money px-3 py-2 text-right font-bold text-(--color-expense)">{formatTiyin(total.toString())}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Item({ k, v, wide }: { k: string; v: string; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <dt className="text-(--color-text-muted)">{k}</dt>
      <dd className="money break-words text-heading">{v || '—'}</dd>
    </div>
  );
}