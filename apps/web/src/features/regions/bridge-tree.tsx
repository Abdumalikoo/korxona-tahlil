'use client';

import { DiffCell, MoneyCell, NameCell, ReportCard, RTable, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr } from '@/components/report/report';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import type { UnitStats } from './api';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Umumiy › «Natija qanday shakllanadi» — bo'lim-bo'lim, ichma-ich:
//   1. Hududlar: + daromad (▸ xizmat turlari → viloyatlar), − xarajat (▸ moddalar → viloyatlar), = natija;
//   2. Markaz: + daromad (▸ manbalar), − xarajat (▸ moddalar), = natija;
//   3. Har yo'nalish (Tax free …): + daromad, − xarajat, = natija;
//   so'ng biriktirilmagan yozuvlar va = Korxona natijasi.
// Ma'lumot — natija jadvali bilan bitta manbadan (birliklar va ularning qismlari); xarajat — manfiy ishorada.
// ═══════════════════════════════════════════════════════════

type Amount = { cur: number; prev: number };
type Part = Amount & { key: string; label: string; by?: (Amount & { key: string; label: string })[] };
type Side = 'income' | 'expense';

const ZERO: Amount = { cur: 0, prev: 0 };
const add = (a: Amount, b: Amount): Amount => ({ cur: a.cur + b.cur, prev: a.prev + b.prev });
const neg = (a: Amount): Amount => ({ cur: -a.cur, prev: -a.prev });
const nonZero = (a: Amount) => Math.round(a.cur / 100) !== 0 || Math.round(a.prev / 100) !== 0;

function amountOf(s: UnitStats, side: Side): Amount {
  return side === 'income' ? { cur: s.income, prev: s.previousIncome } : { cur: s.expense, prev: s.previousExpense };
}

/** Birlik qismlari (xizmatlar / moddalar); qismlar yig'indisi jamidan farq qilsa — «Boshqa (tarkibi ko'rsatilmagan)» */
function partsOf(s: UnitStats, side: Side): Part[] {
  const list = (side === 'income' ? s.unit.incomeParts : s.unit.expenseParts).map((p) => ({ key: p.key, label: p.label, cur: Number(p.amountTiyin), prev: Number(p.previousTiyin) }));
  const sum = list.reduce(add, ZERO);
  const total = amountOf(s, side);
  const rest = { cur: total.cur - sum.cur, prev: total.prev - sum.prev };
  if (nonZero(rest)) list.push({ key: '__rest', label: "Boshqa (tarkibi ko'rsatilmagan)", ...rest });
  return list.filter(nonZero).sort((a, b) => b.cur - a.cur || b.prev - a.prev);
}

/** Hududlar: qismlar (xizmat turlari / moddalar) yig'indisi, har birida — viloyatlar kesimi */
function regionParts(regions: UnitStats[], side: Side): Part[] {
  const m = new Map<string, Part & { by: (Amount & { key: string; label: string })[] }>();
  for (const r of regions)
    for (const p of partsOf(r, side)) {
      const x = m.get(p.key) ?? { key: p.key, label: p.label, cur: 0, prev: 0, by: [] };
      x.cur += p.cur;
      x.prev += p.prev;
      x.by.push({ key: r.unit.key, label: r.unit.name, cur: p.cur, prev: p.prev });
      m.set(p.key, x);
    }
  return [...m.values()].map((p) => ({ ...p, by: p.by.sort((a, b) => b.cur - a.cur) })).sort((a, b) => b.cur - a.cur || b.prev - a.prev);
}

