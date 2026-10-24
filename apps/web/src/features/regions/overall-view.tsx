'use client';

import type { DateRange } from '@/components/shared/date-range-picker';
import { CalcValue } from '@/components/ui/calc';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { compact, pct, RAMP, som, TONE, type CompareMode, type SectionFilter } from '@/features/structure/api';
import { Legend, LineChart, Sparkline } from '@/features/structure/charts';
import { CompareToggle, PanelHeader, SectionToggle, Segmented, SmallButton } from '@/features/structure/parts';
import { changePct, csvPct, csvSom, downloadCsv } from '@/features/structure/stats';
import { calcMargin, calcResult, calcSum, Q, type Calc } from '@/lib/calc';
import { formatDate, formatPeriod, formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useBrief } from '@/lib/view-mode';
import { useRouter } from 'next/navigation';
import { unitByCode } from '@/lib/segments';
import { useMemo, useState, type ReactNode } from 'react';
import { KIND_LABEL, KIND_ORDER, regionsApi, statsOf, type RegionsResult, type RegionUnit, type UnitStats } from './api';
import { centerCover } from './center-cover';
import { UnassignedDrawer } from './unassigned-drawer';
import { Bridge, EXPENSE_BAR } from './regions-charts';
import { CompareTable, CoverTable, FmtToggle, money, MonthsTable, UnitDetail, type Fmt } from './overall-tables';
import { IconChevronRight } from '@/components/ui/icons';
import { Fragment } from 'react';

// ═══════════════════════════════════════════════════════════
// Bosh sahifa › Umumiy (Daromad · Xarajat · Tahlil yonida) — butun korxona bitta ekranda:
// Markaz va barcha hududlar bir jadvalda, bir xil ustunlar bilan.
//   1) Korxona jami: daromad, xarajat, natija — har biri Hududlar | Markaz bo'yicha bo'lingan
//   2) Natija qanday shakllanadi: hududlar foydasi → Markaz → korxona natijasi
//   3) Umumiy jadval: har bir birlik — daromad, xarajat tarkibi (ish haqi, ijara, mashinalar,
//      asosiy vositalar, hududlar uchun, boshqa), natija, rentabellik, o'zgarish, xodimlar, 12 oy
//   4) Taqqoslash (joriy / o'tgan), oylar bo'yicha va Markazni qoplash jadvallari
//   5) Grafiklar — sahifa oxirida: natija ko'prigi, qoplash, ulushlar, 12 oylik dinamika
// Qatorni bosish — o'sha hudud (Solishtirma › Hududlar) yoki Markaz (Solishtirma › Markaz) sahifasiga o'tadi.
// ═══════════════════════════════════════════════════════════

/** Markaz rangi — butun sahifada bir xil */
export const CENTER_COLOR = '#6b5bb5';
const CENTER_SOFT = '#ebe7f7';
/** Hududlar rangi */
const REGIONS_COLOR = RAMP[2]!;
const UNASSIGNED_COLOR = '#9ca3af';
/** Yo'nalishlar ranglari (Tax free, Marksheyder, Fermer xo'jaligi, Buxgalteriya xizmatlari) */
const SEGMENT_COLORS = ['#b45309', '#0f766e', '#4d7c0f', '#be185d'];

type Group = 'PAYROLL' | 'LEASE' | 'VEHICLE' | 'ASSET' | 'REGIONAL' | 'OTHER';
const GROUPS: { key: Group; label: string; short: string; color: string }[] = [
  { key: 'PAYROLL', label: 'Ish haqi', short: 'Ish haqi', color: '#23426a' },
  { key: 'LEASE', label: 'Ijara', short: 'Ijara', color: '#6187b3' },
  { key: 'VEHICLE', label: 'Mashinalar', short: 'Mashina', color: '#b7791f' },
  { key: 'ASSET', label: 'Asosiy vositalar', short: 'Asosiy v.', color: '#4f8a8b' },
  { key: 'REGIONAL', label: "Hududlar uchun (Markaz to'lagan)", short: 'Hudud uchun', color: CENTER_COLOR },
  { key: 'OTHER', label: 'Boshqa xarajatlar', short: 'Boshqa', color: '#aab8cc' },
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
  let sum = 0;
  for (const p of unit.expenseParts) {
    const v = Number(p.amountTiyin);
    mix[groupOf(p.key)] += v;
    sum += v;
  }
  const total = Number(unit.expenseTiyin);
  if (sum === 0 && total !== 0) {
    const payroll = Math.min(Number(unit.payrollTiyin), total);
    mix.PAYROLL = payroll;
    mix.OTHER = total - payroll;
  } else if (Math.abs(total - sum) >= 100) {
    mix.OTHER += total - sum;
  }
  return mix;
}

interface Row {
  s: UnitStats;
  mix: Mix;
  color: string;
  /** Korxona daromadidagi ulushi, % */
  incomeShare: number | null;
  expenseShare: number | null;
}

type SortKey = 'name' | 'income' | 'expense' | 'profit' | 'margin' | 'delta' | 'headcount' | Group;
type MixMode = 'bar' | 'sum' | 'share';

const TH = 'px-2.5 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-(--color-text-muted) whitespace-nowrap';

function signed(value: number): string {
  if (Math.round(value / 100) === 0) return '0';
  return `${value > 0 ? '+' : '−'}${compact(Math.abs(value))}`;
}

function sum(rows: UnitStats[], pick: (s: UnitStats) => number): number {
  return rows.reduce((a, s) => a + pick(s), 0);
}

function trendSum(rows: UnitStats[], key: 'incomeTrend' | 'expenseTrend', last = 12): number[] {
  const len = rows[0]?.unit[key].length ?? 0;
  const out: number[] = [];
  for (let i = Math.max(0, len - last); i < len; i++) out.push(rows.reduce((a, s) => a + Number(s.unit[key][i] ?? 0), 0));
  return out;
}

// ═══════════════════════════════════════════════════════════
// Asosiy komponent
// ═══════════════════════════════════════════════════════════

