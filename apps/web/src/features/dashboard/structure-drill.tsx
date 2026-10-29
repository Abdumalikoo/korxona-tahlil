'use client';

import { DiffCell, changeOf, MoneyCell, NameCell, PctCell, RTable, STICKY_NAME, STICKY_NO, Td, Th, Tr } from '@/components/report/report';
import type { RegionUnit } from '@/features/regions/api';
import { SEGMENTS } from '@/lib/segments';
import { cn } from '@/lib/utils';
import { useState, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa: daromad / xarajat tarkibi — shu sahifaning o'zida ichma-ich:
//   Markaz → xizmatlari (moddalari); Hudud → viloyatlar → viloyat xizmatlari (moddalari)
//   yoki «Xizmat turlari bo'yicha» → xizmat → viloyatlar; keyin 4 yo'nalish (Tax free, Marksheyder, Fermer, Buxgalteriya).
// Ma'lumot — Solishtirma bilan bir manbadan (birliklar va ularning qismlari).
// ═══════════════════════════════════════════════════════════

type Kind = 'income' | 'expense';
type Amount = { cur: number; prev: number };
type Part = { key: string; label: string } & Amount;

const amountOf = (u: RegionUnit, kind: Kind): Amount =>
  kind === 'income' ? { cur: Number(u.incomeTiyin), prev: Number(u.previousIncomeTiyin) } : { cur: Number(u.expenseTiyin), prev: Number(u.previousExpenseTiyin) };
const partsOf = (u: RegionUnit, kind: Kind): Part[] =>
  (kind === 'income' ? u.incomeParts : u.expenseParts)
    .map((p) => ({ key: p.key, label: p.label, cur: Number(p.amountTiyin), prev: Number(p.previousTiyin) }))
    .filter((p) => p.cur !== 0 || p.prev !== 0)
    .sort((a, b) => b.cur - a.cur || b.prev - a.prev);
const add = (a: Amount, b: Amount): Amount => ({ cur: a.cur + b.cur, prev: a.prev + b.prev });
const ZERO: Amount = { cur: 0, prev: 0 };

export function StructureDrill({ units, kind, cmpOn }: { units: RegionUnit[]; kind: Kind; cmpOn: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [regionMode, setRegionMode] = useState<'regions' | 'parts'>('regions');
  const toggle = (k: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const word = kind === 'income' ? 'xizmat' : 'modda';
  const center = units.find((u) => u.kind === 'center') ?? null;
  const regions = units.filter((u) => u.kind === 'region').sort((a, b) => amountOf(b, kind).cur - amountOf(a, kind).cur);
  const order = SEGMENTS.map((s) => s.code as string);
  const segments = units.filter((u) => u.kind === 'segment').sort((a, b) => order.indexOf(a.segment ?? '') - order.indexOf(b.segment ?? ''));
  const unassigned = units.find((u) => u.kind === 'unassigned') ?? null;
  const total = units.reduce((a, u) => add(a, amountOf(u, kind)), ZERO);
  const regionTotal = regions.reduce((a, u) => add(a, amountOf(u, kind)), ZERO);

  // Hudud — xizmat turlari (moddalar) bo'yicha: viloyatlar qismlari yig'indisi, har birida viloyatlar kesimi
  const regionParts = (() => {
    const m = new Map<string, Part & { byRegion: { name: string; key: string; cur: number; prev: number }[] }>();
    for (const r of regions)
      for (const p of partsOf(r, kind)) {
        const x = m.get(p.key) ?? { key: p.key, label: p.label, cur: 0, prev: 0, byRegion: [] };
        x.cur += p.cur;
        x.prev += p.prev;
        x.byRegion.push({ name: r.name, key: r.key, cur: p.cur, prev: p.prev });
        m.set(p.key, x);
      }
    return [...m.values()].sort((a, b) => b.cur - a.cur || b.prev - a.prev);
  })();

  const rows: ReactNode[] = [];
  let n = 0;
  /** Qator: depth — ichma-ichlik (chekinish), key — ochilish kaliti (bo'lsa — bosiladi) */
  const line = (id: string, label: ReactNode, a: Amount, depth: number, opts: { sub?: ReactNode; openKey?: string; extra?: ReactNode; strong?: boolean } = {}) => {
    const isOpen = opts.openKey ? open.has(opts.openKey) : false;
    rows.push(
      <Tr key={id} onClick={opts.openKey ? () => toggle(opts.openKey!) : undefined} className={cn(depth > 0 && 'bg-(--color-surface-muted)/40')}>
        <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{depth === 0 ? ++n : ''}</Td>
        <NameCell
          sub={opts.sub}
          className={cn(opts.strong && 'font-semibold text-heading')}
          before={
            <span className="flex shrink-0 items-center" style={{ paddingLeft: depth * 18 }}>
              <span className={cn('inline-block w-3.5 text-center text-(--color-text-faint)', !opts.openKey && 'invisible')}>{isOpen ? '▾' : '▸'}</span>
            </span>
          }
        >
          <span className="flex flex-wrap items-center gap-2">
            {label}
            {opts.extra}
          </span>
        </NameCell>
        {cmpOn && <MoneyCell value={a.prev} />}
        <MoneyCell value={a.cur} />
        {cmpOn ? <DiffCell value={a.cur - a.prev} pct={changeOf(a.cur, a.prev)} growthGood={kind === 'income'} /> : null}
        <PctCell value={total.cur > 0 ? (a.cur / total.cur) * 100 : null} plain className="font-normal text-(--color-text-muted)" />
      </Tr>,
    );
    return isOpen;
  };
  const partLines = (prefix: string, parts: Part[], depth: number) => {
    for (const p of parts) line(`${prefix}:${p.key}`, p.label, p, depth);
    if (!parts.length) line(`${prefix}:none`, <span className="text-(--color-text-faint)">Qism yo&apos;q</span>, ZERO, depth);
  };

  // 1) Markaz
  if (center && (amountOf(center, kind).cur || amountOf(center, kind).prev)) {
    if (line('center', 'Markaz', amountOf(center, kind), 0, { sub: `${word}lar bo'yicha`, openKey: 'center', strong: true })) partLines('center', partsOf(center, kind), 1);
  }
  // 2) Hudud: viloyatlar yoki xizmat turlari (moddalar) bo'yicha
  const modeSwitch = (
    <span className="inline-flex rounded-md border border-(--color-line-strong) bg-white p-0.5 text-[11px]" onClick={(e) => e.stopPropagation()}>
      {(
        [
          ['regions', 'Viloyatlar bo‘yicha'],
          ['parts', kind === 'income' ? 'Xizmat turlari bo‘yicha' : 'Moddalar bo‘yicha'],
        ] as const
      ).map(([m, t]) => (
        <button
          key={m}
          type="button"
          onClick={() => {
            setRegionMode(m);
            setOpen((s) => new Set([...s, 'regions']));
          }}
          className={cn('rounded px-1.5 py-0.5 font-medium', regionMode === m ? 'bg-brand-600 text-white' : 'text-(--color-text-muted) hover:text-heading')}
        >
          {t}
        </button>
      ))}
    </span>
  );
  if (regions.length) {
    if (line('regions', `Hudud · ${regions.length} viloyat`, regionTotal, 0, { openKey: 'regions', extra: modeSwitch, strong: true })) {
      if (regionMode === 'regions') {
        for (const r of regions) if (line(`r:${r.key}`, r.name, amountOf(r, kind), 1, { openKey: `r:${r.key}`, sub: `${word}lar bo'yicha` })) partLines(`r:${r.key}`, partsOf(r, kind), 2);
      } else {
        for (const p of regionParts)
          if (line(`p:${p.key}`, p.label, p, 1, { openKey: `p:${p.key}`, sub: 'viloyatlar bo‘yicha' }))
            for (const x of p.byRegion.sort((a, b) => b.cur - a.cur)) line(`p:${p.key}:${x.key}`, x.name, x, 2);
      }
    }
  }
  // 3) Yo'nalishlar: Tax free, Marksheyder, Fermer, Buxgalteriya (tartibda); qolganlari — summa bo'lsa
  for (const s of segments) {
    const a = amountOf(s, kind);
    const main = order.indexOf(s.segment ?? '') < 4;
    if (!main && !a.cur && !a.prev) continue;
    if (line(`s:${s.key}`, s.name, a, 0, { openKey: `s:${s.key}`, sub: `yo'nalish · ${word}lar bo'yicha` })) partLines(`s:${s.key}`, partsOf(s, kind), 1);
  }
  if (unassigned && (amountOf(unassigned, kind).cur || amountOf(unassigned, kind).prev)) line('unassigned', unassigned.name, amountOf(unassigned, kind), 0, { sub: 'hudud belgilanmagan yozuvlar' });

  return (
    <RTable minWidth={cmpOn ? 820 : 620}>
      <thead>
        <tr>
          <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
          <Th className={cn(STICKY_NAME, 'z-[2] min-w-56 text-left')}>{kind === 'income' ? 'Daromad manbai' : 'Xarajat joyi'}</Th>
          {cmpOn && <Th>O&apos;tgan davr</Th>}
          <Th>Joriy davr</Th>
          {cmpOn && <Th>Farqi, foizda</Th>}
          <Th>Ulushi</Th>
        </tr>
      </thead>
      <tbody>
        <Tr total>
          <Td className={STICKY_NO} />
          <NameCell>{kind === 'income' ? 'Jami daromad' : 'Jami xarajat'}</NameCell>
          {cmpOn && <MoneyCell value={total.prev} />}
          <MoneyCell value={total.cur} />
          {cmpOn && <DiffCell value={total.cur - total.prev} pct={changeOf(total.cur, total.prev)} growthGood={kind === 'income'} />}
          <PctCell value={total.cur > 0 ? 100 : null} plain className="font-normal text-(--color-text-muted)" />
        </Tr>
        {rows}
      </tbody>
    </RTable>
  );
}
