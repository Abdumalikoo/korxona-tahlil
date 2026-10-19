import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    HttpStatus,
    Param,
    Patch,
    Post,
    Query,
    Res,
    UploadedFile,
    UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { LeaseImportService, type ImportLease } from './leases.import';
import { LeaseMonthsService } from './leases.months';
import { LeasesService } from './leases.service';
import {
    MAX_DOCUMENT_SIZE,
    type LeaseInput,
    type TerminateInput,
    type TermInput,
} from './leases.types';

@Controller('leases')
export class LeasesController {
  constructor(
    private readonly leases: LeasesService,
    private readonly months: LeaseMonthsService,
    private readonly importer: LeaseImportService,
  ) {}

  // ═══════════ Ma'lumotnomalar ═══════════

  /** Hududlar + tumanlar, Markaz bo'limlari, aeroport nomlari */
  @Get('lookups')
  async lookups() {
    const data = await this.leases.lookups();
    return { data };
  }

  // ═══════════ Oyni yopish ═══════════

  /** Yopilgan va yopilmagan oylar */
  @Get('months')
  async monthList() {
    const data = await this.months.list();
    return { data };
  }

  /** Bitta oy: hisob va (yopilgan bo'lsa) yozilgan summalar */
  @Get('months/:period')
  async monthView(@Param('period') period: string) {
    const data = await this.months.view(period);
    return { data };
  }

  /** Oyni yopish — "Ijara" kategoriyasida xarajatlar yaratiladi */
  @Roles(UserRole.ADMIN)
  @Post('months/:period/close')
  @HttpCode(HttpStatus.OK)
  async closeMonth(
    @Param('period') period: string,
    @Body() body: { replace?: boolean },
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.months.close(period, userId, body?.replace === true);
    return { data };
  }

  /** Oy yopilishini bekor qilish */
  @Roles(UserRole.ADMIN)
  @Post('months/:period/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelMonth(@Param('period') period: string) {
    const data = await this.months.cancel(period);
    return { data };
  }

  // ═══════════ Excel import ═══════════

  /** Import shabloni — hududlar, tumanlar va bo'limlar ro'yxati bilan */
  @Get('import/template')
  async importTemplate(@Res() response: Response) {
    const { buffer, filename } = await this.importer.buildTemplate();
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Faylni tekshirish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('import/analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async importAnalyze(@UploadedFile() file: Express.Multer.File) {
    const data = await this.importer.analyze(file);
    return { data };
  }

  /** Tekshirilgan qatorlarni saqlash */
  @Roles(UserRole.ADMIN)
  @Post('import/commit')
  @HttpCode(HttpStatus.OK)
  async importCommit(
    @Body() body: { rows?: ImportLease[]; accrue?: boolean },
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.importer.commit(body?.rows ?? [], userId, body?.accrue === true);
    return { data };
  }

  // ═══════════ Hujjatlar ═══════════

  /** Hujjatni yuklab olish; ?inline=1 — brauzerda ochish */
  @Get('documents/:docId/file')
  async documentFile(
    @Param('docId') docId: string,
    @Query('inline') inline: string | undefined,
    @Res() response: Response,
  ) {
    const file = await this.leases.documentFile(docId);
    const disposition = inline === '1' ? 'inline' : 'attachment';
    const ascii = file.fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');

    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.size));
    response.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    file.stream.pipe(response);
  }

  @Roles(UserRole.ADMIN)
  @Delete('documents/:docId')
  async removeDocument(@Param('docId') docId: string) {
    const data = await this.leases.removeDocument(docId);
    return { data };
  }

  // ═══════════ Shartnomalar ═══════════

  /** Ro'yxat: ?period, kind, regionCode, status (active|ended|upcoming|all), search */
  @Get()
  async list(
    @Query('period') period?: string,
    @Query('kind') kind?: string,
    @Query('regionCode') regionCode?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
  ) {
    const data = await this.leases.list({
      period: period || undefined,
      kind: kind || undefined,
      regionCode: regionCode !== undefined && regionCode !== '' ? Number(regionCode) : undefined,
      status: status || undefined,
      search: search || undefined,
    });
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Post()
  async create(@Body() body: LeaseInput, @CurrentUser('id') userId: string) {
    const data = await this.leases.create(body ?? {}, userId);
    return { data };
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @Query('period') period?: string) {
    const data = await this.leases.getOne(id, period || undefined);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: LeaseInput) {
    const data = await this.leases.update(id, body ?? {});
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    const data = await this.leases.remove(id);
    return { data };
  }

  /** Shu oydan boshlab yangi oylik summa */
  @Roles(UserRole.ADMIN)
  @Post(':id/terms')
  async setTerm(
    @Param('id') id: string,
    @Body() body: TermInput,
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.leases.setTerm(id, body ?? {}, userId);
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Delete(':id/terms/:termId')
  async removeTerm(@Param('id') id: string, @Param('termId') termId: string) {
    const data = await this.leases.removeTerm(id, termId);
    return { data };
  }

  /** Tugatish (endPeriod) yoki qayta tiklash (endPeriod: null) */
  @Roles(UserRole.ADMIN)
  @Post(':id/terminate')
  @HttpCode(HttpStatus.OK)
  async terminate(@Param('id') id: string, @Body() body: TerminateInput) {
    const data = await this.leases.terminate(id, body ?? {});
    return { data };
  }

  /** Hujjat yuklash: multipart "file", ixtiyoriy "type" va "termId" */
  @Roles(UserRole.ADMIN)
  @Post(':id/documents')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_SIZE } }))
  async addDocument(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { type?: string; termId?: string },
    @CurrentUser('id') userId: string,
  ) {
    const data = await this.leases.addDocument(id, file, body ?? {}, userId);
    return { data };
  }
}