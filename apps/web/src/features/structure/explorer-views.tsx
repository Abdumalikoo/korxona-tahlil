'use client';

import {
  changeOf,
  DiffCell,
  GroupTh,
  MoneyCell,
  NameCell,
  PctCell,
  ReportCard,
  RTable,
  SearchInput,
  ExcelButton,
  STICKY_NAME,
  STICKY_NO,
  sum,
  TableNote,
  Td,
  Th,
  Tr,
} from '@/components/report/report';
import { EmptyNote, MiniButton, pctPlain, StatusBadge } from '@/components/report/report-extra-b';
import { formatDate, formatPeriod, formatPeriodShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import type { MarkItem } from '@/features/reactions/api';
import { Mark } from '@/features/reactions/mark';
import { compact, pct, type StructureKind, type StructureNode, type StructureTree } from './api';
import { csvPct, csvSom, downloadCsv, lastN } from './stats';

// ═══════════════════════════════════════════════════════════
// Daromad / xarajat tarkibi — jadvallar (grafiklarsiz)
// ═══════════════════════════════════════════════════════════

const MODULE_TEXT: Record<string, string> = {
  PAYROLL: 'ish haqi moduli',
  LEASE: 'ijara moduli',
  VEHICLE: 'mashinalar moduli',
  REGIONAL: 'hududiy Excel shablon',
};

const cap = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export function changeText(change: number | null, _amount?: string | number): string {
  if (change === null) return '';
  return pct(change, true);
}

// ═══════════════════════════════════════════════════════════
// Saralash
// ═══════════════════════════════════════════════════════════

export type SortKey = 'amount' | 'previous' | 'delta' | 'change' | 'label';

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'amount', label: "Joriy summa bo'yicha" },
  { value: 'previous', label: "O'tgan davr bo'yicha" },
  { value: 'delta', label: "Farq bo'yicha" },
  { value: 'change', label: "O'zgarish foizi bo'yicha" },
  { value: 'label', label: "Nomi bo'yicha (A–Z)" },
];

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

// ═══════════════════════════════════════════════════════════
// 1. Tarkib jadvali: o'tgan / joriy / farq / ulush
// ═══════════════════════════════════════════════════════════

