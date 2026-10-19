'use client';

import { useAsOf } from '@/lib/period';
import { CalcValue } from '@/components/ui/calc';
import { calcDiff, Q } from '@/lib/calc';
import { expenseFactorCalc, incomeFactorCalc, probabilityCalc, scenarioTotalCalc } from './calcs';
import { Card } from '@/components/ui/card';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { Mark } from '@/features/reactions/mark';
import { compact, RAMP, TONE } from '@/features/structure/api';
import { Findings, KpiStrip, ModelCard, PanelHeader, Segmented, SmallButton } from '@/features/structure/parts';
import { csvSom, downloadCsv } from '@/features/structure/stats';
import { formatPeriod, formatPeriodShort } from '@/lib/format';
import { useAsync } from '@/lib/use-async';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { econApi, resultMark, type EconOverview, type RiskUnit, type ScenarioBand, type ScenarioRequest, type ScenarioResult } from './api';

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-(--color-text-muted)';

type Lever = 'headcount' | 'wage' | 'vehicle' | 'lease' | 'other' | 'income';

const LEVERS: { key: Lever; label: string; hint: string }[] = [
  { key: 'headcount', label: 'Xodimlar soni', hint: "Ish haqi xarajati shunga mos o'zgaradi; daromadga ta'sir — elastiklik bo'yicha" },
  { key: 'wage', label: 'Bir xodimga ish haqi', hint: 'Faqat ish haqi xarajatiga' },
  { key: 'vehicle', label: 'Mashina xarajatlari', hint: "Yoqilg'i, ta'mir va boshqalar" },
  { key: 'lease', label: 'Ijara', hint: 'Ijara shartnomalari' },
  { key: 'other', label: 'Qolgan xarajatlar', hint: 'Ish haqi, ijara va mashinadan tashqari barcha xarajatlar' },
  { key: 'income', label: 'Daromad (narx, hajm)', hint: "Daromadni to'g'ridan-to'g'ri o'zgartiradi: narx oshishi, yangi mijozlar" },
];

const PRESETS: { label: string; values: Partial<Record<Lever, number>> }[] = [
  { label: 'Tejash', values: { vehicle: -15, other: -10 } },
  { label: 'Kengayish', values: { headcount: 10 } },
  { label: 'Ish haqi +15%', values: { wage: 15 } },
  { label: 'Narx +5%', values: { income: 5 } },
  { label: 'Inqiroz', values: { income: -15 } },
];

const EMPTY: Record<Lever, number> = { headcount: 0, wage: 0, vehicle: 0, lease: 0, other: 0, income: 0 };

const n = (t: string) => Number(t);
const pctText = (v: number) => `${Math.round(v * 100)}%`;
const signedCompact = (v: number) => `${v >= 0 ? '+' : '−'}${compact(Math.abs(v))}`;

// ═══════════════════════════════════════════════════════════
// Grafik: bazaviy va stsenariy, 80% oraliqlar bilan
// ═══════════════════════════════════════════════════════════

