'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
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
  SearchInput,
  SelectBox,
  StatTiles,
  STICKY_NAME,
  STICKY_NO,
  TableNote,
  Td,
  Th,
  Tr,
} from '@/components/report/report';
import { COMPARE_OPTIONS, SECTION_OPTIONS, type CompareMode, type SectionFilter } from '@/features/structure/api';
import { SmallButton } from '@/features/structure/parts';
import { csvPct, csvSom, downloadCsv } from '@/features/structure/stats';
import { formatDate } from '@/lib/format';
import { calcChange, calcDivide, calcResult, calcSum, moneyText, Q, type Calc } from '@/lib/calc';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { unitByCode } from '@/lib/segments';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, Fragment, useContext, useMemo, useState } from 'react';
import { DrillProvider } from '@/features/explore/drill';
import { UnitTree } from './overall-tree';
import { Mark } from '@/features/reactions/mark';
import { KIND_LABEL, regionsApi, statsOf, unitMark, type RegionsResult, type UnitStats } from './api';
import { DistrictDrill, DrillBreadcrumb, EmployeeDrill, RegionDrill, type Crumb } from './drill';
import { CenterDepartmentDrill, CenterDrill } from './center-drill';
import { UNASSIGNED_KEY } from './drill-api';
import { CenterCoverView } from './center-cover-view';
import { UnassignedDrawer } from './unassigned-drawer';
import { RegionCard } from './region-card';

type View = 'table' | 'cover';
type SortKey = 'order' | 'income' | 'expense' | 'profit' | 'delta';

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'order', label: "Ro'yxat tartibida" },
  { value: 'income', label: "Daromad bo'yicha" },
  { value: 'expense', label: "Xarajat bo'yicha" },
  { value: 'profit', label: "Foyda bo'yicha" },
  { value: 'delta', label: "O'zgarish bo'yicha" },
];

/** Hudud daromadi / xarajati — tarkibidagi moddalar yig'indisi */
function partsCalc(title: string, parts: { label: string; amountTiyin: string }[], source: string): Calc {
  return calcSum(title, parts.map((p) => Q.money(p.label, p.amountTiyin, source)));
}

const cap = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

function sortValue(s: UnitStats, key: SortKey): number {
  switch (key) {
    case 'income':
      return s.income;
    case 'expense':
      return s.expense;
    case 'delta':
      return s.profitDelta;
    default:
      return s.profit;
  }
}

// ═══════════════════════════════════════════════════════════
// Jadval qatorlari
// ═══════════════════════════════════════════════════════════

/** Yig'indi: bir nechta hudud (jami qatorlari uchun) */
interface Totals {
  income: number;
  expense: number;
  previousIncome: number;
  previousExpense: number;
}

function totalsOf(rows: UnitStats[]): Totals {
  return rows.reduce(
    (a, s) => ({ income: a.income + s.income, expense: a.expense + s.expense, previousIncome: a.previousIncome + s.previousIncome, previousExpense: a.previousExpense + s.previousExpense }),
    { income: 0, expense: 0, previousIncome: 0, previousExpense: 0 },
  );
}

/**
 * Solishtirish holati: oldingi davr uchun ma'lumot umuman yo'q bo'lsa (hammasi 0) — «o'tgan davr» va «farq»
 * ustunlari o'rniga ulush (jamiga nisbatan) ko'rsatiladi: jadval bo'sh takrorlardan xoli bo'ladi.
 */
const CmpContext = createContext<{ on: boolean; income: number; expense: number }>({ on: true, income: 0, expense: 0 });

