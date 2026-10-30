'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import {
  changeOf,
  DiffCell,
  ExcelButton,
  GroupTh,
  MoneyCell,
  NameCell,
  PctBadge,
  PillTabs,
  ReportCard,
  RTable,
  SearchInput,
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
import { count, EmptyNote, LoadingCard, MarkMoneyCell, PartsTable, ShareCell } from '@/components/report/report-extra-c';
import { CalcValue } from '@/components/ui/calc';
import type { CompareMode, SectionFilter } from '@/features/structure/api';
import { csvPct, csvSom, downloadCsv } from '@/features/structure/stats';
import { calcChange, calcDivide, calcResult, calcShare, calcSum, Q } from '@/lib/calc';
import { formatDate, formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn, cap } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';
import { centerDrillApi, type CenterDetailResult, type DepartmentDetailResult, type DepartmentRow } from './drill-api';
import { PinflText } from './pinfl-text';
import { Mark } from '@/features/reactions/mark';
import { centerPartMark, departmentMark, departmentPartMark, employeeMark } from '@/features/reactions/marks';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Markaz — hududlar kabi ichkariga kirish (reja/tushum yo'q):
//   Markaz (daromad manbalari, o'z xarajati, hududlar uchun to'langan) → Bo'limlar → Bo'lim xodimlari → Xodim.
// Yagona hisobot uslubi: kartalar, yorliqlar va jadvallar (grafiklarsiz).
// ═══════════════════════════════════════════════════════════


function periodText(range: DateRange): string {
  return `${formatDate(range.from)} — ${formatDate(range.to)}`;
}

/** Summa matni: «1 234 567 so'm» */
function somText(tiyin: number): string {
  return `${Math.round(tiyin / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;
}

// ═══════════════════════════════════════════════════════════
// Markaz
// ═══════════════════════════════════════════════════════════

type CenterView = 'departments' | 'income' | 'expense' | 'regional' | 'months';

export function CenterDrill({
  range,
  section,
  compare,
  coverage,
  onDepartment,
}: {
  range: DateRange;
  section: SectionFilter;
  compare: CompareMode;
  /** Hududlar foydasi ÷ Markaz sof xarajati, % (Solishtirmadan) */
  coverage: number | null;
  onDepartment: (row: DepartmentRow) => void;
}) {
  const result = useAsync(() => centerDrillApi.center(range, section, compare).then((r) => r.data), [range.from, range.to, section, compare]);
  if (!result.data) return <LoadingCard label="Markaz hisoblanmoqda" error={result.error} onRetry={result.reload} />;
  return <CenterBody data={result.data} coverage={coverage} onDepartment={onDepartment} vehicles={{ unit: 'center', range, section, compare }} />;
}

function CenterBody({ data, coverage, onDepartment, vehicles }: { data: CenterDetailResult; coverage: number | null; onDepartment: (row: DepartmentRow) => void; vehicles: VehicleQuery }) {
  const [view, setView] = useState<CenterView>('departments');
  const [query, setQuery] = useState('');
  const t = data.totals;
  const label = cap(data.compareLabel);
  const income = Number(t.incomeTiyin);
  const own = Number(t.ownExpenseTiyin);
  const regional = Number(t.regionalExpenseTiyin);
  /** 2-guruh: asosiy vositalar sarfi (xarid balansda) */
  const assets = Number(t.assetsExpenseTiyin ?? 0);
  const currentExp = own + regional;
  const prevCurrentExp = Number(t.previousOwnExpenseTiyin) + Number(t.previousRegionalExpenseTiyin);
  const expense = Number(t.expenseTiyin);
  const net = income - expense;
  const prevNet = Number(t.previousIncomeTiyin) - Number(t.previousExpenseTiyin);

  const q = query.trim().toLowerCase();
  const rows = data.departments.filter((d) => !q || d.name.toLowerCase().includes(q));

  const exportCsv = () =>
    downloadCsv(
      `solishtirma-markaz-bolimlar-${data.range.from}_${data.range.to}`,
      ["Bo'lim", 'Xodimlar', `${data.compareLabel}: xarajat, so'm`, "Xarajat, so'm", "Farqi, so'm", 'Farqi, %', "Ish haqi, so'm", "Boshqa xarajat, so'm", "Bir xodimga, so'm", "Daromad, so'm"],
      data.departments.map((d) => [
        d.name,
        d.headcount,
        csvSom(d.previousExpenseTiyin),
        csvSom(d.expenseTiyin),
        csvSom(Number(d.expenseTiyin) - Number(d.previousExpenseTiyin)),
        csvPct(changeOf(Number(d.expenseTiyin), Number(d.previousExpenseTiyin))),
        csvSom(d.payrollTiyin),
        csvSom(d.otherTiyin),
        d.perHeadTiyin ? csvSom(d.perHeadTiyin) : '',
        csvSom(d.incomeTiyin),
      ]),
    );

  const exportMonths = () =>
    downloadCsv(
      `solishtirma-markaz-oylar`,
      ['Oy', "Daromad, so'm", "O'z xarajati, so'm", "Hududlar uchun, so'm", "Asosiy vositalar sarfi, so'm", "Jami xarajat, so'm", "Natija, so'm"],
      data.months.map((m, i) => {
        const inc = Number(data.trend.income[i] ?? 0);
        const o = Number(data.trend.own[i] ?? 0);
        const r = Number(data.trend.regional[i] ?? 0);
        const a = Number(data.trend.assets?.[i] ?? 0);
        return [formatPeriod(m), csvSom(inc), csvSom(o), csvSom(r), csvSom(a), csvSom(o + r + a), csvSom(inc - o - r - a)];
      }),
    );

  const tiles: StatTile[] = [
    {
      label: 'Markaz daromadi',
      value: income,
      previous: Number(t.previousIncomeTiyin),
      tone: 'green',
      calc: calcSum('Markaz daromadi', data.incomeParts.map((p) => Q.money(p.label, p.amountTiyin, 'Daromadlar'))),
    },
    {
      label: '1. Joriy xarajatlar',
      value: currentExp,
      previous: prevCurrentExp,
      growthGood: false,
      tone: 'red',
      calc: calcSum('Joriy xarajatlar', [
        ...data.ownParts.map((p) => Q.money(p.label, p.amountTiyin, "O'ziniki")),
        ...data.regionalParts.map((p) => Q.money(`Hududlar uchun: ${p.label}`, p.amountTiyin, 'Xarajatlar siyosati')),
      ]),
    },
    {
      label: '2. Asosiy vositalar sarfi',
      value: assets,
      previous: assets ? Number(t.previousAssetsExpenseTiyin ?? 0) : null,
      growthGood: false,
      tone: 'orange',
    },
    {
      label: net >= 0 ? 'Markaz natijasi' : 'Markaz sof xarajati',
      value: net,
      previous: prevNet,
      signed: true,
      tone: 'blue',
      calc: calcResult(income, expense, {
        title: 'Markaz natijasi',
        note: `Xarajat = o'z xarajati ${somText(own)} + hududlar uchun ${somText(regional)}${assets ? ` + asosiy vositalar sarfi ${somText(assets)}` : ''}`,
      }),
    },
    {
      label: 'Markazni qoplash',
      value: 0,
      text: coverage === null ? '' : `${coverage.toFixed(1).replace('.', ',')}%`,
      note: 'hududlar foydasi ÷ Markaz sof xarajati',
      tone: 'purple',
    },
  ];

  const views: { value: CenterView; label: string }[] = [
    { value: 'departments', label: `Bo'limlar (${data.departments.length})` },
    { value: 'income', label: 'Daromad manbalari' },
    { value: 'expense', label: 'Xarajat tarkibi' },
    { value: 'regional', label: 'Hududlar uchun — kimga' },
    { value: 'months', label: 'Oylar kesimida' },
  ];

  const prevOwn = Number(t.previousOwnExpenseTiyin);

  return (
    <div className="space-y-4">
      <StatTiles items={tiles} compareLabel="Avval" />

      <PillTabs value={view} onChange={setView} options={views} />

      {view === 'departments' && (
        <ReportCard
          title="Markaz bo'limlari"
          badge={`${periodText(data.range)} · ${t.headcount} xodim · ${data.compareLabel}: ${periodText(data.previousRange)}`}
          actions={
            <>
              <SearchInput value={query} onChange={setQuery} placeholder="Bo'lim qidirish…" />
              <ExcelButton onClick={exportCsv} />
            </>
          }
        >
          <RTable minWidth={1060}>
            <thead>
              <tr>
                <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>
                  №
                </Th>
                <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>
                  Bo&apos;lim
                </Th>
                <Th rowSpan={2}>Xodim</Th>
                <GroupTh span={3}>Xarajat</GroupTh>
                <GroupTh span={2}>Shundan</GroupTh>
                <Th rowSpan={2}>Bir xodimga</Th>
                <Th rowSpan={2}>Daromad</Th>
              </tr>
              <tr>
                <Th className="first:border-l">{label}</Th>
                <Th>Joriy davr</Th>
                <Th>Farqi, foizda</Th>
                <Th>Ish haqi</Th>
                <Th>Boshqa</Th>
              </tr>
            </thead>
            <tbody>
              <Tr total>
                <Td className={STICKY_NO} />
                <NameCell>O&apos;z xarajati jami</NameCell>
                <Td>{count(t.headcount)}</Td>
                <MoneyCell value={prevOwn} />
                <MoneyCell value={own} calc={calcSum("O'z xarajati", data.departments.map((d) => Q.money(d.name, d.expenseTiyin)))} />
                <DiffCell value={own - prevOwn} pct={changeOf(own, prevOwn)} growthGood={false} />
                <MoneyCell value={Number(t.payrollTiyin)} />
                <MoneyCell value={own - Number(t.payrollTiyin)} />
                <MoneyCell value={t.headcount > 0 ? own / t.headcount : 0} />
                <MoneyCell value={data.departments.reduce((s, d) => s + Number(d.incomeTiyin), 0)} />
              </Tr>
              {rows.map((d, i) => {
                const exp = Number(d.expenseTiyin);
                const prev = Number(d.previousExpenseTiyin);
                return (
                  <Tr key={d.id} onClick={() => onDepartment(d)} muted={d.unassigned}>
                    <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{d.unassigned ? '' : i + 1}</Td>
                    <NameCell
                      drill
                      before={<Mark item={departmentMark(d.id, d.name, 'EXPENSE', data.section)} />}
                      sub={d.topParts.length ? `asosan: ${d.topParts.map((p) => p.label).join(', ')}` : undefined}
                      className={cn('max-w-72', d.unassigned && 'italic')}
                    >
                      {d.name}
                    </NameCell>
                    <Td>{d.headcount ? count(d.headcount) : <span className="text-(--color-text-faint)"></span>}</Td>
                    <MoneyCell value={prev} />
                    <MoneyCell value={exp} strong />
                    <DiffCell value={exp - prev} pct={changeOf(exp, prev)} growthGood={false} calc={calcChange(`${d.name} xarajati`, Q.money('Joriy davr', exp), Q.money(label, prev), { growthGood: false })} />
                    <MoneyCell value={Number(d.payrollTiyin)} />
                    <MoneyCell value={Number(d.otherTiyin)} />
                    <Td className="whitespace-nowrap">
                      {d.perHeadTiyin ? (
                        <CalcValue calc={calcDivide(`${d.name}: bir xodimga xarajat`, Q.money('Xarajat', d.expenseTiyin), { label: 'Xodimlar', value: d.headcount, kind: 'ratio' }, 'money', { formulaId: 'perHead' })} className="no-underline">
                          {somText(Number(d.perHeadTiyin)).replace(" so'm", '')}
                        </CalcValue>
                      ) : (
                        ''
                      )}
                    </Td>
                    <MoneyCell value={Number(d.incomeTiyin)} className="text-(--color-income)" />
                  </Tr>
                );
              })}
            </tbody>
          </RTable>
          <TableNote>Bo&apos;limni bosing — xodimlari ochiladi. Hududlar uchun to&apos;langan va asosiy vositalar sarfi bu jadvalga kirmaydi — «Xarajat tarkibi» yorlig&apos;ida.</TableNote>
        </ReportCard>
      )}

      {view === 'income' && (
        <ReportCard title="Daromad manbalari" badge={`Markazga yozilgan daromad · ${data.compareLabel}ga nisbatan`}>
          <PartsTable
            parts={data.incomeParts}
            title="Markaz daromadi"
            compareLabel={data.compareLabel}
            growthGood
            markOf={(p) => centerPartMark('INCOME', p, data.section)}
            nameHead="Daromad manbai"
            totalLabel="Jami daromad"
            empty="Bu davrda Markazga yozilgan daromad yo'q (Daromadlar › Markaz tushumi)"
          />
        </ReportCard>
      )}

      {view === 'expense' && (
        <>
          <ReportCard title={`1a. O'z xarajati · ${somText(own)}`} badge={`${data.compareLabel}ga nisbatan · o'sish — qizil`}>
            <PartsTable parts={data.ownParts} title="O'z xarajati" compareLabel={data.compareLabel} growthGood={false} markOf={(p) => centerPartMark('EXPENSE', p, data.section)} totalLabel="Jami o'z xarajati" empty="O'z xarajati yo'q" vehicles={vehicles} safar={vehicles} />
          </ReportCard>
          <ReportCard title={`1b. Hududlar uchun to'langan · ${somText(regional)}`} badge="Xarajatlar siyosati bo'yicha Markaz hisobidan">
            <PartsTable
              parts={data.regionalParts}
              title="Hududlar uchun to'langan"
              compareLabel={data.compareLabel}
              growthGood={false}
              markOf={(p) => centerPartMark('EXPENSE', p, data.section, true)}
              totalLabel="Jami hududlar uchun"
              empty="Xarajatlar siyosatida Markaz hisobidan moddalar yo'q yoki bu davrda yozilmagan"
              safar={{ ...vehicles, unit: 'center:regional' }}
            />
          </ReportCard>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-5 py-3.5 text-sm shadow-card">
            <span>
              <b className="text-heading">2. Asosiy vositalar sarfi · {somText(assets)}</b>
              <span className="block text-xs text-(--color-text-muted)">Xarid balansda turadi — xarajatga har oy faqat sarfi (eskirishi) o&apos;tadi</span>
            </span>
            <Link href="/xarajatlar/asosiy-vositalar" className="whitespace-nowrap rounded-lg border border-brand-300 px-3 py-1.5 text-xs font-semibold text-brand-700 hover:bg-brand-50">
              Asosiy vositalar →
            </Link>
          </div>
        </>
      )}

      {view === 'regional' && (
        <ReportCard title="Hududlar uchun — kimga" badge="Markaz hisobidan to'langan moddalar qaysi hudud uchun">
          {data.regionalBy.length === 0 ? (
            <EmptyNote>Bu davrda yo&apos;q</EmptyNote>
          ) : (
            <RTable minWidth={560}>
              <thead>
                <tr>
                  <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
                  <Th className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>Hudud</Th>
                  <Th>Summasi</Th>
                  <Th>Ulushi</Th>
                </tr>
              </thead>
              <tbody>
                <Tr total>
                  <Td className={STICKY_NO} />
                  <NameCell>Jami hududlar uchun</NameCell>
                  <MoneyCell value={regional} calc={calcSum("Hududlar uchun to'langan", data.regionalBy.map((r) => Q.money(r.name, r.amountTiyin)))} />
                  <Td>
                    <PctBadge value={100} plain />
                  </Td>
                </Tr>
                {data.regionalBy.map((r, i) => (
                  <Tr key={String(r.regionCode)}>
                    <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                    <NameCell>{r.name}</NameCell>
                    <MoneyCell value={Number(r.amountTiyin)} />
                    <ShareCell part={Number(r.amountTiyin)} total={regional} calc={calcShare(`${r.name} ulushi`, Q.money(r.name, r.amountTiyin), Q.money('Hududlar uchun jami', regional))} />
                  </Tr>
                ))}
              </tbody>
            </RTable>
          )}
        </ReportCard>
      )}

      {view === 'months' && (
        <ReportCard title={`Markaz: oxirgi ${data.months.length} oy`} badge="Daromad va xarajat oyma-oy" actions={<ExcelButton onClick={exportMonths} />}>
          <CenterMonths data={data} />
        </ReportCard>
      )}
    </div>
  );
}

