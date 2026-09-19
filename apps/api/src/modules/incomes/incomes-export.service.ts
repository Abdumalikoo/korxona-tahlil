import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import type { QueryIncomeDto } from './dto/query-income.dto';
import { IncomesService } from './incomes.service';

const TASHKENT_OFFSET_HOURS = 5;

const statusLabels: Record<string, string> = {
  PAID: "To'langan",
  PARTIAL: 'Qisman',
  UNPAID: "To'lanmagan",
};

const methodLabels: Record<string, string> = {
  BANK: "Bank o'tkazmasi",
  CASH: 'Naqd pul',
  CARD: 'Plastik karta',
  OTHER: 'Boshqa',
};

@Injectable()
export class IncomesExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly incomes: IncomesService,
  ) {}

  private toLocalDate(date: Date): Date {
    return new Date(date.getTime() + TASHKENT_OFFSET_HOURS * 3600_000);
  }

  private tiyinToSum(tiyin: bigint): number {
    return Number(tiyin) / 100;
  }

  async build(query: QueryIncomeDto): Promise<{ buffer: Buffer; filename: string }> {
    const result = await this.incomes.findAll({ ...query, page: 1, limit: 100000 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Korxona tahlil';
    workbook.created = new Date();

    // --------- 1-varaq: Daromadlar ---------

    const sheet = workbook.addWorksheet('Daromadlar', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
      { header: 'Sana', key: 'date', width: 14 },
      { header: 'Xizmat turi', key: 'category', width: 45 },
      { header: 'Mijoz', key: 'client', width: 30 },
      { header: 'Shartnoma', key: 'contract', width: 18 },
      { header: "Bo'lim", key: 'department', width: 30 },
      { header: 'Hudud', key: 'region', width: 24 },
      { header: 'Holat', key: 'status', width: 14 },
      { header: "To'lov usuli", key: 'method', width: 18 },
      { header: 'Tushgan', key: 'paid', width: 18 },
      { header: 'Summa', key: 'amount', width: 18 },
      { header: 'Tavsif', key: 'description', width: 40 },
    ];

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
    header.alignment = { vertical: 'middle' };
    header.height = 22;

    sheet.getColumn('A').numFmt = 'dd.mm.yyyy';
    sheet.getColumn('I').numFmt = '#,##0';
    sheet.getColumn('J').numFmt = '#,##0';

    let total = 0;
    let totalPaid = 0;

    for (const item of result.items) {
      const record = item as typeof item & {
        category: { label: string };
        department: { name: string } | null;
        region: { name: string } | null;
      };

      const amount = this.tiyinToSum(record.amountTiyin);
      const paid = this.tiyinToSum(record.paidTiyin);

      total += amount;
      totalPaid += paid;

      sheet.addRow({
        date: this.toLocalDate(record.date),
        category: record.category.label,
        client: record.clientName ?? '',
        contract: record.contractNo ?? '',
        department: record.department?.name ?? '',
        region: record.region?.name ?? '',
        status: statusLabels[record.paymentStatus] ?? record.paymentStatus,
        method: methodLabels[record.paymentMethod] ?? record.paymentMethod,
        paid,
        amount,
        description: record.description ?? '',
      });
    }

    // Jami qator
    const totalRow = sheet.addRow({
      category: 'JAMI',
      paid: totalPaid,
      amount: total,
    });
    totalRow.font = { bold: true };
    totalRow.eachCell((cell) => {
      cell.border = { top: { style: 'medium' } };
    });

    sheet.autoFilter = { from: 'A1', to: `K${sheet.rowCount - 1}` };

    // --------- 2-varaq: Xizmat turlari ---------

    const byCategory = await this.incomes.summaryByCategory(query);

    const catSheet = workbook.addWorksheet('Xizmat turlari');
    catSheet.columns = [
      { header: 'Xizmat turi', key: 'label', width: 50 },
      { header: 'Soni', key: 'count', width: 12 },
      { header: 'Ulush', key: 'share', width: 12 },
      { header: 'Tushgan', key: 'paid', width: 18 },
      { header: 'Summa', key: 'amount', width: 18 },
    ];

    const catHeader = catSheet.getRow(1);
    catHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    catHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF475569' },
    };

    catSheet.getColumn('C').numFmt = '0.0"%"';
    catSheet.getColumn('D').numFmt = '#,##0';
    catSheet.getColumn('E').numFmt = '#,##0';

    for (const row of byCategory.rows) {
      catSheet.addRow({
        label: row.label,
        count: row.count,
        share: row.sharePercent,
        paid: this.tiyinToSum(row.paidTiyin),
        amount: this.tiyinToSum(row.amountTiyin),
      });
    }

    const catTotal = catSheet.addRow({
      label: 'JAMI',
      amount: this.tiyinToSum(byCategory.totalTiyin),
    });
    catTotal.font = { bold: true };

    // --------- 3-varaq: Bo'limlar ---------

    const byDepartment = await this.incomes.summaryByDepartment(query);

    const deptSheet = workbook.addWorksheet('Bolimlar');
    deptSheet.columns = [
      { header: "Bo'lim", key: 'name', width: 45 },
      { header: 'Soni', key: 'count', width: 12 },
      { header: 'Ulush', key: 'share', width: 12 },
      { header: 'Summa', key: 'amount', width: 18 },
    ];

    const deptHeader = deptSheet.getRow(1);
    deptHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    deptHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF475569' },
    };

    deptSheet.getColumn('C').numFmt = '0.0"%"';
    deptSheet.getColumn('D').numFmt = '#,##0';

    for (const row of byDepartment.rows) {
      deptSheet.addRow({
        name: row.name,
        count: row.count,
        share: row.sharePercent,
        amount: this.tiyinToSum(row.amountTiyin),
      });
    }

    const deptTotal = deptSheet.addRow({
      name: 'JAMI',
      amount: this.tiyinToSum(byDepartment.totalTiyin),
    });
    deptTotal.font = { bold: true };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    const suffix = query.period ?? new Date().toISOString().slice(0, 10);

    return {
      buffer: Buffer.from(arrayBuffer),
      filename: `Daromadlar-${suffix}.xlsx`,
    };
  }
}
