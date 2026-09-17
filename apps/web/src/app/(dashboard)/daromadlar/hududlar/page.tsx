'use client';

import { useState, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api';
import {
  regionalIncomeApi,
  downloadRegionalTemplate,
  analyzeRegionalFile,
  type RegionalAnalyzeResult,
} from '@/features/incomes/regional-api';
import { currentPeriod, formatPeriod, formatTiyin, formatPercent } from '@/lib/format';

import { PageHeader } from '@/components/layout/page-header';
import { Tabs } from '@/components/ui/tabs';
import { PeriodPicker } from '@/components/shared/period-picker';
import { ShareBar } from '@/components/shared/share-bar';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
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
  { href: '/daromadlar', label: "Ro'yxat" },
  { href: '/daromadlar/tahlil', label: 'Tahlil' },
  { href: '/daromadlar/hududlar', label: 'Hududlar' },
];

export default function RegionalIncomePage() {
  const { isAdmin } = useAuth();

  const [period, setPeriod] = useState(currentPeriod());
  const [analysis, setAnalysis] = useState<RegionalAnalyzeResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [replacePrevious, setReplacePrevious] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState('');
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(
    null,
  );

  const inputRef = useRef<HTMLInputElement>(null);

  const byRegion = useAsync(() => regionalIncomeApi.summaryByRegion(period), [period]);
  const byService = useAsync(
    () =>
      regionalIncomeApi.summaryByService(
        period,
        selectedRegion ? Number(selectedRegion) : undefined,
      ),
    [period, selectedRegion],
  );

  function reset() {
    setAnalysis(null);
    setReplacePrevious(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleTemplate() {
    setDownloading(true);
    try {
      await downloadRegionalTemplate(period);
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
      const result = await analyzeRegionalFile(period, file);
      setAnalysis(result);
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Xatolik',
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
      const result = await regionalIncomeApi.commit(
        period,
        analysis.rows,
        replacePrevious,
      );
      setToast({
        message: `${result.data.created} ta daromad yozuvi yaratildi`,
        tone: 'success',
      });
      reset();
      byRegion.reload();
      byService.reload();
    } catch (err) {
      setToast({
        message: err instanceof ApiError ? err.message : 'Saqlashda xatolik',
        tone: 'error',
      });
    } finally {
      setCommitting(false);
      setConfirmOpen(false);
    }
  }

  const regionOptions = [
    { value: '', label: 'Barcha hududlar' },
    ...(byRegion.data?.data.rows ?? []).map((row) => ({
      value: String(row.regionCode ?? ''),
      label: row.name,
    })),
  ];

  const regionRows = byRegion.data?.data.rows ?? [];
  const serviceRows = byService.data?.data.rows ?? [];

  return (
    <>
      <PageHeader
        title="Daromadlar"
        description={`Hududlar \u00B7 ${formatPeriod(period)}`}
      />

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
                    <IconUpload
                      className="size-8 text-[--color-text-faint]"
                      strokeWidth={1.5}
                    />
                    <p className="text-sm font-medium text-[--color-text]">
                      To&rsquo;ldirilgan faylni shu yerga tashlang
                    </p>
                    <p className="text-xs text-[--color-text-muted]">
                      Har hudud alohida varaq &middot; Soni va Summasi
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
            onCancel={reset}
            committing={committing}
          />
        )}

        {/* Hududlar kesimi */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Hududlar bo'yicha daromad"
            description={formatPeriod(period)}
          />

          {byRegion.loading ? (
            <LoadingState />
          ) : regionRows.length === 0 ? (
            <EmptyState title="Bu davrda hududiy daromad yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Hudud</Th>
                  <Th align="center" className="w-24">
                    Xizmat
                  </Th>
                  <Th align="center" className="w-24">
                    Soni
                  </Th>
                  <Th className="w-40">Ulush</Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {regionRows.map((row) => (
                  <Tr key={row.regionCode ?? 'none'}>
                    <Td>{row.name}</Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {row.count}
                    </Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {row.quantity || '\u2014'}
                    </Td>

                    <Td>
                      <div className="flex items-center gap-2">
                        <ShareBar
                          percent={row.sharePercent}
                          color="var(--color-income)"
                        />
                        <span className="money w-12 shrink-0 text-right text-xs text-[--color-text-muted]">
                          {formatPercent(row.sharePercent)}
                        </span>
                      </div>
                    </Td>

                    <Td money>
                      <Money tiyin={row.amountTiyin} tone="income" />
                    </Td>
                  </Tr>
                ))}
              </TBody>

              <TFoot>
                <Tr>
                  <Td colSpan={4}>Jami</Td>
                  <Td money>
                    <Money
                      tiyin={byRegion.data?.data.totalTiyin ?? 0}
                      tone="income"
                      className="font-semibold"
                    />
                  </Td>
                </Tr>
              </TFoot>
            </Table>
          )}
        </Card>

        {/* Xizmat turlari */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Xizmat turlari bo'yicha"
            description="Eng katta daromaddan boshlab"
            actions={
              <div className="w-56">
                <Select
                  options={regionOptions}
                  value={selectedRegion}
                  onChange={(event) => setSelectedRegion(event.target.value)}
                  className="h-9"
                />
              </div>
            }
          />

          {byService.loading ? (
            <LoadingState />
          ) : serviceRows.length === 0 ? (
            <EmptyState title="Ma'lumot yo'q" />
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Xizmat turi</Th>
                  <Th align="center" className="w-20">
                    Soni
                  </Th>
                  <Th align="right" className="w-32">
                    O&apos;rtacha
                  </Th>
                  <Th className="w-32">Ulush</Th>
                  <Th align="right" className="w-40">
                    Summa
                  </Th>
                </Tr>
              </THead>

              <TBody>
                {serviceRows.map((row) => (
                  <Tr key={row.categoryCode}>
                    <Td className="max-w-md truncate" title={row.label}>
                      {row.label}
                    </Td>

                    <Td align="center" className="money text-[--color-text-muted]">
                      {row.quantity || '\u2014'}
                    </Td>

                    <Td money className="text-[--color-text-muted]">
                      {row.averageTiyin ? formatTiyin(row.averageTiyin) : '\u2014'}
                    </Td>

                    <Td>
                      <div className="flex items-center gap-2">
                        <ShareBar
                          percent={row.sharePercent}
                          color="var(--color-income)"
                        />
                      </div>
                    </Td>

                    <Td money>
                      <Money tiyin={row.amountTiyin} tone="income" />
                    </Td>
                  </Tr>
                ))}
              </TBody>

              <TFoot>
                <Tr>
                  <Td colSpan={4}>Jami</Td>
                  <Td money>
                    <Money
                      tiyin={byService.data?.data.totalTiyin ?? 0}
                      tone="income"
                      className="font-semibold"
                    />
                  </Td>
                </Tr>
              </TFoot>
            </Table>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Yuklashni tasdiqlash"
        message={
          replacePrevious
            ? `Bu davrdagi eski hududiy daromadlar o'chiriladi va ${analysis?.totalRows ?? 0} ta yangi yozuv yaratiladi.`
            : `${analysis?.totalRows ?? 0} ta daromad yozuvi yaratiladi.`
        }
        confirmLabel="Tasdiqlash"
        danger={replacePrevious}
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
  analysis: RegionalAnalyzeResult;
  replacePrevious: boolean;
  onReplaceChange: (value: boolean) => void;
  onCommit: () => void;
  onCancel: () => void;
  committing: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Yig'indi */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryBox label="Hududlar" value={String(analysis.regions.length)} />
        <SummaryBox label="Yozuvlar" value={String(analysis.totalRows)} tone="income" />
        <SummaryBox
          label="Jami summa"
          value={formatTiyin(analysis.totalTiyin)}
          tone="income"
        />
      </div>

      {/* Ogohlantirishlar */}
      {analysis.unknownSheets.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-[--radius-card] border border-[--color-warn] bg-[--color-warn-soft] px-4 py-3">
          <IconAlert className="mt-0.5 size-4 shrink-0 text-[--color-warn]" />
          <div>
            <p className="text-sm font-medium text-[--color-warn]">
              Tanilmagan varaqlar
            </p>
            <p className="mt-0.5 text-xs text-[--color-text-muted]">
              {analysis.unknownSheets.join(', ')} &mdash; bu varaqlar o&rsquo;tkazib
              yuborildi
            </p>
          </div>
        </div>
      )}

      {analysis.unknownServices.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader
            title={`Tanilmagan xizmatlar \u2014 ${analysis.unknownServices.length} ta`}
            description="Bu qatorlar hisobga olinmaydi"
          />
          <CardBody className="max-h-40 overflow-y-auto">
            <ul className="space-y-1 text-xs text-[--color-text-muted]">
              {analysis.unknownServices.slice(0, 20).map((item, index) => (
                <li key={`${item.sheet}-${item.rowIndex}-${index}`}>
                  <span className="money">{item.sheet}</span> &middot; {item.rowIndex}-qator
                  &mdash; {item.label}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {analysis.hasPrevious && (
        <div className="rounded-[--radius-card] border border-[--color-warn] bg-[--color-warn-soft] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <IconAlert className="mt-0.5 size-4 shrink-0 text-[--color-warn]" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[--color-warn]">
                Bu davrda {analysis.previousCount} ta hududiy daromad bor
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
                      Eski yozuvlar joyida qoladi
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
                      Eski yozuvlar o&rsquo;chiriladi
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hududlar */}
      <Card className="overflow-hidden">
        <CardHeader
          title="Shakllanadigan daromadlar"
          description="Tasdiqlangandan keyin shu yozuvlar yaratiladi"
        />

        <Table>
          <THead>
            <Tr>
              <Th>Hudud</Th>
              <Th align="center" className="w-24">
                Xizmat
              </Th>
              <Th align="center" className="w-24">
                Soni
              </Th>
              <Th align="right" className="w-44">
                Summa
              </Th>
            </Tr>
          </THead>

          <TBody>
            {analysis.regions.map((region) => (
              <Tr key={region.regionCode}>
                <Td>{region.name}</Td>
                <Td align="center" className="money text-[--color-text-muted]">
                  {region.count}
                </Td>
                <Td align="center" className="money text-[--color-text-muted]">
                  {region.quantity || '\u2014'}
                </Td>
                <Td money>
                  <Money tiyin={region.totalTiyin} tone="income" />
                </Td>
              </Tr>
            ))}
          </TBody>

          <TFoot>
            <Tr>
              <Td colSpan={3}>Jami</Td>
              <Td money>
                <Money
                  tiyin={analysis.totalTiyin}
                  tone="income"
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
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'income';
}) {
  return (
    <div className="rounded-[--radius-card] border border-[--color-line] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[--color-text-muted]">
        {label}
      </p>
      <p
        className={cn(
          'money mt-2 text-xl font-semibold',
          tone === 'income' ? 'text-[--color-income]' : 'text-[--color-text]',
        )}
      >
        {value}
      </p>
    </div>
  );
}
