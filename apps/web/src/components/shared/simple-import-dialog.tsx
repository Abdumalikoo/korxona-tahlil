'use client';

import {
    analyzeSimpleFile,
    downloadSimpleTemplate,
    simpleImportApi,
    type ImportKind,
    type SimpleImportResult,
} from '@/features/shared/simple-import-api';
import { errorMessage } from '@/lib/error-message';
import { formatTiyin } from '@/lib/format';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
    IconAlert,
    IconClose,
    IconDownload,
    IconSpinner,
    IconUpload,
} from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { Table, TBody, Td, TFoot, Th, THead, Tr } from '@/components/ui/table';
import { cn } from '@/lib/utils';

interface SimpleImportDialogProps {
  open: boolean;
  kind: ImportKind;
  onClose: () => void;
  onImported: (message: string) => void;
}

/**
 * Sodda Excel import — ikki ustun: nomi va summa.
 *
 * Yozuvlar bugungi sana bilan, Umumkorxona bo'limiga,
 * standart kategoriya bilan yaratiladi. Keyin qo'lda tuzatiladi.
 */
export function SimpleImportDialog({
  open,
  kind,
  onClose,
  onImported,
}: SimpleImportDialogProps) {
  const [analysis, setAnalysis] = useState<SimpleImportResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const isExpense = kind === 'expense';
  const title = isExpense ? 'Xarajatlarni yuklash' : 'Daromadlarni yuklash';

  function reset() {
    setAnalysis(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleTemplate() {
    setDownloading(true);
    try {
      await downloadSimpleTemplate(kind);
    } catch (err) {
      setError(errorMessage(err, 'Shablonni yuklab bo\u2018lmadi'));
    } finally {
      setDownloading(false);
    }
  }

  async function handleFile(file: File) {
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
      setError('Faqat Excel fayl yuklang');
      return;
    }

    setUploading(true);
    setError(null);
    setAnalysis(null);

    try {
      const result = await analyzeSimpleFile(file);
      setAnalysis(result);
    } catch (err) {
      setError(errorMessage(err, 'Faylni o\u2018qib bo\u2018lmadi'));
    } finally {
      setUploading(false);
    }
  }

  async function handleCommit() {
    if (!analysis) return;

    setSaving(true);

    try {
      const result = await simpleImportApi.commit(kind, analysis.rows);
      onImported(`${result.data.created} ta yozuv qo\u2018shildi`);
      reset();
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Saqlashda xatolik'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-10">
      <div
        className="fixed inset-0 bg-slate-900/30"
        onClick={saving ? undefined : onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-2xl rounded-[--radius-card] bg-white shadow-xl"
      >
        {/* Sarlavha */}
        <div className="flex items-center justify-between border-b border-[--color-line] px-5 py-3.5">
          <h3 className="text-sm font-semibold">{title}</h3>

          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex size-7 items-center justify-center rounded text-[--color-text-muted] transition-colors hover:bg-[--color-surface-sunken] hover:text-[--color-text]"
            aria-label="Yopish"
          >
            <IconClose className="size-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error && (
            <div className="rounded-[--radius-control] bg-[--color-expense-soft] px-3 py-2.5 text-sm text-[--color-expense]">
              {error}
            </div>
          )}

          {!analysis ? (
            <>
              {/* Shablon */}
              <div className="flex items-center justify-between gap-3 rounded-[--radius-control] bg-[--color-surface-muted] px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Shablon</p>
                  <p className="text-xs text-[--color-text-muted]">
                    Ikki ustun: nomi va summa
                  </p>
                </div>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleTemplate()}
                  loading={downloading}
                >
                  <IconDownload className="size-4" />
                  Yuklab olish
                </Button>
              </div>

              {/* Yuklash zonasi */}
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
                    <IconSpinner className="size-7 animate-spin text-brand-700" />
                    <p className="text-sm text-[--color-text-muted]">
                      O&rsquo;qilmoqda&hellip;
                    </p>
                  </>
                ) : (
                  <>
                    <IconUpload
                      className="size-7 text-[--color-text-faint]"
                      strokeWidth={1.5}
                    />
                    <p className="text-sm font-medium">
                      To&rsquo;ldirilgan faylni tashlang
                    </p>
                    <p className="text-xs text-[--color-text-muted]">
                      yoki bosib tanlang
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

              <p className="text-xs text-[--color-text-muted]">
                Yozuvlar bugungi sana bilan, Umumkorxona bo&rsquo;limiga
                qo&rsquo;shiladi. Keyin ro&rsquo;yxatdan tahrirlashingiz mumkin.
              </p>
            </>
          ) : (
            <>
              {/* Yig'indi */}
              <div className="grid gap-3 sm:grid-cols-3">
                <SummaryBox label="Jami qator" value={String(analysis.totalRows)} />
                <SummaryBox
                  label="Yaroqli"
                  value={String(analysis.validRows)}
                  tone="income"
                />
                <SummaryBox
                  label="Summa"
                  value={formatTiyin(analysis.totalTiyin)}
                />
              </div>

              {/* Xato qatorlar */}
              {analysis.invalidRows.length > 0 && (
                <div className="rounded-[--radius-control] border border-[--color-warn] bg-[--color-warn-soft] px-3 py-2.5">
                  <div className="flex items-start gap-2">
                    <IconAlert className="mt-0.5 size-4 shrink-0 text-[--color-warn]" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[--color-warn]">
                        {analysis.invalidRows.length} ta qator o&rsquo;tkazib
                        yuborildi
                      </p>
                      <ul className="mt-1 space-y-0.5 text-xs text-[--color-text-muted]">
                        {analysis.invalidRows.slice(0, 5).map((row) => (
                          <li key={row.rowIndex}>
                            {row.rowIndex}-qator &mdash; {row.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Ro'yxat */}
              <div className="max-h-72 overflow-y-auto rounded-[--radius-control] border border-[--color-line]">
                <Table>
                  <THead>
                    <Tr>
                      <Th>Nomi</Th>
                      <Th align="right" className="w-40">
                        Summa
                      </Th>
                    </Tr>
                  </THead>

                  <TBody>
                    {analysis.rows.map((row) => (
                      <Tr key={row.rowIndex}>
                        <Td className="truncate">{row.name}</Td>
                        <Td money>
                          <Money
                            tiyin={row.amountTiyin}
                            tone={isExpense ? 'expense' : 'income'}
                          />
                        </Td>
                      </Tr>
                    ))}
                  </TBody>

                  <TFoot>
                    <Tr>
                      <Td>Jami</Td>
                      <Td money>
                        <Money
                          tiyin={analysis.totalTiyin}
                          tone={isExpense ? 'expense' : 'income'}
                          className="font-semibold"
                        />
                      </Td>
                    </Tr>
                  </TFoot>
                </Table>
              </div>
            </>
          )}
        </div>

        {/* Amallar */}
        <div className="flex justify-end gap-2 border-t border-[--color-line] bg-[--color-surface-muted] px-5 py-3">
          {analysis ? (
            <>
              <Button variant="secondary" size="sm" onClick={reset} disabled={saving}>
                Boshqa fayl
              </Button>
              <Button size="sm" onClick={() => void handleCommit()} loading={saving}>
                {analysis.validRows} ta yozuvni saqlash
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={onClose}>
              Yopish
            </Button>
          )}
        </div>
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
    <div className="rounded-[--radius-control] bg-[--color-surface-muted] p-3">
      <p className="text-xs uppercase tracking-wide text-[--color-text-muted]">
        {label}
      </p>
      <p
        className={cn(
          'money mt-1 text-base font-semibold',
          tone === 'income' ? 'text-[--color-income]' : 'text-[--color-text]',
        )}
      >
        {value}
      </p>
    </div>
  );
}
