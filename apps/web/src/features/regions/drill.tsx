'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { CalcValue } from '@/components/ui/calc';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { DiscussMenu } from '@/features/reactions/discuss';
import { Mark } from '@/features/reactions/mark';
import { compactMarks, districtMark, districtPartMark, districtServiceMark, employeeMark } from '@/features/reactions/marks';
import { compact, num, pct, type CompareMode, type SectionFilter } from '@/features/structure/api';
import { Findings, KpiStrip, SearchBox, SmallButton } from '@/features/structure/parts';
import { changePct, csvSom, downloadCsv } from '@/features/structure/stats';
import { formatDate, formatPeriod, formatPeriodShort } from '@/lib/format';
import { calcChange, calcCompletion, calcDiff, calcDivide, calcResult, calcShare, calcSum, Q } from '@/lib/calc';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useBrief } from '@/lib/view-mode';
import { useMemo, useState, type ReactNode } from 'react';
import { PinflText } from './pinfl-text';
import {
  drillApi,
  type DistrictDetailResult,
  type DistrictRow,
  type EmployeeDetailResult,
  type RegionDistrictsResult,
} from './drill-api';

// ═══════════════════════════════════════════════════════════
// Solishtirma ichkarisi: Viloyat → Tumanlar → Tuman → Xodim
// Har bir daraja o'sha joyning o'zida ochiladi; tepada yo'lak — istalgan bo'g'inga bir bosishda qaytiladi.
// ═══════════════════════════════════════════════════════════

const INCOME = 'var(--color-income)';
const EXPENSE = 'var(--color-expense)';

// ─────────── Kichik yordamchilar ───────────

/**
 * O'zgarish: ▲/▼ foiz; rang — yaxshi/yomonligiga qarab (xarajat o'sishi — qizil).
 * what berilsa — bosilganda «Qanday hisoblandi?» oynasi ochiladi.
 */
function Delta({
  current,
  previous,
  growthGood,
  what,
  kind = 'money',
}: {
  current: number;
  previous: number;
  growthGood: boolean;
  what?: string;
  kind?: 'money' | 'count';
}) {
  const d = changePct(current, previous);
  const calc = what
    ? calcChange(`${what}: o'zgarish`, { label: 'Joriy davr', value: current, kind }, { label: 'Oldingi davr', value: previous, kind }, { growthGood, note: "Oldingi davr — sahifa tepasida tanlangan taqqoslash (o'tgan davr yoki o'tgan yil)." })
    : null;
  let body: ReactNode;
  if (d === null) {
    body = <span className="text-[11px] text-(--color-text-faint)">{current !== 0 ? 'yangi' : '—'}</span>;
  } else if (Math.abs(d) < 0.05) {
    body = <span className="text-[11px] text-(--color-text-muted)">0%</span>;
  } else {
    const good = d > 0 === growthGood;
    body = (
      <span className={cn('inline-flex items-center gap-0.5 whitespace-nowrap text-[11px] font-semibold tabular-nums', good ? 'text-(--color-income)' : 'text-(--color-expense)')}>
        <span className="text-[0.75em]">{d > 0 ? '▲' : '▼'}</span>
        {pct(Math.abs(d))}
      </span>
    );
  }
  return calc ? <CalcValue calc={calc}>{body}</CalcValue> : body;
}

function Money({ tiyin, className }: { tiyin: string | number; className?: string }) {
  return <span className={cn('whitespace-nowrap tabular-nums', className)}>{num(tiyin)}</span>;
}

function resultColor(value: number): string {
  return value >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)';
}

/** Reja bajarilishi, % */
function completion(plan: number, fact: number): number | null {
  return plan > 0 ? (fact / plan) * 100 : null;
}

