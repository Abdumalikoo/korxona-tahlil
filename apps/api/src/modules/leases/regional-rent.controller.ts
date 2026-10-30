import { Controller, Get, HttpCode, HttpStatus, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { RegionalRentService } from './regional-rent.service';

const MAX_FILE_SIZE = 15 * 1024 * 1024;

/** Xarajatlar › Hudud ijaralari: /api/regional-rent/… — shablon, tahlil, tasdiqlash (tanlangan oygacha) */
@Controller('regional-rent')
export class RegionalRentController {
  constructor(private readonly rent: RegionalRentService) {}

  /** Bazadagi holat: hudud → tuman → oylar (?year) */
  @Get()
  async current(@Query('year') year?: string) {
    return { data: await this.rent.current(year) };
  }

  /** Shablon (Excel): hududlar ketma-ketligida tumanlar, joriy ijaralar bilan to'ldirilgan */
  @Get('template')
  async template(@Query('year') year: string | undefined, @Res() response: Response) {
    const { buffer, filename } = await this.rent.template(year);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Fayl tahlili — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@UploadedFile() file: Express.Multer.File, @Query('year') year?: string) {
    return { data: await this.rent.analyze(file, year) };
  }

  /** Tasdiqlash: ?year&until (1–12) — fayl qayta o'qiladi */
  @Roles(UserRole.ADMIN)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async commit(@UploadedFile() file: Express.Multer.File, @Query('year') year: string | undefined, @Query('until') until: string | undefined, @CurrentUser('id') userId: string) {
    return { data: await this.rent.commit(file, year, until, userId) };
  }
}
