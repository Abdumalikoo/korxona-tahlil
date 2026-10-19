import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { ensureCenterCategories, PAYROLL_CENTER_CATEGORY, PAYROLL_CENTER_OTHER, payrollCenterCategory, readPolicy } from '../expense-policy/policy.util';
import { PrismaService } from '../prisma/prisma.service';
import { TaxesService } from '../taxes/taxes.service';

const CENTRAL_REGION = 0;
const PAYROLL_CATEGORY = 'PAYROLL_BASE';
const TASHKENT_OFFSET_HOURS = 5;

/** Saqlash uchun qator */
export interface PayrollRow {
  pinfl: string;
  amountTiyin: bigint;
}

export interface MissingRow {
  rowIndex: number;
  pinfl: string;
}

/** Guruhlash uchun xodim — hudud va turi tarixga qarab almashtirilgan bo'lishi mumkin */
export interface GroupEmployee {
  pinfl: string;
  fullName: string;
  regionCode: number;
  employmentType: string;
  departmentId: string | null;
  region: { name: string };
  district: { name: string } | null;
  department: { name: string } | null;
}

/** Shu oy hudud tarixi yozuvi */
export interface LocationRef {
  employeePinfl: string;
  regionCode: number;
  districtId: string | null;
  employmentType: string;
  region: { name: string };
  district: { id: string; code: number; name: string } | null;
}

export interface ExpenseGroup {
  key: string;
  label: string;
  departmentId: string | null;
  regionCode: number | null;
  totalTiyin: bigint;
  count: number;
  zeroCount: number;
}

/** Qayta guruhlashda ko'chgan xodim */
export interface MovedEmployee {
  pinfl: string;
  fullName: string;
  amountTiyin: bigint;
  from: string;
  to: string;
}

export interface RegroupReport {
  period: string;
  batches: number;
  changedBatches: number;
  moved: MovedEmployee[];
  /** Hudud xodimlari ish haqidan Markaz hisobiga o'tgan qism (bayram, choraklik …) */
  centerTiyin: bigint;
  /** Markazga o'tgan xodimlar soni */
  centerEmployees: number;
}

/** Xodim ish haqidan Markazga o'tadigan qism: modda → summa */
export type CenterParts = Map<string, bigint>;

/** Modda tartibi: avval bayram, keyin choraklik, keyin boshqalar */
const CENTER_ORDER = [...Object.values(PAYROLL_CENTER_CATEGORY).map((c) => c.code), PAYROLL_CENTER_OTHER.code];

/**
 * Markazga o'tadigan qismni ish haqi bilan cheklaydi (tarkib soliq hisobotidan katta bo'lsa — ish haqidan oshmaydi).
 * Natija: modda → summa (nol bo'lganlar tashlanadi).
 */
