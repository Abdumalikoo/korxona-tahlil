import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { UnitBankService } from './unit-bank.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Yo'nalish bank xarajatlari: /api/unit-bank/:unit/…
 * Shablon — bank ko'chirmasi shakli; yuklangan fayldagi hamma oylar o'qiladi (debet qatorlari — xarajat).
 */
@Controller('unit-bank')
export class UnitBankController {
  constructor(private readonly service: UnitBankService) {}

  @Get(':unit/template')
  async template(@Param('unit') unit: string, @Res() response: Response) {
    const { buffer, filename } = await this.service.template(this.service.unitOf(unit));
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Faylni tahlil qilish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post(':unit/analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@Param('unit') unit: string, @UploadedFile() file: Express.Multer.File) {
    return { data: await this.service.analyze(this.service.unitOf(unit), file) };
  }

  @Roles(UserRole.ADMIN)
  @Post(':unit/commit')
  @HttpCode(HttpStatus.OK)
  async commit(@Param('unit') unit: string, @Body() body: { fileName?: unknown; months?: unknown; rows?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.commit(this.service.unitOf(unit), body, userId) };
  }

  @Get(':unit/data')
  async data(@Param('unit') unit: string, @Query('from') from: string, @Query('to') to: string) {
    return { data: await this.service.data(this.service.unitOf(unit), from, to) };
  }

  @Get(':unit/batches')
  async batches(@Param('unit') unit: string) {
    return { data: await this.service.batches(this.service.unitOf(unit)) };
  }

  @Roles(UserRole.ADMIN)
  @Post(':unit/batches/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('unit') unit: string, @Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.cancel(this.service.unitOf(unit), id, userId) };
  }
}