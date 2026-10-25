import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Personal, Roles } from '../../common/decorators';
import { PayrollSolishtirmaService, type SolishtirmaSettings } from './payroll-solishtirma.service';

/** Xarajatlar › Ish haqi solishtirma: FOT − soliq (− kasaba) = 23106 — /api/payroll-solishtirma/… */
@Controller('payroll-solishtirma')
export class PayrollSolishtirmaController {
  constructor(private readonly service: PayrollSolishtirmaService) {}

  /** ?period=YYYY-MM&bankMonth=ACCRUAL|PAID&tab=CENTER|REGION */
  @Personal()
  @Get()
  async view(@Query('period') period: string, @Query('bankMonth') bankMonth?: string, @Query('tab') tab?: string) {
    return { data: await this.service.view(period, bankMonth, tab) };
  }

  @Get('settings')
  async settings() {
    return { data: await this.service.settings() };
  }

  @Roles(UserRole.ADMIN)
  @Put('settings')
  async saveSettings(@Body() body: Partial<Record<keyof SolishtirmaSettings, unknown>>, @CurrentUser('id') userId: string) {
    return { data: await this.service.saveSettings(body, userId) };
  }

  /** Mos kelganlarni «to'g'ri» deb tasdiqlash: ?period&tab&bankMonth, body { pinfls? } */
  @Roles(UserRole.ADMIN)
  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirm(@Query('period') period: string, @Query('tab') tab: string | undefined, @Query('bankMonth') bankMonth: string | undefined, @Body() body: { pinfls?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.confirm(period, tab, bankMonth, body, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('confirm/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelConfirm(@Query('period') period: string, @Query('tab') tab: string | undefined, @CurrentUser('id') userId: string) {
    return { data: await this.service.cancelConfirm(period, tab, userId) };
  }
}
