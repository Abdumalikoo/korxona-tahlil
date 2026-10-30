import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { XaridService } from './xarid.service';

const MAX_FILE_SIZE = 15 * 1024 * 1024;

/** Asosiy vositalar › Xarid shabloni: /api/asset-xarid/… (1-bosqich — reestr, raqamlarga ta'sir qilmaydi) */
@Controller('asset-xarid')
export class XaridController {
  constructor(private readonly xarid: XaridService) {}

  /** Saqlangan reestr: qatorlar (tur, holat, summa), jamlanmalar, qoida */
  @Get()
  async view() {
    return { data: await this.xarid.view() };
  }

  /** Bo'sh shablon (Excel) — sarlavhalar va yo'riqnoma */
  @Get('template')
  async template(@Res() response: Response) {
    const { buffer, filename } = await this.xarid.template();
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Faylni o'qish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@UploadedFile() file: Express.Multer.File) {
    return { data: await this.xarid.analyze(file) };
  }

  /** Saqlash (fayl qayta o'qiladi) — avvalgi fayl almashtiriladi */
  @Roles(UserRole.ADMIN)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async commit(@UploadedFile() file: Express.Multer.File, @CurrentUser('id') userId: string) {
    return { data: await this.xarid.commit(file, userId) };
  }

  /** Filtr qoidasi: { assetMinSom } — asosiy vosita chegarasi (1 dona narxi, so'm) */
  @Roles(UserRole.ADMIN)
  @Put('rule')
  async rule(@Body() body: { assetMinSom?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.xarid.setRule(body, userId) };
  }

  /** Qator turini qo'lda belgilash: { key, kind | null } */
  @Roles(UserRole.ADMIN)
  @Put('override')
  async override(@Body() body: { key?: unknown; kind?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.xarid.setOverride(body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Delete()
  async remove(@CurrentUser('id') userId: string) {
    return { data: await this.xarid.remove(userId) };
  }
}
