import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { ExpensePolicyService } from './expense-policy.service';

/** Xarajatlar siyosati: qaysi moddalar kim hisobidan — Markaz yoki yo'nalish (Tax free, Marksheyder …), qayerda yozilgan bo'lsa ham */
@Controller('expense-policy')
export class ExpensePolicyController {
  constructor(private readonly policy: ExpensePolicyService) {}

  @Get()
  async get() {
    return { data: await this.policy.get() };
  }

  /** Markaz xarajati: o'ziniki va hududlar uchun (?from&to) */
  @Get('summary')
  async summary(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.policy.summary(from, to) };
  }

  /** Moddalar bo'yicha davrdagi xarajat: hududlarda / Markazda yozilgani (?from&to) */
  @Get('amounts')
  async amounts(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.policy.amounts(from, to) };
  }

  @Patch()
  @Roles(UserRole.ADMIN)
  async save(@Body() body: { centerCategories?: unknown; excludeCategories?: unknown; payers?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.policy.save(body?.centerCategories, userId, body?.excludeCategories, body?.payers) };
  }

  /** Ish haqi tarkibidan Markazga o'tadigan komponentlar (bayram, choraklik …) — saqlanadi va hamma oylar qayta hisoblanadi */
  @Patch('payroll')
  @Roles(UserRole.ADMIN)
  async savePayroll(@Body() body: { components?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.policy.savePayroll(body?.components, userId) };
  }

  /** Hamma oylar ish haqini qayta hisoblash (hudud — sof oylik, Markaz — bayram, choraklik) */
  @Post('payroll/recompute')
  @Roles(UserRole.ADMIN)
  async recompute(@CurrentUser('id') userId: string) {
    return { data: await this.policy.recompute(userId) };
  }

  /** Tavsiya etilgan moddalar (bayram puli, choraklik, komandirovka, internet …) */
  @Post('seed')
  @Roles(UserRole.ADMIN)
  async seed(@CurrentUser('id') userId: string) {
    return { data: await this.policy.seed(userId) };
  }
}