export function BridgeTree({ center, regions, segments, unassigned, compareLabel, period, notes }: { center: UnitStats | null; regions: UnitStats[]; segments: UnitStats[]; unassigned: UnitStats | null; compareLabel: string; period: string; notes: string[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const rows: ReactNode[] = [];
  /** Bitta qator: depth — ichma-ichlik; openKey bo'lsa — bosilib ochiladi; kind — sarlavha / oddiy / natija */
  const line = (id: string, label: ReactNode, a: Amount, depth: number, opts: { openKey?: string; kind?: 'head' | 'result' | 'final'; sub?: ReactNode } = {}) => {
    const isOpen = opts.openKey ? open.has(opts.openKey) : false;
    const head = opts.kind === 'head';
    rows.push(
      <Tr key={id} total={opts.kind === 'result' || opts.kind === 'final'} onClick={opts.openKey ? () => toggle(opts.openKey!) : undefined} className={cn(head && 'bg-brand-50/60', depth > 1 && 'bg-(--color-surface-muted)/40')}>
        <Td className={STICKY_NO} />
        <NameCell
          sub={opts.sub}
          className={cn((head || opts.kind === 'final') && 'font-semibold text-heading')}
          before={
            <span className="flex shrink-0 items-center" style={{ paddingLeft: depth * 18 }}>
              <span className={cn('inline-block w-3.5 text-center text-(--color-text-faint)', !opts.openKey && 'invisible')}>{isOpen ? '▾' : '▸'}</span>
            </span>
          }
        >
          {label}
        </NameCell>
        {head ? (
          <Td colSpan={3} />
        ) : (
          <>
            <MoneyCell value={a.prev} signedColor={opts.kind === 'result' || opts.kind === 'final'} />
            <MoneyCell value={a.cur} strong={opts.kind === 'result' || opts.kind === 'final'} signedColor={opts.kind === 'result' || opts.kind === 'final'} />
            <DiffCell value={a.cur - a.prev} />
          </>
        )}
      </Tr>,
    );
    return isOpen;
  };
  const partLines = (prefix: string, parts: Part[], side: Side, depth: number, childWord?: string) => {
    for (const p of parts) {
      const key = `${prefix}:${p.key}`;
      const amount = side === 'expense' ? neg(p) : p;
      if (p.by?.length) {
        if (line(key, p.label, amount, depth, { openKey: key, sub: childWord })) for (const x of p.by) line(`${key}:${x.key}`, x.label, side === 'expense' ? neg(x) : x, depth + 1);
      } else line(key, p.label, amount, depth);
    }
    if (!parts.length) line(`${prefix}:none`, <span className="text-(--color-text-faint)">Tarkibi yo&apos;q</span>, ZERO, depth);
  };
  /** Bo'lim bloki: + daromad, − xarajat, = natija */
  const block = (id: string, title: string, sub: string, income: Amount, expense: Amount, incomeParts: Part[], expenseParts: Part[], words: { income: string; expense: string; child?: string }) => {
    line(`${id}:head`, title, ZERO, 0, { kind: 'head', sub });
    if (line(`${id}:inc`, `+ Daromad`, income, 1, { openKey: `${id}:inc`, sub: words.income })) partLines(`${id}:inc`, incomeParts, 'income', 2, words.child);
    if (line(`${id}:exp`, `− Xarajat`, neg(expense), 1, { openKey: `${id}:exp`, sub: words.expense })) partLines(`${id}:exp`, expenseParts, 'expense', 2, words.child);
    line(`${id}:res`, `= ${title} natijasi`, { cur: income.cur - expense.cur, prev: income.prev - expense.prev }, 1, {
      kind: 'result',
      sub: income.cur > 0 ? `rentabellik ${(((income.cur - expense.cur) / income.cur) * 100).toFixed(1).replace('.', ',')}%` : undefined,
    });
  };

  let n = 0;
  const num = () => `${++n}. `;
  const regIncome = regions.reduce((a, s) => add(a, amountOf(s, 'income')), ZERO);
  const regExpense = regions.reduce((a, s) => add(a, amountOf(s, 'expense')), ZERO);
  if (regions.length)
    block('reg', `${num()}Hududlar`, `${regions.length} ta viloyat`, regIncome, regExpense, regionParts(regions, 'income'), regionParts(regions, 'expense'), {
      income: "xizmat turlari bo'yicha → viloyatlar",
      expense: "moddalar bo'yicha → viloyatlar",
      child: "viloyatlar bo'yicha",
    });
  if (center) block('center', `${num()}Markaz`, "bo'limlar", amountOf(center, 'income'), amountOf(center, 'expense'), partsOf(center, 'income'), partsOf(center, 'expense'), { income: "manbalar bo'yicha", expense: "moddalar bo'yicha" });
  for (const sg of segments) block(`s:${sg.unit.key}`, `${num()}${sg.unit.name}`, "yo'nalish", amountOf(sg, 'income'), amountOf(sg, 'expense'), partsOf(sg, 'income'), partsOf(sg, 'expense'), { income: "xizmatlar bo'yicha", expense: "moddalar bo'yicha" });
  if (unassigned) block('none', `${num()}Biriktirilmagan yozuvlar`, "hududi ko'rsatilmagan", amountOf(unassigned, 'income'), amountOf(unassigned, 'expense'), partsOf(unassigned, 'income'), partsOf(unassigned, 'expense'), { income: "turlari bo'yicha", expense: "moddalar bo'yicha" });

  const all = [...regions, ...(center ? [center] : []), ...segments, ...(unassigned ? [unassigned] : [])];
  const inc = all.reduce((a, s) => add(a, amountOf(s, 'income')), ZERO);
  const exp = all.reduce((a, s) => add(a, amountOf(s, 'expense')), ZERO);
  line('final', '= Korxona natijasi', { cur: inc.cur - exp.cur, prev: inc.prev - exp.prev }, 0, {
    kind: 'final',
    sub: inc.cur > 0 ? `rentabellik ${(((inc.cur - exp.cur) / inc.cur) * 100).toFixed(1).replace('.', ',')}% · bo'limlar natijalari yig'indisi` : "bo'limlar natijalari yig'indisi",
  });

  return (
    <ReportCard title="Korxona natijasi qanday shakllanadi" badge={period}>
      <RTable minWidth={820}>
        <thead>
          <tr>
            <Th className={cn(STICKY_NO, 'z-[2]')} />
            <Th className={cn(STICKY_NAME, 'z-[2] min-w-72 text-left')}>Bo&apos;lim va qadam</Th>
            <Th>{compareLabel.charAt(0).toUpperCase() + compareLabel.slice(1)}</Th>
            <Th>Joriy davr</Th>
            <Th>Farqi</Th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </RTable>
      <TableNote>
        «+ Daromad» va «− Xarajat» qatorlarini bosing — tarkibi ochiladi (Hududlarda — xizmat turi yoki modda, uning ichida viloyatlar). Xarajat manfiy ishorada ko&apos;rsatilgan: har bo&apos;lim
        natijasi = daromad − xarajat, korxona natijasi = bo&apos;limlar natijalari yig&apos;indisi. Hududlar foydasi Markazning sof xarajatini qoplaydi.
      </TableNote>
      {notes.length > 0 && (
        <ul className="list-disc space-y-1 px-9 pb-4 text-xs text-(--color-text-muted)">
          {notes.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
    </ReportCard>
  );
}
