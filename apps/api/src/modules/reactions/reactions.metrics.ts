import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { loadCenterCategories } from '../expense-policy/policy.util';
import { PrismaService } from '../prisma/prisma.service';
import { CenterService } from '../structure/center.service';
import { DistrictsService } from '../structure/districts.service';
import { RegionsService } from '../structure/regions.service';
import type { ItemFilter, ItemKind, TopRecord } from './reactions.types';
import { districtPayrollRows, employeeResultRows, employeeSalaryRows, type VirtualRow } from './reactions.virtual';

// ═══════════════════════════════════════════════════════════
// Hisoblash yadrosi: belgilangan modda bo'yicha summalar.
// Ma'lumot faqat Daromadlar (incomes) va Xarajatlar (expenses) jadvallaridan olinadi —
// bo'limlar ro'yxati qanday hisoblasa, shunday.
//
// Solishtirmadan belgilangan butun birliklar (viloyat, Markaz, biriktirilmagan, tuman, Markaz bo'limi)
// — Solishtirma hisobining O'ZI bilan hisoblanadi (xarajatlar siyosati, ish haqi vedomosti,
// tumanga bo'linmagan daromad taqsimoti, Markaz bo'limlari): Munosabatdagi raqam Solishtirmadagi bilan bir xil.
// ═══════════════════════════════════════════════════════════

export const TASHKENT_MS = 5 * 3600_000;
export const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Bugun (Toshkent), YYYY-MM-DD */
export function todayIso(): string {
  return new Date(Date.now() + TASHKENT_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD → Toshkent kuni boshi (UTC) */
export function dayStart(iso: string): Date {
  const match = DATE_RE.exec(iso);
  if (!match) throw new BadRequestException(`Sana noto'g'ri: ${iso} (YYYY-MM-DD)`);
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), -5);
  const check = new Date(ms + TASHKENT_MS).toISOString().slice(0, 10);
  if (check !== iso) throw new BadRequestException(`Sana noto'g'ri: ${iso}`);
  return new Date(ms);
}

/** Toshkent kuni boshi (UTC) → YYYY-MM-DD */
export function isoOf(date: Date): string {
  return new Date(date.getTime() + TASHKENT_MS).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return isoOf(new Date(dayStart(iso).getTime() + days * DAY_MS));
}

/** Ikki sana orasidagi kunlar (ikkala chekka ham kiradi) */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / DAY_MS) + 1;
}

/** Oxirgi oy bilan tugaydigan n oy */
export function monthsEnding(period: string, count: number): string[] {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const result: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const index = y * 12 + (m - 1) - i;
    result.push(`${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`);
  }
  return result;
}