function CenterMonths({ data }: { data: CenterDetailResult }) {
  const rows = data.months
    .map((m, i) => ({
      m,
      inc: Number(data.trend.income[i] ?? 0),
      own: Number(data.trend.own[i] ?? 0),
      reg: Number(data.trend.regional[i] ?? 0),
      ast: Number(data.trend.assets?.[i] ?? 0),
    }))
    .filter((r) => r.inc || r.own || r.reg || r.ast);
  if (rows.length === 0) return <EmptyNote>Ma&apos;lumot yo&apos;q</EmptyNote>;
  const hasAssets = rows.some((r) => r.ast !== 0);
  const total = rows.reduce((a, r) => ({ inc: a.inc + r.inc, own: a.own + r.own, reg: a.reg + r.reg, ast: a.ast + r.ast }), { inc: 0, own: 0, reg: 0, ast: 0 });
  const line = (r: typeof total, title?: string) => {
    const exp = r.own + r.reg + r.ast;
    return (
      <>
        <MoneyCell value={r.inc} className="text-(--color-income)" />
        <MoneyCell value={r.own} />
        <MoneyCell value={r.reg} />
        {hasAssets && <MoneyCell value={r.ast} />}
        <MoneyCell value={exp} className="text-(--color-expense)" />
        <MoneyCell value={r.inc - exp} strong signedColor calc={calcResult(r.inc, exp, { title })} />
      </>
    );
  };
  return (
    <RTable minWidth={900}>
      <thead>
        <tr>
          <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>
            №
          </Th>
          <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>
            Oy
          </Th>
          <Th rowSpan={2}>Daromad</Th>
          <GroupTh span={hasAssets ? 4 : 3}>Xarajat</GroupTh>
          <Th rowSpan={2}>Natija</Th>
        </tr>
        <tr>
          <Th className="first:border-l">O&apos;ziniki</Th>
          <Th>Hududlar uchun</Th>
          {hasAssets && <Th>Asosiy vositalar</Th>}
          <Th>Jami</Th>
        </tr>
      </thead>
      <tbody>
        <Tr total>
          <Td className={STICKY_NO} />
          <NameCell>Jami · {rows.length} oy</NameCell>
          {line(total, 'Jami')}
        </Tr>
        {[...rows].reverse().map((r, i) => (
          <Tr key={r.m}>
            <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
            <NameCell>{formatPeriod(r.m)}</NameCell>
            {line(r, formatPeriod(r.m))}
          </Tr>
        ))}
      </tbody>
    </RTable>
  );
}