export function OverallView({ range }: { range: DateRange }) {
  const [section, setSection] = useState<SectionFilter>('ALL');
  const [compare, setCompare] = useState<CompareMode>('prev');
  const brief = useBrief();
  const result = useAsync(() => regionsApi.compare(range, section, compare).then((r) => r.data), [range.from, range.to, section, compare]);
  const data = result.data;

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Umumiy: Markaz va hududlar birga"
        description={
          data
            ? `${formatDate(data.range.from)} — ${formatDate(data.range.to)} · solishtirish: ${data.compareLabel} (${formatDate(data.previousRange.from)} — ${formatDate(data.previousRange.to)})`
            : 'Butun korxona: har bir hudud va Markaz bir xil ko’rsatkichlar bilan yonma-yon'
        }
        actions={data ? <CsvButton data={data} /> : null}
      >
        <div className="flex flex-wrap items-center gap-3">
          <SectionToggle value={section} onChange={setSection} />
          <CompareToggle value={compare} onChange={setCompare} />
          {result.loading && data && <span className="text-xs text-(--color-text-faint)">yangilanmoqda…</span>}
        </div>
      </PanelHeader>

      {result.error ? (
        <Card>
          <ErrorState message={result.error} onRetry={result.reload} />
        </Card>
      ) : !data ? (
        <Card>
          <LoadingState label="Korxona bo'yicha hisoblanmoqda" />
        </Card>
      ) : (
        <Body data={data} brief={brief} />
      )}
    </div>
  );
}

