import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { QomitaService } from './qomita.service';

/** Qo'mita mablag'lari: qoplanadigan bo'limlar, ajratmalar (daromad) va qoplangan xarajatlar */
@Controller('qomita')
export class QomitaController {
  constructor(private readonly qomita: QomitaService) {}

  /** Sozlama: bo'limlar, ish haqi qismlari, moddalar */
  @Get('config')
  async config() {
    return { data: await this.qomita.config() };
  }

  /** Bo'lim qo'shish / o'zgartirish: { departmentId, components, categories, note } */
  @Put('item')
  @Roles(UserRole.ADMIN)
  async saveItem(@Body() body: { departmentId?: unknown; components?: unknown; categories?: unknown; note?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.qomita.saveItem(body, userId) };
  }

  @Delete('item/:departmentId')
  @Roles(UserRole.ADMIN)
  async removeItem(@Param('departmentId') departmentId: string, @CurrentUser('id') userId: string) {
    return { data: await this.qomita.removeItem(departmentId, userId) };
  }

  /** Hisobot: bo'lim × oy (?from=YYYY-MM&to=YYYY-MM) */
  @Get('report')
  async report(@Query('from') from: string, @Query('to') to: string) {
    return { data: await this.qomita.report(from, to) };
  }

  /** Bo'lim tafsiloti (key — bo'lim id yoki «-») */
  @Get('detail/:key')
  async detail(@Param('key') key: string, @Query('from') from: string, @Query('to') to: string) {
    return { data: await this.qomita.detail(key, from, to) };
  }

  /** Qo'lda ajratma: { departmentId, period, date?, amount (so'm), description? } */
  @Post('income')
  @Roles(UserRole.ADMIN)
  async addIncome(@Body() body: { departmentId?: unknown; period?: unknown; date?: unknown; amount?: unknown; description?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.qomita.addIncome(body, userId) };
  }

  /** Davrdagi hamma ajratmalar (?from=YYYY-MM&to=YYYY-MM) — o'chirish ro'yxati */
  @Get('incomes')
  async incomes(@Query('from') from: string, @Query('to') to: string) {
    return { data: await this.qomita.incomes(from, to) };
  }

  /** Bir nechta ajratmani o'chirish: { ids } (yumshoq — Savatdan tiklanadi; bankdan yo'naltirilgani — yo'naltirish bekor qilinadi) */
  @Post('income/remove-many')
  @Roles(UserRole.ADMIN)
  async removeIncomes(@Body() body: { ids?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.qomita.removeIncomes(body, userId) };
  }

  @Delete('income/:id')
  @Roles(UserRole.ADMIN)
  async removeIncome(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.qomita.removeIncome(id, userId) };
  }

  /** Tasdiqlash: { ok } (false — tasdiqni olib tashlash) */
  @Post('income/:id/approve')
  @Roles(UserRole.ADMIN)
  async approveIncome(@Param('id') id: string, @Body() body: { ok?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.qomita.approveIncome(id, body?.ok !== false, userId) };
  }

  /** Bank ko'chirmasidagi Qo'mitadan kelgan (yo'naltirilmagan) kirimlar; q — qidiruv */
  @Get('bank')
  async bank(@Query('q') q?: string, @Query('dismissed') dismissed?: string) {
    return { data: await this.qomita.bankCandidates(q, dismissed === '1' || dismissed === 'true') };
  }

  /** Kirimlarni tozalash (ro'yxatdan chiqarish, yozuv yaratilmaydi): { items: [{account,rowId}], reason? } */
  @Post('bank/dismiss')
  @Roles(UserRole.ADMIN)
  async bankDismiss(@Body() body: { items?: unknown; reason?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.qomita.bankDismiss(body, userId) };
  }

  /** Tozalanganlarni qaytarish: { items } */
  @Post('bank/dismiss/undo')
  @Roles(UserRole.ADMIN)
  async bankUndismiss(@Body() body: { items?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.qomita.bankUndismiss(body, userId) };
  }

  /** Kirimlarni bo'lim ajratmasi sifatida yozish: { items: [{account,rowId}], departmentId, description?, skipDuplicates?, force? } */
  @Post('bank')
  @Roles(UserRole.ADMIN)
  async bankRoute(@Body() body: { items?: unknown; departmentId?: unknown; description?: unknown; force?: unknown; skipDuplicates?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.qomita.bankRoute(body, userId) };
  }
}
