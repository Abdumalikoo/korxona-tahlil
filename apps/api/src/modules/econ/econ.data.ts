import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { DataWarning, Panel, UnitKind, UnitSeries } from './econ.types';
import { median } from './econ.math';

// ═══════════════════════════════════════════════════════════
// Modellar uchun yagona ma'lumot jadvali: oy × birlik (korxona, hududlar, Markaz).
//
// Ma'lumot faqat uchta bo'limdan olinadi — hech narsa qo'shilmaydi, o'zgartirilmaydi:
//  - Daromadlar bo'limi (incomes) — yozuv SANASI qaysi oyda bo'lsa (Toshkent vaqti), o'sha oy:
//    ro'yxatlar, bosh sahifa, Solishtirma va hisobotlar bilan bir xil;
//  - Xarajatlar bo'limi (expenses) — ish haqi, ijara, mashinalar va boshqalar shu yerda;
//  - Xodimlar bo'limi (employees) — oy ichida ishlagan xodimlar soni.
// Birlik Solishtirma bilan bir xil aniqlanadi: hudud kodi → hudud (0 — Markaz),
// hududsiz lekin Markaz bo'limi bor → Markaz, qolgani → biriktirilmagan.
// ═══════════════════════════════════════════════════════════

const TASHKENT_MS = 5 * 3600_000;

/** Oy × birlik bo'yicha yig'ma qator (SQL natijasi) */
interface MonthRow {
  month: string;
  regionCode: number | null;
  departmentId: string | null;
  section: string;
  source: string | null;
  total: bigint | number | string | null;
  count: number | bigint;
}
/** Eng ko'pi bilan necha oy orqaga qaraladi */
const MAX_MONTHS = 60;
const CACHE_MS = 60_000;

export function currentPeriodOf(now = Date.now()): string {
  return new Date(now + TASHKENT_MS).toISOString().slice(0, 7);
}

export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function periodRange(from: string, to: string): string[] {
  const out: string[] = [];
  let p = from;
  while (p <= to && out.length < 240) {
    out.push(p);
    p = shiftPeriod(p, 1);
  }
  return out;
}

const MONTH_NAMES = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

/** "2026-09" → "sentabr 2026" */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month);
}

function monthStart(period: string): Date {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1) - TASHKENT_MS);
}

function unitKeyOf(regionCode: number | null, departmentId: string | null): string {
  if (regionCode !== null) return regionCode === 0 ? 'center' : `r:${regionCode}`;
  if (departmentId) return 'center';
  return 'none';
}

/** Tiyin (BigInt) → so'm (hisoblash uchun) */
function som(tiyin: bigint | null | undefined): number {
  return tiyin ? Number(tiyin) / 100 : 0;
}

/** Pul qisqa ko'rinishda: "1,25 mlrd so'm" */
export function fmtSom(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  const text =
    abs >= 1e9
      ? `${(abs / 1e9).toFixed(2).replace('.', ',')} mlrd`
      : abs >= 1e6
        ? `${(abs / 1e6).toFixed(1).replace('.', ',')} mln`
        : abs >= 1e3
          ? `${Math.round(abs / 1e3)} ming`
          : `${Math.round(abs)}`;
  return `${sign}${text} so'm`;
}

export function fmtPct(value: number, digits = 1): string {
  return `${value.toFixed(digits).replace('.', ',')}%`;
}

/** So'm → tiyin satri */
export function tiyin(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return String(Math.round(value * 100));
}

/** Umumiy «Davr» oyi: "2026-08" — o'tgan oy bo'lsa tarixiy ko'rinish, aks holda null (bugungi holat) */
export function normalizeAsOf(asOf?: string | null): string | null {
  if (!asOf || !/^\d{4}-(0[1-9]|1[0-2])$/.test(asOf)) return null;
  return asOf < currentPeriodOf() ? asOf : null;
}

