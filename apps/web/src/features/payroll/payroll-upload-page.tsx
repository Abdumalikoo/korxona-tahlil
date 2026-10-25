'use client';

import { useMonthChange, usePeriod } from '@/lib/period';
import { SourceActions } from '@/components/shared/source-actions';
import { downloadTemplate, payrollApi, type PayrollBatch } from '@/features/payroll/api';
import { planApi, type PlanAnalysis, type PlanInputRow } from '@/features/payroll/plan-api';
import { PlanView } from '@/features/payroll/plan-view';
import { NdflSummaryCard } from '@/features/payroll/ndfl-summary';
import { compositionApi, type CheckSummary } from '@/features/salary-composition/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import Link from 'next/link';
import { useRef, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconCheck, IconSpinner, IconUpload } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { SectionTabs } from '@/features/sections/section-tabs';
import { Toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';


type ToastState = { message: string; tone: 'success' | 'error' } | null;

/**
 * Umumiy ish haqi yuklash sahifasi — ikki ko'rinishda:
 *  • vedomost — PINFL + summa shabloni (soliq hisoboti fayli tashlansa ham taniydi);
 *  • ndfl — «Soliq hisoboti»: JShDS hisob-kitobining 4-ilovasi (oylik) va 5-ilovasi (boshqa daromadlar) to'g'ridan-to'g'ri;
 *    faqat «hisobot davrida» ustunlari olinadi, ikkala ilova PINFL bo'yicha qo'shiladi.
 * Keyingi qadamlar bir xil: bo'limlarga taqsimot (PlanView), saqlash, tarix.
 */
export function PayrollUploadPage({ mode }: { mode: 'vedomost' | 'ndfl' }) {
  const { isAdmin } = useAuth();
  const ndflMode = mode === 'ndfl';


  /** Oy — yuqori paneldagi umumiy «Davr» tugmasidan (oy ko'rinishi) */
  const { month: period } = usePeriod();
  const [analysis, setAnalysis] = useState<PlanAnalysis | null>(null);
  const [replacePrevious, setReplacePrevious] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<PayrollBatch | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [toast, setToast] = useState<ToastState>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const batches = useAsync(() => payrollApi.batches(period), [period]);
  /** Ish haqi tarkibi shu oy soliq hisobotiga mosmi */
  const composition = useAsync(() => compositionApi.check(period), [period]);

  function reset() {
    setAnalysis(null);
    setReplacePrevious(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleTemplate() {
    setDownloading(true);
    try {
      await downloadTemplate(period);
    } catch (err) {
      setToast({ message: errorMessage(err, 'Shablonni yuklab bo\u2018lmadi'), tone: 'error' });
    } finally {
      setDownloading(false);
    }
  }

  async function handleFile(file: File) {
    if (!/\.(xlsx|xltx|xls)$/i.test(file.name)) {
      setToast({ message: 'Faqat Excel fayl yuklang', tone: 'error' });
      return;
    }

    setUploading(true);
    setAnalysis(null);

    try {
      setAnalysis(await planApi.analyze(period, file, ndflMode ? 'ndfl' : 'auto'));
    } catch (err) {
      setToast({ message: errorMessage(err, 'Faylni o\u2018qib bo\u2018lmadi'), tone: 'error' });
    } finally {
      setUploading(false);
    }
  }

  /** Saqlash: umumiy qism — umumiy vedomost, bo'lim xodimlari — o'z bo'limi ish haqiga */
  async function handleSave(rows: PlanInputRow[]) {
    if (!analysis) return;

    setSaving(true);

    try {
      const data = (await planApi.commit(period, rows, analysis.fileName, replacePrevious)).data;
      const parts = [
        data.general ? `umumiy vedomostga ${data.general.employees} xodim (${data.general.expensesCreated} ta xarajat)` : null,
        ...data.units.map((u) => `${u.label}ga ${u.employees} xodim`),
      ].filter(Boolean);
      setToast({
        message:
          `Saqlandi: ${parts.join(', ')}` +
          (data.locked ? ` · ${data.locked} tasi bo'limlarda avval yuklangan — olinmadi` : '') +
          (data.skipped ? ` · ${data.skipped} tasi olinmadi` : '') +
          (data.moved ? ` · ${data.moved} tasining bo'limi o'zgartirildi` : ''),
        tone: 'success',
      });

      reset();
      batches.reload();
      composition.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Saqlashda xatolik'), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function handleCancelBatch() {
    if (!cancelTarget) return;

    setCancelling(true);

    try {
      await payrollApi.cancel(cancelTarget.id);
      setToast({ message: "Yuklash bekor qilindi, xarajatlar savatga tushdi (undan bo'limlarga yozilganlari ham)", tone: 'success' });
      batches.reload();
      composition.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Bekor qilishda xatolik'), tone: 'error' });
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  }

  // Oy almashganda: yuklash oynasi va tanlovlar tozalanadi
  useMonthChange(period, () => {
    reset();
  });

  return (
    <>
      <PageHeader
        title="Xarajatlar"
        description={`${ndflMode ? 'Soliq hisoboti' : 'Ish haqi'} \u00B7 ${formatPeriod(period)}`}
      />

      <SectionTabs kind="expense" section="DOIMIY" />

      <div className="space-y-4 p-6">
        {/* Amallar — hamma Manba sahifasida bir xil joyda */}
        <SourceActions
          upload={{
            label: ndflMode ? 'Soliq hisobotini yuklash' : 'Vedomostni yuklash',
            onClick: () => inputRef.current?.click(),
            loading: uploading,
            disabled: Boolean(analysis),
            hint: analysis ? 'Avval joriy tahlilni saqlang yoki bekor qiling' : ndflMode ? "JShDS hisob-kitobi: 4-ilova (oylik) va 5-ilova (boshqa daromadlar)" : 'Ish haqi vedomosti (Excel)',
          }}
          template={ndflMode ? undefined : { label: 'Shablon', onClick: () => void handleTemplate(), loading: downloading }}
          deleteData={{ target: 'PAYROLL', month: period, place: 'Xarajatlar › Ish haqi', onDone: () => batches.reload() }}
          note={<>Oy: <b className="text-heading">{formatPeriod(period)}</b> (yuqori paneldagi «Davr»). Faylni pastdagi maydonga tashlash ham mumkin.</>}
        />

        <div className="flex flex-wrap items-center gap-3">
          <CompositionStatus
            check={composition.data?.data ?? null}
            loading={composition.loading}
            period={period}
          />
        </div>

        {/* Yuklash zonasi */}
        {isAdmin && !analysis && (
          <Card>
            <CardBody>
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files[0];
                  if (file) void handleFile(file);
                }}
                onClick={() => inputRef.current?.click()}
                className={cn(
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-(--radius-card) border-2 border-dashed px-6 py-12 transition-colors',
                  dragging
                    ? 'border-brand-600 bg-brand-50'
                    : 'border-(--color-line-strong) hover:border-brand-400 hover:bg-(--color-surface-muted)',
                )}
              >
                {uploading ? (
                  <>
                    <IconSpinner className="size-8 animate-spin text-brand-700" />
                    <p className="text-sm text-(--color-text-muted)">O&rsquo;qilmoqda&hellip;</p>
                  </>
                ) : (
                  <>
                    <IconUpload className="size-8 text-(--color-text-faint)" strokeWidth={1.5} />
                    <p className="text-sm font-medium">{ndflMode ? 'Soliq hisoboti faylini shu yerga tashlang' : 'Excel faylni shu yerga tashlang'}</p>
                    {ndflMode ? (
                      <p className="max-w-xl text-center text-xs text-(--color-text-muted)">
                        yoki bosib tanlang &middot; 4-ilova (oylik) va 5-ilova (ta&apos;til puli va boshqa daromadlar) o&apos;qiladi.
                        Faqat &laquo;hisobot davrida hisoblangan&raquo; summa olinadi (&laquo;jami&raquo; &mdash; yil boshidan o&apos;sib boruvchi, olinmaydi).
                        Ikkala ilovadagi summa PINFL bo&apos;yicha qo&apos;shiladi.
                      </p>
                    ) : (
                      <p className="text-xs text-(--color-text-muted)">
                        yoki bosib tanlang &middot; PINFL va summa (yoki soliq hisobotining o&apos;zi). Summa bo&rsquo;sh yoki 0 &mdash;
                        &ldquo;hisoblanmagan&rdquo;
                      </p>
                    )}
                  </>
                )}

                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xltx,.xls"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
              </div>
            </CardBody>
          </Card>
        )}

        {/* Soliq hisoboti: varaqlar bo'yicha nima o'qildi */}
        {analysis?.ndfl && <NdflSummaryCard ndfl={analysis.ndfl} period={period} />}

        {/* Tahlil natijasi */}
        {analysis && (
          <PlanView
            analysis={analysis}
            period={period}
            replacePrevious={replacePrevious}
            onReplaceChange={setReplacePrevious}
            onSave={(rows) => void handleSave(rows)}
            onCancel={reset}
            saving={saving}
            onError={(message) => setToast({ message, tone: 'error' })}
          />
        )}

        {/* Tarix */}
        <Card className="overflow-hidden">
          <CardHeader title="Yuklashlar tarixi" description={formatPeriod(period)} />

          {batches.loading ? (
            <LoadingState />
          ) : (batches.data?.data.length ?? 0) === 0 ? (
            <EmptyState title="Bu davrda yuklash yo'q" hint="upload" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Fayl</Th>
                  <Th className="w-32">Holat</Th>
                  <Th align="center" className="w-24">
                    Xodim
                  </Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                  <Th className="w-40">Yuklagan</Th>
                  <Th className="w-28" />
                </Tr>
              </THead>

              <TBody>
                {batches.data?.data.map((batch) => (
                  <Tr key={batch.id} className={cn(batch.status === 'CANCELLED' && 'opacity-50')}>
                    <Td>
                      <span className="truncate">{batch.fileName}</span>
                      <p className="text-xs text-(--color-text-muted)">
                        {formatDateTime(batch.createdAt)}
                      </p>
                    </Td>

                    <Td>
                      <Badge tone={batch.status === 'COMMITTED' ? 'income' : 'neutral'}>
                        {batch.status === 'COMMITTED' ? 'Saqlangan' : 'Bekor qilingan'}
                      </Badge>
                    </Td>

                    <Td align="center" className="money text-(--color-text-muted)">
                      {batch._count?.entries ?? batch.matchedRows}
                    </Td>

                    <Td money>
                      <Money tiyin={batch.totalTiyin} tone="expense" />
                    </Td>

                    <Td className="text-(--color-text-muted)">{batch.uploadedBy.fullName}</Td>

                    <Td>
                      {isAdmin && batch.status === 'COMMITTED' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCancelTarget(batch)}
                          className="text-(--color-text-muted) hover:text-(--color-expense)"
                        >
                          Bekor qilish
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Yuklashni bekor qilish"
        message={`${cancelTarget?.fileName ?? ''} bekor qilinadi. Undan yaratilgan xarajatlar (shu yuklashdan bo'limlarga yozilgan ish haqi ham) savatga tushadi.`}
        confirmLabel="Bekor qilish"
        danger
        loading={cancelling}
        onConfirm={() => void handleCancelBatch()}
        onCancel={() => setCancelTarget(null)}
      />

      {toast && (
        <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
      )}
    </>
  );
}

// ─────── Ish haqi tarkibi holati ───────

/** Tanlangan oy tarkibi soliq hisobotiga mosmi — bosilsa Tarkib tabiga o'tadi */
function CompositionStatus({
  check,
  loading,
  period,
}: {
  check: CheckSummary | null;
  loading: boolean;
  period: string;
}) {
  if (loading || !check) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 px-2 text-xs text-(--color-text-faint)">
        <IconSpinner className="size-3.5 animate-spin" />
        Tarkib tekshirilmoqda
      </span>
    );
  }

  const config = {
    MATCHED: {
      label: 'Tarkib mos',
      className: 'border-(--color-income) bg-(--color-income-soft) text-(--color-income)',
      icon: 'check' as const,
    },
    MISMATCH: {
      label: `Tarkib mos emas \u00B7 ${check.mismatchCount} ta farq`,
      className: 'border-(--color-expense) bg-(--color-expense-soft) text-(--color-expense)',
      icon: 'alert' as const,
    },
    NO_PAYROLL: {
      label: 'Tarkib bor, soliq hisoboti yo\u2018q',
      className: 'border-(--color-warn) bg-(--color-warn-soft) text-(--color-warn)',
      icon: 'alert' as const,
    },
    NOT_UPLOADED: {
      label: 'Tarkib yuklanmagan',
      className:
        'border-(--color-line-strong) bg-white text-(--color-text-muted) hover:text-(--color-text)',
      icon: 'none' as const,
    },
  }[check.state];

  return (
    <Link
      href={`/xarajatlar/tarkib?period=${period}`}
      title="Ish haqi tarkibi bo‘limiga o‘tish"
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-(--radius-control) border px-3 text-xs font-medium transition-opacity hover:opacity-80',
        config.className,
      )}
    >
      {config.icon === 'check' && <IconCheck className="size-3.5" />}
      {config.icon === 'alert' && <IconAlert className="size-3.5" />}
      {config.icon === 'none' && <span className="size-2 rounded-full bg-(--color-line-strong)" />}
      {config.label}
    </Link>
  );
}