import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Doimiy / Boshqa — xarajat va daromadning ikki bo'limi
// ═══════════════════════════════════════════════════════════

export type SectionKind = 'expense' | 'income';
export type SectionValue = 'DOIMIY' | 'BOSHQA';

export const SECTIONS: SectionValue[] = ['DOIMIY', 'BOSHQA'];

/** Bo'lim ichidagi qism: Ro'yxat, Ish haqi, Ijara, Hududlar tushumi */
export interface SectionPart {
  key: string;
  label: string;
  sumTiyin: string;
  count: number;
  /** Moduldan avtomatik yoziladi — boshqa bo'limga o'tkazilmaydi */
  locked: boolean;
}

export interface SectionSummary {
  section: SectionValue;
  sumTiyin: string;
  count: number;
  /** Jami summadagi ulushi, % */
  sharePercent: number;
  previousTiyin: string;
  previousChange: number | null;
  lastYearTiyin: string;
  lastYearChange: number | null;

  unpaidTiyin: string;
  unpaidCount: number;
  parts: SectionPart[];
}

export interface SectionOverview {
  kind: SectionKind;
  period: string;
  previousPeriod: string;
  lastYearPeriod: string;
  totalTiyin: string;
  sections: SectionSummary[];
}

export interface SectionTrendPoint {
  period: string;
  doimiyTiyin: string;
  boshqaTiyin: string;
}

export interface MoveResult {
  section: SectionValue;
  moved: number;
  /** Allaqachon shu bo'limda */
  unchanged: number;
  /** Ish haqi, ijara, hududlar tushumi — o'tkazilmaydi */
  locked: number;
  /** Topilmadi yoki o'chirilgan */
  missing: number;
}

const PART_LABELS: Record<string, string> = {

  LIST: "Ro'yxat",
  PAYROLL: 'Ish haqi',
  LEASE: 'Ijara',
  VEHICLE: 'Mashinalar',
  WAREHOUSE: 'Ombor',
  ASSET: 'Asosiy vositalar sarfi',
  TAX: 'Soliqlar',
  REGIONAL: 'Hududlar tushumi',
};

/** Qismlar tartibi — bo'lim kartasida shu tartibda chiqadi */
const PART_ORDER = ['PAYROLL', 'LEASE', 'VEHICLE', 'WAREHOUSE', 'ASSET', 'TAX', 'REGIONAL', 'LIST'];

interface Row {
  section: SectionValue;
  partKey: string;
  sum: bigint;
  count: number;
}


const TASHKENT_MS = 5 * 3600_000;
@Injectable()
export class SectionsService {
  constructor(private readonly prisma: PrismaService) {}

  // ═══════════ Yordamchilar ═══════════

  assertKind(kind: string): SectionKind {
    if (kind !== 'expense' && kind !== 'income') {
      throw new BadRequestException("Tur noto'g'ri: expense yoki income");
    }
    return kind;
  }

  assertSection(section: unknown): SectionValue {
    if (section !== 'DOIMIY' && section !== 'BOSHQA') {
      throw new BadRequestException("Bo'lim noto'g'ri: DOIMIY yoki BOSHQA");

    }
    return section;
  }

