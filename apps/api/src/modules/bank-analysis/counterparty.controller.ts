import { Controller, Get, Param, Query } from '@nestjs/common';
import { CounterpartyService } from './counterparty.service';

/** Kontragentlar — schyot-faktura va bank ko'chirmasidan yagona karta (faqat o'qish): /api/counterparties/… */
@Controller('counterparties')
export class CounterpartyController {
  constructor(private readonly service: CounterpartyService) {}

  @Get()
  async list(@Query('from') from?: string, @Query('to') to?: string, @Query('q') search?: string, @Query('role') role?: string, @Query('issue') issue?: string) {
    return { data: await this.service.list({ from, to, search, role, issue }) };
  }

  @Get(':inn')
  async card(@Param('inn') inn: string, @Query('from') from?: string, @Query('to') to?: string) {
    return { data: await this.service.card(inn, from, to) };
  }
}
