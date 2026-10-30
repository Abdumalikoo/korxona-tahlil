'use client';

import { ExcelButton, PillTabs, ReportCard, TableNote } from '@/components/report/report';
import { compact, num, TONE } from '@/features/structure/api';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatPeriod, formatPeriodShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { KIND_ORDER, type UnitStats } from './api';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Umumiy — aniq jadvallar (grafiklar sahifa oxirida):
//   • MonthsTable      — birliklar × oylar: daromad / xarajat / natija
// Hamma summalar to'liq (so'm) — «qisqa» tugmasi bilan mln/mlrd ko'rinishiga o'tadi.
// ═══════════════════════════════════════════════════════════

const TH = 'px-2.5 py-2.5 text-xs font-bold text-heading whitespace-nowrap';

export type Fmt = 'full' | 'short';

const FMT_OPTIONS: { value: Fmt; label: string }[] = [
  { value: 'full', label: "To'liq summa" },
  { value: 'short', label: 'Qisqa (mln)' },
];

export function money(tiyin: number, fmt: Fmt): string {
  if (Math.round(tiyin / 100) === 0) return '';
  return fmt === 'full' ? num(tiyin) : compact(tiyin);
}

const kindOrder = (s: UnitStats) => KIND_ORDER[s.unit.kind];

// ───────────────────────── Oylar jadvali ─────────────────────────

type Metric = 'profit' | 'income' | 'expense';

