'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { CalcValue } from '@/components/ui/calc';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { compact, num, pct, som, TONE, type CompareMode, type SectionFilter } from '@/features/structure/api';
import { Legend, LineChart, Sparkline } from '@/features/structure/charts';
import {
  CompareToggle,
  Findings,
  GroupTitle,
  KpiStrip,
  ModelCard,
  PanelHeader,
  SearchBox,
  SectionToggle,
  SmallButton,
  ViewTabs,
} from '@/features/structure/parts';
import { changePct, csvPct, csvSom, downloadCsv } from '@/features/structure/stats';
import { formatDate, formatPeriod, formatPeriodShort } from '@/lib/format';
import { calcChange, calcDiff, calcDivide, calcMargin, calcResult, calcShare, calcSum, moneyText, Q, type Calc } from '@/lib/calc';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useBrief } from '@/lib/view-mode';
import { unitByCode } from '@/lib/segments';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Mark } from '@/features/reactions/mark';
import { KIND_LABEL, regionsApi, statsOf, unitMark, type RegionsResult, type UnitStats } from './api';
import { DistrictDrill, DrillBreadcrumb, EmployeeDrill, RegionDrill, type Crumb } from './drill';
import { CenterDepartmentDrill, CenterDrill } from './center-drill';
import { UNASSIGNED_KEY } from './drill-api';
import { CenterCoverView } from './center-cover-view';
import { UnassignedDrawer } from './unassigned-drawer';
import { RegionCard } from './region-card';
import { Bridge, EXPENSE_BAR, ExpenseMix, MIX_COLORS, MIX_LABELS, PairedBars, ProfitBars, ProfitHeatmap, RegionScatter } from './regions-charts';

type View = 'table' | 'pairs' | 'rating' | 'map' | 'months' | 'mix' | 'cover';
type SortKey = 'name' | 'income' | 'expense' | 'profit' | 'margin' | 'delta' | 'headcount' | 'perHead';

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';

function signed(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${compact(Math.abs(value))}`;
}

function toneOf(delta: number | null, good: boolean): string {
  if (delta === null || Math.abs(delta) < 0.5) return 'text-(--color-text-muted)';
  return delta > 0 === good ? 'text-(--color-income)' : 'text-(--color-expense)';
}


/** Hudud daromadi / xarajati — tarkibidagi moddalar yig'indisi */
function partsCalc(title: string, parts: { label: string; amountTiyin: string }[], source: string): Calc {
  return calcSum(title, parts.map((p) => Q.money(p.label, p.amountTiyin, source)));
}

/** «Zararli oylar»: so'nggi 12 oyda natijasi manfiy bo'lgan oylar */
function lossCalc(s: UnitStats, months: string[]): Calc {
  const last = s.profitTrend.slice(-12);
  const labels = months.slice(-12);
  const inc = s.unit.incomeTrend.slice(-12).map(Number);
  const exp = s.unit.expenseTrend.slice(-12).map(Number);
  const rows = last.map((v, i) => ({ month: labels[i] ? formatPeriodShort(labels[i]!) : `${i + 1}-oy`, v, active: inc[i] !== 0 || exp[i] !== 0 }));
  const losses = rows.filter((r) => r.active && r.v < 0);
  return {
    title: `${s.unit.name}: zararli oylar`,
    formula: "Oy zararli, agar shu oydagi Daromad − Xarajat < 0. Hisob: zararli oylar soni / ma'lumoti bor oylar soni",
    inputs: rows.filter((r) => r.active).map((r) => ({ label: `${r.month} natijasi`, value: r.v, kind: 'money' as const })),
    steps: [
      `Ma'lumoti bor oylar: ${rows.filter((r) => r.active).length} ta`,
      losses.length ? `Zararli: ${losses.map((r) => `${r.month} (${moneyText(r.v)})`).join(', ')}` : "Zararli oy yo'q",
      `= ${losses.length} / ${rows.filter((r) => r.active).length}`,
    ],
    result: `${losses.length} / ${rows.filter((r) => r.active).length}`,
    note: "So'nggi 12 oy olinadi (tanlangan davr oxirigacha).",
  };
}

function sortValue(s: UnitStats, key: SortKey): number | string {
  switch (key) {
    case 'name':
      return s.unit.name.toLowerCase();
    case 'income':
      return s.income;
    case 'expense':
      return s.expense;
    case 'margin':
      return s.margin ?? Number.NEGATIVE_INFINITY;
    case 'delta':
      return s.profitDelta;
    case 'headcount':
      return s.unit.headcount;
    case 'perHead':
      return s.incomePerHead ?? Number.NEGATIVE_INFINITY;
    default:
      return s.profit;
  }
}

// ═══════════════════════════════════════════════════════════
// Asosiy jadval
// ═══════════════════════════════════════════════════════════

