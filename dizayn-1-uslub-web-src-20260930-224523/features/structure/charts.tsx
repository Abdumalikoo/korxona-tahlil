'use client';

import { formatPeriod, formatPeriodShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useMemo, useState } from 'react';
import { compact, inkOn, pct, rampColor, TONE, type FlowResult, type Insights, type StructureKind } from './api';

// ═══════════════════════════════════════════════════════════
// Umumiy: o'q uchun "chiroyli" qadamlar
// ═══════════════════════════════════════════════════════════

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.001; v += step) ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  if (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}

export function Legend({ items }: { items: { color: string; label: string; line?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[--color-text-muted]">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          {item.line ? (
            <span className="h-0.5 w-4" style={{ background: item.color }} />
          ) : (
            <span className="size-2.5 rounded-[2px]" style={{ background: item.color }} />
          )}
          {item.label}
        </span>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 1. Treemap — maydon = summa. Bosilganda ichiga kiriladi
// ═══════════════════════════════════════════════════════════

export interface TreemapItem {
  key: string;
  label: string;
  value: number;
  sharePercent: number;
  color: string;
  drillable: boolean;
}

interface Rect {
  item: TreemapItem;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap: bloklar kvadratga yaqin — solishtirish oson */
function squarify(items: TreemapItem[], x: number, y: number, w: number, h: number): Rect[] {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0 || items.length === 0) return [];
  const scale = (w * h) / total;
  const areas = items.map((item) => ({ item, area: item.value * scale }));
  const rects: Rect[] = [];

  let rest = areas;
  let box = { x, y, w, h };
  while (rest.length > 0) {
    const short = Math.min(box.w, box.h);
    const row: typeof areas = [];
    let best = Infinity;
    for (const next of rest) {
      const candidate = [...row, next];
      const s = candidate.reduce((a, r) => a + r.area, 0);
      const max = Math.max(...candidate.map((r) => r.area));
      const min = Math.min(...candidate.map((r) => r.area));
      const worst = Math.max((short * short * max) / (s * s), (s * s) / (short * short * min));
      if (worst > best) break;
      best = worst;
      row.push(next);
    }
    const s = row.reduce((a, r) => a + r.area, 0);
    if (box.w >= box.h) {
      const colW = s / box.h;
      let cy = box.y;
      for (const r of row) {
        const rh = r.area / colW;
        rects.push({ item: r.item, x: box.x, y: cy, w: colW, h: rh });
        cy += rh;
      }
      box = { x: box.x + colW, y: box.y, w: box.w - colW, h: box.h };
    } else {
      const rowH = s / box.w;
      let cx = box.x;
      for (const r of row) {
        const rw = r.area / rowH;
        rects.push({ item: r.item, x: cx, y: box.y, w: rw, h: rowH });
        cx += rw;
      }
      box = { x: box.x, y: box.y + rowH, w: box.w, h: box.h - rowH };
    }
    rest = rest.slice(row.length);
  }
  return rects;
}

export function Treemap({
  items,
  onSelect,
  height = 300,
}: {
  items: TreemapItem[];
  onSelect: (key: string) => void;
  height?: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  // Ulushi 0,5% dan kichiklar bitta "Boshqalar" blokiga yig'iladi
  const prepared = useMemo(() => {
    const positive = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
    const total = positive.reduce((s, i) => s + i.value, 0);
    const big = positive.filter((i) => i.value / total >= 0.005);
    const small = positive.filter((i) => i.value / total < 0.005);
    if (small.length > 1) {
      big.push({
        key: '__rest',
        label: `Boshqalar · ${small.length} ta`,
        value: small.reduce((s, i) => s + i.value, 0),
        sharePercent: small.reduce((s, i) => s + i.sharePercent, 0),
        color: TONE.rest,
        drillable: false,
      });
    } else big.push(...small);
    return big;
  }, [items]);

  const ratio = 2.6;
  const rects = useMemo(() => squarify(prepared, 0, 0, 100 * ratio, 100), [prepared]);

  if (rects.length === 0) {
    return (
      <div className="flex items-center justify-center bg-[--color-surface-muted] text-sm text-[--color-text-muted]" style={{ height }}>
        Bu davrda ma&apos;lumot yo&apos;q
      </div>
    );
  }

  return (
    <div className="relative w-full overflow-hidden bg-white" style={{ height }}>
      {rects.map(({ item, x, y, w, h }) => {
        const wp = w / ratio;
        const showName = wp > 6 && h > 10;
        const showValue = wp > 9 && h > 17;
        const ink = inkOn(item.color);
        return (
          <button
            key={item.key}
            type="button"
            disabled={!item.drillable}
            onClick={() => item.drillable && onSelect(item.key)}
            onMouseEnter={() => setHover(item.key)}
            onMouseLeave={() => setHover(null)}
            title={`${item.label}\n${compact(item.value)} so'm · ${pct(item.sharePercent)}${item.drillable ? '\nBosing — ichiga kirish' : ''}`}
            className={cn(
              'absolute flex flex-col items-start justify-start overflow-hidden border border-white px-2.5 py-2 text-left transition-opacity',
              item.drillable ? 'cursor-pointer' : 'cursor-default',
              hover && hover !== item.key && 'opacity-60',
            )}
            style={{ left: `${x / ratio}%`, top: `${y}%`, width: `${wp}%`, height: `${h}%`, background: item.color, color: ink }}
          >
            {showName && <span className="line-clamp-2 text-xs font-semibold leading-snug sm:text-[13px]">{item.label}</span>}
            {showValue && (
              <span className="mt-0.5 block text-[11px] tabular-nums opacity-85 sm:text-xs">
                {compact(item.value)} · {pct(item.sharePercent)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 2. Kichik trend chizig'i (12 oy)
// ═══════════════════════════════════════════════════════════

export function Sparkline({ values, color = TONE.slate, width = 88, height = 24 }: { values: string[]; color?: string; width?: number; height?: number }) {
  const nums = values.map(Number);
  if (nums.length === 0) return null;
  const max = Math.max(...nums, 1);
  const min = Math.min(...nums, 0);
  const step = nums.length > 1 ? width / (nums.length - 1) : width;
  const yOf = (v: number) => height - 2 - ((v - min) / (max - min || 1)) * (height - 4);
  const points = nums.map((v, i) => `${(i * step).toFixed(1)},${yOf(v).toFixed(1)}`);
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      <line x1={0} x2={width} y1={height - 1} y2={height - 1} stroke={TONE.grid} />
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth={1.4} strokeLinejoin="round" />
      <circle cx={(nums.length - 1) * step} cy={yOf(nums[nums.length - 1]!)} r={2} fill={color} />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// 3. O'zgarish omillari — sharshara (o'tgan davr → joriy davr)
// ═══════════════════════════════════════════════════════════

export function Waterfall({
  kind,
  previousTiyin,
  currentTiyin,
  drivers,
}: {
  kind: StructureKind;
  previousTiyin: string;
  currentTiyin: string;
  drivers: Insights['drivers'];
}) {
  const prev = Number(previousTiyin);
  const cur = Number(currentTiyin);
  const steps: { label: string; start: number; end: number; type: 'total' | 'up' | 'down' }[] = [];
  steps.push({ label: "O'tgan davr", start: 0, end: prev, type: 'total' });
  let running = prev;
  for (const d of drivers) {
    const delta = Number(d.deltaTiyin);
    if (delta === 0) continue;
    steps.push({ label: d.label, start: running, end: running + delta, type: delta > 0 ? 'up' : 'down' });
    running += delta;
  }
  steps.push({ label: 'Joriy davr', start: 0, end: cur, type: 'total' });

  // O'q noldan emas, qiymatlar atrofidan boshlanadi — kichik o'zgarishlar ham ko'rinadi
  const levels = steps.flatMap((s) => (s.type === 'total' ? [s.end] : [s.start, s.end]));
  const hi = Math.max(...levels, 1);
  const lo = Math.min(...levels);
  const pad = (hi - lo) * 0.3 || Math.abs(hi) * 0.05 || 1;
  const min = Math.max(0, lo - pad);
  const max = hi + (hi - lo) * 0.05;
  const span = max - min || 1;
  const pos = (v: number) => ((v - min) / span) * 100;
  // Xarajat uchun o'sish — yomon (qizil); daromad uchun — yaxshi (yashil)
  const upColor = kind === 'expense' ? TONE.expense : TONE.income;
  const downColor = kind === 'expense' ? TONE.income : TONE.expense;

  return (
    <div>
      <div className="grid grid-cols-[minmax(7rem,12rem)_1fr_6rem] gap-x-3 border-b border-[--color-line] pb-1.5 text-[11px] uppercase tracking-wide text-[--color-text-faint]">
        <span>Modda</span>
        <span>{min > 0 ? `o'q ${compact(min)} dan boshlanadi` : ''}</span>
        <span className="text-right">Ta&apos;sir</span>
      </div>
      {steps.map((s, i) => {
        const from = s.type === 'total' ? min : Math.min(s.start, s.end);
        const to = s.type === 'total' ? s.end : Math.max(s.start, s.end);
        const delta = s.end - s.start;
        const total = s.type === 'total';
        return (
          <div
            key={`${s.label}-${i}`}
            className={cn(
              'grid grid-cols-[minmax(7rem,12rem)_1fr_6rem] items-center gap-x-3 py-1.5 text-sm',
              total && 'border-y border-[--color-line] bg-[--color-surface-muted]',
            )}
          >
            <span className={cn('truncate', total ? 'font-semibold' : 'text-[--color-text-muted]')} title={s.label}>
              {s.label}
            </span>
            <div className="relative h-4">
              {/* O'tgan davr darajasi — mo'ljal chizig'i */}
              <span className="absolute inset-y-[-6px] w-px bg-[--color-text-faint] opacity-50" style={{ left: `${pos(prev)}%` }} />
              <span
                className="absolute inset-y-0"
                style={{
                  left: `${pos(from)}%`,
                  width: `${Math.max(0.6, pos(to) - pos(from))}%`,
                  background: total ? TONE.slate : s.type === 'up' ? upColor : downColor,
                }}
              />
            </div>
            <span className={cn('text-right tabular-nums', total && 'font-semibold')}>
              {total ? compact(s.end) : `${delta > 0 ? '+' : ''}${compact(delta)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 4. Pareto 80/20 — ustunlar (ulush) + jamlanma chiziq
// ═══════════════════════════════════════════════════════════

export const ABC_COLORS = { A: '#23426a', B: '#7a9bc2', C: '#d1d5db' } as const;

export function Pareto({ items }: { items: Insights['pareto'] }) {
  const shown = items.slice(0, 15);
  if (shown.length === 0) return null;
  const W = 640;
  const H = 240;
  const pad = { l: 40, r: 40, t: 14, b: 76 };
  const plotH = H - pad.t - pad.b;
  const slotW = (W - pad.l - pad.r) / shown.length;
  const bw = Math.min(slotW, 64);
  const offset = pad.l + (slotW - bw) / 2;
  const maxShare = Math.max(...shown.map((i) => i.sharePercent), 1);
  const leftTicks = niceTicks(0, maxShare, 4);
  const leftMax = leftTicks[leftTicks.length - 1]!;
  const yL = (v: number) => pad.t + plotH * (1 - v / leftMax);
  const yR = (v: number) => pad.t + plotH * (1 - v / 100);
  const cx = (i: number) => pad.l + i * slotW + slotW / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" style={{ fontFamily: 'inherit' }}>
      {leftTicks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={yL(t)} y2={yL(t)} stroke={TONE.grid} />
          <text x={pad.l - 6} y={yL(t) + 3.5} fontSize={11} fill={TONE.axis} textAnchor="end">{`${Math.round(t)}%`}</text>
        </g>
      ))}
      {[0, 50, 100].map((t) => (
        <text key={t} x={W - pad.r + 6} y={yR(t) + 3.5} fontSize={11} fill={TONE.axis}>{`${t}%`}</text>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={yR(80)} y2={yR(80)} stroke={TONE.slate} strokeDasharray="4 3" strokeWidth={1} />
      <text x={W - pad.r + 6} y={yR(80) + 3.5} fontSize={11} fontWeight={600} fill={TONE.slate}>80%</text>

      {shown.map((item, i) => (
        <g key={item.key}>
          <rect x={offset + i * slotW + 3} y={yL(item.sharePercent)} width={bw - 6} height={pad.t + plotH - yL(item.sharePercent)} fill={ABC_COLORS[item.abc]}>
            <title>{`${item.label}\nUlush: ${pct(item.sharePercent)} · jamlanma: ${pct(item.cumulativePercent)}\nGuruh: ${item.abc}`}</title>
          </rect>
          <text x={cx(i)} y={H - pad.b + 12} fontSize={11} fill="#4b5563" textAnchor="end" transform={`rotate(-38 ${cx(i)} ${H - pad.b + 12})`}>
            {item.label.length > 18 ? `${item.label.slice(0, 17)}…` : item.label}
          </text>
        </g>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={pad.t + plotH} y2={pad.t + plotH} stroke={TONE.axis} />
      <polyline fill="none" stroke={TONE.ink} strokeWidth={1.5} points={shown.map((item, i) => `${cx(i)},${yR(item.cumulativePercent)}`).join(' ')} />
      {shown.map((item, i) => (
        <circle key={`c${item.key}`} cx={cx(i)} cy={yR(item.cumulativePercent)} r={2.5} fill="#fff" stroke={TONE.ink} strokeWidth={1.3} />
      ))}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// 5. Konsentratsiya (HHI) — uch zonali shkala
// ═══════════════════════════════════════════════════════════

const HHI_ZONES = [
  { key: 'tarqoq', label: 'Tarqoq', from: 0, to: 1500 },
  { key: "o'rtacha", label: "O'rtacha", from: 1500, to: 2500 },
  { key: 'yuqori', label: 'Yuqori', from: 2500, to: 10000 },
] as const;

export function HhiScale({ hhi, concentration }: { hhi: number; concentration: Insights['concentration'] }) {
  // Har zona teng kenglikda — chegaralar aniq ko'rinadi
  const zoneIndex = HHI_ZONES.findIndex((z) => z.key === concentration);
  const zone = HHI_ZONES[Math.max(0, zoneIndex)]!;
  const inside = Math.min(1, Math.max(0, (hhi - zone.from) / (zone.to - zone.from)));
  const left = ((Math.max(0, zoneIndex) + inside) / HHI_ZONES.length) * 100;
  return (
    <div>
      <div className="relative">
        <div className="grid grid-cols-3 gap-0.5">
          {HHI_ZONES.map((z, i) => (
            <div
              key={z.key}
              className={cn('h-2', i === zoneIndex ? '' : 'bg-[--color-surface-sunken]')}
              style={i === zoneIndex ? { background: i === 0 ? TONE.income : i === 1 ? '#b7791f' : TONE.expense } : undefined}
            />
          ))}
        </div>
        <span className="absolute -top-1.5 h-5 w-0.5 -translate-x-1/2 bg-[--color-text]" style={{ left: `${left}%` }} />
      </div>
      <div className="mt-1.5 grid grid-cols-3 text-[11px] text-[--color-text-muted]">
        {HHI_ZONES.map((z, i) => (
          <span key={z.key} className={cn(i === zoneIndex && 'font-semibold text-[--color-text]')}>
            {z.label}
            <span className="block font-normal tabular-nums text-[--color-text-faint]">
              {z.from.toLocaleString('ru-RU')}–{z.to.toLocaleString('ru-RU')}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 6. Oylar kesimida ustunli grafik (umumiy)
// ═══════════════════════════════════════════════════════════

interface MonthSeries {
  label: string;
  color: string;
  values: number[];
}

function MonthChart({
  months,
  series,
  stacked,
  line,
  height = 240,
}: {
  months: string[];
  series: MonthSeries[];
  stacked: boolean;
  line?: MonthSeries;
  height?: number;
}) {
  const W = 960;
  const H = height;
  const pad = { l: 64, r: 12, t: 12, b: 26 };
  const plotH = H - pad.t - pad.b;
  const n = months.length || 1;
  const slot = (W - pad.l - pad.r) / n;

  const tops = months.map((_, i) =>
    stacked ? series.reduce((s, ser) => s + (ser.values[i] ?? 0), 0) : Math.max(...series.map((ser) => ser.values[i] ?? 0)),
  );
  const lineVals = line?.values ?? [];
  const hi = Math.max(...tops, ...lineVals, 1);
  const lo = Math.min(0, ...lineVals);
  const ticks = niceTicks(lo, hi, 4);
  const dMin = ticks[0]!;
  const dMax = ticks[ticks.length - 1]!;
  const y = (v: number) => pad.t + plotH * (1 - (v - dMin) / (dMax - dMin || 1));
  const barW = stacked ? slot * 0.56 : (slot * 0.7) / series.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? TONE.axis : TONE.grid} />
          <text x={pad.l - 8} y={y(t) + 3.5} fontSize={10.5} fill={TONE.axis} textAnchor="end">{t === 0 ? '0' : compact(t)}</text>
        </g>
      ))}
      {months.map((m, i) => {
        const x0 = pad.l + i * slot;
        let acc = 0;
        const tip = [formatPeriod(m), ...series.map((s) => `${s.label}: ${compact(s.values[i] ?? 0)} so'm`), ...(line ? [`${line.label}: ${compact(line.values[i] ?? 0)} so'm`] : [])].join('\n');
        return (
          <g key={m}>
            <title>{tip}</title>
            <rect x={x0} y={pad.t} width={slot} height={plotH} fill="transparent" />
            {series.map((s, si) => {
              const v = s.values[i] ?? 0;
              if (stacked) {
                const yTop = y(acc + v);
                const yBot = y(acc);
                acc += v;
                return <rect key={s.label} x={x0 + (slot - barW) / 2} y={yTop} width={barW} height={Math.max(0, yBot - yTop)} fill={s.color} />;
              }
              const bx = x0 + (slot - barW * series.length) / 2 + si * barW;
              return <rect key={s.label} x={bx + 1} y={y(Math.max(v, 0))} width={barW - 2} height={Math.max(0, y(0) - y(Math.max(v, 0)))} fill={s.color} />;
            })}
            <text x={x0 + slot / 2} y={H - 8} fontSize={10.5} fill="#6b7280" textAnchor="middle">{formatPeriodShort(m)}</text>
          </g>
        );
      })}
      {line && (
        <>
          <polyline
            fill="none"
            stroke={line.color}
            strokeWidth={1.8}
            points={line.values.map((v, i) => `${pad.l + i * slot + slot / 2},${y(v)}`).join(' ')}
          />
          {line.values.map((v, i) => (
            <circle key={i} cx={pad.l + i * slot + slot / 2} cy={y(v)} r={3} fill="#fff" stroke={v < 0 ? TONE.expense : line.color} strokeWidth={1.6} />
          ))}
        </>
      )}
    </svg>
  );
}

// Doimiy / Boshqa — oylar kesimida
export function SectionBars({ rows }: { rows: NonNullable<Insights['sectionTrend']> }) {
  return (
    <div className="space-y-2">
      <MonthChart
        months={rows.map((r) => r.period)}
        stacked
        height={220}
        series={[
          { label: 'Doimiy', color: '#23426a', values: rows.map((r) => Number(r.doimiyTiyin)) },
          { label: 'Boshqa', color: '#95b0d0', values: rows.map((r) => Number(r.boshqaTiyin)) },
        ]}
      />
      <Legend items={[{ color: '#23426a', label: 'Doimiy (muntazam)' }, { color: '#95b0d0', label: 'Boshqa (bir martalik)' }]} />
    </div>
  );
}

// Daromad va xarajat — oylar kesimida, foyda chizig'i bilan
export function IncomeExpenseBars({ monthly }: { monthly: FlowResult['monthly'] }) {
  return (
    <div className="space-y-2">
      <MonthChart
        months={monthly.map((m) => m.period)}
        stacked={false}
        series={[
          { label: 'Daromad', color: TONE.income, values: monthly.map((m) => Number(m.incomeTiyin)) },
          { label: 'Xarajat', color: '#c9837d', values: monthly.map((m) => Number(m.expenseTiyin)) },
        ]}
        line={{ label: 'Foyda', color: TONE.ink, values: monthly.map((m) => Number(m.incomeTiyin) - Number(m.expenseTiyin)) }}
      />
      <Legend
        items={[
          { color: TONE.income, label: 'Daromad' },
          { color: '#c9837d', label: 'Xarajat' },
          { color: TONE.ink, label: 'Foyda (daromad − xarajat)', line: true },
        ]}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 7. Sankey — pul qayerdan keladi va qayerga ketadi
// ═══════════════════════════════════════════════════════════

function SankeyLabel({
  x,
  y,
  anchor,
  label,
  value,
  share,
  single,
  strong,
}: {
  x: number;
  y: number;
  anchor: 'start' | 'end';
  label: string;
  value: number;
  share: number;
  single: boolean;
  strong?: string;
}) {
  const limit = single ? 22 : 30;
  const text = label.length > limit ? `${label.slice(0, limit - 1)}…` : label;
  const nameColor = strong ?? TONE.ink;
  if (single) {
    return (
      <text x={x} y={y + 4} textAnchor={anchor} fontSize={11.5} fill={nameColor} fontWeight={strong ? 600 : 400}>
        <title>{label}</title>
        {text}
        <tspan fill="#6b7280">{`  ${compact(value)} · ${pct(share)}`}</tspan>
      </text>
    );
  }
  return (
    <g>
      <title>{label}</title>
      <text x={x} y={y - 2} textAnchor={anchor} fontSize={12} fill={nameColor} fontWeight={strong ? 600 : 500}>{text}</text>
      <text x={x} y={y + 13} textAnchor={anchor} fontSize={11} fill="#6b7280">{`${compact(value)} so'm · ${pct(share)}`}</text>
    </g>
  );
}

export function Sankey({ flow }: { flow: FlowResult }) {
  const W = 980;
  const H = 460;
  const top = 34;
  const bottom = 10;
  const nodeW = 12;
  const minGap = 20;
  const colX = [260, W / 2 - nodeW / 2, W - 260 - nodeW];

  const income = flow.income.parts.map((p) => ({ ...p, value: Number(p.amountTiyin) })).filter((p) => p.value > 0);
  const expenses = flow.expense.parts.map((p) => ({ ...p, value: Number(p.amountTiyin) })).filter((p) => p.value > 0);
  const profit = Number(flow.profitTiyin);
  const right = [...expenses];
  const left = [...income];
  if (profit > 0) right.push({ key: 'profit', label: 'Sof foyda', amountTiyin: flow.profitTiyin, previousTiyin: '0', value: profit });
  if (profit < 0) left.push({ key: 'loss', label: 'Zarar (qoplanmagan qism)', amountTiyin: String(-profit), previousTiyin: '0', value: -profit });

  const total = Math.max(left.reduce((s, p) => s + p.value, 0), right.reduce((s, p) => s + p.value, 0), 1);
  const avail = H - top - bottom;
  const usable = (n: number) => avail - minGap * Math.max(0, n - 1);
  const k = Math.min(usable(left.length), usable(right.length)) / total;

  const place = (list: typeof left) => {
    const need = list.reduce((s, p) => s + Math.max(2, p.value * k), 0) + minGap * Math.max(0, list.length - 1);
    let y = top + Math.max(0, (avail - need) / 2);
    return list.map((p) => {
      const h = Math.max(2, p.value * k);
      const node = { ...p, y, h };
      y += h + Math.max(8, h < minGap ? minGap - h + 8 : 8);
      return node;
    });
  };
  const L = place(left);
  const R = place(right);
  const midH = total * k;
  const midY = top + (avail - midH) / 2;

  const band = (x0: number, y0: number, x1: number, y1: number, h: number) => {
    const c = (x1 - x0) / 2;
    return `M${x0},${y0} C${x0 + c},${y0} ${x1 - c},${y1} ${x1},${y1} L${x1},${y1 + h} C${x1 - c},${y1 + h} ${x0 + c},${y0 + h} ${x0},${y0 + h} Z`;
  };

  const leftColor = (key: string) => (key === 'loss' ? TONE.expense : TONE.income);
  const rightColor = (key: string) => (key === 'profit' ? TONE.income : TONE.slate);

  let midIn = midY;
  let midOut = midY;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {/* Ustun sarlavhalari */}
      <text x={colX[0]! + nodeW} y={14} textAnchor="end" fontSize={10.5} fontWeight={600} letterSpacing={0.6} fill="#6b7280">DAROMAD MANBALARI</text>
      <text x={colX[1]! + nodeW / 2} y={14} textAnchor="middle" fontSize={10.5} fontWeight={600} letterSpacing={0.6} fill="#6b7280">KORXONA</text>
      <text x={colX[2]!} y={14} fontSize={10.5} fontWeight={600} letterSpacing={0.6} fill="#6b7280">XARAJATLAR VA FOYDA</text>

      {L.map((p) => {
        const d = band(colX[0]! + nodeW, p.y, colX[1]!, midIn, p.h);
        midIn += p.h;
        return (
          <path key={`l${p.key}`} d={d} fill={leftColor(p.key)} opacity={0.16}>
            <title>{`${p.label}: ${compact(p.value)} so'm`}</title>
          </path>
        );
      })}
      {R.map((p) => {
        const d = band(colX[1]! + nodeW, midOut, colX[2]!, p.y, p.h);
        midOut += p.h;
        return (
          <path key={`r${p.key}`} d={d} fill={rightColor(p.key)} opacity={p.key === 'profit' ? 0.2 : 0.13}>
            <title>{`${p.label}: ${compact(p.value)} so'm`}</title>
          </path>
        );
      })}

      {L.map((p) => (
        <g key={`ln${p.key}`}>
          <rect x={colX[0]} y={p.y} width={nodeW} height={p.h} fill={leftColor(p.key)} />
          <SankeyLabel
            x={colX[0]! - 10}
            y={p.y + p.h / 2}
            anchor="end"
            label={p.label}
            value={p.value}
            share={(p.value / total) * 100}
            single={p.h < 30}
            strong={p.key === 'loss' ? TONE.expense : undefined}
          />
        </g>
      ))}
      <rect x={colX[1]} y={midY} width={nodeW} height={midH} fill={TONE.ink} />
      {R.map((p) => (
        <g key={`rn${p.key}`}>
          <rect x={colX[2]} y={p.y} width={nodeW} height={p.h} fill={rightColor(p.key)} />
          <SankeyLabel
            x={colX[2]! + nodeW + 10}
            y={p.y + p.h / 2}
            anchor="start"
            label={p.label}
            value={p.value}
            share={(p.value / total) * 100}
            single={p.h < 30}
            strong={p.key === 'profit' ? TONE.income : undefined}
          />
        </g>
      ))}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// 8. Chiziqli grafik (bir nechta qator, uzilishlar bilan)
// ═══════════════════════════════════════════════════════════

export interface LineSeries {
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
  width?: number;
}

export function LineChart({
  labels,
  series,
  height = 240,
  threshold,
  format = compact,
  tooltipLabels,
  width = 960,
}: {
  labels: string[];
  series: LineSeries[];
  /** viewBox kengligi: tor joylar (yon oyna) uchun kichikroq — matn o'qiladigan bo'ladi */
  width?: number;
  height?: number;
  threshold?: { value: number; label: string };
  format?: (value: number) => string;
  /** Sichqoncha ustida ko'rinadigan to'liq nomlar (masalan "Sentabr 2026") */
  tooltipLabels?: string[];
}) {
  const W = width;
  const H = height;
  const pad = { l: 64, r: 28, t: 14, b: 26 };
  const plotH = H - pad.t - pad.b;
  const n = labels.length || 1;
  const step = n > 1 ? (W - pad.l - pad.r) / (n - 1) : 0;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (threshold) all.push(threshold.value);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all, 1), 4);
  const dMin = ticks[0]!;
  const dMax = ticks[ticks.length - 1]!;
  const x = (i: number) => pad.l + i * step;
  const y = (v: number) => pad.t + plotH * (1 - (v - dMin) / (dMax - dMin || 1));

  const segments = (values: (number | null)[]) => {
    const result: string[] = [];
    let current: string[] = [];
    values.forEach((v, i) => {
      if (v === null) {
        if (current.length) result.push(current.join(' '));
        current = [];
      } else current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    if (current.length) result.push(current.join(' '));
    return result;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? TONE.axis : TONE.grid} />
          <text x={pad.l - 8} y={y(t) + 3.5} fontSize={10.5} fill={TONE.axis} textAnchor="end">{t === 0 ? '0' : format(t)}</text>
        </g>
      ))}
      {threshold && (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={y(threshold.value)} y2={y(threshold.value)} stroke={TONE.expense} strokeDasharray="5 4" />
          <text x={W - pad.r} y={y(threshold.value) - 5} fontSize={10.5} fill={TONE.expense} textAnchor="end">{threshold.label}</text>
        </g>
      )}
      {labels.map((label, i) => (
        <g key={`${label}-${i}`}>
          <title>
            {[tooltipLabels?.[i] ?? label, ...series.map((s) => `${s.label}: ${s.values[i] === null || s.values[i] === undefined ? '—' : format(s.values[i]!)}`)].join('\n')}
          </title>
          <rect x={x(i) - step / 2} y={pad.t} width={Math.max(step, 1)} height={plotH} fill="transparent" />
          <text x={x(i)} y={H - 8} fontSize={10.5} fill="#6b7280" textAnchor="middle">{label}</text>
        </g>
      ))}
      {series.map((s) => (
        <g key={s.label} pointerEvents="none">
          {segments(s.values).map((points, k) => (
            <polyline
              key={k}
              points={points}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 2}
              strokeDasharray={s.dashed ? '6 4' : undefined}
              strokeLinejoin="round"
            />
          ))}
          {s.values.map((v, i) =>
            v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r={2.6} fill="#fff" stroke={s.color} strokeWidth={1.5} />,
          )}
        </g>
      ))}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// 9. Oylar jadvali (issiqlik xaritasi): moddalar × oylar
// ═══════════════════════════════════════════════════════════

export interface HeatRow {
  key: string;
  label: string;
  values: number[];
  drillable: boolean;
}

export function Heatmap({
  months,
  rows,
  scale,
  onSelect,
}: {
  months: string[];
  rows: HeatRow[];
  /** row — har qator o'z maksimumiga nisbatan (mavsumiylik), all — umumiy (hajm) */
  scale: 'row' | 'all';
  onSelect?: (key: string) => void;
}) {
  const globalMax = Math.max(...rows.flatMap((r) => r.values), 1);
  const columnTotals = months.map((_, i) => rows.reduce((s, r) => s + (r.values[i] ?? 0), 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-[--color-text-muted]">
            <th className="sticky left-0 z-10 min-w-[11rem] bg-white py-1.5 pr-2 text-left font-semibold">Modda</th>
            {months.map((m) => (
              <th key={m} className="min-w-[3.6rem] py-1.5 text-center font-semibold" title={formatPeriod(m)}>
                {formatPeriodShort(m)}
              </th>
            ))}
            <th className="min-w-[4.5rem] py-1.5 pl-2 text-right font-semibold">12 oy</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const max = scale === 'row' ? Math.max(...row.values, 1) : globalMax;
            return (
              <tr key={row.key}>
                <th
                  scope="row"
                  className={cn(
                    'sticky left-0 z-10 max-w-[14rem] truncate bg-white py-1 pr-2 text-left text-sm font-normal text-[--color-text]',
                    row.drillable && onSelect && 'cursor-pointer hover:underline',
                  )}
                  title={row.label}
                  onClick={() => row.drillable && onSelect?.(row.key)}
                >
                  {row.label}
                </th>
                {row.values.map((v, i) => {
                  // Ildiz shkalasi: bitta juda katta oy qolganlarini "o'chirib" yubormasligi uchun
                  const alpha = v > 0 ? 0.08 + 0.87 * Math.sqrt(v / max) : 0;
                  return (
                    <td
                      key={months[i]}
                      className="h-8 text-center tabular-nums"
                      style={{ background: v > 0 ? `rgba(35, 66, 106, ${alpha.toFixed(3)})` : '#f9fafb', color: alpha > 0.5 ? '#fff' : '#1f2937' }}
                      title={`${row.label} · ${formatPeriod(months[i]!)}: ${compact(v)} so'm`}
                    >
                      {v > 0 ? compact(v).replace(' mlrd', 'B').replace(' mln', 'M').replace(' ming', 'K') : '·'}
                    </td>
                  );
                })}
                <td className="pl-2 text-right font-medium tabular-nums">{compact(row.values.reduce((a, b) => a + b, 0))}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <th className="sticky left-0 z-10 bg-white py-1.5 pr-2 text-left text-sm">Jami</th>
            {columnTotals.map((v, i) => (
              <td key={months[i]} className="text-center tabular-nums text-[--color-text]">
                {compact(v).replace(' mlrd', 'B').replace(' mln', 'M').replace(' ming', 'K')}
              </td>
            ))}
            <td className="pl-2 text-right tabular-nums">{compact(columnTotals.reduce((a, b) => a + b, 0))}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 10. Ulush o'zgarishi: avval ○ → hozir ● (gantel diagrammasi)
// ═══════════════════════════════════════════════════════════

export function ShareShift({
  rows,
  compareLabel,
}: {
  rows: { key: string; label: string; now: number; before: number }[];
  compareLabel: string;
}) {
  const max = Math.max(...rows.flatMap((r) => [r.now, r.before]), 1);
  const ticks = niceTicks(0, max, 4);
  const top = ticks[ticks.length - 1]!;
  const pos = (v: number) => (v / top) * 100;
  return (
    <div>
      <div className="grid grid-cols-[minmax(8rem,14rem)_1fr_5.5rem] gap-x-4 border-b border-[--color-line] pb-1.5 text-[11px] uppercase tracking-wider text-[--color-text-muted]">
        <span className="font-semibold">Modda</span>
        <span className="relative h-4">
          {ticks.map((t) => (
            <span key={t} className="absolute -translate-x-1/2 tabular-nums" style={{ left: `${pos(t)}%` }}>
              {Math.round(t)}%
            </span>
          ))}
        </span>
        <span className="text-right font-semibold">Farq</span>
      </div>
      {rows.map((row) => {
        const delta = row.now - row.before;
        const lo = Math.min(row.now, row.before);
        const hi = Math.max(row.now, row.before);
        return (
          <div key={row.key} className="grid grid-cols-[minmax(8rem,14rem)_1fr_5.5rem] items-center gap-x-4 border-b border-[--color-line] py-2 text-sm last:border-0">
            <span className="truncate" title={row.label}>{row.label}</span>
            <div className="relative h-4" title={`${compareLabel}: ${pct(row.before)} → hozir: ${pct(row.now)}`}>
              {ticks.map((t) => (
                <span key={t} className="absolute inset-y-0 w-px bg-[--color-surface-sunken]" style={{ left: `${pos(t)}%` }} />
              ))}
              <span className="absolute top-1/2 h-0.5 -translate-y-1/2" style={{ left: `${pos(lo)}%`, width: `${pos(hi) - pos(lo)}%`, background: TONE.axis }} />
              <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white" style={{ left: `${pos(row.before)}%`, borderColor: TONE.axis }} />
              <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: `${pos(row.now)}%`, background: '#23426a' }} />
            </div>
            <span className={cn('text-right font-medium tabular-nums', Math.abs(delta) < 0.1 ? 'text-[--color-text-muted]' : 'text-[--color-text]')}>
              {Math.abs(delta) < 0.05 ? '' : delta > 0 ? '+' : '−'}
              {Math.abs(delta).toFixed(1).replace('.', ',')} p.p.
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 11. Doimiy / Boshqa — har modda uchun yotiq ustun
// ═══════════════════════════════════════════════════════════

export function SplitBars({ rows }: { rows: { key: string; label: string; doimiy: number; boshqa: number }[] }) {
  const max = Math.max(...rows.map((r) => r.doimiy + r.boshqa), 1);
  return (
    <div>
      <div className="grid grid-cols-[minmax(8rem,14rem)_1fr_6rem_5rem] gap-x-4 border-b border-[--color-line] pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">
        <span>Modda</span>
        <span>Summa (to&apos;q — doimiy, och — boshqa)</span>
        <span className="text-right">Jami</span>
        <span className="text-right">Boshqa</span>
      </div>
      {rows.map((row) => {
        const total = row.doimiy + row.boshqa;
        const share = total > 0 ? (row.boshqa / total) * 100 : 0;
        return (
          <div key={row.key} className="grid grid-cols-[minmax(8rem,14rem)_1fr_6rem_5rem] items-center gap-x-4 border-b border-[--color-line] py-2 text-sm last:border-0">
            <span className="truncate" title={row.label}>{row.label}</span>
            <div className="flex h-3.5" title={`Doimiy: ${compact(row.doimiy)} · Boshqa: ${compact(row.boshqa)}`}>
              <span style={{ width: `${(row.doimiy / max) * 100}%`, background: '#23426a' }} />
              <span style={{ width: `${(row.boshqa / max) * 100}%`, background: '#95b0d0' }} />
            </div>
            <span className="text-right tabular-nums">{compact(total)}</span>
            <span className={cn('text-right font-medium tabular-nums', share >= 30 ? 'text-[--color-expense]' : 'text-[--color-text-muted]')}>{pct(share)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 12. Moddalar xaritasi: o'sish sur'ati × o'zgaruvchanlik
// ═══════════════════════════════════════════════════════════

export interface MapPoint {
  key: string;
  label: string;
  /** Oylik trend, % */
  growth: number;
  /** O'zgaruvchanlik (CV), % */
  volatility: number;
  amount: number;
}

export const VOLATILITY_LINE = 40;

export function GrowthMap({ points, kind }: { points: MapPoint[]; kind: StructureKind }) {
  const W = 760;
  const H = 360;
  const pad = { l: 56, r: 20, t: 20, b: 40 };
  const xLim = Math.min(20, Math.max(5, Math.ceil(Math.max(...points.map((p) => Math.abs(p.growth)), 1) / 5) * 5));
  const yLim = Math.min(150, Math.max(60, Math.ceil(Math.max(...points.map((p) => p.volatility), 1) / 20) * 20));
  const x = (v: number) => pad.l + ((Math.max(-xLim, Math.min(xLim, v)) + xLim) / (2 * xLim)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - Math.min(yLim, Math.max(0, v)) / yLim) * (H - pad.t - pad.b);
  const maxAmount = Math.max(...points.map((p) => p.amount), 1);
  const r = (a: number) => 4 + Math.sqrt(a / maxAmount) * 16;
  // Doira markazi chizma ichida qoladi (chetdagi qiymatlar chegaraga "yopishadi")
  const cx = (p: MapPoint) => Math.min(W - pad.r - r(p.amount), Math.max(pad.l + r(p.amount), x(p.growth)));
  const cy = (p: MapPoint) => Math.min(H - pad.b - r(p.amount), Math.max(pad.t + r(p.amount), y(p.volatility)));
  // Yorliqlar bir-birining ustiga tushmasligi uchun: kattadan kichikka, yaqin joyda allaqachon yorliq bo'lsa — tashlab ketiladi
  const labelled = new Set<string>();
  const placed: { x: number; y: number }[] = [];
  for (const p of [...points].sort((a, b) => b.amount - a.amount)) {
    if (labelled.size >= 8) break;
    const lx = cx(p);
    const ly = cy(p) - r(p.amount) - 5;
    if (placed.some((q) => Math.abs(q.x - lx) < 120 && Math.abs(q.y - ly) < 24)) continue;
    placed.push({ x: lx, y: ly });
    labelled.add(p.key);
  }
  const growColor = kind === 'expense' ? TONE.expense : TONE.income;
  const fallColor = kind === 'expense' ? TONE.income : TONE.expense;
  const quad = (text: string, qx: number, qy: number, anchor: 'start' | 'end') => (
    <text x={qx} y={qy} fontSize={11.5} fill="#9ca3af" textAnchor={anchor} fontWeight={600} letterSpacing={0.4}>
      {text}
    </text>
  );

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {/* Zonalar */}
      <rect x={pad.l} y={y(VOLATILITY_LINE)} width={W - pad.l - pad.r} height={y(0) - y(VOLATILITY_LINE)} fill="#f8fafc" />
      <line x1={x(0)} x2={x(0)} y1={pad.t} y2={H - pad.b} stroke={TONE.axis} />
      <line x1={pad.l} x2={W - pad.r} y1={y(VOLATILITY_LINE)} y2={y(VOLATILITY_LINE)} stroke={TONE.axis} strokeDasharray="4 3" />
      {quad("KAMAYMOQDA · BEQAROR", pad.l + 8, pad.t + 14, 'start')}
      {quad("O'SMOQDA · BEQAROR", W - pad.r - 8, pad.t + 14, 'end')}
      {quad('KAMAYMOQDA · BARQAROR', pad.l + 8, H - pad.b - 8, 'start')}
      {quad("O'SMOQDA · BARQAROR", W - pad.r - 8, H - pad.b - 8, 'end')}

      {/* O'qlar */}
      {[-xLim, -xLim / 2, 0, xLim / 2, xLim].map((t) => (
        <text key={t} x={x(t)} y={H - pad.b + 16} fontSize={12} fill={TONE.axis} textAnchor="middle">
          {t > 0 ? '+' : t < 0 ? '−' : ''}
          {Math.abs(t)}%
        </text>
      ))}
      <text x={(pad.l + W - pad.r) / 2} y={H - 6} fontSize={12} fill="#6b7280" textAnchor="middle">
        O&apos;sish sur&apos;ati (oyiga, 12 oylik trend) →
      </text>
      {[0, VOLATILITY_LINE, yLim].map((t) => (
        <text key={t} x={pad.l - 8} y={y(t) + 3.5} fontSize={12} fill={TONE.axis} textAnchor="end">
          {t}%
        </text>
      ))}
      <text x={14} y={(pad.t + H - pad.b) / 2} fontSize={12} fill="#6b7280" textAnchor="middle" transform={`rotate(-90 14 ${(pad.t + H - pad.b) / 2})`}>
        O&apos;zgaruvchanlik (CV) →
      </text>

      {/* Nuqtalar: kattasi orqada */}
      {[...points]
        .sort((a, b) => b.amount - a.amount)
        .map((p) => (
          <g key={p.key}>
            <circle
              cx={cx(p)}
              cy={cy(p)}
              r={r(p.amount)}
              fill={Math.abs(p.growth) < 2 ? TONE.slate : p.growth > 0 ? growColor : fallColor}
              fillOpacity={0.35}
              stroke={Math.abs(p.growth) < 2 ? TONE.slate : p.growth > 0 ? growColor : fallColor}
              strokeWidth={1.2}
            >
              <title>{`${p.label}\nO'sish: ${p.growth > 0 ? '+' : ''}${p.growth.toFixed(1).replace('.', ',')}% oyiga\nO'zgaruvchanlik: ${p.volatility.toFixed(0)}%\nSumma: ${compact(p.amount)} so'm`}</title>
            </circle>
            {labelled.has(p.key) && (
              <text
                x={cx(p)}
                y={cy(p) - r(p.amount) - 5 < pad.t + 10 ? cy(p) + r(p.amount) + 13 : cy(p) - r(p.amount) - 5}
                fontSize={12}
                fill={TONE.ink}
                textAnchor={cx(p) > W - 110 ? 'end' : cx(p) < pad.l + 90 ? 'start' : 'middle'}
                pointerEvents="none"
              >
                {p.label.length > 22 ? `${p.label.slice(0, 21)}…` : p.label}
              </text>
            )}
          </g>
        ))}
    </svg>
  );
}