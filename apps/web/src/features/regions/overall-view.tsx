'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import {
  changeOf,
  ExcelButton,
  GroupTh,
  MoneyCell,
  NameCell,
  PctBadge,
  PctCell,
  PillTabs,
  ToggleAllButton,
  SearchInput,
  ReportCard,
  RTable,
  StatTiles,
  STICKY_NAME,
  STICKY_NO,
  TableNote,
  Td,
  Th,
  Tr,
  type StatTile,
} from '@/components/report/report';
import { count, LoadingCard } from '@/components/report/report-extra-c';
import { type CompareMode, type SectionFilter } from '@/features/structure/api';
import { csvPct, csvSom, downloadCsv } from '@/features/structure/stats';
import { calcResult, calcSum, moneyText, Q } from '@/lib/calc';
import { formatDate } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn, cap } from '@/lib/utils';
import { unitByCode } from '@/lib/segments';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useMemo, useState } from 'react';
import { KIND_LABEL, regionsApi, statsOf, type RegionsResult, type RegionUnit, type UnitStats } from './api';
import { UnassignedDrawer } from './unassigned-drawer';
import { MonthsTable } from './overall-tables';
import { UnitTree } from './overall-tree';
import { BridgeTree } from './bridge-tree';
import { DrillProvider } from '@/features/explore/drill';
import Link from 'next/link';
import { Fragment } from 'react';

// ═══════════════════════════════════════════════════════════
// Solishtirma › Umumiy — butun korxona bitta ekranda (grafiklarsiz):
//   • tepada kartalar: korxona daromadi, xarajati, natijasi, hududlar natijasi, Markazni qoplash;
//   • yorliqlar: natija jadvali (o'tgan davr bilan, qator joyida kengayadi), oylar kesimida,
//     natija qanday shakllanadi (bo'lim-bo'lim, ichma-ich: Hudud → xizmat turlari → viloyatlar …).
// ═══════════════════════════════════════════════════════════

/** Markaz rangi — butun sahifada bir xil */
export const CENTER_COLOR = '#6b5bb5';

type Group = 'PAYROLL' | 'LEASE' | 'VEHICLE' | 'ASSET' | 'REGIONAL' | 'OTHER';
const GROUPS: { key: Group; label: string; short: string }[] = [
  { key: 'PAYROLL', label: 'Ish haqi', short: 'Ish haqi' },
  { key: 'LEASE', label: 'Ijara', short: 'Ijara' },
  { key: 'VEHICLE', label: 'Mashinalar', short: 'Mashinalar' },
  { key: 'ASSET', label: 'Asosiy vositalar', short: 'Asosiy vositalar' },
  { key: 'REGIONAL', label: "Hududlar uchun (Markaz to'lagan)", short: 'Hududlar uchun' },
  { key: 'OTHER', label: 'Boshqa xarajatlar', short: 'Boshqa' },
];

function groupOf(key: string): Group {
  if (key === 'PAYROLL' || key === 'LEASE' || key === 'VEHICLE') return key;
  if (key === 'ASSET' || key === 'ASSET_X') return 'ASSET';
  if (key.startsWith('h:')) return 'REGIONAL';
  return 'OTHER';
}

type Mix = Record<Group, number>;
const emptyMix = (): Mix => ({ PAYROLL: 0, LEASE: 0, VEHICLE: 0, ASSET: 0, REGIONAL: 0, OTHER: 0 });

/** Xarajat tarkibi guruhlar bo'yicha; tarkib yo'q bo'lsa — hammasi «Boshqa» (ish haqi alohida ma'lum bo'lsa — u) */
function mixOf(unit: RegionUnit): Mix {
  const mix = emptyMix();
  let total = 0;
  for (const p of unit.expenseParts) {
    const v = Number(p.amountTiyin);
    mix[groupOf(p.key)] += v;
    total += v;
  }
  const expense = Number(unit.expenseTiyin);
  if (total === 0 && expense !== 0) {
    const payroll = Math.min(Number(unit.payrollTiyin), expense);
    mix.PAYROLL = payroll;
    mix.OTHER = expense - payroll;
  } else if (Math.abs(expense - total) >= 100) {
    mix.OTHER += expense - total;
  }
  return mix;
}


