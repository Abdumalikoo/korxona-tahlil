import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { ExpensePolicyService } from './expense-policy.service';
import { UnitPolicyService } from './unit-policy.service';
import { DepPolicyService } from './dep-policy.service';

/** Xarajatlar siyosati: qaysi moddalar kim hisobidan — Markaz yoki yo'nalish (Tax free, Marksheyder …), qayerda yozilgan bo'lsa ham */
@Controller('expense-policy')
export class ExpensePolicyController {
  constructor(
    private readonly policy: ExpensePolicyService,
    private readonly units: UnitPolicyService,
    private readonly deps: DepPolicyService,
  ) {}

  /** Foyda keltirmaydigan bo'limlar (Markaz bo'limlari): ro'yxat va davrdagi xarajati (?from=YYYY-MM&to=YYYY-MM) */
  @Get('departments')
  async depList(@Query('from') from: string, @Query('to') to: string) {
    return { data: await this.deps.list(from, to) };
  }

  /** Markaz bo'limi: moddalar oyma-oy va bo'lim siyosati */
  @Get('department/:id')
  async depView(@Param('id') id: string, @Query('from') from: string, @Query('to') to: string) {
    return { data: await this.deps.view(id, from, to) };
  }

  /** Markaz bo'limi qoidalari: { rules: { MODDA: 'SELF' | 'CENTER' | 'dep:<id>' | yo'nalish } } — to'liq ro'yxat */
  @Patch('department/:id')
  @Roles(UserRole.ADMIN)
  async depSave(@Param('id') id: string, @Body() body: { rules?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.deps.save(id, body, userId) };
  }

  /** Bo'lim xarajatlari siyosati: shu bo'limda yozilgan moddalar kim hisobida (?from=YYYY-MM&to=YYYY-MM) */
  @Get('unit/:unit')
  async unitView(@Param('unit') unit: string, @Query('from') from: string, @Query('to') to: string) {
    return { data: await this.units.view(this.units.unitOf(unit), from, to) };
  }

  /** Bo'lim qoidalari: { rules: { MODDA: bo'lim }, payroll?: { KOMPONENT: bo'lim } } — to'liq ro'yxat */
  @Patch('unit/:unit')
  @Roles(UserRole.ADMIN)
  async unitSave(@Param('unit') unit: string, @Body() body: { rules?: unknown; payroll?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.units.save(this.units.unitOf(unit), body, userId) };
  }

  @Get()
  async get() {
    return { data: await this.policy.get() };
  }

  /** Markaz xarajati: o'ziniki va hududlar uchun (?from&to) */
  @Get('summary')
  async summary(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.policy.summary(from, to) };
  }

  /** Ish haqi komponentlari bo'yicha davrdagi summa (tarkibdan): Markaz, hudud xodimlari, yo'nalishlar (?from&to) */
  @Get('payroll-amounts')
  async payrollAmounts(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.policy.payrollAmounts(from, to) };
  }

  /** Moddalar bo'yicha davrdagi xarajat: hududlarda / Markazda yozilgani (?from&to) */
  @Get('amounts')
  async amounts(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.policy.amounts(from, to) };
  }

  /** Bitta modda to'lovchisi: { code, payer: 'region' | 'center' | yo'nalish } */
  @Patch('payer')
  @Roles(UserRole.ADMIN)
  async setPayer(@Body() body: { code?: unknown; payer?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.policy.setPayer(body?.code, body?.payer, userId) };
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