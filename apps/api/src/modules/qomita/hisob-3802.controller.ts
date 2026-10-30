import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { Hisob3802Service } from './hisob-3802.service';

/** 3802 — Qo'mita pullari: ikki hisob (3802 hovuzi va Marksheyder) — kirim, sarf, qoldiq */
@Controller('qomita/3802/hisob')
export class Hisob3802Controller {
  constructor(private readonly hisob: Hisob3802Service) {}

  /** ?from=YYYY-MM&to=YYYY-MM */
  @Get()
  async ledger(@Query('from') from: string, @Query('to') to: string) {
    return { data: await this.hisob.ledger(from, to) };
  }

  /** Sarfi hisobga olinmaydigan oylar: { periods: ['2026-07', …] } */
  @Put('excluded')
  @Roles(UserRole.ADMIN)
  async excluded(@Body() body: { periods?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.hisob.setExcluded(body, userId) };
  }

  /** Yillik shartnoma summasi: { year, amount (so'm) } */
  @Put('contract')
  @Roles(UserRole.ADMIN)
  async contract(@Body() body: { year?: unknown; amount?: unknown }, @CurrentUser('id') userId: string) {
    return { data: await this.hisob.setContract(body, userId) };
  }
}
