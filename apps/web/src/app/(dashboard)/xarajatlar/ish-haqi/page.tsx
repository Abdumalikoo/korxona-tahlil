'use client';

import {
  analyzeFile,
  downloadMissing,
  downloadTemplate,
  payrollApi,
  type AnalyzeResult,
  type PayrollBatch,
} from '@/features/payroll/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import { currentPeriod, formatDateTime, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useRef, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/shared/period-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconDownload, IconSpinner, IconUpload } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { Toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/xarajatlar', label: "Ro'yxat" },
  { href: '/xarajatlar/tahlil', label: 'Tahlil' },
  { href: '/xarajatlar/ish-haqi', label: 'Ish haqi' },
];

type ToastState = { message: string; tone: 'success' | 'error' } | null;

export default function PayrollPage() {
  const { isAdmin } = useAuth();

  const [period, setPeriod] = useState(currentPeriod());
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
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
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setToast({ message: 'Faqat Excel fayl yuklang', tone: 'error' });
      return;
    }

    setUploading(true);
    setAnalysis(null);

    try {
      setAnalysis(await analyzeFile(period, file));
    } catch (err) {
      setToast({ message: errorMessage(err, 'Faylni o\u2018qib bo\u2018lmadi'), tone: 'error' });
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!analysis) return;

    setSaving(true);

    try {
      const result = await payrollApi.commit(
        period,
        { rows: analysis.rows, fileName: analysis.fileName, missing: analysis.missing },
        replacePrevious,
      );

      const data = result.data;
      setToast({
        message:
          `${data.employees} xodim saqlandi, ${data.expensesCreated} ta xarajat yaratildi` +
          (data.zeroCount > 0 ? ` \u00B7 ${data.zeroCount} tasiga hisoblanmagan` : ''),
        tone: 'success',
      });

      reset();
      batches.reload();
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
      setToast({ message: 'Yuklash bekor qilindi, xarajatlar savatga tushdi', tone: 'success' });
      batches.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Bekor qilishda xatolik'), tone: 'error' });
    } finally {
      setCancelling(false);
      setCancelTarget(null);
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
            Shablon
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
                    <p className="text-sm text-[--color-text-muted]">O&rsquo;qilmoqda&hellip;</p>
                  </>
                ) : (
                  <>
                    <IconUpload className="size-8 text-[--color-text-faint]" strokeWidth={1.5} />
                    <p className="text-sm font-medium">Excel faylni shu yerga tashlang</p>
                    <p className="text-xs text-[--color-text-muted]">
                      yoki bosib tanlang &middot; PINFL va summa. Summa bo&rsquo;sh yoki 0 &mdash;
                      &ldquo;hisoblanmagan&rdquo;
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
            period={period}
            replacePrevious={replacePrevious}
            onReplaceChange={setReplacePrevious}
            onSave={() => void handleSave()}
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
            <EmptyState title="Bu davrda yuklash yo'q" />
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
                      <p className="text-xs text-[--color-text-muted]">
                        {formatDateTime(batch.createdAt)}
                      </p>
                    </Td>

                    <Td>
                      <Badge tone={batch.status === 'COMMITTED' ? 'income' : 'neutral'}>
                        {batch.status === 'COMMITTED' ? 'Saqlangan' : 'Bekor qilingan'}
                      </Badge>
                    </Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {batch._count?.entries ?? batch.matchedRows}
                    </Td>

                    <Td money>
                      <Money tiyin={batch.totalTiyin} tone="expense" />
                    </Td>

                    <Td className="text-[--color-text-muted]">{batch.uploadedBy.fullName}</Td>

                    <Td>
                      {isAdmin && batch.status === 'COMMITTED' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setCancelTarget(batch)}
                          className="text-[--color-text-muted] hover:text-[--color-expense]"
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
        message={`${cancelTarget?.fileName ?? ''} bekor qilinadi. Undan yaratilgan xarajatlar savatga tushadi.`}
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

// ─────── Tahlil natijasi ───────

function AnalysisView({
  analysis,
  period,
  replacePrevious,
  onReplaceChange,
  onSave,
  onCancel,
  saving,
  onError,
}: {
  analysis: AnalyzeResult;
  period: string;
  replacePrevious: boolean;
  onReplaceChange: (value: boolean) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  onError: (message: string) => void;
}) {
  const [showZero, setShowZero] = useState(false);

  async function handleMissing() {
    try {
      await downloadMissing(period, analysis.missing);
    } catch (err) {
      onError(errorMessage(err, 'Faylni yuklab bo\u2018lmadi'));
    }
  }

  return (
    <div className="space-y-4">
      {/* Yig'indi */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryBox label="Topildi" value={String(analysis.matchedRows)} />
        <SummaryBox label="Hisoblangan" value={String(analysis.paidRows)} tone="income" />
        <SummaryBox
          label="Hisoblanmagan"
          value={String(analysis.zeroRows)}
          tone={analysis.zeroRows > 0 ? 'warn' : 'neutral'}
        />
        <SummaryBox
          label="Topilmadi"
          value={String(analysis.missingRows)}
          tone={analysis.missingRows > 0 ? 'expense' : 'neutral'}
        />
        <SummaryBox label="Jami summa" value={formatTiyin(analysis.totalTiyin)} />
      </div>

      {/* Hisoblanmaganlar */}
      {analysis.zeroEmployees.length > 0 && (
        <div className="rounded-[--radius-card] border border-[--color-warn] bg-[--color-warn-soft] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <IconAlert className="mt-0.5 size-4 shrink-0 text-[--color-warn]" />

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-[--color-warn]">
                  {analysis.zeroEmployees.length} ta xodimga ish haqi hisoblanmagan
                </p>

                <button
                  type="button"
                  onClick={() => setShowZero((state) => !state)}
                  className="text-xs font-medium text-[--color-text-muted] hover:text-[--color-text]"
                >
                  {showZero ? 'Yashirish' : 'Ro\u2018yxatni ko\u2018rish'}
                </button>
              </div>

              <p className="mt-0.5 text-xs text-[--color-text-muted]">
                Ular saqlanadi va tahlilda &ldquo;hisoblanmagan&rdquo; deb ko&rsquo;rinadi
              </p>

              {showZero && (
                <div className="mt-3 max-h-60 space-y-1 overflow-y-auto">
                  {analysis.zeroEmployees.map((employee) => (
                    <div
                      key={employee.pinfl}
                      className="flex items-center justify-between gap-3 rounded-[--radius-control] bg-white px-3 py-1.5 text-xs"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {employee.fullName}
                      </span>
                      <span className="shrink-0 text-[--color-text-muted]">{employee.place}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Topilmaganlar */}
      {analysis.missing.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title={`Reestrda topilmadi \u2014 ${analysis.missing.length} ta`}
            description="Bu PINFL lar xodimlar ro'yxatida yo'q va saqlanmaydi"
            actions={
              <Button variant="secondary" size="sm" onClick={() => void handleMissing()}>
                <IconDownload className="size-4" />
                Excel
              </Button>
            }
          />
          <CardBody className="max-h-40 overflow-y-auto">
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

      {/* Xato qatorlar */}
      {analysis.invalidRows.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title={`Xato qatorlar \u2014 ${analysis.invalidRows.length} ta`}
            description="O'tkazib yuboriladi"
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

      {/* Takroriy PINFL */}
      {analysis.duplicates.length > 0 && (
        <p className="text-xs text-[--color-text-muted]">
          {analysis.duplicates.length} ta xodim faylda bir necha marta uchradi &mdash; summalari
          qo&rsquo;shildi.
        </p>
      )}

      {/* Oldingi yuklash */}
      {analysis.hasPrevious && (
        <div className="rounded-[--radius-card] border border-[--color-warn] bg-[--color-warn-soft] px-4 py-3">
          <p className="text-sm font-medium text-[--color-warn]">
            Bu oy uchun {analysis.previousCount} ta yuklash allaqachon saqlangan
          </p>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <ChoiceCard
              checked={!replacePrevious}
              onChange={() => onReplaceChange(false)}
              title="Qo'shish"
              description="Eski yuklash qoladi, bu ham qo'shiladi (masalan mukofot)"
            />
            <ChoiceCard
              checked={replacePrevious}
              onChange={() => onReplaceChange(true)}
              title="Almashtirish"
              description="Eski yuklash bekor qilinadi, faqat bu qoladi"
            />
          </div>
        </div>
      )}

      {/* Guruhlar */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Shakllanadigan xarajatlar"
          description="Saqlanganda shu yozuvlar yaratiladi"
        />

        <Table>
          <THead>
            <Tr>
              <Th>Guruh</Th>
              <Th align="center" className="w-24">
                Xodim
              </Th>
              <Th align="center" className="w-32">
                Hisoblanmagan
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
                <Td align="center" className="money">
                  {group.zeroCount > 0 ? (
                    <span className="text-[--color-warn]">{group.zeroCount}</span>
                  ) : (
                    <span className="text-[--color-text-faint]">&mdash;</span>
                  )}
                </Td>
                <Td money>
                  <Money tiyin={group.totalTiyin} tone="expense" />
                </Td>
              </Tr>
            ))}
          </TBody>

          <TFoot>
            <Tr>
              <Td colSpan={3}>Jami</Td>
              <Td money>
                <Money tiyin={analysis.totalTiyin} tone="expense" className="font-semibold" />
              </Td>
            </Tr>
          </TFoot>
        </Table>
      </Card>

      {/* Amallar */}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Boshqa fayl
        </Button>
        <Button onClick={onSave} loading={saving} disabled={analysis.matchedRows === 0}>
          Saqlash
        </Button>
      </div>
    </div>
  );
}

function SummaryBox({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'income' | 'expense' | 'warn';
}) {
  const colors = {
    neutral: 'text-[--color-text]',
    income: 'text-[--color-income]',
    expense: 'text-[--color-expense]',
    warn: 'text-[--color-warn]',
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

function ChoiceCard({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-[--radius-control] border bg-white px-3 py-2.5',
        checked ? 'border-brand-600' : 'border-transparent',
      )}
    >
      <input type="radio" checked={checked} onChange={onChange} className="mt-0.5 size-4" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-[--color-text-muted]">{description}</span>
      </span>
    </label>
  );
}
