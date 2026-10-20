'use client';

import { useMonthChange, usePeriod } from '@/lib/period';
import {
    analyzeCompositionFile,
    compositionApi,
    downloadCompositionExcel,
    downloadCompositionTemplate,
    type CompositionAnalysis,
    type CompositionBatch,
} from '@/features/salary-composition/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useCallback, useRef, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { DeleteDataButton } from '@/components/shared/delete-data';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconDownload, IconSpinner, IconUpload } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';
import { SectionTabs } from '@/features/sections/section-tabs';
import { Toast } from '@/components/ui/toast';

import { AnalysisView } from './_components/analysis-view';
import { CompositionTable } from './_components/composition-table';
import { EmployeeModal } from './_components/employee-modal';
import { CheckLists, CheckSummaryBoxes, StatusBanner, StructureCard } from './_components/shared';


type ToastState = { message: string; tone: 'success' | 'error' } | null;

const STATUS_BADGE: Record<CompositionBatch['status'], { label: string; tone: 'income' | 'expense' | 'warn' }> = {
  MATCHED: { label: 'Mos', tone: 'income' },
  MISMATCH: { label: 'Mos emas', tone: 'expense' },
  NO_PAYROLL: { label: 'Soliq yo‘q', tone: 'warn' },
};

export default function SalaryCompositionPage() {
  const { isAdmin } = useAuth();


  /** Oy — yuqori paneldagi umumiy «Davr» tugmasidan (oy ko'rinishi) */
  const { month: period } = usePeriod();
  const [analysis, setAnalysis] = useState<CompositionAnalysis | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);

  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<CompositionBatch | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [selected, setSelected] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const view = useAsync(() => compositionApi.view(period), [period]);
  const batches = useAsync(() => compositionApi.batches(period), [period]);

  const closeModal = useCallback(() => setSelected(null), []);

  function reset() {
    setAnalysis(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function reloadAll() {
    view.reload();
    batches.reload();
  }

  async function handleTemplate() {
    setDownloading(true);
    try {
      await downloadCompositionTemplate(period);
    } catch (err) {
      setToast({ message: errorMessage(err, 'Shablonni yuklab bo‘lmadi'), tone: 'error' });
    } finally {
      setDownloading(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      await downloadCompositionExcel(period);
    } catch (err) {
      setToast({ message: errorMessage(err, 'Faylni yuklab bo‘lmadi'), tone: 'error' });
    } finally {
      setExporting(false);
    }
  }

  async function handleFile(file: File, sheet?: string) {
    if (!/\.xlsx$/i.test(file.name)) {
      setToast({ message: 'Faqat .xlsx formatidagi Excel fayl yuklang', tone: 'error' });
      return;
    }

    setUploading(true);
    setAnalysis(null);
    setLastFile(file);

    try {
      setAnalysis(await analyzeCompositionFile(period, file, sheet));
    } catch (err) {
      setToast({ message: errorMessage(err, 'Faylni o‘qib bo‘lmadi'), tone: 'error' });
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!analysis) return;
    setSaving(true);

    try {
      const result = await compositionApi.commit(period, analysis.fileName, analysis.rows);
      const data = result.data;

      setToast({
        message:
          `${data.saved} xodim tarkibi saqlandi` +
          (data.status === 'MATCHED'
            ? ' · soliq hisobotiga mos'
            : data.status === 'MISMATCH'
              ? ` · ${data.mismatchCount} ta farq bor`
              : ' · soliq hisoboti yuklanmagan') +
          (data.centerTiyin && data.centerTiyin !== '0'
            ? ` · bayram/choraklik ${formatTiyin(data.centerTiyin, { currency: true })} (${data.centerEmployees ?? 0} hudud xodimi) Markaz hisobiga o'tdi`
            : ''),
        tone: data.status === 'MISMATCH' ? 'error' : 'success',
      });

      reset();
      reloadAll();
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
      await compositionApi.cancel(cancelTarget.id);
      setToast({ message: 'Tarkib bekor qilindi', tone: 'success' });
      reloadAll();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Bekor qilishda xatolik'), tone: 'error' });
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  }

  const data = view.data?.data;
  const hasSaved = !!data?.batch;

  // Oy almashganda: yuklash oynasi va tanlovlar tozalanadi
  useMonthChange(period, () => {
    reset();
  });

  return (
    <>
      <PageHeader
        title="Xarajatlar"
        description={`Ish haqi tarkibi · ${formatPeriod(period)}`}
        actions={
          <DeleteDataButton
            target="COMPOSITION"
            size="sm"
            month={period}
            place="Xarajatlar › Ish haqi tarkibi"
            onDone={({ count }) => {
              setToast({ message: `${count} ta tarkib yuklamasi bekor qilindi (bayram, choraklik ajratmasi ham qaytdi)`, tone: 'success' });
              reloadAll();
            }}
          />
        }
      />

      <SectionTabs kind="expense" section="DOIMIY" />

      <div className="space-y-4 p-6">
        {/* Shablon va eksport (oy — yuqori panelda) */}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleTemplate()}
            loading={downloading}
          >
            <IconDownload className="size-4" />
            Shablon (vedomost shakli)
          </Button>
          <span className="text-xs text-(--color-text-muted)">Buxgalteriyaning «OYLIK» vedomostini o&rsquo;zini ham yuklash mumkin — kerakli oy varag&rsquo;i o&rsquo;zi tanlanadi</span>

          {hasSaved && !analysis && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleExport()}
              loading={exporting}
            >
              <IconDownload className="size-4" />
              Excel hisobot
            </Button>
          )}
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
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-(--radius-card) border-2 border-dashed px-6 transition-colors',
                  hasSaved ? 'py-6' : 'py-12',
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
                    <p className="text-sm font-medium">
                      {hasSaved ? 'Yangi tarkib faylini yuklash' : 'Tarkib faylini shu yerga tashlang'}
                    </p>
                    <p className="text-xs text-(--color-text-muted)">
                      yoki bosib tanlang &middot; shablon yoki buxgalteriya vedomosti («OYLIK MARKAZ …»), .xlsx
                      {hasSaved && ' · saqlansa, joriy tarkib almashtiriladi'}
                    </p>
                  </>
                )}

                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx"
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

        {/* Tahlil yoki saqlangan tarkib */}
        {analysis ? (
          <AnalysisView
            analysis={analysis}
            saving={saving}
            onSheet={lastFile ? (sheet) => void handleFile(lastFile, sheet) : undefined}
            onSave={() => void handleSave()}
            onCancel={reset}
          />
        ) : view.loading ? (
          <Card>
            <LoadingState />
          </Card>
        ) : view.error ? (
          <Card>
            <ErrorState message={view.error} onRetry={view.reload} />
          </Card>
        ) : data ? (
          <>
            <StatusBanner check={data.check} />

            {hasSaved && (
              <>
                <CheckSummaryBoxes check={data.check} />

                <div className="grid gap-4 xl:grid-cols-2">
                  <StructureCard byCategory={data.byCategory} byComponent={data.byComponent} />
                  <div className="space-y-4">
                    {data.check.mismatchCount > 0 || (data.check.outOfScope?.employees ?? 0) > 0 ? (
                      <CheckLists check={data.check} />
                    ) : (
                      <Card>
                        <EmptyState
                          title={
                            data.check.state === 'MATCHED'
                              ? 'Farq yo‘q'
                              : 'Solishtirish uchun soliq hisoboti kerak'
                          }
                          description={
                            data.check.state === 'MATCHED'
                              ? 'Har bir xodimning tarkibi soliq hisobotiga teng'
                              : 'Ish haqi bo‘limida shu oy uchun soliq hisobotini yuklang'
                          }
                        />
                      </Card>
                    )}
                  </div>
                </div>

                <CompositionTable view={data} onSelect={setSelected} />
              </>
            )}
          </>
        ) : null}

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
                    Tarkib
                  </Th>
                  <Th align="right" className="w-40">
                    Soliq hisoboti
                  </Th>
                  <Th className="w-40">Yuklagan</Th>
                  <Th className="w-28" />
                </Tr>
              </THead>

              <TBody>
                {batches.data?.data.map((batch) => {
                  const cancelled = batch.cancelledAt !== null;
                  const badge = STATUS_BADGE[batch.status];

                  return (
                    <Tr key={batch.id} className={cn(cancelled && 'opacity-50')}>
                      <Td>
                        <span className="truncate">{batch.fileName ?? '—'}</span>
                        <p className="text-xs text-(--color-text-muted)">
                          {formatDateTime(batch.createdAt)}
                        </p>
                      </Td>
                      <Td>
                        {cancelled ? (
                          <Badge>Bekor qilingan</Badge>
                        ) : (
                          <Badge tone={badge.tone}>
                            {badge.label}
                            {batch.status === 'MISMATCH' && ` · ${batch.mismatchCount}`}
                          </Badge>
                        )}
                      </Td>
                      <Td align="center" className="money text-(--color-text-muted)">
                        {batch.employeeCount}
                      </Td>
                      <Td money>
                        <Money tiyin={batch.totalTiyin} />
                      </Td>
                      <Td money>
                        <Money tiyin={batch.payrollTiyin} className="text-(--color-text-muted)" />
                      </Td>
                      <Td className="text-(--color-text-muted)">{batch.uploadedBy ?? '—'}</Td>
                      <Td>
                        {isAdmin && !cancelled && (
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
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      {selected && <EmployeeModal pinfl={selected} onClose={closeModal} />}

      <ConfirmDialog
        open={cancelTarget !== null}
        title="Tarkibni bekor qilish"
        message={`${cancelTarget?.fileName ?? 'Tarkib'} bekor qilinadi va xodimlar tarkibi o'chiriladi. Soliq hisobotiga (Ish haqi) ta'sir qilmaydi.`}
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