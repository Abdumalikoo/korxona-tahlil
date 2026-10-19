'use client';

import { Card } from '@/components/ui/card';
import { SubTabs } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useBrief } from '@/lib/view-mode';
import { Mark } from '@/features/reactions/mark';
import type { ItemFilter, MarkItem } from '@/features/reactions/api';
import { createContext, useContext, useEffect, useState } from 'react';
import type { Cell, ColumnFormat, DocBlock, DocChart, DocColumn, DocFormulas, DocTable, ReportDoc, Tone } from './api';

// ═══════════════════════════════════════════════════════════
// Hisobotni ekranda ko'rsatish — Excel / PowerPoint / PDF bilan aynan bir xil hujjatdan.
// Bo'limlar yorliqlarda: bittasi ochiladi, qolganlari tepada turadi (uzun skroll yo'q).
// ═══════════════════════════════════════════════════════════

const TONE_TEXT: Record<Tone, string> = {
  good: 'text-(--color-income)',
  bad: 'text-(--color-expense)',
  warn: 'text-(--color-warn)',
  neutral: '',
};

const TONE_CHIP: Record<Tone, string> = {
  good: 'bg-(--color-income-soft) text-(--color-income)',
  bad: 'bg-(--color-expense-soft) text-(--color-expense)',
  warn: 'bg-(--color-warn-soft) text-(--color-warn)',
  neutral: 'bg-(--color-surface-sunken) text-heading',
};

// ─────────── Formatlash (backend reports.format.ts bilan bir xil) ───────────

function grouped(value: number, digits = 0): string {
  const fixed = Math.abs(value).toFixed(digits);
  const [int, frac] = fixed.split('.');
  const g = int!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${value < 0 ? '−' : ''}${g}${frac ? `,${frac}` : ''}`;
}

function pctText(value: number, signed: boolean): string {
  const sign = signed ? (value > 0 ? '+' : value < 0 ? '−' : '') : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(1).replace('.', ',')}%`;
}

function cellText(value: Cell, format: ColumnFormat = 'text'): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  switch (format) {
    case 'money':
    case 'int':
      return grouped(value);
    case 'mln':
      return grouped(value / 1e6, 1);
    case 'pct':
      return pctText(value, false);
    case 'signedPct':
      return pctText(value, true);
    case 'decimal':
      return value.toFixed(2).replace('.', ',');
    case 'decimal3':
      return value.toFixed(3).replace('.', ',');
    default:
      return String(value);
  }
}

function cellTone(value: Cell, column: DocColumn | undefined, rowDirection: 'up' | 'down' | null | undefined): Tone {
  if (typeof value === 'string') return column?.tones?.[value] ?? 'neutral';
  const by = column?.toneBy === 'row' ? rowDirection : column?.toneBy;
  if (!by || typeof value !== 'number' || Math.abs(value) < 0.5) return 'neutral';
  return value > 0 === (by === 'up') ? 'good' : 'bad';
}

// ─────────── Bloklar ───────────

function Kpis({ items }: { items: { label: string; value: string; sub?: string; tone?: Tone }[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((k) => (
        <div key={k.label} className="rounded-(--radius-control) border border-(--color-line) bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{k.label}</p>
          <p className={cn('mt-1 text-xl font-bold text-heading', k.tone && TONE_TEXT[k.tone])}>{k.value}</p>
          {k.sub && <p className="mt-0.5 text-xs text-(--color-text-muted)">{k.sub}</p>}
        </div>
      ))}
    </div>
  );
}

/** Belgining kelib chiqishi: «Hisobotlar › Hisobot nomi» */
const OriginContext = createContext('Hisobotlar');

