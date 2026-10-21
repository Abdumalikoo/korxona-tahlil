'use client';

import { IconChevronRight, IconSearch } from '@/components/ui/icons';
import { cn } from '@/lib/utils';
import { useMemo, useState, type ReactNode } from 'react';
import { change, csvSom, downloadCsv, goodUp, pct, pctSigned, share, short, som, type Filter, type Kind, type Vals, type Which, type XNode } from './api';
import { useDrill } from './drill';

// ═══════════════════════════════════════════════════════════
// Ichiga kirib boriladigan jadval.
//  Nomi | Joriy | Ulushi | O'tgan davr | O'zgarish | O'tgan yil | O'zgarish | Soni (+ qo'shimcha ustunlar)
//  • nom yonidagi ▸ — ichini ochadi; ichi yo'q qator nomi — yozuvlarni ochadi;
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

const sumVals = (list: XNode[]): Vals => list.reduce((a, n) => ({ cur: a.cur + n.cur, prev: a.prev + n.prev, ly: a.ly + n.ly, count: a.count + n.count }), { cur: 0, prev: 0, ly: 0, count: 0 });

export function DrillTable({ nodes, title, description, nameHeader = 'Nomi', root, openDepth = 0, extra = [], total, csv, note, limit, hideLy, actions }: Props) {
  const { open: drill } = useDrill();
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
      const c1 = change(n.cur, n.prev);
      const c2 = change(n.cur, n.ly);
      const sh = share(n.cur, parentCur);
      rows.push(
        <tr key={p} className={cn('group border-t border-(--color-line)', depth === 0 ? 'bg-white' : depth === 1 ? 'bg-(--color-surface-muted)/40' : 'bg-(--color-surface-muted)/70')}>
          <td className="py-1.5 pr-2" style={{ paddingLeft: 10 + depth * 20 }}>
            <div className="flex min-w-0 items-center gap-1.5">
              {has ? (
                <button type="button" onClick={() => toggle(p)} aria-expanded={isOpen} aria-label={isOpen ? 'Yopish' : 'Ochish'} className="flex size-6 shrink-0 items-center justify-center rounded text-(--color-text-muted) hover:bg-brand-50 hover:text-brand-700">
                  <IconChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
                </button>
              ) : (
                <span className="size-6 shrink-0" />
              )}
              <button
                type="button"
                onClick={() => (has ? toggle(p) : open(n, path, 'cur'))}
                title={has ? 'Ichini ochish' : "Yozuvlarni ko'rish"}
                className={cn('min-w-0 truncate text-left hover:text-brand-700 hover:underline', depth === 0 ? 'font-semibold text-heading' : 'text-heading', n.x?.exact && 'italic text-(--color-text-muted)')}
              >
                {n.label}
              </button>
              {has && <span className="shrink-0 text-[11px] text-(--color-text-faint)">{n.children!.length}</span>}
            </div>
          </td>
          <Num v={n.cur} strong={depth === 0} onClick={() => open(n, path, 'cur')} />
          <td className="px-2 py-1.5 text-right">
            <div className="money text-xs text-(--color-text-muted)">{pct(sh)}</div>
            <div className="ml-auto mt-0.5 h-1 w-14 overflow-hidden rounded-full bg-(--color-surface-sunken)">
              <div className="h-full rounded-full bg-brand-500/70" style={{ width: `${Math.max(0, Math.min(100, (sh ?? 0) * 100))}%` }} />
            </div>
          </td>
          <Cmp base={n.prev} c={c1} diff={n.cur - n.prev} up={up} onClick={() => open(n, path, 'prev')} />
          {!hideLy && <Cmp base={n.ly} c={c2} diff={n.cur - n.ly} up={up} onClick={() => open(n, path, 'ly')} />}
          <td className="money px-2 py-1.5 text-right text-xs text-(--color-text-muted)">{n.count.toLocaleString('uz')}</td>
          {extra.map((e) => {
            const v = e.get(n);
            return <Num key={e.key} v={v} muted={e.tone === 'muted'} tone={e.tone === 'expense' && v > 0 ? 'expense' : undefined} onClick={e.drill && v ? () => open(n, path, 'cur', e.drill!(n), e.label) : undefined} />;
          })}
        </tr>,
      );
      if (isOpen) walk(n.children!, depth + 1, [...path, n.label], p, n.cur);
    }
  };
  walk(cut, 0, [], '', tot.cur);

  return (
    <section className="overflow-hidden rounded-(--radius-card) border border-(--color-line) bg-white shadow-card">
      <header className="flex flex-wrap items-start gap-3 border-b border-(--color-line) px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-heading">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-(--color-text-muted)">{description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <label className="relative">
            <IconSearch className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-(--color-text-faint)" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Qidirish" data-skip-focus className="h-8 w-40 rounded-(--radius-control) border border-(--color-line) pr-2 pl-7 text-sm" />
          </label>
          {anyChildren && (
            <button type="button" onClick={() => (expanded.size ? setOpened(new Set()) : expandAll())} className="h-8 rounded-(--radius-control) border border-(--color-line) px-2.5 text-xs font-medium text-heading hover:bg-brand-50">
              {expanded.size ? 'Hammasini yopish' : 'Hammasini ochish'}
            </button>
          )}
          <button type="button" onClick={exportCsv} className="h-8 rounded-(--radius-control) border border-(--color-line) px-2.5 text-xs font-medium text-heading hover:bg-brand-50">
            Excel
          </button>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead className="bg-(--color-surface-muted) text-[11px] uppercase tracking-wide text-(--color-text-muted)">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">{nameHeader}</th>
              <th className="w-32 px-2 py-2 text-right font-semibold">Joriy davr</th>
              <th className="w-20 px-2 py-2 text-right font-semibold" title="Yuqori qatordagi summaga nisbatan">Ulushi</th>
              <th className="w-36 px-2 py-2 text-right font-semibold" title="Summa va joriy davrning unga nisbatan o'zgarishi">
                O&apos;tgan davr <span className="normal-case">· o&apos;zgarish</span>
              </th>
              {!hideLy && (
                <th className="w-36 px-2 py-2 text-right font-semibold" title="Summa va joriy davrning unga nisbatan o'zgarishi">
                  O&apos;tgan yil <span className="normal-case">· o&apos;zgarish</span>
                </th>
              )}
              <th className="w-16 px-2 py-2 text-right font-semibold" title="Yozuvlar soni">Soni</th>
              {extra.map((e) => (
                <th key={e.key} className="w-28 px-2 py-2 text-right font-semibold" title={e.hint}>
                  {e.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows : (
              <tr>
                <td colSpan={(hideLy ? 5 : 6) + extra.length} className="px-4 py-8 text-center text-sm text-(--color-text-muted)">
                  {term ? 'Topilmadi' : "Bu davrda ma'lumot yo'q"}
                </td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t-2 border-(--color-line-strong) bg-(--color-surface-muted) font-semibold text-heading">
            <tr>
              <td className="px-3 py-2">Jami</td>
              <td className="money px-2 py-2 text-right">{som(tot.cur)}</td>
              <td className="money px-2 py-2 text-right text-xs">100%</td>
              <Cmp base={tot.prev} c={change(tot.cur, tot.prev)} diff={tot.cur - tot.prev} up={up} strong />
              {!hideLy && <Cmp base={tot.ly} c={change(tot.cur, tot.ly)} diff={tot.cur - tot.ly} up={up} strong />}
              <td className="money px-2 py-2 text-right text-xs">{tot.count.toLocaleString('uz')}</td>
              {extra.map((e) => (
                <td key={e.key} className="money px-2 py-2 text-right">
                  {som(nodes.reduce((a, n) => a + e.get(n), 0))}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {(cut.length < shown.length || all) && limit && !term && shown.length > limit && (
        <button type="button" onClick={() => setAll((x) => !x)} className="w-full border-t border-(--color-line) py-2 text-xs font-semibold text-brand-700 hover:bg-brand-50">
          {all ? 'Qisqartirish' : `Yana ${shown.length - limit} ta qatorni ko'rsatish`}
        </button>
      )}
      {note && <p className="border-t border-(--color-line) px-4 py-2 text-xs text-(--color-text-muted)">{note}</p>}
    </section>
  );
}

export function Num({ v, strong, muted, tone, onClick }: { v: number; strong?: boolean; muted?: boolean; tone?: 'expense' | 'income'; onClick?: () => void }) {
  const text = v === 0 ? '—' : som(v);
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
    <td className="px-2 py-1.5 text-right">
      <div className={cn('money text-xs font-semibold', good === null ? 'text-(--color-text-faint)' : good ? 'text-(--color-income)' : 'text-(--color-expense)')}>{v === null ? (diff ? 'yangi' : '—') : pctSigned(v)}</div>
      {diff !== 0 && <div className="money text-[11px] text-(--color-text-faint)">{`${diff > 0 ? '+' : '−'}${short(Math.abs(diff))}`}</div>}
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
        <span className={cn('money', base === 0 ? 'text-(--color-text-faint)' : strong ? 'text-heading' : 'text-(--color-text-muted)')}>{base === 0 ? '—' : som(base)}</span>
      )}
      <div className="money mt-0.5 text-[11px] leading-tight whitespace-nowrap">
        <span className={cn('font-semibold', good === null ? 'text-(--color-text-faint)' : good ? 'text-(--color-income)' : 'text-(--color-expense)')}>{c === null ? (diff ? 'yangi' : '0') : pctSigned(c)}</span>
        {diff !== 0 && <span className="text-(--color-text-faint)">{` · ${diff > 0 ? '+' : '−'}${short(Math.abs(diff))}`}</span>}
      </div>
    </td>
  );
}