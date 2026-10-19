import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { BudgetService } from './budget.service';
import { CatalogService, EVENT_KINDS, type EventInput, type TariffInput } from './catalog.service';
import { PeriodCloseService } from './period-close.service';
import { QualityService } from './quality.service';
import { StaffingService, type SalaryInput } from './staffing.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function send(response: Response, file: { buffer: Buffer; filename: string }) {
  response.setHeader('Content-Type', XLSX);
  response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
  response.send(file.buffer);
}

/** Hududchi: tahlil uchun ma'lumot asosi — sifat, oyni yopish, voqealar, tariflar, shtat-maosh, xarajat rejasi */
@Controller('regional-data')
export class RegionalDataController {
  constructor(
    private readonly quality: QualityService,
    private readonly closes: PeriodCloseService,
    private readonly catalog: CatalogService,
    private readonly staffing: StaffingService,
    private readonly budget: BudgetService,
  ) {}

  // ── Sifat va oyni yopish ──
  @Get('quality')
  async check(@Query('period') period: string) {
    return { data: await this.quality.check(period) };
  }

  @Get('closes')
  async closeList(@Query('year') year?: string) {
    return { data: await this.closes.list(year) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('closes/:period/close')
  async close(@Param('period') period: string, @Body() body: { note?: string }, @CurrentUser('id') userId: string) {
    return { data: await this.closes.close(period, body?.note, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('closes/:period/reopen')
  async reopen(@Param('period') period: string, @Body() body: { reason?: string }, @CurrentUser('id') userId: string, @CurrentUser('role') role: string) {
    return { data: await this.closes.reopen(period, body?.reason, userId, role) };
  }

  // ── Voqealar jurnali ──
  @Get('events')
  async events() {
    return { data: { kinds: EVENT_KINDS, items: await this.catalog.events() } };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('events')
  async createEvent(@Body() body: EventInput, @CurrentUser('id') userId: string) {
    return { data: await this.catalog.createEvent(body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Patch('events/:id')
  async updateEvent(@Param('id') id: string, @Body() body: EventInput, @CurrentUser('id') userId: string) {
    return { data: await this.catalog.updateEvent(id, body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Delete('events/:id')
  async deleteEvent(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.catalog.deleteEvent(id, userId) };
  }

  // ── Tariflar ──
  @Get('tariffs')
  async tariffs() {
    return { data: await this.catalog.tariffs() };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('tariffs')
  async propose(@Body() body: TariffInput, @CurrentUser('id') userId: string) {
    return { data: await this.catalog.proposeTariff(body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('tariffs/:id/decide')
  async decide(@Param('id') id: string, @Body() body: { approve?: boolean }, @CurrentUser('id') userId: string, @CurrentUser('role') role: string) {
    return { data: await this.catalog.decideTariff(id, body?.approve === true, userId, role) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Delete('tariffs/:id')
  async deleteTariff(@Param('id') id: string, @CurrentUser('id') userId: string, @CurrentUser('role') role: string) {
    return { data: await this.catalog.deleteTariff(id, userId, role) };
  }

  // ── Shtat va maosh ──
  @Get('staff')
  async staff() {
    return { data: await this.staffing.list() };
  }

  @Get('staff/template')
  async staffTemplate(@Res() response: Response) {
    send(response, await this.staffing.template());
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('staff/import/analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async staffAnalyze(@UploadedFile() file?: Express.Multer.File) {
    return { data: await this.staffing.analyzeImport(file) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('staff/import/commit')
  async staffCommit(@Body() body: { rows?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.staffing.commitImport(body?.rows, userId) };
  }

  @Get('staff/:pinfl')
  async staffHistory(@Param('pinfl') pinfl: string) {
    return { data: await this.staffing.history(pinfl) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('staff/:pinfl')
  async staffAdd(@Param('pinfl') pinfl: string, @Body() body: SalaryInput, @CurrentUser('id') userId: string) {
    return { data: await this.staffing.add(pinfl, body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Delete('staff/salary/:id')
  async staffRemove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.staffing.remove(id, userId) };
  }

  // ── Xarajat rejasi ──
  @Get('budget')
  async budgetGrid(@Query('period') period: string, @Query('region') region: string) {
    return { data: await this.budget.grid(period, region) };
  }

  @Get('budget/summary')
  async budgetSummary(@Query('period') period: string) {
    return { data: await this.budget.summary(period) };
  }

  @Get('budget/template')
  async budgetTemplate(@Query('period') period: string, @Res() response: Response) {
    send(response, await this.budget.template(period));
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('budget')
  async budgetSave(@Body() body: { period?: string; regionCode?: number; items?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.budget.save(String(body?.period ?? ''), body?.regionCode, body?.items, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('budget/copy')
  async budgetCopy(@Body() body: { period?: string; regionCode?: number }, @CurrentUser('id') userId: string) {
    return { data: await this.budget.copyPrevious(String(body?.period ?? ''), body?.regionCode, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('budget/import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async budgetImport(@Query('period') period: string, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser('id') userId: string) {
    return { data: await this.budget.importFile(period, file, userId) };
  }
}