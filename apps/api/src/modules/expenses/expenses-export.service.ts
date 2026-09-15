import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import type { QueryExpenseDto } from './dto/query-expense.dto';
import { ExpensesService } from './expenses.service';

const TASHKENT_OFFSET_HOURS = 5;

const PAYMENT_METHODS: Record<string, string> = {
  BANK: 'Bank otkazmasi',
  CASH: 'Naqd pul',
  CARD: 'Plastik karta',
  OTHER: 'Boshqa',
};

const PAYMENT_STATUSES: Record<string, string> = {
  PAID: 'Tolangan',
  UNPAID: 'Tolanmagan',
  PARTIAL: 'Qisman tolangan',
};

const BEHAVIORS: Record<string, string> = {
  FIXED: 'Doimiy',
  VARIABLE: 'Ozgaruvchan',
  MIXED: 'Aralash',
};

const MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
];

@Injectable()
export class ExpensesExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly expenses: ExpensesService,
  ) {}

  /** Tiyinni songa ogiradi - Excel da pul formati uchun */
  private toSum(tiyin: bigint | null): number {
    if (tiyin === null) return 0;
    return Number(tiyin) / 100;
  }

  /** UTC sanani Toshkent kuniga keltiradi */
  private toLocalDate(date: Date | null): Date | null {
    if (!date) return null;
    return new Date(date.getTime() + TASHKENT_OFFSET_HOURS * 3600000);
  }

  private periodLabel(period: string): string {
    const match = /^(\d{4})-(\d{2})$/.exec(period);
    if (!match) return period;
    return `${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
  }

  async build(query: QueryExpenseDto): Promise<{ buffer: Buffer; filename: string }> {
    // Sahifalashsiz - barcha yozuvlar
    const all = await this.expenses.findAll({ ...query, page: 1, limit: 100000 });
    const summary = await this.expenses.summaryByCategory(query);
    const byDepartment = await this.expenses.summaryByDepartment(query);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Korxona tahlil';
    workbook.created = new Date();

    // ═══════════ 1-varaq: Yozuvlar ═══════════

    const sheet = workbook.addWorksheet('Xarajatlar', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
      { header: 'Sana', key: 'date', width: 12 },
      { header: 'Davr', key: 'period', width: 10 },
      { header: 'Kategoriya', key: 'category', width: 28 },
      { header: 'Turi', key: 'behavior', width: 14 },
      { header: 'Bolim', key: 'department', width: 22 },
      { header: 'Summa', key: 'amount', width: 16 },
      { header: 'QQS', key: 'vat', width: 14 },
      { header: 'Tolov usuli', key: 'method', width: 16 },
      { header: 'Holat', key: 'status', width: 16 },
      { header: 'Tolov muddati', key: 'dueDate', width: 14 },
      { header: 'Kontragent', key: 'counterparty', width: 24 },
      { header: 'Hujjat raqami', key: 'documentNo', width: 16 },
      { header: 'Javobgar', key: 'responsible', width: 20 },
      { header: 'Tavsif', key: 'description', width: 36 },
      { header: 'Kiritgan', key: 'createdBy', width: 20 },
    ];

    for (const item of all.items) {
      const record = item as typeof item & {
        category: { label: string; behavior: string };
        department: { name: string } | null;
        createdBy: { fullName: string } | null;
        vatTiyin: bigint | null;
        dueDate: Date | null;
        responsible: string | null;
      };

      sheet.addRow({
        date: this.toLocalDate(record.date),
        period: record.period,
        category: record.category.label,
        behavior: BEHAVIORS[record.category.behavior] ?? record.category.behavior,
        department: record.department?.name ?? 'Umumkorxona',
        amount: this.toSum(record.amountTiyin),
        vat: record.vatTiyin ? this.toSum(record.vatTiyin) : null,
        method: PAYMENT_METHODS[record.paymentMethod] ?? record.paymentMethod,
        status: PAYMENT_STATUSES[record.paymentStatus] ?? record.paymentStatus,
        dueDate: this.toLocalDate(record.dueDate),
        counterparty: record.counterparty ?? '',
        documentNo: record.documentNo ?? '',
        responsible: record.responsible ?? '',
        description: record.description ?? '',
        createdBy: record.createdBy?.fullName ?? '',
      });
    }

    this.styleHeader(sheet);
    this.styleMoneyColumn(sheet, 'F');
    this.styleMoneyColumn(sheet, 'G');
    this.styleDateColumn(sheet, 'A');
    this.styleDateColumn(sheet, 'J');

    // Yigindi qatori
    const totalRow = sheet.addRow({
      category: 'JAMI',
      amount: this.toSum(all.meta.sumTiyin as bigint),
    });
    totalRow.font = { bold: true };
    totalRow.getCell('F').numFmt = '#,##0';
    totalRow.eachCell((cell) => {
      cell.border = { top: { style: 'medium' } };
    });

    sheet.autoFilter = { from: 'A1', to: `O${sheet.rowCount - 1}` };

    // ═══════════ 2-varaq: Kategoriya kesimi ═══════════

    const catSheet = workbook.addWorksheet('Kategoriyalar');

    catSheet.columns = [
      { header: 'Kategoriya', key: 'label', width: 32 },
      { header: 'Turi', key: 'behavior', width: 14 },
      { header: 'Yozuvlar soni', key: 'count', width: 14 },
      { header: 'Summa', key: 'amount', width: 18 },
      { header: 'Ulush, %', key: 'share', width: 12 },
    ];

    for (const row of summary.rows) {
      catSheet.addRow({
        label: row.label,
        behavior: row.behavior ? (BEHAVIORS[row.behavior] ?? row.behavior) : '',
        count: row.count,
        amount: this.toSum(row.amountTiyin),
        share: row.sharePercent / 100,
      });
    }

    this.styleHeader(catSheet);
    this.styleMoneyColumn(catSheet, 'D');
    catSheet.getColumn('E').numFmt = '0.0%';

    const catTotal = catSheet.addRow({
      label: 'JAMI',
      amount: this.toSum(summary.totalTiyin),
      share: 1,
    });
    catTotal.font = { bold: true };
    catTotal.getCell('D').numFmt = '#,##0';
    catTotal.getCell('E').numFmt = '0.0%';
    catTotal.eachCell((cell) => {
      cell.border = { top: { style: 'medium' } };
    });

    // ═══════════ 3-varaq: Bolimlar ═══════════

    const depSheet = workbook.addWorksheet('Bolimlar');

    depSheet.columns = [
      { header: 'Bolim', key: 'name', width: 28 },
      { header: 'Yozuvlar soni', key: 'count', width: 14 },
      { header: 'Summa', key: 'amount', width: 18 },
      { header: 'Ulush, %', key: 'share', width: 12 },
    ];

    for (const row of byDepartment.rows) {
      depSheet.addRow({
        name: row.name,
        count: row.count,
        amount: this.toSum(row.amountTiyin),
        share: row.sharePercent / 100,
      });
    }

    this.styleHeader(depSheet);
    this.styleMoneyColumn(depSheet, 'C');
    depSheet.getColumn('D').numFmt = '0.0%';

    const depTotal = depSheet.addRow({
      name: 'JAMI',
      amount: this.toSum(byDepartment.totalTiyin),
      share: 1,
    });
    depTotal.font = { bold: true };
    depTotal.getCell('C').numFmt = '#,##0';
    depTotal.getCell('D').numFmt = '0.0%';
    depTotal.eachCell((cell) => {
      cell.border = { top: { style: 'medium' } };
    });

    // ═══════════ Fayl nomi ═══════════

    const periodPart = query.period
      ? this.periodLabel(query.period).replace(' ', '-')
      : 'barcha-davrlar';

    const filename = `Xarajatlar_${periodPart}.xlsx`;

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return { buffer: Buffer.from(arrayBuffer), filename };
  }

  // ═══════════ Uslub yordamchilari ═══════════

  private styleHeader(sheet: ExcelJS.Worksheet): void {
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E40AF' },
    };
    header.alignment = { vertical: 'middle' };
    header.height = 22;
  }

  private styleMoneyColumn(sheet: ExcelJS.Worksheet, column: string): void {
    sheet.getColumn(column).numFmt = '#,##0';
    sheet.getColumn(column).alignment = { horizontal: 'right' };
  }

  private styleDateColumn(sheet: ExcelJS.Worksheet, column: string): void {
    sheet.getColumn(column).numFmt = 'dd.mm.yyyy';
  }
}