function Table({ block }: { block: DocTable }) {
  const numeric = (f?: ColumnFormat) => Boolean(f && f !== 'text');
  const origin = useContext(OriginContext);
  // Munosabatga belgilash (sariq «+ Munosabat» yoqilganda birinchi katakda ko'rinadi)
  const markOf = (r: number): MarkItem | null => {
    const m = block.marks?.[r];
    return m ? { kind: m.kind, label: m.label, filter: m.filter as ItemFilter, origin } : null;
  };
  return (
    <div>
      {block.title && <h4 className="mb-2 text-sm font-bold text-heading">{block.title}</h4>}
      <div className="overflow-x-auto rounded-(--radius-control) border border-(--color-line)">
        <table className="w-full text-sm">
          <thead className="bg-brand-700 text-white">
            <tr>
              {block.columns.map((c, i) => (
                <th key={`${c.label}-${i}`} className={cn('whitespace-nowrap px-3 py-2 text-[11px] font-semibold', numeric(c.format) ? 'text-right' : 'text-left')}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-(--color-line)">
            {block.rows.map((row, r) => (
              <tr key={r} className="even:bg-(--color-surface-muted)/60">
                {block.columns.map((c, i) => (
                  <td
                    key={i}
                    className={cn(
                      'px-3 py-1.5',
                      numeric(c.format) ? 'whitespace-nowrap text-right tabular-nums' : 'min-w-[8rem]',
                      TONE_TEXT[cellTone(row[i] ?? null, c, block.rowTone?.[r])],
                    )}
                  >
                    {i === 0 && block.marks ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Mark item={markOf(r)} />
                        {cellText(row[i] ?? null, c.format)}
                      </span>
                    ) : (
                      cellText(row[i] ?? null, c.format)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {block.total && (
            <tfoot className="border-t-2 border-(--color-line-strong) bg-(--color-surface-sunken) font-bold text-heading">
              <tr>
                {block.columns.map((c, i) => (
                  <td key={i} className={cn('px-3 py-2', numeric(c.format) ? 'whitespace-nowrap text-right tabular-nums' : '')}>
                    {cellText(block.total![i] ?? null, c.format)}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {block.note && <p className="mt-1.5 text-xs text-(--color-text-muted)">{block.note}</p>}
    </div>
  );
}

/** Hisob-kitob yoki formulalar ro'yxati */
function Formulas({ block, workings }: { block: DocFormulas; workings: boolean }) {
  return (
    <div className={cn('rounded-(--radius-control) border', workings ? 'border-brand-200 bg-brand-50/50' : 'border-(--color-line) bg-white')}>
      <div className="flex items-center gap-2 border-b border-inherit px-4 py-2.5">
        <span className={cn('flex size-6 items-center justify-center rounded-md text-xs font-bold', workings ? 'bg-brand-600 text-white' : 'bg-(--color-surface-sunken) text-heading')}>
          {workings ? '=' : 'ƒ'}
        </span>
        <h4 className="text-sm font-bold text-heading">{block.title ?? (workings ? 'Hisob-kitob' : 'Hisoblash formulalari')}</h4>
      </div>
      <dl className="divide-y divide-(--color-line)">
        {block.items.map((f, i) => (
          <div key={`${f.name}-${i}`} className="grid gap-1 px-4 py-2 md:grid-cols-[minmax(10rem,16rem)_1fr] md:gap-4">
            <dt className="text-xs font-semibold text-heading">{f.name}</dt>
            <dd className="font-mono text-xs leading-relaxed text-(--color-text)">{f.formula}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Oddiy grafik: ustunlar yonma-yon (yoki ustma-ust), gorizontal ustunlar yoki chiziq */
function Chart({ block }: { block: DocChart }) {
  const colors = block.series.map((s, i) => `#${s.color ?? ['2D527F', '2F7A57', 'B3423B', 'B45309', '7A9BC2', '94A3B8'][i % 6]}`);

  if (block.kind === 'barh') {
    const s = block.series[0];
    const max = Math.max(1e-9, ...(s?.values ?? []).map((v) => Math.abs(v)));
    return (
      <div>
        <h4 className="mb-2 text-sm font-bold text-heading">
          {block.title} <span className="font-normal text-(--color-text-muted)">({block.unit})</span>
        </h4>
        <div className="space-y-1.5">
          {block.labels.map((label, i) => {
            const v = s?.values[i] ?? 0;
            return (
              <div key={`${label}-${i}`} className="grid grid-cols-[minmax(6rem,11rem)_1fr_5rem] items-center gap-3 text-xs">
                <span className="truncate text-(--color-text)" title={label}>
                  {label}
                </span>
                <span className="h-3 overflow-hidden rounded-full bg-(--color-surface-sunken)">
                  <span className="block h-full rounded-full" style={{ width: `${(Math.abs(v) / max) * 100}%`, background: v < 0 ? '#e5484d' : colors[0] }} />
                </span>
                <span className="text-right tabular-nums text-heading">{grouped(v, Math.abs(v) < 10 ? 1 : 0)}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const W = 760;
  const H = 240;
  const pad = { l: 56, r: 12, t: 12, b: 34 };
  const n = block.labels.length;
  const bars = block.series.filter((s) => block.kind === 'bar' && !s.asLine);
  const lines = block.series.filter((s) => block.kind === 'line' || s.asLine);
  const stackTotals = block.labels.map((_, i) => bars.reduce((a, s) => a + Math.max(0, s.values[i] ?? 0), 0));
  const all = [...block.series.flatMap((s) => s.values), ...(block.stacked ? stackTotals : []), 0];
  const max = Math.max(...all);
  const min = Math.min(...all);
  const span = max - min || 1;
  const y = (v: number) => pad.t + ((max - v) / span) * (H - pad.t - pad.b);
  const slot = (W - pad.l - pad.r) / Math.max(1, n);
  const x0 = (i: number) => pad.l + i * slot;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + span * t);
  const every = Math.max(1, Math.ceil(n / 14));

  return (
    <div>
      <h4 className="mb-2 text-sm font-bold text-heading">
        {block.title} <span className="font-normal text-(--color-text-muted)">({block.unit})</span>
      </h4>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={block.title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e4ebf7" strokeDasharray="3 3" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#98a4ba">
              {grouped(t, Math.abs(span) < 10 ? 1 : 0)}
            </text>
          </g>
        ))}
        {bars.length > 0 &&
          block.labels.map((_, i) => {
            if (block.stacked) {
              let acc = 0;
              return bars.map((s, k) => {
                const v = Math.max(0, s.values[i] ?? 0);
                const top = y(acc + v);
                const h = y(acc) - top;
                acc += v;
                return <rect key={`${i}-${k}`} x={x0(i) + slot * 0.18} width={slot * 0.64} y={top} height={Math.max(0, h)} fill={colors[block.series.indexOf(s)]} />;
              });
            }
            // Yonma-yon: har bir qator o'z ustuni (bir-birining orqasida emas)
            const w = (slot * 0.76) / bars.length;
            return bars.map((s, k) => {
              const v = s.values[i] ?? 0;
              const top = y(Math.max(0, v));
              const h = Math.abs(y(v) - y(0));
              return <rect key={`${i}-${k}`} x={x0(i) + slot * 0.12 + k * w} width={Math.max(1, w - 1)} y={top} height={Math.max(v === 0 ? 0 : 1, h)} rx={1.5} fill={colors[block.series.indexOf(s)]} />;
            });
          })}
        {lines.map((s) => (
          <polyline
            key={s.name}
            fill="none"
            stroke={colors[block.series.indexOf(s)]}
            strokeWidth={2.2}
            points={s.values.map((v, i) => `${x0(i) + slot / 2},${y(v)}`).join(' ')}
          />
        ))}
        {block.labels.map((label, i) =>
          i % every === 0 ? (
            <text key={`${label}-${i}`} x={x0(i) + slot / 2} y={H - pad.b + 14} textAnchor="middle" fontSize="10" fill="#64718b">
              {label.length > 12 ? `${label.slice(0, 11)}…` : label}
            </text>
          ) : null,
        )}
      </svg>
      {block.series.length > 1 && (
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--color-text-muted)">
          {block.series.map((s, i) => (
            <span key={s.name} className="inline-flex items-center gap-1.5">
              <span className={cn('inline-block', s.asLine || block.kind === 'line' ? 'h-0.5 w-4' : 'size-2.5 rounded-sm')} style={{ background: colors[i] }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Block({ block }: { block: DocBlock }) {
  /** Qisqa rejim: diagramma bloklari yashiriladi */
  const brief = useBrief();
  switch (block.type) {
    case 'kpis':
      return <Kpis items={block.items} />;
    case 'table':
      return <Table block={block} />;
    case 'chart':
      // Qisqa rejimda diagrammalar ko'rsatilmaydi (To'liq rejimda va Excel/PDF'da bor)
      return brief ? null : <Chart block={block} />;
    case 'formulas':
      return <Formulas block={block} workings={Boolean(block.headers)} />;
    case 'notes':
      return (
        <div className="rounded-(--radius-control) border-l-4 border-brand-500 bg-white px-4 py-3">
          {block.title && <h4 className="mb-1.5 text-sm font-bold text-heading">{block.title}</h4>}
          <ol className="list-decimal space-y-1 pl-5 text-sm text-(--color-text)">
            {block.items.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ol>
        </div>
      );
  }
}

// ─────────── Hujjat ───────────

export function ReportView({ doc }: { doc: ReportDoc }) {
  const tabs = [{ value: 'summary', label: 'Xulosa' }, ...doc.sections.map((s, i) => ({ value: String(i), label: s.title }))];
  const [tab, setTab] = useState('summary');
  // Hisobot almashsa — xulosadan boshlanadi
  useEffect(() => setTab('summary'), [doc.fileBase]);

  const section = tab === 'summary' ? null : doc.sections[Number(tab)];

  return (
    <OriginContext.Provider value={`Hisobotlar › ${doc.title}`}>
      <div className="space-y-4">
        <Card className="p-2">
          <SubTabs value={tab} onChange={setTab} options={tabs} />
        </Card>

        {section ? (
          <Card className="space-y-4 p-5">
            <div>
              <h3 className="text-lg font-bold text-heading">{section.title}</h3>
              {section.intro && <p className="mt-0.5 text-sm text-(--color-text-muted)">{section.intro}</p>}
            </div>
            {section.blocks.map((b, i) => (
              <Block key={i} block={b} />
            ))}
          </Card>
        ) : (
          <Card className="space-y-4 p-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-faint)">{doc.kind}</p>
              <h3 className="text-xl font-bold text-heading">{doc.title}</h3>
              <p className="text-sm text-(--color-text-muted)">{doc.subtitle}</p>
            </div>
            {doc.meta.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {doc.meta.map((m) => (
                  <span key={m} className={cn('rounded-full px-3 py-1 text-xs font-medium', TONE_CHIP.neutral)}>
                    {m}
                  </span>
                ))}
              </div>
            )}
            {doc.highlights.length > 0 && (
              <div className="rounded-(--radius-control) border-l-4 border-brand-500 bg-brand-50/50 px-4 py-3">
                <h4 className="mb-1.5 text-sm font-bold text-heading">Asosiy xulosalar</h4>
                <ol className="list-decimal space-y-1 pl-5 text-sm text-(--color-text)">
                  {doc.highlights.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ol>
              </div>
            )}
            <div>
              <h4 className="mb-2 text-sm font-bold text-heading">Hisobot tarkibi</h4>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {doc.sections.map((s, i) => (
                  <button
                    key={s.title}
                    type="button"
                    onClick={() => setTab(String(i))}
                    className="flex items-center gap-3 rounded-(--radius-control) border border-(--color-line) bg-white px-3 py-2.5 text-left text-sm transition-colors hover:border-brand-300 hover:bg-brand-50"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-xs font-bold text-brand-700">{i + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-heading">{s.title}</span>
                      <span className="block text-[11px] text-(--color-text-faint)">
                        {s.blocks.filter((b) => b.type === 'table').length} jadval · {s.blocks.filter((b) => b.type === 'chart').length} grafik
                        {s.blocks.some((b) => b.type === 'formulas' && b.headers) ? ' · hisob-kitob' : ''}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>
    </OriginContext.Provider>
  );
}