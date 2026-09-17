import {
  Controller,
  Get,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
  BadRequestException,
} from '@nestjs/common';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  private assertPeriod(period: string): void {
    if (!/^\d{4}-\d{2}$/.test(period ?? '')) {
      throw new BadRequestException('Davr notogri formatda');
    }
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
