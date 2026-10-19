import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
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
import { PayrollService } from '../payroll/payroll.service';
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
    buildTemplateWorkbook,
    cellText,
    detectColumns,
    parseNumber,
    toTiyin,
} from './salary-composition.excel';
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

// ═══════════════════════════════════════════════════════════
// Servis
// ═══════════════════════════════════════════════════════════

@Injectable()
export class SalaryCompositionService implements OnModuleInit {
  private readonly logger = new Logger(SalaryCompositionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payrollService: PayrollService,
  ) {}

  /** Komponentlar jadvali bo'sh bo'lsa — standart komponentlarni yozamiz; keyin qo'shilgan «Choraklik mukofot» — mavjud bazaga ham */
  async onModuleInit(): Promise<void> {
    try {
      const count = await this.prisma.salaryComponent.count();
      if (count > 0) {
        const chorak = DEFAULT_COMPONENTS.find((c) => c.code === 'CHORAK');
        if (chorak && !(await this.prisma.salaryComponent.findUnique({ where: { code: 'CHORAK' } }))) {
          await this.prisma.salaryComponent.create({ data: { ...chorak } }).catch(() => null);
          this.logger.log("Ish haqi komponenti qo'shildi: Choraklik mukofot");
        }
        return;
      }

      await this.prisma.salaryComponent.createMany({
        data: DEFAULT_COMPONENTS.map((item) => ({ ...item })),
        skipDuplicates: true,
      });
      this.logger.log(`Ish haqi komponentlari yaratildi: ${DEFAULT_COMPONENTS.length} ta`);
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
  private async registry(pinfls: string[]): Promise<Map<string, RegistryInfo>> {
    const map = new Map<string, RegistryInfo>();
    if (pinfls.length === 0) return map;

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
  private async payroll(period: string): Promise<PayrollInfo> {
    const batchCount = await this.prisma.payrollBatch.count({
      where: { period, status: 'COMMITTED' },
    });

    const map = new Map<string, bigint>();
    if (batchCount === 0) return { uploaded: false, map };

    // To'liq (soliq hisobotidagi) summa: baseTiyin. totalTiyin — hududda qolgan qism (bayram, choraklik Markazga o'tgan)
    const grouped = await this.prisma.payrollEntry.groupBy({
      by: ['employeePinfl'],
      where: { period, deletedAt: null, batch: { status: 'COMMITTED' } },
      _sum: { baseTiyin: true },
    });

    for (const item of grouped) {
      map.set(item.employeePinfl, item._sum.baseTiyin ?? 0n);
    }
    return { uploaded: true, map };
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
  ): Promise<CheckSummary> {
    const compositionUploaded = rows !== null;
    const list = rows ?? [];

    let compositionTotal = 0n;
    let payrollTotal = 0n;
    for (const value of payroll.map.values()) payrollTotal += value;

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
        ([pinfl, amount]) => amount !== 0n && !inComposition.has(pinfl),
      );
      const names = await this.registry(absent.map(([pinfl]) => pinfl));

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

  async buildTemplate(period: string): Promise<{ buffer: Buffer; filename: string }> {
    this.assertPeriod(period);

    const components = (await this.allComponents()).filter((c) => c.isActive);
    if (components.length === 0) {
      throw new BadRequestException('Faol komponent yo\'q — Sozlamalarda komponent qo\'shing');
    }

    const payroll = await this.payroll(period);

    // Xodimlar varag'i: faol xodimlar + shu oy ish haqi olganlar
    const employees = await this.prisma.employee.findMany({
      where: {
        OR: [{ isActive: true }, { pinfl: { in: [...payroll.map.keys()] } }],
      },
      select: {
        pinfl: true,
        fullName: true,
        regionCode: true,
        region: { select: { name: true } },
        department: { select: { name: true } },
      },
      orderBy: { fullName: 'asc' },
    });

    const workbook = buildTemplateWorkbook({ period, components, employees, payroll });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, filename: `ish-haqi-tarkibi-${period}.xlsx` };
  }

  // ═══════════════════════════════════════════════════════════
  // Faylni o'qish
  // ═══════════════════════════════════════════════════════════

  async analyze(period: string, file: Express.Multer.File | undefined): Promise<AnalysisResult> {
    this.assertPeriod(period);
    if (!file) throw new BadRequestException('Fayl yuklanmadi');

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as unknown as ExcelJS.Buffer);
    } catch {
      throw new BadRequestException('Faylni o\'qib bo\'lmadi — .xlsx formatida saqlang');
    }

    const sheet = workbook.getWorksheet('Tarkib') ?? workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('Faylda varaq yo\'q');

    const components = await this.allComponents();
    const signs = new Map(components.map((c) => [c.code, c.sign]));
    const byCode = new Map(components.map((c) => [c.code, c]));

    const { headerRow, fixed, comps } = detectColumns(sheet, components);

    const invalidRows: AnalysisResult['invalidRows'] = [];
    const duplicates: AnalysisResult['duplicates'] = [];
    const totalMismatches: AnalysisResult['totalMismatches'] = [];
    const parsed: ParsedRow[] = [];
    const seen = new Set<string>();
    let totalRows = 0;

    const pinflCol = fixed.pinfl as number;

    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const pinflRaw = cellText(row.getCell(pinflCol).value);

      // Kodlar qatori (nomlar bo'yicha topilgan bo'lsa) yoki JAMI qatori — o'tkazamiz
      const upper = pinflRaw.toUpperCase();
      if (upper === 'JAMI' || upper === SERVICE_CODES.pinfl) continue;

      // Summalarni o'qiymiz
      const items = new Map<string, bigint>();
      const errors: string[] = [];
      let hasAmount = false;

      for (const [code, col] of comps) {
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
          else {
            errors.push(`${component.name}: manfiy summa`);
            continue;
          }
        }

        const tiyin = toTiyin(amount);
        if (tiyin !== 0n) {
          items.set(code, tiyin);
          hasAmount = true;
        }
      }

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
      if (fileTotalTiyin !== null && this.abs(fileTotalTiyin - computed) > DIFF_TOLERANCE_TIYIN) {
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
      });
    }

    if (parsed.length === 0 && invalidRows.length === 0) {
      throw new BadRequestException('Faylda xodim qatorlari topilmadi');
    }

    const [registry, payroll, previous] = await Promise.all([
      this.registry(parsed.map((p) => p.pinfl)),
      this.payroll(period),
      this.activeBatch(period),
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
    );

    const found = components.filter((c) => comps.has(c.code));
    const missingColumns = components
      .filter((c) => c.isActive && !comps.has(c.code))
      .map((c) => ({ code: c.code, name: c.name }));

    const { byComponent, byCategory } = this.totals(parsed, components);

    return {
      period,
      fileName: file.originalname,
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

  // ═══════════════════════════════════════════════════════════
  // Saqlash / bekor qilish
  // ═══════════════════════════════════════════════════════════

  async commit(input: {
    period: string;
    fileName: string;
    userId: string;
    rows: CommitRow[];
  }): Promise<CommitResult> {
    const { period, rows } = input;
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
    const registry = await this.registry(rows.map((r) => r.pinfl));
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

    const payroll = await this.payroll(period);
    const check = await this.buildCheck(
      period,
      prepared.map((p) => ({ pinfl: p.row.pinfl, fullName: p.fullName ?? '—', totalTiyin: p.total })),
      payroll,
    );
    const status: SalaryCompositionStatus =
      check.state === 'MATCHED' ? 'MATCHED' : check.state === 'MISMATCH' ? 'MISMATCH' : 'NO_PAYROLL';

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

  async cancel(batchId: string): Promise<{ success: true; period: string }> {
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

  async batches(period?: string): Promise<BatchDto[]> {
    if (period) this.assertPeriod(period);

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
  async check(period: string): Promise<CheckSummary> {
    this.assertPeriod(period);

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
  async view(period: string): Promise<CompositionView> {
    this.assertPeriod(period);

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
  async employeeHistory(pinfl: string, from?: string, to?: string): Promise<EmployeeHistory> {
    if (!/^\d{14}$/.test(pinfl ?? '')) throw new BadRequestException('PINFL noto\'g\'ri');
    if (from) this.assertPeriod(from);
    if (to) this.assertPeriod(to);

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
        const payroll = payrolls.get(row.period) ?? { uploaded: false, map: new Map<string, bigint>() };
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

  async exportExcel(period: string): Promise<{ buffer: Buffer; filename: string }> {
    const view = await this.view(period);
    if (!view.batch) throw new NotFoundException('Bu oy uchun tarkib yuklanmagan');

    const workbook = buildExportWorkbook(view);

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, filename: `ish-haqi-tarkibi-${period}-hisobot.xlsx` };
  }
}