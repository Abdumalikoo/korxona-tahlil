import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { CurrentUser, Personal, Roles } from '../../common/decorators';
import { SourceArchiveService } from '../source-archive/source-archive.service';
import { BankAnalysisService } from './bank-analysis.service';

const MAX_FILE_SIZE = 15 * 1024 * 1024;

/**
 * Xarajatlar › Bank ko'chirmasi — tahlil: /api/bank-analysis/…
 * Ko'chirma (23106 shabloni shakli) o'qiladi; xarajat va daromadga yozilmaydi — o'xshashlar oyma-oy guruhlanadi.
 */
@Controller('bank-analysis')
export class BankAnalysisController {
  constructor(
    private readonly service: BankAnalysisService,
    private readonly archive: SourceArchiveService,
  ) {}

  /** Faylni o'qish — hech narsa saqlanmaydi */
  @Roles(UserRole.ADMIN)
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_SIZE } }))
  async analyze(@UploadedFile() file: Express.Multer.File, @CurrentUser('id') userId: string) {
    const data = await this.service.analyze(file);
    await this.archive.hold('bank-analysis', file, { userId });
    return { data };
  }

  @Roles(UserRole.ADMIN)
  @Post('commit')
  @HttpCode(HttpStatus.OK)
  async commit(@Body() body: { fileName?: unknown; account?: unknown; months?: unknown; rows?: unknown }, @CurrentUser('id') userId: string) {
    const data = await this.service.commit(body, userId);
    await this.archive.link('bank-analysis', { userId, fileName: typeof body?.fileName === 'string' ? body.fileName : null, refId: data.batchId, periods: data.months, unit: data.account });
    return { data };
  }

  @Personal()
  @Get('view')
  async view(@Query('from') from: string, @Query('to') to: string, @Query('account') account?: string) {
    return { data: await this.service.view(from, to, account || null) };
  }

  @Personal()
  @Get('group')
  async group(@Query('key') key: string, @Query('from') from: string, @Query('to') to: string, @Query('account') account?: string) {
    return { data: await this.service.group(key, from, to, account || null) };
  }

  @Get('options')
  async options(@Query('dir') dir: string, @Query('unit') unit?: string) {
    return { data: await this.service.options(dir, unit) };
  }

  /** To'lovga o'z izohingiz (yo'naltirilgan bo'lsa — yozuv izohi ham) */
  @Roles(UserRole.ADMIN)
  @Post('notes')
  @HttpCode(HttpStatus.OK)
  async notes(@Body() body: { items?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.notes(body, userId) };
  }

  /** Yo'naltirishdan oldin: takror yozuvlar bormi */
  @Roles(UserRole.ADMIN)
  @Post('route/check')
  @HttpCode(HttpStatus.OK)
  async check(@Body() body: { items?: unknown }) {
    return { data: await this.service.check(body) };
  }

  /** Chiqim — xarajat, kirim — daromad bo'lib yoziladi */
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
    await this.archive.cancel('bank-analysis', id).catch(() => 0);
    return { data };
  }
}