export function NodeTable({
  kind,
  tree,
  nodes,
  onDrill,
  onOpen,
  markOf,
}: {
  kind: StructureKind;
  tree: StructureTree;
  nodes: StructureNode[];
  onDrill: (node: StructureNode) => void;
  onOpen: (node: StructureNode) => void;
  /** Munosabat belgisi uchun modda (belgilash rejimida) */
  markOf?: (node: StructureNode) => MarkItem | null;
}) {
  const growthGood = kind === 'income';
  const previousTotal = Number(tree.previousTotalTiyin);
  const filtered = nodes.length !== tree.nodes.length;
  const shown = nodes.reduce((a, n) => ({ amount: a.amount + Number(n.amountTiyin), previous: a.previous + Number(n.previousTiyin) }), { amount: 0, previous: 0 });
  const total = filtered ? shown : { amount: Number(tree.totalTiyin), previous: previousTotal };

  return (
    <RTable minWidth={1000}>
      <thead>
        <tr>
          <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>№</Th>
          <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-64 text-left')}>{tree.levelLabel}</Th>
          <GroupTh span={3}>Summa, so&apos;m</GroupTh>
          <GroupTh span={2}>Ulushi</GroupTh>
          <Th rowSpan={2}>Yozuvlar</Th>
          <Th rowSpan={2} className="w-24" />
        </tr>
        <tr>
          <Th className="first:border-l">{cap(tree.compareLabel)}</Th>
          <Th>Joriy davr</Th>
          <Th>Farqi, foizda</Th>
          <Th>Avval</Th>
          <Th>Hozir</Th>
        </tr>
      </thead>
      <tbody>
        <Tr total>
          <Td className={STICKY_NO} />
          <NameCell>{filtered ? `Ko'rsatilgan · ${nodes.length} ta` : `Jami · ${nodes.length} ta`}</NameCell>
          <MoneyCell value={total.previous} />
          <MoneyCell value={total.amount} />
          <DiffCell value={total.amount - total.previous} pct={changeOf(total.amount, total.previous)} growthGood={growthGood} />
          <PctCell value={filtered && previousTotal > 0 ? (shown.previous / previousTotal) * 100 : 100} plain />
          <PctCell value={filtered && Number(tree.totalTiyin) > 0 ? (shown.amount / Number(tree.totalTiyin)) * 100 : 100} plain />
          <Td>{(filtered ? nodes.reduce((s, n) => s + n.count, 0) : tree.count).toLocaleString('ru-RU')}</Td>
          <Td />
        </Tr>
        {nodes.map((node, i) => {
          const amount = Number(node.amountTiyin);
          const previous = Number(node.previousTiyin);
          const shareBefore = previousTotal > 0 ? (previous / previousTotal) * 100 : 0;
          return (
            <Tr key={node.key} onClick={node.drillable ? () => onDrill(node) : undefined}>
              <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
              <NameCell
                drill={node.drillable}
                before={<Mark item={markOf?.(node) ?? null} />}
                sub={node.module && MODULE_TEXT[node.module] ? MODULE_TEXT[node.module] : undefined}
              >
                {node.label}
              </NameCell>
              <MoneyCell value={previous} />
              <MoneyCell value={amount} strong />
              <DiffCell value={amount - previous} pct={previous === 0 ? null : changeOf(amount, previous)} growthGood={growthGood} />
              <Td className="text-(--color-text-muted)">{pctPlain(shareBefore)}</Td>
              <Td className="font-semibold text-heading">{pctPlain(node.sharePercent)}</Td>
              <Td className="text-(--color-text-muted)">{node.count.toLocaleString('ru-RU')}</Td>
              <Td>
                <MiniButton onClick={() => onOpen(node)} title="Modda kartasi: 12 oy, ko'rsatkichlar, prognoz, xulosa">
                  Batafsil
                </MiniButton>
              </Td>
            </Tr>
          );
        })}
        {nodes.length === 0 && (
          <tr>
            <td colSpan={9} className="px-5 py-8 text-center text-sm text-(--color-text-muted)">
              Qidiruv bo&apos;yicha hech narsa topilmadi
            </td>
          </tr>
        )}
      </tbody>
    </RTable>
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
// 2. Oylar kesimi: moddalar × 12 oy (mln so'mda)
// ═══════════════════════════════════════════════════════════

/** Oylar jadvali uchun: million so'mda, bir xona kasr bilan — 351,1 */
function short(tiyin: number): string {
  if (tiyin === 0) return '';
  const mln = tiyin / 100 / 1e6;
  const [int, frac] = Math.abs(mln).toFixed(1).split('.');
  return `${mln < 0 ? '-' : ''}${int!.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0')},${frac}`;
}

export function MonthsView({ tree, nodes, onDrill }: { tree: StructureTree; nodes: StructureNode[]; onDrill: (node: StructureNode) => void }) {
  const months12 = lastN(tree.months, 12);
  const rows = nodes.slice(0, 30);
  const totals = lastN(tree.totalTrend, 12).map(Number);
  const totalSum = totals.reduce((a, b) => a + b, 0);
  return (
    <>
      <RTable minWidth={1060}>
        <thead>
          <tr>
            <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>№</Th>
            <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>{tree.levelLabel}</Th>
            <GroupTh span={months12.length}>So&apos;nggi 12 oy, mln so&apos;m</GroupTh>
            <Th rowSpan={2}>12 oy jami</Th>
          </tr>
          <tr>
            {months12.map((m, i) => (
              <Th key={m} className={cn('whitespace-nowrap', i === 0 && 'first:border-l')}>
                {formatPeriodShort(m)}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Tr total>
            <Td className={STICKY_NO} />
            <NameCell>Jami</NameCell>
            {totals.map((v, i) => (
              <Td key={months12[i]} className="whitespace-nowrap">
                {short(v)}
              </Td>
            ))}
            <Td className="whitespace-nowrap">{short(totalSum)}</Td>
          </Tr>
          {rows.map((node, i) => {
            const values = lastN(node.trend, 12).map(Number);
            const max = Math.max(...values);
            const sum12 = values.reduce((a, b) => a + b, 0);
            return (
              <Tr key={node.key} onClick={node.drillable ? () => onDrill(node) : undefined}>
                <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                <NameCell drill={node.drillable}>{node.label}</NameCell>
                {values.map((v, j) => (
                  <Td key={months12[j]} className={cn('whitespace-nowrap', v === 0 ? 'text-(--color-text-faint)' : v === max && max > 0 ? 'font-semibold text-brand-700' : '')}>
                    {short(v)}
                  </Td>
                ))}
                <Td className="whitespace-nowrap font-semibold">{short(sum12)}</Td>
              </Tr>
            );
          })}
        </tbody>
      </RTable>
      <TableNote>
        Summalar million so&apos;mda (351,1 — 351,1 mln so&apos;m). Ko&apos;k qalin — moddaning eng katta oyi.
        {nodes.length > rows.length ? ` Eng katta ${rows.length} ta modda ko'rsatilgan.` : ''}
      </TableNote>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// 3. Doimiy / Boshqa kesimi
// ═══════════════════════════════════════════════════════════

export function SplitView({ tree, nodes }: { tree: StructureTree; nodes: StructureNode[] }) {
  const doimiy = tree.nodes.reduce((s, n) => s + Number(n.doimiyTiyin), 0);
  const total = Number(tree.totalTiyin);
  const boshqa = total - doimiy;
  return (
    <>
      <RTable minWidth={860}>
        <thead>
          <tr>
            <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
            <Th className={cn(STICKY_NAME, 'z-[2] min-w-64 text-left')}>{tree.levelLabel}</Th>
            <Th>Jami, so&apos;m</Th>
            <Th>Doimiy (muntazam)</Th>
            <Th>Boshqa (bir martalik)</Th>
            <Th>Bir martalik ulushi</Th>
          </tr>
        </thead>
        <tbody>
          <Tr total>
            <Td className={STICKY_NO} />
            <NameCell>Jami</NameCell>
            <MoneyCell value={total} />
            <MoneyCell value={doimiy} />
            <MoneyCell value={boshqa} />
            <Td>{pctPlain(total > 0 ? (boshqa / total) * 100 : null)}</Td>
          </Tr>
          {nodes.map((n, i) => {
            const amount = Number(n.amountTiyin);
            const b = Number(n.boshqaTiyin);
            const share = amount > 0 ? (b / amount) * 100 : null;
            return (
              <Tr key={n.key}>
                <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                <NameCell>{n.label}</NameCell>
                <MoneyCell value={amount} strong />
                <MoneyCell value={Number(n.doimiyTiyin)} />
                <MoneyCell value={b} />
                <Td>
                  <StatusBadge tone={share === null ? 'muted' : share >= 30 ? 'red' : share > 0 ? 'amber' : 'green'}>{pctPlain(share)}</StatusBadge>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </RTable>
      <TableNote>Doimiy — muntazam takrorlanadigan yozuvlar, Boshqa — bir martalik. Bir martalik ulushi 30% dan yuqori bo&apos;lsa qizil.</TableNote>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// 4. Yozuvlar (eng quyi daraja)
// ═══════════════════════════════════════════════════════════

export function RecordsTable({ tree, pathText }: { tree: StructureTree; pathText: string }) {
  const [query, setQuery] = useState('');
  const records = tree.records ?? [];
  const q = query.trim().toLowerCase();
  const shown = q ? records.filter((r) => `${r.label} ${r.detail ?? ''} ${r.place} ${r.date}`.toLowerCase().includes(q)) : records;
  const shownSum = shown.reduce((s, r) => s + Number(r.amountTiyin), 0);
  const avg = records.length ? records.reduce((s, r) => s + Number(r.amountTiyin), 0) / records.length : 0;
  const total = Number(tree.totalTiyin);

  return (
    <ReportCard
      title="Yozuvlar"
      badge={`${tree.recordsTotal.toLocaleString('ru-RU')} ta${tree.recordsTotal > records.length ? ` · eng kattalari ${records.length} tasi` : ''} · o'rtacha ${compact(avg)} so'm`}
      actions={
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="Tavsif, joy, sana…" />
          <ExcelButton
            onClick={() =>
              downloadCsv(
                `yozuvlar-${tree.range.from}_${tree.range.to}`,
                ['Sana', 'Tavsif', 'Izoh', 'Joy', "Summa, so'm"],
                [...shown.map((r) => [r.date, r.label, r.detail, r.place, csvSom(r.amountTiyin)]), [], [`Yo'l: ${pathText}`]],
              )
            }
          />
        </>
      }
    >
      {records.length === 0 ? (
        <EmptyNote>Bu davrda yozuv yo&apos;q</EmptyNote>
      ) : (
        <RTable minWidth={900}>
          <thead>
            <tr>
              <Th className="w-12">№</Th>
              <Th className="w-28">Sana</Th>
              <Th className="text-left">Tavsif</Th>
              <Th className="text-left">Joy</Th>
              <Th>Ulushi</Th>
              <Th>Summa, so&apos;m</Th>
            </tr>
          </thead>
          <tbody>
            <Tr total>
              <Td />
              <Td />
              <Td className="text-left" colSpan={3}>
                {q ? `Topildi: ${shown.length} ta` : `Jami (${tree.recordsTotal.toLocaleString('ru-RU')} ta yozuv)`}
              </Td>
              <MoneyCell value={q ? shownSum : total} />
            </Tr>
            {shown.map((record, i) => {
              const amount = Number(record.amountTiyin);
              const big = avg > 0 && amount > avg * 3;
              return (
                <Tr key={record.id}>
                  <Td className="text-(--color-text-faint)">{i + 1}</Td>
                  <Td className="whitespace-nowrap text-(--color-text-muted)">{formatDate(record.date)}</Td>
                  <Td className="text-left">
                    <span className="line-clamp-1">{record.label}</span>
                    {record.detail && <span className="block text-[11px] text-(--color-text-faint)">{record.detail}</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-left text-(--color-text-muted)">{record.place}</Td>
                  <Td className="text-(--color-text-muted)">{total > 0 ? pctPlain((amount / total) * 100) : ''}</Td>
                  <Td className="whitespace-nowrap font-semibold">
                    {big && (
                      <span className="mr-2" title="O'rtacha yozuvdan 3 baravardan ko'p">
                        <StatusBadge tone="amber">yirik</StatusBadge>
                      </span>
                    )}
                    {sum(amount)}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </RTable>
      )}
    </ReportCard>
  );
}
