'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { ExcelButton, MoneyCell, NameCell, ReportCard, RTable, SearchInput, STICKY_NAME, STICKY_NO, sum, TableNote, Td, Th, Tr } from '@/components/report/report';
import { EmptyNote, LoadingCard } from '@/components/report/report-extra-c';
import { ExpandBox, NEST_CELL, nestHead, NestedRow } from '@/components/report/nested';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { api, type ApiResponse } from '@/lib/api';
import { formatPeriod } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { Fragment, useMemo, useState } from 'react';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa › Xodimlar kesimida: birlik (Markaz bo'limi, viloyat, yo'nalish) › xodim › oy. Xarajat — ish haqi, ijtimoiy soliq,
// xizmat safari; daromad — birlikning shu oy daromadi xodimlarga ish haqi ulushiga qarab bo'lingani; natija = daromad −
// xarajat. Strelka bosilsa — tagida alohida panel (xodimlar, so'ng oylar).
// ═══════════════════════════════════════════════════════════

interface Sums {
  salaryTiyin: string;
  taxTiyin: string;
  safarTiyin: string;
  costTiyin: string;
  incomeTiyin: string;
  resultTiyin: string;
}
interface CutEmployee extends Sums {
  pinfl: string;
  fullName: string;
  position: string | null;
  months: { period: string; salaryTiyin: string; taxTiyin: string; safarTiyin: string; incomeTiyin: string }[];
}
interface CutUnit extends Sums {
  key: string;
  name: string;
  group: 'center' | 'region' | 'segment' | 'none';
  unitIncomeTiyin: string;
  unallocatedTiyin: string;
  headcount: number;
  employees: CutEmployee[];
}
interface EmployeesCut {
  from: string;
  to: string;
  months: string[];
  taxRate: number;
  units: CutUnit[];
  total: Sums & { headcount: number; unitIncomeTiyin: string; unallocatedTiyin: string };
  notes: string[];
}

const GROUP_LABEL: Record<CutUnit['group'], string> = { center: "Markaz bo'limlari", region: 'Hududlar', segment: "Yo'nalishlar", none: 'Joyi aniqlanmagan' };
const n = (x: string) => Number(x);

export function EmployeesCutView({ range }: { range: DateRange }) {
  const res = useAsync(() => api.get<ApiResponse<EmployeesCut>>('/structure/regions/employees-cut', { params: { from: range.from, to: range.to } }).then((r) => r.data), [range.from, range.to]);
  if (!res.data) return <LoadingCard label="Xodimlar kesimi tuzilmoqda" error={res.error} onRetry={res.reload} />;
  return <Body d={res.data} />;
}

/** Pul ustunlari: ish haqi, ijtimoiy soliq, safar, jami xarajat, daromad, natija */
function MoneyCells({ s, strong }: { s: Sums; strong?: boolean }) {
  return (
    <>
      <MoneyCell value={n(s.salaryTiyin)} />
      <MoneyCell value={n(s.taxTiyin)} className="text-(--color-text-muted)" />
      <MoneyCell value={n(s.safarTiyin)} className="text-(--color-text-muted)" />
      <MoneyCell value={n(s.costTiyin)} strong={strong} className="text-(--color-expense)" />
      <MoneyCell value={n(s.incomeTiyin)} strong={strong} className="text-(--color-income)" />
      <MoneyCell value={n(s.resultTiyin)} strong signedColor />
    </>
  );
}

function MoneyHead({ head }: { head: string }) {
  return (
    <>
      <th className={head}>Ish haqi</th>
      <th className={head}>Ijtimoiy soliq</th>
      <th className={head}>Safar</th>
      <th className={head}>Jami xarajat</th>
      <th className={head} title="Birlik daromadi — ish haqi ulushiga qarab">
        Daromad (ulushi)
      </th>
      <th className={head}>Natija</th>
    </>
  );
}

