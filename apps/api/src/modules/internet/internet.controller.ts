import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { InternetService } from './internet.service';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Xarajatlar › Internet: shartnomalar ro'yxati, oylik to'lovlar tahlili va xarajatga yozish */
@Controller('internet')
export class InternetController {
  constructor(private readonly internet: InternetService) {}

  /** Ro'yxat, modda, bo'lim va hududlar, yozilgan to'lovlar (shartnoma × oy) */
  @Get()
  async overview() {
    return { data: await this.internet.overview() };
  }

  /** Ro'yxatni saqlash; applyToPosted — yozilgan xarajatlar ham yangi biriktirishga o'tadi */
  @Roles(UserRole.ADMIN)
  @Patch('registry')
  async saveRegistry(@Body() body: { contracts?: unknown[]; categoryCode?: unknown; applyToPosted?: boolean }) {
    return { data: await this.internet.saveRegistry(body) };
  }

  /** Faylni o'qish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@UploadedFile() file: Express.Multer.File) {
    return { data: await this.internet.analyze(file) };
  }

  /** To'lovlarni xarajat sifatida yozish */
  @Roles(UserRole.ADMIN)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  async commit(@Body() body: { fileName?: unknown; payments?: unknown[]; contracts?: unknown[]; categoryCode?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.internet.commit(body, userId) };
  }

  /** Bo'sh shablon (joriy ro'yxat bilan) */
  @Get('template')
  async template(@Res() res: Response) {
    const { buffer, filename } = await this.internet.template();
    this.send(res, buffer, filename);
  }

  /** Yuklangan fayldan to'ldirilgan shablon: shartnomalar, oylar bo'yicha summalar va tahlil */
  @Roles(UserRole.ADMIN)
  @Post('template')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async templateFrom(@UploadedFile() file: Express.Multer.File, @Res() res: Response) {
    const { buffer, filename } = await this.internet.template(file);
    this.send(res, buffer, filename);
  }

  private send(res: Response, buffer: Buffer, filename: string) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
  }
}