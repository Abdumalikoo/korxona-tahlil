'use client';

import { cn } from '@/lib/utils';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { monthShort, short } from './api';

// ═══════════════════════════════════════════════════════════
// Hudud uchun reja — oddiy SVG grafiklar (haqiqiy piksel o'lchamida chiziladi).
// Bo'sh oy (null) — chiziq uziladi, nol deb chizilmaydi.
// ═══════════════════════════════════════════════════════════

export const PALETTE = { blue: '#2a78d6', orange: '#eb6834', green: '#1baf7a', yellow: '#eda100', pink: '#e87ba4', gray: '#a3a29c' };

export interface TrendSeries {
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

interface TrendProps {
  months: string[];
  series: TrendSeries[];
  /** Prognoz nuqtasi — oxirgi oydan keyin alohida ko'rsatiladi */
  forecast?: { period: string; value: number; lo?: number | null; hi?: number | null; label?: string } | null;
  height?: number;
  format?: (v: number) => string;
}

const PAD = { top: 14, right: 30, bottom: 26, left: 70 };

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || 720);
    const ro = new ResizeObserver((e) => {
      const w = e[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Oylik dinamika: bir nechta chiziq + (ixtiyoriy) prognoz nuqtasi va oralig'i */
export function TrendChart({ months, series, forecast, height = 260, format = short }: TrendProps) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const cols = forecast ? [...months, forecast.period] : months;
  const n = cols.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null && Number.isFinite(v)));
  if (forecast) all.push(forecast.value, forecast.hi ?? forecast.value);
  const max = niceMax(Math.max(0, ...all));
  const w = Math.max(width, 320);
  const iw = w - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * max);
  const step = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(iw / 70))));

  const path = (vals: (number | null)[]) => {
    let d = '';
    let open = false;
    vals.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        open = false;
        return;
      }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      open = true;
    });
    return d;
  };

  if (all.length === 0) return <ChartEmpty height={height} />;
  const last = months.length - 1;
  const lastVal = series[0]?.values[last] ?? null;

  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={w} height={height} className="block" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-slate-200" strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
              {format(t)}
            </text>
          </g>
        ))}
        {cols.map((m, i) =>
          i % step === 0 || i === n - 1 ? (
            <text key={m} x={x(i)} y={height - 6} textAnchor="middle" className={cn('text-[11px]', forecast && i === n - 1 ? 'fill-[#eb6834] font-semibold' : 'fill-slate-500')}>
              {monthShort(m)}
            </text>
          ) : null,
        )}
        {forecast && (
          <>
            <rect x={x(n - 1) - Math.min(18, iw / n / 2)} y={PAD.top} width={Math.min(36, iw / n)} height={ih} fill={PALETTE.orange} opacity={0.06} />
            {forecast.lo !== null && forecast.lo !== undefined && forecast.hi !== null && forecast.hi !== undefined && (
              <line x1={x(n - 1)} x2={x(n - 1)} y1={y(forecast.hi)} y2={y(forecast.lo)} stroke={PALETTE.orange} strokeWidth={6} strokeLinecap="round" opacity={0.25} />
            )}
            {lastVal !== null && <line x1={x(last)} y1={y(lastVal)} x2={x(n - 1)} y2={y(forecast.value)} stroke={PALETTE.orange} strokeWidth={2} strokeDasharray="5 4" />}
          </>
        )}
        {series.map((s) => (
          <path key={s.label} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />
        ))}
        {series.map((s) =>
          s.values.map((v, i) =>
            v !== null && Number.isFinite(v) && (hover === i || (i > 0 && s.values[i - 1] === null && s.values[i + 1] === null)) ? (
              <circle key={`${s.label}${i}`} cx={x(i)} cy={y(v)} r={3.5} fill="white" stroke={s.color} strokeWidth={2} />
            ) : null,
          ),
        )}
        {forecast && <circle cx={x(n - 1)} cy={y(forecast.value)} r={5} fill={PALETTE.orange} stroke="white" strokeWidth={2} />}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} stroke="#94a3b8" strokeDasharray="3 3" />}
        {cols.map((m, i) => (
          <rect key={`h${m}`} x={x(i) - iw / Math.max(1, n - 1) / 2} y={PAD.top} width={iw / Math.max(1, n - 1)} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} />
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-2 z-10 min-w-40 rounded-lg border border-(--color-border) bg-white px-3 py-2 text-xs shadow-lg"
          style={{ left: Math.min(Math.max(x(hover) - 80, 0), w - 180) }}
        >
          <p className="mb-1 font-semibold text-heading">{monthShort(cols[hover]!)}</p>
          {forecast && hover === n - 1 ? (
            <>
              <Row color={PALETTE.orange} label={forecast.label ?? 'Prognoz'} value={format(forecast.value)} />
              {forecast.lo !== null && forecast.lo !== undefined && forecast.hi !== null && forecast.hi !== undefined && (
                <p className="mt-0.5 text-(--color-text-muted)">
                  Oraliq: {format(forecast.lo)} — {format(forecast.hi)}
                </p>
              )}
            </>
          ) : (
            series.map((s) => <Row key={s.label} color={s.color} label={s.label} value={s.values[hover] === null || s.values[hover] === undefined ? "ma'lumot yo'q" : format(s.values[hover]!)} />)
          )}
        </div>
      )}
      <Legend items={[...series.map((s) => ({ color: s.color, label: s.label, dashed: s.dashed })), ...(forecast ? [{ color: PALETTE.orange, label: forecast.label ?? 'Prognoz', dashed: true }] : [])]} />
    </div>
  );
}

