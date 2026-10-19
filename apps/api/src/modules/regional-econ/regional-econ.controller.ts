import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, Roles } from '../../common/decorators';
import { DashboardService } from './dashboard.service';
import { RegionalDemo } from './regional.demo';
import { ForecastService } from './forecast.service';
import { KpiService } from './kpi.service';
import { PotentialService } from './potential.service';
import { RegionalEconService } from './regional-econ.service';

/**
 * Katta modellar › «Hudud natijasi» va «Markaz xarajati».
 * ?to=YYYY-MM (davr oxirgi oyi) &mode=M|Q|Y (oy / 3 oy / yil boshidan).
 * Ko'rish — administrator va kuzatuvchi; qoida va drayverlarni faqat administrator o'zgartiradi.
 */
@Controller('regional-econ')
export class RegionalEconController {
  constructor(
    private readonly econ: RegionalEconService,
    private readonly forecasts: ForecastService,
    private readonly potentials: PotentialService,
    private readonly kpis: KpiService,
    private readonly dash: DashboardService,
    private readonly demo: RegionalDemo,
  ) {}

  // ── Katta demo (faqat administrator qo'shadi/o'chiradi) ──
  @Get('demo')
  async demoStatus() {
    return { data: await this.demo.status() };
  }

  @Roles(UserRole.ADMIN)
  @Post('demo')
  async demoCreate(@Body() body: { force?: boolean }, @CurrentUser('id') userId: string) {
    return { data: await this.demo.create(userId, body?.force === true) };
  }

  @Roles(UserRole.ADMIN)
  @Delete('demo')
  async demoRemove(@CurrentUser('id') userId: string) {
    return { data: await this.demo.remove(userId) };
  }

  // ── 5-bosqich: hududlar paneli, «nega o'zgardi?», stsenariylar ──
  @Get('dashboard')
  async dashboard(@Query('to') to?: string) {
    return { data: await this.dash.dashboard(to) };
  }

  @Get('explain')
  async explain(@Query('region') region: string, @Query('period') period?: string) {
    return { data: await this.dash.explain(region, period) };
  }

  /** Stsenariy — faqat hisob, hech narsa saqlanmaydi (?levers= JSON) */
  @Get('scenario')
  async scenario(@Query('to') to?: string, @Query('h') h?: string, @Query('levers') levers?: string) {
    let parsed: Record<string, unknown> = {};
    if (levers) {
      try {
        parsed = JSON.parse(levers) as Record<string, unknown>;
      } catch {
        throw new BadRequestException("Dastaklar noto'g'ri");
      }
    }
    return { data: await this.dash.scenario({ to, h, levers: parsed }) };
  }

  // ── 4-bosqich: salohiyat (?to=YYYY-MM — oxirgi haqiqiy oy, &h=1..12) ──
  @Get('potential')
  async potential(@Query('to') to?: string, @Query('h') h?: string) {
    return { data: await this.potentials.potential(to, h) };
  }

  // ── 4-bosqich: KPI ──
  @Get('kpi')
  async kpi(@Query('period') period?: string) {
    return { data: await this.kpis.list(period) };
  }

  @Get('kpi/:id/history')
  async kpiHistory(@Param('id') id: string) {
    return { data: await this.kpis.history(id) };
  }

  @Roles(UserRole.ADMIN)
  @Post('kpi/period/:period/generate')
  async kpiGenerate(@Param('period') period: string, @CurrentUser('id') userId: string) {
    return { data: await this.kpis.generate(period, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('kpi/period/:period/approve-all')
  async kpiApproveAll(@Param('period') period: string, @CurrentUser('id') userId: string) {
    return { data: await this.kpis.approveAll(period, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('kpi/:id/propose')
  async kpiPropose(@Param('id') id: string, @Body() body: { valueTiyin?: string; note?: string | null }, @CurrentUser('id') userId: string) {
    return { data: await this.kpis.propose(id, body ?? {}, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('kpi/:id/approve')
  async kpiApprove(@Param('id') id: string, @Body() body: { valueTiyin?: string; note?: string | null }, @CurrentUser('id') userId: string) {
    return { data: await this.kpis.approve(id, body ?? {}, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('kpi/:id/reject')
  async kpiReject(@Param('id') id: string, @Body() body: { note?: string | null }, @CurrentUser('id') userId: string) {
    return { data: await this.kpis.reject(id, body?.note, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('kpi/:id/reopen')
  async kpiReopen(@Param('id') id: string, @Body() body: { note?: string | null }, @CurrentUser('id') userId: string) {
    return { data: await this.kpis.reopen(id, body?.note, userId) };
  }

  // ── 3-bosqich: hudud prognozi (?to=YYYY-MM — oxirgi haqiqiy oy, &h=1..12) ──
  @Get('forecast')
  async forecast(@Query('to') to?: string, @Query('h') h?: string) {
    return { data: await this.forecasts.forecast(to, h) };
  }

  @Get('forecast/payroll')
  async payrollDetail(@Query('region') region: string, @Query('to') to?: string, @Query('h') h?: string) {
    return { data: await this.forecasts.payrollDetail(to, h, region) };
  }

  @Get('forecast/runs')
  async runs() {
    return { data: await this.forecasts.runs() };
  }

  @Roles(UserRole.ADMIN)
  @Post('forecast/runs')
  async saveRun(@Body() body: { to?: string; h?: number; note?: string | null }, @CurrentUser('id') userId: string) {
    return { data: await this.forecasts.saveRun(body?.to, body?.h, body?.note, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Delete('forecast/runs/:id')
  async deleteRun(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.forecasts.deleteRun(id, userId) };
  }

  @Get('performance')
  async performance(@Query('to') to?: string, @Query('mode') mode?: string) {
    return { data: await this.econ.performance(to, mode) };
  }

  @Get('overhead')
  async overhead(@Query('to') to?: string, @Query('mode') mode?: string) {
    return { data: await this.econ.overhead(to, mode) };
  }

  @Get('rules')
  async rules() {
    return { data: await this.econ.ruleList() };
  }

  @Roles(UserRole.ADMIN)
  @Post('rules')
  async setRule(@Body() body: { unitKey?: string; role?: string; driver?: string | null; validFrom?: string; note?: string | null }, @CurrentUser('id') userId: string) {
    return { data: await this.econ.setRule(body ?? {}, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Post('rules/accept-suggestions')
  async accept(@Body() body: { validFrom?: string }, @CurrentUser('id') userId: string) {
    return { data: await this.econ.acceptSuggestions(body?.validFrom, userId) };
  }

  @Roles(UserRole.ADMIN)
  @Delete('rules/:id')
  async deleteRule(@Param('id') id: string, @CurrentUser('id') userId: string) {
    return { data: await this.econ.deleteRule(id, userId) };
  }

  @Get('drivers')
  async drivers(@Query('period') period: string, @Query('unitKey') unitKey: string) {
    return { data: await this.econ.driverValues(period, unitKey) };
  }

  @Roles(UserRole.ADMIN)
  @Post('drivers')
  async setDrivers(@Body() body: { period?: string; unitKey?: string; values?: { regionCode: number; value: number | null }[] }, @CurrentUser('id') userId: string) {
    return { data: await this.econ.setDriverValues(String(body?.period ?? ''), String(body?.unitKey ?? ''), body?.values ?? [], userId) };
  }
}