export function MonthsTable({ units, months, range, onOpen }: { units: UnitStats[]; months: string[]; range: { from: string; to: string }; onOpen: (s: UnitStats) => void }) {
  const [metric, setMetric] = useState<Metric>('profit');
  const [fmt, setFmt] = useState<Fmt>('short');
  const list = [...units].sort((a, b) => kindOrder(a) - kindOrder(b) || b.profit - a.profit);
  const inRange = (m: string) => m >= range.from.slice(0, 7) && m <= range.to.slice(0, 7);
  const valuesOf = (s: UnitStats): number[] =>
    months.map((_, i) => {
      const inc = Number(s.unit.incomeTrend[i] ?? 0);
      const exp = Number(s.unit.expenseTrend[i] ?? 0);
      return metric === 'income' ? inc : metric === 'expense' ? exp : inc - exp;
    });
  const rows = list.map((s) => ({ s, values: valuesOf(s) }));
  const sumRows = (rs: typeof rows) => months.map((_, i) => rs.reduce((a, r) => a + r.values[i]!, 0));
  const regTotal = sumRows(rows.filter((r) => r.s.unit.kind === 'region'));
  const total = sumRows(rows);
  // Rang shkalasi hududlar bo'yicha (Markaz qiymati katta bo'lib, hammasini och qilib qo'ymasin)
  const scaleRows = rows.filter((r) => r.s.unit.kind === 'region');
  const max = Math.max(1, ...(scaleRows.length ? scaleRows : rows).flatMap((r) => r.values.map(Math.abs)));
  const signedMetric = metric === 'profit';

  const cell = (v: number, key: string, heat: boolean, inR: boolean) => {
    const color = signedMetric ? (v >= 0 ? TONE.income : TONE.expense) : metric === 'income' ? TONE.income : TONE.expense;
    return (
      <td key={key} className={cn('relative px-2 py-1.5 text-right tabular-nums', !inR && 'text-(--color-text-muted)')} title={`${num(v)} so'm`}>
        {heat && Math.round(v / 100) !== 0 && <span className="absolute inset-0.5 rounded" style={{ background: color, opacity: 0.05 + Math.min(1, Math.abs(v) / max) * 0.22 }} />}
        <span className={cn('relative', signedMetric && v < 0 && 'text-(--color-expense)')}>{money(v, fmt)}</span>
      </td>
    );
  };

  const exportCsv = () =>
    downloadCsv(
      `umumiy-oylar-${metric}.csv`,
      ['Birlik', ...months.map(formatPeriod), "Jami (so'm)"],
      [...rows.map((r) => [r.s.unit.name, ...r.values.map(csvSom), csvSom(r.values.reduce((a, b) => a + b, 0))]), ['Hududlar jami', ...regTotal.map(csvSom), csvSom(regTotal.reduce((a, b) => a + b, 0))], ['Korxona jami', ...total.map(csvSom), csvSom(total.reduce((a, b) => a + b, 0))]],
    );

  return (
    <ReportCard
      title="Oylar bo'yicha: Markaz va hududlar"
      actions={
        <>
          <PillTabs
            value={metric}
            onChange={setMetric}
            options={[
              { value: 'profit', label: 'Natija' },
              { value: 'income', label: 'Daromad' },
              { value: 'expense', label: 'Xarajat' },
            ]}
          />
          <PillTabs value={fmt} onChange={setFmt} options={FMT_OPTIONS} />
          <ExcelButton onClick={exportCsv} />
        </>
      }
    >
      <div className="overflow-x-auto px-4 pb-4">
        <table className="w-full border-collapse whitespace-nowrap border border-(--color-line) text-[12.5px]" style={{ minWidth: 220 + months.length * (fmt === 'full' ? 118 : 78) + 140 }}>
          <thead>
            <tr className="border-y border-(--color-line) bg-[#f3f6fd]">
              <th className={cn(TH, 'sticky left-0 z-10 bg-[#f3f6fd] text-left')}>Birlik</th>
              {months.map((m) => (
                <th key={m} className={cn(TH, 'text-right', inRange(m) && 'text-heading')}>
                  {formatPeriodShort(m)}
                </th>
              ))}
              <th className={cn(TH, 'border-l border-(--color-line) text-right')}>Jami</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isCenter = r.s.unit.kind === 'center';
              const sum = r.values.reduce((a, b) => a + b, 0);
              return (
                <tr key={r.s.unit.key} onClick={() => onOpen(r.s)} className={cn('cursor-pointer border-b border-(--color-line) hover:bg-(--color-surface-muted)', isCenter && 'bg-[#f6f4fc]')}>
                  <td className={cn('sticky left-0 z-[1] max-w-[13rem] truncate px-2.5 py-1.5 font-medium', isCenter ? 'bg-[#f6f4fc]' : 'bg-white')}>{r.s.unit.name}</td>
                  {r.values.map((v, i) => cell(v, months[i]!, true, inRange(months[i]!)))}
                  <td className={cn('border-l border-(--color-line) px-2.5 py-1.5 text-right font-semibold tabular-nums', signedMetric && sum < 0 && 'text-(--color-expense)')} title={`${num(sum)} so'm`}>
                    {money(sum, fmt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            {(
              [
                ['Hududlar jami', regTotal, 'bg-[#eaf0fd]'],
                ['Korxona jami', total, 'bg-[#eef2f8] font-bold'],
              ] as const
            ).map(([label, vals, cls]) => {
              const sum = vals.reduce((a, b) => a + b, 0);
              return (
                <tr key={label} className={cn('border-b border-(--color-line) font-semibold', cls)}>
                  <td className={cn('sticky left-0 z-[1] px-2.5 py-2', cls)}>{label}</td>
                  {vals.map((v, i) => cell(v, months[i]!, false, inRange(months[i]!)))}
                  <td className={cn('border-l border-(--color-line) px-2.5 py-2 text-right tabular-nums', signedMetric && sum < 0 && 'text-(--color-expense)')} title={`${num(sum)} so'm`}>
                    {money(sum, fmt)}
                  </td>
                </tr>
              );
            })}
          </tfoot>
        </table>
      </div>
      <TableNote>
        Har bir birlikning har oydagi ko&apos;rsatkichi. Qalin ustunlar — tanlangan davr oylari; kataklar rangi — kattaligiga qarab. «Jami» — jadvaldagi hamma oylar yig&apos;indisi (
        {formatPeriod(months[0] ?? '')} — {formatPeriod(months[months.length - 1] ?? '')}); tanlangan davr jamisi yuqoridagi jadvallarda.
      </TableNote>
    </ReportCard>
  );
}
