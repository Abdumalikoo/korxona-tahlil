import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { FixedAssetAdoptService } from './fixed-assets.adopt';
import { FixedAssetImportService, type AssetImportCommit } from './fixed-assets.import';
import { FixedAssetReportService } from './fixed-assets.report';
import { FixedAssetsService } from './fixed-assets.service';

/** Asosiy vositalar: balans, oylik sarf (eskirish), rejimlar, Excel'dan yuklash, balans hisoboti, siyosat */
@Controller('fixed-assets')
export class FixedAssetsController {
  constructor(
    private readonly assets: FixedAssetsService,
    private readonly importer: FixedAssetImportService,
    private readonly reports: FixedAssetReportService,
    private readonly adopter: FixedAssetAdoptService,
  ) {}

  @Get()
  async list(@Query('status') status?: string, @Query('search') search?: string, @Query('category') category?: string, @Query('batch') batch?: string) {
    return { data: await this.assets.list({ status, search, category, batch }) };
  }

  /** Davr bo'yicha: sarf, xarid, qoldiq (?from&to) */
  @Get('summary')
  async summary(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.assets.summary(from, to) };
  }

  @Get('policy')
  async policy() {
    return { data: await this.assets.policyView() };
  }

  @Patch('policy')
  @Roles(UserRole.ADMIN)
  async savePolicy(@Body() body: unknown, @CurrentUser('id') userId: string) {
    return { data: await this.assets.savePolicy(body, userId) };
  }

  /** Hozir qayta hisoblash (yangi xaridlar balansga, oylik sarf) */
  @Post('sync')
  @Roles(UserRole.ADMIN)
  async sync() {
    return { data: await this.assets.sync() };
  }

  /** Excel import partiyalari */
  @Get('batches')
  async batches() {
    return { data: await this.assets.batches() };
  }

  /** Balans hisoboti (?at=YYYY-MM-DD&batch=) */
  @Get('report')
  async report(@Query('at') at?: string, @Query('batch') batch?: string) {
    return { data: await this.reports.report(at, batch) };
  }

  @Get('report/excel')
  async reportExcel(@Res() response: Response, @Query('at') at?: string, @Query('batch') batch?: string) {
    const { buffer, filename } = await this.reports.excel(at, batch);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    response.send(buffer);
  }

  /** Excel'ni tekshirish — hech narsa saqlanmaydi */
  @Post('import/analyze')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async importAnalyze(@UploadedFile() file: Express.Multer.File) {
    return { data: await this.importer.analyze(file) };
  }

  /** Omborga ulash — oldindan ko'rish: ?batch= */
  @Get('adopt')
  @Roles(UserRole.ADMIN)
  async adoptPreview(@Query('batch') batch?: string) {
    return { data: await this.adopter.preview(batch || undefined) };
  }

  /** Excel'dan yuklanganlarni omborga ulash: { batch? } */
  @Post('adopt')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async adopt(@Body() body: { batch?: string }, @CurrentUser('id') userId: string) {
    return { data: await this.adopter.adopt(typeof body?.batch === 'string' && body.batch ? body.batch : undefined, userId) };
  }

  @Post('import/commit')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async importCommit(@Body() body: AssetImportCommit, @CurrentUser('id') userId: string) {
    return { data: await this.importer.commit(body, userId) };
  }

  /** Bir nechta vosita yoki butun partiya rejimi: { ids?, batch?, mode: BALANCE | HOLD | EXPENSE } */
  @Post('mode')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async modeMany(@Body() body: { ids?: unknown; batch?: string; mode?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.assets.setModeMany(body?.ids, body?.mode, userId, typeof body?.batch === 'string' && body.batch ? body.batch : undefined) };
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return { data: await this.assets.detail(id) };
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(@Body() body: unknown, @CurrentUser('id') userId: string) {
    return { data: await this.assets.create(body, userId) };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  async update(@Param('id') id: string, @Body() body: unknown, @CurrentUser('id') userId: string) {
    return { data: await this.assets.update(id, body, userId) };
  }

  @Post(':id/dispose')
  @Roles(UserRole.ADMIN)
  async dispose(@Param('id') id: string, @Body() body: unknown, @CurrentUser('id') userId: string) {
    return { data: await this.assets.dispose(id, body, userId) };
  }

  /** mode: BALANCE | HOLD | EXPENSE */
  @Post(':id/mode')
  @Roles(UserRole.ADMIN)
  async mode(@Param('id') id: string, @Body() body: { mode?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.assets.setMode(id, body?.mode, userId) };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  async remove(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.assets.remove(id, userId) };
  }
}