import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { CashbookService, type CashAccountInput, type CashSaveInput } from './cashbook.service';
import { CenterIncomeService } from './center-income.service';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Buxgalteriya: hisobraqamlar bo'yicha kunlik tushum va qoldiq */
@Controller('cashbook')
export class CashbookController {
  constructor(
    private readonly cashbook: CashbookService,
    private readonly center: CenterIncomeService,
  ) {}

  @Get('overview')
  async overview() {
    return { data: await this.cashbook.overview() };
  }

  @Get('reports')
  async reports(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.cashbook.reports(from, to) };
  }

  // ── Hisobraqamlar ──
  @Get('accounts')
  async accounts() {
    return { data: await this.cashbook.accounts() };
  }

  @Roles(UserRole.ADMIN, UserRole.BUXGALTER)
  @Post('accounts')
  async createAccount(@Body() body: CashAccountInput, @CurrentUser('id') userId: string) {
    return { data: await this.cashbook.createAccount(body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.BUXGALTER)
  @Patch('accounts/:id')
  async updateAccount(@Param('id') id: string, @Body() body: CashAccountInput, @CurrentUser('id') userId: string) {
    return { data: await this.cashbook.updateAccount(id, body, userId) };
  }

  @Roles(UserRole.ADMIN, UserRole.BUXGALTER)
  @Post('accounts/:id/move')
  async move(@Param('id') id: string, @Body() body: { dir?: string }) {
    return { data: await this.cashbook.move(id, body?.dir === 'up' ? 'up' : 'down') };
  }

  // ── Excel'dan o'qish (saqlamaydi) ──
  @Roles(UserRole.ADMIN, UserRole.BUXGALTER)
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async importFile(@UploadedFile() file?: Express.Multer.File) {
    return { data: await this.cashbook.parseImport(file?.buffer) };
  }

  // ── Kun ──
  @Get('day/:date')
  async day(@Param('date') date: string) {
    return { data: await this.cashbook.day(date) };
  }

  @Get('day/:date/export')
  async exportDay(@Param('date') date: string, @Res() response: Response) {
    const { buffer, filename } = await this.cashbook.exportXlsx(date);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  @Roles(UserRole.ADMIN, UserRole.BUXGALTER)
  @Post('day/:date')
  async save(@Param('date') date: string, @Body() body: CashSaveInput, @CurrentUser('id') userId: string) {
    const day = await this.cashbook.save(date, body, userId);
    // Markaz daromadi (oylik) — shu oy va keyingi oy qayta yoziladi
    await this.center.afterDayChange(day.date, userId);
    return { data: day };
  }

  @Roles(UserRole.ADMIN)
  @Delete('day/:date')
  async remove(@Param('date') date: string, @CurrentUser('id') userId: string) {
    const res = await this.cashbook.remove(date, userId);
    await this.center.afterDayChange(date, userId);
    return { data: res };
  }
}