@Injectable()
export class EconData {
  /** Kesh: kalit — tarixiy oy yoki "now" */
  private cache = new Map<string, { panel: Panel; at: number }>();
  private pending = new Map<string, Promise<Panel>>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Oy × birlik jadvali (1 daqiqa keshlanadi).
   * asOf — umumiy «Davr»ning oyi: o'tgan oy bo'lsa, jadval o'sha oy oxirida turgandek quriladi —
   * keyingi oylar yozuvlari olinmaydi, «joriy» oy asOf dan keyingi oy (unda hali yozuv yo'q).
   */
  async panel(asOf?: string | null): Promise<Panel> {
    const at = normalizeAsOf(asOf);
    const key = at ?? 'now';
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.panel;
    let job = this.pending.get(key);
    if (!job) {
      job = this.build(at)
        .then((panel) => {
          // Eski tarixiy jadvallar ko'payib ketmasin
          if (this.cache.size > 12) this.cache.clear();
          this.cache.set(key, { panel, at: Date.now() });
          return panel;
        })
        .finally(() => {
          this.pending.delete(key);
        });
      this.pending.set(key, job);
    }
    return job;
  }

  private async build(asOf: string | null): Promise<Panel> {
    const currentPeriod = asOf ? shiftPeriod(asOf, 1) : currentPeriodOf();
    const earliest = shiftPeriod(currentPeriod, -(MAX_MONTHS - 1));

    // Oylar yozuv sanasi bo'yicha (Toshkent = UTC+5); faqat o'chirilmagan yozuvlar.
    // Tarixiy ko'rinishda asOf oyidan keyingi yozuvlar olinmaydi.
    const windowStart = monthStart(earliest);
    const windowEnd = asOf ? monthStart(currentPeriod) : monthStart(shiftPeriod(currentPeriod, 1));
    const [bounds, regions, incomeRows, expenseRows, employees] = await Promise.all([
      this.prisma.$queryRaw<{ first: Date | null }[]>(Prisma.sql`
        SELECT MIN(d) AS first FROM (
          SELECT MIN("date") AS d FROM "incomes" WHERE "deletedAt" IS NULL AND "date" >= ${windowStart} AND "date" < ${windowEnd}
          UNION ALL
          SELECT MIN("date") AS d FROM "expenses" WHERE "deletedAt" IS NULL AND "date" >= ${windowStart} AND "date" < ${windowEnd}
        ) t`),
      this.prisma.region.findMany({ select: { code: true, name: true, isActive: true }, orderBy: { code: 'asc' } }),
      this.prisma.$queryRaw<MonthRow[]>(Prisma.sql`
        SELECT to_char("date" + interval '5 hours', 'YYYY-MM') AS month, "regionCode", "departmentId", "section"::text AS section,
               NULL::text AS source, SUM("amountTiyin")::bigint AS total, COUNT(*)::int AS count
        FROM "incomes"
        WHERE "deletedAt" IS NULL AND "date" >= ${windowStart} AND "date" < ${windowEnd}
        GROUP BY 1, 2, 3, 4`),
      this.prisma.$queryRaw<MonthRow[]>(Prisma.sql`
        SELECT to_char("date" + interval '5 hours', 'YYYY-MM') AS month, "regionCode", "departmentId", "section"::text AS section,
               "source"::text AS source, SUM("amountTiyin")::bigint AS total, COUNT(*)::int AS count
        FROM "expenses"
        WHERE "deletedAt" IS NULL AND "date" >= ${windowStart} AND "date" < ${windowEnd}
        GROUP BY 1, 2, 3, 4, 5`),
      this.prisma.employee.findMany({ select: { regionCode: true, hiredAt: true, firedAt: true, isActive: true } }),
    ]);
    const first = bounds[0]?.first ?? null;
    const firstPeriod = first ? new Date(new Date(first).getTime() + TASHKENT_MS).toISOString().slice(0, 7) : currentPeriod;
    const months = periodRange(firstPeriod < earliest ? earliest : firstPeriod, currentPeriod);
    const index = new Map(months.map((p, i) => [p, i]));

    const size = months.length;
    const zeros = () => new Array<number>(size).fill(0);
    const make = (key: string, code: number | null, name: string, kind: UnitKind): UnitSeries => ({
      key,
      code,
      name,
      kind,
      income: zeros(),
      incomeDoimiy: zeros(),
      expense: zeros(),
      expenseDoimiy: zeros(),
      payroll: zeros(),
      lease: zeros(),
      vehicle: zeros(),
      otherExpense: zeros(),
      headcount: zeros(),
      incomeCount: zeros(),
      expenseCount: zeros(),
    });

    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const units = new Map<string, UnitSeries>();
    units.set('center', make('center', 0, regionName.get(0) ?? 'Markaz', 'center'));
    for (const region of regions) {
      if (region.code === 0 || !region.isActive) continue;
      units.set(`r:${region.code}`, make(`r:${region.code}`, region.code, region.name, 'region'));
    }
    const unit = (key: string): UnitSeries => {
      let u = units.get(key);
      if (!u) {
        if (key === 'none') u = make('none', null, 'Hududga biriktirilmagan', 'unassigned');
        else {
          const code = Number(key.slice(2));
          u = make(key, code, regionName.get(code) ?? `Hudud ${code}`, 'region');
        }
        units.set(key, u);
      }
      return u;
    };
    const total = make('all', null, 'Butun korxona', 'total');

    for (const row of incomeRows) {
      const i = index.get(row.month);
      if (i === undefined) continue;
      const amount = som(BigInt(row.total ?? 0));
      const count = Number(row.count);
      for (const u of [unit(unitKeyOf(row.regionCode, row.departmentId)), total]) {
        u.income[i]! += amount;
        u.incomeCount[i]! += count;
        if (row.section === 'DOIMIY') u.incomeDoimiy[i]! += amount;
      }
    }

    for (const row of expenseRows) {
      const i = index.get(row.month);
      if (i === undefined) continue;
      const amount = som(BigInt(row.total ?? 0));
      const count = Number(row.count);
      for (const u of [unit(unitKeyOf(row.regionCode, row.departmentId)), total]) {
        u.expense[i]! += amount;
        u.expenseCount[i]! += count;
        if (row.section === 'DOIMIY') u.expenseDoimiy[i]! += amount;
        if (row.source === 'PAYROLL') u.payroll[i]! += amount;
        else if (row.source === 'LEASE') u.lease[i]! += amount;
        else if (row.source === 'VEHICLE') u.vehicle[i]! += amount;
        else u.otherExpense[i]! += amount;
      }
    }

    // Xodimlar: oy ichida kamida bir kun ishlagan (Solishtirma bilan bir xil qoida)
    const monthBounds = months.map((p) => ({ start: monthStart(p), end: monthStart(shiftPeriod(p, 1)) }));
    for (const e of employees) {
      if (!e.isActive && e.firedAt === null) continue;
      const u = unit(e.regionCode === 0 ? 'center' : `r:${e.regionCode}`);
      monthBounds.forEach((b, i) => {
        if ((!e.hiredAt || e.hiredAt < b.end) && (!e.firedAt || e.firedAt >= b.start)) {
          u.headcount[i]! += 1;
          total.headcount[i]! += 1;
        }
      });
    }

    const kindOrder: Record<UnitKind, number> = { total: 0, region: 1, center: 2, unassigned: 3 };
    const list = [...units.values()]
      .filter((u) => u.kind !== 'unassigned' || u.income.some((v) => v !== 0) || u.expense.some((v) => v !== 0))
      .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || (a.code ?? 0) - (b.code ?? 0));

    return {
      months,
      currentPeriod,
      lastFullPeriod: shiftPeriod(currentPeriod, -1),
      asOf,
      total,
      units: list,
      builtAt: Date.now(),
    };
  }

