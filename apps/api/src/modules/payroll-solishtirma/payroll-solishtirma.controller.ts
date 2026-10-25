import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Personal, Roles } from '../../common/decorators';
import { PayrollSolishtirmaService, type SolishtirmaSettings } from './payroll-solishtirma.service';

/** Xarajatlar › Ish haqi solishtirma: FOT − soliq (− kasaba) = 23106 — /api/payroll-solishtirma/… */
@Controller('payroll-solishtirma')
export class PayrollSolishtirmaController {
  constructor(private readonly service: PayrollSolishtirmaService) {}

  /** ?period=YYYY-MM&bankMonth=ACCRUAL|PAID&fot=TARKIB|SOLIQ */
  @Personal()
  @Get()
  async view(@Query('period') period: string, @Query('bankMonth') bankMonth?: string, @Query('fot') fot?: string) {
    return { data: await this.service.view(period, bankMonth, fot) };
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
}
