import { Controller, Get, Param, Query } from '@nestjs/common';
import { ChangesService } from './changes.service';
import { RegionsService } from './regions.service';
import { SegmentsService } from './segments.service';
import { UnassignedService } from './unassigned.service';
import { VehicleCostsService } from './vehicle-costs.service';
import { SafarCostsService } from './safar-costs.service';
import { PartDetailService } from './part-detail.service';

/** Solishtirma: hududlar va Markaz — daromad va xarajat; xodimlar o'zgarishi */
@Controller('structure/regions')
export class RegionsController {
  constructor(
    private readonly regions: RegionsService,
    private readonly changes: ChangesService,
    private readonly unassigned: UnassignedService,
    private readonly segments: SegmentsService,
    private readonly vehicleCosts: VehicleCostsService,
    private readonly safarCosts: SafarCostsService,
    private readonly partDetail: PartDetailService,
  ) {}

  /** «Mashina xarajatlari» ichi: qaysi mashinaga qancha, turlari, izoh (?unit=center|dep:ID|r:3|dist:ID|rnd:3|cnd|s:KOD&from&to&compare&section) */
  @Get('vehicles')
  async vehicles(@Query('unit') unit?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('compare') compare?: string, @Query('section') section?: string) {
    return { data: await this.vehicleCosts.costs({ unit, from, to, compare, section }) };
  }

  /** Xarajat qismi ichi (ichma-ich): ichki moddalar → kontragentlar; siyosat qismlari — qayerda yozilgani (?unit&key&from&to&compare&section) */
  @Get('part')
  async part(@Query('unit') unit?: string, @Query('key') key?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('compare') compare?: string, @Query('section') section?: string) {
    return { data: await this.partDetail.detail({ unit, key, from, to, compare, section }) };
  }

  /** «Xizmat safari» moddasi ichi: kimga qancha, oyma-oy (?unit=center|center:regional|dep:ID|r:KOD|dist:ID|s:KOD&from&to&compare&section) */
  @Get('safar')
  async safar(@Query('unit') unit?: string, @Query('from') from?: string, @Query('to') to?: string, @Query('compare') compare?: string, @Query('section') section?: string) {
    return { data: await this.safarCosts.costs({ unit, from, to, compare, section }) };
  }

  /** Yo'nalish (Tax free, Marksheyder …): daromad manbalari, xarajat tarkibi, natija, siyosat oqimlari (?from&to&section&compare) */
  @Get('segment/:code')
  async segment(@Param('code') code: string, @Query('from') from?: string, @Query('to') to?: string, @Query('section') section?: string, @Query('compare') compare?: string) {
    return { data: await this.segments.view(code, { from, to, section, compare }) };
  }

  /** ?from&to&section=ALL|DOIMIY|BOSHQA&compare=prev|yoy */
  @Get()
  async compare(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('section') section?: string,
    @Query('compare') compare?: string,
  ) {
    const data = await this.regions.compare({ from, to, section, compare });
    return { data };
  }

  /** Hududga biriktirilmagan yozuvlar: jami, moddalar, manba, fayllar, oylar va ro'yxat (?from&to&section) */
  @Get('unassigned')
  async unassignedOf(@Query('from') from?: string, @Query('to') to?: string, @Query('section') section?: string) {
    return { data: await this.unassigned.list({ from, to, section }) };
  }

  /** Biriktirilmagan bitta yozuv — to'liq: kim kiritgan, fayl, qaysi hududniki bo'lishi mumkin */
  @Get('unassigned/:side/:id')
  async unassignedItem(@Param('side') side: string, @Param('id') id: string) {
    return { data: await this.unassigned.detail(side, id) };
  }

  /** O'zgarishlar: oy bo'yicha oylik hisoblangan xodimlar, ishga olingan, bo'shagan, ishlamagan, ko'chgan (?month=YYYY-MM yoki ?to=YYYY-MM-DD) */
  @Get('changes')
  async changesOf(@Query('month') month?: string, @Query('to') to?: string) {
    return { data: await this.changes.month({ month, to }) };
  }
}