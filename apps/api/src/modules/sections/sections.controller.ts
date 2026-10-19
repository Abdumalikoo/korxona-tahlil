import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators';
import { SectionsService } from './sections.service';

/**
 * Doimiy / Boshqa bo'limlari.
 * :kind — "expense" (xarajat) yoki "income" (daromad)
 */
@Controller('sections')
export class SectionsController {
  constructor(private readonly sections: SectionsService) {}

  /** Ikki katta karta: summa, taqqoslash, qismlar — ?period=YYYY-MM */
  @Get(':kind/overview')
  async overview(@Param('kind') kind: string, @Query('period') period: string) {
    const data = await this.sections.overview(kind, period);
    return { data };
  }

  /** Oylar bo'yicha Doimiy va Boshqa — ?from=YYYY-MM&to=YYYY-MM */
  @Get(':kind/trend')
  async trend(@Param('kind') kind: string, @Query('from') from: string, @Query('to') to: string) {
    const data = await this.sections.trend(kind, from, to);
    return { data };
  }

  /** Yozuvlarni boshqa bo'limga o'tkazish: { ids: string[], section: "DOIMIY" | "BOSHQA" } */
  @Roles(UserRole.ADMIN)
  @Post(':kind/move')
  @HttpCode(HttpStatus.OK)
  async move(@Param('kind') kind: string, @Body() body: { ids?: string[]; section?: string }) {
    const data = await this.sections.move(kind, body?.ids, body?.section);
    return { data };
  }
}
