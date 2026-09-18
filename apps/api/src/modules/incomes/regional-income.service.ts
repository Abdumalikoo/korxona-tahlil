import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';

const TASHKENT_OFFSET_HOURS = 5;

/** Faylning bitta qatori */
export interface ParsedRow {
  regionCode: number;
  regionName: string;
  categoryCode: string;
  categoryLabel: string;
  quantity: number | null;
  amountTiyin: bigint;
}

@Injectable()
export class RegionalIncomeService {
  constructor(private readonly prisma: PrismaService) {}

  // --------- Yordamchilar ---------

  /** Davr oxirgi kuni - daromad sanasi */
  private periodEndDate(period: string): Date {
    const match = /^(\d{4})-(\d{2})$/.exec(period);
    if (!match) {
      throw new BadRequestException('Davr notogri formatda');
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    return new Date(
      Date.UTC(nextYear, nextMonth - 1, 1, -TASHKENT_OFFSET_HOURS) - 86400000,
    );
  }

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

  private parseQuantity(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;

    const parsed = Number(String(value).replace(/[\s\u00A0]/g, ''));
    if (!Number.isFinite(parsed) || parsed <= 0) return null;

    return Math.round(parsed);
  }

  /** Varaq nomini soddalashtiradi - solishtirish uchun */
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[\u2018\u2019'`]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  // --------- Shablon ---------

  /**
   * Har bir hudud uchun alohida varaq.
   * Ichida 38 xizmat turi, soni va summa ustunlari bilan.
   */
  /**
   * Har bir hudud uchun alohida varaq.
   *
   * Har xizmat ikki qator egallaydi:
   *   A ustun — xizmat nomi (birinchi qatorda)
   *   B ustun — "Soni" / "Summasi"
   *   C ustun — qiymat
   */
  async buildTemplate(period: string): Promise<{ buffer: Buffer; filename: string }> {
    const [regions, services] = await Promise.all([
      this.prisma.region.findMany({
        // Markaz (0) hududiy daromadlarga kirmaydi
        where: { isActive: true, code: { not: 0 } },
        orderBy: { code: 'asc' },
      }),
      this.prisma.incomeCategory.findMany({
        where: { isActive: true },
        orderBy: { order: 'asc' },
      }),
    ]);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Korxona tahlil';
    workbook.created = new Date();

    for (const region of regions) {
      const sheetName = region.name.slice(0, 31);
      const sheet = workbook.addWorksheet(sheetName, {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      sheet.columns = [
        { header: '№', key: 'no', width: 6 },
        { header: 'Xizmat turi', key: 'service', width: 66 },
        { header: '', key: 'metric', width: 14 },
        { header: 'Qiymat', key: 'value', width: 18 },
      ];

      const header = sheet.getRow(1);
      header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E40AF' },
      };
      header.alignment = { vertical: 'middle', wrapText: true };
      header.height = 26;

      sheet.getColumn('A').alignment = { horizontal: 'center', vertical: 'middle' };
      sheet.getColumn('B').alignment = { wrapText: true, vertical: 'middle' };
      sheet.getColumn('C').alignment = { vertical: 'middle' };
      sheet.getColumn('D').numFmt = '#,##0';

      let rowIndex = 2;
      let serviceNo = 1;

      for (const service of services) {
        const countRow = sheet.addRow({
          no: serviceNo,
          service: service.label,
          metric: 'Soni',
          value: null,
        });

        const amountRow = sheet.addRow({
          no: null,
          service: null,
          metric: 'Summasi',
          value: null,
        });

        // Raqam va nom ikki qatorga birlashtiriladi
        sheet.mergeCells(`A${rowIndex}:A${rowIndex + 1}`);
        sheet.mergeCells(`B${rowIndex}:B${rowIndex + 1}`);

        countRow.getCell('C').font = { color: { argb: 'FF64748B' } };
        amountRow.getCell('C').font = { color: { argb: 'FF64748B' }, bold: true };

        amountRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } } };
        });

        rowIndex += 2;
        serviceNo += 1;
      }

