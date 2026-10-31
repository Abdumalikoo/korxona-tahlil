import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { CostStructureService } from './cost-structure.service';

/** Moddalar boshqaruvi › Xarajatlar tarkibiy tuzilishi: /api/cost-structure/… */
@Controller('cost-structure')
export class CostStructureController {
  constructor(private readonly service: CostStructureService) {}

  /** Birliklar: Markaz bo'limlari, hududlar, yo'nalishlar */
  @Get('units')
  async units() {
    return { data: await this.service.units() };
  }

  /** Bitta birlik: daromad tomoni (moddalar, kunlik tushum qatorlari) va xarajat moddalari (?unit=&from=&to=) */
  @Get('unit')
  async unit(@Query('unit') unit: string, @Query('from') from: string, @Query('to') to: string) {
    return { data: await this.service.unit(unit, from, to) };
  }

  /** Ko'chirish uchun xarajat yozuvlarini qidirish (?text=&unit=&categoryCode=&from=&to=) */
  @Get('search')
  async search(@Query() q: Record<string, string | undefined>) {
    return { data: await this.service.search(q) };
  }

  /** Yozuvlarni boshqa birlik / moddaga ko'chirish: { ids, unit?, categoryCode? } */
  @Roles(UserRole.ADMIN)
  @Post('move')
  @HttpCode(HttpStatus.OK)
  async move(@Body() body: { ids?: unknown; unit?: unknown; categoryCode?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.move(body, userId) };
  }

  /** Xodim xarajatini foiz bilan bo'limlarga bo'lish: ro'yxat (?dep= — shu bo'lim qatnashganlari) */
  @Get('splits')
  async splits(@Query('dep') dep?: string) {
    return { data: await this.service.splits(dep) };
  }

  /** Bo'linish saqlash: { pinfl, from, to?, parts: [{ departmentId, pct }] } — ish haqi shu oydan qayta guruhlanadi */
  @Roles(UserRole.ADMIN)
  @Post('splits')
  @HttpCode(HttpStatus.OK)
  async saveSplit(@Body() body: { pinfl?: unknown; from?: unknown; to?: unknown; parts?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.service.saveSplit(body, userId) };
  }

  /** Bo'linishni bekor qilish */
  @Roles(UserRole.ADMIN)
  @Post('splits/:id/delete')
  @HttpCode(HttpStatus.OK)
  async removeSplit(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.service.removeSplit(id, userId) };
  }
}
