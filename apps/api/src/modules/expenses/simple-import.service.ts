import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';

const TASHKENT_OFFSET_HOURS = 5;

/** Standart kategoriyalar — import qilingan yozuvlar shularga tushadi */
const DEFAULT_EXPENSE_CATEGORY = 'OTHER_MISC';
const DEFAULT_INCOME_CATEGORY = 'SRV_39';

export interface SimpleRow {
  rowIndex: number;
  name: string;
  amountTiyin: bigint;
}

export interface SimpleImportResult {
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: { rowIndex: number; reason: string }[];
  totalTiyin: bigint;
  rows: SimpleRow[];
}

@Injectable()
export class SimpleImportService {
  constructor(private readonly prisma: PrismaService) {}

  // --------- Yordamchilar ---------

  private today(): Date {
    const now = new Date(Date.now() + TASHKENT_OFFSET_HOURS * 3600_000);
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        -TASHKENT_OFFSET_HOURS,
      ),
    );
  }

  private currentPeriod(): string {
    const now = new Date(Date.now() + TASHKENT_OFFSET_HOURS * 3600_000);
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
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

  // --------- Shablon ---------

  /** Ikki ustunli bosh shablon */
  buildTemplate(kind: 'expense' | 'income'): {
    buffer: Promise<Buffer>;
    filename: string;
  } {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Korxona tahlil';

    const isExpense = kind === 'expense';
    const sheet = workbook.addWorksheet(isExpense ? 'Xarajatlar' : 'Daromadlar', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
      { header: 'Nomi', key: 'name', width: 55 },
      { header: 'Summa', key: 'amount', width: 20 },
    ];

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: isExpense ? 'FFDC2626' : 'FF059669' },
    };
    header.height = 22;

    sheet.getColumn('B').numFmt = '#,##0';

    // Namuna qatorlar
    const samples = isExpense
      ? [
          ['Ofis ijarasi', 5000000],
          ['Internet tolovi', 800000],
        ]
      : [
          ['Konsultatsiya xizmati', 3000000],
          ['Hisobot tayyorlash', 1500000],
        ];

    for (const [name, amount] of samples) {
      const row = sheet.addRow({ name, amount });
      row.font = { color: { argb: 'FF94A3B8' }, italic: true };
    }

    const now = new Date().toISOString().slice(0, 10);

    return {
      buffer: workbook.xlsx.writeBuffer().then((data) => Buffer.from(data)),
      filename: `${isExpense ? 'Xarajatlar' : 'Daromadlar'}-shablon-${now}.xlsx`,
    };
  }

  // --------- Tahlil ---------

  /** Faylni oqiydi — hech narsa saqlanmaydi */
  async analyze(file: Express.Multer.File): Promise<SimpleImportResult> {
    if (!file) {
      throw new BadRequestException('Fayl yuklanmadi');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('Faylda varaq topilmadi');
    }

    const rows: SimpleRow[] = [];
    const invalidRows: { rowIndex: number; reason: string }[] = [];

    sheet.eachRow((row, rowIndex) => {
      if (rowIndex === 1) return; // sarlavha

      const nameRaw = row.getCell(1).value;
      const name =
        nameRaw === null || nameRaw === undefined ? '' : String(nameRaw).trim();

      const amount = this.parseAmount(row.getCell(2).value);

      // Bo'sh qator
      if (!name && !amount) return;

      if (!name) {
        invalidRows.push({ rowIndex, reason: 'Nomi kiritilmagan' });
        return;
      }

      if (!amount) {
        invalidRows.push({ rowIndex, reason: 'Summa notogri' });
        return;
      }

      rows.push({ rowIndex, name, amountTiyin: amount });
    });

    if (rows.length === 0) {
      throw new BadRequestException('Faylda yaroqli qator topilmadi');
    }

    return {
      fileName: file.originalname,
      totalRows: rows.length + invalidRows.length,
      validRows: rows.length,
      invalidRows,
      totalTiyin: rows.reduce((sum, row) => sum + row.amountTiyin, 0n),
      rows,
    };
  }

  // --------- Saqlash ---------

  /**
   * Yozuvlarni yaratadi.
   *
   * Sana — bugungi kun, kategoriya — standart, bolim — Umumkorxona.
   * Foydalanuvchi keyin qolda tuzatadi.
   */
  async commit(
    kind: 'expense' | 'income',
    rows: SimpleRow[],
    userId: string,
  ): Promise<{ created: number; totalTiyin: bigint }> {
    if (rows.length === 0) {
      throw new BadRequestException('Saqlash uchun malumot yoq');
    }

    const date = this.today();
    const period = this.currentPeriod();
    const totalTiyin = rows.reduce((sum, row) => sum + row.amountTiyin, 0n);

    if (kind === 'expense') {
      // Standart kategoriya mavjudligini tekshiramiz
      const category = await this.prisma.category.findUnique({
        where: { code: DEFAULT_EXPENSE_CATEGORY },
      });

      if (!category) {
        throw new BadRequestException(
          `Standart kategoriya topilmadi: ${DEFAULT_EXPENSE_CATEGORY}`,
        );
      }

      const result = await this.prisma.expense.createMany({
        data: rows.map((row) => ({
          date,
          period,
          amountTiyin: row.amountTiyin,
          categoryCode: DEFAULT_EXPENSE_CATEGORY,
          departmentId: null,
          regionCode: null,
          description: row.name,
          paymentMethod: 'BANK' as const,
          paymentStatus: 'PAID' as const,
          source: 'IMPORT' as const,
          createdById: userId,
        })),
      });

      return { created: result.count, totalTiyin };
    }

    const category = await this.prisma.incomeCategory.findUnique({
      where: { code: DEFAULT_INCOME_CATEGORY },
    });

    if (!category) {
      throw new BadRequestException(
        `Standart xizmat turi topilmadi: ${DEFAULT_INCOME_CATEGORY}`,
      );
    }

    const result = await this.prisma.income.createMany({
      data: rows.map((row) => ({
        date,
        period,
        amountTiyin: row.amountTiyin,
        paidTiyin: row.amountTiyin,
        paymentStatus: 'PAID' as const,
        paymentMethod: 'BANK' as const,
        categoryCode: DEFAULT_INCOME_CATEGORY,
        departmentId: null,
        regionCode: null,
        description: row.name,
        source: 'IMPORT' as const,
        createdById: userId,
      })),
    });

    return { created: result.count, totalTiyin };
  }
}
