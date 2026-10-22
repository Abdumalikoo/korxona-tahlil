import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { loadCenterCategories } from '../expense-policy/policy.util';
import { PrismaService } from '../prisma/prisma.service';
import { uzDate } from './reports.format';

// ═══════════════════════════════════════════════════════════
// Hisobotlar uchun ma'lumot: faqat Daromadlar, Xarajatlar va Xodimlar bo'limlaridan.
// Davr sanalar bo'yicha (Toshkent kuni): ro'yxatlar va bosh sahifa bilan bir xil.
// Birlik (hudud) Solishtirma bilan bir xil aniqlanadi.
// ═══════════════════════════════════════════════════════════

const TZ = 5 * 3600_000;
const DAY = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface Range {
  from: string;
  to: string;
}

export interface Row {
  date: Date;
  /** Toshkent bo'yicha oy: YYYY-MM */
  month: string;
  /** So'mda (ko'rsatish va eski hisobotlar uchun) */
  amount: number;
  /** Tiyinda — aniq hisob uchun (BigInt) */
  tiyin: bigint;
  categoryCode: string;
  unit: string;
  source: string;
  section: string;
}

export interface Labels {
  units: Map<string, string>;
  expenseCategory: Map<string, { label: string; parent: string | null }>;
  incomeCategory: Map<string, string>;
}

export function dayStart(iso: string): Date {
  const m = DATE_RE.exec(iso);
  if (!m) throw new BadRequestException(`Sana noto'g'ri: ${iso} (YYYY-MM-DD)`);
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - TZ;
  if (new Date(ms + TZ).toISOString().slice(0, 10) !== iso) throw new BadRequestException(`Sana noto'g'ri: ${iso}`);
  return new Date(ms);
}

export function isoOf(date: Date): string {
  return new Date(date.getTime() + TZ).toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date(Date.now() + TZ).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return isoOf(new Date(dayStart(iso).getTime() + days * DAY));
}

export function daysIn(range: Range): number {
  return Math.round((dayStart(range.to).getTime() - dayStart(range.from).getTime()) / DAY) + 1;
}

/** Oldingi teng davr */
export function previousRange(range: Range): Range {
  const days = daysIn(range);
  return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
}

/** O'tgan yilning shu davri (29-fevral — 28-fevral) */
export function yearAgoRange(range: Range): Range {
  const shift = (iso: string) => {
    const y = Number(iso.slice(0, 4)) - 1;
    let md = iso.slice(5);
    if (md === '02-29') md = '02-28';
    return `${y}-${md}`;
  };
  return { from: shift(range.from), to: shift(range.to) };
}

export function rangeText(range: Range): string {
  return `${uzDate(range.from)} – ${uzDate(range.to)}`;
}

/** Davrdagi oylar */
export function monthsOf(range: Range): string[] {
  const out: string[] = [];
  let y = Number(range.from.slice(0, 4));
  let m = Number(range.from.slice(5, 7));
  const end = range.to.slice(0, 7);
  while (out.length < 60) {
    const p = `${y}-${String(m).padStart(2, '0')}`;
    out.push(p);
    if (p >= end) break;
    m += 1;
    if (m === 13) {
      y += 1;
      m = 1;
    }
  }
  return out;
}

export function unitKeyOf(regionCode: number | null, departmentId: string | null): string {
  if (regionCode !== null) return regionCode === 0 ? 'center' : `r:${regionCode}`;
  if (departmentId) return 'center';
  return 'none';
}

@Injectable()
export class ReportData {
  constructor(private readonly prisma: PrismaService) {}

  parseRange(from?: string, to?: string): Range {
    const today = todayIso();
    const range = { from: from || `${today.slice(0, 4)}-01-01`, to: to || today };
    const a = dayStart(range.from);
    const b = dayStart(range.to);
    if (a > b) throw new BadRequestException('Boshlanish sanasi tugash sanasidan keyin');
    if ((b.getTime() - a.getTime()) / DAY > 3 * 366) throw new BadRequestException('Davr 3 yildan oshmasin');
    return range;
  }

