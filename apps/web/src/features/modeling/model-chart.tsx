'use client';

import { useState } from 'react';
import {
  CHART_COLORS,
  OVERLAY_COLOR,
  formatAxis,
  formatCategory,
  formatValue,
  isPeriod,
  type ChartData,
  type PieChartData,
  type ScatterChartData,
  type SeriesChartData,
} from './api';

// ═══════════════════════════════════════════════════════════
// Umumiy yordamchilar
// ═══════════════════════════════════════════════════════════

const W = 760;
const H = 300;

/** Chiroyli o'q bo'linmalari: 0, 5 mln, 10 mln ... */
function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) {
    if (min === 0) return [0, 1];
    const pad = Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const rough = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / magnitude;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * magnitude;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function finite(values: (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

/** Null qiymatlarda uziladigan chiziq yo'llari */
function linePaths(points: ({ x: number; y: number } | null)[]): string[] {
  const paths: string[] = [];
  let current = '';
  for (const point of points) {
    if (!point) {
      if (current) paths.push(current);
      current = '';
      continue;
    }
    current += `${current ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  }
  if (current) paths.push(current);
  return paths;
}

function Legend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--color-text-muted)">
      {items.map((item) => (
        <span key={item.name} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 rounded"
            style={{
              background: item.dashed ? 'transparent' : item.color,
              borderTop: item.dashed ? `2px dashed ${item.color}` : undefined,
              height: item.dashed ? 0 : 3,
            }}
          />
          {item.name}
        </span>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 1. Vaqt qatori: ustun / chiziq + o'ng o'q + σ oralig'i
// ═══════════════════════════════════════════════════════════

function SeriesChart({ chart }: { chart: SeriesChartData }) {
  const [hover, setHover] = useState<number | null>(null);
  const { x, series, overlay, bands } = chart;
  const count = x.length;
  const unit = series[0]?.unit ?? 'number';
  const hasOverlay = Boolean(overlay && finite(overlay.values).length > 0);

  const pad = { left: 70, right: hasOverlay ? 56 : 18, top: 14, bottom: 34 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const all = finite([
    ...series.flatMap((s) => s.values),
    bands?.lower,
    bands?.upper,
    bands?.mean,
  ]);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all));
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const y = (v: number) => pad.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

  const overlayValues = overlay ? finite(overlay.values) : [];
  const oTicks = hasOverlay
    ? niceTicks(Math.min(0, ...overlayValues), Math.max(0, ...overlayValues))
    : [];
  const oMin = oTicks[0] ?? 0;
  const oMax = oTicks[oTicks.length - 1] ?? 1;
  const oy = (v: number) => pad.top + plotH - ((v - oMin) / (oMax - oMin || 1)) * plotH;

  const band = plotW / Math.max(count, 1);
  const cx = (i: number) => pad.left + band * i + band / 2;
  const labelEvery = Math.max(1, Math.ceil(count / 12));

  const barGroup = band * 0.72;
  const barW = chart.type === 'bar' ? barGroup / Math.max(series.length, 1) : 0;

  const legend = [
    ...series.map((s, i) => ({ name: s.name, color: CHART_COLORS[i % CHART_COLORS.length] })),
    ...(hasOverlay && overlay ? [{ name: overlay.name, color: OVERLAY_COLOR }] : []),
    ...(bands?.mean != null ? [{ name: "O'rtacha ± σ", color: '#94a3b8', dashed: true }] : []),
  ];

  return (
    <div>
      <Legend items={legend} />
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
          {/* Chap o'q */}
          {ticks.map((t) => (
            <g key={`t${t}`}>
              <line
                x1={pad.left}
                x2={W - pad.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--color-line, #e5e7eb)"
                strokeDasharray={t === 0 ? undefined : '3 3'}
              />
              <text x={pad.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="#6b7280">
                {formatAxis(t, unit)}
              </text>
            </g>
          ))}

          {/* O'ng o'q */}
          {hasOverlay &&
            oTicks.map((t) => (
              <text key={`o${t}`} x={W - pad.right + 8} y={oy(t) + 4} fontSize={11} fill={OVERLAY_COLOR}>
                {formatAxis(t, overlay!.unit)}
              </text>
            ))}

          {/* σ oralig'i */}
          {bands && bands.lower != null && bands.upper != null && (
            <rect
              x={pad.left}
              width={plotW}
              y={y(bands.upper)}
              height={Math.max(0, y(bands.lower) - y(bands.upper))}
              fill="#94a3b8"
              opacity={0.12}
            />
          )}
          {bands?.mean != null && (
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={y(bands.mean)}
              y2={y(bands.mean)}
              stroke="#64748b"
              strokeDasharray="6 4"
            />
          )}

          {/* Ustunlar */}
          {chart.type === 'bar' &&
            series.map((s, si) =>
              s.values.map((v, i) => {
                if (v == null || !Number.isFinite(v)) return null;
                const top = y(Math.max(v, 0));
                const height = Math.abs(y(v) - y(0));
                return (
                  <rect
                    key={`${si}-${i}`}
                    x={cx(i) - barGroup / 2 + barW * si + 1}
                    y={top}
                    width={Math.max(barW - 2, 1)}
                    height={Math.max(height, 0.5)}
                    rx={2}
                    fill={CHART_COLORS[si % CHART_COLORS.length]}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                );
              }),
            )}

          {/* Chiziqlar */}
          {chart.type === 'line' &&
            series.map((s, si) => {
              const color = CHART_COLORS[si % CHART_COLORS.length];
              const pts = s.values.map((v, i) =>
                v == null || !Number.isFinite(v) ? null : { x: cx(i), y: y(v) },
              );
              return (
                <g key={`l${si}`}>
                  {linePaths(pts).map((d, k) => (
                    <path key={k} d={d} fill="none" stroke={color} strokeWidth={2.25} />
                  ))}
                  {pts.map((p, i) =>
                    p ? <circle key={i} cx={p.x} cy={p.y} r={hover === i ? 4.5 : 3} fill={color} /> : null,
                  )}
                </g>
              );
            })}

          {/* Qo'shimcha chiziq (o'ng o'q) */}
          {hasOverlay && overlay && (
            <g>
              {linePaths(
                overlay.values.map((v, i) =>
                  v == null || !Number.isFinite(v) ? null : { x: cx(i), y: oy(v) },
                ),
              ).map((d, k) => (
                <path key={k} d={d} fill="none" stroke={OVERLAY_COLOR} strokeWidth={2} />
              ))}
              {overlay.values.map((v, i) =>
                v == null || !Number.isFinite(v) ? null : (
                  <circle key={i} cx={cx(i)} cy={oy(v)} r={hover === i ? 4.5 : 3} fill={OVERLAY_COLOR} />
                ),
              )}
            </g>
          )}

          {/* X o'qi */}
          {x.map((label, i) =>
            i % labelEvery === 0 ? (
              <text key={label} x={cx(i)} y={H - 12} textAnchor="middle" fontSize={11} fill="#6b7280">
                {formatCategory(label)}
              </text>
            ) : null,
          )}

          {/* Sichqoncha zonasi */}
          {x.map((label, i) => (
            <rect
              key={`h${label}`}
              x={pad.left + band * i}
              y={pad.top}
              width={band}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>

        {hover !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[10rem] rounded-md border border-(--color-line) bg-white px-3 py-2 text-xs shadow-md"
            style={{
              left: `${(cx(hover) / W) * 100}%`,
              transform: cx(hover) > W / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
            }}
          >
            <p className="mb-1 font-semibold text-(--color-text)">
              {isPeriod(x[hover]) ? formatCategory(x[hover]) : x[hover]}
            </p>
            {series.map((s, si) => (
              <p key={s.name} className="flex justify-between gap-3">
                <span style={{ color: CHART_COLORS[si % CHART_COLORS.length] }}>{s.name}</span>
                <span className="font-medium tabular-nums">{formatValue(s.values[hover], s.unit)}</span>
              </p>
            ))}
            {hasOverlay && overlay && (
              <p className="flex justify-between gap-3">
                <span style={{ color: OVERLAY_COLOR }}>{overlay.name}</span>
                <span className="font-medium tabular-nums">
                  {formatValue(overlay.values[hover], overlay.unit)}
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 2. Toifalar: gorizontal ustunlar (hududlar, turlar)
// ═══════════════════════════════════════════════════════════

function CategoryBars({ chart }: { chart: SeriesChartData }) {
  const s = chart.series[0];
  if (!s) return null;
  const max = Math.max(...finite(s.values).map(Math.abs), 0) || 1;

  return (
    <div className="space-y-2">
      {chart.x.map((name, i) => {
        const value = s.values[i];
        const width = value == null ? 0 : (Math.abs(value) / max) * 100;
        return (
          <div key={name} className="grid grid-cols-[minmax(7rem,12rem)_1fr_auto] items-center gap-3 text-sm">
            <span className="truncate text-(--color-text)" title={name}>
              {name}
            </span>
            <div className="h-5 overflow-hidden rounded bg-(--color-surface-sunken)">
              <div
                className="h-full rounded"
                style={{ width: `${width}%`, background: CHART_COLORS[0] }}
              />
            </div>
            <span className="w-20 text-right font-medium tabular-nums text-(--color-text)">
              {formatValue(value, s.unit)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 3. Ulushlar: halqa diagramma
// ═══════════════════════════════════════════════════════════

function PieChart({ chart }: { chart: PieChartData }) {
  const [hover, setHover] = useState<number | null>(null);
  const s = chart.series[0];
  if (!s) return null;

  const values = s.values.map((v) => (v != null && v > 0 ? v : 0));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const R = 110;
  const r = 66;
  const C = 130;

  // Har bo'lak boshlanish burchagi — oldingilar yig'indisidan (render ichida o'zgaruvchi qayta yozilmaydi)
  const starts: number[] = [];
  let acc = -Math.PI / 2;
  for (const v of values) {
    starts.push(acc);
    acc += (v / total) * Math.PI * 2;
  }
  const arcs = values.map((v, i) => {
    const sweep = (v / total) * Math.PI * 2;
    const start = starts[i]!;
    const end = start + sweep;
    const large = sweep > Math.PI ? 1 : 0;
    const p = (rad: number, radius: number) =>
      `${(C + radius * Math.cos(rad)).toFixed(2)},${(C + radius * Math.sin(rad)).toFixed(2)}`;
    // To'liq aylana bo'lsa ikki yarimga bo'lamiz
    const d =
      sweep >= Math.PI * 2 - 1e-6
        ? `M${p(start, R)}A${R},${R} 0 1 1 ${p(start + Math.PI, R)}A${R},${R} 0 1 1 ${p(start, R)}` +
          `M${p(start, r)}A${r},${r} 0 1 0 ${p(start + Math.PI, r)}A${r},${r} 0 1 0 ${p(start, r)}Z`
        : `M${p(start, R)}A${R},${R} 0 ${large} 1 ${p(end, R)}L${p(end, r)}A${r},${r} 0 ${large} 0 ${p(start, r)}Z`;
    return { d, color: CHART_COLORS[i % CHART_COLORS.length], value: v, sweep };
  });

  const active = hover ?? 0;

  return (
    <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
      <svg viewBox="0 0 260 260" className="w-56 shrink-0" role="img">
        {arcs.map((arc, i) =>
          arc.sweep > 0 ? (
            <path
              key={i}
              d={arc.d}
              fill={arc.color}
              fillRule="evenodd"
              opacity={hover === null || hover === i ? 1 : 0.45}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ) : null,
        )}
        <text x={C} y={C - 4} textAnchor="middle" fontSize={20} fontWeight={600} fill="#111827">
          {formatValue(s.values[active], s.unit)}
        </text>
        <text x={C} y={C + 16} textAnchor="middle" fontSize={11} fill="#6b7280">
          {(chart.x[active] ?? '').slice(0, 22)}
        </text>
      </svg>

      <ul className="w-full space-y-1.5 text-sm">
        {chart.x.map((name, i) => (
          <li
            key={name}
            className="flex items-center justify-between gap-3 rounded px-2 py-1 hover:bg-(--color-surface-sunken)"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-sm"
                style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
              />
              <span className="truncate text-(--color-text)">{name}</span>
            </span>
            <span className="font-medium tabular-nums text-(--color-text)">
              {formatValue(s.values[i], s.unit)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 4. Bog'liqlik: nuqtalar + regressiya chizig'i
// ═══════════════════════════════════════════════════════════

function ScatterChart({ chart }: { chart: ScatterChartData }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = chart.points.filter(
    (p): p is { x: number; y: number; label: string } =>
      p.x != null && p.y != null && Number.isFinite(p.x) && Number.isFinite(p.y),
  );
  if (points.length === 0) return null;

  const pad = { left: 70, right: 18, top: 14, bottom: 44 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xTicks = niceTicks(Math.min(...xs), Math.max(...xs));
  const yTicks = niceTicks(Math.min(0, ...ys), Math.max(...ys));
  const [x0, x1] = [xTicks[0], xTicks[xTicks.length - 1]];
  const [y0, y1] = [yTicks[0], yTicks[yTicks.length - 1]];
  const sx = (v: number) => pad.left + ((v - x0) / (x1 - x0 || 1)) * plotW;
  const sy = (v: number) => pad.top + plotH - ((v - y0) / (y1 - y0 || 1)) * plotH;

  const line = chart.line;
  const hasLine = line && line.slope != null && line.intercept != null;
  const clampY = (v: number) => Math.min(Math.max(v, y0), y1);
  const hovered = hover !== null ? points[hover] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={pad.left} x2={W - pad.right} y1={sy(t)} y2={sy(t)} stroke="var(--color-line, #e5e7eb)" strokeDasharray="3 3" />
            <text x={pad.left - 8} y={sy(t) + 4} textAnchor="end" fontSize={11} fill="#6b7280">
              {formatAxis(t, chart.yUnit)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={H - 26} textAnchor="middle" fontSize={11} fill="#6b7280">
            {formatAxis(t, chart.xUnit)}
          </text>
        ))}
        <text x={pad.left + plotW / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="#374151">
          {chart.xLabel} →
        </text>
        <text
          x={14}
          y={pad.top + plotH / 2}
          textAnchor="middle"
          fontSize={11}
          fill="#374151"
          transform={`rotate(-90 14 ${pad.top + plotH / 2})`}
        >
          {chart.yLabel} →
        </text>

        {hasLine && (
          <line
            x1={sx(x0)}
            y1={sy(clampY(line!.intercept! + line!.slope! * x0))}
            x2={sx(x1)}
            y2={sy(clampY(line!.intercept! + line!.slope! * x1))}
            stroke={OVERLAY_COLOR}
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        )}

        {points.map((p, i) => (
          <circle
            key={i}
            cx={sx(p.x)}
            cy={sy(p.y)}
            r={hover === i ? 6 : 4.5}
            fill={CHART_COLORS[0]}
            fillOpacity={hover === null || hover === i ? 0.75 : 0.35}
            stroke="white"
            strokeWidth={1}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-(--color-line) bg-white px-3 py-2 text-xs shadow-md"
          style={{
            left: `${(sx(hovered.x) / W) * 100}%`,
            top: `${(sy(hovered.y) / H) * 100}%`,
            transform: sx(hovered.x) > W / 2 ? 'translate(calc(-100% - 10px), -50%)' : 'translate(10px, -50%)',
          }}
        >
          <p className="mb-1 font-semibold text-(--color-text)">{hovered.label}</p>
          <p>
            {chart.xLabel}: <b className="tabular-nums">{formatValue(hovered.x, chart.xUnit)}</b>
          </p>
          <p>
            {chart.yLabel}: <b className="tabular-nums">{formatValue(hovered.y, chart.yUnit)}</b>
          </p>
        </div>
      )}

      {hasLine && (
        <p className="mt-1 text-xs text-(--color-text-muted)">
          Uzuq chiziq — eng kichik kvadratlar usulidagi to&apos;g&apos;ri chiziq: Y = {formatAxis(line!.intercept!, chart.yUnit)} {line!.slope! < 0 ? '−' : '+'}{' '}
          {formatAxis(Math.abs(line!.slope!), 'number')} × X
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Tanlovchi
// ═══════════════════════════════════════════════════════════

export function ModelChart({ chart }: { chart: ChartData }) {
  switch (chart.type) {
    case 'pie':
      return <PieChart chart={chart} />;
    case 'scatter':
      return <ScatterChart chart={chart} />;
    case 'bar':
    case 'line': {
      const timeline = chart.x.length > 0 && chart.x.every(isPeriod);
      if (!timeline && chart.type === 'bar' && !chart.overlay) return <CategoryBars chart={chart} />;
      return <SeriesChart chart={chart} />;
    }
    default:
      return null;
  }
}