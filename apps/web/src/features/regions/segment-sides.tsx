'use client';

import { changeOf, DiffCell, ExcelButton, MoneyCell, NameCell, PctCell, ReportCard, RTable, SearchInput, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr } from '@/components/report/report';
import { csvPct, csvSom, downloadCsv } from '@/features/structure/stats';
import { useState } from 'react';
import { hisobApi } from '@/features/qomita/api';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import type { DrillNode, SegmentView } from './segment-api';

// ═══════════════════════════════════════════════════════════
// Solishtirma › yo'nalish (Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya, Qo'mita pullari sarfi):
// bir tomonda DAROMAD, bir tomonda XARAJAT (o'tgan va joriy davr, ulush), pastda NATIJA.
// Qo'mita: xarajat tomoni — Qo'mita pullari sarfi (3802 va Marksheyder, oylik shablon bo'yicha).
// ═══════════════════════════════════════════════════════════

const n = (s: string) => Number(s);
type Line = { key: string; label: string; cur: number; prev: number; hint?: string };

const linesOf = (nodes: DrillNode[]): Line[] =>
  nodes
    .map((x) => ({ key: x.key, label: x.label, cur: n(x.amountTiyin), prev: n(x.previousTiyin), hint: x.hint }))
    .filter((x) => x.cur !== 0 || x.prev !== 0)
    .sort((a, b) => b.cur - a.cur || b.prev - a.prev);

function Side({ title, unit, lines: all, total, growthGood, compareLabel, empty, note, period }: { title: string; unit: string; lines: Line[]; total: { cur: number; prev: number }; growthGood: boolean; compareLabel: string; empty: string; note?: string; period: string }) {
  // Markaz va Hududlar kabi: qidirish va Excelga eksport — karta sarlavhasida
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const lines = q ? all.filter((x) => x.label.toLowerCase().includes(q)) : all;
  const exportCsv = () =>
    downloadCsv(
      `${unit}-${title.toLowerCase()}-${period}`.replace(/[^\p{L}\p{N}._-]+/gu, '_'),
      ['Nomi', `${compareLabel}, so'm`, "Joriy davr, so'm", 'Ulushi, %'],
      [...all.map((x) => [x.label, csvSom(x.prev), csvSom(x.cur), csvPct(total.cur > 0 ? (x.cur / total.cur) * 100 : null)]), ['Jami', csvSom(total.prev), csvSom(total.cur), '100']],
    );
  return (
    <ReportCard
      title={title}
      badge={`${lines.length} ta`}
      actions={
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="Qidirish…" />
          <ExcelButton onClick={exportCsv} />
        </>
      }
    >
      <RTable minWidth={560}>
        <thead>
          <tr>
            <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
            <Th className={cn(STICKY_NAME, 'z-[2] min-w-44 text-left')}>Nomi</Th>
            <Th>{compareLabel.charAt(0).toUpperCase() + compareLabel.slice(1)}</Th>
            <Th>Joriy davr</Th>
            <Th>Ulushi</Th>
          </tr>
        </thead>
        <tbody>
          <Tr total>
            <Td className={STICKY_NO} />
            <NameCell>Jami</NameCell>
            <MoneyCell value={total.prev} />
            <MoneyCell value={total.cur} />
            <PctCell value={total.cur > 0 ? 100 : null} plain className="font-normal text-(--color-text-muted)" />
          </Tr>
          {lines.length ? (
            lines.map((x, i) => (
              <Tr key={x.key}>
                <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                <NameCell sub={x.hint}>{x.label}</NameCell>
                <MoneyCell value={x.prev} className={cn(!x.prev && 'text-(--color-text-faint)')} />
                <MoneyCell value={x.cur} className={cn(!x.cur && 'text-(--color-text-faint)')} />
                <PctCell value={total.cur > 0 ? (x.cur / total.cur) * 100 : null} plain growthGood={growthGood} className="font-normal text-(--color-text-muted)" />
              </Tr>
            ))
          ) : (
            <Tr>
              <Td className={STICKY_NO} />
              <Td colSpan={4} className="text-left text-sm text-(--color-text-faint)">
                {empty}
              </Td>
            </Tr>
          )}
        </tbody>
      </RTable>
      {note && <TableNote>{note}</TableNote>}
    </ReportCard>
  );
}

