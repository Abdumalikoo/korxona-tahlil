'use client';

import { useState, useRef, useEffect } from 'react';
import { formatTiyin, formatCompact, formatPeriodShort } from '@/lib/format';

export interface LinePoint {
  period: string;
  incomeTiyin: string;
  expenseTiyin: string;
  profitTiyin?: string;
}

interface LineChartProps {
  data: LinePoint[];
  height?: number;
}

const PADDING = { top: 16, right: 16, bottom: 8, left: 56 };

/**
 * Daromad va xarajat dinamikasi.
 *
 * Haqiqiy piksel koordinatalarida chiziladi — SVG cho'zilmaydi,
 * shuning uchun nuqtalar doira bo'lib qoladi.
 */
export function LineChart({ data, height = 280 }: LineChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [width, setWidth] = useState(800);
  const containerRef = useRef<HTMLDivElement>(null);

  // Konteyner kengligini kuzatamiz
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  if (data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-[--color-text-muted]"
        style={{ height }}
      >
        Ma&apos;lumot yo&apos;q
      </div>
    );
  }

  const plotWidth = Math.max(width - PADDING.left - PADDING.right, 100);
  const plotHeight = height - PADDING.top - PADDING.bottom - 28;

  const values = data.flatMap((p) => [Number(p.incomeTiyin), Number(p.expenseTiyin)]);
  const rawMax = Math.max(...values, 1);
  // Yumaloq chegara — o'q yorliqlari toza chiqishi uchun
  const max = niceMax(rawMax);

  function pointX(index: number): number {
    if (data.length === 1) return PADDING.left + plotWidth / 2;
    return PADDING.left + (index / (data.length - 1)) * plotWidth;
  }

  function pointY(value: number): number {
    return PADDING.top + plotHeight - (value / max) * plotHeight;
  }

  /** Yumshoq egri chiziq — Catmull-Rom asosida */
  function buildPath(getValue: (point: LinePoint) => number): string {
    const points = data.map((point, index) => ({
      x: pointX(index),
      y: pointY(getValue(point)),
    }));

    if (points.length === 0) return '';
    if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;

    let path = `M ${points[0]!.x} ${points[0]!.y}`;

    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[Math.max(i - 1, 0)]!;
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const p3 = points[Math.min(i + 2, points.length - 1)]!;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }

    return path;
  }

  /** To'ldirish uchun yopiq yo'l */
  function buildArea(getValue: (point: LinePoint) => number): string {
    const line = buildPath(getValue);
    const lastX = pointX(data.length - 1);
    const firstX = pointX(0);
    const baseY = PADDING.top + plotHeight;

    return `${line} L ${lastX} ${baseY} L ${firstX} ${baseY} Z`;
  }

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const active = hovered !== null ? data[hovered] : null;

  return (
    <div ref={containerRef} className="relative w-full select-none">
      <svg width={width} height={height - 28} className="overflow-visible">
        <defs>
          <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-income)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--color-income)" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-expense)" stopOpacity="0.14" />
            <stop offset="100%" stopColor="var(--color-expense)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Setka va o'q yorliqlari */}
        {gridLines.map((ratio) => {
          const y = PADDING.top + plotHeight * (1 - ratio);
          return (
            <g key={ratio}>
              <line
                x1={PADDING.left}
                y1={y}
                x2={PADDING.left + plotWidth}
                y2={y}
                stroke="var(--color-line)"
                strokeWidth="1"
                strokeDasharray={ratio === 0 ? undefined : '3 4'}
              />
              <text
                x={PADDING.left - 10}
                y={y + 4}
                textAnchor="end"
                className="fill-[--color-text-faint] text-[10px]"
                style={{ fontFamily: 'var(--font-mono)' }}
              >
                {ratio === 0 ? '0' : formatCompact(String(max * ratio))}
              </text>
            </g>
          );
        })}

        {/* Vertikal yo'naltiruvchi */}
        {hovered !== null && (
          <line
            x1={pointX(hovered)}
            y1={PADDING.top}
            x2={pointX(hovered)}
            y2={PADDING.top + plotHeight}
            stroke="var(--color-line-strong)"
            strokeWidth="1"
          />
        )}

        {/* Maydonlar */}
        <path d={buildArea((p) => Number(p.expenseTiyin))} fill="url(#expenseGradient)" />
        <path d={buildArea((p) => Number(p.incomeTiyin))} fill="url(#incomeGradient)" />

        {/* Chiziqlar */}
        <path
          d={buildPath((p) => Number(p.expenseTiyin))}
          fill="none"
          stroke="var(--color-expense)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={buildPath((p) => Number(p.incomeTiyin))}
          fill="none"
          stroke="var(--color-income)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Nuqtalar — faqat sichqoncha ustida */}
        {hovered !== null && (
          <>
            <circle
              cx={pointX(hovered)}
              cy={pointY(Number(data[hovered]!.expenseTiyin))}
              r="4.5"
              fill="white"
              stroke="var(--color-expense)"
              strokeWidth="2.5"
            />
            <circle
              cx={pointX(hovered)}
              cy={pointY(Number(data[hovered]!.incomeTiyin))}
              r="4.5"
              fill="white"
              stroke="var(--color-income)"
              strokeWidth="2.5"
            />
          </>
        )}

        {/* Sichqoncha zonalari */}
        {data.map((point, index) => {
          const zoneWidth = plotWidth / data.length;
          return (
            <rect
              key={point.period}
              x={PADDING.left + index * zoneWidth}
              y={PADDING.top}
              width={zoneWidth}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}

        {/* Davr yorliqlari */}
        {data.map((point, index) => (
          <text
            key={point.period}
            x={pointX(index)}
            y={PADDING.top + plotHeight + 18}
            textAnchor="middle"
            className={
              hovered === index
                ? 'fill-[--color-text] text-[10px] font-semibold'
                : 'fill-[--color-text-muted] text-[10px]'
            }
          >
            {formatPeriodShort(point.period)}
          </text>
        ))}
      </svg>

      {/* Yorliq */}
      {active && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white shadow-lg"
          style={{
            left: Math.min(Math.max(pointX(hovered ?? 0), 70), width - 70),
            top: PADDING.top,
            transform: 'translateX(-50%)',
          }}
        >
          <p className="mb-1.5 font-medium">{formatPeriodShort(active.period)}</p>
          <p className="flex items-center gap-2 whitespace-nowrap">
            <span className="size-2 rounded-full bg-[--color-income]" />
            <span className="money">{formatTiyin(active.incomeTiyin)}</span>
          </p>
          <p className="mt-0.5 flex items-center gap-2 whitespace-nowrap">
            <span className="size-2 rounded-full bg-[--color-expense]" />
            <span className="money">{formatTiyin(active.expenseTiyin)}</span>
          </p>
        </div>
      )}

      {/* Izoh */}
      <div className="mt-2 flex items-center gap-4 pl-14">
        <span className="flex items-center gap-1.5 text-xs text-[--color-text-muted]">
          <span className="h-0.5 w-4 rounded bg-[--color-income]" />
          Daromad
        </span>
        <span className="flex items-center gap-1.5 text-xs text-[--color-text-muted]">
          <span className="h-0.5 w-4 rounded bg-[--color-expense]" />
          Xarajat
        </span>
      </div>
    </div>
  );
}

/** Yumaloq chegara: 723 500 000 → 800 000 000 */
function niceMax(value: number): number {
  if (value <= 0) return 1;

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;

  let nice: number;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 2.5) nice = 2.5;
  else if (normalized <= 5) nice = 5;
  else nice = 10;

  return nice * magnitude;
}
