import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ═══════════════════════════════════════════════════════════
// Turlar
// ═══════════════════════════════════════════════════════════

/** Xodimning bir oydagi joyi */
export interface Place {
  regionCode: number;
  regionName: string;
  districtId: string | null;
  districtName: string | null;
  employmentType: string;
}

/**
 * O'tkazma turi:
 * region — boshqa hududga, district — shu hudud ichida boshqa tumanga,
 * type — shtat ↔ shartnoma
 */
export type TransferKind = 'region' | 'district' | 'type';

export interface Transfer {
  pinfl: string;
  fullName: string;
  /** Yangi joyda ishlay boshlagan oy */
  period: string;
  /** Eski joyda oxirgi ma'lum oy */
  previousPeriod: string;
  kinds: TransferKind[];
  from: Place;
  to: Place;
}

export interface RegionMovement {
  regionCode: number;
  regionName: string;
  /** Boshqa hududdan kelganlar */
  arrived: number;
  /** Boshqa hududga ketganlar */
  left: number;
  net: number;
}

export interface TransferList {
  from: string | null;
  to: string | null;
  total: number;
  transfers: Transfer[];
  regions: RegionMovement[];
}

export interface EmployeeTimeline {
  employee: { pinfl: string; fullName: string; isActive: boolean; current: Place | null };
  /** Oylar bo'yicha joy (Natijalar faylidan) */
  months: (Place & { period: string })[];
  transfers: Transfer[];
}

// ═══════════════════════════════════════════════════════════
// Servis
// ═══════════════════════════════════════════════════════════

/**
 * Xodim o'tkazmalari — Natijalar faylidan yozilgan oylik joylashuvdan
 * (EmployeeLocation) avtomatik aniqlanadi: ketma-ket ikki ma'lum oyda
 * hudud, tuman yoki ish turi farq qilsa — o'tkazma.
 */
@Injectable()
export class EmployeeTransfersService {
  constructor(private readonly prisma: PrismaService) {}

  private assertPeriod(value: string | undefined, label: string): void {
    if (value && !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      throw new BadRequestException(`${label} noto'g'ri formatda (YYYY-MM)`);
    }
  }

