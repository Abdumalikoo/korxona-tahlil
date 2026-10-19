import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { ReconcileService } from './reconcile.service';
import { ReportsService } from './reports.service';
import type { GenerateInput } from './reports.types';

function sendFile(response: Response, buffer: Buffer, filename: string, type: string, id?: string) {
  response.setHeader('Content-Type', type);
  response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Report-Id');
  if (id) response.setHeader('X-Report-Id', id);
  response.send(buffer);
}

/** Hisobotlar markazi: ro'yxat, yaratish (Excel / PowerPoint / PDF), tarix */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly reconcile: ReconcileService,
  ) {}

  /** Raqamlar tekshiruvi: har bir bo'lim hisoblagani bazadagi SQL yig'indilari bilan (?from&to) */
  @Get('reconcile')
  async check(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.reconcile.run(from, to) };
  }

  @Get('catalog')
  catalog() {
    return { data: this.reports.catalog() };
  }

  /** Ekranda ko'rish: { type, from, to, unit?, subject? } — hujjat (bo'limlar, jadvallar, hisob-kitoblar) */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  async preview(@Body() body: GenerateInput) {
    return { data: await this.reports.preview(body ?? {}) };
  }

  /** Hisobot yaratish: { type, from, to, unit?, format } — javob fayl */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(@Body() body: GenerateInput, @CurrentUser('id') userId: string, @Res() response: Response) {
    const file = await this.reports.generate(body ?? {}, userId ?? null);
    sendFile(response, file.buffer, file.filename, file.mime, file.id);
  }

  @Get('history')
  async history(@Query('limit') limit?: string) {
    return { data: await this.reports.history(Number(limit) || 50) };
  }

  @Get('history/:id/file')
  async file(@Param('id') id: string, @Res() response: Response) {
    const file = await this.reports.file(id);
    sendFile(response, file.buffer, file.filename, file.mime);
  }

  @Delete('history/:id')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.reports.remove(id);
  }
}