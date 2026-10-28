import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { CurrentUser, Personal, Roles } from '../../common/decorators';
import { Vedomost3802Service } from './vedomost-3802.service';

const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** 3802 › Har oylik real bajarilgan ishlar: /api/qomita/3802/oylik/… */
@Controller('qomita/3802/oylik')
export class Vedomost3802Controller {
  constructor(private readonly ved: Vedomost3802Service) {}

  /** Qabul qilingan oylar (qisqa) */
  @Get()
  async list() {
    return { data: await this.ved.list() };
  }

  /** Faylni o'qish — undagi hamma oylar, hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@UploadedFile() file: Express.Multer.File) {
    return { data: await this.ved.analyze(file) };
  }

  /** Qabul qilish: ?from=YYYY-MM&to=YYYY-MM — faqat shu oraliqdagi oylar (fayl qayta o'qiladi) */
  @Roles(UserRole.ADMIN)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async commit(@UploadedFile() file: Express.Multer.File, @Query('from') from: string, @Query('to') to: string, @CurrentUser('id') userId: string) {
    return { data: await this.ved.commit(file, from, to, userId) };
  }

  /** Qabul qilingan oy(lar)ni o'chirish: ?from=YYYY-MM&to=YYYY-MM */
  @Roles(UserRole.ADMIN)
  @Delete()
  async remove(@Query('from') from: string, @Query('to') to: string, @CurrentUser('id') userId: string) {
    return { data: await this.ved.remove(from, to, userId) };
  }

  /** Bitta oy: bo'limlar → xodimlar (shaxsiy ma'lumot) */
  @Personal()
  @Get(':period')
  async detail(@Param('period') period: string) {
    return { data: await this.ved.detail(period) };
  }
}
