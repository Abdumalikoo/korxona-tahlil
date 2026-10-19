import { Controller, Get, Param, Query } from '@nestjs/common';
import { EmployeeTransfersService } from './employee-transfers.service';

@Controller('employee-transfers')
export class EmployeeTransfersController {
  constructor(private readonly transfers: EmployeeTransfersService) {}

  /** O'tkazmalar ro'yxati — from/to: "YYYY-MM" (o'tkazma oyi), regionCode — hudud */
  @Get()
  async list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('regionCode') regionCode?: string,
  ) {
    const code = regionCode === undefined || regionCode === '' ? undefined : Number(regionCode);
    const data = await this.transfers.list({
      from: from || undefined,
      to: to || undefined,
      regionCode: code !== undefined && Number.isInteger(code) ? code : undefined,
    });
    return { data };
  }

  /** Har bir xodimning oxirgi o'tkazmasi: { [pinfl]: Transfer } */
  @Get('latest')
  async latest() {
    const data = await this.transfers.latest();
    return { data };
  }

  /** Bitta xodimning oylar bo'yicha joylashuvi va o'tkazmalari */
  @Get('employee/:pinfl')

  async timeline(@Param('pinfl') pinfl: string) {
    const data = await this.transfers.timeline(pinfl);
    return { data };
  }
}
