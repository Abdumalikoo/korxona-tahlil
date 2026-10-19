'use client';

import { formatCompact, formatPeriodShort, formatTiyin } from '@/lib/format';
import { useState } from 'react';

export interface BarPoint {
  period: string;
  amountTiyin: string;
  count?: number;
}

interface BarChartProps {
  data: BarPoint[];
  /** Ustun rangi - CSS o'zgaruvchisi */
  color?: string;
  height?: number;
}

/**
 * Oylik dinamika grafigi.
 *
 * SVG bilan qo'lda chizilgan - tashqi kutubxona yo'q.
 * Sichqoncha ustunga kelganda aniq summa ko'rsatiladi.
 */
export function BarChart({
  data,
  color = 'var(--color-expense)',
  height = 220,
}: BarChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);

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

  const values = data.map((point) => Number(point.amountTiyin));
  const max = Math.max(...values, 1);

  /** Yuqorida yorliq uchun joy qoldiramiz */
  const chartHeight = height - 44;

  return (
    <div className="relative w-full">
      <div className="flex items-end gap-1" style={{ height: chartHeight }}>
        {data.map((point, index) => {
          const value = Number(point.amountTiyin);
          const barHeight = max > 0 ? Math.max((value / max) * chartHeight, value > 0 ? 3 : 0) : 0;
          const isHovered = hovered === index;

          return (
            <div
              key={point.period}
              className="group relative flex flex-1 flex-col items-center justify-end"
              style={{ height: chartHeight }}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Yorliq - faqat sichqoncha ustida */}
              {isHovered && value > 0 && (
                <div className="absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white shadow">
                  <span className="money">{formatTiyin(point.amountTiyin)}</span>
                  {point.count !== undefined && (
                    <span className="ml-1.5 opacity-70">{point.count} ta</span>
                  )}
                </div>
              )}

              <div
                className="w-full rounded-t transition-opacity"
                style={{
                  height: barHeight,
                  backgroundColor: color,
                  opacity: hovered === null ? 0.85 : isHovered ? 1 : 0.4,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* O'q yorliqlari */}
      <div className="mt-2 flex gap-1 border-t border-[--color-line] pt-2">
        {data.map((point, index) => (
          <div
            key={point.period}
            className="flex-1 text-center text-[10px] text-[--color-text-muted]"
            style={{ fontWeight: hovered === index ? 600 : 400 }}
          >
            {formatPeriodShort(point.period)}
          </div>
        ))}
      </div>

      {/* Eng katta qiymat */}
      <div className="mt-1 text-right text-xs text-[--color-text-faint]">
        Eng yuqori: <span className="money">{formatCompact(String(max))}</span>
      </div>
    </div>
  );
}
