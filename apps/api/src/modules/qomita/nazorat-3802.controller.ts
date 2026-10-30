import { Body, Controller, Get, Param, Put, Query, Res } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentUser, Personal, Roles } from '../../common/decorators';
import { Nazorat3802Service } from './nazorat-3802.service';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 3802 › Nazorat zanjiri: /api/qomita/3802/nazorat/… */
@Controller('qomita/3802/nazorat')
export class Nazorat3802Controller {
  constructor(private readonly nz: Nazorat3802Service) {}

  /** Hamma oylar: halqalar holati va qoplash (ismlarsiz) */
  @Get()
  async overview() {
    return { data: await this.nz.overview() };
  }

  /** Qo'lda bog'lash: { fullName, pinfl } (pinfl: null — «tarkibda yo'q»; berilmasa — bekor qilish) */
  @Roles(UserRole.ADMIN)
  @Put('link')
  async link(@Body() body: { fullName?: unknown; pinfl?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.nz.setLink(body, userId) };
  }

  /** Vedomost bo'limi → shtat bo'limi: { section, shtatKey } */
  @Roles(UserRole.ADMIN)
  @Put('section')
  async section(@Body() body: { section?: unknown; shtatKey?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.nz.setSection(body, userId) };
  }

  /** Izoh: { period, link, item, note } (bo'sh — o'chirish) */
  @Roles(UserRole.ADMIN)
  @Put('note')
  async note(@Body() body: { period?: unknown; link?: unknown; item?: unknown; note?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.nz.setNote(body, userId) };
  }

  /** Farq chegarasi: { toleranceSom } */
  @Roles(UserRole.ADMIN)
  @Put('config')
  async config(@Body() body: { toleranceSom?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.nz.setConfig(body, userId) };
  }

  /** Qo'mita pullarining sarfi: 3802 va xizmat shartnomalari (ismsiz) */
  @Get('sarf')
  async sarf(@Query('from') from: string, @Query('to') to: string) {
    return { data: await this.nz.sarf(from, to) };
  }

  /** Bitta bo'lim — xodimlar bilan (shaxsiy ma'lumot) */
  @Personal()
  @Get('sarf/:unit')
  async sarfUnit(@Param('unit') unit: string, @Query('from') from: string, @Query('to') to: string) {
    return { data: await this.nz.sarfUnit(unit, from, to) };
  }

  /** Bitta oy — xodimlar bilan (shaxsiy ma'lumot) */
  @Personal()
  @Get(':period')
  async detail(@Param('period') period: string) {
    return { data: await this.nz.detail(period) };
  }

  @Personal()
  @Get(':period/export')
  async export(@Param('period') period: string, @Res() response: Response) {
    const { buffer, filename } = await this.nz.export(period);
    response.setHeader('Content-Type', XLSX_TYPE);
    response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    response.send(buffer);
  }
}