// ═══════════════════════════════════════════════════════════
// Bo'lim
// ═══════════════════════════════════════════════════════════

type DepartmentView = 'employees' | 'expense' | 'income';

export function CenterDepartmentDrill({
  id,
  range,
  section,
  compare,
  onEmployee,
}: {
  id: string;
  range: DateRange;
  section: SectionFilter;
  compare: CompareMode;
  onEmployee: (pinfl: string, name: string) => void;
}) {
  const result = useAsync(() => centerDrillApi.department(id, range, section, compare).then((r) => r.data), [id, range.from, range.to, section, compare]);
  if (!result.data) return <LoadingCard label="Bo'lim hisoblanmoqda" error={result.error} onRetry={result.reload} />;
  return <DepartmentBody data={result.data} onEmployee={onEmployee} vehicles={{ unit: id === '-' ? 'cnd' : `dep:${id}`, range, section, compare }} />;
}

function DepartmentBody({ data, onEmployee, vehicles }: { data: DepartmentDetailResult; onEmployee: (pinfl: string, name: string) => void; vehicles: VehicleQuery }) {
  const [view, setView] = useState<DepartmentView>('employees');
  const [query, setQuery] = useState('');
  const s = data.summary;
  const label = cap(data.compareLabel);
  const expense = Number(s.expenseTiyin);
  const payroll = Number(s.payrollTiyin);
  const q = query.trim().toLowerCase();
  const list = data.employees.filter((e) => !q || e.fullName.toLowerCase().includes(q) || e.pinfl.includes(q));
  const salary = data.employees.reduce((a, e) => a + Number(e.salaryTiyin), 0);
  const prevSalary = data.employees.reduce((a, e) => a + Number(e.previousSalaryTiyin), 0);

  const exportCsv = () =>
    downloadCsv(
      `solishtirma-markaz-${data.department.name}-xodimlar-${data.range.from}_${data.range.to}`,
      ['F.I.Sh', 'PINFL', 'Lavozim', 'Turi', `${data.compareLabel}: ish haqi, so'm`, "Ish haqi, so'm", "Farqi, so'm", 'Farqi, %', 'Oylar'],
      data.employees.map((e) => [
        e.fullName,
        e.pinfl,
        e.position ?? '',
        e.employmentType === 'SHARTNOMA' ? 'Shartnoma' : 'Shtat',
        csvSom(e.previousSalaryTiyin),
        csvSom(e.salaryTiyin),
        csvSom(Number(e.salaryTiyin) - Number(e.previousSalaryTiyin)),
        csvPct(changeOf(Number(e.salaryTiyin), Number(e.previousSalaryTiyin))),
        e.paidMonths,
      ]),
    );

  const tiles: StatTile[] = [
    {
      label: "Bo'lim xarajati",
      value: expense,
      previous: Number(s.previousExpenseTiyin),
      growthGood: false,
      tone: 'red',
      calc: calcSum("Bo'lim xarajati", data.expenseParts.map((p) => Q.money(p.label, p.amountTiyin))),
    },
    {
      label: 'Ish haqi',
      value: payroll,
      previous: Number(s.previousPayrollTiyin),
      growthGood: false,
      tone: 'orange',
      calc: calcSum('Ish haqi', data.employees.filter((e) => Number(e.salaryTiyin)).map((e) => Q.money(e.fullName, e.salaryTiyin, 'Ish haqi qaydnomasi'))),
    },
    { label: 'Xodimlar', value: 0, text: `${count(s.headcount)} ta`, note: `${data.employees.filter((e) => Number(e.salaryTiyin) > 0).length} tasiga ish haqi yozilgan`, tone: 'purple' },
    {
      label: 'Bir xodimga',
      value: s.perHeadTiyin ? Number(s.perHeadTiyin) : 0,
      note: Number(s.incomeTiyin) ? `bo'lim daromadi ${somText(Number(s.incomeTiyin))}` : 'xarajat ÷ xodimlar',
      tone: 'blue',
      calc: s.perHeadTiyin ? calcDivide('Bir xodimga xarajat', Q.money('Xarajat', s.expenseTiyin), { label: 'Xodimlar', value: s.headcount, kind: 'ratio' }, 'money', { formulaId: 'perHead' }) : null,
    },
  ];

  const views: { value: DepartmentView; label: string }[] = [
    { value: 'employees', label: `Xodimlar (${data.employees.length})` },
    { value: 'expense', label: `Xarajat tarkibi (${data.expenseParts.length})` },
    ...(data.incomeParts.length > 0 ? [{ value: 'income' as const, label: "Bo'lim daromadi" }] : []),
  ];

  return (
    <div className="space-y-4">
      <StatTiles items={tiles} compareLabel="Avval" />

      <PillTabs value={view} onChange={setView} options={views} />

      {view === 'employees' && (
        <ReportCard
          title={`${data.department.name}: xodimlar — ${data.employees.length} ta`}
          badge={`${periodText(data.range)} · xodimni bosing — oylar bo'yicha ish haqi`}
          actions={
            <>
              <SearchInput value={query} onChange={setQuery} placeholder="F.I.Sh yoki PINFL…" />
              <ExcelButton onClick={exportCsv} />
            </>
          }
        >
          {list.length === 0 ? (
            <EmptyNote>{data.employees.length === 0 ? "Bo'limda xodim yo'q" : "Qidiruv bo'yicha topilmadi"}</EmptyNote>
          ) : (
            <RTable minWidth={960}>
              <thead>
                <tr>
                  <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>
                    №
                  </Th>
                  <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>
                    Xodim
                  </Th>
                  <Th rowSpan={2} className="text-left">
                    Lavozim
                  </Th>
                  <GroupTh span={3}>Ish haqi</GroupTh>
                  <Th rowSpan={2}>Oylar</Th>
                </tr>
                <tr>
                  <Th className="first:border-l">{label}</Th>
                  <Th>Joriy davr</Th>
                  <Th>Farqi, foizda</Th>
                </tr>
              </thead>
              <tbody>
                <Tr total>
                  <Td className={STICKY_NO} />
                  <NameCell>Jami · {data.employees.length} xodim</NameCell>
                  <Td />
                  <MoneyCell value={prevSalary} />
                  <MoneyCell value={salary} calc={calcSum('Ish haqi', data.employees.map((e) => Q.money(e.fullName, e.salaryTiyin)))} />
                  <DiffCell value={salary - prevSalary} pct={changeOf(salary, prevSalary)} growthGood={false} />
                  <Td />
                </Tr>
                {list.map((e, i) => {
                  const sal = Number(e.salaryTiyin);
                  const prev = Number(e.previousSalaryTiyin);
                  return (
                    <Tr key={e.pinfl} onClick={() => onEmployee(e.pinfl, e.fullName)}>
                      <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                      <NameCell
                        drill
                        before={<Mark item={employeeMark(e.pinfl, e.fullName, 'EXPENSE', 'Solishtirma › Markaz xodimi')} />}
                        sub={
                          <>
                            <PinflText pinfl={e.pinfl} />
                            {e.employmentType === 'SHARTNOMA' ? ' · shartnoma' : ''}
                            {!e.isActive ? ' · ishdan ketgan' : ''}
                          </>
                        }
                        className="max-w-72"
                      >
                        {e.fullName}
                      </NameCell>
                      <Td className="text-left text-(--color-text-muted)">{e.position ?? ''}</Td>
                      <MoneyCell value={prev} />
                      {sal ? (
                        <MarkMoneyCell value={sal} className="text-(--color-expense)" />
                      ) : (
                        <Td>
                          <span className="text-xs text-amber-700">yozilmagan</span>
                        </Td>
                      )}
                      <DiffCell value={sal - prev} pct={changeOf(sal, prev)} growthGood={false} />
                      <Td className="text-(--color-text-muted)">{e.paidMonths || ''}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </RTable>
          )}
        </ReportCard>
      )}

      {view === 'expense' && (
        <ReportCard title={`${data.department.name}: xarajat tarkibi`} badge={`${data.compareLabel}ga nisbatan · o'sish — qizil`}>
          <PartsTable
            parts={data.expenseParts}
            title="Bo'lim xarajati"
            compareLabel={data.compareLabel}
            growthGood={false}
            markOf={(p) => departmentPartMark(data.department.id, data.department.name, p as (typeof data.expenseParts)[number], data.section)}
            totalLabel="Jami xarajat"
            empty="Bu davrda xarajat yo'q"
            vehicles={vehicles}
            safar={vehicles}
          />
        </ReportCard>
      )}

      {view === 'income' && (
        <ReportCard title={`${data.department.name}: daromad`} badge="Shu bo'limga yozilgan daromad">
          <PartsTable parts={data.incomeParts} title="Bo'lim daromadi" compareLabel={data.compareLabel} growthGood nameHead="Daromad manbai" totalLabel="Jami daromad" empty="Daromad yo'q" />
        </ReportCard>
      )}
    </div>
  );
}