function Th({ children, className, onClick, active }: { children: ReactNode; className?: string; onClick?: () => void; active?: boolean }) {
  return (
    <th className={cn('px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)', className)}>
      {onClick ? (
        <button type="button" onClick={onClick} className={cn('inline-flex items-center gap-1 uppercase hover:text-heading', active && 'text-brand-700')}>
          {children}
          {active && <span aria-hidden="true">↓</span>}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function Section({ title, description, actions, children, className }: { title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-(--color-line) px-5 py-3.5">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-heading">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-(--color-text-muted)">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </Card>
  );
}

function Loading({ label, error, onRetry }: { label: string; error: string | null; onRetry: () => void }) {
  return <Card>{error ? <ErrorState message={error} onRetry={onRetry} /> : <LoadingState label={label} />}</Card>;
}

// ═══════════════════════════════════════════════════════════
// Yo'lak: Solishtirma › Viloyat › Tuman › Xodim
// ═══════════════════════════════════════════════════════════

export interface Crumb {
  label: string;
  onClick?: () => void;
}

export function DrillBreadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 rounded-(--radius-card) bg-white px-4 py-3 text-sm shadow-card" aria-label="Yo'lak">
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <span key={`${item.label}-${i}`} className="inline-flex items-center gap-1.5">
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

type DistrictSort = 'income' | 'quantity' | 'expense' | 'expenseGrowth' | 'result' | 'headcount' | 'name';

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
  if (!result.data) return <Loading label="Tumanlar hisoblanmoqda" error={result.error} onRetry={result.reload} />;
  return <RegionBody data={result.data} onDistrict={onDistrict} extraActions={extraActions} />;
}

function RegionBody({ data, onDistrict, extraActions }: { data: RegionDistrictsResult; onDistrict: (row: DistrictRow) => void; extraActions?: ReactNode }) {
  const [sort, setSort] = useState<DistrictSort>('income');
  const [query, setQuery] = useState('');

  const t = data.totals;
  const income = Number(t.incomeTiyin);
  const expense = Number(t.expenseTiyin);
  const prevIncome = Number(t.previousIncomeTiyin);
  const prevExpense = Number(t.previousExpenseTiyin);

  const real = data.districts.filter((d) => !d.unassigned);
  const unassigned = data.districts.find((d) => d.unassigned) ?? null;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const key = (d: DistrictRow): number | string => {
      switch (sort) {
        case 'name':
          return d.name;
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
    };
    return real
      .filter((d) => !q || d.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const va = key(a);
        const vb = key(b);
        if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb), 'uz');
        return vb - va;
      });
  }, [real, query, sort]);

  const max = Math.max(1, ...data.districts.flatMap((d) => [Number(d.incomeTiyin), Number(d.expenseTiyin)]));

  const exportCsv = () =>
    downloadCsv(
      `solishtirma-${data.region.name}-tumanlar-${data.range.from}_${data.range.to}`,
      ['Tuman', "Daromad, so'm", 'Xizmatlar soni', "Xarajat, so'm", "shundan ish haqi, so'm", "ijara, so'm", "boshqa, so'm", "Natija, so'm", `${data.compareLabel}: daromad, so'm`, `${data.compareLabel}: xarajat, so'm`, 'Xodimlar', "Natijalar: fakt, so'm"],
      data.districts.map((d) => [
        d.name,
        csvSom(d.incomeTiyin),
        d.quantity,
        csvSom(d.expenseTiyin),
        csvSom(d.payrollTiyin),
        csvSom(d.leaseTiyin),
        csvSom(d.otherTiyin),
        csvSom(d.resultTiyin),
        csvSom(d.previousIncomeTiyin),
        csvSom(d.previousExpenseTiyin),
        d.headcount,
        csvSom(d.factTiyin),
      ]),
    );

  return (
    <div className="space-y-4">
      <KpiStrip
        items={[
          {
            label: 'Daromad',
            value: compact(income),
            valueClass: 'text-(--color-income)',
            sub: <Delta what="Viloyat daromadi" current={income} previous={prevIncome} growthGood />,
            calc: calcSum('Viloyat daromadi', data.districts.map((d) => Q.money(d.name, d.incomeTiyin, 'Hududlar tushumi')), {
              note: "Viloyat daromadi — tumanlar daromadlari yig'indisi («Tumanga bo'linmagan» qatori bilan birga).",
            }),
          },
          {
            label: "Ko'rsatilgan xizmatlar",
            value: `${t.quantity.toLocaleString('ru-RU')} ta`,
            sub: `${real.filter((d) => Number(d.incomeTiyin) > 0).length} ta tumandan`,
            calc: calcSum("Ko'rsatilgan xizmatlar", data.districts.map((d) => Q.count(d.name, d.quantity, 'Hududlar tushumi, «Soni» ustuni')), { kind: 'count' }),
          },
          {
            label: 'Xarajat',
            value: compact(expense),
            valueClass: 'text-(--color-expense)',
            sub: <Delta what="Viloyat xarajati" current={expense} previous={prevExpense} growthGood={false} />,
            calc: calcSum('Viloyat xarajati', data.districts.map((d) => Q.money(d.name, d.expenseTiyin)), {
              note: 'Har tuman xarajati = ish haqi + ijara + boshqa xarajatlar. Tuman ko\'rsatilmagan yozuvlar «Tumanga bo\'linmagan» qatorida.',
            }),
          },
          {
            label: 'Natija',
            value: compact(income - expense),
            valueClass: resultColor(income - expense),
            sub: `${data.compareLabel}: ${compact(prevIncome - prevExpense)}`,
            calc: calcResult(income, expense, { note: `${formatDate(data.range.from)} — ${formatDate(data.range.to)} davri uchun.` }),
          },
        ]}
      />

      {(!data.check.incomeOk || !data.check.expenseOk) && (
        <p className="rounded-(--radius-card) bg-(--color-expense-soft) px-4 py-3 text-sm text-(--color-expense)">
          Diqqat: tumanlar yig&apos;indisi viloyat jamisiga teng chiqmadi ({!data.check.incomeOk ? 'daromad' : ''}
          {!data.check.incomeOk && !data.check.expenseOk ? ', ' : ''}
          {!data.check.expenseOk ? 'xarajat' : ''}). Bu xabarni skrinshot qilib yuboring.
        </p>
      )}

      <Findings title="Asosiy xulosalar" notes={data.notes} />

      <Section
        title={`${data.region.name}: tumanlar`}
        description={`${formatDate(data.range.from)} — ${formatDate(data.range.to)} · o'zgarish: ${data.compareLabel}ga nisbatan · tumanni bosing — ichiga kiring`}
        actions={
          <>
            <SearchBox value={query} onChange={setQuery} placeholder="Tuman qidirish…" />
            <SmallButton onClick={exportCsv}>Excel (CSV)</SmallButton>
            {extraActions}
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="border-b border-(--color-line) bg-(--color-surface-muted) text-left">
              <tr>
                <Th className="w-10 pl-5 text-right">№</Th>
                <Th onClick={() => setSort('name')} active={sort === 'name'}>Tuman</Th>
                <Th className="text-right" onClick={() => setSort('income')} active={sort === 'income'}>Daromad</Th>
                <Th className="text-right" onClick={() => setSort('quantity')} active={sort === 'quantity'}>Xizmatlar</Th>
                <Th className="text-right" onClick={() => setSort('expense')} active={sort === 'expense'}>Xarajat</Th>
                <Th className="text-right" onClick={() => setSort('expenseGrowth')} active={sort === 'expenseGrowth'}>Xarajat o&apos;sishi</Th>
                <Th className="text-right" onClick={() => setSort('result')} active={sort === 'result'}>Natija</Th>
                <Th className="text-right" onClick={() => setSort('headcount')} active={sort === 'headcount'}>Xodimlar</Th>
                <Th className="pr-5">Daromad / xarajat</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-line)">
              {rows.map((d, i) => (
                <DistrictTr key={d.id} d={d} index={i + 1} max={max} section={data.section} onOpen={() => onDistrict(d)} />
              ))}
              {unassigned && <DistrictTr d={unassigned} index={null} max={max} section={data.section} onOpen={() => onDistrict(unassigned)} />}
            </tbody>
            <tfoot className="border-t-2 border-(--color-line-strong) bg-(--color-surface-muted) font-semibold">
              <tr>
                <td />
                <td className="px-3 py-2.5 text-heading">Jami {data.region.name}</td>
                <td className="px-3 py-2.5 text-right">
                  <CalcValue calc={calcSum('Jami daromad', data.districts.map((d) => Q.money(d.name, d.incomeTiyin)))}>
                    <Money tiyin={t.incomeTiyin} className="text-(--color-income)" />
                  </CalcValue>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <CalcValue calc={calcSum('Jami xizmatlar', data.districts.map((d) => Q.count(d.name, d.quantity)), { kind: 'count' })}>{t.quantity.toLocaleString('ru-RU')}</CalcValue>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <CalcValue calc={calcSum('Jami xarajat', data.districts.map((d) => Q.money(d.name, d.expenseTiyin)))}>
                    <Money tiyin={t.expenseTiyin} className="text-(--color-expense)" />
                  </CalcValue>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <Delta what="Viloyat xarajati" current={expense} previous={prevExpense} growthGood={false} />
                </td>
                <td className={cn('px-3 py-2.5 text-right', resultColor(income - expense))}>
                  <CalcValue calc={calcResult(income, expense, { title: `Natija: ${data.region.name}` })}>
                    <Money tiyin={income - expense} />
                  </CalcValue>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <CalcValue calc={calcSum('Xodimlar', real.map((d) => Q.count(d.name, d.headcount, 'Davrda ish haqi olgan xodimlar')), { kind: 'count' })}>
                    {real.reduce((s, d) => s + d.headcount, 0)}
                  </CalcValue>
                </td>
                <td className="pr-5" />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="border-t border-(--color-line) px-5 py-2.5 text-[11px] leading-relaxed text-(--color-text-muted)">
          Daromad — Hududlar tushumi (tumanlar kesimida yuklangani); xarajat — tumanda ishlagan xodimlar ish haqi, tumanga yozilgan ijara va
          tuman ko&apos;rsatilgan boshqa xarajatlar. Tuman ko&apos;rsatilmagan yozuvlar — «Tumanga bo&apos;linmagan» qatorida; hammasi birga viloyat jamisiga teng.
        </p>
      </Section>
    </div>
  );
}

