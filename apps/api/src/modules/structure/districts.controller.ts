import { Controller, Get, Param, Query } from '@nestjs/common';
import { CenterService } from './center.service';
import { DistrictsService } from './districts.service';
import { Personal } from '../../common/decorators';

/**
 * Solishtirma ichkarisi: Viloyat → Tumanlar → Tuman → Xodim; Markaz → Bo'limlar → Bo'lim → Xodim.
 * Umumiy parametrlar: ?from&to&section=ALL|DOIMIY|BOSHQA&compare=prev|yoy
 */
@Controller('structure/drill')
export class DistrictsController {
  constructor(
    private readonly districts: DistrictsService,
    private readonly centerDrill: CenterService,
  ) {}

  /** Markaz: daromad manbalari, o'z xarajati va hududlar uchun to'langan, bo'limlar */
  @Get('center')
  async center(@Query('from') from?: string, @Query('to') to?: string, @Query('section') section?: string, @Query('compare') compare?: string) {
    return { data: await this.centerDrill.center({ from, to, section, compare }) };
  }

  /** Markaz bo'limi: xarajat tarkibi va xodimlar. id="-" — bo'limga biriktirilmagan */
  @Personal('mask')
  @Get('center/department/:id')
  async centerDepartment(
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('section') section?: string,
    @Query('compare') compare?: string,
  ) {
    return { data: await this.centerDrill.department(id, { from, to, section, compare }) };
  }

  /** Viloyat tumanlari: daromad, xizmatlar soni, xarajat, natija, o'zgarish */
  @Get('region/:code')
  async region(
    @Param('code') code: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('section') section?: string,
    @Query('compare') compare?: string,
  ) {
    const data = await this.districts.regionDistricts(Number(code), { from, to, section, compare });
    return { data };
  }

  /** Tuman: xizmat turlari, xarajat tarkibi, xodimlar. id="-" — tumanga bo'linmagan (?region= kerak) */
  @Personal('mask')
  @Get('district/:id')
  async district(
    @Param('id') id: string,
    @Query('region') region?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('section') section?: string,
    @Query('compare') compare?: string,
  ) {
    const data = await this.districts.district(id, { region, from, to, section, compare });
    return { data };
  }

  /** Xodim: oylar bo'yicha ish haqi, reja, fakt va qaysi tumanda ishlagani */
  @Personal()
  @Get('employee/:pinfl')
  async employee(@Param('pinfl') pinfl: string, @Query('from') from?: string, @Query('to') to?: string) {
    const data = await this.districts.employee(pinfl, { from, to });
    return { data };
  }
}