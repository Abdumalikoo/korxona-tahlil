'use client';

import { changeOf, DiffCell, ExcelButton, GroupTh, ReportCard, RTable, TableNote, Td, Th, ToggleAllButton, Tr } from '@/components/report/report';
import { LinkMoneyCell, STICKY_LEFT, TreeNameCell } from '@/components/report/report-extra-a';
import { cn } from '@/lib/utils';
import { useMemo, useState, type ReactNode } from 'react';
import { change, csvSom, downloadCsv, goodUp, pct, pctSigned, share, short, som, type Filter, type Kind, type Vals, type Which, type XNode } from './api';
import { useDrill } from './drill';

// ═══════════════════════════════════════════════════════════
// Ichiga kirib boriladigan jadval (yagona hisobot uslubida).
//  Nomi | Joriy davr | Ulushi | O'TGAN DAVR: summa, farqi | O'TGAN YIL: summa, farqi | Soni (+ qo'shimcha ustunlar)
//  • tepada — Jami qatori (och ko'k);
//  • nom yonidagi › — ichini ochadi; ichi yo'q qator nomi — yozuvlarni ochadi;
//  • har bir summa bosilsa — aynan o'sha summani tashkil qilgan yozuvlar (o'tgan davr / yil ham).
// ═══════════════════════════════════════════════════════════

export interface ExtraCol {
  key: string;
  label: string;
  hint?: string;
  get: (n: XNode) => number;
  /** Bosilganda ochiladigan filtr (bo'lmasa — bosilmaydi) */
  drill?: (n: XNode) => Filter;
  tone?: 'expense' | 'muted';
}

interface Props {
  nodes: XNode[];
  title: ReactNode;
  description?: ReactNode;
  nameHeader?: string;
  /** Sarlavhalar uchun: «Daromad» */
  root: string;
  /** Ochiq turadigan daraja (0 — hammasi yopiq) */
  openDepth?: number;
  extra?: ExtraCol[];
  /** Jami qatori (bo'lmasa — yuqori qatorlar yig'indisi) */
  total?: Vals;
  csv?: string;
  /** Qo'shimcha izoh jadval tagida */
  note?: ReactNode;
  /** Qatorlar ko'p bo'lsa — dastlab nechtasi ko'rinadi */
  limit?: number;
  hideLy?: boolean;
  actions?: ReactNode;
}

/**
 * Ish haqi (PAYROLL_BASE) qatori — to'liq summa; ichiga kirilganda ajraladi: «shundan: qo'lga (sof, 88%)» va «shundan: daromad
 * solig'i 12%» (ish haqi ichida — alohida xarajat emas). Ichki qatorlar jamiga qo'shilmaydi (jami — yuqori qatorlardan).
 */
const PAYROLL_CAT = 'PAYROLL_BASE';
const JSHDS_RATE = 0.12;
function withPayrollSplit(list: XNode[]): XNode[] {
  return list.map((n) => {
    if (n.children?.length) return { ...n, children: withPayrollSplit(n.children) };
    if (n.kind !== 'expense' || n.f.cats?.length !== 1 || n.f.cats[0] !== PAYROLL_CAT || !n.cur) return n;
    const part = (k: string, label: string, r: number): XNode => ({ ...n, key: `${n.key}:${k}`, label, cur: Math.round(n.cur * r), prev: Math.round(n.prev * r), ly: Math.round(n.ly * r), count: 0, children: undefined });
    return { ...n, children: [part('net', "shundan: qo'lga (sof, 88%)", 1 - JSHDS_RATE), part('jshds', "shundan: daromad solig'i 12% — ish haqi ichida, alohida xarajat emas", JSHDS_RATE)] };
  });
}

const sumVals = (list: XNode[]): Vals => list.reduce((a, n) => ({ cur: a.cur + n.cur, prev: a.prev + n.prev, ly: a.ly + n.ly, count: a.count + n.count }), { cur: 0, prev: 0, ly: 0, count: 0 });


