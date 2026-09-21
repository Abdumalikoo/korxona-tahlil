import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { InsightsService } from './insights.service';
import { MetricsService } from './metrics.service';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly insights: InsightsService,
    private readonly metrics: MetricsService,
  ) {}

  private assertPeriod(period: string): void {
    if (!/^\d{4}-\d{2}$/.test(period ?? '')) {
      throw new BadRequestException('Davr notogri formatda');
    }
  }

  private assertRange(from: string, to: string): void {
    const pattern = /^\d{4}-\d{2}-\d{2}$/;

    if (!pattern.test(from ?? '') || !pattern.test(to ?? '')) {
      throw new BadRequestException('Sana oraligi notogri');
    }
  }

  /** Nima ozgardi - tizim ozi topadi */
  @Get('insights')
  async getInsights(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    this.assertRange(dateFrom, dateTo);
    const data = await this.insights.findChanges(dateFrom, dateTo);
    return { data };
  }

  /** Bolimlar reytingi */
  @Get('rating')
  async rating(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    this.assertRange(dateFrom, dateTo);
    const data = await this.metrics.departmentRating(dateFrom, dateTo);
    return { data };
  }

  /** Xodim boshiga korsatkichlar */
  @Get('per-employee')
  async perEmployee(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    this.assertRange(dateFrom, dateTo);
    const data = await this.metrics.perEmployee(dateFrom, dateTo);
    return { data };
  }

  /** Tayyor savolga javob */
  @Get('answer/:question')
  async answer(
    @Param('question') question: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
  ) {
    this.assertRange(dateFrom, dateTo);
    const data = await this.metrics.answer(question, dateFrom, dateTo);
    return { data };
  }

  /** Asosiy korsatkichlar va solishtirish */
  @Get('overview')
  async overview(@Query('period') period: string) {
    this.assertPeriod(period);
    const data = await this.dashboard.overview(period);
    return { data };
  }

  /** Daromad va xarajat dinamikasi */
  @Get('trend')
  async trend(
    @Query('months', new DefaultValuePipe(12), ParseIntPipe) months: number,
    @Query('from') from?: string,
  ) {
    const data = await this.dashboard.trend(Math.min(months, 36), from);
    return { data };
  }

  /** Bolimlar boyicha foyda */
  @Get('departments')
  async departments(@Query('period') period: string) {
    this.assertPeriod(period);
    const data = await this.dashboard.departmentPnL(period);
    return { data };
  }

  /** Etibor talab qiladigan holatlar */
  /** Hududlar boyicha foyda */
  @Get('regions')
  async regions(@Query('period') period: string) {
    this.assertPeriod(period);
    const data = await this.dashboard.regionPnL(period);
    return { data };
  }

  @Get('alerts')
  async alerts(@Query('period') period: string) {
    this.assertPeriod(period);
    const data = await this.dashboard.alerts(period);
    return { data };
  }

  /** Xarajat strukturasi */
  @Get('expense-structure')
  async expenseStructure(@Query('period') period: string) {
    this.assertPeriod(period);
    const data = await this.dashboard.expenseStructure(period);
    return { data };
  }
}