  private async lookups() {
    const [regions, districts] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true, name: true } }),
      this.prisma.district.findMany({ select: { id: true, name: true } }),
    ]);
    return {
      regionNames: new Map(regions.map((r) => [r.code, r.name])),
      districtNames: new Map(districts.map((d) => [d.id, d.name])),
    };
  }

  private place(
    row: { regionCode: number; districtId: string | null; employmentType: string | null },
    lookups: { regionNames: Map<number, string>; districtNames: Map<string, string> },
  ): Place {
    return {
      regionCode: row.regionCode,
      regionName: lookups.regionNames.get(row.regionCode) ?? `Hudud ${row.regionCode}`,
      districtId: row.districtId,
      districtName: row.districtId ? (lookups.districtNames.get(row.districtId) ?? row.districtId) : null,
      employmentType: String(row.employmentType ?? 'SHTAT'),
    };
  }

  private kindsBetween(a: Place, b: Place): TransferKind[] {
    const kinds: TransferKind[] = [];
    if (a.regionCode !== b.regionCode) kinds.push('region');
    else if ((a.districtId ?? '') !== (b.districtId ?? '')) kinds.push('district');
    if (a.employmentType !== b.employmentType) kinds.push('type');
    return kinds;
  }

  /** Oylik joylar ro'yxatidan o'tkazmalarni ajratadi (oylar o'sish tartibida) */
  private detect(
    pinfl: string,
    fullName: string,
    months: (Place & { period: string })[],
  ): Transfer[] {
    const result: Transfer[] = [];
    for (let i = 1; i < months.length; i++) {
      const prev = months[i - 1];
      const curr = months[i];
      if (!prev || !curr) continue;

      const kinds = this.kindsBetween(prev, curr);
      if (kinds.length === 0) continue;

      const { period: _p, ...from } = prev;
      const { period: _c, ...to } = curr;
      result.push({
        pinfl,
        fullName,
        period: curr.period,
        previousPeriod: prev.period,
        kinds,
        from,
        to,
      });
    }
    return result;
  }

  /** Barcha xodimlarning o'tkazmalari (from/to — o'tkazma oyi bo'yicha filtr) */
  async list(options: { from?: string; to?: string; regionCode?: number; pinfl?: string }): Promise<TransferList> {
    this.assertPeriod(options.from, 'Boshlanish oyi');
    this.assertPeriod(options.to, 'Tugash oyi');

    const [locations, lookups] = await Promise.all([
      this.prisma.employeeLocation.findMany({
        where: options.pinfl ? { employeePinfl: options.pinfl } : undefined,
        select: {
          employeePinfl: true,
          period: true,
          regionCode: true,
          districtId: true,
          employmentType: true,
        },
        orderBy: [{ employeePinfl: 'asc' }, { period: 'asc' }],
      }),
      this.lookups(),
    ]);

    // Xodim bo'yicha guruhlaymiz
    const byEmployee = new Map<string, (Place & { period: string })[]>();
    for (const row of locations) {
      const list = byEmployee.get(row.employeePinfl) ?? [];
      list.push({ period: row.period, ...this.place(row, lookups) });
      byEmployee.set(row.employeePinfl, list);
    }

    // Faqat bir necha oy ma'lumoti borlarida o'tkazma bo'lishi mumkin
    const candidates = [...byEmployee.entries()].filter(([, months]) => months.length > 1);
    const employees = candidates.length
      ? await this.prisma.employee.findMany({
          where: { pinfl: { in: candidates.map(([pinfl]) => pinfl) } },
          select: { pinfl: true, fullName: true },
        })
      : [];
    const names = new Map(employees.map((e) => [e.pinfl, e.fullName]));

    let transfers: Transfer[] = candidates.flatMap(([pinfl, months]) =>
      this.detect(pinfl, names.get(pinfl) ?? '—', months),
    );

    if (options.from) transfers = transfers.filter((t) => t.period >= (options.from as string));
    if (options.to) transfers = transfers.filter((t) => t.period <= (options.to as string));
    if (options.regionCode !== undefined) {
      const code = options.regionCode;
      transfers = transfers.filter((t) => t.from.regionCode === code || t.to.regionCode === code);
    }

    transfers.sort((a, b) =>
      a.period === b.period ? a.fullName.localeCompare(b.fullName) : b.period.localeCompare(a.period),
    );

    // Hududlar bo'yicha harakat (faqat hududlararo o'tkazmalar)
    const movement = new Map<number, RegionMovement>();
    const touch = (code: number, name: string): RegionMovement => {
      const current = movement.get(code) ?? { regionCode: code, regionName: name, arrived: 0, left: 0, net: 0 };
      movement.set(code, current);
      return current;
    };
    for (const transfer of transfers) {
      if (!transfer.kinds.includes('region')) continue;
      touch(transfer.from.regionCode, transfer.from.regionName).left += 1;
      touch(transfer.to.regionCode, transfer.to.regionName).arrived += 1;
    }
    const regions = [...movement.values()]
      .map((r) => ({ ...r, net: r.arrived - r.left }))
      .sort((a, b) => b.arrived + b.left - (a.arrived + a.left));

    return {
      from: options.from ?? null,
      to: options.to ?? null,
      total: transfers.length,
      transfers,
      regions,
    };
  }

  /** Har bir xodimning eng oxirgi o'tkazmasi — Xodimlar ro'yxatidagi belgi uchun */
  async latest(): Promise<Record<string, Transfer>> {
    const { transfers } = await this.list({});
    const result: Record<string, Transfer> = {};
    for (const transfer of transfers) {
      const existing = result[transfer.pinfl];
      if (!existing || transfer.period > existing.period) result[transfer.pinfl] = transfer;
    }
    return result;
  }

  /** Bitta xodimning oylar bo'yicha joylashuvi va o'tkazmalari */
  async timeline(pinfl: string): Promise<EmployeeTimeline> {
    if (!/^\d{14}$/.test(pinfl ?? '')) throw new BadRequestException('PINFL noto\'g\'ri');

    const [employee, locations, lookups] = await Promise.all([
      this.prisma.employee.findUnique({
        where: { pinfl },
        select: {
          pinfl: true,
          fullName: true,
          isActive: true,
          regionCode: true,
          districtId: true,
          employmentType: true,
        },
      }),
      this.prisma.employeeLocation.findMany({
        where: { employeePinfl: pinfl },
        select: { period: true, regionCode: true, districtId: true, employmentType: true },
        orderBy: { period: 'asc' },
      }),
      this.lookups(),
    ]);

    if (!employee) throw new NotFoundException('Xodim topilmadi');

    const months = locations.map((row) => ({ period: row.period, ...this.place(row, lookups) }));

    return {
      employee: {
        pinfl: employee.pinfl,
        fullName: employee.fullName,
        isActive: employee.isActive,
        current: this.place(
          {
            regionCode: employee.regionCode,
            districtId: employee.districtId,
            employmentType: String(employee.employmentType),
          },
          lookups,
        ),
      },
      months,
      transfers: this.detect(employee.pinfl, employee.fullName, months).reverse(),
    };
  }
}
