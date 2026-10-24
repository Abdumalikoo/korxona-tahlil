'use client';

import { Pagination } from '@/components/shared/pagination';
import { SearchInput } from '@/components/shared/search-input';
import { SourceActions } from '@/components/shared/source-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { IconAlert, IconCheck, IconSpinner, IconUpload } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useRef, useState } from 'react';
import { analyzeHrFile, downloadHrTemplate, exportHrSheet, hrSheetsApi, type HrAnalyze, type HrOverview, type HrSheetCode, type HrSheetInfo } from './api';

// ═══════════════════════════════════════════════════════════
// Xodimlar › Ma'lumotnomalar: 10, 16, 37, 51-jadval.
//   Shablon (asl shaklda) → to'ldirilgan faylni yuklash → tahlil (ustunlar, xatolar, takrorlar, avvalgisiga nisbatan
//   farq, bo'limlar) → «Saqlash». Saqlangani «miya»ni oziqlaydi: bo'lim ish haqi ro'yxatlari, xodim kartasi.
//   Shaxsiy ustunlar (pasport, telefon, manzil …) jadvalda yashirin — to'liq faqat xodim kartasida.
// ═══════════════════════════════════════════════════════════

type ToastState = { message: string; tone?: 'success' | 'error' } | null;

export function HrSheetsView({ onOpenPerson }: { onOpenPerson: (pinfl: string) => void }) {
  const overview = useAsync(() => hrSheetsApi.overview(), []);
  const [active, setActive] = useState<HrSheetCode>('J10');
  const data = overview.data?.data ?? null;
  const sheet = data?.sheets.find((s) => s.code === active) ?? null;

  if (overview.loading && !data) return <LoadingState />;
  if (overview.error) return <ErrorState message={overview.error} onRetry={overview.reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <MiyaSummary data={data} />

      <div className="flex flex-wrap gap-2">
        {data.sheets.map((s) => (
          <button
            key={s.code}
            type="button"
            onClick={() => setActive(s.code)}
            className={cn(
              'flex items-center gap-2 rounded-(--radius-control) border px-3.5 py-2 text-sm transition-colors',
              active === s.code ? 'border-brand-600 bg-brand-600 text-white shadow-sm' : 'border-(--color-line) bg-white text-heading hover:border-brand-400',
            )}
          >
            <span className="font-semibold">{s.label}</span>
            <span className={cn('rounded-full px-1.5 text-[11px]', active === s.code ? 'bg-white/20' : s.current ? 'bg-emerald-50 text-emerald-700' : 'bg-(--color-surface-muted) text-(--color-text-faint)')}>
              {s.current ? s.current.count : '—'}
            </span>
          </button>
        ))}
      </div>

      {sheet && <SheetPanel key={sheet.code} sheet={sheet} onChanged={overview.reload} onOpenPerson={onOpenPerson} />}
    </div>
  );
}

function MiyaSummary({ data }: { data: HrOverview }) {
  const p = data.people;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Miya — ma&apos;lumotnomalardan</p>
          <p className="mt-1 text-2xl font-bold text-heading">
            {p.total} <span className="text-sm font-medium text-(--color-text-muted)">xodim (JShShIR bo&apos;yicha)</span>
          </p>
        </div>
        <Stat label="Ishlayotgan" value={p.working} />
        <Stat label="Xodimlar bazasida" value={p.inRegistry} />
        <Stat label="Bazada yo'q" value={p.notInRegistry} tone={p.notInRegistry ? 'warn' : undefined} />
        <div className="ml-auto max-w-xl">
          <p className="text-xs text-(--color-text-muted)">Tuzilmasi bo&apos;yicha bo&apos;limlarga — bo&apos;lim ish haqi shablonida o&apos;zi chiqadi:</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {data.units.length ? (
              data.units.map((u) => (
                <span key={u.unit} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800">
                  {u.label} · {u.count}
                </span>
              ))
            ) : (
              <span className="text-xs text-(--color-text-faint)">hali yo&apos;q</span>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'warn' }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money text-lg font-semibold', tone === 'warn' ? 'text-amber-700' : 'text-heading')}>{value}</p>
    </div>
  );
}

