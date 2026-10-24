import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { HrSheetsService } from './hr-sheets.service';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Xodimlar › Ma'lumotnomalar (10, 16, 37, 51-jadval) va «Miya» (xodim kartasi): /api/hr-sheets/…
 * Shaxsiy ma'lumotlar — hamma amallar faqat administrator uchun.
 */
@Roles(UserRole.ADMIN)
@Controller('hr-sheets')
export class HrSheetsController {
  constructor(private readonly service: HrSheetsService) {}

  @Get()
  async overview() {
    return { data: await this.service.overview() };
  }

  @Get('search')
  async search(@Query('q') q: string) {
    return { data: await this.service.search(q) };
  }

  @Get('person/:pinfl')
  async person(@Param('pinfl') pinfl: string) {
    return { data: await this.service.person(pinfl) };
  }

  @Get(':code/rows')
  async rows(@Param('code') code: string, @Query() query: { q?: string; unit?: string; page?: string; limit?: string }) {
    return { data: await this.service.rows(code, query) };
  }

  @Get(':code/template')
  async template(@Param('code') code: string, @Res() response: Response) {
    const { buffer, filename } = await this.service.template(code);
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  @Get(':code/export')
  async export(@Param('code') code: string, @CurrentUser('id') userId: string, @Res() response: Response) {
    const { buffer, filename } = await this.service.export(code, userId);
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Faylni tahlil qilish — hali saqlanmaydi (30 daqiqa ichida «Saqlash») */
  @Post(':code/analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@Param('code') code: string, @UploadedFile() file: Express.Multer.File, @CurrentUser('id') userId: string) {
    return { data: await this.service.analyze(code, file, userId) };
  }

  @Post(':code/commit')
  @HttpCode(HttpStatus.OK)
  async commit(@Param('code') code: string, @Body() body: { token?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.commit(code, body, userId) };
  }

  @Post(':code/restore')
  @HttpCode(HttpStatus.OK)
  async restore(@Param('code') code: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.restore(code, userId) };
  }

  @Delete(':code')
  async clear(@Param('code') code: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.clear(code, userId) };
  }
}