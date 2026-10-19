'use client';

import { Card } from '@/components/ui/card';
import { IconChevronRight } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/states';
import { formatDate, formatPeriod, formatPeriodShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import type { MarkItem } from '@/features/reactions/api';
import { Mark } from '@/features/reactions/mark';
import { changeTone, compact, num, pct, TONE, type StructureKind, type StructureNode, type StructureTree } from './api';
import { Heatmap, Legend, LineChart, ShareShift, Sparkline, SplitBars } from './charts';
import { Segmented, ShareBar, SmallButton } from './parts';
import { BEHAVIOR_TEXT, behaviorOf, changePct, csvPct, csvSom, downloadCsv, lastN, mean, toNums, trendPerMonth, variation } from './stats';

const MODULE_TEXT: Record<string, string> = {
  PAYROLL: 'ish haqi moduli',
  LEASE: 'ijara moduli',
  VEHICLE: 'mashinalar moduli',
  REGIONAL: 'hududiy Excel shablon',
};

/** Solishtirish grafigidagi chiziqlar ranglari — bir-biridan aniq ajraladi */
export const COMPARE_COLORS = ['#23426a', '#2f7a57', '#b7791f', '#7a9bc2', '#b3423b'];
export const MAX_COMPARE = 5;

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';

export function changeText(change: number | null, amount: string | number): string {
  if (change === null) return Number(amount) > 0 ? 'yangi' : '—';
  return pct(change, true);
}

function signedCompact(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${compact(Math.abs(value))}`;
}

// ═══════════════════════════════════════════════════════════
// Saralash
// ═══════════════════════════════════════════════════════════

export type SortKey = 'amount' | 'previous' | 'delta' | 'change' | 'label';

export function sortNodes(nodes: StructureNode[], key: SortKey, dir: 'asc' | 'desc'): StructureNode[] {
  const value = (n: StructureNode): number | string => {
    switch (key) {
      case 'label':
        return n.label.toLowerCase();
      case 'previous':
        return Number(n.previousTiyin);
      case 'delta':
        return Number(n.amountTiyin) - Number(n.previousTiyin);
      case 'change':
        return n.changePercent ?? (Number(n.amountTiyin) > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
      default:
        return Number(n.amountTiyin);
    }
  };
  const sign = dir === 'asc' ? 1 : -1;
  return [...nodes].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb), 'uz') * sign;
    return (va - vb) * sign;
  });
}

function SortTh({
  label,
  column,
  sort,
  onSort,
  className,
}: {
  label: string;
  column: SortKey;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sort.key === column;
  return (
    <th className={cn(TH, className)} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(column)} className={cn('inline-flex items-center gap-1 uppercase hover:text-(--color-text)', active && 'text-(--color-text)')}>
        {label}
        <span className="text-[10px]">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

// ═══════════════════════════════════════════════════════════
// 1. Tugunlar jadvali: saralash, belgilash, batafsil
// ═══════════════════════════════════════════════════════════

export function NodeTable({
  kind,
  tree,
  nodes,
  colors,
  sort,
  onSort,
  selected,
  onToggle,
  onDrill,
  onOpen,
  markOf,
}: {
  kind: StructureKind;
  tree: StructureTree;
  nodes: StructureNode[];
  colors: Map<string, string>;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  onSort: (key: SortKey) => void;
  selected: string[];
  onToggle: (key: string) => void;
  onDrill: (node: StructureNode) => void;
  onOpen: (node: StructureNode) => void;
  /** Munosabat belgisi uchun modda (belgilash rejimida) */
  markOf?: (node: StructureNode) => MarkItem | null;
}) {
  const rank = new Map(tree.nodes.map((n, i) => [n.key, i + 1]));
  const previousTotal = Number(tree.previousTotalTiyin);
  const shown = { amount: 0, previous: 0 };
  nodes.forEach((n) => {
    shown.amount += Number(n.amountTiyin);
    shown.previous += Number(n.previousTiyin);
  });
  const filtered = nodes.length !== tree.nodes.length;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-y border-(--color-line) bg-(--color-surface-muted)">
          <tr>
            <th className={cn(TH, 'w-9 pl-5')} title="Solishtirish uchun belgilang (5 tagacha)">
              <span className="sr-only">Belgilash</span>
            </th>
            <th className={cn(TH, 'w-8 text-right')}>#</th>
            <SortTh label={tree.levelLabel} column="label" sort={sort} onSort={onSort} className="text-left" />
            <SortTh label="Summa, so'm" column="amount" sort={sort} onSort={onSort} className="text-right" />
            <th className={cn(TH, 'w-40 text-left')}>Ulush</th>
            <SortTh label="Avval" column="previous" sort={sort} onSort={onSort} className="hidden text-right lg:table-cell" />
            <SortTh label="Farq" column="delta" sort={sort} onSort={onSort} className="hidden text-right md:table-cell" />
            <SortTh label="O'zgarish" column="change" sort={sort} onSort={onSort} className="text-right" />
            <th className={cn(TH, 'hidden text-left xl:table-cell')}>12 oy</th>
            <th className={cn(TH, 'pr-5 text-right')}>
              <span className="sr-only">Amallar</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-(--color-line)">
          {nodes.map((node) => {
            const color = colors.get(node.key) ?? TONE.rest;
            const delta = Number(node.amountTiyin) - Number(node.previousTiyin);
            const isSelected = selected.includes(node.key);
            const shareBefore = previousTotal > 0 ? (Number(node.previousTiyin) / previousTotal) * 100 : 0;
            return (
              <tr key={node.key} className={cn('group', isSelected && 'bg-slate-50')}>
                <td className="py-2.5 pl-5">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!isSelected && selected.length >= 5}
                    onChange={() => onToggle(node.key)}
                    className="size-3.5 cursor-pointer accent-slate-800"
                    aria-label={`${node.label} — solishtirishga qo'shish`}
                  />
                </td>
                <td className="py-2.5 pr-1 text-right text-xs tabular-nums text-(--color-text-faint)">{rank.get(node.key)}</td>
                <td className="px-3 py-2.5">
                  <span className="flex items-center gap-2.5">
                    <Mark item={markOf?.(node) ?? null} />
                    <span className="size-2.5 shrink-0" style={{ background: color }} />
                    <span className="min-w-0">
                      <button
                        type="button"
                        disabled={!node.drillable}
                        onClick={() => onDrill(node)}
                        title={node.drillable ? `${node.label} — ichiga kirish` : node.label}
                        className={cn('block max-w-[22rem] truncate text-left text-(--color-text)', node.drillable && 'hover:underline')}
                      >
                        {node.label}
                      </button>
                      <span className="text-xs text-(--color-text-faint)">
                        {node.count.toLocaleString('ru-RU')} ta yozuv
                        {node.module && MODULE_TEXT[node.module] ? ` · ${MODULE_TEXT[node.module]}` : ''}
                      </span>
                    </span>
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums">{num(node.amountTiyin)}</td>
                <td className="px-3 py-2.5" title={`Avval: ${pct(shareBefore)}`}>
                  <ShareBar percent={node.sharePercent} color={TONE.slate} />
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-(--color-text-muted) lg:table-cell">{compact(node.previousTiyin)}</td>
                <td className={cn('hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums md:table-cell', changeTone(kind, node.changePercent ?? (delta > 0 ? 100 : delta < 0 ? -100 : 0)))}>
                  {signedCompact(delta)}
                </td>
                <td className={cn('whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums', changeTone(kind, node.changePercent))}>
                  {changeText(node.changePercent, node.amountTiyin)}
                </td>
                <td className="hidden px-3 py-2.5 xl:table-cell">
                  <Sparkline values={lastN(node.trend, 12)} />
                </td>
                <td className="whitespace-nowrap py-2.5 pl-2 pr-5 text-right">
                  <span className="inline-flex items-center gap-1">
                    <SmallButton onClick={() => onOpen(node)} title="Modda kartasi: statistika, prognoz, xulosa">
                      Batafsil
                    </SmallButton>
                    {node.drillable && (
                      <button
                        type="button"
                        onClick={() => onDrill(node)}
                        className="rounded p-1 text-(--color-text-faint) hover:bg-(--color-surface-sunken) hover:text-(--color-text)"
                        title="Ichiga kirish"
                        aria-label="Ichiga kirish"
                      >
                        <IconChevronRight className="size-4" />
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
          {nodes.length === 0 && (
            <tr>
              <td colSpan={10} className="px-5 py-8 text-center text-sm text-(--color-text-muted)">
                Qidiruv bo&apos;yicha hech narsa topilmadi
              </td>
            </tr>
          )}
        </tbody>
        <tfoot className="border-t-2 border-(--color-line) bg-(--color-surface-muted) font-semibold">
          <tr>
            <td />
            <td />
            <td className="px-3 py-2.5">{filtered ? `Ko'rsatilgan · ${nodes.length} ta` : `Jami · ${nodes.length} ta`}</td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{num(filtered ? shown.amount : tree.totalTiyin)}</td>
            <td className="px-3 py-2.5 text-xs text-(--color-text-muted)">
              {filtered && Number(tree.totalTiyin) > 0 ? pct((shown.amount / Number(tree.totalTiyin)) * 100) : '100%'}
            </td>
            <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-(--color-text-muted) lg:table-cell">
              {compact(filtered ? shown.previous : tree.previousTotalTiyin)}
            </td>
            <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums md:table-cell">
              {signedCompact(filtered ? shown.amount - shown.previous : Number(tree.totalTiyin) - Number(tree.previousTotalTiyin))}
            </td>
            <td className={cn('whitespace-nowrap px-3 py-2.5 text-right tabular-nums', changeTone(kind, filtered ? changePct(shown.amount, shown.previous) : tree.changePercent))}>
              {filtered ? changeText(changePct(shown.amount, shown.previous), shown.amount) : changeText(tree.changePercent, tree.totalTiyin)}
            </td>
            <td className="hidden xl:table-cell" />
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function exportNodes(kind: StructureKind, tree: StructureTree, pathText: string) {
  const months12 = lastN(tree.months, 12);
  const previousTotal = Number(tree.previousTotalTiyin);
  downloadCsv(
    `${kind === 'expense' ? 'xarajat' : 'daromad'}-tarkibi-${tree.range.from}_${tree.range.to}`,
    [
      tree.levelLabel,
      "Summa, so'm",
      'Ulush, %',
      `${tree.compareLabel}, so'm`,
      'Avvalgi ulush, %',
      "Farq, so'm",
      "O'zgarish, %",
      "Doimiy, so'm",
      "Boshqa, so'm",
      'Yozuvlar soni',
      ...months12.map((m) => formatPeriod(m)),
    ],
    [
      ...tree.nodes.map((n) => [
        n.label,
        csvSom(n.amountTiyin),
        csvPct(n.sharePercent),
        csvSom(n.previousTiyin),
        csvPct(previousTotal > 0 ? (Number(n.previousTiyin) / previousTotal) * 100 : null),
        csvSom(Number(n.amountTiyin) - Number(n.previousTiyin)),
        csvPct(n.changePercent),
        csvSom(n.doimiyTiyin),
        csvSom(n.boshqaTiyin),
        n.count,
        ...lastN(n.trend, 12).map(csvSom),
      ]),
      ['Jami', csvSom(tree.totalTiyin), '100', csvSom(tree.previousTotalTiyin), '100', csvSom(Number(tree.totalTiyin) - previousTotal), csvPct(tree.changePercent), '', '', tree.count, ...lastN(tree.totalTrend, 12).map(csvSom)],
      [],
      [`Yo'l: ${pathText}`],
      [`Davr: ${tree.range.from} — ${tree.range.to}; solishtirish: ${tree.compareLabel} (${tree.previousRange.from} — ${tree.previousRange.to})`],
    ],
  );
}

// ═══════════════════════════════════════════════════════════
// 2. Moddalarni o'zaro solishtirish
// ═══════════════════════════════════════════════════════════

export function CompareView({
  kind,
  tree,
  selected,
  onToggle,
  onOpen,
}: {
  kind: StructureKind;
  tree: StructureTree;
  selected: string[];
  onToggle: (key: string) => void;
  onOpen: (node: StructureNode) => void;
}) {
  const [mode, setMode] = useState<'amount' | 'index' | 'share'>('amount');
  const months12 = lastN(tree.months, 12);
  const chosen = selected.map((key) => tree.nodes.find((n) => n.key === key)).filter((n): n is StructureNode => Boolean(n));
  const totals12 = toNums(lastN(tree.totalTrend, 12));

  const seriesValues = (node: StructureNode): (number | null)[] => {
    const values = toNums(lastN(node.trend, 12));
    if (mode === 'share') return values.map((v, i) => (totals12[i]! > 0 ? (v / totals12[i]!) * 100 : null));
    if (mode === 'index') {
      const base = values.find((v) => v > 0);
      return base ? values.map((v) => (v / base) * 100) : values.map(() => null);
    }
    return values;
  };
  const format =
    mode === 'amount' ? compact : (v: number) => (mode === 'share' ? `${v.toFixed(1).replace('.', ',')}%` : Math.round(v).toString());

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {tree.nodes.slice(0, 20).map((node) => {
            const index = selected.indexOf(node.key);
            const on = index >= 0;
            return (
              <button
                key={node.key}
                type="button"
                disabled={!on && selected.length >= MAX_COMPARE}
                onClick={() => onToggle(node.key)}
                className={cn(
                  'inline-flex max-w-[16rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-40',
                  on ? 'border-slate-800 bg-white font-medium text-(--color-text)' : 'border-(--color-line) text-(--color-text-muted) hover:border-slate-400',
                )}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: on ? COMPARE_COLORS[index] : '#e5e7eb' }} />
                <span className="truncate">{node.label}</span>
              </button>
            );
          })}
        </div>
        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'amount', label: 'Summa', hint: "Har oy summasi, so'm" },
            { value: 'share', label: 'Ulush', hint: 'Har oy umumiy summadagi ulushi, %' },
            { value: 'index', label: 'Indeks', hint: "Birinchi oy = 100: o'sish sur'atini solishtirish uchun" },
          ]}
        />
      </div>

      {chosen.length === 0 ? (
        <p className="py-10 text-center text-sm text-(--color-text-muted)">Yuqoridan yoki jadvaldan 2–5 ta moddani tanlang.</p>
      ) : (
        <>
          <LineChart
            labels={months12.map((m) => formatPeriodShort(m))}
            tooltipLabels={months12.map((m) => formatPeriod(m))}
            format={format}
            threshold={mode === 'index' ? { value: 100, label: "Boshlang'ich daraja = 100" } : undefined}
            series={chosen.map((node, i) => ({ label: node.label, color: COMPARE_COLORS[i]!, values: seriesValues(node) }))}
          />
          <Legend items={chosen.map((node, i) => ({ color: COMPARE_COLORS[i]!, label: node.label, line: true }))} />
          <p className="text-xs text-(--color-text-muted)">
            {mode === 'amount'
              ? "Har bir chiziq — moddaning oylik summasi. Katta va kichik moddalarni o'sish bo'yicha solishtirish uchun «Indeks»ni tanlang."
              : mode === 'share'
                ? "Har oy moddaning shu daraja jami ichidagi ulushi. Chiziq ko'tarilsa — modda boshqalarga nisbatan kattalashmoqda."
                : "Indeks: har moddaning birinchi (nol bo'lmagan) oyi = 100. 150 — 1,5 baravar o'sgan, 80 — 20% kamaygan."}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-(--color-line) bg-(--color-surface-muted)">
                <tr>
                  <th className={cn(TH, 'text-left')}>Modda</th>
                  <th className={cn(TH, 'text-right')}>Joriy davr</th>
                  <th className={cn(TH, 'text-right')}>Avval</th>
                  <th className={cn(TH, 'text-right')}>O&apos;zgarish</th>
                  <th className={cn(TH, 'text-right')}>O&apos;rtacha oylik</th>
                  <th className={cn(TH, 'text-right')}>Trend, oyiga</th>
                  <th className={cn(TH, 'text-right')}>Tebranish</th>
                  <th className={cn(TH, 'text-left')}>Xarakter</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {chosen.map((node, i) => {
                  const values = toNums(lastN(node.trend, 12));
                  const slope = trendPerMonth(values);
                  const cv = variation(values);
                  const behavior = behaviorOf(values);
                  return (
                    <tr key={node.key}>
                      <td className="max-w-[16rem] px-3 py-2">
                        <span className="flex items-center gap-2">
                          <span className="h-0.5 w-4 shrink-0" style={{ background: COMPARE_COLORS[i] }} />
                          <span className="truncate" title={node.label}>{node.label}</span>
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{compact(node.amountTiyin)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-(--color-text-muted)">{compact(node.previousTiyin)}</td>
                      <td className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', changeTone(kind, node.changePercent))}>{changeText(node.changePercent, node.amountTiyin)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{compact(mean(values.filter((v) => v > 0)))}</td>
                      <td className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', changeTone(kind, slope))}>
                        {slope === null ? '—' : `${slope >= 0 ? '+' : '−'}${Math.abs(slope).toFixed(1).replace('.', ',')}%`}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{cv === null ? '—' : `${Math.round(cv)}%`}</td>
                      <td className="whitespace-nowrap px-3 py-2" title={BEHAVIOR_TEXT[behavior].hint}>{BEHAVIOR_TEXT[behavior].label}</td>
                      <td className="px-3 py-2 text-right">
                        <SmallButton onClick={() => onOpen(node)}>Batafsil</SmallButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 3. Oylar jadvali
// ═══════════════════════════════════════════════════════════

export function MonthsView({ tree, nodes, onDrill }: { tree: StructureTree; nodes: StructureNode[]; onDrill: (node: StructureNode) => void }) {
  const [scale, setScale] = useState<'row' | 'all'>('all');
  const months12 = lastN(tree.months, 12);
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-xs leading-relaxed text-(--color-text-muted)">
          {scale === 'all'
            ? "Katak qancha to'q bo'lsa, summa shuncha katta (barcha kataklar bitta shkalada) — qaysi modda qaysi oyda eng katta ekanini ko'rsatadi."
            : "Har qator o'zining eng katta oyiga nisbatan bo'yalgan — har bir moddaning qaysi oylarda ko'payishi (mavsumiyligi) ko'rinadi."}{' '}
          Qisqartmalar: B — mlrd, M — mln, K — ming so&apos;m.
        </p>
        <Segmented
          size="sm"
          value={scale}
          onChange={setScale}
          options={[
            { value: 'all', label: 'Umumiy shkala' },
            { value: 'row', label: "Har qator o'zicha" },
          ]}
        />
      </div>
      <Heatmap
        months={months12}
        scale={scale}
        rows={nodes.slice(0, 25).map((n) => ({ key: n.key, label: n.label, values: toNums(lastN(n.trend, 12)), drillable: n.drillable }))}
        onSelect={(key) => {
          const node = nodes.find((n) => n.key === key);
          if (node) onDrill(node);
        }}
      />
      {nodes.length > 25 && <p className="text-xs text-(--color-text-faint)">Eng katta 25 ta modda ko&apos;rsatilgan.</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 4. Ulush o'zgarishi
// ═══════════════════════════════════════════════════════════

export function SharesView({ tree, nodes }: { tree: StructureTree; nodes: StructureNode[] }) {
  const previousTotal = Number(tree.previousTotalTiyin);
  const rows = useMemo(
    () =>
      nodes.slice(0, 15).map((n) => ({
        key: n.key,
        label: n.label,
        now: n.sharePercent,
        before: previousTotal > 0 ? (Number(n.previousTiyin) / previousTotal) * 100 : 0,
      })),
    [nodes, previousTotal],
  );
  const gainer = [...rows].sort((a, b) => b.now - b.before - (a.now - a.before))[0];
  const loser = [...rows].sort((a, b) => a.now - a.before - (b.now - b.before))[0];
  return (
    <div className="space-y-3 px-5 py-4">
      <p className="text-xs leading-relaxed text-(--color-text-muted)">
        ○ — {tree.compareLabel}dagi ulush, ● — joriy davrdagi ulush. Chiziq uzunligi — ulush qanchaga siljigani (p.p. — foiz punkti).
        {gainer && gainer.now - gainer.before > 0.1 ? ` Eng ko'p ulush olgan: «${gainer.label}» (+${(gainer.now - gainer.before).toFixed(1).replace('.', ',')} p.p.).` : ''}
        {loser && loser.now - loser.before < -0.1 ? ` Eng ko'p ulush yo'qotgan: «${loser.label}» (−${Math.abs(loser.now - loser.before).toFixed(1).replace('.', ',')} p.p.).` : ''}
      </p>
      <ShareShift rows={rows} compareLabel={tree.compareLabel} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 5. Doimiy / Boshqa kesimi
// ═══════════════════════════════════════════════════════════

export function SplitView({ tree, nodes }: { tree: StructureTree; nodes: StructureNode[] }) {
  const doimiy = tree.nodes.reduce((s, n) => s + Number(n.doimiyTiyin), 0);
  const total = Number(tree.totalTiyin);
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-relaxed text-(--color-text-muted)">
          Har modda ichida muntazam (Doimiy) va bir martalik (Boshqa) qism. Jami bo&apos;yicha bir martalik qism — <b className="text-(--color-text)">{pct(total > 0 ? ((total - doimiy) / total) * 100 : 0)}</b>. 30% dan yuqori bo&apos;lsa qizil bilan belgilanadi.
        </p>
        <Legend items={[{ color: '#23426a', label: 'Doimiy' }, { color: '#95b0d0', label: 'Boshqa (bir martalik)' }]} />
      </div>
      <SplitBars rows={nodes.slice(0, 20).map((n) => ({ key: n.key, label: n.label, doimiy: Number(n.doimiyTiyin), boshqa: Number(n.boshqaTiyin) }))} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 6. Yozuvlar (eng quyi daraja)
// ═══════════════════════════════════════════════════════════

export function RecordsTable({ tree, pathText }: { tree: StructureTree; pathText: string }) {
  const [query, setQuery] = useState('');
  const records = tree.records ?? [];
  const q = query.trim().toLowerCase();
  const shown = q
    ? records.filter((r) => `${r.label} ${r.detail ?? ''} ${r.place} ${r.date}`.toLowerCase().includes(q))
    : records;
  const shownSum = shown.reduce((s, r) => s + Number(r.amountTiyin), 0);
  const avg = records.length ? records.reduce((s, r) => s + Number(r.amountTiyin), 0) / records.length : 0;

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <div>
          <h3 className="text-sm font-semibold">Yozuvlar</h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            {tree.recordsTotal.toLocaleString('ru-RU')} ta
            {tree.recordsTotal > records.length ? ` · summasi bo'yicha eng kattalari ${records.length} tasi` : ''} · o&apos;rtacha yozuv {compact(avg)} so&apos;m
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tavsif, joy, sana…"
            className="h-8 w-56 rounded-(--radius-control) border border-(--color-line) bg-white px-2.5 text-sm outline-none placeholder:text-(--color-text-faint) focus:border-slate-500"
          />
          <SmallButton
            onClick={() =>
              downloadCsv(
                `yozuvlar-${tree.range.from}_${tree.range.to}`,
                ['Sana', 'Tavsif', 'Izoh', 'Joy', "Summa, so'm"],
                [...shown.map((r) => [r.date, r.label, r.detail, r.place, csvSom(r.amountTiyin)]), [], [`Yo'l: ${pathText}`]],
              )
            }
          >
            Excel (CSV)
          </SmallButton>
        </div>
      </div>
      {records.length === 0 ? (
        <EmptyState title="Bu davrda yozuv yo'q" hint="period" />
      ) : (
        <div className="max-h-[34rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 border-y border-(--color-line) bg-(--color-surface-muted)">
              <tr>
                <th className={cn(TH, 'pl-5 text-left')}>Sana</th>
                <th className={cn(TH, 'text-left')}>Tavsif</th>
                <th className={cn(TH, 'text-left')}>Joy</th>
                <th className={cn(TH, 'text-right')}>Ulush</th>
                <th className={cn(TH, 'pr-5 text-right')}>Summa, so&apos;m</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-line)">
              {shown.map((record) => {
                const amount = Number(record.amountTiyin);
                const big = avg > 0 && amount > avg * 3;
                return (
                  <tr key={record.id} className="hover:bg-(--color-surface-muted)">
                    <td className="whitespace-nowrap py-2 pl-5 pr-3 tabular-nums text-(--color-text-muted)">{formatDate(record.date)}</td>
                    <td className="px-3 py-2">
                      <span className="line-clamp-1">{record.label}</span>
                      {record.detail && <span className="text-xs text-(--color-text-faint)">{record.detail}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-(--color-text-muted)">{record.place}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-(--color-text-muted)">
                      {Number(tree.totalTiyin) > 0 ? pct((amount / Number(tree.totalTiyin)) * 100) : '—'}
                    </td>
                    <td className="whitespace-nowrap py-2 pl-3 pr-5 text-right font-medium tabular-nums">
                      {big && (
                        <span className="mr-2 rounded bg-(--color-surface-sunken) px-1.5 py-0.5 text-[10px] font-semibold uppercase text-(--color-text-muted)" title="O'rtacha yozuvdan 3 baravardan ko'p">
                          yirik
                        </span>
                      )}
                      {num(record.amountTiyin)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 border-t-2 border-(--color-line) bg-(--color-surface-muted) font-semibold">
              <tr>
                <td className="py-2.5 pl-5" colSpan={4}>
                  {q ? `Topildi: ${shown.length} ta` : `Jami (${tree.recordsTotal.toLocaleString('ru-RU')} ta yozuv)`}
                </td>
                <td className="whitespace-nowrap py-2.5 pr-5 text-right tabular-nums">{num(q ? shownSum : tree.totalTiyin)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}