'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import {
  changeOf,
  DiffCell,
  ExcelButton,
  GroupTh,
  PctBadge,
  PctCell,
  ReportCard,
  RTable,
  SelectBox,
  StatTiles,
  STICKY_NAME,
  STICKY_NO,
  TableNote,
  Td,
  Th,
  Tr,
} from '@/components/report/report';
import { LinkMoneyCell, STICKY_LEFT, TreeNameCell } from '@/components/report/report-extra-a';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { calcChange, calcMargin, calcResult, Q } from '@/lib/calc';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, useState, type ReactNode } from 'react';
import { csvSom, downloadCsv, exploreApi, monthLabel, pct, share, short, som, spanText, type PnlRow, type ResultExplore, type UnitRow, type XNode } from './api';
import { DrillProvider, useDrill } from './drill';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa › Tahlil › Natija jadvali — bir qarashda:
//  ko'rsatkich kartalari → foyda va zarar hisoboti (davrlar solishtirmasi + oylar) →
//  Markaz, hududlar va yo'nalishlar natijasi. Grafiklar yo'q; har bir summa bosiladi — yozuvlar ochiladi.
// ═══════════════════════════════════════════════════════════

/** only = 'pnl' — Chuqur tahlil › Dinamika: faqat oylar bo'yicha natija (kartalar va birliklar jadvali boshqa joyda) */
export function ResultExplorer({ range, only }: { range: DateRange; only?: 'pnl' }) {
  const res = useAsync(() => exploreApi.result(range.from, range.to).then((r) => r.data), [range.from, range.to]);
  if (res.loading && !res.data) return <LoadingState />;
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  const d = res.data!;
  return (
    <DrillProvider range={range}>
      <Body d={d} only={only} />
    </DrillProvider>
  );
}

function Body({ d, only }: { d: ResultExplore; only?: 'pnl' }) {
  const { open } = useDrill();
  const t = d.totals;
  const marginText = (v: number | null) => (v === null ? '' : pct(v));
  return (
    <div className="space-y-4">
      {!only && <StatTiles
        compareLabel="Avval"
        items={[
          {
            label: 'Daromad',
            value: t.income.cur,
            previous: t.income.prev,
            tone: 'green',
            icon: <IconUp />,
            onClick: () => open({ kind: 'income', f: {}, title: 'Daromad › Jami', expected: t.income.cur }),
          },
          {
            label: 'Xarajat',
            value: t.expense.cur,
            previous: t.expense.prev,
            growthGood: false,
            tone: 'red',
            icon: <IconDown />,
            onClick: () => open({ kind: 'expense', f: {}, title: 'Xarajat › Jami', expected: t.expense.cur }),
          },
          {
            label: t.result.cur >= 0 ? 'Natija (foyda)' : 'Natija (zarar)',
            value: t.result.cur,
            previous: t.result.prev,
            signed: true,
            tone: 'blue',
            calc: calcResult(t.income.cur, t.expense.cur, { title: 'Natija' }),
          },
          {
            label: 'Rentabellik',
            value: 0,
            text: marginText(t.margin),
            note: `O'tgan davr ${marginText(t.marginPrev)} · o'tgan yil ${marginText(t.marginLy)}`,
            tone: 'purple',
            icon: <IconPercent />,
            calc: calcMargin(t.income.cur, t.expense.cur, {}),
          },
          {
            label: 'Debitorlik / kreditorlik',
            value: 0,
            text: `${short(t.receivable)} / ${short(t.payable)}`,
            note: "Olinmagan daromad / to'lanmagan xarajat",
            tone: 'orange',
            icon: <IconScale />,
          },
        ]}
      />}

      <PnlTable d={d} />
      {!only && <UnitsTable units={d.units} totals={d.totals} />}
    </div>
  );
}

// ───────────────────────── Foyda va zarar ─────────────────────────

