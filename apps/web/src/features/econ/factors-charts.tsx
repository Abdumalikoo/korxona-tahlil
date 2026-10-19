'use client';

import { compact, RAMP, TONE } from '@/features/structure/api';
import { useMemo } from 'react';
import type { FactorCoef, FactorsResult } from './api';

// ═══════════════════════════════════════════════════════════
// Omillar tahlili — grafiklar
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

const dec = (v: number, d = 2) => v.toFixed(d).replace('.', ',');

/** Elastikliklar: nuqta — baho, chiziq — 95% oraliq, 0 — ta'sir yo'q */
export function ForestPlot({ rows }: { rows: FactorCoef[] }) {
  const W = 560;
  const rowH = 38;
  const pad = { l: 190, r: 64, t: 10, b: 26 };
  const H = pad.t + pad.b + rows.length * rowH;
  const lo = Math.min(0, ...rows.map((r) => r.lo95));
  const hi = Math.max(0, ...rows.map((r) => r.hi95));
  const ticks = niceTicks(lo, hi, 4);
  const dMin = ticks[0]!;
  const dMax = ticks[ticks.length - 1]!;
  const x = (v: number) => pad.l + ((v - dMin) / (dMax - dMin || 1)) * (W - pad.l - pad.r);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} stroke={t === 0 ? TONE.ink : TONE.grid} strokeDasharray={t === 0 ? '3 3' : undefined} />
          <text x={x(t)} y={H - 8} fontSize={10.5} fill={TONE.axis} textAnchor="middle">
            {dec(t, Math.abs(t) < 1 && t !== 0 ? 2 : 1)}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const cy = pad.t + i * rowH + rowH / 2;
        const color = r.significance === 'strong' ? (r.value >= 0 ? TONE.income : TONE.expense) : r.significance === 'weak' ? '#b45309' : TONE.axis;
        return (
          <g key={r.key}>
            <title>{`${r.label}\nElastiklik: ${dec(r.value)} (95%: ${dec(r.lo95)} … ${dec(r.hi95)})\np = ${dec(r.p, 3)}`}</title>
            <text x={pad.l - 10} y={cy + 4} fontSize={11.5} fill={TONE.ink} textAnchor="end">
              {r.label.length > 28 ? `${r.label.slice(0, 27)}…` : r.label}
            </text>
            <line x1={x(r.lo95)} x2={x(r.hi95)} y1={cy} y2={cy} stroke={color} strokeWidth={2.2} />
            <line x1={x(r.lo95)} x2={x(r.lo95)} y1={cy - 5} y2={cy + 5} stroke={color} strokeWidth={1.5} />
            <line x1={x(r.hi95)} x2={x(r.hi95)} y1={cy - 5} y2={cy + 5} stroke={color} strokeWidth={1.5} />
            <circle cx={x(r.value)} cy={cy} r={5} fill={color} />
            <text x={W - pad.r + 8} y={cy + 4} fontSize={11.5} fontWeight={600} fill={color}>
              {r.value >= 0 ? '+' : '−'}
              {dec(Math.abs(r.value))}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Hudud effekti: resurslariga nisbatan kutilganidan ko'p (+) yoki kam (−) daromad, oyiga */
export function EffectBars({ rows }: { rows: FactorsResult['unitEffects'] }) {
  const W = 620;
  const rowH = 24;
  const pad = { l: 150, r: 84, t: 6, b: 22 };
  const H = pad.t + pad.b + rows.length * rowH;
  const values = rows.map((r) => Number(r.effectTiyin));
  const m = Math.max(1, ...values.map(Math.abs));
  const ticks = niceTicks(-m, m, 4);
  const dMin = ticks[0]!;
  const dMax = ticks[ticks.length - 1]!;
  const x = (v: number) => pad.l + ((v - dMin) / (dMax - dMin || 1)) * (W - pad.l - pad.r);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} stroke={t === 0 ? TONE.ink : TONE.grid} />
          <text x={x(t)} y={H - 6} fontSize={10} fill={TONE.axis} textAnchor="middle">
            {t === 0 ? '0' : `${t > 0 ? '+' : '−'}${compact(Math.abs(t))}`}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const v = values[i]!;
        const y = pad.t + i * rowH;
        const x0 = x(Math.min(0, v));
        const x1 = x(Math.max(0, v));
        return (
          <g key={r.key}>
            <title>{`${r.name}\nHaqiqiy o'rtacha daromad: ${compact(r.actualTiyin)} so'm/oy\nResurslariga ko'ra kutilgan: ${compact(r.expectedTiyin)} so'm/oy\nFarq: ${v >= 0 ? '+' : '−'}${compact(Math.abs(v))} so'm/oy`}</title>
            <text x={pad.l - 8} y={y + rowH / 2 + 4} fontSize={11} fill={TONE.ink} textAnchor="end">
              {r.name}
            </text>
            <rect x={x0} y={y + 5} width={Math.max(1, x1 - x0)} height={rowH - 10} fill={v >= 0 ? TONE.income : TONE.expense} opacity={0.85} />
            <text x={v >= 0 ? x1 + 5 : x(0) + 5} y={y + rowH / 2 + 4} fontSize={10.5} fill={TONE.slate} textAnchor="start">
              {v >= 0 ? '+' : '−'}
              {compact(Math.abs(v))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Umumiy samaradorlik (TFP) indeksi: 100 — o'rtacha */
export function TfpBars({ rows }: { rows: { key: string; name: string; index: number }[] }) {
  const W = 520;
  const rowH = 22;
  const pad = { l: 150, r: 44, t: 6, b: 22 };
  const H = pad.t + pad.b + rows.length * rowH;
  const lo = Math.min(80, ...rows.map((r) => r.index));
  const hi = Math.max(120, ...rows.map((r) => r.index));
  const ticks = niceTicks(lo, hi, 4);
  const dMin = ticks[0]!;
  const dMax = ticks[ticks.length - 1]!;
  const x = (v: number) => pad.l + ((v - dMin) / (dMax - dMin || 1)) * (W - pad.l - pad.r);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} stroke={t === 100 ? TONE.ink : TONE.grid} strokeDasharray={t === 100 ? '3 3' : undefined} />
          <text x={x(t)} y={H - 6} fontSize={10} fill={TONE.axis} textAnchor="middle">
            {t}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = pad.t + i * rowH;
        const x0 = x(Math.min(100, r.index));
        const x1 = x(Math.max(100, r.index));
        return (
          <g key={r.key}>
            <title>{`${r.name}: ${dec(r.index, 0)} — bir xil xodim va xarajat bilan o'rtachadan ${r.index >= 100 ? `${dec(r.index - 100, 0)}% ko'p` : `${dec(100 - r.index, 0)}% kam`} daromad`}</title>
            <text x={pad.l - 8} y={y + rowH / 2 + 4} fontSize={11} fill={TONE.ink} textAnchor="end">
              {r.name}
            </text>
            <rect x={x0} y={y + 5} width={Math.max(1, x1 - x0)} height={rowH - 10} fill={r.index >= 100 ? RAMP[2] : RAMP[7]} />
            <text x={x1 + 5} y={y + rowH / 2 + 4} fontSize={10.5} fill={TONE.slate}>
              {dec(r.index, 0)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Miqyos samarasi shkalasi: α + β va 1 chizig'i */
export function ScaleGauge({ sum, se }: { sum: number; se: number }) {
  const W = 420;
  const H = 64;
  const lo = Math.min(0.5, sum - 2 * se);
  const hi = Math.max(1.5, sum + 2 * se);
  const x = (v: number) => 16 + ((v - lo) / (hi - lo)) * (W - 32);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      <rect x={x(lo)} y={22} width={x(1) - x(lo)} height={10} fill="#f0d4d1" />
      <rect x={x(1)} y={22} width={x(hi) - x(1)} height={10} fill="#cfe5d9" />
      <line x1={x(1)} x2={x(1)} y1={14} y2={40} stroke={TONE.ink} strokeDasharray="3 2" />
      <text x={x(1)} y={10} fontSize={10.5} fill={TONE.ink} textAnchor="middle">
        1 — doimiy
      </text>
      <text x={x(lo)} y={54} fontSize={10} fill={TONE.expense}>
        kamayuvchi
      </text>
      <text x={x(hi)} y={54} fontSize={10} fill={TONE.income} textAnchor="end">
        o&apos;suvchi
      </text>
      <line x1={x(sum - 1.96 * se)} x2={x(sum + 1.96 * se)} y1={27} y2={27} stroke={TONE.ink} strokeWidth={2} />
      <circle cx={x(sum)} cy={27} r={6} fill={TONE.ink} />
      <text x={x(sum)} y={54} fontSize={11} fontWeight={700} fill={TONE.ink} textAnchor="middle">
        {dec(sum)}
      </text>
    </svg>
  );
}

/** Nuqtali grafik: hudud-oylar (och) va hudud o'rtachalari (to'q, nomli) + chiziqli moslik */
export function FactorScatter({
  data,
  factor,
  unit,
}: {
  data: FactorsResult;
  factor: keyof FactorsResult['points'][number]['factors'];
  unit: 'kishi' | 'som';
}) {
  const W = 620;
  const H = 320;
  const pad = { l: 66, r: 16, t: 12, b: 36 };
  const pts = data.points.map((p) => ({ x: p.factors[factor], y: p.incomeTiyin }));
  const means = data.regionMeans.map((m) => ({ x: m.factors[factor], y: m.incomeTiyin, name: m.name }));
  const fmtX = (v: number) => (unit === 'kishi' ? dec(v, v < 10 ? 1 : 0) : compact(v));
  const fit = useMemo(() => {
    const n = pts.length;
    if (n < 3) return null;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n;
    const my = pts.reduce((s, p) => s + p.y, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (const p of pts) {
      sxy += (p.x - mx) * (p.y - my);
      sxx += (p.x - mx) ** 2;
    }
    if (sxx === 0) return null;
    const b = sxy / sxx;
    return { a: my - b * mx, b };
  }, [pts]);
  if (pts.length === 0) return null;
  const xt = niceTicks(Math.min(0, ...pts.map((p) => p.x)), Math.max(1, ...pts.map((p) => p.x)), 5);
  const yt = niceTicks(Math.min(0, ...pts.map((p) => p.y)), Math.max(1, ...pts.map((p) => p.y)), 4);
  const X = (v: number) => pad.l + ((v - xt[0]!) / (xt[xt.length - 1]! - xt[0]! || 1)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - yt[0]!) / (yt[yt.length - 1]! - yt[0]! || 1)) * (H - pad.t - pad.b);
  const xMax = xt[xt.length - 1]!;
  const xMin = xt[0]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {yt.map((t) => (
        <g key={`y${t}`}>
          <line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} stroke={TONE.grid} />
          <text x={pad.l - 8} y={Y(t) + 3.5} fontSize={10.5} fill={TONE.axis} textAnchor="end">
            {t === 0 ? '0' : compact(t)}
          </text>
        </g>
      ))}
      {xt.map((t) => (
        <text key={`x${t}`} x={X(t)} y={H - 20} fontSize={10.5} fill={TONE.axis} textAnchor="middle">
          {t === 0 ? '0' : fmtX(t)}
        </text>
      ))}
      <text x={(pad.l + W - pad.r) / 2} y={H - 4} fontSize={11} fill={TONE.slate} textAnchor="middle">
        {data.available.find((a) => a.key === factor)?.label} (oyiga)
      </text>
      {pts.map((p, i) => (
        <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={2.6} fill={RAMP[8]} opacity={0.7} />
      ))}
      {fit && (
        <line x1={X(xMin)} x2={X(xMax)} y1={Y(fit.a + fit.b * xMin)} y2={Y(fit.a + fit.b * xMax)} stroke={TONE.ink} strokeWidth={1.4} strokeDasharray="6 4" />
      )}
      {means.map((m) => (
        <g key={m.name}>
          <title>{`${m.name}\nO'rtacha daromad: ${compact(m.y)} so'm/oy\n${fmtX(m.x)}${unit === 'kishi' ? ' kishi' : " so'm"}`}</title>
          <circle cx={X(m.x)} cy={Y(m.y)} r={5} fill={RAMP[1]} stroke="#fff" strokeWidth={1.2} />
          <text x={X(m.x) + 7} y={Y(m.y) + 3.5} fontSize={10} fill={TONE.ink}>
            {m.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Korrelyatsiya matritsasi: yashil — birga o'sadi, qizil — biri o'ssa boshqasi kamayadi */
export function CorrMatrix({ data }: { data: NonNullable<FactorsResult['correlation']> }) {
  const n = data.labels.length;
  const cell = 58;
  const left = 190;
  const top = 8;
  const W = left + n * cell + 8;
  const H = top + n * cell + 120;
  const color = (v: number | null) => {
    if (v === null) return '#f3f4f6';
    const a = Math.min(1, Math.abs(v));
    const [r, g, b] = v >= 0 ? [47, 122, 87] : [179, 66, 59];
    return `rgba(${r},${g},${b},${0.12 + a * 0.78})`;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[640px]">
      {data.labels.map((label, i) => (
        <text key={`r${i}`} x={left - 8} y={top + i * cell + cell / 2 + 4} fontSize={11} fill={TONE.ink} textAnchor="end">
          {label.length > 26 ? `${label.slice(0, 25)}…` : label}
        </text>
      ))}
      {data.labels.map((label, j) => (
        <text
          key={`c${j}`}
          x={left + j * cell + cell / 2}
          y={top + n * cell + 10}
          fontSize={10.5}
          fill={TONE.slate}
          textAnchor="end"
          transform={`rotate(-40 ${left + j * cell + cell / 2} ${top + n * cell + 10})`}
        >
          {label.length > 22 ? `${label.slice(0, 21)}…` : label}
        </text>
      ))}
      {data.matrix.map((row, i) =>
        row.map((v, j) => (
          <g key={`${i}-${j}`}>
            <title>{`${data.labels[i]} ↔ ${data.labels[j]}: ${v === null ? '—' : dec(v)}`}</title>
            <rect x={left + j * cell + 1} y={top + i * cell + 1} width={cell - 2} height={cell - 2} fill={color(v)} />
            <text x={left + j * cell + cell / 2} y={top + i * cell + cell / 2 + 4} fontSize={11} fontWeight={600} fill={v !== null && Math.abs(v) > 0.55 ? '#fff' : TONE.ink} textAnchor="middle">
              {v === null ? '—' : dec(v)}
            </text>
          </g>
        )),
      )}
    </svg>
  );
}