  async labels(): Promise<Labels> {
    const [regions, cats, incomeCats] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.category.findMany({ select: { code: true, label: true, parentCode: true } }),
      this.prisma.incomeCategory.findMany({ select: { code: true, label: true } }),
    ]);
    const units = new Map<string, string>([
      ['all', 'Butun korxona'],
      ['center', regions.find((r) => r.code === 0)?.name ?? 'Markaz'],
      ['none', 'Hududga biriktirilmagan'],
    ]);
    for (const r of regions) if (r.code !== 0) units.set(`r:${r.code}`, r.name);
    return {
      units,
      expenseCategory: new Map(cats.map((c) => [c.code, { label: c.label, parent: c.parentCode }])),
      incomeCategory: new Map(incomeCats.map((c) => [c.code, c.label])),
    };
  }

  /** Birlik kalitini tekshirish: all | center | none | r:N */
  checkUnit(unit: string | undefined, labels: Labels, required = false): string {
    const key = unit || 'all';
    if (required && key === 'all') throw new BadRequestException('Hududni tanlang');
    if (!labels.units.has(key)) throw new NotFoundException('Hudud topilmadi');
    return key;
  }

  /** Daromad va xarajat yozuvlari (bir necha davrni qamrab oluvchi oyna) */
  async rows(ranges: Range[], unit = 'all'): Promise<{ incomes: Row[]; expenses: Row[] }> {
    const start = new Date(Math.min(...ranges.map((r) => dayStart(r.from).getTime())));
    const end = new Date(Math.max(...ranges.map((r) => dayStart(r.to).getTime())) + DAY);
    const where = { deletedAt: null, date: { gte: start, lt: end } };
    const [incomes, expenses] = await Promise.all([
      this.prisma.income.findMany({ where, select: { date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, source: true, section: true } }),
      this.prisma.expense.findMany({ where, select: { date: true, amountTiyin: true, categoryCode: true, regionCode: true, departmentId: true, source: true, section: true } }),
    ]);
    // Xarajatlar siyosati: Markaz hisobidagi moddalar qayerga yozilgan bo'lsa ham — Markaz xarajati (Solishtirmadagidek)
    const centerCats = await loadCenterCategories(this.prisma).catch(() => new Set<string>());
    const map = (r: (typeof incomes)[number], expense = false): Row => ({
      date: r.date,
      month: isoOf(r.date).slice(0, 7),
      amount: Number(r.amountTiyin) / 100,
      tiyin: r.amountTiyin,
      categoryCode: r.categoryCode,
      unit: expense && centerCats.has(r.categoryCode) ? 'center' : unitKeyOf(r.regionCode, r.departmentId),
      source: String(r.source),
      section: String(r.section),
    });
    const keep = (row: Row) => unit === 'all' || row.unit === unit;
    return { incomes: incomes.map((r) => map(r)).filter(keep), expenses: expenses.map((r) => map(r, true)).filter(keep) };
  }

  /** Davr ichida ishlagan xodimlar soni (Xodimlar bo'limi) */
  async headcount(range: Range, unit = 'all'): Promise<number> {
    const employees = await this.prisma.employee.findMany({ select: { regionCode: true, hiredAt: true, firedAt: true, isActive: true } });
    const start = dayStart(range.from);
    const end = new Date(dayStart(range.to).getTime() + DAY);
    return employees.filter((e) => {
      if (!e.isActive && e.firedAt === null) return false;
      const key = e.regionCode === 0 ? 'center' : `r:${e.regionCode}`;
      if (unit !== 'all' && key !== unit) return false;
      return (!e.hiredAt || e.hiredAt < end) && (!e.firedAt || e.firedAt >= start);
    }).length;
  }

  /** Davr ichida ishlagan xodimlar soni — birliklar bo'yicha */
  async headcountByUnit(range: Range): Promise<Map<string, number>> {
    const employees = await this.prisma.employee.findMany({ select: { regionCode: true, hiredAt: true, firedAt: true, isActive: true } });
    const start = dayStart(range.from);
    const end = new Date(dayStart(range.to).getTime() + DAY);
    const out = new Map<string, number>();
    for (const e of employees) {
      if (!e.isActive && e.firedAt === null) continue;
      if (!((!e.hiredAt || e.hiredAt < end) && (!e.firedAt || e.firedAt >= start))) continue;
      const key = e.regionCode === 0 ? 'center' : `r:${e.regionCode}`;
      out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
  }

  /**
   * O'rtacha faol xodimlar soni — birliklar bo'yicha: har oy shu oyda ishlagan xodimlar soni,
   * so'ng davr oylari bo'yicha o'rtacha (oy ichida kirgan yoki bo'shagan ham o'sha oyda ishlagan hisoblanadi).
   */
  async averageHeadcountByUnit(range: Range): Promise<Map<string, number>> {
    const employees = await this.prisma.employee.findMany({ select: { regionCode: true, hiredAt: true, firedAt: true, isActive: true } });
    const months = monthsOf(range);
    const sums = new Map<string, number>();
    for (const m of months) {
      const start = dayStart(`${m}-01`);
      const end = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1) - TZ);
      for (const e of employees) {
        if (!e.isActive && e.firedAt === null) continue;
        if (!((!e.hiredAt || e.hiredAt < end) && (!e.firedAt || e.firedAt >= start))) continue;
        const key = e.regionCode === 0 ? 'center' : `r:${e.regionCode}`;
        sums.set(key, (sums.get(key) ?? 0) + 1);
      }
    }
    return new Map([...sums].map(([k, v]) => [k, v / months.length]));
  }

  /** Yozuvlar davr ichidami */
  static inRange(range: Range): (row: Row) => boolean {
    const a = dayStart(range.from).getTime();
    const b = dayStart(range.to).getTime() + DAY;
    return (row) => row.date.getTime() >= a && row.date.getTime() < b;
  }
}