function PnlTable({ d }: { d: ResultExplore }) {
  const { open } = useDrill();
  const [opened, setOpened] = useState<Set<string>>(new Set(['income', 'expense']));
  const months = d.monthList;
  const toggle = (k: string) =>
    setOpened((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const rowOf = (r: PnlRow, depth: number, path: string[], id: string, up: boolean, total = false): ReactNode[] => {
    const has = Boolean(r.children?.length);
    const isOpen = opened.has(id);
    const drill = (month: string | undefined, which: 'cur' | 'prev' | 'ly', expected: number) =>
      r.kind && r.f ? () => open({ kind: r.kind!, f: month ? { ...r.f!, month } : r.f!, which, title: [...path, r.label, ...(month ? [formatPeriod(month)] : [])].join(' › '), expected }) : undefined;
    const signed = !r.kind;
    const out: ReactNode[] = [
      <Tr key={id} total={total} muted={depth > 0} className={cn(depth === 0 && !total && 'font-semibold text-heading')}>
        <TreeNameCell depth={depth} open={has ? isOpen : undefined} onToggle={has ? () => toggle(id) : undefined}>
          {r.label}
        </TreeNameCell>
        <LinkMoneyCell value={r.prev} onClick={drill(undefined, 'prev', r.prev)} signedColor={signed} />
        <LinkMoneyCell value={r.total} onClick={drill(undefined, 'cur', r.total)} strong signedColor={signed} />
        <DiffCell value={r.total - r.prev} growthGood={up} pct={changeOf(r.total, r.prev)} />
        <LinkMoneyCell value={r.ly} onClick={drill(undefined, 'ly', r.ly)} signedColor={signed} />
        <DiffCell value={r.total - r.ly} growthGood={up} pct={changeOf(r.total, r.ly)} />
        {months.map((m, i) => (
          <LinkMoneyCell key={m} value={r.values[i] ?? 0} onClick={drill(m, 'cur', r.values[i] ?? 0)} signedColor={signed} className="font-normal" />
        ))}
      </Tr>,
    ];
    if (has && isOpen) r.children!.forEach((c) => out.push(...rowOf(c, depth + 1, [...path, r.label], `${id}/${c.key}`, up)));
    return out;
  };

  const m = d.pnl.margin;
  const pp = (a: number | null, b: number | null) => (a !== null && b !== null ? (a - b) * 100 : null);
  const ppText = (v: number | null) => (v === null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',')} p.p.`);
  const marginRow = (
    <Tr muted>
      <TreeNameCell>Rentabellik (natija / daromad)</TreeNameCell>
      <Td>{pct(m.prev)}</Td>
      <Td className="font-semibold text-heading">{pct(m.total)}</Td>
      <Td className={cn('text-xs font-semibold', (pp(m.total, m.prev) ?? 0) < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{ppText(pp(m.total, m.prev))}</Td>
      <Td>{pct(m.ly)}</Td>
      <Td className={cn('text-xs font-semibold', (pp(m.total, m.ly) ?? 0) < 0 ? 'text-(--color-expense)' : 'text-(--color-income)')}>{ppText(pp(m.total, m.ly))}</Td>
      {m.values.map((v, i) => (
        <Td key={i} className={cn((v ?? 0) < 0 && 'text-(--color-expense)')}>
          {pct(v)}
        </Td>
      ))}
    </Tr>
  );

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [['Ko‘rsatkich', "O'tgan davr (so'm)", "Joriy davr (so'm)", "O'tgan yil (so'm)", ...months.map(formatPeriod)]];
    const add = (r: PnlRow, depth: number) => {
      rows.push([`${'   '.repeat(depth)}${r.label}`, csvSom(r.prev), csvSom(r.total), csvSom(r.ly), ...r.values.map(csvSom)]);
      r.children?.forEach((c) => add(c, depth + 1));
    };
    add(d.pnl.income, 0);
    add(d.pnl.expense, 0);
    add(d.pnl.result, 0);
    const p = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
    rows.push(['Rentabellik, %', p(m.prev), p(m.total), p(m.ly), ...m.values.map(p)]);
    downloadCsv('Foyda va zarar hisoboti', rows);
  };

  return (
    <ReportCard
      title="Foyda va zarar hisoboti"
      badge={`Joriy: ${spanText(d.cur)} · o'tgan davr: ${spanText(d.prev)} · o'tgan yil: ${spanText(d.ly)}`}
      actions={<ExcelButton onClick={exportCsv} />}
    >
      <RTable minWidth={260 + 5 * 118 + months.length * 108}>
        <thead>
          <tr>
            <Th rowSpan={2} className={cn(STICKY_LEFT, 'z-[2] min-w-60 text-left')}>
              Ko&apos;rsatkich
            </Th>
            <GroupTh span={3}>O&apos;tgan davr bilan</GroupTh>
            <GroupTh span={2}>O&apos;tgan yil bilan</GroupTh>
            {months.length > 0 && <GroupTh span={months.length}>Oylar bo&apos;yicha (joriy davr)</GroupTh>}
          </tr>
          <tr>
            <Th className="first:border-l">O&apos;tgan davr</Th>
            <Th>Joriy davr</Th>
            <Th>Farqi, foizda</Th>
            <Th>O&apos;tgan yil</Th>
            <Th>Farqi, foizda</Th>
            {months.map((mo) => (
              <Th key={mo} className="whitespace-nowrap">
                {monthLabel(mo)}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowOf(d.pnl.result, 0, [], 'result', true, true)}
          {rowOf(d.pnl.income, 0, [], 'income', true)}
          {rowOf(d.pnl.expense, 0, [], 'expense', false)}
          {marginRow}
        </tbody>
      </RTable>
      <TableNote>
        ›-ni bosing — modda ichidagi qatorlar ochiladi. Istalgan summani bosing — uni tashkil qilgan yozuvlar ochiladi. Oylar jadvalning o&apos;ng qismida — o&apos;ngga suring.
      </TableNote>
    </ReportCard>
  );
}

// ───────────────────────── Birliklar ─────────────────────────

type UnitSort = 'order' | 'result' | 'margin';
const UNIT_SORTS: { value: UnitSort; label: string }[] = [
  { value: 'order', label: "Markaz, hududlar, yo'nalishlar" },
  { value: 'result', label: "Natija bo'yicha" },
  { value: 'margin', label: "Rentabellik bo'yicha" },
];

function UnitsTable({ units, totals }: { units: UnitRow[]; totals: ResultExplore['totals'] }) {
  const { open } = useDrill();
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<UnitSort>('order');
  const list = [...units].sort((a, b) => (sort === 'result' ? b.result.cur - a.result.cur : sort === 'margin' ? (b.margin ?? -9) - (a.margin ?? -9) : 0));
  const filterOf = (u: UnitRow) => ({ unit: u.key });
  const toggle = (k: string) =>
    setOpened((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const exportCsv = () =>
    downloadCsv("Markaz, hududlar va yo'nalishlar natijasi", [
      ['Birlik', "Daromad: o'tgan davr (so'm)", "Daromad: joriy (so'm)", "Xarajat: o'tgan davr (so'm)", "Xarajat: joriy (so'm)", "Natija: o'tgan davr (so'm)", "Natija: joriy (so'm)", "Natija: o'tgan yil (so'm)", 'Rentabellik, %', 'Daromad ulushi, %'],
      ...list.map((u) => [
        u.label,
        csvSom(u.income.prev),
        csvSom(u.income.cur),
        csvSom(u.expense.prev),
        csvSom(u.expense.cur),
        csvSom(u.result.prev),
        csvSom(u.result.cur),
        csvSom(u.result.ly),
        u.margin === null ? null : Math.round(u.margin * 1000) / 10,
        totals.income.cur ? Math.round((u.income.cur / totals.income.cur) * 1000) / 10 : null,
      ]),
    ]);

  const margin = (v: number | null) => (v === null ? null : v * 100);

  return (
    <ReportCard
      title="Markaz, hududlar va yo'nalishlar natijasi"
      actions={
        <>
          <SelectBox value={sort} options={UNIT_SORTS} onChange={setSort} className="h-9 min-w-52" />
          <ExcelButton onClick={exportCsv} />
        </>
      }
    >
      <RTable minWidth={1000}>
        <thead>
          <tr>
            <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>
              №
            </Th>
            <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>
              Birlik
            </Th>
            <GroupTh span={3}>Daromad</GroupTh>
            <GroupTh span={3}>Xarajat</GroupTh>
            <GroupTh span={3}>Natija</GroupTh>
          </tr>
          <tr>
            <Th className="first:border-l">O&apos;tgan davr</Th>
            <Th>Joriy davr</Th>
            <Th>Farqi, foizda</Th>
            <Th>O&apos;tgan davr</Th>
            <Th>Joriy davr</Th>
            <Th>Farqi, foizda</Th>
            <Th>Joriy davr</Th>
            <Th>Farqi, foizda</Th>
            <Th>Rentabellik</Th>
          </tr>
        </thead>
        <tbody>
          <Tr total>
            <Td className={STICKY_NO} />
            <TreeNameCell sticky={STICKY_NAME}>Jami</TreeNameCell>
            <LinkMoneyCell value={totals.income.prev} />
            <LinkMoneyCell value={totals.income.cur} />
            <DiffCell value={totals.income.cur - totals.income.prev} pct={changeOf(totals.income.cur, totals.income.prev)} />
            <LinkMoneyCell value={totals.expense.prev} />
            <LinkMoneyCell value={totals.expense.cur} />
            <DiffCell value={totals.expense.cur - totals.expense.prev} growthGood={false} pct={changeOf(totals.expense.cur, totals.expense.prev)} />
            <LinkMoneyCell value={totals.result.cur} signedColor calc={calcResult(totals.income.cur, totals.expense.cur, { title: 'Jami natija' })} />
            <DiffCell value={totals.result.cur - totals.result.prev} pct={changeOf(totals.result.cur, totals.result.prev)} />
            <PctCell value={margin(totals.margin)} plain />
          </Tr>
          {list.map((u, i) => {
            const isOpen = opened.has(u.key);
            return (
              <Fragment key={u.key}>
                <Tr onClick={() => toggle(u.key)} muted={u.key === 'center'}>
                  <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                  <TreeNameCell sticky={STICKY_NAME} open={isOpen} onToggle={() => toggle(u.key)} className="font-medium text-heading">
                    {u.label}
                  </TreeNameCell>
                  <LinkMoneyCell value={u.income.prev} onClick={() => open({ kind: 'income', f: filterOf(u), which: 'prev', title: `Daromad › ${u.label}`, expected: u.income.prev })} />
                  <LinkMoneyCell value={u.income.cur} onClick={() => open({ kind: 'income', f: filterOf(u), title: `Daromad › ${u.label}`, expected: u.income.cur })} />
                  <DiffCell
                    value={u.income.cur - u.income.prev}
                    pct={changeOf(u.income.cur, u.income.prev)}
                    calc={calcChange(`${u.label}: daromad o'zgarishi`, Q.money('Joriy davr', u.income.cur), Q.money("O'tgan davr", u.income.prev), { growthGood: true })}
                  />
                  <LinkMoneyCell value={u.expense.prev} onClick={() => open({ kind: 'expense', f: filterOf(u), which: 'prev', title: `Xarajat › ${u.label}`, expected: u.expense.prev })} />
                  <LinkMoneyCell value={u.expense.cur} onClick={() => open({ kind: 'expense', f: filterOf(u), title: `Xarajat › ${u.label}`, expected: u.expense.cur })} />
                  <DiffCell
                    value={u.expense.cur - u.expense.prev}
                    growthGood={false}
                    pct={changeOf(u.expense.cur, u.expense.prev)}
                    calc={calcChange(`${u.label}: xarajat o'zgarishi`, Q.money('Joriy davr', u.expense.cur), Q.money("O'tgan davr", u.expense.prev), { growthGood: false })}
                  />
                  <LinkMoneyCell value={u.result.cur} strong signedColor calc={calcResult(u.income.cur, u.expense.cur, { title: `Natija: ${u.label}` })} />
                  <DiffCell value={u.result.cur - u.result.prev} pct={changeOf(u.result.cur, u.result.prev)} />
                  <PctCell value={margin(u.margin)} plain />
                </Tr>
                {isOpen && (
                  <tr>
                    <td colSpan={11} className="border-b border-(--color-line) bg-[#f8f9fc] px-6 py-3">
                      <div className="flex flex-col gap-6 lg:flex-row">
                        <TopList u={u} title="Eng katta daromad moddalari" nodes={u.incomeTop} total={u.income.cur} />
                        <TopList u={u} title="Eng katta xarajat guruhlari" nodes={u.expenseTop} total={u.expense.cur} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </RTable>
      <TableNote>
        Qatorni bosing — eng katta daromad va xarajat moddalari ochiladi; summani bosing — yozuvlar. Birlik qoidasi Solishtirma bilan bir xil: hudud kodi bo&apos;lsa — o&apos;sha hudud; hudud
        yo&apos;q, bo&apos;lim bor — Markaz. Markaz xarajatlari hududlarga taqsimlanmagan (taqsimlangan ko&apos;rinish — Solishtirma bo&apos;limida).
      </TableNote>
    </ReportCard>
  );
}

function TopList({ u, title, nodes, total }: { u: UnitRow; title: string; nodes: XNode[]; total: number }) {
  const { open } = useDrill();
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1.5 text-xs font-bold text-heading">{title}</p>
      {nodes.length ? (
        <table className="w-full overflow-hidden rounded-lg border border-(--color-line) bg-white text-xs">
          <thead>
            <tr className="bg-[#f3f6fd] text-heading">
              <th className="px-2 py-1.5 text-left font-semibold">Modda</th>
              <th className="w-28 px-2 py-1.5 text-center font-semibold">Joriy davr</th>
              <th className="w-16 px-2 py-1.5 text-center font-semibold">Ulushi</th>
              <th className="w-20 px-2 py-1.5 text-center font-semibold">O&apos;zgarish</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.key} className="border-t border-(--color-line)">
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => open({ kind: n.kind, f: n.f, title: [n.kind === 'income' ? 'Daromad' : 'Xarajat', u.label, n.label].join(' › '), expected: n.cur })}
                    className="text-left text-heading hover:text-brand-700 hover:underline"
                  >
                    {n.label}
                  </button>
                </td>
                <td className="px-2 py-1.5 text-center tabular-nums text-heading">{som(n.cur)}</td>
                <td className="px-2 py-1.5 text-center tabular-nums text-(--color-text-muted)">{pct(share(n.cur, total))}</td>
                <td className="px-2 py-1.5 text-center">
                  <PctBadge value={changeOf(n.cur, n.prev)} growthGood={n.kind !== 'expense'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-(--color-text-faint)">Yo&apos;q</p>
      )}
    </div>
  );
}

// ─────────── Kartalar belgilari ───────────

function IconUp() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
    </svg>
  );
}

function IconDown() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 7l6 6 4-4 8 8M15 17h6v-6" />
    </svg>
  );
}

function IconPercent() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 5L5 19M7 9a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z" />
    </svg>
  );
}

function IconScale() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v18M5 7h14M5 7l-3 7a3 3 0 006 0L5 7zM19 7l-3 7a3 3 0 006 0l-3-7M8 21h8" />
    </svg>
  );
}
