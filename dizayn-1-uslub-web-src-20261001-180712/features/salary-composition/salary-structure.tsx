'use client';

import { formatPercent, formatPeriod, formatPeriodShort, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useState } from 'react';

import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { IconArrowRight, IconChevronDown } from '@/components/ui/icons';
import { Money } from '@/components/ui/money';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/table';

import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_ORDER, type ComponentCategory } from './api';
import {
    fetchSalaryStructure,
    type SalaryStructure,
    type StructurePerson,
} from './structure-api';

/** Tarkibi yuklanmagan qism rangi */
const UNALLOCATED_COLOR = '#cbd5e1';

interface Props {
  /** Sana oralig'i: "YYYY-MM-DD" — oylari olinadi */
  range: { from: string; to: string };
  /**
   * compact — faqat guruhlar (Xarajat tahlili sahifasi uchun),
   * aks holda to'liq: oylar, bo'limlar, premiya va jarimalar
   */
  compact?: boolean;
}

/**
 * Ish haqi tuzilmasi — rasmiy summa (soliq hisoboti) tarkib guruhlariga bo'linadi.
 * Tarkibi yuklanmagan qism alohida ko'rsatiladi, shuning uchun jami rasmiy summaga teng.
 */
export function SalaryStructureCard({ range, compact = false }: Props) {
  const structure = useAsync(
    () => fetchSalaryStructure(range.from, range.to),
    [range.from, range.to],
  );

  const data = structure.data?.data;
  const title = 'Ish haqi tuzilmasi';
  const periodText = `${formatPeriod(range.from.slice(0, 7))} — ${formatPeriod(range.to.slice(0, 7))}`;

  if (structure.loading) {
    return (
      <Card>
        <CardHeader title={title} description={periodText} />
        <LoadingState />
      </Card>
    );
  }

  if (structure.error || !data) {
    return (
      <Card>
        <CardHeader title={title} description={periodText} />
        <ErrorState message={structure.error ?? 'Ma’lumot yo‘q'} onRetry={structure.reload} />
      </Card>
    );
  }

  if (data.totals.coveredPeriods === 0) {
    return (
      <Card>
        <CardHeader title={title} description={periodText} />
        <EmptyState
          title="Bu oraliqda ish haqi tarkibi yuklanmagan"
          description="Ish haqi qanday qismlardan iborat ekanini ko'rish uchun tarkib faylini yuklang"
          action={
            <Link
              href="/xarajatlar/tarkib"
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              Ish haqi tarkibi bo&rsquo;limiga o&rsquo;tish
            </Link>
          }
        />
      </Card>
    );
  }

  if (compact) return <CompactView data={data} range={range} periodText={periodText} />;

  return <FullView data={data} periodText={periodText} />;
}

// ═══════════════════════════════════════════════════════════
// Ixcham ko'rinish
// ═══════════════════════════════════════════════════════════

