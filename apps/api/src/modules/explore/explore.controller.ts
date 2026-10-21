import { Controller, Get, Query } from '@nestjs/common';
import { ExploreService } from './explore.service';

/** Bosh sahifa › Daromad / Xarajat / Tahlil: ichiga kirib boriladigan jadvallar va yozuvlar */
@Controller('explore')
export class ExploreController {
  constructor(private readonly explore: ExploreService) {}

  @Get('income')
  async income(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.explore.income(from, to) };
  }

  @Get('expense')
  async expense(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.explore.expense(from, to) };
  }

  @Get('result')
  async result(@Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.explore.result(from, to) };
  }

  /** Jadvaldagi istalgan qatorning yozuvlari: kind, from, to, which (cur|prev|ly), cats, unit, dep, month, party, unpaid, exact, page, sort */
  @Get('records')
  async records(@Query() q: Record<string, string | undefined>) {
    return { data: await this.explore.records(q.kind ?? '', q.from, q.to, ExploreService.parseFilter(q), q.page, q.sort, q.which) };
  }
}