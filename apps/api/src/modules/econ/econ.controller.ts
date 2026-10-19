import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EfficiencyService } from './econ.efficiency';
import { FactorsService } from './econ.factors';
import { EconReportService } from './econ.report';
import { ScenarioService } from './econ.scenario';
import { EconService } from './econ.service';

function sendFile(response: Response, buffer: Buffer, filename: string, type: string) {
  response.setHeader('Content-Type', type);
  response.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  response.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  response.send(buffer);
}

/**
 * Katta modellar: prognoz, omillar, samaradorlik, stsenariylar.
 * Ma'lumot faqat Daromadlar, Xarajatlar va Xodimlar bo'limlaridan.
 *
 * Hamma so'rovlarda ?asOf=YYYY-MM — umumiy «Davr» oyi: o'tgan oy bo'lsa, modellar o'sha oy oxirida
 * turgandek hisoblanadi (keyingi oylar yozuvlari olinmaydi). Bo'lmasa — bugungi holat.
 */
@Controller('econ')
export class EconController {
  constructor(
    private readonly econ: EconService,
    private readonly factors: FactorsService,
    private readonly efficiencyService: EfficiencyService,
    private readonly scenarios: ScenarioService,
    private readonly report: EconReportService,
  ) {}

  /** Qancha ma'lumot bor, qaysi model tayyor, ma'lumot sifati haqida ogohlantirishlar */
  @Get('overview')
  async overview(@Query('asOf') asOf?: string) {
    return { data: await this.econ.overview(asOf) };
  }

  /** Prognoz (?target=income|expense|result|payroll&unit=all|center|r:N&horizon=1..24) */
  @Get('forecast')
  async forecast(@Query('target') target?: string, @Query('unit') unit?: string, @Query('horizon') horizon?: string, @Query('asOf') asOf?: string) {
    return { data: await this.econ.forecast({ target, unit, horizon, asOf }) };
  }

  /** Barcha hududlar bo'yicha qisqa prognoz (?target&horizon) */
  @Get('forecast/units')
  async unitsForecast(@Query('target') target?: string, @Query('horizon') horizon?: string, @Query('asOf') asOf?: string) {
    return { data: await this.econ.unitsForecast({ target, horizon, asOf }) };
  }

  /** Omillar tahlili (?factors=headcount,nonpayroll,...) — regressiya, FE/RE, elastiklik, Kobb-Duglas */
  @Get('factors')
  async factorsAnalysis(@Query('factors') factors?: string, @Query('asOf') asOf?: string) {
    return { data: await this.factors.analyze({ factors, asOf }) };
  }

  /** Samaradorlik chegarasi — DEA (?months=3|6|12|24|all&mode=resources|money) */
  @Get('efficiency')
  async efficiency(@Query('months') months?: string, @Query('mode') mode?: string, @Query('asOf') asOf?: string) {
    return { data: await this.efficiencyService.efficiency({ months, mode, asOf }) };
  }

  /** Zararsizlik nuqtasi (?months=6|12|24|all) */
  @Get('breakeven')
  async breakeven(@Query('months') months?: string, @Query('asOf') asOf?: string) {
    return { data: await this.efficiencyService.breakeven({ months, asOf }) };
  }

  /** Stsenariy: { unit, horizon, headcount, wage, vehicle, lease, other, income (foizda), useElasticity } */
  @Post('scenario')
  @HttpCode(HttpStatus.OK)
  async scenario(@Body() body: Record<string, unknown>, @Query('asOf') asOf?: string) {
    return { data: await this.scenarios.scenario({ ...(body ?? {}), asOf }) };
  }

  /** Risk xaritasi: zararga tushish ehtimoli (?horizon=3|6|12) */
  @Get('risk')
  async risk(@Query('horizon') horizon?: string, @Query('asOf') asOf?: string) {
    return { data: await this.scenarios.risk({ horizon, asOf }) };
  }

  /** Barcha modellar bo'yicha Excel hisobot */
  @Get('report')
  async excel(@Res() response: Response, @Query('asOf') asOf?: string) {
    const file = await this.report.excel(asOf);
    sendFile(response, file.buffer, file.filename, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  /** Barcha modellar bo'yicha slaydlar (PowerPoint) */
  @Get('slides')
  async slides(@Res() response: Response, @Query('asOf') asOf?: string) {
    const file = await this.report.slides(asOf);
    sendFile(response, file.buffer, file.filename, 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  }
}