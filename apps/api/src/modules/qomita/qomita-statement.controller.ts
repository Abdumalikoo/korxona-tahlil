import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { QomitaStatementService } from './qomita-statement.service';

const MAX_FILE_SIZE = 25 * 1024 * 1024;

/** Daromadlar › Qo'mita mablag'lari › Bank ko'chirmasidan: /api/qomita/statement/… */
@Controller('qomita/statement')
export class QomitaStatementController {
  constructor(private readonly st: QomitaStatementService) {}

  /** Faylni o'qish va taklif (?all=1 — Qo'mitadan bo'lmagan kirimlar ham); hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@UploadedFile() file: Express.Multer.File, @Query('all') all?: string) {
    return { data: await this.st.analyze(file, all === '1' || all === 'true') };
  }

  /** Qabul qilish: fayl + «decisions» (JSON: [{ rowIndex, target, period }]) */
  @Roles(UserRole.ADMIN)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async commit(@UploadedFile() file: Express.Multer.File, @Body('decisions') decisions: unknown, @CurrentUser('id') userId: string) {
    return { data: await this.st.commit(file, decisions, userId) };
  }

  @Get('uploads')
  async uploads() {
    return { data: await this.st.uploads() };
  }

  /** Yuklashni o'chirish — shu fayldan yozilgan hamma ajratma */
  @Roles(UserRole.ADMIN)
  @Delete('uploads/:id')
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.st.removeUpload(id, userId) };
  }
}
