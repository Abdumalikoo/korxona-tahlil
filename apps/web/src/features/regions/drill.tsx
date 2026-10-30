'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import {
  ActionButton,
  changeOf,
  DiffCell,
  ExcelButton,
  Field,
  FilterBar,
  GroupTh,
  MoneyCell,
  NameCell,
  PctBadge,
  PctInline,
  PillTabs,
  ReportCard,
  RTable,
  SearchInput,
  SelectBox,
  StatTiles,
  STICKY_NAME,
  STICKY_NO,
  TableNote,
  Td,
  Th,
  Tr,
  type StatTile,
} from '@/components/report/report';
import type { VehicleQuery } from './api';
import { count, CountCell, CountDiffCell, DiscussBar, EmptyNote, LoadingCard, MarkMoneyCell, PartsTable, ShareCell } from '@/components/report/report-extra-c';
import { CalcValue } from '@/components/ui/calc';
import { DiscussMenu } from '@/features/reactions/discuss';
import { Mark } from '@/features/reactions/mark';
import { compactMarks, districtMark, districtPartMark, districtServiceMark, employeeMark } from '@/features/reactions/marks';
import type { CompareMode, SectionFilter } from '@/features/structure/api';
import { csvPct, csvSom, downloadCsv } from '@/features/structure/stats';
import { formatDate, formatPeriod } from '@/lib/format';
import { calcChange, calcCompletion, calcDivide, calcResult, calcShare, calcSum, Q } from '@/lib/calc';
import { useAsync } from '@/lib/use-async';
import { cn, cap } from '@/lib/utils';
import { useState, type ReactNode } from 'react';
import { PinflText } from './pinfl-text';
import { drillApi, type DistrictDetailResult, type DistrictRow, type EmployeeDetailResult, type RegionDistrictsResult } from './drill-api';

// ═══════════════════════════════════════════════════════════
// Solishtirma ichkarisi: Viloyat → Tumanlar → Tuman → Xodim
// Har daraja — yagona hisobot uslubida: tepada kartalar, keyin bitta katta jadval (grafiklarsiz).
// Tepada yo'lak — istalgan bo'g'inga bir bosishda qaytiladi.
// ═══════════════════════════════════════════════════════════


/** Reja bajarilishi, % */
function completion(plan: number, fact: number): number | null {
  return plan > 0 ? (fact / plan) * 100 : null;
}

/** Bajarilish nishoni: 100% va yuqori — yashil, past — qizil */
function DoneCell({ plan, fact, note }: { plan: number; fact: number; note?: string }) {
  const done = completion(plan, fact);
  if (done === null)
    return (
      <Td>
        <span className="text-(--color-text-faint)"></span>
      </Td>
    );
  return (
    <Td>
      <CalcValue calc={calcCompletion(plan, fact, { note })} className="no-underline">
        <span className={cn('inline-block min-w-12 rounded-full px-2 py-px text-[11px] font-semibold', done >= 100 ? 'bg-[#e3f5ea] text-[#0b7a3b]' : 'bg-[#fdecec] text-[#c22f34]')}>{done.toFixed(1).replace('.', ',')}%</span>
      </CalcValue>
    </Td>
  );
}

function periodText(range: DateRange): string {
  return `${formatDate(range.from)} — ${formatDate(range.to)}`;
}

// ═══════════════════════════════════════════════════════════
// Yo'lak: Solishtirma › Viloyat › Tuman › Xodim
// ═══════════════════════════════════════════════════════════

export interface Crumb {
  label: string;
  onClick?: () => void;
}

