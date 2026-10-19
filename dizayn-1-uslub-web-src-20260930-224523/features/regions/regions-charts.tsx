'use client';

import { formatPeriod, formatPeriodShort } from '@/lib/format';
import { cn } from '@/lib/utils';
import { compact, pct, TONE } from '@/features/structure/api';
import type { UnitStats } from './api';

/** Xarajat ustuni rangi (daromad — TONE.income) */
export const EXPENSE_BAR = '#c9837d';

function signed(value: number): string {
  if (value === 0) return '0';
  return `${value > 0 ? '+' : '−'}${compact(Math.abs(value))}`;
}

// ═══════════════════════════════════════════════════════════
// 1. Daromad va xarajat yonma-yon (har hudud uchun ikki chiziq)
// ═══════════════════════════════════════════════════════════

export function PairedBars({ rows, onOpen }: { rows: UnitStats[]; onOpen: (key: string) => void }) {
  const max = Math.max(...rows.flatMap((r) => [r.income, r.expense]), 1);
  return (
    <div>
      <div className="grid grid-cols-[minmax(8rem,12rem)_1fr_7rem] gap-x-4 border-b border-[--color-line] pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">
        <span>Hudud</span>
        <span>Yuqori chiziq — daromad, pastki — xarajat</span>
        <span className="text-right">Foyda</span>
      </div>
      {rows.map((r) => (
        <button
          key={r.unit.key}
          type="button"
          onClick={() => onOpen(r.unit.key)}
          className="grid w-full grid-cols-[minmax(8rem,12rem)_1fr_7rem] items-center gap-x-4 border-b border-[--color-line] py-2 text-left text-sm last:border-0 hover:bg-[--color-surface-muted]"
        >
          <span className={cn('truncate', r.unit.kind !== 'region' && 'font-medium')} title={r.unit.name}>
            {r.unit.name}
          </span>
          <span className="space-y-1" title={`Daromad: ${compact(r.income)} · Xarajat: ${compact(r.expense)}`}>
            <span className="flex items-center gap-2">
              <span className="h-2.5" style={{ width: `${(r.income / max) * 100}%`, background: TONE.income, minWidth: r.income > 0 ? 2 : 0 }} />
              <span className="whitespace-nowrap text-[11px] tabular-nums text-[--color-text-muted]">{compact(r.income)}</span>
            </span>
            <span className="flex items-center gap-2">
              <span className="h-2.5" style={{ width: `${(r.expense / max) * 100}%`, background: EXPENSE_BAR, minWidth: r.expense > 0 ? 2 : 0 }} />
              <span className="whitespace-nowrap text-[11px] tabular-nums text-[--color-text-muted]">{compact(r.expense)}</span>
            </span>
          </span>
          <span className="text-right font-semibold tabular-nums" style={{ color: r.profit >= 0 ? TONE.income : TONE.expense }}>
            {signed(r.profit)}
          </span>
        </button>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 2. Foyda reytingi — noldan o'ngga foyda, chapga zarar
// ═══════════════════════════════════════════════════════════

export function ProfitBars({ rows, onOpen }: { rows: UnitStats[]; onOpen: (key: string) => void }) {
  // Nol nuqtasi: chap tomon — eng katta zarar, o'ng tomon — eng katta foyda (bir xil shkala)
  const maxLoss = Math.max(0, ...rows.map((r) => -r.profit));
  const maxGain = Math.max(0, ...rows.map((r) => r.profit));
  const total = maxLoss + maxGain || 1;
  const hasLoss = maxLoss > 0;
  const zero = (maxLoss / total) * 100;
  return (
    <div>
      <div className="grid grid-cols-[2rem_minmax(8rem,12rem)_1fr_7rem_5rem] gap-x-3 border-b border-[--color-line] pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">
        <span className="text-right">#</span>
        <span>Hudud</span>
        <span className="relative">
          {hasLoss && <span className="absolute -translate-x-1/2" style={{ left: `${zero}%` }}>0</span>}
          <span className="absolute right-0">foyda →</span>
          {hasLoss && <span className="absolute left-0">← zarar</span>}
        </span>
        <span className="text-right">Foyda</span>
        <span className="text-right">Rent.</span>
      </div>
      {rows.map((r, i) => {
        const w = (Math.abs(r.profit) / total) * 100;
        return (
          <button
            key={r.unit.key}
            type="button"
            onClick={() => onOpen(r.unit.key)}
            className="grid w-full grid-cols-[2rem_minmax(8rem,12rem)_1fr_7rem_5rem] items-center gap-x-3 border-b border-[--color-line] py-2 text-left text-sm last:border-0 hover:bg-[--color-surface-muted]"
          >
            <span className="text-right text-xs tabular-nums text-[--color-text-faint]">{i + 1}</span>
            <span className="truncate" title={r.unit.name}>{r.unit.name}</span>
            <span className="relative h-3.5">
              {hasLoss && <span className="absolute inset-y-[-4px] w-px bg-[--color-text-faint]" style={{ left: `${zero}%` }} />}
              <span
                className="absolute inset-y-0"
                style={{
                  left: r.profit >= 0 ? `${zero}%` : `${zero - w}%`,
                  width: `${Math.max(w, 0.4)}%`,
                  background: r.profit >= 0 ? TONE.income : TONE.expense,
                }}
              />
            </span>
            <span className="text-right font-medium tabular-nums" style={{ color: r.profit >= 0 ? undefined : TONE.expense }}>
              {signed(r.profit)}
            </span>
            <span className="text-right text-xs tabular-nums text-[--color-text-muted]">{pct(r.margin)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 3. Hududlar xaritasi: xarajat (gorizontal) × daromad (vertikal)
// ═══════════════════════════════════════════════════════════

export function RegionScatter({ rows, onOpen }: { rows: UnitStats[]; onOpen: (key: string) => void }) {
  const W = 1000;
  const H = 500;
  const pad = { l: 100, r: 24, t: 20, b: 48 };
  const max = Math.max(...rows.flatMap((r) => [r.income, r.expense]), 1) * 1.08;
  const x = (v: number) => pad.l + (v / max) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const maxHead = Math.max(...rows.map((r) => r.unit.headcount), 1);
  const rad = (r: UnitStats) => 5 + Math.sqrt(r.unit.headcount / maxHead) * 13;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => (max / 1.08) * k);

  // Yorliqlar ustma-ust tushmasligi uchun
  const placed: { x: number; y: number }[] = [];
  const labelled = new Set<string>();
  // Yorliq doiraning chap tomonida (diagonaldan yuqoridagi bo'sh joyda)
  // Avval zarardagi hududlar va Markaz, keyin foydasi kattalar
  const priority = (r: UnitStats) => (r.profit < 0 ? 1e20 : 0) + Math.abs(r.profit);
  for (const r of [...rows].sort((a, b) => priority(b) - priority(a))) {
    const lx = x(r.expense) - rad(r) - 6;
    const ly = y(r.income) + 4;
    if (placed.some((q) => Math.abs(q.x - lx) < 130 && Math.abs(q.y - ly) < 16)) continue;
    placed.push({ x: lx, y: ly });
    labelled.add(r.unit.key);
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {/* Zarar zonasi: diagonaldan pastda (xarajat > daromad) */}
      <polygon points={`${x(0)},${y(0)} ${x(max)},${y(0)} ${x(max)},${y(max)}`} fill="#fbeeed" />
      <line x1={x(0)} y1={y(0)} x2={x(max)} y2={y(max)} stroke={TONE.expense} strokeDasharray="6 4" />
      <text x={x(max) - 6} y={y(max) + 16} fontSize={12} fill={TONE.expense} textAnchor="end">
        daromad = xarajat
      </text>
      <text x={x(max * 0.72)} y={y(max * 0.2)} fontSize={12} fontWeight={600} fill={TONE.expense} textAnchor="middle" letterSpacing={0.4}>
        ZARAR ZONASI
      </text>
      <text x={x(0) + 10} y={y(max) + 18} fontSize={12} fontWeight={600} fill={TONE.income} letterSpacing={0.4}>
        FOYDA ZONASI
      </text>

      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={TONE.grid} strokeOpacity={0.7} />
          <text x={pad.l - 8} y={y(t) + 4} fontSize={12} fill={TONE.axis} textAnchor="end">{t === 0 ? '0' : compact(t)}</text>
          <text x={x(t)} y={H - pad.b + 18} fontSize={12} fill={TONE.axis} textAnchor="middle">{t === 0 ? '0' : compact(t)}</text>
        </g>
      ))}
      <text x={(pad.l + W - pad.r) / 2} y={H - 6} fontSize={12} fill="#6b7280" textAnchor="middle">
        Xarajat →
      </text>
      <text x={16} y={(pad.t + H - pad.b) / 2} fontSize={12} fill="#6b7280" textAnchor="middle" transform={`rotate(-90 16 ${(pad.t + H - pad.b) / 2})`}>
        Daromad →
      </text>

      {[...rows]
        .sort((a, b) => b.unit.headcount - a.unit.headcount)
        .map((r) => {
          const color = r.unit.kind === 'center' ? TONE.slate : r.profit >= 0 ? TONE.income : TONE.expense;
          return (
            <g key={r.unit.key} className="cursor-pointer" onClick={() => onOpen(r.unit.key)}>
              <circle cx={x(r.expense)} cy={y(r.income)} r={rad(r)} fill={color} fillOpacity={0.3} stroke={color} strokeWidth={1.3}>
                <title>{`${r.unit.name}\nDaromad: ${compact(r.income)} so'm\nXarajat: ${compact(r.expense)} so'm\nFoyda: ${signed(r.profit)} so'm\nXodimlar: ${r.unit.headcount}`}</title>
              </circle>
              {labelled.has(r.unit.key) && (
                <text
                  x={x(r.expense) - rad(r) - 6 < pad.l + 90 ? x(r.expense) + rad(r) + 6 : x(r.expense) - rad(r) - 6}
                  y={y(r.income) + 4}
                  fontSize={12}
                  fill={TONE.ink}
                  textAnchor={x(r.expense) - rad(r) - 6 < pad.l + 90 ? 'start' : 'end'}
                  pointerEvents="none"
                >
                  {r.unit.name}
                </text>
              )}
            </g>
          );
        })}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════
// 4. Oylar kesimida foyda: hududlar × 12 oy (yashil — foyda, qizil — zarar)
// ═══════════════════════════════════════════════════════════

export function ProfitHeatmap({ months, rows, onOpen }: { months: string[]; rows: UnitStats[]; onOpen: (key: string) => void }) {
  const values = rows.map((r) => r.profitTrend.slice(-12));
  // Shkala hududlar bo'yicha: Markazning katta summasi hududlar ranglarini "o'chirib" yubormasligi uchun
  const scaleRows = rows.some((r) => r.unit.kind === 'region') ? values.filter((_, i) => rows[i]!.unit.kind === 'region') : values;
  const max = Math.max(...scaleRows.flat().map(Math.abs), 1);
  const cell = (v: number, active: boolean) => {
    if (!active) return { background: '#f9fafb', color: '#9ca3af' };
    const a = 0.1 + 0.8 * Math.sqrt(Math.min(1, Math.abs(v) / max));
    return v >= 0
      ? { background: `rgba(47, 122, 87, ${a.toFixed(3)})`, color: a > 0.5 ? '#fff' : '#1f2937' }
      : { background: `rgba(179, 66, 59, ${a.toFixed(3)})`, color: a > 0.5 ? '#fff' : '#1f2937' };
  };
  const short = (v: number) => {
    const t = compact(Math.abs(v)).replace(' mlrd', 'B').replace(' mln', 'M').replace(' ming', 'K');
    return `${v < 0 ? '−' : ''}${t}`;
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-xs">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-[--color-text-muted]">
            <th className="sticky left-0 z-10 min-w-[10rem] bg-white py-1.5 pr-2 text-left font-semibold">Hudud</th>
            {months.map((m) => (
              <th key={m} className="min-w-[3.6rem] py-1.5 text-center font-semibold" title={formatPeriod(m)}>
                {formatPeriodShort(m)}
              </th>
            ))}
            <th className="min-w-[4rem] py-1.5 pl-2 text-right font-semibold">Zarar oylari</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => {
            const inc = r.unit.incomeTrend.slice(-12).map(Number);
            const exp = r.unit.expenseTrend.slice(-12).map(Number);
            return (
              <tr key={r.unit.key}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 max-w-[13rem] cursor-pointer truncate bg-white py-1 pr-2 text-left text-sm font-normal hover:underline"
                  onClick={() => onOpen(r.unit.key)}
                  title={r.unit.name}
                >
                  {r.unit.name}
                </th>
                {values[ri]!.map((v, i) => {
                  const active = inc[i] !== 0 || exp[i] !== 0;
                  return (
                    <td
                      key={months[i]}
                      className="h-8 text-center tabular-nums"
                      style={cell(v, active)}
                      title={`${r.unit.name} · ${formatPeriod(months[i]!)}\nDaromad: ${compact(inc[i] ?? 0)}\nXarajat: ${compact(exp[i] ?? 0)}\nFoyda: ${signed(v)}`}
                    >
                      {active ? short(v) : '·'}
                    </td>
                  );
                })}
                <td className={cn('pl-2 text-right font-medium tabular-nums', r.lossMonths > 0 ? 'text-[--color-expense]' : 'text-[--color-text-muted]')}>
                  {r.lossMonths} / {r.activeMonths}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 5. Xarajat tuzilmasi: har hudud xarajati 100% ga bo'lingan
// ═══════════════════════════════════════════════════════════

export const MIX_COLORS: Record<string, string> = {
  PAYROLL: '#23426a',
  LEASE: '#6187b3',
  VEHICLE: '#b7791f',
  OTHER: '#c7d5e7',
};
export const MIX_LABELS: Record<string, string> = {
  PAYROLL: 'Ish haqi',
  LEASE: 'Ijara',
  VEHICLE: 'Mashinalar',
  OTHER: 'Boshqa xarajatlar',
};

export function mixOf(r: UnitStats): Record<string, number> {
  const mix: Record<string, number> = { PAYROLL: 0, LEASE: 0, VEHICLE: 0, OTHER: 0 };
  for (const part of r.unit.expenseParts) {
    const key = part.key === 'PAYROLL' || part.key === 'LEASE' || part.key === 'VEHICLE' ? part.key : 'OTHER';
    mix[key]! += Number(part.amountTiyin);
  }
  return mix;
}

export function ExpenseMix({ rows, onOpen }: { rows: UnitStats[]; onOpen: (key: string) => void }) {
  const keys = ['PAYROLL', 'LEASE', 'VEHICLE', 'OTHER'];
  return (
    <div>
      <div className="grid grid-cols-[minmax(8rem,12rem)_1fr_6rem] gap-x-4 border-b border-[--color-line] pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[--color-text-muted]">
        <span>Hudud</span>
        <span>Xarajat tarkibi, 100%</span>
        <span className="text-right">Ish haqi</span>
      </div>
      {rows.map((r) => {
        const mix = mixOf(r);
        const total = keys.reduce((s, k) => s + mix[k]!, 0);
        return (
          <button
            key={r.unit.key}
            type="button"
            onClick={() => onOpen(r.unit.key)}
            className="grid w-full grid-cols-[minmax(8rem,12rem)_1fr_6rem] items-center gap-x-4 border-b border-[--color-line] py-2 text-left text-sm last:border-0 hover:bg-[--color-surface-muted]"
          >
            <span className="truncate" title={r.unit.name}>{r.unit.name}</span>
            <span className="flex h-3.5 overflow-hidden bg-[--color-surface-sunken]">
              {total > 0 &&
                keys.map((k) =>
                  mix[k]! > 0 ? (
                    <span
                      key={k}
                      style={{ width: `${(mix[k]! / total) * 100}%`, background: MIX_COLORS[k] }}
                      title={`${MIX_LABELS[k]}: ${compact(mix[k]!)} (${pct((mix[k]! / total) * 100)})`}
                    />
                  ) : null,
                )}
            </span>
            <span className="text-right tabular-nums text-[--color-text-muted]">{total > 0 ? pct((mix.PAYROLL! / total) * 100) : '—'}</span>
          </button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// 6. Ko'prik: hududlar foydasidan korxona natijasigacha
// ═══════════════════════════════════════════════════════════

export function Bridge({ steps }: { steps: { label: string; value: number; total?: boolean; hint?: string }[] }) {
  // Yig'ilib boruvchi qiymatlar
  let running = 0;
  const bars = steps.map((s) => {
    const start = s.total ? 0 : running;
    const end = s.total ? s.value : running + s.value;
    running = s.total ? s.value : end;
    return { ...s, start, end };
  });
  const lo = Math.min(0, ...bars.flatMap((b) => [b.start, b.end]));
  const hi = Math.max(0, ...bars.flatMap((b) => [b.start, b.end]), 1);
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;
  return (
    <div>
      {bars.map((b, i) => {
        const from = Math.min(b.start, b.end);
        const to = Math.max(b.start, b.end);
        const color = b.total ? (b.end >= 0 ? TONE.slate : TONE.expense) : b.value >= 0 ? TONE.income : TONE.expense;
        return (
          <div
            key={`${b.label}-${i}`}
            className={cn(
              'grid grid-cols-[minmax(9rem,15rem)_1fr_7rem] items-center gap-x-3 py-2 text-sm',
              b.total && 'border-y border-[--color-line] bg-[--color-surface-muted] font-semibold',
            )}
          >
            <span className="min-w-0">
              <span className="block truncate" title={b.label}>{b.label}</span>
              {b.hint && <span className="block truncate text-xs font-normal text-[--color-text-faint]">{b.hint}</span>}
            </span>
            <span className="relative h-4">
              <span className="absolute inset-y-[-6px] w-px bg-[--color-text-faint] opacity-60" style={{ left: `${pos(0)}%` }} />
              <span className="absolute inset-y-0" style={{ left: `${pos(from)}%`, width: `${Math.max(0.5, pos(to) - pos(from))}%`, background: color }} />
            </span>
            <span className="text-right tabular-nums" style={{ color: b.end < 0 && b.total ? TONE.expense : undefined }}>
              {b.total ? compact(b.value) : signed(b.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}