/** 8 ta raqamli ustun: daromad (3), xarajat (3), natija (2); solishtirish yo'q bo'lsa — 6 ta (summa, ulush) */
function NumberCells({ t, title, incomeCalc, expenseCalc, compareLabel }: { t: Totals; title: string; incomeCalc?: Calc | null; expenseCalc?: Calc | null; compareLabel: string }) {
  const cmp = useContext(CmpContext);
  const profit = t.income - t.expense;
  const previousProfit = t.previousIncome - t.previousExpense;
  if (!cmp.on) {
    return (
      <>
        <MoneyCell value={t.income} calc={incomeCalc} />
        <PctCell value={cmp.income > 0 ? (t.income / cmp.income) * 100 : null} plain className="font-normal text-(--color-text-muted)" />
        <MoneyCell value={t.expense} calc={expenseCalc} />
        <PctCell value={cmp.expense > 0 ? (t.expense / cmp.expense) * 100 : null} plain className="font-normal text-(--color-text-muted)" />
        <MoneyCell value={profit} strong signedColor calc={calcResult(t.income, t.expense, { title: `Natija: ${title}` })} />
        <PctCell value={t.income > 0 ? (profit / t.income) * 100 : null} plain />
      </>
    );
  }
  return (
    <>
      <MoneyCell value={t.previousIncome} />
      <MoneyCell value={t.income} calc={incomeCalc} />
      <DiffCell value={t.income - t.previousIncome} pct={changeOf(t.income, t.previousIncome)} calc={calcChange(`${title}: daromad o'zgarishi`, Q.money('Joriy davr', t.income), Q.money(compareLabel, t.previousIncome), { growthGood: true })} />
      <MoneyCell value={t.previousExpense} />
      <MoneyCell value={t.expense} calc={expenseCalc} />
      <DiffCell value={t.expense - t.previousExpense} pct={changeOf(t.expense, t.previousExpense)} growthGood={false} calc={calcChange(`${title}: xarajat o'zgarishi`, Q.money('Joriy davr', t.expense), Q.money(compareLabel, t.previousExpense), { growthGood: false })} />
      <MoneyCell
        value={profit}
        strong
        signedColor
        calc={calcResult(t.income, t.expense, {
          title: `Natija: ${title}`,
          note: `${cap(compareLabel)}: ${moneyText(t.previousIncome)} − ${moneyText(t.previousExpense)} = ${moneyText(previousProfit)}`,
        })}
      />
      <PctCell value={t.income > 0 ? (profit / t.income) * 100 : null} plain />
    </>
  );
}

/**
 * Bitta bosish — qator tagida ichi ochiladi (joyida, sahifadan chiqmasdan); yana bosish — yopiladi.
 * Ikki marta bosish — ichiga kiriladi (hudud → tumanlar sahifasi, Markaz → bo'limlar, yo'nalish → o'z sahifasi).
 */
function UnitRow({
  s,
  index,
  open,
  onToggle,
  onOpen,
  section,
  compareLabel,
  range,
  compare,
}: {
  s: UnitStats;
  index: number | null;
  open: boolean;
  onToggle: (key: string) => void;
  onOpen: (key: string) => void;
  section: SectionFilter;
  compareLabel: string;
  range: DateRange;
  compare: CompareMode;
}) {
  const u = s.unit;
  const cmp = useContext(CmpContext);
  const sub = u.kind === 'center' ? "bo'limlar va xodimlar" : u.kind === 'segment' ? "yo'nalish" : u.kind === 'unassigned' ? 'hudud belgilanmagan yozuvlar' : u.headcount > 0 ? `${Math.round(u.headcount)} xodim` : undefined;
  return (
    <Fragment>
    <Tr
      onClick={() => onToggle(u.key)}
      onDoubleClick={() => onOpen(u.key)}
      title="Bosing — tagida ochiladi · ikki marta bosing — ichiga kirasiz"
      muted={u.kind !== 'region'}
      className={cn('select-none', open && 'bg-brand-50')}
    >
      <Td className={cn(STICKY_NO, 'text-(--color-text-faint)')}>{index ?? ''}</Td>
      <NameCell
        sub={sub}
        before={
          <>
            <span className={cn('inline-block w-3 text-xs text-(--color-text-faint) transition-transform', open && 'rotate-90')}>▸</span>
            <Mark item={unitMark(u, 'RESULT', section)} />
          </>
        }
        className="font-medium text-heading"
      >
        {u.name}
      </NameCell>
      <NumberCells
        t={s}
        title={u.name}
        compareLabel={compareLabel}
        incomeCalc={partsCalc(`${u.name} daromadi`, u.incomeParts, 'Daromad yozuvlari')}
        expenseCalc={partsCalc(`${u.name} xarajati`, u.expenseParts, 'Xarajat yozuvlari va ish haqi')}
      />
    </Tr>
    {open && (
      <tr>
        <td colSpan={cmp.on ? 10 : 8} className="border-b border-(--color-line) bg-[#f8f9fc] p-0">
          <div className="sticky left-0 max-w-[calc(100vw-8rem)] px-4 py-3">
            <UnitTree s={s} range={range} section={section} compare={compare} fmt="full" />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-(--color-text-muted)">
              <span>Ichidagi har bir qatorni bosib, yana chuqurroq ochish mumkin.</span>
              <button type="button" onClick={() => onOpen(u.key)} className="rounded-md border border-brand-300 bg-white px-3 py-1 font-semibold text-brand-700 hover:bg-brand-50">
                To&apos;liq ochish ›
              </button>
            </div>
          </div>
        </td>
      </tr>
    )}
    </Fragment>
  );
}