  private assertPeriod(period: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) {
      throw new BadRequestException("Davr noto'g'ri (YYYY-MM)");
    }
  }

  /** Oy chegaralari (Toshkent vaqti): yozuvlar oyga SANASI bo'yicha tushadi — ro'yxatlar bilan bir xil */
  private monthDates(from: string, to = from): { gte: Date; lt: Date } {
    const [fy, fm] = from.split('-').map(Number) as [number, number];
    const [ty, tm] = to.split('-').map(Number) as [number, number];
    return { gte: new Date(Date.UTC(fy, fm - 1, 1) - TASHKENT_MS), lt: new Date(Date.UTC(ty, tm, 1) - TASHKENT_MS) };
  }

  private shift(period: string, delta: number): string {
    const [y, m] = period.split('-').map(Number) as [number, number];
    const index = y * 12 + (m - 1) + delta;
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
  }

  private change(current: bigint, base: bigint): number | null {
    if (base === 0n) return null;
    return Math.round((Number(current - base) / Number(base)) * 1000) / 10;
  }

  /** Xarajat: qaysi yozuvlar qulflangan (moduldan yoziladi) */
  private expensePart(source: string): string {
    if (source === 'PAYROLL') return 'PAYROLL';
    if (source === 'LEASE') return 'LEASE';
    if (source === 'VEHICLE') return 'VEHICLE';
    if (source === 'WAREHOUSE') return 'WAREHOUSE';
    if (source === 'ASSET') return 'ASSET';
    if (source === 'TAX') return 'TAX';
    return 'LIST';
  }

  /** Daromad: hududlar tushumi (Excel'dan hudud bo'yicha) qulflangan */
  private incomePart(source: string, regionCode: number | null): string {
    return source === 'IMPORT' && regionCode !== null ? 'REGIONAL' : 'LIST';
  }


  /** Bir oy uchun bo'lim × qism yig'indilari */
  private async rows(kind: SectionKind, period: string): Promise<Row[]> {
    if (kind === 'expense') {
      const groups = await this.prisma.expense.groupBy({
        by: ['section', 'source'],
        where: { deletedAt: null, date: this.monthDates(period) },
        _sum: { amountTiyin: true },
        _count: { _all: true },
      });
      return groups.map((g) => ({
        section: g.section as SectionValue,
        partKey: this.expensePart(g.source),
        sum: g._sum.amountTiyin ?? 0n,
        count: g._count._all,
      }));
    }

    const groups = await this.prisma.income.groupBy({
      by: ['section', 'source', 'regionCode'],
      where: { deletedAt: null, date: this.monthDates(period) },
      _sum: { amountTiyin: true },
      _count: { _all: true },
    });
    return groups.map((g) => ({
      section: g.section as SectionValue,
      partKey: this.incomePart(g.source, g.regionCode),
      sum: g._sum.amountTiyin ?? 0n,
      count: g._count._all,
    }));
  }


  private async unpaid(kind: SectionKind, period: string) {
    const where = {
      deletedAt: null,
      date: this.monthDates(period),
      paymentStatus: { in: ['UNPAID' as const, 'PARTIAL' as const] },
    };
    const groups =
      kind === 'expense'
        ? await this.prisma.expense.groupBy({
            by: ['section'],
            where,
            _sum: { amountTiyin: true },
            _count: { _all: true },
          })
        : await this.prisma.income.groupBy({
            by: ['section'],
            where,
            _sum: { amountTiyin: true },
            _count: { _all: true },
          });
    return new Map(
      groups.map((g) => [g.section as SectionValue, { sum: g._sum.amountTiyin ?? 0n, count: g._count._all }]),
    );
  }

  private sumOf(rows: Row[], section: SectionValue): bigint {
    return rows.filter((r) => r.section === section).reduce((sum, r) => sum + r.sum, 0n);
  }

  // ═══════════ Umumiy ko'rinish ═══════════

  /** Ikki katta karta uchun: har bo'lim summasi, taqqoslash va qismlari */

  async overview(kindInput: string, period: string): Promise<SectionOverview> {
    const kind = this.assertKind(kindInput);
    this.assertPeriod(period);

    const previousPeriod = this.shift(period, -1);
    const lastYearPeriod = this.shift(period, -12);

    const [current, previous, lastYear, unpaid] = await Promise.all([
      this.rows(kind, period),
      this.rows(kind, previousPeriod),
      this.rows(kind, lastYearPeriod),
      this.unpaid(kind, period),
    ]);

    const total = current.reduce((sum, r) => sum + r.sum, 0n);

    const sections: SectionSummary[] = SECTIONS.map((section) => {
      const sum = this.sumOf(current, section);
      const prev = this.sumOf(previous, section);
      const year = this.sumOf(lastYear, section);

      // Qismlar: DOIMIY — modul qismlari har doim ko'rinadi; BOSHQA — faqat Ro'yxat
      const keys =
        section === 'DOIMIY'
          ? kind === 'expense'
            ? ['PAYROLL', 'LEASE', 'VEHICLE', 'LIST']
            : ['REGIONAL', 'LIST']
          : ['LIST'];
      for (const row of current) {
        if (row.section === section && !keys.includes(row.partKey)) keys.push(row.partKey);
      }


      const parts: SectionPart[] = keys
        .sort((a, b) => PART_ORDER.indexOf(a) - PART_ORDER.indexOf(b))
        .map((key) => {
          const matching = current.filter((r) => r.section === section && r.partKey === key);
          return {
            key,
            label: PART_LABELS[key] ?? key,
            sumTiyin: matching.reduce((s, r) => s + r.sum, 0n).toString(),
            count: matching.reduce((s, r) => s + r.count, 0),
            locked: key !== 'LIST',
          };
        });

      const unpaidRow = unpaid.get(section);
      return {
        section,
        sumTiyin: sum.toString(),
        count: current.filter((r) => r.section === section).reduce((s, r) => s + r.count, 0),
        sharePercent: total > 0n ? Math.round((Number(sum) / Number(total)) * 1000) / 10 : 0,
        previousTiyin: prev.toString(),
        previousChange: this.change(sum, prev),
        lastYearTiyin: year.toString(),
        lastYearChange: this.change(sum, year),
        unpaidTiyin: (unpaidRow?.sum ?? 0n).toString(),
        unpaidCount: unpaidRow?.count ?? 0,
        parts,
      };
    });

    return {
      kind,
      period,

      previousPeriod,
      lastYearPeriod,
      totalTiyin: total.toString(),
      sections,
    };
  }

  /** Oylar bo'yicha Doimiy va Boshqa — Tahlil va Bosh sahifa uchun */
  async trend(kindInput: string, from: string, to: string): Promise<SectionTrendPoint[]> {
    const kind = this.assertKind(kindInput);
    this.assertPeriod(from);
    this.assertPeriod(to);
    if (from > to) throw new BadRequestException('Boshlanish oyi tugashdan keyin');

    const periods: string[] = [];
    for (let p = from; p <= to && periods.length < 120; p = this.shift(p, 1)) periods.push(p);

    // Kunlar bo'yicha yig'ib, oyga yozuv sanasi (Toshkent vaqti) bo'yicha ajratiladi
    const where = { deletedAt: null, date: this.monthDates(from, to) };
    const groups =
      kind === 'expense'
        ? await this.prisma.expense.groupBy({ by: ['date', 'section'], where, _sum: { amountTiyin: true } })
        : await this.prisma.income.groupBy({ by: ['date', 'section'], where, _sum: { amountTiyin: true } });

    const map = new Map<string, { DOIMIY: bigint; BOSHQA: bigint }>();
    for (const g of groups) {
      const month = new Date(g.date.getTime() + TASHKENT_MS).toISOString().slice(0, 7);
      const entry = map.get(month) ?? { DOIMIY: 0n, BOSHQA: 0n };
      entry[g.section as SectionValue] += g._sum.amountTiyin ?? 0n;
      map.set(month, entry);
    }

    return periods.map((period) => {
      const entry = map.get(period);

      return {
        period,
        doimiyTiyin: (entry?.DOIMIY ?? 0n).toString(),
        boshqaTiyin: (entry?.BOSHQA ?? 0n).toString(),
      };
    });
  }

  // ═══════════ O'tkazish ═══════════

  /** Tanlangan yozuvlarni boshqa bo'limga o'tkazish (qulflanganlar o'tkazilmaydi) */
  async move(kindInput: string, idsInput: unknown, sectionInput: unknown): Promise<MoveResult> {
    const kind = this.assertKind(kindInput);
    const section = this.assertSection(sectionInput);

    if (!Array.isArray(idsInput) || idsInput.length === 0) {
      throw new BadRequestException('Yozuv tanlanmagan');
    }
    const ids = [...new Set(idsInput.map(String))];
    if (ids.length > 5000) throw new BadRequestException("Bir martada 5000 tadan ko'p emas");

    let movable: string[] = [];
    let unchanged = 0;
    let locked = 0;
    let found = 0;

    if (kind === 'expense') {
      const rows = await this.prisma.expense.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, source: true, section: true },
      });
      found = rows.length;

      for (const row of rows) {
        if (this.expensePart(row.source) !== 'LIST') locked += 1;
        else if (row.section === section) unchanged += 1;
        else movable.push(row.id);
      }
      if (movable.length > 0) {
        await this.prisma.expense.updateMany({ where: { id: { in: movable } }, data: { section } });
      }
    } else {
      const rows = await this.prisma.income.findMany({
        where: { id: { in: ids }, deletedAt: null },
        select: { id: true, source: true, regionCode: true, section: true },
      });
      found = rows.length;
      for (const row of rows) {
        if (this.incomePart(row.source, row.regionCode) !== 'LIST') locked += 1;
        else if (row.section === section) unchanged += 1;
        else movable.push(row.id);
      }
      if (movable.length > 0) {
        await this.prisma.income.updateMany({ where: { id: { in: movable } }, data: { section } });
      }
    }

    return {
      section,
      moved: movable.length,
      unchanged,
      locked,
      missing: ids.length - found,
    };
  }

}