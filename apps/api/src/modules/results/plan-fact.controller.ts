import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { PlanFactService } from './plan-fact.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Xodimlar reja / tushum fayli (bir nechta oy) — administrator (Daromadlar) va Hududchi uchun.
 * Saqlanganda Natijalar (Solishtirma, ustama) bilan bir joyga tushadi.
 */
@Controller('plan-fact')
export class PlanFactController {
  constructor(private readonly planFact: PlanFactService) {}

  @Get('template')
  async template(@Query('year') year: string | undefined, @Query('months') months: string | undefined, @Res() response: Response) {
    const { buffer, filename } = await this.planFact.template(year, months);
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Faylni tahlil qilish — hech narsa saqlanmaydi; months=3,4 — faqat shu oylar (oy nomisiz faylda — bitta oy majburiy) */
  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@UploadedFile() file: Express.Multer.File | undefined, @Query('year') year?: string, @Query('months') months?: string) {
    return { data: await this.planFact.analyze(file, year, months) };
  }

  /** Saqlash — fayl qayta o'qiladi; months=3,4 yoki 2026-03,2026-04 (bo'sh — fayldagi hamma oylar) */
  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async commit(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('year') year: string | undefined,
    @Query('months') months: string | undefined,
    @Query('payroll') payroll: string | undefined,
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.planFact.commit(file, year, months, userId, payroll !== '0') };
  }

  /** Faylda bor, reestrda yo'q xodimlarni Xodimlarga qo'shish */
  @Roles(UserRole.ADMIN, UserRole.HUDUDCHI)
  @Post('add-employees')
  @HttpCode(HttpStatus.OK)
  async addEmployees(@Body() body: { employees?: unknown }, @CurrentUser('id') id: string, @CurrentUser('role') role: string) {
    return { data: await this.planFact.addEmployees(body?.employees, { id, role }) };
  }
}