import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { UnitEntriesService } from './unit-entries.service';

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Yo'nalish xarajatlari — qo'lda kiritish jadvali: /api/unit-entries/:unit/:kind/…
 * kind: ASSET (asosiy vositalar), AD (reklama), OTHER (boshqa xarajatlar).
 */
@Controller('unit-entries')
export class UnitEntriesController {
  constructor(private readonly service: UnitEntriesService) {}

  private send(response: Response, file: { buffer: Buffer; filename: string }) {
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.filename)}"`);
    response.send(file.buffer);
  }

  @Get(':unit/:kind')
  async list(@Param('unit') unit: string, @Param('kind') kind: string, @Query('from') from: string, @Query('to') to: string) {
    return { data: await this.service.list(this.service.unitOf(unit), this.service.kindOf(kind), from, to) };
  }

  /** Qatorlarni saqlash: { rows: [{ id?, date, name, branch, counterparty, docNo, qty, priceTiyin, amountTiyin, note }] } */
  @Roles(UserRole.ADMIN)
  @Post(':unit/:kind/save')
  @HttpCode(HttpStatus.OK)
  async save(@Param('unit') unit: string, @Param('kind') kind: string, @Body() body: { rows?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.save(this.service.unitOf(unit), this.service.kindOf(kind), body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post(':unit/:kind/delete')
  @HttpCode(HttpStatus.OK)
  async remove(@Param('unit') unit: string, @Param('kind') kind: string, @Body() body: { ids?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.remove(this.service.unitOf(unit), this.service.kindOf(kind), body, userId) };
  }

  @Get(':unit/:kind/template')
  async template(@Param('unit') unit: string, @Param('kind') kind: string, @Res() response: Response) {
    this.send(response, await this.service.template(this.service.unitOf(unit), this.service.kindOf(kind)));
  }

  @Get(':unit/:kind/export')
  async exportExcel(@Param('unit') unit: string, @Param('kind') kind: string, @Query('from') from: string, @Query('to') to: string, @Res() response: Response) {
    this.send(response, await this.service.exportExcel(this.service.unitOf(unit), this.service.kindOf(kind), from, to));
  }

  /** Faylni o'qish — qatorlar qoralama bo'lib qaytadi (saqlanmaydi) */
  @Roles(UserRole.ADMIN)
  @Post(':unit/:kind/parse')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async parse(@Param('unit') unit: string, @Param('kind') kind: string, @UploadedFile() file: Express.Multer.File) {
    return { data: await this.service.parseFile(this.service.unitOf(unit), this.service.kindOf(kind), file) };
  }
}