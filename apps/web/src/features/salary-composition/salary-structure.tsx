'use client';

import { formatPercent, formatPeriod, formatTiyin } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { CalcValue } from '@/components/ui/calc';
import { calcDiff, calcShare, calcSum, Q, type Calc } from '@/lib/calc';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { Card } from '@/components/ui/card';
import { IconArrowRight } from '@/components/ui/icons';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { GroupTh, MoneyCell, NameCell, PillTabs, ReportCard, RTable, StatTiles, STICKY_NAME, STICKY_NO, TableNote, Td, Th, Tr } from '@/components/report/report';
import { EmptyNote, pctPlain, StatusBadge } from '@/components/report/report-extra-b';
import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_ORDER, type ComponentCategory } from './api';
import { fetchSalaryStructure, type SalaryStructure, type StructurePerson } from './structure-api';

interface Props {
  /** Sana oralig'i: "YYYY-MM-DD" — oylari olinadi */
  range: { from: string; to: string };
  /**
   * compact — faqat guruhlar (Xarajat tahlili sahifasi uchun),
   * aks holda to'liq: oylar, bo'limlar, premiya va jarimalar
   */
  compact?: boolean;
}

type View = 'groups' | 'months' | 'units' | 'people';

/**
 * Ish haqi tuzilmasi — rasmiy summa (soliq hisoboti) tarkib guruhlariga bo'linadi.
 * Tarkibi yuklanmagan qism alohida ko'rsatiladi, shuning uchun jami rasmiy summaga teng.
 * Hisobot ko'rinishi: kartalar, yorliqlar va jadvallar (grafiklarsiz).
 */
export function SalaryStructureCard({ range, compact = false }: Props) {
  const structure = useAsync(() => fetchSalaryStructure(range.from, range.to), [range.from, range.to]);
  const data = structure.data?.data;
  const periodText = `${formatPeriod(range.from.slice(0, 7))} — ${formatPeriod(range.to.slice(0, 7))}`;

  if (structure.loading && !data) {
    return (
      <ReportCard title="Ish haqi tuzilmasi" badge={periodText}>
        <LoadingState />
      </ReportCard>
    );
  }
  if (structure.error || !data) {
    return (
      <Card>
        <ErrorState message={structure.error ?? 'Ma’lumot yo‘q'} onRetry={structure.reload} />
      </Card>
    );
  }
  if (data.totals.coveredPeriods === 0) {
    return (
      <ReportCard title="Ish haqi tuzilmasi" badge={periodText}>
        <EmptyNote>
          Bu oraliqda ish haqi tarkibi yuklanmagan.{' '}
          <Link href="/xarajatlar/tarkib" className="font-semibold text-brand-700 hover:underline">
            Ish haqi tarkibi bo&rsquo;limiga o&rsquo;tish
          </Link>
        </EmptyNote>
      </ReportCard>
    );
  }
  if (compact) return <CompactView data={data} range={range} periodText={periodText} />;
  return <FullView data={data} periodText={periodText} />;
}

// ═══════════════════════════════════════════════════════════
// Ixcham ko'rinish (boshqa sahifalar uchun): faqat guruhlar jadvali
// ═══════════════════════════════════════════════════════════

function CompactView({ data, range, periodText }: { data: SalaryStructure; range: { from: string; to: string }; periodText: string }) {
  const href = `/tahlil/umumiy?${new URLSearchParams({ dateFrom: range.from, dateTo: range.to, tab: 'expenses' }).toString()}`;
  return (
    <ReportCard
      title="Ish haqi tuzilmasi"
      badge={`${periodText} · ${coverageText(data)}`}
      actions={
        <Link href={href} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline">
          Batafsil
          <IconArrowRight className="size-3.5" />
        </Link>
      }
    >
      <GroupsTable data={data} />
    </ReportCard>
  );
}

// ═══════════════════════════════════════════════════════════
// To'liq ko'rinish
// ═══════════════════════════════════════════════════════════