export function DrillTable({ nodes: nodesIn, title, description, nameHeader = 'Nomi', root, openDepth = 0, extra = [], total, csv, note, limit, hideLy, actions }: Props) {
  const { open: drill } = useDrill();
  const nodes = useMemo(() => withPayrollSplit(nodesIn), [nodesIn]);
  const [opened, setOpened] = useState<Set<string> | null>(null);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const kind: Kind = nodes[0]?.kind ?? 'income';
  const tot = total ?? sumVals(nodes);

  // Dastlabki ochiq qatorlar
  const initial = useMemo(() => {
    const s = new Set<string>();
    const walk = (list: XNode[], path: string, depth: number) => {
      if (depth >= openDepth) return;
      for (const n of list) {
        const p = `${path}/${n.key}`;
        if (n.children?.length) {
          s.add(p);
          walk(n.children, p, depth + 1);
        }
      }
    };
    walk(nodes, '', 0);
    return s;
  }, [nodes, openDepth]);
  const expanded = opened ?? initial;

  const term = q.trim().toLowerCase();
  const hit = (n: XNode): boolean => n.label.toLowerCase().includes(term) || Boolean(n.children?.some(hit));

  const toggle = (p: string) => {
    const s = new Set(expanded);
    if (s.has(p)) s.delete(p);
    else s.add(p);
    setOpened(s);
  };
  const expandAll = () => {
    const s = new Set<string>();
    const walk = (list: XNode[], path: string) => list.forEach((n) => n.children?.length && (s.add(`${path}/${n.key}`), walk(n.children, `${path}/${n.key}`)));
    walk(nodes, '');
    setOpened(s);
  };
  const anyChildren = nodes.some((n) => n.children?.length);

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [['Daraja', nameHeader, "Joriy (so'm)", 'Ulushi, %', "O'tgan davr (so'm)", "O'zgarish, %", ...(hideLy ? [] : ["O'tgan yil (so'm)", "O'zgarish, %"]), 'Yozuvlar', ...extra.map((e) => `${e.label} (so'm)`)]];
    const walk = (list: XNode[], depth: number, parent: number) =>
      list.forEach((n) => {
        const c1 = change(n.cur, n.prev);
        const c2 = change(n.cur, n.ly);
        const sh = share(n.cur, parent);
        rows.push([depth + 1, `${'   '.repeat(depth)}${n.label}`, csvSom(n.cur), sh === null ? null : Math.round(sh * 1000) / 10, csvSom(n.prev), c1 === null ? null : Math.round(c1 * 1000) / 10, ...(hideLy ? [] : [csvSom(n.ly), c2 === null ? null : Math.round(c2 * 1000) / 10]), n.count, ...extra.map((e) => csvSom(e.get(n)))]);
        if (n.children) walk(n.children, depth + 1, n.cur);
      });
    walk(nodes, 0, tot.cur);
    rows.push(['', 'Jami', csvSom(tot.cur), 100, csvSom(tot.prev), null, ...(hideLy ? [] : [csvSom(tot.ly), null]), tot.count, ...extra.map(() => null)]);
    downloadCsv(csv ?? root, rows);
  };

  // O'tgan davr / o'tgan yil uchun ma'lumot umuman yo'q bo'lsa — bu ustunlar yashiriladi
  // (aks holda hamma qatorda bir xil bo'sh farq takrorlanib, jadval keraksiz kengayadi)
  const showPrev = tot.prev !== 0;
  const showLy = !hideLy && tot.ly !== 0;
  const missing = [!showPrev && "o'tgan davr", !hideLy && !showLy && "o'tgan yil"].filter(Boolean) as string[];

  const shown = term ? nodes.filter(hit) : nodes;
  const cut = limit && !all && !term && shown.length > limit ? shown.slice(0, limit) : shown;
  const up = goodUp(kind);

  const open = (n: XNode, path: string[], which: Which, f: Filter = n.f, label?: string) =>
    drill({ kind: n.kind, f, which, title: [root, ...path, n.label, ...(label ? [label] : [])].join(' › '), expected: which === 'cur' && !label ? n.cur : which === 'prev' && !label ? n.prev : which === 'ly' && !label ? n.ly : undefined });

  const rows: ReactNode[] = [];
  const walk = (list: XNode[], depth: number, path: string[], ppath: string, parentCur: number) => {
    for (const n of list) {
      if (term && !hit(n)) continue;
      const p = `${ppath}/${n.key}`;
      const has = Boolean(n.children?.length);
      const isOpen = has && (Boolean(term) || expanded.has(p));
      const sh = share(n.cur, parentCur);
      rows.push(
        <Tr key={p} muted={depth > 0} className={cn(depth === 0 && 'font-semibold text-heading')}>
          <TreeNameCell depth={depth} open={has ? isOpen : undefined} onToggle={has ? () => toggle(p) : undefined} sub={has ? `${n.children!.length} ta ichki qator` : undefined}>
            <button
              type="button"
              onClick={() => (has ? toggle(p) : open(n, path, 'cur'))}
              title={has ? 'Ichini ochish' : "Yozuvlarni ko'rish"}
              className={cn('max-w-full truncate text-left hover:text-brand-700 hover:underline', n.x?.exact && 'italic text-(--color-text-muted)')}
            >
              {n.label}
            </button>
          </TreeNameCell>
          <LinkMoneyCell value={n.cur} strong={depth === 0} onClick={() => open(n, path, 'cur')} />
          <Td className="text-xs text-(--color-text-muted)">{pct(sh)}</Td>
          {showPrev && <LinkMoneyCell value={n.prev} onClick={() => open(n, path, 'prev')} className="font-normal text-(--color-text-muted)" />}
          {showPrev && <DiffCell value={n.cur - n.prev} growthGood={up} pct={changeOf(n.cur, n.prev)} className="font-semibold" />}
          {showLy && <LinkMoneyCell value={n.ly} onClick={() => open(n, path, 'ly')} className="font-normal text-(--color-text-muted)" />}
          {showLy && <DiffCell value={n.cur - n.ly} growthGood={up} pct={changeOf(n.cur, n.ly)} />}
          <Td className="text-xs font-normal text-(--color-text-muted)">{n.count.toLocaleString('uz')}</Td>
          {extra.map((e) => {
            const v = e.get(n);
            return (
              <LinkMoneyCell
                key={e.key}
                value={v}
                onClick={e.drill && v ? () => open(n, path, 'cur', e.drill!(n), e.label) : undefined}
                className={cn('font-normal', e.tone === 'muted' && 'text-(--color-text-muted)', e.tone === 'expense' && v > 0 && 'text-(--color-expense)')}
              />
            );
          })}
        </Tr>,
      );
      if (isOpen) walk(n.children!, depth + 1, [...path, n.label], p, n.cur);
    }
  };
  walk(cut, 0, [], '', tot.cur);

  const groups = (showPrev ? 1 : 0) + (showLy ? 1 : 0);
  const cols = 4 + groups * 2 + extra.length;
  const minWidth = 250 + 110 + 70 + groups * 2 * 112 + 64 + extra.length * 112;

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
          {actions}
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish…" data-skip-focus className="h-10 w-60 rounded-lg border border-(--color-line-strong) bg-white px-3 text-sm outline-none placeholder:text-(--color-text-faint) focus:border-brand-500" />
          <ExcelButton onClick={exportCsv} />
          {anyChildren && <ToggleAllButton open={expanded.size > 0} onClick={() => (expanded.size ? setOpened(new Set()) : expandAll())} />}
        </>
      }
    >
      <RTable minWidth={minWidth}>
        <thead>
          <tr>
            <Th rowSpan={2} className={cn(STICKY_LEFT, 'z-[2] min-w-60 text-left')}>
              {nameHeader}
            </Th>
            <Th rowSpan={2}>Joriy davr</Th>
            <Th rowSpan={2} title="Yuqori qatordagi summaga nisbatan">
              Ulushi
            </Th>
            {showPrev && <GroupTh span={2}>O&apos;tgan davr</GroupTh>}
            {showLy && <GroupTh span={2}>O&apos;tgan yil</GroupTh>}
            <Th rowSpan={2} title="Yozuvlar soni">
              Soni
            </Th>
            {extra.map((e) => (
              <Th key={e.key} rowSpan={2} title={e.hint}>
                {e.label}
              </Th>
            ))}
          </tr>
          {groups > 0 && (
            <tr>
              {showPrev && <Th className="first:border-l">Summa</Th>}
              {showPrev && <Th>Farqi, foizda</Th>}
              {showLy && <Th className={cn(!showPrev && 'first:border-l')}>Summa</Th>}
              {showLy && <Th>Farqi, foizda</Th>}
            </tr>
          )}
        </thead>
        <tbody>
          <Tr total>
            <TreeNameCell>Jami</TreeNameCell>
            <LinkMoneyCell value={tot.cur} />
            <Td className="text-xs">100%</Td>
            {showPrev && <LinkMoneyCell value={tot.prev} />}
            {showPrev && <DiffCell value={tot.cur - tot.prev} growthGood={up} pct={changeOf(tot.cur, tot.prev)} />}
            {showLy && <LinkMoneyCell value={tot.ly} />}
            {showLy && <DiffCell value={tot.cur - tot.ly} growthGood={up} pct={changeOf(tot.cur, tot.ly)} />}
            <Td className="text-xs">{tot.count.toLocaleString('uz')}</Td>
            {extra.map((e) => (
              <LinkMoneyCell key={e.key} value={nodes.reduce((a, n) => a + e.get(n), 0)} />
            ))}
          </Tr>
          {rows.length ? (
            rows
          ) : (
            <tr>
              <td colSpan={cols} className="px-4 py-8 text-center text-sm text-(--color-text-muted)">
                {term ? 'Topilmadi' : "Bu davrda ma'lumot yo'q"}
              </td>
            </tr>
          )}
        </tbody>
      </RTable>
      {(cut.length < shown.length || all) && limit && !term && shown.length > limit && (
        <div className="px-4 pb-3">
          <button type="button" onClick={() => setAll((x) => !x)} className="w-full rounded-lg border border-dashed border-brand-300 py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50">
            {all ? 'Qisqartirish' : `Yana ${shown.length - limit} ta qatorni ko'rsatish`}
          </button>
        </div>
      )}
      {missing.length > 0 && (
        <TableNote>
          {missing.join(' va ')[0]!.toUpperCase() + missing.join(' va ').slice(1)} uchun ma&apos;lumot yo&apos;q — solishtirish ustunlari ko&apos;rsatilmadi. Davrni ma&apos;lumoti bor oyga
          o&apos;zgartirsangiz, farq va foizlar paydo bo&apos;ladi.
        </TableNote>
      )}
      {note && <TableNote>{note}</TableNote>}
    </ReportCard>
  );
}