function CompactView({
  data,
  range,
  periodText,
}: {
  data: SalaryStructure;
  range: { from: string; to: string };
  periodText: string;
}) {
  const href = `/tahlil/umumiy?${new URLSearchParams({
    dateFrom: range.from,
    dateTo: range.to,
    tab: 'expenses',
  }).toString()}`;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Ish haqi tuzilmasi"
        description={`${periodText} · ${coverageText(data)}`}
        actions={
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
          >
            Batafsil
            <IconArrowRight className="size-3.5" />
          </Link>
        }
      />
      <CardBody className="space-y-4">
        <StackBar data={data} />
        <CategoryList data={data} />
      </CardBody>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// To'liq ko'rinish
// ═══════════════════════════════════════════════════════════

function FullView({ data, periodText }: { data: SalaryStructure; periodText: string }) {
  const { totals } = data;
  const bonus = totals.byCategory.find((c) => c.category === 'PREMIYA');
  const unallocated = BigInt(totals.unallocatedTiyin);

  return (
    <div className="space-y-4">
      {/* Asosiy raqamlar */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Rasmiy ish haqi" value={formatTiyin(totals.payrollTiyin)} hint={periodText} />
        <Tile
          label="Tarkibda taqsimlangan"
          value={formatTiyin(totals.compositionTiyin)}
          hint={coverageText(data)}
        />
        <Tile
          label="Premiyalar ulushi"
          value={formatPercent(bonus?.sharePercent ?? null)}
          hint={bonus ? formatTiyin(bonus.totalTiyin) : 'Premiya yo‘q'}
          tone="income"
        />
        <Tile
          label="Tarkibi yuklanmagan"
          value={formatTiyin(totals.unallocatedTiyin)}
          hint={
            unallocated === 0n
              ? 'Hammasi taqsimlangan'
              : 'Soliq hisobotidagi, tarkibda yo‘q summa'
          }
          tone={unallocated === 0n ? 'neutral' : 'warn'}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Guruhlar */}
        <Card className="overflow-hidden">
          <CardHeader
            title="Guruhlar bo'yicha"
            description="Ulush — tarkib yuklangan oylardagi rasmiy ish haqiga nisbatan"
          />
          <CardBody className="space-y-4">
            <StackBar data={data} />
            <CategoryList data={data} />
          </CardBody>
        </Card>

        {/* Oylar */}
        <Card className="overflow-hidden">
          <CardHeader title="Oylar bo'yicha" description="Har oy ish haqi qanday tarkibdan iborat" />
          <CardBody>
            <MonthBars data={data} />
          </CardBody>
        </Card>
      </div>

      <UnitsTable data={data} />

      <div className="grid gap-4 xl:grid-cols-2">
        <PeopleCard
          title="Eng katta premiyalar"
          description="Oraliq bo'yicha jami · ulush — xodim ish haqida"
          people={data.topBonus}
          tone="income"
          empty="Premiya yo'q"
        />
        <PeopleCard
          title="Eng katta jarimalar"
          description="Oraliq bo'yicha jami · ulush — xodim ish haqida"
          people={data.topPenalty}
          tone="expense"
          empty="Jarima yo'q"
        />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Bo'laklar
// ═══════════════════════════════════════════════════════════

function coverageText(data: SalaryStructure): string {
  const months = data.periods.filter((p) => p.payrollUploaded).length;
  return `tarkib ${data.totals.coveredPeriods}/${months} oy · qamrov ${formatPercent(data.totals.coveragePercent)}`;
}

function Tile({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'income' | 'expense' | 'warn';
}) {
  const colors = {
    neutral: 'text-(--color-text)',
    income: 'text-(--color-income)',
    expense: 'text-(--color-expense)',
    warn: 'text-(--color-warn)',
  };

  return (
    <div className="rounded-(--radius-card) border border-(--color-line) bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">{label}</p>
      <p className={cn('money mt-2 text-xl font-semibold', colors[tone])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-(--color-text-muted)">{hint}</p>}
    </div>
  );
}

/** Umumiy ulush chizig'i — tarkib yuklangan oylar bo'yicha */
function StackBar({ data }: { data: SalaryStructure }) {
  const covered = Number(data.totals.coveredPayrollTiyin);
  if (covered <= 0) return null;

  const segments = data.totals.byCategory
    .filter((c) => BigInt(c.totalTiyin) > 0n)
    .map((c) => ({
      key: c.category,
      label: c.label,
      color: CATEGORY_COLORS[c.category],
      width: (Number(c.totalTiyin) / covered) * 100,
    }));

  const used = segments.reduce((sum, s) => sum + s.width, 0);
  const rest = Math.max(0, 100 - used);

  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-(--color-surface-sunken)">
      {segments.map((segment) => (
        <div
          key={segment.key}
          title={`${segment.label}: ${formatPercent(segment.width)}`}
          style={{ width: `${segment.width}%`, backgroundColor: segment.color }}
        />
      ))}
      {rest > 0.2 && (
        <div
          title={`Tarkibi yuklanmagan / farq: ${formatPercent(rest)}`}
          style={{ width: `${rest}%`, backgroundColor: UNALLOCATED_COLOR }}
        />
      )}
    </div>
  );
}

/** Guruhlar ro'yxati — ochilganda komponentlar */
function CategoryList({ data }: { data: SalaryStructure }) {
  const [open, setOpen] = useState<ComponentCategory | null>(null);

  return (
    <div className="divide-y divide-(--color-line) rounded-(--radius-control) border border-(--color-line)">
      {data.totals.byCategory.map((category) => {
        const expanded = open === category.category;
        const items = data.byComponent.filter((c) => c.category === category.category);
        const negative = BigInt(category.totalTiyin) < 0n;

        return (
          <div key={category.category}>
            <button
              type="button"
              onClick={() => setOpen(expanded ? null : category.category)}
              className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-(--color-surface-muted)"
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: CATEGORY_COLORS[category.category] }}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{category.label}</span>
              <span className="w-16 shrink-0 text-right text-xs text-(--color-text-muted)">
                {formatPercent(category.sharePercent)}
              </span>
              <span className="w-36 shrink-0 text-right">
                <Money tiyin={category.totalTiyin} tone={negative ? 'expense' : 'neutral'} />
              </span>
              <IconChevronDown
                className={cn(
                  'size-4 shrink-0 text-(--color-text-faint) transition-transform',
                  expanded && 'rotate-180',
                )}
              />
            </button>

            {expanded && (
              <div className="bg-(--color-surface-muted) px-4 py-2">
                {items.map((item) => (
                  <div key={item.code} className="flex items-center gap-3 py-1.5 pl-5 text-sm">
                    <span className="min-w-0 flex-1 truncate text-(--color-text-muted)">{item.name}</span>
                    <span className="w-20 shrink-0 text-right text-xs text-(--color-text-muted)">
                      {item.employees} xodim
                    </span>
                    <span className="w-36 shrink-0 text-right">
                      <Money tiyin={item.totalTiyin} tone={item.sign < 0 ? 'expense' : 'neutral'} />
                    </span>
                    <span className="w-4 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Tarkibi yuklanmagan */}
      {BigInt(data.totals.unallocatedTiyin) !== 0n && (
        <div className="flex items-center gap-3 px-4 py-2.5">
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: UNALLOCATED_COLOR }} />
          <span className="min-w-0 flex-1 truncate text-sm text-(--color-text-muted)">
            Tarkibi yuklanmagan / farq
          </span>
          <span className="w-16 shrink-0" />
          <span className="w-36 shrink-0 text-right">
            <Money tiyin={data.totals.unallocatedTiyin} className="text-(--color-text-muted)" />
          </span>
          <span className="w-4 shrink-0" />
        </div>
      )}
    </div>
  );
}

/** Har oy uchun gorizontal ustun — guruhlar rasmiy summaga nisbatan */
function MonthBars({ data }: { data: SalaryStructure }) {
  const max = Math.max(...data.periods.map((p) => Number(p.payrollTiyin)), 1);
  const present = new Set(data.totals.byCategory.map((c) => c.category));
  const categories = CATEGORY_ORDER.filter((c) => present.has(c) && c !== 'JARIMA');

  return (
    <div className="space-y-2">
      {data.periods.map((period) => {
        const payroll = Number(period.payrollTiyin);
        const rowWidth = (payroll / max) * 100;

        return (
          <div key={period.period} className="flex items-center gap-3">
            <span className="w-16 shrink-0 text-xs text-(--color-text-muted)">
              {formatPeriodShort(period.period)}
            </span>

            <div className="h-5 min-w-0 flex-1">
              {payroll > 0 ? (
                <div
                  className="flex h-full overflow-hidden rounded"
                  style={{ width: `${Math.max(rowWidth, 2)}%` }}
                  title={`${formatPeriod(period.period)}: ${formatTiyin(period.payrollTiyin)}`}
                >
                  {period.compositionUploaded ? (
                    <>
                      {categories.map((category) => {
                        const value = Number(period.byCategory[category]);
                        if (value <= 0) return null;
                        return (
                          <div
                            key={category}
                            title={`${CATEGORY_LABELS[category]}: ${formatTiyin(value)}`}
                            style={{
                              width: `${(value / payroll) * 100}%`,
                              backgroundColor: CATEGORY_COLORS[category],
                            }}
                          />
                        );
                      })}
                      {Number(period.unallocatedTiyin) > 0 && (
                        <div
                          title={`Tarkibi yuklanmagan: ${formatTiyin(period.unallocatedTiyin)}`}
                          style={{
                            width: `${(Number(period.unallocatedTiyin) / payroll) * 100}%`,
                            backgroundColor: UNALLOCATED_COLOR,
                          }}
                        />
                      )}
                    </>
                  ) : (
                    <div className="h-full w-full" style={{ backgroundColor: UNALLOCATED_COLOR }} />
                  )}
                </div>
              ) : (
                <span className="text-xs text-(--color-text-faint)">ish haqi yuklanmagan</span>
              )}
            </div>

            <span className="money w-28 shrink-0 text-right text-xs">
              {payroll > 0 ? formatTiyin(period.payrollTiyin) : '—'}
            </span>
          </div>
        );
      })}

      {/* Izoh */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2">
        {categories.map((category) => (
          <span key={category} className="inline-flex items-center gap-1.5 text-xs text-(--color-text-muted)">
            <span className="size-2 rounded-sm" style={{ backgroundColor: CATEGORY_COLORS[category] }} />
            {CATEGORY_LABELS[category]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-xs text-(--color-text-muted)">
          <span className="size-2 rounded-sm" style={{ backgroundColor: UNALLOCATED_COLOR }} />
          Tarkibi yuklanmagan
        </span>
      </div>
    </div>
  );
}

/** Bo'lim / hudud bo'yicha tuzilma */
function UnitsTable({ data }: { data: SalaryStructure }) {
  const present = new Set(data.totals.byCategory.map((c) => c.category));
  const categories = CATEGORY_ORDER.filter((c) => present.has(c));

  const share = (value: string, base: string): number | null => {
    const b = Number(base);
    return b > 0 ? (Number(value) / b) * 100 : null;
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Bo'limlar va hududlar bo'yicha"
        description="Guruh ulushlari — tarkib yuklangan oylardagi ish haqiga nisbatan"
      />

      <Table>
        <THead>
          <Tr>
            <Th className="min-w-[14rem]">Bo&apos;lim / hudud</Th>
            <Th align="center" className="w-20">
              Xodim
            </Th>
            <Th align="right" className="w-36">
              Rasmiy ish haqi
            </Th>
            {categories.map((category) => (
              <Th key={category} align="right" className="w-28 whitespace-nowrap normal-case">
                <span className="inline-flex items-center gap-1.5">
                  <span className="size-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[category] }} />
                  {CATEGORY_LABELS[category]}
                </span>
              </Th>
            ))}
            <Th align="right" className="w-36">
              Tarkibi yuklanmagan
            </Th>
          </Tr>
        </THead>

        <TBody>
          {data.units.map((unit) => (
            <Tr key={unit.key}>
              <Td>
                <span className="block truncate font-medium">{unit.label}</span>
                <span className="text-xs text-(--color-text-muted)">
                  {unit.kind === 'department' ? 'Markaz bo‘limi' : unit.kind === 'contract' ? 'Shartnoma' : 'Hudud'}
                </span>
              </Td>
              <Td align="center" className="money text-(--color-text-muted)">
                {unit.employees}
              </Td>
              <Td money>
                <Money tiyin={unit.payrollTiyin} />
              </Td>
              {categories.map((category) => {
                const value = unit.byCategory[category];
                const pct = share(value, unit.coveredPayrollTiyin);
                return (
                  <Td key={category} align="right" className="money">
                    {BigInt(value) === 0n ? (
                      <span className="text-(--color-text-faint)">&mdash;</span>
                    ) : (
                      <span
                        className={cn(
                          'text-sm',
                          category === 'PREMIYA' && 'font-medium text-(--color-income)',
                          category === 'JARIMA' && 'text-(--color-expense)',
                        )}
                        title={formatTiyin(value)}
                      >
                        {formatPercent(pct)}
                      </span>
                    )}
                  </Td>
                );
              })}
              <Td money>
                {BigInt(unit.unallocatedTiyin) === 0n ? (
                  <span className="text-(--color-text-faint)">&mdash;</span>
                ) : (
                  <Money tiyin={unit.unallocatedTiyin} className="text-(--color-text-muted)" />
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

function PeopleCard({
  title,
  description,
  people,
  tone,
  empty,
}: {
  title: string;
  description: string;
  people: StructurePerson[];
  tone: 'income' | 'expense';
  empty: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} description={description} />

      {people.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <div className="divide-y divide-(--color-line)">
          {people.map((person, index) => (
            <div key={person.pinfl} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="money w-6 shrink-0 text-center text-xs text-(--color-text-faint)">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{person.fullName}</span>
                <span className="text-xs text-(--color-text-muted)">{person.unitName}</span>
              </span>
              <span className="w-14 shrink-0 text-right text-xs text-(--color-text-muted)">
                {formatPercent(person.sharePercent)}
              </span>
              <span className="w-32 shrink-0 text-right">
                <Money tiyin={person.amountTiyin} tone={tone} className="font-medium" />
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
