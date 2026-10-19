import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';

/** Global qidiruv: GET /search?q=... */
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  async find(@Query('q') q?: string) {
    return { data: await this.search.search(q) };
  }
}