function add(rows: UnitStats[], pick: (s: UnitStats) => number): number {
  return rows.reduce((a, s) => a + pick(s), 0);
}

interface Totals {
  income: number;
  expense: number;
  previousIncome: number;
  previousExpense: number;
  headcount: number;
}

function totalsOf(rows: UnitStats[]): Totals {
  return {
    income: add(rows, (s) => s.income),
    expense: add(rows, (s) => s.expense),
    previousIncome: add(rows, (s) => s.previousIncome),
    previousExpense: add(rows, (s) => s.previousExpense),
    headcount: rows.reduce((a, s) => a + s.unit.headcount, 0),
  };
}

/** Birlikning alohida Solishtirma sahifasi */
function pageOf(s: UnitStats): string {
  if (s.unit.kind === 'center') return '/solishtirma/markaz';
  if (s.unit.kind === 'region' && s.unit.code !== null) return `/solishtirma?r=${s.unit.code}`;
  if (s.unit.kind === 'segment' && s.unit.segment && unitByCode(s.unit.segment)) return `/solishtirma/${unitByCode(s.unit.segment)!.slug}`;
  return '/solishtirma';
}

function subOf(s: UnitStats): string {
  if (s.unit.kind === 'center') return "Markaz · bo'limlar";
  if (s.unit.kind === 'unassigned') return "hududi ko'rsatilmagan";
  if (s.unit.kind === 'segment') return "yo'nalish";
  return s.unit.headcount ? `Hudud · ${Math.round(s.unit.headcount)} xodim` : 'Hudud';
}

// ═══════════════════════════════════════════════════════════
// Asosiy komponent
// ═══════════════════════════════════════════════════════════

type View = 'result' | 'months' | 'bridge';

const REGIONS_KEY = '__regions';

export function OverallView({ range }: { range: DateRange }) {
  // Doim: barcha yozuvlar, o'tgan teng davr bilan («Yozuvlar» / «Solishtirish» tanlovlari olib tashlangan)
  const section: SectionFilter = 'ALL';
  const compare: CompareMode = 'prev';
  const result = useAsync(() => regionsApi.compare(range, section, compare).then((r) => r.data), [range.from, range.to, section, compare]);
  const data = result.data;

  if (!data) return <LoadingCard label="Korxona bo'yicha hisoblanmoqda" error={result.error} onRetry={result.reload} />;
  return (
    <DrillProvider range={{ from: data.range.from, to: data.range.to }}>
      <Body data={data} loading={result.loading} />
    </DrillProvider>
  );
}

