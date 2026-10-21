import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { KIND_ORDER, KINDS, MAX_FILE_SIZE } from './hp.const';
import { HpExportService } from './hp.export';
import { HpImportService } from './hp.import.service';
import { HpService } from './hp.service';

/**
 * Hudud uchun reja — statistik prognoz va xodimlar rejasi.
 * Ko'rish va eksport — administrator va kuzatuvchi; yuklash, hisoblash, tuzatish va tasdiqlash — faqat administrator.
 */
@Controller('hudud-reja')
export class HpController {
  constructor(
    private readonly hp: HpService,
    private readonly imports: HpImportService,
    private readonly exporter: HpExportService,
  ) {}

  private static send(res: Response, file: { buffer: Buffer; filename: string }) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(file.buffer);
  }

  // ── Ma'lumotlar: shablon, tekshirish, import ──

  @Get('templates/:kind')
  async template(@Param('kind') kind: string, @Query('fill') fill: string | undefined, @Res() res: Response) {
    HpController.send(res, await this.imports.template(kind, fill === '1'));
  }

  /** Shablon turlari: nima uchun, bir qator nimani bildiradi, ustunlar (majburiylari bilan) */
  @Get('kinds')
  kinds() {
    return {
      data: KIND_ORDER.map((k) => {
        const d = KINDS[k];
        return { kind: d.kind, sheet: d.sheet, title: d.title, what: d.what, why: d.why, row: d.row, key: d.key, mandatory: d.mandatory, cols: d.cols.map((c) => ({ key: c.key, label: c.label, type: c.type, required: c.required, hint: c.hint })) };
      }),
    };
  }

  @Get('data/status')
  async dataStatus() {
    return { data: await this.imports.status() };
  }

  @Roles(UserRole.ADMIN)
  @Post('imports/check')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async check(@UploadedFile() file: Express.Multer.File, @Query('kind') kind: string, @CurrentUser('id') userId: string) {
    return { data: await this.imports.check(file, kind ?? 'ALL', userId) };
  }

  @Get('imports')
  async imports_(@Query('kind') kind?: string) {
    return { data: await this.imports.list(kind) };
  }

  @Get('imports/:id')
  async importOne(@Param('id') id: string) {
    return { data: await this.imports.get(id) };
  }

  @Roles(UserRole.ADMIN)
  @Post('imports/:id/confirm')
  async confirm(@Param('id') id: string, @Body() body: { policy?: unknown; excludeRows?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.imports.confirm(id, body ?? {}, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('imports/:id/cancel')
  async cancel(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.imports.cancel(id, userId) };
  }

  // ── Dashboard va sifat ──

  @Get('overview')
  async overview(@Query() q: Record<string, string>) {
    return { data: await this.hp.overview(q) };
  }

  @Get('quality')
  async quality(@Query() q: Record<string, string>) {
    return { data: await this.hp.quality(q) };
  }

  // ── Hisoblash ──

  @Post('precheck')
  async precheck(@Body() body: Record<string, unknown>) {
    return { data: await this.hp.precheck(body ?? {}) };
  }

  @Roles(UserRole.ADMIN)
  @Post('runs')
  async start(@Body() body: Record<string, unknown>, @CurrentUser('id') userId: string) {
    return { data: await this.hp.start(body ?? {}, userId) };
  }

  @Get('runs')
  async runs(@Query('target') target?: string) {
    return { data: await this.hp.list(target) };
  }

  @Get('runs/:id')
  async run(@Param('id') id: string) {
    return { data: await this.hp.get(id) };
  }

  @Get('runs/:id/regions')
  async regions(@Param('id') id: string) {
    return { data: await this.hp.regions(id) };
  }

  @Get('runs/:id/services')
  async services(@Param('id') id: string, @Query('region') region?: string) {
    return { data: await this.hp.services(id, region) };
  }

  @Get('runs/:id/series')
  async series(@Param('id') id: string, @Query('region') region: string, @Query('service') service: string) {
    return { data: await this.hp.series(id, region, service) };
  }

  @Get('runs/:id/employees')
  async employees(@Param('id') id: string, @Query('region') region?: string) {
    return { data: await this.hp.employees(id, region) };
  }

  @Roles(UserRole.ADMIN)
  @Post('runs/:id/assign')
  async assign(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser('id') userId: string) {
    return { data: await this.hp.assign(id, body ?? {}, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Delete('runs/:id/assign/:index')
  async unassign(@Param('id') id: string, @Param('index') index: string, @CurrentUser('id') userId: string) {
    return { data: await this.hp.unassign(id, Number(index), userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('runs/:id/approve')
  async approve(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser('id') userId: string) {
    return { data: await this.hp.approve(id, body ?? {}, userId) };
  }

  @Get('runs/:id/export')
  async export(@Param('id') id: string, @Query('kind') kind: string, @Res() res: Response) {
    HpController.send(res, await this.exporter.build(id, kind ?? 'full'));
  }

  // ── Tasdiqlangan versiyalar ──

  @Get('plans')
  async plans(@Query('target') target: string) {
    return { data: await this.hp.versions(target) };
  }

  @Get('plans/:id')
  async plan(@Param('id') id: string) {
    return { data: await this.hp.version(id) };
  }

  @Roles(UserRole.ADMIN)
  @Patch('plans/:id/restore')
  async restore(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser('id') userId: string) {
    return { data: await this.hp.restore(id, body ?? {}, userId) };
  }
}