function TotalRow({ label, rows, compareLabel }: { label: string; rows: UnitStats[]; compareLabel: string }) {
  const t = totalsOf(rows);
  return (
    <Tr total>
      <Td className={STICKY_NO} />
      <NameCell>{label}</NameCell>
      <NumberCells
        t={t}
        title={label}
        compareLabel={compareLabel}
        incomeCalc={calcSum(`${label}: daromad`, rows.map((r) => Q.money(r.unit.name, r.income)))}
        expenseCalc={calcSum(`${label}: xarajat`, rows.map((r) => Q.money(r.unit.name, r.expense)))}
      />
    </Tr>
  );
}

// ═══════════════════════════════════════════════════════════
// Asosiy komponent
// ═══════════════════════════════════════════════════════════

/**
 * Solishtirma: har bir hudud va Markaz — daromad (shu hududda bajarilgan ishlar)
 * va xarajat (shu hudud xodimlari ish haqi + hudud xarajatlari).
 * center — Solishtirma › Markaz paneli: to'g'ridan-to'g'ri Markaz ichkarisi (bo'limlar → xodimlar)
 */
export function RegionsCompare({ range, center = false }: { range: DateRange; center?: boolean }) {
  const [section, setSection] = useState<SectionFilter>('ALL');
  const [compare, setCompare] = useState<CompareMode>('prev');
  const [cardOpen, setCardOpen] = useState(false);
  const result = useAsync(() => regionsApi.compare(range, section, compare).then((r) => r.data), [range.from, range.to, section, compare]);
  const data = result.data;

  // ─────────── Ichma-ich kirish: manzilda saqlanadi (?r=3&d=3-1&dn=…&e=…&en=…) ───────────
  // Brauzerning «orqaga» tugmasi ham, havolani ulashish ham ishlaydi.
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const regionParam = params.get('r');
  const drillRegion = center ? 0 : regionParam !== null && /^\d+$/.test(regionParam) ? Number(regionParam) : null;
  const drillDistrict = drillRegion !== null ? params.get('d') : null;
  const districtName = params.get('dn') ?? (drillDistrict === UNASSIGNED_KEY ? (drillRegion === 0 ? "Bo'limga biriktirilmagan" : "Tumanga bo'linmagan") : drillRegion === 0 ? "Bo'lim" : 'Tuman');
  const drillEmployee = drillDistrict !== null ? params.get('e') : null;
  const employeeName = params.get('en') ?? 'Xodim';

  const go = (next: Record<string, string | number | null>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(next)) if (value !== null && value !== '') query.set(key, String(value));
    const text = query.toString();
    router.push(text ? `${pathname}?${text}` : pathname, { scroll: false });
    setCardOpen(false);
  };
  // Hududlar panelida Markaz bosilsa — Markaz paneliga o'tiladi
  const openRegion = (code: number) => (code === 0 && !center ? router.push('/solishtirma/markaz') : go({ r: code }));

  const regionUnit = drillRegion !== null ? (data?.units.find((u) => u.kind === 'region' && u.code === drillRegion) ?? null) : null;
  const isCenter = drillRegion === 0;
  const centerUnit = isCenter ? (data?.units.find((u) => u.kind === 'center') ?? null) : null;
  const regionName = isCenter ? (centerUnit?.name ?? 'Markaz') : (regionUnit?.name ?? (drillRegion !== null ? `Viloyat ${drillRegion}` : ''));
  /** Markazni qoplash: hududlar foydasi ÷ Markaz sof xarajati */
  const coverage = useMemo(() => {
    if (!data) return null;
    const regionsProfit = data.units.filter((u) => u.kind === 'region').map(statsOf).reduce((s, x) => s + x.profit, 0);
    const c = data.units.find((u) => u.kind === 'center');
    if (!c) return null;
    const cs = statsOf(c);
    const net = cs.expense - cs.income;
    return net > 0 ? (regionsProfit / net) * 100 : null;
  }, [data]);

  const crumbs: Crumb[] = center ? [{ label: regionName, onClick: () => go({}) }] : [{ label: 'Solishtirma', onClick: () => go({}) }];
  if (drillRegion !== null && !center) crumbs.push({ label: regionName, onClick: () => go({ r: drillRegion }) });
  if (drillRegion !== null && drillDistrict) crumbs.push({ label: districtName, onClick: () => go({ r: drillRegion, d: drillDistrict, dn: params.get('dn') }) });
  if (drillRegion !== null && drillDistrict && drillEmployee) crumbs.push({ label: employeeName });

  const cardStats = regionUnit ? statsOf(regionUnit) : null;
  const cardRegions = useMemo(
    () => (data ? data.units.filter((u) => u.kind === 'region').map(statsOf).filter((x) => x.income !== 0 || x.expense !== 0) : []),
    [data],
  );

  return (
    <div className="space-y-4">
      {drillRegion !== null ? (
        <>
          <DrillBreadcrumb items={crumbs} />
          {drillDistrict && drillEmployee ? (
            // Xodim uchun — yil boshidan (yoki tanlangan sanadan, qaysi biri oldin bo'lsa) oylar ko'rinadi
            <EmployeeDrill pinfl={drillEmployee} range={{ from: [range.from, `${range.to.slice(0, 4)}-01-01`].sort()[0]!, to: range.to }} noPlan={isCenter} />
          ) : isCenter && drillDistrict ? (
            <CenterDepartmentDrill
              id={drillDistrict}
              range={range}
              section={section}
              compare={compare}
              onEmployee={(pinfl, name) => go({ r: 0, d: drillDistrict, dn: params.get('dn'), e: pinfl, en: name })}
            />
          ) : isCenter ? (
            <CenterDrill range={range} section={section} compare={compare} coverage={coverage} onDepartment={(row) => go({ r: 0, d: row.id, dn: row.name })} />
          ) : drillDistrict ? (
            <DistrictDrill
              id={drillDistrict}
              regionCode={drillRegion}
              range={range}
              section={section}
              compare={compare}
              onEmployee={(pinfl, name) => go({ r: drillRegion, d: drillDistrict, dn: params.get('dn'), e: pinfl, en: name })}
            />
          ) : (
            <RegionDrill
              code={drillRegion}
              range={range}
              section={section}
              compare={compare}
              onDistrict={(row) => go({ r: drillRegion, d: row.id, dn: row.name })}
              extraActions={
                data && cardStats ? (
                  <SmallButton className="h-10 rounded-lg border-brand-300 px-4 text-sm font-semibold text-brand-700 hover:bg-brand-50" onClick={() => setCardOpen(true)} title="Xizmat turlari, xarajat tarkibi va Munosabatga belgilash">
                    Viloyat kartasi
                  </SmallButton>
                ) : null
              }
            />
          )}
          {data && <RegionCard data={data} stats={cardOpen ? cardStats : null} regions={cardRegions} onClose={() => setCardOpen(false)} />}
        </>
      ) : result.error ? (
        <Card>
          <ErrorState message={result.error} onRetry={result.reload} />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingState label="Hududlar hisoblanmoqda" />
        </Card>
      ) : (
        <Body data={data} loading={result.loading} onDrill={openRegion} section={section} onSection={setSection} compare={compare} onCompare={setCompare} />
      )}
    </div>
  );
}

