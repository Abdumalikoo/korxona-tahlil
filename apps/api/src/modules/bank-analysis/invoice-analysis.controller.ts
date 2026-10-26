import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { CurrentUser, Personal, Roles } from '../../common/decorators';
import { SourceArchiveService } from '../source-archive/source-archive.service';
import { InvoiceAnalysisService } from './invoice-analysis.service';

/** Katta reyestrlar (Didox eksporti ichida 1 GB gacha bo'sh qatorlar bilan) — 250 MB gacha */
const MAX_FILE_SIZE = 250 * 1024 * 1024;
/** Arxivga faqat shu hajmgacha (katta fayllar diskni to'ldirmasin) */
const ARCHIVE_MAX = 30 * 1024 * 1024;

/**
 * Schyot-faktura tahlili (nazorat): /api/invoice-analysis/…
 * Xarajat va daromadga o'zi yozmaydi — foydalanuvchi tanlab yo'naltirsagina.
 */
@Controller('invoice-analysis')
export class InvoiceAnalysisController {
  constructor(
    private readonly service: InvoiceAnalysisService,
    private readonly archive: SourceArchiveService,
  ) {}

  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@UploadedFile() file: Express.Multer.File, @CurrentUser('id') userId: string) {
    const data = await this.service.analyze(file);
    if (file?.buffer && file.buffer.length <= ARCHIVE_MAX) await this.archive.hold('invoice-analysis', file, { userId });
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  async commit(@Body() body: { fileName?: unknown; rows?: unknown; allIds?: unknown; org?: unknown; months?: unknown }, @CurrentUser('id') userId: string) {
    const data = await this.service.commit(body, userId);
    await this.archive.link('invoice-analysis', { userId, fileName: typeof body?.fileName === 'string' ? body.fileName : null, refId: data.batchId, periods: data.months }).catch(() => null);
    return { data };
  }

  @Get('org')
  async org() {
    return { data: await this.service.orgInfo() };
  }

  @Personal()
  @Get('view')
  async view(@Query('from') from: string, @Query('to') to: string) {
    return { data: await this.service.view(from, to, null) };
  }

  @Personal()
  @Get('group')
  async group(@Query('key') key: string, @Query('from') from: string, @Query('to') to: string) {
    return { data: await this.service.group(key, from, to, null) };
  }

  @Roles(UserRole.ADMIN)
  @Post('groups/meta')
  @HttpCode(HttpStatus.OK)
  async groupMeta(@Body() body: { key?: unknown; name?: unknown; kind?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.groupMeta(body, userId) };
  }

  @Get('options')
  async options(@Query('dir') dir: string, @Query('unit') unit?: string) {
    return { data: await this.service.options(dir, unit) };
  }

  @Roles(UserRole.ADMIN)
  @Post('notes')
  @HttpCode(HttpStatus.OK)
  async notes(@Body() body: { items?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.notes(body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('route/check')
  @HttpCode(HttpStatus.OK)
  async check(@Body() body: { items?: unknown }) {
    return { data: await this.service.check(body) };
  }

  @Roles(UserRole.ADMIN)
  @Post('route')
  @HttpCode(HttpStatus.OK)
  async route(@Body() body: { items?: unknown; place?: unknown; categoryCode?: unknown; section?: unknown; description?: unknown; force?: unknown; skipDuplicates?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.route(body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('route/cancel')
  @HttpCode(HttpStatus.OK)
  async unroute(@Body() body: { ids?: unknown; batch?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.unroute(body, userId) };
  }

  @Get('posts')
  async posts() {
    return { data: await this.service.posts() };
  }

  @Get('batches')
  async batches() {
    return { data: await this.service.batches() };
  }

  @Roles(UserRole.ADMIN)
  @Post('batches/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id') id: string, @CurrentUser('id') userId: string) {
    const data = await this.service.cancel(id, userId);
    await this.archive.cancel('invoice-analysis', id).catch(() => 0);
    return { data };
  }
}