function FullView({ data, periodText }: { data: SalaryStructure; periodText: string }) {
  const [view, setView] = useState<View>('groups');
  const { totals } = data;
  const bonus = totals.byCategory.find((c) => c.category === 'PREMIYA');
  const unallocated = Number(totals.unallocatedTiyin);

  return (
    <div className="space-y-4">
      <StatTiles
        items={[
          {
            label: 'Rasmiy ish haqi',
            value: Number(totals.payrollTiyin),
            tone: 'blue',
            note: periodText,
            calc: calcSum('Rasmiy ish haqi', data.periods.map((p) => Q.money(formatPeriod(p.period), p.payrollTiyin, 'Ish haqi qaydnomasi (soliq hisoboti)'))),
          },
          {
            label: 'Tarkibda taqsimlangan',
            value: Number(totals.compositionTiyin),
            tone: 'green',
            note: coverageText(data),
            calc: calcSum('Tarkibda taqsimlangan', totals.byCategory.map((c) => Q.money(c.label, c.totalTiyin, 'Ish haqi tarkibi fayli')), {
              note: `Qamrov = ${formatTiyin(totals.compositionTiyin)} ÷ ${formatTiyin(totals.payrollTiyin)} × 100 = ${formatPercent(totals.coveragePercent)}`,
            }),
          },
          {
            label: 'Premiyalar ulushi',
            value: 0,
            text: formatPercent(bonus?.sharePercent ?? null),
            tone: 'purple',
            note: bonus ? `${formatTiyin(bonus.totalTiyin)}` : 'Premiya yo‘q',
            calc: bonus
              ? calcShare('Premiyalar ulushi', Q.money('Premiyalar', bonus.totalTiyin), Q.money('Tarkib yuklangan oylardagi ish haqi', totals.coveredPayrollTiyin), {
                  note: 'Ulush faqat tarkibi yuklangan oylar ish haqiga nisbatan olinadi — yuklanmagan oylar ulushni kamaytirib yubormasligi uchun.',
                })
              : null,
          },
          {
            label: 'Tarkibi yuklanmagan',
            value: unallocated,
            tone: unallocated === 0 ? 'cyan' : 'orange',
            note: unallocated === 0 ? 'Hammasi taqsimlangan' : 'Soliq hisobotidagi, tarkibda yo‘q summa',
            calc: calcDiff('Tarkibi yuklanmagan', Q.money('Rasmiy ish haqi', totals.payrollTiyin), Q.money('Tarkibda taqsimlangan', totals.compositionTiyin)),
          },
        ]}
      />

      <PillTabs
        value={view}
        onChange={setView}
        options={[
          { value: 'groups', label: 'Guruhlar bo‘yicha', hint: 'Asosiy ish haqi, premiya, ta’til … — bosib tarkibiy qismlarini oching' },
          { value: 'months', label: 'Oylar bo‘yicha', hint: 'Har oy ish haqi qanday tarkibdan iborat' },
          { value: 'units', label: 'Bo‘limlar va hududlar', hint: 'Har bo‘lim ish haqi tuzilmasi' },
          { value: 'people', label: 'Premiya va jarimalar', hint: 'Eng katta premiya va jarimalar' },
        ]}
      />

      {view === 'groups' && (
        <ReportCard title="Ish haqi — guruhlar bo'yicha" badge={`${periodText} · ${coverageText(data)}`}>
          <GroupsTable data={data} />
          <TableNote>Ulushi — tarkib yuklangan oylardagi rasmiy ish haqiga nisbatan. Guruh nomini bosing — tarkibiy qismlari ochiladi.</TableNote>
        </ReportCard>
      )}
      {view === 'months' && (
        <ReportCard title="Ish haqi — oylar bo'yicha" badge={periodText}>
          <MonthsTable data={data} />
        </ReportCard>
      )}
      {view === 'units' && (
        <ReportCard title="Bo'limlar va hududlar bo'yicha" badge="guruh ulushlari — tarkib yuklangan oylardagi ish haqiga nisbatan">
          <UnitsTable data={data} />
        </ReportCard>
      )}
      {view === 'people' && (
        <div className="grid gap-4 2xl:grid-cols-2">
          <PeopleCard title="Eng katta premiyalar" people={data.topBonus} what="Premiya" empty="Premiya yo'q" />
          <PeopleCard title="Eng katta jarimalar" people={data.topPenalty} what="Jarima" empty="Jarima yo'q" />
        </div>
      )}
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

function Dot({ category }: { category: ComponentCategory }) {
  return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[category] }} />;
}

