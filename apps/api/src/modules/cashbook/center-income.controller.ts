import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { CashbookService } from './cashbook.service';
import { CenterIncomeService } from './center-income.service';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Markaz daromadlari — kunlik ma'lumotnomadan oylik daromad (Buxgalter va administrator) */
@Controller('cashbook/center-income')
export class CenterIncomeController {
  constructor(
    private readonly center: CenterIncomeService,
    private readonly cashbook: CashbookService,
  ) {}

  @Get()
  async year(@Query('year') year?: string) {
    return { data: await this.center.year(year) };
  }

  /** Bo'sh shablon — «Kunlik tushum va qoldiq» shakli (hozirgi hisobraqamlar ro'yxati) */
  @Get('template')
  async template(@Res() response: Response) {
    const today = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
    const { buffer, filename } = await this.cashbook.exportXlsx(today, { blank: true });
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Faylni o'qish (saqlamaydi) */
  @Roles(UserRole.ADMIN, UserRole.BUXGALTER)
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async preview(@UploadedFile() file?: Express.Multer.File, @Query('date') date?: string) {
    const { input: _input, ...rest } = await this.center.preview(file?.buffer, date);
    void _input;
    return { data: rest };
  }

  /** Saqlash: kunlik ma'lumotnoma + shu oy Markaz daromadi */
  @Roles(UserRole.ADMIN, UserRole.BUXGALTER)
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async upload(@UploadedFile() file: Express.Multer.File | undefined, @Query('date') date: string | undefined, @CurrentUser('id') userId: string) {
    return { data: await this.center.upload(file?.buffer, date, userId) };
  }

  /** Daromadlarga qayta yozish (bir oy yoki hammasi) */
  @Roles(UserRole.ADMIN, UserRole.BUXGALTER)
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async sync(@Query('period') period: string | undefined, @Query('year') year: string | undefined, @CurrentUser('id') userId: string) {
    if (period) await this.center.syncPeriod(period, userId);
    else await this.center.syncAll(userId);
    return { data: await this.center.year(year ?? period?.slice(0, 4)) };
  }

  /** Qator turlari: Markaz daromadi / Boshqa daromad / Hududlar (hisobot) / Daromad emas */
  @Roles(UserRole.ADMIN, UserRole.BUXGALTER)
  @Patch('modes')
  async modes(@Body() body: unknown, @CurrentUser('id') userId: string) {
    return { data: await this.center.setModes(body, userId) };
  }
}