function Body({ data, brief }: { data: RegionsResult; brief: boolean }) {
  const router = useRouter();
  const all = useMemo(() => data.units.map(statsOf), [data]);
  const center = all.find((s) => s.unit.kind === 'center') ?? null;
  const unassigned = all.find((s) => s.unit.kind === 'unassigned' && (s.income !== 0 || s.expense !== 0)) ?? null;
  const regions = all.filter((s) => s.unit.kind === 'region');
  const activeRegions = regions.filter((s) => s.income !== 0 || s.expense !== 0);
  /** Yo'nalishlar (Tax free, Marksheyder …) — ma'lumoti borlari; hududlar ko'rsatkichlariga kirmaydi, korxona jamisiga kiradi */
  const segments = all.filter((s) => s.unit.kind === 'segment' && (s.income !== 0 || s.expense !== 0));
  const units = [...(center ? [center] : []), ...activeRegions, ...segments, ...(unassigned ? [unassigned] : [])];

  const total = {
    income: sum(units, (s) => s.income),
    expense: sum(units, (s) => s.expense),
    previousIncome: sum(units, (s) => s.previousIncome),
    previousExpense: sum(units, (s) => s.previousExpense),
    headcount: units.reduce((a, s) => a + s.unit.headcount, 0),
  };
  const reg = {
    income: sum(activeRegions, (s) => s.income),
    expense: sum(activeRegions, (s) => s.expense),
    previousIncome: sum(activeRegions, (s) => s.previousIncome),
    previousExpense: sum(activeRegions, (s) => s.previousExpense),
  };
  const profit = total.income - total.expense;
  const previousProfit = total.previousIncome - total.previousExpense;
  const regProfit = reg.income - reg.expense;
  const centerNet = center ? center.expense - center.income : 0;

  // Hudud ranglari: foydasi bo'yicha (eng katta — eng to'q)
  const byProfit = [...activeRegions].sort((a, b) => b.profit - a.profit);
  const colorOf = new Map<string, string>();
  byProfit.forEach((s, i) => colorOf.set(s.unit.key, RAMP[Math.min(RAMP.length - 2, Math.round((i * (RAMP.length - 2)) / Math.max(1, byProfit.length - 1)))]!));
  if (center) colorOf.set(center.unit.key, CENTER_COLOR);
  if (unassigned) colorOf.set(unassigned.unit.key, UNASSIGNED_COLOR);
  segments.forEach((s, i) => colorOf.set(s.unit.key, SEGMENT_COLORS[i % SEGMENT_COLORS.length]!));

  const rows: Row[] = units.map((s) => ({
    s,
    mix: mixOf(s.unit),
    color: colorOf.get(s.unit.key) ?? REGIONS_COLOR,
    incomeShare: total.income > 0 ? (s.income / total.income) * 100 : null,
    expenseShare: total.expense > 0 ? (s.expense / total.expense) * 100 : null,
  }));

  /** Biriktirilmagan yozuvlar paneli */
  const [unOpen, setUnOpen] = useState(false);
  const open = (s: UnitStats) => {
    if (s.unit.kind === 'center') router.push('/solishtirma/markaz');
    else if (s.unit.kind === 'region' && s.unit.code !== null) router.push(`/solishtirma?r=${s.unit.code}`);
    else if (s.unit.kind === 'unassigned') setUnOpen(true);
    // Yo'nalish — o'z sahifasi: Solishtirma › Tax free …
    else if (s.unit.kind === 'segment') router.push(s.unit.segment && unitByCode(s.unit.segment) ? `/solishtirma/${unitByCode(s.unit.segment)!.slug}` : '/solishtirma');
  };

  const cover = centerCover(
    activeRegions.map((s) => ({ key: s.unit.key, code: s.unit.code, name: s.unit.name, income: s.income, profit: s.profit })),
    centerNet,
  );

  const months12 = data.months.slice(-12);

  return (
    <>
      <Hero
        total={total}
        reg={reg}
        center={center}
        unassigned={unassigned}
        profit={profit}
        previousProfit={previousProfit}
        regionsCount={activeRegions.length}
        onUnassigned={() => setUnOpen(true)}
      />

      <Matrix rows={rows} total={total} reg={reg} months={data.months} onOpen={open} />

      {!brief && <CompareTable units={units} compareLabel={data.compareLabel} onOpen={open} />}
      {!brief && <MonthsTable units={units} months={data.months} range={data.range} onOpen={open} />}
      {center && activeRegions.length > 0 && (
        <CoverTable cover={cover} onOpenCode={(code) => (code !== null && code !== undefined ? router.push(`/solishtirma?r=${code}`) : undefined)} />
      )}

      {/* ── Grafiklar: jadvallar bilan bir xil ma'lumot, sahifa oxirida ── */}
      <div className="flex flex-wrap items-baseline gap-x-3 pt-2">
        <h2 className="text-base font-semibold text-heading">Grafiklar</h2>
        <p className="text-xs text-(--color-text-muted)">Yuqoridagi jadvallar bilan bir xil ma&apos;lumot</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Card>
          <div className="px-5 pt-4">
            <h3 className="text-sm font-bold text-heading">Korxona natijasi qanday shakllanadi</h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">Hududlar foydasi Markazning sof xarajatini qoplaydi — qolgani korxona natijasi</p>
          </div>
          <div className="px-5 pb-3 pt-2">
            <Bridge
              steps={[
                { label: 'Hududlar daromadi', value: reg.income, hint: `${activeRegions.length} ta hudud` },
                { label: 'Hududlar xarajati', value: -reg.expense },
                { label: 'Hududlar natijasi', value: regProfit, total: true, hint: reg.income > 0 ? `rentabellik ${pct((regProfit / reg.income) * 100)}` : undefined },
                ...(center
                  ? [
                      { label: 'Markaz daromadi', value: center.income },
                      { label: 'Markaz xarajati', value: -center.expense, hint: `ish haqi ${compact(center.payroll)}` },
                    ]
                  : []),
                ...(unassigned ? [{ label: 'Biriktirilmagan yozuvlar', value: unassigned.profit, hint: 'hududi ko’rsatilmagan' }] : []),
                { label: 'Korxona natijasi', value: profit, total: true, hint: total.income > 0 ? `rentabellik ${pct((profit / total.income) * 100)}` : undefined },
              ]}
            />
          </div>
        </Card>
        <CoverCard cover={cover} centerNet={centerNet} regProfit={regProfit} />
      </div>

      {!brief && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <div className="px-5 pt-4">
              <h3 className="text-sm font-bold text-heading">Kim qancha ulush qo&apos;shadi</h3>
              <p className="mt-0.5 text-xs text-(--color-text-muted)">Korxona daromadi va xarajatida har bir birlikning ulushi. Segmentni bosing — o&apos;sha birlikka o&apos;tadi</p>
            </div>
            <div className="space-y-5 px-5 pb-5 pt-4">
              <ShareRibbon title="Daromad" rows={rows} value={(r) => r.s.income} total={total.income} onOpen={open} />
              <ShareRibbon title="Xarajat" rows={rows} value={(r) => r.s.expense} total={total.expense} onOpen={open} />
              <ShareRibbon title="Xodimlar" rows={rows} value={(r) => r.s.unit.headcount} total={total.headcount} onOpen={open} count />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-(--color-text-muted)">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: CENTER_COLOR }} />
                  Markaz
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-8 rounded-sm" style={{ background: `linear-gradient(90deg, ${RAMP[0]}, ${RAMP[RAMP.length - 2]})` }} />
                  Hududlar — to&apos;q rang: foydasi katta, och: kichik
                </span>
                {rows.some((r) => r.s.unit.kind === 'unassigned') && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: UNASSIGNED_COLOR }} />
                    Biriktirilmagan
                  </span>
                )}
                <span className="text-(--color-text-faint)">Segment ustiga olib boring — nomi va summasi</span>
              </div>
            </div>
          </Card>
          <Card>
            <div className="px-5 pt-4">
              <h3 className="text-sm font-bold text-heading">12 oylik dinamika: korxona, hududlar va Markaz</h3>
              <p className="mt-0.5 text-xs text-(--color-text-muted)">Yashil va qizg&apos;ish orasidagi masofa — korxona foydasi; ko&apos;k — hududlar natijasi; binafsha — Markaz sof xarajati</p>
            </div>
            <div className="px-3 pb-4 pt-2">
              <LineChart
                width={620}
                height={270}
                labels={months12.map((m) => formatPeriodShort(m).split(' ')[0]!)}
                tooltipLabels={months12.map((m) => formatPeriod(m))}
                series={[
                  { label: 'Korxona daromadi', color: TONE.income, values: trendSum(units, 'incomeTrend') },
                  { label: 'Korxona xarajati', color: EXPENSE_BAR, values: trendSum(units, 'expenseTrend') },
                  {
                    label: 'Hududlar natijasi',
                    color: REGIONS_COLOR,
                    values: trendSum(activeRegions, 'incomeTrend').map((v, i) => v - trendSum(activeRegions, 'expenseTrend')[i]!),
                  },
                  ...(center
                    ? [{ label: 'Markaz sof xarajati', color: CENTER_COLOR, dashed: true, values: trendSum([center], 'expenseTrend').map((v, i) => v - trendSum([center], 'incomeTrend')[i]!) }]
                    : []),
                ]}
              />
              <div className="mt-2 px-2">
                <Legend
                  items={[
                    { color: TONE.income, label: 'Korxona daromadi', line: true },
                    { color: EXPENSE_BAR, label: 'Korxona xarajati', line: true },
                    { color: REGIONS_COLOR, label: 'Hududlar natijasi', line: true },
                    ...(center ? [{ color: CENTER_COLOR, label: 'Markaz sof xarajati', line: true }] : []),
                  ]}
                />
              </div>
            </div>
          </Card>
        </div>
      )}


      {data.notes.length > 0 && !brief && (
        <Card className="px-5 py-3">
          <ul className="list-disc space-y-1 pl-4 text-xs text-(--color-text-muted)">
            {data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Card>
      )}

      <UnassignedDrawer open={unOpen} onClose={() => setUnOpen(false)} range={data.range} section={data.section} />
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// 1. Korxona jami — uchta katta raqam, har biri Hududlar | Markaz bo'yicha bo'lingan
// ═══════════════════════════════════════════════════════════

function Hero({
  total,
  reg,
  center,
  unassigned,
  profit,
  previousProfit,
  regionsCount,
  onUnassigned,
}: {
  total: { income: number; expense: number; previousIncome: number; previousExpense: number; headcount: number };
  reg: { income: number; expense: number };
  center: UnitStats | null;
  unassigned: UnitStats | null;
  profit: number;
  previousProfit: number;
  regionsCount: number;
  onUnassigned: () => void;
}) {
  const margin = total.income > 0 ? (profit / total.income) * 100 : null;
  const prevMargin = total.previousIncome > 0 ? (previousProfit / total.previousIncome) * 100 : null;
  const parts = (pick: (s: UnitStats) => number, regValue: number) => [
    { label: `Hududlar (${regionsCount})`, value: regValue, color: REGIONS_COLOR },
    ...(center ? [{ label: 'Markaz', value: pick(center), color: CENTER_COLOR }] : []),
    ...(unassigned ? [{ label: 'Biriktirilmagan', value: pick(unassigned), color: UNASSIGNED_COLOR, onClick: onUnassigned }] : []),
  ];
  const incomeParts = parts((s) => s.income, reg.income);
  const expenseParts = parts((s) => s.expense, reg.expense);
  const sumCalc = (title: string, ps: { label: string; value: number }[]): Calc => calcSum(title, ps.map((p) => Q.money(p.label, p.value, 'Solishtirma')));

  return (
    <Card className="overflow-hidden">
      <div className="relative bg-gradient-to-br from-[#16294a] via-[#23426a] to-[#3b3478] px-5 py-5 text-white">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-24 right-40 h-48 w-48 rounded-full bg-white/5" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">Butun korxona</p>
            <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight md:text-4xl">
              <CalcValue calc={calcResult(total.income, total.expense, { title: 'Korxona natijasi' })}>
                <span className={profit < 0 ? 'text-[#ffb4ae]' : undefined}>{signed(profit)}</span>
              </CalcValue>
              <span className="ml-2 text-base font-medium text-white/70">so&apos;m natija</span>
            </p>
            <p className="mt-1 text-sm text-white/70">
              rentabellik{' '}
              <CalcValue calc={calcMargin(total.income, total.expense)}>
                <b className="text-white">{pct(margin)}</b>
              </CalcValue>
              {prevMargin !== null && margin !== null && (
                <span className="ml-2 text-white/60">
                  (oldin {pct(prevMargin)}, {margin - prevMargin >= 0 ? '+' : '−'}
                  {Math.abs(margin - prevMargin).toFixed(1).replace('.', ',')} p.p.)
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Chip color="#7ea6d8" label="Hududlar" value={`${regionsCount} ta`} />
            {center && <Chip color={CENTER_COLOR} label="Markaz" value={`${center.unit.headcount} xodim`} />}
            <Chip color="#94a3b8" label="Jami xodim" value={String(total.headcount)} />
          </div>
        </div>
      </div>

      <div className="grid divide-y divide-(--color-line) md:grid-cols-3 md:divide-x md:divide-y-0">
        <HeroCell
          label="Daromad"
          value={total.income}
          previous={total.previousIncome}
          good="up"
          parts={incomeParts}
          calc={sumCalc('Korxona daromadi', incomeParts)}
        />
        <HeroCell
          label="Xarajat"
          value={total.expense}
          previous={total.previousExpense}
          good="down"
          parts={expenseParts}
          calc={sumCalc('Korxona xarajati', expenseParts)}
        />
        <HeroCell
          label="Natija"
          value={profit}
          previous={previousProfit}
          good="up"
          parts={[
            { label: 'Hududlar', value: reg.income - reg.expense, color: REGIONS_COLOR },
            ...(center ? [{ label: 'Markaz', value: center.profit, color: CENTER_COLOR }] : []),
            ...(unassigned ? [{ label: 'Biriktirilmagan', value: unassigned.profit, color: UNASSIGNED_COLOR, onClick: onUnassigned }] : []),
          ]}
          calc={calcResult(total.income, total.expense, { title: 'Korxona natijasi' })}
          signedParts
        />
      </div>
    </Card>
  );
}

function Chip({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 ring-1 ring-white/15 backdrop-blur">
      <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white/70" style={{ background: color }} />
      <span className="text-white/70">{label}</span>
      <b className="tabular-nums">{value}</b>
    </span>
  );
}

function HeroCell({
  label,
  value,
  previous,
  good,
  parts,
  calc,
  signedParts = false,
}: {
  label: string;
  value: number;
  previous: number;
  good: 'up' | 'down';
  parts: { label: string; value: number; color: string; onClick?: () => void }[];
  calc: Calc;
  signedParts?: boolean;
}) {
  const change = changePct(value, previous);
  const better = change === null || Math.abs(change) < 0.5 ? null : change > 0 === (good === 'up');
  // Natijada manfiy qism bo'lishi mumkin — chiziq faqat musbatlar bo'yicha, manfiylar alohida ko'rsatiladi
  const positive = parts.filter((p) => p.value > 0);
  const base = positive.reduce((a, p) => a + p.value, 0);
  return (
    <div className="px-5 py-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)">{label}</p>
        <span className={cn('text-xs font-semibold tabular-nums', better === null ? 'text-(--color-text-muted)' : better ? 'text-(--color-income)' : 'text-(--color-expense)')}>
          {change === null ? '—' : `${change > 0 ? '▲' : change < 0 ? '▼' : ''} ${pct(change, true)}`}
        </span>
      </div>
      <p className={cn('mt-1 text-2xl font-bold tabular-nums tracking-tight text-heading', label === 'Natija' && value < 0 && 'text-(--color-expense)')} title={som(value)}>
        <CalcValue calc={calc}>{signedParts ? signed(value) : compact(value)}</CalcValue>
      </p>
      <p className="text-xs text-(--color-text-faint)">oldin: {signedParts ? signed(previous) : compact(previous)}</p>
      <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-(--color-surface-muted)">
        {base > 0 &&
          positive.map((p) => (
            <span key={p.label} className="h-full transition-all" style={{ width: `${(p.value / base) * 100}%`, background: p.color }} title={`${p.label}: ${compact(p.value)}`} />
          ))}
      </div>
      <ul className="mt-2.5 space-y-1">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: p.color }} />
              {p.onClick ? (
                <button type="button" onClick={p.onClick} className="truncate text-brand-700 underline decoration-dotted underline-offset-2 hover:decoration-solid" title="Ichida nima borligini ko'rish">
                  {p.label} ›
                </button>
              ) : (
                <span className="truncate text-(--color-text-muted)">{p.label}</span>
              )}
            </span>
            <span className="flex items-baseline gap-2 tabular-nums">
              <b className={cn('font-semibold', p.value < 0 && 'text-(--color-expense)')}>{signedParts ? signed(p.value) : compact(p.value)}</b>
              <span className="w-12 text-right text-(--color-text-faint)">{!signedParts && value > 0 ? pct((p.value / value) * 100) : ''}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 2. Markazni qoplash — halqa
// ═══════════════════════════════════════════════════════════

function CoverCard({ cover, centerNet, regProfit }: { cover: ReturnType<typeof centerCover>; centerNet: number; regProfit: number }) {
  const covered = centerNet > 0 ? Math.min(100, (cover.covered / centerNet) * 100) : 100;
  const ratio = cover.coverPct;
  const R = 52;
  const C = 2 * Math.PI * R;
  const losers = cover.rows.filter((r) => r.status === 'none');
  return (
    <Card>
      <div className="px-5 pt-4">
        <h3 className="text-sm font-bold text-heading">Hududlar Markazni qoplaydimi?</h3>
        <p className="mt-0.5 text-xs text-(--color-text-muted)">Markaz sof xarajati (xarajat − o&apos;z daromadi) hududlar foydasi bilan solishtiriladi</p>
      </div>
      <div className="flex flex-wrap items-center gap-5 px-5 pb-5 pt-3">
        <svg width={132} height={132} viewBox="0 0 132 132" className="shrink-0" aria-hidden>
          <circle cx={66} cy={66} r={R} fill="none" stroke={CENTER_SOFT} strokeWidth={14} />
          <circle
            cx={66}
            cy={66}
            r={R}
            fill="none"
            stroke={covered >= 99.95 ? TONE.income : CENTER_COLOR}
            strokeWidth={14}
            strokeLinecap="round"
            strokeDasharray={`${(covered / 100) * C} ${C}`}
            transform="rotate(-90 66 66)"
          />
          <text x={66} y={62} textAnchor="middle" className="fill-(--color-text) text-[20px] font-bold tabular-nums">
            {centerNet > 0 ? pct(ratio) : '—'}
          </text>
          <text x={66} y={80} textAnchor="middle" className="fill-(--color-text-muted) text-[10px]">
            qoplash
          </text>
        </svg>
        <dl className="grid min-w-[14rem] flex-1 grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-(--color-text-muted)">Markaz sof xarajati</dt>
          <dd className="text-right font-semibold tabular-nums" style={{ color: CENTER_COLOR }}>{compact(centerNet)}</dd>
          <dt className="text-(--color-text-muted)">Hududlar natijasi</dt>
          <dd className={cn('text-right font-semibold tabular-nums', regProfit < 0 && 'text-(--color-expense)')}>{signed(regProfit)}</dd>
          <dt className="text-(--color-text-muted)">Teng ulush (har hududga)</dt>
          <dd className="text-right tabular-nums">{compact(cover.equalShare)}</dd>
          {cover.shortfall > 0 ? (
            <>
              <dt className="text-(--color-expense)">Yetishmovchilik</dt>
              <dd className="text-right font-semibold tabular-nums text-(--color-expense)">{compact(cover.shortfall)}</dd>
            </>
          ) : (
            <>
              <dt className="text-(--color-income)">Qoplagandan ortgan foyda</dt>
              <dd className="text-right font-semibold tabular-nums text-(--color-income)">{compact(cover.surplus)}</dd>
            </>
          )}
          <dt className="col-span-2 mt-1 text-xs text-(--color-text-faint)">
            {cover.equalLosers > 0
              ? `Teng bo'linsa ${cover.equalLosers} ta hudud zararga tushadi.`
              : "Teng bo'linsa ham hech bir hudud zararga tushmaydi."}
            {losers.length > 0 && ` Zarardagi hududlar: ${losers.map((r) => r.name).join(', ')}.`}
          </dt>
        </dl>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════
// 3. Umumiy jadval — Markaz va barcha hududlar bir xil ustunlar bilan
// ═══════════════════════════════════════════════════════════

function Matrix({
  rows,
  total,
  reg,
  months,
  onOpen,
}: {
  rows: Row[];
  total: { income: number; expense: number; previousIncome: number; previousExpense: number; headcount: number };
  reg: { income: number; expense: number; previousIncome: number; previousExpense: number };
  months: string[];
  onOpen: (s: UnitStats) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'profit', dir: 'desc' });
  const [mode, setMode] = useState<MixMode>('bar');
  const [pinCenter, setPinCenter] = useState(true);
  const [fmt, setFmt] = useState<Fmt>('short');
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggleOpen = (key: string) => setOpened((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const sgn = (v: number) => (Math.round(v / 100) === 0 ? '0' : `${v > 0 ? '+' : '−'}${money(Math.abs(v), fmt)}`);

  const groups = GROUPS.filter((g) => rows.some((r) => Math.round(r.mix[g.key] / 100) !== 0));
  const colMax = Object.fromEntries(groups.map((g) => [g.key, Math.max(1, ...rows.map((r) => (mode === 'share' ? (r.s.expense > 0 ? r.mix[g.key] / r.s.expense : 0) : Math.abs(r.mix[g.key]))))])) as Record<Group, number>;
  const maxIncome = Math.max(1, ...rows.map((r) => r.s.income));

  const value = (r: Row, key: SortKey): number | string => {
    switch (key) {
      case 'name':
        return r.s.unit.name.toLowerCase();
      case 'income':
        return r.s.income;
      case 'expense':
        return r.s.expense;
      case 'margin':
        return r.s.margin ?? Number.NEGATIVE_INFINITY;
      case 'delta':
        return r.s.profitDelta;
      case 'headcount':
        return r.s.unit.headcount;
      case 'profit':
        return r.s.profit;
      default:
        return r.mix[key];
    }
  };
  const sorted = [...rows].sort((a, b) => {
    if (pinCenter) {
      const ra = KIND_ORDER[a.s.unit.kind];
      const rb = KIND_ORDER[b.s.unit.kind];
      if (ra !== rb) return ra - rb;
    }
    const va = value(a, sort.key);
    const vb = value(b, sort.key);
    const c = typeof va === 'string' ? va.localeCompare(String(vb)) : (va as number) - (vb as number);
    return sort.dir === 'asc' ? c : -c;
  });
  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));

  const regionRows = rows.filter((r) => r.s.unit.kind === 'region');
  const totalMix = emptyMix();
  const regMix = emptyMix();
  for (const r of rows) for (const g of GROUPS) totalMix[g.key] += r.mix[g.key];
  for (const r of regionRows) for (const g of GROUPS) regMix[g.key] += r.mix[g.key];
  const regHead = regionRows.reduce((a, r) => a + r.s.unit.headcount, 0);
  const regProfit = reg.income - reg.expense;
  const profit = total.income - total.expense;

  const cols = mode === 'bar' ? [] : groups;

  /** Xarajat tarkibi — bitta 100% chiziq, guruh ranglarida */
  const mixBar = (m: Mix, expense: number) => {
    const base = groups.reduce((a, g) => a + Math.max(0, m[g.key]), 0);
    if (base <= 0) return <span className="text-(--color-text-faint)">—</span>;
    const tip = groups
      .filter((g) => Math.round(m[g.key] / 100) !== 0)
      .map((g) => `${g.label}: ${compact(m[g.key])} (${pct(expense > 0 ? (m[g.key] / expense) * 100 : null)})`)
      .join('\n');
    const payroll = expense > 0 ? (m.PAYROLL / expense) * 100 : null;
    return (
      <span className="flex items-center gap-2" title={tip}>
        <span className="flex h-3 w-36 overflow-hidden rounded-full bg-(--color-surface-muted)">
          {groups.map((g) =>
            m[g.key] > 0 ? <span key={g.key} className="h-full border-r border-white/60 last:border-r-0" style={{ width: `${(m[g.key] / base) * 100}%`, background: g.color }} /> : null,
          )}
        </span>
        <span className="w-12 text-[10.5px] tabular-nums text-(--color-text-faint)" title="Ish haqi ulushi">
          {payroll !== null ? `ih ${Math.round(payroll)}%` : ''}
        </span>
      </span>
    );
  };

  const Sort = ({ label, k, className, title }: { label: ReactNode; k: SortKey; className?: string; title?: string }) => (
    <th className={cn(TH, className)} title={title}>
      <button type="button" onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 uppercase hover:text-(--color-text)', sort.key === k && 'text-(--color-text)')}>
        {label}
        <span className="text-[9px]">{sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );

  const mixCell = (m: Mix, expense: number, g: Group, heat: boolean) => {
    const v = m[g];
    const share = expense > 0 ? v / expense : 0;
    const intensity = heat ? Math.min(1, Math.abs(mode === 'share' ? share : v) / colMax[g]) : 0;
    const color = GROUPS.find((x) => x.key === g)!.color;
    return (
      <td key={g} className="relative px-2.5 py-2 text-right tabular-nums" title={`${GROUPS.find((x) => x.key === g)!.label}: ${som(v)}${expense > 0 ? ` · xarajatning ${pct(share * 100)}` : ''}`}>
        {heat && intensity > 0 && <span className="absolute inset-0.5 rounded" style={{ background: color, opacity: 0.04 + intensity * 0.18 }} />}
        <span className={cn('relative', Math.round(v / 100) === 0 && 'text-(--color-text-faint)')}>
          {Math.round(v / 100) === 0 ? '—' : mode === 'share' ? pct(share * 100) : money(v, fmt)}
        </span>
      </td>
    );
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div>
          <h3 className="text-sm font-bold text-heading">Umumiy jadval: Markaz va hududlar</h3>
          <p className="mt-0.5 text-xs text-(--color-text-muted)">
            Bir xil ustunlar — bir xil hisob. ▸ — qator ichida daromad va xarajat tarkibi (joriy / o&apos;tgan / o&apos;zgarish). Qatorni bosing — birlik sahifasi
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FmtToggle value={fmt} onChange={setFmt} />
          <Segmented
            value={mode}
            options={[
              { value: 'bar', label: 'Tarkib chizig\u2019i' },
              { value: 'sum', label: 'Ustunlarda: summa' },
              { value: 'share', label: 'Ustunlarda: %' },
            ]}
            onChange={setMode}
          />
          <SmallButton onClick={() => setPinCenter((v) => !v)} className={cn(pinCenter && 'border-(--color-text-faint)')}>
            {pinCenter ? 'Markaz tepada' : 'Markaz saralanadi'}
          </SmallButton>
        </div>
      </div>
      {mode === 'bar' && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-2.5 text-[11px] text-(--color-text-muted)">
          <span className="text-(--color-text-faint)">Xarajat tarkibi:</span>
          {groups.map((g) => (
            <span key={g.key} className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: g.color }} />
              {g.label}
            </span>
          ))}
          <span className="text-(--color-text-faint)">· «ih» — ish haqi ulushi</span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={cn('w-full border-collapse whitespace-nowrap text-[13px]', mode === 'bar' ? 'min-w-[980px]' : 'min-w-[1180px]')}>
          <thead>
            <tr className="border-y border-(--color-line) bg-(--color-surface-muted)">
              <th className={cn(TH, 'w-8 text-center')}>#</th>
              <Sort label="Birlik" k="name" className="sticky left-0 z-10 bg-(--color-surface-muted) text-left" />
              <Sort label="Daromad" k="income" className="text-left" />
              {mode === 'bar' && <th className={cn(TH, 'text-left')}>Xarajat tarkibi</th>}
              {cols.map((g) => (
                <Sort
                  key={g.key}
                  k={g.key}
                  title={g.label}
                  className="text-right"
                  label={
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: g.color }} />
                      {g.short}
                    </span>
                  }
                />
              ))}
              <Sort label="Xarajat" k="expense" className="text-right" />
              <Sort label="Natija" k="profit" className="text-right" />
              <Sort label="Rent." k="margin" className="text-right" title="Rentabellik: natija ÷ daromad" />
              <Sort label="Δ natija" k="delta" className="text-right" title="Natijaning oldingi davrga nisbatan o'zgarishi" />
              <Sort label="Xodim" k="headcount" className="text-right" />
              <th className={cn(TH, 'text-left')}>12 oy natija</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const s = r.s;
              const isCenter = s.unit.kind === 'center';
              const isUn = s.unit.kind === 'unassigned';
              const clickable = true;
              const isOpen = opened.has(s.unit.key);
              return (
                <Fragment key={s.unit.key}>
                <tr
                  onClick={clickable ? () => onOpen(s) : undefined}
                  className={cn(
                    'group border-b border-(--color-line) transition-colors',
                    clickable && 'cursor-pointer hover:bg-(--color-surface-muted)',
                    isCenter && 'bg-[#f6f4fc]',
                  )}
                >
                  <td className="px-2 py-2 text-center text-xs text-(--color-text-faint) tabular-nums">{isCenter || isUn ? '' : i + 1 - (pinCenter && sorted[0]?.s.unit.kind === 'center' ? 1 : 0)}</td>
                  <td className={cn('sticky left-0 z-[1] max-w-[13rem] px-2.5 py-2', isCenter ? 'bg-[#f6f4fc]' : 'bg-(--color-surface) group-hover:bg-(--color-surface-muted)')}>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleOpen(s.unit.key);
                        }}
                        aria-expanded={isOpen}
                        title="Tarkibini ochish"
                        className="flex size-6 shrink-0 items-center justify-center rounded text-(--color-text-muted) hover:bg-brand-50 hover:text-brand-700"
                      >
                        <IconChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} />
                      </button>
                      <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: r.color }} />
                      <span className="min-w-0">
                        <span className={cn('block truncate font-medium', isCenter && 'font-semibold')} style={isCenter ? { color: CENTER_COLOR } : undefined}>
                          {s.unit.name}
                        </span>
                        <span className="block text-[10.5px] text-(--color-text-faint)">
                          {isCenter ? "Markaz · bo'limlar" : isUn ? <span className="font-medium text-brand-700 group-hover:underline">hududi ko&apos;rsatilmagan · ichini ko&apos;rish ›</span> : 'Hudud'}
                        </span>
                      </span>
                    </span>
                  </td>
                  <td className="px-2.5 py-2">
                    <span className="flex items-center gap-2">
                      <span className="relative h-2 w-10 shrink-0 overflow-hidden rounded-full bg-(--color-surface-muted)">
                        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(Math.max(0, s.income) / maxIncome) * 100}%`, background: TONE.income, opacity: 0.75 }} />
                      </span>
                      <span className="tabular-nums" title={som(s.income)}>{money(s.income, fmt)}</span>
                      <span className="text-[10.5px] text-(--color-text-faint) tabular-nums">{pct(r.incomeShare)}</span>
                    </span>
                  </td>
                  {mode === 'bar' && <td className="px-2.5 py-2">{mixBar(r.mix, s.expense)}</td>}
                  {cols.map((g) => mixCell(r.mix, s.expense, g.key, true))}
                  <td className="px-2.5 py-2 text-right font-medium tabular-nums" title={som(s.expense)}>
                    {money(s.expense, fmt)}
                    <span className="block text-[10.5px] font-normal text-(--color-text-faint)">{pct(r.expenseShare)}</span>
                  </td>
                  <td className="px-2.5 py-2 text-right">
                    <span
                      className="inline-block rounded-md px-2 py-0.5 font-semibold tabular-nums"
                      style={{ background: s.profit >= 0 ? TONE.incomeSoft : TONE.expenseSoft, color: s.profit >= 0 ? TONE.income : TONE.expense }}
                      title={som(s.profit)}
                    >
                      {sgn(s.profit)}
                    </span>
                  </td>
                  <td
                    className={cn('px-2.5 py-2 text-right tabular-nums', !isCenter && s.margin !== null && s.margin < 0 && 'text-(--color-expense)')}
                    title={isCenter ? "Markaz asosan xizmat ko'rsatadi — uning rentabelligi ma'noli emas; uni hududlar foydasi qoplaydi" : undefined}
                  >
                    {isCenter ? <span className="text-(--color-text-faint)">—</span> : pct(s.margin)}
                  </td>
                  <td className={cn('px-2.5 py-2 text-right text-xs tabular-nums', s.profitDelta > 0 ? 'text-(--color-income)' : s.profitDelta < 0 ? 'text-(--color-expense)' : 'text-(--color-text-muted)')}>
                    {sgn(s.profitDelta)}
                  </td>
                  <td className="px-2.5 py-2 text-right tabular-nums">{s.unit.headcount || '—'}</td>
                  <td className="px-2.5 py-2">
                    <Sparkline values={s.profitTrend.slice(-12).map(String)} color={s.profit >= 0 ? TONE.income : TONE.expense} width={84} height={22} />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-(--color-line) bg-(--color-surface-muted)/60">
                    <td colSpan={9 + (mode === 'bar' ? 1 : cols.length)} className="whitespace-normal px-6 py-3">
                      <UnitDetail s={s} fmt={fmt} onOpen={() => onOpen(s)} />
                    </td>
                  </tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <TotalRow
              label="Hududlar jami"
              sub={`${regionRows.length} ta hudud`}
              color={REGIONS_COLOR}
              income={reg.income}
              incomeShare={total.income > 0 ? (reg.income / total.income) * 100 : null}
              mix={regMix}
              expense={reg.expense}
              expenseShare={total.expense > 0 ? (reg.expense / total.expense) * 100 : null}
              profit={regProfit}
              previousProfit={reg.previousIncome - reg.previousExpense}
              headcount={regHead}
              groups={cols.map((g) => g.key)}
              cell={mixCell}
              bar={mode === 'bar' ? mixBar : null}
              fmt={fmt}
            />
            <TotalRow
              label="Korxona jami"
              sub="Markaz + hududlar"
              color="#0f172a"
              strong
              income={total.income}
              incomeShare={total.income > 0 ? 100 : null}
              mix={totalMix}
              expense={total.expense}
              expenseShare={total.expense > 0 ? 100 : null}
              profit={profit}
              previousProfit={total.previousIncome - total.previousExpense}
              headcount={total.headcount}
              groups={cols.map((g) => g.key)}
              cell={mixCell}
              bar={mode === 'bar' ? mixBar : null}
              fmt={fmt}
            />
          </tfoot>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-(--color-line) px-5 py-2.5 text-[11px] text-(--color-text-faint)">
        {months.length > 0 && <span>«12 oy natija» chizig&apos;i: {formatPeriod(months[Math.max(0, months.length - 12)]!)} — {formatPeriod(months[months.length - 1]!)}</span>}
        <span>«Hudud uchun» — Markaz Xarajatlar siyosati bo&apos;yicha hududlar nomidan to&apos;lagan xarajatlar</span>
      </div>
    </Card>
  );
}

function TotalRow({
  label,
  sub,
  color,
  strong = false,
  income,
  incomeShare,
  mix,
  expense,
  expenseShare,
  profit,
  previousProfit,
  headcount,
  groups,
  cell,
  bar,
  fmt,
}: {
  label: string;
  sub: string;
  color: string;
  strong?: boolean;
  income: number;
  incomeShare: number | null;
  mix: Mix;
  expense: number;
  expenseShare: number | null;
  profit: number;
  previousProfit: number;
  headcount: number;
  groups: Group[];
  cell: (m: Mix, expense: number, g: Group, heat: boolean) => ReactNode;
  bar: ((m: Mix, expense: number) => ReactNode) | null;
  fmt: Fmt;
}) {
  const sgn = (v: number) => (Math.round(v / 100) === 0 ? '0' : `${v > 0 ? '+' : '−'}${money(Math.abs(v), fmt)}`);
  const margin = income > 0 ? (profit / income) * 100 : null;
  const delta = profit - previousProfit;
  const bg = strong ? 'bg-[#eef2f8]' : 'bg-(--color-surface-muted)';
  return (
    <tr className={cn('border-b border-(--color-line)', bg, strong && 'border-t-2 border-t-(--color-text-faint)')}>
      <td />
      <td className={cn('sticky left-0 z-[1] px-2.5 py-2.5', bg)}>
        <span className="flex items-center gap-2">
          <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: color }} />
          <span>
            <span className={cn('block font-semibold', strong && 'font-bold text-heading')}>{label}</span>
            <span className="block text-[10.5px] text-(--color-text-faint)">{sub}</span>
          </span>
        </span>
      </td>
      <td className="px-2.5 py-2.5 font-semibold tabular-nums" title={som(income)}>
        {money(income, fmt)} <span className="text-[10.5px] font-normal text-(--color-text-faint)">{pct(incomeShare)}</span>
      </td>
      {bar && <td className="px-2.5 py-2.5">{bar(mix, expense)}</td>}
      {groups.map((g) => cell(mix, expense, g, false))}
      <td className="px-2.5 py-2.5 text-right font-semibold tabular-nums" title={som(expense)}>
        {money(expense, fmt)}
        <span className="block text-[10.5px] font-normal text-(--color-text-faint)">{pct(expenseShare)}</span>
      </td>
      <td className="px-2.5 py-2.5 text-right font-bold tabular-nums" style={{ color: profit >= 0 ? TONE.income : TONE.expense }} title={som(profit)}>
        {sgn(profit)}
      </td>
      <td className="px-2.5 py-2.5 text-right font-semibold tabular-nums">{pct(margin)}</td>
      <td className={cn('px-2.5 py-2.5 text-right text-xs font-semibold tabular-nums', delta > 0 ? 'text-(--color-income)' : delta < 0 ? 'text-(--color-expense)' : '')}>{sgn(delta)}</td>
      <td className="px-2.5 py-2.5 text-right font-semibold tabular-nums">{headcount}</td>
      <td />
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════
// 4. Ulush lentasi — 100% gorizontal, har birlik o'z rangida
// ═══════════════════════════════════════════════════════════

function ShareRibbon({ title, rows, value, total, onOpen, count = false }: { title: string; rows: Row[]; value: (r: Row) => number; total: number; onOpen: (s: UnitStats) => void; count?: boolean }) {
  const items = rows.map((r) => ({ r, v: Math.max(0, value(r)) })).filter((x) => x.v > 0);
  const base = items.reduce((a, x) => a + x.v, 0);
  // Markaz birinchi, so'ng hududlar rang tartibida (foydasi kattadan — to'qdan ochga), oxirida biriktirilmagan
  const rank = (r: Row) => (r.s.unit.kind === 'center' ? -Infinity : r.s.unit.kind === 'unassigned' ? Infinity : r.s.unit.kind === 'segment' ? 1e15 - r.s.profit : -r.s.profit);
  items.sort((a, b) => rank(a.r) - rank(b.r));
  const center = rows.find((r) => r.s.unit.kind === 'center');
  const centerShare = center && base > 0 ? (Math.max(0, value(center)) / base) * 100 : null;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="font-semibold text-(--color-text)">{title}</span>
        <span className="text-(--color-text-muted)">
          jami <b className="tabular-nums text-(--color-text)">{count ? total : compact(total)}</b>
          {centerShare !== null && (
            <>
              {' · '}
              <span style={{ color: CENTER_COLOR }}>Markaz {pct(centerShare)}</span>
              {' · '}
              <span style={{ color: REGIONS_COLOR }}>hududlar {pct(100 - centerShare)}</span>
            </>
          )}
        </span>
      </div>
      <div className="flex h-7 overflow-hidden rounded-lg ring-1 ring-(--color-line)">
        {base > 0 &&
          items.map(({ r, v }) => {
            const share = (v / base) * 100;
            return (
              <button
                type="button"
                key={r.s.unit.key}
                onClick={() => onOpen(r.s)}
                className="group relative h-full border-r border-white/70 last:border-r-0 hover:brightness-110"
                style={{ width: `${share}%`, background: r.color }}
                title={`${r.s.unit.name}: ${count ? v : compact(v)} (${pct(share)})`}
              >
                {share >= 7 && <span className="absolute inset-0 flex items-center justify-center truncate px-1 text-[10.5px] font-semibold text-white/95">{pct(share)}</span>}
              </button>
            );
          })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// CSV — jadval qanday ko'rinsa, shunday (to'liq summalar)
// ═══════════════════════════════════════════════════════════

function CsvButton({ data }: { data: RegionsResult }) {
  const download = () => {
    const units = data.units.map(statsOf).filter((s) => s.unit.kind !== 'unassigned' || s.income !== 0 || s.expense !== 0);
    const rows = units
      .sort((a, b) => (a.unit.kind === 'center' ? -1 : b.unit.kind === 'center' ? 1 : b.profit - a.profit))
      .map((s) => {
        const m = mixOf(s.unit);
        return [
          s.unit.name,
          KIND_LABEL[s.unit.kind],
          csvSom(s.income),
          ...GROUPS.map((g) => csvSom(m[g.key])),
          csvSom(s.expense),
          csvSom(s.profit),
          csvPct(s.margin),
          csvSom(s.previousProfit),
          s.unit.headcount,
        ];
      });
    const inc = units.reduce((a, s) => a + s.income, 0);
    const exp = units.reduce((a, s) => a + s.expense, 0);
    rows.push(['Korxona jami', '', csvSom(inc), ...GROUPS.map(() => ''), csvSom(exp), csvSom(inc - exp), csvPct(inc > 0 ? ((inc - exp) / inc) * 100 : null), '', units.reduce((a, s) => a + s.unit.headcount, 0)]);
    downloadCsv(
      `umumiy-manba_${data.range.from}_${data.range.to}.csv`,
      ['Birlik', 'Turi', "Daromad (so'm)", ...GROUPS.map((g) => `${g.label} (so'm)`), "Xarajat (so'm)", "Natija (so'm)", 'Rentabellik %', `Natija — ${data.compareLabel} (so'm)`, 'Xodimlar'],
      rows,
    );
  };
  return <SmallButton onClick={download}>CSV yuklab olish</SmallButton>;
}