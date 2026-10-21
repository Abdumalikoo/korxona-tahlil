import { BadRequestException } from '@nestjs/common';

// ═══════════════════════════════════════════════════════════
// Davr oraliqlari: joriy, o'tgan (teng uzunlikdagi oldingi davr) va o'tgan yil.
// Sanalar Toshkent vaqti bo'yicha (UTC+5): [boshlanish 00:00, oxiri + 1 kun 00:00).
// ═══════════════════════════════════════════════════════════

const OFFSET_HOURS = 5;
const DAY = 86400000;

export interface Span {
  from: string;
  to: string;
  start: Date;
  end: Date;
}

export interface Ranges {
  cur: Span;
  prev: Span;
  ly: Span;
  /** Joriy davr oylari: ['2026-01', '2026-02', ...] */
  months: string[];
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y!, m!, d!];
}

function iso(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10);
}

function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function span(from: string, to: string): Span {
  const [fy, fm, fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return {
    from,
    to,
    start: new Date(Date.UTC(fy, fm - 1, fd, -OFFSET_HOURS)),
    end: new Date(Date.UTC(ty, tm - 1, td, -OFFSET_HOURS) + DAY),
  };
}

/** Oy boshidan oy oxirigacha bo'lgan oraliqni n oyga suradi */
function shiftMonths(from: string, to: string, n: number): [string, string] {
  const [fy, fm] = parts(from);
  const [ty, tm] = parts(to);
  const a = new Date(Date.UTC(fy, fm - 1 - n, 1));
  const b = new Date(Date.UTC(ty, tm - 1 - n, 1));
  return [iso(a.getUTCFullYear(), a.getUTCMonth() + 1, 1), iso(b.getUTCFullYear(), b.getUTCMonth() + 1, lastDay(b.getUTCFullYear(), b.getUTCMonth() + 1))];
}

export function isWholeMonths(from: string, to: string): boolean {
  const [, , fd] = parts(from);
  const [ty, tm, td] = parts(to);
  return fd === 1 && td === lastDay(ty, tm);
}

export function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = parts(from);
  const [ty, tm] = parts(to);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 120) break;
  }
  return out;
}

export function ranges(from?: string, to?: string): Ranges {
  if (!ISO.test(from ?? '') || !ISO.test(to ?? '')) throw new BadRequestException("Sana oralig'i noto'g'ri (YYYY-MM-DD)");
  if (from! > to!) throw new BadRequestException("Boshlanish sanasi oxiridan keyin bo'lishi mumkin emas");
  const f = from!;
  const t = to!;
  const months = monthsBetween(f, t);
  if (months.length > 60) throw new BadRequestException("Oraliq 5 yildan oshmasin");

  let prev: [string, string];
  let ly: [string, string];
  if (isWholeMonths(f, t)) {
    prev = shiftMonths(f, t, months.length);
    ly = shiftMonths(f, t, 12);
  } else {
    const days = Math.round((span(f, t).end.getTime() - span(f, t).start.getTime()) / DAY);
    const [fy, fm, fd] = parts(f);
    const pTo = iso(fy, fm, fd - 1);
    const [py, pm, pd] = parts(pTo);
    prev = [iso(py, pm, pd - days + 1), pTo];
    const [ty, tm, td] = parts(t);
    // 29-fevral → 28-fevral
    ly = [iso(fy - 1, fm, Math.min(fd, lastDay(fy - 1, fm))), iso(ty - 1, tm, Math.min(td, lastDay(ty - 1, tm)))];
  }
  return { cur: span(f, t), prev: span(prev[0], prev[1]), ly: span(ly[0], ly[1]), months };
}