      // Yig'indi
      const totalRow = sheet.addRow({
        no: null,
        service: 'JAMI',
        metric: 'Summasi',
        value: { formula: `SUMIF(C2:C${rowIndex - 1},"Summasi",D2:D${rowIndex - 1})` },
      });
      totalRow.font = { bold: true };
      totalRow.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = { top: { style: 'medium' } };
      });
    }

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      filename: `Hududiy-daromadlar-${period}.xlsx`,
    };
  }

  // --------- Tahlil ---------

  /**
   * Faylni oqiydi va tekshiradi.
   * Hech narsa saqlanmaydi - faqat natija qaytariladi.
   */
  async analyze(period: string, file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Fayl yuklanmadi');
    }

    const [regions, services] = await Promise.all([
      this.prisma.region.findMany({ where: { isActive: true, code: { not: 0 } } }),
      this.prisma.incomeCategory.findMany({ where: { isActive: true } }),
    ]);

    // Nom boyicha qidirish uchun xaritalar
    const regionMap = new Map(regions.map((r) => [this.normalize(r.name), r]));
    const serviceMap = new Map(services.map((s) => [this.normalize(s.label), s]));

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);

    const rows: ParsedRow[] = [];
    const unknownSheets: string[] = [];
    const unknownServices: { sheet: string; rowIndex: number; label: string }[] = [];

    for (const sheet of workbook.worksheets) {
      const region = regionMap.get(this.normalize(sheet.name));

      if (!region) {
        unknownSheets.push(sheet.name);
        continue;
      }

            // Ikki qatorli tuzilma: nom + Soni, keyingi qator Summasi
      let currentLabel = '';
      let currentQuantity: number | null = null;

      sheet.eachRow((row, rowIndex) => {
        if (rowIndex === 1) return; // sarlavha

        const labelRaw = row.getCell(2).value;
        const labelText =
          labelRaw === null || labelRaw === undefined ? '' : String(labelRaw).trim();

        // Nom faqat birinchi qatorda turadi — keyingisida bo'sh
        if (labelText) currentLabel = labelText;

        if (!currentLabel || currentLabel.toUpperCase() === 'JAMI') return;

        const metricRaw = row.getCell(3).value;
        const metric =
          metricRaw === null || metricRaw === undefined
            ? ''
            : String(metricRaw).trim().toLowerCase();

        const valueCell = row.getCell(4).value;

        if (metric.startsWith('son')) {
          currentQuantity = this.parseQuantity(valueCell);
          return;
        }

        if (!metric.startsWith('summ')) return;

        const amount = this.parseAmount(valueCell);
        if (!amount) {
          currentQuantity = null;
          return;
        }

        const service = serviceMap.get(this.normalize(currentLabel));

        if (!service) {
          unknownServices.push({ sheet: sheet.name, rowIndex, label: currentLabel });
          currentQuantity = null;
          return;
        }

        rows.push({
          regionCode: region.code,
          regionName: region.name,
          categoryCode: service.code,
          categoryLabel: service.label,
          quantity: currentQuantity,
          amountTiyin: amount,
        });

        currentQuantity = null;
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException('Faylda yaroqli qator topilmadi');
    }

    // Hududlar boyicha yigindi
    const byRegion = new Map<
      number,
      { name: string; count: number; totalTiyin: bigint; quantity: number }
    >();

    for (const row of rows) {
      const current = byRegion.get(row.regionCode) ?? {
        name: row.regionName,
        count: 0,
        totalTiyin: 0n,
        quantity: 0,
      };

      current.count += 1;
      current.totalTiyin += row.amountTiyin;
      current.quantity += row.quantity ?? 0;
      byRegion.set(row.regionCode, current);
    }

    const totalTiyin = rows.reduce((sum, row) => sum + row.amountTiyin, 0n);

    // Bu davr uchun oldin import qilinganmi
    const existing = await this.prisma.income.count({
      where: { deletedAt: null, period, source: 'IMPORT', regionCode: { not: null } },
    });

    return {
      period,
      fileName: file.originalname,
      fileHash: createHash('sha256').update(file.buffer).digest('hex'),
      totalRows: rows.length,
      totalTiyin,
      unknownSheets,
      unknownServices,
      hasPrevious: existing > 0,
      previousCount: existing,
      regions: [...byRegion.entries()]
        .map(([code, value]) => ({ regionCode: code, ...value }))
        .sort((a, b) => (b.totalTiyin > a.totalTiyin ? 1 : -1)),
      rows,
    };
  }

  // --------- Saqlash ---------

  /**
   * Tahlil natijasini bazaga yozadi.
   * replacePrevious bolsa eski yozuvlar ochiriladi.
   */
  async commit(
    period: string,
    rows: ParsedRow[],
    userId: string,
    replacePrevious = false,
  ) {
    if (rows.length === 0) {
      throw new BadRequestException('Saqlash uchun malumot yoq');
    }

    // Kelgan qatorlarni tekshiramiz - hudud va xizmat mavjudmi
    const [regions, services] = await Promise.all([
      this.prisma.region.findMany({ select: { code: true } }),
      this.prisma.incomeCategory.findMany({
        where: { isActive: true },
        select: { code: true },
      }),
    ]);

    const regionCodes = new Set(regions.map((r) => r.code));
    const serviceCodes = new Set(services.map((s) => s.code));

    for (const row of rows) {
      if (!regionCodes.has(row.regionCode)) {
        throw new BadRequestException(`Hudud topilmadi: ${row.regionCode}`);
      }
      if (!serviceCodes.has(row.categoryCode)) {
        throw new BadRequestException(
          `Xizmat turi topilmadi: ${row.categoryCode}`,
        );
      }
      if (row.amountTiyin <= 0n) {
        throw new BadRequestException(
          `Notogri summa: ${row.regionName} - ${row.categoryLabel}`,
        );
      }
    }

    const date = this.periodEndDate(period);
    const expectedTotal = rows.reduce((sum, row) => sum + row.amountTiyin, 0n);
    const startedAt = new Date();

    // Eski yozuvlarni ochirish va yangilarini yaratish - birga
    const created = await this.prisma.$transaction(async (tx) => {
      if (replacePrevious) {
        await tx.income.updateMany({
          where: {
            deletedAt: null,
            period,
            source: 'IMPORT',
            regionCode: { not: null },
          },
          data: { deletedAt: new Date() },
        });
      }

      await tx.income.createMany({
        data: rows.map((row) => ({
          date,
          period,
          amountTiyin: row.amountTiyin,
          paidTiyin: row.amountTiyin,
          paymentStatus: 'PAID' as const,
          paymentMethod: 'BANK' as const,
          categoryCode: row.categoryCode,
          regionCode: row.regionCode,
          quantity: row.quantity,
          description: `${row.regionName} \u2014 ${row.categoryLabel}`,
          source: 'IMPORT' as const,
          createdById: userId,
        })),
      });

      const result = await tx.income.aggregate({
        where: {
          deletedAt: null,
          period,
          source: "IMPORT",
          regionCode: { not: null },
          createdAt: { gte: startedAt },
        },
        _sum: { amountTiyin: true },
        _count: { _all: true },
      });

      if (result._count._all !== rows.length) {
        throw new BadRequestException(
          `Yaratishda xato: kutilgan ${rows.length} ta, ` +
            `yaratilgan ${result._count._all} ta`,
        );
      }

      return result;
    });

    return {
      success: true,
      created: created._count._all,
      totalTiyin: created._sum.amountTiyin ?? expectedTotal,
      replacedPrevious: replacePrevious,
    };
  }

  // --------- Tahlil korinishlari ---------

  /** Hududlar kesimida daromad */
  async summaryByRegion(period: string) {
    const grouped = await this.prisma.income.groupBy({
      by: ['regionCode'],
      where: { deletedAt: null, period, regionCode: { not: null } },
      _sum: { amountTiyin: true, quantity: true },
      _count: { _all: true },
    });

    const regions = await this.prisma.region.findMany({
      select: { code: true, name: true },
    });
    const map = new Map(regions.map((r) => [r.code, r.name]));

    const total = grouped.reduce((sum, row) => sum + (row._sum.amountTiyin ?? 0n), 0n);

    return {
      rows: grouped
        .map((row) => {
          const amount = row._sum.amountTiyin ?? 0n;
          return {
            regionCode: row.regionCode,
            name: map.get(row.regionCode ?? -1) ?? 'Nomalum',
            amountTiyin: amount,
            quantity: row._sum.quantity ?? 0,
            count: row._count._all,
            sharePercent: total > 0n ? Number((amount * 10000n) / total) / 100 : 0,
          };
        })
        .sort((a, b) => (b.amountTiyin > a.amountTiyin ? 1 : -1)),
      totalTiyin: total,
    };
  }

  /** Xizmat turlari kesimida - hududiy daromadlar boyicha */
  async summaryByService(period: string, regionCode?: number) {
    const grouped = await this.prisma.income.groupBy({
      by: ['categoryCode'],
      where: {
        deletedAt: null,
        period,
        regionCode: regionCode !== undefined ? regionCode : { not: null },
      },
      _sum: { amountTiyin: true, quantity: true },
      _count: { _all: true },
    });

    const services = await this.prisma.incomeCategory.findMany({
      select: { code: true, label: true },
    });
    const map = new Map(services.map((s) => [s.code, s.label]));

    const total = grouped.reduce((sum, row) => sum + (row._sum.amountTiyin ?? 0n), 0n);

    return {
      rows: grouped
        .map((row) => {
          const amount = row._sum.amountTiyin ?? 0n;
          const quantity = row._sum.quantity ?? 0;

          return {
            categoryCode: row.categoryCode,
            label: map.get(row.categoryCode) ?? row.categoryCode,
            amountTiyin: amount,
            quantity,
            /** Ortacha narx - agar soni korsatilgan bolsa */
            averageTiyin: quantity > 0 ? amount / BigInt(quantity) : null,
            count: row._count._all,
            sharePercent: total > 0n ? Number((amount * 10000n) / total) / 100 : 0,
          };
        })
        .sort((a, b) => (b.amountTiyin > a.amountTiyin ? 1 : -1)),
      totalTiyin: total,
    };
  }
}