/** Guruhlar jadvali — bosilsa tarkibiy qismlari ochiladi */
function GroupsTable({ data }: { data: SalaryStructure }) {
  const [open, setOpen] = useState<ComponentCategory | null>(null);
  const covered = data.totals.coveredPayrollTiyin;
  return (
    <RTable minWidth={760}>
      <thead>
        <tr>
          <Th className="w-12">№</Th>
          <Th className="min-w-64 text-left">Guruh</Th>
          <Th>Xodimlar</Th>
          <Th>Summa, so&apos;m</Th>
          <Th>Ulushi</Th>
        </tr>
      </thead>
      <tbody>
        <Tr total>
          <Td />
          <NameCell sticky={false}>Rasmiy ish haqi — jami</NameCell>
          <Td />
          <MoneyCell value={Number(data.totals.payrollTiyin)} />
          <Td>100%</Td>
        </Tr>
        {data.totals.byCategory.map((category, i) => {
          const expanded = open === category.category;
          const items = data.byComponent.filter((c) => c.category === category.category);
          return (
            <Fragment key={category.category}>
              <Tr onClick={() => setOpen(expanded ? null : category.category)}>
                <Td className="text-(--color-text-faint)">{i + 1}</Td>
                <NameCell sticky={false} before={<Dot category={category.category} />} sub={`${items.length} ta tarkibiy qism`}>
                  <span className="font-medium text-heading">
                    {category.label} <span className="text-(--color-text-faint)">{expanded ? '▾' : '▸'}</span>
                  </span>
                </NameCell>
                <Td />
                <MoneyCell value={Number(category.totalTiyin)} strong signedColor={Number(category.totalTiyin) < 0} />
                <Td>
                  <CalcValue
                    calc={calcShare(`${category.label}: ulush`, Q.money(category.label, category.totalTiyin), Q.money('Tarkib yuklangan oylardagi ish haqi', covered))}
                    className="no-underline"
                  >
                    {formatPercent(category.sharePercent)}
                  </CalcValue>
                </Td>
              </Tr>
              {expanded &&
                items.map((item) => (
                  <Tr key={item.code} muted>
                    <Td />
                    <NameCell sticky={false} className="pl-10">
                      <span className="text-(--color-text-muted)">{item.name}</span>
                    </NameCell>
                    <Td className="text-(--color-text-muted)">{item.employees}</Td>
                    <MoneyCell value={Number(item.totalTiyin)} signedColor={item.sign < 0} />
                    <Td className="text-(--color-text-muted)">{Number(covered) > 0 ? pctPlain((Number(item.totalTiyin) / Number(covered)) * 100) : ''}</Td>
                  </Tr>
                ))}
            </Fragment>
          );
        })}
        {Number(data.totals.unallocatedTiyin) !== 0 && (
          <Tr muted>
            <Td />
            <NameCell sticky={false} sub="soliq hisobotidagi, tarkibda yo'q summa">
              Tarkibi yuklanmagan / farq
            </NameCell>
            <Td />
            <MoneyCell value={Number(data.totals.unallocatedTiyin)} className="text-(--color-text-muted)" />
            <Td />
          </Tr>
        )}
      </tbody>
    </RTable>
  );
}