function Body({ d }: { d: EmployeesCut }) {
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpened((o) => {
      const x = new Set(o);
      if (x.has(key)) x.delete(key);
      else x.add(key);
      return x;
    });

  const q = query.trim().toLowerCase();
  /** Qidiruv: birlik nomi yoki xodim (ism, JShShIR) — mos xodimlar qoladi */
  const units = useMemo(
    () =>
      d.units
        .map((u) => (!q || u.name.toLowerCase().includes(q) ? u : { ...u, employees: u.employees.filter((e) => e.fullName.toLowerCase().includes(q) || e.pinfl.includes(q)) }))
        .filter((u) => !q || u.name.toLowerCase().includes(q) || u.employees.length > 0),
    [d.units, q],
  );

  const exportCsv = () =>
    downloadCsv(
      `xodimlar-kesimi_${d.from}_${d.to}`,
      ['Birlik', 'Xodim', 'JShShIR', 'Lavozim', "Ish haqi, so'm", `Ijtimoiy soliq ${d.taxRate}%, so'm`, "Safar, so'm", "Jami xarajat, so'm", "Daromad (ulushi), so'm", "Natija, so'm"],
      units.flatMap((u) => u.employees.map((e) => [u.name, e.fullName, e.pinfl, e.position ?? '', csvSom(e.salaryTiyin), csvSom(e.taxTiyin), csvSom(e.safarTiyin), csvSom(e.costTiyin), csvSom(e.incomeTiyin), csvSom(e.resultTiyin)])),
    );

  const COLS = 10;
  return (
    <ReportCard
      title="Xodimlar kesimida: xarajat va daromad"
      badge={`${formatPeriod(d.from)} — ${formatPeriod(d.to)} · ${d.total.headcount} xodim`}
      actions={
        <>
          <SearchInput value={query} onChange={setQuery} placeholder="Birlik, xodim yoki JShShIR…" />
          <ExcelButton onClick={exportCsv} />
        </>
      }
    >
      {units.length ? (
        <RTable minWidth={1180}>
          <thead>
            <tr>
              <Th className={cn(STICKY_NO, 'z-[2]')}>№</Th>
              <Th className={cn(STICKY_NAME, 'z-[2] min-w-64 text-left')}>Birlik</Th>
              <Th>Xodim</Th>
              <Th>Ish haqi</Th>
              <Th>Ijtimoiy soliq</Th>
              <Th>Safar</Th>
              <Th>Jami xarajat</Th>
              <Th title="Birlik daromadi — ish haqi ulushiga qarab">Daromad (ulushi)</Th>
              <Th>Natija</Th>
            </tr>
          </thead>
          <tbody>
            <Tr total>
              <Td className={STICKY_NO} />
              <NameCell sub={`daromad: birliklar ${sum(n(d.total.unitIncomeTiyin))}${n(d.total.unallocatedTiyin) ? ` · xodimga bo'linmagan ${sum(n(d.total.unallocatedTiyin))}` : ''}`}>Jami</NameCell>
              <Td>{d.total.headcount}</Td>
              <MoneyCells s={d.total} strong />
            </Tr>
            {units.map((u, i) => {
              const isOpen = opened.has(u.key) || q !== '';
              /** Guruh (Markaz bo'limlari, Hududlar …) birinchi qatori oldidan — sarlavha */
              const header = i === 0 || units[i - 1]!.group !== u.group;
              return (
                <Fragment key={u.key}>
                  {header && (
                    <tr className="bg-[#f1f5fe]">
                      <td colSpan={COLS} className="sticky left-0 border-b border-(--color-line) px-4 py-1.5 text-[11px] font-bold uppercase tracking-wide text-brand-700">
                        {GROUP_LABEL[u.group]}
                      </td>
                    </tr>
                  )}
                  <Tr onClick={() => toggle(u.key)} className={cn(isOpen && 'bg-brand-50')}>
                    <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{i + 1}</Td>
                    <NameCell
                      before={<ExpandBox open={isOpen} hidden={!u.employees.length} onClick={() => toggle(u.key)} />}
                      sub={n(u.unallocatedTiyin) ? `birlik daromadi ${sum(n(u.unitIncomeTiyin))} · xodimga bo'linmagan ${sum(n(u.unallocatedTiyin))}` : undefined}
                      className="font-semibold text-heading"
                    >
                      {u.name}
                    </NameCell>
                    <Td>{u.headcount}</Td>
                    <MoneyCells s={u} />
                  </Tr>
                  {isOpen && u.employees.length > 0 && (
                    <NestedRow colSpan={COLS} level={1}>
                      <EmployeesTable unit={u} months={d.months} opened={opened} toggle={toggle} />
                    </NestedRow>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </RTable>
      ) : (
        <EmptyNote>{q ? 'Qidiruvga mos birlik yoki xodim yo‘q' : "Bu davrda xodim yo'q"}</EmptyNote>
      )}
      <TableNote>
        Xarajat — ish haqi (Bosh sahifadagi bilan bir xil), ijtimoiy soliq {d.taxRate}% (ish haqidan) va xizmat safari (23106, xodim bo‘yicha). Daromad — birlikning shu oy daromadi shu oy ish haqi olgan xodimlariga ish haqi ulushiga qarab bo‘lingan (birlik jami o‘zgarmaydi). Natija = daromad − xarajat. Strelka — xodimlar, xodimda — oylar.
        {d.notes.map((x) => (
          <span key={x} className="mt-1 block">
            • {x}
          </span>
        ))}
      </TableNote>
    </ReportCard>
  );
}

function EmployeesTable({ unit, months, opened, toggle }: { unit: CutUnit; months: string[]; opened: Set<string>; toggle: (key: string) => void }) {
  const head = nestHead(1);
  const cols = 9;
  return (
    <table className="w-full border-separate border-spacing-0">
      <thead>
        <tr>
          <th className={cn(head, 'w-8')} />
          <th className={cn(head, 'w-9')}>№</th>
          <th className={cn(head, 'text-left')}>Xodim</th>
          <MoneyHead head={cn(head, 'text-right')} />
        </tr>
      </thead>
      <tbody>
        {unit.employees.map((e, i) => {
          const key = `${unit.key}|${e.pinfl}`;
          const isOpen = opened.has(key);
          return (
            <Fragment key={e.pinfl}>
              <tr onClick={() => toggle(key)} className={cn('cursor-pointer hover:bg-brand-50', isOpen ? 'bg-brand-50/60' : i % 2 ? 'bg-[#fafbfe]' : 'bg-white')}>
                <td className={cn(NEST_CELL, 'text-center')}>
                  <ExpandBox open={isOpen} onClick={() => toggle(key)} />
                </td>
                <td className={cn(NEST_CELL, 'text-center text-(--color-text-faint)')}>{i + 1}</td>
                <td className={cn(NEST_CELL, 'min-w-56 text-left')}>
                  <span className={cn('block text-heading', isOpen && 'font-semibold')}>{e.fullName}</span>
                  {e.position && <span className="block truncate text-[10.5px] text-(--color-text-faint)">{e.position}</span>}
                </td>
                <NestMoney s={e} />
              </tr>
              {isOpen && (
                <NestedRow colSpan={cols} level={2}>
                  <MonthsTable e={e} months={months} />
                </NestedRow>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

function NestMoney({ s }: { s: Sums }) {
  const cell = cn(NEST_CELL, 'text-right whitespace-nowrap');
  const result = n(s.resultTiyin);
  return (
    <>
      <td className={cell}>{sum(n(s.salaryTiyin))}</td>
      <td className={cn(cell, 'text-(--color-text-muted)')}>{sum(n(s.taxTiyin))}</td>
      <td className={cn(cell, 'text-(--color-text-muted)')}>{n(s.safarTiyin) ? sum(n(s.safarTiyin)) : '—'}</td>
      <td className={cn(cell, 'font-semibold text-(--color-expense)')}>{sum(n(s.costTiyin))}</td>
      <td className={cn(cell, 'text-(--color-income)')}>{n(s.incomeTiyin) ? sum(n(s.incomeTiyin)) : '—'}</td>
      <td className={cn(cell, 'font-semibold', result >= 0 ? 'text-(--color-income)' : 'text-(--color-expense)')}>{sum(result)}</td>
    </>
  );
}

function MonthsTable({ e, months }: { e: CutEmployee; months: string[] }) {
  const head = nestHead(2);
  const rows = e.months.filter((m) => n(m.salaryTiyin) || n(m.safarTiyin) || n(m.incomeTiyin));
  return (
    <table className="w-full border-separate border-spacing-0">
      <thead>
        <tr>
          <th className={cn(head, 'w-9')}>№</th>
          <th className={cn(head, 'text-left')}>Oy</th>
          <MoneyHead head={cn(head, 'text-right')} />
        </tr>
      </thead>
      <tbody>
        {rows.map((m, i) => {
          const cost = n(m.salaryTiyin) + n(m.taxTiyin) + n(m.safarTiyin);
          const s: Sums = { salaryTiyin: m.salaryTiyin, taxTiyin: m.taxTiyin, safarTiyin: m.safarTiyin, costTiyin: String(cost), incomeTiyin: m.incomeTiyin, resultTiyin: String(n(m.incomeTiyin) - cost) };
          return (
            <tr key={m.period} className={i % 2 ? 'bg-[#fafbfe]' : 'bg-white'}>
              <td className={cn(NEST_CELL, 'text-center text-(--color-text-faint)')}>{i + 1}</td>
              <td className={cn(NEST_CELL, 'text-left text-heading')}>{formatPeriod(m.period)}</td>
              <NestMoney s={s} />
            </tr>
          );
        })}
        {rows.length < months.length && (
          <tr>
            <td colSpan={8} className={cn(NEST_CELL, 'text-left text-[11px] text-(--color-text-faint)')}>
              Qolgan {months.length - rows.length} oyda bu birlikda ish haqi yo‘q
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
