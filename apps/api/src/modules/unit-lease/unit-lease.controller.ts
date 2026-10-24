import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { UnitLeaseService } from './unit-lease.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Yo'nalish ijara va kommunal to'lovlari (filiallar kesimida): /api/unit-lease/:unit/…
 * Shablon oylar oralig'i uchun (from–to), yuklangan fayldagi hamma oylar o'qiladi.
 */
@Controller('unit-lease')
export class UnitLeaseController {
  constructor(private readonly service: UnitLeaseService) {}

  @Get(':unit/branches')
  branches(@Param('unit') unit: string) {
    return { data: this.service.branches(this.service.unitOf(unit)) };
  }

  @Get(':unit/template')
  async template(@Param('unit') unit: string, @Query('from') from: string, @Query('to') to: string, @Res() response: Response) {
    const { buffer, filename } = await this.service.template(this.service.unitOf(unit), from, to);
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