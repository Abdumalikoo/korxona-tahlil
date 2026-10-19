'use client';

import { compact, TONE } from '@/features/structure/api';
import { formatPeriod, formatPeriodShort } from '@/lib/format';
import type { ReactNode } from 'react';
import type { ForecastResult, Target } from './api';
import { monthTitle } from './api';

// ═══════════════════════════════════════════════════════════
// Katta modellar — grafiklar
// ═══════════════════════════════════════════════════════════

/** Ko'rsatkich rangi: daromad — yashil, xarajat — qizil, natija — to'q */
export function targetColor(target: Target): string {
  if (target === 'income') return TONE.income;
  if (target === 'result') return TONE.ink;
  return TONE.expense;
}

const BAND_95 = '#e8edf4';
const BAND_80 = '#c9d6e6';
const FITTED = '#94a3b8';

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

/**
 * Prognoz grafigi: tarix (to'liq chiziq), model moslashuvi (nuqtali), prognoz (uzuq chiziq)
 * va ishonch oraliqlari (80% — to'qroq, 95% — ochroq soha). Joriy oyda — hozircha yozilgan summa.
 */
export function ForecastChart({ data, height = 300, historyLimit = 24 }: { data: ForecastResult; height?: number; historyLimit?: number }) {
  const W = 960;
  const H = height;
  const pad = { l: 66, r: 20, t: 22, b: 28 };
  const history = data.history.slice(-historyLimit);
  const forecast = data.forecast;
  const periods = [...history.map((h) => h.period), ...forecast.map((f) => f.period)];
  const n = periods.length;
  if (n === 0) return null;
  const color = targetColor(data.target);

  const hist = history.map((h) => Number(h.valueTiyin));
  const fitted = history.map((h) => (h.fittedTiyin === null ? null : Number(h.fittedTiyin)));
  const mean = forecast.map((f) => Number(f.meanTiyin));
  const lo80 = forecast.map((f) => Number(f.lo80Tiyin));
  const hi80 = forecast.map((f) => Number(f.hi80Tiyin));
  const lo95 = forecast.map((f) => Number(f.lo95Tiyin));
  const hi95 = forecast.map((f) => Number(f.hi95Tiyin));
  const soFar = forecast[0]?.actualSoFarTiyin ? Number(forecast[0].actualSoFarTiyin) : null;

  const all = [...hist, ...fitted.filter((v): v is number => v !== null), ...lo95, ...hi95, ...(soFar !== null ? [soFar] : [])];
  const ticks = niceTicks(Math.min(0, ...all), Math.max(1, ...all), 4);
  const dMin = ticks[0]!;
  const dMax = ticks[ticks.length - 1]!;
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const step = n > 1 ? plotW / (n - 1) : 0;
  const x = (i: number) => pad.l + i * step;
  const y = (v: number) => pad.t + plotH * (1 - (v - dMin) / (dMax - dMin || 1));
  const h0 = history.length;

  // Prognoz sohasi tarixning oxirgi nuqtasidan boshlanadi — chiziq uzilmaydi
  const anchor = h0 > 0 ? hist[h0 - 1]! : null;
  const band = (lo: number[], hi: number[]) => {
    const top = hi.map((v, i) => `${x(h0 + i).toFixed(1)},${y(v).toFixed(1)}`);
    const bottom = lo.map((v, i) => `${x(h0 + i).toFixed(1)},${y(v).toFixed(1)}`).reverse();
    const start = anchor !== null ? [`${x(h0 - 1).toFixed(1)},${y(anchor).toFixed(1)}`] : [];
    return [...start, ...top, ...bottom].join(' ');
  };
  const line = (values: (number | null)[], offset = 0) =>
    values
      .map((v, i) => (v === null ? null : `${x(offset + i).toFixed(1)},${y(v).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');
  const every = Math.max(1, Math.ceil(n / 14));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${data.targetLabel} prognozi`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? TONE.axis : TONE.grid} />
          <text x={pad.l - 8} y={y(t) + 3.5} fontSize={10.5} fill={TONE.axis} textAnchor="end">
            {t === 0 ? '0' : compact(t)}
          </text>
        </g>
      ))}

      {forecast.length > 0 && (
        <g>
          <rect x={x(h0) - step / 2} y={pad.t} width={W - pad.r - (x(h0) - step / 2)} height={plotH} fill="#f8fafc" />
          <polygon points={band(lo95, hi95)} fill={BAND_95} />
          <polygon points={band(lo80, hi80)} fill={BAND_80} />
          <line x1={x(h0) - step / 2} x2={x(h0) - step / 2} y1={pad.t - 10} y2={pad.t + plotH} stroke={TONE.axis} strokeDasharray="2 3" />
          <text x={x(h0) - step / 2 + 6} y={pad.t - 3} fontSize={10.5} fill={TONE.slate} fontWeight={600}>
            prognoz →
          </text>
          {h0 > 0 && (
            <text x={x(h0) - step / 2 - 6} y={pad.t - 3} fontSize={10.5} fill={TONE.axis} textAnchor="end">
              ← haqiqiy
            </text>
          )}
        </g>
      )}

      <polyline points={line(fitted)} fill="none" stroke={FITTED} strokeWidth={1.4} strokeDasharray="2 3" />
      <polyline points={line(hist)} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
      {forecast.length > 0 && (
        <polyline
          points={[anchor !== null ? `${x(h0 - 1).toFixed(1)},${y(anchor).toFixed(1)}` : '', line(mean, h0)].filter(Boolean).join(' ')}
          fill="none"
          stroke={color}
          strokeWidth={2.2}
          strokeDasharray="7 5"
          strokeLinejoin="round"
        />
      )}
      {hist.map((v, i) => (
        <circle key={`h${i}`} cx={x(i)} cy={y(v)} r={2.4} fill="#fff" stroke={color} strokeWidth={1.4} />
      ))}
      {mean.map((v, i) => (
        <circle key={`f${i}`} cx={x(h0 + i)} cy={y(v)} r={3} fill={color} />
      ))}
      {soFar !== null && (
        <g>
          <rect x={x(h0) - 4.5} y={y(soFar) - 4.5} width={9} height={9} fill="#fff" stroke={TONE.ink} strokeWidth={1.5} />
          <text x={x(h0)} y={y(soFar) + 18} fontSize={10.5} fill={TONE.ink} textAnchor="middle">
            hozircha {compact(soFar)}
          </text>
        </g>
      )}

      {periods.map((p, i) => {
        const isForecast = i >= h0;
        const f = isForecast ? forecast[i - h0]! : null;
        const tip = isForecast
          ? `${formatPeriod(p)} — prognoz\nKutilmoqda: ${compact(f!.meanTiyin)} so'm\n80%: ${compact(f!.lo80Tiyin)} – ${compact(f!.hi80Tiyin)}\n95%: ${compact(f!.lo95Tiyin)} – ${compact(f!.hi95Tiyin)}${f!.actualSoFarTiyin ? `\nHozircha yozilgan: ${compact(f!.actualSoFarTiyin)}` : ''}`
          : `${formatPeriod(p)}\nHaqiqiy: ${compact(hist[i]!)} so'm${fitted[i] !== null ? `\nModel: ${compact(fitted[i]!)}` : ''}`;
        return (
          <g key={p}>
            <title>{tip}</title>
            <rect x={x(i) - Math.max(step, 8) / 2} y={pad.t} width={Math.max(step, 8)} height={plotH} fill="transparent" />
            {(i % every === 0 || i === h0) && (
              <text x={x(i)} y={H - 8} fontSize={10.5} fill={isForecast ? TONE.slate : '#6b7280'} fontWeight={isForecast ? 600 : 400} textAnchor="middle">
                {formatPeriodShort(p)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Grafik izohi */
export function ForecastLegend({ target }: { target: Target }) {
  const color = targetColor(target);
  const item = (swatch: ReactNode, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      {swatch}
      {label}
    </span>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-[--color-text-muted]">
      {item(<span className="h-0.5 w-5" style={{ background: color }} />, 'Haqiqiy (tugagan oylar)')}
      {item(<span className="h-0 w-5 border-t-2 border-dashed" style={{ borderColor: color }} />, 'Prognoz')}
      {item(<span className="h-2.5 w-5" style={{ background: BAND_80 }} />, '80% ehtimol oralig\'i')}
      {item(<span className="h-2.5 w-5" style={{ background: BAND_95 }} />, '95% ehtimol oralig\'i')}
      {item(<span className="h-0 w-5 border-t-2 border-dotted" style={{ borderColor: FITTED }} />, 'Model o\'tmishni qanday tushuntirgan')}
      {item(<span className="size-2.5 border-[1.5px] border-[--color-text] bg-white" />, 'Joriy oy: hozircha yozilgan')}
    </div>
  );
}

/** Mavsumiy ta'sir: har oy o'rtachadan qancha yuqori yoki past */
export function SeasonChart({ seasonal, target }: { seasonal: { month: number; effectTiyin: string }[]; target: Target }) {
  const W = 480;
  const H = 200;
  const pad = { l: 58, r: 8, t: 12, b: 24 };
  const values = seasonal.map((s) => Number(s.effectTiyin));
  const max = Math.max(1, ...values.map(Math.abs));
  const ticks = niceTicks(-max, max, 4);
  const dMin = ticks[0]!;
  const dMax = ticks[ticks.length - 1]!;
  const plotH = H - pad.t - pad.b;
  const y = (v: number) => pad.t + plotH * (1 - (v - dMin) / (dMax - dMin || 1));
  const slot = (W - pad.l - pad.r) / 12;
  const good = target === 'income' || target === 'result';
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? TONE.axis : TONE.grid} />
          <text x={pad.l - 6} y={y(t) + 3.5} fontSize={10} fill={TONE.axis} textAnchor="end">
            {t === 0 ? '0' : `${t > 0 ? '+' : ''}${compact(t)}`}
          </text>
        </g>
      ))}
      {seasonal.map((s, i) => {
        const v = values[i]!;
        const up = v >= 0;
        const fill = up === good ? TONE.income : TONE.expense;
        const top = y(Math.max(v, 0));
        const bottom = y(Math.min(v, 0));
        return (
          <g key={s.month}>
            <title>{`${monthTitle(s.month)}: o'rtachadan ${v >= 0 ? '+' : '−'}${compact(Math.abs(v))} so'm`}</title>
            <rect x={pad.l + i * slot + slot * 0.18} y={top} width={slot * 0.64} height={Math.max(1, bottom - top)} fill={fill} opacity={0.85} />
            <text x={pad.l + i * slot + slot / 2} y={H - 8} fontSize={10} fill="#6b7280" textAnchor="middle">
              {monthTitle(s.month).slice(0, 3)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Kichik chiziq: tarix — to'liq, prognoz — uzuq */
export function SparkForecast({ values, from, color, width = 120, height = 28 }: { values: string[]; from: number; color: string; width?: number; height?: number }) {
  const nums = values.map(Number);
  if (nums.length < 2) return null;
  const min = Math.min(...nums, 0);
  const max = Math.max(...nums, 1);
  const x = (i: number) => 2 + (i * (width - 4)) / (nums.length - 1);
  const y = (v: number) => 3 + (height - 6) * (1 - (v - min) / (max - min || 1));
  const pts = (a: number, b: number) =>
    nums
      .slice(a, b)
      .map((v, i) => `${x(a + i).toFixed(1)},${y(v).toFixed(1)}`)
      .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden>
      {min < 0 && <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke={TONE.grid} />}
      <polyline points={pts(0, from)} fill="none" stroke={TONE.slate} strokeWidth={1.4} />
      {from < nums.length && <polyline points={pts(Math.max(0, from - 1), nums.length)} fill="none" stroke={color} strokeWidth={1.6} strokeDasharray="3 2" />}
    </svg>
  );
}