export function DrillBreadcrumb({ items }: { items: Crumb[] }) {
  const back = [...items].reverse().find((item, i) => i > 0 && item.onClick);
  return (
    <nav className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4 py-2.5 shadow-card" aria-label="Yo'lak">
      {back && (
        <ActionButton onClick={back.onClick!} className="mr-1">
          ← Orqaga
        </ActionButton>
      )}
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="inline-flex items-center gap-1.5 text-sm">
            {i > 0 && <span className="text-(--color-text-faint)">›</span>}
            {item.onClick && !last ? (
              <button type="button" onClick={item.onClick} className="rounded-md px-1.5 py-0.5 font-medium text-brand-700 hover:bg-brand-50 hover:underline">
                {item.label}
              </button>
            ) : (
              <span className={cn('px-1.5 py-0.5', last ? 'font-bold text-heading' : 'text-(--color-text-muted)')}>{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════
// 1) Viloyat → tumanlar
// ═══════════════════════════════════════════════════════════

type DistrictSort = 'order' | 'income' | 'quantity' | 'expense' | 'expenseGrowth' | 'result' | 'headcount' | 'name';

const DISTRICT_SORT: { value: DistrictSort; label: string }[] = [
  { value: 'income', label: "Daromad bo'yicha" },
  { value: 'expense', label: "Xarajat bo'yicha" },
  { value: 'result', label: "Natija bo'yicha" },
  { value: 'expenseGrowth', label: "Xarajat o'sishi bo'yicha" },
  { value: 'quantity', label: "Xizmatlar soni bo'yicha" },
  { value: 'headcount', label: "Xodimlar bo'yicha" },
  { value: 'name', label: "Nomi bo'yicha" },
];

export function RegionDrill({
  code,
  range,
  section,
  compare,
  onDistrict,
  extraActions,
}: {
  code: number;
  range: DateRange;
  section: SectionFilter;
  compare: CompareMode;
  onDistrict: (row: DistrictRow) => void;
  extraActions?: ReactNode;
}) {
  const result = useAsync(() => drillApi.region(code, range, section, compare).then((r) => r.data), [code, range.from, range.to, section, compare]);
  if (!result.data) return <LoadingCard label="Tumanlar hisoblanmoqda" error={result.error} onRetry={result.reload} />;
  return <RegionBody data={result.data} onDistrict={onDistrict} extraActions={extraActions} />;
}

function districtKey(d: DistrictRow, sort: DistrictSort): number {
  switch (sort) {
    case 'quantity':
      return d.quantity;
    case 'expense':
      return Number(d.expenseTiyin);
    case 'expenseGrowth':
      return Number(d.expenseTiyin) - Number(d.previousExpenseTiyin);
    case 'result':
      return Number(d.resultTiyin);
    case 'headcount':
      return d.headcount;
    default:
      return Number(d.incomeTiyin);
  }
}

function RegionBody({ data, onDistrict, extraActions }: { data: RegionDistrictsResult; onDistrict: (row: DistrictRow) => void; extraActions?: ReactNode }) {
  const [sort, setSort] = useState<DistrictSort>('income');
  const [query, setQuery] = useState('');

  const t = data.totals;
  const income = Number(t.incomeTiyin);
  const expense = Number(t.expenseTiyin);
  const prevIncome = Number(t.previousIncomeTiyin);
  const prevExpense = Number(t.previousExpenseTiyin);
  const prevQuantity = data.districts.reduce((s, d) => s + d.previousQuantity, 0);
  const label = cap(data.compareLabel);

  const real = data.districts.filter((d) => !d.unassigned);
  const unassigned = data.districts.find((d) => d.unassigned) ?? null;
  const heads = real.reduce((s, d) => s + d.headcount, 0);

  const q = query.trim().toLowerCase();
  const found = real.filter((d) => !q || d.name.toLowerCase().includes(q));
  const rows = sort === 'name' ? [...found].sort((a, b) => a.name.localeCompare(b.name, 'uz')) : [...found].sort((a, b) => districtKey(b, sort) - districtKey(a, sort));

  const exportCsv = () =>
    downloadCsv(
      `solishtirma-${data.region.name}-tumanlar-${data.range.from}_${data.range.to}`,
      [
        'Tuman',
        `Daromad: ${data.compareLabel}, so'm`,
        "Daromad: joriy, so'm",
        "Daromad farqi, so'm",
        'Daromad farqi, %',
        'Xizmatlar soni',
        `Xarajat: ${data.compareLabel}, so'm`,
        "Xarajat: joriy, so'm",
        "Xarajat farqi, so'm",
        'Xarajat farqi, %',
        "shundan ish haqi, so'm",
        "ijara, so'm",
        "boshqa, so'm",
        "Natija, so'm",
        'Xodimlar',
        "Natijalar: fakt, so'm",
      ],
      data.districts.map((d) => [
        d.name,
        csvSom(d.previousIncomeTiyin),
        csvSom(d.incomeTiyin),
        csvSom(Number(d.incomeTiyin) - Number(d.previousIncomeTiyin)),
        csvPct(changeOf(Number(d.incomeTiyin), Number(d.previousIncomeTiyin))),
        d.quantity,
        csvSom(d.previousExpenseTiyin),
        csvSom(d.expenseTiyin),
        csvSom(Number(d.expenseTiyin) - Number(d.previousExpenseTiyin)),
        csvPct(changeOf(Number(d.expenseTiyin), Number(d.previousExpenseTiyin))),
        csvSom(d.payrollTiyin),
        csvSom(d.leaseTiyin),
        csvSom(d.otherTiyin),
        csvSom(d.resultTiyin),
        d.headcount,
        csvSom(d.factTiyin),
      ]),
    );

  const tiles: StatTile[] = [
    {
      label: 'Daromad',
      value: income,
      previous: prevIncome,
      tone: 'green',
      calc: calcSum('Viloyat daromadi', data.districts.map((d) => Q.money(d.name, d.incomeTiyin, 'Hududlar tushumi')), {
        note: "Viloyat daromadi — tumanlar daromadlari yig'indisi («Tumanga bo'linmagan» qatori bilan birga).",
      }),
    },
    {
      label: 'Xarajat',
      value: expense,
      previous: prevExpense,
      growthGood: false,
      tone: 'red',
      calc: calcSum('Viloyat xarajati', data.districts.map((d) => Q.money(d.name, d.expenseTiyin)), {
        note: "Har tuman xarajati = ish haqi + ijara + boshqa xarajatlar. Tuman ko'rsatilmagan yozuvlar «Tumanga bo'linmagan» qatorida.",
      }),
    },
    {
      label: income - expense >= 0 ? 'Natija (foyda)' : 'Natija (zarar)',
      value: income - expense,
      previous: prevIncome - prevExpense,
      signed: true,
      tone: 'blue',
      calc: calcResult(income, expense, { note: `${periodText(data.range)} davri uchun.` }),
    },
    {
      label: "Ko'rsatilgan xizmatlar",
      value: 0,
      text: `${count(t.quantity)} ta`,
      note: `Avval ${count(prevQuantity)} ta · ${real.filter((d) => Number(d.incomeTiyin) > 0).length} ta tumandan`,
      tone: 'cyan',
      calc: calcSum("Ko'rsatilgan xizmatlar", data.districts.map((d) => Q.count(d.name, d.quantity, 'Hududlar tushumi, «Soni» ustuni')), { kind: 'count' }),
    },
    {
      label: 'Xodimlar',
      value: 0,
      text: `${count(heads)} ta`,
      note: `${real.length} ta tumanda`,
      tone: 'purple',
      calc: calcSum('Xodimlar', real.map((d) => Q.count(d.name, d.headcount, 'Davrda ish haqi olgan xodimlar')), { kind: 'count' }),
    },
  ];

  return (
    <div className="space-y-4">
      <StatTiles items={tiles} compareLabel="Avval" />

      {(!data.check.incomeOk || !data.check.expenseOk) && (
        <p className="rounded-2xl bg-(--color-expense-soft) px-4 py-3 text-sm text-(--color-expense)">
          Diqqat: tumanlar yig&apos;indisi viloyat jamisiga teng chiqmadi ({!data.check.incomeOk ? 'daromad' : ''}
          {!data.check.incomeOk && !data.check.expenseOk ? ', ' : ''}
          {!data.check.expenseOk ? 'xarajat' : ''}). Bu xabarni skrinshot qilib yuboring.
        </p>
      )}

      <FilterBar
        actions={
          <>
            {extraActions}
            <ExcelButton onClick={exportCsv} />
          </>
        }
      >
        <Field label="Tartib">
          <SelectBox value={sort} options={DISTRICT_SORT} onChange={setSort} />
        </Field>
        <Field label="Tuman">
          <SearchInput value={query} onChange={setQuery} placeholder="Tuman nomi…" />
        </Field>
      </FilterBar>

      <ReportCard title={`${data.region.name}: tumanlar kesimida`} badge={`Joriy: ${periodText(data.range)} · ${data.compareLabel}: ${periodText(data.previousRange)}`}>
        <RTable minWidth={1060}>
          <thead>
            <tr>
              <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>
                №
              </Th>
              <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>
                Tuman
              </Th>
              <GroupTh span={3}>Daromad</GroupTh>
              <Th rowSpan={2}>Xizmatlar soni</Th>
              <GroupTh span={3}>Xarajat</GroupTh>
              <Th rowSpan={2}>Natija</Th>
            </tr>
            <tr>
              <Th className="first:border-l">{label}</Th>
              <Th>Joriy davr</Th>
              <Th>Farqi, foizda</Th>
              <Th>{label}</Th>
              <Th>Joriy davr</Th>
              <Th>Farqi, foizda</Th>
            </tr>
          </thead>
          <tbody>
            <Tr total>
              <Td className={STICKY_NO} />
              <NameCell sub={`${count(heads)} xodim`}>Jami {data.region.name}</NameCell>
              <MoneyCell value={prevIncome} />
              <MoneyCell value={income} calc={calcSum('Jami daromad', data.districts.map((d) => Q.money(d.name, d.incomeTiyin)))} />
              <DiffCell value={income - prevIncome} pct={changeOf(income, prevIncome)} calc={calcChange("Viloyat daromadi: o'zgarish", Q.money('Joriy davr', income), Q.money(label, prevIncome), { growthGood: true })} />
              <CountCell value={t.quantity} calc={calcSum('Jami xizmatlar', data.districts.map((d) => Q.count(d.name, d.quantity)), { kind: 'count' })} />
              <MoneyCell value={prevExpense} />
              <MoneyCell value={expense} calc={calcSum('Jami xarajat', data.districts.map((d) => Q.money(d.name, d.expenseTiyin)))} />
              <DiffCell value={expense - prevExpense} pct={changeOf(expense, prevExpense)} growthGood={false} calc={calcChange("Viloyat xarajati: o'zgarish", Q.money('Joriy davr', expense), Q.money(label, prevExpense), { growthGood: false })} />
              <MoneyCell value={income - expense} strong signedColor calc={calcResult(income, expense, { title: `Natija: ${data.region.name}` })} />
            </Tr>
            {rows.map((d, i) => (
              <DistrictTr key={d.id} d={d} index={i + 1} section={data.section} compareLabel={label} onOpen={() => onDistrict(d)} />
            ))}
            {unassigned && <DistrictTr d={unassigned} index={null} section={data.section} compareLabel={label} onOpen={() => onDistrict(unassigned)} />}
          </tbody>
        </RTable>
        <TableNote>
          Tumanni bosing — ichiga kirasiz (xizmatlar, xarajat tarkibi, xodimlar). Daromad — Hududlar tushumi (tumanlar kesimida yuklangani); xarajat — tumanda ishlagan xodimlar ish
          haqi, tumanga yozilgan ijara va tuman ko&apos;rsatilgan boshqa xarajatlar. Tuman ko&apos;rsatilmagan yozuvlar — «Tumanga bo&apos;linmagan» qatorida; hammasi birga viloyat
          jamisiga teng.
        </TableNote>
      </ReportCard>
    </div>
  );
}

function DistrictTr({ d, index, section, compareLabel, onOpen }: { d: DistrictRow; index: number | null; section: SectionFilter; compareLabel: string; onOpen: () => void }) {
  const income = Number(d.incomeTiyin);
  const expense = Number(d.expenseTiyin);
  const prevIncome = Number(d.previousIncomeTiyin);
  const prevExpense = Number(d.previousExpenseTiyin);
  const sub = [d.headcount ? `${d.headcount} xodim` : null, d.topServices[0] ? `asosan: ${d.topServices.map((s) => s.label).join(', ')}` : null].filter(Boolean).join(' · ');
  return (
    <Tr onClick={onOpen} muted={d.unassigned}>
      <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{index ?? ''}</Td>
      <NameCell drill sub={sub || undefined} before={<Mark item={districtMark(d.id, d.name, 'RESULT', section)} />} className={cn('max-w-64', d.unassigned && 'italic')}>
        {d.name}
      </NameCell>
      <MoneyCell value={prevIncome} />
      <MarkMoneyCell value={income} mark={districtMark(d.id, d.name, 'INCOME', section)} />
      <DiffCell value={income - prevIncome} pct={changeOf(income, prevIncome)} calc={calcChange(`${d.name} daromadi: o'zgarish`, Q.money('Joriy davr', income), Q.money(compareLabel, prevIncome), { growthGood: true })} />
      <Td className="whitespace-nowrap">
        {d.quantity ? count(d.quantity) : <span className="text-(--color-text-faint)"></span>}
        {(d.quantity || d.previousQuantity) > 0 && <PctInline value={changeOf(d.quantity, d.previousQuantity)} />}
      </Td>
      <MoneyCell value={prevExpense} />
      <MarkMoneyCell
        value={expense}
        mark={districtMark(d.id, d.name, 'EXPENSE', section)}
        calc={calcSum(`${d.name} xarajati`, [Q.money('Ish haqi', d.payrollTiyin, 'Tumanda ishlagan xodimlar'), Q.money('Ijara', d.leaseTiyin, 'Tumandagi ijara shartnomalari'), Q.money('Boshqa', d.otherTiyin, "Tuman ko'rsatilgan xarajatlar")])}
      />
      <DiffCell value={expense - prevExpense} pct={changeOf(expense, prevExpense)} growthGood={false} calc={calcChange(`${d.name} xarajati: o'zgarish`, Q.money('Joriy davr', expense), Q.money(compareLabel, prevExpense), { growthGood: false })} />
      <MoneyCell value={Number(d.resultTiyin)} strong signedColor calc={calcResult(income, expense, { title: `Natija: ${d.name}` })} />
    </Tr>
  );
}

// ═══════════════════════════════════════════════════════════
// 2) Tuman
// ═══════════════════════════════════════════════════════════

type DistrictView = 'services' | 'expense' | 'employees' | 'months';

export function DistrictDrill({
  id,
  regionCode,
  range,
  section,
  compare,
  onEmployee,
}: {
  id: string;
  regionCode: number;
  range: DateRange;
  section: SectionFilter;
  compare: CompareMode;
  onEmployee: (pinfl: string, name: string) => void;
}) {
  const result = useAsync(() => drillApi.district(id, regionCode, range, section, compare).then((r) => r.data), [id, regionCode, range.from, range.to, section, compare]);
  if (!result.data) return <LoadingCard label="Tuman hisoblanmoqda" error={result.error} onRetry={result.reload} />;
  return <DistrictBody data={result.data} onEmployee={onEmployee} vehicles={{ unit: id === '-' ? `rnd:${regionCode}` : `dist:${id}`, range, section, compare }} />;
}

function DistrictBody({ data, onEmployee, vehicles }: { data: DistrictDetailResult; onEmployee: (pinfl: string, name: string) => void; vehicles: VehicleQuery }) {
  const [view, setView] = useState<DistrictView>('services');
  const [query, setQuery] = useState('');
  const s = data.summary;
  const d = data.district;
  const income = Number(s.incomeTiyin);
  const expense = Number(s.expenseTiyin);
  const prevIncome = Number(s.previousIncomeTiyin);
  const prevExpense = Number(s.previousExpenseTiyin);
  const plan = Number(s.planTiyin);
  const fact = Number(s.factTiyin);
  const label = cap(data.compareLabel);

  const q = query.trim().toLowerCase();
  const employees = data.employees.filter((e) => !q || e.fullName.toLowerCase().includes(q) || (e.position ?? '').toLowerCase().includes(q) || e.pinfl.includes(q.replace(/\s/g, '')));

  const exportServices = () =>
    downloadCsv(
      `solishtirma-${d.name}-xizmatlar-${data.range.from}_${data.range.to}`,
      ['Xizmat', `Soni: ${data.compareLabel}`, 'Soni: joriy', `Summa: ${data.compareLabel}, so'm`, "Summa: joriy, so'm", "Farqi, so'm", 'Farqi, %', "O'rtacha, so'm"],
      data.services.map((x) => [
        x.label,
        x.previousQuantity,
        x.quantity,
        csvSom(x.previousTiyin),
        csvSom(x.amountTiyin),
        csvSom(Number(x.amountTiyin) - Number(x.previousTiyin)),
        csvPct(changeOf(Number(x.amountTiyin), Number(x.previousTiyin))),
        x.averageTiyin ? csvSom(x.averageTiyin) : '',
      ]),
    );

  const exportParts = () =>
    downloadCsv(
      `solishtirma-${d.name}-xarajat-${data.range.from}_${data.range.to}`,
      ['Modda', `${data.compareLabel}, so'm`, "Joriy, so'm", "Farqi, so'm", 'Farqi, %'],
      data.expenseParts.map((p) => [p.label, csvSom(p.previousTiyin), csvSom(p.amountTiyin), csvSom(Number(p.amountTiyin) - Number(p.previousTiyin)), csvPct(changeOf(Number(p.amountTiyin), Number(p.previousTiyin)))]),
    );

  const exportEmployees = () =>
    downloadCsv(
      `solishtirma-${d.name}-xodimlar-${data.range.from}_${data.range.to}`,
      ['PINFL', 'F.I.Sh.', 'Lavozim', "Ish haqi, so'm", `${data.compareLabel}: ish haqi, so'm`, "Reja, so'm", "Fakt, so'm", 'Bajarilish, %', "Bonus, so'm"],
      data.employees.map((e) => [
        e.pinfl,
        e.fullName,
        e.position ?? '',
        csvSom(e.salaryTiyin),
        csvSom(e.previousSalaryTiyin),
        csvSom(e.planTiyin),
        csvSom(e.factTiyin),
        csvPct(completion(Number(e.planTiyin), Number(e.factTiyin))),
        csvSom(e.bonusTiyin),
      ]),
    );

  const exportMonths = () =>
    downloadCsv(
      `solishtirma-${d.name}-oylar`,
      ['Oy', "Daromad, so'm", "Xarajat, so'm", "Natija, so'm"],
      data.months.map((m, i) => {
        const inc = Number(s.incomeTrend[i] ?? 0);
        const exp = Number(s.expenseTrend[i] ?? 0);
        return [formatPeriod(m), csvSom(inc), csvSom(exp), csvSom(inc - exp)];
      }),
    );

  const discussItems = d.unassigned
    ? []
    : compactMarks([
        districtMark(d.id, d.name, 'RESULT', data.section),
        districtMark(d.id, d.name, 'INCOME', data.section),
        districtMark(d.id, d.name, 'EXPENSE', data.section),
        ...data.services.map((x) => districtServiceMark(d.id, d.name, x, data.section)),
        ...data.expenseParts.map((p) => districtPartMark(d.id, d.name, p, data.section)),
      ]);

  const tiles: StatTile[] = [
    {
      label: 'Daromad',
      value: income,
      previous: prevIncome,
      tone: 'green',
      calc: calcSum(`${d.name} daromadi`, data.services.map((x) => Q.money(x.label, x.amountTiyin, 'Hududlar tushumi'))),
    },
    {
      label: 'Xarajat',
      value: expense,
      previous: prevExpense,
      growthGood: false,
      tone: 'red',
      calc: calcSum(`${d.name} xarajati`, data.expenseParts.map((p) => Q.money(p.label, p.amountTiyin)), {
        note: "Ish haqi — shu tumanda ishlagan xodimlarga hisoblangani; ijara — tumandagi shartnomalar; qolgani — tuman ko'rsatilgan xarajatlar.",
      }),
    },
    {
      label: income - expense >= 0 ? 'Natija (foyda)' : 'Natija (zarar)',
      value: income - expense,
      previous: prevIncome - prevExpense,
      signed: true,
      tone: 'blue',
      calc: calcResult(income, expense, { title: `Natija: ${d.name}` }),
    },
    {
      label: "Ko'rsatilgan xizmatlar",
      value: 0,
      text: `${count(s.quantity)} ta`,
      note: `Avval ${count(s.previousQuantity)} ta`,
      tone: 'cyan',
      calc: calcSum("Ko'rsatilgan xizmatlar", data.services.map((x) => Q.count(x.label, x.quantity)), { kind: 'count' }),
    },
    {
      label: 'Xodimlar rejasi',
      value: 0,
      text: plan > 0 ? `${(completion(plan, fact) ?? 0).toFixed(1).replace('.', ',')}%` : '',
      note: `${s.headcount} xodim ish haqi olgan`,
      tone: 'purple',
      calc: plan > 0 ? calcCompletion(plan, fact, { note: "Natijalar faylidagi tuman xodimlari rejasi va fakti (daromadga qo'shilmaydi)." }) : null,
    },
  ];

  const views: { value: DistrictView; label: string }[] = [
    { value: 'services', label: `Xizmat turlari (${data.services.length})` },
    { value: 'expense', label: `Xarajat tarkibi (${data.expenseParts.length})` },
    { value: 'employees', label: `Xodimlar (${data.employees.length})` },
    { value: 'months', label: 'Oylar kesimida' },
  ];

  const serviceTotal = data.services.reduce((a, x) => a + Number(x.amountTiyin), 0);
  const servicePrev = data.services.reduce((a, x) => a + Number(x.previousTiyin), 0);
  const qtyTotal = data.services.reduce((a, x) => a + x.quantity, 0);
  const qtyPrev = data.services.reduce((a, x) => a + x.previousQuantity, 0);

  return (
    <div className="space-y-4">
      {discussItems.length > 0 && (
        <DiscussBar action={<DiscussMenu items={discussItems} />}>
          <b className="text-heading">{d.name}</b> — daromadi, xarajati, natijasi, istalgan xizmat turi yoki xarajat moddasini muhokamaga qo&apos;yish mumkin.
        </DiscussBar>
      )}

      <StatTiles items={tiles} compareLabel="Avval" />

      <PillTabs value={view} onChange={setView} options={views} />

      {view === 'services' && (
        <ReportCard title={`${d.name}: xizmat turlari bo'yicha daromad`} badge={`${periodText(data.range)} · ${data.compareLabel}ga nisbatan`} actions={<ExcelButton onClick={exportServices} />}>
          {data.services.length === 0 ? (
            <EmptyNote>Bu davr uchun tuman kesimidagi daromad yo&apos;q. Hududlar tushumini shablon bilan yuklang.</EmptyNote>
          ) : (
            <RTable minWidth={1060}>
              <thead>
                <tr>
                  <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>
                    №
                  </Th>
                  <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-64 text-left')}>
                    Xizmat
                  </Th>
                  <GroupTh span={3}>Soni</GroupTh>
                  <GroupTh span={3}>Summasi</GroupTh>
                  <Th rowSpan={2}>O&apos;rtacha narx</Th>
                  <Th rowSpan={2}>Ulushi</Th>
                </tr>
                <tr>
                  <Th className="first:border-l">{label}</Th>
                  <Th>Joriy davr</Th>
                  <Th>Farqi, foizda</Th>
                  <Th>{label}</Th>
                  <Th>Joriy davr</Th>
                  <Th>Farqi, foizda</Th>
                </tr>
              </thead>
              <tbody>
                <Tr total>
                  <Td className={STICKY_NO} />
                  <NameCell>Jami</NameCell>
                  <CountCell value={qtyPrev} />
                  <CountCell value={qtyTotal} calc={calcSum("Ko'rsatilgan xizmatlar", data.services.map((x) => Q.count(x.label, x.quantity)), { kind: 'count' })} />
                  <CountDiffCell current={qtyTotal} previous={qtyPrev} />
                  <MoneyCell value={servicePrev} />
                  <MoneyCell value={serviceTotal} calc={calcSum(`${d.name} daromadi`, data.services.map((x) => Q.money(x.label, x.amountTiyin)))} />
                  <DiffCell value={serviceTotal - servicePrev} pct={changeOf(serviceTotal, servicePrev)} />
                  <Td>{qtyTotal > 0 ? sumAvg(serviceTotal, qtyTotal) : ''}</Td>
                  <Td>
                    <PctBadge value={100} plain />
                  </Td>
                </Tr>
                {data.services.map((x, i) => {
                  const amount = Number(x.amountTiyin);
                  const previous = Number(x.previousTiyin);
                  return (
                    <Tr key={x.code}>
                      <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                      <NameCell before={<Mark item={districtServiceMark(d.id, d.name, x, data.section)} />} className="max-w-80">
                        <span title={x.label}>{x.label}</span>
                      </NameCell>
                      <CountCell value={x.previousQuantity} />
                      <CountCell value={x.quantity} />
                      <CountDiffCell current={x.quantity} previous={x.previousQuantity} />
                      <MoneyCell value={previous} />
                      <MoneyCell value={amount} />
                      <DiffCell value={amount - previous} pct={changeOf(amount, previous)} calc={calcChange(`${x.label}: summa`, Q.money('Joriy davr', amount), Q.money(label, previous), { growthGood: true })} />
                      <Td className="whitespace-nowrap text-(--color-text-muted)">
                        {x.averageTiyin ? (
                          <CalcValue calc={calcDivide(`${x.label}: o'rtacha narx`, Q.money('Summa', x.amountTiyin), Q.count('Soni', x.quantity), 'money', { formulaId: 'average' })} className="no-underline">
                            {sumAvg(Number(x.averageTiyin), 1)}
                          </CalcValue>
                        ) : (
                          ''
                        )}
                      </Td>
                      <ShareCell part={amount} total={serviceTotal} calc={calcShare(`${x.label}: ulush`, Q.money('Xizmat summasi', amount), Q.money('Tuman daromadi', serviceTotal))} />
                    </Tr>
                  );
                })}
              </tbody>
            </RTable>
          )}
        </ReportCard>
      )}

      {view === 'expense' && (
        <ReportCard title={`${d.name}: xarajat tarkibi`} badge={`${periodText(data.range)} · o'sish — qizil`} actions={<ExcelButton onClick={exportParts} />}>
          <PartsTable
            parts={data.expenseParts}
            title={`${d.name} xarajati`}
            compareLabel={data.compareLabel}
            growthGood={false}
            markOf={(p) => districtPartMark(d.id, d.name, p as (typeof data.expenseParts)[number], data.section)}
            totalLabel="Jami xarajat"
            empty="Bu davrda tumanga yozilgan xarajat yo'q."
            vehicles={vehicles}
            safar={vehicles}
          />
        </ReportCard>
      )}

      {view === 'employees' && (
        <ReportCard
          title={`${d.name}: xodimlar — ${data.employees.length} ta`}
          badge="Ish haqi tuman xarajatiga kiradi · reja va fakt — Natijalar faylidan"
          actions={
            <>
              <SearchInput value={query} onChange={setQuery} placeholder="Ism yoki PINFL…" />
              <ExcelButton onClick={exportEmployees} />
            </>
          }
        >
          {employees.length === 0 ? (
            <EmptyNote>{data.employees.length === 0 ? "Bu davrda shu tumanda ish haqi olgan xodim yo'q" : "Qidiruv bo'yicha topilmadi"}</EmptyNote>
          ) : (
            <EmployeesTable employees={employees} all={data.employees} label={label} onEmployee={onEmployee} />
          )}
        </ReportCard>
      )}

      {view === 'months' && (
        <ReportCard title={`${d.name}: oxirgi ${data.months.length} oy`} badge="Daromad, xarajat va natija oyma-oy" actions={<ExcelButton onClick={exportMonths} />}>
          <MonthsTable months={data.months} income={s.incomeTrend} expense={s.expenseTrend} />
        </ReportCard>
      )}
    </div>
  );
}

/** «1 234 567» — summa ÷ son */
function sumAvg(totalTiyin: number, qty: number): string {
  const v = Math.round(totalTiyin / qty / 100);
  return Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function EmployeesTable({ employees, all, label, onEmployee }: { employees: DistrictDetailResult['employees']; all: DistrictDetailResult['employees']; label: string; onEmployee: (pinfl: string, name: string) => void }) {
  const tot = (pick: (e: (typeof all)[number]) => string) => all.reduce((s, e) => s + Number(pick(e)), 0);
  const salary = tot((e) => e.salaryTiyin);
  const prevSalary = tot((e) => e.previousSalaryTiyin);
  const plan = tot((e) => e.planTiyin);
  const fact = tot((e) => e.factTiyin);
  const bonus = tot((e) => e.bonusTiyin);
  return (
    <RTable minWidth={1060}>
      <thead>
        <tr>
          <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>
            №
          </Th>
          <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>
            F.I.Sh.
          </Th>
          <Th rowSpan={2}>PINFL</Th>
          <GroupTh span={3}>Ish haqi</GroupTh>
          <GroupTh span={3}>Natijalar (reja / fakt)</GroupTh>
          <Th rowSpan={2}>Bonus</Th>
        </tr>
        <tr>
          <Th className="first:border-l">{label}</Th>
          <Th>Joriy davr</Th>
          <Th>Farqi, foizda</Th>
          <Th>Reja</Th>
          <Th>Fakt</Th>
          <Th>Bajarilishi</Th>
        </tr>
      </thead>
      <tbody>
        <Tr total>
          <Td className={STICKY_NO} />
          <NameCell>Jami · {all.length} xodim</NameCell>
          <Td />
          <MoneyCell value={prevSalary} />
          <MoneyCell value={salary} calc={calcSum('Ish haqi', all.map((e) => Q.money(e.fullName, e.salaryTiyin)))} />
          <DiffCell value={salary - prevSalary} pct={changeOf(salary, prevSalary)} growthGood={false} />
          <MoneyCell value={plan} />
          <MoneyCell value={fact} />
          <DoneCell plan={plan} fact={fact} />
          <MoneyCell value={bonus} />
        </Tr>
        {employees.map((e, i) => {
          const sal = Number(e.salaryTiyin);
          const prev = Number(e.previousSalaryTiyin);
          return (
            <Tr key={e.pinfl} onClick={() => onEmployee(e.pinfl, e.fullName)}>
              <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
              <NameCell
                drill
                before={<Mark item={employeeMark(e.pinfl, e.fullName, 'RESULT', 'Solishtirma › xodim')} />}
                sub={[e.position, e.employmentType === 'SHARTNOMA' ? 'shartnoma' : null, e.paidMonths ? `${e.paidMonths} oy ish haqi` : null].filter(Boolean).join(' · ') || undefined}
                className="max-w-72"
              >
                {e.fullName}
              </NameCell>
              <Td className="whitespace-nowrap">
                <PinflText pinfl={e.pinfl} />
              </Td>
              <MoneyCell value={prev} />
              <MarkMoneyCell value={sal} mark={employeeMark(e.pinfl, e.fullName, 'EXPENSE', 'Solishtirma › xodim')} />
              <DiffCell value={sal - prev} pct={changeOf(sal, prev)} growthGood={false} calc={calcChange(`${e.fullName}: ish haqi`, Q.money('Joriy davr', sal), Q.money(label, prev), { growthGood: false })} />
              <MoneyCell value={Number(e.planTiyin)} />
              <MarkMoneyCell value={Number(e.factTiyin)} mark={Number(e.factTiyin) ? employeeMark(e.pinfl, e.fullName, 'INCOME', 'Solishtirma › xodim') : null} />
              <DoneCell plan={Number(e.planTiyin)} fact={Number(e.factTiyin)} note={e.fullName} />
              <MoneyCell value={Number(e.bonusTiyin)} />
            </Tr>
          );
        })}
      </tbody>
    </RTable>
  );
}

/** Oylar jadvali: daromad, xarajat, natija (eng yangi oy tepada) */
export function MonthsTable({ months, income, expense }: { months: string[]; income: string[]; expense: string[] }) {
  const rows = months.map((m, i) => ({ m, inc: Number(income[i] ?? 0), exp: Number(expense[i] ?? 0) })).filter((r) => r.inc !== 0 || r.exp !== 0);
  if (rows.length === 0) return <EmptyNote>Ma&apos;lumot yo&apos;q</EmptyNote>;
  const ti = rows.reduce((s, r) => s + r.inc, 0);
  const te = rows.reduce((s, r) => s + r.exp, 0);
  return (
    <RTable minWidth={640}>
      <thead>
        <tr>
          <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
          <Th className={cn(STICKY_NAME, 'z-[2] min-w-40 text-left')}>Oy</Th>
          <Th>Daromad</Th>
          <Th>Xarajat</Th>
          <Th>Natija</Th>
          <Th>Rentabellik</Th>
        </tr>
      </thead>
      <tbody>
        <Tr total>
          <Td className={STICKY_NO} />
          <NameCell>Jami · {rows.length} oy</NameCell>
          <MoneyCell value={ti} />
          <MoneyCell value={te} />
          <MoneyCell value={ti - te} strong signedColor calc={calcResult(ti, te)} />
          <Td>
            <PctBadge value={ti > 0 ? ((ti - te) / ti) * 100 : null} plain />
          </Td>
        </Tr>
        {[...rows].reverse().map((r, i) => (
          <Tr key={r.m}>
            <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
            <NameCell>{formatPeriod(r.m)}</NameCell>
            <MoneyCell value={r.inc} className="text-(--color-income)" />
            <MoneyCell value={r.exp} className="text-(--color-expense)" />
            <MoneyCell value={r.inc - r.exp} strong signedColor calc={calcResult(r.inc, r.exp, { title: formatPeriod(r.m) })} />
            <Td>
              <PctBadge value={r.inc > 0 ? ((r.inc - r.exp) / r.inc) * 100 : null} plain />
            </Td>
          </Tr>
        ))}
      </tbody>
    </RTable>
  );
}

// ═══════════════════════════════════════════════════════════
// 3) Xodim
// ═══════════════════════════════════════════════════════════

/** noPlan — Markaz xodimi: reja/fakt yo'q, faqat ish haqi */
export function EmployeeDrill({ pinfl, range, noPlan = false }: { pinfl: string; range: DateRange; noPlan?: boolean }) {
  const result = useAsync(() => drillApi.employee(pinfl, range).then((r) => r.data), [pinfl, range.from, range.to]);
  if (!result.data) return <LoadingCard label="Xodim ma'lumoti yuklanmoqda" error={result.error} onRetry={result.reload} />;
  return <EmployeeBody data={result.data} noPlan={noPlan} />;
}

function EmployeeBody({ data, noPlan }: { data: EmployeeDetailResult; noPlan: boolean }) {
  const e = data.employee;
  const t = data.totals;
  const paid = data.months.filter((m) => Number(m.salaryTiyin) > 0);
  const maxMonth = paid.reduce<(typeof paid)[number] | null>((best, m) => (!best || Number(m.salaryTiyin) > Number(best.salaryTiyin) ? m : best), null);
  const plan = Number(t.planTiyin);
  const fact = Number(t.factTiyin);
  const done = completion(plan, fact);
  const moved = new Set(data.months.map((m) => m.placeLabel ?? m.districtName ?? m.regionName)).size > 1;

  const exportCsv = () =>
    downloadCsv(
      `solishtirma-xodim-${e.fullName}-${data.range.from}_${data.range.to}`,
      noPlan ? ['Oy', 'Qayerda', "Ish haqi, so'm"] : ['Oy', 'Qayerda', "Ish haqi, so'm", "Reja, so'm", "Fakt, so'm", 'Bajarilish, %', "Bonus, so'm"],
      data.months.map((m) => {
        const base = [formatPeriod(m.period), (m.placeLabel ?? (m.districtName ? `${m.regionName}, ${m.districtName}` : m.regionName)), csvSom(m.salaryTiyin)];
        return noPlan ? base : [...base, csvSom(m.planTiyin), csvSom(m.factTiyin), csvPct(completion(Number(m.planTiyin), Number(m.factTiyin))), csvSom(m.bonusTiyin)];
      }),
    );

  const salaryCalc = calcSum('Ish haqi (davr)', data.months.map((m) => Q.money(formatPeriod(m.period), m.salaryTiyin, 'Ish haqi qaydnomasi')));
  const tiles: StatTile[] = noPlan
    ? [
        { label: 'Ish haqi (davr)', value: Number(t.salaryTiyin), note: `${paid.length} oy ish haqi olgan`, tone: 'red', calc: salaryCalc },
        { label: "O'rtacha oylik", value: paid.length ? Number(t.salaryTiyin) / paid.length : 0, note: "ish haqi olgan oylar bo'yicha", tone: 'blue' },
        { label: 'Eng katta oy', value: maxMonth ? Number(maxMonth.salaryTiyin) : 0, note: maxMonth ? formatPeriod(maxMonth.period) : '', tone: 'orange' },
        { label: 'Holati', value: 0, text: e.isActive ? 'Ishlamoqda' : 'Ishdan ketgan', note: e.employmentType === 'SHARTNOMA' ? 'Shartnoma asosida' : 'Shtat', tone: 'purple' },
      ]
    : [
        { label: 'Ish haqi (davr)', value: Number(t.salaryTiyin), note: `${paid.length} oy ish haqi olgan`, tone: 'red', calc: salaryCalc },
        { label: 'Reja', value: plan, note: 'Natijalar faylidan', tone: 'blue', calc: plan ? calcSum('Reja', data.months.map((m) => Q.money(formatPeriod(m.period), m.planTiyin, 'Natijalar fayli'))) : null },
        { label: 'Fakt', value: fact, note: 'Natijalar faylidan', tone: 'green', calc: fact ? calcSum('Fakt', data.months.map((m) => Q.money(formatPeriod(m.period), m.factTiyin, 'Natijalar fayli'))) : null },
        {
          label: 'Bajarilish',
          value: 0,
          text: done === null ? '' : `${done.toFixed(1).replace('.', ',')}%`,
          note: Number(t.bonusTiyin) ? `bonus ${Math.round(Number(t.bonusTiyin) / 100).toLocaleString('ru-RU')} so'm` : 'fakt ÷ reja',
          tone: 'orange',
          calc: plan ? calcCompletion(plan, fact) : null,
        },
      ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-white p-5 shadow-card">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white">
          {e.fullName
            .split(/\s+/)
            .slice(0, 2)
            .map((p) => p.charAt(0).toUpperCase())
            .join('')}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-heading">{e.fullName}</p>
          <p className="mt-0.5 flex items-center gap-2 text-sm text-(--color-text-muted)">
            <span className="text-xs font-semibold uppercase tracking-wide text-(--color-text-faint)">PINFL</span>
            <PinflText pinfl={e.pinfl} large />
          </p>
          <p className="text-sm text-(--color-text-muted)">
            {[e.position, e.employmentType === 'SHARTNOMA' ? 'Shartnoma asosida' : 'Shtat', e.districtName ? `${e.regionName}, ${e.districtName}` : e.regionName].filter(Boolean).join(' · ')}
          </p>
        </div>
        {!e.isActive && <span className="rounded-full bg-(--color-surface-sunken) px-3 py-1 text-xs font-semibold text-(--color-text-muted)">Ishdan ketgan</span>}
        <DiscussMenu
          items={[
            employeeMark(e.pinfl, e.fullName, 'EXPENSE', 'Solishtirma › xodim'),
            employeeMark(e.pinfl, e.fullName, 'INCOME', 'Solishtirma › xodim'),
            employeeMark(e.pinfl, e.fullName, 'RESULT', 'Solishtirma › xodim'),
          ]}
        />
      </div>

      <StatTiles items={tiles} />

      <ReportCard
        title="Oylar bo'yicha"
        badge={`${periodText(data.range)}${noPlan ? " · ish haqi Markaz bo'limi xarajatiga kiradi" : ' · ish haqi tuman xarajatiga kiradi'}${moved ? " · davr ichida joyini o'zgartirgan" : ''}`}
        actions={data.months.length > 0 ? <ExcelButton onClick={exportCsv} /> : undefined}
      >
        {data.months.length === 0 ? (
          <EmptyNote>Bu davrda ish haqi yoki natija yozuvi yo&apos;q</EmptyNote>
        ) : (
          <RTable minWidth={noPlan ? 640 : 960}>
            <thead>
              <tr>
                <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
                <Th className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>Oy</Th>
                <Th className="text-left">Qayerda ishlagan</Th>
                <Th>Ish haqi</Th>
                {!noPlan && (
                  <>
                    <Th>Reja</Th>
                    <Th>Fakt</Th>
                    <Th>Bajarilishi</Th>
                    <Th>Bonus</Th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              <Tr total>
                <Td className={STICKY_NO} />
                <NameCell>Jami</NameCell>
                <Td />
                <MoneyCell value={Number(t.salaryTiyin)} calc={calcSum('Jami ish haqi', data.months.map((m) => Q.money(formatPeriod(m.period), m.salaryTiyin)))} />
                {!noPlan && (
                  <>
                    <MoneyCell value={plan} />
                    <MoneyCell value={fact} />
                    <DoneCell plan={plan} fact={fact} />
                    <MoneyCell value={Number(t.bonusTiyin)} />
                  </>
                )}
              </Tr>
              {data.months.map((m, i) => (
                <Tr key={m.period}>
                  <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                  <NameCell>{formatPeriod(m.period)}</NameCell>
                  <Td className="text-left text-(--color-text-muted)">{(m.placeLabel ?? (m.districtName ? `${m.regionName}, ${m.districtName}` : m.regionName))}</Td>
                  <MoneyCell value={Number(m.salaryTiyin)} className="text-(--color-expense)" />
                  {!noPlan && (
                    <>
                      <MoneyCell value={Number(m.planTiyin)} />
                      <MoneyCell value={Number(m.factTiyin)} className="text-(--color-income)" />
                      <DoneCell plan={Number(m.planTiyin)} fact={Number(m.factTiyin)} note={formatPeriod(m.period)} />
                      <MoneyCell value={Number(m.bonusTiyin)} />
                    </>
                  )}
                </Tr>
              ))}
            </tbody>
          </RTable>
        )}
      </ReportCard>
    </div>
  );
}
