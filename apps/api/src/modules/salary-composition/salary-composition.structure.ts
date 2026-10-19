import { BadRequestException, Injectable } from '@nestjs/common';
import type { SalaryComponentCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CATEGORY_LABELS, CATEGORY_ORDER, CENTRAL_REGION } from './salary-composition.constants';

// ═══════════════════════════════════════════════════════════
// Turlar
// ═══════════════════════════════════════════════════════════

/** Guruh → summa (tiyin, belgisi bilan; jarima manfiy) */
export type CategoryAmounts = Record<SalaryComponentCategory, string>;

export type UnitKind = 'department' | 'region' | 'contract';

export interface StructurePeriod {
  period: string;
  /** Rasmiy summa — soliq hisobotidan */
  payrollTiyin: string;
  /** Tarkibda taqsimlangan qism */
  compositionTiyin: string;
  /** Soliq − tarkib: tarkibi yuklanmagan yoki farq */
  unallocatedTiyin: string;
  byCategory: CategoryAmounts;
  payrollUploaded: boolean;
  compositionUploaded: boolean;
}

export interface StructureCategory {
  category: SalaryComponentCategory;
  label: string;
  totalTiyin: string;
  /** Tarkib yuklangan oylardagi rasmiy ish haqidagi ulushi, % */
  sharePercent: number | null;
}

export interface StructureComponent {
  code: string;
  name: string;
  category: SalaryComponentCategory;
  sign: number;
  totalTiyin: string;
  employees: number;
}

export interface StructureUnit {
  key: string;
  label: string;
  kind: UnitKind;
  employees: number;
  payrollTiyin: string;
  compositionTiyin: string;
  unallocatedTiyin: string;
  byCategory: CategoryAmounts;
  /** Tarkib yuklangan oylardagi rasmiy ish haqi — ulushlar shunga nisbatan */
  coveredPayrollTiyin: string;
  /** Premiyaning ish haqidagi ulushi (tarkib yuklangan oylar), % */
  bonusSharePercent: number | null;
}

export interface StructurePerson {
  pinfl: string;
  fullName: string;
  unitName: string;
  amountTiyin: string;
  /** Xodim rasmiy ish haqidagi ulushi, % */
  sharePercent: number | null;
  /** Ulush maxraji: xodimning ish haqi (faqat tarkib yuklangan oylarda, qaydnoma bo'yicha) */
  payrollTiyin: string;
  /** Summa oylar bo'yicha (yig'indi ishlanishi uchun) */
  months: { period: string; amountTiyin: string }[];
}

export interface SalaryStructure {
  from: string;
  to: string;
  periods: StructurePeriod[];
  totals: {
    payrollTiyin: string;
    compositionTiyin: string;
    unallocatedTiyin: string;
    /** Tarkib bilan qoplangan qism, % */
    coveragePercent: number | null;
    /** Tarkib yuklangan oylar soni */
    coveredPeriods: number;
    /** Tarkib yuklangan oylardagi rasmiy ish haqi */
    coveredPayrollTiyin: string;
    byCategory: StructureCategory[];
  };
  byComponent: StructureComponent[];
  units: StructureUnit[];
  topBonus: StructurePerson[];
  topPenalty: StructurePerson[];
}

// ─────────── Ichki ───────────

interface UnitInfo {
  key: string;
  label: string;
  kind: UnitKind;
}

type Sums = Record<SalaryComponentCategory, bigint>;

function emptySums(): Sums {
  return {
    ASOSIY: 0n,
    TATIL: 0n,
    PREMIYA: 0n,
    KOMPENSATSIYA: 0n,
    USTAMA: 0n,
    JARIMA: 0n,
    BOSHQA: 0n,
  };
}

function sumsToStrings(sums: Sums): CategoryAmounts {
  const result = {} as CategoryAmounts;
  for (const category of CATEGORY_ORDER) result[category] = sums[category].toString();
  return result;
}

function totalOf(sums: Sums): bigint {
  return CATEGORY_ORDER.reduce((sum, category) => sum + sums[category], 0n);
}

function percent(part: bigint, total: bigint): number | null {
  if (total === 0n) return null;
  return Math.round((Number(part) / Number(total)) * 10000) / 100;
}

const MAX_MONTHS = 36;

// ═══════════════════════════════════════════════════════════
// Servis
// ═══════════════════════════════════════════════════════════

