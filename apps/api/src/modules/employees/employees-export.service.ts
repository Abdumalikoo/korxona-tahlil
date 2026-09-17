import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from './employees.service';
import type { QueryEmployeeDto } from './dto/query-employee.dto';

const CENTRAL_REGION = 0;

@Injectable()
export class EmployeesExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly employees: EmployeesService,
  ) {}

  private formatDate(date: Date | null): Date | null {
    if (!date) return null;
    return new Date(date.getTime() + 5 * 3600000);
  }

  async build(query: QueryEmployeeDto): Promise<{ buffer: Buffer; filename: string }> {
    // Sahifalashsiz - barcha yozuvlar
    const result = await this.employees.findAll({ ...query, page: 1, limit: 100000 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Korxona tahlil';
    workbook.created = new Date();

    // --------- 1-varaq: Xodimlar ---------

    const sheet = workbook.addWorksheet('Xodimlar', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    sheet.columns = [
      { header: 'PINFL', key: 'pinfl', width: 18 },
      { header: 'F.I.Sh.', key: 'fullName', width: 45 },
      { header: 'Ish turi', key: 'type', width: 14 },
      { header: 'Hudud', key: 'region', width: 26 },
      { header: 'Tuman', key: 'district', width: 24 },
      { header: "Bo'lim", key: 'department', width: 40 },
      { header: 'Lavozim', key: 'position', width: 24 },
      { header: 'Ishga kirgan', key: 'hiredAt', width: 14 },
      { header: 'Holat', key: 'status', width: 12 },
    ];

    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    header.alignment = { vertical: 'middle' };
    header.height = 22;

    sheet.getColumn('A').numFmt = '@';
    sheet.getColumn('H').numFmt = 'dd.mm.yyyy';

    for (const emp of result.items) {
      const record = emp as typeof emp & {
        region: { code: number; name: string };
        district: { name: string } | null;
        department: { name: string } | null;
      };

      sheet.addRow({
        pinfl: record.pinfl,
        fullName: record.fullName,
        type: record.employmentType === 'SHTAT' ? 'Shtat' : 'Shartnoma',
        region: record.region.name,
        district: record.district?.name ?? '',
        department: record.department?.name ?? '',
        position: record.position ?? '',
        hiredAt: this.formatDate(record.hiredAt),
        status: record.isActive ? 'Faol' : 'Arxiv',
      });
    }

    sheet.autoFilter = { from: 'A1', to: `I${sheet.rowCount}` };

    // --------- 2-varaq: Hududlar kesimi ---------

    const byRegion = await this.employees.byRegion();

    const regionSheet = workbook.addWorksheet('Hududlar');
    regionSheet.columns = [
      { header: 'Kod', key: 'code', width: 10 },
      { header: 'Hudud', key: 'name', width: 34 },
      { header: 'Xodimlar', key: 'count', width: 14 },
    ];

    const regionHeader = regionSheet.getRow(1);
    regionHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    regionHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF475569' },
    };

    for (const row of byRegion) {
      regionSheet.addRow({
        code: row.regionCode,
        name: row.name,
        count: row.count,
      });
    }

    const regionTotal = regionSheet.addRow({
      name: 'JAMI',
      count: byRegion.reduce((sum, r) => sum + r.count, 0),
    });
    regionTotal.font = { bold: true };

    // --------- 3-varaq: Bo'limlar kesimi ---------

    const byDepartment = await this.employees.byDepartment();

    const deptSheet = workbook.addWorksheet('Bolimlar');
    deptSheet.columns = [
      { header: "Bo'lim", key: 'name', width: 46 },
      { header: 'Xodimlar', key: 'count', width: 14 },
    ];

    const deptHeader = deptSheet.getRow(1);
    deptHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    deptHeader.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF475569' },
    };

    for (const row of byDepartment) {
      deptSheet.addRow({ name: row.name, count: row.count });
    }

    const deptTotal = deptSheet.addRow({
      name: 'JAMI',
      count: byDepartment.reduce((sum, r) => sum + r.count, 0),
    });
    deptTotal.font = { bold: true };

    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      filename: `Xodimlar-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }
}
