import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';

const CENTRAL_REGION = 0;
const PAYROLL_CATEGORY = 'PAYROLL_BASE';
const TASHKENT_OFFSET_HOURS = 5;

/** Faylning bitta qatori */
interface ParsedRow {
  rowIndex: number;
  pinfl: string;
  amountTiyin: bigint;
}

/** Xodim bilan bog'langan qator */
interface MatchedRow extends ParsedRow {
  fullName: string;
  regionCode: number;
  regionName: string;
  districtName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  employmentType: string;
  /** Guruh kaliti - xarajatlarni yigish uchun */
  groupKey: string;
  groupLabel: string;
}

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

  // --------- Yordamchilar ---------

  /** Davr oxirgi kunini qaytaradi - xarajat sanasi shu boladi */
  private periodEndDate(period: string): Date {
    const match = /^(\d{4})-(\d{2})$/.exec(period);
    if (!match) {
      throw new BadRequestException('Davr notogri formatda');
    }

    const year = Number(match[1]);
    const month = Number(match[2]);

    // Keyingi oyning birinchi kunidan bir kun oldin
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    return new Date(
      Date.UTC(nextYear, nextMonth - 1, 1, -TASHKENT_OFFSET_HOURS) - 86400000,
    );
  }

  /** Matndan summani ajratadi - "1 250 000" va "1250000.50" ishlaydi */
  private parseAmount(value: unknown): bigint | null {
    if (value === null || value === undefined || value === '') return null;

    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value <= 0) return null;
      return BigInt(Math.round(value * 100));
    }

    const text = String(value)
      .replace(/[\s\u00A0\u202F]/g, '')
      .replace(',', '.');

    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;

    return BigInt(Math.round(parsed * 100));
  }

  /** PINFL ni tozalaydi va tekshiradi */
  private parsePinfl(value: unknown): string | null {
    if (value === null || value === undefined) return null;

    const text = String(value).replace(/\D/g, '');
    return /^\d{14}$/.test(text) ? text : null;
  }

  // --------- Shablon ---------

  /**
   * Bosh shablon yasaydi.
   *
   * Ikki ustun: PINFL va summa. Qolgan malumot reestrdan tortiladi.
   * Yordamchi varaqda faol xodimlar royxati bor - nusxalash uchun.
   */
  async buildTemplate(period: string): Promise<{ buffer: Buffer; filename: string }> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Korxona tahlil';

    const sheet = workbook.addWorksheet('Ish haqi');

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

    // Namuna qator
    sheet.addRow({ pinfl: '12345678901234', amount: 5000000 });
    sheet.getRow(2).font = { color: { argb: 'FF94A3B8' }, italic: true };

    // Yordamchi varaq - faol xodimlar
    const employees = await this.prisma.employee.findMany({
      where: { isActive: true },
      orderBy: { fullName: 'asc' },
      include: {
        region: { select: { name: true } },
        district: { select: { name: true } },
        department: { select: { name: true } },
      },
    });

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

    for (const emp of employees) {
      ref.addRow({
        pinfl: emp.pinfl,
        fullName: emp.fullName,
        type: emp.employmentType === 'SHTAT' ? 'Shtat' : 'Shartnoma',
        place:
          emp.regionCode === CENTRAL_REGION
            ? (emp.department?.name ?? 'Markaz')
            : `${emp.region.name}${emp.district ? ` / ${emp.district.name}` : ''}`,
      });
    }

    ref.autoFilter = { from: 'A1', to: `D${ref.rowCount}` };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      filename: `Ish-haqi-${period}.xlsx`,
    };
  }

  // --------- Yuklash va tahlil ---------

  /**
   * Faylni oqiydi va reestr bilan solishtiradi.
   * Hech narsa saqlanmaydi - faqat natija qaytariladi.
   */
  async analyze(period: string, file: Express.Multer.File, userId: string) {
    if (!file) {
      throw new BadRequestException('Fayl yuklanmadi');
    }

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');

    // Bu davr uchun tasdiqlangan yuklash bormi
    const existing = await this.prisma.payrollBatch.findFirst({
      where: { period, status: 'COMMITTED' },
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('Faylda varaq topilmadi');
    }

    // Qatorlarni oqiymiz
    const rows: ParsedRow[] = [];
    const invalidRows: { rowIndex: number; reason: string }[] = [];

    sheet.eachRow((row, rowIndex) => {
      if (rowIndex === 1) return; // sarlavha

      const pinfl = this.parsePinfl(row.getCell(1).value);
      const amount = this.parseAmount(row.getCell(2).value);

      if (!pinfl && !amount) return; // bosh qator

      if (!pinfl) {
        invalidRows.push({ rowIndex, reason: 'PINFL notogri' });
        return;
      }
      if (!amount) {
        invalidRows.push({ rowIndex, reason: 'Summa notogri' });
        return;
      }

      rows.push({ rowIndex, pinfl, amountTiyin: amount });
    });

    if (rows.length === 0) {
      throw new BadRequestException('Faylda yaroqli qator topilmadi');
    }

    // Reestrdan xodimlarni tortamiz
    const pinfls = [...new Set(rows.map((r) => r.pinfl))];
    const employees = await this.prisma.employee.findMany({
      where: { pinfl: { in: pinfls } },
      include: {
        region: { select: { code: true, name: true } },
        district: { select: { name: true } },
        department: { select: { id: true, name: true } },
      },
    });

    const empMap = new Map(employees.map((e) => [e.pinfl, e]));

    const matched: MatchedRow[] = [];
    const missing: { rowIndex: number; pinfl: string }[] = [];

    for (const row of rows) {
      const emp = empMap.get(row.pinfl);

      if (!emp) {
        missing.push({ rowIndex: row.rowIndex, pinfl: row.pinfl });
        continue;
      }

      const isCentral = emp.regionCode === CENTRAL_REGION;
      const isContract = emp.employmentType === 'SHARTNOMA';

      // Guruh kaliti: shartnoma alohida, markaz bolim boyicha, viloyat yaxlit
      let groupKey: string;
      let groupLabel: string;

      if (isContract) {
        groupKey = 'shartnoma';
        groupLabel = 'Shartnoma';
      } else if (isCentral) {
        groupKey = `markaz-${emp.departmentId ?? 'none'}`;
        groupLabel = `Markaz \u2014 ${emp.department?.name ?? 'bolimsiz'}`;
      } else {
        groupKey = `region-${emp.regionCode}`;
        groupLabel = emp.region.name;
      }

      matched.push({
        ...row,
        fullName: emp.fullName,
        regionCode: emp.regionCode,
        regionName: emp.region.name,
        districtName: emp.district?.name ?? null,
        departmentId: emp.departmentId,
        departmentName: emp.department?.name ?? null,
        employmentType: emp.employmentType,
        groupKey,
        groupLabel,
      });
    }

    // Guruhlar boyicha yigamiz
    const groups = new Map<
      string,
      { label: string; departmentId: string | null; count: number; totalTiyin: bigint }
    >();

    for (const row of matched) {
      const current = groups.get(row.groupKey) ?? {
        label: row.groupLabel,
        departmentId: row.groupKey.startsWith('markaz-') ? row.departmentId : null,
        count: 0,
        totalTiyin: 0n,
      };

      current.count += 1;
      current.totalTiyin += row.amountTiyin;
      groups.set(row.groupKey, current);
    }

    const totalTiyin = matched.reduce((sum, row) => sum + row.amountTiyin, 0n);

    // Qoralama saqlaymiz - tasdiqlash uchun kerak
    const batch = await this.prisma.payrollBatch.create({
      data: {
        period,
        status: 'DRAFT',
        fileName: file.originalname,
        fileHash,
        totalRows: rows.length,
        matchedRows: matched.length,
        missingRows: missing.length,
        totalTiyin,
        missingPinfls: missing,
        uploadedById: userId,
      },
    });

    // Qatorlarni vaqtincha saqlaymiz
    await this.prisma.payrollEntry.createMany({
      data: matched.map((row) => ({
        employeePinfl: row.pinfl,
        period,
        baseTiyin: row.amountTiyin,
        totalTiyin: row.amountTiyin,
        batchId: batch.id,
      })),
      skipDuplicates: true,
    });

    return {
      batchId: batch.id,
      period,
      fileName: file.originalname,
      totalRows: rows.length,
      matchedRows: matched.length,
      missingRows: missing.length,
      invalidRows,
      missing,
      totalTiyin,
      hasPrevious: Boolean(existing),
      previousBatchId: existing?.id ?? null,
      groups: [...groups.values()].sort((a, b) =>
        b.totalTiyin > a.totalTiyin ? 1 : -1,
      ),
    };
  }

  // --------- Tasdiqlash ---------

  /**
   * Qoralamani tasdiqlaydi va xarajat yozuvlarini yaratadi.
   * Bu davr uchun eski tasdiqlangan yuklash bolsa - bekor qilinadi.
   */
  async commit(batchId: string, userId: string, replacePrevious = false) {
    const batch = await this.prisma.payrollBatch.findUnique({
      where: { id: batchId },
      include: { entries: true },
    });

    if (!batch) {
      throw new NotFoundException('Yuklash topilmadi');
    }
    if (batch.status !== 'DRAFT') {
      throw new BadRequestException('Bu yuklash allaqachon qayta ishlangan');
    }

    // Eski tasdiqlangan yuklashni bekor qilamiz
    const previous = await this.prisma.payrollBatch.findFirst({
      where: { period: batch.period, status: 'COMMITTED' },
    });

    if (previous && replacePrevious) {
      await this.prisma.expense.updateMany({
        where: { payrollBatchId: previous.id },
        data: { deletedAt: new Date() },
      });

      await this.prisma.payrollEntry.deleteMany({
        where: { batchId: previous.id },
      });

      await this.prisma.payrollBatch.update({
        where: { id: previous.id },
        data: { status: 'CANCELLED' },
      });
    }

    // Guruhlarni qayta yigamiz
    const entries = await this.prisma.payrollEntry.findMany({
      where: { batchId: batch.id },
      include: {
        employee: {
          include: {
            region: { select: { code: true, name: true } },
            department: { select: { id: true, name: true } },
          },
        },
      },
    });

    if (entries.length === 0) {
      throw new BadRequestException(
        "Qoralamada yozuv yoq. Faylni qaytadan yuklang",
      );
    }

    // Qatorlar yigindisi yuklash summasiga teng bolishi kerak
    const entriesTotal = entries.reduce(
      (sum, item) => sum + item.totalTiyin,
      0n,
    );

    if (entriesTotal !== batch.totalTiyin) {
      const expected = Number(batch.totalTiyin) / 100;
      const actual = Number(entriesTotal) / 100;

      throw new BadRequestException(
        `Malumot nomuvofiq: yuklashda ${expected.toLocaleString("uz-UZ")} som, ` +
          `qatorlarda ${actual.toLocaleString("uz-UZ")} som. ` +
          "Faylni qaytadan yuklang",
      );
    }

    const groups = new Map<
      string,
      {
        label: string;
        departmentId: string | null;
        regionCode: number | null;
        totalTiyin: bigint;
        count: number;
      }
    >();

    for (const entry of entries) {
      const emp = entry.employee;
      const isCentral = emp.regionCode === CENTRAL_REGION;
      const isContract = emp.employmentType === 'SHARTNOMA';

      let key: string;
      let label: string;
      let departmentId: string | null = null;
      let regionCode: number | null = null;

      if (isContract) {
        key = 'shartnoma';
        label = 'Shartnoma asosidagi ish haqi';
      } else if (isCentral) {
        key = `markaz-${emp.departmentId ?? 'none'}`;
        label = `Ish haqi \u2014 ${emp.department?.name ?? 'bolimsiz'}`;
        departmentId = emp.departmentId;
        regionCode = 0;
      } else {
        key = `region-${emp.regionCode}`;
        label = `Ish haqi \u2014 ${emp.region.name}`;
        regionCode = emp.regionCode;
      }

      const current = groups.get(key) ?? {
        label,
        departmentId,
        regionCode,
        totalTiyin: 0n,
        count: 0,
      };
      current.totalTiyin += entry.totalTiyin;
      current.count += 1;
      groups.set(key, current);
    }

    const date = this.periodEndDate(batch.period);

    if (groups.size === 0) {
      throw new BadRequestException("Xarajat guruhi shakllanmadi");
    }

    // Guruhlar yigindisi ham tekshiriladi
    const groupsTotal = [...groups.values()].reduce(
      (sum, group) => sum + group.totalTiyin,
      0n,
    );

    if (groupsTotal !== entriesTotal) {
      throw new BadRequestException("Guruhlash xatosi: summalar mos kelmadi");
    }

    // Xarajat yozuvlarini birdan yaratamiz
    await this.prisma.expense.createMany({
      data: [...groups.values()].map((group) => ({
        date,
        period: batch.period,
        amountTiyin: group.totalTiyin,
        categoryCode: PAYROLL_CATEGORY,
        departmentId: group.departmentId,
        regionCode: group.regionCode,
        description: `${group.label} (${group.count} xodim)`,
        paymentMethod: "BANK" as const,
        paymentStatus: "PAID" as const,
        source: "PAYROLL" as const,
        payrollBatchId: batch.id,
        createdById: userId,
      })),
    });

    // Yaratilganini tekshiramiz
    const created = await this.prisma.expense.aggregate({
      where: { payrollBatchId: batch.id, deletedAt: null },
      _sum: { amountTiyin: true },
      _count: { _all: true },
    });

    if ((created._sum.amountTiyin ?? 0n) !== groupsTotal) {
      // Yaratilganlarni bekor qilamiz
      await this.prisma.expense.deleteMany({
        where: { payrollBatchId: batch.id },
      });

      throw new BadRequestException(
        "Xarajat yaratishda xato. Amal bekor qilindi",
      );
    }

    await this.prisma.payrollBatch.update({
      where: { id: batch.id },
      data: { status: 'COMMITTED', committedAt: new Date() },
    });

    return {
      success: true,
      expensesCreated: created._count._all,
      totalTiyin: created._sum.amountTiyin ?? 0n,
      entriesCount: entries.length,
      replacedPrevious: Boolean(previous && replacePrevious),
    };
  }

  /** Qoralamani bekor qiladi */
  async cancel(batchId: string) {
    const batch = await this.prisma.payrollBatch.findUnique({ where: { id: batchId } });

    if (!batch) {
      throw new NotFoundException('Yuklash topilmadi');
    }
    if (batch.status !== 'DRAFT') {
      throw new BadRequestException('Faqat qoralama bekor qilinadi');
    }

    await this.prisma.payrollEntry.deleteMany({ where: { batchId } });
    await this.prisma.payrollBatch.update({
      where: { id: batchId },
      data: { status: 'CANCELLED' },
    });

    return { success: true };
  }

  /**
   * Xarajat yozuvi ortidagi xodimlar royxati.
   *
   * Markaz xarajati bolsa - bolim xodimlari.
   * Viloyat xarajati bolsa - tumanlar boyicha guruhlangan.
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
      throw new NotFoundException("Xarajat topilmadi");
    }

    if (expense.source !== "PAYROLL" || !expense.payrollBatchId) {
      return { isPayroll: false, expense, groups: [], entries: [] };
    }

    // Shu xarajatga tegishli xodimlarni topamiz
    const isCentral = expense.regionCode === CENTRAL_REGION;

    const entries = await this.prisma.payrollEntry.findMany({
      where: {
        batchId: expense.payrollBatchId,
        employee: isCentral
          ? {
              regionCode: CENTRAL_REGION,
              departmentId: expense.departmentId,
              employmentType: "SHTAT",
            }
          : {
              regionCode: expense.regionCode ?? undefined,
              employmentType: "SHTAT",
            },
      },
      orderBy: { totalTiyin: "desc" },
      include: {
        employee: {
          select: {
            pinfl: true,
            fullName: true,
            position: true,
            regionCode: true,
            districtId: true,
            district: { select: { id: true, code: true, name: true } },
            department: { select: { name: true } },
          },
        },
      },
    });

    // Viloyat bolsa tumanlar boyicha guruhlaymiz
    const groups: {
      key: string;
      label: string;
      count: number;
      totalTiyin: bigint;
    }[] = [];

    if (!isCentral) {
      const byDistrict = new Map<string, { label: string; count: number; total: bigint }>();

      for (const entry of entries) {
        const key = entry.employee.districtId ?? "none";
        const label = entry.employee.district?.name ?? "Tuman korsatilmagan";

        const current = byDistrict.get(key) ?? { label, count: 0, total: 0n };
        current.count += 1;
        current.total += entry.totalTiyin;
        byDistrict.set(key, current);
      }

      for (const [key, value] of byDistrict.entries()) {
        groups.push({
          key,
          label: value.label,
          count: value.count,
          totalTiyin: value.total,
        });
      }

      groups.sort((a, b) => (b.totalTiyin > a.totalTiyin ? 1 : -1));
    }

    const totalTiyin = entries.reduce((sum, e) => sum + e.totalTiyin, 0n);

    return {
      isPayroll: true,
      expense,
      isCentral,
      groups,
      entries,
      count: entries.length,
      totalTiyin,
    };
  }

  /**
   * Topilmagan PINFL larni Excel faylga chiqaradi.
   * Ular reestrda yoq, shuning uchun faqat PINFL va qator raqami boladi.
   */
  async exportMissing(batchId: string): Promise<{ buffer: Buffer; filename: string }> {
    const batch = await this.prisma.payrollBatch.findUnique({
      where: { id: batchId },
    });

    if (!batch) {
      throw new NotFoundException("Yuklash topilmadi");
    }

    const missing = (batch.missingPinfls ?? []) as { rowIndex: number; pinfl: string }[];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Korxona tahlil";

    const sheet = workbook.addWorksheet("Topilmaganlar");

    sheet.columns = [
      { header: "Qator", key: "rowIndex", width: 10 },
      { header: "PINFL", key: "pinfl", width: 20 },
      { header: "F.I.Sh.", key: "fullName", width: 45 },
      { header: "Izoh", key: "note", width: 40 },
    ];

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDC2626" } };
    header.height = 22;

    sheet.getColumn("B").numFmt = "@";

    for (const item of missing) {
      sheet.addRow({
        rowIndex: item.rowIndex,
        pinfl: item.pinfl,
        fullName: "",
        note: "Reestrda topilmadi",
      });
    }

    if (missing.length === 0) {
      sheet.addRow({ rowIndex: "", pinfl: "", fullName: "", note: "Hammasi topildi" });
    }

    sheet.autoFilter = { from: "A1", to: `D${sheet.rowCount}` };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      filename: `Topilmaganlar-${batch.period}.xlsx`,
    };
  }

  // --------- Royxat ---------

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

  /** Bitta yuklash tafsiloti - xodimlar royxati bilan */
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
}
