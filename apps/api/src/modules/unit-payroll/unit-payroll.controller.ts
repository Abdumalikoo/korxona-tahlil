import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Personal, Roles } from '../../common/decorators';
import { UnitPayrollService } from './unit-payroll.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Yo'nalish ish haqi: /api/unit-payroll/:unit/… (unit — TAX_FREE, MARKSHEYDER, FERMER, BUXGALTERIYA, QOMITA).
 * Shablon (2-varaq — faqat shu bo'lim xodimlari), tahlil, saqlash, tarix, bo'lim xodimlari ro'yxati.
 */
@Controller('unit-payroll')
export class UnitPayrollController {
  constructor(private readonly service: UnitPayrollService) {}

  /** Bo'lim xodimlari (?period=YYYY-MM — o'sha oydagi tarkib; ko'chishlar bilan) */
  @Personal()
  @Get(':unit/staff')
  async staff(@Param('unit') unit: string, @Query('period') period?: string) {
    return { data: await this.service.staff(this.service.unitOf(unit), period) };
  }

  /** Shu oy saqlangan ish haqi — xodimlar bo'yicha (?period=YYYY-MM) */
  @Personal()
  @Get(':unit/saved')
  async saved(@Param('unit') unit: string, @Query('period') period: string) {
    return { data: await this.service.saved(this.service.unitOf(unit), period) };
  }

  /** Shu oy ish haqidan xodimlarni olib tashlash: { pinfls } */
  @Roles(UserRole.ADMIN)
  @Post(':unit/saved/remove')
  @HttpCode(HttpStatus.OK)
  async removeRows(@Param('unit') unit: string, @Query('period') period: string, @Body() body: { pinfls?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.removeRows(this.service.unitOf(unit), period, body, userId) };
  }

  /** Shu oyda boshqa bo'limda ishlagan: { pinfls, target, onlyThisMonth?, withAmount?, place? { departmentId } | { regionCode, districtId? } } */
  @Roles(UserRole.ADMIN)
  @Post(':unit/saved/move')
  @HttpCode(HttpStatus.OK)
  async moveRows(@Param('unit') unit: string, @Query('period') period: string, @Body() body: { pinfls?: unknown; target?: unknown; onlyThisMonth?: unknown; withAmount?: unknown; place?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.moveRows(this.service.unitOf(unit), period, body, userId) };
  }

  /** Bo'limlar o'rtasida ko'chishlar: shu bo'limga kelgan / ketgan (?pinfl — bitta xodim) */
  @Personal()
  @Get(':unit/moves')
  async moves(@Param('unit') unit: string, @Query('pinfl') pinfl?: string) {
    return { data: await this.service.moves({ unit: this.service.unitOf(unit), pinfl: pinfl || undefined }) };
  }

  /** Ko'chirish: { pinfl, unit (CENTER, REGION, TAX_FREE …), from: YYYY-MM, note? } */
  @Roles(UserRole.ADMIN)
  @Post(':unit/moves')
  async addMove(@Param('unit') unit: string, @Body() body: { pinfl?: unknown; unit?: unknown; from?: unknown; note?: unknown; fullName?: unknown }, @CurrentUser('id') userId: string) {
    this.service.unitOf(unit);
    return { data: await this.service.addMove(body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Delete(':unit/moves/:id')
  async removeMove(@Param('unit') unit: string, @Param('id') id: string, @CurrentUser('id') userId: string) {
    this.service.unitOf(unit);
    return { data: await this.service.removeMove(id, userId) };
  }

  /** Xodimlar bazasi bilan bog'lash: qaysi bo'limlar (avtomatik — nomi bo'yicha), lavozim bo'yicha */
  @Get(':unit/link')
  async link(@Param('unit') unit: string) {
    return { data: await this.service.link(this.service.unitOf(unit)) };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':unit/link')
  async setLink(@Param('unit') unit: string, @Body() body: { departmentIds?: unknown; byPosition?: unknown; byHr?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.setLink(this.service.unitOf(unit), body ?? {}, userId) };
  }

  @Personal()
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
  async template(@Param('unit') unit: string, @Query('period') period: string, @Res() response: Response, @Query('from') from?: string, @Query('to') to?: string) {
    // ?from=&to= — oylar oralig'i; bo'lmasa — bitta oy (?period=)
    const { buffer, filename } = await this.service.template(this.service.unitOf(unit), from || period, to || from || period);
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Faylni tahlil qilish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post(':unit/analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@Param('unit') unit: string, @Query('period') period: string, @Query('format') format: string, @UploadedFile() file: Express.Multer.File) {
    return { data: await this.service.analyze(this.service.unitOf(unit), period, file, format === 'ndfl' ? 'ndfl' : 'auto') };
  }

  /** Fayldagi hamma oylar (oylar oralig'i shabloni); eski shablon — ?period= oyi; soliq hisoboti — ?period= oyi (?format=ndfl — faqat u) */
  @Roles(UserRole.ADMIN)
  @Post(':unit/analyze-many')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyzeMany(@Param('unit') unit: string, @Query('period') period: string, @Query('format') format: string, @UploadedFile() file: Express.Multer.File) {
    return { data: await this.service.analyzeMany(this.service.unitOf(unit), period, file, format === 'ndfl' ? 'ndfl' : 'auto') };
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

  @Personal()
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