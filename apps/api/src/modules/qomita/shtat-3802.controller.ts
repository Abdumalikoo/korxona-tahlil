import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Personal, Roles } from '../../common/decorators';
import { Shtat3802Service } from './shtat-3802.service';

const MAX_FILE_SIZE = 15 * 1024 * 1024;

/** 3802 › Shtatlar: /api/qomita/3802/shtat/… — ikki toifa (?kind=OLADI | OLMAYDI), har biri alohida yuklanadi */
@Controller('qomita/3802/shtat')
export class Shtat3802Controller {
  constructor(private readonly shtat: Shtat3802Service) {}

  /** Ikkala toifaning saqlangan jadvali, bo'limlar sozlamasi va bog'lash uchun bo'limlar ro'yxati */
  @Get()
  async view() {
    return { data: await this.shtat.view() };
  }

  /** Shablon (Excel): fayldagi shakl, yo'riqnoma bilan */
  @Get('template')
  async template(@Query('kind') kind: string, @Res() response: Response) {
    const { buffer, filename } = await this.shtat.template(kind);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Faylni o'qish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@Query('kind') kind: string, @UploadedFile() file: Express.Multer.File) {
    return { data: await this.shtat.analyze(kind, file) };
  }

  /** Saqlash (fayl qayta o'qiladi) — shu toifaning avvalgi jadvali almashtiriladi, bo'limlar sozlamasi qoladi */
  @Roles(UserRole.ADMIN)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async commit(@Query('kind') kind: string, @UploadedFile() file: Express.Multer.File, @CurrentUser('id') userId: string) {
    return { data: await this.shtat.commit(kind, file, userId) };
  }

  /** Bo'lim sozlamasi: { kind, section, departmentId, coverage: OKLAD_40 | FULL | NONE } */
  @Roles(UserRole.ADMIN)
  @Post('section')
  @HttpCode(HttpStatus.OK)
  async section(@Body() body: { kind?: unknown; section?: unknown; departmentId?: unknown; coverage?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.shtat.setSection(body, userId) };
  }

  /** Shu toifaga kimlar kiradi: ?kind&period (ish haqi tarkibi oyi) — xodimlar ro'yxati (shaxsiy ma'lumot) */
  @Personal()
  /** Yuklangan shtatni o'chirish: ?kind=OLADI | OLMAYDI */
  @Roles(UserRole.ADMIN)
  @Delete()
  async remove(@Query('kind') kind: string, @CurrentUser('id') userId: string) {
    return { data: await this.shtat.remove(kind, userId) };
  }

  @Get('members')
  async members(@Query('kind') kind: string, @Query('period') period?: string) {
    return { data: await this.shtat.members(kind, period) };
  }
}
