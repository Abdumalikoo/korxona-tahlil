import { PALETTE } from './reports.format';
import type { ChartBlock } from './reports.types';

// ═══════════════════════════════════════════════════════════
// PDF uchun grafiklar — oddiy SVG (vertikal/gorizontal ustun, chiziq, aralash)
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

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function num(v: number): string {
  const abs = Math.abs(v);
  const digits = abs >= 100 || v === 0 ? 0 : abs >= 10 ? 1 : 2;
  const [i, f] = abs.toFixed(digits).split('.');
  return `${v < 0 ? '−' : ''}${i!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${f && Number(f) !== 0 ? `,${f}` : ''}`;
}

const DEFAULT_COLORS = [PALETTE.navy, PALETTE.expenseBar, PALETTE.green, PALETTE.amber, PALETTE.ramp[3]!, PALETTE.slate];

export function chartSvg(chart: ChartBlock, width = 515, height = 230): string {
  const colors = chart.series.map((s, i) => `#${s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]}`);
  const legendH = chart.series.length > 1 ? 18 : 0;
  const parts: string[] = [];
  const text = (x: number, y: number, t: string, o: { size?: number; anchor?: string; color?: string; weight?: string } = {}) =>
    parts.push(
      `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${o.size ?? 7.5}" text-anchor="${o.anchor ?? 'start'}" fill="${o.color ?? `#${PALETTE.muted}`}"${o.weight ? ` font-weight="${o.weight}"` : ''}>${esc(t)}</text>`,
    );

  if (chart.kind === 'barh') {
    const s = chart.series[0]!;
    const labelW = Math.min(150, Math.max(60, ...chart.labels.map((l) => l.length * 4.2)));
    const pad = { l: labelW + 6, r: 44, t: 4, b: 16 + legendH };
    const rowH = (height - pad.t - pad.b) / Math.max(1, chart.labels.length);
    const lo = Math.min(0, ...s.values);
    const hi = Math.max(0, ...s.values, 1e-9);
    const ticks = niceTicks(lo, hi, 4);
    const dMin = ticks[0]!;
    const dMax = ticks[ticks.length - 1]!;
    const x = (v: number) => pad.l + ((v - dMin) / (dMax - dMin || 1)) * (width - pad.l - pad.r);
    for (const t of ticks) {
      parts.push(`<line x1="${x(t)}" x2="${x(t)}" y1="${pad.t}" y2="${height - pad.b}" stroke="#${t === 0 ? PALETTE.faint : PALETTE.line}" stroke-width="0.6"/>`);
      text(x(t), height - pad.b + 10, num(t), { anchor: 'middle', size: 7 });
    }
    chart.labels.forEach((label, i) => {
      const v = s.values[i] ?? 0;
      const y = pad.t + i * rowH;
      const bh = Math.max(2, Math.min(14, rowH * 0.62));
      const x0 = x(Math.min(0, v));
      const x1 = x(Math.max(0, v));
      const fill = v < 0 && !s.color ? `#${PALETTE.red}` : colors[0];
      parts.push(`<rect x="${x0.toFixed(1)}" y="${(y + (rowH - bh) / 2).toFixed(1)}" width="${Math.max(0.8, x1 - x0).toFixed(1)}" height="${bh.toFixed(1)}" fill="${fill}"/>`);
      text(pad.l - 5, y + rowH / 2 + 2.6, label.length > 34 ? `${label.slice(0, 33)}…` : label, { anchor: 'end', color: `#${PALETTE.text}`, size: 7.5 });
      text(x1 + 3, y + rowH / 2 + 2.6, num(v), { size: 7, color: `#${PALETTE.text}` });
    });
  } else {
    const pad = { l: 44, r: 8, t: 8, b: 18 + legendH };
    const bars = chart.series.filter((s) => chart.kind === 'bar' && !s.asLine);
    const lines = chart.series.filter((s) => chart.kind === 'line' || s.asLine);
    const n = chart.labels.length;
    // Yig'ma ustunlar: musbatlar yuqoriga, manfiylar pastga alohida to'planadi
    const stackUp = chart.labels.map((_, i) => bars.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0));
    const stackDown = chart.labels.map((_, i) => bars.reduce((sum, s) => sum + Math.min(0, s.values[i] ?? 0), 0));
    const all = [
      ...chart.series.flatMap((s) => s.values),
      ...(chart.stacked ? [...stackUp, ...stackDown] : []),
    ];
    const ticks = niceTicks(Math.min(0, ...all), Math.max(1e-9, ...all), 4);
    const dMin = ticks[0]!;
    const dMax = ticks[ticks.length - 1]!;
    const slot = (width - pad.l - pad.r) / Math.max(1, n);
    const y = (v: number) => pad.t + (1 - (v - dMin) / (dMax - dMin || 1)) * (height - pad.t - pad.b);
    for (const t of ticks) {
      parts.push(`<line x1="${pad.l}" x2="${width - pad.r}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="#${t === 0 ? PALETTE.faint : PALETTE.line}" stroke-width="0.6"/>`);
      text(pad.l - 4, y(t) + 2.5, num(t), { anchor: 'end', size: 7 });
    }
    const every = Math.max(1, Math.ceil(n / 14));
    chart.labels.forEach((label, i) => {
      if (i % every === 0) text(pad.l + slot * (i + 0.5), height - pad.b + 11, label, { anchor: 'middle', size: 7 });
    });
    if (bars.length) {
      const groupW = slot * 0.72;
      const bw = chart.stacked ? groupW : groupW / bars.length;
      chart.labels.forEach((_, i) => {
        let up = 0;
        let down = 0;
        bars.forEach((s, k) => {
          const v = s.values[i] ?? 0;
          if (chart.stacked && v === 0) return;
          const color = colors[chart.series.indexOf(s)]!;
          const x0 = pad.l + slot * i + (slot - groupW) / 2 + (chart.stacked ? 0 : k * bw);
          let top: number;
          let bottom: number;
          if (!chart.stacked) {
            top = y(Math.max(0, v));
            bottom = y(Math.min(0, v));
          } else if (v >= 0) {
            top = y(up + v);
            bottom = y(up);
            up += v;
          } else {
            top = y(down);
            bottom = y(down + v);
            down += v;
          }
          parts.push(`<rect x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(0.8, bw - (chart.stacked ? 0 : 0.8)).toFixed(1)}" height="${Math.max(0.5, bottom - top).toFixed(1)}" fill="${color}"/>`);
        });
      });
    }
    for (const s of lines) {
      const color = colors[chart.series.indexOf(s)]!;
      const pts = s.values.map((v, i) => `${(pad.l + slot * (i + 0.5)).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
      parts.push(`<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"/>`);
      s.values.forEach((v, i) => parts.push(`<circle cx="${(pad.l + slot * (i + 0.5)).toFixed(1)}" cy="${y(v).toFixed(1)}" r="1.8" fill="${color}"/>`));
    }
  }

  if (legendH) {
    let lx = 44;
    chart.series.forEach((s, i) => {
      parts.push(`<rect x="${lx}" y="${height - 9}" width="8" height="6" fill="${colors[i]}"/>`);
      text(lx + 11, height - 3.5, s.name, { size: 7.5, color: `#${PALETTE.text}` });
      lx += 20 + s.name.length * 4.1;
    });
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Roboto">${parts.join('')}</svg>`;
}