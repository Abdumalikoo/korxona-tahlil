'use client';

import { formatPercent, formatTiyin } from '@/lib/format';
import { useState } from 'react';

export interface DonutSlice {
  key: string;
  label: string;
  amountTiyin: string;
  sharePercent: number;
}

interface DonutChartProps {
  slices: DonutSlice[];
  /** Markazda ko'rsatiladigan umumiy summa */
  totalTiyin: string;
  size?: number;
}

/** Ranglar palitrasi — eng kattadan boshlab */
const COLORS = [
  '#1e40af',
  '#dc2626',
  '#059669',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#be123c',
  '#4d7c0f',
  '#c2410c',
  '#6366f1',
];

const STROKE = 28;

/**
 * Doira grafigi — ulushlarni ko'rsatadi.
 *
 * SVG bilan chizilgan, kutubxonasiz. Har bo'lak ustiga
 * sichqoncha kelganda ajralib turadi.
 */
export function DonutChart({ slices, totalTiyin, size = 200 }: DonutChartProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  if (slices.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-sm text-[--color-text-muted]"
        style={{ height: size }}
      >
        Ma&apos;lumot yo&apos;q
      </div>
    );
  }

  const radius = (size - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  // Har bo'lak uchun boshlanish nuqtasi
  let offset = 0;
  const segments = slices.map((slice, index) => {
    const length = (slice.sharePercent / 100) * circumference;
    const segment = {
      ...slice,
      color: COLORS[index % COLORS.length]!,
      dashArray: `${length} ${circumference - length}`,
      dashOffset: -offset,
    };
    offset += length;
    return segment;
  });

  const active = hovered ? segments.find((s) => s.key === hovered) : null;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      {/* Doira */}
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          {segments.map((segment) => (
            <circle
              key={segment.key}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={hovered === segment.key ? STROKE + 6 : STROKE}
              strokeDasharray={segment.dashArray}
              strokeDashoffset={segment.dashOffset}
              className="cursor-pointer transition-all"
              onMouseEnter={() => setHovered(segment.key)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
        </svg>

        {/* Markaz */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {active ? (
            <>
              <span className="money text-sm font-semibold">
                {formatPercent(active.sharePercent)}
              </span>
              <span className="mt-0.5 max-w-24 truncate text-center text-[10px] text-[--color-text-muted]">
                {active.label}
              </span>
            </>
          ) : (
            <>
              <span className="money text-sm font-semibold">
                {formatTiyin(totalTiyin)}
              </span>
              <span className="text-[10px] text-[--color-text-muted]">jami</span>
            </>
          )}
        </div>
      </div>

      {/* Izoh */}
      <div className="min-w-0 flex-1 space-y-1.5">
        {segments.map((segment) => (
          <button
            key={segment.key}
            type="button"
            onMouseEnter={() => setHovered(segment.key)}
            onMouseLeave={() => setHovered(null)}
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors ${
              hovered === segment.key ? 'bg-[--color-surface-sunken]' : ''
            }`}
          >
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: segment.color }}
            />

            <span className="min-w-0 flex-1 truncate text-xs">{segment.label}</span>

            <span className="money shrink-0 text-xs text-[--color-text-muted]">
              {formatPercent(segment.sharePercent)}
            </span>

            <span className="money w-24 shrink-0 text-right text-xs">
              {formatTiyin(segment.amountTiyin)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
