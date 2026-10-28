import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Personal, Roles } from '../../common/decorators';
import type { AuthUser } from '../auth/auth.types';
import { KpiService } from './kpi.service';

/**
 * KPI baholash: /api/kpi/… — bo'lim rahbari (o'z bo'limi), administrator (hamma bo'lim, ?b=KALIT).
 * Yig'ma va rahbarlar — faqat umumiy hudud (rahbar kira olmaydi).
 */
@Controller('kpi')
export class KpiController {
  constructor(private readonly kpi: KpiService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthUser, @Query('b') b?: string) {
    return { data: await this.kpi.me(user, b) };
  }

  @Get('sheet')
  async sheet(@CurrentUser() user: AuthUser, @Query('period') period: string, @Query('b') b?: string) {
    return { data: await this.kpi.sheet(user, b, period) };
  }

  /** Baho: { b?, period, pinfl, picks } — ball shablondan hisoblanadi */
  @Roles(UserRole.ADMIN, UserRole.BOLIM_RAHBARI)
  @Put('eval')
  async save(@CurrentUser() user: AuthUser, @Body() body: { b?: unknown; period?: unknown; pinfl?: unknown; picks?: unknown }) {
    return { data: await this.kpi.save(user, body) };
  }

  @Roles(UserRole.ADMIN, UserRole.BOLIM_RAHBARI)
  @Post('submit')
  @HttpCode(HttpStatus.OK)
  async submit(@CurrentUser() user: AuthUser, @Body() body: { b?: unknown; period?: unknown }) {
    return { data: await this.kpi.submit(user, body) };
  }

  @Roles(UserRole.ADMIN)
  @Post('reopen')
  @HttpCode(HttpStatus.OK)
  async reopen(@CurrentUser() user: AuthUser, @Body() body: { b?: unknown; period?: unknown }) {
    return { data: await this.kpi.reopen(user, body) };
  }

  @Roles(UserRole.ADMIN)
  @Get('heads')
  async heads() {
    return { data: await this.kpi.headsList() };
  }

  @Roles(UserRole.ADMIN)
  @Put('heads')
  async setHead(@CurrentUser() user: AuthUser, @Body() body: { userId?: unknown; b?: unknown }) {
    return { data: await this.kpi.setHead(user, body) };
  }

  /** Rollar › KPI: bo'lim dashbordi (?b=KALIT&year=YYYY) */
  @Roles(UserRole.ADMIN, UserRole.VIEWER)
  @Personal()
  @Get('overview')
  async overview(@Query('b') b: string, @Query('year') year?: string) {
    return { data: await this.kpi.departmentOverview(b, year) };
  }

  /** Yig'ma KPI (xodimlar ismlari bilan) */
  @Roles(UserRole.ADMIN, UserRole.VIEWER)
  @Personal()
  @Get('summary')
  async summary(@Query('from') from: string, @Query('to') to: string) {
    return { data: await this.kpi.summary(from, to) };
  }

  @Roles(UserRole.ADMIN, UserRole.VIEWER)
  @Personal()
  @Get('export')
  async export(@Query('from') from: string, @Query('to') to: string, @Query('format') format: string, @Res() response: Response) {
    const f = await this.kpi.export(from, to, format);
    response.setHeader('Content-Type', f.mime);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.filename)}"; filename*=UTF-8''${encodeURIComponent(f.filename)}`);
    response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    response.send(f.buffer);
  }
}
