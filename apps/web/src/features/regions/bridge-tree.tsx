'use client';

import { ExpandBox, nestHead, NestedRow } from '@/components/report/nested';
import { DiffCell, MoneyCell, NameCell, ReportCard, RTable, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr } from '@/components/report/report';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import type { UnitStats } from './api';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Umumiy › «Natija qanday shakllanadi» — bo'lim-bo'lim, ichma-ich:
//   1. Hududlar: + daromad (› xizmat turlari → viloyatlar), − xarajat (› moddalar → viloyatlar), = natija;
//   2. Markaz: + daromad (› manbalar), − xarajat (› moddalar), = natija;
//   3. Har yo'nalish (Tax free …): + daromad, − xarajat, = natija;
//   so'ng biriktirilmagan yozuvlar va = Korxona natijasi.
// Ma'lumot — natija jadvali bilan bitta manbadan (birliklar va ularning qismlari); xarajat — manfiy ishorada.
// «+ Daromad» / «− Xarajat» ochilsa — qator tagida o'z sarlavhali, o'z raqamlashli panel (qismlar → viloyatlar).
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
  /** Bitta qator: depth — ichma-ichlik; openKey bo'lsa — bosilib ochiladi; kind — sarlavha / oddiy / natija; no — № ustuni */
  const line = (id: string, label: ReactNode, a: Amount, depth: number, opts: { openKey?: string; kind?: 'head' | 'result' | 'final'; sub?: ReactNode; no?: string } = {}) => {
    const isOpen = opts.openKey ? open.has(opts.openKey) : false;
    const head = opts.kind === 'head';
    rows.push(
      <Tr key={id} total={opts.kind === 'result' || opts.kind === 'final'} onClick={opts.openKey ? () => toggle(opts.openKey!) : undefined} className={cn(head && 'bg-brand-50/60', depth > 1 && 'bg-(--color-surface-muted)/40')}>
        <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{opts.no}</Td>
        <NameCell
          sub={opts.sub}
          className={cn((head || opts.kind === 'final') && 'font-semibold text-heading')}
          before={
            <span className="flex shrink-0 items-center" style={{ paddingLeft: depth * 18 }}>
              <ExpandBox open={isOpen} hidden={!opts.openKey} onClick={opts.openKey ? () => toggle(opts.openKey!) : undefined} />
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
  /** Ichki panel jadvali: o'z sarlavhasi, o'z raqamlashi (1, 2, 3 …); qism viloyatlarga bo'linsa — u ham panelda ochiladi */
  const partTable = (prefix: string, parts: Part[], side: Side, level: number, childWord?: string): ReactNode => {
    if (!parts.length) return <p className="px-3 py-2 text-xs text-(--color-text-faint)">Tarkibi yo&apos;q</p>;
    const head = cn(nestHead(level), 'border-l border-(--color-line) text-center first:border-l-0');
    const canOpen = parts.some((p) => p.by?.length);
    const body: ReactNode[] = [];
    parts.forEach((p, i) => {
      const key = `${prefix}:${p.key}`;
      const amount = side === 'expense' ? neg(p) : p;
      const kids = p.by?.length ? p.by : null;
      const isOpen = kids ? open.has(key) : false;
      body.push(
        <Tr key={key} onClick={kids ? () => toggle(key) : undefined} className={cn(isOpen && 'bg-brand-50/60')}>
          {canOpen && (
            <Td className="w-8">
              <ExpandBox open={isOpen} hidden={!kids} onClick={() => toggle(key)} />
            </Td>
          )}
          <Td className="w-9 text-(--color-text-faint)">{i + 1}</Td>
          <NameCell sticky={false} sub={kids ? childWord : undefined} className={cn(isOpen && 'font-semibold text-heading')}>
            {p.label}
          </NameCell>
          <MoneyCell value={amount.prev} />
          <MoneyCell value={amount.cur} />
          <DiffCell value={amount.cur - amount.prev} />
        </Tr>,
      );
      if (isOpen && kids)
        body.push(
          <NestedRow key={`${key}>`} colSpan={canOpen ? 6 : 5} level={level + 1}>
            {partTable(key, kids, side, level + 1)}
          </NestedRow>,
        );
    });
    return (
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            {canOpen && <th className={cn(head, 'w-8')} />}
            <th className={cn(head, 'w-9')}>№</th>
            <th className={cn(head, 'min-w-60 text-left')}>Nomi</th>
            <th className={head}>{compareLabel.charAt(0).toUpperCase() + compareLabel.slice(1)}</th>
            <th className={head}>Joriy davr</th>
            <th className={head}>Farqi</th>
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    );
  };
  /** Qismlar paneli — ochilgan «+ Daromad» / «− Xarajat» qatori tagida */
  const partPanel = (prefix: string, parts: Part[], side: Side, childWord?: string) =>
    rows.push(
      <NestedRow key={`${prefix}>`} colSpan={5} level={1}>
        {partTable(prefix, parts, side, 1, childWord)}
      </NestedRow>,
    );
  /** Bo'lim bloki: + daromad, − xarajat, = natija */
  const block = (id: string, title: string, sub: string, income: Amount, expense: Amount, incomeParts: Part[], expenseParts: Part[], words: { income: string; expense: string; child?: string }) => {
    const no = String(++n);
    line(`${id}:head`, title, ZERO, 0, { kind: 'head', sub, no });
    if (line(`${id}:inc`, `+ Daromad`, income, 1, { openKey: `${id}:inc`, sub: words.income, no: `${no}.1` })) partPanel(`${id}:inc`, incomeParts, 'income', words.child);
    if (line(`${id}:exp`, `− Xarajat`, neg(expense), 1, { openKey: `${id}:exp`, sub: words.expense, no: `${no}.2` })) partPanel(`${id}:exp`, expenseParts, 'expense', words.child);
    line(`${id}:res`, `= ${title} natijasi`, { cur: income.cur - expense.cur, prev: income.prev - expense.prev }, 1, {
      kind: 'result',
      sub: income.cur > 0 ? `rentabellik ${(((income.cur - expense.cur) / income.cur) * 100).toFixed(1).replace('.', ',')}%` : undefined,
    });
  };

  // Bo'lim raqami № ustunida (1, 2, 3 …), ichidagi «+ Daromad» / «− Xarajat» — 1.1, 1.2; natija qatorlari — raqamsiz
  let n = 0;
  const regIncome = regions.reduce((a, s) => add(a, amountOf(s, 'income')), ZERO);
  const regExpense = regions.reduce((a, s) => add(a, amountOf(s, 'expense')), ZERO);
  if (regions.length)
    block('reg', 'Hududlar', `${regions.length} ta viloyat`, regIncome, regExpense, regionParts(regions, 'income'), regionParts(regions, 'expense'), {
      income: "xizmat turlari bo'yicha → viloyatlar",
      expense: "moddalar bo'yicha → viloyatlar",
      child: "viloyatlar bo'yicha",
    });
  if (center) block('center', 'Markaz', "bo'limlar", amountOf(center, 'income'), amountOf(center, 'expense'), partsOf(center, 'income'), partsOf(center, 'expense'), { income: "manbalar bo'yicha", expense: "moddalar bo'yicha" });
  for (const sg of segments) block(`s:${sg.unit.key}`, sg.unit.name, "yo'nalish", amountOf(sg, 'income'), amountOf(sg, 'expense'), partsOf(sg, 'income'), partsOf(sg, 'expense'), { income: "xizmatlar bo'yicha", expense: "moddalar bo'yicha" });
  if (unassigned) block('none', 'Biriktirilmagan yozuvlar', "hududi ko'rsatilmagan", amountOf(unassigned, 'income'), amountOf(unassigned, 'expense'), partsOf(unassigned, 'income'), partsOf(unassigned, 'expense'), { income: "turlari bo'yicha", expense: "moddalar bo'yicha" });

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