export function SegmentSides({ d, isQomita }: { d: SegmentView; isQomita: boolean }) {
  const t = d.totals;
  // Qo'mita: sarf — oylik shablon bo'yicha (3802 va Marksheyder); joriy va o'tgan davr oylari
  const curM = [d.range.from.slice(0, 7), d.range.to.slice(0, 7)] as const;
  const prevM = [d.previousRange.from.slice(0, 7), d.previousRange.to.slice(0, 7)] as const;
  const q = useAsync(
    () => (isQomita ? hisobApi.ledger(prevM[0] < curM[0] ? prevM[0] : curM[0], curM[1]).then((r) => r.data) : Promise.resolve(null)),
    [isQomita, curM[0], curM[1], prevM[0]],
  );
  const spend = (side: 'pool' | 'marksheyder', a: string, b: string) => (q.data ? q.data.months.reduce((s, p, i) => (p >= a && p <= b ? s + n(q.data![side].months[i]!.spendTiyin) : s), 0) : 0);

  const income = { cur: n(t.incomeTiyin), prev: n(t.previousIncomeTiyin) };
  const incomeLines = linesOf(d.tree.income);
  let expense = { cur: n(t.expenseTiyin), prev: n(t.previousExpenseTiyin) };
  let expenseLines = linesOf(d.tree.expense);
  if (isQomita && q.data) {
    expenseLines = [
      { key: 'q3802', label: '3802 sarfi', hint: "hamma bo'limlar xodimlari — shablonning asosiy varag'i", cur: spend('pool', curM[0], curM[1]), prev: spend('pool', prevM[0], prevM[1]) },
      { key: 'qmar', label: 'Marksheyder sarfi', hint: "shablonning Marksheyder varag'i", cur: spend('marksheyder', curM[0], curM[1]), prev: spend('marksheyder', prevM[0], prevM[1]) },
      ...expenseLines.map((x) => ({ ...x, hint: x.hint ?? "Qo'mita yo'nalishiga yozilgan xarajat" })),
    ].filter((x) => x.cur !== 0 || x.prev !== 0);
    expense = expenseLines.reduce((a, x) => ({ cur: a.cur + x.cur, prev: a.prev + x.prev }), { cur: 0, prev: 0 });
  }
  const res = { cur: income.cur - expense.cur, prev: income.prev - expense.prev };
  const margin = (r: number, i: number) => (i > 0 ? (r / i) * 100 : null);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <Side title="Daromad" unit={d.label} period={`${d.range.from}_${d.range.to}`} lines={incomeLines} total={income} growthGood compareLabel={d.compareLabel} empty="Bu davrda daromad yo'q" />
        <Side
          title="Xarajat"
          unit={d.label}
          period={`${d.range.from}_${d.range.to}`}
          lines={expenseLines}
          total={expense}
          growthGood={false}
          compareLabel={d.compareLabel}
          empty={isQomita && q.loading ? 'Yuklanmoqda…' : "Bu davrda xarajat yo'q"}
          note={isQomita ? "Qo'mita pullari sarfi — oylik «3802 dan olingan pullar» shabloni bo'yicha (sarfi hisobga olinmagan oylar kirmaydi); bu pul xodimlarga ish haqi sifatida to'langan." : undefined}
        />
      </div>
      <ReportCard title="Natija: daromad − xarajat">
        <RTable minWidth={640}>
          <thead>
            <tr>
              <Th className={cn(STICKY_NAME, 'z-[2] min-w-44 text-left')}>Ko&apos;rsatkich</Th>
              <Th>{d.compareLabel.charAt(0).toUpperCase() + d.compareLabel.slice(1)}</Th>
              <Th>Joriy davr</Th>
              <Th>Farqi, foizda</Th>
            </tr>
          </thead>
          <tbody>
            <Tr>
              <NameCell>Daromad</NameCell>
              <MoneyCell value={income.prev} />
              <MoneyCell value={income.cur} />
              <DiffCell value={income.cur - income.prev} pct={changeOf(income.cur, income.prev)} />
            </Tr>
            <Tr>
              <NameCell>Xarajat</NameCell>
              <MoneyCell value={expense.prev} />
              <MoneyCell value={expense.cur} />
              <DiffCell value={expense.cur - expense.prev} pct={changeOf(expense.cur, expense.prev)} growthGood={false} />
            </Tr>
            <Tr total>
              <NameCell sub={margin(res.cur, income.cur) === null ? undefined : `rentabellik ${margin(res.cur, income.cur)!.toFixed(1).replace('.', ',')}%`}>{res.cur >= 0 ? 'Natija (foyda)' : 'Natija (zarar)'}</NameCell>
              <MoneyCell value={res.prev} signedColor />
              <MoneyCell value={res.cur} strong signedColor />
              <DiffCell value={res.cur - res.prev} />
            </Tr>
          </tbody>
        </RTable>
      </ReportCard>
    </div>
  );
}
