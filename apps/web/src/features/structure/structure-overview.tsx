'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import {
  changeOf,
  DiffCell,
  ExcelButton,
  Field,
  FilterBar,
  GroupTh,
  MoneyCell,
  NameCell,
  PctCell,
  PillTabs,
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
import { pctPlain, ppText, StatusBadge } from '@/components/report/report-extra-b';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { formatDate, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { COMPARE_OPTIONS, compact, pct, SECTION_OPTIONS, structureApi, type CompareMode, type FlowPart, type FlowResult, type SectionFilter } from './api';
import { Mark } from '@/features/reactions/mark';
import type { ItemFilter, MarkItem } from '@/features/reactions/api';
import { changePct, csvPct, csvSom, downloadCsv, forecastYear, lastN, mean } from './stats';


function change(current: string | number, previous: string | number): number | null {
  return changePct(Number(current), Number(previous));
}

function signedCompact(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${compact(Math.abs(value))}`;
}

/** Munosabat filtri: tanlangan bo'lim (Doimiy / Boshqa) */
function sectionFilter(section: SectionFilter): ItemFilter {
  return section === 'ALL' ? {} : { section };
}

function sectionLabel(label: string, section: SectionFilter): string {
  return section === 'ALL' ? label : `${label} · ${section === 'DOIMIY' ? 'Doimiy' : 'Boshqa'}`;
}

/** Oqim qismlari → Munosabat moddasi */
function partMark(kind: 'INCOME' | 'EXPENSE', part: FlowPart, section: SectionFilter): MarkItem | null {
  const filter = sectionFilter(section);
  if (kind === 'INCOME') {
    if (part.key !== 'REGIONAL') return null;
    return { kind, label: sectionLabel('Hududlar tushumi', section), filter: { ...filter, source: 'IMPORT' }, origin: 'Daromad va xarajat tarkibi' };
  }
  if (part.key === 'm:PAYROLL') return { kind, label: sectionLabel('Ish haqi', section), filter: { ...filter, source: 'PAYROLL' }, origin: 'Daromad va xarajat tarkibi' };
  if (part.key === 'm:LEASE') return { kind, label: sectionLabel('Ijara', section), filter: { ...filter, source: 'LEASE' }, origin: 'Daromad va xarajat tarkibi' };
  if (part.key === 'm:VEHICLE') return { kind, label: sectionLabel('Mashinalar', section), filter: { ...filter, source: 'VEHICLE' }, origin: 'Daromad va xarajat tarkibi' };
  if (part.key.startsWith('c:')) return { kind, label: sectionLabel(part.label, section), filter: { ...filter, rootCategoryCode: part.key.slice(2) }, origin: 'Daromad va xarajat tarkibi' };
  return null;
}

function cap(text: string): string {
  return text[0]!.toUpperCase() + text.slice(1);
}

// ═══════════════════════════════════════════════════════════
// Hisoblar (bir joyda — kartalar va xulosalar bir xil raqamni ishlatadi)
// ═══════════════════════════════════════════════════════════

function derive(flow: FlowResult) {
  const income = Number(flow.income.totalTiyin);
  const expense = Number(flow.expense.totalTiyin);
  const profit = Number(flow.profitTiyin);
  const prevIncome = Number(flow.income.previousTiyin);
  const prevExpense = Number(flow.expense.previousTiyin);

  const months = flow.monthly.map((m) => m.period);
  const incomes = flow.monthly.map((m) => Number(m.incomeTiyin));
  const expenses = flow.monthly.map((m) => Number(m.expenseTiyin));
  const profits = incomes.map((v, i) => v - expenses[i]!);

  const months12 = lastN(months, 12);
  const inc12 = lastN(incomes, 12);
  const exp12 = lastN(expenses, 12);
  const prof12 = lastN(profits, 12);
  // Bir yil oldingi xuddi shu oylar; ma'lumot kiritilmagan oy (daromad ham, xarajat ham 0) — null
  const hasPrevYear = months.length >= 24;
  const emptyPrev = hasPrevYear ? incomes.slice(-24, -12).map((v, i) => v === 0 && expenses[expenses.length - 24 + i] === 0) : [];
  const prevSlice = (list: number[]) => (hasPrevYear ? list.slice(-24, -12).map((v, i) => (emptyPrev[i] ? null : v)) : null);
  const incPrev = prevSlice(incomes);
  const expPrev = prevSlice(expenses);
  const profPrev = prevSlice(profits);
  const prevSum = (list: (number | null)[] | null) => (list && list.some((v) => v !== null) ? list.reduce<number>((a, b) => a + (b ?? 0), 0) : null);

  // Har 100 so'm daromadga xarajat
  const ratio = income > 0 ? (expense / income) * 100 : null;
  const prevRatio = prevIncome > 0 ? (prevExpense / prevIncome) * 100 : null;
  const ratio12 = inc12.map((v, i) => (v > 0 ? (exp12[i]! / v) * 100 : null));
  const ratioPrev = incPrev && expPrev ? incPrev.map((v, i) => (v !== null && v > 0 ? ((expPrev[i] ?? 0) / v) * 100 : null)) : null;

  // Doimiy qoplash: doimiy daromad doimiy xarajatni necha foiz qoplaydi
  const s = flow.split;
  const coverage = Number(s.expense.doimiyTiyin) > 0 ? (Number(s.income.doimiyTiyin) / Number(s.expense.doimiyTiyin)) * 100 : null;
  const prevCoverage =
    Number(s.expense.previousDoimiyTiyin) > 0 ? (Number(s.income.previousDoimiyTiyin) / Number(s.expense.previousDoimiyTiyin)) * 100 : null;

  // Eng yaxshi va eng yomon oy (12 oy)
  let best = 0;
  let worst = 0;
  prof12.forEach((v, i) => {
    if (v > prof12[best]!) best = i;
    if (v < prof12[worst]!) worst = i;
  });

  const forecast = {
    income: forecastYear(months, incomes, flow.range.to),
    expense: forecastYear(months, expenses, flow.range.to),
  };
  const lossMonths = prof12.filter((v) => v < 0).length;

  return {
    income,
    expense,
    profit,
    prevIncome,
    prevExpense,
    months,
    incomes,
    expenses,
    profits,
    months12,
    inc12,
    exp12,
    prof12,
    incPrev,
    expPrev,
    profPrev,
    // Faqat ikkala yilda ham ma'lumot bor oylar bo'yicha (juft) solishtirish
    incPaired: incPrev && incPrev.some((v) => v !== null) ? inc12.reduce((a, v, i) => a + (incPrev[i] === null ? 0 : v), 0) : null,
    incPrevSum: prevSum(incPrev),
    profPaired: profPrev && profPrev.some((v) => v !== null) ? prof12.reduce((a, v, i) => a + (profPrev[i] === null ? 0 : v), 0) : null,
    profPrevSum: prevSum(profPrev),
    pairedMonths: incPrev ? incPrev.filter((v) => v !== null).length : 0,
    ratio,
    prevRatio,
    ratio12,
    ratioPrev,
    coverage,
    prevCoverage,
    best: { period: months12[best]!, value: prof12[best] ?? 0 },
    worst: { period: months12[worst]!, value: prof12[worst] ?? 0 },
    forecast,
    lossMonths,
    avgProfit12: mean(prof12),
  };
}

type Derived = ReturnType<typeof derive>;

function notesOf(flow: FlowResult, d: Derived): string[] {
  const notes: string[] = [];
  if (d.income > 0) {
    const spent = Math.round((d.expense / d.income) * 100);
    notes.push(
      d.profit >= 0
        ? `Har 100 so'm daromadning ${spent} so'mi xarajatga ketmoqda, ${100 - spent} so'mi foyda bo'lib qolmoqda.`
        : `Xarajat daromaddan ${compact(-d.profit)} so'mga ko'p: har 100 so'm daromadga ${spent} so'm xarajat to'g'ri kelmoqda.`,
    );
  }
  const incomeGrowth = change(d.income, d.prevIncome);
  const expenseGrowth = change(d.expense, d.prevExpense);
  if (incomeGrowth !== null && expenseGrowth !== null) {
    notes.push(
      expenseGrowth > incomeGrowth
        ? `${cap(flow.compareLabel)}ga nisbatan xarajat (${pct(expenseGrowth, true)}) daromaddan (${pct(incomeGrowth, true)}) tezroq o'smoqda — rentabellik pasaymoqda.`
        : `${cap(flow.compareLabel)}ga nisbatan daromad (${pct(incomeGrowth, true)}) xarajatdan (${pct(expenseGrowth, true)}) tezroq o'smoqda — rentabellik yaxshilanmoqda.`,
    );
  }
  const topExpense = [...flow.expense.parts].filter((p) => p.key !== 'rest').sort((a, b) => Number(b.amountTiyin) - Number(a.amountTiyin))[0];
  if (topExpense && d.expense > 0) {
    notes.push(`Eng katta xarajat yo'nalishi — «${topExpense.label}»: barcha xarajatlarning ${pct((Number(topExpense.amountTiyin) / d.expense) * 100)}.`);
  }
  const topIncome = [...flow.income.parts].sort((a, b) => Number(b.amountTiyin) - Number(a.amountTiyin))[0];
  if (topIncome && d.income > 0) {
    notes.push(`Asosiy daromad manbai — «${topIncome.label}»: barcha daromadning ${pct((Number(topIncome.amountTiyin) / d.income) * 100)}.`);
  }
  if (flow.section === 'ALL' && d.coverage !== null) {
    notes.push(
      d.coverage >= 100
        ? `Doimiy daromad doimiy xarajatni to'liq qoplaydi (${pct(d.coverage)}) — korxona muntazam tushumlar hisobiga yashay oladi.`
        : `Doimiy daromad doimiy xarajatning faqat ${pct(d.coverage)} ini qoplaydi — qolgani bir martalik tushumlarga bog'liq.`,
    );
  }
  if (d.prof12.length > 0) {
    notes.push(
      `So'nggi 12 oyda eng yaxshi oy — ${formatPeriod(d.best.period)} (${signedCompact(d.best.value)}), eng og'ir oy — ${formatPeriod(d.worst.period)} (${signedCompact(d.worst.value)})` +
        (d.lossMonths > 0 ? `; ${d.lossMonths} ta oy zarar bilan yopilgan.` : "; zarar bilan yopilgan oy yo'q."),
    );
  }
  const fi = d.forecast.income;
  const fe = d.forecast.expense;
  if (fi && fe) {
    notes.push(`Shu sur'at davom etsa, ${fi.year}-yil ${signedCompact(fi.forecastTiyin - fe.forecastTiyin)} so'm ${fi.forecastTiyin >= fe.forecastTiyin ? 'foyda' : 'zarar'} bilan yopiladi (taxminiy).`);
  }
  return notes;
}

