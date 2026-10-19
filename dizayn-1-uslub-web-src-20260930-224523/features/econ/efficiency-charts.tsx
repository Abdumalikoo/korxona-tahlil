'use client';

import { compact, RAMP, TONE } from '@/features/structure/api';
import type { BreakevenUnit, EfficiencyResult } from './api';

// ═══════════════════════════════════════════════════════════
// Samaradorlik va zararsizlik — grafiklar
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

const pctText = (v: number) => `${Math.round(v * 100)}%`;

export const EFF_COLOR: Record<EfficiencyResult['units'][number]['status'], string> = {
  frontier: TONE.income,
  near: '#6fa487',
  mid: '#c9a227',
  low: TONE.expense,
};

/** Samaradorlik reytingi: to'liq ustun — CRS, ingichka belgi — hajmi hisobga olingan (VRS) */
export function EfficiencyBars({ units, onSelect, selected }: { units: EfficiencyResult['units']; onSelect?: (key: string) => void; selected?: string | null }) {
  const W = 620;
  const rowH = 26;
  const pad = { l: 150, r: 56, t: 8, b: 24 };
  const H = pad.t + pad.b + units.length * rowH;
  const x = (v: number) => pad.l + v * (W - pad.l - pad.r);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} stroke={t === 1 ? TONE.ink : TONE.grid} strokeDasharray={t === 1 ? '3 3' : undefined} />
          <text x={x(t)} y={H - 7} fontSize={10} fill={TONE.axis} textAnchor="middle">
            {pctText(t)}
          </text>
        </g>
      ))}
      {units.map((u, i) => {
        const y = pad.t + i * rowH;
        return (
          <g key={u.key} onClick={() => onSelect?.(u.key)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
            <title>{`${u.name}\nSamaradorlik: ${pctText(u.crs)}\nHajmi hisobga olinganda: ${pctText(u.vrs)}\nMiqyos: ${pctText(u.scale)}${u.peers.length ? `\nNamuna: ${u.peers.map((p) => p.name).join(', ')}` : ''}`}</title>
            {selected === u.key && <rect x={0} y={y + 1} width={W} height={rowH - 2} fill="#f1f5f9" />}
            <text x={pad.l - 8} y={y + rowH / 2 + 4} fontSize={11} fill={TONE.ink} textAnchor="end" fontWeight={selected === u.key ? 700 : 400}>
              {u.rank}. {u.name}
            </text>
            <rect x={x(0)} y={y + 6} width={Math.max(1, x(u.crs) - x(0))} height={rowH - 12} fill={EFF_COLOR[u.status]} />
            <line x1={x(u.vrs)} x2={x(u.vrs)} y1={y + 3} y2={y + rowH - 3} stroke={TONE.ink} strokeWidth={2} />
            <text x={x(1) + 6} y={y + rowH / 2 + 4} fontSize={11} fontWeight={600} fill={EFF_COLOR[u.status]}>
              {pctText(u.crs)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Samaradorlik chegarasi (klassik DEA rasmi): har bir hudud uchun
 * 1 so'm daromadga to'g'ri keladigan ikki resurs. Pastki-chap — yaxshi.
 * Chegara — eng yaxshilarni tutashtiruvchi siniq chiziq.
 */
export function FrontierChart({ data, selected, onSelect }: { data: EfficiencyResult; selected?: string | null; onSelect?: (key: string) => void }) {
  const W = 620;
  const H = 360;
  const pad = { l: 64, r: 20, t: 14, b: 42 };
  const money = data.mode === 'money';
  // Resurslar daromad birligiga: xodimlar — 100 mln so'm oylik daromadga, pul — 1 so'm daromadga
  const pts = data.units.map((u) => {
    const income = Number(u.incomeTiyin) / 100;
    const a = money ? Number(u.payrollTiyin) / 100 / income : u.headcount / (income / 1e8);
    const b = Number(u.nonpayrollTiyin) / 100 / income;
    return { u, x: a, y: b };
  });
  const span = (vals: number[]) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const padd = (hi - lo || hi || 1) * 0.12;
    return niceTicks(Math.max(0, lo - padd), hi + padd, 5);
  };
  const xt = span(pts.map((p) => p.x));
  const yt = span(pts.map((p) => p.y));
  const X = (v: number) => pad.l + ((v - xt[0]!) / (xt[xt.length - 1]! - xt[0]! || 1)) * (W - pad.l - pad.r);
  const Y = (v: number) => pad.t + (1 - (v - yt[0]!) / (yt[yt.length - 1]! - yt[0]! || 1)) * (H - pad.t - pad.b);

  // Chegara: pastki-chap qavariq qobiq (erkin kamaytirish bilan)
  const front = pts.filter((p) => p.u.status === 'frontier').sort((a, b) => a.x - b.x);
  const hull: { x: number; y: number }[] = [];
  for (const p of front) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2]!;
      const b = hull[hull.length - 1]!;
      if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) <= 0) hull.pop();
      else break;
    }
    hull.push(p);
  }
  const xMax = xt[xt.length - 1]!;
  const yMax = yt[yt.length - 1]!;
  const path = hull.length
    ? [`${X(hull[0]!.x)},${Y(yMax)}`, ...hull.map((p) => `${X(p.x)},${Y(p.y)}`), `${X(xMax)},${Y(hull[hull.length - 1]!.y)}`].join(' ')
    : '';

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {yt.map((t) => (
        <g key={`y${t}`}>
          <line x1={pad.l} x2={W - pad.r} y1={Y(t)} y2={Y(t)} stroke={TONE.grid} />
          <text x={pad.l - 8} y={Y(t) + 3.5} fontSize={10.5} fill={TONE.axis} textAnchor="end">
            {t.toFixed(2).replace('.', ',')}
          </text>
        </g>
      ))}
      {xt.map((t) => (
        <text key={`x${t}`} x={X(t)} y={H - 24} fontSize={10.5} fill={TONE.axis} textAnchor="middle">
          {t.toFixed(t < 1 ? 2 : t < 10 ? 1 : 0).replace('.', ',')}
        </text>
      ))}
      <text x={(pad.l + W - pad.r) / 2} y={H - 6} fontSize={11} fill={TONE.slate} textAnchor="middle">
        {money ? "Ish haqi, 1 so'm daromadga (so'm)" : "Xodimlar, har 100 mln so'm oylik daromadga (kishi)"}
      </text>
      <text x={14} y={(pad.t + H - pad.b) / 2} fontSize={11} fill={TONE.slate} textAnchor="middle" transform={`rotate(-90 14 ${(pad.t + H - pad.b) / 2})`}>
        Boshqa xarajat, 1 so'm daromadga
      </text>
      {path && <polyline points={path} fill="none" stroke={TONE.income} strokeWidth={2} />}
      {pts.map((p) => {
        const on = selected === p.u.key;
        return (
          <g key={p.u.key} onClick={() => onSelect?.(p.u.key)} style={{ cursor: onSelect ? 'pointer' : undefined }}>
            <title>{`${p.u.name} — samaradorlik ${pctText(p.u.crs)}\n${money ? `1 so'm daromadga ${p.x.toFixed(2)} so'm ish haqi` : `100 mln daromadga ${p.x.toFixed(1)} xodim`}, ${p.y.toFixed(2)} so'm boshqa xarajat`}</title>
            <circle cx={X(p.x)} cy={Y(p.y)} r={on ? 7 : 5} fill={EFF_COLOR[p.u.status]} stroke="#fff" strokeWidth={1.5} />
            <text x={X(p.x) + 8} y={Y(p.y) + 4} fontSize={10.5} fill={TONE.ink} fontWeight={on ? 700 : 400}>
              {p.u.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Zararsizlik grafigi: gorizontal — oylik daromad, vertikal — so'm.
 * Daromad chizig'i (45°), xarajat chizig'i (doimiy + o'zgaruvchan), kesishgan joy — zararsizlik nuqtasi.
 * Nuqtalar — haqiqiy oylar (daromad, xarajat).
 */
export function BreakevenChart({ unit }: { unit: BreakevenUnit }) {
  const W = 620;
  const H = 340;
  const pad = { l: 66, r: 20, t: 16, b: 40 };
  const pts = unit.points.map((p) => ({ x: Number(p.incomeTiyin), y: Number(p.expenseTiyin), period: p.period }));
  const be = unit.breakevenTiyin ? Number(unit.breakevenTiyin) : null;
  const F = unit.fixedTiyin ? Number(unit.fixedTiyin) : null;
  const v = unit.variableRate ?? 0;
  const maxX = Math.max(1, ...pts.map((p) => p.x), be ?? 0) * 1.12;
  const maxY = Math.max(1, ...pts.map((p) => p.y), maxX, F ?? 0) * 1.02;
  const xt = niceTicks(0, maxX, 5);
  const yt = niceTicks(0, maxY, 4);
  const X = (val: number) => pad.l + (val / xt[xt.length - 1]!) * (W - pad.l - pad.r);
  const Y = (val: number) => pad.t + (1 - val / yt[yt.length - 1]!) * (H - pad.t - pad.b);
  const xEnd = xt[xt.length - 1]!;
  const avgI = Number(unit.avgIncomeTiyin);
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
        <text key={`x${t}`} x={X(t)} y={H - 22} fontSize={10.5} fill={TONE.axis} textAnchor="middle">
          {t === 0 ? '0' : compact(t)}
        </text>
      ))}
      <text x={(pad.l + W - pad.r) / 2} y={H - 4} fontSize={11} fill={TONE.slate} textAnchor="middle">
        Oylik daromad
      </text>
      {/* Foyda va zarar sohalari */}
      {be !== null && F !== null && (
        <>
          <polygon points={`${X(0)},${Y(0)} ${X(be)},${Y(be)} ${X(0)},${Y(F)}`} fill="#f0d4d1" opacity={0.55} />
          <polygon points={`${X(be)},${Y(be)} ${X(xEnd)},${Y(Math.min(xEnd, yt[yt.length - 1]!))} ${X(xEnd)},${Y(F + v * xEnd)}`} fill="#cfe5d9" opacity={0.6} />
        </>
      )}
      <line x1={X(0)} y1={Y(0)} x2={X(xEnd)} y2={Y(Math.min(xEnd, yt[yt.length - 1]!))} stroke={TONE.income} strokeWidth={2} />
      <text x={X(xEnd) - 4} y={Y(Math.min(xEnd, yt[yt.length - 1]!)) + 14} fontSize={10.5} fill={TONE.income} textAnchor="end">
        daromad
      </text>
      {F !== null && (
        <>
          <line x1={X(0)} y1={Y(F)} x2={X(xEnd)} y2={Y(F + v * xEnd)} stroke={TONE.expense} strokeWidth={2} />
          <text x={X(xEnd) - 4} y={Y(F + v * xEnd) - 6} fontSize={10.5} fill={TONE.expense} textAnchor="end">
            xarajat
          </text>
          <line x1={X(0)} y1={Y(F)} x2={X(xEnd)} y2={Y(F)} stroke={TONE.expense} strokeDasharray="3 4" opacity={0.5} />
          <text x={X(0) + 4} y={Y(F) - 5} fontSize={10} fill={TONE.expense}>
            doimiy qism {compact(F)}
          </text>
        </>
      )}
      {pts.map((p) => (
        <g key={p.period}>
          <title>{`${p.period}\nDaromad: ${compact(p.x)} so'm\nXarajat: ${compact(p.y)} so'm\n${p.x >= p.y ? 'Foyda' : 'Zarar'}: ${compact(Math.abs(p.x - p.y))}`}</title>
          <circle cx={X(p.x)} cy={Y(p.y)} r={4} fill={p.x >= p.y ? RAMP[2] : TONE.expense} opacity={0.8} />
        </g>
      ))}
      {be !== null && (
        <g>
          <line x1={X(be)} x2={X(be)} y1={Y(be)} y2={Y(0)} stroke={TONE.ink} strokeDasharray="4 3" />
          <circle cx={X(be)} cy={Y(be)} r={6} fill="#fff" stroke={TONE.ink} strokeWidth={2} />
          <text x={X(be)} y={Y(0) - 6} fontSize={10.5} fontWeight={700} fill={TONE.ink} textAnchor="middle">
            zararsizlik {compact(be)}
          </text>
        </g>
      )}
      {avgI > 0 && (
        <g>
          <line x1={X(avgI)} x2={X(avgI)} y1={pad.t} y2={Y(0)} stroke={RAMP[3]} strokeDasharray="2 3" />
          <text x={X(avgI)} y={pad.t + 10} fontSize={10.5} fill={RAMP[3]} textAnchor="middle" fontWeight={600}>
            o&apos;rtacha {compact(avgI)}
          </text>
        </g>
      )}
    </svg>
  );
}

/** Xavfsizlik zaxirasi chizig'i (jadval uchun): −50% … +50% */
export function MarginBar({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-[--color-text-faint]">—</span>;
  const clamped = Math.max(-0.5, Math.min(0.5, value));
  const left = value >= 0 ? 50 : 50 + clamped * 100;
  const width = Math.abs(clamped) * 100;
  const color = value < 0 ? TONE.expense : value < 0.1 ? '#b45309' : TONE.income;
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-28 bg-[--color-surface-sunken]">
        <div className="absolute inset-y-0" style={{ left: `${left}%`, width: `${width}%`, background: color }} />
        <span className="absolute inset-y-[-2px] left-1/2 w-px bg-[--color-text]" />
      </div>
      <span className="w-12 text-right text-xs font-semibold tabular-nums" style={{ color }}>
        {value >= 0 ? '+' : '−'}
        {Math.abs(Math.round(value * 100))}%
      </span>
    </div>
  );
}