import { Body, Controller, Delete, Get, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Roles } from '../../common/decorators';
import { BplanService } from './bplan.service';

/** Hisobotlar › Choraklik ijro: biznes-reja, qatorlarni belgilash, fakt va formulali Excel */
@Controller('bplan')
export class BplanController {
  constructor(private readonly bplan: BplanService) {}

  /** Reja, belgilash, fakt (avtomatik + qo'lda), tekshiruv */
  @Get()
  async overview(@Query('year') year?: string) {
    return { data: await this.bplan.overview(year ?? new Date().getFullYear()) };
  }

  /** Ekrandagi ijro hisoboti: chorak (1–4) va tartib (quarter | ytd) */
  @Get('report')
  async report(@Query('year') year: string, @Query('quarter') quarter: string, @Query('mode') mode: string) {
    return { data: await this.bplan.report(year, quarter, mode) };
  }

  /** To'liq formulali Excel */
  @Get('excel')
  async excel(@Query('year') year: string, @Query('quarter') quarter: string, @Query('mode') mode: string, @Res() res: Response) {
    const { buffer, filename } = await this.bplan.excel(year, quarter, mode);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(buffer);
  }

  @Roles(UserRole.ADMIN)
  @Post('plan')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async upload(@Query('year') year: string, @UploadedFile() file: Express.Multer.File, @CurrentUser('id') userId: string) {
    return { data: await this.bplan.uploadPlan(year, file, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Delete('plan')
  async remove(@Query('year') year: string, @CurrentUser('id') userId: string) {
    return { data: await this.bplan.removePlan(year, userId) };
  }

  /** Belgilash taklifi (nomlar bo'yicha) — saqlanmaydi */
  @Get('map/suggest')
  async suggest() {
    return { data: await this.bplan.suggest() };
  }

  @Roles(UserRole.ADMIN)
  @Patch('map')
  async saveMap(@Body() body: unknown, @CurrentUser('id') userId: string) {
    return { data: await this.bplan.saveMap(body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Patch('manual')
  async saveManual(@Query('year') year: string, @Body() body: unknown, @CurrentUser('id') userId: string) {
    return { data: await this.bplan.saveManual(year, body, userId) };
  }
}