export function Num({ v, strong, muted, tone, onClick }: { v: number; strong?: boolean; muted?: boolean; tone?: 'expense' | 'income'; onClick?: () => void }) {
  const text = v === 0 ? '' : som(v);
  return (
    <td className="px-2 py-1.5 text-right">
      {onClick && v !== 0 ? (
        <button
          type="button"
          onClick={onClick}
          title={`${short(v)} — yozuvlarni ko'rish`}
          className={cn('money rounded px-1 -mx-1 hover:bg-brand-50 hover:text-brand-700 hover:underline', strong ? 'font-semibold text-heading' : muted ? 'text-(--color-text-muted)' : 'text-heading', tone === 'expense' && 'text-(--color-expense)', tone === 'income' && 'text-(--color-income)')}
        >
          {text}
        </button>
      ) : (
        <span className={cn('money', v === 0 ? 'text-(--color-text-faint)' : muted ? 'text-(--color-text-muted)' : 'text-heading', strong && 'font-semibold')}>{text}</span>
      )}
    </td>
  );
}

export function Chg({ v, diff, up }: { v: number | null; diff: number; up: boolean }) {
  const good = v === null || v === 0 ? null : v > 0 === up;
  return (
    <td className="whitespace-nowrap px-2 py-1.5 text-right">
      {diff !== 0 && <span className="money text-[11px] text-(--color-text-muted)">{`${diff > 0 ? '+' : '−'}${short(Math.abs(diff))}`}</span>}
      <span className={cn('money ml-1 text-xs font-semibold', good === null ? 'text-(--color-text-faint)' : good ? 'text-(--color-income)' : 'text-(--color-expense)')}>{v === null ? '' : `(${pctSigned(v)})`}</span>
    </td>
  );
}

