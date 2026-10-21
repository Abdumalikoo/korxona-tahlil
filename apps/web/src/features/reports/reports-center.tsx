'use client';

import { Card } from '@/components/ui/card';
import { IconDownload, IconSpinner } from '@/components/ui/icons';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { reactionsApi } from '@/features/reactions/api';
import { useAuth } from '@/lib/auth-context';
import { usePeriod } from '@/lib/period';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { QuarterlyReport } from '@/features/bplan/quarterly-report';
import { ReconcilePanel } from './reconcile-panel';
import { ReportView } from './report-view';
import {
  downloadHistory,
  FORMAT_HINT,
  FORMAT_LABEL,
  generateReport,
  previewReport,
  reportsApi,
  type CatalogItem,
  type HistoryItem,
  type ReportFormat,
} from './api';

// ═══════════════════════════════════════════════════════════
// Hisobotlar bo'limi.
// Tepada — hisobot nomlari (yorliqlar) va «Raqamlar tekshiruvi», «Tarix».
// Bittasi bosilsa — pastda o'sha hisobot: davr/hudud tanlovi, Excel · PowerPoint · PDF tugmalari
// va hisobotning o'zi ekranda (jadvallar, grafiklar, hisob-kitoblar raqamlar bilan).
// Tanlangan hisobot manzilda saqlanadi (?r=financial) — havolani ulashish mumkin.
// ═══════════════════════════════════════════════════════════

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';
const FIELD = 'h-9 w-full rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 text-sm outline-none focus:border-brand-400';
const LABEL = 'mb-1 block text-xs font-medium text-(--color-text-muted)';

/** Biznes-reja ijrosi — alohida (o'z reja fayli, belgilash va formulali Excel) */
const PLAN_TAB = { id: 'chorak', title: 'Choraklik ijro (biznes-reja)' } as const;

const EXTRA_TABS = [
  { id: 'reconcile', title: 'Raqamlar tekshiruvi' },
  { id: 'history', title: 'Tarix' },
] as const;

// ─────────── Sanalar (Toshkent) ───────────

function uzDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const FORMAT_TONE: Record<ReportFormat, string> = {
  xlsx: 'bg-(--color-income-soft) text-(--color-income)',
  pptx: 'bg-(--color-warn-soft) text-(--color-warn)',
  pdf: 'bg-(--color-expense-soft) text-(--color-expense)',
};

/** Yuklab olish tugmasi rangi (formatga mos) */
const FORMAT_BUTTON: Record<ReportFormat, string> = {
  xlsx: 'bg-tile-green hover:brightness-95',
  pptx: 'bg-tile-orange hover:brightness-95',
  pdf: 'bg-tile-red hover:brightness-95',
};

function FormatBadge({ format }: { format: ReportFormat }) {
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', FORMAT_TONE[format])}>{FORMAT_LABEL[format]}</span>;
}

// ═══════════════════════════════════════════════════════════
// Hisobotlar markazi
// ═══════════════════════════════════════════════════════════

