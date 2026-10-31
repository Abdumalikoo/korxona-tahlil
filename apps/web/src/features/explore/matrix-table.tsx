'use client';

import { ExcelButton, ReportCard, RTable, SelectBox, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr } from '@/components/report/report';
import { TreeNameCell } from '@/components/report/report-extra-a';
import { formatPeriod } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import { csvSom, downloadCsv, monthLabel, pct, share, short, som, type MatrixRow, type Months } from './api';
import { useDrill } from './drill';

// ═══════════════════════════════════════════════════════════
// Oylar kesimi: qatorlar (moddalar) × oylar. Har bir katak bosilsa — o'sha oy yozuvlari.
// Tepada: Jami (och ko'k) va Markaz / Hududlar qatorlari, keyin moddalar.
// ═══════════════════════════════════════════════════════════

type Mode = 'full' | 'short' | 'share';
const MODES: { value: Mode; label: string }[] = [
  { value: 'full', label: "To'liq summa" },
  { value: 'short', label: 'Qisqa (mln)' },
  { value: 'share', label: 'Oy ichidagi ulush' },
];

export function MatrixTable({ data, months, title, description, root, csv, note }: { data: Months; months: string[]; title: ReactNode; description?: ReactNode; root: string; csv: string; note?: ReactNode }) {
  const { open } = useDrill();
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>('full');
  const grand = data.total.total;
  const monthTotals = data.total.values;

  const cell = (row: MatrixRow, i: number, path: string[]) => {
    const v = row.values[i] ?? 0;
    const text = mode === 'full' ? som(v) : mode === 'short' ? short(v) : pct(share(v, monthTotals[i] ?? 0));
    return (
      <Td key={i} className="whitespace-nowrap font-normal">
        {v ? (
          <button
            type="button"
            title={`${formatPeriod(months[i]!)}: ${som(v)} so'm — yozuvlarni ko'rish`}
            onClick={() => open({ kind: row.kind, f: { ...row.f, month: months[i] }, title: [root, ...path, row.label, formatPeriod(months[i]!)].join(' › '), expected: v })}
            className="-mx-1 rounded px-1 tabular-nums hover:bg-brand-50 hover:text-brand-700 hover:underline"
          >
            {text}
          </button>
        ) : (
          <span className="text-(--color-text-faint)"></span>
        )}
      </Td>
    );
  };

  /** no — raqami: yuqori qator «2», ichkisi «2.1» (jami va Markaz / Hududlar kesimi — bo'sh) */
  const line = (row: MatrixRow, depth: number, path: string[], kind: 'row' | 'total' | 'unit' = 'row', no = ''): ReactNode[] => {
    const has = Boolean(row.children?.length);
    const isOpen = opened.has(row.key);
    const toggle = () =>
      setOpened((s) => {
        const n = new Set(s);
        if (n.has(row.key)) n.delete(row.key);
        else n.add(row.key);
        return n;
      });
    const out: ReactNode[] = [
      <Tr key={`${kind}:${path.join('/')}/${row.key}`} total={kind === 'total'} muted={kind === 'unit' || depth > 0} className={cn(kind === 'row' && depth === 0 && 'font-medium text-heading')}>
        <Td className={cn(STICKY_NO, 'whitespace-nowrap font-normal text-(--color-text-faint)')}>{no}</Td>
        <TreeNameCell depth={depth} sticky={STICKY_NAME} open={has ? isOpen : undefined} onToggle={has ? toggle : undefined}>
          {row.label}
        </TreeNameCell>
        <Td className="whitespace-nowrap font-semibold">
          <button
            type="button"
            onClick={() => open({ kind: row.kind, f: row.f, title: [root, ...path, row.label].join(' › '), expected: row.total })}
            className="-mx-1 rounded px-1 tabular-nums hover:bg-brand-50 hover:text-brand-700 hover:underline"
            title={`${som(row.total)} so'm`}
          >
            {mode === 'short' ? short(row.total) : som(row.total)}
          </button>
        </Td>
        <Td className="text-xs text-(--color-text-muted)">{pct(share(row.total, grand))}</Td>
        {months.map((_, i) => cell(row, i, path))}
      </Tr>,
    ];
    if (has && isOpen) row.children!.forEach((c, i) => out.push(...line(c, depth + 1, [...path, row.label], 'row', no ? `${no}.${i + 1}` : '')));
    return out;
  };

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [['Nomi', "Jami (so'm)", 'Ulushi, %', ...months.map(formatPeriod)]];
    const add = (r: MatrixRow, depth: number) => {
      rows.push([`${'   '.repeat(depth)}${r.label}`, csvSom(r.total), grand ? Math.round((r.total / grand) * 1000) / 10 : null, ...r.values.map(csvSom)]);
      r.children?.forEach((c) => add(c, depth + 1));
    };
    add(data.total, 0);
    data.units.forEach((r) => add(r, 0));
    data.rows.forEach((r) => add(r, 0));
    downloadCsv(csv, rows);
  };

  const colW = mode === 'full' ? 112 : 84;

  return (
    <ReportCard
      title={
        <span>
          {title}
          {description && <span className="mt-0.5 block text-xs font-normal text-(--color-text-muted)">{description}</span>}
        </span>
      }
      actions={
        <>
          <SelectBox value={mode} options={MODES} onChange={setMode} className="h-10 min-w-44" />
          <ExcelButton onClick={exportCsv} label="Excel" />
        </>
      }
    >
      <RTable minWidth={48 + 260 + 120 + 64 + months.length * colW}>
        <thead>
          <tr>
            <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
            <Th className={cn(STICKY_NAME, 'z-[2] min-w-60 text-left')}>Nomi</Th>
            <Th>Jami</Th>
            <Th>Ulushi</Th>
            {months.map((m) => (
              <Th key={m} className="whitespace-nowrap">
                {monthLabel(m)}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {line(data.total, 0, [], 'total')}
          {data.units.filter((u) => u.total).flatMap((u) => line(u, 0, [], 'unit'))}
          {data.rows.flatMap((r, i) => line(r, 0, [], 'row', String(i + 1)))}
        </tbody>
      </RTable>
      <TableNote>{note ?? "Katakni bosing — o'sha oy yozuvlari ochiladi. Oylar o'ng tomonda — kerak bo'lsa o'ngga suring."}</TableNote>
    </ReportCard>
  );
}