/** O'tgan davr / yil: summa (bosiladi) va ostida — joriy davrning o'zgarishi (% va so'mda) */
export function Cmp({ base, c, diff, up, onClick, strong }: { base: number; c: number | null; diff: number; up: boolean; onClick?: () => void; strong?: boolean }) {
  const good = c === null || c === 0 ? null : c > 0 === up;
  return (
    <td className="px-2 py-1.5 text-right">
      {onClick && base !== 0 ? (
        <button type="button" onClick={onClick} title={`${som(base)} so'm — yozuvlarni ko'rish`} className="money -mx-1 rounded px-1 text-(--color-text-muted) hover:bg-brand-50 hover:text-brand-700 hover:underline">
          {som(base)}
        </button>
      ) : (
        <span className={cn('money', base === 0 ? 'text-(--color-text-faint)' : strong ? 'text-heading' : 'text-(--color-text-muted)')}>{base === 0 ? '' : som(base)}</span>
      )}
      <div className="money mt-0.5 text-[11px] leading-tight whitespace-nowrap">
        <span className={cn('font-semibold', good === null ? 'text-(--color-text-faint)' : good ? 'text-(--color-income)' : 'text-(--color-expense)')}>{c === null ? '' : pctSigned(c)}</span>
        {diff !== 0 && <span className="text-(--color-text-faint)">{` · ${diff > 0 ? '+' : '−'}${short(Math.abs(diff))}`}</span>}
      </div>
    </td>
  );
}