/** Oylar: rasmiy summa va guruhlar */
function MonthsTable({ data }: { data: SalaryStructure }) {
  const present = new Set(data.totals.byCategory.map((c) => c.category));
  const categories = CATEGORY_ORDER.filter((c) => present.has(c));
  return (
    <RTable minWidth={420 + categories.length * 120}>
      <thead>
        <tr>
          <Th rowSpan={2} className="w-32 text-left">Oy</Th>
          <Th rowSpan={2}>Rasmiy ish haqi</Th>
          <GroupTh span={categories.length}>Tarkib guruhlari</GroupTh>
          <Th rowSpan={2}>Tarkibi yuklanmagan</Th>
          <Th rowSpan={2}>Holat</Th>
        </tr>
        <tr>
          {categories.map((c, i) => (
            <Th key={c} className={cn('whitespace-nowrap', i === 0 && 'first:border-l')}>
              <span className="inline-flex items-center gap-1.5">
                <Dot category={c} />
                {CATEGORY_LABELS[c]}
              </span>
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        <Tr total>
          <Td className="text-left">Jami</Td>
          <MoneyCell value={Number(data.totals.payrollTiyin)} />
          {categories.map((c) => (
            <MoneyCell key={c} value={Number(data.totals.byCategory.find((x) => x.category === c)?.totalTiyin ?? 0)} />
          ))}
          <MoneyCell value={Number(data.totals.unallocatedTiyin)} />
          <Td />
        </Tr>
        {data.periods.map((p) => (
          <Tr key={p.period}>
            <Td className="whitespace-nowrap text-left">{formatPeriod(p.period)}</Td>
            {p.payrollUploaded ? <MoneyCell value={Number(p.payrollTiyin)} strong /> : <Td className="text-(--color-text-faint)"></Td>}
            {categories.map((c) =>
              p.compositionUploaded && Number(p.byCategory[c]) !== 0 ? (
                <MoneyCell key={c} value={Number(p.byCategory[c])} signedColor={c === 'JARIMA'} />
              ) : (
                <Td key={c} className="text-(--color-text-faint)">
                  —
                </Td>
              ),
            )}
            {Number(p.unallocatedTiyin) !== 0 ? <MoneyCell value={Number(p.unallocatedTiyin)} className="text-(--color-text-muted)" /> : <Td className="text-(--color-text-faint)"></Td>}
            <Td>
              {!p.payrollUploaded ? (
                <StatusBadge tone="muted">ish haqi yuklanmagan</StatusBadge>
              ) : p.compositionUploaded ? (
                <StatusBadge tone="green">tarkib bor</StatusBadge>
              ) : (
                <StatusBadge tone="amber">tarkib yo‘q</StatusBadge>
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </RTable>
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
    <RTable minWidth={560 + categories.length * 100}>
      <thead>
        <tr>
          <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>№</Th>
          <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>Bo&apos;lim / hudud</Th>
          <Th rowSpan={2}>Xodim</Th>
          <Th rowSpan={2}>Rasmiy ish haqi</Th>
          <GroupTh span={categories.length}>Guruh ulushlari</GroupTh>
          <Th rowSpan={2}>Tarkibi yuklanmagan</Th>
        </tr>
        <tr>
          {categories.map((c, i) => (
            <Th key={c} className={cn('whitespace-nowrap', i === 0 && 'first:border-l')}>
              {CATEGORY_LABELS[c]}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.units.map((unit, i) => (
          <Tr key={unit.key}>
            <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
            <NameCell sub={unit.kind === 'department' ? 'Markaz bo‘limi' : unit.kind === 'contract' ? 'Shartnoma' : 'Hudud'}>{unit.label}</NameCell>
            <Td className="text-(--color-text-muted)">{unit.employees}</Td>
            <MoneyCell value={Number(unit.payrollTiyin)} strong />
            {categories.map((category) => {
              const value = unit.byCategory[category];
              const p = share(value, unit.coveredPayrollTiyin);
              return (
                <Td key={category} className={cn(category === 'PREMIYA' && 'font-semibold text-(--color-income)', category === 'JARIMA' && 'text-(--color-expense)')}>
                  {Number(value) === 0 ? (
                    <span className="text-(--color-text-faint)"></span>
                  ) : (
                    <CalcValue
                      calc={calcShare(`${CATEGORY_LABELS[category]}: ulush`, Q.money(CATEGORY_LABELS[category], value), Q.money('Tarkib yuklangan oylardagi ish haqi', unit.coveredPayrollTiyin))}
                      className="no-underline"
                    >
                      <span title={formatTiyin(value)}>{formatPercent(p)}</span>
                    </CalcValue>
                  )}
                </Td>
              );
            })}
            {Number(unit.unallocatedTiyin) === 0 ? <Td className="text-(--color-text-faint)"></Td> : <MoneyCell value={Number(unit.unallocatedTiyin)} className="text-(--color-text-muted)" />}
          </Tr>
        ))}
      </tbody>
    </RTable>
  );
}

function PeopleCard({ title, people, what, empty }: { title: string; people: StructurePerson[]; /** "Premiya" yoki "Jarima" */ what: string; empty: string }) {
  // «Qanday hisoblandi?»: summa — oylar yig'indisi; ulush — summa ÷ xodim ish haqi × 100
  const sumCalc = (p: StructurePerson): Calc =>
    calcSum(`${p.fullName}: ${what.toLowerCase()}`, p.months.map((m) => Q.money(formatPeriod(m.period), m.amountTiyin, 'Ish haqi tarkibi')), {
      note: `${p.unitName}. Faqat tarkib yuklangan oylar.`,
    });
  const shareCalc = (p: StructurePerson): Calc =>
    calcShare(`${p.fullName}: ${what.toLowerCase()} ulushi`, Q.money(what, p.amountTiyin, 'Ish haqi tarkibi'), Q.money('Xodimning ish haqi (tarkib yuklangan oylarda)', p.payrollTiyin, 'Ish haqi qaydnomasi'));
  return (
    <ReportCard title={title} badge="oraliq bo'yicha jami · ulushi — xodim ish haqida">
      {people.length === 0 ? (
        <EmptyNote>{empty}</EmptyNote>
      ) : (
        <RTable minWidth={620}>
          <thead>
            <tr>
              <Th className="w-12">№</Th>
              <Th className="text-left">Xodim</Th>
              <Th>{what}, so&apos;m</Th>
              <Th>Ulushi</Th>
            </tr>
          </thead>
          <tbody>
            {people.map((person, index) => (
              <Tr key={person.pinfl}>
                <Td className="text-(--color-text-faint)">{index + 1}</Td>
                <NameCell sticky={false} sub={person.unitName}>
                  {person.fullName}
                </NameCell>
                <MoneyCell value={Number(person.amountTiyin)} calc={sumCalc(person)} strong className={what === 'Jarima' ? 'text-(--color-expense)' : 'text-(--color-income)'} />
                <Td>
                  <CalcValue calc={shareCalc(person)} className="no-underline">
                    {formatPercent(person.sharePercent)}
                  </CalcValue>
                </Td>
              </Tr>
            ))}
          </tbody>
        </RTable>
      )}
    </ReportCard>
  );
}
