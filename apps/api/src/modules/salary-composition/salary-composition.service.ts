import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
    Optional,
    type OnModuleInit,
} from '@nestjs/common';
import type {
    SalaryComponent,
    SalaryComponentCategory,
    SalaryComponentGroup,
    SalaryCompositionStatus,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import ExcelJS from 'exceljs';
import { entryUnitLabel } from '../../common/segments/segments';
import { PayrollService } from '../payroll/payroll.service';
import { UnitPayrollService } from '../unit-payroll/unit-payroll.service';
import { PrismaService } from '../prisma/prisma.service';
import {
    CATEGORY_LABELS,
    CATEGORY_ORDER,
    CENTRAL_REGION,
    DEFAULT_COMPONENTS,
    DIFF_TOLERANCE_TIYIN,
    GROUP_LABELS,
    GROUP_ORDER,
    RESERVED_CODES,
    SERVICE_CODES,
} from './salary-composition.constants';
import {
    buildExportWorkbook,
    cellText,
    detectColumns,
    parseNumber,
    toTiyin,
} from './salary-composition.excel';
import { buildVedomostWorkbook, detectVedomost, rankSheets, VEDOMOST_COMPONENTS } from './salary-composition.vedomost';
import { guessComponent, LEARNED_KEY, LEARNED_MAX, readLearned, SKIP, smartScan, type Learned, type SmartColumn, type SmartScan } from './salary-composition.smart';
import { runExclusive } from '../../common/locks';
import type {
    AnalysisResult,
    BatchDto,
    CategoryTotal,
    CheckInput,
    CheckPerson,
    CheckState,
    CheckSummary,
    CommitResult,
    CommitRow,
    ComponentDto,
    ComponentInput,
    ComponentTotal,
    CompositionRowDto,
    CompositionView,
    EmployeeHistory,
    ParsedRow,
    PayrollInfo,
    RegistryInfo,
    RowState,
} from './salary-composition.types';
import { assertSafeXlsx } from '../../common/files/xlsx-guard';

// ═══════════════════════════════════════════════════════════
// Servis
// ═══════════════════════════════════════════════════════════

@Injectable()
export class SalaryCompositionService implements OnModuleInit {
  private readonly logger = new Logger(SalaryCompositionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollService: PayrollService,
    /** Yo'nalish (Tax free …) ish haqi — alohida tarkib shu vedomost bilan solishtiriladi */
    @Optional() private readonly unitPayroll?: UnitPayrollService,
  ) {}

  /** Komponentlar jadvali bo'sh bo'lsa — standart komponentlarni yozamiz; keyin qo'shilgan «Choraklik mukofot» — mavjud bazaga ham */
  async onModuleInit(): Promise<void> {
    try {
      const count = await this.prisma.salaryComponent.count();
      if (count > 0) {
        // Keyin qo'shilgan komponentlar (choraklik mukofot, buxgalteriya vedomosti ustunlari) — mavjud bazaga ham
        const have = new Set((await this.prisma.salaryComponent.findMany({ select: { code: true } })).map((c) => c.code));
        const missing = [...DEFAULT_COMPONENTS, ...VEDOMOST_COMPONENTS].filter((c) => !have.has(c.code));
        for (const c of missing) await this.prisma.salaryComponent.create({ data: { ...c } }).catch(() => null);
        if (missing.length) this.logger.log(`Ish haqi komponentlari qo'shildi: ${missing.map((c) => c.name).join(', ')}`);
        return;
      }

      await this.prisma.salaryComponent.createMany({
        data: [...DEFAULT_COMPONENTS, ...VEDOMOST_COMPONENTS].map((item) => ({ ...item })),
        skipDuplicates: true,
      });
      this.logger.log(`Ish haqi komponentlari yaratildi: ${DEFAULT_COMPONENTS.length + VEDOMOST_COMPONENTS.length} ta`);
    } catch (error) {
      this.logger.error('Ish haqi komponentlarini yaratib bo\'lmadi', error as Error);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Yordamchilar
  // ═══════════════════════════════════════════════════════════

  private assertPeriod(period: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) {
      throw new BadRequestException('Davr noto\'g\'ri formatda (YYYY-MM)');
    }
  }

  private abs(value: bigint): bigint {
    return value < 0n ? -value : value;
  }

  private percent(part: bigint, total: bigint): number | null {
    if (total === 0n) return null;
    return Math.round((Number(part) / Number(total)) * 10000) / 100;
  }

  private toComponentDto(component: SalaryComponent, usedCount = 0): ComponentDto {
    return {
      code: component.code,
      name: component.name,
      group: component.group,
      groupLabel: GROUP_LABELS[component.group],
      category: component.category,
      categoryLabel: CATEGORY_LABELS[component.category],
      sign: component.sign,
      sortOrder: component.sortOrder,
      isActive: component.isActive,
      usedCount,
    };
  }

  /** Guruh → tartib raqami bo'yicha saralash */
  private sortComponents<T extends { group: SalaryComponentGroup; sortOrder: number; code: string }>(
    list: T[],
  ): T[] {
    return [...list].sort((a, b) => {
      const groupDiff = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
      if (groupDiff !== 0) return groupDiff;
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.code.localeCompare(b.code);
    });
  }

  private async allComponents(): Promise<SalaryComponent[]> {
    const list = await this.prisma.salaryComponent.findMany();
    return this.sortComponents(list);
  }

  /** Belgisi bilan qator jami: Σ sign × summa */
  private rowTotal(items: Map<string, bigint>, signs: Map<string, number>): bigint {
    let total = 0n;
    for (const [code, amount] of items) {
      total += (signs.get(code) ?? 1) < 0 ? -amount : amount;
    }
    return total;
  }

  private mapToRecord(items: Map<string, bigint>): Record<string, string> {
    const record: Record<string, string> = {};
    for (const [code, amount] of items) {
      if (amount !== 0n) record[code] = amount.toString();
    }
    return record;
  }

  /** Reestrdagi ism va bo'lim / hudud */
  private async registry(pinfls: string[], unit?: string): Promise<Map<string, RegistryInfo>> {
    const map = new Map<string, RegistryInfo>();
    if (pinfls.length === 0) return map;
    if (unit) return this.unitRegistry(pinfls, unit);

    const employees = await this.prisma.employee.findMany({
      where: { pinfl: { in: pinfls } },
      select: {
        pinfl: true,
        fullName: true,
        regionCode: true,
        region: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

    for (const emp of employees) {
      map.set(emp.pinfl, {
        fullName: emp.fullName,
        unitName:
          emp.regionCode === CENTRAL_REGION
            ? (emp.department?.name ?? 'Markaz')
            : (emp.region?.name ?? null),
      });
    }
    return map;
  }

  /** Soliq hisoboti (tasdiqlangan ish haqi) — xodim bo'yicha jami */
  private async payroll(period: string, unit?: string): Promise<PayrollInfo> {
    if (unit) {
      // Yo'nalish: shu bo'lim ish haqi vedomosti (Xarajatlar › <yo'nalish> › Ish haqi); hamma xodim — doira ichida
      const map = await this.unitService().payrollMap(unit, period);
      if (!map) return { uploaded: false, map: new Map(), central: new Set(), regionOf: new Map() };
      return { uploaded: true, map, central: new Set(map.keys()), regionOf: new Map() };
    }
    const batchCount = await this.prisma.payrollBatch.count({
      where: { period, status: 'COMMITTED' },
    });

    const map = new Map<string, bigint>();
    if (batchCount === 0) return { uploaded: false, map, central: new Set(), regionOf: new Map() };

    // To'liq (soliq hisobotidagi) summa: baseTiyin. totalTiyin — hududda qolgan qism (bayram, choraklik Markazga o'tgan)
    const grouped = await this.prisma.payrollEntry.groupBy({
      by: ['employeePinfl'],
      where: { period, deletedAt: null, batch: { status: 'COMMITTED' } },
      _sum: { baseTiyin: true },
    });

    for (const item of grouped) {
      map.set(item.employeePinfl, item._sum.baseTiyin ?? 0n);
    }

    // Kim Markaz xodimi (shu oy): oy bo'yicha joylashuv bo'lsa — u, aks holda reestrdagi hudud
    const pinfls = [...map.keys()];
    const [employees, locations, regions] = pinfls.length
      ? await Promise.all([
          this.prisma.employee.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, regionCode: true } }),
          this.prisma.employeeLocation.findMany({ where: { employeePinfl: { in: pinfls }, period }, select: { employeePinfl: true, regionCode: true } }),
          this.prisma.region.findMany({ select: { code: true, name: true } }),
        ])
      : [[], [], []];
    const regionName = new Map(regions.map((r) => [r.code, r.name]));
    const located = new Map(locations.map((l) => [l.employeePinfl, l.regionCode]));
    const registryRegion = new Map(employees.map((e) => [e.pinfl, e.regionCode]));
    const central = new Set<string>();
    const regionOf = new Map<string, string>();
    for (const pinfl of pinfls) {
      const code = located.get(pinfl) ?? registryRegion.get(pinfl) ?? null;
      if (code === CENTRAL_REGION) central.add(pinfl);
      else regionOf.set(pinfl, code === null ? "Reestrda yo'q" : (regionName.get(code) ?? `Hudud ${code}`));
    }
    return { uploaded: true, map, central, regionOf };
  }

  private rowState(pinfl: string, total: bigint, payroll: PayrollInfo): {
    state: RowState;
    payrollTiyin: bigint | null;
    diffTiyin: bigint | null;
  } {
    if (!payroll.uploaded) return { state: 'no_payroll', payrollTiyin: null, diffTiyin: null };

    const payrollTiyin = payroll.map.get(pinfl);
    if (payrollTiyin === undefined) {
      return {
        state: total === 0n ? 'ok' : 'not_in_payroll',
        payrollTiyin: null,
        diffTiyin: total === 0n ? null : total,
      };
    }

    const diff = total - payrollTiyin;
    return {
      state: this.abs(diff) <= DIFF_TOLERANCE_TIYIN ? 'ok' : 'diff',
      payrollTiyin,
      diffTiyin: diff,
    };
  }

  /** Tarkib ↔ soliq hisoboti solishtiruvi */
  private async buildCheck(
    period: string,
    rows: CheckInput[] | null,
    payroll: PayrollInfo,
    unit?: string,
  ): Promise<CheckSummary> {
    const compositionUploaded = rows !== null;
    const list = rows ?? [];

    let compositionTotal = 0n;
    // Doira: Markaz xodimlari + tarkib faylidagilar (hudud xodimi faylda bo'lsa — u ham solishtiriladi)
    const inFile = new Set(list.map((r) => r.pinfl));
    const inScope = (pinfl: string) => payroll.central.has(pinfl) || inFile.has(pinfl);
    let payrollTotal = 0n;
    for (const [pinfl, value] of payroll.map) if (inScope(pinfl)) payrollTotal += value;

    const mismatches: CheckPerson[] = [];
    const notInPayroll: CheckPerson[] = [];
    const inComposition = new Set<string>();

    for (const row of list) {
      compositionTotal += row.totalTiyin;
      inComposition.add(row.pinfl);
      if (!payroll.uploaded) continue;

      const payrollTiyin = payroll.map.get(row.pinfl);

      if (payrollTiyin === undefined) {
        if (row.totalTiyin !== 0n) {
          notInPayroll.push({
            pinfl: row.pinfl,
            fullName: row.fullName,
            compositionTiyin: row.totalTiyin.toString(),
            payrollTiyin: '0',
            diffTiyin: row.totalTiyin.toString(),
          });
        }
        continue;
      }

      const diff = row.totalTiyin - payrollTiyin;
      if (this.abs(diff) > DIFF_TOLERANCE_TIYIN) {
        mismatches.push({
          pinfl: row.pinfl,
          fullName: row.fullName,
          compositionTiyin: row.totalTiyin.toString(),
          payrollTiyin: payrollTiyin.toString(),
          diffTiyin: diff.toString(),
        });
      }
    }

    const missingInComposition: CheckPerson[] = [];
    if (payroll.uploaded && compositionUploaded) {
      const absent = [...payroll.map.entries()].filter(
        ([pinfl, amount]) => amount !== 0n && !inComposition.has(pinfl) && inScope(pinfl),
      );
      const names = await this.registry(absent.map(([pinfl]) => pinfl), unit);

      for (const [pinfl, amount] of absent) {
        missingInComposition.push({
          pinfl,
          fullName: names.get(pinfl)?.fullName ?? '—',
          compositionTiyin: '0',
          payrollTiyin: amount.toString(),
          diffTiyin: (-amount).toString(),
        });
      }
    }

    // Doiradan tashqari: hudud xodimlari — tarkib ular uchun tuzilmaydi, farq hisoblanmaydi
    const outside = payroll.uploaded ? [...payroll.map.entries()].filter(([pinfl, amount]) => amount !== 0n && !inScope(pinfl)) : [];
    const outsideNames = outside.length ? await this.registry(outside.map(([pinfl]) => pinfl)) : new Map<string, RegistryInfo>();
    const regionAcc = new Map<string, { employees: number; total: bigint }>();
    let outsideTotal = 0n;
    const outsidePeople = outside.map(([pinfl, amount]) => {
      const unitName = payroll.regionOf.get(pinfl) ?? '—';
      const g = regionAcc.get(unitName) ?? { employees: 0, total: 0n };
      g.employees += 1;
      g.total += amount;
      regionAcc.set(unitName, g);
      outsideTotal += amount;
      return { pinfl, fullName: outsideNames.get(pinfl)?.fullName ?? '—', unitName, compositionTiyin: '0', payrollTiyin: amount.toString(), diffTiyin: (-amount).toString() };
    });
    outsidePeople.sort((x, y) => x.unitName.localeCompare(y.unitName) || x.fullName.localeCompare(y.fullName));

    const byDiff = (a: CheckPerson, b: CheckPerson) =>
      this.abs(BigInt(b.diffTiyin)) > this.abs(BigInt(a.diffTiyin)) ? 1 : -1;
    mismatches.sort(byDiff);
    missingInComposition.sort(byDiff);
    notInPayroll.sort(byDiff);

    const mismatchCount = mismatches.length + missingInComposition.length + notInPayroll.length;

    let state: CheckState;
    if (!compositionUploaded) state = 'NOT_UPLOADED';
    else if (!payroll.uploaded) state = 'NO_PAYROLL';
    else state = mismatchCount === 0 ? 'MATCHED' : 'MISMATCH';

    return {
      period,
      state,
      payrollUploaded: payroll.uploaded,
      compositionUploaded,
      compositionTiyin: compositionTotal.toString(),
      payrollTiyin: payrollTotal.toString(),
      diffTiyin: (compositionTotal - payrollTotal).toString(),
      employees: list.length,
      mismatchCount,
      mismatches,
      missingInComposition,
      notInPayroll,
      scope: unit ? 'UNIT' : 'CENTER',
      outOfScope: {
        employees: outsidePeople.length,
        payrollTiyin: outsideTotal.toString(),
        byRegion: [...regionAcc.entries()]
          .sort((x, y) => (y[1].total > x[1].total ? 1 : y[1].total < x[1].total ? -1 : 0))
          .map(([name, g]) => ({ name, employees: g.employees, payrollTiyin: g.total.toString() })),
        people: outsidePeople,
      },
    };
  }

  /** Komponent va guruh bo'yicha jamilar */
  private totals(
    rows: { items: Map<string, bigint> }[],
    components: SalaryComponent[],
  ): { byComponent: ComponentTotal[]; byCategory: CategoryTotal[] } {
    const sums = new Map<string, { total: bigint; employees: number }>();

    for (const row of rows) {
      for (const [code, amount] of row.items) {
        if (amount === 0n) continue;
        const current = sums.get(code) ?? { total: 0n, employees: 0 };
        current.total += amount;
        current.employees += 1;
        sums.set(code, current);
      }
    }

    const byComponent: ComponentTotal[] = [];
    const categorySums = new Map<SalaryComponentCategory, bigint>();
    let grand = 0n;

    for (const component of components) {
      const sum = sums.get(component.code);
      if (!sum) continue;

      const signed = component.sign < 0 ? -sum.total : sum.total;
      grand += signed;
      categorySums.set(component.category, (categorySums.get(component.category) ?? 0n) + signed);

      byComponent.push({
        code: component.code,
        name: component.name,
        group: component.group,
        category: component.category,
        sign: component.sign,
        totalTiyin: signed.toString(),
        employees: sum.employees,
      });
    }

    const byCategory: CategoryTotal[] = CATEGORY_ORDER.filter((category) =>
      categorySums.has(category),
    ).map((category) => {
      const total = categorySums.get(category) ?? 0n;
      return {
        category,
        label: CATEGORY_LABELS[category],
        totalTiyin: total.toString(),
        sharePercent: this.percent(this.abs(total), grand),
      };
    });

    return { byComponent, byCategory };
  }

  private async usageCounts(): Promise<Map<string, number>> {
    const grouped = await this.prisma.salaryCompositionItem.groupBy({
      by: ['componentCode'],
      _count: { _all: true },
    });
    return new Map(grouped.map((item) => [item.componentCode, item._count._all]));
  }

  private async activeBatch(period: string) {
    return this.prisma.salaryCompositionBatch.findFirst({
      where: { period, cancelledAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async toBatchDtos(
    batches: {
      id: string;
      period: string;
      fileName: string | null;
      employeeCount: number;
      totalTiyin: bigint;
      payrollTiyin: bigint;
      status: SalaryCompositionStatus;
      mismatchCount: number;
      uploadedById: string | null;
      createdAt: Date;
      cancelledAt: Date | null;
    }[],
  ): Promise<BatchDto[]> {
    const userIds = [
      ...new Set(batches.map((b) => b.uploadedById).filter((id): id is string => !!id)),
    ];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.fullName]));

    return batches.map((batch) => ({
      id: batch.id,
      period: batch.period,
      fileName: batch.fileName,
      employeeCount: batch.employeeCount,
      totalTiyin: batch.totalTiyin.toString(),
      payrollTiyin: batch.payrollTiyin.toString(),
      status: batch.status,
      mismatchCount: batch.mismatchCount,
      uploadedBy: batch.uploadedById ? (names.get(batch.uploadedById) ?? null) : null,
      createdAt: batch.createdAt,
      cancelledAt: batch.cancelledAt,
    }));
  }

  // ═══════════════════════════════════════════════════════════
  // Komponentlar ma'lumotnomasi
  // ═══════════════════════════════════════════════════════════

  async listComponents(): Promise<ComponentDto[]> {
    const [components, usage] = await Promise.all([this.allComponents(), this.usageCounts()]);
    return components.map((c) => this.toComponentDto(c, usage.get(c.code) ?? 0));
  }

  private parseGroup(value: unknown): SalaryComponentGroup {
    if (value === 'BUDGET' || value === 'HOJALIK') return value;
    throw new BadRequestException('Manba noto\'g\'ri: BUDGET yoki HOJALIK bo\'lishi kerak');
  }

  private parseCategory(value: unknown): SalaryComponentCategory {
    if (typeof value === 'string' && (CATEGORY_ORDER as string[]).includes(value)) {
      return value as SalaryComponentCategory;
    }
    throw new BadRequestException('Guruh noto\'g\'ri');
  }

  private parseName(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (name.length < 2 || name.length > 100) {
      throw new BadRequestException('Nomi 2–100 belgi bo\'lishi kerak');
    }
    return name;
  }

  async createComponent(input: ComponentInput): Promise<ComponentDto> {
    const code = String(input.code ?? '')
      .trim()
      .toUpperCase();

    if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(code)) {
      throw new BadRequestException(
        'Kod lotin katta harflar, raqam va "_" dan iborat bo\'lsin (2–30 belgi), masalan: TUNGI_ISH',
      );
    }
    if (RESERVED_CODES.includes(code)) {
      throw new BadRequestException(`"${code}" kodi band — boshqa kod tanlang`);
    }

    const exists = await this.prisma.salaryComponent.findUnique({ where: { code } });
    if (exists) throw new BadRequestException(`"${code}" kodli komponent allaqachon bor`);

    const name = this.parseName(input.name);
    const group = this.parseGroup(input.group);
    const category = this.parseCategory(input.category);
    const sign = category === 'JARIMA' || input.sign === -1 ? -1 : 1;

    let sortOrder = Number(input.sortOrder);
    if (!Number.isInteger(sortOrder)) {
      const last = await this.prisma.salaryComponent.aggregate({
        where: { group },
        _max: { sortOrder: true },
      });
      sortOrder = (last._max.sortOrder ?? 0) + 10;
    }

    const created = await this.prisma.salaryComponent.create({
      data: { code, name, group, category, sign, sortOrder, isActive: true },
    });
    return this.toComponentDto(created, 0);
  }

  async updateComponent(code: string, input: ComponentInput): Promise<ComponentDto> {
    const current = await this.prisma.salaryComponent.findUnique({ where: { code } });
    if (!current) throw new NotFoundException('Komponent topilmadi');

    const usage = await this.prisma.salaryCompositionItem.count({ where: { componentCode: code } });

    const data: {
      name?: string;
      group?: SalaryComponentGroup;
      category?: SalaryComponentCategory;
      sign?: number;
      sortOrder?: number;
      isActive?: boolean;
    } = {};

    if (input.name !== undefined) data.name = this.parseName(input.name);
    if (input.group !== undefined) data.group = this.parseGroup(input.group);
    if (input.category !== undefined) data.category = this.parseCategory(input.category);

    if (input.sign !== undefined || data.category !== undefined) {
      const category = data.category ?? current.category;
      const sign = category === 'JARIMA' || input.sign === -1 ? -1 : 1;

      if (sign !== current.sign && usage > 0) {
        throw new BadRequestException(
          'Bu komponent ishlatilgan — ishorasini (+/−) o\'zgartirib bo\'lmaydi, eski oylar jami buziladi',
        );
      }
      data.sign = sign;
    }

    if (input.sortOrder !== undefined) {
      const sortOrder = Number(input.sortOrder);
      if (!Number.isInteger(sortOrder)) throw new BadRequestException('Tartib raqami butun son bo\'lsin');
      data.sortOrder = sortOrder;
    }
    if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);

    const updated = await this.prisma.salaryComponent.update({ where: { code }, data });
    return this.toComponentDto(updated, usage);
  }

  async removeComponent(code: string): Promise<{ success: true }> {
    const current = await this.prisma.salaryComponent.findUnique({ where: { code } });
    if (!current) throw new NotFoundException('Komponent topilmadi');

    const usage = await this.prisma.salaryCompositionItem.count({ where: { componentCode: code } });
    if (usage > 0) {
      throw new BadRequestException(
        `Bu komponent ${usage} ta yozuvda ishlatilgan — o'chirib bo'lmaydi. Uni "nofaol" qiling, shablonda chiqmaydi.`,
      );
    }

    await this.prisma.salaryComponent.delete({ where: { code } });
    return { success: true };
  }

  // ═══════════════════════════════════════════════════════════
  // Shablon
  // ═══════════════════════════════════════════════════════════

  async buildTemplate(period: string, unit?: string): Promise<{ buffer: Buffer; filename: string }> {
    this.assertPeriod(period);

    const components = (await this.allComponents()).filter((c) => c.isActive);
    if (components.length === 0) {
      throw new BadRequestException('Faol komponent yo\'q — Sozlamalarda komponent qo\'shing');
    }
    if (unit) return this.unitTemplate(period, unit, components);

    const payroll = await this.payroll(period);

    // Xodimlar: shu oy soliq hisobotidagilar; hisobot yo'q bo'lsa — faol xodimlar (avval Markaz, bo'limlar bo'yicha)
    const employees = await this.prisma.employee.findMany({
      where: payroll.map.size ? { pinfl: { in: [...payroll.map.keys()] } } : { isActive: true },
      select: {
        pinfl: true,
        fullName: true,
        position: true,
        regionCode: true,
        region: { select: { name: true } },
        department: { select: { name: true } },
      },
    });
    employees.sort((a, b) => {
      const ca = a.regionCode === CENTRAL_REGION ? 0 : 1;
      const cb = b.regionCode === CENTRAL_REGION ? 0 : 1;
      if (ca !== cb) return ca - cb;
      const ua = a.department?.name ?? a.region?.name ?? '';
      const ub = b.department?.name ?? b.region?.name ?? '';
      return ua === ub ? a.fullName.localeCompare(b.fullName) : ua.localeCompare(ub);
    });

    const workbook = buildVedomostWorkbook({ period, components, employees, payroll });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, filename: `ish-haqi-tarkibi-${period}.xlsx` };
  }

  // ═══════════════════════════════════════════════════════════
  // Faylni o'qish
  // ═══════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════
  // Ustunlar moslashi — o'rgatilganlar (sarlavha → komponent)
  // ═══════════════════════════════════════════════════════════

  async learnedColumns(): Promise<Learned> {
    const row = await this.prisma.setting.findUnique({ where: { key: LEARNED_KEY } });
    return readLearned(row?.value ?? null);
  }

  /**
   * Tasdiqlangan moslashlarni eslab qolish (saqlashda). Faqat summa ustunlari; kod — mavjud komponent yoki SKIP.
   * Bir sarlavha uchun oxirgi tanlov qoladi.
   */
  async rememberColumns(items: unknown): Promise<number> {
    if (!Array.isArray(items) || !items.length) return 0;
    const codes = new Set((await this.allComponents()).map((c) => c.code));
    const clean = items
      .slice(0, 400)
      .map((x) => x as { key?: unknown; leaf?: unknown; label?: unknown; code?: unknown })
      .filter((x) => typeof x.key === 'string' && x.key.length > 0 && x.key.length <= 400 && typeof x.leaf === 'string' && typeof x.code === 'string' && (x.code === SKIP || codes.has(x.code)));
    if (!clean.length) return 0;
    return runExclusive(`setting:${LEARNED_KEY}`, async () => {
      const current = await this.learnedColumns();
      const at = new Date().toISOString();
      for (const x of clean) current[x.key as string] = { code: x.code as string, leaf: (x.leaf as string).slice(0, 300), label: typeof x.label === 'string' ? x.label.slice(0, 300) : '', at };
      // Eng eskilari tashlanadi (cheklov)
      const entries = Object.entries(current).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, LEARNED_MAX);
      const value = { v: 1, items: Object.fromEntries(entries) };
      await this.prisma.setting.upsert({ where: { key: LEARNED_KEY }, create: { key: LEARNED_KEY, value: value as never }, update: { value: value as never } });
      return clean.length;
    });
  }

  /** O'rgatilgan moslashlar ro'yxati (sozlash uchun) */
  async listLearned(): Promise<{ key: string; leaf: string; label: string; code: string; at: string }[]> {
    const l = await this.learnedColumns();
    return Object.entries(l)
      .map(([key, x]) => ({ key, ...x }))
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /** O'rgatilgan moslashni o'chirish */
  async forgetLearned(key: string): Promise<{ success: true }> {
    await runExclusive(`setting:${LEARNED_KEY}`, async () => {
      const current = await this.learnedColumns();
      if (!(key in current)) return;
      delete current[key];
      const value = { v: 1, items: current };
      await this.prisma.setting.upsert({ where: { key: LEARNED_KEY }, create: { key: LEARNED_KEY, value: value as never }, update: { value: value as never } });
    });
    return { success: true };
  }

  /**
   * mapping — shu yuklashda foydalanuvchi tanlagani: { ustun harfi: komponent kodi | 'SKIP' }.
   * Fayl istalgan shaklda bo'lishi mumkin: tanish shakl (vedomost, dastur shabloni) qoidalari bilan, notanishi —
   * ma'lumotning o'zidan (PINFL ustuni, sarlavhalar) va har ustun uchun komponent taklifi bilan o'qiladi.
   */
  async analyze(period: string, file: Express.Multer.File | undefined, sheetName?: string, unit?: string, mapping?: Record<string, string>): Promise<AnalysisResult> {
    this.assertPeriod(period);
    if (!file) throw new BadRequestException('Fayl yuklanmadi');

    const workbook = new ExcelJS.Workbook();
    await assertSafeXlsx(file.buffer);
    try {
      await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Faylni o\'qib bo\'lmadi — .xlsx formatida saqlang');
    }

    if (!workbook.worksheets.length) throw new BadRequestException('Faylda varaq yo\'q');

    const components = await this.allComponents();
    const signs = new Map(components.map((c) => [c.code, c.sign]));
    const byCode = new Map(components.map((c) => [c.code, c]));
    const learned = await this.learnedColumns();
    const user = mapping && typeof mapping === 'object' ? Object.fromEntries(Object.entries(mapping).filter(([k, v]) => /^[A-Z]{1,3}$/.test(k) && typeof v === 'string')) : undefined;

    // Varaq: tanlangan; bo'lmasa — oy nomi mos, buxgalteriya vedomosti shaklidagi birinchisi; eski shablon («Tarkib») ham o'qiladi
    const names = workbook.worksheets.map((w) => w.name);
    const order = sheetName ? [sheetName] : rankSheets(names, period);
    let sheet: ExcelJS.Worksheet | undefined;
    let det: { headerRow: number; dataStart: number; fixed: Partial<Record<'pinfl' | 'fullName' | 'days' | 'rate' | 'total', number>>; comps: Map<string, number>; skipped: { column: string; label: string; reason: string }[]; vedomost: boolean } | null = null;
    for (const name of order) {
      const ws = workbook.getWorksheet(name);
      if (!ws) continue;
      const v = detectVedomost(ws, components);
      if (v) {
        sheet = ws;
        det = v;
        break;
      }
      try {
        const old = detectColumns(ws, components);
        sheet = ws;
        det = { ...old, dataStart: old.headerRow + 1, skipped: [], vedomost: false };
        break;
      } catch {
        if (sheetName) throw new BadRequestException(`«${sheetName}» varag'ida ish haqi ustunlari topilmadi`);
      }
    }
    // Ustunlar: tanish shakl — qoidalar bilan (+ o'rgatilgan va siz tanlagan); notanish — ma'lumotning o'zidan
    let smart: SmartScan | null = null;
    let trusted = false;
    if (sheet && det) {
      const rule = new Map<number, string>([...det.comps.entries()].map(([code, col]) => [col, code]));
      const ruleSkipped = new Map<number, string>(det.skipped.map((x) => [colIndexOf(x.column), x.reason]));
      smart = smartScan(sheet, components, { rule, ruleSkipped, trusted: true, learned, user });
      trusted = true;
    } else {
      for (const name of order) {
        const ws = workbook.getWorksheet(name);
        if (!ws) continue;
        const s = smartScan(ws, components, { learned, user });
        if (!s || !s.columns.some((c) => c.kind === 'amount')) continue;
        sheet = ws;
        smart = s;
        det = {
          headerRow: s.headerBottom,
          dataStart: s.dataStart,
          fixed: { pinfl: s.pinflCol, ...(s.nameCol ? { fullName: s.nameCol } : {}), ...(s.daysCol ? { days: s.daysCol } : {}), ...(s.rateCol ? { rate: s.rateCol } : {}), ...(s.totalCol ? { total: s.totalCol } : {}) },
          comps: new Map(),
          skipped: [],
          vedomost: true,
        };
        break;
      }
    }
    if (!sheet || !det) throw new BadRequestException("Ish haqi varag'i topilmadi: 14 xonali PINFL ustuni va summa ustunlari bo'lgan varaq kerak");
    const { fixed } = det;
    if (!fixed.total && smart?.totalCol) fixed.total = smart.totalCol;
    // Ustun → komponent (bir komponentga bir nechta ustun ham bo'lishi mumkin — qo'shiladi)
    const colMap: [number, string][] = smart
      ? smart.columns.filter((c) => c.kind === 'amount' && c.code).map((c) => [c.col, c.code!] as [number, string])
      : [...det.comps.entries()].map(([code, col]) => [col, code] as [number, string]);
    const amountCols = smart ? smart.columns.filter((c) => c.kind === 'amount').map((c) => c.col) : colMap.map(([c]) => c);
    const unmappedWithValues = smart ? smart.columns.filter((c) => c.kind === 'amount' && !c.code && c.nonZero > 0 && c.source === 'none') : [];

    const invalidRows: AnalysisResult['invalidRows'] = [];
    const duplicates: AnalysisResult['duplicates'] = [];
    const totalMismatches: AnalysisResult['totalMismatches'] = [];
    const parsed: ParsedRow[] = [];
    const mergedRows: { rowIndex: number; pinfl: string; intoRow: number }[] = [];
    const seen = new Set<string>();
    let totalRows = 0;

    const pinflCol = fixed.pinfl as number;

    for (let r = det.dataStart; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const pinflRaw = cellText(row.getCell(pinflCol).value);
      // Vedomost: PINFL siz qatorlar (bo'lim jami, bo'sh, «JAMI») — jimgina o'tkaziladi
      if (det.vedomost && !pinflRaw.replace(/\D/g, '')) {
        const name = fixed.fullName ? cellText(row.getCell(fixed.fullName).value) : '';
        if (!name || /^jami/i.test(name) || /^\d+$/.test(name)) continue;
      }

      // Kodlar qatori (nomlar bo'yicha topilgan bo'lsa) yoki JAMI qatori — o'tkazamiz
      const upper = pinflRaw.toUpperCase();
      if (upper === 'JAMI' || upper === SERVICE_CODES.pinfl) continue;

      // Summalarni o'qiymiz
      const items = new Map<string, bigint>();
      const errors: string[] = [];
      let hasAmount = false;
      // Hamma summa ustunlari (moslanmaganlari ham) — soliq hisoboti bilan farqni tahlil qilish uchun
      const raw = new Map<number, bigint>();
      for (const col of amountCols) {
        const n = parseNumber(row.getCell(col).value);
        if (n !== null && !Number.isNaN(n) && n !== 0) raw.set(col, toTiyin(n));
      }

      for (const [col, code] of colMap) {
        const component = byCode.get(code);
        if (!component) continue;

        const value = parseNumber(row.getCell(col).value);
        if (value === null || value === 0) continue;

        if (Number.isNaN(value)) {
          errors.push(`${component.name}: son emas`);
          continue;
        }

        let amount = value;
        if (amount < 0) {
          if (component.sign < 0) amount = -amount;
          // Vedomostda manfiy tuzatish (masalan front farqi) — ФОТ bo'yicha «Vedomost farqi»ga o'tadi
          else if (det.vedomost && fixed.total) continue;
          else {
            errors.push(`${component.name}: manfiy summa`);
            continue;
          }
        }

        const tiyin = toTiyin(amount);
        if (tiyin !== 0n) {
          items.set(code, (items.get(code) ?? 0n) + tiyin);
          hasAmount = true;
        }
      }
      if (!hasAmount && raw.size > 0) hasAmount = true;

      if (!pinflRaw) {
        if (hasAmount) {
          totalRows += 1;
          invalidRows.push({ rowIndex: r, reason: 'PINFL yozilmagan, lekin summa bor' });
        }
        continue;
      }

      totalRows += 1;
      const pinfl = pinflRaw.replace(/\D/g, '');

      if (pinfl.length !== 14) {
        invalidRows.push({ rowIndex: r, reason: `PINFL noto'g'ri: "${pinflRaw}" (14 ta raqam bo'lishi kerak)` });
        continue;
      }
      if (errors.length > 0) {
        invalidRows.push({ rowIndex: r, reason: errors.join('; ') });
        continue;
      }
      if (seen.has(pinfl)) {
        // Vedomostda bir xodim ikki qatorda (masalan ikkinchi lavozim) — summalar qo'shiladi
        const first = det.vedomost ? parsed.find((p) => p.pinfl === pinfl) : undefined;
        if (first) {
          for (const [code, amount] of items) first.items.set(code, (first.items.get(code) ?? 0n) + amount);
          for (const [col, v] of raw) first.raw!.set(col, (first.raw!.get(col) ?? 0n) + v);
          if (fixed.total) {
            const t = parseNumber(row.getCell(fixed.total).value);
            if (t !== null && !Number.isNaN(t)) first.fileTotalTiyin = (first.fileTotalTiyin ?? 0n) + toTiyin(t);
          }
          mergedRows.push({ rowIndex: r, pinfl, intoRow: first.rowIndex });
          continue;
        }
        duplicates.push({ rowIndex: r, pinfl });
        continue;
      }
      seen.add(pinfl);

      const days = fixed.days ? parseNumber(row.getCell(fixed.days).value) : null;
      const rate = fixed.rate ? parseNumber(row.getCell(fixed.rate).value) : null;

      let fileTotalTiyin: bigint | null = null;
      if (fixed.total) {
        const total = parseNumber(row.getCell(fixed.total).value);
        if (total !== null && !Number.isNaN(total)) fileTotalTiyin = toTiyin(total);
      }

      const computed = this.rowTotal(items, signs);
      if (det.vedomost) {
        // ФОТ — taqqoslash qatorlar birlashtirilgandan keyin (pastda)
      } else if (fileTotalTiyin !== null && this.abs(fileTotalTiyin - computed) > DIFF_TOLERANCE_TIYIN) {
        totalMismatches.push({
          rowIndex: r,
          pinfl,
          fileTiyin: fileTotalTiyin.toString(),
          computedTiyin: computed.toString(),
        });
      }

      parsed.push({
        rowIndex: r,
        pinfl,
        fileName: fixed.fullName ? cellText(row.getCell(fixed.fullName).value) : '',
        workedDays: days === null || Number.isNaN(days) ? null : days,
        rate: rate === null || Number.isNaN(rate) ? null : rate,
        items,
        fileTotalTiyin,
        raw,
      });
    }

    if (parsed.length === 0 && invalidRows.length === 0) {
      throw new BadRequestException('Faylda xodim qatorlari topilmadi');
    }

    // Vedomost: fayldagi ФОТ = tarkib bo'lsin. Buxgalter formulaga qo'lda qo'shgan / ayirgan summa (ustunsiz)
    // «Vedomost farqi (+ / −)» komponentiga yoziladi va ro'yxatda ko'rsatiladi.
    const fotAdjustments: { rowIndex: number; pinfl: string; fileName: string; fileTiyin: string; computedTiyin: string; diffTiyin: string }[] = [];
    // Faqat tanish shaklda va hamma summa ustuni moslangan bo'lsa: aks holda farq — moslanmagan ustunlardan (taklif qilinadi)
    if (det.vedomost && fixed.total && trusted && unmappedWithValues.length === 0) {
      for (const p of parsed) {
        if (p.fileTotalTiyin === null) continue;
        p.items.delete('VED_FARQ');
        p.items.delete('VED_FARQ_M');
        const computed = this.rowTotal(p.items, signs);
        const diff = p.fileTotalTiyin - computed;
        if (this.abs(diff) <= DIFF_TOLERANCE_TIYIN) continue;
        const code = diff > 0n ? 'VED_FARQ' : 'VED_FARQ_M';
        if (!byCode.has(code)) {
          totalMismatches.push({ rowIndex: p.rowIndex, pinfl: p.pinfl, fileTiyin: p.fileTotalTiyin.toString(), computedTiyin: computed.toString() });
          continue;
        }
        p.items.set(code, this.abs(diff));
        fotAdjustments.push({ rowIndex: p.rowIndex, pinfl: p.pinfl, fileName: p.fileName, fileTiyin: p.fileTotalTiyin.toString(), computedTiyin: computed.toString(), diffTiyin: diff.toString() });
      }
    }

    const [registry, payroll, previous] = await Promise.all([
      this.registry(parsed.map((p) => p.pinfl), unit),
      this.payroll(period, unit),
      unit ? this.unitActive(unit, period) : this.activeBatch(period),
    ]);

    const unknownEmployees: AnalysisResult['unknownEmployees'] = [];

    const rows: CompositionRowDto[] = parsed.map((p) => {
      const reg = registry.get(p.pinfl);
      if (!reg) unknownEmployees.push({ rowIndex: p.rowIndex, pinfl: p.pinfl, fileName: p.fileName });

      const total = this.rowTotal(p.items, signs);
      const state = this.rowState(p.pinfl, total, payroll);

      return {
        rowIndex: p.rowIndex,
        pinfl: p.pinfl,
        fullName: reg?.fullName ?? (p.fileName && p.fileName !== "Reestrda yo'q" ? p.fileName : '—'),
        inRegistry: !!reg,
        unitName: reg?.unitName ?? null,
        workedDays: p.workedDays,
        rate: p.rate,
        items: this.mapToRecord(p.items),
        totalTiyin: total.toString(),
        payrollTiyin: state.payrollTiyin === null ? null : state.payrollTiyin.toString(),
        diffTiyin: state.diffTiyin === null ? null : state.diffTiyin.toString(),
        state: state.state,
      };
    });

    const check = await this.buildCheck(
      period,
      rows.map((r) => ({ pinfl: r.pinfl, fullName: r.fullName, totalTiyin: BigInt(r.totalTiyin) })),
      payroll,
      unit,
    );

    const usedCodes = new Set(colMap.map(([, code]) => code));
    const found = components.filter((c) => usedCodes.has(c.code));
    const missingColumns = components
      .filter((c) => c.isActive && !usedCodes.has(c.code))
      .map((c) => ({ code: c.code, name: c.name }));
    // Notanish shakl yoki tanish shaklda moslanmagan ustunlar bo'lsa — ФОТ bilan farq ham ko'rsatiladi
    if (!trusted || unmappedWithValues.length) {
      for (const p of parsed) {
        if (p.fileTotalTiyin === null || totalMismatches.some((m) => m.pinfl === p.pinfl)) continue;
        const computed = this.rowTotal(p.items, signs);
        if (this.abs(p.fileTotalTiyin - computed) > DIFF_TOLERANCE_TIYIN) totalMismatches.push({ rowIndex: p.rowIndex, pinfl: p.pinfl, fileTiyin: p.fileTotalTiyin.toString(), computedTiyin: computed.toString() });
      }
    }
    const mappingOut = smart ? this.mappingDto(smart, components) : null;
    const suggestions = smart ? this.suggestFixes(smart, parsed, payroll, signs, components) : null;

    const { byComponent, byCategory } = this.totals(parsed, components);

    return {
      period,
      fileName: file.originalname,
      sheetName: sheet.name,
      sheets: names,
      mapping: mappingOut,
      suggestions,
      skippedColumns: smart
        ? smart.columns.filter((c) => c.kind === 'amount' && !c.code && c.nonZero > 0).map((c) => ({ column: c.letter, label: c.label, reason: c.reason ?? 'tanilmadi' }))
        : det.skipped,
      fotAdjustments,
      mergedRows,
      totalRows,
      validRows: rows.length,
      columns: found.map((c) => this.toComponentDto(c)),
      missingColumns,
      invalidRows,
      duplicates,
      unknownEmployees,
      totalMismatches,
      hasPrevious: !!previous,
      byComponent,
      byCategory,
      check,
      rows,
    };
  }

  /** Ekran uchun: har ustun — turi, summasi, qo'llangan komponent va manbasi */
  private mappingDto(smart: SmartScan, components: SalaryComponent[]) {
    const name = new Map(components.map((c) => [c.code, c.name]));
    const kindOrder = { amount: 0, total: 1, deduct: 2, qualifier: 3, info: 4 } as const;
    return {
      headerRows: [smart.headerTop, smart.headerBottom] as [number, number],
      dataStart: smart.dataStart,
      pinflColumn: colLetter(smart.pinflCol),
      nameColumn: smart.nameCol ? colLetter(smart.nameCol) : null,
      totalColumn: smart.totalCol ? colLetter(smart.totalCol) : null,
      columns: smart.columns
        .filter((c) => c.kind !== 'info' || c.nonZero > 0)
        .sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.col - b.col)
        .map((c) => ({
          letter: c.letter,
          label: c.label,
          key: c.key,
          leaf: c.leaf,
          kind: c.kind,
          nonZero: c.nonZero,
          sumTiyin: c.sumTiyin.toString(),
          code: c.code,
          codeName: c.code ? (name.get(c.code) ?? c.code) : null,
          source: c.source,
          score: c.score,
          reason: c.reason,
        })),
    };
  }

  /**
   * Soliq hisoboti (bo'lsa) yoki fayldagi ФОТ bilan farq qilgan xodimlar bo'yicha: qaysi ustun farqni yopadi.
   *  • ADD — moslanmagan ustun: uning summasi farqqa teng (tarkibga qo'shish kerak);
   *  • SKIP — moslangan ustun: olib tashlansa farq yo'qoladi (jami / ikki marta sanalgan);
   *  • ALL — hamma moslanmagan ustunlar birgalikda farqni yopadi.
   */
  private suggestFixes(smart: SmartScan, parsed: ParsedRow[], payroll: PayrollInfo, signs: Map<string, number>, components: SalaryComponent[]) {
    const byCol = new Map(smart.columns.map((c) => [c.col, c]));
    const amount = smart.columns.filter((c) => c.kind === 'amount');
    const unmapped = amount.filter((c) => !c.code);
    const tol = DIFF_TOLERANCE_TIYIN;
    const stats = new Map<string, { col: number; action: 'ADD' | 'ADD_NEG' | 'SKIP'; rows: number; tiyin: bigint }>();
    let mismatched = 0;
    let allUnmapped = 0;
    const against: 'SOLIQ' | 'FILE' = payroll.uploaded ? 'SOLIQ' : 'FILE';
    for (const p of parsed) {
      const target = payroll.uploaded ? (payroll.map.get(p.pinfl) ?? null) : p.fileTotalTiyin;
      if (target === null) continue;
      const computed = this.rowTotal(p.items, signs);
      const d = target - computed;
      if (this.abs(d) <= tol) continue;
      mismatched += 1;
      const raw = p.raw ?? new Map<number, bigint>();
      let rest = 0n;
      for (const c of unmapped) rest += raw.get(c.col) ?? 0n;
      if (unmapped.length > 1 && this.abs(rest - d) <= tol) allUnmapped += 1;
      for (const c of amount) {
        const v = raw.get(c.col);
        if (!v) continue;
        const bump = (action: 'ADD' | 'ADD_NEG' | 'SKIP') => {
          const k = `${c.col}|${action}`;
          const s = stats.get(k) ?? { col: c.col, action, rows: 0, tiyin: 0n };
          s.rows += 1;
          s.tiyin += v;
          stats.set(k, s);
        };
        if (!c.code) {
          if (this.abs(v - d) <= tol) bump('ADD');
          else if (this.abs(v + d) <= tol) bump('ADD_NEG');
        } else {
          const sign = signs.get(c.code) ?? 1;
          if ((sign > 0 && this.abs(v + d) <= tol) || (sign < 0 && this.abs(v - d) <= tol)) bump('SKIP');
        }
      }
    }
    const name = new Map(components.map((c) => [c.code, c.name]));
    const items = [...stats.values()]
      .sort((a, b) => b.rows - a.rows)
      .slice(0, 10)
      .map((s) => {
        const c = byCol.get(s.col)!;
        const guess = s.action === 'ADD_NEG' ? 'JARIMA' : s.action === 'ADD' ? (guessComponent(c.leaf, c.key, components)?.code ?? 'BOSHQA') : null;
        return {
          letter: c.letter,
          label: c.label,
          action: s.action,
          rows: s.rows,
          tiyin: s.tiyin.toString(),
          /** Taklif qilingan kod (ADD) yoki SKIP */
          code: s.action === 'SKIP' ? SKIP : guess,
          codeName: s.action === 'SKIP' ? null : guess ? (name.get(guess) ?? guess) : null,
          currentCode: c.code,
        };
      });
    return { against, mismatched, allUnmapped, unmappedColumns: unmapped.filter((c) => c.nonZero > 0).length, items };
  }

  // ═══════════════════════════════════════════════════════════
  // Saqlash / bekor qilish
  // ═══════════════════════════════════════════════════════════

  async commit(input: {
    period: string;
    fileName: string;
    userId: string;
    rows: CommitRow[];
    /** Yo'nalish (Tax free …) — umumiy tarkibga tegmaydi, alohida saqlanadi */
    unit?: string;
  }): Promise<CommitResult> {
    const { period, rows, unit } = input;
    this.assertPeriod(period);

    if (rows.length === 0) throw new BadRequestException('Saqlash uchun ma\'lumot yo\'q');
    if (rows.length > 20000) throw new BadRequestException('Qatorlar juda ko\'p');

    const components = await this.allComponents();
    const signs = new Map(components.map((c) => [c.code, c.sign]));

    // ─── Tekshiruv ───
    const seen = new Set<string>();
    for (const row of rows) {
      if (!/^\d{14}$/.test(row.pinfl)) {
        throw new BadRequestException(`PINFL noto'g'ri: ${row.pinfl}`);
      }
      if (seen.has(row.pinfl)) throw new BadRequestException(`PINFL takrorlangan: ${row.pinfl}`);
      seen.add(row.pinfl);

      for (const [code, amount] of row.items) {
        if (!signs.has(code)) throw new BadRequestException(`Noma'lum komponent: ${code}`);
        if (amount < 0n) throw new BadRequestException(`Manfiy summa: ${row.pinfl} / ${code}`);
      }
    }

    // ─── Hisob ───
    const registry = await this.registry(rows.map((r) => r.pinfl), unit);
    const prepared = rows.map((row) => ({
      id: randomUUID(),
      row,
      fullName: registry.get(row.pinfl)?.fullName ?? row.fullName ?? null,
      total: this.rowTotal(row.items, signs),
    }));

    const grandTotal = prepared.reduce((sum, p) => sum + p.total, 0n);
    const itemCount = prepared.reduce(
      (sum, p) => sum + [...p.row.items.values()].filter((a) => a !== 0n).length,
      0,
    );

    const payroll = await this.payroll(period, unit);
    const check = await this.buildCheck(
      period,
      prepared.map((p) => ({ pinfl: p.row.pinfl, fullName: p.fullName ?? '—', totalTiyin: p.total })),
      payroll,
      unit,
    );
    const status: SalaryCompositionStatus =
      check.state === 'MATCHED' ? 'MATCHED' : check.state === 'MISMATCH' ? 'MISMATCH' : 'NO_PAYROLL';

    if (unit) return this.unitCommit({ unit, period, fileName: input.fileName, userId: input.userId, prepared, grandTotal, check, status });

    // ─── Tranzaksiya ───
    const result = await this.prisma.$transaction(
      async (tx) => {
        const previous = await tx.salaryCompositionBatch.findMany({
          where: { period, cancelledAt: null },
          select: { id: true },
        });
        const previousIds = previous.map((p) => p.id);

        if (previousIds.length > 0) {
          await tx.salaryCompositionItem.deleteMany({ where: { batchId: { in: previousIds } } });
          await tx.salaryCompositionRow.deleteMany({ where: { batchId: { in: previousIds } } });
          await tx.salaryCompositionBatch.updateMany({
            where: { id: { in: previousIds } },
            data: { cancelledAt: new Date() },
          });
        }

        const batch = await tx.salaryCompositionBatch.create({
          data: {
            period,
            fileName: input.fileName.slice(0, 255),
            employeeCount: prepared.length,
            totalTiyin: grandTotal,
            payrollTiyin: BigInt(check.payrollTiyin),
            status,
            mismatchCount: check.mismatchCount,
            uploadedById: input.userId,
          },
        });

        await tx.salaryCompositionRow.createMany({
          data: prepared.map((p) => ({
            id: p.id,
            batchId: batch.id,
            period,
            employeePinfl: p.row.pinfl,
            fullName: p.fullName,
            workedDays: p.row.workedDays,
            rate: p.row.rate,
            totalTiyin: p.total,
          })),
        });

        const items = prepared.flatMap((p) =>
          [...p.row.items.entries()]
            .filter(([, amount]) => amount !== 0n)
            .map(([componentCode, amountTiyin]) => ({
              batchId: batch.id,
              rowId: p.id,
              componentCode,
              amountTiyin,
            })),
        );

        const CHUNK = 5000;
        for (let i = 0; i < items.length; i += CHUNK) {
          await tx.salaryCompositionItem.createMany({ data: items.slice(i, i + CHUNK) });
        }

        // ─── Nazorat: yozilgan jami = hisoblangan jami ───
        const [rowSum, savedItems] = await Promise.all([
          tx.salaryCompositionRow.aggregate({
            where: { batchId: batch.id },
            _sum: { totalTiyin: true },
            _count: { _all: true },
          }),
          tx.salaryCompositionItem.count({ where: { batchId: batch.id } }),
        ]);

        if (
          (rowSum._sum.totalTiyin ?? 0n) !== grandTotal ||
          rowSum._count._all !== prepared.length ||
          savedItems !== itemCount
        ) {
          throw new BadRequestException('Saqlashda nazorat summasi mos kelmadi — hech narsa saqlanmadi');
        }

        return { batchId: batch.id, replacedPrevious: previousIds.length > 0 };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );

    // Bayram, choraklik pullar — hudud xodimlari ish haqidan Markaz hisobiga (vedomost bo'lsa)
    const split = await this.payrollService.regroup(period).catch((error: unknown) => {
      this.logger.warn(`Ish haqi Markaz ulushi hisoblanmadi (${period}): ${(error as Error).message}`);
      return null;
    });

    return {
      success: true,
      batchId: result.batchId,
      saved: prepared.length,
      replacedPrevious: result.replacedPrevious,
      totalTiyin: grandTotal.toString(),
      payrollTiyin: check.payrollTiyin,
      status,
      mismatchCount: check.mismatchCount,
      centerTiyin: (split?.centerTiyin ?? 0n).toString(),
      centerEmployees: split?.centerEmployees ?? 0,
    };
  }

  async cancel(batchId: string, unit?: string, period?: string): Promise<{ success: true; period: string }> {
    if (unit) return this.unitCancel(unit, period ?? '', batchId);
    const batch = await this.prisma.salaryCompositionBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('Yuklash topilmadi');
    if (batch.cancelledAt) throw new BadRequestException('Bu yuklash allaqachon bekor qilingan');

    await this.prisma.$transaction([
      this.prisma.salaryCompositionItem.deleteMany({ where: { batchId } }),
      this.prisma.salaryCompositionRow.deleteMany({ where: { batchId } }),
      this.prisma.salaryCompositionBatch.update({
        where: { id: batchId },
        data: { cancelledAt: new Date() },
      }),
    ]);
    // Tarkib bekor qilindi — Markazga o'tgan qism hududga qaytadi
    await this.payrollService.regroup(batch.period).catch((error: unknown) => {
      this.logger.warn(`Ish haqi qayta guruhlanmadi (${batch.period}): ${(error as Error).message}`);
    });

    return { success: true, period: batch.period };
  }

  async batches(period?: string, unit?: string): Promise<BatchDto[]> {
    if (period) this.assertPeriod(period);
    if (unit) {
      if (!period) throw new BadRequestException('Oy (period) kerak');
      const list = [...(await this.unitBatches(unit, period))].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return this.toBatchDtos(list.map((b) => this.unitBatchRecord(b)));
    }

    const list = await this.prisma.salaryCompositionBatch.findMany({
      where: period ? { period } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return this.toBatchDtos(list);
  }

  // ═══════════════════════════════════════════════════════════
  // Ko'rish va tekshiruv
  // ═══════════════════════════════════════════════════════════

  /** Oy holati — ish haqi sahifasidagi belgi uchun (jonli hisoblanadi) */
  async check(period: string, unit?: string): Promise<CheckSummary> {
    this.assertPeriod(period);
    if (unit) {
      const [batch, payroll] = await Promise.all([this.unitActive(unit, period), this.payroll(period, unit)]);
      return this.buildCheck(period, batch ? batch.rows.map((r) => ({ pinfl: r.pinfl, fullName: r.fullName ?? '—', totalTiyin: BigInt(r.totalTiyin) })) : null, payroll, unit);
    }

    const [batch, payroll] = await Promise.all([this.activeBatch(period), this.payroll(period)]);
    if (!batch) return this.buildCheck(period, null, payroll);

    const rows = await this.prisma.salaryCompositionRow.findMany({
      where: { batchId: batch.id },
      select: { employeePinfl: true, fullName: true, totalTiyin: true },
    });

    const summary = await this.buildCheck(
      period,
      rows.map((r) => ({ pinfl: r.employeePinfl, fullName: r.fullName ?? '—', totalTiyin: r.totalTiyin })),
      payroll,
    );

    await this.syncBatchStatus(batch.id, batch.status, batch.mismatchCount, batch.payrollTiyin, summary);
    return summary;
  }

  /** Soliq hisoboti keyin o'zgargan bo'lsa — saqlangan holatni yangilaymiz */
  private async syncBatchStatus(
    batchId: string,
    status: SalaryCompositionStatus,
    mismatchCount: number,
    payrollTiyin: bigint,
    summary: CheckSummary,
  ): Promise<void> {
    const nextStatus: SalaryCompositionStatus =
      summary.state === 'MATCHED' ? 'MATCHED' : summary.state === 'MISMATCH' ? 'MISMATCH' : 'NO_PAYROLL';
    const nextPayroll = BigInt(summary.payrollTiyin);

    if (nextStatus !== status || summary.mismatchCount !== mismatchCount || nextPayroll !== payrollTiyin) {
      await this.prisma.salaryCompositionBatch.update({
        where: { id: batchId },
        data: { status: nextStatus, mismatchCount: summary.mismatchCount, payrollTiyin: nextPayroll },
      });
    }
  }

  /** Oy tarkibi: xodimlar, komponentlar, jamilar va tekshiruv */
  async view(period: string, unit?: string): Promise<CompositionView> {
    this.assertPeriod(period);
    if (unit) return this.unitView(period, unit);

    const [batch, payroll, components, usage] = await Promise.all([
      this.activeBatch(period),
      this.payroll(period),
      this.allComponents(),
      this.usageCounts(),
    ]);

    if (!batch) {
      return {
        period,
        batch: null,
        components: components
          .filter((c) => c.isActive)
          .map((c) => this.toComponentDto(c, usage.get(c.code) ?? 0)),
        byComponent: [],
        byCategory: [],
        check: await this.buildCheck(period, null, payroll),
        rows: [],
      };
    }

    const dbRows = await this.prisma.salaryCompositionRow.findMany({
      where: { batchId: batch.id },
      include: { items: { select: { componentCode: true, amountTiyin: true } } },
    });

    const registry = await this.registry(dbRows.map((r) => r.employeePinfl));

    const withItems = dbRows.map((r) => ({
      row: r,
      items: new Map(r.items.map((i) => [i.componentCode, i.amountTiyin])),
    }));

    const usedCodes = new Set(withItems.flatMap((r) => [...r.items.keys()]));
    const visible = components.filter((c) => c.isActive || usedCodes.has(c.code));

    const rows: CompositionRowDto[] = withItems
      .map(({ row, items }) => {
        const reg = registry.get(row.employeePinfl);
        const state = this.rowState(row.employeePinfl, row.totalTiyin, payroll);
        return {
          rowIndex: null,
          pinfl: row.employeePinfl,
          fullName: reg?.fullName ?? row.fullName ?? '—',
          inRegistry: !!reg,
          unitName: reg?.unitName ?? null,
          workedDays: row.workedDays,
          rate: row.rate,
          items: this.mapToRecord(items),
          totalTiyin: row.totalTiyin.toString(),
          payrollTiyin: state.payrollTiyin === null ? null : state.payrollTiyin.toString(),
          diffTiyin: state.diffTiyin === null ? null : state.diffTiyin.toString(),
          state: state.state,
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));

    const check = await this.buildCheck(
      period,
      rows.map((r) => ({ pinfl: r.pinfl, fullName: r.fullName, totalTiyin: BigInt(r.totalTiyin) })),
      payroll,
    );
    await this.syncBatchStatus(batch.id, batch.status, batch.mismatchCount, batch.payrollTiyin, check);

    const { byComponent, byCategory } = this.totals(withItems, components);
    const [batchDto] = await this.toBatchDtos([
      { ...batch, status: check.state === 'MATCHED' ? 'MATCHED' : check.state === 'MISMATCH' ? 'MISMATCH' : 'NO_PAYROLL', mismatchCount: check.mismatchCount },
    ]);

    return {
      period,
      batch: batchDto ?? null,
      components: visible.map((c) => this.toComponentDto(c, usage.get(c.code) ?? 0)),
      byComponent,
      byCategory,
      check,
      rows,
    };
  }

  /** Bitta xodimning oylar bo'yicha tarkibi */
  async employeeHistory(pinfl: string, from?: string, to?: string, unit?: string): Promise<EmployeeHistory> {
    if (!/^\d{14}$/.test(pinfl ?? '')) throw new BadRequestException('PINFL noto\'g\'ri');
    if (from) this.assertPeriod(from);
    if (to) this.assertPeriod(to);
    if (unit) return this.unitEmployeeHistory(pinfl, unit, from, to);

    const periodFilter: { gte?: string; lte?: string } = {};
    if (from) periodFilter.gte = from;
    if (to) periodFilter.lte = to;

    const [dbRows, components, registry] = await Promise.all([
      this.prisma.salaryCompositionRow.findMany({
        where: {
          employeePinfl: pinfl,
          batch: { cancelledAt: null },
          ...(from || to ? { period: periodFilter } : {}),
        },
        include: { items: { select: { componentCode: true, amountTiyin: true } } },
        orderBy: { period: 'asc' },
      }),
      this.allComponents(),
      this.registry([pinfl]),
    ]);

    const reg = registry.get(pinfl);
    if (!reg && dbRows.length === 0) throw new NotFoundException('Xodim topilmadi');

    const periods = [...new Set(dbRows.map((r) => r.period))];
    const payrolls = new Map<string, PayrollInfo>();
    for (const period of periods) {
      payrolls.set(period, await this.payroll(period));
    }

    const withItems = dbRows.map((r) => ({
      row: r,
      items: new Map(r.items.map((i) => [i.componentCode, i.amountTiyin])),
    }));
    const usedCodes = new Set(withItems.flatMap((r) => [...r.items.keys()]));

    const { byCategory } = this.totals(withItems, components);

    return {
      employee: {
        pinfl,
        fullName: reg?.fullName ?? dbRows[0]?.fullName ?? '—',
        unitName: reg?.unitName ?? null,
        inRegistry: !!reg,
      },
      components: components.filter((c) => usedCodes.has(c.code)).map((c) => this.toComponentDto(c)),
      periods: withItems.map(({ row, items }) => {
        const payroll = payrolls.get(row.period) ?? { uploaded: false, map: new Map<string, bigint>(), central: new Set<string>(), regionOf: new Map<string, string>() };
        const state = this.rowState(pinfl, row.totalTiyin, payroll);
        return {
          period: row.period,
          workedDays: row.workedDays,
          rate: row.rate,
          items: this.mapToRecord(items),
          totalTiyin: row.totalTiyin.toString(),
          payrollTiyin: state.payrollTiyin === null ? null : state.payrollTiyin.toString(),
          diffTiyin: state.diffTiyin === null ? null : state.diffTiyin.toString(),
          state: state.state,
        };
      }),
      byCategory,
    };
  }

  // ═══════════════════════════════════════════════════════════
  // Excel eksport
  // ═══════════════════════════════════════════════════════════

  async exportExcel(period: string, unit?: string): Promise<{ buffer: Buffer; filename: string }> {
    const view = await this.view(period, unit);
    if (!view.batch) throw new NotFoundException('Bu oy uchun tarkib yuklanmagan');

    const workbook = buildExportWorkbook(view);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const tag = unit ? `-${entryUnitLabel(unit).replace(/\s+/g, '-')}` : '';
    return { buffer, filename: `ish-haqi-tarkibi${tag}-${period}-hisobot.xlsx` };
  }

  // ═══════════════════════════════════════════════════════════
  // Yo'nalish (Tax free …) ish haqi tarkibi — umumiy tarkibdan ALOHIDA.
  // Shablon va fayl o'qish — avvalgidek (vedomost shakli). Farqi:
  //  • xodimlar — faqat shu bo'lim xodimlari (Xarajatlar › <yo'nalish> › Ish haqi ro'yxati);
  //  • solishtirish — shu bo'lim ish haqi vedomosti bilan;
  //  • saqlash — `settings` jadvali (unit.composition.<BO'LIM>.<OY>), umumiy tarkib va Markaz ulushiga tegmaydi.
  // ═══════════════════════════════════════════════════════════

  private unitService(): UnitPayrollService {
    if (!this.unitPayroll) throw new BadRequestException("Yo'nalish ish haqi moduli ulanmagan");
    return this.unitPayroll;
  }

  private unitKey(unit: string, period: string): string {
    return `unit.composition.${unit}.${period}`;
  }

  private readUnitList(value: unknown): UnitCompBatch[] {
    const list = (value as { batches?: unknown } | null)?.batches;
    return Array.isArray(list) ? (list as UnitCompBatch[]) : [];
  }

  private async unitBatches(unit: string, period: string): Promise<UnitCompBatch[]> {
    const row = await this.prisma.setting.findUnique({ where: { key: this.unitKey(unit, period) } });
    return this.readUnitList(row?.value ?? null);
  }

  private async unitActive(unit: string, period: string): Promise<UnitCompBatch | null> {
    const list = (await this.unitBatches(unit, period)).filter((b) => !b.cancelledAt);
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  /** Saqlangan yuklama → toBatchDtos shakli */
  private unitBatchRecord(b: UnitCompBatch) {
    return {
      id: b.id,
      period: b.period,
      fileName: b.fileName,
      employeeCount: b.employeeCount,
      totalTiyin: BigInt(b.totalTiyin),
      payrollTiyin: BigInt(b.payrollTiyin),
      status: b.status,
      mismatchCount: b.mismatchCount,
      uploadedById: b.uploadedById,
      createdAt: new Date(b.createdAt),
      cancelledAt: b.cancelledAt ? new Date(b.cancelledAt) : null,
    };
  }

  /** Ism: avval umumiy xodimlar bazasi, bo'lmasa — bo'lim ro'yxati */
  private async unitRegistry(pinfls: string[], unit: string): Promise<Map<string, RegistryInfo>> {
    const label = entryUnitLabel(unit);
    const map = new Map<string, RegistryInfo>();
    const want = new Set(pinfls);
    for (const s of await this.unitService().staffOf(unit)) if (want.has(s.pinfl)) map.set(s.pinfl, { fullName: s.fullName, unitName: label });
    const general = await this.prisma.employee.findMany({ where: { pinfl: { in: pinfls } }, select: { pinfl: true, fullName: true } });
    for (const e of general) map.set(e.pinfl, { fullName: e.fullName, unitName: label });
    return map;
  }

  private async unitTemplate(period: string, unit: string, components: SalaryComponent[]): Promise<{ buffer: Buffer; filename: string }> {
    const label = entryUnitLabel(unit);
    const payroll = await this.payroll(period, unit);
    const staff = await this.unitService().staffOf(unit);
    // Xodimlar: bo'limning faol xodimlari + shu oy ish haqi vedomostidagilar (ketgan bo'lsa ham)
    const pinfls = new Set([...staff.filter((s) => s.active).map((s) => s.pinfl), ...payroll.map.keys()]);
    const names = await this.unitRegistry([...pinfls], unit);
    const byPinfl = new Map(staff.map((s) => [s.pinfl, s]));
    const employees = [...pinfls]
      .map((pinfl) => ({
        pinfl,
        fullName: names.get(pinfl)?.fullName ?? pinfl,
        position: byPinfl.get(pinfl)?.position ?? null,
        regionCode: CENTRAL_REGION,
        region: null,
        department: { name: label },
      }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    const workbook = buildVedomostWorkbook({ period, components, employees, payroll });
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, filename: `ish-haqi-tarkibi-${label.replace(/\s+/g, '-')}-${period}.xlsx` };
  }

  private async unitCommit(p: {
    unit: string;
    period: string;
    fileName: string;
    userId: string;
    prepared: { row: CommitRow; fullName: string | null; total: bigint }[];
    grandTotal: bigint;
    check: CheckSummary;
    status: SalaryCompositionStatus;
  }): Promise<CommitResult> {
    const key = this.unitKey(p.unit, p.period);
    const batch: UnitCompBatch = {
      id: randomUUID(),
      period: p.period,
      fileName: p.fileName.slice(0, 255),
      employeeCount: p.prepared.length,
      totalTiyin: p.grandTotal.toString(),
      payrollTiyin: p.check.payrollTiyin,
      status: p.status,
      mismatchCount: p.check.mismatchCount,
      uploadedById: p.userId,
      createdAt: new Date().toISOString(),
      cancelledAt: null,
      rows: p.prepared.map((x) => ({
        pinfl: x.row.pinfl,
        fullName: x.fullName,
        workedDays: x.row.workedDays,
        rate: x.row.rate,
        totalTiyin: x.total.toString(),
        items: this.mapToRecord(x.row.items),
      })),
    };
    // Nazorat: qatorlar jami = umumiy jami
    const sum = batch.rows.reduce((s, r) => s + BigInt(r.totalTiyin), 0n);
    if (sum !== p.grandTotal) throw new BadRequestException('Saqlashda nazorat summasi mos kelmadi — hech narsa saqlanmadi');

    const replaced = await this.prisma.$transaction(async (tx) => {
      const list = this.readUnitList((await tx.setting.findUnique({ where: { key } }))?.value ?? null);
      const now = new Date().toISOString();
      let n = 0;
      for (const b of list) {
        if (b.cancelledAt) continue;
        b.cancelledAt = now;
        b.rows = []; // bekor qilingan tarkib qatorlari saqlanmaydi (umumiy tarkibdagidek)
        n += 1;
      }
      const value = { batches: [...list, batch] } as object;
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
      return n;
    });
    // Ish haqi qismlari (bo'lim siyosati bo'yicha) — yangi tarkib asosida qayta ajratiladi
    await this.unitPayroll?.splitComponents(p.unit, p.period).catch(() => null);

    return {
      success: true,
      batchId: batch.id,
      saved: batch.rows.length,
      replacedPrevious: replaced > 0,
      totalTiyin: batch.totalTiyin,
      payrollTiyin: batch.payrollTiyin,
      status: p.status,
      mismatchCount: p.check.mismatchCount,
      centerTiyin: '0',
      centerEmployees: 0,
    };
  }

  private async unitCancel(unit: string, period: string, batchId: string): Promise<{ success: true; period: string }> {
    this.assertPeriod(period);
    const key = this.unitKey(unit, period);
    await this.prisma.$transaction(async (tx) => {
      const list = this.readUnitList((await tx.setting.findUnique({ where: { key } }))?.value ?? null);
      const b = list.find((x) => x.id === batchId);
      if (!b) throw new NotFoundException('Yuklash topilmadi');
      if (b.cancelledAt) throw new BadRequestException('Bu yuklash allaqachon bekor qilingan');
      b.cancelledAt = new Date().toISOString();
      b.rows = [];
      const value = { batches: list } as object;
      await tx.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
    });
    await this.unitPayroll?.splitComponents(unit, period).catch(() => null);
    return { success: true, period };
  }

  private async unitView(period: string, unit: string): Promise<CompositionView> {
    const [batch, payroll, components, usage] = await Promise.all([this.unitActive(unit, period), this.payroll(period, unit), this.allComponents(), this.usageCounts()]);
    if (!batch) {
      return {
        period,
        batch: null,
        components: components.filter((c) => c.isActive).map((c) => this.toComponentDto(c, usage.get(c.code) ?? 0)),
        byComponent: [],
        byCategory: [],
        check: await this.buildCheck(period, null, payroll, unit),
        rows: [],
      };
    }
    const registry = await this.unitRegistry(batch.rows.map((r) => r.pinfl), unit);
    const withItems = batch.rows.map((r) => ({ r, items: new Map(Object.entries(r.items ?? {}).map(([c, v]) => [c, BigInt(v)])) }));
    const usedCodes = new Set(withItems.flatMap((x) => [...x.items.keys()]));
    const visible = components.filter((c) => c.isActive || usedCodes.has(c.code));
    const rows: CompositionRowDto[] = withItems
      .map(({ r, items }) => {
        const reg = registry.get(r.pinfl);
        const total = BigInt(r.totalTiyin);
        const state = this.rowState(r.pinfl, total, payroll);
        return {
          rowIndex: null,
          pinfl: r.pinfl,
          fullName: reg?.fullName ?? r.fullName ?? '—',
          inRegistry: !!reg,
          unitName: reg?.unitName ?? entryUnitLabel(unit),
          workedDays: r.workedDays,
          rate: r.rate,
          items: this.mapToRecord(items),
          totalTiyin: r.totalTiyin,
          payrollTiyin: state.payrollTiyin === null ? null : state.payrollTiyin.toString(),
          diffTiyin: state.diffTiyin === null ? null : state.diffTiyin.toString(),
          state: state.state,
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    const check = await this.buildCheck(period, rows.map((r) => ({ pinfl: r.pinfl, fullName: r.fullName, totalTiyin: BigInt(r.totalTiyin) })), payroll, unit);
    const { byComponent, byCategory } = this.totals(withItems, components);
    const status: SalaryCompositionStatus = check.state === 'MATCHED' ? 'MATCHED' : check.state === 'MISMATCH' ? 'MISMATCH' : 'NO_PAYROLL';
    const [batchDto] = await this.toBatchDtos([{ ...this.unitBatchRecord(batch), status, mismatchCount: check.mismatchCount, payrollTiyin: BigInt(check.payrollTiyin) }]);
    return { period, batch: batchDto ?? null, components: visible.map((c) => this.toComponentDto(c, usage.get(c.code) ?? 0)), byComponent, byCategory, check, rows };
  }

  private async unitEmployeeHistory(pinfl: string, unit: string, from?: string, to?: string): Promise<EmployeeHistory> {
    const prefix = `unit.composition.${unit}.`;
    const settings = await this.prisma.setting.findMany({ where: { key: { startsWith: prefix } } });
    const found: { period: string; row: UnitCompRow }[] = [];
    for (const s of settings) {
      const period = s.key.slice(prefix.length);
      if (!/^\d{4}-\d{2}$/.test(period) || (from && period < from) || (to && period > to)) continue;
      const active = this.readUnitList(s.value).filter((b) => !b.cancelledAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const row = active?.rows.find((r) => r.pinfl === pinfl);
      if (row) found.push({ period, row });
    }
    found.sort((a, b) => a.period.localeCompare(b.period));
    const [components, registry] = await Promise.all([this.allComponents(), this.unitRegistry([pinfl], unit)]);
    const reg = registry.get(pinfl);
    if (!reg && found.length === 0) throw new NotFoundException('Xodim topilmadi');
    const withItems = found.map((f) => ({ ...f, items: new Map(Object.entries(f.row.items ?? {}).map(([c, v]) => [c, BigInt(v)])) }));
    const usedCodes = new Set(withItems.flatMap((x) => [...x.items.keys()]));
    const { byCategory } = this.totals(withItems, components);
    const periods = [];
    for (const { period, row, items } of withItems) {
      const payroll = await this.payroll(period, unit);
      const state = this.rowState(pinfl, BigInt(row.totalTiyin), payroll);
      periods.push({
        period,
        workedDays: row.workedDays,
        rate: row.rate,
        items: this.mapToRecord(items),
        totalTiyin: row.totalTiyin,
        payrollTiyin: state.payrollTiyin === null ? null : state.payrollTiyin.toString(),
        diffTiyin: state.diffTiyin === null ? null : state.diffTiyin.toString(),
        state: state.state,
      });
    }
    return {
      employee: { pinfl, fullName: reg?.fullName ?? found[0]?.row.fullName ?? '—', unitName: entryUnitLabel(unit), inRegistry: !!reg },
      components: components.filter((c) => usedCodes.has(c.code)).map((c) => this.toComponentDto(c)),
      periods,
      byCategory,
    };
  }
}

/** Yo'nalish tarkibi qatori (settings'da) */
interface UnitCompRow {
  pinfl: string;
  fullName: string | null;
  workedDays: number | null;
  rate: number | null;
  totalTiyin: string;
  items: Record<string, string>;
}

/** Yo'nalish tarkibi yuklamasi (settings'da) */
interface UnitCompBatch {
  id: string;
  period: string;
  fileName: string;
  employeeCount: number;
  totalTiyin: string;
  payrollTiyin: string;
  status: SalaryCompositionStatus;
  mismatchCount: number;
  uploadedById: string;
  createdAt: string;
  cancelledAt: string | null;
  rows: UnitCompRow[];
}

/** Ustun harfi → raqam (A → 1) */
function colIndexOf(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Ustun raqami → harf */
function colLetter(index: number): string {
  let out = '';
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export type { SmartColumn };