function Body({
  data,
  loading,
  onDrill,
  section,
  onSection,
  compare,
  onCompare,
}: {
  data: RegionsResult;
  loading: boolean;
  onDrill: (code: number) => void;
  section: SectionFilter;
  onSection: (value: SectionFilter) => void;
  compare: CompareMode;
  onCompare: (value: CompareMode) => void;
}) {
  const [view, setView] = useState<View>('table');
  const [sort, setSort] = useState<SortKey>('order');
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [unOpen, setUnOpen] = useState(false);
  /** Joyida ochilgan qatorlar (bir nechtasi birga ochiq bo'lishi mumkin) */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const router = useRouter();

  /** Viloyat bosilsa — ichiga (tumanlar); Markaz — bo'limlar; yo'nalish — o'z sahifasi; biriktirilmagan — yozuvlar */
  const open = (key: string) => {
    const unit = data.units.find((u) => u.key === key);
    if (unit?.kind === 'region' && unit.code !== null) onDrill(unit.code);
    else if (unit?.kind === 'center') onDrill(0);
    else if (unit?.kind === 'unassigned') setUnOpen(true);
    else if (unit?.kind === 'segment' && unit.segment && unitByCode(unit.segment)) router.push(`/solishtirma/${unitByCode(unit.segment)!.slug}`);
    else setOpenKey(key);
  };

  const all = useMemo(() => data.units.map(statsOf), [data]);
  const regions = all.filter((s) => s.unit.kind === 'region');
  const activeRegions = regions.filter((s) => s.income !== 0 || s.expense !== 0);
  const center = all.find((s) => s.unit.kind === 'center') ?? null;
  const unassigned = all.find((s) => s.unit.kind === 'unassigned') ?? null;
  /** Yo'nalishlar (Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari) */
  const segments = all.filter((s) => s.unit.kind === 'segment');
  const others = [...(center ? [center] : []), ...segments, ...(unassigned ? [unassigned] : [])];

  const q = query.trim().toLowerCase();
  const found = regions.filter((s) => !q || s.unit.name.toLowerCase().includes(q));
  const sorted = sort === 'order' ? found : [...found].sort((a, b) => sortValue(b, sort) - sortValue(a, sort));

  // ─────────── Jami ko'rsatkichlar ───────────
  const r = totalsOf(regions);
  const rProfit = r.income - r.expense;
  const rPrevProfit = r.previousIncome - r.previousExpense;
  const t = totalsOf(all);
  const centerNet = center ? center.expense - center.income : 0;
  const coverage = centerNet > 0 ? (rProfit / centerNet) * 100 : null;
  const winners = activeRegions.filter((s) => s.profit > 0).length;
  /** Oldingi davrda ma'lumot bormi (yo'q bo'lsa — solishtirish ustunlari o'rniga ulush) */
  const cmpOn = t.previousIncome !== 0 || t.previousExpense !== 0;

  const exportCsv = () =>
    downloadCsv(
      `solishtirma-hududlar-${data.range.from}_${data.range.to}`,
      [
        'Hudud',
        'Turi',
        `Daromad: ${data.compareLabel}, so'm`,
        "Daromad: joriy, so'm",
        "Daromad farqi, so'm",
        'Daromad farqi, %',
        `Xarajat: ${data.compareLabel}, so'm`,
        "Xarajat: joriy, so'm",
        "Xarajat farqi, so'm",
        'Xarajat farqi, %',
        "Foyda, so'm",
        "Foyda farqi, so'm",
        'Rentabellik, %',
      ],
      [
        ...[...regions, ...others].map((s) => [
          s.unit.name,
          KIND_LABEL[s.unit.kind],
          csvSom(s.previousIncome),
          csvSom(s.income),
          csvSom(s.income - s.previousIncome),
          csvPct(changeOf(s.income, s.previousIncome)),
          csvSom(s.previousExpense),
          csvSom(s.expense),
          csvSom(s.expense - s.previousExpense),
          csvPct(changeOf(s.expense, s.previousExpense)),
          csvSom(s.profit),
          csvSom(s.profitDelta),
          csvPct(s.margin),
        ]),
        [
          "Korxona bo'yicha jami",
          '',
          csvSom(t.previousIncome),
          csvSom(t.income),
          csvSom(t.income - t.previousIncome),
          csvPct(changeOf(t.income, t.previousIncome)),
          csvSom(t.previousExpense),
          csvSom(t.expense),
          csvSom(t.expense - t.previousExpense),
          csvPct(changeOf(t.expense, t.previousExpense)),
          csvSom(t.income - t.expense),
          csvSom(t.income - t.expense - (t.previousIncome - t.previousExpense)),
          csvPct(t.income > 0 ? ((t.income - t.expense) / t.income) * 100 : null),
        ],
        [],
        [`Davr: ${data.range.from} — ${data.range.to}; solishtirish: ${data.compareLabel} (${data.previousRange.from} — ${data.previousRange.to})`],
      ],
    );

  const period = `${formatDate(data.range.from)} — ${formatDate(data.range.to)}`;
  const previousPeriod = `${formatDate(data.previousRange.from)} — ${formatDate(data.previousRange.to)}`;

  return (
    <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}>
      <StatTiles
        compareLabel="Avval"
        items={[
          {
            label: 'Hududlar daromadi',
            value: r.income,
            previous: r.previousIncome,
            tone: 'green',
            icon: <IconUp />,
            calc: calcSum('Hududlar daromadi', regions.map((x) => Q.money(x.unit.name, x.income))),
          },
          {
            label: 'Hududlar xarajati',
            value: r.expense,
            previous: r.previousExpense,
            growthGood: false,
            tone: 'red',
            icon: <IconDown />,
            calc: calcSum('Hududlar xarajati', regions.map((x) => Q.money(x.unit.name, x.expense))),
          },
          {
            label: rProfit >= 0 ? 'Hududlar foydasi' : 'Hududlar zarari',
            value: rProfit,
            previous: rPrevProfit,
            signed: true,
            tone: 'blue',
            calc: calcResult(r.income, r.expense, { title: 'Hududlar natijasi' }),
          },
          {
            label: 'Markazni qoplash',
            value: 0,
            text: coverage === null ? '' : `${coverage.toFixed(1).replace('.', ',')}%`,
            note: `Foydada ${winners} / ${activeRegions.length} hudud`,
            tone: 'orange',
            icon: <IconShield />,
            calc: center
              ? calcDivide('Markazni qoplash', Q.money('Hududlar foydasi', rProfit), Q.money('Markaz sof xarajati', centerNet), 'pct', {
                  note: `Markaz sof xarajati = Markaz xarajati − Markaz daromadi = ${moneyText(center.expense)} − ${moneyText(center.income)} = ${moneyText(centerNet)}. 100% dan yuqori — hududlar Markazni to'liq qoplaydi.`,
                })
              : null,
            onClick: () => setView('cover'),
          },
          {
            label: "Korxona natijasi",
            value: t.income - t.expense,
            previous: t.previousIncome - t.previousExpense,
            signed: true,
            tone: 'purple',
            calc: calcResult(t.income, t.expense, { title: 'Korxona natijasi (hududlar, Markaz, yo‘nalishlar)' }),
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
        <Field label="Tartib">
          <SelectBox value={sort} options={SORT_OPTIONS} onChange={setSort} />
        </Field>
        <Field label="Hudud">
          <SearchInput value={query} onChange={setQuery} placeholder="Hudud nomi…" />
        </Field>
      </FilterBar>

      <PillTabs
        value={view}
        onChange={setView}
        options={[
          { value: 'table', label: 'Hududlar kesimida', hint: 'Har hudud: daromad, xarajat va natija — joriy va oldingi davr' },
          { value: 'cover', label: 'Markazni qoplash', hint: "Markaz xarajati hududlarga bo'linadi, ortiqcha — foydaga" },
        ]}
      />

      {view === 'table' ? (
        <DrillProvider range={{ from: data.range.from, to: data.range.to }}>
        <ReportCard title="Hududlar kesimida daromad va xarajat" badge={cmpOn ? `Joriy: ${period} · ${data.compareLabel}: ${previousPeriod}` : period}>
          <CmpContext.Provider value={{ on: cmpOn, income: t.income, expense: t.expense }}>
          <RTable minWidth={cmpOn ? 1060 : 860}>
            <thead>
              <tr>
                <Th rowSpan={2} className={cn(STICKY_NO, 'z-[2]')}>№</Th>
                <Th rowSpan={2} className={cn(STICKY_NAME, 'z-[2] min-w-36 text-left')}>Hudud</Th>
                <GroupTh span={cmpOn ? 3 : 2}>Daromad</GroupTh>
                <GroupTh span={cmpOn ? 3 : 2}>Xarajat</GroupTh>
                <GroupTh span={2}>Natija</GroupTh>
              </tr>
              {cmpOn ? (
                <tr>
                  <Th className="first:border-l">{cap(data.compareLabel)}</Th>
                  <Th>Joriy davr</Th>
                  <Th>Farqi, foizda</Th>
                  <Th>{cap(data.compareLabel)}</Th>
                  <Th>Joriy davr</Th>
                  <Th>Farqi, foizda</Th>
                  <Th>Foyda</Th>
                  <Th>Rentabellik</Th>
                </tr>
              ) : (
                <tr>
                  <Th className="first:border-l">Summa</Th>
                  <Th title="Korxona jami daromadiga nisbatan">Ulushi</Th>
                  <Th>Summa</Th>
                  <Th title="Korxona jami xarajatiga nisbatan">Ulushi</Th>
                  <Th>Foyda</Th>
                  <Th>Rentabellik</Th>
                </tr>
              )}
            </thead>
            <tbody>
              <TotalRow label={`Hududlar bo'yicha · ${regions.length} ta`} rows={regions} compareLabel={data.compareLabel} />
              {[...sorted, ...others].map((s) => (
                <UnitRow
                  key={s.unit.key}
                  s={s}
                  index={s.unit.kind === 'region' ? sorted.indexOf(s) + 1 : null}
                  open={expanded.has(s.unit.key)}
                  onToggle={toggle}
                  onOpen={open}
                  section={data.section}
                  compareLabel={data.compareLabel}
                  range={data.range}
                  compare={data.compare}
                />
              ))}
              <TotalRow label="Korxona bo'yicha jami" rows={all} compareLabel={data.compareLabel} />
            </tbody>
          </RTable>
          </CmpContext.Provider>
          <TableNote>
            {!cmpOn && (
              <>
                {cap(data.compareLabel)} ({previousPeriod}) uchun ma&apos;lumot yo&apos;q — solishtirish o&apos;rniga ulush ko&apos;rsatildi (korxona jamiga nisbatan).{' '}
              </>
            )}
            Qatorni bosing — tagida ochiladi (tumanlar, xarajat tarkibi, mashinalar …); ikki marta bosing — ichiga kirasiz. Ma&apos;lumot Daromadlar, Xarajatlar va Xodimlar bo&apos;limlaridan olinadi. Rentabellik — foyda ÷ daromad.
            Raqamni bosing — qanday hisoblangani ko&apos;rinadi.
          </TableNote>
        </ReportCard>
        </DrillProvider>
      ) : (
        <ReportCard title="Markazni qoplash" badge={period}>
          <CenterCoverView regions={activeRegions} center={center ?? null} onOpen={open} range={data.range} section={data.section} compare={data.compare} />
        </ReportCard>
      )}

      <RegionCard data={data} stats={openKey ? (all.find((s) => s.unit.key === openKey) ?? null) : null} regions={activeRegions} onClose={() => setOpenKey(null)} />
      <UnassignedDrawer open={unOpen} onClose={() => setUnOpen(false)} range={data.range} section={data.section} />
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

function IconShield() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />
    </svg>
  );
}
