'use client';

import { IconChart, IconDashboard } from '@/components/ui/icons';
import { formatPercent, formatTiyin } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export interface ChartSlice {
  key: string;
  label: string;
  amountTiyin: string;
  sharePercent: number;
}

interface ShareChartProps {
  slices: ChartSlice[];
  totalTiyin: string;
  /** Standart ko'rinish */
  defaultView?: 'donut' | 'bar';
  /** Nechta element ko'rsatiladi, qolgani "Boshqalar" ga yig'iladi */
  maxItems?: number;
}

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

const DONUT_SIZE = 200;
const STROKE = 28;

/**
 * Ulushlarni ko'rsatadigan grafik.
 *
 * Ikki ko'rinish: doira (nisbat uchun) va ustun (taqqoslash uchun).
 * Foydalanuvchi almashtirishi mumkin.
 */
export function ShareChart({
  slices,
  totalTiyin,
  defaultView = 'donut',
  maxItems = 10,
}: ShareChartProps) {
  const [view, setView] = useState<'donut' | 'bar'>(defaultView);
  const [hovered, setHovered] = useState<string | null>(null);

  if (slices.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-[--color-text-muted]">
        Ma&apos;lumot yo&apos;q
      </div>
    );
  }

  // Ko'p element bo'lsa qolganini yig'amiz
  const sorted = [...slices].sort((a, b) => b.sharePercent - a.sharePercent);
  const visible = sorted.slice(0, maxItems);
  const rest = sorted.slice(maxItems);

  const data =
    rest.length > 0
      ? [
          ...visible,
          {
            key: '__others',
            label: `Boshqalar (${rest.length})`,
            amountTiyin: String(
              rest.reduce((sum, item) => sum + Number(item.amountTiyin), 0),
            ),
            sharePercent: rest.reduce((sum, item) => sum + item.sharePercent, 0),
          },
        ]
      : visible;

  const colored = data.map((slice, index) => ({
    ...slice,
    color: COLORS[index % COLORS.length]!,
  }));

  return (
    <div className="space-y-3">
      {/* Ko'rinish almashtirish */}
      <div className="flex justify-end">
        <div className="inline-flex rounded-[--radius-control] border border-[--color-line-strong] p-0.5">
          <ViewButton
            active={view === 'donut'}
            onClick={() => setView('donut')}
            icon={<IconDashboard className="size-3.5" />}
            label="Doira"
          />
          <ViewButton
            active={view === 'bar'}
            onClick={() => setView('bar')}
            icon={<IconChart className="size-3.5" />}
            label="Ustun"
          />
        </div>
      </div>

      {view === 'donut' ? (
        <DonutView
          slices={colored}
          totalTiyin={totalTiyin}
          hovered={hovered}
          onHover={setHovered}
        />
      ) : (
        <BarView slices={colored} hovered={hovered} onHover={setHovered} />
      )}
    </div>
  );
}

// ─────── Doira ───────

function DonutView({
  slices,
  totalTiyin,
  hovered,
  onHover,
}: {
  slices: (ChartSlice & { color: string })[];
  totalTiyin: string;
  hovered: string | null;
  onHover: (key: string | null) => void;
}) {
  const radius = (DONUT_SIZE - STROKE) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = DONUT_SIZE / 2;

  let offset = 0;
  const segments = slices.map((slice) => {
    const length = (slice.sharePercent / 100) * circumference;
    const segment = {
      ...slice,
      dashArray: `${length} ${circumference - length}`,
      dashOffset: -offset,
    };
    offset += length;
    return segment;
  });

  const active = hovered ? segments.find((s) => s.key === hovered) : null;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <div
        className="relative shrink-0"
        style={{ width: DONUT_SIZE, height: DONUT_SIZE }}
      >
        <svg width={DONUT_SIZE} height={DONUT_SIZE} className="-rotate-90">
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
              onMouseEnter={() => onHover(segment.key)}
              onMouseLeave={() => onHover(null)}
            />
          ))}
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {active ? (
            <>
              <span className="money text-base font-semibold">
                {formatPercent(active.sharePercent)}
              </span>
              <span className="mt-0.5 max-w-28 truncate text-center text-[10px] text-[--color-text-muted]">
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

      <Legend slices={segments} hovered={hovered} onHover={onHover} />
    </div>
  );
}

// ─────── Ustun ───────

function BarView({
  slices,
  hovered,
  onHover,
}: {
  slices: (ChartSlice & { color: string })[];
  hovered: string | null;
  onHover: (key: string | null) => void;
}) {
  const max = Math.max(...slices.map((s) => s.sharePercent), 1);

  return (
    <div className="space-y-2.5">
      {slices.map((slice) => (
        <button
          key={slice.key}
          type="button"
          onMouseEnter={() => onHover(slice.key)}
          onMouseLeave={() => onHover(null)}
          className={cn(
            'block w-full rounded-[--radius-control] px-2 py-1.5 text-left transition-colors',
            hovered === slice.key && 'bg-[--color-surface-sunken]',
          )}
        >
          <div className="mb-1 flex items-baseline justify-between gap-3">
            <span className="min-w-0 flex-1 truncate text-sm">{slice.label}</span>

            <span className="money shrink-0 text-xs text-[--color-text-muted]">
              {formatPercent(slice.sharePercent)}
            </span>

            <span className="money w-32 shrink-0 text-right text-sm font-medium">
              {formatTiyin(slice.amountTiyin)}
            </span>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-[--color-surface-sunken]">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(slice.sharePercent / max) * 100}%`,
                backgroundColor: slice.color,
              }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}

// ─────── Izoh ───────

function Legend({
  slices,
  hovered,
  onHover,
}: {
  slices: (ChartSlice & { color: string })[];
  hovered: string | null;
  onHover: (key: string | null) => void;
}) {
  return (
    <div className="min-w-0 flex-1 space-y-1">
      {slices.map((slice) => (
        <button
          key={slice.key}
          type="button"
          onMouseEnter={() => onHover(slice.key)}
          onMouseLeave={() => onHover(null)}
          className={cn(
            'flex w-full items-center gap-2 rounded px-2 py-1 text-left transition-colors',
            hovered === slice.key && 'bg-[--color-surface-sunken]',
          )}
        >
          <span
            className="size-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: slice.color }}
          />

          <span className="min-w-0 flex-1 truncate text-xs">{slice.label}</span>

          <span className="money shrink-0 text-xs text-[--color-text-muted]">
            {formatPercent(slice.sharePercent)}
          </span>

          <span className="money w-24 shrink-0 text-right text-xs">
            {formatTiyin(slice.amountTiyin)}
          </span>
        </button>
      ))}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-[--radius-control] px-2.5 py-1 text-xs transition-colors',
        active
          ? 'bg-brand-800 text-white'
          : 'text-[--color-text-muted] hover:text-[--color-text]',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
