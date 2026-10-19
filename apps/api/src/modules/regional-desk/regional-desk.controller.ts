import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { RegionalDeskService, type IncomeCommitInput, type PayrollCommitInput, type RegionalExpenseInput } from './regional-desk.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Hududchi ish joyi: hududlar daromadi (xizmatlar hisoboti), ish haqi va xarajatlar */
@Controller('regional-desk')
export class RegionalDeskController {
  constructor(private readonly desk: RegionalDeskService) {}

  @Get('lookups')
  async lookups() {
    return { data: await this.desk.lookups() };
  }

  @Get('overview')
  async overview(@Query('period') period?: string) {
    return { data: await this.desk.overview(period) };
  }

  // ── Daromad ──
  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('income/analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyzeIncome(@UploadedFile() file?: Express.Multer.File, @Query('period') period?: string) {
    return { data: await this.desk.analyzeIncome(file, period) };
  }

  /** Bo'sh shablon (manba tizimdagi hisobot tuzilmasida) */
  @Get('income/template')
  async incomeTemplate(@Query('period') period: string, @Res() response: Response) {
    const { buffer, filename } = await this.desk.incomeTemplate(period);
    response.setHeader('Content-Type', XLSX);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('income/commit')
  async commitIncome(@Body() body: IncomeCommitInput, @CurrentUser('id') userId: string) {
    return { data: await this.desk.commitIncome(body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('income/services')
  async createServices(@Body() body: { labels?: string[] }, @CurrentUser('id') userId: string) {
    return { data: await this.desk.createServices(body?.labels, userId) };
  }

  // ── Ish haqi ──
  @Get('payroll/template')
  async payrollTemplate(@Query('period') period: string, @Res() response: Response) {
    const { buffer, filename } = await this.desk.payrollTemplate(period);
    response.setHeader('Content-Type', XLSX);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  @Get('payroll/batches')
  async payrollBatches(@Query('period') period?: string) {
    return { data: await this.desk.payrollBatches(period) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('payroll/analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyzePayroll(@Query('period') period: string, @UploadedFile() file?: Express.Multer.File) {
    return { data: await this.desk.analyzePayroll(period, file) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('payroll/commit')
  async commitPayroll(@Body() body: PayrollCommitInput, @CurrentUser('id') userId: string) {
    return { data: await this.desk.commitPayroll(body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('payroll/:id/cancel')
  async cancelPayroll(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.desk.cancelPayroll(id, userId) };
  }

  // ── Xarajatlar ──
  @Get('expenses')
  async expenses(@Query('period') period: string, @Query('region') region?: string) {
    return { data: await this.desk.expenses(period, region !== undefined && region !== '' ? Number(region) : undefined) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('expenses')
  async createExpense(@Body() body: RegionalExpenseInput, @CurrentUser('id') userId: string) {
    return { data: await this.desk.createExpense(body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Patch('expenses/:id')
  async updateExpense(@Param('id') id: string, @Body() body: RegionalExpenseInput, @CurrentUser('id') userId: string) {
    return { data: await this.desk.updateExpense(id, body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Delete('expenses/:id')
  async deleteExpense(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.desk.deleteExpense(id, userId) };
  }
}