/**
 * Ish haqi tuzilmasi — rasmiy summa (soliq hisoboti) tarkib guruhlariga bo'linadi.
 * Xarajat yozuvlari o'zgarmaydi: bu faqat tahlil ko'rinishi.
 * Soliq − tarkib farqi "tarkibi yuklanmagan" bo'lib qoladi, shuning uchun
 * jami har doim rasmiy summaga teng.
 */
@Injectable()
export class SalaryStructureService {
  constructor(private readonly prisma: PrismaService) {}

  private assertPeriod(period: string, label: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) {
      throw new BadRequestException(`${label} noto'g'ri formatda (YYYY-MM)`);
    }
  }

  /** "2026-01".."2026-08" oralig'idagi barcha oylar */
  private periodsBetween(from: string, to: string): string[] {
    const result: string[] = [];
    let year = Number(from.slice(0, 4));
    let month = Number(from.slice(5, 7));
    const endYear = Number(to.slice(0, 4));
    const endMonth = Number(to.slice(5, 7));

    while (year < endYear || (year === endYear && month <= endMonth)) {
      result.push(`${year}-${String(month).padStart(2, '0')}`);
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      if (result.length > MAX_MONTHS) {
        throw new BadRequestException(`Oraliq ${MAX_MONTHS} oydan oshmasin`);
      }
    }
    return result;
  }

  async structure(from: string, to: string): Promise<SalaryStructure> {
    this.assertPeriod(from, 'Boshlanish oyi');
    this.assertPeriod(to, 'Tugash oyi');
    if (from > to) throw new BadRequestException('Boshlanish oyi tugash oyidan keyin bo\'lmasin');

    const periods = this.periodsBetween(from, to);
    const range = { gte: from, lte: to };

    // ─── Ma'lumotlarni yig'amiz ───
    const [payrollGroups, payrollBatches, batches, components] = await Promise.all([
      this.prisma.payrollEntry.groupBy({
        by: ['period', 'employeePinfl'],
        where: { period: range, deletedAt: null, batch: { status: 'COMMITTED' } },
        _sum: { baseTiyin: true },
      }),
      this.prisma.payrollBatch.findMany({
        where: { period: range, status: 'COMMITTED' },
        select: { period: true },
        distinct: ['period'],
      }),
      this.prisma.salaryCompositionBatch.findMany({
        where: { period: range, cancelledAt: null },
        select: { id: true, period: true },
      }),
      this.prisma.salaryComponent.findMany(),
    ]);

    const batchIds = batches.map((b) => b.id);
    const rows = batchIds.length
      ? await this.prisma.salaryCompositionRow.findMany({
          where: { batchId: { in: batchIds } },
          select: {
            period: true,
            employeePinfl: true,
            fullName: true,
            items: { select: { componentCode: true, amountTiyin: true } },
          },
        })
      : [];

    const pinfls = [
      ...new Set([...payrollGroups.map((g) => g.employeePinfl), ...rows.map((r) => r.employeePinfl)]),
    ];

    const [employees, locations, regions] = await Promise.all([
      pinfls.length
        ? this.prisma.employee.findMany({
            where: { pinfl: { in: pinfls } },
            select: {
              pinfl: true,
              fullName: true,
              regionCode: true,
              employmentType: true,
              departmentId: true,
              department: { select: { name: true } },
              region: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      pinfls.length
        ? this.prisma.employeeLocation.findMany({
            where: { employeePinfl: { in: pinfls }, period: range },
            select: { employeePinfl: true, period: true, regionCode: true, employmentType: true },
          })
        : Promise.resolve([]),
      this.prisma.region.findMany({ select: { code: true, name: true } }),
    ]);

    const employeeMap = new Map(employees.map((e) => [e.pinfl, e]));
    const locationMap = new Map(locations.map((l) => [`${l.employeePinfl}|${l.period}`, l]));
    const regionNames = new Map(regions.map((r) => [r.code, r.name]));
    const componentMap = new Map(components.map((c) => [c.code, c]));

    /** Xodim shu oyda qaysi bo'lim / hududga tegishli — ish haqi guruhlash qoidasi bilan bir xil */
    const unitOf = (pinfl: string, period: string): UnitInfo => {
      const emp = employeeMap.get(pinfl);
      const loc = locationMap.get(`${pinfl}|${period}`);

      const type = String(loc?.employmentType ?? emp?.employmentType ?? 'SHTAT');
      if (type === 'SHARTNOMA') {
        return { key: 'shartnoma', label: 'Shartnoma asosida', kind: 'contract' };
      }

      const regionCode = loc?.regionCode ?? emp?.regionCode ?? null;

      if (regionCode === CENTRAL_REGION) {
        const departmentId = emp?.departmentId ?? 'none';
        return {
          key: `markaz-${departmentId}`,
          label: emp?.department?.name ?? 'Markaz (bo\'limsiz)',
          kind: 'department',
        };
      }

      if (regionCode === null) {
        return { key: 'unknown', label: 'Reestrda yo\'q', kind: 'region' };
      }

      return {
        key: `region-${regionCode}`,
        label: regionNames.get(regionCode) ?? `Hudud ${regionCode}`,
        kind: 'region',
      };
    };

    const uploadedPayroll = new Set(payrollBatches.map((b) => b.period));
    const uploadedComposition = new Set(batches.map((b) => b.period));

    // ─── Oylar va bo'limlar bo'yicha yig'indilar ───
    const periodPayroll = new Map<string, bigint>();
    const periodSums = new Map<string, Sums>();

    interface UnitAcc {
      info: UnitInfo;
      employees: Set<string>;
      payroll: bigint;
      coveredPayroll: bigint;
      sums: Sums;
    }
    const units = new Map<string, UnitAcc>();
    const unitAcc = (info: UnitInfo): UnitAcc => {
      let acc = units.get(info.key);
      if (!acc) {
        acc = { info, employees: new Set(), payroll: 0n, coveredPayroll: 0n, sums: emptySums() };
        units.set(info.key, acc);
      }
      return acc;
    };

    for (const group of payrollGroups) {
      const amount = group._sum.baseTiyin ?? 0n;
      periodPayroll.set(group.period, (periodPayroll.get(group.period) ?? 0n) + amount);

      const acc = unitAcc(unitOf(group.employeePinfl, group.period));
      acc.payroll += amount;
      if (uploadedComposition.has(group.period)) acc.coveredPayroll += amount;
      acc.employees.add(group.employeePinfl);
    }

    const componentTotals = new Map<string, { total: bigint; employees: Set<string> }>();
    const personBonus = new Map<string, bigint>();
    const personPenalty = new Map<string, bigint>();
    // Xodim × oy: premiya va jarima (hisob-kitobda oylar bo'yicha yig'indi)
    const personBonusMonths = new Map<string, Map<string, bigint>>();
    const personPenaltyMonths = new Map<string, Map<string, bigint>>();
    const addMonth = (store: Map<string, Map<string, bigint>>, pinfl: string, period: string, amount: bigint) => {
      const m = store.get(pinfl) ?? new Map<string, bigint>();
      m.set(period, (m.get(period) ?? 0n) + amount);
      store.set(pinfl, m);
    };
    const personUnit = new Map<string, string>();
    const personName = new Map<string, string>();

    for (const row of rows) {
      const sums = periodSums.get(row.period) ?? emptySums();
      periodSums.set(row.period, sums);

      const unit = unitOf(row.employeePinfl, row.period);
      const acc = unitAcc(unit);
      acc.employees.add(row.employeePinfl);

      personUnit.set(row.employeePinfl, unit.label);
      personName.set(
        row.employeePinfl,
        employeeMap.get(row.employeePinfl)?.fullName ?? row.fullName ?? '—',
      );

      for (const item of row.items) {
        const component = componentMap.get(item.componentCode);
        const category = component?.category ?? 'BOSHQA';
        const negative = (component?.sign ?? 1) < 0;
        const signed = negative ? -item.amountTiyin : item.amountTiyin;

        sums[category] += signed;
        acc.sums[category] += signed;

        const ct = componentTotals.get(item.componentCode) ?? { total: 0n, employees: new Set<string>() };
        ct.total += signed;
        ct.employees.add(row.employeePinfl);
        componentTotals.set(item.componentCode, ct);

        if (category === 'PREMIYA') {
          personBonus.set(row.employeePinfl, (personBonus.get(row.employeePinfl) ?? 0n) + item.amountTiyin);
          addMonth(personBonusMonths, row.employeePinfl, row.period, item.amountTiyin);
        }
        if (category === 'JARIMA') {
          personPenalty.set(row.employeePinfl, (personPenalty.get(row.employeePinfl) ?? 0n) + item.amountTiyin);
          addMonth(personPenaltyMonths, row.employeePinfl, row.period, item.amountTiyin);
        }
      }
    }

    // ─── Oylar ───
    const periodList: StructurePeriod[] = periods.map((period) => {
      const payroll = periodPayroll.get(period) ?? 0n;
      const sums = periodSums.get(period) ?? emptySums();
      const composition = totalOf(sums);
      return {
        period,
        payrollTiyin: payroll.toString(),
        compositionTiyin: composition.toString(),
        unallocatedTiyin: (payroll - composition).toString(),
        byCategory: sumsToStrings(sums),
        payrollUploaded: uploadedPayroll.has(period),
        compositionUploaded: uploadedComposition.has(period),
      };
    });

    // ─── Jami ───
    const totalSums = emptySums();
    for (const sums of periodSums.values()) {
      for (const category of CATEGORY_ORDER) totalSums[category] += sums[category];
    }
    const totalPayroll = [...periodPayroll.values()].reduce((a, b) => a + b, 0n);
    const totalComposition = totalOf(totalSums);
    const coveredPayroll = [...periodPayroll.entries()]
      .filter(([period]) => uploadedComposition.has(period))
      .reduce((sum, [, amount]) => sum + amount, 0n);

    const byCategory: StructureCategory[] = CATEGORY_ORDER.filter(
      (category) => totalSums[category] !== 0n,
    ).map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      totalTiyin: totalSums[category].toString(),
      sharePercent: percent(totalSums[category], coveredPayroll),
    }));

    const byComponent: StructureComponent[] = components
      .filter((c) => componentTotals.has(c.code))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => {
        const ct = componentTotals.get(c.code);
        return {
          code: c.code,
          name: c.name,
          category: c.category,
          sign: c.sign,
          totalTiyin: (ct?.total ?? 0n).toString(),
          employees: ct?.employees.size ?? 0,
        };
      });

    // ─── Bo'limlar / hududlar ───
    const unitList: StructureUnit[] = [...units.values()]
      .map((acc) => {
        const composition = totalOf(acc.sums);
        return {
          key: acc.info.key,
          label: acc.info.label,
          kind: acc.info.kind,
          employees: acc.employees.size,
          payrollTiyin: acc.payroll.toString(),
          compositionTiyin: composition.toString(),
          unallocatedTiyin: (acc.payroll - composition).toString(),
          byCategory: sumsToStrings(acc.sums),
          coveredPayrollTiyin: acc.coveredPayroll.toString(),
          bonusSharePercent: percent(acc.sums.PREMIYA, acc.coveredPayroll),
        };
      })
      .sort((a, b) => {
        const diff = BigInt(b.payrollTiyin) - BigInt(a.payrollTiyin);
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      });

    // ─── Eng katta premiya va jarimalar ───
    const personPayroll = new Map<string, bigint>();
    for (const group of payrollGroups) {
      if (!uploadedComposition.has(group.period)) continue;
      personPayroll.set(
        group.employeePinfl,
        (personPayroll.get(group.employeePinfl) ?? 0n) + (group._sum.baseTiyin ?? 0n),
      );
    }

    const top = (source: Map<string, bigint>, byMonth: Map<string, Map<string, bigint>>): StructurePerson[] =>
      [...source.entries()]
        .filter(([, amount]) => amount > 0n)
        .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
        .slice(0, 10)
        .map(([pinfl, amount]) => ({
          pinfl,
          fullName: personName.get(pinfl) ?? '—',
          unitName: personUnit.get(pinfl) ?? '—',
          amountTiyin: amount.toString(),
          sharePercent: percent(amount, personPayroll.get(pinfl) ?? 0n),
          payrollTiyin: (personPayroll.get(pinfl) ?? 0n).toString(),
          months: [...(byMonth.get(pinfl)?.entries() ?? [])]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([period, value]) => ({ period, amountTiyin: value.toString() })),
        }));

    return {
      from,
      to,
      periods: periodList,
      totals: {
        payrollTiyin: totalPayroll.toString(),
        compositionTiyin: totalComposition.toString(),
        unallocatedTiyin: (totalPayroll - totalComposition).toString(),
        coveragePercent: percent(totalComposition, totalPayroll),
        coveredPeriods: uploadedComposition.size,
        coveredPayrollTiyin: coveredPayroll.toString(),
        byCategory,
      },
      byComponent,
      units: unitList,
      topBonus: top(personBonus, personBonusMonths),
      topPenalty: top(personPenalty, personPenaltyMonths),
    };
  }
}