'use client';

import { useState, useRef, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { errorMessage } from '@/lib/error-message';
import { ApiError } from '@/lib/api';
import {
  payrollApi,
  downloadTemplate,
  analyzeFile,
  downloadMissing,
  type AnalyzeResult,
} from '@/features/payroll/api';
import { currentPeriod, formatPeriod, formatTiyin, formatDateTime } from '@/lib/format';

import { PageHeader } from '@/components/layout/page-header';
import { Tabs } from '@/components/ui/tabs';
import { PeriodPicker } from '@/components/shared/period-picker';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { Table, THead, TBody, TFoot, Tr, Th, Td } from '@/components/ui/table';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  IconDownload,
  IconUpload,
  IconAlert,
  IconSpinner,
} from '@/components/ui/icons';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/xarajatlar', label: "Ro'yxat" },
  { href: '/xarajatlar/tahlil', label: 'Tahlil' },
  { href: '/xarajatlar/ish-haqi', label: 'Ish haqi' },
];

export default function PayrollPage() {
  const { isAdmin } = useAuth();

  const [period, setPeriod] = useState(currentPeriod());
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [replacePrevious, setReplacePrevious] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(
    null,
  );

  const inputRef = useRef<HTMLInputElement>(null);

  const batches = useAsync(() => payrollApi.batches(period), [period]);

  const reset = useCallback(() => {
    setAnalysis(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  async function handleTemplate() {
    setDownloading(true);
    try {
      await downloadTemplate(period);
    } catch {
      setToast({ message: 'Shablonni yuklab bo\u2018lmadi', tone: 'error' });
    } finally {
      setDownloading(false);
    }
  }

  async function handleFile(file: File) {
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setToast({ message: 'Faqat Excel fayl yuklang', tone: 'error' });
      return;
    }

    setUploading(true);
    setAnalysis(null);

    try {
      const result = await analyzeFile(period, file);
      setAnalysis(result);
    } catch (err) {
      setToast({
        message: errorMessage(err),
        tone: 'error',
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleCommit() {
    if (!analysis) return;

    setCommitting(true);

    try {
      const result = await payrollApi.commit(analysis.batchId, replacePrevious);
      setToast({
        message: `${result.data.expensesCreated} ta xarajat yozuvi yaratildi`,
        tone: 'success',
      });
      reset();
      batches.reload();
    } catch (err) {
      setToast({
        message: errorMessage(err, 'Tasdiqlashda xatolik'),
        tone: 'error',
      });
    } finally {
      setCommitting(false);
      setConfirmOpen(false);
    }
  }

  async function handleCancel() {
    if (!analysis) return;

    try {
      await payrollApi.cancel(analysis.batchId);
      reset();
      batches.reload();
    } catch {
      setToast({ message: 'Bekor qilishda xatolik', tone: 'error' });
    }
  }

  return (
    <>
      <PageHeader title="Xarajatlar" description={`Ish haqi \u00B7 ${formatPeriod(period)}`} />

      <Tabs items={tabs} className="bg-white px-6" />

      <div className="space-y-4 p-6">
        {/* Davr va shablon */}
        <div className="flex flex-wrap items-center gap-3">
          <PeriodPicker
            value={period}
            onChange={(value) => {
              setPeriod(value);
              reset();
            }}
          />

          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleTemplate()}
            loading={downloading}
          >
            <IconDownload className="size-4" />
            Shablon yuklab olish
          </Button>
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
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[--radius-card] border-2 border-dashed px-6 py-12 transition-colors',
                  dragging
                    ? 'border-brand-600 bg-brand-50'
                    : 'border-[--color-line-strong] hover:border-brand-400 hover:bg-[--color-surface-muted]',
                )}
              >
                {uploading ? (
                  <>
                    <IconSpinner className="size-8 animate-spin text-brand-700" />
                    <p className="text-sm text-[--color-text-muted]">
                      Fayl tahlil qilinmoqda&hellip;
                    </p>
                  </>
                ) : (
                  <>
                    <IconUpload className="size-8 text-[--color-text-faint]" strokeWidth={1.5} />
                    <p className="text-sm font-medium text-[--color-text]">
                      Excel faylni shu yerga tashlang
                    </p>
                    <p className="text-xs text-[--color-text-muted]">
                      yoki bosib tanlang &middot; PINFL va summa ustunlari yetarli
                    </p>
                  </>
                )}

                <input
                  ref={inputRef}
                  type="file"
                  accept=".xlsx,.xls"
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

        {/* Tahlil natijasi */}
        {analysis && (
          <AnalysisView
            analysis={analysis}
            replacePrevious={replacePrevious}
            onReplaceChange={setReplacePrevious}
            onCommit={() => setConfirmOpen(true)}
            onCancel={() => void handleCancel()}
            committing={committing}
          />
        )}

        {/* Tarix */}
        <Card className="overflow-hidden">
          <CardHeader title="Yuklashlar tarixi" description={formatPeriod(period)} />

          {batches.loading ? (
            <LoadingState />
          ) : (batches.data?.data.length ?? 0) === 0 ? (
            <EmptyState title="Bu davrda yuklash yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Fayl</Th>
                  <Th className="w-32">Holat</Th>
                  <Th align="center" className="w-24">
                    Qatorlar
                  </Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                  <Th className="w-44">Yuklagan</Th>
                </Tr>
              </THead>

              <TBody>
                {batches.data?.data.map((batch) => (
                  <Tr key={batch.id}>
                    <Td>
                      <span className="truncate">{batch.fileName}</span>
                      <p className="text-xs text-[--color-text-muted]">
                        {formatDateTime(batch.createdAt)}
                      </p>
                    </Td>

                    <Td>
                      <Badge
                        tone={
                          batch.status === 'COMMITTED'
                            ? 'income'
                            : batch.status === 'DRAFT'
                              ? 'warn'
                              : 'neutral'
                        }
                      >
                        {batch.status === 'COMMITTED'
                          ? 'Tasdiqlangan'
                          : batch.status === 'DRAFT'
                            ? 'Qoralama'
                            : 'Bekor qilingan'}
                      </Badge>
                    </Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {batch.matchedRows}
                      {batch.missingRows > 0 && (
                        <span className="text-[--color-expense]">
                          {' '}
                          / {batch.missingRows}
                        </span>
                      )}
                    </Td>

                    <Td money>
                      <Money tiyin={batch.totalTiyin} tone="expense" />
                    </Td>

                    <Td className="text-[--color-text-muted]">
                      {batch.uploadedBy.fullName}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Yuklashni tasdiqlash"
        message={
          analysis?.hasPrevious && replacePrevious
            ? `Eski xarajatlar bekor qilinadi va ${analysis?.groups.length ?? 0} ta yangi yozuv yaratiladi.`
            : `${analysis?.groups.length ?? 0} ta xarajat yozuvi yaratiladi. Davom etamizmi?`
        }
        confirmLabel="Tasdiqlash"
        danger={analysis?.hasPrevious && replacePrevious}
        loading={committing}
        onConfirm={() => void handleCommit()}
        onCancel={() => setConfirmOpen(false)}
      />

      {toast && (
        <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
      )}
    </>
  );
}

// ─────────── Tahlil natijasi ───────────

function AnalysisView({
  analysis,
  replacePrevious,
  onReplaceChange,
  onCommit,
  onCancel,
  committing,
}: {
  analysis: AnalyzeResult;
  replacePrevious: boolean;
  onReplaceChange: (value: boolean) => void;
  onCommit: () => void;
  onCancel: () => void;
  committing: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Yig'indi */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryBox label="Jami qator" value={String(analysis.totalRows)} />
        <SummaryBox label="Topildi" value={String(analysis.matchedRows)} tone="income" />
        <SummaryBox
          label="Topilmadi"
          value={String(analysis.missingRows)}
          tone={analysis.missingRows > 0 ? 'expense' : 'neutral'}
        />
        <SummaryBox
          label="Jami summa"
          value={formatTiyin(analysis.totalTiyin)}
          money
        />
      </div>

      {/* Ogohlantirishlar */}
      {analysis.hasPrevious && (
        <div className="rounded-[--radius-card] border border-[--color-warn] bg-[--color-warn-soft] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <IconAlert className="mt-0.5 size-4 shrink-0 text-[--color-warn]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[--color-warn]">
                Bu davr uchun oldin yuklash tasdiqlangan
              </p>
              <p className="mt-0.5 text-xs text-[--color-text-muted]">
                Nima qilishni tanlang
              </p>

              <div className="mt-3 space-y-2">
                <label className="flex cursor-pointer items-start gap-2.5 rounded-[--radius-control] bg-white px-3 py-2.5">
                  <input
                    type="radio"
                    checked={!replacePrevious}
                    onChange={() => onReplaceChange(false)}
                    className="mt-0.5 size-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">Qo&rsquo;shish</span>
                    <span className="block text-xs text-[--color-text-muted]">
                      Eski xarajatlar joyida qoladi, yangilari ustiga qo&rsquo;shiladi
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-2.5 rounded-[--radius-control] bg-white px-3 py-2.5">
                  <input
                    type="radio"
                    checked={replacePrevious}
                    onChange={() => onReplaceChange(true)}
                    className="mt-0.5 size-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">Almashtirish</span>
                    <span className="block text-xs text-[--color-text-muted]">
                      Eski xarajatlar bekor qilinadi, faqat yangilari qoladi
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {analysis.missing.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title={`Reestrda topilmadi \u2014 ${analysis.missing.length} ta`}
            description="Bu PINFL lar xodimlar ro'yxatida yo'q. Ular hisobga olinmaydi."
            actions={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void downloadMissing(analysis.batchId)}
              >
                <IconDownload className="size-4" />
                Excel
              </Button>
            }
          />
          <CardBody className="max-h-48 overflow-y-auto">
            <div className="flex flex-wrap gap-2">
              {analysis.missing.map((row) => (
                <span
                  key={`${row.rowIndex}-${row.pinfl}`}
                  className="money rounded bg-[--color-expense-soft] px-2 py-1 text-xs text-[--color-expense]"
                >
                  {row.pinfl}
                  <span className="ml-1.5 opacity-60">{row.rowIndex}-qator</span>
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {analysis.invalidRows.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title={`Xato qatorlar \u2014 ${analysis.invalidRows.length} ta`}
          />
          <CardBody className="max-h-40 overflow-y-auto">
            <ul className="space-y-1 text-sm text-[--color-text-muted]">
              {analysis.invalidRows.map((row) => (
                <li key={row.rowIndex}>
                  <span className="money">{row.rowIndex}-qator</span> &mdash; {row.reason}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {/* Shakllanadigan xarajatlar */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Shakllanadigan xarajatlar"
          description="Tasdiqlangandan keyin shu yozuvlar yaratiladi"
        />

        <Table>
          <THead>
            <Tr>
              <Th>Guruh</Th>
              <Th align="center" className="w-28">
                Xodimlar
              </Th>
              <Th align="right" className="w-44">
                Summa
              </Th>
            </Tr>
          </THead>

          <TBody>
            {analysis.groups.map((group) => (
              <Tr key={group.label}>
                <Td>{group.label}</Td>
                <Td align="center" className="money text-[--color-text-muted]">
                  {group.count}
                </Td>
                <Td money>
                  <Money tiyin={group.totalTiyin} tone="expense" />
                </Td>
              </Tr>
            ))}
          </TBody>

          <TFoot>
            <Tr>
              <Td colSpan={2}>Jami</Td>
              <Td money>
                <Money
                  tiyin={analysis.totalTiyin}
                  tone="expense"
                  className="font-semibold"
                />
              </Td>
            </Tr>
          </TFoot>
        </Table>
      </Card>

      {/* Amallar */}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={committing}>
          Bekor qilish
        </Button>
        <Button onClick={onCommit} loading={committing}>
          Tasdiqlash va saqlash
        </Button>
      </div>
    </div>
  );
}

function SummaryBox({
  label,
  value,
  tone = 'neutral',
  money,
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'income' | 'expense';
  money?: boolean;
}) {
  const colors = {
    neutral: 'text-[--color-text]',
    income: 'text-[--color-income]',
    expense: 'text-[--color-expense]',
  };

  return (
    <div className="rounded-[--radius-card] border border-[--color-line] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
        {label}
      </p>
      <p className={cn('money mt-2 text-xl font-semibold', colors[tone])}>{value}</p>
    </div>
  );
}