function SortTh({ label, column, sort, onSort, className }: { label: string; column: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === column;
  return (
    <th className={cn(TH, className)}>
      <button type="button" onClick={() => onSort(column)} className={cn('inline-flex items-center gap-1 uppercase hover:text-(--color-text)', active && 'text-(--color-text)')}>
        {label}
        <span className="text-[10px]">{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}

function UnitRow({
  s,
  rank,
  onOpen,
  strong,
  section,
  months,
  brief,
}: {
  s: UnitStats;
  rank: number | null;
  onOpen: (key: string) => void;
  strong?: boolean;
  section: SectionFilter;
  months: string[];
  /** Qisqa rejim: faqat daromad, xarajat, foyda, rentabellik */
  brief?: boolean;
}) {
  const u = s.unit;
  return (
    <tr className={cn('group cursor-pointer hover:bg-(--color-surface-muted)', strong && 'bg-slate-50')} onClick={() => onOpen(u.key)}>
      <td className="py-2.5 pl-5 pr-1 text-right text-xs tabular-nums text-(--color-text-faint)">{rank ?? ''}</td>
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-2">
          <Mark item={unitMark(u, 'RESULT', section)} />
          <span className={cn('block max-w-[14rem] truncate group-hover:underline', u.kind !== 'region' && 'font-medium')} title={u.name}>
            {u.name}
          </span>
        </span>
        {u.kind !== 'region' && (
          <span className="text-xs text-(--color-text-faint)">
            {u.kind === 'center' ? "Markaz bo'limlari va xodimlari" : u.kind === 'segment' ? "yo'nalish · sahifasini ochish ›" : "hudud belgilanmagan yozuvlar · ichini ko'rish ›"}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
        <CalcValue calc={partsCalc(`${u.name} daromadi`, u.incomeParts, 'Daromad yozuvlari')}>{num(s.income)}</CalcValue>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
        <CalcValue calc={partsCalc(`${u.name} xarajati`, u.expenseParts, 'Xarajat yozuvlari va ish haqi')}>{num(s.expense)}</CalcValue>
        {!brief && <span className="block text-xs text-(--color-text-faint)">ish haqi {compact(s.payroll)}</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums" style={{ color: s.profit >= 0 ? TONE.income : TONE.expense }}>
        <CalcValue calc={calcResult(s.income, s.expense, { title: `Natija: ${u.name}` })}>{num(s.profit)}</CalcValue>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-(--color-text-muted)">
        <CalcValue calc={calcMargin(s.income, s.expense, { note: u.name })}>{pct(s.margin)}</CalcValue>
      </td>
      {!brief && (
      <>
      <td className={cn('hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums md:table-cell', toneOf(s.profitDelta === 0 ? null : s.profitDelta, true))}>
        <CalcValue
          calc={calcDiff(`${u.name}: natija o'zgarishi`, Q.money('Joriy natija', s.profit), Q.money('Oldingi natija', s.previousProfit), {
            note: `Oldingi natija = ${moneyText(s.previousIncome)} − ${moneyText(s.previousExpense)} = ${moneyText(s.previousProfit)}`,
          })}
        >
          {signed(s.profitDelta)}
        </CalcValue>
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums lg:table-cell">{String(u.headcount).replace('.', ',')}</td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums lg:table-cell">
        {s.incomePerHead === null ? (
          '—'
        ) : (
          <CalcValue calc={calcDivide(`${u.name}: bir xodimga daromad`, Q.money('Daromad', s.income), { label: 'Xodimlar', value: u.headcount, kind: 'ratio' }, 'money', { formulaId: 'perHead' })}>
            {compact(s.incomePerHead)}
          </CalcValue>
        )}
      </td>
      <td className="hidden px-3 py-2.5 2xl:table-cell">
        <Sparkline values={s.profitTrend.slice(-12).map(String)} color={s.profit >= 0 ? TONE.income : TONE.expense} />
      </td>
      <td className={cn('whitespace-nowrap py-2.5 pl-3 pr-5 text-right text-xs tabular-nums', s.lossMonths > 0 ? 'text-(--color-expense)' : 'text-(--color-text-faint)')}>
        {s.activeMonths > 0 ? <CalcValue calc={lossCalc(s, months)}>{`${s.lossMonths} / ${s.activeMonths}`}</CalcValue> : '—'}
      </td>
      </>
      )}
    </tr>
  );
}

function TotalRow({ label, rows, previousProfit, brief }: { label: string; rows: UnitStats[]; previousProfit: number; brief?: boolean }) {
  const income = rows.reduce((s, r) => s + r.income, 0);
  const expense = rows.reduce((s, r) => s + r.expense, 0);
  const payroll = rows.reduce((s, r) => s + r.payroll, 0);
  const heads = rows.reduce((s, r) => s + r.unit.headcount, 0);
  const profit = income - expense;
  return (
    <tr className="border-t-2 border-(--color-line) bg-(--color-surface-muted) font-semibold">
      <td />
      <td className="px-3 py-2.5">{label}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
        <CalcValue calc={calcSum(`${label}: daromad`, rows.map((r) => Q.money(r.unit.name, r.income)))}>{num(income)}</CalcValue>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
        <CalcValue calc={calcSum(`${label}: xarajat`, rows.map((r) => Q.money(r.unit.name, r.expense)))}>{num(expense)}</CalcValue>
        {!brief && <span className="block text-xs font-normal text-(--color-text-faint)">ish haqi {compact(payroll)}</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums" style={{ color: profit >= 0 ? TONE.income : TONE.expense }}>
        <CalcValue calc={calcResult(income, expense, { title: `${label}: natija` })}>{num(profit)}</CalcValue>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
        <CalcValue calc={calcMargin(income, expense, { note: label })}>{pct(income > 0 ? (profit / income) * 100 : null)}</CalcValue>
      </td>
      {!brief && (
      <>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums md:table-cell">
        <CalcValue calc={calcDiff(`${label}: natija o'zgarishi`, Q.money('Joriy natija', profit), Q.money('Oldingi natija', previousProfit))}>{signed(profit - previousProfit)}</CalcValue>
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums lg:table-cell">{Math.round(heads)}</td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums lg:table-cell">
        {heads > 0 ? (
          <CalcValue calc={calcDivide(`${label}: bir xodimga daromad`, Q.money('Daromad', income), { label: 'Xodimlar', value: heads, kind: 'ratio' }, 'money', { formulaId: 'perHead' })}>
            {compact(income / heads)}
          </CalcValue>
        ) : (
          '—'
        )}
      </td>
      <td className="hidden 2xl:table-cell" />
      <td />
      </>
      )}
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════
// Asosiy komponent
// ═══════════════════════════════════════════════════════════

/**
 * Solishtirma: har bir hudud va Markaz — daromad (shu hududda bajarilgan ishlar)
 * va xarajat (shu hudud xodimlari ish haqi + hudud xarajatlari).
 */
/** center — Solishtirma › Markaz paneli: to'g'ridan-to'g'ri Markaz ichkarisi (bo'limlar → xodimlar) */
export function RegionsCompare({ range, center = false }: { range: DateRange; center?: boolean }) {
  const [section, setSection] = useState<SectionFilter>('ALL');
  const [compare, setCompare] = useState<CompareMode>('prev');
  const [cardOpen, setCardOpen] = useState(false);
  /** Qisqa rejim: asosiy raqamlar va jadval; grafiklar, modellar va sozlagichlar — To'liq rejimda */
  const brief = useBrief();
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
      {/* Solishtirish va bo'lim sozlagichlari — tepada; sarlavha va izoh — sahifa oxirida */}
      {!brief && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <CompareToggle value={compare} onChange={setCompare} />
          <SectionToggle value={section} onChange={setSection} />
        </div>
      )}

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
                  <SmallButton onClick={() => setCardOpen(true)} title="Xizmat turlari, xarajat tarkibi va Munosabatga belgilash">
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
        <Body data={data} loading={result.loading} onDrill={openRegion} brief={brief} />
      )}

      <PanelHeader
        title={center ? "Markaz: daromad, xarajat, bo'limlar va xodimlar" : 'Hududlar va Markaz: daromad va xarajat'}
        description={
          data
            ? `${formatDate(data.range.from)} — ${formatDate(data.range.to)} · solishtirish: ${data.compareLabel} (${formatDate(data.previousRange.from)} — ${formatDate(data.previousRange.to)})`
            : 'Har bir hudud qancha daromad keltirgani va qancha xarajat qilgani'
        }
      >
        {!brief && (
        <p className="text-xs leading-relaxed text-(--color-text-muted)">
          Ma&apos;lumot faqat <b className="text-(--color-text)">Daromadlar</b>, <b className="text-(--color-text)">Xarajatlar</b> va{' '}
          <b className="text-(--color-text)">Xodimlar</b> bo&apos;limlaridan olinadi — o&apos;sha yerda qanday yozilgan bo&apos;lsa, shunday. Daromad — shu hududga yozilgan tushumlar;
          xarajat — shu hududga yozilgan xarajatlar (xodimlar ish haqi, ijara, mashinalar va boshqalar); xodimlar soni — Xodimlar bo&apos;limidan. Markaz bo&apos;limlariniki —
          Markazga, hududi ko&apos;rsatilmagan yozuvlar — alohida qatorda.
        </p>
        )}
      </PanelHeader>
    </div>
  );
}

function Body({ data, loading, onDrill, brief = false }: { data: RegionsResult; loading: boolean; onDrill: (code: number) => void; brief?: boolean }) {
  const [viewState, setView] = useState<View>('table');
  /** Qisqa rejimda — jadval va «Markazni qoplash» (bosib ichiga kiriladigan) */
  const view: View = brief && viewState !== 'cover' ? 'table' : viewState;
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'profit', dir: 'desc' });
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [unOpen, setUnOpen] = useState(false);
  const router = useRouter();

  /** Viloyat bosilsa — ichiga (tumanlar); Markaz va biriktirilmagan — karta */
  const open = (key: string) => {
    const unit = data.units.find((u) => u.key === key);
    if (unit?.kind === 'region' && unit.code !== null) onDrill(unit.code);
    // Markaz — hududlar kabi ichiga (bo'limlar → xodimlar)
    else if (unit?.kind === 'center') onDrill(0);
    // Biriktirilmagan — ichidagi yozuvlar paneli
    else if (unit?.kind === 'unassigned') setUnOpen(true);
    // Yo'nalish (Tax free …) — o'z sahifasi (daromad manbalari, xarajat tarkibi, natija)
    else if (unit?.kind === 'segment' && unit.segment && unitByCode(unit.segment)) router.push(`/solishtirma/${unitByCode(unit.segment)!.slug}`);
    else setOpenKey(key);
  };

  const all = useMemo(() => data.units.map(statsOf), [data]);
  const regions = all.filter((s) => s.unit.kind === 'region');
  const activeRegions = regions.filter((s) => s.income !== 0 || s.expense !== 0);
  const center = all.find((s) => s.unit.kind === 'center') ?? null;
  const unassigned = all.find((s) => s.unit.kind === 'unassigned') ?? null;
  /** Yo'nalishlar (Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari) — hududlar reytingiga kirmaydi */
  const segments = all.filter((s) => s.unit.kind === 'segment');
  const withCenter = center ? [...activeRegions, center] : activeRegions;

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sign = sort.dir === 'asc' ? 1 : -1;
    return regions
      .filter((s) => !q || s.unit.name.toLowerCase().includes(q))
      .sort((a, b) => {
        const va = sortValue(a, sort.key);
        const vb = sortValue(b, sort.key);
        if (typeof va === 'string' || typeof vb === 'string') return String(va).localeCompare(String(vb), 'uz') * sign;
        return (va - vb) * sign;
      });
  }, [regions, query, sort]);
  const byProfit = [...activeRegions].sort((a, b) => b.profit - a.profit);
  const rankOf = new Map(byProfit.map((s, i) => [s.unit.key, i + 1]));

  const onSort = (key: SortKey) =>
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));

  // ─────────── Jami ko'rsatkichlar ───────────
  const sum = (list: UnitStats[], pick: (s: UnitStats) => number) => list.reduce((a, s) => a + pick(s), 0);
  const rIncome = sum(regions, (s) => s.income);
  const rExpense = sum(regions, (s) => s.expense);
  const rProfit = rIncome - rExpense;
  const rPrevIncome = sum(regions, (s) => s.previousIncome);
  const rPrevExpense = sum(regions, (s) => s.previousExpense);
  const rPrevProfit = rPrevIncome - rPrevExpense;
  const winners = activeRegions.filter((s) => s.profit > 0).length;
  const prevActive = regions.filter((s) => s.previousIncome !== 0 || s.previousExpense !== 0);
  const prevWinners = prevActive.filter((s) => s.previousProfit > 0).length;
  const centerNet = center ? center.expense - center.income : 0;
  const coverage = centerNet > 0 ? (rProfit / centerNet) * 100 : null;
  const totalIncome = sum(all, (s) => s.income);
  const totalExpense = sum(all, (s) => s.expense);
  const totalPrevProfit = sum(all, (s) => s.previousProfit);
  const heads = sum(regions, (s) => s.unit.headcount);
  const openStats = openKey ? (all.find((s) => s.unit.key === openKey) ?? null) : null;

  const exportCsv = () =>
    downloadCsv(
      `solishtirma-hududlar-${data.range.from}_${data.range.to}`,
      ['Hudud', 'Turi', "Daromad, so'm", "Xarajat, so'm", "shundan ish haqi, so'm", "Foyda, so'm", 'Rentabellik, %', `${data.compareLabel}: foyda, so'm`, "Foyda farqi, so'm", "Xodimlar (o'rtacha)", "Bir xodimga daromad, so'm", 'Zarar oylari (12 oy)'],
      [
        ...[...byProfit, ...regions.filter((s) => s.income === 0 && s.expense === 0), ...(center ? [center] : []), ...segments, ...(unassigned ? [unassigned] : [])].map((s) => [
          s.unit.name,
          KIND_LABEL[s.unit.kind],
          csvSom(s.income),
          csvSom(s.expense),
          csvSom(s.payroll),
          csvSom(s.profit),
          csvPct(s.margin),
          csvSom(s.previousProfit),
          csvSom(s.profitDelta),
          String(s.unit.headcount).replace('.', ','),
          s.incomePerHead === null ? '' : csvSom(s.incomePerHead),
          s.lossMonths,
        ]),
        ['Jami', '', csvSom(totalIncome), csvSom(totalExpense), csvSom(sum(all, (s) => s.payroll)), csvSom(totalIncome - totalExpense), csvPct(totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : null), csvSom(totalPrevProfit), csvSom(totalIncome - totalExpense - totalPrevProfit), '', '', ''],
        [],
        [`Davr: ${data.range.from} — ${data.range.to}; solishtirish: ${data.compareLabel} (${data.previousRange.from} — ${data.previousRange.to})`],
      ],
    );

  // Markazni qoplash: har hudud foydasining hissasi
  const contributors = byProfit.filter((s) => s.profit > 0).slice(0, 5);
  const months12 = data.months.slice(-12);
  const trendSum = (list: UnitStats[], pick: 'incomeTrend' | 'expenseTrend') =>
    months12.map((_, i) => list.reduce((a, s) => a + Number(s.unit[pick].slice(-12)[i] ?? 0), 0));

  const avgIncomePerHead = heads > 0 ? rIncome / heads : null;
  const avgExpensePerHead = heads > 0 ? rExpense / heads : null;
  const efficiency = activeRegions.filter((s) => s.incomePerHead !== null).sort((a, b) => b.incomePerHead! - a.incomePerHead!);
  const effMax = Math.max(...efficiency.flatMap((s) => [s.incomePerHead ?? 0, s.expensePerHead ?? 0]), 1);
  const movers = [...activeRegions].filter((s) => s.previousIncome !== 0 || s.previousExpense !== 0).sort((a, b) => b.profitDelta - a.profitDelta);
  const improved = movers.filter((s) => s.profitDelta > 0).slice(0, 5);
  const worsened = [...movers].reverse().filter((s) => s.profitDelta < 0).slice(0, 5);

  const winnersItem = {
    label: 'Foydada ishlayotgan hududlar',
    value: `${winners} / ${activeRegions.length}`,
    valueClass: winners < activeRegions.length ? undefined : 'text-(--color-income)',
    calc: {
      title: 'Foydada ishlayotgan hududlar',
      formula: "Hudud foydada, agar Natija = Daromad − Xarajat > 0. Hisob: foydadagi hududlar / faol hududlar",
      inputs: byProfit.map((r) => Q.money(`${r.unit.name} natijasi`, r.profit)),
      steps: [
        `Faol hududlar (daromadi yoki xarajati bor): ${activeRegions.length} ta`,
        `Foydada: ${winners} ta; zararda yoki 0: ${activeRegions.length - winners} ta`,
        `= ${winners} / ${activeRegions.length}`,
      ],
      result: `${winners} / ${activeRegions.length}`,
    },
    sub: `avval ${prevWinners} / ${prevActive.length} · zararda ${activeRegions.length - winners} ta`,
  };
  const coverageItem = {
    label: 'Markazni qoplash',
    value: coverage === null ? '—' : pct(coverage),
    valueClass: coverage !== null && coverage < 100 ? 'text-(--color-expense)' : coverage !== null ? 'text-(--color-income)' : undefined,
    sub: 'hududlar foydasi ÷ Markaz sof xarajati',
    calc: center
      ? calcDivide('Markazni qoplash', Q.money('Hududlar foydasi', rProfit), Q.money('Markaz sof xarajati', centerNet), 'pct', {
          note: `Markaz sof xarajati = Markaz xarajati − Markaz daromadi = ${moneyText(center.expense)} − ${moneyText(center.income)} = ${moneyText(centerNet)}. 100% dan yuqori — hududlar Markazni to'liq qoplaydi.`,
        })
      : null,
  };

  const views: { value: View; label: string; hint: string }[] = [
    { value: 'table', label: 'Jadval', hint: 'Barcha hududlar va Markaz — raqamlar' },
    { value: 'pairs', label: 'Daromad va xarajat', hint: 'Har hudud uchun ikki chiziq' },
    { value: 'rating', label: 'Foyda reytingi', hint: "Foydadan zararga qarab tartiblangan" },
    { value: 'map', label: 'Hududlar xaritasi', hint: 'Xarajat × daromad; diagonaldan pastda — zarar' },
    { value: 'months', label: 'Oylar kesimi', hint: 'Har hudud oylik foydasi (12 oy)' },
    { value: 'mix', label: 'Xarajat tuzilmasi', hint: 'Ish haqi, ijara, mashinalar, boshqa — 100%' },
    { value: 'cover', label: 'Markazni qoplash', hint: "Markaz xarajati hududlarga optimal bo'linadi, ortiqcha — foydaga" },
  ];

  return (
    <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')}>
      <KpiStrip
        items={[
          {
            label: 'Hududlar daromadi',
            value: som(rIncome),
            calc: calcSum('Hududlar daromadi', regions.map((r) => Q.money(r.unit.name, r.income))),
            sub: (
              <>
                <CalcValue calc={calcChange("Hududlar daromadi: o'zgarish", Q.money('Joriy davr', rIncome), Q.money(data.compareLabel, rPrevIncome), { growthGood: true })}>
                  <b className={cn('font-medium', toneOf(changePct(rIncome, rPrevIncome), true))}>{pct(changePct(rIncome, rPrevIncome), true)}</b>
                </CalcValue>{' '}
                · avval {compact(rPrevIncome)}
              </>
            ),
          },
          {
            label: 'Hududlar xarajati',
            value: som(rExpense),
            calc: calcSum('Hududlar xarajati', regions.map((r) => Q.money(r.unit.name, r.expense))),
            sub: (
              <>
                <CalcValue calc={calcChange("Hududlar xarajati: o'zgarish", Q.money('Joriy davr', rExpense), Q.money(data.compareLabel, rPrevExpense), { growthGood: false })}>
                  <b className={cn('font-medium', toneOf(changePct(rExpense, rPrevExpense), false))}>{pct(changePct(rExpense, rPrevExpense), true)}</b>
                </CalcValue>{' '}
                · avval {compact(rPrevExpense)}
              </>
            ),
          },
          {
            label: rProfit >= 0 ? 'Hududlar foydasi' : 'Hududlar zarari',
            value: som(rProfit),
            valueClass: rProfit < 0 ? 'text-(--color-expense)' : undefined,
            calc: calcResult(rIncome, rExpense, { title: 'Hududlar natijasi' }),
            sub: (
              <>
                <CalcValue calc={calcDiff("Hududlar natijasi: o'zgarish", Q.money('Joriy natija', rProfit), Q.money(`${data.compareLabel} natijasi`, rPrevProfit))}>
                  <b className={cn('font-medium', toneOf(rProfit - rPrevProfit === 0 ? null : rProfit - rPrevProfit, true))}>{signed(rProfit - rPrevProfit)}</b>
                </CalcValue>{' '}
                · avval {compact(rPrevProfit)}
              </>
            ),
          },
          ...(brief ? [coverageItem] : [winnersItem]),
        ]}
      />
      {!brief && (
      <KpiStrip
        items={[
          {
            label: 'Markaz xarajati',
            value: som(center?.expense ?? 0),
            calc: center ? partsCalc('Markaz xarajati', center.unit.expenseParts, "Markaz bo'limlari xarajatlari va ish haqi") : null,
            sub:
              rIncome > 0 && center ? (
                <CalcValue calc={calcShare('Markaz xarajati ulushi', Q.money('Markaz xarajati', center.expense), Q.money('Hududlar daromadi', rIncome))}>
                  hududlar daromadining {pct((center.expense / rIncome) * 100)} i
                </CalcValue>
              ) : undefined,
          },
          coverageItem,
          {
            label: 'Korxona natijasi',
            value: som(totalIncome - totalExpense),
            calc: calcSum(
              'Korxona natijasi',
              [
                Q.money('Hududlar natijasi', rProfit),
                ...(center ? [Q.money('Markaz natijasi', center.profit)] : []),
                ...(unassigned ? [Q.money('Biriktirilmagan natija', unassigned.profit)] : []),
              ],
              { note: `Tekshiruv: jami daromad − jami xarajat = ${moneyText(totalIncome)} − ${moneyText(totalExpense)} = ${moneyText(totalIncome - totalExpense)}` },
            ),
            valueClass: totalIncome - totalExpense < 0 ? 'text-(--color-expense)' : undefined,
            sub: `hududlar + Markaz${unassigned ? ' + biriktirilmagan' : ''} · avval ${compact(totalPrevProfit)}`,
          },
          {
            label: 'Bir xodimga (hududlar)',
            value: avgIncomePerHead === null ? '—' : `${compact(avgIncomePerHead)} daromad`,
            calc: heads > 0 ? calcDivide('Bir xodimga daromad (hududlar)', Q.money('Hududlar daromadi', rIncome), { label: 'Hududlar xodimlari', value: heads, kind: 'ratio' }, 'money', { formulaId: 'perHead' }) : null,
            sub: avgExpensePerHead === null ? undefined : `${compact(avgExpensePerHead)} xarajat · ${Math.round(heads)} xodim`,
          },
        ]}
      />
      )}

      <Findings notes={brief ? data.notes.slice(0, 3) : data.notes} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold">Hududlar solishtirmasi · {activeRegions.length} ta hudud va Markaz</h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">{brief ? 'Hududni bosing — ichiga kirasiz (tumanlar, xodimlar).' : 'Qatorni yoki grafikdagi hududni bosing — hudud kartasi ochiladi (tarkib, 12 oy, xulosa).'}</p>
          </div>
          {!brief && (
            <div className="flex items-center gap-2">
              {view === 'table' && <SearchBox value={query} onChange={setQuery} placeholder="Hudud nomi…" />}
              <SmallButton onClick={exportCsv}>Excel (CSV)</SmallButton>
            </div>
          )}
        </div>
        <ViewTabs value={view} options={brief ? views.filter((v) => v.value === 'table' || v.value === 'cover') : views} onChange={setView} />

        {view === 'table' && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-(--color-line) bg-(--color-surface-muted)">
                <tr>
                  <th className={cn(TH, 'w-8 pl-5 text-right')}>#</th>
                  <SortTh label="Hudud" column="name" sort={sort} onSort={onSort} className="text-left" />
                  <SortTh label="Daromad" column="income" sort={sort} onSort={onSort} className="text-right" />
                  <SortTh label="Xarajat" column="expense" sort={sort} onSort={onSort} className="text-right" />
                  <SortTh label="Foyda" column="profit" sort={sort} onSort={onSort} className="text-right" />
                  <SortTh label="Rent." column="margin" sort={sort} onSort={onSort} className="text-right" />
                  {!brief && (
                  <>
                  <SortTh label="Farq" column="delta" sort={sort} onSort={onSort} className="hidden text-right md:table-cell" />
                  <SortTh label="Xodim" column="headcount" sort={sort} onSort={onSort} className="hidden text-right lg:table-cell" />
                  <SortTh label="Daromad/xodim" column="perHead" sort={sort} onSort={onSort} className="hidden text-right lg:table-cell" />
                  <th className={cn(TH, 'hidden text-left 2xl:table-cell')}>Foyda, 12 oy</th>
                  <th className={cn(TH, 'pr-5 text-right')} title="So'nggi 12 oyda zarar bilan yopilgan oylar / ma'lumoti bor oylar">
                    Zarar oylari
                  </th>
                  </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {sorted.map((s) => (
                  <UnitRow key={s.unit.key} s={s} rank={rankOf.get(s.unit.key) ?? null} onOpen={open} section={data.section} months={data.months} brief={brief} />
                ))}
              </tbody>
              <tbody>
                <TotalRow label={`Hududlar jami · ${regions.length} ta`} rows={regions} previousProfit={rPrevProfit} brief={brief} />
              </tbody>
              <tbody className="divide-y divide-(--color-line) border-t border-(--color-line)">
                {center && <UnitRow s={center} rank={null} onOpen={open} strong section={data.section} months={data.months} brief={brief} />}
                {segments.map((s) => (
                  <UnitRow key={s.unit.key} s={s} rank={null} onOpen={open} strong section={data.section} months={data.months} brief={brief} />
                ))}
                {unassigned && <UnitRow s={unassigned} rank={null} onOpen={open} strong section={data.section} months={data.months} brief={brief} />}
              </tbody>
              <tbody>
                <TotalRow label="Korxona bo'yicha jami" rows={all} previousProfit={totalPrevProfit} brief={brief} />
              </tbody>
            </table>
            {!brief && <p className="border-t border-(--color-line) px-5 py-2.5 text-xs text-(--color-text-muted)">
              # — foyda bo&apos;yicha o&apos;rin. Farq — foydaning {data.compareLabel}ga nisbatan o&apos;zgarishi. Xodim — Xodimlar bo&apos;limidagi shu hudud xodimlari (davr ichida ishlaganlar).
              Zarar oylari — so&apos;nggi 12 oyda zarar bilan yopilgan oylar.
            </p>}
          </div>
        )}
        {view === 'pairs' && (
          <div className="space-y-3 px-5 py-4">
            <Legend items={[{ color: TONE.income, label: 'Daromad' }, { color: EXPENSE_BAR, label: 'Xarajat' }]} />
            <PairedBars rows={[...byProfit, ...(center ? [center] : [])]} onOpen={open} />
          </div>
        )}
        {view === 'rating' && (
          <div className="px-5 py-4">
            <ProfitBars rows={byProfit} onOpen={open} />
          </div>
        )}
        {view === 'map' && (
          <div className="space-y-2 px-5 py-4">
            <p className="text-xs leading-relaxed text-(--color-text-muted)">
              Har doira — hudud: o&apos;ngga qancha uzoq — xarajat shuncha katta, yuqoriga — daromad katta. Qizil uzuq chiziq — daromad xarajatga teng joy; undan pastdagi
              (pushti zonadagi) hududlar zararda. Doira kattaligi — xodimlar soni. Kulrang — Markaz.
            </p>
            <RegionScatter rows={withCenter} onOpen={open} />
          </div>
        )}
        {view === 'months' && (
          <div className="space-y-2 px-5 py-4">
            <p className="text-xs leading-relaxed text-(--color-text-muted)">
              Har katak — hududning o&apos;sha oydagi foydasi (daromad − xarajat). Yashil — foyda, qizil — zarar; rang qancha to&apos;q bo&apos;lsa, summa shuncha katta. B —
              mlrd, M — mln, K — ming so&apos;m.
            </p>
            <ProfitHeatmap months={months12} rows={[...byProfit, ...(center ? [center] : [])]} onOpen={open} />
          </div>
        )}
        {view === 'mix' && (
          <div className="space-y-3 px-5 py-4">
            <Legend items={Object.keys(MIX_COLORS).map((k) => ({ color: MIX_COLORS[k]!, label: MIX_LABELS[k]! }))} />
            <ExpenseMix rows={[...byProfit, ...(center ? [center] : [])]} onOpen={open} />
          </div>
        )}
        {view === 'cover' && <CenterCoverView regions={activeRegions} center={center ?? null} onOpen={open} range={data.range} section={data.section} compare={data.compare} />}
      </Card>

      {!brief && (
      <>
      <GroupTitle title="Tahliliy modellar" description={`Solishtirish: ${data.compareLabel}`} />

      <div className="grid gap-4 xl:grid-cols-2">
        <ModelCard
          index={1}
          title="Hududlardan korxona natijasigacha"
          question="Hududlar topgan foyda Markaz xarajatini qoplaydimi?"
          aside={
            <>
              <p className="text-base font-semibold tabular-nums" style={{ color: coverage !== null && coverage >= 100 ? TONE.income : TONE.expense }}>
                {coverage === null ? '—' : pct(coverage)}
              </p>
              <p className="text-[11px] text-(--color-text-muted)">Markazni qoplash</p>
            </>
          }
          howTo="Yuqoridan pastga o'qiladi: hududlarning jami foydasidan Markaz xarajati ayriladi (Markaz daromadi qo'shiladi), so'ng yo'nalishlar (Tax free, Marksheyder …) natijasi, keyin hech qaysi hududga biriktirilmagan yozuvlar. Oxirgi qator — korxonaning umumiy natijasi."
        >
          <Bridge
            steps={[
              { label: 'Hududlar foydasi', value: rProfit, total: true, hint: `${activeRegions.length} ta hudud` },
              ...(center && center.income !== 0 ? [{ label: 'Markaz daromadi', value: center.income }] : []),
              ...(center ? [{ label: 'Markaz xarajati', value: -center.expense, hint: `ish haqi ${compact(center.payroll)}` }] : []),
              ...segments.filter((s) => s.income !== 0 || s.expense !== 0).map((s) => ({ label: `${s.unit.name} natijasi`, value: s.profit, hint: "yo'nalish" })),
              ...(unassigned && unassigned.income !== 0 ? [{ label: 'Biriktirilmagan daromad', value: unassigned.income }] : []),
              ...(unassigned && unassigned.expense !== 0 ? [{ label: 'Biriktirilmagan xarajat', value: -unassigned.expense }] : []),
              { label: 'Korxona natijasi', value: totalIncome - totalExpense, total: true },
            ]}
          />
          {contributors.length > 0 && rProfit > 0 && (
            <div className="mt-4 border-t border-(--color-line) pt-3">
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">Markazni eng ko&apos;p ta&apos;minlayotgan hududlar</h4>
              <ul className="space-y-1.5 text-sm">
                {contributors.map((s) => (
                  <li key={s.unit.key} className="flex items-center justify-between gap-3">
                    <button type="button" className="truncate text-left hover:underline" onClick={() => open(s.unit.key)}>
                      {s.unit.name}
                    </button>
                    <span className="whitespace-nowrap tabular-nums text-(--color-text-muted)">
                      {compact(s.profit)} · <b className="font-medium text-(--color-text)">{pct((s.profit / Math.max(rProfit, 1)) * 100)}</b> hududlar foydasining
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ModelCard>

        <ModelCard
          index={2}
          title="Natijasi o'zgargan hududlar"
          question={`${data.compareLabel[0]!.toUpperCase() + data.compareLabel.slice(1)}ga nisbatan kim yaxshilandi, kim yomonlashdi?`}
          howTo="Farq — hudud foydasining (daromad − xarajat) avvalgi davrdagi foydaga nisbatan o'zgarishi, so'mda. Hududni bosing — kartasi ochiladi."
        >
          <div className="grid gap-5 sm:grid-cols-2">
            {[
              { title: 'Yaxshilanganlar', list: improved },
              { title: 'Yomonlashganlar', list: worsened },
            ].map((group) => {
              const max = Math.max(...movers.map((s) => Math.abs(s.profitDelta)), 1);
              return (
                <div key={group.title}>
                  <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{group.title}</h4>
                  {group.list.length === 0 ? (
                    <p className="py-3 text-sm text-(--color-text-faint)">Yo&apos;q</p>
                  ) : (
                    <ul className="divide-y divide-(--color-line)">
                      {group.list.map((s) => (
                        <li key={s.unit.key}>
                          <button type="button" onClick={() => open(s.unit.key)} className="grid w-full grid-cols-[1fr_auto] items-center gap-x-3 py-2 text-left text-sm hover:bg-(--color-surface-muted)">
                            <span className="min-w-0">
                              <span className="block truncate">{s.unit.name}</span>
                              <span className="mt-1 block h-1 bg-(--color-surface-sunken)">
                                <span className="block h-full" style={{ width: `${(Math.abs(s.profitDelta) / max) * 100}%`, background: s.profitDelta >= 0 ? TONE.income : TONE.expense }} />
                              </span>
                            </span>
                            <span className="text-right">
                              <span className="block font-medium tabular-nums" style={{ color: s.profitDelta >= 0 ? TONE.income : TONE.expense }}>
                                {signed(s.profitDelta)}
                              </span>
                              <span className="block text-xs tabular-nums text-(--color-text-muted)">
                                {compact(s.previousProfit)} → {compact(s.profit)}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </ModelCard>

        <ModelCard
          index={3}
          title="Samaradorlik: bir xodimga daromad va xarajat"
          question="Qaysi hududda bitta xodim ko'proq daromad keltiradi?"
          aside={
            <>
              <p className="text-base font-semibold tabular-nums">{avgIncomePerHead === null ? '—' : compact(avgIncomePerHead)}</p>
              <p className="text-[11px] text-(--color-text-muted)">o&apos;rtacha daromad/xodim</p>
            </>
          }
          howTo="Yashil — bir xodimga to'g'ri keladigan daromad, qizg'ish — bir xodimga xarajat (ish haqi va hudud xarajatlari). Yashil qizg'ishdan uzun bo'lsa, hudud foydada. Vertikal chiziq — hududlar o'rtachasi."
        >
          <div className="space-y-2.5">
            {efficiency.map((s) => (
              <button key={s.unit.key} type="button" onClick={() => open(s.unit.key)} className="grid w-full grid-cols-[minmax(7rem,10rem)_1fr_5.5rem] items-center gap-x-3 text-left text-sm hover:bg-(--color-surface-muted)">
                <span className="truncate" title={s.unit.name}>{s.unit.name}</span>
                <span className="relative block space-y-0.5 py-0.5">
                  {avgIncomePerHead !== null && <span className="absolute inset-y-0 w-px bg-(--color-text)" style={{ left: `${(avgIncomePerHead / effMax) * 100}%` }} />}
                  <span className="block h-2" style={{ width: `${((s.incomePerHead ?? 0) / effMax) * 100}%`, background: TONE.income }} />
                  <span className="block h-2" style={{ width: `${((s.expensePerHead ?? 0) / effMax) * 100}%`, background: EXPENSE_BAR }} />
                </span>
                <span className="text-right text-xs tabular-nums">
                  {compact(s.incomePerHead ?? 0)}
                  <span className="block text-(--color-text-muted)">{compact(s.expensePerHead ?? 0)}</span>
                </span>
              </button>
            ))}
          </div>
        </ModelCard>

        <ModelCard
          index={4}
          title="12 oylik dinamika: hududlar va Markaz"
          question="Hududlar daromadi, xarajati va Markaz xarajati oyma-oy qanday o'zgarmoqda?"
          howTo="Yashil — hududlar jami daromadi, qizg'ish — hududlar jami xarajati, kulrang — Markaz xarajati. Yashil va qizg'ish orasidagi masofa — hududlar foydasi; u kulrang chiziqdan katta bo'lsa, o'sha oy hududlar Markazni to'liq qoplagan."
        >
          <LineChart
            width={600}
            height={280}
            labels={months12.map((m) => formatPeriodShort(m).split(' ')[0]!)}
            tooltipLabels={months12.map((m) => formatPeriod(m))}
            series={[
              { label: 'Hududlar daromadi', color: TONE.income, values: trendSum(activeRegions, 'incomeTrend') },
              { label: 'Hududlar xarajati', color: EXPENSE_BAR, values: trendSum(activeRegions, 'expenseTrend') },
              ...(center ? [{ label: 'Markaz xarajati', color: TONE.slate, values: trendSum([center], 'expenseTrend'), dashed: true }] : []),
            ]}
          />
          <div className="mt-2">
            <Legend
              items={[
                { color: TONE.income, label: 'Hududlar daromadi', line: true },
                { color: EXPENSE_BAR, label: 'Hududlar xarajati', line: true },
                ...(center ? [{ color: TONE.slate, label: 'Markaz xarajati', line: true }] : []),
              ]}
            />
          </div>
        </ModelCard>
      </div>


      </>
      )}

      <RegionCard data={data} stats={openStats} regions={activeRegions} onClose={() => setOpenKey(null)} />
      <UnassignedDrawer open={unOpen} onClose={() => setUnOpen(false)} range={data.range} section={data.section} />
    </div>
  );
}