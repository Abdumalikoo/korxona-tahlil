'use client';

import { Button } from '@/components/ui/button';
import { IconAlert, IconClose, IconSpinner, IconUpload } from '@/components/ui/icons';
import { compact } from '@/features/structure/api';
import { errorMessage } from '@/lib/error-message';
import { formatDate, formatPeriod } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeAssetImport, assetsApi, MODE_INFO, type AssetImportAnalysis, type AssetMode } from './api';

// ═══════════════════════════════════════════════════════════
// Asosiy vositalar — Excel'dan yuklash (xodimlarga berilgan inventar):
//   1) fayl tekshiriladi; 2) har bir «Bo'lim» qayerga tegishli — tizim taklif qiladi, o'zgartirish mumkin;
//   3) rejim: balansda (xarajatsiz) / xarajatga (Markaz) / eskirish bilan; 4) saqlash.
// ═══════════════════════════════════════════════════════════

const FIELD = 'h-8 w-full rounded-(--radius-control) border border-(--color-line) bg-white px-2 text-sm outline-none focus:border-slate-500';
const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';
const MODES: AssetMode[] = ['HOLD', 'EXPENSE', 'BALANCE'];

export function AssetImportDialog({
  onClose,
  onImported,
  initialAnalysis = null,
}: {
  onClose: () => void;
  onImported: (message: string) => void;
  /** Oldindan tekshirilgan natija (ko'rinish uchun) */
  initialAnalysis?: AssetImportAnalysis | null;
}) {
  const [analysis, setAnalysis] = useState<AssetImportAnalysis | null>(initialAnalysis);
  const [mapping, setMapping] = useState<Record<string, string>>(() => Object.fromEntries((initialAnalysis?.places ?? []).map((p) => [p.placeText, p.target])));
  const [mode, setMode] = useState<AssetMode>('HOLD');
  const [batch, setBatch] = useState('');
  const [busy, setBusy] = useState<'analyze' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRows, setShowRows] = useState<'warn' | 'all' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      setError('Faqat .xlsx fayl');
      return;
    }
    setBusy('analyze');
    setError(null);
    setAnalysis(null);
    try {
      const a = await analyzeAssetImport(file);
      setAnalysis(a);
      setMapping(Object.fromEntries(a.places.map((p) => [p.placeText, p.target])));
      setBatch(`${a.fileName.replace(/\.xlsx$/i, '')} · ${new Date().toISOString().slice(0, 10).split('-').reverse().join('.')}`);
    } catch (e) {
      setError(errorMessage(e, 'Faylni tekshirib bo‘lmadi'));
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const okRows = useMemo(() => (analysis ? analysis.rows.filter((r) => !r.errors.length && !r.exists) : []), [analysis]);
  // Joylar bo'yicha natija (tanlangan xaritaga ko'ra)
  const byTarget = useMemo(() => {
    if (!analysis) return [];
    const label = new Map(analysis.targets.map((t) => [t.value, t.label]));
    const m = new Map<string, { label: string; count: number; total: number }>();
    for (const r of okRows) {
      const t = mapping[r.placeText] ?? 'center';
      const g = m.get(t) ?? { label: label.get(t) ?? 'Markaz', count: 0, total: 0 };
      g.count += 1;
      g.total += Number(r.costTiyin);
      m.set(t, g);
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [analysis, mapping, okRows]);

  const save = async () => {
    if (!analysis || !okRows.length) return;
    setBusy('save');
    setError(null);
    try {
      const r = await assetsApi.importCommit({ fileName: analysis.fileName, batch: batch.trim() || undefined, mode, mapping, rows: okRows });
      const d = r.data;
      onImported(
        `${d.created} ta asosiy vosita yuklandi (${compact(d.totalTiyin)} so'm) — ${MODE_INFO[d.mode].label}${d.skipped ? `; ${d.skipped} tasi bazada bor edi` : ''}`,
      );
    } catch (e) {
      setError(errorMessage(e, 'Saqlab bo‘lmadi'));
    } finally {
      setBusy(null);
    }
  };

  const groups = analysis ? [...new Set(analysis.targets.map((t) => t.group))] : [];
  const warnRows = analysis ? analysis.rows.filter((r) => r.warnings.length || r.errors.length || r.exists) : [];
  const listRows = showRows === 'all' ? (analysis?.rows ?? []) : warnRows;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/30" onClick={busy ? undefined : onClose} aria-hidden />
      <div role="dialog" aria-modal="true" className="relative flex max-h-[92vh] w-full max-w-6xl flex-col rounded-(--radius-card) bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-(--color-line) px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Asosiy vositalarni Excel&apos;dan yuklash</h2>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">
              Xodimlarga berilgan inventar: Sana, Mahsulot nomi, Inventar raqami, Miqdori, Summasi, Umumiy summa, Bo&apos;lim, Qabul qiluvchi, Holati. Avval tekshiriladi —
              saqlamaguningizcha hech narsa yozilmaydi.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={Boolean(busy)} className="text-(--color-text-muted) hover:text-(--color-text)" aria-label="Yopish">
            <IconClose className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-col items-center justify-center rounded-(--radius-control) border-2 border-dashed border-(--color-line-strong) p-4 text-center">
            <input ref={inputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
            {busy === 'analyze' ? (
              <p className="flex items-center gap-2 text-sm text-(--color-text-muted)">
                <IconSpinner className="size-4 animate-spin" /> Tekshirilmoqda…
              </p>
            ) : (
              <>
                <p className="text-sm">{analysis ? `Yuklangan: ${analysis.fileName}` : 'Inventar faylini tanlang (.xlsx)'}</p>
                <Button size="sm" className="mt-2" onClick={() => inputRef.current?.click()}>
                  <IconUpload className="size-4" />
                  {analysis ? 'Boshqa fayl' : 'Fayl tanlash'}
                </Button>
              </>
            )}
          </div>

          {error && (
            <div className="flex gap-2 rounded-(--radius-control) bg-(--color-expense-soft) px-3 py-2 text-sm text-(--color-expense)">
              <IconAlert className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {analysis && (
            <>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {(
                  [
                    ['Qatorlar', String(analysis.total)],
                    ['Yoziladi', String(analysis.ok)],
                    ['Jami summa', `${compact(analysis.totalTiyin)} so'm`],
                    ['Narxi yo‘q', String(analysis.zeroPrice)],
                    ['Bazada bor', String(analysis.exists)],
                    ['Xato', String(analysis.errors)],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-2">
                    <p className="text-[11px] text-(--color-text-muted)">{k}</p>
                    <p className="text-base font-semibold tabular-nums">{v}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-(--color-text-muted)">
                Oylar bo&apos;yicha: {analysis.byMonth.map((m) => `${formatPeriod(m.period)} — ${m.count} ta, ${compact(m.totalTiyin)}`).join(' · ')}
              </p>

              {/* Rejim */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">1. Qanday hisobga olinsin</h3>
                <div className="grid gap-2 md:grid-cols-3">
                  {MODES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={cn(
                        'rounded-(--radius-control) border p-3 text-left transition-colors',
                        mode === m ? 'border-brand-700 bg-brand-50 ring-1 ring-brand-700' : 'border-(--color-line) hover:bg-(--color-surface-muted)',
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm font-semibold">
                        <span className={cn('size-3.5 rounded-full border-2', mode === m ? 'border-brand-700 bg-brand-700' : 'border-(--color-line-strong)')} />
                        {MODE_INFO[m].label}
                        {m === 'HOLD' && <span className="rounded bg-(--color-income-soft) px-1.5 py-0.5 text-[10px] font-bold text-(--color-income)">TAVSIYA</span>}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-(--color-text-muted)">{MODE_INFO[m].hint}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-(--color-text-muted)">Rejimni keyin ham butun partiya yoki tanlangan vositalar uchun bir bosishda o&apos;zgartirish mumkin.</p>
              </section>

              {/* Joylar */}
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">2. Fayldagi bo&apos;limlar qayerga tegishli</h3>
                <div className="overflow-x-auto rounded-(--radius-control) border border-(--color-line)">
                  <table className="w-full text-sm">
                    <thead className="border-b border-(--color-line) bg-(--color-surface-muted)">
                      <tr>
                        <th className={cn(TH, 'pl-4 text-left')}>Fayldagi «Bo&apos;lim»</th>
                        <th className={cn(TH, 'text-right')}>Soni</th>
                        <th className={cn(TH, 'text-right')}>Summa</th>
                        <th className={cn(TH, 'w-72 pr-4 text-left')}>Tizimda joyi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-(--color-line)">
                      {analysis.places.map((p) => (
                        <tr key={p.placeText}>
                          <td className="py-1.5 pl-4 pr-3">
                            <span className="block">{p.placeText || '— ko‘rsatilmagan —'}</span>
                            <span className="block text-[11px] text-(--color-text-faint)">{p.reason}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{p.count}</td>
                          <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{compact(p.totalTiyin)}</td>
                          <td className="py-1.5 pl-3 pr-4">
                            <select value={mapping[p.placeText] ?? 'center'} onChange={(e) => setMapping((m) => ({ ...m, [p.placeText]: e.target.value }))} className={FIELD}>
                              {groups.map((g) => (
                                <optgroup key={g} label={g}>
                                  {analysis.targets
                                    .filter((t) => t.group === g)
                                    .map((t) => (
                                      <option key={t.value} value={t.value}>
                                        {t.label}
                                      </option>
                                    ))}
                                </optgroup>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  {byTarget.map((t) => (
                    <span key={t.label} className="rounded-full bg-(--color-surface-sunken) px-2.5 py-1">
                      {t.label}: <b>{t.count}</b> ta · {compact(t.total)}
                    </span>
                  ))}
                </div>
              </section>

              {/* Qatorlar */}
              <section className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">3. Tekshiruv</h3>
                  <button type="button" onClick={() => setShowRows(showRows === 'warn' ? null : 'warn')} className="text-xs font-semibold text-brand-700 hover:underline">
                    Izohli qatorlar ({warnRows.length})
                  </button>
                  <button type="button" onClick={() => setShowRows(showRows === 'all' ? null : 'all')} className="text-xs font-semibold text-brand-700 hover:underline">
                    Hamma qatorlar ({analysis.total})
                  </button>
                </div>
                {showRows && (
                  <div className="max-h-80 overflow-auto rounded-(--radius-control) border border-(--color-line)">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-(--color-surface-muted)">
                        <tr>
                          <th className={cn(TH, 'pl-3 text-left')}>Qator</th>
                          <th className={cn(TH, 'text-left')}>Sana</th>
                          <th className={cn(TH, 'text-left')}>Nomi</th>
                          <th className={cn(TH, 'text-left')}>Inventar</th>
                          <th className={cn(TH, 'text-right')}>Summa</th>
                          <th className={cn(TH, 'text-left')}>Qabul qiluvchi</th>
                          <th className={cn(TH, 'pr-3 text-left')}>Izoh</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-(--color-line)">
                        {listRows.map((r) => (
                          <tr key={r.row} className={cn(r.errors.length > 0 && 'bg-(--color-expense-soft)', r.exists && 'text-(--color-text-faint)')}>
                            <td className="py-1 pl-3 tabular-nums">{r.row}</td>
                            <td className="whitespace-nowrap px-3 py-1">{r.date ? formatDate(r.date) : '—'}</td>
                            <td className="px-3 py-1">
                              {r.name}
                              {r.quantity > 1 && <span className="text-(--color-text-muted)"> × {r.quantity}</span>}
                            </td>
                            <td className="px-3 py-1 tabular-nums">{r.inventoryNo ?? '—'}</td>
                            <td className="whitespace-nowrap px-3 py-1 text-right tabular-nums">{compact(r.costTiyin)}</td>
                            <td className="px-3 py-1">{r.holderName ?? '—'}</td>
                            <td className="py-1 pl-3 pr-3">
                              {r.exists && <p>Bazada bor — qayta yozilmaydi</p>}
                              {r.errors.map((m) => (
                                <p key={m} className="text-(--color-expense)">
                                  {m}
                                </p>
                              ))}
                              {r.warnings.map((m) => (
                                <p key={m} className="text-amber-700">
                                  {m}
                                </p>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <label className="block max-w-lg">
                <span className="mb-1 block text-xs font-medium text-(--color-text-muted)">Partiya nomi (keyin shu nom bilan filtrlab, rejimini birdan o&apos;zgartirasiz)</span>
                <input value={batch} onChange={(e) => setBatch(e.target.value)} maxLength={120} className={FIELD} />
              </label>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-(--color-line) bg-(--color-surface-muted) px-5 py-3">
          <Button variant="secondary" onClick={onClose} disabled={Boolean(busy)}>
            Yopish
          </Button>
          <Button onClick={() => void save()} loading={busy === 'save'} disabled={!analysis || okRows.length === 0 || busy === 'analyze'}>
            {analysis && okRows.length ? `${okRows.length} ta vositani saqlash — ${MODE_INFO[mode].short}` : 'Saqlash'}
          </Button>
        </div>
      </div>
    </div>
  );
}