/** Xulosa yorlig'i uchun: pul oqimidan chiqqan xulosalar va hisoblangan ko'rsatkichlar */
export function flowNotes(flow: FlowResult): string[] {
  return notesOf(flow, derive(flow));
}

export function flowFigures(flow: FlowResult) {
  return derive(flow);
}

type View = 'parts' | 'months' | 'split' | 'forecast';

// ═══════════════════════════════════════════════════════════
// Asosiy komponent
// ═══════════════════════════════════════════════════════════

/**
 * Daromad va xarajat tarkibi — hisobot ko'rinishi (grafiklarsiz):
 * kartalar, filtrlar va yorliqlar: manbalar va yo'nalishlar (daromad → xarajat → natija),
 * oylar kesimi (bir yil oldin bilan), doimiy va bir martalik natija, yil prognozi.
 */
/** fixedView — faqat shu ko'rinish (Chuqur tahlil › Barqarorlik: «Doimiy va bir martalik»), tanlov yashiriladi */
export function StructureOverview({ range, fixedView }: { range: DateRange; fixedView?: View }) {
  const [section, setSection] = useState<SectionFilter>('ALL');
  const [compare, setCompare] = useState<CompareMode>('prev');
  const flow = useAsync(() => structureApi.flow(range, section, compare).then((r) => r.data), [range.from, range.to, section, compare]);
  const data = flow.data;

  if (flow.error) {
    return (
      <Card>
        <ErrorState message={flow.error} onRetry={flow.reload} />
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <LoadingState label="Pul oqimi hisoblanmoqda" />
      </Card>
    );
  }
  return <OverviewBody data={data} loading={flow.loading} section={section} onSection={setSection} compare={compare} onCompare={setCompare} fixedView={fixedView} />;
}