function DistrictTr({ d, index, max, section, onOpen }: { d: DistrictRow; index: number | null; max: number; section: SectionFilter; onOpen: () => void }) {
  const income = Number(d.incomeTiyin);
  const expense = Number(d.expenseTiyin);
  const growth = expense - Number(d.previousExpenseTiyin);
  return (
    <tr className={cn('group cursor-pointer transition-colors hover:bg-brand-50/60', d.unassigned && 'bg-(--color-warn-soft)/40 italic')} onClick={onOpen}>
      <td className="py-2.5 pl-5 pr-1 text-right text-xs tabular-nums text-(--color-text-faint)">{index ?? ''}</td>
      <td className="px-3 py-2.5">
        <span className="inline-flex items-center gap-1.5">
          <Mark item={districtMark(d.id, d.name, 'RESULT', section)} />
          <span className="font-medium text-heading group-hover:text-brand-700 group-hover:underline">{d.name}</span>
        </span>
        {d.topServices[0] && <span className="block max-w-[16rem] truncate text-[11px] text-(--color-text-faint)">asosan: {d.topServices.map((s) => s.label).join(', ')}</span>}
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="inline-flex items-center gap-1.5">
          <Mark item={districtMark(d.id, d.name, 'INCOME', section)} />
          <Money tiyin={d.incomeTiyin} className="text-(--color-income)" />
        </span>
        <span className="block">
          <Delta what={`${d.name} daromadi`} current={income} previous={Number(d.previousIncomeTiyin)} growthGood />
        </span>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {d.quantity ? d.quantity.toLocaleString('ru-RU') : '—'}
        <span className="block">
          <Delta what={`${d.name}: xizmatlar soni`} kind="count" current={d.quantity} previous={d.previousQuantity} growthGood />
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="inline-flex items-center gap-1.5">
          <Mark item={districtMark(d.id, d.name, 'EXPENSE', section)} />
          <CalcValue
            calc={calcSum(`${d.name} xarajati`, [Q.money('Ish haqi', d.payrollTiyin, 'Tumanda ishlagan xodimlar'), Q.money('Ijara', d.leaseTiyin, 'Tumandagi ijara shartnomalari'), Q.money('Boshqa', d.otherTiyin, 'Tuman ko\'rsatilgan xarajatlar')])}
          >
            <Money tiyin={d.expenseTiyin} className="text-(--color-expense)" />
          </CalcValue>
        </span>
        <span className="block text-[11px] text-(--color-text-faint)">ish haqi {compact(d.payrollTiyin)}</span>
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className={cn('block whitespace-nowrap text-xs font-semibold tabular-nums', growth > 0 ? 'text-(--color-expense)' : growth < 0 ? 'text-(--color-income)' : 'text-(--color-text-faint)')}>
          <CalcValue calc={calcDiff(`${d.name}: xarajat o'sishi`, Q.money('Joriy davr xarajati', expense), Q.money('Oldingi davr xarajati', Number(d.previousExpenseTiyin)))}>
            {growth === 0 ? '—' : `${growth > 0 ? '+' : '−'}${compact(Math.abs(growth))}`}
          </CalcValue>
        </span>
        <Delta what={`${d.name} xarajati`} current={expense} previous={Number(d.previousExpenseTiyin)} growthGood={false} />
      </td>
      <td className={cn('px-3 py-2.5 text-right font-semibold', resultColor(Number(d.resultTiyin)))}>
        <CalcValue calc={calcResult(income, expense, { title: `Natija: ${d.name}` })}>
          <Money tiyin={d.resultTiyin} />
        </CalcValue>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">{d.headcount || '—'}</td>
      <td className="w-48 py-2.5 pl-3 pr-5">
        <span className="block space-y-1" title={`Daromad: ${compact(income)} · Xarajat: ${compact(expense)}`}>
          <span className="block h-2 rounded-full" style={{ width: `${(income / max) * 100}%`, background: INCOME, minWidth: income > 0 ? 3 : 0 }} />
          <span className="block h-2 rounded-full" style={{ width: `${(expense / max) * 100}%`, background: EXPENSE, minWidth: expense > 0 ? 3 : 0 }} />
        </span>
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════
// 2) Tuman
// ═══════════════════════════════════════════════════════════

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
  if (!result.data) return <Loading label="Tuman hisoblanmoqda" error={result.error} onRetry={result.reload} />;
  return <DistrictBody data={result.data} onEmployee={onEmployee} />;
}

function DistrictBody({ data, onEmployee }: { data: DistrictDetailResult; onEmployee: (pinfl: string, name: string) => void }) {
  const brief = useBrief();
  const [query, setQuery] = useState('');
  const s = data.summary;
  const income = Number(s.incomeTiyin);
  const expense = Number(s.expenseTiyin);
  const plan = Number(s.planTiyin);
  const fact = Number(s.factTiyin);

  const serviceTotal = data.services.reduce((a, x) => a + Number(x.amountTiyin), 0) || 1;
  const partTotal = data.expenseParts.reduce((a, x) => a + Number(x.amountTiyin), 0) || 1;

  const employees = data.employees.filter((e) => {
    const q = query.trim().toLowerCase();
    return !q || e.fullName.toLowerCase().includes(q) || (e.position ?? '').toLowerCase().includes(q) || e.pinfl.includes(q.replace(/\s/g, ''));
  });

  const exportEmployees = () =>
    downloadCsv(
      `solishtirma-${data.district.name}-xodimlar-${data.range.from}_${data.range.to}`,
      ['PINFL', 'F.I.Sh.', 'Lavozim', "Ish haqi, so'm", `${data.compareLabel}: ish haqi, so'm`, "Reja, so'm", "Fakt, so'm", 'Bajarilish, %', "Bonus, so'm"],
      data.employees.map((e) => [
        e.pinfl,
        e.fullName,
        e.position ?? '',
        csvSom(e.salaryTiyin),
        csvSom(e.previousSalaryTiyin),
        csvSom(e.planTiyin),
        csvSom(e.factTiyin),
        completion(Number(e.planTiyin), Number(e.factTiyin))?.toFixed(1).replace('.', ',') ?? '',
        csvSom(e.bonusTiyin),
      ]),
    );

  const d = data.district;
  const discussItems = d.unassigned
    ? []
    : compactMarks([
        districtMark(d.id, d.name, 'RESULT', data.section),
        districtMark(d.id, d.name, 'INCOME', data.section),
        districtMark(d.id, d.name, 'EXPENSE', data.section),
        ...data.services.map((x) => districtServiceMark(d.id, d.name, x, data.section)),
        ...data.expenseParts.map((p) => districtPartMark(d.id, d.name, p, data.section)),
      ]);

  return (
    <div className="space-y-4">
      {discussItems.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-(--radius-card) border border-brand-100 bg-brand-50/50 px-4 py-2.5">
          <p className="text-xs text-(--color-text-muted)">
            <b className="text-heading">{d.name}</b> — daromadi, xarajati, natijasi, istalgan xizmat turi yoki xarajat moddasini muhokamaga qo&apos;yish mumkin.
          </p>
          <DiscussMenu items={discussItems} />
        </div>
      )}

      <KpiStrip
        items={[
          {
            label: 'Daromad',
            value: compact(income),
            valueClass: 'text-(--color-income)',
            sub: <Delta what={`${data.district.name} daromadi`} current={income} previous={Number(s.previousIncomeTiyin)} growthGood />,
            calc: calcSum(`${data.district.name} daromadi`, data.services.map((x) => Q.money(x.label, x.amountTiyin, 'Hududlar tushumi'))),
          },
          {
            label: "Ko'rsatilgan xizmatlar",
            value: `${s.quantity.toLocaleString('ru-RU')} ta`,
            sub: <Delta what={`${data.district.name}: xizmatlar soni`} kind="count" current={s.quantity} previous={s.previousQuantity} growthGood />,
            calc: calcSum("Ko'rsatilgan xizmatlar", data.services.map((x) => Q.count(x.label, x.quantity)), { kind: 'count' }),
          },
          {
            label: 'Xarajat',
            value: compact(expense),
            valueClass: 'text-(--color-expense)',
            sub: <Delta what={`${data.district.name} xarajati`} current={expense} previous={Number(s.previousExpenseTiyin)} growthGood={false} />,
            calc: calcSum(`${data.district.name} xarajati`, data.expenseParts.map((p) => Q.money(p.label, p.amountTiyin)), {
              note: "Ish haqi — shu tumanda ishlagan xodimlarga hisoblangani; ijara — tumandagi shartnomalar; qolgani — tuman ko'rsatilgan xarajatlar.",
            }),
          },
          {
            label: 'Natija',
            value: compact(income - expense),
            valueClass: resultColor(income - expense),
            sub:
              plan > 0 ? (
                <CalcValue calc={calcCompletion(plan, fact, { note: "Natijalar faylidagi tuman xodimlari rejasi va fakti (daromadga qo'shilmaydi)." })}>
                  Xodimlar rejasi bajarilishi: {pct(completion(plan, fact))}
                </CalcValue>
              ) : (
                `${s.headcount} ta xodim ish haqi olgan`
              ),
            calc: calcResult(income, expense, { title: `Natija: ${data.district.name}` }),
          },
        ]}
      />

      <Findings title="Asosiy xulosalar" notes={data.notes} />

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Xizmat turlari */}
        <Section title="Xizmat turlari bo'yicha daromad" description={`Soni va summasi · ${data.compareLabel}ga nisbatan`}>
          {data.services.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-(--color-text-muted)">
              Bu davr uchun tuman kesimidagi daromad yo&apos;q. Hududlar tushumini «tumanlar kesimida» shabloni bilan yuklang.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-(--color-line) bg-(--color-surface-muted) text-left">
                  <tr>
                    <Th className="pl-5">Xizmat</Th>
                    <Th className="text-right">Soni</Th>
                    <Th className="text-right">Summa</Th>
                    <Th className="text-right">O&apos;rtacha</Th>
                    <Th className="w-28 pr-5">Ulush</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--color-line)">
                  {data.services.map((x) => {
                    const share = (Number(x.amountTiyin) / serviceTotal) * 100;
                    return (
                      <tr key={x.code}>
                        <td className="max-w-[16rem] py-2 pl-5 pr-3" title={x.label}>
                          <span className="flex items-start gap-1.5">
                            <Mark item={districtServiceMark(d.id, d.name, x, data.section)} className="mt-0.5" />
                            <span className="line-clamp-2">{x.label}</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {x.quantity ? x.quantity.toLocaleString('ru-RU') : '—'}
                          <span className="block">
                            <Delta what={`${x.label}: soni`} kind="count" current={x.quantity} previous={x.previousQuantity} growthGood />
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Money tiyin={x.amountTiyin} className="text-(--color-income)" />
                          <span className="block">
                            <Delta what={`${x.label}: summa`} current={Number(x.amountTiyin)} previous={Number(x.previousTiyin)} growthGood />
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums text-(--color-text-muted)">
                          {x.averageTiyin ? (
                            <CalcValue calc={calcDivide(`${x.label}: o'rtacha narx`, Q.money('Summa', x.amountTiyin), Q.count('Soni', x.quantity), 'money', { formulaId: 'average' })}>
                              {num(x.averageTiyin)}
                            </CalcValue>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="py-2 pl-3 pr-5">
                          <span className="block h-1.5 overflow-hidden rounded-full bg-(--color-surface-sunken)">
                            <span className="block h-full rounded-full" style={{ width: `${share}%`, background: INCOME }} />
                          </span>
                          <CalcValue calc={calcShare(`${x.label}: ulush`, Q.money('Xizmat summasi', x.amountTiyin), Q.money('Tuman daromadi', serviceTotal))} className="text-[11px] tabular-nums text-(--color-text-muted)">
                            {pct(share)}
                          </CalcValue>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Xarajat tarkibi */}
        <Section title="Xarajat tarkibi" description={`Qaysi modda qancha · ${data.compareLabel}ga nisbatan o'sish qizil`}>
          {data.expenseParts.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-(--color-text-muted)">Bu davrda tumanga yozilgan xarajat yo&apos;q.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-(--color-line)">
                {data.expenseParts.map((p) => {
                  const amount = Number(p.amountTiyin);
                  const diff = amount - Number(p.previousTiyin);
                  return (
                    <tr key={p.key}>
                      <td className="py-2.5 pl-5 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          <Mark item={districtPartMark(d.id, d.name, p, data.section)} />
                          {p.label}
                        </span>
                      </td>
                      <td className="w-32 px-3 py-2.5">
                        <span className="block h-2 overflow-hidden rounded-full bg-(--color-surface-sunken)">
                          <span className="block h-full rounded-full" style={{ width: `${(amount / partTotal) * 100}%`, background: EXPENSE }} />
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Money tiyin={p.amountTiyin} />
                      </td>
                      <td className="py-2.5 pl-3 pr-5 text-right">
                        <span className={cn('block whitespace-nowrap text-xs font-semibold tabular-nums', diff > 0 ? 'text-(--color-expense)' : diff < 0 ? 'text-(--color-income)' : 'text-(--color-text-faint)')}>
                          <CalcValue calc={calcDiff(`${p.label}: farq`, Q.money('Joriy davr', amount), Q.money('Oldingi davr', Number(p.previousTiyin)))}>
                            {diff === 0 ? '—' : `${diff > 0 ? '+' : '−'}${compact(Math.abs(diff))}`}
                          </CalcValue>
                        </span>
                        <Delta what={`${p.label}`} current={amount} previous={Number(p.previousTiyin)} growthGood={false} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Section>
      </div>

      {/* 12 oy — faqat To'liq rejimda */}
      {!brief && (
        <Section title="Oxirgi 12 oy" description="Daromad (yashil) va xarajat (qizil) yonma-yon">
          <MonthBars months={data.months} income={s.incomeTrend} expense={s.expenseTrend} />
        </Section>
      )}

      {/* Xodimlar */}
      <Section
        title={`Xodimlar — ${data.employees.length} ta`}
        description="Ish haqi tuman xarajatiga kiradi · reja va fakt — Natijalar faylidan (daromadga qo'shilmaydi) · xodimni bosing — batafsil"
        actions={
          <>
            <SearchBox value={query} onChange={setQuery} placeholder="Ism yoki PINFL…" />
            <SmallButton onClick={exportEmployees} disabled={data.employees.length === 0}>
              Excel (CSV)
            </SmallButton>
          </>
        }
      >
        {employees.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-(--color-text-muted)">
            {data.employees.length === 0 ? "Bu davrda shu tumanda ish haqi olgan xodim yo'q" : 'Qidiruv bo‘yicha topilmadi'}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead className="border-b border-(--color-line) bg-(--color-surface-muted) text-left">
                <tr>
                  <Th className="pl-5">F.I.Sh.</Th>
                  <Th>PINFL</Th>
                  <Th className="text-right">Ish haqi</Th>
                  <Th className="text-right">Reja</Th>
                  <Th className="text-right">Fakt</Th>
                  <Th className="text-right">Bajarilish</Th>
                  <Th className="pr-5 text-right">Bonus</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {employees.map((e) => {
                  const done = completion(Number(e.planTiyin), Number(e.factTiyin));
                  return (
                    <tr key={e.pinfl} className="group cursor-pointer hover:bg-brand-50/60" onClick={() => onEmployee(e.pinfl, e.fullName)}>
                      <td className="py-2.5 pl-5 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          <Mark item={employeeMark(e.pinfl, e.fullName, 'RESULT', 'Solishtirma › xodim')} />
                          <span className="font-medium text-heading group-hover:text-brand-700 group-hover:underline">{e.fullName}</span>
                        </span>
                        <span className="block text-[11px] text-(--color-text-faint)">
                          {[e.position, e.employmentType === 'SHARTNOMA' ? 'shartnoma' : null, e.paidMonths ? `${e.paidMonths} oy ish haqi` : null].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <PinflText pinfl={e.pinfl} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <Mark item={employeeMark(e.pinfl, e.fullName, 'EXPENSE', 'Solishtirma › xodim')} />
                          <Money tiyin={e.salaryTiyin} className="text-(--color-expense)" />
                        </span>
                        <span className="block">
                          <Delta what={`${e.fullName}: ish haqi`} current={Number(e.salaryTiyin)} previous={Number(e.previousSalaryTiyin)} growthGood={false} />
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">{Number(e.planTiyin) ? <Money tiyin={e.planTiyin} /> : '—'}</td>
                      <td className="px-3 py-2.5 text-right">
                        {Number(e.factTiyin) ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Mark item={employeeMark(e.pinfl, e.fullName, 'INCOME', 'Solishtirma › xodim')} />
                            <Money tiyin={e.factTiyin} className="text-(--color-income)" />
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={cn('px-3 py-2.5 text-right text-xs font-semibold tabular-nums', done === null ? 'text-(--color-text-faint)' : done >= 100 ? 'text-(--color-income)' : 'text-(--color-expense)')}>
                        {done === null ? '—' : <CalcValue calc={calcCompletion(e.planTiyin, e.factTiyin, { note: e.fullName })}>{pct(done)}</CalcValue>}
                      </td>
                      <td className="py-2.5 pl-3 pr-5 text-right">{Number(e.bonusTiyin) ? <Money tiyin={e.bonusTiyin} /> : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

/** Oylar bo'yicha daromad va xarajat — ikki ustun yonma-yon (bir-birining orqasida emas) */
function MonthBars({ months, income, expense }: { months: string[]; income: string[]; expense: string[] }) {
  const inc = income.map(Number);
  const exp = expense.map(Number);
  const max = Math.max(1, ...inc, ...exp);
  if (inc.every((v) => v === 0) && exp.every((v) => v === 0)) {
    return <p className="px-5 py-8 text-center text-sm text-(--color-text-muted)">Ma&apos;lumot yo&apos;q</p>;
  }
  return (
    <div className="px-5 pb-4 pt-5">
      <div className="flex h-52 items-end gap-2">
        {months.map((m, i) => (
          <div key={m} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${formatPeriod(m)}\nDaromad: ${compact(inc[i] ?? 0)}\nXarajat: ${compact(exp[i] ?? 0)}`}>
            <div className="flex h-full w-full items-end justify-center gap-0.5">
              <div className="w-full max-w-4 rounded-t" style={{ height: `${((inc[i] ?? 0) / max) * 100}%`, background: INCOME, minHeight: (inc[i] ?? 0) > 0 ? 2 : 0 }} />
              <div className="w-full max-w-4 rounded-t" style={{ height: `${((exp[i] ?? 0) / max) * 100}%`, background: EXPENSE, minHeight: (exp[i] ?? 0) > 0 ? 2 : 0 }} />
            </div>
            <span className="whitespace-nowrap text-[10px] text-(--color-text-faint)">{formatPeriodShort(m)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-(--color-text-muted)">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: INCOME }} />
          Daromad
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: EXPENSE }} />
          Xarajat
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 3) Xodim
// ═══════════════════════════════════════════════════════════

/** noPlan — Markaz xodimi: reja/fakt yo'q, faqat ish haqi */
export function EmployeeDrill({ pinfl, range, noPlan = false }: { pinfl: string; range: DateRange; noPlan?: boolean }) {
  const result = useAsync(() => drillApi.employee(pinfl, range).then((r) => r.data), [pinfl, range.from, range.to]);
  if (!result.data) return <Loading label="Xodim ma'lumoti yuklanmoqda" error={result.error} onRetry={result.reload} />;
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
  const moved = new Set(data.months.map((m) => m.districtName ?? m.regionName)).size > 1;

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center gap-4 p-5">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-lg font-bold text-white shadow-md">
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
      </Card>

      {noPlan ? (
        <KpiStrip
          items={[
            {
              label: 'Ish haqi (davr)',
              value: compact(t.salaryTiyin),
              valueClass: 'text-(--color-expense)',
              sub: `${paid.length} oy`,
              calc: calcSum('Ish haqi (davr)', data.months.map((m) => Q.money(formatPeriod(m.period), m.salaryTiyin, 'Ish haqi qaydnomasi'))),
            },
            { label: "O'rtacha oylik", value: paid.length ? compact(Number(t.salaryTiyin) / paid.length) : '—', sub: "ish haqi olgan oylar bo'yicha" },
            { label: 'Eng katta oy', value: maxMonth ? compact(maxMonth.salaryTiyin) : '—', sub: maxMonth ? formatPeriod(maxMonth.period) : undefined },
            { label: 'Holati', value: e.isActive ? 'Ishlamoqda' : 'Ishdan ketgan', sub: e.employmentType === 'SHARTNOMA' ? 'Shartnoma asosida' : 'Shtat' },
          ]}
        />
      ) : (
      <KpiStrip
        items={[
          {
            label: 'Ish haqi (davr)',
            value: compact(t.salaryTiyin),
            valueClass: 'text-(--color-expense)',
            sub: `${data.months.filter((m) => Number(m.salaryTiyin) > 0).length} oy`,
            calc: calcSum('Ish haqi (davr)', data.months.map((m) => Q.money(formatPeriod(m.period), m.salaryTiyin, 'Ish haqi qaydnomasi'))),
          },
          { label: 'Reja', value: plan ? compact(plan) : '—', calc: plan ? calcSum('Reja', data.months.map((m) => Q.money(formatPeriod(m.period), m.planTiyin, 'Natijalar fayli'))) : null },
          { label: 'Fakt', value: fact ? compact(fact) : '—', valueClass: 'text-(--color-income)', calc: fact ? calcSum('Fakt', data.months.map((m) => Q.money(formatPeriod(m.period), m.factTiyin, 'Natijalar fayli'))) : null },
          {
            label: 'Bajarilish',
            value: done === null ? '—' : pct(done),
            valueClass: done === null ? undefined : done >= 100 ? 'text-(--color-income)' : 'text-(--color-expense)',
            sub: Number(t.bonusTiyin) ? `bonus ${compact(t.bonusTiyin)}` : undefined,
            calc: plan ? calcCompletion(plan, fact) : null,
          },
        ]}
      />
      )}

      <Section
        title="Oylar bo'yicha"
        description={
          noPlan
            ? `${formatDate(data.range.from)} — ${formatDate(data.range.to)} · ish haqi Markaz bo'limi xarajatiga kiradi`
            : `${formatDate(data.range.from)} — ${formatDate(data.range.to)} · ish haqi tuman xarajatiga kiradi, reja va fakt — Natijalar faylidan${moved ? ' · xodim davr ichida joyini o‘zgartirgan' : ''}`
        }
      >
        {data.months.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-(--color-text-muted)">Bu davrda ish haqi yoki natija yozuvi yo&apos;q</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-(--color-line) bg-(--color-surface-muted) text-left">
                <tr>
                  <Th className="pl-5">Oy</Th>
                  <Th>Qayerda ishlagan</Th>
                  <Th className={cn('text-right', noPlan && 'pr-5')}>Ish haqi</Th>
                  {!noPlan && (
                    <>
                      <Th className="text-right">Reja</Th>
                      <Th className="text-right">Fakt</Th>
                      <Th className="text-right">Bajarilish</Th>
                      <Th className="pr-5 text-right">Bonus</Th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {data.months.map((m) => {
                  const d = completion(Number(m.planTiyin), Number(m.factTiyin));
                  return (
                    <tr key={m.period}>
                      <td className="py-2.5 pl-5 pr-3 font-medium text-heading">{formatPeriod(m.period)}</td>
                      <td className="px-3 py-2.5 text-(--color-text-muted)">{m.districtName ? `${m.regionName}, ${m.districtName}` : m.regionName}</td>
                      <td className={cn('px-3 py-2.5 text-right', noPlan && 'pr-5')}>{Number(m.salaryTiyin) ? <Money tiyin={m.salaryTiyin} className="text-(--color-expense)" /> : '—'}</td>
                      {!noPlan && (
                      <>
                      <td className="px-3 py-2.5 text-right">{Number(m.planTiyin) ? <Money tiyin={m.planTiyin} /> : '—'}</td>
                      <td className="px-3 py-2.5 text-right">{Number(m.factTiyin) ? <Money tiyin={m.factTiyin} className="text-(--color-income)" /> : '—'}</td>
                      <td className={cn('px-3 py-2.5 text-right text-xs font-semibold tabular-nums', d === null ? 'text-(--color-text-faint)' : d >= 100 ? 'text-(--color-income)' : 'text-(--color-expense)')}>
                        {d === null ? '—' : <CalcValue calc={calcCompletion(m.planTiyin, m.factTiyin, { note: formatPeriod(m.period) })}>{pct(d)}</CalcValue>}
                      </td>
                      <td className="py-2.5 pl-3 pr-5 text-right">{Number(m.bonusTiyin) ? <Money tiyin={m.bonusTiyin} /> : '—'}</td>
                      </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t-2 border-(--color-line-strong) bg-(--color-surface-muted) font-semibold">
                <tr>
                  <td className="py-2.5 pl-5 pr-3 text-heading" colSpan={2}>
                    Jami
                  </td>
                  <td className={cn('px-3 py-2.5 text-right', noPlan && 'pr-5')}>
                    <CalcValue calc={calcSum('Jami ish haqi', data.months.map((m) => Q.money(formatPeriod(m.period), m.salaryTiyin)))}>
                      <Money tiyin={t.salaryTiyin} className="text-(--color-expense)" />
                    </CalcValue>
                  </td>
                  {!noPlan && (
                  <>
                  <td className="px-3 py-2.5 text-right">{plan ? <Money tiyin={t.planTiyin} /> : '—'}</td>
                  <td className="px-3 py-2.5 text-right">{fact ? <Money tiyin={t.factTiyin} className="text-(--color-income)" /> : '—'}</td>
                  <td className="px-3 py-2.5 text-right text-xs tabular-nums">{done === null ? '—' : <CalcValue calc={calcCompletion(plan, fact)}>{pct(done)}</CalcValue>}</td>
                  <td className="py-2.5 pl-3 pr-5 text-right">{Number(t.bonusTiyin) ? <Money tiyin={t.bonusTiyin} /> : '—'}</td>
                  </>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}