function Row({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <p className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-(--color-text-muted)">
        <span className="size-2 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="money font-semibold text-heading">{value}</span>
    </p>
  );
}

export function Legend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 pl-14 text-xs text-(--color-text-muted)">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <svg width="18" height="6">
            <line x1="0" x2="18" y1="3" y2="3" stroke={i.color} strokeWidth="2.5" strokeDasharray={i.dashed ? '4 3' : undefined} />
          </svg>
          {i.label}
        </span>
      ))}
    </div>
  );
}

function ChartEmpty({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center rounded-xl bg-(--color-surface-sunken) text-sm text-(--color-text-muted)" style={{ height }}>
      Ma’lumot yetarli emas
    </div>
  );
}

/** Gorizontal ustunlar: nom — ustun — qiymat */
export function BarList({ rows, color = PALETTE.blue, format = short, empty = 'Ma’lumot yetarli emas' }: { rows: { key: string; label: ReactNode; value: number | null; hint?: ReactNode; muted?: boolean }[]; color?: string; format?: (v: number) => string; empty?: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value ?? 0));
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-(--color-text-muted)">{empty}</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-heading" title={typeof r.label === 'string' ? r.label : undefined}>
            {r.label}
          </span>
          <span className="h-2.5 overflow-hidden rounded-full bg-(--color-surface-sunken)">
            {r.value !== null && <span className="block h-full rounded-full" style={{ width: `${max > 0 ? Math.max(1.5, (r.value / max) * 100) : 0}%`, background: r.muted ? PALETTE.gray : color }} />}
          </span>
          <span className="money min-w-20 text-right font-semibold text-heading">
            {r.value === null ? <span className="text-xs font-normal text-(--color-text-muted)">yetarli emas</span> : format(r.value)}
            {r.hint && <span className="block text-[11px] font-normal text-(--color-text-muted)">{r.hint}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Tarixiy test: haqiqiy va prognoz (ustunlar juftligi) */
export function BacktestChart({ months, actual, forecast, height = 200, format = short }: { months: string[]; actual: (number | null)[]; forecast: (number | null)[]; height?: number; format?: (v: number) => string }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const vals = [...actual, ...forecast].filter((v): v is number => v !== null);
  if (vals.length === 0) return <ChartEmpty height={height} />;
  const max = niceMax(Math.max(...vals));
  const w = Math.max(width, 280);
  const iw = w - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const band = iw / months.length;
  const bw = Math.min(22, band / 3);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={w} height={height} className="block" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((k) => (
          <g key={k}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(k * max)} y2={y(k * max)} className="text-slate-200" stroke="currentColor" />
            <text x={PAD.left - 8} y={y(k * max) + 4} textAnchor="end" className="fill-slate-500 text-[11px]">
              {format(k * max)}
            </text>
          </g>
        ))}
        {months.map((m, i) => {
          const cx = PAD.left + band * i + band / 2;
          const a = actual[i];
          const f = forecast[i];
          return (
            <g key={m} onMouseEnter={() => setHover(i)}>
              <rect x={PAD.left + band * i} y={PAD.top} width={band} height={ih} fill={hover === i ? '#f1f5f9' : 'transparent'} />
              {a !== null && a !== undefined && <rect x={cx - bw - 1} y={y(a)} width={bw} height={PAD.top + ih - y(a)} rx={3} fill={PALETTE.blue} />}
              {f !== null && f !== undefined && <rect x={cx + 1} y={y(f)} width={bw} height={PAD.top + ih - y(f)} rx={3} fill={PALETTE.orange} />}
              <text x={cx} y={height - 6} textAnchor="middle" className="fill-slate-500 text-[11px]">
                {monthShort(m)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute top-2 z-10 min-w-44 rounded-lg border border-(--color-border) bg-white px-3 py-2 text-xs shadow-lg" style={{ left: Math.min(Math.max(PAD.left + band * hover - 60, 0), w - 190) }}>
          <p className="mb-1 font-semibold text-heading">{monthShort(months[hover]!)}</p>
          <Row color={PALETTE.blue} label="Haqiqiy" value={actual[hover] === null ? '—' : format(actual[hover]!)} />
          <Row color={PALETTE.orange} label="Prognoz (o‘sha paytda)" value={forecast[hover] === null ? '—' : format(forecast[hover]!)} />
          {actual[hover] && forecast[hover] !== null && (
            <p className="mt-0.5 text-(--color-text-muted)">Xato: {(((forecast[hover]! - actual[hover]!) / actual[hover]!) * 100).toFixed(1).replace('.', ',')}%</p>
          )}
        </div>
      )}
      <Legend items={[{ color: PALETTE.blue, label: 'Haqiqiy' }, { color: PALETTE.orange, label: 'Tarixiy testdagi prognoz' }]} />
    </div>
  );
}