function OverviewBody({
  data,
  loading,
  section,
  onSection,
  compare,
  onCompare,
  fixedView,
}: {
  data: FlowResult;
  loading: boolean;
  section: SectionFilter;
  onSection: (value: SectionFilter) => void;
  compare: CompareMode;
  onCompare: (value: CompareMode) => void;
  /** Faqat shu ko'rinish (tanlov yashiriladi) */
  fixedView?: View;
}) {
  const [view, setView] = useState<View>(fixedView ?? 'parts');
  const d = derive(data);
  const fi = d.forecast.income;
  const fe = d.forecast.expense;
  const marginDelta = data.marginPercent !== null && data.previousMarginPercent !== null ? data.marginPercent - data.previousMarginPercent : null;
  const showSplit = data.section === 'ALL';
  const activeView: View = (view === 'split' && !showSplit) || (view === 'forecast' && !(fi && fe)) ? 'parts' : view;
  const period = `Joriy: ${formatDate(data.range.from)} — ${formatDate(data.range.to)} · ${data.compareLabel}: ${formatDate(data.previousRange.from)} — ${formatDate(data.previousRange.to)}`;

  const exportCsv = () =>
    downloadCsv(
      `daromad-xarajat-tarkibi-${data.range.from}_${data.range.to}`,
      ['Bo‘lim', 'Nomi', `${data.compareLabel}, so'm`, "Joriy davr, so'm", "Farq, so'm", "O'zgarish, %"],
      [
        ...data.income.parts.map((p) => ['Daromad', p.label, csvSom(p.previousTiyin), csvSom(p.amountTiyin), csvSom(Number(p.amountTiyin) - Number(p.previousTiyin)), csvPct(change(p.amountTiyin, p.previousTiyin))]),
        ['Daromad', 'Jami', csvSom(d.prevIncome), csvSom(d.income), csvSom(d.income - d.prevIncome), csvPct(change(d.income, d.prevIncome))],
        ...data.expense.parts.map((p) => ['Xarajat', p.label, csvSom(p.previousTiyin), csvSom(p.amountTiyin), csvSom(Number(p.amountTiyin) - Number(p.previousTiyin)), csvPct(change(p.amountTiyin, p.previousTiyin))]),
        ['Xarajat', 'Jami', csvSom(d.prevExpense), csvSom(d.expense), csvSom(d.expense - d.prevExpense), csvPct(change(d.expense, d.prevExpense))],
        ['Natija', 'Sof foyda', csvSom(data.previousProfitTiyin), csvSom(d.profit), csvSom(d.profit - Number(data.previousProfitTiyin)), ''],
        [],
        ['Oy', "Daromad, so'm", "Xarajat, so'm", "Foyda, so'm", 'Rentabellik, %'],
        ...d.months12.map((m, i) => [formatPeriod(m), csvSom(d.inc12[i]!), csvSom(d.exp12[i]!), csvSom(d.prof12[i]!), csvPct(d.inc12[i]! > 0 ? (d.prof12[i]! / d.inc12[i]!) * 100 : null)]),
        [],
        [`Davr: ${data.range.from} — ${data.range.to}; solishtirish: ${data.compareLabel} (${data.previousRange.from} — ${data.previousRange.to})`],
      ],
    );

  return (
    <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}>
      <StatTiles
        compareLabel="Avval"
        items={[
          { label: 'Daromad', value: d.income, previous: d.prevIncome, tone: 'green' },
          { label: 'Xarajat', value: d.expense, previous: d.prevExpense, growthGood: false, tone: 'red' },
          { label: d.profit >= 0 ? 'Sof foyda' : 'Zarar', value: d.profit, previous: Number(data.previousProfitTiyin), signed: true, tone: 'blue' },
          {
            label: 'Rentabellik',
            value: 0,
            text: pctPlain(data.marginPercent),
            tone: 'purple',
            note: `avval ${pctPlain(data.previousMarginPercent)} · ${ppText(marginDelta)}`,
          },
          {
            label: 'Doimiy qoplash',
            value: 0,
            text: showSplit ? pctPlain(d.coverage) : '',
            tone: 'orange',
            note: showSplit ? `avval ${pctPlain(d.prevCoverage)}` : '«Barchasi» tanlanganda',
          },
        ]}
      />

      <FilterBar actions={<ExcelButton onClick={exportCsv} />}>
        <Field label="Yozuvlar">
          <SelectBox value={section} options={SECTION_OPTIONS} onChange={onSection} />
        </Field>
        <Field label="Solishtirish">
          <SelectBox value={compare} options={COMPARE_OPTIONS} onChange={onCompare} />
        </Field>
      </FilterBar>

      {!fixedView && <PillTabs
        value={activeView}
        onChange={setView}
        options={[
          { value: 'parts', label: 'Manbalar va yo‘nalishlar', hint: 'Daromad manbalari, xarajat yo‘nalishlari va natija' },
          { value: 'months', label: 'Oylar kesimida', hint: "So'nggi 12 oy, bir yil oldin bilan" },
          ...(showSplit ? [{ value: 'split' as const, label: 'Doimiy va bir martalik', hint: 'Muntazam tushumlar muntazam xarajatlarni qoplaydimi' }] : []),
          ...(fi && fe ? [{ value: 'forecast' as const, label: 'Yil prognozi', hint: "Shu sur'at davom etsa, yil qanday yopiladi" }] : []),
        ]}
      />}

      {activeView === 'parts' && (
        <ReportCard title="Daromad manbalari, xarajat yo'nalishlari va natija" badge={period}>
          <PartsTable data={data} d={d} />
          <TableNote>Ulushi — daromad qatorlarida jami daromad ichida, xarajat qatorlarida jami xarajat ichida. Natija qatorida — rentabellik (foyda ÷ daromad).</TableNote>
        </ReportCard>
      )}
      {activeView === 'months' && (
        <ReportCard title="Oylar kesimida — so'nggi 12 oy" badge="har oy va bir yil oldingi xuddi shu oy">
          <MonthsTable d={d} />
          <TableNote>Yil boshidan foyda — shu yil yanvaridan shu oygacha yig&apos;ilgan foyda. 100 so&apos;mga xarajat — xarajat ÷ daromad × 100; 100 dan yuqori — zarar.</TableNote>
        </ReportCard>
      )}
      {activeView === 'split' && (
        <ReportCard title="Doimiy va bir martalik natija" badge={`doimiy qoplash: ${pctPlain(d.coverage)} (avval ${pctPlain(d.prevCoverage)})`}>
          <SplitTable flow={data} />
          <TableNote>
            Qoplash 100% dan past bo&apos;lsa, korxona doimiy xarajatlarini faqat bir martalik tushumlar hisobiga yopmoqda — bu barqaror emas.
          </TableNote>
        </ReportCard>
      )}
      {activeView === 'forecast' && fi && fe && (
        <ReportCard title={`${fi.year}-yil yakuni prognozi`} badge={`so'nggi 3 to'liq oy o'rtachasi × qolgan ${fi.remainingMonths} oy`}>
          <ForecastTable fi={fi} fe={fe} />
          <TableNote>Prognoz = yil boshidan to&apos;liq o&apos;tgan oylar fakti + so&apos;nggi 3 to&apos;liq oy o&apos;rtachasi × qolgan oylar. Mavsumiylik hisobga olinmaydi.</TableNote>
        </ReportCard>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Manbalar → yo'nalishlar → natija (bitta jadval)
// ═══════════════════════════════════════════════════════════

function sortParts(parts: FlowPart[]): FlowPart[] {
  return [...parts].sort((a, b) => (a.key === 'rest' ? 1 : b.key === 'rest' ? -1 : Number(b.amountTiyin) - Number(a.amountTiyin)));
}

function PartsTable({ data, d }: { data: FlowResult; d: Derived }) {
  const section = data.section;
  const previousProfit = Number(data.previousProfitTiyin);
  const block = (kind: 'INCOME' | 'EXPENSE') => {
    const income = kind === 'INCOME';
    const parts = sortParts(income ? data.income.parts : data.expense.parts);
    const total = income ? d.income : d.expense;
    const previous = income ? d.prevIncome : d.prevExpense;
    return (
      <>
        <Tr total>
          <Td className={STICKY_NO} />
          <NameCell
            before={<Mark item={{ kind, label: sectionLabel(income ? 'Barcha daromadlar' : 'Barcha xarajatlar', section), filter: sectionFilter(section), origin: 'Daromad va xarajat tarkibi' }} />}
          >
            {income ? 'DAROMAD — jami' : 'XARAJAT — jami'}
          </NameCell>
          <MoneyCell value={previous} />
          <MoneyCell value={total} />
          <DiffCell value={total - previous} pct={changeOf(total, previous)} growthGood={income} />
          <PctCell value={100} plain />
        </Tr>
        {parts.map((p, i) => {
          const amount = Number(p.amountTiyin);
          const prev = Number(p.previousTiyin);
          return (
            <Tr key={`${kind}-${p.key}`}>
              <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
              <NameCell before={<Mark item={partMark(kind, p, section)} />}>{p.label}</NameCell>
              <MoneyCell value={prev} />
              <MoneyCell value={amount} strong />
              <DiffCell value={amount - prev} pct={prev === 0 ? null : changeOf(amount, prev)} growthGood={income} />
              <Td className="font-semibold text-heading">{pctPlain(total > 0 ? (amount / total) * 100 : null)}</Td>
            </Tr>
          );
        })}
      </>
    );
  };
  return (
    <RTable minWidth={900}>
      <thead>
        <tr>
          <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>№</Th>
          <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-72 text-left')}>Nomi</Th>
          <GroupTh span={3}>Summa, so&apos;m</GroupTh>
          <Th rowSpan={2}>Ulushi</Th>
        </tr>
        <tr>
          <Th className="first:border-l">{cap(data.compareLabel)}</Th>
          <Th>Joriy davr</Th>
          <Th>Farqi, foizda</Th>
        </tr>
      </thead>
      <tbody>
        {block('INCOME')}
        {block('EXPENSE')}
        <Tr total className="bg-[#e4f5ea]">
          <Td className={STICKY_NO} />
          <NameCell before={<Mark item={{ kind: 'RESULT', label: sectionLabel('Korxona natijasi', section), filter: sectionFilter(section), origin: 'Daromad va xarajat tarkibi' }} />}>
            {d.profit >= 0 ? 'NATIJA — sof foyda' : 'NATIJA — zarar'}
          </NameCell>
          <MoneyCell value={previousProfit} signedColor />
          <MoneyCell value={d.profit} signedColor />
          <DiffCell value={d.profit - previousProfit} pct={changeOf(d.profit, previousProfit)} />
          <Td>
            <StatusBadge tone={(data.marginPercent ?? 0) >= 0 ? 'green' : 'red'}>rent. {pctPlain(data.marginPercent)}</StatusBadge>
          </Td>
        </Tr>
      </tbody>
    </RTable>
  );
}

// ═══════════════════════════════════════════════════════════
// Oylar kesimi: so'nggi 12 oy va bir yil oldin
// ═══════════════════════════════════════════════════════════

function MonthsTable({ d }: { d: Derived }) {
  // Yil boshidan jamlanma foyda (har oy o'z yili ichida)
  const ytd = d.months12.map((m) => {
    const year = m.slice(0, 4);
    return d.months.reduce((s, p, i) => (p.startsWith(year) && p <= m ? s + d.profits[i]! : s), 0);
  });
  const rows = d.months12.map((period, i) => ({
    period,
    inc: d.inc12[i]!,
    exp: d.exp12[i]!,
    profit: d.prof12[i]!,
    incPrev: d.incPrev ? (d.incPrev[i] ?? null) : null,
    expPrev: d.expPrev ? (d.expPrev[i] ?? null) : null,
    profPrev: d.profPrev ? (d.profPrev[i] ?? null) : null,
    ytd: ytd[i]!,
    ratio: d.inc12[i]! > 0 ? (d.exp12[i]! / d.inc12[i]!) * 100 : null,
  }));
  const tot = rows.reduce((s, r) => ({ inc: s.inc + r.inc, exp: s.exp + r.exp }), { inc: 0, exp: 0 });
  const prevSum = (k: 'incPrev' | 'expPrev' | 'profPrev') => (rows.some((r) => r[k] !== null) ? rows.reduce((s, r) => s + (r[k] ?? 0), 0) : null);
  const totPrev = { inc: prevSum('incPrev'), exp: prevSum('expPrev'), prof: prevSum('profPrev') };
  const maybe = (v: number | null) => (v === null ? <Td className="text-(--color-text-faint)"></Td> : <MoneyCell value={v} className="text-(--color-text-muted)" />);

  return (
    <RTable minWidth={1080}>
      <thead>
        <tr>
          <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2] w-28 min-w-28')}>Oy</Th>
          <GroupTh span={2}>Daromad</GroupTh>
          <GroupTh span={2}>Xarajat</GroupTh>
          <GroupTh span={3}>Foyda</GroupTh>
          <Th rowSpan={2}>Yil boshidan foyda</Th>
          <Th rowSpan={2}>100 so&apos;mga xarajat</Th>
        </tr>
        <tr>
          <Th className="first:border-l">Joriy</Th>
          <Th>Bir yil oldin</Th>
          <Th>Joriy</Th>
          <Th>Bir yil oldin</Th>
          <Th>Joriy</Th>
          <Th>Bir yil oldin</Th>
          <Th>Farqi</Th>
        </tr>
      </thead>
      <tbody>
        <Tr total>
          <Td className={cn(STICKY_NO, 'w-28 min-w-28 text-left')}>12 oy jami</Td>
          <MoneyCell value={tot.inc} />
          {maybe(totPrev.inc)}
          <MoneyCell value={tot.exp} />
          {maybe(totPrev.exp)}
          <MoneyCell value={tot.inc - tot.exp} signedColor />
          {maybe(totPrev.prof)}
          {totPrev.prof === null || d.profPaired === null ? <Td className="text-(--color-text-faint)"></Td> : <DiffCell value={d.profPaired - totPrev.prof} />}
          <Td />
          <Td>{tot.inc > 0 ? `${Math.round((tot.exp / tot.inc) * 100)} so'm` : ''}</Td>
        </Tr>
        {rows.map((r) => (
          <Tr key={r.period}>
            <Td className={cn(STICKY_NO, 'w-28 min-w-28 whitespace-nowrap text-left')}>{formatPeriod(r.period)}</Td>
            <MoneyCell value={r.inc} strong />
            {maybe(r.incPrev)}
            <MoneyCell value={r.exp} strong />
            {maybe(r.expPrev)}
            <MoneyCell value={r.profit} strong signedColor />
            {maybe(r.profPrev)}
            {r.profPrev === null ? <Td className="text-(--color-text-faint)"></Td> : <DiffCell value={r.profit - r.profPrev} pct={r.profPrev !== 0 ? changeOf(r.profit, r.profPrev) : null} />}
            <MoneyCell value={r.ytd} signedColor />
            <Td>{r.ratio === null ? '' : <StatusBadge tone={r.ratio > 100 ? 'red' : r.ratio > 90 ? 'amber' : 'green'}>{Math.round(r.ratio)} so&apos;m</StatusBadge>}</Td>
          </Tr>
        ))}
      </tbody>
    </RTable>
  );
}

// ═══════════════════════════════════════════════════════════
// Doimiy va bir martalik
// ═══════════════════════════════════════════════════════════

function SplitTable({ flow }: { flow: FlowResult }) {
  const s = flow.split;
  const rows = [
    { label: 'Doimiy (muntazam)', inc: Number(s.income.doimiyTiyin), exp: Number(s.expense.doimiyTiyin), pInc: Number(s.income.previousDoimiyTiyin), pExp: Number(s.expense.previousDoimiyTiyin) },
    { label: 'Boshqa (bir martalik)', inc: Number(s.income.boshqaTiyin), exp: Number(s.expense.boshqaTiyin), pInc: Number(s.income.previousBoshqaTiyin), pExp: Number(s.expense.previousBoshqaTiyin) },
  ];
  const total = rows.reduce((a, r) => ({ label: 'Jami', inc: a.inc + r.inc, exp: a.exp + r.exp, pInc: a.pInc + r.pInc, pExp: a.pExp + r.pExp }), { label: 'Jami', inc: 0, exp: 0, pInc: 0, pExp: 0 });
  const line = (r: (typeof rows)[number], isTotal: boolean) => (
    <Tr key={r.label} total={isTotal}>
      <NameCell sticky={false}>{r.label}</NameCell>
      <MoneyCell value={r.pInc} />
      <MoneyCell value={r.inc} strong={!isTotal} />
      <MoneyCell value={r.pExp} />
      <MoneyCell value={r.exp} strong={!isTotal} />
      <MoneyCell value={r.pInc - r.pExp} signedColor />
      <MoneyCell value={r.inc - r.exp} signedColor strong />
      <DiffCell value={r.inc - r.exp - (r.pInc - r.pExp)} />
    </Tr>
  );
  return (
    <RTable minWidth={1000}>
      <thead>
        <tr>
          <Th rowSpan={2} className="min-w-52 text-left">Bo&apos;lim</Th>
          <GroupTh span={2}>Daromad</GroupTh>
          <GroupTh span={2}>Xarajat</GroupTh>
          <GroupTh span={3}>Natija</GroupTh>
        </tr>
        <tr>
          <Th className="first:border-l">{cap(flow.compareLabel)}</Th>
          <Th>Joriy</Th>
          <Th>{cap(flow.compareLabel)}</Th>
          <Th>Joriy</Th>
          <Th>{cap(flow.compareLabel)}</Th>
          <Th>Joriy</Th>
          <Th>Farqi</Th>
        </tr>
      </thead>
      <tbody>
        {line(total, true)}
        {rows.map((r) => line(r, false))}
      </tbody>
    </RTable>
  );
}

// ═══════════════════════════════════════════════════════════
// Yil prognozi
// ═══════════════════════════════════════════════════════════

type Forecast = NonNullable<ReturnType<typeof forecastYear>>;

function ForecastTable({ fi, fe }: { fi: Forecast; fe: Forecast }) {
  const rows = [
    { label: 'Daromad', fact: fi.factTiyin, basis: fi.basisTiyin, fc: fi.forecastTiyin, ly: fi.lastYearTiyin, good: true },
    { label: 'Xarajat', fact: fe.factTiyin, basis: fe.basisTiyin, fc: fe.forecastTiyin, ly: fe.lastYearTiyin, good: false },
    {
      label: 'Foyda',
      fact: fi.factTiyin - fe.factTiyin,
      basis: fi.basisTiyin - fe.basisTiyin,
      fc: fi.forecastTiyin - fe.forecastTiyin,
      ly: fi.lastYearTiyin !== null && fe.lastYearTiyin !== null ? fi.lastYearTiyin - fe.lastYearTiyin : null,
      good: true,
    },
  ];
  return (
    <RTable minWidth={900}>
      <thead>
        <tr>
          <Th className="min-w-40 text-left">Ko&apos;rsatkich</Th>
          <Th>Yil boshidan fakt</Th>
          <Th>Oylik sur&apos;at</Th>
          <Th>Yil yakuni prognozi</Th>
          <Th>O&apos;tgan yil</Th>
          <Th>O&apos;zgarish</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Tr key={r.label} total={r.label === 'Foyda'}>
            <NameCell sticky={false}>{r.label}</NameCell>
            <MoneyCell value={r.fact} signedColor={r.label === 'Foyda'} />
            <MoneyCell value={r.basis} signedColor={r.label === 'Foyda'} />
            <MoneyCell value={r.fc} strong signedColor={r.label === 'Foyda'} />
            {r.ly === null ? <Td className="text-(--color-text-faint)"></Td> : <MoneyCell value={r.ly} />}
            <PctCell value={r.ly !== null && r.ly !== 0 ? changePct(r.fc, r.ly) : null} growthGood={r.good} />
          </Tr>
        ))}
      </tbody>
    </RTable>
  );
}