  /** Birlikni kalit bo'yicha topish: all | center | r:N | none */
  static pick(panel: Panel, key: string): UnitSeries | null {
    if (!key || key === 'all') return panel.total;
    return panel.units.find((u) => u.key === key) ?? null;
  }

  /** Tugagan oylar soni (joriy oy kirmaydi) */
  static fullCount(panel: Panel): number {
    return panel.months.filter((p) => p < panel.currentPeriod).length;
  }

  /** Birlikda ma'lumot bor tugagan oylar soni (birinchi yozuvdan boshlab) */
  static activeMonths(panel: Panel, u: UnitSeries): number {
    const full = EconData.fullCount(panel);
    const first = u.income.findIndex((v, i) => i < full && (v !== 0 || u.expense[i] !== 0));
    return first < 0 ? 0 : full - first;
  }

  /**
   * Ma'lumot sifati: g'ayrioddiy oylar haqida ogohlantirish.
   * Hech narsa o'zgartirilmaydi — faqat foydalanuvchiga ko'rsatiladi.
   */
  static warnings(panel: Panel): DataWarning[] {
    const out: DataWarning[] = [];
    const full = EconData.fullCount(panel);
    const t = panel.total;
    const months = panel.months.slice(0, full);

    if (full < 33) {
      out.push({
        level: 'info',
        unit: null,
        period: null,
        text: `Hozircha ${full} ta tugagan oy ma'lumoti bor. Yillik takrorlanadigan mavsumni ajratish uchun taxminan 33 oy kerak — shu paytgacha modellar trend va o'rtachaga tayanadi.`,
      });
    }

    // Ish haqi: odatdagidan ancha ko'p oylar (takrorlangan paket bo'lishi mumkin)
    const payroll = t.payroll.slice(0, full);
    const payrollNonZero = payroll.filter((v) => v > 0);
    if (payrollNonZero.length >= 6) {
      const med = median(payrollNonZero);
      payroll.forEach((v, i) => {
        if (med > 0 && v > med * 1.6) {
          out.push({
            level: 'warn',
            unit: 'all',
            period: months[i]!,
            text: `${periodLabel(months[i]!)}: ish haqi xarajati odatdagidan ${(v / med).toFixed(1).replace('.', ',')} barobar ko'p (${fmtSom(v)}, odatda ${fmtSom(med)}). Xarajatlar bo'limida ish haqi paketi ikki marta kiritilmaganini tekshiring — modellar shu oyni ham hisobga oladi.`,
          });
        }
      });
    }

    // Daromad va xarajatdagi keskin sakrashlar
    const spikes = (values: number[], label: string) => {
      const nonZero = values.filter((v) => v > 0);
      if (nonZero.length < 6) return;
      const med = median(nonZero);
      values.forEach((v, i) => {
        if (med <= 0) return;
        if (v > med * 2.5) {
          out.push({ level: 'info', unit: 'all', period: months[i]!, text: `${periodLabel(months[i]!)}: ${label} odatdagidan ${(v / med).toFixed(1).replace('.', ',')} barobar ko'p (${fmtSom(v)}).` });
        }
      });
    };
    spikes(t.income.slice(0, full), 'daromad');
    spikes(t.expense.slice(0, full).map((v, i) => v - payroll[i]!), 'ish haqidan tashqari xarajat');

    // Oraliqdagi bo'sh oylar
    const income = t.income.slice(0, full);
    const firstIncome = income.findIndex((v) => v > 0);
    const lastIncome = income.length - 1 - [...income].reverse().findIndex((v) => v > 0);
    if (firstIncome >= 0) {
      const empty = months.filter((_, i) => i > firstIncome && i < lastIncome && income[i] === 0);
      if (empty.length > 0) {
        out.push({
          level: 'warn',
          unit: 'all',
          period: empty[0]!,
          text: `Daromad yozilmagan oylar: ${empty.map(periodLabel).join(', ')}. Bu oylar modelda "nol daromad" deb olinadi — agar yozuvlar kiritilmagan bo'lsa, Daromadlar bo'limini to'ldiring.`,
        });
      }
    }

    // Biriktirilmagan yozuvlar ulushi
    const none = panel.units.find((u) => u.kind === 'unassigned');
    if (none) {
      const e = none.expense.slice(0, full).reduce((s, v) => s + v, 0);
      const allE = t.expense.slice(0, full).reduce((s, v) => s + v, 0);
      const i = none.income.slice(0, full).reduce((s, v) => s + v, 0);
      const allI = t.income.slice(0, full).reduce((s, v) => s + v, 0);
      const share = Math.max(allE > 0 ? e / allE : 0, allI > 0 ? i / allI : 0);
      if (share > 0.03) {
        out.push({
          level: 'info',
          unit: 'none',
          period: null,
          text: `Yozuvlarning bir qismi (${fmtPct(share * 100)} gacha) hech qaysi hududga biriktirilmagan — ular korxona jami hisobida bor, lekin hududlar modellariga kirmaydi.`,
        });
      }
    }

    // Xodimlar bo'limi bo'sh
    if (t.headcount.every((v) => v === 0)) {
      out.push({ level: 'warn', unit: null, period: null, text: "Xodimlar bo'limida bu davrda ishlagan xodimlar topilmadi —xodimlar soniga tayanadigan modellar (omillar, Kobb-Duglas) ishlamaydi." });
    }

    return out;
  }
}