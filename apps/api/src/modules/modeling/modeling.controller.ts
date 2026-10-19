import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ModelingService, type RunInput } from './modeling.service';

/** Modellar — matematik va ekonometrik tahlil (Python xizmati orqali) */
@Controller('modeling')
export class ModelingController {
  constructor(private readonly modeling: ModelingService) {}

  /** Python xizmati holati: versiyalar va baza bilan aloqa */
  @Get('health')
  async health() {
    const data = await this.modeling.health();
    return { data };
  }

  /** Formulalar katalogi */
  @Get('formulas')
  async catalog() {
    const data = await this.modeling.catalog();
    return { data };
  }

  /** Formulani hisoblash: { start, end, metric?, metric2?, groupBy? } */
  @Post('formulas/:id/run')
  @HttpCode(HttpStatus.OK)
  async run(@Param('id') id: string, @Body() body: RunInput) {
    const data = await this.modeling.run(id, body ?? ({} as RunInput));
    return { data };
  }

  /** Oy × hudud jadvali (?start=YYYY-MM&end=YYYY-MM) */
  @Get('panel')

  async panel(@Query('start') start: string, @Query('end') end: string) {
    const data = await this.modeling.panel(start, end);
    return { data };
  }
}
