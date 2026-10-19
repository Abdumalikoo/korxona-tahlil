import { Body, Controller, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { TaxesService } from './taxes.service';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Xarajatlar › Soliqlar: turlar, oy jadvali (hudud × soliq), ish haqidan avtomatik foiz, Excel */
@Controller('taxes')
export class TaxesController {
  constructor(private readonly taxes: TaxesService) {}

  @Get('types')
  async types() {
    return { data: await this.taxes.types() };
  }

  @Roles(UserRole.ADMIN)
  @Patch('types')
  async saveTypes(@Body() body: { types?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.taxes.saveTypes(body?.types, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('sync')
  async sync() {
    return { data: await this.taxes.syncAll() };
  }

  @Get('template')
  async template(@Query('period') period: string, @Res() response: Response) {
    const { buffer, filename } = await this.taxes.template(period);
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Excel o'qiladi (saqlanmaydi) — kataklar qaytadi */
  @Roles(UserRole.ADMIN)
  @Post('parse')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async parse(@Query('period') period: string, @UploadedFile() file: Express.Multer.File) {
    return { data: await this.taxes.parse(period, file) };
  }

  @Get(':period')
  async month(@Param('period') period: string) {
    return { data: await this.taxes.month(period) };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':period')
  async save(@Param('period') period: string, @Body() body: unknown, @CurrentUser('id') userId: string) {
    return { data: await this.taxes.saveMonth(period, body, userId) };
  }

  /** O'tgan oy summalarini shu oyga (bo'sh kataklarga) ko'chirish */
  @Roles(UserRole.ADMIN)
  @Post(':period/copy-previous')
  async copy(@Param('period') period: string, @CurrentUser('id') userId: string) {
    return { data: await this.taxes.copyPrevious(period, userId) };
  }
}