export function capCenterParts(base: bigint, parts: CenterParts | undefined): CenterParts {
  const out: CenterParts = new Map();
  if (!parts || base <= 0n) return out;
  let left = base;
  const codes = [...parts.keys()].sort((a, b) => {
    const ia = CENTER_ORDER.indexOf(a);
    const ib = CENTER_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  for (const code of codes) {
    const want = parts.get(code) ?? 0n;
    if (want <= 0n || left <= 0n) continue;
    const take = want < left ? want : left;
    out.set(code, take);
    left -= take;
  }
  return out;
}

const EMPLOYEE_INCLUDE = {
  region: { select: { name: true } },
  district: { select: { name: true } },
  department: { select: { name: true } },
} as const;

@Injectable()
export class PayrollService {
  private readonly logger = new Logger(PayrollService.name);

  constructor(
    private readonly prisma: PrismaService,
    /** Ish haqidan foiz soliqlar (ijtimoiy soliq …) — vedomost o'zgarganda qayta hisoblanadi */
    @Optional() private readonly taxes?: TaxesService,
  ) {}

  private retax(period: string): void {
    if (!this.taxes) return;
    void this.taxes.syncPeriod(period).catch((e: unknown) => this.logger.warn(`Soliqlar (${period}): ${(e as Error).message}`));
  }

  // ═══════════ Yordamchilar ═══════════

  private assertPeriod(period: string): void {
    if (!/^\d{4}-\d{2}$/.test(period ?? '')) {
      throw new BadRequestException('Davr notogri formatda');
    }
  }

  /** Davr oxirgi kuni — xarajat sanasi */
  private periodEndDate(period: string): Date {
    const [year, month] = period.split('-').map(Number);
    const nextMonth = month === 12 ? 1 : (month ?? 1) + 1;
    const nextYear = month === 12 ? (year ?? 2026) + 1 : (year ?? 2026);

    return new Date(
      Date.UTC(nextYear, nextMonth - 1, 1, -TASHKENT_OFFSET_HOURS) - 86_400_000,
    );
  }

  private cellValue(value: ExcelJS.CellValue): unknown {
    if (value && typeof value === 'object') {
      const record = value as unknown as Record<string, unknown>;

      if ('result' in record) return record.result;
      if ('text' in record) return record.text;
      if ('richText' in record && Array.isArray(record.richText)) {
        return (record.richText as { text: string }[]).map((part) => part.text).join('');
      }
    }
    return value;
  }

  private isBlank(value: unknown): boolean {
    return value === null || value === undefined || String(value).trim() === '';
  }

  private parsePinfl(value: unknown): string | null {
    if (this.isBlank(value)) return null;
    const digits = String(value).replace(/\D/g, '');
    return /^\d{14}$/.test(digits) ? digits : null;
  }

  /** Bo'sh yoki 0 — nol (hisoblanmagan). Manfiy yoki matn — null (xato) */
  private parseAmount(value: unknown): bigint | null {
    if (this.isBlank(value)) return 0n;

    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) return null;
      return BigInt(Math.round(value * 100));
    }

    const text = String(value).replace(/[\s\u00A0\u202F]/g, '').replace(',', '.');
    const parsed = Number(text);

    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return BigInt(Math.round(parsed * 100));
  }

  private formatSum(tiyin: bigint): string {
    return `${(Number(tiyin) / 100).toLocaleString('uz-UZ')} som`;
  }

  // ═══════════ Hudud tarixi ═══════════

  /** Shu oy uchun hudud tarixi — natijalar faylidan */
  private async loadLocations(
    period: string,
    pinfls?: string[],
  ): Promise<Map<string, LocationRef>> {
    const locations = await this.prisma.employeeLocation.findMany({
      where: {
        period,
        ...(pinfls ? { employeePinfl: { in: pinfls } } : {}),
      },
      select: {
        employeePinfl: true,
        regionCode: true,
        districtId: true,
        employmentType: true,
        region: { select: { name: true } },
        district: { select: { id: true, code: true, name: true } },
      },
    });

    return new Map<string, LocationRef>(locations.map((item) => [item.employeePinfl, item]));
  }

  /** Tarixda yozuv bo'lsa — hudud, tuman va tur shundan olinadi */
  private applyLocation(employee: GroupEmployee, location?: LocationRef): GroupEmployee {
    if (!location) return employee;

    return {
      ...employee,
      regionCode: location.regionCode,
      employmentType: location.employmentType,
      region: { name: location.region.name },
      district: location.district ? { name: location.district.name } : null,
    };
  }

  private placeOf(employee: GroupEmployee): string {
    if (employee.regionCode === CENTRAL_REGION) {
      return employee.department?.name ?? 'Markaz';
    }
    return employee.district
      ? `${employee.region.name} / ${employee.district.name}`
      : employee.region.name;
  }

  // ═══════════ Guruhlash ═══════════

  /** Xodim qaysi xarajat guruhiga tushishi */
  /**
   * scope REGIONS (hududlar vedomosti) — shartnoma asosidagi hudud xodimlari ham o'z hududi ish haqiga yoziladi
   * (hudud vedomostida faqat hudud xodimlari bo'ladi; umumiy vedomostda shartnoma — alohida guruh).
   */
  private groupOf(employee: GroupEmployee, scope: string = 'ALL'): {
    key: string;
    label: string;
    departmentId: string | null;
    regionCode: number | null;
  } {
    if (employee.employmentType === 'SHARTNOMA' && !(scope === 'REGIONS' && employee.regionCode !== CENTRAL_REGION)) {
      return {
        key: 'shartnoma',
        label: 'Shartnoma asosidagi ish haqi',
        departmentId: null,
        regionCode: null,
      };
    }

    if (employee.regionCode === CENTRAL_REGION) {
      return {
        key: `markaz-${employee.departmentId ?? 'none'}`,
        label: `Ish haqi \u2014 ${employee.department?.name ?? 'bolimsiz'}`,
        departmentId: employee.departmentId,
        regionCode: CENTRAL_REGION,
      };
    }

    return {
      key: `region-${employee.regionCode}`,
      label: `Ish haqi \u2014 ${employee.region.name}`,
      departmentId: null,
      regionCode: employee.regionCode,
    };
  }

  /** Xarajat yozuvi qaysi guruhga tegishli */
  private expenseKey(expense: { regionCode: number | null; departmentId: string | null }): string {
    if (expense.regionCode === null && expense.departmentId === null) return 'shartnoma';
    if (expense.regionCode === CENTRAL_REGION) return `markaz-${expense.departmentId ?? 'none'}`;
    return `region-${expense.regionCode}`;
  }

  private buildGroups(
    items: { amountTiyin: bigint; employee: GroupEmployee }[],
    scope: string = 'ALL',
  ): Map<string, ExpenseGroup> {
    const groups = new Map<string, ExpenseGroup>();

    for (const { amountTiyin, employee } of items) {
      const target = this.groupOf(employee, scope);

      const group = groups.get(target.key) ?? {
        ...target,
        totalTiyin: 0n,
        count: 0,
        zeroCount: 0,
      };

      group.totalTiyin += amountTiyin;
      group.count += 1;
      if (amountTiyin === 0n) group.zeroCount += 1;

      groups.set(target.key, group);
    }

    return groups;
  }

  // ═══════════ Shablon ═══════════

  async buildTemplate(period: string): Promise<{ buffer: Buffer; filename: string }> {
    this.assertPeriod(period);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Korxona tahlil';

    const sheet = workbook.addWorksheet('Ish haqi', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
      { header: 'PINFL', key: 'pinfl', width: 20 },
      { header: 'Summa', key: 'amount', width: 18 },
    ];

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    header.height = 22;

    sheet.getColumn('A').numFmt = '@';
    sheet.getColumn('B').numFmt = '#,##0';

    const employees = await this.prisma.employee.findMany({
      where: { isActive: true },
      orderBy: [{ regionCode: 'asc' }, { fullName: 'asc' }],
      include: EMPLOYEE_INCLUDE,
    });

    const locations = await this.loadLocations(period);

    const ref = workbook.addWorksheet('Xodimlar');
    ref.columns = [
      { header: 'PINFL', key: 'pinfl', width: 20 },
      { header: 'F.I.Sh.', key: 'fullName', width: 45 },
      { header: 'Ish turi', key: 'type', width: 14 },
      { header: 'Joylashuv', key: 'place', width: 40 },
    ];

    const refHeader = ref.getRow(1);
    refHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    refHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
    ref.getColumn('A').numFmt = '@';

    for (const employee of employees) {
      const effective = this.applyLocation(
        employee as unknown as GroupEmployee,
        locations.get(employee.pinfl),
      );

      ref.addRow({
        pinfl: employee.pinfl,
        fullName: employee.fullName,
        type: effective.employmentType === 'SHTAT' ? 'Shtat' : 'Shartnoma',
        place: this.placeOf(effective),
      });
    }

    ref.autoFilter = { from: 'A1', to: `D${ref.rowCount}` };

    const data = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(data), filename: `Ish-haqi-${period}.xlsx` };
  }

  // ═══════════ Tahlil — bazaga hech narsa yozilmaydi ═══════════

  async analyze(period: string, file: Express.Multer.File) {
    this.assertPeriod(period);

    if (!file) {
      throw new BadRequestException('Fayl yuklanmadi');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('Faylda varaq topilmadi');
    }

    const parsed = new Map<string, { rowIndex: number; amountTiyin: bigint }>();
    const invalidRows: { rowIndex: number; reason: string }[] = [];
    const duplicates: string[] = [];

    sheet.eachRow((row, rowIndex) => {
      if (rowIndex === 1) return;

      const rawPinfl = this.cellValue(row.getCell(1).value);
      const rawAmount = this.cellValue(row.getCell(2).value);

      if (this.isBlank(rawPinfl) && this.isBlank(rawAmount)) return;

      const pinfl = this.parsePinfl(rawPinfl);
      if (!pinfl) {
        invalidRows.push({ rowIndex, reason: 'PINFL notogri' });
        return;
      }

      const amount = this.parseAmount(rawAmount);
      if (amount === null) {
        invalidRows.push({ rowIndex, reason: 'Summa notogri' });
        return;
      }

      const existing = parsed.get(pinfl);
      if (existing) {
        existing.amountTiyin += amount;
        duplicates.push(pinfl);
        return;
      }

      parsed.set(pinfl, { rowIndex, amountTiyin: amount });
    });

    if (parsed.size === 0) {
      throw new BadRequestException('Faylda yaroqli qator topilmadi');
    }

    const pinfls = [...parsed.keys()];

    const [employees, locations] = await Promise.all([
      this.prisma.employee.findMany({
        where: { pinfl: { in: pinfls } },
        include: EMPLOYEE_INCLUDE,
      }),
      this.loadLocations(period, pinfls),
    ]);

    const employeeMap = new Map<string, GroupEmployee>(
      employees.map((item) => [
        item.pinfl,
        this.applyLocation(item as unknown as GroupEmployee, locations.get(item.pinfl)),
      ]),
    );

    const matched: { amountTiyin: bigint; employee: GroupEmployee }[] = [];
    const missing: MissingRow[] = [];

    for (const [pinfl, row] of parsed) {
      const employee = employeeMap.get(pinfl);

      if (!employee) {
        missing.push({ rowIndex: row.rowIndex, pinfl });
        continue;
      }

      matched.push({ amountTiyin: row.amountTiyin, employee });
    }

    const groups = this.buildGroups(matched);
    const totalTiyin = matched.reduce((sum, item) => sum + item.amountTiyin, 0n);

    const zeroEmployees = matched
      .filter((item) => item.amountTiyin === 0n)
      .map((item) => ({
        pinfl: item.employee.pinfl,
        fullName: item.employee.fullName,
        place: this.placeOf(item.employee),
      }));

    const previousCount = await this.prisma.payrollBatch.count({
      where: { period, status: 'COMMITTED' },
    });

    return {
      period,
      fileName: file.originalname,
      totalRows: parsed.size + invalidRows.length,
      matchedRows: matched.length,
      paidRows: matched.length - zeroEmployees.length,
      zeroRows: zeroEmployees.length,
      missingRows: missing.length,
      /** Shu oy hudud tarixiga qarab joylashtirilgan xodimlar */
      locatedRows: [...locations.keys()].filter((pinfl) => employeeMap.has(pinfl)).length,
      invalidRows,
      missing,
      duplicates: [...new Set(duplicates)],
      zeroEmployees,
      totalTiyin,
      hasPrevious: previousCount > 0,
      previousCount,
      groups: [...groups.values()]
        .map((group) => ({
          label: group.label,
          departmentId: group.departmentId,
          regionCode: group.regionCode,
          count: group.count,
          zeroCount: group.zeroCount,
          totalTiyin: group.totalTiyin,
        }))
        .sort((a, b) => (b.totalTiyin > a.totalTiyin ? 1 : -1)),
      rows: matched.map((item) => ({
        pinfl: item.employee.pinfl,
        amountTiyin: item.amountTiyin,
      })),
    };
  }

  // ═══════════ Saqlash — bitta tranzaksiyada ═══════════

  async commit(params: {
    period: string;
    rows: PayrollRow[];
    userId: string;
    replacePrevious: boolean;
    fileName: string;
    missing: MissingRow[];
    /** ALL — umumiy (administrator), REGIONS — hududlar vedomosti (Hududchi) */
    scope?: 'ALL' | 'REGIONS';
  }) {
    const { period, userId, replacePrevious, fileName, missing } = params;
    const scope = params.scope ?? 'ALL';
    this.assertPeriod(period);

    if (params.rows.length === 0) {
      throw new BadRequestException('Saqlash uchun malumot yoq');
    }

    const merged = new Map<string, bigint>();
    for (const row of params.rows) {
      if (!/^\d{14}$/.test(row.pinfl)) {
        throw new BadRequestException(`Notogri PINFL: ${row.pinfl}`);
      }
      if (row.amountTiyin < 0n) {
        throw new BadRequestException(`Manfiy summa: ${row.pinfl}`);
      }
      merged.set(row.pinfl, (merged.get(row.pinfl) ?? 0n) + row.amountTiyin);
    }

    const pinfls = [...merged.keys()];

    const [employees, locations] = await Promise.all([
      this.prisma.employee.findMany({
        where: { pinfl: { in: pinfls } },
        include: EMPLOYEE_INCLUDE,
      }),
      this.loadLocations(period, pinfls),
    ]);

    if (employees.length !== merged.size) {
      throw new BadRequestException(
        `${merged.size - employees.length} ta xodim reestrda topilmadi. Faylni qaytadan yuklang`,
      );
    }

    const items = employees.map((employee) => ({
      amountTiyin: merged.get(employee.pinfl) ?? 0n,
      employee: this.applyLocation(
        employee as unknown as GroupEmployee,
        locations.get(employee.pinfl),
      ),
    }));

    const groups = this.buildGroups(items, scope);
    const totalTiyin = items.reduce((sum, item) => sum + item.amountTiyin, 0n);
    const zeroCount = items.filter((item) => item.amountTiyin === 0n).length;

    const date = this.periodEndDate(period);
    const fileHash = createHash('sha256')
      .update(
        `${period}:${fileName}:${JSON.stringify(
          [...merged.entries()].map(([pinfl, amount]) => [pinfl, amount.toString()]),
        )}`,
      )
      .digest('hex');

    const result = await this.prisma.$transaction(
      async (tx) => {
        let replaced = 0;

        // Bir xodim bir oyda ikki vedomostda (umumiy va hudud) bo'lmasin — ish haqi ikki marta sanalmasin
        const overlap = await tx.payrollEntry.findMany({
          where: { period, employeePinfl: { in: pinfls }, batch: { status: 'COMMITTED', scope: { not: scope } } },
          select: { employeePinfl: true },
          take: 2000,
        });
        if (overlap.length > 0) {
          const n = new Set(overlap.map((o) => o.employeePinfl)).size;
          throw new BadRequestException(
            scope === 'REGIONS'
              ? `${n} ta xodimning shu oy ish haqisi umumiy vedomostda (administrator) allaqachon bor. Ularni fayldan olib tashlang`
              : `${n} ta xodimning shu oy ish haqisi hududlar vedomostida (Hududchi) yuklangan. Ularni fayldan olib tashlang yoki hudud vedomostini bekor qiling`,
          );
        }

        if (replacePrevious) {
          const previous = await tx.payrollBatch.findMany({
            where: { period, status: 'COMMITTED', scope },
            select: { id: true },
          });
          const ids = previous.map((item) => item.id);

          if (ids.length > 0) {
            await tx.expense.updateMany({
              where: { payrollBatchId: { in: ids }, deletedAt: null },
              data: { deletedAt: new Date() },
            });
            await tx.payrollEntry.deleteMany({ where: { batchId: { in: ids } } });
            await tx.payrollBatch.updateMany({
              where: { id: { in: ids } },
              data: { status: 'CANCELLED' },
            });
            replaced = ids.length;
          }
        }

        if (!replacePrevious) {
          const dup = await tx.payrollBatch.findFirst({
            where: { period, fileHash, status: 'COMMITTED', scope },
            select: { id: true },
          });
          if (dup) {
            throw new BadRequestException(
              "Bu vedomost shu davr uchun allaqachon saqlangan (xuddi shu ma'lumotlar). Ikki marta yozilmaydi",
            );
          }
        }

        const batch = await tx.payrollBatch.create({
          data: {
            period,
            status: 'COMMITTED',
            scope,
            fileName,
            fileHash,
            totalRows: merged.size + missing.length,
            matchedRows: merged.size,
            missingRows: missing.length,
            missingPinfls: missing as unknown as object,
            totalTiyin,
            uploadedById: userId,
            committedAt: new Date(),
          },
        });

        await tx.payrollEntry.createMany({
          data: items.map((item) => ({
            employeePinfl: item.employee.pinfl,
            period,
            baseTiyin: item.amountTiyin,
            totalTiyin: item.amountTiyin,
            batchId: batch.id,
          })),
        });

        const expenseGroups = [...groups.values()].filter((group) => group.totalTiyin > 0n);

        if (expenseGroups.length > 0) {
          await tx.expense.createMany({
            data: expenseGroups.map((group) => ({
              date,
              period,
              amountTiyin: group.totalTiyin,
              categoryCode: PAYROLL_CATEGORY,
              departmentId: group.departmentId,
              regionCode: group.regionCode,
              description: `${group.label} (${group.count - group.zeroCount} xodim)`,
              paymentMethod: 'BANK' as const,
              paymentStatus: 'PAID' as const,
              source: 'PAYROLL' as const,
              payrollBatchId: batch.id,
              createdById: userId,
            })),
          });
        }

        const created = await tx.expense.aggregate({
          where: { payrollBatchId: batch.id, deletedAt: null },
          _sum: { amountTiyin: true },
          _count: { _all: true },
        });

        const createdTotal = created._sum.amountTiyin ?? 0n;

        if (createdTotal !== totalTiyin) {
          throw new BadRequestException(
            `Summa mos kelmadi: kutilgan ${this.formatSum(totalTiyin)}, ` +
              `yaratilgan ${this.formatSum(createdTotal)}. Hech narsa saqlanmadi`,
          );
        }

        return { batchId: batch.id, expensesCreated: created._count._all, replaced };
      },
      { timeout: 60_000 },
    );

    // Hudud xodimlari: bayram, choraklik pullar (ish haqi tarkibidan) — Markaz hisobiga, sof oylik — hududga
    const split = await this.regroup(period).catch((error: unknown) => {
      this.logger.warn(`Ish haqi Markaz ulushi hisoblanmadi (${period}): ${(error as Error).message}`);
      return null;
    });

    return {
      success: true as const,
      batchId: result.batchId,
      expensesCreated: result.expensesCreated,
      employees: items.length,
      zeroCount,
      totalTiyin,
      replacedPrevious: result.replaced > 0,
      centerTiyin: split?.centerTiyin ?? 0n,
      centerEmployees: split?.centerEmployees ?? 0,
    };
  }

  // ═══════════ Markaz hisobidagi ish haqi qismi ═══════════

  /**
   * Shu oy ish haqi tarkibidan (faol yuklama) Markazga o'tadigan komponentlar: xodim → modda → summa.
   * Komponentlar xarajatlar siyosatida belgilanadi (standart: bayram va choraklik pullar).
   */
  async centerShares(period: string): Promise<Map<string, CenterParts>> {
    const out = new Map<string, CenterParts>();
    const policy = await readPolicy(this.prisma);
    if (!policy.payrollComponents.length) return out;
    const batch = await this.prisma.salaryCompositionBatch.findFirst({
      where: { period, cancelledAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!batch) return out;
    const components = await this.prisma.salaryComponent.findMany({
      where: { code: { in: policy.payrollComponents } },
      select: { code: true, sign: true },
    });
    // Ayiriladigan (jarima) komponent Markazga o'tmaydi
    const codes = components.filter((c) => c.sign > 0).map((c) => c.code);
    if (!codes.length) return out;
    const items = await this.prisma.salaryCompositionItem.findMany({
      where: { batchId: batch.id, componentCode: { in: codes } },
      select: { componentCode: true, amountTiyin: true, row: { select: { employeePinfl: true } } },
    });
    for (const item of items) {
      if (item.amountTiyin <= 0n) continue;
      const pinfl = item.row.employeePinfl;
      const parts = out.get(pinfl) ?? new Map<string, bigint>();
      const code = payrollCenterCategory(item.componentCode);
      parts.set(code, (parts.get(code) ?? 0n) + item.amountTiyin);
      out.set(pinfl, parts);
    }
    return out;
  }

  /** Yozuvdagi to'liq (soliq hisobotidagi) summa — eski yozuvlarda baseTiyin = totalTiyin */
  private fullOf(entry: { baseTiyin: bigint; bonusTiyin: bigint; totalTiyin: bigint }): bigint {
    if (entry.baseTiyin === 0n && entry.totalTiyin + entry.bonusTiyin > 0n) return entry.totalTiyin + entry.bonusTiyin;
    return entry.baseTiyin;
  }

  /** Davrlar: tasdiqlangan ish haqi bor oylar (qayta hisoblash uchun) */
  async committedPeriods(): Promise<string[]> {
    const rows = await this.prisma.payrollBatch.findMany({ where: { status: 'COMMITTED' }, select: { period: true }, distinct: ['period'], orderBy: { period: 'asc' } });
    return rows.map((r) => r.period);
  }

  // ═══════════ Qayta guruhlash ═══════════

  /**
   * Shu oyning tasdiqlangan ish haqisini hudud tarixiga qarab qayta guruhlaydi va Markaz ulushini ajratadi.
   *
   * Natijalar fayli, ish haqi tarkibi saqlanganda yoki bekor qilinganda, vedomost yuklanganda chaqiriladi.
   * Hudud xodimi: sof oylik (to'liq − bayram − choraklik …) — hudud ish haqiga; ajratilgan qism — alohida
   * xarajat (HM_BAYRAM, HM_CHORAK …) bo'lib Markaz hisobiga (hudud kodi saqlanadi — «kim uchun» ko'rinadi).
   * Yozuvda: baseTiyin — to'liq, bonusTiyin — Markazga o'tgan qism, totalTiyin — hududda qolgani.
   * Jami summa o'zgarmaydi — xarajat faqat guruhlar orasida ko'chadi.
   */
  async regroup(period: string): Promise<RegroupReport> {
    this.assertPeriod(period);

    const [batches, locations, shares] = await Promise.all([
      this.prisma.payrollBatch.findMany({
        where: { period, status: 'COMMITTED' },
        include: {
          entries: {
            include: { employee: { include: EMPLOYEE_INCLUDE } },
          },
        },
      }),
      this.loadLocations(period),
      this.centerShares(period),
    ]);

    const report: RegroupReport = { period, batches: batches.length, changedBatches: 0, moved: [], centerTiyin: 0n, centerEmployees: 0 };
    const movedMap = new Map<string, MovedEmployee>();
    const centerPins = new Set<string>();
    let categoriesReady = false;
    const categoryLabels = new Map<string, string>();

    for (const batch of batches) {
      const items = batch.entries.map((entry) => {
        const registry = entry.employee as unknown as GroupEmployee;
        const effective = this.applyLocation(registry, locations.get(entry.employeePinfl));
        const full = this.fullOf(entry);

        const before = this.groupOf(registry, batch.scope);
        const after = this.groupOf(effective, batch.scope);

        if (before.key !== after.key && full > 0n) {
          const existing = movedMap.get(entry.employeePinfl);
          if (existing) {
            existing.amountTiyin += full;
          } else {
            movedMap.set(entry.employeePinfl, {
              pinfl: entry.employeePinfl,
              fullName: registry.fullName,
              amountTiyin: full,
              from: before.label,
              to: after.label,
            });
          }
        }

        // Faqat hudud ish haqi guruhidagi xodim (Markaz va umumiy shartnoma — o'zgarmaydi)
        const isRegion = after.regionCode !== null && after.regionCode !== CENTRAL_REGION;
        const parts = isRegion ? capCenterParts(full, shares.get(entry.employeePinfl)) : new Map<string, bigint>();
        let center = 0n;
        for (const v of parts.values()) center += v;
        if (center > 0n) centerPins.add(entry.employeePinfl);
        report.centerTiyin += center;

        return { entry, full, center, net: full - center, parts, group: after, employee: effective };
      });

      const groups = [...this.buildGroups(items.map((i) => ({ amountTiyin: i.net, employee: i.employee })), batch.scope).values()].filter(
        (group) => group.totalTiyin > 0n,
      );
      // Markaz hisobidagi qism: hudud × modda
      const centerRows = new Map<string, { regionCode: number; regionName: string; categoryCode: string; amount: bigint; count: number }>();
      for (const i of items) {
        if (i.group.regionCode === null) continue;
        for (const [code, amount] of i.parts) {
          const key = `${i.group.regionCode}|${code}`;
          const row = centerRows.get(key) ?? { regionCode: i.group.regionCode, regionName: i.employee.region.name, categoryCode: code, amount: 0n, count: 0 };
          row.amount += amount;
          row.count += 1;
          centerRows.set(key, row);
        }
      }

      const current = await this.prisma.expense.findMany({
        where: { payrollBatchId: batch.id, deletedAt: null },
        select: { regionCode: true, departmentId: true, amountTiyin: true, categoryCode: true },
      });

      // Guruhlar o'zgarmagan bo'lsa — tegmaymiz
      const signature = (list: { key: string; amount: bigint }[]) =>
        list
          .map((item) => `${item.key}:${item.amount}`)
          .sort()
          .join('|');

      const currentSignature = signature(
        current.map((item) => ({ key: `${this.expenseKey(item)}#${item.categoryCode}`, amount: item.amountTiyin })),
      );
      const nextSignature = signature([
        ...groups.map((group) => ({ key: `${group.key}#${PAYROLL_CATEGORY}`, amount: group.totalTiyin })),
        ...[...centerRows.values()].map((row) => ({ key: `region-${row.regionCode}#${row.categoryCode}`, amount: row.amount })),
      ]);

      const changedEntries = items.filter((i) => i.entry.baseTiyin !== i.full || i.entry.bonusTiyin !== i.center || i.entry.totalTiyin !== i.net);
      if (currentSignature === nextSignature && changedEntries.length === 0) continue;

      if (centerRows.size > 0 && !categoriesReady) {
        await ensureCenterCategories(this.prisma);
        const cats = await this.prisma.category.findMany({ where: { code: { in: [...new Set([...centerRows.values()].map((r) => r.categoryCode))] } }, select: { code: true, label: true } });
        for (const c of cats) categoryLabels.set(c.code, c.label);
        categoriesReady = true;
      }

      const total = items.reduce((sum, item) => sum + item.full, 0n);
      const date = this.periodEndDate(period);

      await this.prisma.$transaction(
        async (tx) => {
          // Yozuvlar: to'liq / Markazga / hududda
          for (const i of changedEntries) {
            await tx.payrollEntry.update({
              where: { id: i.entry.id },
              data: { baseTiyin: i.full, bonusTiyin: i.center, totalTiyin: i.net },
            });
          }

          if (currentSignature !== nextSignature) {
            await tx.expense.deleteMany({
              where: { payrollBatchId: batch.id, deletedAt: null },
            });

            if (groups.length > 0) {
              await tx.expense.createMany({
                data: groups.map((group) => ({
                  date,
                  period,
                  amountTiyin: group.totalTiyin,
                  categoryCode: PAYROLL_CATEGORY,
                  departmentId: group.departmentId,
                  regionCode: group.regionCode,
                  description: `${group.label} (${group.count - group.zeroCount} xodim)`,
                  paymentMethod: 'BANK' as const,
                  paymentStatus: 'PAID' as const,
                  source: 'PAYROLL' as const,
                  payrollBatchId: batch.id,
                  createdById: batch.uploadedById,
                })),
              });
            }

            if (centerRows.size > 0) {
              await tx.expense.createMany({
                data: [...centerRows.values()].map((row) => ({
                  date,
                  period,
                  amountTiyin: row.amount,
                  categoryCode: row.categoryCode,
                  departmentId: null,
                  regionCode: row.regionCode,
                  description: `${categoryLabels.get(row.categoryCode) ?? row.categoryCode} \u2014 ${row.regionName} xodimlari (${row.count} xodim) \u00b7 Markaz hisobidan, ish haqi tarkibidan`.slice(0, 500),
                  paymentMethod: 'BANK' as const,
                  paymentStatus: 'PAID' as const,
                  source: 'PAYROLL' as const,
                  payrollBatchId: batch.id,
                  createdById: batch.uploadedById,
                })),
              });
            }
          }

          const created = await tx.expense.aggregate({
            where: { payrollBatchId: batch.id, deletedAt: null },
            _sum: { amountTiyin: true },
          });

          if ((created._sum.amountTiyin ?? 0n) !== total) {
            throw new BadRequestException(
              `Qayta guruhlashda summa mos kelmadi (${batch.fileName}). Hech narsa ozgarmadi`,
            );
          }
        },
        { timeout: 120_000 },
      );

      report.changedBatches += 1;
    }

    report.centerEmployees = centerPins.size;
    this.retax(period);
    report.moved = [...movedMap.values()].sort((a, b) =>
      b.amountTiyin > a.amountTiyin ? 1 : -1,
    );

    return report;
  }

  /** Hamma oylar uchun qayta hisoblash (siyosat o'zgarganda) */
  async regroupAll(): Promise<{ periods: number; changedBatches: number; centerTiyin: string }> {
    let changed = 0;
    let center = 0n;
    const periods = await this.committedPeriods();
    for (const period of periods) {
      const r = await this.regroup(period);
      changed += r.changedBatches;
      center += r.centerTiyin;
    }
    return { periods: periods.length, changedBatches: changed, centerTiyin: center.toString() };
  }

  // ═══════════ Bekor qilish ═══════════

  async cancel(batchId: string) {
    const batch = await this.prisma.payrollBatch.findUnique({ where: { id: batchId } });

    if (!batch) {
      throw new NotFoundException('Yuklash topilmadi');
    }
    if (batch.status === 'CANCELLED') {
      throw new BadRequestException('Bu yuklash allaqachon bekor qilingan');
    }

    await this.prisma.$transaction([
      this.prisma.expense.updateMany({
        where: { payrollBatchId: batchId, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
      this.prisma.payrollEntry.deleteMany({ where: { batchId } }),
      this.prisma.payrollBatch.update({
        where: { id: batchId },
        data: { status: 'CANCELLED' },
      }),
    ]);
    this.retax(batch.period);

    return { success: true as const };
  }

  // ═══════════ Topilmaganlar Excel ═══════════

  async buildMissingExcel(
    period: string,
    missing: MissingRow[],
  ): Promise<{ buffer: Buffer; filename: string }> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Topilmaganlar');

    sheet.columns = [
      { header: 'Qator', key: 'rowIndex', width: 10 },
      { header: 'PINFL', key: 'pinfl', width: 20 },
      { header: 'Izoh', key: 'note', width: 40 },
    ];

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
    sheet.getColumn('B').numFmt = '@';

    for (const item of missing) {
      sheet.addRow({
        rowIndex: item.rowIndex,
        pinfl: item.pinfl,
        note: 'Xodimlar reestrida topilmadi',
      });
    }

    const data = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(data), filename: `Topilmaganlar-${period}.xlsx` };
  }

  // ═══════════ Ro'yxat va tafsilot ═══════════

  async findBatches(period?: string) {
    return this.prisma.payrollBatch.findMany({
      where: period ? { period } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        uploadedBy: { select: { id: true, fullName: true } },
        _count: { select: { entries: true } },
      },
    });
  }

  async findBatch(batchId: string) {
    const batch = await this.prisma.payrollBatch.findUnique({
      where: { id: batchId },
      include: {
        uploadedBy: { select: { id: true, fullName: true } },
        entries: {
          orderBy: { totalTiyin: 'desc' },
          include: {
            employee: {
              select: {
                pinfl: true,
                fullName: true,
                regionCode: true,
                employmentType: true,
                region: { select: { name: true } },
                department: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!batch) {
      throw new NotFoundException('Yuklash topilmadi');
    }

    return batch;
  }

  /**
   * Xarajat yozuvi ortidagi xodimlar.
   * Guruh hudud tarixiga qarab aniqlanadi — xarajat bilan bir xil qoida.
   */
  async expenseDetail(expenseId: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
      include: {
        department: { select: { id: true, name: true } },
        region: { select: { code: true, name: true } },
      },
    });

    if (!expense) {
      throw new NotFoundException('Xarajat topilmadi');
    }

    if (expense.source !== 'PAYROLL' || !expense.payrollBatchId) {
      return { isPayroll: false, expense, groups: [], entries: [] };
    }

    const key = this.expenseKey(expense);
    const isContract = key === 'shartnoma';
    // Markaz hisobidagi qism (bayram, choraklik …) — hudud xodimlari bo'yicha, shu modda summasi
    const centerPart = expense.categoryCode !== PAYROLL_CATEGORY;
    const shares = centerPart ? await this.centerShares(expense.period) : null;
    const batchScope = (await this.prisma.payrollBatch.findUnique({ where: { id: expense.payrollBatchId }, select: { scope: true } }))?.scope ?? 'ALL';
    const isCentral = expense.regionCode === CENTRAL_REGION;

    const [allEntries, locations] = await Promise.all([
      this.prisma.payrollEntry.findMany({
        where: { batchId: expense.payrollBatchId },
        orderBy: { totalTiyin: 'desc' },
        include: {
          employee: {
            select: {
              pinfl: true,
              fullName: true,
              position: true,
              regionCode: true,
              districtId: true,
              departmentId: true,
              employmentType: true,
              region: { select: { name: true } },
              district: { select: { id: true, code: true, name: true } },
              department: { select: { name: true } },
            },
          },
        },
      }),
      this.loadLocations(expense.period),
    ]);

    const entries = allEntries
      .map((entry) => {
        const location = locations.get(entry.employeePinfl);
        const effective = this.applyLocation(
          entry.employee as unknown as GroupEmployee,
          location,
        );

        return { entry, location, effective };
      })
      .filter(({ effective }) => this.groupOf(effective, batchScope).key === key)
      .map(({ entry, location, effective }) => ({
        entry,
        location,
        effective,
        amount: shares ? (capCenterParts(this.fullOf(entry), shares.get(entry.employeePinfl)).get(expense.categoryCode) ?? 0n) : entry.totalTiyin,
      }))
      .filter((x) => !shares || x.amount > 0n)
      .map(({ entry, location, effective, amount }) => ({
        id: entry.id,
        totalTiyin: amount,
        /** To'liq ish haqi (soliq hisobotidagi) va Markazga o'tgan qism */
        fullTiyin: this.fullOf(entry),
        centerTiyin: entry.bonusTiyin,
        employee: {
          pinfl: entry.employee.pinfl,
          fullName: entry.employee.fullName,
          position: entry.employee.position,
          regionCode: effective.regionCode,
          districtId: location ? location.districtId : entry.employee.districtId,
          district: location ? location.district : entry.employee.district,
          department: entry.employee.department,
        },
      }));

    const groups: { key: string; label: string; count: number; totalTiyin: bigint }[] = [];

    if (!isCentral && !isContract) {
      const byDistrict = new Map<string, { label: string; count: number; total: bigint }>();

      for (const entry of entries) {
        const districtKey = entry.employee.districtId ?? 'none';
        const label = entry.employee.district?.name ?? 'Tuman korsatilmagan';

        const item = byDistrict.get(districtKey) ?? { label, count: 0, total: 0n };
        item.count += 1;
        item.total += entry.totalTiyin;
        byDistrict.set(districtKey, item);
      }

      for (const [districtKey, value] of byDistrict) {
        groups.push({
          key: districtKey,
          label: value.label,
          count: value.count,
          totalTiyin: value.total,
        });
      }

      groups.sort((a, b) => (b.totalTiyin > a.totalTiyin ? 1 : -1));
    }

    if (shares) entries.sort((a, b) => (b.totalTiyin > a.totalTiyin ? 1 : -1));

    return {
      isPayroll: true,
      expense,
      /** Markaz hisobidagi qism (bayram, choraklik …) — hudud xodimlari ish haqi tarkibidan */
      centerPart,
      isCentral: isCentral || isContract,
      groups,
      entries,
      count: entries.length,
      totalTiyin: entries.reduce((sum, entry) => sum + entry.totalTiyin, 0n),
    };
  }
}