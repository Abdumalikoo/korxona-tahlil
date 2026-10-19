'use client';

import {
    analyzeLeaseImport,
    commitLeaseImport,
    downloadLeaseTemplate,
    IMPORT_STATUS,
    type ImportAnalysis,
    type ImportLease,
    type ImportRowStatus,
} from '@/features/leases/import-api';
import { errorMessage } from '@/lib/error-message';
import { formatPeriodShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconAlert, IconClose, IconDownload, IconSpinner, IconUpload } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';

interface Props {
  onClose: () => void;
  /** Saqlangandan keyin */
  onImported: (message: string) => void;
}

type Filter = 'all' | ImportRowStatus;

/** Excel'dan ijara shartnomalarini ommaviy kiritish: shablon → tekshirish → saqlash */
export function ImportDialog({ onClose, onImported }: Props) {
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [analyzing, setAnalyzing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const busy = analyzing || saving;

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [busy, onClose]);

  async function handleTemplate() {
    setDownloading(true);
    setError(null);
    try {
      await downloadLeaseTemplate();
    } catch (err) {
      setError(errorMessage(err, 'Shablonni yuklab bo‘lmadi'));
    } finally {
      setDownloading(false);
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setError('Faqat .xlsx fayl — Excel\'da «Excel kitobi (.xlsx)» sifatida saqlang');
      return;
    }
    setAnalyzing(true);
    setError(null);
    setAnalysis(null);
    try {
      const result = await analyzeLeaseImport(file);
      setAnalysis(result);
      setFilter(result.errors > 0 ? 'error' : 'all');
    } catch (err) {
      setError(errorMessage(err, 'Faylni tekshirib bo‘lmadi'));
    } finally {
      setAnalyzing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleSave() {
    if (!analysis) return;
    const rows = analysis.rows
      .filter((row) => row.status === 'ok' && row.lease)
      .map((row) => row.lease as ImportLease);
    if (rows.length === 0) return;

    setSaving(true);
    setError(null);
    try {
      const result = await commitLeaseImport(rows);
      const { created, skipped } = result.data;
      onImported(
        `${created} ta shartnoma import qilindi${skipped > 0 ? `, ${skipped} tasi bazada bor edi` : ''}`,
      );
    } catch (err) {
      setError(errorMessage(err, 'Saqlab bo‘lmadi'));
    } finally {
      setSaving(false);
    }
  }

  const rows = analysis?.rows.filter((row) => filter === 'all' || row.status === filter) ?? [];

  const filters: { value: Filter; label: string; count: number }[] = analysis
    ? [
        { value: 'all', label: 'Hammasi', count: analysis.total },
        { value: 'ok', label: 'Yoziladi', count: analysis.ok },
        { value: 'error', label: 'Xato', count: analysis.errors },
        { value: 'exists', label: 'Bazada bor', count: analysis.exists },
        { value: 'duplicate', label: 'Takror', count: analysis.duplicates },
      ]
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/30" onClick={busy ? undefined : onClose} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[90vh] w-full max-w-6xl flex-col rounded-[--radius-card] bg-white shadow-xl"
      >
        {/* Sarlavha */}
        <div className="flex items-start justify-between gap-4 border-b border-[--color-line] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Excel&rsquo;dan import</h2>
            <p className="mt-0.5 text-xs text-[--color-text-muted]">
              Shablonni yuklab oling, to&rsquo;ldiring va yuklang. Avval tekshiriladi &mdash; saqlash
              tugmasini bosmaguningizcha hech narsa yozilmaydi.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-[--color-text-muted] hover:text-[--color-text]"
            aria-label="Yopish"
          >
            <IconClose className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Shablon va fayl */}
          <div className="grid gap-3 md:grid-cols-[16rem_1fr]">
            <div className="rounded-[--radius-control] border border-[--color-line] p-4">
              <p className="text-sm font-medium">1. Shablon</p>
              <p className="mt-1 text-xs text-[--color-text-muted]">
                Hududlar, tumanlar va bo&rsquo;limlar ro&rsquo;yxati hamda yo&rsquo;riqnoma bilan
              </p>
              <Button variant="secondary" size="sm" className="mt-3" onClick={handleTemplate} loading={downloading}>
                <IconDownload className="size-4" />
                Shablonni yuklab olish
              </Button>
            </div>

            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                handleFile(event.dataTransfer.files?.[0]);
              }}
              className={cn(
                'flex flex-col items-center justify-center rounded-[--radius-control] border-2 border-dashed p-4 text-center transition-colors',
                dragging ? 'border-brand-600 bg-brand-50' : 'border-[--color-line-strong]',
              )}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx"
                className="hidden"
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
              {analyzing ? (
                <p className="flex items-center gap-2 text-sm text-[--color-text-muted]">
                  <IconSpinner className="size-4 animate-spin" />
                  Tekshirilmoqda&hellip;
                </p>
              ) : (
                <>
                  <p className="text-sm font-medium">2. To&rsquo;ldirilgan faylni yuklang</p>
                  <p className="mt-1 text-xs text-[--color-text-muted]">
                    {analysis ? `Yuklangan: ${analysis.fileName}` : 'Faylni shu yerga tashlang yoki tanlang (.xlsx)'}
                  </p>
                  <Button size="sm" className="mt-3" onClick={() => inputRef.current?.click()}>
                    <IconUpload className="size-4" />
                    {analysis ? 'Boshqa fayl' : 'Fayl tanlash'}
                  </Button>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className="flex gap-2 rounded-[--radius-control] bg-[--color-expense-soft] px-3 py-2 text-sm text-[--color-expense]">
              <IconAlert className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Natija */}
          {analysis && (
            <>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[--radius-control] bg-[--color-surface-muted] px-4 py-3">
                <Summary label="Qatorlar">{analysis.total}</Summary>
                <Summary label="Yoziladi" tone="income">{analysis.ok}</Summary>
                <Summary label="Xato" tone={analysis.errors > 0 ? 'expense' : undefined}>{analysis.errors}</Summary>
                <Summary label="Bazada bor">{analysis.exists}</Summary>
                <Summary label="Takror">{analysis.duplicates}</Summary>
                <Summary label="Yoziladiganlar oylik summasi">
                  <Money tiyin={analysis.totalMonthlyTiyin} />
                </Summary>
              </div>

              {analysis.errors > 0 && (
                <p className="text-sm text-[--color-expense]">
                  Xatoli qatorlar saqlanmaydi. Excel&rsquo;da tuzatib, faylni qayta yuklang &mdash; yoki
                  hozircha to&rsquo;g&rsquo;rilarini saqlab, qolganini keyin yuklang (bazadagilar qayta
                  yozilmaydi).
                </p>
              )}

              <div className="flex flex-wrap gap-1">
                {filters.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setFilter(item.value)}
                    disabled={item.count === 0 && item.value !== 'all'}
                    className={cn(
                      'rounded-[--radius-control] px-3 py-1 text-sm transition-colors disabled:opacity-40',
                      filter === item.value
                        ? 'bg-brand-800 text-white'
                        : 'bg-[--color-surface-sunken] text-[--color-text-muted] hover:text-[--color-text]',
                    )}
                  >
                    {item.label} · {item.count}
                  </button>
                ))}
              </div>

              <div className="overflow-hidden rounded-[--radius-control] border border-[--color-line]">
                <Table>
                  <THead>
                    <Tr>
                      <Th className="w-14">Qator</Th>
                      <Th className="w-28">Holat</Th>
                      <Th>Obyekt</Th>
                      <Th>Joyi</Th>
                      <Th className="w-32">Muddati</Th>
                      <Th align="right" className="w-36">
                        Oylik summa
                      </Th>
                      <Th>Izoh</Th>
                    </Tr>
                  </THead>
                  <TBody>
                    {rows.map((row) => {
                      const status = IMPORT_STATUS[row.status];
                      return (
                        <Tr key={row.rowNumber} className={cn(row.status === 'error' && 'bg-[--color-expense-soft]')}>
                          <Td className="money text-[--color-text-muted]">{row.rowNumber}</Td>
                          <Td>
                            <Badge tone={status.tone}>{status.label}</Badge>
                          </Td>
                          <Td>
                            <span className="block max-w-[16rem] truncate">{row.title || '—'}</span>
                            <span className="text-xs text-[--color-text-muted]">№ {row.number || '—'}</span>
                          </Td>
                          <Td className="text-[--color-text-muted]">
                            <span className="block max-w-[14rem] truncate">{row.placeLabel || '—'}</span>
                          </Td>
                          <Td className="text-xs text-[--color-text-muted]">
                            {row.startPeriod ? formatPeriodShort(row.startPeriod) : '—'}
                            {' — '}
                            {row.endPeriod ? formatPeriodShort(row.endPeriod) : 'muddatsiz'}
                          </Td>
                          <Td align="right" money>
                            {row.monthlyTiyin ? <Money tiyin={row.monthlyTiyin} /> : '—'}
                          </Td>
                          <Td className="text-xs">
                            {row.errors.map((message) => (
                              <p key={message} className="text-[--color-expense]">
                                {message}
                              </p>
                            ))}
                            {row.warnings.map((message) => (
                              <p key={message} className="text-[--color-warn]">
                                {message}
                              </p>
                            ))}
                            {row.status === 'exists' && (
                              <p className="text-[--color-text-muted]">Shu hududda bu raqamli shartnoma bor</p>
                            )}
                            {row.status === 'duplicate' && (
                              <p className="text-[--color-warn]">Faylda yuqorida takrorlangan</p>
                            )}
                          </Td>
                        </Tr>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
            </>
          )}
        </div>

        {/* Pastki tugmalar */}
        <div className="flex items-center justify-end gap-2 border-t border-[--color-line] bg-[--color-surface-muted] px-5 py-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Yopish
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!analysis || analysis.ok === 0 || analyzing}>
            {analysis && analysis.ok > 0 ? `${analysis.ok} ta shartnomani saqlash` : 'Saqlash'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Summary({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: 'income' | 'expense';
  children: ReactNode;
}) {
  return (
    <div>
      <p className="text-xs text-[--color-text-muted]">{label}</p>
      <p
        className={cn(
          'money text-base font-semibold',
          tone === 'income' && 'text-[--color-income]',
          tone === 'expense' && 'text-[--color-expense]',
        )}
      >
        {children}
      </p>
    </div>
  );
}