export function daysInMonth(period: string): number {
  const [y, m] = period.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const SOURCES = new Set(['MANUAL', 'IMPORT', 'PAYROLL', 'LEASE', 'VEHICLE']);
const KINDS = new Set(['INCOME', 'EXPENSE', 'RESULT']);

/** Kiruvchi filtrni tekshiradi va tozalaydi */
export function cleanFilter(raw: unknown): ItemFilter {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const text = (key: string, max = 80): string | undefined => {
    const v = value[key];
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string' || v.length > max) throw new BadRequestException(`Filtr noto'g'ri: ${key}`);
    return v;
  };
  const filter: ItemFilter = {};
  const unit = text('unit');
  if (unit !== undefined) {
    if (!(unit === 'center' || unit === 'none' || /^r:\d{1,3}$/.test(unit))) throw new BadRequestException("Filtr noto'g'ri: unit");
    filter.unit = unit;
  }
  const departmentId = text('departmentId');
  if (departmentId) filter.departmentId = departmentId;
  const categoryCode = text('categoryCode');
  if (categoryCode) filter.categoryCode = categoryCode;
  const rootCategoryCode = text('rootCategoryCode');
  if (rootCategoryCode) filter.rootCategoryCode = rootCategoryCode;
  const source = text('source');
  if (source) {
    if (!SOURCES.has(source)) throw new BadRequestException("Filtr noto'g'ri: source");
    filter.source = source as ItemFilter['source'];
  }
  const section = text('section');
  if (section) {
    if (section !== 'DOIMIY' && section !== 'BOSHQA') throw new BadRequestException("Filtr noto'g'ri: section");
    filter.section = section;
  }
  const vehicleId = text('vehicleId');
  if (vehicleId) filter.vehicleId = vehicleId;
  const districtId = text('districtId', 20);
  if (districtId) {
    if (!/^\d{1,3}-\d{1,4}$/.test(districtId)) throw new BadRequestException("Filtr noto'g'ri: districtId");
    filter.districtId = districtId;
  }
  const employeePinfl = text('employeePinfl', 20);
  if (employeePinfl) {
    if (!/^\d{14}$/.test(employeePinfl)) throw new BadRequestException("Filtr noto'g'ri: employeePinfl");
    filter.employeePinfl = employeePinfl;
  }
  const counterparty = text('counterparty', 200);
  if (counterparty) filter.counterparty = counterparty;
  const clientName = text('clientName', 200);
  if (clientName) filter.clientName = clientName;
  const leaseId = text('leaseId');
  if (leaseId) filter.leaseId = leaseId;
  const recordId = text('recordId');
  if (recordId) filter.recordId = recordId;
  return filter;
}

export function cleanKind(raw: unknown): ItemKind {
  if (typeof raw !== 'string' || !KINDS.has(raw)) throw new BadRequestException("Modda turi noto'g'ri: INCOME, EXPENSE yoki RESULT");
  return raw as ItemKind;
}

type Side = 'INCOME' | 'EXPENSE';

@Injectable()
export class ReactionMetrics {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly regions?: RegionsService,
    @Optional() private readonly districts?: DistrictsService,
    @Optional() private readonly center?: CenterService,
  ) {}

  // ─────────── Solishtirma birliklari ───────────

  /** Faqat birlik (+ bo'lim turi) filtri — Solishtirma hisobi bilan; boshqa aniqlashtirish bo'lsa — null */
  private alignedOf(filter: ItemFilter): { type: 'unit'; unit: string } | { type: 'district'; regionCode: number; districtId: string } | { type: 'department'; departmentId: string } | null {
    const extra = (Object.keys(filter) as (keyof ItemFilter)[]).filter((k) => filter[k] !== undefined && !['unit', 'section', 'districtId', 'departmentId'].includes(k));
    if (extra.length) return null;
    if (filter.districtId) {
      if (!this.districts || filter.departmentId) return null;
      return { type: 'district', regionCode: Number(filter.districtId.split('-')[0]), districtId: filter.districtId };
    }
    if (filter.departmentId) {
      if (!this.center || (filter.unit && filter.unit !== 'center')) return null;
      return { type: 'department', departmentId: filter.departmentId };
    }
    if (filter.unit && this.regions) return { type: 'unit', unit: filter.unit };
    return null;
  }

  /**
   * Qisqa muddatli xotira: bitta sahifa (Munosabatlar ro'yxati, Nazorat) ko'p moddani bir xil oylar bilan so'raydi —
   * Solishtirma hisobi (hamma hududlar birdaniga) har oy uchun bir marta hisoblanadi.
   */
  private memo = new Map<string, { at: number; value: Promise<unknown> }>();
  private cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.memo.get(key);
    if (hit && now - hit.at < 20_000) return hit.value as Promise<T>;
    if (this.memo.size > 400) for (const [k, v] of this.memo) if (now - v.at >= 20_000) this.memo.delete(k);
    const value = load();
    this.memo.set(key, { at: now, value });
    value.catch(() => this.memo.delete(key));
    return value;
  }

  /** Solishtirma bo'yicha [from, to] davr: daromad va xarajat (null — hisoblab bo'lmadi, oddiy yo'l ishlatiladi) */
  private async alignedPair(a: NonNullable<ReturnType<ReactionMetrics['alignedOf']>>, section: string | undefined, from: string, to: string): Promise<{ income: bigint; expense: bigint } | null> {
    const q = { from, to, section: section ?? 'ALL' };
    try {
      if (a.type === 'unit') {
        const r = await this.cached(`u|${q.from}|${q.to}|${q.section}`, () => this.regions!.compare(q));
        const u = r.units.find((x) => x.key === a.unit);
        return u ? { income: BigInt(u.incomeTiyin), expense: BigInt(u.expenseTiyin) } : { income: 0n, expense: 0n };
      }
      if (a.type === 'district') {
        const r = await this.cached(`d|${a.regionCode}|${q.from}|${q.to}|${q.section}`, () => this.districts!.regionDistricts(a.regionCode, q));
        const d = r.districts.find((x) => x.id === a.districtId);
        return d ? { income: BigInt(d.incomeTiyin), expense: BigInt(d.expenseTiyin) } : { income: 0n, expense: 0n };
      }
      const r = await this.cached(`c|${a.departmentId}|${q.from}|${q.to}|${q.section}`, () => this.center!.department(a.departmentId, q));
      return { income: BigInt(r.summary.incomeTiyin), expense: BigInt(r.summary.expenseTiyin) };
    } catch {
      return null;
    }
  }

  private pick(kind: ItemKind, p: { income: bigint; expense: bigint }): bigint {
    return kind === 'INCOME' ? p.income : kind === 'EXPENSE' ? p.expense : p.income - p.expense;
  }

  /** Xarajatlar siyosati: Markaz hisobidagi moddalar (Solishtirmada Markazga o'tadi) */
  private async centerCategories(): Promise<Set<string>> {
    try {
      return await loadCenterCategories(this.prisma);
    } catch {
      return new Set();
    }
  }

  // ─────────── Filtr → Prisma where ───────────

  /** null — bu tomonda mos yozuv bo'lishi mumkin emas (masalan, daromadda mashina) */
  private async baseWhere(side: Side, filter: ItemFilter): Promise<Record<string, unknown> | null> {
    const where: Record<string, unknown> = { deletedAt: null };
    const and: Record<string, unknown>[] = [];

    // Xarajatlar siyosati (Solishtirmadagidek): Markaz hisobidagi moddalar qayerga yozilgan bo'lsa ham — Markaz xarajati
    const policy = side === 'EXPENSE' && (filter.unit || filter.districtId) ? await this.centerCategories() : new Set<string>();
    const policyList = [...policy];
    if (filter.unit === 'center') {
      const own = { OR: [{ regionCode: 0 }, { regionCode: null, departmentId: { not: null } }] };
      and.push(policyList.length ? { OR: [own, { categoryCode: { in: policyList } }] } : own);
    } else if (filter.unit === 'none') {
      where.regionCode = null;
      where.departmentId = null;
    } else if (filter.unit?.startsWith('r:')) {
      where.regionCode = Number(filter.unit.slice(2));
    }
    if (policyList.length && filter.unit !== 'center' && (filter.unit || filter.districtId)) and.push({ categoryCode: { notIn: policyList } });
    if (filter.departmentId) where.departmentId = filter.departmentId;
    if (filter.section) where.section = filter.section;
    if (filter.source) where.source = filter.source;

    if (filter.categoryCode) {
      where.categoryCode = filter.categoryCode;
    } else if (filter.rootCategoryCode) {
      if (side === 'EXPENSE') {
        const children = await this.prisma.category.findMany({ where: { parentCode: filter.rootCategoryCode }, select: { code: true } });
        where.categoryCode = { in: [filter.rootCategoryCode, ...children.map((c) => c.code)] };
      } else {
        where.categoryCode = filter.rootCategoryCode;
      }
    }

    // Xodim — faqat "virtual" yozuvlar (ish haqi / natija), jadval qatorlari yo'q
    if (filter.employeePinfl) return null;

    if (filter.vehicleId) {
      if (side === 'INCOME') return null;
      const links = await this.prisma.vehicleRecord.findMany({
        where: { vehicleId: filter.vehicleId, expenseId: { not: null } },
        select: { expenseId: true },
      });
      and.push({ id: { in: links.map((l) => l.expenseId!).filter(Boolean) } });
    }

    if (filter.recordId) and.push({ id: filter.recordId });

    if (filter.counterparty) {
      if (side === 'INCOME') return null;
      where.counterparty = filter.counterparty;
    }
    if (filter.clientName) {
      if (side === 'EXPENSE') return null;
      where.clientName = filter.clientName;
    }

    if (filter.leaseId) {
      if (side === 'INCOME') return null;
      const accruals = await this.prisma.leaseAccrual.findMany({
        where: { leaseId: filter.leaseId, expenseId: { not: null } },
        select: { expenseId: true },
      });
      and.push({ id: { in: accruals.map((a) => a.expenseId!).filter(Boolean) } });
    }

    if (filter.districtId) {
      if (side === 'INCOME') {
        where.districtId = filter.districtId;
      } else {
        // Tumanga yozilgan xarajatlar + tumandagi ijara shartnomalari; ish haqi — alohida (virtual)
        const accruals = await this.prisma.leaseAccrual.findMany({
          where: { lease: { districtId: filter.districtId }, expenseId: { not: null } },
          select: { expenseId: true },
        });
        and.push({ OR: [{ districtId: filter.districtId }, { id: { in: accruals.map((a) => a.expenseId!).filter(Boolean) } }] });
        and.push({ source: { not: 'PAYROLL' } });
      }
    }

    if (and.length) where.AND = and;
    return where;
  }

  /**
   * Jadvalda alohida qator bo'lmagan qismlar: tuman xodimlari ish haqi, xodim ish haqi va natijasi.
   * Boshqa aniqlashtiruvchi filtr (modda, kontragent, mashina, yozuv…) bo'lsa — qo'shilmaydi.
   */
  private async virtualRows(side: Side, filter: ItemFilter, date: { gte: Date; lt: Date }): Promise<VirtualRow[]> {
    const narrowed = filter.categoryCode || filter.rootCategoryCode || filter.counterparty || filter.clientName || filter.leaseId || filter.vehicleId || filter.recordId;
    if (narrowed) return [];
    if (filter.employeePinfl) {
      return side === 'EXPENSE' ? employeeSalaryRows(this.prisma, filter.employeePinfl, date) : employeeResultRows(this.prisma, filter.employeePinfl, date);
    }
    if (filter.districtId && side === 'EXPENSE' && (!filter.source || filter.source === 'PAYROLL')) {
      return districtPayrollRows(this.prisma, filter.districtId, date, filter.section);
    }
    return [];
  }

  private sides(kind: ItemKind): Side[] {
    return kind === 'INCOME' ? ['INCOME'] : kind === 'EXPENSE' ? ['EXPENSE'] : ['INCOME', 'EXPENSE'];
  }

  private async sumSide(side: Side, filter: ItemFilter, date: { gte: Date; lt: Date }): Promise<bigint> {
    const base = await this.baseWhere(side, filter);
    let total = 0n;
    if (base) {
      const where = { ...base, date };
      const result =
        side === 'INCOME'
          ? await this.prisma.income.aggregate({ where: where as Prisma.IncomeWhereInput, _sum: { amountTiyin: true } })
          : await this.prisma.expense.aggregate({ where: where as Prisma.ExpenseWhereInput, _sum: { amountTiyin: true } });
      total += result._sum.amountTiyin ?? 0n;
    }
    for (const row of await this.virtualRows(side, filter, date)) total += row.amount;
    return total;
  }

  /** Sana oralig'idagi summa: [from, to] — ikkala kun ham to'liq kiradi */
  async sumDates(kind: ItemKind, filter: ItemFilter, from: string, to: string): Promise<bigint> {
    const aligned = this.alignedOf(filter);
    if (aligned) {
      const pair = await this.alignedPair(aligned, filter.section, from, to);
      if (pair) return this.pick(kind, pair);
    }
    const date = { gte: dayStart(from), lt: new Date(dayStart(to).getTime() + DAY_MS) };
    if (kind === 'RESULT') {
      const [inc, exp] = await Promise.all([this.sumSide('INCOME', filter, date), this.sumSide('EXPENSE', filter, date)]);
      return inc - exp;
    }
    return this.sumSide(kind, filter, date);
  }

  /**
   * Oylar bo'yicha qiymatlar (months tartibida, ketma-ket oylar).
   * Oy yozuv SANASI bo'yicha (Toshkent vaqti) — ro'yxatlar, hisobotlar va Katta modellar bilan bir xil.
   */
  async monthly(kind: ItemKind, filter: ItemFilter, months: string[]): Promise<bigint[]> {
    const result = months.map(() => 0n);
    if (!months.length) return result;
    const aligned = this.alignedOf(filter);
    if (aligned) {
      const today = todayIso();
      const values: bigint[] = [];
      let ok = true;
      for (const period of months) {
        const from = `${period}-01`;
        if (from > today) {
          values.push(0n);
          continue;
        }
        const last = `${period}-${String(daysInMonth(period)).padStart(2, '0')}`;
        const pair = await this.alignedPair(aligned, filter.section, from, last > today ? today : last);
        if (!pair) {
          ok = false;
          break;
        }
        values.push(this.pick(kind, pair));
      }
      if (ok) return values;
    }
    const index = new Map(months.map((p, i) => [p, i]));
    const sorted = [...months].sort();
    const [fy, fm] = sorted[0]!.split('-').map(Number) as [number, number];
    const [ly, lm] = sorted[sorted.length - 1]!.split('-').map(Number) as [number, number];
    const date = { gte: new Date(Date.UTC(fy, fm - 1, 1) - TASHKENT_MS), lt: new Date(Date.UTC(ly, lm, 1) - TASHKENT_MS) };
    for (const side of this.sides(kind)) {
      const sign = kind === 'RESULT' && side === 'EXPENSE' ? -1n : 1n;
      const base = await this.baseWhere(side, filter);
      if (base) {
        const where = { ...base, date };
        // Kunlar bo'yicha yig'ib, oyga Toshkent vaqtida ajratamiz
        const rows =
          side === 'INCOME'
            ? await this.prisma.income.groupBy({ by: ['date'], where: where as Prisma.IncomeWhereInput, _sum: { amountTiyin: true } })
            : await this.prisma.expense.groupBy({ by: ['date'], where: where as Prisma.ExpenseWhereInput, _sum: { amountTiyin: true } });
        for (const row of rows) {
          const i = index.get(isoOf(row.date).slice(0, 7));
          if (i !== undefined) result[i]! += sign * (row._sum.amountTiyin ?? 0n);
        }
      }
      for (const row of await this.virtualRows(side, filter, date)) {
        const i = index.get(isoOf(row.date).slice(0, 7));
        if (i !== undefined) result[i]! += sign * row.amount;
      }
    }
    return result;
  }

  /** Davrdagi eng katta yozuvlar */
  async topRecords(kind: ItemKind, filter: ItemFilter, from: string, to: string, limit = 8): Promise<TopRecord[]> {
    const date = { gte: dayStart(from), lt: new Date(dayStart(to).getTime() + DAY_MS) };
    const [regions, departments] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
    ]);
    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const departmentName = new Map(departments.map((d) => [d.id, d.name]));
    const place = (regionCode: number | null, departmentId: string | null) =>
      departmentId ? (departmentName.get(departmentId) ?? "Bo'lim") : regionCode !== null ? (regionName.get(regionCode) ?? `Hudud ${regionCode}`) : 'Umumkorxona';
    const clean = (text: string | null) => (text ?? '').replace(/^\[DEMO\]\s*/, '').trim();

    const records: TopRecord[] = [];
    // Natija uchun — xarajatlar (muammo odatda xarajatda)
    const sides: Side[] = kind === 'INCOME' ? ['INCOME'] : ['EXPENSE'];
    for (const side of sides) {
      for (const v of await this.virtualRows(side, filter, date)) {
        records.push({ id: v.id, date: isoOf(v.date), kind: side, label: v.label, place: v.place, amountTiyin: v.amount.toString() });
      }
      const base = await this.baseWhere(side, filter);
      if (!base) continue;
      const where = { ...base, date };
      if (side === 'INCOME') {
        const rows = await this.prisma.income.findMany({
          where: where as Prisma.IncomeWhereInput,
          orderBy: { amountTiyin: 'desc' },
          take: limit,
          select: { id: true, date: true, amountTiyin: true, description: true, clientName: true, regionCode: true, departmentId: true, category: { select: { label: true } } },
        });
        for (const r of rows) {
          records.push({ id: r.id, date: isoOf(r.date), kind: 'INCOME', label: clean(r.description) || r.clientName || r.category.label, place: place(r.regionCode, r.departmentId), amountTiyin: r.amountTiyin.toString() });
        }
      } else {
        const rows = await this.prisma.expense.findMany({
          where: where as Prisma.ExpenseWhereInput,
          orderBy: { amountTiyin: 'desc' },
          take: limit,
          select: { id: true, date: true, amountTiyin: true, description: true, counterparty: true, regionCode: true, departmentId: true, category: { select: { label: true } } },
        });
        for (const r of rows) {
          records.push({ id: r.id, date: isoOf(r.date), kind: 'EXPENSE', label: clean(r.description) || r.counterparty || r.category.label, place: place(r.regionCode, r.departmentId), amountTiyin: r.amountTiyin.toString() });
        }
      }
    }
    return records.sort((a, b) => Number(BigInt(b.amountTiyin) - BigInt(a.amountTiyin))).slice(0, limit);
  }
}