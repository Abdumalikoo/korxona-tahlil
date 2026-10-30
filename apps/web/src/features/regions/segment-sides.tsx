'use client';

import { changeOf, DiffCell, ExcelButton, GroupTh, MoneyCell, NameCell, PctCell, ReportCard, RTable, SearchInput, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr } from '@/components/report/report';
import { csvPct, csvSom, downloadCsv } from '@/features/structure/stats';
import { useState } from 'react';
import { formatDate } from '@/lib/format';
import { hisobApi } from '@/features/qomita/api';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import type { DrillNode, SegmentView } from './segment-api';

// ═══════════════════════════════════════════════════════════
// Solishtirma › yo'nalish (Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya, Qo'mita pullari sarfi):
// bitta jadval (Umumiy kabi): ustunlar — Daromad | Xarajat | Natija; qatorlar — jami, daromad manbalari, xarajat moddalari.
// Qo'mita: xarajat tomoni — Qo'mita pullari sarfi (3802 va Marksheyder, oylik shablon bo'yicha).
// ═══════════════════════════════════════════════════════════

const n = (s: string) => Number(s);
type Line = { key: string; label: string; cur: number; prev: number; hint?: string };

const linesOf = (nodes: DrillNode[]): Line[] =>
  nodes
    .map((x) => ({ key: x.key, label: x.label, cur: n(x.amountTiyin), prev: n(x.previousTiyin), hint: x.hint }))
    .filter((x) => x.cur !== 0 || x.prev !== 0)
    .sort((a, b) => b.cur - a.cur || b.prev - a.prev);

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
  const [query, setQuery] = useState('');
  const qq = query.trim().toLowerCase();
  const match = (x: Line) => !qq || x.label.toLowerCase().includes(qq);
  const inc = incomeLines.filter(match);
  const exp = expenseLines.filter(match);
  const cmpLabel = d.compareLabel.charAt(0).toUpperCase() + d.compareLabel.slice(1);
  const exportCsv = () =>
    downloadCsv(
      `${d.label}-daromad-xarajat-${d.range.from}_${d.range.to}`.replace(/[^\p{L}\p{N}._-]+/gu, '_'),
      ['Tomoni', 'Nomi', `${cmpLabel}, so'm`, "Joriy davr, so'm", "Farqi, so'm", 'Farqi, %'],
      [
        ...incomeLines.map((x) => ['Daromad', x.label, csvSom(x.prev), csvSom(x.cur), csvSom(x.cur - x.prev), csvPct(changeOf(x.cur, x.prev))]),
        ['Daromad', 'Jami', csvSom(income.prev), csvSom(income.cur), csvSom(income.cur - income.prev), csvPct(changeOf(income.cur, income.prev))],
        ...expenseLines.map((x) => ['Xarajat', x.label, csvSom(x.prev), csvSom(x.cur), csvSom(x.cur - x.prev), csvPct(changeOf(x.cur, x.prev))]),
        ['Xarajat', 'Jami', csvSom(expense.prev), csvSom(expense.cur), csvSom(expense.cur - expense.prev), csvPct(changeOf(expense.cur, expense.prev))],
        ['Natija', res.cur >= 0 ? 'Foyda' : 'Zarar', csvSom(res.prev), csvSom(res.cur), csvSom(res.cur - res.prev), ''],
      ],
    );

  // Bir tomonning kataklari (daromad yoki xarajat): o'tgan davr, joriy, farqi; ikkinchi tomon — bo'sh
  const sideCells = (x: { cur: number; prev: number }, growthGood: boolean, strong = false) => (
    <>
      <MoneyCell value={x.prev} className={cn(!x.prev && 'text-(--color-text-faint)')} />
      <MoneyCell value={x.cur} strong={strong} className={cn(!x.cur && 'text-(--color-text-faint)')} />
      <DiffCell value={x.cur - x.prev} pct={changeOf(x.cur, x.prev)} growthGood={growthGood} />
    </>
  );
  const blank = (k: number) => Array.from({ length: k }, (_, i) => <Td key={i} />);
  const empty = (text: string) => (
    <Tr>
      <Td className={STICKY_NO} />
      <Td colSpan={9} className="text-left text-sm text-(--color-text-faint)">
        {text}
      </Td>
    </Tr>
  );

  return (
    <ReportCard
      title="Daromad va xarajat"
      badge={`Joriy: ${formatDate(d.range.from)} — ${formatDate(d.range.to)} · ${d.compareLabel}: ${formatDate(d.previousRange.from)} — ${formatDate(d.previousRange.to)}`}
      actions={
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="Qidirish…" />
          <ExcelButton onClick={exportCsv} />
        </>
      }
    >
      <RTable minWidth={1060}>
        <thead>
          <tr>
            <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>№</Th>
            <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-44 text-left')}>Nomi</Th>
            <GroupTh span={3}>Daromad</GroupTh>
            <GroupTh span={3}>Xarajat</GroupTh>
            <GroupTh span={2}>Natija</GroupTh>
          </tr>
          <tr>
            <Th className="first:border-l">{cmpLabel}</Th>
            <Th>Joriy davr</Th>
            <Th>Farqi, foizda</Th>
            <Th>{cmpLabel}</Th>
            <Th>Joriy davr</Th>
            <Th>Farqi, foizda</Th>
            <Th>Foyda</Th>
            <Th>Rentabellik</Th>
          </tr>
        </thead>
        <tbody>
          <Tr total>
            <Td className={STICKY_NO} />
            <NameCell>Jami</NameCell>
            {sideCells(income, true, true)}
            {sideCells(expense, false, true)}
            <MoneyCell value={res.cur} strong signedColor />
            <PctCell value={income.cur > 0 ? (res.cur / income.cur) * 100 : null} plain />
          </Tr>

          <Tr className="bg-brand-50/60">
            <Td className={STICKY_NO} />
            <NameCell className="font-semibold text-heading" sub={`${incomeLines.length} ta manba`}>
              Daromad
            </NameCell>
            {sideCells(income, true, true)}
            {blank(5)}
          </Tr>
          {inc.length
            ? inc.map((x, i) => (
                <Tr key={`i:${x.key}`}>
                  <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                  <NameCell sub={x.hint}>{x.label}</NameCell>
                  {sideCells(x, true)}
                  {blank(5)}
                </Tr>
              ))
            : empty(qq ? "Qidiruv bo'yicha daromad topilmadi" : "Bu davrda daromad yo'q")}

          <Tr className="bg-brand-50/60">
            <Td className={STICKY_NO} />
            <NameCell className="font-semibold text-heading" sub={`${expenseLines.length} ta modda`}>
              Xarajat
            </NameCell>
            {blank(3)}
            {sideCells(expense, false, true)}
            {blank(2)}
          </Tr>
          {exp.length
            ? exp.map((x, i) => (
                <Tr key={`e:${x.key}`}>
                  <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                  <NameCell sub={x.hint}>{x.label}</NameCell>
                  {blank(3)}
                  {sideCells(x, false)}
                  {blank(2)}
                </Tr>
              ))
            : empty(isQomita && q.loading ? 'Yuklanmoqda…' : qq ? "Qidiruv bo'yicha xarajat topilmadi" : "Bu davrda xarajat yo'q")}
        </tbody>
      </RTable>
      <TableNote>
        Bitta jadvalda: yuqorida — jami va natija (foyda = daromad − xarajat, rentabellik = foyda ÷ daromad), keyin daromad manbalari va xarajat moddalari.
        {isQomita && " Qo'mita pullari sarfi — oylik «3802 dan olingan pullar» shabloni bo'yicha (sarfi hisobga olinmagan oylar kirmaydi); bu pul xodimlarga ish haqi sifatida to'langan."}
      </TableNote>
    </ReportCard>
  );
}
