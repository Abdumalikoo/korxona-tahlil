import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ExportXlsxService, type ExportBody } from './export-xlsx.service';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Excel eksport: sahifa jadvali — tushunarli .xlsx (jadval, tushuntirish, ma'lumot): /api/export/xlsx */
@Controller('export')
export class ExportXlsxController {
  constructor(private readonly service: ExportXlsxService) {}

  @Post('xlsx')
  @HttpCode(HttpStatus.OK)
  async xlsx(@Body() body: ExportBody, @Res() response: Response) {
    const { buffer, filename } = await this.service.build(body);
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    response.send(buffer);
  }
}