// ─────────── Bitta jadval ───────────

function SheetPanel({ sheet, onChanged, onOpenPerson }: { sheet: HrSheetInfo; onChanged: () => void; onOpenPerson: (pinfl: string) => void }) {
  const [analysis, setAnalysis] = useState<HrAnalyze | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<'template' | 'export' | 'restore' | 'clear' | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState<'restore' | 'clear' | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [q, setQ] = useState('');
  const [unit, setUnit] = useState('');
  const [page, setPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const rows = useAsync(() => hrSheetsApi.rows(sheet.code, { q: q || undefined, unit: unit || undefined, page, limit: 50 }), [sheet.code, q, unit, page, sheet.current?.uploadedAt]);

  async function handleFile(file: File) {
    if (!/\.xlsx$/i.test(file.name)) {
      setToast({ message: 'Faqat Excel (.xlsx) fayl yuklang', tone: 'error' });
      return;
    }
    setUploading(true);
    try {
      setAnalysis(await analyzeHrFile(sheet.code, file));
    } catch (err) {
      setToast({ message: errorMessage(err, "Faylni o'qib bo'lmadi"), tone: 'error' });
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function save() {
    if (!analysis) return;
    setSaving(true);
    try {
      const r = (await hrSheetsApi.commit(sheet.code, analysis.token)).data;
      setToast({ tone: 'success', message: `${sheet.label}: ${r.count} qator saqlandi — miya yangilandi` });
      setAnalysis(null);
      onChanged();
    } catch (err) {
      setToast({ message: errorMessage(err, 'Saqlashda xatolik'), tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  async function run(kind: 'template' | 'export' | 'restore' | 'clear') {
    setBusy(kind);
    try {
      if (kind === 'template') await downloadHrTemplate(sheet.code, sheet.no);
      else if (kind === 'export') await exportHrSheet(sheet.code, sheet.no);
      else if (kind === 'restore') {
        const r = (await hrSheetsApi.restore(sheet.code)).data;
        setToast({ tone: 'success', message: `Oldingi holatga qaytarildi: ${r.count} qator` });
        onChanged();
      } else {
        await hrSheetsApi.clear(sheet.code);
        setToast({ tone: 'success', message: `${sheet.label} tozalandi — «Oldingi holatga qaytarish» bilan qaytarish mumkin` });
        onChanged();
      }
    } catch (err) {
      setToast({ message: errorMessage(err, 'Xatolik'), tone: 'error' });
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  }

  const list = rows.data?.data ?? null;
  const cols = sheet.columns.filter((c) => c.key !== 'tr');

  return (
    <div className="space-y-4">
      <SourceActions
        upload={{
          label: 'Faylni yuklash',
          onClick: () => inputRef.current?.click(),
          loading: uploading,
          disabled: Boolean(analysis),
          hint: analysis ? 'Avval joriy tahlilni saqlang yoki bekor qiling' : `To'ldirilgan ${sheet.no}-jadval`,
        }}
        template={{ label: `Shablon · ${sheet.no}-jadval`, onClick: () => void run('template'), loading: busy === 'template' }}
        download={{ label: "Excel'ga yuklab olish", onClick: () => void run('export'), loading: busy === 'export', disabled: !sheet.current }}
        extra={
          <div className="flex flex-wrap items-center gap-2">
            {sheet.hasPrev && (
              <Button variant="ghost" size="sm" onClick={() => setConfirm('restore')} loading={busy === 'restore'}>
                Oldingi holatga qaytarish
              </Button>
            )}
            {sheet.current && (
              <Button variant="ghost" size="sm" className="text-(--color-text-muted) hover:text-(--color-expense)" onClick={() => setConfirm('clear')} loading={busy === 'clear'}>
                Tozalash
              </Button>
            )}
          </div>
        }
        note={
          <>
            {sheet.hint}. Har yuklash — jadvalning yangi to&apos;liq holati (faylda yo&apos;qlar shu jadvaldan chiqadi; oldingisini qaytarish mumkin).
            {sheet.current ? (
              <>
                {' '}
                Hozir: <b>{sheet.current.fileName}</b> · {formatDateTime(sheet.current.uploadedAt)}
                {sheet.current.uploadedBy ? ` · ${sheet.current.uploadedBy}` : ''} · {sheet.current.count} qator.
              </>
            ) : (
              ' Hali yuklanmagan.'
            )}
          </>
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {!analysis && !sheet.current && (
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
                <IconSpinner className="size-8 animate-spin text-brand-700" />
              ) : (
                <>
                  <IconUpload className="size-8 text-(--color-text-faint)" strokeWidth={1.5} />
                  <p className="text-sm font-medium">{sheet.no}-jadvalni shu yerga tashlang</p>
                  <p className="text-xs text-(--color-text-muted)">yoki bosib tanlang · sarlavha qatori va ustunlar nomi bo&apos;yicha o&apos;zi topiladi</p>
                </>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {analysis && <AnalysisCard a={analysis} sheet={sheet} saving={saving} onCancel={() => setAnalysis(null)} onSave={() => void save()} />}

      {/* Saqlangan ma'lumot */}
      {sheet.current && (
        <Card className="overflow-hidden">
          <CardHeader
            title={`${sheet.label} — saqlangan`}
            description={list ? `${list.total} qator${q || unit ? ' (filtr bo‘yicha)' : ''} · qatorni bosing — xodim kartasi (miya)` : '…'}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <SearchInput
                  value={q}
                  onChange={(v) => {
                    setQ(v);
                    setPage(1);
                  }}
                  placeholder="F.I.Sh., JShShIR, tuzilma…"
                  className="w-64"
                />
                <select
                  value={unit}
                  onChange={(e) => {
                    setUnit(e.target.value);
                    setPage(1);
                  }}
                  className="h-9 rounded-(--radius-control) border border-(--color-line-strong) bg-white px-2 text-sm"
                >
                  <option value="">Barcha bo&apos;limlar</option>
                  <option value="FERMER">Fermer xo&apos;jaligi</option>
                  <option value="TAX_FREE">Tax free</option>
                  <option value="MARKSHEYDER">Marksheyder</option>
                  <option value="BUXGALTERIYA">Buxgalteriya xizmatlari</option>
                  <option value="NONE">Bo&apos;limi aniqlanmagan</option>
                </select>
              </div>
            }
          />
          {rows.loading && !list ? (
            <LoadingState />
          ) : rows.error ? (
            <ErrorState message={rows.error} onRetry={rows.reload} />
          ) : !list || list.rows.length === 0 ? (
            <EmptyState title="Topilmadi" description="Qidiruv yoki bo'lim filtrini o'zgartiring" />
          ) : (
            <>
              <div className="max-h-[620px] overflow-auto">
                <table className="w-full min-w-max border-separate border-spacing-0 text-xs">
                  <thead className="sticky top-0 z-[2] bg-(--color-surface-muted)">
                    <tr>
                      <th className="sticky left-0 z-[3] border-b border-(--color-line) bg-(--color-surface-muted) px-2 py-2 text-right font-semibold text-(--color-text-muted)">№</th>
                      <th className="border-b border-(--color-line) px-2 py-2 text-left font-semibold text-(--color-text-muted)">Bo&apos;lim (miya)</th>
                      {cols.map((c) => (
                        <th key={c.key} className="max-w-[16rem] border-b border-(--color-line) px-2 py-2 text-left font-semibold whitespace-normal text-(--color-text-muted)">
                          {c.header}
                          {c.sensitive && (
                            <span className="ml-1 rounded bg-(--color-surface-muted) px-1 text-[10px] font-normal normal-case text-(--color-text-faint)" title="Ro'yxatda yashirin — to'liq xodim kartasida">
                              yashirin
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.rows.map((r) => (
                      <tr
                        key={r.n}
                        onClick={() => r.pinfl && onOpenPerson(r.pinfl)}
                        className={cn('align-top', r.pinfl ? 'cursor-pointer hover:bg-brand-50/50' : 'opacity-70')}
                        title={r.pinfl ? 'Xodim kartasini ochish' : "Xodim aniqlanmadi (F.I.Sh. 10/16-jadvaldagi bilan mos kelmadi)"}
                      >
                        <td className="sticky left-0 z-[1] border-b border-(--color-line) bg-white px-2 py-1.5 text-right text-(--color-text-faint)">{r.n}</td>
                        <td className="border-b border-(--color-line) px-2 py-1.5 whitespace-nowrap">
                          {r.unitLabel ? <Badge tone="brand">{r.unitLabel}</Badge> : <span className="text-(--color-text-faint)">—</span>}
                          {r.pinfl && !r.inRegistry && <span className="ml-1 text-[10px] text-amber-700" title="Xodimlar bazasida yo'q">bazada yo&apos;q</span>}
                        </td>
                        {cols.map((c) => (
                          <td key={c.key} className={cn('max-w-[16rem] border-b border-(--color-line) px-2 py-1.5', c.kind === 'pinfl' && 'money', c.key === 'fio' && 'font-medium text-heading')}>
                            <span className="line-clamp-2">{r.cells[c.key] ?? ''}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={list.page} totalPages={Math.max(1, Math.ceil(list.total / list.limit))} total={list.total} limit={list.limit} onChange={setPage} />
            </>
          )}
        </Card>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'restore' ? 'Oldingi holatga qaytarish' : 'Jadvalni tozalash'}
        message={
          confirm === 'restore'
            ? `${sheet.label}: oldingi yuklangan holat qaytadi, hozirgisi «oldingi» bo'lib qoladi (yana qaytarish mumkin).`
            : `${sheet.label}: saqlangan ma'lumot olib tashlanadi va miyadan chiqadi. «Oldingi holatga qaytarish» bilan qaytarish mumkin.`
        }
        confirmLabel={confirm === 'restore' ? 'Qaytarish' : 'Tozalash'}
        danger={confirm === 'clear'}
        loading={busy === 'restore' || busy === 'clear'}
        onConfirm={() => confirm && void run(confirm)}
        onCancel={() => setConfirm(null)}
      />
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
    </div>
  );
}

// ─────────── Tahlil ───────────

function AnalysisCard({ a, sheet, saving, onCancel, onSave }: { a: HrAnalyze; sheet: HrSheetInfo; saving: boolean; onCancel: () => void; onSave: () => void }) {
  const missing = a.columns.filter((c) => !c.found);
  const show = sheet.columns.filter((c) => c.key !== 'tr').slice(0, 9);
  return (
    <Card className="overflow-hidden">
      <CardHeader title={`Tahlil: ${a.fileName}`} description={`«${a.sheetName}» varag'i · sarlavha ${a.headerRow}-qatorda — hali saqlanmagan`} />
      <CardBody className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Saqlanadigan qatorlar" value={a.total} />
          <Tile label="Xato qatorlar" value={a.invalidCount} tone={a.invalidCount ? 'bad' : undefined} />
          <Tile label="Takror (saqlanmaydi)" value={a.duplicateCount} tone={a.duplicateCount ? 'warn' : undefined} />
          <Tile
            label={sheet.byName ? "F.I.Sh. bo'yicha topildi" : 'Xodimlar bazasida'}
            value={sheet.byName ? a.people.identified : a.people.inRegistry}
            sub={sheet.byName ? `topilmadi: ${a.people.unmatchedNames}${a.people.ambiguousNames ? ` · bir nechta: ${a.people.ambiguousNames}` : ''}` : `bazada yo'q: ${a.people.notInRegistry} · boshqa jadvallarda: ${a.people.alsoInOtherSheets}`}
          />
        </div>

        {a.diff && (
          <p className="rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted) px-3 py-2 text-xs">
            Hozirgi holatga ({a.current?.count} qator) nisbatan: <b className="text-emerald-700">+{a.diff.added} yangi</b> · <b className="text-(--color-expense)">−{a.diff.removed} chiqib ketadi</b>
            {!sheet.multi && (
              <>
                {' '}
                · <b className="text-amber-700">{a.diff.changed} o&apos;zgargan</b>
              </>
            )}{' '}
            · {a.diff.same} o&apos;zgarmagan
          </p>
        )}

        {a.units.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-(--color-text-muted)">Miya — tuzilmasi bo&apos;yicha bo&apos;limlarga:</span>
            {a.units.map((u) => (
              <span key={u.unit} className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-800">
                {u.label} · {u.count}
              </span>
            ))}
          </div>
        )}

        {missing.length > 0 && (
          <p className="rounded-(--radius-control) border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Faylda topilmagan ustunlar (bo&apos;sh saqlanadi): {missing.map((c) => `«${c.header}»`).join(', ')}
          </p>
        )}
        {a.invalidCount > 0 && (
          <p className="rounded-(--radius-control) border border-(--color-expense)/30 bg-(--color-expense-soft) px-3 py-2 text-xs text-(--color-expense)">
            Saqlanmaydigan qatorlar: {a.invalid.slice(0, 12).map((x) => `${x.row}-qator — ${x.reason}`).join('; ')}
            {a.invalidCount > 12 ? ` … (jami ${a.invalidCount})` : ''}
          </p>
        )}
        {a.duplicateCount > 0 && (
          <p className="rounded-(--radius-control) border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Takror qatorlar (birinchisi olinadi): {a.duplicates.slice(0, 10).map((x) => `${x.row}-qator (${x.firstRow}-qatordagi bilan)`).join('; ')}
            {a.duplicateCount > 10 ? ' …' : ''}
          </p>
        )}

        <div className="max-h-[360px] overflow-auto rounded-(--radius-control) border border-(--color-line)">
          <table className="w-full min-w-max border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 bg-(--color-surface-muted)">
              <tr>
                {show.map((c) => (
                  <th key={c.key} className="border-b border-(--color-line) px-2 py-1.5 text-left font-semibold text-(--color-text-muted)">
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {a.preview.map((r, i) => (
                <tr key={i}>
                  {show.map((c) => (
                    <td key={c.key} className="max-w-[14rem] truncate border-b border-(--color-line) px-2 py-1">
                      {r[c.key] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {a.total > a.preview.length && <p className="px-2 py-1.5 text-[11px] text-(--color-text-muted)">… yana {a.total - a.preview.length} qator</p>}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {a.diff && a.diff.removed > 0 && (
            <span className="mr-auto flex items-center gap-1.5 text-xs text-amber-800">
              <IconAlert className="size-4" />
              {a.diff.removed} ta {sheet.multi ? 'qator' : 'xodim'} bu jadvaldan chiqadi (faylda yo&apos;q)
            </span>
          )}
          <Button variant="ghost" onClick={onCancel} disabled={saving}>
            Bekor qilish
          </Button>
          <Button onClick={onSave} loading={saving}>
            <IconCheck className="size-4" />
            Saqlash ({a.total} qator)
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: 'bad' | 'warn' }) {
  return (
    <div className={cn('rounded-(--radius-control) border bg-white px-3 py-2.5', tone === 'bad' ? 'border-(--color-expense)/30' : tone === 'warn' ? 'border-amber-200' : 'border-(--color-line)')}>
      <p className="text-[11px] uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money text-xl font-semibold', tone === 'bad' ? 'text-(--color-expense)' : tone === 'warn' ? 'text-amber-700' : 'text-heading')}>{value}</p>
      {sub && <p className="text-[11px] text-(--color-text-muted)">{sub}</p>}
    </div>
  );
}