function Body({ data, loading }: { data: RegionsResult; loading: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<View>('result');
  /** Natija jadvalida birlik qidirish */
  const [query, setQuery] = useState('');
  const [unOpen, setUnOpen] = useState(false);
  /** Natija jadvalida ochilgan birliklar — qator joyida kengayadi */
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpened((o) => {
      const x = new Set(o);
      if (x.has(key)) x.delete(key);
      else x.add(key);
      return x;
    });

  const all = useMemo(() => data.units.map(statsOf), [data]);
  const center = all.find((s) => s.unit.kind === 'center') ?? null;
  const unassigned = all.find((s) => s.unit.kind === 'unassigned' && (s.income !== 0 || s.expense !== 0)) ?? null;
  const regions = all.filter((s) => s.unit.kind === 'region');
  const activeRegions = regions.filter((s) => s.income !== 0 || s.expense !== 0);
  const segments = all.filter((s) => s.unit.kind === 'segment' && (s.income !== 0 || s.expense !== 0));
  const units = [...(center ? [center] : []), ...activeRegions, ...segments, ...(unassigned ? [unassigned] : [])];

  const total = totalsOf(units);
  const reg = totalsOf(activeRegions);
  const profit = total.income - total.expense;
  const previousProfit = total.previousIncome - total.previousExpense;
  const regProfit = reg.income - reg.expense;
  const centerNet = center ? center.expense - center.income : 0;
  const coverage = centerNet > 0 ? (regProfit / centerNet) * 100 : null;
  const label = cap(data.compareLabel);

  const q = query.trim().toLowerCase();
  const match = (x: UnitStats) => !q || x.unit.name.toLowerCase().includes(q);
  const shownRegions = activeRegions.filter(match);
  /** «Hudud» guruhi: bosilganda yoki qidiruv viloyatga mos kelganda ochiq */
  const regionsOpen = opened.has(REGIONS_KEY) || (q !== '' && shownRegions.length > 0);
  /** Birlik qatori (bosilsa — joyida ichma-ich daraxt); depth 1 — «Hudud» ichidagi viloyat */
  const unitRow = (s: UnitStats, depth: number) => {
    const isOpen = opened.has(s.unit.key);
    const index = s.unit.kind === 'region' ? activeRegions.indexOf(s) + 1 : null;
    return (
    <Fragment key={s.unit.key}>
      <Tr onClick={() => toggle(s.unit.key)} className={cn(isOpen && 'bg-brand-50')}>
        <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{index ?? ''}</Td>
        <NameCell
          before={<span className={cn('inline-block w-3 text-xs text-(--color-text-faint) transition-transform', isOpen && 'rotate-90')} style={{ marginLeft: depth * 18 }}>▸</span>}
          sub={subOf(s)}
          className="max-w-64 font-semibold text-heading"
        >
          <span id={`unit-${s.unit.key}`} className="scroll-mt-24">
            {s.unit.name}
          </span>
        </NameCell>
        <ResultCells s={s} title={s.unit.name} compareLabel={label} center={s.unit.kind === 'center'} />
      </Tr>
      {isOpen && (
        <tr>
          <td colSpan={10} className="border-b border-(--color-line) bg-[#f8f9fc] p-0">
            <div className="sticky left-0 max-w-[calc(100vw-8rem)] px-4 py-3">
              <UnitTree s={s} range={data.range} section={data.section} compare={data.compare} fmt="full" />
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-(--color-text-muted)">
                <span>
                  Yozuvlar: daromad <b className="text-heading">{s.unit.incomeCount}</b> ta, xarajat <b className="text-heading">{s.unit.expenseCount}</b> ta
                </span>
                {s.activeMonths > 0 && (
                  <span>
                    Oxirgi 12 oyda zararli oylar: <b className={s.lossMonths ? 'text-(--color-expense)' : 'text-heading'}>{s.lossMonths}</b> / {s.activeMonths}
                  </span>
                )}
                {s.unit.kind === 'unassigned' ? (
                  <button type="button" onClick={() => setUnOpen(true)} className="ml-auto font-semibold text-brand-700 hover:underline">
                    Yozuvlarni ochish ↗
                  </button>
                ) : (
                  <Link href={pageOf(s)} className="ml-auto font-semibold text-brand-700 hover:underline">
                    Alohida sahifada ochish ↗
                  </Link>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
    );
  };

  /** Boshqa yorliqdan birlikni bosish — natija jadvalida ochib, unga o'tish */
  const open = (s: UnitStats) => {
    setView('result');
    setOpened((o) => {
      const x = new Set(o).add(s.unit.key);
      if (s.unit.kind === 'region') x.add(REGIONS_KEY);
      return x;
    });
    setTimeout(() => document.getElementById(`unit-${s.unit.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  const exportCsv = () => {
    const mixHead = GROUPS.map((g) => `${g.label}, so'm`);
    downloadCsv(
      `umumiy_${data.range.from}_${data.range.to}`,
      ['Birlik', 'Turi', `Daromad: ${data.compareLabel}, so'm`, "Daromad: joriy, so'm", 'Daromad farqi, %', ...mixHead, `Xarajat: ${data.compareLabel}, so'm`, "Xarajat: joriy, so'm", 'Xarajat farqi, %', "Natija, so'm", 'Rentabellik, %', 'Xodimlar'],
      [
        ...units.map((s) => {
          const m = mixOf(s.unit);
          return [
            s.unit.name,
            KIND_LABEL[s.unit.kind],
            csvSom(s.previousIncome),
            csvSom(s.income),
            csvPct(changeOf(s.income, s.previousIncome)),
            ...GROUPS.map((g) => csvSom(m[g.key])),
            csvSom(s.previousExpense),
            csvSom(s.expense),
            csvPct(changeOf(s.expense, s.previousExpense)),
            csvSom(s.profit),
            csvPct(s.margin),
            s.unit.headcount,
          ];
        }),
        ['Korxona jami', '', csvSom(total.previousIncome), csvSom(total.income), csvPct(changeOf(total.income, total.previousIncome)), ...GROUPS.map(() => ''), csvSom(total.previousExpense), csvSom(total.expense), csvPct(changeOf(total.expense, total.previousExpense)), csvSom(profit), csvPct(total.income > 0 ? (profit / total.income) * 100 : null), total.headcount],
        [],
        [`Davr: ${data.range.from} — ${data.range.to}; solishtirish: ${data.compareLabel} (${data.previousRange.from} — ${data.previousRange.to})`],
      ],
    );
  };

  const tiles: StatTile[] = [
    { label: 'Korxona daromadi', value: total.income, previous: total.previousIncome, tone: 'green', calc: calcSum('Korxona daromadi', units.map((s) => Q.money(s.unit.name, s.income))) },
    { label: 'Korxona xarajati', value: total.expense, previous: total.previousExpense, growthGood: false, tone: 'red', calc: calcSum('Korxona xarajati', units.map((s) => Q.money(s.unit.name, s.expense))) },
    { label: profit >= 0 ? 'Korxona natijasi (foyda)' : 'Korxona natijasi (zarar)', value: profit, previous: previousProfit, signed: true, tone: 'blue', calc: calcResult(total.income, total.expense, { title: 'Korxona natijasi' }) },
    { label: 'Hududlar natijasi', value: regProfit, previous: reg.previousIncome - reg.previousExpense, signed: true, tone: 'cyan', calc: calcResult(reg.income, reg.expense, { title: 'Hududlar natijasi' }) },
    {
      label: 'Markazni qoplash',
      value: 0,
      text: coverage === null ? '' : `${coverage.toFixed(1).replace('.', ',')}%`,
      note: centerNet > 0 ? `Markaz sof xarajati ${moneyText(centerNet)}` : "Markazning sof xarajati yo'q",
      tone: 'purple',
      // Markazni qoplash — Solishtirma › Hududlar sahifasida
      onClick: () => router.push('/solishtirma?m=cover'),
    },
  ];

  const views: { value: View; label: string }[] = [
    { value: 'result', label: 'Natija jadvali' },
    { value: 'months', label: 'Oylar kesimida' },
    { value: 'bridge', label: 'Natija qanday shakllanadi' },
  ];

  const period = `${formatDate(data.range.from)} — ${formatDate(data.range.to)}`;
  const previousPeriod = `${formatDate(data.previousRange.from)} — ${formatDate(data.previousRange.to)}`;

  return (
    <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}>
      <StatTiles items={tiles} compareLabel="Avval" />

      <PillTabs value={view} onChange={setView} options={views} />

      {view === 'result' && (
        <ReportCard
          title="Markaz, hududlar va yo'nalishlar: natija"
          badge={`Joriy: ${period} · ${data.compareLabel}: ${previousPeriod}`}
          actions={
            // Markaz va Hududlar kabi: qidirish va Excelga eksport — karta sarlavhasida
            <>
              <SearchInput value={query} onChange={setQuery} placeholder="Birlik qidirish…" />
              <ExcelButton onClick={exportCsv} />
              <ToggleAllButton open={opened.size > 0} onClick={() => setOpened(opened.size ? new Set() : new Set([REGIONS_KEY, ...units.map((s) => s.unit.key)]))} />
            </>
          }
        >
          <ShareBase.Provider value={{ income: total.income, expense: total.expense }}>
          <RTable minWidth={900}>
            <thead>
              <tr>
                <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>
                  №
                </Th>
                <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>
                  Birlik
                </Th>
                <GroupTh span={2}>Daromad</GroupTh>
                <GroupTh span={2}>Xarajat</GroupTh>
                <GroupTh span={2}>Natija</GroupTh>
              </tr>
              <tr>
                <Th className="first:border-l">Summa</Th>
                <Th title="Korxona jami daromadiga nisbatan">Ulushi</Th>
                <Th>Summa</Th>
                <Th title="Korxona jami xarajatiga nisbatan">Ulushi</Th>
                <Th>Foyda</Th>
                <Th>Rentabellik</Th>
              </tr>
            </thead>
            <tbody>
              <ResultTotal label="Korxona jami" sub="Markaz + hududlar + yo'nalishlar" t={total} compareLabel={label} />
              {center && match(center) && unitRow(center, 0)}
              {/* Hudud — bitta qator; bosilsa viloyatlar ochiladi */}
              {activeRegions.length > 0 && (shownRegions.length > 0 || !q) && (
                <Tr onClick={() => toggle(REGIONS_KEY)} className={cn('bg-[#f1f5fe] font-semibold', regionsOpen && 'bg-brand-50')}>
                  <Td className={STICKY_NO} />
                  <NameCell
                    before={<span className={cn('inline-block w-3 text-xs text-(--color-text-faint) transition-transform', regionsOpen && 'rotate-90')}>▸</span>}
                    sub={`${activeRegions.length} viloyat · ${count(reg.headcount)} xodim · bosing — viloyatlar`}
                    className="font-semibold text-heading"
                  >
                    <span id="unit-regions" className="scroll-mt-24">
                      Hudud
                    </span>
                  </NameCell>
                  <ResultCells s={reg} title="Hudud" compareLabel={label} />
                </Tr>
              )}
              {regionsOpen && shownRegions.map((x) => unitRow(x, 1))}
              {[...segments, ...(unassigned ? [unassigned] : [])].filter(match).map((x) => unitRow(x, 0))}
            </tbody>
          </RTable>
          </ShareBase.Provider>
          <TableNote>
            Tartib: Markaz → Hudud (bosing — viloyatlar) → yo&apos;nalishlar. Qatorni bosing — joyida kengayadi: tumanlar, bo&apos;limlar, tuzilmalar, xodimlar, oylar va
            yozuvlargacha. Markaz rentabelligi ko&apos;rsatilmaydi — u asosan xizmat
            ko&apos;rsatadi, xarajatini hududlar foydasi qoplaydi.
          </TableNote>
        </ReportCard>
      )}

      {view === 'months' && <MonthsTable units={units} months={data.months} range={data.range} onOpen={open} />}

      {view === 'bridge' && <BridgeTree center={center} regions={activeRegions} segments={segments} unassigned={unassigned} compareLabel={data.compareLabel} period={`Joriy: ${period} · ${data.compareLabel}: ${previousPeriod}`} notes={data.notes} />}

      <UnassignedDrawer open={unOpen} onClose={() => setUnOpen(false)} range={data.range} section={data.section} />
    </div>
  );
}

// ─────────── Natija jadvali katakchalari ───────────

/** Ulush asosi — korxona jami (jadval bo'ylab bitta) */
const ShareBase = createContext<{ income: number; expense: number }>({ income: 0, expense: 0 });

/** 6 ta raqamli ustun: Daromad (summa, ulushi) · Xarajat (summa, ulushi) · Natija (foyda, rentabellik) */
function ResultCells({ s, title, center = false }: { s: Totals | UnitStats; title: string; compareLabel?: string; center?: boolean }) {
  const base = useContext(ShareBase);
  const p = s.income - s.expense;
  return (
    <>
      <MoneyCell value={s.income} />
      <PctCell value={base.income > 0 ? (s.income / base.income) * 100 : null} plain className="font-normal text-(--color-text-muted)" />
      <MoneyCell value={s.expense} />
      <PctCell value={base.expense > 0 ? (s.expense / base.expense) * 100 : null} plain className="font-normal text-(--color-text-muted)" />
      <MoneyCell value={p} strong signedColor calc={calcResult(s.income, s.expense, { title: `Natija: ${title}` })} />
      <Td>{center ? <span className="text-(--color-text-faint)"></span> : <PctBadge value={s.income > 0 ? (p / s.income) * 100 : null} plain />}</Td>
    </>
  );
}

function ResultTotal({ label, sub, t, compareLabel, light = false }: { label: string; sub: string; t: Totals; compareLabel: string; light?: boolean }) {
  return (
    <Tr total className={cn(light && 'bg-[#f1f5fe] font-semibold')}>
      <Td className={STICKY_NO} />
      <NameCell sub={`${sub} · ${count(t.headcount)} xodim`}>{label}</NameCell>
      <ResultCells s={t} title={label} compareLabel={compareLabel} />
    </Tr>
  );
}
