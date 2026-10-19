import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators';
import { AlertsService } from './alerts.service';
import type { AlertSettings } from './alerts.types';

/** «Muhokama talab qiladi» — avtomatik ogohlantirishlar */
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  /** Ro'yxat (?all=1 — «Ko'rildi» deb belgilanganlari ham) */
  @Get()
  async list(@Query('all') all?: string) {
    return { data: await this.alerts.list(all === '1' || all === 'true') };
  }

  /** «Ko'rildi» — ro'yxatdan yashirish */
  @Roles(UserRole.ADMIN)
  @Post('dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  async dismiss(@Body() body: { key?: string }) {
    await this.alerts.dismiss(String(body?.key ?? ''));
  }

  /** Yashirilganlarni qaytarish */
  @Post('restore')
  @Roles(UserRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  async restore() {
    await this.alerts.restoreAll();
  }

  @Get('settings')
  async settings() {
    return { data: await this.alerts.settings() };
  }

  /** Chegaralarni o'zgartirish (faqat administrator) */
  @Patch('settings')
  @Roles(UserRole.ADMIN)
  async save(@Body() body: Partial<AlertSettings>) {
    return { data: await this.alerts.saveSettings(body ?? {}) };
  }
}