export function ReportsCenter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const catalog = useAsync(() => reportsApi.catalog().then((r) => r.data), []);

  const items = catalog.data ?? [];
  const requested = params.get('r');
  const tab = requested && (requested === PLAN_TAB.id || items.some((c) => c.id === requested) || EXTRA_TABS.some((t) => t.id === requested)) ? requested : (items[0]?.id ?? null);
  const current = items.find((c) => c.id === tab) ?? null;

  // Davr — yuqori paneldagi umumiy «Davr» (hamma bo'lim va hisobotlar uchun bitta)
  const { range, setRange } = usePeriod();

  const open = (id: string) => router.replace(`${pathname}?r=${id}`, { scroll: false });

  return (
    <div className="space-y-4">
      {/* Tepa panel: hisobot nomlari */}
      <Card className="p-2">
        {catalog.error ? (
          <ErrorState message={catalog.error} onRetry={catalog.reload} />
        ) : !catalog.data ? (
          <div className="flex items-center gap-2 px-3 py-2 text-sm text-(--color-text-muted)">
            <IconSpinner className="size-4 animate-spin" /> Hisobotlar ro&apos;yxati…
          </div>
        ) : (
          <nav className="flex flex-wrap items-center gap-2" aria-label="Hisobotlar">
            {[...items.map((c) => ({ id: c.id, title: c.title })), PLAN_TAB, ...EXTRA_TABS].map((t, i) => {
              const on = t.id === tab;
              const extra = i > items.length;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => open(t.id)}
                  aria-current={on ? 'page' : undefined}
                  className={cn(
                    'whitespace-nowrap rounded-(--radius-control) px-3.5 py-2 text-sm transition-all',
                    on
                      ? 'bg-brand-500 font-semibold text-white shadow-pill'
                      : extra
                        ? 'border border-dashed border-(--color-line-strong) font-medium text-(--color-text-muted) hover:border-brand-300 hover:text-brand-700'
                        : 'bg-(--color-surface-muted) font-medium text-heading hover:bg-brand-50 hover:text-brand-700',
                  )}
                >
                  {t.title}
                </button>
              );
            })}
          </nav>
        )}
      </Card>

      {tab === PLAN_TAB.id ? (
        <QuarterlyReport />
      ) : tab === 'reconcile' ? (
        <ReconcileTab range={range} onRange={setRange} />
      ) : tab === 'history' ? (
        <HistoryTab />
      ) : current ? (
        <ReportTab key={current.id} item={current} range={range} onRange={setRange} />
      ) : catalog.data ? (
        <Card>
          <EmptyState title="Hisobot yo'q" description="Hisobotlar ro'yxati bo'sh" />
        </Card>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Davr tanlovi (umumiy)
// ═══════════════════════════════════════════════════════════

function PeriodField({ range }: { range: { from: string; to: string }; onRange?: (r: { from: string; to: string }) => void }) {
  return (
    <div className="min-w-0">
      <span className={LABEL}>Davr</span>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="money rounded-(--radius-control) border border-(--color-line) bg-(--color-surface-muted) px-3 py-1.5 font-semibold text-heading">
          {uzDate(range.from)} — {uzDate(range.to)}
        </span>
        <span className="text-xs text-(--color-text-muted)">yuqori paneldagi «Davr» tugmasida o&apos;zgartiriladi</span>
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Bitta hisobot
// ═══════════════════════════════════════════════════════════

function ReportTab({ item, range, onRange }: { item: CatalogItem; range: { from: string; to: string }; onRange: (r: { from: string; to: string }) => void }) {
  const units = useAsync(() => (item.unit === 'none' ? Promise.resolve([]) : reactionsApi.lookups().then((r) => r.data.units)), [item.unit]);
  const reactionList = useAsync(() => (item.subject ? reactionsApi.list().then((r) => r.data) : Promise.resolve([])), [Boolean(item.subject)]);

  const [unit, setUnit] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState<ReportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Bitta obyekt (munosabat) tanlansa, davr kerak emas — hisobot uning o'z muddati bo'yicha
  const chosenSubject = item.subject ? subject : '';
  const needsPeriod = item.period && !chosenSubject;
  const invalid = (needsPeriod && (!range.from || !range.to || range.from > range.to)) || (item.unit === 'required' && !unit);

  const request = {
    type: item.id,
    from: needsPeriod ? range.from : '',
    to: needsPeriod ? range.to : '',
    unit: item.unit === 'none' ? undefined : unit || undefined,
    subject: chosenSubject || undefined,
  };

  const preview = useAsync(
    () => (invalid ? Promise.resolve(null) : previewReport(request).then((r) => r.data)),
    [item.id, request.from, request.to, request.unit, request.subject, invalid],
  );

  useEffect(() => {
    setDone(null);
    setError(null);
  }, [request.from, request.to, request.unit, request.subject]);

  const download = async (format: ReportFormat) => {
    if (invalid) return;
    setBusy(format);
    setError(null);
    setDone(null);
    try {
      const filename = await generateReport({ ...request, format });
      setDone(filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hisobot tayyorlanmadi');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Sozlash va yuklab olish */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-faint)">{item.group}</p>
            <h2 className="text-lg font-bold text-heading">{item.title}</h2>
            <p className="mt-0.5 text-sm text-(--color-text-muted)">{item.description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {item.formats.map((f) => (
              <button
                key={f}
                type="button"
                title={FORMAT_HINT[f]}
                disabled={invalid || busy !== null}
                onClick={() => download(f)}
                className={cn(
                  'inline-flex h-10 items-center gap-2 rounded-(--radius-control) px-4 text-sm font-semibold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-50',
                  FORMAT_BUTTON[f],
                )}
              >
                {busy === f ? <IconSpinner className="size-4 animate-spin" /> : <IconDownload className="size-4" />}
                {FORMAT_LABEL[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-(--color-line) pt-4">
          {needsPeriod && <PeriodField range={range} onRange={onRange} />}
          {!item.period && (
            <p className="rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-2 text-xs text-(--color-text-muted)">
              Bu hisobot barcha to&apos;plangan ma&apos;lumot bo&apos;yicha tuziladi — davr tanlanmaydi.
            </p>
          )}

          {item.unit !== 'none' && (
            <label className="block w-64">
              <span className={LABEL}>Hudud{item.unit === 'required' ? '' : ' (ixtiyoriy)'}</span>
              <select value={unit} onChange={(e) => setUnit(e.target.value)} className={FIELD}>
                {item.unit === 'optional' ? <option value="">Butun korxona</option> : <option value="">Hududni tanlang</option>}
                {(units.data ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {item.subject && (
            <label className="block w-80">
              <span className={LABEL}>{item.subject.label}</span>
              <select value={subject} onChange={(e) => setSubject(e.target.value)} className={FIELD}>
                <option value="">{item.subject.emptyLabel}</option>
                {(reactionList.data ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} ({uzDate(r.startDate)} – {uzDate(r.dueDate)})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-(--color-expense)">{error}</p>}
        {done && (
          <p className="mt-3 rounded-(--radius-control) bg-(--color-income-soft) px-3 py-2 text-xs text-(--color-income)">
            Tayyor: <b>{done}</b> — yuklab olindi va «Tarix»ga saqlandi.
          </p>
        )}
      </Card>

      {/* Hisobotning o'zi */}
      {invalid ? (
        <Card>
          <EmptyState title="Hisobot uchun tanlov kerak" description={item.unit === 'required' && !unit ? 'Hududni tanlang' : "Davrni to'g'ri tanlang"} />
        </Card>
      ) : preview.error ? (
        <Card>
          <ErrorState message={preview.error} onRetry={preview.reload} />
        </Card>
      ) : !preview.data ? (
        <Card>
          <LoadingState label="Hisobot tayyorlanmoqda" />
        </Card>
      ) : (
        <div className={cn('relative transition-opacity', preview.loading && 'opacity-60')}>
          {preview.loading && (
            <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs text-(--color-text-muted) shadow-card">
              <IconSpinner className="size-3.5 animate-spin" /> Yangilanmoqda
            </span>
          )}
          <ReportView doc={preview.data} />
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Raqamlar tekshiruvi
// ═══════════════════════════════════════════════════════════

function ReconcileTab({ range, onRange }: { range: { from: string; to: string }; onRange: (r: { from: string; to: string }) => void }) {
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <PeriodField range={range} onRange={onRange} />
      </Card>
      <ReconcilePanel range={range} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Tarix
// ═══════════════════════════════════════════════════════════

function HistoryTab() {
  const { isAdmin } = useAuth();
  const history = useAsync(() => reportsApi.history(50).then((r) => r.data), []);
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3.5">
        <h3 className="text-[15px] font-bold text-heading">Tayyorlangan hisobotlar</h3>
        <p className="mt-0.5 text-xs text-(--color-text-muted)">Har bir hisobot fayli saqlanadi — keyin o&apos;sha holatida qayta yuklab olish mumkin (oxirgi 300 ta).</p>
      </div>
      {history.error ? (
        <ErrorState message={history.error} onRetry={history.reload} />
      ) : !history.data ? (
        <LoadingState label="Tarix" />
      ) : history.data.length === 0 ? (
        <EmptyState title="Hali hisobot tayyorlanmagan" description="Hisobotni tanlab, Excel, PowerPoint yoki PDF tugmasini bosing." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-(--color-line) bg-(--color-surface-muted)">
              <tr>
                <th className={cn(TH, 'pl-5 text-left')}>Sana</th>
                <th className={cn(TH, 'text-left')}>Hisobot</th>
                <th className={cn(TH, 'text-left')}>Davr va hudud</th>
                <th className={cn(TH, 'text-left')}>Format</th>
                <th className={cn(TH, 'text-right')}>Hajmi</th>
                <th className={cn(TH, 'text-left')}>Kim</th>
                <th className={cn(TH, 'pr-5 text-right')} />
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-line)">
              {history.data.map((h) => (
                <HistoryRow key={h.id} item={h} canDelete={isAdmin} onDeleted={history.reload} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function HistoryRow({ item, canDelete, onDeleted }: { item: HistoryItem; canDelete: boolean; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const created = new Date(new Date(item.createdAt).getTime() + 5 * 3600_000).toISOString();
  return (
    <tr>
      <td className="whitespace-nowrap py-2.5 pl-5 pr-3 tabular-nums">
        {uzDate(created)} <span className="text-(--color-text-faint)">{created.slice(11, 16)}</span>
      </td>
      <td className="px-3 py-2.5 font-medium text-heading">{item.title}</td>
      <td className="px-3 py-2.5 text-(--color-text-muted)">{item.params.subtitle ?? `${uzDate(item.params.from)} – ${uzDate(item.params.to)}`}</td>
      <td className="px-3 py-2.5">
        <FormatBadge format={item.format} />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-(--color-text-muted)">{sizeText(item.size)}</td>
      <td className="px-3 py-2.5 text-(--color-text-muted)">{item.createdBy ?? '—'}</td>
      <td className="whitespace-nowrap py-2.5 pl-3 pr-5 text-right">
        {error && <span className="mr-2 text-xs text-(--color-expense)">{error}</span>}
        <button
          type="button"
          disabled={busy}
          className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await downloadHistory(item);
            } catch (e) {
              setError(e instanceof Error ? e.message : "Yuklab bo'lmadi");
            } finally {
              setBusy(false);
            }
          }}
        >
          Yuklab olish
        </button>
        {canDelete && (
          <button
            type="button"
            disabled={busy}
            className="ml-3 text-xs text-(--color-text-faint) hover:text-(--color-expense)"
            onClick={async () => {
              if (!window.confirm(`«${item.filename}» tarixdan o'chirilsinmi?`)) return;
              setBusy(true);
              try {
                await reportsApi.remove(item.id);
                onDeleted();
              } catch (e) {
                setError(e instanceof Error ? e.message : "O'chirilmadi");
              } finally {
                setBusy(false);
              }
            }}
          >
            O&apos;chirish
          </button>
        )}
      </td>
    </tr>
  );
}