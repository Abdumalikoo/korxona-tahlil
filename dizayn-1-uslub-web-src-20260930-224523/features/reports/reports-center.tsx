'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { reactionsApi } from '@/features/reactions/api';
import { PanelHeader } from '@/features/structure/parts';
import { useAuth } from '@/lib/auth-context';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useEffect, useMemo, useState } from 'react';
import { ReconcilePanel } from './reconcile-panel';
import { downloadHistory, FORMAT_HINT, FORMAT_LABEL, generateReport, reportsApi, type CatalogItem, type HistoryItem, type ReportFormat } from './api';

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]';
const FIELD = 'h-9 w-full rounded-[--radius-control] border border-[--color-line] bg-white px-2.5 text-sm outline-none focus:border-slate-500';
const LABEL = 'mb-1 block text-xs font-medium text-[--color-text-muted]';

// ─────────── Sanalar (Toshkent) ───────────

function today(): string {
  return new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
}

function iso(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
}

function uzDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

interface Preset {
  label: string;
  range: () => { from: string; to: string };
}

const PRESETS: Preset[] = [
  {
    label: 'Joriy oy',
    range: () => {
      const t = today();
      return { from: `${t.slice(0, 7)}-01`, to: t };
    },
  },
  {
    label: "O'tgan oy",
    range: () => {
      const t = today();
      const y = Number(t.slice(0, 4));
      const m = Number(t.slice(5, 7)) - 1;
      return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
    },
  },
  {
    label: 'Joriy chorak',
    range: () => {
      const t = today();
      const y = Number(t.slice(0, 4));
      const q = Math.floor((Number(t.slice(5, 7)) - 1) / 3);
      return { from: iso(y, q * 3, 1), to: t };
    },
  },
  {
    label: "O'tgan chorak",
    range: () => {
      const t = today();
      const y = Number(t.slice(0, 4));
      const q = Math.floor((Number(t.slice(5, 7)) - 1) / 3);
      return { from: iso(y, (q - 1) * 3, 1), to: iso(y, q * 3, 0) };
    },
  },
  {
    label: 'Yil boshidan',
    range: () => {
      const t = today();
      return { from: `${t.slice(0, 4)}-01-01`, to: t };
    },
  },
  {
    label: "O'tgan yil",
    range: () => {
      const y = Number(today().slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    },
  },
];

function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const FORMAT_TONE: Record<ReportFormat, string> = {
  xlsx: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  pptx: 'bg-orange-50 text-orange-800 border-orange-200',
  pdf: 'bg-rose-50 text-rose-800 border-rose-200',
};

function FormatBadge({ format }: { format: ReportFormat }) {
  return <span className={cn('inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold', FORMAT_TONE[format])}>{FORMAT_LABEL[format]}</span>;
}

// ═══════════════════════════════════════════════════════════
// Hisobot kartochkasi
// ═══════════════════════════════════════════════════════════

function ReportCard({ item, active, onSelect }: { item: CatalogItem; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        'flex h-full flex-col rounded-[--radius-card] border bg-white p-5 text-left transition-shadow hover:shadow-md',
        active ? 'border-slate-800 ring-2 ring-slate-800' : 'border-[--color-line]',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[--color-text-faint]">{item.group}</p>
          <h3 className="mt-0.5 text-base font-semibold text-[--color-text]">{item.title}</h3>
        </div>
        <span className={cn('mt-1 inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px]', active ? 'border-slate-800 bg-slate-800 text-white' : 'border-[--color-line] text-transparent')}>
          ✓
        </span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[--color-text-muted]">{item.description}</p>
      <ul className="mt-3 space-y-1 text-xs text-[--color-text]">
        {item.contents.map((c) => (
          <li key={c} className="flex gap-2">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-slate-500" />
            {c}
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
        {item.formats.map((f) => (
          <FormatBadge key={f} format={f} />
        ))}
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════
// Hisobotlar markazi
// ═══════════════════════════════════════════════════════════

export function ReportsCenter() {
  const { isAdmin } = useAuth();
  const catalog = useAsync(() => reportsApi.catalog().then((r) => r.data), []);
  const units = useAsync(() => reactionsApi.lookups().then((r) => r.data.units), []);
  const reactionList = useAsync(() => reactionsApi.list().then((r) => r.data), []);
  const history = useAsync(() => reportsApi.history(50).then((r) => r.data), []);

  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState(() => PRESETS[4]!.range());
  const [unit, setUnit] = useState('');
  const [subject, setSubject] = useState('');
  const [format, setFormat] = useState<ReportFormat>('xlsx');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const items = catalog.data ?? [];
  const current = items.find((c) => c.id === selected) ?? items[0] ?? null;
  useEffect(() => {
    if (!selected && items[0]) setSelected(items[0].id);
  }, [items, selected]);
  useEffect(() => {
    if (current && !current.formats.includes(format)) setFormat(current.formats[0]!);
  }, [current, format]);

  const groups = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const item of items) map.set(item.group, [...(map.get(item.group) ?? []), item]);
    return [...map.entries()];
  }, [items]);

  // Bitta obyekt (munosabat) tanlansa, davr kerak emas — hisobot uning o'z muddati bo'yicha
  const chosenSubject = current?.subject ? subject : '';
  const needsPeriod = Boolean(current?.period) && !chosenSubject;
  const invalid = !current || (needsPeriod && (!range.from || !range.to || range.from > range.to)) || (current.unit === 'required' && !unit);

  const run = async () => {
    if (!current || invalid) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const filename = await generateReport({
        type: current.id,
        from: range.from,
        to: range.to,
        unit: current.unit === 'none' ? undefined : unit || undefined,
        subject: chosenSubject || undefined,
        format,
      });
      setDone(filename);
      history.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Hisobot tayyorlanmadi');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PanelHeader
        title="Hisobotlar"
        description="Hisobot turini, davrni va formatni tanlang — fayl darhol tayyorlanib yuklab olinadi. Barcha raqamlar Daromadlar, Xarajatlar va Xodimlar bo'limlaridan."
      />

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-5">
          {catalog.error ? (
            <Card>
              <ErrorState message={catalog.error} onRetry={catalog.reload} />
            </Card>
          ) : !catalog.data ? (
            <Card>
              <LoadingState label="Hisobotlar ro'yxati" />
            </Card>
          ) : (
            groups.map(([group, list]) => (
              <section key={group}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[--color-text-muted]">{group}</h2>
                <div className="grid gap-4 md:grid-cols-2">
                  {list.map((item) => (
                    <ReportCard key={item.id} item={item} active={current?.id === item.id} onSelect={() => setSelected(item.id)} />
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        <Card className="h-fit xl:sticky xl:top-4">
          <div className="border-b border-[--color-line] px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[--color-text-faint]">Tanlangan hisobot</p>
            <h3 className="mt-0.5 text-base font-semibold">{current?.title ?? '—'}</h3>
          </div>
          <div className="space-y-5 px-5 py-4">
            {current?.subject && (
              <label className="block">
                <span className={LABEL}>{current.subject.label}</span>
                <select value={subject} onChange={(e) => setSubject(e.target.value)} className={FIELD}>
                  <option value="">{current.subject.emptyLabel}</option>
                  {(reactionList.data ?? []).map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} ({uzDate(r.startDate)} – {uzDate(r.dueDate)})
                    </option>
                  ))}
                </select>
                {chosenSubject && <span className="mt-1 block text-xs text-[--color-text-faint]">Batafsil hisobot — munosabatning o&apos;z kuzatuv davri bo&apos;yicha.</span>}
              </label>
            )}

            {needsPeriod && (
              <div>
                <span className={LABEL}>Davr</span>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {PRESETS.map((p) => {
                    const r = p.range();
                    const on = r.from === range.from && r.to === range.to;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => setRange(r)}
                        className={cn(
                          'rounded-full border px-2.5 py-1 text-xs',
                          on ? 'border-slate-800 bg-slate-800 text-white' : 'border-[--color-line] bg-white text-[--color-text-muted] hover:text-[--color-text]',
                        )}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-[--color-text-faint]">dan</span>
                    <input type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className={FIELD} />
                  </label>
                  <label className="block">
                    <span className="mb-0.5 block text-[11px] text-[--color-text-faint]">gacha</span>
                    <input type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className={FIELD} />
                  </label>
                </div>
              </div>
            )}

            {current && !current.period && (
              <p className="rounded-[--radius-control] bg-[--color-surface-muted] px-3 py-2 text-xs text-[--color-text-muted]">
                Bu hisobot barcha to&apos;plangan ma&apos;lumot bo&apos;yicha tuziladi — davr tanlanmaydi.
              </p>
            )}

            {current && current.unit !== 'none' && (
              <label className="block">
                <span className={LABEL}>Hudud{current.unit === 'required' ? '' : ' (ixtiyoriy)'}</span>
                <select value={unit} onChange={(e) => setUnit(e.target.value)} className={FIELD}>
                  {current.unit === 'optional' ? <option value="">Butun korxona</option> : <option value="">Hududni tanlang</option>}
                  {(units.data ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div>
              <span className={LABEL}>Format</span>
              <div className="grid grid-cols-3 gap-1.5">
                {(current?.formats ?? (['xlsx', 'pptx', 'pdf'] as ReportFormat[])).map((f) => (
                  <button
                    key={f}
                    type="button"
                    title={FORMAT_HINT[f]}
                    onClick={() => setFormat(f)}
                    className={cn(
                      'rounded-[--radius-control] border px-2 py-2 text-sm',
                      format === f ? 'border-slate-800 bg-slate-800 font-medium text-white' : 'border-[--color-line] bg-white text-[--color-text-muted] hover:bg-[--color-surface-muted]',
                    )}
                  >
                    {FORMAT_LABEL[f]}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-[--color-text-faint]">{FORMAT_HINT[format]}</p>
            </div>

            <Button fullWidth loading={busy} disabled={invalid} onClick={run}>
              {busy ? 'Tayyorlanmoqda…' : `Yuklab olish (${FORMAT_LABEL[format]})`}
            </Button>
            {error && <p className="text-sm text-[--color-expense]">{error}</p>}
            {done && (
              <p className="rounded-[--radius-control] bg-[--color-income-soft] px-3 py-2 text-xs text-[--color-income]">
                Tayyor: <b>{done}</b> — yuklab olindi va tarixga saqlandi.
              </p>
            )}
          </div>
        </Card>
      </div>

      <ReconcilePanel range={range} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold">Tayyorlangan hisobotlar</h3>
            <p className="mt-0.5 text-xs text-[--color-text-muted]">Har bir hisobot fayli saqlanadi — keyin o&apos;sha holatida qayta yuklab olish mumkin (oxirgi 300 ta).</p>
          </div>
        </div>
        {history.error ? (
          <ErrorState message={history.error} onRetry={history.reload} />
        ) : !history.data ? (
          <LoadingState label="Tarix" />
        ) : history.data.length === 0 ? (
          <EmptyState title="Hali hisobot tayyorlanmagan" description="Yuqorida hisobot turini tanlab, «Yuklab olish»ni bosing." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-[--color-line] bg-[--color-surface-muted]">
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
              <tbody className="divide-y divide-[--color-line]">
                {history.data.map((h) => (
                  <HistoryRow key={h.id} item={h} canDelete={isAdmin} onDeleted={history.reload} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function HistoryRow({ item, canDelete, onDeleted }: { item: HistoryItem; canDelete: boolean; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const created = new Date(new Date(item.createdAt).getTime() + 5 * 3600_000).toISOString();
  return (
    <tr>
      <td className="whitespace-nowrap py-2.5 pl-5 pr-3 tabular-nums">
        {uzDate(created)} <span className="text-[--color-text-faint]">{created.slice(11, 16)}</span>
      </td>
      <td className="px-3 py-2.5 font-medium">{item.title}</td>
      <td className="px-3 py-2.5 text-[--color-text-muted]">{item.params.subtitle ?? `${uzDate(item.params.from)} – ${uzDate(item.params.to)}`}</td>
      <td className="px-3 py-2.5">
        <FormatBadge format={item.format} />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[--color-text-muted]">{sizeText(item.size)}</td>
      <td className="px-3 py-2.5 text-[--color-text-muted]">{item.createdBy ?? '—'}</td>
      <td className="whitespace-nowrap py-2.5 pl-3 pr-5 text-right">
        {error && <span className="mr-2 text-xs text-[--color-expense]">{error}</span>}
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
            className="ml-3 text-xs text-[--color-text-faint] hover:text-[--color-expense]"
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