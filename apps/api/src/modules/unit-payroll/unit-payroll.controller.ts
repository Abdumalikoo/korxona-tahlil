import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { UnitPayrollService } from './unit-payroll.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Yo'nalish ish haqi: /api/unit-payroll/:unit/… (unit — TAX_FREE, MARKSHEYDER, FERMER, BUXGALTERIYA).
 * Shablon (2-varaq — faqat shu bo'lim xodimlari), tahlil, saqlash, tarix, bo'lim xodimlari ro'yxati.
 */
@Controller('unit-payroll')
export class UnitPayrollController {
  constructor(private readonly service: UnitPayrollService) {}

  @Get(':unit/staff')
  async staff(@Param('unit') unit: string) {
    return { data: await this.service.staff(this.service.unitOf(unit)) };
  }

  @Get(':unit/lookup/:pinfl')
  async lookup(@Param('unit') unit: string, @Param('pinfl') pinfl: string) {
    return { data: await this.service.lookup(this.service.unitOf(unit), pinfl) };
  }

  @Roles(UserRole.ADMIN)
  @Post(':unit/staff')
  @HttpCode(HttpStatus.OK)
  async addStaff(@Param('unit') unit: string, @Body() body: { pinfl?: unknown; fullName?: unknown; position?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.addStaff(this.service.unitOf(unit), body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':unit/staff/:pinfl')
  async updateStaff(
    @Param('unit') unit: string,
    @Param('pinfl') pinfl: string,
    @Body() body: { active?: unknown; fullName?: unknown; position?: unknown },
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.updateStaff(this.service.unitOf(unit), pinfl, body, userId) };
  }

  @Get(':unit/template')
  async template(@Param('unit') unit: string, @Query('period') period: string, @Res() response: Response) {
    const { buffer, filename } = await this.service.template(this.service.unitOf(unit), period);
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Faylni tahlil qilish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post(':unit/analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@Param('unit') unit: string, @Query('period') period: string, @UploadedFile() file: Express.Multer.File) {
    return { data: await this.service.analyze(this.service.unitOf(unit), period, file) };
  }

  @Roles(UserRole.ADMIN)
  @Post(':unit/commit')
  @HttpCode(HttpStatus.OK)
  async commit(
    @Param('unit') unit: string,
    @Query('period') period: string,
    @Query('replace') replace: string,
    @Body() body: { rows?: unknown; fileName?: unknown },
    @CurrentUser('id') userId: string,
  ) {
    return { data: await this.service.commit(this.service.unitOf(unit), period, body, replace === 'true', userId) };
  }

  @Get(':unit/batches')
  async batches(@Param('unit') unit: string, @Query('period') period: string) {
    return { data: await this.service.batches(this.service.unitOf(unit), period) };
  }

  @Get(':unit/batches/:id')
  async batch(@Param('unit') unit: string, @Param('id') id: string, @Query('period') period: string) {
    return { data: await this.service.batch(this.service.unitOf(unit), period, id) };
  }

  @Roles(UserRole.ADMIN)
  @Post(':unit/batches/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('unit') unit: string, @Param('id') id: string, @Query('period') period: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.cancel(this.service.unitOf(unit), period, id, userId) };
  }
}