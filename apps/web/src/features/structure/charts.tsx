'use client';

import { compact, TONE } from './api';

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
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-(--color-text-muted)">
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
