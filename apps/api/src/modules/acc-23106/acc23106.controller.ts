import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Personal, Roles } from '../../common/decorators';
import { Acc23106Service } from './acc23106.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Xarajatlar › 23106 — xodimlarga to'lovlar ko'chirmasi: /api/acc-23106/…
 * Xodim (PINFL / izohdagi F.I.Sh.), sana, nima uchun (izohdan), buyruq; ish haqi tarkibi va soliq hisoboti bilan nazorat.
 */
@Controller('acc-23106')
export class Acc23106Controller {
  constructor(private readonly service: Acc23106Service) {}

  @Get('template')
  async template(@Res() response: Response) {
    const { buffer, filename } = await this.service.template();
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Faylni tahlil qilish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@UploadedFile() file: Express.Multer.File) {
    return { data: await this.service.analyze(file) };
  }

  /** Saqlash: tanlangan oylar (shu oylarning oldingi ko'chirmasi almashtiriladi) */
  @Roles(UserRole.ADMIN)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  async commit(@Body() body: { fileName?: unknown; months?: unknown; rows?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.commit(body, userId) };
  }

  /** Saqlangan to'lovlar va nazorat (?from=YYYY-MM&to=YYYY-MM) */
  @Personal()
  @Get('view')
  async view(@Query('from') from: string, @Query('to') to: string) {
    return { data: await this.service.view(from, to) };
  }

  @Get('batches')
  async batches() {
    return { data: await this.service.batches() };
  }

  @Roles(UserRole.ADMIN)
  @Post('batches/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.cancel(id, userId) };
  }
}