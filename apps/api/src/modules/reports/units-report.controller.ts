import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators';
import { renderExcel } from './render.excel';
import { renderPdf } from './render.pdf';
import { UnitsReport, type UnitReportInput } from './report.units';
import { FORMAT_INFO, forFormat } from './reports.types';

/**
 * Hisobotlar › Bo'limlar bo'yicha: /api/reports/units/… — bitta bo'lim (Markaz bo'limi, hudud / tuman, yo'nalish).
 * Xodimlar ismlari — faqat administrator hisobotida (boshqalarga — soni va jami summalar).
 */
@Controller('reports/units')
export class UnitsReportController {
  constructor(private readonly units: UnitsReport) {}

  @Get('options')
  async options() {
    return { data: await this.units.options() };
  }

  /** Ekranda ko'rish: { kind, id, district?, from, to } */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  async preview(@Body() body: UnitReportInput, @CurrentUser('role') role: UserRole | undefined) {
    return { data: await this.units.build(body ?? {}, role === UserRole.ADMIN) };
  }

  /** Yuklab olish: { ..., format: xlsx | pdf } */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(@Body() body: UnitReportInput & { format?: unknown }, @CurrentUser('role') role: UserRole | undefined, @Res() response: Response) {
    const format = body?.format === 'pdf' ? 'pdf' : body?.format === 'xlsx' || body?.format === undefined ? 'xlsx' : null;
    if (!format) throw new BadRequestException("Format: xlsx yoki pdf");
    const doc = forFormat(await this.units.build(body ?? {}, role === UserRole.ADMIN), format);
    const buffer = format === 'xlsx' ? await renderExcel(doc) : await renderPdf(doc);
    const filename = `${doc.fileBase}.${FORMAT_INFO[format].ext}`;
    response.setHeader('Content-Type', FORMAT_INFO[format].mime);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    response.send(buffer);
  }
}