function ScenarioChart({ periods, base, scenario, zeroLine }: { periods: string[]; base: ScenarioBand[]; scenario: ScenarioBand[]; zeroLine: boolean }) {
  const W = 760;
  const H = 280;
  const pad = { l: 66, r: 16, t: 14, b: 28 };
  const all = [...base, ...scenario].flatMap((b) => [n(b.lo80Tiyin), n(b.hi80Tiyin), n(b.meanTiyin)]);
  const lo = Math.min(zeroLine ? 0 : Math.min(...all), ...all);
  const hi = Math.max(1, ...all);
  const span = hi - lo || 1;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const t0 = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = t0; v <= hi + step * 0.001; v += step) ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  if (ticks[ticks.length - 1]! < hi) ticks.push(ticks[ticks.length - 1]! + step);
  const dMin = ticks[0]!;
  const dMax = ticks[ticks.length - 1]!;
  const slot = (W - pad.l - pad.r) / periods.length;
  const x = (i: number) => pad.l + slot * (i + 0.5);
  const y = (v: number) => pad.t + (1 - (v - dMin) / (dMax - dMin || 1)) * (H - pad.t - pad.b);
  const area = (bands: ScenarioBand[]) =>
    [...bands.map((b, i) => `${x(i)},${y(n(b.hi80Tiyin))}`), ...bands.map((b, i) => `${x(i)},${y(n(b.lo80Tiyin))}`).reverse()].join(' ');
  const line = (bands: ScenarioBand[]) => bands.map((b, i) => `${x(i)},${y(n(b.meanTiyin))}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? TONE.ink : TONE.grid} />
          <text x={pad.l - 8} y={y(t) + 3.5} fontSize={10.5} fill={TONE.axis} textAnchor="end">
            {t === 0 ? '0' : compact(t)}
          </text>
        </g>
      ))}
      <rect x={pad.l} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="#f8fafc" />
      <polygon points={area(base)} fill="#cbd5e1" opacity={0.45} />
      <polygon points={area(scenario)} fill={RAMP[6]} opacity={0.3} />
      <polyline points={line(base)} fill="none" stroke={TONE.slate} strokeWidth={2} strokeDasharray="6 4" />
      <polyline points={line(scenario)} fill="none" stroke={RAMP[1]} strokeWidth={2.6} />
      {periods.map((p, i) => (
        <g key={p}>
          <title>{`${formatPeriod(p)}${i === 0 ? ' (joriy oy — bazaviy)' : ''}\nBazaviy: ${compact(base[i]!.meanTiyin)} (80%: ${compact(base[i]!.lo80Tiyin)} … ${compact(base[i]!.hi80Tiyin)})\nStsenariy: ${compact(scenario[i]!.meanTiyin)} (80%: ${compact(scenario[i]!.lo80Tiyin)} … ${compact(scenario[i]!.hi80Tiyin)})`}</title>
          <rect x={x(i) - slot / 2} y={pad.t} width={slot} height={H - pad.t - pad.b} fill="transparent" />
          <circle cx={x(i)} cy={y(n(base[i]!.meanTiyin))} r={3} fill="#fff" stroke={TONE.slate} strokeWidth={1.5} />
          <circle cx={x(i)} cy={y(n(scenario[i]!.meanTiyin))} r={3.5} fill={RAMP[1]} />
          <text x={x(i)} y={H - 9} fontSize={10.5} fill="#6b7280" textAnchor="middle">
            {formatPeriodShort(p)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function LeverSlider({ lever, value, onChange }: { lever: (typeof LEVERS)[number]; value: number; onChange: (v: number) => void }) {
  return (
    <div title={lever.hint}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">{lever.label}</span>
        <span className={cn('text-sm font-semibold tabular-nums', value === 0 && 'text-(--color-text-faint)')}>
          {value > 0 ? '+' : value < 0 ? '−' : ''}
          {Math.abs(value)}%
        </span>
      </div>
      <input type="range" min={-50} max={50} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-slate-800" aria-label={lever.label} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Stsenariy
// ═══════════════════════════════════════════════════════════

export function ScenarioView({ overview }: { overview: EconOverview }) {
  const [unit, setUnit] = useState('all');
  const [horizon, setHorizon] = useState<'3' | '6' | '12'>('6');
  const [levers, setLevers] = useState<Record<Lever, number>>(EMPTY);
  const [useElasticity, setUseElasticity] = useState(true);
  const [view, setView] = useState<'result' | 'income' | 'expense'>('result');
  // Surgich harakatlanayotganda har safar so'rov yubormaslik uchun — kichik kechikish
  const [applied, setApplied] = useState<ScenarioRequest>({ unit: 'all', horizon: 6, ...EMPTY, useElasticity: true });
  useEffect(() => {
    const t = setTimeout(() => setApplied({ unit, horizon: Number(horizon), ...levers, useElasticity }), 400);
    return () => clearTimeout(t);
  }, [unit, horizon, levers, useElasticity]);
  /** Umumiy «Davr» oyi: o'tgan oy bo'lsa — o'sha oy oxiridagi holat */
  const asOf = useAsOf();
  const result = useAsync(() => econApi.scenario(applied, asOf).then((r) => r.data), [JSON.stringify(applied), asOf]);
  const data = result.data;

  const units = [
    { key: 'all', name: 'Butun korxona' },
    ...overview.units.filter((u) => u.kind === 'region' && u.fullMonths >= 6),
    ...overview.units.filter((u) => u.kind === 'center' && u.fullMonths >= 6),
  ];
  const changed = LEVERS.some((l) => levers[l.key] !== 0);

  return (
    <div className="space-y-4">
      <PanelHeader
        title="Stsenariy"
        description="«Agar … bo'lsa, natija qanday bo'ladi?» — xarajat va daromadni o'zgartirib, keyingi oylar natijasini ehtimollar bilan ko'ring"
        actions={
          <select value={unit} onChange={(e) => setUnit(e.target.value)} className="h-8 min-w-[12rem] rounded-(--radius-control) border border-(--color-line) bg-white px-2 text-sm outline-none focus:border-slate-500">
            {units.map((u) => (
              <option key={u.key} value={u.key}>
                {u.name}
              </option>
            ))}
          </select>
        }
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="flex items-center gap-2">
            <span className="text-xs text-(--color-text-muted)">Muddat:</span>
            <Segmented
              value={horizon}
              onChange={setHorizon}
              size="sm"
              options={[
                { value: '3', label: '3 oy' },
                { value: '6', label: '6 oy' },
                { value: '12', label: '12 oy' },
              ]}
            />
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-(--color-text-muted)">Tayyor stsenariylar:</span>
            {PRESETS.map((p) => (
              <SmallButton key={p.label} onClick={() => setLevers({ ...EMPTY, ...p.values })}>
                {p.label}
              </SmallButton>
            ))}
            {changed && <SmallButton onClick={() => setLevers(EMPTY)}>Tozalash</SmallButton>}
          </span>
        </div>
      </PanelHeader>

      <div className="grid gap-4 xl:grid-cols-[20rem_1fr]">
        <Card className="h-fit">
          <div className="border-b border-(--color-line) px-5 py-3.5">
            <h3 className="text-sm font-semibold">O&apos;zgarishlar</h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">Keyingi oydan boshlab, hozirgi darajaga nisbatan</p>
          </div>
          <div className="space-y-4 px-5 py-4">
            {LEVERS.map((l) => (
              <LeverSlider key={l.key} lever={l} value={levers[l.key]} onChange={(v) => setLevers((s) => ({ ...s, [l.key]: v }))} />
            ))}
            <label className="flex items-start gap-2 border-t border-(--color-line) pt-3 text-xs leading-relaxed text-(--color-text-muted)">
              <input type="checkbox" checked={useElasticity} onChange={(e) => setUseElasticity(e.target.checked)} className="mt-0.5 accent-slate-800" />
              <span>
                Xodimlar va xarajatlar o&apos;zgarishining daromadga ta&apos;sirini Omillar modeli (elastiklik) bo&apos;yicha hisoblash. O&apos;chirilsa — faqat xarajat o&apos;zgaradi.
              </span>
            </label>
            {data && (
              <div className="rounded-(--radius-control) bg-(--color-surface-muted) px-3 py-2.5 text-xs leading-relaxed text-(--color-text-muted)">
                <p className="font-semibold text-(--color-text)">Xarajat tarkibi (oxirgi 3 oy)</p>
                <p>
                  Ish haqi {pctText(data.shares.payroll)} · ijara {pctText(data.shares.lease)} · mashinalar {pctText(data.shares.vehicle)} · qolganlari {pctText(data.shares.other)}
                </p>
                <p className="mt-1.5 font-semibold text-(--color-text)">Elastiklik</p>
                <p>
                  Xodimlar: {data.elasticity.headcount.used ? data.elasticity.headcount.value.toFixed(2).replace('.', ',') : 'ishlatilmadi'} · boshqa xarajatlar:{' '}
                  {data.elasticity.nonpayroll.used ? data.elasticity.nonpayroll.value.toFixed(2).replace('.', ',') : 'ishlatilmadi'}
                </p>
              </div>
            )}
          </div>
        </Card>

        <div className="min-w-0 space-y-4">
          {result.error ? (
            <Card>
              <ErrorState message={result.error} onRetry={result.reload} />
            </Card>
          ) : !data ? (
            <Card>
              <LoadingState label="Stsenariy hisoblanmoqda" />
            </Card>
          ) : (
            <ScenarioResultPanel data={data} view={view} setView={setView} />
          )}
        </div>
      </div>

      <RiskPanel />
    </div>
  );
}

function ScenarioResultPanel({ data, view, setView }: { data: ScenarioResult; view: 'result' | 'income' | 'expense'; setView: (v: 'result' | 'income' | 'expense') => void }) {
  const b = data.totals.baseline;
  const s = data.totals.scenario;
  const dR = n(s.resultTiyin) - n(b.resultTiyin);
  const label = { result: 'Natija', income: 'Daromad', expense: 'Xarajat' }[view];
  return (
    <>
      <KpiStrip
        items={[
          {
            label: "Natija o'zgarishi",
            value: signedCompact(dR),
            valueClass: dR > 0 ? 'text-(--color-income)' : dR < 0 ? 'text-(--color-expense)' : undefined,
            calc: calcDiff("Natija o'zgarishi", Q.money('Stsenariy natijasi', s.resultTiyin), Q.money('Bazaviy natija (hech narsa o\'zgarmasa)', b.resultTiyin), {
              note: `${data.horizon} oy jamida. Daromad farqi ${signedCompact(n(s.incomeTiyin) - n(b.incomeTiyin))}, xarajat farqi ${signedCompact(n(s.expenseTiyin) - n(b.expenseTiyin))}.`,
            }),
            sub: (
              <>
                {data.horizon} oy jamida ·{' '}
                <CalcValue calc={incomeFactorCalc(data)}>daromad {signedCompact(n(s.incomeTiyin) - n(b.incomeTiyin))}</CalcValue>,{' '}
                <CalcValue calc={expenseFactorCalc(data)}>xarajat {signedCompact(n(s.expenseTiyin) - n(b.expenseTiyin))}</CalcValue>
              </>
            ),
            mark: <Mark item={resultMark({ key: data.unit, name: data.unitName }, 'Stsenariy')} />,
          },
          {
            label: 'Stsenariy natijasi',
            value: compact(s.resultTiyin),
            calc: scenarioTotalCalc(data),
            sub: `80%: ${compact(s.resultLo80Tiyin)} … ${compact(s.resultHi80Tiyin)} (bazaviy ${compact(b.resultTiyin)})`,
          },
          {
            label: 'Zarar ehtimoli',
            value: `${pctText(b.lossProbability)} → ${pctText(s.lossProbability)}`,
            valueClass: s.lossProbability > b.lossProbability + 0.02 ? 'text-(--color-expense)' : s.lossProbability < b.lossProbability - 0.02 ? 'text-(--color-income)' : undefined,
            sub: 'bazaviy → stsenariy, davr jamida',
            calc: probabilityCalc('Zarar ehtimoli (stsenariy)', s.lossProbability, "davr jami natijasi < 0"),
          },
          {
            label: "Yaxshiroq bo'lish ehtimoli",
            value: pctText(data.totals.betterProbability),
            sub: '2000 ta simulyatsiyada stsenariy bazaviydan yaxshi',
            calc: probabilityCalc("Yaxshiroq bo'lish ehtimoli", data.totals.betterProbability, 'stsenariy natijasi bazaviydan katta'),
          },
        ]}
      />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-(--color-line) px-5 py-3.5">
          <div>
            <h3 className="text-sm font-semibold">
              {data.unitName}: {label.toLowerCase()} — bazaviy va stsenariy
            </h3>
            <p className="mt-0.5 text-xs text-(--color-text-muted)">Soha — 80% ehtimol oralig&apos;i. Birinchi oy (och fon) — joriy oy, o&apos;zgarishsiz.</p>
          </div>
          <Segmented
            value={view}
            onChange={setView}
            size="sm"
            options={[
              { value: 'result', label: 'Natija' },
              { value: 'income', label: 'Daromad' },
              { value: 'expense', label: 'Xarajat' },
            ]}
          />
        </div>
        <div className="px-3 pb-2 pt-3">
          <ScenarioChart periods={data.periods} base={data.baseline[view]} scenario={data.scenario[view]} zeroLine={view !== 'result'} />
        </div>
        <div className="flex flex-wrap gap-x-5 border-t border-(--color-line) px-5 py-2.5 text-xs text-(--color-text-muted)">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0 w-5 border-t-2 border-dashed" style={{ borderColor: TONE.slate }} />
            Bazaviy (hech narsa o&apos;zgarmasa)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-0.5 w-5" style={{ background: RAMP[1] }} />
            Stsenariy
          </span>
        </div>
      </Card>

      <Findings title="Stsenariy xulosasi" notes={data.notes} />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
          <h3 className="text-sm font-semibold">Oylar bo&apos;yicha</h3>
          <SmallButton
            onClick={() =>
              downloadCsv(
                `stsenariy-${data.unit}`,
                ['Oy', 'Bazaviy daromad', 'Bazaviy xarajat', 'Bazaviy natija', 'Stsenariy daromad', 'Stsenariy xarajat', 'Stsenariy natija', 'Zarar ehtimoli %'],
                data.periods.map((p, i) => [
                  p,
                  csvSom(data.baseline.income[i]!.meanTiyin),
                  csvSom(data.baseline.expense[i]!.meanTiyin),
                  csvSom(data.baseline.result[i]!.meanTiyin),
                  csvSom(data.scenario.income[i]!.meanTiyin),
                  csvSom(data.scenario.expense[i]!.meanTiyin),
                  csvSom(data.scenario.result[i]!.meanTiyin),
                  Math.round(data.scenario.lossProbability[i]! * 100),
                ]),
              )
            }
          >
            CSV yuklab olish
          </SmallButton>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-(--color-line) bg-(--color-surface-muted)">
              <tr>
                <th className={cn(TH, 'pl-5 text-left')}>Oy</th>
                <th className={cn(TH, 'text-right')}>Daromad</th>
                <th className={cn(TH, 'text-right')}>Xarajat</th>
                <th className={cn(TH, 'text-right')}>Natija</th>
                <th className={cn(TH, 'text-right')}>Farq</th>
                <th className={cn(TH, 'pr-5 text-right')}>Zarar ehtimoli</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-line)">
              {data.periods.map((p, i) => {
                const d = n(data.scenario.result[i]!.meanTiyin) - n(data.baseline.result[i]!.meanTiyin);
                const lp = data.scenario.lossProbability[i]!;
                return (
                  <tr key={p}>
                    <td className="whitespace-nowrap py-2 pl-5 pr-3">
                      {formatPeriod(p)}
                      {i === 0 && <span className="ml-1 text-[11px] text-(--color-text-faint)">joriy</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{compact(data.scenario.income[i]!.meanTiyin)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-(--color-text-muted)">{compact(data.scenario.expense[i]!.meanTiyin)}</td>
                    <td className={cn('whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums', n(data.scenario.result[i]!.meanTiyin) < 0 && 'text-(--color-expense)')}>
                      {compact(data.scenario.result[i]!.meanTiyin)}
                    </td>
                    <td className={cn('whitespace-nowrap px-3 py-2 text-right tabular-nums', d > 0 ? 'text-(--color-income)' : d < 0 ? 'text-(--color-expense)' : 'text-(--color-text-faint)')}>
                      {Math.abs(d) < 1 ? '—' : signedCompact(d)}
                    </td>
                    <td className={cn('whitespace-nowrap py-2 pl-3 pr-5 text-right tabular-nums', lp >= 0.5 ? 'font-semibold text-(--color-expense)' : lp >= 0.2 ? 'text-amber-700' : 'text-(--color-text-muted)')}>
                      {pctText(lp)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ═══════════════════════════════════════════════════════════
// Risk xaritasi
// ═══════════════════════════════════════════════════════════

const LEVEL: Record<RiskUnit['level'], { label: string; tone: string }> = {
  high: { label: 'Yuqori', tone: 'bg-(--color-expense-soft) text-(--color-expense)' },
  medium: { label: "O'rtacha", tone: 'bg-amber-100 text-amber-800' },
  low: { label: 'Past', tone: 'bg-(--color-income-soft) text-(--color-income)' },
};

function ProbBar({ value }: { value: number }) {
  const color = value >= 0.5 ? TONE.expense : value >= 0.2 ? '#b45309' : TONE.income;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-20 bg-(--color-surface-sunken)">
        <div className="h-full" style={{ width: `${Math.round(value * 100)}%`, background: color }} />
      </div>
      <span className="w-9 text-right text-xs font-semibold tabular-nums" style={{ color }}>
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

function RiskPanel() {
  const [horizon, setHorizon] = useState<'3' | '6' | '12'>('3');
  /** Umumiy «Davr» oyi: o'tgan oy bo'lsa — o'sha oy oxiridagi holat */
  const asOf = useAsOf();
  const result = useAsync(() => econApi.risk(Number(horizon), asOf).then((r) => r.data), [horizon, asOf]);
  const data = result.data;
  return (
    <ModelCard
      index={2}
      title="Risk xaritasi (Monte-Karlo)"
      question="Qaysi hudud keyingi oylarda zararga tushishi mumkin?"
      howTo="Har bir hudud uchun daromad va xarajat 2000 marta simulyatsiya qilinadi (o'zaro bog'liqligi bilan). «Zarar» — davr jamida xarajat daromaddan ko'p bo'lgan holatlar ulushi. «Kamida 1 oy» — birorta oy zararli bo'lishi. «Daromad tushishi» — o'rtacha oylik daromad oxirgi 3 oydan 10% dan ko'proq past bo'lishi."
      aside={
        <Segmented
          value={horizon}
          onChange={setHorizon}
          size="sm"
          options={[
            { value: '3', label: '3 oy' },
            { value: '6', label: '6 oy' },
            { value: '12', label: '12 oy' },
          ]}
        />
      }
    >
      {result.error ? (
        <ErrorState message={result.error} onRetry={result.reload} />
      ) : !data ? (
        <LoadingState label="Simulyatsiya" />
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-(--color-text-muted)">
            {formatPeriod(data.periodFrom)} – {formatPeriod(data.periodTo)}
          </p>
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-(--color-line) bg-(--color-surface-muted)">
                <tr>
                  <th className={cn(TH, 'pl-5 text-left')}>Hudud</th>
                  <th className={cn(TH, 'text-right')}>Kutilgan natija</th>
                  <th className={cn(TH, 'text-right')}>80% oraliq</th>
                  <th className={cn(TH, 'text-right')}>Zarar</th>
                  <th className={cn(TH, 'text-right')}>Kamida 1 oy</th>
                  <th className={cn(TH, 'text-right')}>Daromad tushishi</th>
                  <th className={cn(TH, 'pr-5 text-right')}>Xavf</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--color-line)">
                {data.units.map((u) => (
                  <tr key={u.key} className={cn(u.kind === 'total' && 'bg-(--color-surface-muted) font-medium')}>
                    <td className="py-2 pl-5 pr-3">
                      <span className="flex items-center gap-2">
                        {u.kind === 'region' && <Mark item={resultMark(u, 'Risk')} />}
                        {u.name}
                      </span>
                    </td>
                    <td className={cn('whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums', n(u.expectedResultTiyin) < 0 && 'text-(--color-expense)')}>{compact(u.expectedResultTiyin)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-xs tabular-nums text-(--color-text-muted)">
                      {compact(u.p10Tiyin)} … {compact(u.p90Tiyin)}
                    </td>
                    <td className="px-3 py-2">
                      <CalcValue calc={probabilityCalc(`${u.name}: zarar ehtimoli`, u.lossProbability, 'davr jamida xarajat daromaddan ko\'p')}>
                        <ProbBar value={u.lossProbability} />
                      </CalcValue>
                    </td>
                    <td className="px-3 py-2">
                      <CalcValue calc={probabilityCalc(`${u.name}: kamida 1 oy zarar`, u.anyMonthLossProbability, 'kamida bitta oy zararli')}>
                        <ProbBar value={u.anyMonthLossProbability} />
                      </CalcValue>
                    </td>
                    <td className="px-3 py-2">
                      <ProbBar value={u.incomeDropProbability} />
                    </td>
                    <td className="py-2 pl-3 pr-5 text-right">
                      <span className={cn('inline-flex rounded px-2 py-0.5 text-[11px] font-semibold', LEVEL[u.level].tone)}>{LEVEL[u.level].label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Findings title="Risk xulosasi" notes={data.notes} />
        </div>
      )}
    </ModelCard>
  );
}