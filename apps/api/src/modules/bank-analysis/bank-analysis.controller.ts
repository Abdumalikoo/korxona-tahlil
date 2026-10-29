import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
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

  /** Nomma-nom (vipiska kabi): davrdagi hamma to'lov (?dir=OUT|IN) */
  @Personal()
  @Get('rows')
  async rows(@Query('from') from: string, @Query('to') to: string, @Query('account') account?: string, @Query('dir') dir?: string) {
    return { data: await this.service.rowsList(from, to, account || null, dir || null) };
  }

  @Personal()
  @Get('group')
  async group(@Query('key') key: string, @Query('from') from: string, @Query('to') to: string, @Query('account') account?: string) {
    return { data: await this.service.group(key, from, to, account || null) };
  }

  /** Ajralib turgan to'lovlar: bir martalik, odatdan tashqari summa, izohi boshqacha */
  @Personal()
  @Get('outliers')
  async outliers(@Query('from') from: string, @Query('to') to: string, @Query('account') account?: string) {
    return { data: await this.service.outliers(from, to, account || null) };
  }

  /** «Oddiy» deb belgilash: { items: [{account,rowId}], ok } */
  @Roles(UserRole.ADMIN)
  @Post('outliers/ok')
  @HttpCode(HttpStatus.OK)
  async outliersOk(@Body() body: { items?: unknown; ok?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.markOutliers(body, userId) };
  }

  /** Guruhga o'z nomingiz va turi */
  @Roles(UserRole.ADMIN)
  @Post('groups/meta')
  @HttpCode(HttpStatus.OK)
  async groupMeta(@Body() body: { key?: unknown; name?: unknown; kind?: unknown; category?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.groupMeta(body, userId) };
  }

  @Get('kinds')
  kinds() {
    return { data: this.service.kinds() };
  }

  /** Hisobot (pivot): ?from&to&dir=OUT|IN&levels=category,counterparty,service&kinds=&categories=&patterns=&q=&min= */
  @Personal()
  @Get('pivot')
  async pivot(@Query('from') from: string, @Query('to') to: string, @Query('account') account: string | undefined, @Query() raw: Record<string, unknown>) {
    return { data: await this.service.pivot(from, to, account || null, raw) };
  }

  @Personal()
  @Get('pivot/excel')
  async pivotExcel(@Query('from') from: string, @Query('to') to: string, @Query('account') account: string | undefined, @Query() raw: Record<string, unknown>, @Res() response: Response) {
    const { buffer, filename } = await this.service.pivotExcel(from, to, account || null, raw);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }

  /** Bir nechta guruhga hisobot moddasi */
  @Roles(UserRole.ADMIN)
  @Post('groups/category')
  @HttpCode(HttpStatus.OK)
  async groupCategory(@Body() body: { keys?: unknown; category?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.groupCategory(body, userId) };
  }

  @Get('categories')
  async categories() {
    return { data: await this.service.categories() };
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

  /** Ro'yxatdan chiqarish (yo'naltirmasdan; yozuv yaratilmaydi): { items, reason? } */
  @Roles(UserRole.ADMIN)
  @Post('dismiss')
  @HttpCode(HttpStatus.OK)
  async dismiss(@Body() body: { items?: unknown; reason?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.dismiss(body, userId) };
  }

  /** To'lovni ko'chirmadan butunlay o'chirish: { items } (yo'naltirilganini emas) */
  @Roles(UserRole.ADMIN)
  @Post('rows/delete')
  @HttpCode(HttpStatus.OK)
  async deleteRows(@Body() body: { items?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.deleteRows(body, userId) };
  }

  /** Aniqlashtirishga o'tkazish: { items, note? } (yozuv yaratilmaydi) */
  @Roles(UserRole.ADMIN)
  @Post('clarify')
  @HttpCode(HttpStatus.OK)
  async clarify(@Body() body: { items?: unknown; note?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.clarify(body, userId) };
  }

  /** Aniqlashtirishdan qaytarish: { items } */
  @Roles(UserRole.ADMIN)
  @Post('clarify/undo')
  @HttpCode(HttpStatus.OK)
  async unclarify(@Body() body: { items?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.unclarify(body, userId) };
  }

  /** Ro'yxatga qaytarish: { items } */
  @Roles(UserRole.ADMIN)
  @Post('dismiss/undo')
  @HttpCode(HttpStatus.OK)
  async undismiss(@Body() body: { items?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.undismiss(body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('route/cancel')
  @HttpCode(HttpStatus.OK)
  async unroute(@Body() body: { ids?: unknown; batch?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.unroute(body, userId) };
  }

  /** Tur qoidalari («izohda X bo'lsa → Y»; bank va faktura uchun bitta ro'yxat) */
  @Get('kind-rules')
  async kindRules() {
    return { data: await this.service.kindRules() };
  }

  @Roles(UserRole.ADMIN)
  @Post('kind-rules')
  @HttpCode(HttpStatus.OK)
  async addKindRule(@Body() body: { text?: unknown; kind?: unknown; dir?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.addKindRule(body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('kind-rules/:id/delete')
  @HttpCode(HttpStatus.OK)
  async deleteKindRule(@Param('id') id: string) {
    return { data: await this.service.deleteKindRule(id) };
  }

  /** Kontragentning hamma guruhiga bitta tur */
  @Roles(UserRole.ADMIN)
  @Post('counterparty-kind')
  @HttpCode(HttpStatus.OK)
  async counterpartyKind(@Body() body: { inn?: unknown; dir?: unknown; kind?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.counterpartyKind(body, userId) };
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
