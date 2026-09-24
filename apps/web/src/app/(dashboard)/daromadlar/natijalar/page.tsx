'use client';

import {
    analyzeResultsFile,
    downloadResultsExcel,
    downloadResultsTemplate,
    EMPLOYMENT_LABELS,
    resultsApi,
    type CommitResult,
    type RegionTotal,
    type ResultBatch,
    type ResultListRow,
    type ResultsAnalysis,
    type ResultTotals,
} from '@/features/results/api';
import { useAuth } from '@/lib/auth-context';
import { errorMessage } from '@/lib/error-message';
import {
    currentPeriod,
    formatDateTime,
    formatPercent,
    formatPeriod,
    formatTiyin,
} from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { useMemo, useRef, useState } from 'react';

import { PageHeader } from '@/components/layout/page-header';
import { PeriodPicker } from '@/components/shared/period-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
    IconAlert,
    IconCheck,
    IconChevronDown,
    IconDownload,
    IconSpinner,
    IconUpload,
} from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { Select } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { Toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

const tabs = [
  { href: '/daromadlar', label: "Ro'yxat" },
  { href: '/daromadlar/tahlil', label: 'Tahlil' },
  { href: '/daromadlar/hududlar', label: 'Hududlar' },
  { href: '/daromadlar/natijalar', label: 'Xodim natijalari' },
];

type ToastState = { message: string; tone: 'success' | 'error' } | null;

/** Bajarilish rangi: <80 qizil, 80–95 sariq, >95 yashil */
function percentColor(percent: number | null): string {
  if (percent == null) return 'text-[--color-text-faint]';
  if (percent < 80) return 'text-[--color-expense]';
  if (percent <= 95) return 'text-[--color-warn]';
  return 'text-[--color-income]';
}

/** Nisbat rangi: maosh tushumdan katta bo'lsa (1 dan kichik) — qizil */
function ratioColor(ratio: number | null): string {
  if (ratio == null) return 'text-[--color-text-faint]';
  if (ratio < 1) return 'text-[--color-expense]';
  return 'text-[--color-text]';
}

function formatRatio(ratio: number | null): string {
  if (ratio == null) return '\u2014';
  return `${ratio.toFixed(2).replace('.', ',')}\u00D7`;
}

export default function EmployeeResultsPage() {
  const { isAdmin } = useAuth();

  const [period, setPeriod] = useState(currentPeriod());
  const [analysis, setAnalysis] = useState<ResultsAnalysis | null>(null);
  const [report, setReport] = useState<CommitResult | null>(null);

  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [regionFilter, setRegionFilter] = useState('');
  const [search, setSearch] = useState('');

  const [cancelTarget, setCancelTarget] = useState<ResultBatch | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const [toast, setToast] = useState<ToastState>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const regionCode = regionFilter === '' ? undefined : Number(regionFilter);

  const list = useAsync(() => resultsApi.list(period, regionCode), [period, regionCode]);
  const batches = useAsync(() => resultsApi.batches(period), [period]);

  const data = list.data?.data;

  const filteredRows = useMemo(() => {
    const rows = data?.rows ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return rows;

    return rows.filter(
      (row) =>
        row.fullName.toLowerCase().includes(query) ||
        row.pinfl.includes(query) ||
        (row.districtName ?? '').toLowerCase().includes(query),
    );
  }, [data, search]);

  function resetUpload() {
    setAnalysis(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleTemplate() {
    setDownloading(true);
    try {
      await downloadResultsTemplate(period);
    } catch (err) {
      setToast({ message: errorMessage(err, 'Shablonni yuklab bo\u2018lmadi'), tone: 'error' });
    } finally {
      setDownloading(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      await downloadResultsExcel(period, regionCode);
    } catch (err) {
      setToast({ message: errorMessage(err, 'Faylni yuklab bo\u2018lmadi'), tone: 'error' });
    } finally {
      setExporting(false);
    }
  }

  async function handleFile(file: File) {
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setToast({ message: 'Faqat Excel fayl yuklang', tone: 'error' });
      return;
    }

    setUploading(true);
    setAnalysis(null);
    setReport(null);

    try {
      setAnalysis(await analyzeResultsFile(period, file));
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
      const result = await resultsApi.commit(period, analysis.fileName, analysis.rows);

      setReport(result.data);
      setToast({ message: `${result.data.saved} ta xodim natijasi saqlandi`, tone: 'success' });

      resetUpload();
      list.reload();
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
      const result = await resultsApi.cancel(cancelTarget.id);
      const moved = result.data.payroll.moved.length;

      setToast({
        message:
          'Yuklash bekor qilindi' +
          (moved > 0 ? ` \u00B7 ish haqi qayta guruhlandi (${moved} xodim)` : ''),
        tone: 'success',
      });

      setReport(null);
      list.reload();
      batches.reload();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Bekor qilishda xatolik'), tone: 'error' });
    } finally {
      setCancelling(false);
      setCancelTarget(null);
    }
  }

  const regionOptions = [
    { value: '', label: 'Barcha hududlar' },
    ...(data?.regions ?? []).map((region) => ({
      value: String(region.regionCode),
      label: region.name,
    })),
  ];

  return (
    <>
      <PageHeader
        title="Daromadlar"
        description={`Xodim natijalari \u00B7 ${formatPeriod(period)}`}
      />

      <Tabs items={tabs} className="bg-white px-6" />

      <div className="space-y-4 p-6">
        <p className="text-xs text-[--color-text-muted]">
          Xodimlar tushirgan tushum &mdash; daromadga qo&rsquo;shilmaydi, hududiy daromadning
          xodimlar kesimi. Shu oy ish haqisi bilan PINFL bo&rsquo;yicha solishtiriladi.
        </p>

        {/* Davr, shablon, eksport */}
        <div className="flex flex-wrap items-center gap-3">
          <PeriodPicker
            value={period}
            onChange={(value) => {
              setPeriod(value);
              setRegionFilter('');
              resetUpload();
              setReport(null);
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

          {data && data.rows.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleExport()}
              loading={exporting}
            >
              <IconDownload className="size-4" />
              Excel{regionCode !== undefined ? ' (hudud)' : ''}
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
                  'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[--radius-card] border-2 border-dashed px-6 py-10 transition-colors',
                  dragging
                    ? 'border-brand-600 bg-brand-50'
                    : 'border-[--color-line-strong] hover:border-brand-400 hover:bg-[--color-surface-muted]',
                )}
              >
                {uploading ? (
                  <>
                    <IconSpinner className="size-8 animate-spin text-brand-700" />
                    <p className="text-sm text-[--color-text-muted]">Tekshirilmoqda&hellip;</p>
                  </>
                ) : (
                  <>
                    <IconUpload className="size-8 text-[--color-text-faint]" strokeWidth={1.5} />
                    <p className="text-sm font-medium">Natijalar faylini shu yerga tashlang</p>
                    <p className="text-xs text-[--color-text-muted]">
                      Hudud va tuman kodi, PINFL, turi (1/2), reja, tushum, ustama
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
            saving={saving}
            onSave={() => void handleSave()}
            onCancel={resetUpload}
          />
        )}

        {/* Saqlash hisoboti */}
        {report && <CommitReport report={report} onClose={() => setReport(null)} />}

        {/* ─────── Saqlangan natijalar ─────── */}
        {list.loading ? (
          <LoadingState />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !data || data.rows.length === 0 ? (
          <Card>
            <EmptyState
              title="Bu oy uchun natijalar yo'q"
              description="Shablonni to'ldirib yuklang"
            />
          </Card>
        ) : (
          <>
            {/* Ish haqi yuklanmagan */}
            {!data.payrollUploaded && (
              <div className="flex items-start gap-2.5 rounded-[--radius-card] border border-[--color-warn] bg-[--color-warn-soft] px-4 py-3">
                <IconAlert className="mt-0.5 size-4 shrink-0 text-[--color-warn]" />
                <div>
                  <p className="text-sm font-medium text-[--color-warn]">
                    {formatPeriod(period)} uchun ish haqi yuklanmagan
                  </p>
                  <p className="mt-0.5 text-xs text-[--color-text-muted]">
                    Solishtirish uchun <b>Xarajatlar &rarr; Ish haqi</b> bo&rsquo;limidan shu oy
                    faylini yuklang &mdash; ustunlar o&rsquo;zi to&rsquo;ladi.
                  </p>
                </div>
              </div>
            )}

            {/* Yig'indi */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryBox label="Xodimlar" value={String(data.rows.length)} />
              <SummaryBox label="Reja" value={formatTiyin(data.totals.planTiyin)} />
              <SummaryBox
                label="Tushum"
                value={formatTiyin(data.totals.factTiyin)}
                className="text-[--color-income]"
              />
              <SummaryBox
                label="Bajarilish"
                value={formatPercent(data.totals.percent)}
                className={percentColor(data.totals.percent)}
              />
              <SummaryBox label="Ustama" value={formatTiyin(data.totals.bonusTiyin)} />
              <SummaryBox
                label="Ish haqi"
                value={data.payrollUploaded ? formatTiyin(data.totals.salaryTiyin) : 'yuklanmagan'}
                className={data.payrollUploaded ? 'text-[--color-expense]' : 'text-[--color-warn]'}
              />
              <SummaryBox
                label="Tushum / ish haqi"
                value={formatRatio(data.totals.ratio)}
                hint="Har 1 so'm maoshga tushum"
                className={ratioColor(data.totals.ratio)}
              />
              <SummaryBox
                label="Ish haqi ulushi"
                value={formatPercent(data.totals.salaryShare)}
                hint="Tushumning maoshga ketgan qismi"
              />
            </div>

            {/* Maosh olgan, natijasi yo'q */}
            <IssueBlock
              tone="warn"
              title="Maosh olgan, lekin natijalar faylida yo'q"
              description="Shu oy ish haqi olgan viloyat xodimlari — markaz xodimlari kirmaydi"
              count={(data.payrollOnly ?? []).length}
            >
              {(data.payrollOnly ?? []).map((item) => (
                <IssueLine
                  key={item.pinfl}
                  left={`${item.fullName} · ${item.place}`}
                  right={formatTiyin(item.salaryTiyin)}
                />
              ))}
            </IssueBlock>

            {/* Hududlar */}
            {regionCode === undefined && (
              <RegionTable
                regions={data.regions}
                totals={data.totals}
                showSalary={data.payrollUploaded}
              />
            )}

            {/* Xodimlar */}
            <Card className="overflow-hidden">
              <CardHeader
                title="Xodimlar"
                description={`${filteredRows.length} ta`}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Ism, PINFL yoki tuman"
                      className="h-9 w-56 rounded-[--radius-control] border border-[--color-line-strong] px-3 text-sm focus:border-brand-600 focus:outline-none"
                    />
                    <div className="w-52">
                      <Select
                        options={regionOptions}
                        value={regionFilter}
                        onChange={(event) => setRegionFilter(event.target.value)}
                        className="h-9"
                      />
                    </div>
                  </div>
                }
              />

              {filteredRows.length === 0 ? (
                <EmptyState title="Topilmadi" />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <THead>
                      <Tr>
                        <Th>Xodim</Th>
                        <Th className="w-48">Hudud / Tuman</Th>
                        <Th className="w-28">Turi</Th>
                        <Th align="right" className="w-32">
                          Reja
                        </Th>
                        <Th align="right" className="w-32">
                          Tushum
                        </Th>
                        <Th align="right" className="w-20">
                          Foiz
                        </Th>
                        <Th align="right" className="w-32">
                          Ustama
                        </Th>
                        <Th align="right" className="w-32 bg-brand-50">
                          Ish haqi
                        </Th>
                        <Th align="right" className="w-24 bg-brand-50">
                          Nisbat
                        </Th>
                        <Th align="right" className="w-20 bg-brand-50">
                          Ulush
                        </Th>
                      </Tr>
                    </THead>

                    <TBody>
                      {filteredRows.map((row) => (
                        <Tr key={row.pinfl}>
                          <Td>
                            <span className="font-medium">{row.fullName}</span>
                            <p className="money text-xs text-[--color-text-faint]">{row.pinfl}</p>
                          </Td>
                          <Td className="text-[--color-text-muted]">
                            {row.regionName}
                            {row.districtName && (
                              <p className="text-xs text-[--color-text-faint]">
                                {row.districtName}
                              </p>
                            )}
                          </Td>
                          <Td>
                            <Badge tone={row.employmentType === 'SHTAT' ? 'neutral' : 'warn'}>
                              {EMPLOYMENT_LABELS[row.employmentType]}
                            </Badge>
                          </Td>
                          <Td money className="text-[--color-text-muted]">
                            <Money tiyin={row.planTiyin} />
                          </Td>
                          <Td money>
                            <Money tiyin={row.factTiyin} tone="income" />
                          </Td>
                          <Td
                            align="right"
                            className={cn('money font-medium', percentColor(row.percent))}
                          >
                            {formatPercent(row.percent)}
                          </Td>
                          <Td money>
                            <Money tiyin={row.bonusTiyin} />
                          </Td>
                          <Td align="right" className="bg-brand-50/40">
                            <SalaryCell row={row} />
                          </Td>
                          <Td
                            align="right"
                            className={cn('money bg-brand-50/40 font-medium', ratioColor(row.ratio))}
                          >
                            {formatRatio(row.ratio)}
                          </Td>
                          <Td align="right" className="money bg-brand-50/40 text-[--color-text-muted]">
                            {row.salaryShare == null ? '\u2014' : formatPercent(row.salaryShare)}
                          </Td>
                        </Tr>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
            </Card>
          </>
        )}

        {/* Tarix */}
        <Card className="overflow-hidden">
          <CardHeader title="Yuklashlar tarixi" description={formatPeriod(period)} />

          {batches.loading ? (
            <LoadingState />
          ) : (batches.data?.data.length ?? 0) === 0 ? (
            <EmptyState title="Bu oy uchun yuklash yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Fayl</Th>
                  <Th className="w-32">Holat</Th>
                  <Th align="center" className="w-24">
                    Xodim
                  </Th>
                  <Th align="center" className="w-32">
                    O&apos;zgargan
                  </Th>
                  <Th align="right" className="w-40">
                    Tushum
                  </Th>
                  <Th className="w-40">Yuklagan</Th>
                  <Th className="w-28" />
                </Tr>
              </THead>

              <TBody>
                {batches.data?.data.map((batch) => (
                  <Tr key={batch.id} className={cn(batch.cancelledAt && 'opacity-50')}>
                    <Td>
                      {batch.fileName}
                      <p className="text-xs text-[--color-text-muted]">
                        {formatDateTime(batch.createdAt)}
                      </p>
                    </Td>
                    <Td>
                      <Badge tone={batch.cancelledAt ? 'neutral' : 'income'}>
                        {batch.cancelledAt ? 'Bekor qilingan' : 'Amalda'}
                      </Badge>
                    </Td>
                    <Td align="center" className="money text-[--color-text-muted]">
                      {batch.totalRows}
                    </Td>
                    <Td align="center" className="money">
                      {batch.movedCount > 0 ? (
                        <span className="text-[--color-warn]">{batch.movedCount}</span>
                      ) : (
                        <span className="text-[--color-text-faint]">&mdash;</span>
                      )}
                    </Td>
                    <Td money>
                      <Money tiyin={batch.factTiyin} tone="income" />
                    </Td>
                    <Td className="text-[--color-text-muted]">{batch.uploadedBy.fullName}</Td>
                    <Td>
                      {isAdmin && !batch.cancelledAt && (
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
        message={`${cancelTarget?.fileName ?? ''} bekor qilinadi. Shu oy hudud tarixi o'chadi va ish haqi reestr bo'yicha qayta guruhlanadi.`}
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

// ═══════════ Ish haqi katagi ═══════════

function SalaryCell({ row }: { row: ResultListRow }) {
  if (row.salaryStatus === 'ok' && row.salaryTiyin !== null) {
    return <Money tiyin={row.salaryTiyin} tone="expense" />;
  }

  const labels: Record<Exclude<ResultListRow['salaryStatus'], 'ok'>, string> = {
    zero: 'hisoblanmagan',
    missing: "yo'q",
    not_uploaded: '\u2014',
  };

  return (
    <span
      className={cn(
        'text-xs',
        row.salaryStatus === 'not_uploaded'
          ? 'text-[--color-text-faint]'
          : 'italic text-[--color-warn]',
      )}
    >
      {labels[row.salaryStatus as Exclude<ResultListRow['salaryStatus'], 'ok'>]}
    </span>
  );
}

// ═══════════ Tahlil natijasi ═══════════

function AnalysisView({
  analysis,
  saving,
  onSave,
  onCancel,
}: {
  analysis: ResultsAnalysis;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const warnings =
    analysis.missing.length +
    analysis.invalidRows.length +
    analysis.unknownDistricts.length +
    analysis.nameMismatches.length +
    analysis.bonusMismatches.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <SummaryBox label="Topildi" value={`${analysis.matchedRows} / ${analysis.totalRows}`} />
        <SummaryBox label="Reja" value={formatTiyin(analysis.planTiyin)} />
        <SummaryBox
          label="Tushum"
          value={formatTiyin(analysis.factTiyin)}
          className="text-[--color-income]"
        />
        <SummaryBox
          label="Bajarilish"
          value={formatPercent(analysis.percent)}
          className={percentColor(analysis.percent)}
        />
        <SummaryBox label="Ustama" value={formatTiyin(analysis.bonusTiyin)} />
      </div>

      {warnings === 0 &&
        analysis.locationChanges.length === 0 &&
        analysis.typeChanges.length === 0 && (
          <div className="flex items-center gap-2 rounded-[--radius-card] border border-[--color-income] bg-[--color-income-soft] px-4 py-3 text-sm text-[--color-income]">
            <IconCheck className="size-4" />
            Fayl toza &mdash; hech qanday nomuvofiqlik topilmadi
          </div>
        )}

      <IssueBlock
        tone="expense"
        title="Reestrda topilmadi — saqlanmaydi"
        count={analysis.missing.length}
      >
        {analysis.missing.map((item) => (
          <IssueLine
            key={item.pinfl}
            left={item.fullName || '(ismsiz)'}
            right={`${item.pinfl} · ${item.rowIndex}-qator`}
          />
        ))}
      </IssueBlock>

      <IssueBlock
        tone="expense"
        title="Xato qatorlar — o'tkazib yuboriladi"
        count={analysis.invalidRows.length}
      >
        {analysis.invalidRows.map((item) => (
          <IssueLine key={item.rowIndex} left={`${item.rowIndex}-qator`} right={item.reason} />
        ))}
      </IssueBlock>

      <IssueBlock
        tone="warn"
        title="Ustama qoidaga mos emas"
        description="80% dan past — 0, 80–95% — tushumning 25%, 95% dan yuqori — 45%. Fayldagi qiymat saqlanadi"
        count={analysis.bonusMismatches.length}
      >
        {analysis.bonusMismatches.map((item) => (
          <IssueLine
            key={item.pinfl}
            left={`${item.fullName} · ${formatPercent(item.percent)}`}
            right={`faylda ${formatTiyin(item.fileTiyin)} · qoida bo'yicha ${formatTiyin(item.expectedTiyin)}`}
          />
        ))}
      </IssueBlock>

      <IssueBlock
        tone="warn"
        title="Ism reestrdagidan farq qiladi"
        description="PINFL xato yozilgan bo'lishi mumkin — tekshiring"
        count={analysis.nameMismatches.length}
      >
        {analysis.nameMismatches.map((item) => (
          <IssueLine
            key={item.pinfl}
            left={`Faylda: ${item.fileName}`}
            right={`Reestrda: ${item.registryName}`}
          />
        ))}
      </IssueBlock>

      <IssueBlock
        tone="warn"
        title="Tuman topilmadi — tumansiz saqlanadi"
        count={analysis.unknownDistricts.length}
      >
        {analysis.unknownDistricts.map((item) => (
          <IssueLine
            key={item.rowIndex}
            left={`${item.rowIndex}-qator · ${item.region}`}
            right={`"${item.value}"`}
          />
        ))}
      </IssueBlock>

      <IssueBlock
        tone="info"
        title="Hudud o'zgargan"
        description="Shu oy uchun fayldagi hudud olinadi — ish haqi shunga ko'chadi"
        count={analysis.locationChanges.length}
      >
        {analysis.locationChanges.map((item) => (
          <IssueLine key={item.pinfl} left={item.fullName} right={`${item.from} → ${item.to}`} />
        ))}
      </IssueBlock>

      <IssueBlock
        tone="info"
        title="Xodim turi o'zgargan"
        description="Shu oy uchun fayldagi tur olinadi"
        count={analysis.typeChanges.length}
      >
        {analysis.typeChanges.map((item) => (
          <IssueLine key={item.pinfl} left={item.fullName} right={`${item.from} → ${item.to}`} />
        ))}
      </IssueBlock>

      {analysis.hasPrevious && (
        <p className="text-xs text-[--color-warn]">
          Bu oy uchun natijalar allaqachon saqlangan &mdash; saqlasangiz, oldingisi almashtiriladi.
        </p>
      )}

      <RegionTable
        regions={analysis.regions}
        totals={{
          planTiyin: analysis.planTiyin,
          factTiyin: analysis.factTiyin,
          bonusTiyin: analysis.bonusTiyin,
          salaryTiyin: '0',
          percent: analysis.percent,
          ratio: null,
          salaryShare: null,
        }}
        showSalary={false}
        title="Saqlanadigan natijalar"
      />

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Boshqa fayl
        </Button>
        <Button onClick={onSave} loading={saving} disabled={analysis.rows.length === 0}>
          Saqlash ({analysis.rows.length} xodim)
        </Button>
      </div>
    </div>
  );
}

// ═══════════ Saqlash hisoboti ═══════════

function CommitReport({ report, onClose }: { report: CommitResult; onClose: () => void }) {
  const moved = report.payroll.moved;
  const movedTotal = moved.reduce((sum, item) => sum + Number(item.amountTiyin), 0);

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Saqlandi"
        description={`${report.saved} ta xodim${report.replacedPrevious ? ' · oldingi yuklash almashtirildi' : ''}`}
        actions={
          <Button variant="ghost" size="sm" onClick={onClose}>
            Yopish
          </Button>
        }
      />

      <CardBody className="space-y-3">
        {report.payroll.batches === 0 ? (
          <p className="text-sm text-[--color-text-muted]">
            Bu oy uchun ish haqi hali yuklanmagan. Yuklanganda fayldagi hudud va turga qarab
            darhol to&rsquo;g&rsquo;ri guruhlanadi.
          </p>
        ) : moved.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-[--color-income]">
            <IconCheck className="size-4" />
            Ish haqi to&rsquo;g&rsquo;ri joylashgan &mdash; hech narsa ko&rsquo;chmadi
          </div>
        ) : (
          <>
            <p className="text-sm">
              Ish haqi qayta guruhlandi:{' '}
              <span className="font-semibold">{moved.length} xodim</span>,{' '}
              <span className="money font-semibold">{formatTiyin(String(movedTotal))}</span>{' '}
              boshqa guruhga ko&rsquo;chdi. Jami ish haqi o&rsquo;zgarmadi.
            </p>

            <div className="max-h-72 overflow-y-auto rounded-[--radius-control] border border-[--color-line]">
              <Table>
                <THead>
                  <Tr>
                    <Th>Xodim</Th>
                    <Th>Qayerdan</Th>
                    <Th>Qayerga</Th>
                    <Th align="right" className="w-36">
                      Summa
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {moved.map((item) => (
                    <Tr key={item.pinfl}>
                      <Td className="font-medium">{item.fullName}</Td>
                      <Td className="text-[--color-text-muted]">{item.from}</Td>
                      <Td>{item.to}</Td>
                      <Td money>
                        <Money tiyin={item.amountTiyin} tone="expense" />
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

// ═══════════ Hududlar jadvali ═══════════

function RegionTable({
  regions,
  totals,
  showSalary,
  title = 'Hududlar bo\u2018yicha',
}: {
  regions: RegionTotal[];
  totals: ResultTotals;
  showSalary: boolean;
  title?: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} />

      <div className="overflow-x-auto">
        <Table>
          <THead>
            <Tr>
              <Th>Hudud</Th>
              <Th align="center" className="w-20">
                Xodim
              </Th>
              <Th align="right" className="w-36">
                Reja
              </Th>
              <Th align="right" className="w-36">
                Tushum
              </Th>
              <Th align="right" className="w-20">
                Foiz
              </Th>
              <Th align="right" className="w-36">
                Ustama
              </Th>
              {showSalary && (
                <>
                  <Th align="right" className="w-36 bg-brand-50">
                    Ish haqi
                  </Th>
                  <Th align="right" className="w-24 bg-brand-50">
                    Nisbat
                  </Th>
                  <Th align="right" className="w-20 bg-brand-50">
                    Ulush
                  </Th>
                </>
              )}
            </Tr>
          </THead>

          <TBody>
            {regions.map((region) => (
              <Tr key={region.regionCode}>
                <Td className="font-medium">{region.name}</Td>
                <Td align="center" className="money text-[--color-text-muted]">
                  {region.count}
                </Td>
                <Td money className="text-[--color-text-muted]">
                  <Money tiyin={region.planTiyin} />
                </Td>
                <Td money>
                  <Money tiyin={region.factTiyin} tone="income" />
                </Td>
                <Td align="right" className={cn('money font-medium', percentColor(region.percent))}>
                  {formatPercent(region.percent)}
                </Td>
                <Td money>
                  <Money tiyin={region.bonusTiyin} />
                </Td>
                {showSalary && (
                  <>
                    <Td money className="bg-brand-50/40">
                      <Money tiyin={region.salaryTiyin} tone="expense" />
                    </Td>
                    <Td
                      align="right"
                      className={cn('money bg-brand-50/40 font-medium', ratioColor(region.ratio))}
                    >
                      {formatRatio(region.ratio)}
                    </Td>
                    <Td align="right" className="money bg-brand-50/40 text-[--color-text-muted]">
                      {region.salaryShare == null ? '\u2014' : formatPercent(region.salaryShare)}
                    </Td>
                  </>
                )}
              </Tr>
            ))}
          </TBody>

          <TFoot>
            <Tr>
              <Td>Jami</Td>
              <Td align="center" className="money">
                {regions.reduce((sum, region) => sum + region.count, 0)}
              </Td>
              <Td money>
                <Money tiyin={totals.planTiyin} className="font-semibold" />
              </Td>
              <Td money>
                <Money tiyin={totals.factTiyin} tone="income" className="font-semibold" />
              </Td>
              <Td align="right" className={cn('money font-semibold', percentColor(totals.percent))}>
                {formatPercent(totals.percent)}
              </Td>
              <Td money>
                <Money tiyin={totals.bonusTiyin} className="font-semibold" />
              </Td>
              {showSalary && (
                <>
                  <Td money>
                    <Money tiyin={totals.salaryTiyin} tone="expense" className="font-semibold" />
                  </Td>
                  <Td
                    align="right"
                    className={cn('money font-semibold', ratioColor(totals.ratio))}
                  >
                    {formatRatio(totals.ratio)}
                  </Td>
                  <Td align="right" className="money font-semibold">
                    {totals.salaryShare == null ? '\u2014' : formatPercent(totals.salaryShare)}
                  </Td>
                </>
              )}
            </Tr>
          </TFoot>
        </Table>
      </div>
    </Card>
  );
}

// ═══════════ Yordamchi komponentlar ═══════════

function IssueBlock({
  tone,
  title,
  description,
  count,
  children,
}: {
  tone: 'expense' | 'warn' | 'info';
  title: string;
  description?: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  if (count === 0) return null;

  const styles = {
    expense: 'border-[--color-expense] bg-[--color-expense-soft] text-[--color-expense]',
    warn: 'border-[--color-warn] bg-[--color-warn-soft] text-[--color-warn]',
    info: 'border-brand-200 bg-brand-50 text-brand-800',
  };

  return (
    <div className={cn('rounded-[--radius-card] border px-4 py-3', styles[tone])}>
      <button
        type="button"
        onClick={() => setOpen((state) => !state)}
        className="flex w-full items-start gap-2.5 text-left"
      >
        <IconAlert className="mt-0.5 size-4 shrink-0" />

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">
            {title} &mdash; {count} ta
          </span>
          {description && (
            <span className="mt-0.5 block text-xs text-[--color-text-muted]">{description}</span>
          )}
        </span>

        <IconChevronDown
          className={cn('mt-0.5 size-4 shrink-0 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && <div className="mt-3 max-h-64 space-y-1 overflow-y-auto">{children}</div>}
    </div>
  );
}

function IssueLine({ left, right }: { left: string; right: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[--radius-control] bg-white px-3 py-1.5 text-xs text-[--color-text]">
      <span className="min-w-0 flex-1 truncate font-medium">{left}</span>
      <span className="shrink-0 text-[--color-text-muted]">{right}</span>
    </div>
  );
}

function SummaryBox({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className="rounded-[--radius-card] border border-[--color-line] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
        {label}
      </p>
      <p className={cn('money mt-2 text-xl font-semibold', className)}>{value}</p>
      {hint && <p className="mt-1 text-xs text-[--color-text-faint]">{hint}</p>}
    </div>
  );
}
