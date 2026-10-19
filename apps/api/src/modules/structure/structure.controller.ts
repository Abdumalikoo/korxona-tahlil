import { Controller, Get, Param, Query } from '@nestjs/common';
import { StructureService } from './structure.service';

/** Daromad va xarajat tarkibi — Tahlil bo'limi */
@Controller('structure')
export class StructureController {
  constructor(private readonly structure: StructureService) {}

  /**
   * Pul oqimi: daromad manbalari → xarajat yo'nalishlari
   * ?from&to&section=ALL|DOIMIY|BOSHQA&compare=prev|yoy
   */
  @Get('flow')
  async flow(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('section') section?: string,
    @Query('compare') compare?: string,
  ) {
    const data = await this.structure.flow({ from, to, section, compare });
    return { data };
  }

  /**
   * Ichma-ich kirish: /structure/expense/tree?from&to&section&compare&path=section~group~...
   * path — tanlangan tugunlar kalitlari, "~" bilan ajratilgan
   * compare — prev (o'tgan teng davr) yoki yoy (o'tgan yilning shu davri)
   * flat=1 — «Doimiy / Boshqa» bosqichisiz (qisqa ko'rinish uchun)
   */
  @Get(':kind/tree')
  async tree(
    @Param('kind') kind: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('section') section?: string,
    @Query('path') path?: string,
    @Query('compare') compare?: string,
    @Query('flat') flat?: string,
  ) {
    const data = await this.structure.tree(kind, { from, to, section, path, compare, flat });
    return { data };
  }
}